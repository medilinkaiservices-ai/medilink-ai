import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import Chatbot from "../components/Chatbot";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import {
  getStoredAccount,
  getStoredProfile,
  mergeStoredAccount,
  saveStoredProfile
} from "../utils/session";

function SellerShopProfile() {
  const account = getStoredAccount();
  const initialProfile = getStoredProfile("seller");
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [shopProducts, setShopProducts] = useState([]);
  const [shopOffers, setShopOffers] = useState([]);
  const [form, setForm] = useState({
    shopName: initialProfile?.shopName || "",
    name: initialProfile?.name || "",
    phone: initialProfile?.phone || "",
    city: initialProfile?.city || "",
    categoryId: initialProfile?.categoryId || "",
    description: initialProfile?.description || ""
  });
  useEffect(() => {
    const fetchSellerData = async () => {
      if (!initialProfile?.shopId) return;

      try {
        const [productSnapshot, offerSnapshot] = await Promise.all([
          getDocs(query(collection(db, "products"), where("shopId", "==", initialProfile.shopId))),
          getDocs(query(collection(db, "offers"), where("shopId", "==", initialProfile.shopId))),
        ]);

        setShopProducts(productSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setShopOffers(offerSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      } catch (error) {
        console.error("Failed to load seller chatbot context:", error);
        setShopProducts([]);
        setShopOffers([]);
      }
    };

    fetchSellerData();
  }, [initialProfile?.shopId]);

  const sellerContext = {
    shopName: profile?.shopName || form.shopName || "Your Shop",
    products: shopProducts.map((product) => ({
      name: product.productName || "Unnamed product",
      price: product.price ?? "N/A",
      availability: product.quantity > 0 ? "In Stock" : "Out of Stock",
    })),
    offers: shopOffers.length
      ? shopOffers.map((offer) => `${offer.title} (${offer.discount}% off)`).join(", ")
      : profile?.description || form.description || "No active offers.",
    availability: profile?.orderEnabled ? "Accepting orders" : "Orders paused",
    city: profile?.city || form.city || "",
    description: profile?.description || form.description || "",
  };

  if (!account) {
    return <Navigate to="/login" replace />;
  }

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
            <div className="eyebrow">Current shop view</div>
            <h3>{form.shopName || profile?.shopName || "Shop name"}</h3>
            <p className="muted-copy">
              Owner: {form.name || profile?.name || "Owner"}<br />
              Phone: {form.phone || profile?.phone || "Phone"}<br />
              City: {form.city || profile?.city || "City"}
            </p>
          </div>
          <div className="soft-panel">
            <div className="section-title">Shop summary</div>
            <p className="muted-copy">
              Category: {form.categoryId || profile?.categoryId || "Not added"}<br />
              Status: {profile?.orderEnabled === false ? "Orders paused" : "Orders active"}<br />
              Description: {form.description || profile?.description || "Add a short shop description"}
            </p>
          </div>
        </div>
      </div>
      <Chatbot role="shop" contextData={sellerContext} floating />
    </SellerShell>
  );
}

export default SellerShopProfile;
