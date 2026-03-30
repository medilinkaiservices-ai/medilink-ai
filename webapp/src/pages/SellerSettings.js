import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile, saveStoredProfile } from "../utils/session";

function SellerSettings() {
  const initialProfile = getStoredProfile("seller");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    whatsappPhone: initialProfile?.whatsappPhone || initialProfile?.phone || "",
    openTime: initialProfile?.openTime || "08:00",
    closeTime: initialProfile?.closeTime || "21:00",
    deliveryRadius: initialProfile?.deliveryRadius || "5",
    orderEnabled:
      initialProfile?.orderEnabled === undefined ? true : Boolean(initialProfile.orderEnabled),
    holidayMode: Boolean(initialProfile?.holidayMode)
  });

  if (!initialProfile) {
    return <Navigate to="/register/seller" replace />;
  }

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((current) => ({
      ...current,
      [name]:
        type === "checkbox"
          ? checked
          : name === "whatsappPhone"
            ? value.replace(/[^0-9]/g, "").slice(0, 10)
            : value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setSaving(true);

      const nextProfile = {
        ...initialProfile,
        ...form
      };

      await updateDoc(doc(db, "sellers", initialProfile.shopId), {
        whatsappPhone: nextProfile.whatsappPhone,
        openTime: nextProfile.openTime,
        closeTime: nextProfile.closeTime,
        deliveryRadius: Number(nextProfile.deliveryRadius || 0),
        orderEnabled: nextProfile.orderEnabled,
        holidayMode: nextProfile.holidayMode
      });

      saveStoredProfile("seller", nextProfile);
      alert("Seller settings saved.");
    } catch (error) {
      console.error("Failed to save seller settings:", error);
      alert("Could not save seller settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SellerShell
      title="Seller settings"
      subtitle="Control shop timings, order availability and WhatsApp order preferences."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            WhatsApp order number
            <input
              name="whatsappPhone"
              value={form.whatsappPhone}
              onChange={handleChange}
              placeholder="10 digit WhatsApp number"
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Open time
              <input
                name="openTime"
                type="time"
                value={form.openTime}
                onChange={handleChange}
              />
            </label>
            <label>
              Close time
              <input
                name="closeTime"
                type="time"
                value={form.closeTime}
                onChange={handleChange}
              />
            </label>
            <label>
              Delivery radius (km)
              <input
                name="deliveryRadius"
                type="number"
                value={form.deliveryRadius}
                onChange={handleChange}
              />
            </label>
          </div>

          <label className="seller-check-row">
            <input
              name="orderEnabled"
              type="checkbox"
              checked={form.orderEnabled}
              onChange={handleChange}
            />
            Accept orders from customers
          </label>

          <label className="seller-check-row">
            <input
              name="holidayMode"
              type="checkbox"
              checked={form.holidayMode}
              onChange={handleChange}
            />
            Holiday mode
          </label>

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">Current shop operations</div>
            <p className="muted-copy">
              WhatsApp: {form.whatsappPhone || "Not set"}
            </p>
            <p className="muted-copy">
              Timings: {form.openTime} to {form.closeTime}
            </p>
            <p className="muted-copy">
              Delivery radius: {form.deliveryRadius} km
            </p>
            <p className="muted-copy">
              Orders: {form.orderEnabled ? "Enabled" : "Paused"}
            </p>
            <p className="muted-copy">
              Holiday mode: {form.holidayMode ? "On" : "Off"}
            </p>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default SellerSettings;
