import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import VoiceRecorder from "../components/VoiceRecorder";
import HospitalShell from "../components/HospitalShell";
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
import { fetchHospitals } from "../utils/hospitalApi";
import { fetchCustomers } from "../utils/customerApi";

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(-10);
}

function HospitalInbox() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const identity = getChatIdentityForRole("hospital");
  const isMobileViewport = typeof window !== "undefined" && window.innerWidth <= 900;
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState([]);
  const [directoryFilter, setDirectoryFilter] = useState("");
  const [isStartingRoom, setIsStartingRoom] = useState("");
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [syncedContacts, setSyncedContacts] = useState(getSyncedContacts());
  const [contactForm, setContactForm] = useState({ name: "", phone: "" });
  const [contactStatus, setContactStatus] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
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
        setRoomError(error?.message || "Unable to load hospital conversations right now.");
      }
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    let isMounted = true;

    const loadDirectory = async () => {
      try {
        const [hospitalList, customerList] = await Promise.all([
          fetchHospitals(),
          fetchCustomers()
        ]);

        if (!isMounted) return;

        const hospitalDirectory = hospitalList
          .map((item) => ({
            id: item.id,
            type: "hospital",
            name: item.hospitalName || "Hospital",
            subtitle: item.city || "Hospital support",
            phone: normalizePhone(item.phone || item.emergencyPhone || "")
          }))
          .filter((item) => item.phone && item.phone !== normalizePhone(identity.phone));

        const roomContacts = rooms
          .filter((room) => room.roomType !== "group")
          .map((room) => ({
            id: room.id,
            type: room.targetType || "customer",
            name: room.targetName || room.lastSenderName || "Patient",
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

        const mergedDirectory = [...roomContacts, ...customerDirectory, ...hospitalDirectory].filter((item, index, array) => {
          return array.findIndex((entry) => entry.phone === item.phone) === index;
        });

        setDirectory(mergedDirectory);
      } catch (error) {
        console.error("Failed to load hospital chat directory:", error);
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
      (error) => console.error("Failed to subscribe to hospital incoming calls:", error)
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setMessageError("");
      return undefined;
    }

    markRoomAsRead(roomId, identity?.phone).catch((error) => {
      console.error("Failed to mark hospital room as read:", error);
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
          setMessageError("Hospital inbox is getting ready. Firestore index is still building, please retry shortly.");
          return;
        }

        setMessageError(error?.message || "Unable to load this hospital conversation right now.");
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

  const selectedGroupPhones = useMemo(
    () => groupMembers.split(",").map((item) => item.trim()).filter(Boolean),
    [groupMembers]
  );

  const visibleChats = useMemo(() => {
    const keyword = directoryFilter.trim().toLowerCase();

    if (!keyword) return rooms;

    return rooms.filter((room) => {
      const title = room.roomType === "group"
        ? room.groupName || room.targetName || "Group"
        : room.lastSenderName === identity.name
          ? room.targetName
          : room.lastSenderName || room.targetName || "Patient";

      return (
        title.toLowerCase().includes(keyword) ||
        (room.lastMessage || "").toLowerCase().includes(keyword)
      );
    });
  }, [directoryFilter, identity.name, rooms]);

  useEffect(() => {
    if (isMobileViewport) return;
    if (!roomId && rooms.length > 0) {
      navigate(`/hospital/inbox/${rooms[0].id}`, { replace: true });
    }
  }, [isMobileViewport, navigate, roomId, rooms]);

  if (!identity) {
    return <Navigate to="/hospital/access" replace />;
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
      targetName: activeRoom.targetName || "Patient consultation",
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

  const handleCreateGroup = async () => {
    const members = visibleDirectory
      .filter((entry) => selectedGroupPhones.includes(entry.phone))
      .map((entry) => ({
        phone: entry.phone,
        name: entry.name,
        role: entry.type || "customer"
      }));

    if (!groupName.trim() || members.length === 0) {
      alert("Enter group name and at least one phone number.");
      return;
    }

    try {
      setGroupBusy(true);
      const newRoomId = await createGroupRoom({
        groupName: groupName.trim(),
        members,
        initialMessage: `${identity.name} started this hospital group.`
      });
      setGroupName("");
      setGroupMembers("");
      navigate(`/hospital/inbox/${newRoomId}`);
    } catch (error) {
      console.error("Failed to create hospital group:", error);
      alert("Could not create group.");
    } finally {
      setGroupBusy(false);
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
        initialMessage: `Hello ${entry.name}, this is ${identity.name} from hospital support.`
      });

      navigate(`/hospital/inbox/${nextRoomId}`);
    } catch (error) {
      console.error("Failed to start hospital chat:", error);
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
        console.error("Hospital contacts sync failed:", error);
      }
    }

    setContactStatus("Direct contacts sync is not supported here. Use manual add.");
  };

  const handleManualContactAdd = () => {
    const phone = normalizePhone(contactForm.phone);
    const name = contactForm.name.trim();

    if (!name || !phone) {
      setContactStatus("Enter contact name and valid 10 digit phone number.");
      return;
    }

    const merged = mergeSyncedContacts([{ name, phone, role: "customer" }]);
    setSyncedContacts(merged);
    setContactForm({ name: "", phone: "" });
    setContactStatus(`Added ${name} to contacts.`);
  };

  const handleToggleGroupMember = (phone) => {
    const members = groupMembers
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const nextMembers = members.includes(phone)
      ? members.filter((item) => item !== phone)
      : [...members, phone];

    setGroupMembers(nextMembers.join(", "));
  };

  const getPreviewLabel = (room) => {
    if (!room?.lastMessage) return "Start consultation chat";
    return room.lastSenderPhone === identity.phone
      ? `Outgoing: ${room.lastMessage}`
      : `Incoming: ${room.lastMessage}`;
  };

  return (
    <HospitalShell
      title="Hospital inbox"
      subtitle="Handle patient questions, support requests and consultation follow-up from one place."
      actions={
        <>
          <Link className="header-link" to="/hospital/dashboard">
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
                  <div className="eyebrow">Incoming consultation</div>
                  <h3>{call.hostName || "Patient"} is calling</h3>
                </div>
                <span className="order-status-pill">{call.mode}</span>
              </div>
              <p className="muted-copy">
                Accept to join the consultation room or reject to close this request.
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
                <button
                  type="button"
                  className="chat-icon-button"
                  onClick={() => setQuickPanelOpen((current) => !current)}
                  title="More options"
                >
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
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder="Follow-up patients"
                      />
                    </label>
                    <div className="chat-group-members">
                      {visibleDirectory.slice(0, 6).map((entry) => (
                        <label key={`group-quick-${entry.phone}`} className="seller-check-row">
                          <input
                            type="checkbox"
                            checked={selectedGroupPhones.includes(entry.phone)}
                            onChange={() => handleToggleGroupMember(entry.phone)}
                          />
                          {entry.name}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={groupBusy}
                      onClick={async () => {
                        await handleCreateGroup();
                        setQuickPanelOpen(false);
                      }}
                    >
                      {groupBusy ? "Creating..." : "Create group"}
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
              placeholder="Search contacts or chats"
              className="chat-search-input"
            />

            <div className="chat-directory-section">
              <div className="identity-label">Conversations</div>
              {rooms.length === 0 && (
                <div className="soft-panel">
                  <p className="muted-copy">No patient conversations yet.</p>
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
                    to={`/hospital/inbox/${room.id}`}
                  >
                    <div className="chat-avatar">
                      {(room.groupName || room.targetName || room.lastSenderName || "P").charAt(0).toUpperCase()}
                    </div>
                    <div className="chat-directory-copy">
                      <strong>
                        {room.roomType === "group"
                          ? room.groupName || room.targetName || "Group"
                          : room.lastSenderName === identity.name
                            ? room.targetName
                            : room.lastSenderName || "Patient"}
                      </strong>
                      <p>{getPreviewLabel(room)}</p>
                    </div>
                    <div className="chat-room-side">
                      <small>{room.unreadByPhones?.includes(identity.phone) ? "New" : "Open"}</small>
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
              <h3>Select a patient chat</h3>
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
                    onClick={() => navigate("/hospital/inbox", { replace: true })}
                  >
                    Back to chats
                  </button>
                  <div className="eyebrow">Hospital thread</div>
                  <h2>{activeRoom.roomType === "group" ? activeRoom.groupName || activeRoom.targetName || "Group thread" : activeRoom.targetName || "Patient support thread"}</h2>
                  <p className="muted-copy">
                    {activeRoom.roomType === "group"
                      ? `${activeRoom.participantPhones?.length || 0} members in this group`
                      : "Direct patient support conversation"}
                  </p>
                </div>
                <div className="chat-thread-actions">
                  <div className="order-status-pill">{activeRoom.roomType === "group" ? "group" : activeRoom.targetType}</div>
                  {activeRoom.roomType !== "group" ? (
                    <>
                      <button
                        type="button"
                        className="chat-icon-button"
                        onClick={() => handleStartCall("audio")}
                        title="Audio consultancy"
                      >
                        📞
                      </button>
                      <button
                        type="button"
                        className="chat-icon-button"
                        onClick={() => handleStartCall("video")}
                        title="Video consultancy"
                      >
                        📹
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="chat-message-list chat-message-list-pro chat-message-list-dark">
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
                <div className="chat-compose-shell">
                  <label className="chat-icon-button" style={{ cursor: "pointer" }} title="Attach file">
                    ＋
                    <input
                      type="file"
                      style={{ display: "none" }}
                      onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  <textarea
                    rows="2"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Type a message"
                  />
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
                  <button type="submit" className="chat-send-button" title="Send message">
                    ➤
                  </button>
                </div>
                <div className="chat-compose-bar">
                  <span className="muted-copy">
                    {attachmentFile ? `Selected: ${attachmentFile.name}` : `Sending as ${identity.name}`}
                  </span>
                  {sendingAttachment ? <span className="muted-copy">Uploading...</span> : null}
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </HospitalShell>
  );
}

export default HospitalInbox;
