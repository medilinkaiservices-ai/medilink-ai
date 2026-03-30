import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import Chatbot from "../components/Chatbot";
import CustomerWorkspaceSidebar from "../components/CustomerWorkspaceSidebar";
import { db } from "../firebase";
import { fetchAppointmentsByPhone, fetchHospitals } from "../utils/hospitalApi";
import { fetchCustomerKhathaSummary } from "../utils/khathaApi";
import { getStoredAccount, getStoredProfile } from "../utils/session";

function CustomerAccount() {
  const [searchParams] = useSearchParams();
  const account = getStoredAccount();
  const profile = getStoredProfile("customer");
  const [activeSection, setActiveSection] = useState(searchParams.get("section") || "orders");
  const [orders, setOrders] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [khathaSummary, setKhathaSummary] = useState({
    totalBalance: 0,
    totalCredit: 0,
    totalDebit: 0,
    shops: []
  });

  useEffect(() => {
    const loadOrders = async () => {
      if (!profile?.phone) return;
      try {
        const snapshot = await getDocs(
          query(collection(db, "orders"), where("address.phone", "==", profile.phone))
        );
        setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error("Failed to load customer orders:", error);
        setOrders([]);
      }
    };

    loadOrders();
  }, [profile?.phone]);

  useEffect(() => {
    if (!profile?.phone) return;
    fetchCustomerKhathaSummary(profile.phone)
      .then(setKhathaSummary)
      .catch((error) => console.error("Failed to load customer khatha summary:", error));
  }, [profile?.phone]);

  useEffect(() => {
    if (!profile?.phone) return;
    fetchAppointmentsByPhone(profile.phone)
      .then(setAppointments)
      .catch((error) => console.error("Failed to load customer hospital records:", error));
  }, [profile?.phone]);

  useEffect(() => {
    fetchHospitals()
      .then(setHospitals)
      .catch((error) => console.error("Failed to load hospitals:", error));
  }, []);

  const customerContext = useMemo(() => ({
    appFeatures: "Customer orders, khatha balances, hospital records, and chat inbox in one customer workspace.",
    navigationHelp: "Use the left customer menu to switch between orders, khatha, hospital records and inbox.",
    generalInfo: "Medilink AI supports customer shopping, khatha tracking and hospital follow-up.",
    customerArea: profile?.area || "",
    hospitals: appointments.slice(0, 10).map((appointment) => ({
      name: appointment.hospitalName || "Hospital",
      city: appointment.city || "",
      departments: [appointment.department].filter(Boolean),
      emergencyPhone: appointment.contactPhone || ""
    }))
  }), [appointments, profile?.area]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "khatha" || section === "records" || section === "orders") {
      setActiveSection(section);
      return;
    }

    setActiveSection("orders");
  }, [searchParams]);

  if (!account) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return <Navigate to="/register/customer" replace />;
  }

  const requestPaymentConfirmation = (shop) => {
    const phone = String(shop.ownerPhone || "").replace(/\D/g, "");
    if (!phone) {
      alert("Seller phone not available for this khatha entry.");
      return;
    }

    const fullPhone = phone.length === 10 ? `91${phone}` : phone;
    const text = `Hello ${shop.shopName}, I have paid or want to confirm my khatha balance of Rs. ${Number(shop.balance || 0).toFixed(2)}. Please update my khatha status in Medilink AI.`;
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="page-shell customer-workspace-shell">
      <CustomerWorkspaceSidebar activeSection={activeSection} />

      <main className="customer-workspace-main">
        <section className="account-hero">
          <div>
            <div className="eyebrow">
              {activeSection === "orders" ? "Orders" : activeSection === "khatha" ? "Khatha Book" : "Hospital Records"}
            </div>
            <h1>
              {activeSection === "orders" && "Your orders"}
              {activeSection === "khatha" && "Your khatha book"}
              {activeSection === "records" && "Your hospital records"}
            </h1>
            <p className="muted-copy">
              {activeSection === "orders" && "Track placed orders, repeat purchases and next shopping actions."}
              {activeSection === "khatha" && "Watch outstanding balance, debit, credit and shop-wise khatha entries."}
              {activeSection === "records" && "See hospital appointments, request status and recent care activity."}
            </p>
          </div>

          <div className="identity-card">
            <div className="identity-label">Orders</div>
            <div className="identity-value">{orders.length}</div>
            <div className="identity-label">Khatha shops</div>
            <div className="identity-value">{khathaSummary.shops.length}</div>
            <div className="identity-label">Hospital records</div>
            <div className="identity-value">{appointments.length}</div>
          </div>
        </section>

        {activeSection === "orders" && (
          <section className="customer-section-stack">
            <div className="soft-panel">
              <div className="section-title">Order summary</div>
              <div className="customer-summary-grid">
                <div className="list-row"><span>Total orders</span><small>{orders.length}</small></div>
                <div className="list-row"><span>Active cart</span><small><Link to="/cart">Open cart</Link></small></div>
                <div className="list-row"><span>Find more shops</span><small><Link to="/search">Search</Link></small></div>
              </div>
            </div>

            <div className="soft-panel">
              <div className="section-title">Recent orders</div>
              {!orders.length ? <p className="muted-copy">No orders yet. Search a shop and place your first order.</p> : null}
              {orders.map((order) => (
                <div key={order.id} className="customer-record-card">
                  <div className="seller-product-head">
                    <strong>{order.address?.name || profile.name || "Customer order"}</strong>
                    <small>Rs. {Number(order.total || 0).toFixed(2)}</small>
                  </div>
                  <p className="muted-copy">Status: {order.status || "pending"}</p>
                  <p className="muted-copy">Items: {Array.isArray(order.items) ? order.items.length : 0}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeSection === "khatha" && (
          <section className="customer-section-stack">
            <div className="soft-panel">
              <div className="section-title">Khatha summary</div>
              <div className="list-row"><span>Total outstanding</span><small>Rs. {Number(khathaSummary.totalBalance || 0).toFixed(2)}</small></div>
              <div className="list-row"><span>Total credit</span><small>Rs. {Number(khathaSummary.totalCredit || 0).toFixed(2)}</small></div>
              <div className="list-row"><span>Total debit</span><small>Rs. {Number(khathaSummary.totalDebit || 0).toFixed(2)}</small></div>
            </div>

            <div className="soft-panel">
              <div className="section-title">Shop-wise khatha</div>
              {!khathaSummary.shops.length ? <p className="muted-copy">No khatha entries linked to your number yet.</p> : null}
              {khathaSummary.shops.map((shop) => (
                <div key={shop.shopId} className="customer-record-card">
                  <div className="seller-product-head">
                    <strong>{shop.shopName}</strong>
                    <small>Rs. {Number(shop.balance || 0).toFixed(2)}</small>
                  </div>
                  <p className="muted-copy">Credit: Rs. {Number(shop.totalCredit || 0).toFixed(2)} | Debit: Rs. {Number(shop.totalDebit || 0).toFixed(2)}</p>
                  {Number(shop.balance || 0) > 0 ? (
                    <button type="button" className="header-link" style={{ marginTop: "12px" }} onClick={() => requestPaymentConfirmation(shop)}>
                      Request payment confirmation
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeSection === "records" && (
          <section className="customer-section-stack">
            <div className="soft-panel">
              <div className="section-title">Hospital records</div>
              {!appointments.length ? <p className="muted-copy">No hospital records yet. Explore hospitals and send your first request.</p> : null}
              {appointments.map((appointment) => (
                <div key={appointment.id} className="customer-record-card">
                  <div className="seller-product-head">
                    <strong>{appointment.hospitalName || "Hospital request"}</strong>
                    <small>{appointment.status || "Pending review"}</small>
                  </div>
                  <p className="muted-copy">Department: {appointment.department || "General"}</p>
                  <p className="muted-copy">Date: {appointment.date || "Flexible"}</p>
                  <p className="muted-copy">Priority: {appointment.priority || "Standard"}</p>
                </div>
              ))}
            </div>

            <div className="soft-panel">
              <div className="section-title">Explore hospitals</div>
              {hospitals.slice(0, 5).map((hospital) => (
                <Link key={hospital.id} className="list-row" to={`/hospitals/${hospital.id}`}>
                  <span>{hospital.hospitalName}</span>
                  <small>{hospital.city || "Hospital"}</small>
                </Link>
              ))}
            </div>
          </section>
        )}

        <Chatbot role="customer" contextData={customerContext} floating />
      </main>
    </div>
  );
}

export default CustomerAccount;
