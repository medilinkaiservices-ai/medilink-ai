import React, { useEffect, useState } from "react";
import HospitalShell from "../components/HospitalShell";
import { getStoredProfile } from "../utils/session";
import {
  createHospitalAppointment,
  fetchHospitalAppointments,
  updateHospitalAppointment,
  updateHospitalAppointmentStatus
} from "../utils/hospitalApi";

function getTimelineSteps(status) {
  if (status === "Immediate attention") {
    return ["Request", "Emergency desk", "Critical response"];
  }

  if (status === "In follow-up") {
    return ["Request", "Reviewed", "Follow-up"];
  }

  if (status === "Confirmed") {
    return ["Request", "Reviewed", "Confirmed"];
  }

  return ["Request", "Reviewed", "Pending"];
}

function HospitalAppointments() {
  const profile = getStoredProfile("hospital");
  const [appointments, setAppointments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [responseNotes, setResponseNotes] = useState({});
  const [form, setForm] = useState({
    patientName: "",
    department: "",
    contact: "",
    date: "",
    priority: "Normal"
  });

  useEffect(() => {
    const loadAppointments = async () => {
      if (!profile?.hospitalId) return;
      const list = await fetchHospitalAppointments(profile.hospitalId);
      setAppointments(list);
    };

    loadAppointments().catch((error) => console.error("Failed to load appointments:", error));
  }, [profile?.hospitalId]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "contact" ? value.replace(/[^0-9]/g, "").slice(0, 10) : value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.patientName.trim() || !form.department.trim() || !profile?.hospitalId) {
      alert("Enter patient name and department.");
      return;
    }

    const nextAppointment = {
      hospitalId: profile.hospitalId,
      hospitalName: profile.hospitalName,
      patientName: form.patientName.trim(),
      department: form.department.trim(),
      contact: form.contact.trim(),
      date: form.date,
      priority: form.priority,
      status: form.priority === "Emergency" ? "Immediate attention" : "Pending review",
      responseNote: ""
    };

    const appointmentId = await createHospitalAppointment(nextAppointment);
    setAppointments((current) => [{ id: appointmentId, ...nextAppointment }, ...current]);
    setForm({
      patientName: "",
      department: "",
      contact: "",
      date: "",
      priority: "Normal"
    });
  };

  const updateStatus = async (appointmentId, status) => {
    await updateHospitalAppointmentStatus(appointmentId, status);
    setAppointments((current) =>
      current.map((item) => (item.id === appointmentId ? { ...item, status } : item))
    );
  };

  const handleResponseNoteChange = (appointmentId, value) => {
    setResponseNotes((current) => ({
      ...current,
      [appointmentId]: value
    }));
  };

  const handleSaveResponse = async (appointmentId) => {
    const responseNote = (responseNotes[appointmentId] || "").trim();
    await updateHospitalAppointment(appointmentId, { responseNote });
    setAppointments((current) =>
      current.map((item) => (item.id === appointmentId ? { ...item, responseNote } : item))
    );
  };

  const visibleAppointments = appointments.filter((appointment) => {
    const statusMatches = statusFilter === "All" || appointment.status === statusFilter;
    const priorityMatches = priorityFilter === "All" || appointment.priority === priorityFilter;
    return statusMatches && priorityMatches;
  });

  return (
    <HospitalShell
      title="Appointments"
      subtitle="Manage appointment requests with clearer priority and status handling."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Patient name
            <input name="patientName" value={form.patientName} onChange={handleChange} placeholder="Patient name" />
          </label>
          <label>
            Department
            <input name="department" value={form.department} onChange={handleChange} placeholder="Cardiology, General Medicine" />
          </label>
          <div className="seller-form-grid">
            <label>
              Contact
              <input name="contact" value={form.contact} onChange={handleChange} placeholder="10 digit number" />
            </label>
            <label>
              Preferred date
              <input name="date" type="date" value={form.date} onChange={handleChange} />
            </label>
          </div>
          <label>
            Priority
            <select name="priority" value={form.priority} onChange={handleChange}>
              <option value="Normal">Normal</option>
              <option value="Priority">Priority</option>
              <option value="Emergency">Emergency</option>
            </select>
          </label>
          <button type="submit" className="primary-button">
            Add appointment request
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="seller-product-head">
            <div className="section-title">Appointment queue</div>
            <small>{visibleAppointments.length} visible</small>
          </div>
          <div className="seller-form-grid">
            <label>
              Status filter
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Pending review">Pending review</option>
                <option value="Immediate attention">Immediate attention</option>
                <option value="Confirmed">Confirmed</option>
                <option value="In follow-up">In follow-up</option>
              </select>
            </label>
            <label>
              Priority filter
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Normal">Normal</option>
                <option value="Priority">Priority</option>
                <option value="Emergency">Emergency</option>
              </select>
            </label>
          </div>
          <div className="hospital-stack">
            {visibleAppointments.length === 0 && (
              <div className="soft-panel">
                <p className="muted-copy">No appointment requests matched your filters.</p>
              </div>
            )}
            {visibleAppointments.map((appointment) => (
              <div key={appointment.id} className="hospital-card">
                <div className="seller-product-head">
                  <h3>{appointment.patientName}</h3>
                  <span className="order-status-pill">{appointment.priority}</span>
                </div>
                <p className="muted-copy">Department: {appointment.department}</p>
                <p className="muted-copy">Date: {appointment.date || "Flexible"}</p>
                <p className="muted-copy">Contact: {appointment.contact || "Not shared"}</p>
                <p className="muted-copy">Status: {appointment.status}</p>
                <p className="muted-copy">Hospital note: {appointment.responseNote || "No internal note yet."}</p>
                <div className="timeline-row">
                  {getTimelineSteps(appointment.status).map((step, index) => (
                    <div key={step} className="timeline-step">
                      <div className={index < 2 || appointment.status === "Confirmed" || appointment.status === "In follow-up" || appointment.status === "Immediate attention" ? "timeline-dot active" : "timeline-dot"} />
                      <small>{step}</small>
                    </div>
                  ))}
                </div>
                <div className="seller-inline-actions">
                  <button className="primary-button" onClick={() => updateStatus(appointment.id, "Confirmed")}>
                    Confirm
                  </button>
                  <button className="ghost-button" onClick={() => updateStatus(appointment.id, "In follow-up")}>
                    Follow up
                  </button>
                </div>
                <label>
                  Response note
                  <textarea
                    rows="2"
                    value={responseNotes[appointment.id] ?? appointment.responseNote ?? ""}
                    onChange={(event) => handleResponseNoteChange(appointment.id, event.target.value)}
                    placeholder="Call patient after 6 PM, bring previous reports..."
                  />
                </label>
                <button className="ghost-button" onClick={() => handleSaveResponse(appointment.id)}>
                  Save response note
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </HospitalShell>
  );
}

export default HospitalAppointments;
