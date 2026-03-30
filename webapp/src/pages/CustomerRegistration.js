import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerRole } from "../utils/session";

function CustomerRegistration() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    area: ""
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "phone" ? value.replace(/[^0-9]/g, "").slice(0, 10) : value
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      alert("Enter customer name.");
      return;
    }

    if (!/^[0-9]{10}$/.test(form.phone)) {
      alert("Enter a valid 10 digit mobile number.");
      return;
    }

    registerRole("customer", {
      name: form.name.trim(),
      phone: form.phone,
      email: form.email.trim(),
      area: form.area.trim(),
      joinedAt: new Date().toISOString()
    });

    navigate("/customer/account");
  };

  return (
    <div className="page-shell">
      <div className="auth-layout">
        <div>
          <div className="eyebrow">Customer onboarding</div>
          <h1>Create your customer account</h1>
          <p className="muted-copy">
            Register once and we can keep building your customer features here:
            account, addresses, orders, khatha and faster repeat shopping.
          </p>
          <div className="feature-stack">
            <div className="soft-panel">
              Same number can work for both customer and seller roles.
            </div>
            <div className="soft-panel">
              Your customer page becomes the base for future features.
            </div>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Full name
            <input
              name="name"
              type="text"
              placeholder="Enter your name"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Mobile number
            <input
              name="phone"
              type="text"
              placeholder="10 digit number"
              value={form.phone}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              placeholder="Optional email"
              value={form.email}
              onChange={handleChange}
            />
          </label>
          <label>
            Area / locality
            <input
              name="area"
              type="text"
              placeholder="Your locality"
              value={form.area}
              onChange={handleChange}
            />
          </label>
          <button type="submit" className="primary-button">
            Create customer account
          </button>
        </form>
      </div>
    </div>
  );
}

export default CustomerRegistration;
