import React, { useState, useEffect } from "react";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useParams } from "react-router-dom";

function OfferCard({ isOwner, products = [] }) {

  const { shopId } = useParams();

  const [offers, setOffers] = useState([]);
  const [editingId, setEditingId] = useState(null);

  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  /* LOAD OFFERS */

  useEffect(() => {

    if (!shopId) return;

    const loadOffers = async () => {

      const q = query(
        collection(db, "offers"),
        where("shopId", "==", shopId)
      );

      const snapshot = await getDocs(q);

      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setOffers(list);

    };

    loadOffers();

  }, [shopId]);

  /* ADD OFFER */

  const addOffer = () => {

    const newOffer = {
      id: Date.now(),
      title: "New Offer",
      description: "",
      discount: 20,
      productId: "",
      customProduct: "",
      image: "",
      expiry: ""
    };

    setOffers([...offers, newOffer]);
    setEditingId(newOffer.id);

  };

  

  const handleChange = (id, field, value) => {

    setOffers(
      offers.map(o =>
        o.id === id ? { ...o, [field]: value } : o
      )
    );

  };

  const handleImage = (id, file) => {

    const reader = new FileReader();

    reader.onload = () => {

      setOffers(
        offers.map(o =>
          o.id === id ? { ...o, image: reader.result } : o
        )
      );

    };

    reader.readAsDataURL(file);

  };

  /* SAVE OFFER */

  const saveOffer = async (offer) => {

    await addDoc(collection(db, "offers"), {
      shopId: shopId,
      title: offer.title,
      description: offer.description,
      discount: offer.discount,
      productId: offer.productId,
      customProduct: offer.customProduct,
      image: offer.image,
      expiry: offer.expiry,
      createdAt: new Date()
    });

    setEditingId(null);

  };

  const shareWhatsApp = (offer) => {

    const text = `🔥 ${offer.title}
${offer.description}

Visit Shop:
${window.location.href}`;

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, "_blank");

  };

  const copyLink = () => {

    navigator.clipboard.writeText(window.location.href);
    alert("Link copied!");

  };

  const getRemainingTime = (expiry) => {

    if (!expiry) return "";

    const end = new Date(expiry).getTime();
    const now = new Date().getTime();

    const distance = end - now;

    if (distance <= 0) return "Expired";

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));

    const hours = Math.floor(
      (distance % (1000 * 60 * 60 * 24)) /
      (1000 * 60 * 60)
    );

    const minutes = Math.floor(
      (distance % (1000 * 60 * 60)) /
      (1000 * 60)
    );

    return `${days}d ${hours}h ${minutes}m`;

  };

  const today = new Date().toISOString().split("T")[0];

  const activeOffers = offers.filter(
    o => !o.expiry || o.expiry >= today
  );

  return (

    <div>

      {isOwner && (

        <button
          onClick={addOffer}
          style={{
            marginBottom: "15px",
            padding: "8px 14px",
            background: "#4e73df",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer"
          }}
        >
          + Add Offer
        </button>

      )}

      {activeOffers.map((offer) => {

        const productName =
          offer.productId === "other"
            ? offer.customProduct
            : products.find(p => p.id === offer.productId)?.productName;

        return (

          <div
            key={offer.id}
            style={{
              background: "linear-gradient(135deg,#ff416c,#ff4b2b)",
              color: "white",
              padding: "14px",
              borderRadius: "12px",
              marginBottom: "15px",
              maxWidth: "420px",
              fontSize: "14px",
              position: "relative"
            }}
          >

            <div
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                background: "white",
                color: "#ff416c",
                padding: "4px 10px",
                borderRadius: "20px",
                fontWeight: "bold",
                fontSize: "12px"
              }}
            >
              {offer.discount}% OFF
            </div>

            {editingId === offer.id ? (

              <>
                <input
                  value={offer.title}
                  onChange={(e) =>
                    handleChange(offer.id, "title", e.target.value)
                  }
                  style={{ width: "100%", marginBottom: "8px" }}
                />

                <textarea
                  value={offer.description}
                  onChange={(e) =>
                    handleChange(offer.id, "description", e.target.value)
                  }
                  style={{ width: "100%", marginBottom: "8px" }}
                />

                <input
                  type="file"
                  onChange={(e) =>
                    handleImage(offer.id, e.target.files[0])
                  }
                />

                <br />

                <button
                  onClick={() => saveOffer(offer)}
                  style={{
                    marginTop: "8px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#2563eb",
                    color: "white"
                  }}
                >
                  Save
                </button>

              </>

            ) : (

              <>

                {offer.image && (

                  <img
                    src={offer.image}
                    alt="offer"
                    style={{
                      width: "100%",
                      height: "140px",
                      objectFit: "cover",
                      borderRadius: "8px",
                      marginBottom: "8px"
                    }}
                  />

                )}

                <h3>{offer.title}</h3>

                <p>{offer.description}</p>

                {productName && <p>📦 {productName}</p>}

                {offer.expiry && (
                  <p>⏳ Ends in: {getRemainingTime(offer.expiry)}</p>
                )}

                <div style={{ marginTop: "10px" }}>

                  <button
                    onClick={() => shareWhatsApp(offer)}
                    style={{
                      marginRight: "8px",
                      background: "#25D366",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      borderRadius: "6px"
                    }}
                  >
                    WhatsApp
                  </button>

                  <button onClick={copyLink}>
                    Copy Link
                  </button>

                </div>

              </>

            )}

          </div>

        );

      })}

    </div>

  );

}

export default OfferCard;