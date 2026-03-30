import React, { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc
} from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function SellerOrders() {
  const [orders, setOrders] = useState([]);
  const sellerProfile = getStoredProfile("seller");

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const shopId = localStorage.getItem("shopId") || sellerProfile?.shopId;

        if (!shopId) {
          setOrders([]);
          return;
        }

        const snap = await getDocs(
          query(collection(db, "orders"), where("shopId", "==", shopId))
        );

        const data = snap.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data()
        }));

        setOrders(data);
      } catch (error) {
        console.error("Failed to load seller orders:", error);
      }
    };

    loadOrders();
  }, [sellerProfile?.shopId]);

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      await updateDoc(doc(db, "orders", orderId), {
        status: newStatus
      });

      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      );
    } catch (error) {
      console.error("Failed to update order status:", error);
      alert("Status update failed");
    }
  };

  return (
    <SellerShell
      title="Seller orders"
      subtitle="Review incoming orders and respond from a cleaner queue."
    >
      {orders.length === 0 && (
        <div className="soft-panel">
          <h3>No orders yet</h3>
          <p className="muted-copy">
            When customers place orders for this shop, they will appear here.
          </p>
        </div>
      )}

      <div className="seller-order-grid">
        {orders.map((order, index) => {
          const address = order.address || {};
          const item = order.items?.[0] || {};

          return (
            <div key={order.id} className="soft-panel seller-order-card">
              <div className="seller-order-head">
                <h3>Order #{index + 1}</h3>
                <span className="order-status-pill">{order.status || "Pending"}</span>
              </div>

              <p className="muted-copy">Product: {item.name || "N/A"}</p>
              <p className="muted-copy">Qty: {item.qty || 0}</p>
              <p className="muted-copy">Total: Rs. {order.total || 0}</p>
              <p className="muted-copy">Customer: {address.name || "N/A"}</p>
              <p className="muted-copy">Phone: {address.phone || "N/A"}</p>
              <p className="muted-copy">City: {address.city || "N/A"}</p>

              <div className="seller-inline-actions">
                <button
                  className="primary-button"
                  onClick={() => updateOrderStatus(order.id, "Accepted")}
                >
                  Accept
                </button>
                <button
                  className="ghost-button seller-danger"
                  onClick={() => updateOrderStatus(order.id, "Rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </SellerShell>
  );
}

export default SellerOrders;
