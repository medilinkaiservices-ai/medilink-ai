import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import CustomerWorkspaceSidebar from "../components/CustomerWorkspaceSidebar";
import VoiceRecorder from "../components/VoiceRecorder";
import { fetchHospitals } from "../utils/hospitalApi";
import {
  createCallSession,
  createGroupRoom,
  createOrFindDirectRoom,
  getCurrentChatIdentity,
  markRoomAsRead,
  sendChatAttachment,
  sendChatMessage,
  sendVoiceNote,
  subscribeToIncomingCalls,
  subscribeToMessages,
  subscribeToRooms,
  updateCallSession
} from "../utils/chatApi";
import { getSyncedContacts, mergeSyncedContacts } from "../utils/contactSync";

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

function ChatInbox() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const identity = getCurrentChatIdentity();
  const isMobileViewport = typeof window !== "undefined" && window.innerWidth <= 900;
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState([]);
  const [directoryFilter, setDirectoryFilter] = useState("");
  const [isStartingRoom, setIsStartingRoom] = useState("");
  const [roomError, setRoomError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [syncedContacts, setSyncedContacts] = useState(getSyncedContacts());
  const [contactForm, setContactForm] = useState({ name: "", phone: "" });
  const [groupForm, setGroupForm] = useState({ name: "", members: [] });
  const [contactStatus, setContactStatus] = useState("");
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [sendingAttachment, setSendingAttachment] = useState(false);
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
        setRoomError(error?.message || "Unable to load conversations right now.");
      }
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    return subscribeToIncomingCalls(
      identity.phone,
      setIncomingCalls,
      (error) => console.error("Failed to subscribe to customer incoming calls:", error)
    );
  }, [identity?.phone]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setMessageError("");
      return undefined;
    }

    markRoomAsRead(roomId, identity?.phone).catch((error) => {
      console.error("Failed to mark customer room as read:", error);
    });

    return subscribeToMessages(
      roomId,
      (nextMessages) => {
        setMessages(nextMessages);
        setMessageError("");
      },
      (error) => {
        setMessages([]);
        setMessageError(error?.message || "Unable to load this conversation right now.");
      }
    );
  }, [identity?.phone, roomId]);

  useEffect(() => {
    if (!identity?.phone) return undefined;

    let isMounted = true;

    const loadDirectory = async () => {
      try {
        const [sellerSnapshot, hospitalList] = await Promise.all([
          getDocs(collection(db, "sellers")),
          fetchHospitals()
        ]);

        if (!isMounted) return;

        const sellerDirectory = sellerSnapshot.docs
          .map((item) => ({
            id: item.id,
            type: "seller",
            name: item.data().shopName || item.data().name || "Shop",
            subtitle: item.data().area || "Local seller",
            phone: normalizePhone(item.data().ownerPhone || item.data().phone || "")
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

        setDirectory([...sellerDirectory, ...hospitalDirectory]);
      } catch (error) {
        console.error("Failed to load chat directory:", error);
        if (isMounted) {
          setDirectory([]);
        }
      }
    };

    loadDirectory();

    return () => {
      isMounted = false;
    };
  }, [identity?.phone]);

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

    return combined.filter((item) => {
      return (
        (item.name || "").toLowerCase().includes(keyword) ||
        (item.subtitle || "").toLowerCase().includes(keyword) ||
        (item.type || "").toLowerCase().includes(keyword) ||
        (item.phone || "").includes(keyword)
      );
    });
  }, [directory, directoryFilter, syncedContacts]);

  const visibleChats = useMemo(() => {
    const keyword = directoryFilter.trim().toLowerCase();

    if (!keyword) return rooms;

    return rooms.filter((room) => {
      const title = room.roomType === "group"
        ? room.groupName || room.targetName || "Group"
        : room.targetName || "Conversation";

      return (
        title.toLowerCase().includes(keyword) ||
        (room.lastMessage || "").toLowerCase().includes(keyword)
      );
    });
  }, [directoryFilter, rooms]);

  useEffect(() => {
    if (isMobileViewport) return;
    if (!roomId && rooms.length > 0) {
      navigate(`/connect/${rooms[0].id}`, { replace: true });
    }
  }, [isMobileViewport, navigate, roomId, rooms]);

  const handleSend = async (event) => {
    event.preventDefault();

    if (!roomId || (!draft.trim() && !attachmentFile)) return;

    if (attachmentFile) {
      try {
        setSendingAttachment(true);
        await sendChatAttachment(roomId, attachmentFile, draft.trim());
        setAttachmentFile(null);
        setDraft("");
        return;
      } finally {
        setSendingAttachment(false);
      }
    }

    await sendChatMessage(roomId, draft.trim());
    setDraft("");
  };

  const handleStartChat = async (entry) => {
    setIsStartingRoom(entry.id);

    try {
      const nextRoomId = await createOrFindDirectRoom({
        targetId: entry.id,
        targetType: entry.type === "contact" ? "contact" : entry.type,
        targetName: entry.name,
        targetPhone: entry.phone,
        initialMessage:
          entry.type === "hospital"
            ? `Hello ${entry.name}, I need support with appointment or treatment details.`
            : `Hello ${entry.name}, I want to connect through Medilink chat.`
      });

      navigate(`/connect/${nextRoomId}`);
    } catch (error) {
      console.error("Failed to start chat:", error);
    } finally {
      setIsStartingRoom("");
    }
  };

  const handleStartCall = async (mode) => {
    if (!activeRoom) return;

    const callId = await createCallSession({
      roomId: activeRoom.id,
      mode,
      targetName: activeRoom.targetName || "Consultation",
      targetPhone: activeRoom.targetPhone,
      targetRole: activeRoom.targetType
    });

    navigate(`/consult/${callId}`);
  };

  const handleIncomingCallAction = async (callId, status) => {
    await updateCallSession(callId, { status });

    if (status === "accepted") {
      navigate(`/consult/${callId}`);
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
        setContactStatus(`Synced ${nextContacts.length} phone contacts.`);
        return;
      } catch (error) {
        console.error("Contact picker failed:", error);
      }
    }

    setContactStatus("Direct phone contacts sync is not supported here. Use manual add below.");
  };

  const handleManualContactAdd = () => {
    const phone = normalizePhone(contactForm.phone);
    const name = contactForm.name.trim();

    if (!name || phone.length !== 10) {
      setContactStatus("Enter contact name and valid 10 digit phone number.");
      return;
    }

    const merged = mergeSyncedContacts([{ name, phone, role: "contact" }]);
    setSyncedContacts(merged);
    setContactForm({ name: "", phone: "" });
    setContactStatus(`Added ${name} to synced contacts.`);
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
        initialMessage: `Group ${name} created in Medilink chat.`
      });
      setGroupForm({ name: "", members: [] });
      setContactStatus(`Group ${name} created successfully.`);
      navigate(`/connect/${nextRoomId}`);
    } catch (error) {
      console.error("Group creation failed:", error);
      setContactStatus("Group creation failed.");
    }
  };

  const getPreviewLabel = (room) => {
    if (!room?.lastMessage) return "Start professional chat";
    return room.lastSenderPhone === identity.phone
      ? `Outgoing: ${room.lastMessage}`
      : `Incoming: ${room.lastMessage}`;
  };

  const getBusinessLabel = () => {
    if (!activeRoom) return "Business team";
    if (activeRoom.roomType === "group") return "Group support";
    return activeRoom.targetType === "hospital" ? "Hospital desk" : "Shop team";
  };

  const getAssistantLabel = () => {
    if (!activeRoom) return "AI assistant";
    const name = activeRoom.targetName || "Business";
    return `${name} assistant`;
  };

  const businessLabel = getBusinessLabel();
  const assistantLabel = getAssistantLabel();

  const introMessages = useMemo(() => {
    if (!activeRoom || messages.length > 0) return [];

    return [
      {
        id: "assistant-intro",
        senderRole: "assistant",
        senderName: assistantLabel,
        text: `Hi, I am the ${assistantLabel}. I can help with quick info and connect you to ${businessLabel.toLowerCase()} here.`,
        displayTime: "now"
      },
      {
        id: "team-intro",
        senderRole: "system",
        senderName: "Medilink system",
        text: `${businessLabel} can join this same thread whenever you need a human response.`,
        displayTime: "now"
      }
    ];
  }, [activeRoom, assistantLabel, businessLabel, messages.length]);

  if (!identity) {
    return <Navigate to="/register/customer" replace />;
  }

  return (
    <div className="page-shell customer-workspace-shell">
      <CustomerWorkspaceSidebar activeSection="inbox" />

      <main className="customer-workspace-main">
        {incomingCalls.length > 0 && (
          <section className="hospital-stack" style={{ marginBottom: "24px" }}>
            {incomingCalls.map((call) => (
              <div key={call.id} className="soft-panel">
                <div className="seller-product-head">
                  <div>
                    <div className="eyebrow">Incoming call</div>
                    <h3>{call.hostName || "Caller"} is calling</h3>
                  </div>
                  <span className="order-status-pill">{call.mode}</span>
                </div>
                <p className="muted-copy">
                  This call is waiting for your response. Accept to enter the consultation room.
                </p>
                <div className="account-actions" style={{ marginTop: "16px" }}>
                  <button type="button" className="primary-button" onClick={() => handleIncomingCallAction(call.id, "accepted")}>
                    Accept
                  </button>
                  <button type="button" className="header-link" onClick={() => handleIncomingCallAction(call.id, "rejected")}>
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
                        placeholder="Family care group / Shop team"
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
              placeholder="Search chats, contacts, hospitals, shops"
              className="chat-search-input"
            />

            <div className="chat-directory-section">
              <div className="identity-label">Conversations</div>
              {rooms.length === 0 && (
                <div className="soft-panel">
                  <p className="muted-copy">No conversations yet. Start a direct chat or create a group.</p>
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
                to={`/connect/${room.id}`}
              >
                <div className="chat-avatar">
                  {(room.groupName || room.targetName || "C").charAt(0).toUpperCase()}
                </div>
                <div className="chat-directory-copy">
                  <strong>{room.roomType === "group" ? room.groupName || room.targetName || "Group" : room.targetName || "Conversation"}</strong>
                  <p>{getPreviewLabel(room)}</p>
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
              <h3>Select a conversation</h3>
              <p className="muted-copy">Choose a room to start chatting.</p>
            </div>
          )}

          {activeRoom && (
            <>
              <div className="chat-thread-head chat-thread-head-pro">
                <div>
                  <button
                    type="button"
                    className="chat-mobile-back"
                    onClick={() => navigate("/connect", { replace: true })}
                  >
                    Back to chats
                  </button>
                  <div className="eyebrow">Live thread</div>
                  <h2>{activeRoom.roomType === "group" ? activeRoom.groupName || activeRoom.targetName : activeRoom.targetName}</h2>
                  <p className="muted-copy">
                    {activeRoom.roomType === "group"
                      ? `${activeRoom.participantPhones?.length || 0} members in this group`
                      : `${activeRoom.targetType} conversation on Medilink`}
                  </p>
                  <div className="chat-presence-row">
                    <span className="chat-role-pill chat-role-pill-ai">{getAssistantLabel()}</span>
                    <span className="chat-role-pill">{getBusinessLabel()}</span>
                  </div>
                </div>
                <div className="chat-thread-actions">
                  <div className="chat-thread-status">
                    <span>Single thread</span>
                    <strong>AI + Team</strong>
                  </div>
                  <div className="order-status-pill">{activeRoom.roomType === "group" ? "group" : activeRoom.targetType}</div>
                  {activeRoom.roomType !== "group" ? (
                    <>
                      <button type="button" className="chat-icon-button" onClick={() => handleStartCall("audio")} title="Audio consultancy">
                        📞
                      </button>
                      <button type="button" className="chat-icon-button" onClick={() => handleStartCall("video")} title="Video consultancy">
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
                {[...introMessages, ...messages].map((message) => {
                  const isMine = message.senderPhone === identity.phone;
                  const senderLabel = isMine
                    ? "You"
                    : message.senderRole === "system"
                      ? "Medilink system"
                      : message.senderRole === "assistant"
                        ? getAssistantLabel()
                        : message.senderName || getBusinessLabel();
                  return (
                    <div key={message.id} className={isMine ? "chat-bubble mine" : "chat-bubble"}>
                      <div className="chat-bubble-topline">
                        <small>{senderLabel}</small>
                        <span>{message.displayTime || formatChatTime(message.createdAt || message.sentAt || message.timestamp) || ""}</span>
                      </div>
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
                    +
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
                    placeholder="Type message, patient update, order note, or group coordination message"
                  />
                  <VoiceRecorder
                    disabled={!roomId || sendingAttachment}
                    onReady={async (file) => {
                      if (!roomId) return;
                      try {
                        setSendingAttachment(true);
                        await sendVoiceNote(roomId, file, "Voice note");
                      } finally {
                        setSendingAttachment(false);
                      }
                    }}
                  />
                  <button type="submit" className="chat-send-button">
                    ➤
                  </button>
                </div>
                <div className="chat-compose-bar">
                  <span className="muted-copy">
                    {attachmentFile
                      ? `Selected: ${attachmentFile.name}`
                      : `One thread: ${getAssistantLabel()} + ${getBusinessLabel()}`}
                  </span>
                  {sendingAttachment ? <span className="muted-copy">Uploading...</span> : null}
                </div>
              </form>
            </>
          )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default ChatInbox;
