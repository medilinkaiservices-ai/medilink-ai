import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "firebase/firestore";
import { registerRole } from "../utils/session";

function SellerRegistration({ sellerId, onRegistered }) {
  const navigate = useNavigate();
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState([]);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const snapshot = await getDocs(collection(db, "categories"));

        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

        setCategories(list);
      } catch (error) {
        console.error("Category load error", error);
      }
    };

    loadCategories();
  }, []);

  const getCurrentLocation = () => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ latitude: null, longitude: null });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
          });
        },
        (error) => {
          console.error("Location error:", error);
          resolve({ latitude: null, longitude: null });
        }
      );
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const cleanShopName = shopName.trim();
    const cleanOwnerName = ownerName.trim();
    const cleanPhone = phone.trim();
    const cleanAddress = address.trim();
    const cleanCity = city.trim();
    const cleanDescription = description.trim();
    const cleanLocation = location.trim();

    if (!cleanShopName) return alert("Shop name is required.");
    if (!cleanOwnerName) return alert("Owner name is required.");

    if (!/^[0-9]{10}$/.test(cleanPhone)) {
      return alert("Phone must be 10 digits.");
    }

    if (!categoryId) {
      return alert("Select category.");
    }

    try {
      setLoading(true);

      if (sellerId) {
        const existing = await getDocs(
          query(
            collection(db, "sellers"),
            where("ownerUid", "==", sellerId),
            where("shopName", "==", cleanShopName)
          )
        );

        if (!existing.empty) {
          alert("You already created this shop.");
          setLoading(false);
          return;
        }
      }

      const { latitude, longitude } = await getCurrentLocation();

      const sellerRef = await addDoc(collection(db, "sellers"), {
        ownerUid: sellerId || "guest",
        shopName: cleanShopName,
        shopNameLower: cleanShopName.toLowerCase(),
        ownerName: cleanOwnerName,
        ownerPhone: cleanPhone,
        categoryId: categoryId || "",
        address: cleanAddress,
        city: cleanCity,
        description: cleanDescription,
        locationLink: cleanLocation || null,
        latitude,
        longitude,
        shopImageUrl: "",
        isVerified: false,
        isActive: true,
        orderEnabled: true,
        createdAt: serverTimestamp()
      });

      registerRole("seller", {
        name: cleanOwnerName,
        phone: cleanPhone,
        shopName: cleanShopName,
        city: cleanCity,
        categoryId,
        shopId: sellerRef.id
      });

      localStorage.setItem("shopId", sellerRef.id);

      setShopName("");
      setOwnerName("");
      setPhone("");
      setCategoryId("");
      setAddress("");
      setCity("");
      setDescription("");
      setLocation("");

      if (onRegistered) onRegistered();

      alert("Shop registered successfully.");
      navigate("/seller/dashboard");
    } catch (error) {
      console.error("Registration error:", error);
      alert("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="auth-layout">
        <div>
          <div className="eyebrow">Seller onboarding</div>
          <h1>Create your seller page</h1>
          <p className="muted-copy">
            Register as a seller even if the same mobile number is already being
            used as a customer. Both roles can live under the same account flow.
          </p>
          <div className="feature-stack">
            <div className="soft-panel">Dedicated seller dashboard after registration.</div>
            <div className="soft-panel">Shop profile, products, orders and offers can grow here.</div>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Shop Name"
            value={shopName}
            onChange={(event) => setShopName(event.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Owner Name"
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Phone Number"
            value={phone}
            maxLength="10"
            onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, ""))}
            required
          />

          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          >
            <option value="">Select Category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Full Address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
          />

          <input
            type="text"
            placeholder="City"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            required
          />

          <textarea
            placeholder="Shop Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows="3"
            required
          />

          <input
            type="url"
            placeholder="Google Maps Location (optional)"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />

          <button type="submit" disabled={loading} className="primary-button">
            {loading ? "Registering..." : "Register Shop"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SellerRegistration;
