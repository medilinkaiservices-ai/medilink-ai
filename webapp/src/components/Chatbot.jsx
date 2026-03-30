import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getStoredAccount, getStoredProfile } from "../utils/session";
import { saveHospitalPatientSummary } from "../utils/hospitalApi";

const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const CHAT_ENDPOINTS = isLocalhost
  ? [
      "http://127.0.0.1:5003/medilink-ai-b3cf9/us-central1/chat",
      "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/chat",
      "http://127.0.0.1:5100/medilink-ai-b3cf9/us-central1/chat",
      "http://127.0.0.1:5001/medilink-ai-b3cf9/us-central1/chat",
      "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/chat",
    ]
  : [
      "/chat",
      "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/chat",
    ];

const ASSISTANT_CONFIG = {
  shop: {
    label: "Shop Assistant",
    accent: "#0f766e",
    highlight: "#ccfbf1",
    subtitle: "Ask about products, pricing, offers, and availability.",
  },
  hospital: {
    label: "Hospital Assistant",
    accent: "#2563eb",
    highlight: "#dbeafe",
    subtitle: "Ask about doctors, services, timings, and appointments.",
  },
  customer: {
    label: "Medilink Guide",
    accent: "#7c3aed",
    highlight: "#ede9fe",
    subtitle: "Get help with navigation, accounts, and platform flows.",
  },
};

function getAssistantConfig(role) {
  return ASSISTANT_CONFIG[role] || ASSISTANT_CONFIG.customer;
}

function getEntityName(role, contextData = {}) {
  if (role === "shop") return contextData.shopName || "this shop";
  if (role === "hospital") return contextData.hospitalName || "this hospital";
  return "Medilink AI";
}

function buildSuggestionChips(role, contextData = {}) {
  if (role === "shop") {
    const firstProduct = contextData.products?.find((item) => item?.name)?.name;

    return [
      `What are the best offers in ${getEntityName(role, contextData)}?`,
      firstProduct
        ? `Is ${firstProduct} available right now?`
        : `Which products are available right now?`,
      "What should I add to cart today?",
      "Tell me the price range here.",
    ];
  }

  if (role === "hospital") {
    if (contextData.assistantMode === "hybrid") {
      return [
        `Which services are available at ${getEntityName(role, contextData)}?`,
        "Which doctor should I consult for my symptoms?",
        "I have fever and body pain since yesterday. What could this indicate?",
        "What are today's timings and emergency options?",
      ];
    }
    if (contextData.assistantMode === "care") {
      return [
        "Patient has fever, cough and tiredness for 3 days. What could this indicate?",
        "Explain possible reasons for chest discomfort without giving a diagnosis.",
        "What symptoms need urgent hospital review today?",
        "Create a follow-up summary for this patient.",
      ];
    }
    return [
      `Which services are available at ${getEntityName(role, contextData)}?`,
      "Which doctor should I consult?",
      "What are today's timings?",
      "How do I book an appointment?",
    ];
  }

  return [];
}

function buildProactiveGreeting(role, contextData = {}) {
  const name = getEntityName(role, contextData);
  const account = getStoredAccount();
  const roleProfile = getStoredProfile(role === "shop" ? "seller" : role);
  const userName =
    roleProfile?.name ||
    account?.name ||
    "";
  const greetingName = userName ? ` ${userName}` : "";

  if (role === "shop") {
    return `Hi${greetingName}, I am here for ${name}. How can I help you today?`;
  }

  if (role === "hospital") {
    if (contextData.assistantMode === "hybrid") {
      return `Hi${greetingName}, I can help with ${name}'s hospital services and doctor availability. If you share symptoms, I can also explain possible causes, effects, urgency, and red flags without giving a diagnosis.`;
    }
    if (contextData.assistantMode === "care") {
      return `Hi${greetingName}, I am here to help capture patient symptom discussions for ${name}. Share symptoms, duration, age, and warning signs, and I will prepare a safe AI summary without diagnosis.`;
    }
    return `Hi${greetingName}, I am here to help with ${name}. How can I support you today?`;
  }

  return `Hi${greetingName}, welcome to Medilink AI. How can I help you today?`;
}

