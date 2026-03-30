import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredProfile } from "../utils/session";

const navItems = [
  { to: "/seller/dashboard", label: "Dashboard" },
  { to: "/seller/shop-profile", label: "Shop Profile" },
  { to: "/seller/inbox", label: "Inbox" },
  { to: "/seller/products", label: "Products" },
  { to: "/seller/offers", label: "Offers" },
  { to: "/seller-orders", label: "Orders" },
  { to: "/seller/qr", label: "QR code" },
  { to: "/seller/analytics", label: "Analytics" },
  { to: "/seller/settings", label: "Settings" },
  { to: "/khatha-billing", label: "Khatha Billing" }
];

function SellerShell({ title, subtitle, actions, children }) {
  const location = useLocation();
  const profile = getStoredProfile("seller");
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!profile?.phone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(profile.phone, setUnreadCount, (error) =>
      console.error("Failed to subscribe to seller unread count:", error)
    );
  }, [profile?.phone]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!profile) {
    return <Navigate to="/seller/access" replace />;
  }

  return (
    <div className="page-shell">
      <div className="seller-layout premium-seller-layout">
        <aside className="seller-sidebar premium-seller-sidebar">
          <div className={menuOpen ? "seller-mobile-nav-panel active" : "seller-mobile-nav-panel"}>
            <div className="shell-section-label">Workspace</div>
            <nav className="seller-nav premium-seller-nav">
              {navItems.map((item) => {
                const isActive = location.pathname === item.to;
                const label = item.to === "/seller/inbox" && unreadCount > 0 ? `${item.label} (${unreadCount})` : item.label;

                return (
                  <Link key={item.to} className={isActive ? "seller-nav-link active" : "seller-nav-link"} to={item.to}>
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="seller-main">
          <div className="seller-topbar premium-seller-topbar">
            <div>
              <div className="eyebrow">Seller side</div>
              <h1>{title}</h1>
              {subtitle && <p className="muted-copy">{subtitle}</p>}
            </div>
            <div className="seller-top-actions">
              <button
                type="button"
                className="seller-mobile-menu-button"
                onClick={() => setMenuOpen((current) => !current)}
              >
                {menuOpen ? "Close menu" : "Menu"}
              </button>
              {actions}
            </div>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

export default SellerShell;
