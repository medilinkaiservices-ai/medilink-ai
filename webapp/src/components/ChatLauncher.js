import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredAccount, getStoredProfile } from "../utils/session";

function ChatLauncher() {
  const account = getStoredAccount();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const activePhone = account?.lastActiveRole
      ? getStoredProfile(account.lastActiveRole)?.phone || account.phone
      : account?.phone;

    if (!activePhone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(
      activePhone,
      setUnreadCount,
      (error) => console.error("Failed to subscribe to launcher unread count:", error)
    );
  }, [account?.lastActiveRole, account?.phone]);

  if (!account) return null;

  return (
    <Link className="chat-launcher" to="/connect">
      <span className="chat-launcher-label">Medilink Chat</span>
      <span className="chat-launcher-icon">{unreadCount > 0 ? unreadCount : "Chat"}</span>
    </Link>
  );
}

export default ChatLauncher;
