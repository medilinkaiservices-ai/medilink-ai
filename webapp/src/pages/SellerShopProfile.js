import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import {
  getStoredProfile,
  mergeStoredAccount,
  saveStoredProfile
} from "../utils/session";

function SellerShopProfile() {
  const initialProfile = getStoredProfile("seller");
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    shopName: initialProfile?.shopName || "",
    name: initialProfile?.name || "",
    phone: initialProfile?.phone || "",
    city: initialProfile?.city || "",
    categoryId: initialProfile?.categoryId || "",
    description: initialProfile?.description || ""
  });

  if (!initialProfile) {
    return <Navigate to="/register/seller" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "phone" ? value.replace(/[^0-9]/g, "").slice(0, 10) : value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!profile?.shopId) {
      alert("Seller shop id missing. Please register seller again.");
      return;
    }

    const nextProfile = {
      ...profile,
      ...form,
      phone: form.phone.trim()
    };

    try {
      setSaving(true);

      await updateDoc(doc(db, "sellers", profile.shopId), {
        shopName: nextProfile.shopName,
        shopNameLower: nextProfile.shopName.toLowerCase(),
        ownerName: nextProfile.name,
        ownerPhone: nextProfile.phone,
        city: nextProfile.city,
        categoryId: nextProfile.categoryId || "",
        description: nextProfile.description || ""
      });

      saveStoredProfile("seller", nextProfile);
      mergeStoredAccount({ name: nextProfile.name, phone: nextProfile.phone });
      setProfile(nextProfile);
      alert("Seller profile saved to Firebase.");
    } catch (error) {
      console.error("Failed to save seller profile:", error);
      alert("Could not save seller profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SellerShell
      title="Shop profile"
      subtitle="Keep seller identity, shop details and future business settings in one place."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Shop name
            <input
              name="shopName"
              value={form.shopName}
              onChange={handleChange}
              placeholder="Your shop name"
            />
          </label>
          <label>
            Owner name
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Owner name"
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="10 digit number"
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
            Category id
            <input
              name="categoryId"
              value={form.categoryId}
              onChange={handleChange}
              placeholder="Category id"
            />
          </label>
          <label>
            About shop
            <textarea
              name="description"
              rows="4"
              value={form.description}
              onChange={handleChange}
              placeholder="Tell customers about your store"
            />
          </label>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Save seller profile"}
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Preview</div>
            <h3>{profile?.shopName || "Shop name"}</h3>
            <p className="muted-copy">
              Owner: {profile?.name || "Owner"}<br />
              Phone: {profile?.phone || "Phone"}<br />
              City: {profile?.city || "City"}
            </p>
          </div>
          <div className="soft-panel">
            <div className="section-title">What we can add next</div>
            <p className="muted-copy">
              Shop timings, delivery radius, WhatsApp order preferences, holiday mode
              and verification settings can all fit into this profile page next.
            </p>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default SellerShopProfile;
