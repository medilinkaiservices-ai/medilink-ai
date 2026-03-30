import React, { useEffect, useState } from "react";
import HospitalShell from "../components/HospitalShell";
import { getStoredProfile } from "../utils/session";
import {
  createHospitalService,
  deleteHospitalService,
  fetchHospitalServices
} from "../utils/hospitalApi";

function HospitalServices() {
  const profile = getStoredProfile("hospital");
  const [services, setServices] = useState([]);
  const [form, setForm] = useState({
    serviceName: "",
    department: "",
    type: "",
    price: "",
    turnaround: "",
    availability: "Available",
    note: ""
  });

  useEffect(() => {
    const loadServices = async () => {
      if (!profile?.hospitalId) return;
      const list = await fetchHospitalServices(profile.hospitalId);
      setServices(list);
    };

    loadServices().catch((error) => console.error("Failed to load services:", error));
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

    if (!form.serviceName.trim() || !profile?.hospitalId) {
      alert("Enter service name.");
      return;
    }

    const nextService = {
      serviceName: form.serviceName.trim(),
      department: form.department.trim(),
      type: form.type.trim(),
      price: form.price.trim(),
      turnaround: form.turnaround.trim(),
      availability: form.availability,
      note: form.note.trim()
    };

    const serviceId = await createHospitalService(profile.hospitalId, nextService);
    setServices((current) => [{ id: serviceId, hospitalId: profile.hospitalId, ...nextService }, ...current]);
    setForm({
      serviceName: "",
      department: "",
      type: "",
      price: "",
      turnaround: "",
      availability: "Available",
      note: ""
    });
  };

  const handleDelete = async (serviceId) => {
    await deleteHospitalService(serviceId);
    setServices((current) => current.filter((service) => service.id !== serviceId));
  };

  return (
    <HospitalShell
      title="Services"
      subtitle="List diagnostics, consultations, packages and emergency support with a professional structure."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Service name
            <input name="serviceName" value={form.serviceName} onChange={handleChange} placeholder="CT Scan, ICU Bed, Ortho Consultation" />
          </label>
          <div className="seller-form-grid">
            <label>
              Department
              <input name="department" value={form.department} onChange={handleChange} placeholder="Diagnostics" />
            </label>
            <label>
              Type
              <input name="type" value={form.type} onChange={handleChange} placeholder="Scan, Package, OP" />
            </label>
          </div>
          <div className="seller-form-grid">
            <label>
              Price
              <input name="price" value={form.price} onChange={handleChange} placeholder="1500" />
            </label>
            <label>
              Turnaround
              <input name="turnaround" value={form.turnaround} onChange={handleChange} placeholder="Same day" />
            </label>
          </div>
          <div className="seller-form-grid">
            <label>
              Availability
              <select name="availability" value={form.availability} onChange={handleChange}>
                <option value="Available">Available</option>
                <option value="Limited">Limited</option>
                <option value="By appointment">By appointment</option>
              </select>
            </label>
            <label>
              Service note
              <input name="note" value={form.note} onChange={handleChange} placeholder="Pre-booking required" />
            </label>
          </div>
          <button type="submit" className="primary-button">
            Add service
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="section-title">Published services</div>
          <div className="hospital-stack">
            {services.length === 0 && (
              <div className="soft-panel">
                <p className="muted-copy">No services listed yet.</p>
              </div>
            )}
            {services.map((service) => (
              <div key={service.id} className="hospital-card">
                <div className="seller-product-head">
                  <h3>{service.serviceName}</h3>
                  <span className="order-status-pill">{service.type || "Service"}</span>
                </div>
                <p className="muted-copy">Department: {service.department || "General"}</p>
                <p className="muted-copy">Price: {service.price ? `Rs. ${service.price}` : "Contact hospital"}</p>
                <p className="muted-copy">Turnaround: {service.turnaround || "Not set"}</p>
                <p className="muted-copy">Availability: {service.availability || "Available"}</p>
                <p className="muted-copy">Note: {service.note || "No extra note"}</p>
                <button className="ghost-button seller-danger" onClick={() => handleDelete(service.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </HospitalShell>
  );
}

export default HospitalServices;
