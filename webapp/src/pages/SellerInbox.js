import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import VoiceRecorder from "../components/VoiceRecorder";
import SellerShell from "../components/SellerShell";
import {
  createOrFindDirectRoom,
  createGroupRoom,
  createCallSession,
  getChatIdentityForRole,
  markRoomAsRead,
  sendChatAttachmentWithIdentity,
  sendChatMessageWithIdentity,
  sendVoiceNoteWithIdentity,
  subscribeToIncomingCalls,
  subscribeToMessages,
  subscribeToRooms,
  updateCallSession
} from "../utils/chatApi";
import { getSyncedContacts, mergeSyncedContacts } from "../utils/contactSync";
import { fetchCustomers } from "../utils/customerApi";
import { fetchHospitals } from "../utils/hospitalApi";

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(-10);
}

function formatChatTime(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function SellerInbox() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const identity = getChatIdentityForRole("seller");
  const isMobileViewport = typeof window !== "undefined" && window.innerWidth <= 900;
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState([]);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [directoryFilter, setDirectoryFilter] = useState("");
  const [isStartingRoom, setIsStartingRoom] = useState("");
  const [syncedContacts, setSyncedContacts] = useState(getSyncedContacts());
  const [contactForm, setContactForm] = useState({ name: "", phone: "" });
  const [contactStatus, setContactStatus] = useState("");
  const [groupForm, setGroupForm] = useState({ name: "", members: [] });
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    return subscribeToRooms(
      identity.phone,
      (nextRooms) => {
        setRooms(nextRooms);
        setRoomError("");
      },
      (error) => {
        setRooms([]);
        setRoomError(error?.message || "Unable to load seller conversations right now.");
      }
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    let isMounted = true;

    const loadDirectory = async () => {
      try {
        const [customerList, hospitalList] = await Promise.all([
          fetchCustomers(),
          fetchHospitals()
        ]);

        if (!isMounted) return;

        const roomContacts = rooms
          .filter((room) => room.roomType !== "group")
          .map((room) => ({
            id: room.id,
            type: room.targetType || "customer",
            name: room.targetName || room.lastSenderName || "Customer",
            subtitle: "Existing conversation",
            phone: normalizePhone(room.targetPhone || (room.participantPhones || []).find((phone) => phone !== identity.phone) || "")
          }))
          .filter((item) => item.phone);

        const customerDirectory = customerList
          .map((item) => ({
            id: item.id || item.phone,
            type: "customer",
            name: item.name || "Customer",
            subtitle: item.area || item.email || "Registered customer",
            phone: normalizePhone(item.phone || item.id || "")
          }))
          .filter((item) => item.phone && item.phone !== normalizePhone(identity.phone));

        const hospitalDirectory = hospitalList
          .map((item) => ({
            id: item.id,
            type: "hospital",
            name: item.hospitalName || "Hospital",
            subtitle: item.city || "Hospital support",
            phone: normalizePhone(item.phone || item.emergencyPhone || "")
          }))
          .filter((item) => item.phone && item.phone !== normalizePhone(identity.phone));

        const mergedDirectory = [...roomContacts, ...customerDirectory, ...hospitalDirectory].filter((item, index, array) => {
          return array.findIndex((entry) => entry.phone === item.phone) === index;
        });

        setDirectory(mergedDirectory);
      } catch (error) {
        console.error("Failed to load seller chat directory:", error);
        if (isMounted) {
          setDirectory([]);
        }
      }
    };

    loadDirectory();

    return () => {
      isMounted = false;
    };
  }, [identity?.phone, rooms]);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    return subscribeToIncomingCalls(
      identity.phone,
      setIncomingCalls,
      (error) => console.error("Failed to subscribe to seller incoming calls:", error)
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setMessageError("");
      return undefined;
    }

    markRoomAsRead(roomId, identity?.phone).catch((error) => {
      console.error("Failed to mark seller room as read:", error);
    });

    return subscribeToMessages(
      roomId,
      (nextMessages) => {
        setMessages(nextMessages);
        setMessageError("");
      },
      (error) => {
        setMessages([]);

        if ((error?.message || "").toLowerCase().includes("index")) {
          setMessageError("Inbox is getting ready. Firestore index is still building, please retry shortly.");
          return;
        }

        setMessageError(error?.message || "Unable to load this seller conversation right now.");
      }
    );
  }, [identity?.phone, roomId]);

  const activeRoom = useMemo(
    () => rooms.find((item) => item.id === roomId) || null,
    [roomId, rooms]
  );

  const visibleDirectory = useMemo(() => {
    const keyword = directoryFilter.trim().toLowerCase();
    const externalContacts = syncedContacts.map((item) => ({
      id: item.phone,
      type: "contact",
      name: item.name,
      subtitle: "Phone contact",
      phone: normalizePhone(item.phone),
      role: item.role || "contact"
    }));

    const combined = [...directory, ...externalContacts].filter((item, index, array) => {
      return array.findIndex((entry) => entry.phone === item.phone) === index;
    });

    if (!keyword) return combined;

    return combined.filter((item) => (
      (item.name || "").toLowerCase().includes(keyword) ||
      (item.subtitle || "").toLowerCase().includes(keyword) ||
      (item.type || "").toLowerCase().includes(keyword) ||
      (item.phone || "").includes(keyword)
    ));
  }, [directory, directoryFilter, syncedContacts]);

  const visibleChats = useMemo(() => {
    const keyword = directoryFilter.trim().toLowerCase();

    if (!keyword) return rooms;

    return rooms.filter((room) => {
      const title = room.roomType === "group"
        ? room.groupName || room.targetName || "Group"
        : room.lastSenderName === identity.name
          ? room.targetName
          : room.lastSenderName || room.targetName || "Customer";

      return (
        title.toLowerCase().includes(keyword) ||
        (room.lastMessage || "").toLowerCase().includes(keyword)
      );
    });
  }, [directoryFilter, identity.name, rooms]);

  useEffect(() => {
    if (isMobileViewport) return;
    if (!roomId && rooms.length > 0) {
      navigate(`/seller/inbox/${rooms[0].id}`, { replace: true });
    }
  }, [isMobileViewport, navigate, roomId, rooms]);

  if (!identity) {
    return <Navigate to="/register/seller" replace />;
  }

  const handleSend = async (event) => {
    event.preventDefault();

    if (!roomId || (!draft.trim() && !attachmentFile)) return;

    if (attachmentFile) {
      try {
        setSendingAttachment(true);
        await sendChatAttachmentWithIdentity(roomId, attachmentFile, identity, draft.trim());
        setAttachmentFile(null);
        setDraft("");
        return;
      } finally {
        setSendingAttachment(false);
      }
    }

    await sendChatMessageWithIdentity(roomId, draft.trim(), identity);
    setDraft("");
  };

  const handleStartCall = async (mode) => {
    if (!activeRoom) return;

    const targetPhone = (activeRoom.participantPhones || []).find((phone) => phone !== identity.phone) || "";

    const callId = await createCallSession({
      roomId: activeRoom.id,
      mode,
      targetName: activeRoom.targetName || "Customer consultation",
      targetPhone,
      targetRole: "customer"
    });

    navigate(`/consult/${callId}`);
  };

  const handleIncomingCallAction = async (callId, status) => {
    await updateCallSession(callId, { status });

    if (status === "accepted") {
      navigate(`/consult/${callId}`);
    }
  };

  const handleStartChat = async (entry) => {
    setIsStartingRoom(entry.id);

    try {
      const nextRoomId = await createOrFindDirectRoom({
        targetId: entry.id,
        targetType: entry.type === "contact" ? "customer" : entry.type,
        targetName: entry.name,
        targetPhone: entry.phone,
        initialMessage:
          entry.type === "hospital"
            ? `Hello ${entry.name}, this is ${identity.name} from seller support.`
            : `Hello ${entry.name}, I want to connect through seller inbox.`
      });

      navigate(`/seller/inbox/${nextRoomId}`);
    } catch (error) {
      console.error("Failed to start seller chat:", error);
    } finally {
      setIsStartingRoom("");
    }
  };

  const handleContactSync = async () => {
    if ("contacts" in navigator && "ContactsManager" in window) {
      try {
        const contacts = await navigator.contacts.select(["name", "tel"], { multiple: true });
        const nextContacts = contacts.map((item) => ({
          name: item.name?.[0] || item.tel?.[0] || "Contact",
          phone: normalizePhone(item.tel?.[0] || "")
        })).filter((item) => item.phone);

        const merged = mergeSyncedContacts(nextContacts);
        setSyncedContacts(merged);
        setContactStatus(`Synced ${nextContacts.length} contacts.`);
        return;
      } catch (error) {
        console.error("Seller contacts sync failed:", error);
      }
    }

    setContactStatus("Direct contacts sync is not supported here. Use manual add.");
  };

  const handleManualContactAdd = () => {
    const phone = normalizePhone(contactForm.phone);
    const name = contactForm.name.trim();

    if (!name || phone.length !== 10) {
      setContactStatus("Enter contact name and valid 10 digit phone number.");
      return;
    }

    const merged = mergeSyncedContacts([{ name, phone, role: "customer" }]);
    setSyncedContacts(merged);
    setContactForm({ name: "", phone: "" });
    setContactStatus(`Added ${name} to contacts.`);
  };

  const handleToggleGroupMember = (phone) => {
    setGroupForm((current) => ({
      ...current,
      members: current.members.includes(phone)
        ? current.members.filter((item) => item !== phone)
        : [...current.members, phone]
    }));
  };

  const handleCreateGroup = async () => {
    const name = groupForm.name.trim();
    if (!name || groupForm.members.length === 0) {
      setContactStatus("Enter group name and select at least one member.");
      return;
    }

    const memberDetails = visibleDirectory
      .filter((item) => groupForm.members.includes(item.phone))
      .map((item) => ({
        name: item.name,
        phone: item.phone,
        role: item.type
      }));

    try {
      const nextRoomId = await createGroupRoom({
        groupName: name,
        members: memberDetails,
        initialMessage: `${identity.name} started this seller group.`
      });
      setGroupForm({ name: "", members: [] });
      setContactStatus(`Group ${name} created successfully.`);
      navigate(`/seller/inbox/${nextRoomId}`);
    } catch (error) {
      console.error("Seller group creation failed:", error);
      setContactStatus("Group creation failed.");
    }
  };

  return (
    <SellerShell
      title="Seller inbox"
      subtitle="Reply to customer conversations directly from your seller workspace."
      actions={
        <>
          <Link className="header-link" to="/seller/shop-profile">
            Back to dashboard
          </Link>
        </>
      }
    >
      {incomingCalls.length > 0 && (
        <section className="hospital-stack">
          {incomingCalls.map((call) => (
            <div key={call.id} className="soft-panel">
              <div className="seller-product-head">
                <div>
                  <div className="eyebrow">Incoming call</div>
                  <h3>{call.hostName || "Customer"} is calling</h3>
                </div>
                <span className="order-status-pill">{call.mode}</span>
              </div>
              <p className="muted-copy">
                Accept to open the consultation room, or reject to stop the ringing request.
              </p>
              <div className="account-actions" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleIncomingCallAction(call.id, "accepted")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="header-link"
                  onClick={() => handleIncomingCallAction(call.id, "rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className={activeRoom ? "chat-layout chat-layout-thread-open" : "chat-layout"}>
        <aside className="chat-sidebar chat-sidebar-whatsapp">
          <div className="chat-directory-panel chat-directory-panel-whatsapp">
            <div className="chat-directory-topbar">
              <div>
                <div className="section-title" style={{ marginBottom: 0 }}>Chats</div>
                <small>{rooms.length} active rooms</small>
              </div>
              <div className="chat-topbar-icons">
                <button type="button" className="chat-icon-button" onClick={handleContactSync} title="Load contacts">
                  @
                </button>
                <button type="button" className="chat-icon-button" onClick={() => setQuickPanelOpen((current) => !current)} title="More options">
                  +
                </button>
              </div>
            </div>

            {quickPanelOpen ? (
              <div className="chat-quick-panel">
                <div className="chat-quick-panel-section">
                  <div className="identity-label">Saved contacts</div>
                  <div className="chat-directory-list">
                    {visibleDirectory.slice(0, 6).map((entry) => (
                      <button
                        key={`quick-contact-${entry.type}-${entry.id}-${entry.phone}`}
                        type="button"
                        className="chat-directory-card chat-directory-card-whatsapp"
                        onClick={() => {
                          setQuickPanelOpen(false);
                          handleStartChat(entry);
                        }}
                        disabled={isStartingRoom === entry.id}
                      >
                        <div className="chat-avatar">{(entry.name || "?").charAt(0).toUpperCase()}</div>
                        <div className="chat-directory-copy">
                          <strong>{entry.name}</strong>
                          <p>{entry.phone || entry.subtitle}</p>
                        </div>
                        <span className="chat-directory-cta">Open</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="chat-quick-panel-grid">
                  <div className="chat-quick-panel-section">
                    <div className="identity-label">New contact</div>
                    <div className="seller-form-grid">
                      <input
                        type="text"
                        value={contactForm.name}
                        onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Contact name"
                      />
                      <input
                        type="text"
                        value={contactForm.phone}
                        onChange={(event) => setContactForm((current) => ({ ...current, phone: normalizePhone(event.target.value) }))}
                        placeholder="10 digit number"
                      />
                    </div>
                    <div className="seller-inline-actions">
                      <button type="button" className="header-link" onClick={handleManualContactAdd}>
                        Save contact
                      </button>
                    </div>
                  </div>

                  <div className="chat-quick-panel-section">
                    <div className="identity-label">New group</div>
                    <label>
                      Group name
                      <input
                        type="text"
                        value={groupForm.name}
                        onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Family group / Delivery team"
                      />
                    </label>
                    <div className="chat-group-members">
                      {visibleDirectory.slice(0, 6).map((entry) => (
                        <label key={`group-quick-${entry.phone}`} className="seller-check-row">
                          <input
                            type="checkbox"
                            checked={groupForm.members.includes(entry.phone)}
                            onChange={() => handleToggleGroupMember(entry.phone)}
                          />
                          {entry.name}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={async () => {
                        await handleCreateGroup();
                        setQuickPanelOpen(false);
                      }}
                    >
                      Create group
                    </button>
                  </div>
                </div>

                {contactStatus ? <p className="muted-copy">{contactStatus}</p> : null}
              </div>
            ) : null}

            <input
              type="text"
              value={directoryFilter}
              onChange={(event) => setDirectoryFilter(event.target.value)}
              placeholder="Search customer chats"
              className="chat-search-input"
            />

            <div className="chat-directory-section">
              <div className="identity-label">Conversations</div>
              {rooms.length === 0 && (
                <div className="soft-panel">
                  <p className="muted-copy">No customer conversations yet.</p>
                </div>
              )}

              {roomError && (
                <div className="soft-panel">
                  <p className="muted-copy">{roomError}</p>
                </div>
              )}

              <div className="chat-room-list">
            {visibleChats.map((room) => (
              <Link
                key={room.id}
                className={room.id === roomId ? "chat-room-card active chat-room-card-whatsapp" : "chat-room-card chat-room-card-whatsapp"}
                to={`/seller/inbox/${room.id}`}
              >
                <div className="chat-avatar">
                  {(room.groupName || room.targetName || room.lastSenderName || "C").charAt(0).toUpperCase()}
                </div>
                <div className="chat-directory-copy">
                  <strong>
                    {room.roomType === "group"
                      ? room.groupName || room.targetName || "Group"
                      : room.lastSenderName === identity.name
                        ? room.targetName
                        : room.lastSenderName || "Customer"}
                  </strong>
                  <p>{room.lastMessage || "No message yet"}</p>
                </div>
                <div className="chat-room-side">
                  <small>{formatChatTime(room.updatedAt || room.lastMessageAt) || "Now"}</small>
                  {room.unreadByPhones?.includes(identity.phone) ? <span className="chat-unread-dot">1</span> : null}
                </div>
              </Link>
            ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="chat-thread-panel chat-thread-panel-pro">
          {!activeRoom && (
            <div className="soft-panel">
              <h3>Select a customer chat</h3>
              <p className="muted-copy">Open a conversation from the left side.</p>
            </div>
          )}

          {activeRoom && (
            <>
              <div className="chat-thread-head chat-thread-head-pro">
                <div>
                  <button
                    type="button"
                    className="chat-mobile-back"
                    onClick={() => navigate("/seller/inbox", { replace: true })}
                  >
                    Back to chats
                  </button>
                  <div className="eyebrow">Seller thread</div>
                  <h2>{activeRoom.roomType === "group" ? activeRoom.groupName || activeRoom.targetName || "Group conversation" : activeRoom.targetName || "Customer conversation"}</h2>
                  <p className="muted-copy">
                    {activeRoom.roomType === "group"
                      ? `${activeRoom.participantPhones?.length || 0} members in this group`
                      : "Direct customer support conversation"}
                  </p>
                </div>
                <div className="chat-thread-actions">
                  <div className="order-status-pill">{activeRoom.roomType === "group" ? "group" : activeRoom.targetType}</div>
                  {activeRoom.roomType !== "group" ? (
                    <>
                      <button type="button" className="chat-icon-button" onClick={() => handleStartCall("audio")} title="Audio call">
                        A
                      </button>
                      <button type="button" className="chat-icon-button" onClick={() => handleStartCall("video")} title="Video call">
                        V
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="chat-message-list chat-message-list-pro">
                {messageError && (
                  <div className="soft-panel">
                    <p className="muted-copy">{messageError}</p>
                  </div>
                )}
                {messages.map((message) => {
                  const isMine = message.senderPhone === identity.phone;

                  return (
                    <div
                      key={message.id}
                      className={isMine ? "chat-bubble mine" : "chat-bubble"}
                    >
                      <small>{message.senderName}</small>
                      <div>{message.text}</div>
                      {message.attachmentUrl ? (
                        message.attachmentType?.startsWith("audio/") ? (
                          <audio controls className="chat-audio-player" src={message.attachmentUrl} />
                        ) : message.attachmentKind === "image" ? (
                          <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="chat-attachment-link">
                            <img src={message.attachmentUrl} alt={message.attachmentName || "attachment"} className="chat-attachment-preview" />
                          </a>
                        ) : (
                          <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="chat-attachment-link">
                            Open {message.attachmentName || "attachment"}
                          </a>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <form className="chat-input-row chat-input-row-pro" onSubmit={handleSend}>
                <textarea
                  rows="3"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Reply as seller"
                />
                <div className="seller-inline-actions">
                  <label className="header-link" style={{ cursor: "pointer" }}>
                    Attach image/file
                    <input
                      type="file"
                      style={{ display: "none" }}
                      onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  {attachmentFile ? <span className="muted-copy">Selected: {attachmentFile.name}</span> : null}
                </div>
                <VoiceRecorder
                  disabled={!roomId || sendingAttachment}
                  onReady={async (file) => {
                    if (!roomId) return;
                    try {
                      setSendingAttachment(true);
                      await sendVoiceNoteWithIdentity(roomId, file, identity, "Voice note");
                    } finally {
                      setSendingAttachment(false);
                    }
                  }}
                />
                <div className="chat-compose-bar">
                  <span className="muted-copy">Sending as {identity.name}</span>
                  <button type="submit" className="primary-button">
                    {sendingAttachment ? "Uploading..." : "Send reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </SellerShell>
  );
}

export default SellerInbox;
