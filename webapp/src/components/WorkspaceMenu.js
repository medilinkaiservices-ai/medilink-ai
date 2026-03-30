import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearStoredSession, getStoredAccount } from "../utils/session";
import { logoutPhoneAuth } from "../utils/phoneAuth";

function WorkspaceMenu({ className = "", onNavigate = null, onClose = null, showClose = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const account = getStoredAccount();

  const sellerPath = account?.roles?.includes("seller") ? "/seller/dashboard" : "/register/seller";
  const hospitalPath = account?.roles?.includes("hospital") ? "/hospital/dashboard" : "/register/hospital";
  const customerPath = account?.roles?.includes("customer") ? "/customer/account" : "/register/customer";
  const lawPath = account?.roles?.includes("lawyer") ? "/law-assistant?mode=lawyer" : "/law-assistant?mode=public";

  const handleLogout = async () => {
    try {
      await logoutPhoneAuth();
    } catch (error) {
      console.error("Logout issue:", error);
    } finally {
      clearStoredSession();
      navigate("/login", { replace: true });
    }
  };

  const isActive = (path) => location.pathname === path;
  const handleLinkClick = () => {
    if (onNavigate) {
      onNavigate();
    }
  };
  const menuItems = [
    { label: "Customer Account", to: customerPath, badge: "Personal" },
    { label: "Seller Space", to: sellerPath, badge: "Business" },
    { label: "Hospital Workspace", to: hospitalPath, badge: "Care" },
    { label: "Law Assistant", to: lawPath, badge: "Legal" },
    { label: "Medilink Chat", to: "/connect", badge: "Inbox" }
  ];

  return (
    <aside className={`workspace-menu ${className}`.trim()}>
      {showClose ? (
        <div className="workspace-menu-mobile-top">
          <button type="button" className="workspace-menu-close" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}

      <div className="workspace-menu-brand">
        <div className="workspace-menu-logo">M</div>
        <div>
          <div className="workspace-menu-title">Medilink AI</div>
          <p className="workspace-menu-copy">Search first. Open the right workspace when you need it.</p>
        </div>
      </div>

      <div className="workspace-menu-section-label">Workspaces</div>
      <nav className="workspace-menu-nav">
        {menuItems.map((item) => (
          <Link key={item.label} className={`workspace-menu-link ${isActive(item.to) ? "active" : ""}`} to={item.to} onClick={handleLinkClick}>
            <span className="workspace-menu-link-text">{item.label}</span>
            <span className="workspace-menu-link-badge">{item.badge}</span>
          </Link>
        ))}
      </nav>

      <div className="workspace-menu-footer">
        <div className="workspace-menu-user-label">Logged in as</div>
        <div className="workspace-menu-user">{account?.name || account?.phone || "Workspace user"}</div>
        <button type="button" className="workspace-menu-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}

export default WorkspaceMenu;
