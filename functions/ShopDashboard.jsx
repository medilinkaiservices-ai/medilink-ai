import React, { useState, useEffect } from "react";
import Chatbot from "../webapp/src/components/Chatbot";
import { getStoredProfile } from "../utils/session";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase"; // Assuming firebase.js is correctly configured

function ShopDashboard() {
  const profile = getStoredProfile("seller");
  const [shopProducts, setShopProducts] = useState([]);
  const [shopOffers, setShopOffers] = useState([]);

  useEffect(() => {
    const fetchShopData = async () => {
      if (profile?.shopId) {
        // Fetch products
        const productsQuery = query(collection(db, "products"), where("shopId", "==", profile.shopId));
        const productSnapshot = await getDocs(productsQuery);
        const productsList = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setShopProducts(productsList);

        // Fetch offers
        const offersQuery = query(collection(db, "offers"), where("shopId", "==", profile.shopId));
        const offerSnapshot = await getDocs(offersQuery);
        const offersList = offerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setShopOffers(offersList);
      }
    };
    fetchShopData();
  }, [profile?.shopId]);

  const sellerContext = {
    shopName: profile?.shopName || "Your Shop",
    products: shopProducts.map(p => ({ name: p.productName, price: p.price, availability: p.quantity > 0 ? "In Stock" : "Out of Stock" })),
    offers: shopOffers.map(o => `${o.title} (${o.discount}% off)`).join(', ') || "No active offers.",
    availability: profile?.orderEnabled ? "Accepting orders" : "Orders paused"
  };

  return (
    <div className="page-shell">
      <div className="soft-panel">
        <h1>Shop Dashboard</h1>
        <p>Welcome, {profile?.shopName || profile?.name}!</p>
      </div>
      <div style={{ marginTop: "20px" }}>
        <h2>Shop Assistant</h2>
        <Chatbot role="shop" contextData={sellerContext} />
      </div>
    </div>
  );
}

export default ShopDashboard;