import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

function AffiliateAnalytics() {

  const [clicks, setClicks] = useState([]);
  const [sales, setSales] = useState([]);

  /* LOAD CLICKS */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "affiliateClicks"),
      (snapshot) => {
        setClicks(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );
      }
    );

    return () => unsub();
  }, []);

  /* LOAD SALES */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "affiliateSales"),
      (snapshot) => {
        setSales(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );
      }
    );

    return () => unsub();
  }, []);

  const totalClicks = clicks.length;
  const totalSales = sales.length;

  const totalCommission = sales.reduce(
    (sum, sale) => sum + (sale.commission || 0),
    0
  );

  const conversionRate =
    totalClicks > 0
      ? ((totalSales / totalClicks) * 100).toFixed(2)
      : 0;

  return (
    <div style={{ padding: "30px" }}>
      <h2>📊 Affiliate Analytics</h2>

      <div style={{ marginTop: "20px" }}>
        <p>👆 Total Clicks: <b>{totalClicks}</b></p>
        <p>🛒 Total Sales: <b>{totalSales}</b></p>
        <p>💰 Total Earnings: <b>₹{totalCommission}</b></p>
        <p>📈 Conversion Rate: <b>{conversionRate}%</b></p>
      </div>

    </div>
  );
}

export default AffiliateAnalytics;