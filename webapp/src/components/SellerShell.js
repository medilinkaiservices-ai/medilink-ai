import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredProfile } from "../utils/session";

const navItems = [
  { to: "/seller/dashboard", label: "Overview" },
  { to: "/seller/inbox", label: "Inbox" },
  { to: "/seller/shop-profile", label: "Shop Profile" },
  { to: "/seller/products", label: "Products" },
  { to: "/seller/offers", label: "Offers" },
  { to: "/seller/analytics", label: "Analytics" },
  { to: "/seller/settings", label: "Settings" },
  { to: "/product-entry", label: "Add Product" },
  { to: "/product-update", label: "Update Products" },
  { to: "/seller-orders", label: "Orders" }
];

function SellerShell({ title, subtitle, actions, children }) {
  const location = useLocation();
  const profile = getStoredProfile("seller");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profile?.phone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(
      profile.phone,
      setUnreadCount,
      (error) => console.error("Failed to subscribe to seller unread count:", error)
    );
  }, [profile?.phone]);

  if (!profile) {
    return <Navigate to="/seller/access" replace />;
  }

  return (
    <div className="page-shell">
      <div className="seller-layout">
        <aside className="seller-sidebar">
          <div className="seller-sidebar-card">
            <div className="eyebrow">Seller workspace</div>
            <h2>{profile.shopName || profile.name}</h2>
            <p className="muted-copy">
              Manage your shop, products and orders from one clean seller panel.
            </p>
          </div>

          <nav className="seller-nav">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              const label = item.to === "/seller/inbox" && unreadCount > 0
                ? `${item.label} (${unreadCount})`
                : item.label;

              return (
                <Link
                  key={item.to}
                  className={isActive ? "seller-nav-link active" : "seller-nav-link"}
                  to={item.to}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="seller-main">
          <div className="seller-topbar">
            <div>
              <div className="eyebrow">Seller side</div>
              <h1>{title}</h1>
              {subtitle && <p className="muted-copy">{subtitle}</p>}
            </div>
            {actions && <div className="seller-top-actions">{actions}</div>}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

export default SellerShell;
