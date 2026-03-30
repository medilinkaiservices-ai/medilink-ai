import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "firebase/firestore";

function CustomerList({ shopId }) {

  const [customers, setCustomers] = useState([]);

  useEffect(() => {

    if (!shopId) return;

    const unsubscribe = onSnapshot(
      collection(db, "sellers", shopId, "customers"),
      async (snapshot) => {

        const customerData = [];

        for (const docSnap of snapshot.docs) {

          const customerId = docSnap.id;
          const data = docSnap.data();

          const transQuery = query(
            collection(
              db,
              "sellers",
              shopId,
              "customers",
              customerId,
              "transactions"
            ),
            orderBy("createdAt", "asc")
          );

          const transSnap = await getDocs(transQuery);

          let balance = 0;

          transSnap.forEach(t => {
            const tx = t.data();
            const amount = Number(tx.totalAmount) || 0;

            if (tx.type === "credit") {
              balance += amount;
            } else {
              balance -= amount;
            }
          });

          customerData.push({
            id: customerId,
            name: data.name,
            mobile: data.mobile,
            balance
          });
        }

        setCustomers(customerData);
      }
    );

    return () => unsubscribe();

  }, [shopId]);

  return (
    <div className="card">
      <h2>Customer List</h2>

      <table border="1" cellPadding="5" width="100%">
        <thead>
          <tr>
            <th>Name</th>
            <th>Mobile</th>
            <th>Outstanding</th>
          </tr>
        </thead>

        <tbody>
          {customers.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.mobile}</td>
              <td>₹ {c.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>

    </div>
  );
}

export default CustomerList;