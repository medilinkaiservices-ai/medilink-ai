import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import HospitalShell from "../components/HospitalShell";
import { getStoredAccount, getStoredProfile } from "../utils/session";
import { fetchHospitalAppointments, fetchHospitalDoctors, fetchHospitalServices } from "../utils/hospitalApi";
import { getChatIdentityForRole, subscribeToRooms } from "../utils/chatApi";

function HospitalDashboard() {
  const account = getStoredAccount();
  const profile = getStoredProfile("hospital");
  const [doctors, setDoctors] = useState([]);
  const [services, setServices] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [quickDraft, setQuickDraft] = useState("");
  const chatIdentity = getChatIdentityForRole("hospital");

  useEffect(() => {
    const loadSummary = async () => {
      if (!profile?.hospitalId) return;
      const [doctorList, serviceList, appointmentList] = await Promise.all([
        fetchHospitalDoctors(profile.hospitalId),
        fetchHospitalServices(profile.hospitalId),
        fetchHospitalAppointments(profile.hospitalId)
      ]);
      setDoctors(doctorList);
      setServices(serviceList);
      setAppointments(appointmentList);
    };

    loadSummary().catch((error) => console.error("Failed to load hospital summary:", error));
  }, [profile?.hospitalId]);

  const urgentAppointments = useMemo(() => appointments.filter((item) => item.priority === "Emergency").slice(0, 3), [appointments]);
  const timingsLabel = profile?.alwaysOpen
    ? "Open 24/7"
    : profile?.openTime && profile?.closeTime
      ? `${profile.openTime} - ${profile.closeTime}`
      : "Add timings";

  useEffect(() => {
    if (!chatIdentity?.phone) {
      setRooms([]);
      return undefined;
    }

    return subscribeToRooms(
      chatIdentity.phone,
      (nextRooms) => setRooms(nextRooms.slice(0, 4)),
      (error) => console.error("Failed to load hospital rooms:", error)
    );
  }, [chatIdentity?.phone]);

  if (!account) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/register/hospital" replace />;

  const summary = [
    { label: "Status", value: profile?.alwaysOpen ? "24/7 care" : "Active today" },
    { label: "Emergency", value: profile.emergencyPhone || "Not set" }
  ];

  const cards = [
    { title: "Doctors", metric: doctors.length, metricLabel: "profiles", text: "Manage doctor profiles, specialties and timings.", to: "/hospital/doctors" },
    { title: "Services", metric: services.length, metricLabel: "listed", text: "Update departments, scans and treatments.", to: "/hospital/services" },
    { title: "Appointments", metric: appointments.length, metricLabel: "requests", text: "Review bookings and emergency cases quickly.", to: "/hospital/appointments" },
    { title: "Hospital profile", metric: profile.departments?.length || 0, metricLabel: "departments", text: "Edit hospital identity, contacts and availability.", to: "/hospital/profile" }
  ];

  return (
    <HospitalShell
      title="Dashboard"
      subtitle="Doctors, services and appointments ni one clean workspace lo manage cheyandi."
    >
      <section className="hospital-dashboard-summary-strip">
        {summary.map((item) => (
          <div key={item.label} className="soft-panel hospital-stat-card premium-stat-card compact-hospital-stat">
            <div className="identity-label">{item.label}</div>
            <div className="seller-stat-value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="hospital-dashboard-focus soft-panel">
        <div className="hospital-dashboard-focus-copy">
          <div className="eyebrow">Overview</div>
          <h2>Quick access</h2>
          <div className="hospital-dashboard-inline-meta">
            <span>{profile.city || "Add city"}</span>
            <span>{timingsLabel}</span>
          </div>
        </div>
        <div className="hospital-priority-card compact-priority-card">
          <div className="section-title">Emergency queue</div>
          {urgentAppointments.length === 0 ? <p className="muted-copy">No emergency appointments in the queue.</p> : null}
          {urgentAppointments.map((item) => <div key={item.id} className="list-row"><span>{item.patientName}</span><small>{item.department || item.priority}</small></div>)}
        </div>
      </section>

      <section className="soft-panel hospital-priority-card compact-priority-card">
        <div className="hospital-public-card-head">
          <div>
            <div className="eyebrow">Patient communication</div>
            <h3>Replies, reminders and follow-up</h3>
          </div>
          <Link className="header-link" to="/hospital/inbox">Open inbox</Link>
        </div>
        {rooms.length === 0 ? <p className="muted-copy">No incoming messages.</p> : null}
        {rooms.map((room) => (
          <Link key={room.id} className="list-row" to={`/hospital/inbox/${room.id}`}>
            <span>{room.targetName || room.groupName || room.lastSenderName || "Patient"}</span>
            <small>{room.unreadByPhones?.includes(chatIdentity?.phone) ? "Unread" : "Open"}</small>
          </Link>
        ))}
        <div className="hospital-dashboard-chatbox">
          <textarea
            rows="3"
            value={quickDraft}
            onChange={(event) => setQuickDraft(event.target.value)}
            placeholder="Type reply, reminder, or discount message..."
          />
          <div className="chat-compose-bar hospital-dashboard-chatbox-bar">
            <span className="muted-copy">
              {rooms[0] ? `Open ${rooms[0].targetName || "chat"} to send` : "Open inbox to send message"}
            </span>
            <Link
              className="primary-button"
              to={rooms[0] ? `/hospital/inbox/${rooms[0].id}` : "/hospital/inbox"}
            >
              Continue
            </Link>
          </div>
        </div>
        <div className="seller-inline-actions">
          <Link className="ghost-button" to="/hospital/inbox">Reply to patients</Link>
          <Link className="ghost-button" to="/hospital/inbox">Send reminders</Link>
        </div>
      </section>

      <section className="seller-quick-links seller-dashboard-grid hospital-dashboard-grid">
        {cards.map((card) => (
          <Link key={card.title} className="soft-panel action-card premium-action-card" to={card.to}>
            <h3>{card.title}</h3>
            <div className="hospital-dashboard-card-metric">{card.metric} <span>{card.metricLabel}</span></div>
            <span className="card-cta">Open</span>
          </Link>
        ))}
      </section>
    </HospitalShell>
  );
}

export default HospitalDashboard;
