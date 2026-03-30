import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchAppointmentsByPhone } from "../utils/hospitalApi";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredProfile } from "../utils/session";

function CustomerNotifications() {
  const customer = getStoredProfile("customer");
  const [unreadChats, setUnreadChats] = useState(0);
  const [appointments, setAppointments] = useState([]);

  useEffect(() => {
    if (!customer?.phone) return undefined;

    return subscribeToUnreadCount(
      customer.phone,
      setUnreadChats,
      (error) => console.error("Failed to subscribe to customer unread chats:", error)
    );
  }, [customer?.phone]);

  useEffect(() => {
    const loadAppointments = async () => {
      if (!customer?.phone) return;
      const list = await fetchAppointmentsByPhone(customer.phone);
      setAppointments(list);
    };

    loadAppointments().catch((error) => console.error("Failed to load notification appointments:", error));
  }, [customer?.phone]);

  if (!customer) {
    return <Navigate to="/register/customer" replace />;
  }

  const activeAppointments = appointments.filter((item) => item.status && item.status !== "Confirmed");

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Notifications</div>
          <h1>Your customer alerts</h1>
          <p className="muted-copy">
            Track unread chats, hospital updates and follow-up actions from one clean customer view.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Unread chats</div>
          <div className="identity-value">{unreadChats}</div>
          <div className="identity-label">Appointment alerts</div>
          <div className="identity-value">{activeAppointments.length}</div>
          <div className="identity-label">Customer</div>
          <div className="identity-value">{customer.name}</div>
        </div>
      </section>

      <section className="seller-quick-links">
        <div className="soft-panel">
          <div className="section-title">Chat alerts</div>
          <p className="muted-copy">
            You currently have {unreadChats} unread conversations waiting in Medilink Chat.
          </p>
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-pill" to="/connect">
              Open chat inbox
            </Link>
          </div>
        </div>

        <div className="soft-panel">
          <div className="section-title">Hospital updates</div>
          {activeAppointments.length === 0 && (
            <p className="muted-copy">No pending hospital updates right now.</p>
          )}
          {activeAppointments.slice(0, 4).map((appointment) => (
            <div key={appointment.id} className="list-row">
              <span>{appointment.hospitalName || "Hospital"}</span>
              <small>{appointment.status || "Pending review"}</small>
            </div>
          ))}
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-link" to="/customer/appointments">
              View appointments
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CustomerNotifications;
