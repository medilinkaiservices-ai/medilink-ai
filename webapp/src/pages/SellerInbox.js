import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import SellerShell from "../components/SellerShell";
import {
  createCallSession,
  getChatIdentityForRole,
  markRoomAsRead,
  sendChatMessageWithIdentity,
  subscribeToIncomingCalls,
  subscribeToMessages,
  subscribeToRooms,
  updateCallSession
} from "../utils/chatApi";

function SellerInbox() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const identity = getChatIdentityForRole("seller");
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
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
        setRoomError(error?.message || "Unable to load seller conversations right now.");
      }
    );
  }, [identity?.phone]);

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

  useEffect(() => {
    if (!roomId && rooms.length > 0) {
      navigate(`/seller/inbox/${rooms[0].id}`, { replace: true });
    }
  }, [navigate, roomId, rooms]);

  if (!identity) {
    return <Navigate to="/register/seller" replace />;
  }

  const handleSend = async (event) => {
    event.preventDefault();

    if (!roomId || !draft.trim()) return;

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

  return (
    <SellerShell
      title="Seller inbox"
      subtitle="Reply to customer conversations directly from your seller workspace."
      actions={
        <>
          <Link className="header-link" to="/seller/dashboard">
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

      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="soft-panel">
            <div className="section-title">Incoming chats</div>
            <p className="muted-copy">
              Customer messages sent to your shop number will appear here.
            </p>
          </div>

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
            {rooms.map((room) => (
              <Link
                key={room.id}
                className={room.id === roomId ? "chat-room-card active" : "chat-room-card"}
                to={`/seller/inbox/${room.id}`}
              >
                <div className="seller-product-head">
                  <strong>{room.lastSenderName === identity.name ? room.targetName : room.lastSenderName || "Customer"}</strong>
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
              <h3>Select a customer chat</h3>
              <p className="muted-copy">Open a conversation from the left side.</p>
            </div>
          )}

          {activeRoom && (
            <>
              <div className="chat-thread-head">
                <div>
                  <div className="eyebrow">Seller thread</div>
                  <h2>{activeRoom.targetName || "Customer conversation"}</h2>
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
                  placeholder="Reply as seller"
                />
                <button type="submit" className="primary-button">
                  Send reply
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </SellerShell>
  );
}

export default SellerInbox;
