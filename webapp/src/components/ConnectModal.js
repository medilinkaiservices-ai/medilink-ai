import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOrFindDirectRoom } from "../utils/chatApi";

function ConnectModal({
  isOpen,
  onClose,
  entityName,
  phone,
  whatsappPhone,
  mode,
  shareTitle,
  defaultMessage,
  targetId
}) {
  const navigate = useNavigate();
  const [message, setMessage] = useState(defaultMessage || "");

  if (!isOpen) return null;

  const cleanedWhatsApp = (whatsappPhone || phone || "").replace(/\D/g, "");
  const cleanedPhone = (phone || whatsappPhone || "").replace(/\D/g, "");

  const buildWhatsAppUrl = (text) => {
    if (!cleanedWhatsApp) return null;

    const fullNumber =
      cleanedWhatsApp.length === 10 ? `91${cleanedWhatsApp}` : cleanedWhatsApp;

    return `https://wa.me/${fullNumber}?text=${encodeURIComponent(text)}`;
  };

  const openUrl = (url) => {
    if (!url) {
      alert("Contact number not available.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleChat = () => {
    const text =
      message.trim() ||
      `Hello ${entityName}, I want to connect with your ${mode} page.`;
    openUrl(buildWhatsAppUrl(text));
  };

  const handleAudioCall = () => {
    const text = `Hello ${entityName}, please connect for an audio call.`;
    openUrl(buildWhatsAppUrl(text));
  };

  const handleVideoCall = () => {
    const text = `Hello ${entityName}, please connect for a video call.`;
    openUrl(buildWhatsAppUrl(text));
  };

  const handlePhoneCall = () => {
    if (!cleanedPhone) {
      alert("Contact number not available.");
      return;
    }

    window.location.href = `tel:${cleanedPhone}`;
  };

  const handleShare = async () => {
    const shareData = {
      title: shareTitle || entityName,
      text: `Check ${entityName} on Medilink AI`,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }

      await navigator.clipboard.writeText(window.location.href);
      alert("Page link copied.");
    } catch (error) {
      console.error("Share failed:", error);
    }
  };

  const handleOwnChat = async () => {
    try {
      const roomId = await createOrFindDirectRoom({
        targetId,
        targetType: mode,
        targetName: entityName,
        targetPhone: cleanedWhatsApp || cleanedPhone,
        initialMessage:
          message.trim() || `Hello ${entityName}, I want to connect through Medilink chat.`
      });

      onClose();
      navigate(`/connect/${roomId}`);
    } catch (error) {
      console.error("Could not open chat:", error);
      alert("Please create an account before starting chat.");
    }
  };

  return (
    <div className="connect-overlay" onClick={onClose}>
      <div className="connect-modal" onClick={(event) => event.stopPropagation()}>
        <div className="seller-product-head">
          <div>
            <div className="eyebrow">Connect instantly</div>
            <h2>{entityName}</h2>
          </div>
          <button className="ghost-button connect-close" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="muted-copy">
          Start a quick WhatsApp connection, ask for audio/video support, or share this page.
        </p>

        <label>
          Message box
          <textarea
            rows="4"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={`Hello ${entityName}, I need help.`}
          />
        </label>

        <div className="connect-action-grid">
          <button className="primary-button" onClick={handleOwnChat}>
            Open Medilink Chat
          </button>
          <button className="primary-button" onClick={handleChat}>
            WhatsApp Chat
          </button>
          <button className="ghost-button" onClick={handleAudioCall}>
            Audio Call
          </button>
          <button className="ghost-button" onClick={handleVideoCall}>
            Video Call
          </button>
          <button className="ghost-button" onClick={handlePhoneCall}>
            Phone Call
          </button>
          <button className="ghost-button" onClick={handleShare}>
            Share Page
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConnectModal;
