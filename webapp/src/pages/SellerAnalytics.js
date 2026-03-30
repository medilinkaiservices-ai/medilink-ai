import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function SellerAnalytics() {
  const sellerProfile = getStoredProfile("seller");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    const loadAnalytics = async () => {
      const shopId = localStorage.getItem("shopId") || sellerProfile?.shopId;

      if (!shopId) return;

      const [productsSnap, ordersSnap, offersSnap] = await Promise.all([
        getDocs(query(collection(db, "products"), where("shopId", "==", shopId))),
        getDocs(query(collection(db, "orders"), where("shopId", "==", shopId))),
        getDocs(query(collection(db, "offers"), where("shopId", "==", shopId)))
      ]);

      setProducts(productsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setOrders(ordersSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setOffers(offersSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    };

    loadAnalytics().catch((error) => {
      console.error("Failed to load seller analytics:", error);
    });
  }, [sellerProfile?.shopId]);

  const summary = useMemo(() => {
    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const acceptedOrders = orders.filter((order) => order.status === "Accepted").length;
    const lowStock = products.filter((product) => Number(product.quantity || 0) <= 5).length;

    return [
      { label: "Total products", value: products.length },
      { label: "Orders received", value: orders.length },
      { label: "Accepted orders", value: acceptedOrders },
      { label: "Offers running", value: offers.length },
      { label: "Low stock items", value: lowStock },
      { label: "Revenue snapshot", value: `Rs. ${totalRevenue}` }
    ];
  }, [offers.length, orders, products]);

  const topProducts = useMemo(() => {
    return [...products]
      .sort((first, second) => Number(second.quantity || 0) - Number(first.quantity || 0))
      .slice(0, 4);
  }, [products]);

  return (
    <SellerShell
      title="Seller analytics"
      subtitle="Quick summary cards to understand how your shop is performing."
    >
      <section className="seller-analytics-grid">
        {summary.map((card) => (
          <div key={card.label} className="soft-panel">
            <div className="identity-label">{card.label}</div>
            <div className="seller-stat-value">{card.value}</div>
          </div>
        ))}
      </section>

      <section className="seller-two-column">
        <div className="soft-panel">
          <div className="section-title">Top stocked products</div>
          {topProducts.length === 0 && (
            <p className="muted-copy">Products will appear here after catalog setup.</p>
          )}
          {topProducts.map((product) => (
            <div key={product.id} className="list-row">
              <span>{product.productName}</span>
              <small>Qty {product.quantity || 0}</small>
            </div>
          ))}
        </div>

        <div className="soft-panel">
          <div className="section-title">Quick observations</div>
          <p className="muted-copy">
            Use these cards as the first level analytics view. Next we can add date range
            filters, charts, conversion tracking and repeat customer insights.
          </p>
        </div>
      </section>
    </SellerShell>
  );
}

export default SellerAnalytics;
