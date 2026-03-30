import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import { collection, onSnapshot } from "firebase/firestore";

function DashboardSummary({ shopId }) {

  const [totalCustomers, setTotalCustomers] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [totalDebit, setTotalDebit] = useState(0);
  const [outstanding, setOutstanding] = useState(0);

  useEffect(() => {

    if (!shopId) return;

    const unsubscribe = onSnapshot(
      collection(db, "sellers", shopId, "customers"),
      (snapshot) => {

        setTotalCustomers(snapshot.size);

        let credit = 0;
        let debit = 0;

        snapshot.docs.forEach(customerDoc => {

          const txRef = collection(
            db,
            "sellers",
            shopId,
            "customers",
            customerDoc.id,
            "transactions"
          );

          onSnapshot(txRef, (txSnap) => {

            txSnap.forEach(tx => {
              const data = tx.data();
              const amount = Number(data.totalAmount) || 0;

              if (data.type === "credit") {
                credit += amount;
              } else {
                debit += amount;
              }
            });

            setTotalCredit(credit);
            setTotalDebit(debit);
            setOutstanding(credit - debit);

          });

        });

      }
    );

    return () => unsubscribe();

  }, [shopId]);

  return (
    <div className="dashboard-grid">
      <div className="card-box customers">
        <h3>Total Customers</h3>
        <h2>{totalCustomers}</h2>
      </div>

      <div className="card-box credit">
        <h3>Total Credit</h3>
        <h2>₹{totalCredit}</h2>
      </div>

      <div className="card-box debit">
        <h3>Total Debit</h3>
        <h2>₹{totalDebit}</h2>
      </div>

      <div className="card-box balance">
        <h3>Outstanding</h3>
        <h2>₹{outstanding}</h2>
      </div>
    </div>
  );
}

export default DashboardSummary;