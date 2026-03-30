import React from "react";
import { useNavigate } from "react-router-dom";
import { logoutPhoneAuth } from "../utils/phoneAuth";
import { clearStoredSession, getStoredProfile } from "../utils/session";

const CUSTOMER_MENU = [
  { id: "orders", label: "Orders", to: "/customer/account" },
  { id: "khatha", label: "Khatha Book", to: "/customer/account?section=khatha" },
  { id: "records", label: "Hospital Records", to: "/customer/account?section=records" },
  { id: "inbox", label: "Inbox", to: "/connect" }
];

function CustomerWorkspaceSidebar({ activeSection = "orders" }) {
  const navigate = useNavigate();
  const profile = getStoredProfile("customer");

  const handleLogout = async () => {
    try {
      await logoutPhoneAuth();
    } catch (error) {
      console.error("Logout issue:", error);
    } finally {
      clearStoredSession();
      navigate("/", { replace: true });
    }
  };

  return (
    <aside className="customer-sidebar soft-panel">
      <div>
        <div className="eyebrow">Customer Account</div>
        <h2 className="customer-sidebar-title">{profile?.name || "Customer"}</h2>
        <p className="muted-copy">Orders, khatha, hospital records and inbox from one focused workspace.</p>
      </div>

      <div className="customer-sidebar-nav">
        {CUSTOMER_MENU.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`customer-sidebar-link ${activeSection === item.id ? "active" : ""}`}
            onClick={() => navigate(item.to)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="customer-sidebar-footer">
        <div className="identity-label">Mobile</div>
        <div className="identity-value">{profile?.phone || "--"}</div>
        <button type="button" className="customer-logout-button" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}

export default CustomerWorkspaceSidebar;
