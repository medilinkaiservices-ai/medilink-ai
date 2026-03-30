import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { fetchHospitals } from "../utils/hospitalApi";
import {
  createCallSession,
  createOrFindDirectRoom,
  getCurrentChatIdentity,
  markRoomAsRead,
  sendChatMessage,
  subscribeToIncomingCalls,
  subscribeToMessages,
  subscribeToRooms,
  updateCallSession
} from "../utils/chatApi";

function ChatInbox() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const identity = getCurrentChatIdentity();
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [directory, setDirectory] = useState([]);
  const [directoryFilter, setDirectoryFilter] = useState("");
  const [isStartingRoom, setIsStartingRoom] = useState("");
  const [roomError, setRoomError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [incomingCalls, setIncomingCalls] = useState([]);

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

        if ((error?.message || "").toLowerCase().includes("index")) {
          setMessageError("Chat thread is getting ready. Firestore index is building, please retry in a moment.");
          return;
        }

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
            phone: item.data().ownerPhone || item.data().phone || ""
          }))
          .filter((item) => item.phone && item.phone !== identity.phone);

        const hospitalDirectory = hospitalList
          .map((item) => ({
            id: item.id,
            type: "hospital",
            name: item.hospitalName || "Hospital",
            subtitle: item.city || "Hospital support",
            phone: item.phone || item.emergencyPhone || ""
          }))
          .filter((item) => item.phone && item.phone !== identity.phone);

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

    if (!keyword) return directory;

    return directory.filter((item) => {
      return (
        (item.name || "").toLowerCase().includes(keyword) ||
        (item.subtitle || "").toLowerCase().includes(keyword) ||
        item.type.toLowerCase().includes(keyword)
      );
    });
  }, [directory, directoryFilter]);

  useEffect(() => {
    if (!roomId && rooms.length > 0) {
      navigate(`/connect/${rooms[0].id}`, { replace: true });
    }
  }, [navigate, roomId, rooms]);

  if (!identity) {
    return <Navigate to="/register/customer" replace />;
  }

  const handleSend = async (event) => {
    event.preventDefault();

    if (!roomId || !draft.trim()) return;

    await sendChatMessage(roomId, draft.trim());
    setDraft("");
  };

  const handleStartChat = async (entry) => {
    setIsStartingRoom(entry.id);

    try {
      const nextRoomId = await createOrFindDirectRoom({
        targetId: entry.id,
        targetType: entry.type,
        targetName: entry.name,
        targetPhone: entry.phone,
        initialMessage:
          entry.type === "hospital"
            ? `Hello ${entry.name}, I need support with appointment or treatment details.`
            : `Hello ${entry.name}, I want to know more about your products.`
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

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Medilink connect</div>
          <h1>Your own chatbox</h1>
          <p className="muted-copy">
            Chat directly with sellers and hospitals, and later we can extend this into
            marketing campaigns, doctor consultations and media sharing.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Active identity</div>
          <div className="identity-value">{identity.name}</div>
          <div className="identity-label">Role</div>
          <div className="identity-value">{identity.role}</div>
          <div className="identity-label">Rooms</div>
          <div className="identity-value">{rooms.length}</div>
        </div>
      </section>

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

      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="soft-panel chat-directory-panel">
            <div className="seller-product-head">
              <div className="section-title" style={{ marginBottom: 0 }}>
                Start new chat
              </div>
              <small>{directory.length} contacts</small>
            </div>
            <input
              type="text"
              value={directoryFilter}
              onChange={(event) => setDirectoryFilter(event.target.value)}
              placeholder="Search shops or hospitals"
            />
            <div className="chat-directory-list">
              {visibleDirectory.slice(0, 8).map((entry) => (
                <button
                  key={`${entry.type}-${entry.id}`}
                  type="button"
                  className="chat-directory-card"
                  onClick={() => handleStartChat(entry)}
                  disabled={isStartingRoom === entry.id}
                >
                  <div className="seller-product-head">
                    <strong>{entry.name}</strong>
                    <span className="order-status-pill">{entry.type}</span>
                  </div>
                  <p className="muted-copy">{entry.subtitle}</p>
                  <span className="chat-directory-cta">
                    {isStartingRoom === entry.id ? "Opening..." : "Start chat"}
                  </span>
                </button>
              ))}
              {visibleDirectory.length === 0 && (
                <p className="muted-copy">
                  No matching shops or hospitals right now.
                </p>
              )}
            </div>
          </div>

          <div className="section-title">Conversations</div>
          {rooms.length === 0 && (
            <div className="soft-panel">
              <p className="muted-copy">
                No conversations yet. Start from the directory above and your room will appear here.
              </p>
            </div>
          )}
          {roomError && (
            <div className="soft-panel">
              <p className="muted-copy">{roomError}</p>
            </div>
          )}
          <div className="chat-room-list">
            {rooms.map((room) => (
              <Link
                key={room.id}
                className={room.id === roomId ? "chat-room-card active" : "chat-room-card"}
                to={`/connect/${room.id}`}
              >
                <div className="seller-product-head">
                  <strong>{room.targetName || "Conversation"}</strong>
                  <small>{room.targetType}</small>
                </div>
                <p className="muted-copy">{room.lastMessage || "No message yet"}</p>
              </Link>
            ))}
          </div>
        </aside>

        <section className="chat-thread-panel">
          {!activeRoom && (
            <div className="soft-panel">
              <h3>Select a conversation</h3>
              <p className="muted-copy">Choose a room to start chatting.</p>
            </div>
          )}

          {activeRoom && (
            <>
              <div className="chat-thread-head">
                <div>
                  <div className="eyebrow">Live thread</div>
                  <h2>{activeRoom.targetName}</h2>
                </div>
                <div className="order-status-pill">{activeRoom.targetType}</div>
              </div>

              <div className="account-actions">
                <button type="button" className="header-link" onClick={() => handleStartCall("audio")}>
                  Audio call
                </button>
                <button type="button" className="header-link" onClick={() => handleStartCall("video")}>
                  Video call
                </button>
              </div>

              <div className="chat-message-list">
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
                    </div>
                  );
                })}
              </div>

              <form className="chat-input-row" onSubmit={handleSend}>
                <textarea
                  rows="3"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type your message"
                />
                <button type="submit" className="primary-button">
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default ChatInbox;
