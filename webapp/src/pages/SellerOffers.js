import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function SellerOffers() {
  const sellerProfile = getStoredProfile("seller");
  const [products, setProducts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    discount: "10",
    productId: "",
    expiry: ""
  });

  useEffect(() => {
    const loadData = async () => {
      const shopId = localStorage.getItem("shopId") || sellerProfile?.shopId;

      if (!shopId) return;

      const [productSnapshot, offerSnapshot] = await Promise.all([
        getDocs(query(collection(db, "products"), where("shopId", "==", shopId))),
        getDocs(query(collection(db, "offers"), where("shopId", "==", shopId)))
      ]);

      setProducts(
        productSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }))
      );

      setOffers(
        offerSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }))
      );
    };

    loadData().catch((error) => {
      console.error("Failed to load offers data:", error);
    });
  }, [sellerProfile?.shopId]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product.productName])),
    [products]
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const shopId = localStorage.getItem("shopId") || sellerProfile?.shopId;

    if (!shopId) {
      alert("Seller shop not found.");
      return;
    }

    if (!form.title.trim()) {
      alert("Enter an offer title.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        shopId,
        title: form.title.trim(),
        description: form.description.trim(),
        discount: Number(form.discount) || 0,
        productId: form.productId || "",
        customProduct: "",
        image: "",
        expiry: form.expiry || "",
        createdAt: new Date()
      };

      const ref = await addDoc(collection(db, "offers"), payload);

      setOffers((current) => [{ id: ref.id, ...payload }, ...current]);
      setForm({
        title: "",
        description: "",
        discount: "10",
        productId: "",
        expiry: ""
      });
      alert("Offer created.");
    } catch (error) {
      console.error("Failed to save offer:", error);
      alert("Offer save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (offerId) => {
    const confirmed = window.confirm("Delete this offer?");

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "offers", offerId));
      setOffers((current) => current.filter((offer) => offer.id !== offerId));
    } catch (error) {
      console.error("Failed to delete offer:", error);
      alert("Could not delete offer.");
    }
  };

  return (
    <SellerShell
      title="Seller offers"
      subtitle="Create promotional offers your customers can spot quickly."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            Offer title
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Weekend medicine sale"
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              rows="4"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe the offer details"
            />
          </label>
          <div className="seller-form-grid">
            <label>
              Discount %
              <input
                name="discount"
                type="number"
                value={form.discount}
                onChange={handleChange}
              />
            </label>
            <label>
              Expiry
              <input
                name="expiry"
                type="date"
                value={form.expiry}
                onChange={handleChange}
              />
            </label>
          </div>
          <label>
            Product
            <select name="productId" value={form.productId} onChange={handleChange}>
              <option value="">General shop offer</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.productName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Create offer"}
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">Active offers</div>
            {offers.length === 0 && (
              <p className="muted-copy">Your shop does not have any offers yet.</p>
            )}
            <div className="seller-offer-stack">
              {offers.map((offer) => (
                <div key={offer.id} className="seller-offer-card">
                  <div className="seller-product-head">
                    <h3>{offer.title}</h3>
                    <span className="order-status-pill">{offer.discount}% OFF</span>
                  </div>
                  <p className="muted-copy">{offer.description || "No description added."}</p>
                  <p className="muted-copy">
                    Product: {productMap.get(offer.productId) || "Shop level offer"}
                  </p>
                  <p className="muted-copy">Expiry: {offer.expiry || "No expiry"}</p>
                  <button className="ghost-button seller-danger" onClick={() => handleDelete(offer.id)}>
                    Delete offer
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default SellerOffers;
