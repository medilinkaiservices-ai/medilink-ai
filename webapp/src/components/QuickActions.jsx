import React, { useState } from "react";

function QuickActions({ isOwner, setIsOwner }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          left: "10px",
          top: "100px",
          zIndex: 1000,
          padding: "8px 12px",
          borderRadius: "6px",
          border: "none",
          background: "#4e73df",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        ☰ Menu
      </button>

      <div
        style={{
          width: "220px",
          background: "#ffffff",
          height: "100vh",
          position: "fixed",
          left: open ? "0" : "-240px",
          top: "0",
          transition: "0.3s",
          boxShadow: "0 0 10px rgba(0,0,0,0.1)",
          padding: "20px",
          borderRight: "1px solid #eee",
          zIndex: 999,
        }}
      >
        <h3 style={{ marginBottom: "20px" }}>Menu</h3>

        <button
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            background: "#4e73df",
            color: "#fff",
            cursor: "pointer",
          }}
          onClick={() => setIsOwner(!isOwner)}
        >
          {isOwner ? "Customer Mode" : "Owner Mode"}
        </button>

        <button
          onClick={() => (window.location.href = "/seller-orders")}
          style={{
            width: "100%",
            padding: "10px",
            marginTop: "10px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          📦 Seller Orders
        </button>
      </div>
    </>
  );
}

export default QuickActions;