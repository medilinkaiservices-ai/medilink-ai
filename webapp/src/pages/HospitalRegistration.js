import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerRole } from "../utils/session";
import { createHospital } from "../utils/hospitalApi";

function HospitalRegistration() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    hospitalName: "",
    adminName: "",
    phone: "",
    city: "",
    emergencyPhone: "",
    departments: ""
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "phone" || name === "emergencyPhone"
        ? value.replace(/[^0-9]/g, "").slice(0, 10)
        : value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.hospitalName.trim() || !form.adminName.trim()) {
      alert("Enter hospital and admin details.");
      return;
    }

    if (!/^[0-9]{10}$/.test(form.phone)) {
      alert("Enter a valid 10 digit mobile number.");
      return;
    }

    const hospitalProfile = {
      name: form.adminName.trim(),
      phone: form.phone,
      hospitalName: form.hospitalName.trim(),
      city: form.city.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      departments: form.departments
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      joinedAt: new Date().toISOString()
    };

    try {
      const hospitalId = await createHospital(hospitalProfile);
      registerRole("hospital", {
        ...hospitalProfile,
        hospitalId
      });
    } catch (error) {
      console.error("Failed to create hospital:", error);
      alert("Could not create hospital now.");
      return;
    }

    navigate("/hospital/dashboard");
  };

  return (
    <div className="page-shell">
      <div className="auth-layout">
        <div>
          <div className="eyebrow">Hospital onboarding</div>
          <h1>Create your hospital workspace</h1>
          <p className="muted-copy">
            Keep hospitals separate from retail sellers so we can build trust-based,
            healthcare-specific workflows the right way.
          </p>
          <div className="feature-stack">
            <div className="soft-panel">Separate hospital dashboard and navigation.</div>
            <div className="soft-panel">Appointments, doctors and services can grow here next.</div>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Hospital name
            <input
              name="hospitalName"
              value={form.hospitalName}
              onChange={handleChange}
              placeholder="Hospital name"
              required
            />
          </label>
          <label>
            Admin name
            <input
              name="adminName"
              value={form.adminName}
              onChange={handleChange}
              placeholder="Admin or manager name"
              required
            />
          </label>
          <label>
            Mobile number
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="10 digit number"
              required
            />
          </label>
          <label>
            City
            <input
              name="city"
              value={form.city}
              onChange={handleChange}
              placeholder="City"
            />
          </label>
          <label>
            Emergency phone
            <input
              name="emergencyPhone"
              value={form.emergencyPhone}
              onChange={handleChange}
              placeholder="Emergency contact"
            />
          </label>
          <label>
            Departments
            <input
              name="departments"
              value={form.departments}
              onChange={handleChange}
              placeholder="Cardiology, Ortho, Diagnostics"
            />
          </label>
          <button type="submit" className="primary-button">
            Create hospital account
          </button>
        </form>
      </div>
    </div>
  );
}

export default HospitalRegistration;
