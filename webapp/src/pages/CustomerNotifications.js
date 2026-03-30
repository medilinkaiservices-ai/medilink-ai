import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchAppointmentsByPhone } from "../utils/hospitalApi";
import { getStoredProfile } from "../utils/session";

function CustomerNotifications() {
  const customer = getStoredProfile("customer");
  const [appointments, setAppointments] = useState([]);

  useEffect(() => {
    const loadAppointments = async () => {
      if (!customer?.phone) return;
      const list = await fetchAppointmentsByPhone(customer.phone);
      setAppointments(list);
    };

    loadAppointments().catch((error) => console.error("Failed to load hospital alerts:", error));
  }, [customer?.phone]);

  const activeHospitalAlerts = useMemo(
    () => appointments.filter((item) => item.status && item.status !== "Confirmed"),
    [appointments]
  );

  if (!customer) {
    return <Navigate to="/register/customer" replace />;
  }

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Hospital Alerts</div>
          <h1>Your hospital updates</h1>
          <p className="muted-copy">
            Only hospital-related alerts are shown here, including appointment review, follow-up and priority updates.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Pending hospital alerts</div>
          <div className="identity-value">{activeHospitalAlerts.length}</div>
          <div className="identity-label">Total hospital records</div>
          <div className="identity-value">{appointments.length}</div>
          <div className="identity-label">Customer</div>
          <div className="identity-value">{customer.name}</div>
        </div>
      </section>

      <section className="customer-section-stack">
        <div className="soft-panel">
          <div className="section-title">Active hospital alerts</div>
          {!activeHospitalAlerts.length ? (
            <p className="muted-copy">No pending hospital alerts right now.</p>
          ) : null}
          {activeHospitalAlerts.map((appointment) => (
            <div key={appointment.id} className="customer-record-card">
              <div className="seller-product-head">
                <strong>{appointment.hospitalName || "Hospital"}</strong>
                <small>{appointment.status || "Pending review"}</small>
              </div>
              <p className="muted-copy">Department: {appointment.department || "General"}</p>
              <p className="muted-copy">Priority: {appointment.priority || "Normal"}</p>
              <p className="muted-copy">Date: {appointment.date || "Flexible"}</p>
            </div>
          ))}
        </div>

        <div className="soft-panel">
          <div className="section-title">All hospital records</div>
          {!appointments.length ? <p className="muted-copy">No hospital appointments or records found yet.</p> : null}
          {appointments.map((appointment) => (
            <div key={appointment.id} className="list-row">
              <span>{appointment.hospitalName || "Hospital"}</span>
              <small>{appointment.status || "Pending review"}</small>
            </div>
          ))}
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-link" to="/customer/appointments">
              View hospital records
            </Link>
            <Link className="header-pill" to="/hospitals">
              Explore hospitals
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CustomerNotifications;
