import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getStoredProfile } from "../utils/session";
import { fetchAppointmentsByPhone } from "../utils/hospitalApi";

function getAppointmentTimeline(status) {
  const stages = ["Request sent", "Under review", "Confirmed"];

  if (status === "Immediate attention") {
    return ["Request sent", "Emergency review", "Priority response"];
  }

  if (status === "In follow-up") {
    return ["Request sent", "Under review", "Follow-up active"];
  }

  if (status === "Confirmed") {
    return stages;
  }

  return ["Request sent", "Under review", "Awaiting confirmation"];
}

function CustomerAppointments() {
  const customer = getStoredProfile("customer");
  const [appointments, setAppointments] = useState([]);

  useEffect(() => {
    const loadAppointments = async () => {
      if (!customer?.phone) return;
      const list = await fetchAppointmentsByPhone(customer.phone);
      setAppointments(list);
    };

    loadAppointments().catch((error) => console.error("Failed to load customer appointments:", error));
  }, [customer?.phone]);

  if (!customer) {
    return <Navigate to="/register/customer" replace />;
  }

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Customer appointments</div>
          <h1>Your hospital requests</h1>
          <p className="muted-copy">
            Track hospital appointment requests, priority and current response status.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Customer</div>
          <div className="identity-value">{customer.name}</div>
          <div className="identity-label">Mobile</div>
          <div className="identity-value">{customer.phone}</div>
          <div className="identity-label">Requests</div>
          <div className="identity-value">{appointments.length}</div>
        </div>
      </section>

      <div className="hospital-stack">
        {appointments.length === 0 && (
          <div className="soft-panel">
            <h3>No hospital requests yet</h3>
            <p className="muted-copy">
              Explore hospitals and send your first appointment request.
            </p>
            <div className="account-actions" style={{ marginTop: "16px" }}>
              <Link className="header-pill" to="/hospitals">
                Explore hospitals
              </Link>
            </div>
          </div>
        )}

        {appointments.map((appointment) => (
          <div key={appointment.id} className="hospital-card">
            <div className="seller-product-head">
              <h3>{appointment.hospitalName || "Hospital request"}</h3>
              <span className="order-status-pill">{appointment.priority}</span>
            </div>
            <p className="muted-copy">Department: {appointment.department}</p>
            <p className="muted-copy">Date: {appointment.date || "Flexible"}</p>
            <p className="muted-copy">Status: {appointment.status || "Pending review"}</p>
            <p className="muted-copy">Note: {appointment.note || "No note added."}</p>
            <div className="timeline-row">
              {getAppointmentTimeline(appointment.status).map((step, index) => (
                <div key={step} className="timeline-step">
                  <div className={index < 2 || appointment.status === "Confirmed" || appointment.status === "In follow-up" || appointment.status === "Immediate attention" ? "timeline-dot active" : "timeline-dot"} />
                  <small>{step}</small>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CustomerAppointments;