function getGreetingHighlightName(role) {
  const account = getStoredAccount();
  const roleProfile = getStoredProfile(role === "shop" ? "seller" : role);
  return roleProfile?.name || account?.name || "";
}

function buildLocalFallbackReply(role, contextData = {}, userMessage = "") {
  const lowerMessage = userMessage.toLowerCase();

  if (role === "shop") {
    if (lowerMessage.includes("offer")) {
      return `Current offers: ${contextData.offers || "No offers are listed for this shop right now."}`;
    }

    if (Array.isArray(contextData.products) && contextData.products.length) {
      const productNames = contextData.products
        .slice(0, 5)
        .map((item) => item.name)
        .filter(Boolean);

      if (productNames.length) {
        return `I can help with this shop. Available products include ${productNames.join(", ")}. Ask about price, availability, or offers.`;
      }
    }

    return `I can help with ${contextData.shopName || "this shop"}. Ask about products, pricing, availability, or offers.`;
  }

  if (role === "hospital") {
    if (contextData.assistantMode === "hybrid") {
      return "I can help with hospital services, doctors, timings, and appointments. If you describe symptoms, I can also explain possible related conditions, likely effects, urgency, and red flags without diagnosis.";
    }
    if (contextData.assistantMode === "care") {
      return "I can summarize the patient's symptoms, possible related conditions, likely effects, and follow-up points. I cannot diagnose. Share the symptoms, duration, age, and warning signs.";
    }
    if (Array.isArray(contextData.services) && contextData.services.length) {
      return `I can help with ${contextData.hospitalName || "this hospital"}. Services include ${contextData.services.slice(0, 5).join(", ")}. Ask about doctors, timings, or appointments.`;
    }

    return `I can help with ${contextData.hospitalName || "this hospital"}. Ask about services, doctors, timings, or appointment availability.`;
  }

  return "I can help with Medilink AI navigation, accounts, hospitals, shops, and appointments. Ask a more specific question and I will do my best to help.";
}

