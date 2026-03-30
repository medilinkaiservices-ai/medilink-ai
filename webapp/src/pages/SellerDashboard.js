import React from "react";
import { Link, Navigate } from "react-router-dom";
import SellerShell from "../components/SellerShell";
import { getStoredAccount, getStoredProfile } from "../utils/session";

function SellerDashboard() {
  const account = getStoredAccount();
  const profile = getStoredProfile("seller");

  if (!account || !profile) {
    return <Navigate to="/register/seller" replace />;
  }

  const stats = [
    { label: "Shop ready", value: profile.shopName ? "Yes" : "Setup" },
    { label: "Role access", value: account.roles.includes("seller") ? "Seller active" : "Pending" },
    { label: "Primary city", value: profile.city || "Add city" }
  ];

  const tiles = [
    {
      title: "Inbox",
      text: "Read and reply to customer chats sent to your shop.",
      to: "/seller/inbox"
    },
    {
      title: "Shop profile",
      text: "Update store identity and business details.",
      to: "/seller/shop-profile"
    },
    {
      title: "Products list",
      text: "Browse the full catalog and remove old items quickly.",
      to: "/seller/products"
    },
    {
      title: "Offers",
      text: "Create shop promotions and special discounts.",
      to: "/seller/offers"
    },
    {
      title: "Analytics",
      text: "See product, order and revenue summary cards.",
      to: "/seller/analytics"
    },
    {
      title: "Settings",
      text: "Control timings, WhatsApp orders and shop availability.",
      to: "/seller/settings"
    },
    {
      title: "Add products",
      text: "Upload new products and grow your catalog.",
      to: "/product-entry"
    },
    {
      title: "Manage orders",
      text: "See requests and respond quickly from one place.",
      to: "/seller-orders"
    },
    {
      title: "Update products",
      text: "Adjust quantity, price and stock details.",
      to: "/product-update"
    }
  ];

  return (
    <SellerShell
      title={`${profile.shopName || profile.name}'s dashboard`}
      subtitle="A clean seller workspace for daily shop operations."
      actions={
        <>
          <Link className="header-pill" to="/product-entry">
            Add product
          </Link>
          <Link className="header-link" to="/seller/products">
            View products
          </Link>
          <Link className="header-link" to="/seller/inbox">
            Inbox
          </Link>
          <Link className="header-link" to="/seller/analytics">
            View analytics
          </Link>
          <Link className="header-link" to="/seller/settings">
            Settings
          </Link>
          <Link className="header-link" to="/seller/shop-profile">
            Edit shop
          </Link>
        </>
      }
    >
      <section className="seller-stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="soft-panel">
            <div className="identity-label">{stat.label}</div>
            <div className="seller-stat-value">{stat.value}</div>
          </div>
        ))}
      </section>

      <section className="seller-hero-card">
        <div>
          <div className="eyebrow">Seller overview</div>
          <h2>Run your store from one focused panel</h2>
          <p className="muted-copy">
            We now have a dedicated seller workspace. Next we can keep improving
            products, order management, offers and analytics from this base.
          </p>
        </div>
        <div className="seller-quick-links">
          {tiles.map((tile) => (
            <Link key={tile.title} className="soft-panel action-card" to={tile.to}>
              <h3>{tile.title}</h3>
              <p className="muted-copy">{tile.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </SellerShell>
  );
}

export default SellerDashboard;
