import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { createHospitalAppointment, fetchHospitals } from "../utils/hospitalApi";
import { getStoredProfile } from "../utils/session";

function HospitalAppointmentBooking() {
  const { hospitalId } = useParams();
  const customer = getStoredProfile("customer");
  const [hospital, setHospital] = useState(undefined);
  const [form, setForm] = useState({
    patientName: customer?.name || "",
    contact: customer?.phone || "",
    department: "",
    date: "",
    priority: "Normal",
    note: ""
  });

  useEffect(() => {
    const loadHospital = async () => {
      const hospitals = await fetchHospitals();
      const match = hospitals.find((item) => item.id === hospitalId);
      setHospital(match || null);
    };

    loadHospital().catch((error) => {
      console.error("Failed to load hospital:", error);
      setHospital(null);
    });
  }, [hospitalId]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: name === "contact" ? value.replace(/[^0-9]/g, "").slice(0, 10) : value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!hospital || !form.patientName.trim() || !form.department.trim()) {
      alert("Please enter patient name and department.");
      return;
    }

    try {
      await createHospitalAppointment({
        hospitalId: hospital.id,
        hospitalName: hospital.hospitalName,
        patientName: form.patientName.trim(),
        bookedByName: customer?.name || form.patientName.trim(),
        bookedByPhone: customer?.phone || form.contact.trim(),
        contact: form.contact.trim(),
        department: form.department.trim(),
        date: form.date,
        priority: form.priority,
        note: form.note.trim(),
        status: form.priority === "Emergency" ? "Immediate attention" : "Pending review"
      });

      alert("Appointment request submitted.");
      setForm((current) => ({ ...current, department: "", date: "", priority: "Normal", note: "" }));
    } catch (error) {
      console.error("Failed to submit appointment:", error);
      alert("Could not submit appointment.");
    }
  };

  if (hospital === null) return <Navigate to="/hospitals" replace />;
  if (hospital === undefined) return <div className="page-shell"><div className="soft-panel">Loading hospital...</div></div>;

  return (
    <div className="page-shell hospital-booking-shell">
      <section className="account-hero hospital-booking-hero">
        <div>
          <div className="eyebrow">Appointment booking</div>
          <h1>Book with {hospital.hospitalName}</h1>
          <p className="muted-copy">Submit a clean appointment request for department-based follow-up and hospital review.</p>
        </div>
        <div className="identity-card hospital-booking-summary">
          <div className="identity-label">Hospital</div>
          <div className="identity-value">{hospital.hospitalName}</div>
          <div className="identity-label">City</div>
          <div className="identity-value">{hospital.city || "Not set"}</div>
          <div className="identity-label">Emergency</div>
          <div className="identity-value">{hospital.emergencyPhone || "Not set"}</div>
        </div>
      </section>

      <div className="seller-two-column hospital-booking-grid">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>Patient name<input name="patientName" value={form.patientName} onChange={handleChange} /></label>
          <label>Contact number<input name="contact" value={form.contact} onChange={handleChange} /></label>
          <label>Department<input name="department" value={form.department} onChange={handleChange} placeholder="Cardiology, General Medicine" /></label>
          <div className="seller-form-grid">
            <label>Preferred date<input name="date" type="date" value={form.date} onChange={handleChange} /></label>
            <label>Priority<select name="priority" value={form.priority} onChange={handleChange}><option value="Normal">Normal</option><option value="Priority">Priority</option><option value="Emergency">Emergency</option></select></label>
          </div>
          <label>Note<textarea name="note" rows="4" value={form.note} onChange={handleChange} placeholder="Symptoms or request note" /></label>
          <button type="submit" className="primary-button">Submit request</button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel hospital-booking-help">
            <div className="section-title">Booking guidance</div>
            <p className="muted-copy">Use emergency priority only for urgent situations. For regular visits, choose normal or priority and mention symptoms clearly.</p>
            <div className="account-actions">
              <Link className="header-link" to={`/hospitals/${encodeURIComponent(hospital.id)}`}>View hospital profile</Link>
              <Link className="header-link" to="/customer/account">Back to account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HospitalAppointmentBooking;
