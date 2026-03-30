import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import HospitalShell from "../components/HospitalShell";
import { getStoredProfile, saveStoredProfile } from "../utils/session";
import { updateHospitalProfile } from "../utils/hospitalApi";

function HospitalProfile() {
  const initialProfile = getStoredProfile("hospital");
  const [profile, setProfile] = useState(initialProfile);
  const [form, setForm] = useState({
    hospitalName: initialProfile?.hospitalName || "",
    name: initialProfile?.name || "",
    phone: initialProfile?.phone || "",
    city: initialProfile?.city || "",
    emergencyPhone: initialProfile?.emergencyPhone || "",
    address: initialProfile?.address || "",
    openTime: initialProfile?.openTime || "",
    closeTime: initialProfile?.closeTime || "",
    alwaysOpen: Boolean(initialProfile?.alwaysOpen),
    ambulanceAvailable: Boolean(initialProfile?.ambulanceAvailable),
    departments: (initialProfile?.departments || []).join(", "),
    about: initialProfile?.about || ""
  });

  if (!initialProfile) {
    return <Navigate to="/register/hospital" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]:
        name === "alwaysOpen" || name === "ambulanceAvailable"
          ? event.target.checked
          : name === "phone" || name === "emergencyPhone"
            ? value.replace(/[^0-9]/g, "").slice(0, 10)
            : value
    }));
  };

  const nextProfileFromForm = () => ({
    ...profile,
    hospitalName: form.hospitalName.trim(),
    name: form.name.trim(),
    phone: form.phone.trim(),
    city: form.city.trim(),
    emergencyPhone: form.emergencyPhone.trim(),
    address: form.address.trim(),
    openTime: form.openTime,
    closeTime: form.closeTime,
    alwaysOpen: Boolean(form.alwaysOpen),
    ambulanceAvailable: Boolean(form.ambulanceAvailable),
    departments: form.departments.split(",").map((item) => item.trim()).filter(Boolean),
    about: form.about.trim(),
    integrationConfig: profile?.integrationConfig || initialProfile?.integrationConfig
  });

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextProfile = nextProfileFromForm();

    try {
      if (!nextProfile.hospitalId) {
        alert("Hospital id missing. Please register again.");
        return;
      }

      await updateHospitalProfile(nextProfile.hospitalId, nextProfile);
      saveStoredProfile("hospital", nextProfile);
      setProfile(nextProfile);
      alert("Hospital profile saved.");
    } catch (error) {
      console.error("Failed to save hospital profile:", error);
      alert("Could not save hospital profile.");
    }
  };

  const profilePreview = nextProfileFromForm();

  return (
    <HospitalShell
      title="Hospital profile"
      subtitle="Keep hospital identity, contacts and department structure in one place."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Hospital name
            <input name="hospitalName" value={form.hospitalName} onChange={handleChange} />
          </label>
          <label>
            Admin name
            <input name="name" value={form.name} onChange={handleChange} />
          </label>
          <label>
            Main phone
            <input name="phone" value={form.phone} onChange={handleChange} />
          </label>
          <label>
            Emergency phone
            <input name="emergencyPhone" value={form.emergencyPhone} onChange={handleChange} />
          </label>
          <label>
            Address
            <input name="address" value={form.address} onChange={handleChange} placeholder="Full hospital address" />
          </label>
          <div className="seller-form-grid">
            <label>
              Open time
              <input name="openTime" type="time" value={form.openTime} onChange={handleChange} />
            </label>
            <label>
              Close time
              <input name="closeTime" type="time" value={form.closeTime} onChange={handleChange} />
            </label>
          </div>
          <label>
            City
            <input name="city" value={form.city} onChange={handleChange} />
          </label>
          <label>
            Departments
            <input
              name="departments"
              value={form.departments}
              onChange={handleChange}
              placeholder="Cardiology, Ortho"
            />
          </label>
          <label>
            About hospital
            <textarea name="about" rows="4" value={form.about} onChange={handleChange} />
          </label>
          <label className="seller-check-row">
            <input
              name="alwaysOpen"
              type="checkbox"
              checked={form.alwaysOpen}
              onChange={handleChange}
            />
            24/7 hospital
          </label>
          <label className="seller-check-row">
            <input
              name="ambulanceAvailable"
              type="checkbox"
              checked={form.ambulanceAvailable}
              onChange={handleChange}
            />
            Ambulance available
          </label>
          <button type="submit" className="primary-button">
            Save hospital profile
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Hospital preview</div>
            <h3>{profilePreview.hospitalName || "Hospital name"}</h3>
            <p className="muted-copy">
              Admin: {profilePreview.name || "Admin"}<br />
              Phone: {profilePreview.phone || "Phone"}<br />
              Emergency: {profilePreview.emergencyPhone || "Emergency phone"}<br />
              Address: {profilePreview.address || "Address"}<br />
              Timings: {profilePreview.alwaysOpen ? "Open 24/7" : `${profilePreview.openTime || "--"} to ${profilePreview.closeTime || "--"}`}
            </p>
          </div>
          <div className="soft-panel">
            <div className="section-title">Readiness</div>
            <div className="list-row">
              <span>Ambulance support</span>
              <small>{profilePreview.ambulanceAvailable ? "Available" : "Not listed"}</small>
            </div>
            <div className="list-row">
              <span>Departments</span>
              <small>{profilePreview.departments.length}</small>
            </div>
          </div>
        </div>
      </div>
    </HospitalShell>
  );
}
export default HospitalProfile;
