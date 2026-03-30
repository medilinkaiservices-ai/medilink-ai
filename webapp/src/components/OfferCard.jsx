import React, { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { useParams } from "react-router-dom";
import { db } from "../firebase";

function OfferCard({ isOwner, products = [] }) {
  const { shopId } = useParams();
  const [offers, setOffers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!shopId) return;

    const loadOffers = async () => {
      const result = await getDocs(query(collection(db, "offers"), where("shopId", "==", shopId)));
      setOffers(result.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    };

    loadOffers();
  }, [shopId]);

  const addOffer = () => {
    const newOffer = {
      id: Date.now(),
      title: "Limited-time offer",
      description: "Describe the offer, who it is for and why customers should act now.",
      discount: 20,
      productId: "",
      customProduct: "",
      image: "",
      expiry: ""
    };

    setOffers((current) => [...current, newOffer]);
    setEditingId(newOffer.id);
  };

  const handleChange = (id, field, value) => {
    setOffers((current) => current.map((offer) => (offer.id === id ? { ...offer, [field]: value } : offer)));
  };

  const handleImage = (id, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setOffers((current) => current.map((offer) => (offer.id === id ? { ...offer, image: reader.result } : offer)));
    };
    reader.readAsDataURL(file);
  };

  const saveOffer = async (offer) => {
    await addDoc(collection(db, "offers"), {
      shopId,
      title: offer.title,
      description: offer.description,
      discount: Number(offer.discount || 0),
      productId: offer.productId,
      customProduct: offer.customProduct,
      image: offer.image,
      expiry: offer.expiry,
      createdAt: new Date()
    });

    setEditingId(null);
  };

  const shareWhatsApp = (offer) => {
    const text = `Offer: ${offer.title}\n${offer.description}\n\nVisit: ${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const copyLink = (offer) => {
    navigator.clipboard.writeText(`${offer.title} - ${window.location.href}`);
    alert("Offer link copied.");
  };

  const getRemainingTime = (expiry) => {
    if (!expiry) return "Open-ended";
    const end = new Date(expiry).getTime();
    const distance = end - Date.now();
    if (distance <= 0) return "Expired";
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    return `${days}d ${hours}h ${minutes}m left`;
  };

  const today = new Date().toISOString().split("T")[0];
  const activeOffers = useMemo(() => offers.filter((offer) => !offer.expiry || offer.expiry >= today), [offers, today]);

  return (
    <div className="offer-card-shell">
      <div className="offer-card-headline">
        <div>
          <div className="eyebrow">Campaign board</div>
          <h3>Live shop offers</h3>
        </div>
        {isOwner && <button onClick={addOffer} className="primary-button">Create offer</button>}
      </div>

      <div className="offer-card-grid">
        {activeOffers.map((offer) => {
          const productName = offer.productId === "other"
            ? offer.customProduct
            : products.find((product) => product.id === offer.productId)?.productName;
          const isEditing = editingId === offer.id;

          return (
            <div key={offer.id} className="offer-premium-card">
              <div className="offer-premium-topbar">
                <span className="offer-premium-pill">{offer.discount || 0}% OFF</span>
                <span className="offer-premium-expiry">{getRemainingTime(offer.expiry)}</span>
              </div>

              {isEditing ? (
                <div className="offer-editor-grid">
                  <input value={offer.title} onChange={(event) => handleChange(offer.id, "title", event.target.value)} />
                  <textarea rows="4" value={offer.description} onChange={(event) => handleChange(offer.id, "description", event.target.value)} />
                  <div className="seller-form-grid">
                    <input type="number" value={offer.discount} onChange={(event) => handleChange(offer.id, "discount", event.target.value)} placeholder="Discount %" />
                    <input type="date" value={offer.expiry} onChange={(event) => handleChange(offer.id, "expiry", event.target.value)} />
                  </div>
                  <select value={offer.productId} onChange={(event) => handleChange(offer.id, "productId", event.target.value)}>
                    <option value="">Select product</option>
                    <option value="other">Custom offer</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                  </select>
                  {offer.productId === "other" && <input value={offer.customProduct} onChange={(event) => handleChange(offer.id, "customProduct", event.target.value)} placeholder="Custom product or combo name" />}
                  <input type="file" accept="image/*" onChange={(event) => handleImage(offer.id, event.target.files?.[0])} />
                  <div className="seller-inline-actions">
                    <button onClick={() => saveOffer(offer)} className="primary-button">Save offer</button>
                    <button onClick={() => setEditingId(null)} className="ghost-button">Done</button>
                  </div>
                </div>
              ) : (
                <>
                  {offer.image ? <img src={offer.image} alt={offer.title} className="offer-premium-image" /> : null}
                  <h4>{offer.title}</h4>
                  <p className="muted-copy">{offer.description}</p>
                  <div className="offer-premium-meta">
                    {productName ? <span>Product: {productName}</span> : null}
                    {offer.expiry ? <span>Ends on {offer.expiry}</span> : <span>No expiry date</span>}
                  </div>
                  <div className="seller-inline-actions">
                    <button onClick={() => shareWhatsApp(offer)} className="header-pill">Share on WhatsApp</button>
                    <button onClick={() => copyLink(offer)} className="ghost-button">Copy offer link</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OfferCard;
