import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import HospitalShell from "../components/HospitalShell";
import { getStoredAccount, getStoredProfile } from "../utils/session";
import {
  fetchHospitalAppointments,
  fetchHospitalDoctors,
  fetchHospitalServices
} from "../utils/hospitalApi";

function HospitalDashboard() {
  const account = getStoredAccount();
  const profile = getStoredProfile("hospital");
  const [doctors, setDoctors] = useState([]);
  const [services, setServices] = useState([]);
  const [appointments, setAppointments] = useState([]);

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

  const urgentAppointments = useMemo(
    () => appointments.filter((item) => item.priority === "Emergency").slice(0, 3),
    [appointments]
  );

  if (!account || !profile) {
    return <Navigate to="/register/hospital" replace />;
  }

  const summary = [
    { label: "Departments", value: profile.departments?.length || 0 },
    { label: "Doctors onboarded", value: doctors.length },
    { label: "Services listed", value: services.length },
    { label: "Appointment queue", value: appointments.length },
    { label: "Emergency line", value: profile.emergencyPhone || "Not set" },
    { label: "City", value: profile.city || "Add city" }
  ];

  const cards = [
    {
      title: "Hospital profile",
      text: "Update hospital identity, contacts and care availability.",
      to: "/hospital/profile"
    },
    {
      title: "Doctors",
      text: "Maintain a polished roster with specialty, timing and experience.",
      to: "/hospital/doctors"
    },
    {
      title: "Services",
      text: "List departments, scans, surgeries and diagnostic packages.",
      to: "/hospital/services"
    },
    {
      title: "Appointments",
      text: "Track appointment requests and emergency intake professionally.",
      to: "/hospital/appointments"
    }
  ];

  return (
    <HospitalShell
      title={`${profile.hospitalName || profile.name} dashboard`}
      subtitle="A more professional hospital workspace for operations, appointments and care presentation."
      actions={
        <>
          <Link className="header-pill" to="/hospital/profile">
            Edit hospital
          </Link>
          <Link className="header-link" to="/hospital/doctors">
            Manage doctors
          </Link>
          <Link className="header-link" to="/hospital/inbox">
            Inbox
          </Link>
          <Link className="header-link" to="/hospital/access">
            Switch hospital
          </Link>
        </>
      }
    >
      <section className="hospital-analytics-grid">
        {summary.map((item) => (
          <div key={item.label} className="soft-panel hospital-stat-card">
            <div className="identity-label">{item.label}</div>
            <div className="seller-stat-value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="hospital-hero-panel">
        <div className="hospital-hero-copy">
          <div className="eyebrow">Hospital overview</div>
          <h2>Present trust, readiness and clinical clarity</h2>
          <p className="muted-copy">
            This hospital side is now structured like an actual care workspace. We can keep
            building it into doctor discovery, bookings, diagnostics and patient support.
          </p>
        </div>

        <div className="hospital-priority-card">
          <div className="section-title">Emergency watch</div>
          {urgentAppointments.length === 0 && (
            <p className="muted-copy">No emergency appointments in the queue.</p>
          )}
          {urgentAppointments.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.patientName}</span>
              <small>{item.department || item.priority}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="seller-quick-links">
        {cards.map((card) => (
          <Link key={card.title} className="soft-panel action-card" to={card.to}>
            <h3>{card.title}</h3>
            <p className="muted-copy">{card.text}</p>
          </Link>
        ))}
      </section>
    </HospitalShell>
  );
}

export default HospitalDashboard;