async function postChatMessage(payload) {
  let lastError = null;

  for (const endpoint of CHAT_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        ...data,
        endpoint,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach chat service.");
}

function Chatbot({ role, contextData, floating = false }) {
  const location = useLocation();
  const assistant = getAssistantConfig(role);
  const isMobileViewport = typeof window !== "undefined" ? window.innerWidth <= 900 : false;
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      sender: "bot",
      text: buildProactiveGreeting(role, contextData),
      meta: "Welcome",
      highlightName: getGreetingHighlightName(role),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [introTyping, setIntroTyping] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDockOpen, setIsDockOpen] = useState(false);
  const [lastSource, setLastSource] = useState("assistant");
  const [dockPosition, setDockPosition] = useState(() => ({ x: 20, y: 20 }));
  const [selectionTools, setSelectionTools] = useState(null);
  const messagesEndRef = useRef(null);
  const dragStateRef = useRef(null);
  const inputRef = useRef(null);
  const suggestions = buildSuggestionChips(role, contextData);
  const dockStorageKey = `chatbot-position:${location.pathname}:${role}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, isExpanded]);

  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        sender: "bot",
        text: buildProactiveGreeting(role, contextData),
        meta: "Welcome",
        highlightName: getGreetingHighlightName(role),
      },
    ]);
    setLastSource("assistant");
    setIsDockOpen(false);
    setIsExpanded(false);
    setIntroTyping(false);
    setSelectionTools(null);
  }, [role, contextData, floating]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIntroTyping(false);
    }, floating ? 500 : 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [role, contextData, floating]);

  useEffect(() => {
    if (!floating) return;
    try {
      const saved = window.localStorage.getItem(dockStorageKey);
      if (!saved) {
        setDockPosition({ x: 20, y: 20 });
        return;
      }
      const parsed = JSON.parse(saved);
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        setDockPosition(parsed);
      }
    } catch {
      setDockPosition({ x: 20, y: 20 });
    }
  }, [dockStorageKey, floating]);

  useEffect(() => {
    if (!floating) return;
    window.localStorage.setItem(dockStorageKey, JSON.stringify(dockPosition));
  }, [dockPosition, dockStorageKey, floating]);

  useEffect(() => {
    if (!floating) return undefined;

    const handleMove = (event) => {
      if (!dragStateRef.current) return;

      const nextX = Math.min(
        Math.max(12, dragStateRef.current.startX + (dragStateRef.current.pointerX - event.clientX) * -1),
        Math.max(12, window.innerWidth - dragStateRef.current.width - 12)
      );
      const nextY = Math.min(
        Math.max(12, dragStateRef.current.startY + (dragStateRef.current.pointerY - event.clientY) * -1),
        Math.max(12, window.innerHeight - dragStateRef.current.height - 12)
      );

      setDockPosition({ x: nextX, y: nextY });
    };

    const handleUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [floating]);

  const startDragging = (event, size) => {
    if (!floating) return;
    dragStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: dockPosition.x,
      startY: dockPosition.y,
      width: size.width,
      height: size.height,
    };
  };

  const sendMessage = async (event, presetMessage) => {
    if (event) event.preventDefault();

    const userMessage = (presetMessage || input).trim();
    if (!userMessage || loading) return;

    const userEntry = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: userMessage,
    };

    setMessages((prev) => {
      const filtered = prev.filter((item) => item.id !== "welcome");
      return [...filtered, userEntry];
    });
    setInput("");
    setLoading(true);

    try {
      const data = await postChatMessage({
        role,
        userMessage,
        contextData,
      });

      setLastSource(
        data.fallback ? "smart fallback" : data.endpoint?.includes("localhost") || data.endpoint?.includes("127.0.0.1")
          ? "local ai"
          : "cloud ai"
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: data.reply,
          meta: data.fallback ? "Fallback response" : "AI response",
        },
      ]);

      if (role === "hospital" && (contextData.assistantMode === "care" || contextData.assistantMode === "hybrid") && data.patientReport && contextData.hospitalId && contextData.patientName) {
        try {
          await saveHospitalPatientSummary({
            hospitalId: contextData.hospitalId,
            hospitalName: contextData.hospitalName,
            patientName: contextData.patientName,
            patientPhone: contextData.patientPhone,
            patientAge: contextData.patientAge,
            patientGender: contextData.patientGender,
            patientNotes: contextData.patientNotes,
            latestMessage: userMessage,
            aiReply: data.reply,
            report: data.patientReport,
          });
        } catch (saveError) {
          console.error("Failed to save hospital patient summary:", saveError);
        }
      }
    } catch (error) {
      console.error("Error sending message to chatbot:", error);
      setLastSource("offline fallback");
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: buildLocalFallbackReply(role, contextData, userMessage),
          meta: "Offline fallback",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([
      {
        id: "welcome",
        sender: "bot",
        text: buildProactiveGreeting(role, contextData),
        meta: "Reset",
        highlightName: getGreetingHighlightName(role),
      },
    ]);
    setInput("");
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(event);
    }
  };

  const handleCopyText = async () => {
    const element = inputRef.current;
    if (!element) return;
    const selectedText = element.value.slice(element.selectionStart, element.selectionEnd);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch (error) {
      console.error("Unable to copy text:", error);
    }
  };

  const handlePasteText = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText) return;
      setInput((prev) => `${prev}${clipText}`);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      console.error("Unable to paste text:", error);
    }
  };

  const handleCutText = async () => {
    const element = inputRef.current;
    if (!element) return;
    const { selectionStart, selectionEnd, value } = element;
    const selectedText = value.slice(selectionStart, selectionEnd);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      setInput(`${value.slice(0, selectionStart)}${value.slice(selectionEnd)}`);
      setSelectionTools(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      console.error("Unable to cut text:", error);
    }
  };

  const handleSelectAllText = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleTextSelection = () => {
    const element = inputRef.current;
    if (!element) return;

    const { selectionStart, selectionEnd } = element;
    if (selectionStart === selectionEnd) {
      setSelectionTools(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    setSelectionTools({
      top: rect.top - 44,
      left: rect.left + 12,
    });
  };

  return (
    <>
      {floating && !isDockOpen && (
        <button
          type="button"
          style={floatingLauncherStyle(assistant.accent, dockPosition)}
          onClick={() => setIsDockOpen(true)}
        >
          <span style={floatingLauncherDotStyle(assistant.accent)} />
          <span style={floatingLauncherCopyStyle}>
            <strong>{assistant.label}</strong>
            <small>Open assistant</small>
          </span>
        </button>
      )}

      {isExpanded && (
        <div style={modalOverlayStyle} onClick={() => setIsExpanded(false)}>
          <div
            style={modalCardStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <ChatLayout
              assistant={assistant}
              role={role}
              contextData={contextData}
              messages={messages}
              input={input}
              setInput={setInput}
              loading={loading}
              onSend={sendMessage}
              onSuggestion={sendMessage}
              onClear={clearConversation}
              onCollapse={() => setIsExpanded(false)}
              onExpand={null}
              expanded
              inputRef={inputRef}
              onInputKeyDown={handleInputKeyDown}
              onCopyText={handleCopyText}
              onPasteText={handlePasteText}
              onCutText={handleCutText}
              onSelectAllText={handleSelectAllText}
              selectionTools={selectionTools}
              onTextSelection={handleTextSelection}
            lastSource={lastSource}
            suggestions={suggestions}
            messagesEndRef={messagesEndRef}
            />
          </div>
        </div>
      )}

      {(!floating || isDockOpen) && (
        <div style={floating ? floatingDockShellStyle(dockPosition) : undefined}>
          <ChatLayout
            assistant={assistant}
            role={role}
            contextData={contextData}
            messages={messages}
            input={input}
            setInput={setInput}
            loading={loading}
            onSend={sendMessage}
            onSuggestion={sendMessage}
            onClear={clearConversation}
            onCollapse={floating ? () => setIsDockOpen(false) : null}
            onExpand={isMobileViewport ? null : () => setIsExpanded(true)}
            expanded={false}
            compact={floating}
            floating={floating}
            mobileViewport={isMobileViewport}
            onDragStart={startDragging}
            introTyping={introTyping}
            inputRef={inputRef}
            onInputKeyDown={handleInputKeyDown}
            onCopyText={handleCopyText}
            onPasteText={handlePasteText}
            onCutText={handleCutText}
            onSelectAllText={handleSelectAllText}
            selectionTools={selectionTools}
            onTextSelection={handleTextSelection}
            lastSource={lastSource}
            suggestions={suggestions}
            messagesEndRef={messagesEndRef}
          />
        </div>
      )}
    </>
  );
}

function ChatLayout({
  assistant,
  role,
  contextData,
  messages,
  input,
  setInput,
  loading,
  onSend,
  onSuggestion,
  onClear,
  onCollapse,
  onExpand,
  expanded,
  compact = false,
  floating = false,
  mobileViewport = false,
  onDragStart,
  introTyping = false,
  inputRef,
  onInputKeyDown,
  onCopyText,
  onPasteText,
  onCutText,
  onSelectAllText,
  selectionTools,
  onTextSelection,
  lastSource,
  suggestions,
  messagesEndRef,
}) {
  const entityName = getEntityName(role, contextData);
  const containerStyle = {
    ...chatbotContainerStyle,
    ...(expanded ? expandedContainerStyle : {}),
    ...(compact ? floatingContainerStyle : {}),
    ...(mobileViewport && compact ? mobileFloatingContainerStyle : {}),
    "--chat-accent": assistant.accent,
    "--chat-highlight": assistant.highlight,
  };

  const renderMessageText = (msg) => {
    if (!msg.highlightName || !msg.text.includes(msg.highlightName)) {
      return <div style={messageTextStyle}>{msg.text}</div>;
    }

    const parts = msg.text.split(msg.highlightName);
    return (
      <div style={messageTextStyle}>
        {parts[0]}
        <span style={greetingHighlightStyle}>{msg.highlightName}</span>
        {parts.slice(1).join(msg.highlightName)}
      </div>
    );
  };

  return (
    <div className="chatbot-container" style={containerStyle}>
      <div
        style={{
          ...chatbotHeaderStyle,
          ...(mobileViewport ? mobileChatbotHeaderStyle : {}),
          background: `linear-gradient(135deg, ${assistant.accent}, ${assistant.highlight})`,
          cursor: floating && !mobileViewport ? "move" : "default",
        }}
        onMouseDown={(event) => {
          if (!floating || !onDragStart || mobileViewport) return;
          const width = compact ? Math.min(420, window.innerWidth - 24) : 980;
          const height = compact ? Math.min(window.innerHeight * 0.72, 640) : Math.min(window.innerHeight * 0.86, 860);
          onDragStart(event, { width, height });
        }}
      >
        <div>
          <div style={eyebrowStyle}>{assistant.label}</div>
          <div style={chatbotTitleStyle}>Ask about {entityName}</div>
          <div style={chatbotSubtitleStyle}>{assistant.subtitle}</div>
        </div>
        <div style={headerActionsStyle}>
          {!mobileViewport && (
            <div style={statusPillStyle}>
              <span style={statusDotStyle(assistant.accent)} />
              {lastSource}
            </div>
          )}
          {onExpand && !mobileViewport && (
            <button type="button" style={ghostButtonStyle} onClick={onExpand}>
              Expand
            </button>
          )}
          {floating && !mobileViewport && (
            <div style={dragHintStyle}>Drag</div>
          )}
          {onCollapse && (
            <button type="button" style={ghostButtonStyle} onClick={onCollapse}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className="chatbot-messages" style={chatbotMessagesStyle}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...messageRowStyle,
              justifyContent: msg.sender === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={
                msg.sender === "user"
                  ? userMessageCardStyle(assistant.accent)
                  : botMessageCardStyle
              }
            >
              <div style={messageMetaStyle}>
                {msg.sender === "user" ? "You" : assistant.label}
                {msg.meta ? ` • ${msg.meta}` : ""}
              </div>
              {renderMessageText(msg)}
            </div>
          </div>
        ))}
        {(loading || introTyping) && (
          <div style={messageRowStyle}>
            <div style={typingCardStyle}>
              <div style={messageMetaStyle}>
                {assistant.label} • {introTyping && !loading ? "Joining" : "Thinking"}
              </div>
              <div style={typingDotsStyle}>
                <span style={typingDotStyle} />
                <span style={typingDotStyle} />
                <span style={typingDotStyle} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={footerPanelStyle}>
        {!mobileViewport && (
          <div style={helperRowStyle}>
            <span>{role === "hospital" && (contextData.assistantMode === "care" || contextData.assistantMode === "hybrid") ? "Share symptoms or hospital questions for a safe summary without diagnosis." : "Ask a direct question and the assistant will reply here."}</span>
            <button type="button" style={clearButtonStyle} onClick={onClear}>
              Clear chat
            </button>
          </div>
        )}
        {selectionTools && (
          <div
            style={{
              ...selectionToolbarStyle,
              top: selectionTools.top,
              left: selectionTools.left,
            }}
          >
            <button type="button" style={selectionToolButtonStyle} onClick={onCopyText}>
              Copy
            </button>
            <button type="button" style={selectionToolButtonStyle} onClick={onCutText}>
              Cut
            </button>
            <button type="button" style={selectionToolButtonStyle} onClick={onSelectAllText}>
              Select all
            </button>
          </div>
        )}
        <form onSubmit={onSend} style={chatbotInputFormStyle}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            onSelect={onTextSelection}
            onMouseUp={onTextSelection}
            onKeyUp={onTextSelection}
            placeholder={role === "hospital" && (contextData.assistantMode === "care" || contextData.assistantMode === "hybrid") ? "Ask about services or describe symptoms, duration, severity, and warning signs..." : `Message the ${role} assistant...`}
            style={chatbotInputFieldStyle}
            disabled={loading}
            rows={mobileViewport ? 2 : expanded ? 3 : 2}
          />
          <button
            type="submit"
            style={chatbotSendButtonStyle(assistant.accent)}
            disabled={loading}
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

const chatbotContainerStyle = {
  display: "flex",
  flexDirection: "column",
  minHeight: "520px",
  borderRadius: "22px",
  overflow: "hidden",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  border: "1px solid rgba(148, 163, 184, 0.24)",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.10)",
};

const floatingDockShellStyle = (position) => ({
  position: "fixed",
  right: typeof window !== "undefined" && window.innerWidth <= 900 ? "0" : `${position.x}px`,
  left: typeof window !== "undefined" && window.innerWidth <= 900 ? "0" : "auto",
  bottom: typeof window !== "undefined" && window.innerWidth <= 900 ? "0" : `${position.y}px`,
  zIndex: 1100,
  width: typeof window !== "undefined" && window.innerWidth <= 900 ? "100vw" : "min(420px, calc(100vw - 24px))",
});

const floatingContainerStyle = {
  minHeight: "520px",
  height: "min(72vh, 620px)",
  borderRadius: "22px",
};

const mobileFloatingContainerStyle = {
  minHeight: "84vh",
  height: "84vh",
  borderRadius: "24px 24px 0 0",
};

const expandedContainerStyle = {
  width: "min(980px, 92vw)",
  height: "min(86vh, 860px)",
  minHeight: "720px",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
  background: "rgba(15, 23, 42, 0.52)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
};

const modalCardStyle = {
  width: "100%",
  maxWidth: "980px",
};

const chatbotHeaderStyle = {
  padding: "14px 18px",
  color: "#0f172a",
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
};

const mobileChatbotHeaderStyle = {
  padding: "10px 14px",
  alignItems: "flex-start",
};

const eyebrowStyle = {
  fontSize: "10px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  marginBottom: "4px",
  opacity: 0.8,
};

const chatbotTitleStyle = {
  fontSize: "clamp(1rem, 1.4vw, 1.2rem)",
  fontWeight: 800,
  lineHeight: 1.1,
  marginBottom: "2px",
};

const chatbotSubtitleStyle = {
  fontSize: "0.84rem",
  maxWidth: "420px",
  color: "rgba(15, 23, 42, 0.82)",
};

const headerActionsStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const statusPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "9px 14px",
  borderRadius: "999px",
  background: "rgba(255, 255, 255, 0.72)",
  border: "1px solid rgba(255, 255, 255, 0.45)",
  fontSize: "0.85rem",
  fontWeight: 700,
};

const statusDotStyle = (color) => ({
  width: "9px",
  height: "9px",
  borderRadius: "999px",
  background: color,
  boxShadow: `0 0 0 4px ${color}22`,
});

const chatbotMessagesStyle = {
  flexGrow: 1,
  overflowY: "auto",
  padding: "16px 18px 14px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  minHeight: 0,
};

const messageRowStyle = {
  display: "flex",
};

const botMessageCardStyle = {
  maxWidth: "86%",
  background: "#ffffff",
  color: "#0f172a",
  borderRadius: "20px 20px 20px 8px",
  padding: "14px 16px",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  boxShadow: "0 12px 26px rgba(15, 23, 42, 0.06)",
};

const userMessageCardStyle = (accent) => ({
  maxWidth: "86%",
  background: accent,
  color: "#ffffff",
  borderRadius: "20px 20px 8px 20px",
  padding: "14px 16px",
  boxShadow: `0 12px 26px ${accent}33`,
});

const typingCardStyle = {
  ...botMessageCardStyle,
  minWidth: "120px",
};

const messageMetaStyle = {
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.02em",
  marginBottom: "6px",
  opacity: 0.72,
};

const messageTextStyle = {
  lineHeight: 1.55,
  fontSize: "0.98rem",
  whiteSpace: "pre-wrap",
};

const greetingHighlightStyle = {
  color: "#0f766e",
  fontWeight: 900,
  letterSpacing: "0.015em",
  background: "linear-gradient(135deg, #0f766e 0%, #14b8a6 35%, #2563eb 75%, #1d4ed8 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
  textShadow: "0 6px 18px rgba(37, 99, 235, 0.18)",
  position: "relative",
};

const typingDotsStyle = {
  display: "inline-flex",
  gap: "6px",
  alignItems: "center",
  minHeight: "20px",
};

const typingDotStyle = {
  width: "8px",
  height: "8px",
  borderRadius: "999px",
  background: "#94a3b8",
};

const footerPanelStyle = {
  borderTop: "1px solid rgba(148, 163, 184, 0.16)",
  background: "#ffffff",
  padding: "10px 14px 14px",
};

const helperRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  color: "#64748b",
  fontSize: "0.8rem",
  marginBottom: "10px",
  flexWrap: "wrap",
};

const clearButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#0f766e",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
};

const chatbotInputFormStyle = {
  display: "flex",
  gap: "12px",
  alignItems: "flex-end",
};

const selectionToolbarStyle = {
  position: "fixed",
  zIndex: 1300,
  display: "flex",
  gap: "8px",
  padding: "8px",
  borderRadius: "999px",
  background: "#0f172a",
  boxShadow: "0 18px 38px rgba(15, 23, 42, 0.28)",
};

const selectionToolButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#ffffff",
  borderRadius: "999px",
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: "0.82rem",
  fontWeight: 700,
};

const chatbotInputFieldStyle = {
  flexGrow: 1,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: "16px",
  padding: "12px 14px",
  fontSize: "0.94rem",
  resize: "none",
  outline: "none",
  background: "#f8fafc",
  minHeight: "52px",
};

const chatbotSendButtonStyle = (accent) => ({
  background: accent,
  color: "white",
  border: "none",
  borderRadius: "14px",
  padding: "12px 18px",
  cursor: "pointer",
  fontWeight: 700,
  minWidth: "92px",
  boxShadow: `0 14px 24px ${accent}33`,
});

const ghostButtonStyle = {
  background: "rgba(255, 255, 255, 0.72)",
  color: "#0f172a",
  border: "1px solid rgba(255, 255, 255, 0.45)",
  borderRadius: "999px",
  padding: "9px 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const dragHintStyle = {
  fontSize: "0.76rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  opacity: 0.72,
};

const floatingLauncherStyle = (accent, position) => ({
  position: "fixed",
  right: `${position.x}px`,
  bottom: `${position.y}px`,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  gap: "12px",
  border: "none",
  borderRadius: "999px",
  padding: "14px 18px",
  background: "#ffffff",
  boxShadow: `0 22px 44px ${accent}22`,
  cursor: "pointer",
  minWidth: "220px",
});

const floatingLauncherDotStyle = (accent) => ({
  width: "14px",
  height: "14px",
  borderRadius: "999px",
  background: accent,
  boxShadow: `0 0 0 6px ${accent}22`,
  flexShrink: 0,
});

const floatingLauncherCopyStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  color: "#0f172a",
  lineHeight: 1.2,
};

export default Chatbot;
