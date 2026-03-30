import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import Chatbot from "../components/Chatbot";
import { db } from "../firebase";
import { getStoredAccount, getStoredProfile } from "../utils/session";
import { fetchSellerKhathaSummary } from "../utils/khathaApi";

function SellerDashboard() {
  const account = getStoredAccount();
  const profile = getStoredProfile("seller");
  const [khathaSummary, setKhathaSummary] = useState({
    totalCustomers: 0,
    totalCredit: 0,
    totalDebit: 0,
    outstanding: 0,
    topCustomers: []
  });
  const [operations, setOperations] = useState({
    productCount: 0,
    offerCount: 0,
    orderCount: 0,
    pendingOrders: 0,
    lowStockItems: []
  });

  useEffect(() => {
    if (!profile?.shopId) return;
    fetchSellerKhathaSummary(profile.shopId)
      .then(setKhathaSummary)
      .catch((error) => console.error("Failed to load seller khatha summary:", error));
  }, [profile?.shopId]);

  useEffect(() => {
    const loadOperations = async () => {
      if (!profile?.shopId) return;

      try {
        const [productSnapshot, offerSnapshot, orderSnapshot] = await Promise.all([
          getDocs(query(collection(db, "products"), where("shopId", "==", profile.shopId))),
          getDocs(query(collection(db, "offers"), where("shopId", "==", profile.shopId))),
          getDocs(query(collection(db, "orders"), where("shopId", "==", profile.shopId)))
        ]);

        const products = productSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        const orders = orderSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        const lowStockItems = products
          .filter((item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 5)
          .slice(0, 4);

        setOperations({
          productCount: products.length,
          offerCount: offerSnapshot.size,
          orderCount: orders.length,
          pendingOrders: orders.filter((item) => !item.status || item.status === "Pending").length,
          lowStockItems
        });
      } catch (error) {
        console.error("Failed to load seller operations summary:", error);
      }
    };

    loadOperations();
  }, [profile?.shopId]);

  if (!account || !profile) {
    return <Navigate to="/register/seller" replace />;
  }

  const sellerContext = {
    shopName: profile.shopName || "Your Shop",
    products: "Manage your products in the Products section.",
    prices: "Update pricing in the Update Products section.",
    availability: profile.orderEnabled ? "Accepting orders" : "Orders paused",
    offers: "Create and manage offers in the Offers section."
  };

  const stats = [
    { label: "Shop ready", value: profile.shopName ? "Yes" : "Setup" },
    { label: "Role access", value: account.roles.includes("seller") ? "Seller active" : "Pending" },
    { label: "Primary city", value: profile.city || "Add city" },
    { label: "Pending orders", value: operations.pendingOrders },
    { label: "Low stock items", value: operations.lowStockItems.length }
  ];

  const tiles = [
    { title: "Inbox", text: "Read and reply to customer chats sent to your shop.", to: "/seller/inbox" },
    { title: "Shop profile", text: "Update store identity and business details.", to: "/seller/shop-profile" },
    { title: "Products list", text: "Browse the full catalog and remove old items quickly.", to: "/seller/products" },
    { title: "Offers", text: "Create shop promotions and special discounts.", to: "/seller/offers" },
    { title: "Analytics", text: "See product, order and revenue summary cards.", to: "/seller/analytics" },
    { title: "Settings", text: "Control timings, WhatsApp orders and shop availability.", to: "/seller/settings" },
    { title: "Add products", text: "Upload new products and grow your catalog.", to: "/product-entry" },
    { title: "Manage orders", text: "See requests and respond quickly from one place.", to: "/seller-orders" },
    { title: "Update products", text: "Adjust quantity, price and stock details.", to: "/product-update" }
  ];

  return (
    <SellerShell
      title={`${profile.shopName || profile.name}'s dashboard`}
      subtitle="A premium seller workspace for daily shop operations, order flow and catalog growth."
      actions={
        <>
          <Link className="header-pill" to="/product-entry">Add product</Link>
          <Link className="header-link" to="/seller/products">View products</Link>
          <Link className="header-link" to="/seller/inbox">Inbox</Link>
        </>
      }
    >
      <section className="seller-dashboard-hero soft-panel">
        <div>
          <div className="eyebrow">Seller overview</div>
          <h2>Run your store from one premium operations panel</h2>
          <p className="muted-copy">
            Focus on products, orders, offers and customer conversations without switching between cluttered screens.
          </p>
        </div>
        <div className="seller-dashboard-badges">
          <span>Catalog ready</span>
          <span>Chat enabled</span>
          <span>Orders active</span>
        </div>
      </section>

      <section className="seller-stats-grid seller-dashboard-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="soft-panel premium-stat-card">
            <div className="identity-label">{stat.label}</div>
            <div className="seller-stat-value">{stat.value}</div>
          </div>
        ))}
      </section>

      <section className="seller-hero-card">
        <div className="seller-quick-links seller-dashboard-grid">
          {tiles.map((tile) => (
            <Link key={tile.title} className="soft-panel action-card premium-action-card" to={tile.to}>
              <div className="eyebrow">Workspace</div>
              <h3>{tile.title}</h3>
              <p className="muted-copy">{tile.text}</p>
              <span className="card-cta">Open</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="seller-two-column">
        <div className="soft-panel">
          <div className="section-title">Operations snapshot</div>
          <div className="list-row">
            <span>Total products</span>
            <small>{operations.productCount}</small>
          </div>
          <div className="list-row">
            <span>Active offers</span>
            <small>{operations.offerCount}</small>
          </div>
          <div className="list-row">
            <span>Total orders</span>
            <small>{operations.orderCount}</small>
          </div>
          <div className="list-row">
            <span>Pending orders</span>
            <small>{operations.pendingOrders}</small>
          </div>
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-link" to="/seller-orders">Open orders</Link>
            <Link className="header-link" to="/product-update">Update stock</Link>
          </div>
        </div>

        <div className="soft-panel">
          <div className="section-title">Khatha summary</div>
          <div className="list-row">
            <span>Total khatha customers</span>
            <small>{khathaSummary.totalCustomers}</small>
          </div>
          <div className="list-row">
            <span>Total credit</span>
            <small>Rs. {khathaSummary.totalCredit.toFixed(2)}</small>
          </div>
          <div className="list-row">
            <span>Total debit</span>
            <small>Rs. {khathaSummary.totalDebit.toFixed(2)}</small>
          </div>
          <div className="list-row">
            <span>Outstanding balance</span>
            <small>Rs. {khathaSummary.outstanding.toFixed(2)}</small>
          </div>
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-link" to="/khatha-billing">Open billing</Link>
            <Link className="header-link" to="/khatha-history">Open history</Link>
          </div>
        </div>
      </section>

      <section className="seller-two-column">
        <div className="soft-panel">
          <div className="section-title">Low stock watch</div>
          {operations.lowStockItems.length === 0 ? <p className="muted-copy">No low-stock items right now.</p> : null}
          {operations.lowStockItems.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.productName || item.name || "Unnamed product"}</span>
              <small>{Number(item.quantity || 0)} left</small>
            </div>
          ))}
        </div>

        <div className="soft-panel">
          <div className="section-title">Top pending customers</div>
          {khathaSummary.topCustomers.length === 0 ? <p className="muted-copy">No outstanding khatha balances right now.</p> : null}
          {khathaSummary.topCustomers.map((customer) => (
            <div key={customer.id} className="list-row">
              <span>{customer.name}</span>
              <small>Rs. {Number(customer.balance || 0).toFixed(2)}</small>
            </div>
          ))}
        </div>
      </section>

      <Chatbot role="shop" contextData={sellerContext} floating />
    </SellerShell>
  );
}

export default SellerDashboard;
