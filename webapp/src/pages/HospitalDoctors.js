import React, { useEffect, useState } from "react";
import HospitalShell from "../components/HospitalShell";
import { getStoredProfile } from "../utils/session";
import {
  createHospitalDoctor,
  deleteHospitalDoctor,
  fetchHospitalDoctors
} from "../utils/hospitalApi";

function HospitalDoctors() {
  const profile = getStoredProfile("hospital");
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({
    name: "",
    specialty: "",
    experience: "",
    timing: "",
    fee: "",
    qualification: "",
    consultationMode: "In-person"
  });

  useEffect(() => {
    const loadDoctors = async () => {
      if (!profile?.hospitalId) return;
      const list = await fetchHospitalDoctors(profile.hospitalId);
      setDoctors(list);
    };

    loadDoctors().catch((error) => console.error("Failed to load doctors:", error));
  }, [profile?.hospitalId]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.specialty.trim() || !profile?.hospitalId) {
      alert("Enter doctor name and specialty.");
      return;
    }

    const nextDoctor = {
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      experience: form.experience.trim(),
      timing: form.timing.trim(),
      fee: form.fee.trim(),
      qualification: form.qualification.trim(),
      consultationMode: form.consultationMode
    };

    const doctorId = await createHospitalDoctor(profile.hospitalId, nextDoctor);
    setDoctors((current) => [{ id: doctorId, hospitalId: profile.hospitalId, ...nextDoctor }, ...current]);
    setForm({
      name: "",
      specialty: "",
      experience: "",
      timing: "",
      fee: "",
      qualification: "",
      consultationMode: "In-person"
    });
  };

  const handleDelete = async (doctorId) => {
    await deleteHospitalDoctor(doctorId);
    setDoctors((current) => current.filter((doctor) => doctor.id !== doctorId));
  };

  return (
    <HospitalShell
      title="Doctors"
      subtitle="Create a professional doctor roster with specialization, timing and consultation info."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Doctor name
            <input name="name" value={form.name} onChange={handleChange} placeholder="Dr. Name" />
          </label>
          <label>
            Specialty
            <input name="specialty" value={form.specialty} onChange={handleChange} placeholder="Cardiology, Orthopedics" />
          </label>
          <div className="seller-form-grid">
            <label>
              Experience
              <input name="experience" value={form.experience} onChange={handleChange} placeholder="12 years" />
            </label>
            <label>
              Consultation fee
              <input name="fee" value={form.fee} onChange={handleChange} placeholder="500" />
            </label>
          </div>
          <div className="seller-form-grid">
            <label>
              Qualification
              <input name="qualification" value={form.qualification} onChange={handleChange} placeholder="MBBS, MD" />
            </label>
            <label>
              Consultation mode
              <select name="consultationMode" value={form.consultationMode} onChange={handleChange}>
                <option value="In-person">In-person</option>
                <option value="Online and in-person">Online and in-person</option>
                <option value="Online only">Online only</option>
              </select>
            </label>
          </div>
          <label>
            Timings
            <input name="timing" value={form.timing} onChange={handleChange} placeholder="9:00 AM - 1:00 PM" />
          </label>
          <button type="submit" className="primary-button">
            Add doctor
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">Doctor roster</div>
            {doctors.length === 0 && <p className="muted-copy">No doctors added yet.</p>}
            <div className="hospital-stack">
              {doctors.map((doctor) => (
                <div key={doctor.id} className="hospital-card">
                  <div className="seller-product-head">
                    <h3>{doctor.name}</h3>
                    <span className="order-status-pill">{doctor.specialty}</span>
                  </div>
                  <p className="muted-copy">Experience: {doctor.experience || "Not set"}</p>
                  <p className="muted-copy">Qualification: {doctor.qualification || "Not set"}</p>
                  <p className="muted-copy">Timings: {doctor.timing || "Not set"}</p>
                  <p className="muted-copy">Fee: {doctor.fee ? `Rs. ${doctor.fee}` : "Not set"}</p>
                  <p className="muted-copy">Mode: {doctor.consultationMode || "In-person"}</p>
                  <button className="ghost-button seller-danger" onClick={() => handleDelete(doctor.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </HospitalShell>
  );
}

export default HospitalDoctors;
