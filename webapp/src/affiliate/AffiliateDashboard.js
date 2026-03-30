import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

function AffiliateDashboard() {

  const [sales, setSales] = useState([]);
  const [sellers, setSellers] = useState([]);

  /* LOAD AFFILIATE SALES */
  useEffect(() => {

    const unsubscribe = onSnapshot(
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

    return () => unsubscribe();

  }, []);

  /* LOAD SELLERS (FOR SHOP NAME) */
  useEffect(() => {

    const unsub = onSnapshot(
      collection(db, "sellers"),
      (snap) => {

        setSellers(
          snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }
    );

    return () => unsub();

  }, []);

  /* TOTAL EARNINGS */
  const totalEarnings = sales.reduce(
    (sum, sale) => sum + (sale.commission || 0),
    0
  );

  return (
    <div style={{ padding: "30px" }}>

      <h2>💰 Affiliate Earnings</h2>
      <h3>Total Earnings: ₹{totalEarnings}</h3>

      <table
        style={{
          width: "600px",
          borderCollapse: "collapse",
          marginTop: "20px"
        }}
      >
        <thead>
          <tr>
            <th style={{ border: "1px solid #ccc", padding: "8px" }}>Shop</th>
            <th style={{ border: "1px solid #ccc", padding: "8px" }}>Total Sale</th>
            <th style={{ border: "1px solid #ccc", padding: "8px" }}>Commission</th>
          </tr>
        </thead>

        <tbody>
          {sales.map((sale) => {

            const shop = sellers.find(s => s.id === sale.shopId);

            return (
              <tr key={sale.id}>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>
                  {shop ? shop.shopName : sale.shopId}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>
                  ₹{sale.totalAmount}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>
                  ₹{sale.commission}
                </td>
              </tr>
            );

          })}
        </tbody>

      </table>

    </div>
  );
}

export default AffiliateDashboard;