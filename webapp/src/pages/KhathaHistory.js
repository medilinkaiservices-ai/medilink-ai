import React, { useState, useEffect } from "react";
import { db } from "../firebase";

import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "firebase/firestore";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function KhathaHistory() {

  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState("");

  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");

  const [bills, setBills] = useState([]);

  /* LOAD SHOPS */

  useEffect(() => {

    const loadShops = async () => {

      const snapshot = await getDocs(collection(db, "sellers"));

      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setShops(list);
    };

    loadShops();

  }, []);


  /* LOAD CUSTOMERS */

  useEffect(() => {

    if (!shopId) return;

    const unsubscribe = onSnapshot(

      collection(db, "sellers", shopId, "customers"),

      (snapshot) => {

        setCustomers(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }

    );

    return () => unsubscribe();

  }, [shopId]);


  /* LOAD BILLS */

  useEffect(() => {

    if (!shopId || !selectedCustomer) {
      setBills([]);
      return;
    }

    const billsQuery = query(

      collection(
        db,
        "sellers",
        shopId,
        "customers",
        selectedCustomer,
        "bills"
      ),

      orderBy("createdAt", "desc")

    );

    const unsubscribe = onSnapshot(

      billsQuery,

      (snapshot) => {

        setBills(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }

    );

    return () => unsubscribe();

  }, [shopId, selectedCustomer]);


  /* GENERATE PDF */

  const generatePDF = (bill, customerName) => {

    const pdf = new jsPDF();

    pdf.setFontSize(16);
    pdf.text("Bill Receipt", 14, 20);

    pdf.text(`Customer: ${customerName}`, 14, 30);

    pdf.text(
      `Date: ${
        bill.createdAt?.seconds
          ? new Date(bill.createdAt.seconds * 1000).toLocaleDateString()
          : ""
      }`,
      14,
      38
    );

    autoTable(pdf, {

      startY: 45,

      head: [["Product", "Price", "Qty", "Total"]],

      body:
        bill.items?.map(item => [
          item.productName,
          `₹${item.price}`,
          item.quantity,
          `₹${item.total}`
        ]) || []

    });

    pdf.text(
      `Grand Total: ₹${bill.totalAmount}`,
      14,
      pdf.lastAutoTable.finalY + 10
    );

    pdf.save(`Bill_${Date.now()}.pdf`);

  };


  /* UI */

  return (

    <div className="card">

      <h2>Khatha History</h2>


      {/* SHOP SELECT */}

      <select
        value={shopId}
        onChange={(e) => setShopId(e.target.value)}
      >

        <option value="">Select Shop</option>

        {shops.map(shop => (

          <option key={shop.id} value={shop.id}>
            {shop.shopName}
          </option>

        ))}

      </select>

      <br /><br />


      {/* CUSTOMER SELECT */}

      <select
        value={selectedCustomer}
        onChange={(e) => setSelectedCustomer(e.target.value)}
      >

        <option value="">Select Customer</option>

        {customers.map(c => (

          <option key={c.id} value={c.id}>
            {c.name} ({c.mobile})
          </option>

        ))}

      </select>

      <br /><br />


      {/* BILLS */}

      {selectedCustomer && (

        <>

          <h3>Total Bills: {bills.length}</h3>

          {bills.length === 0 && <p>No Bills Found</p>}

          {bills.map(bill => {

            const customer = customers.find(
              c => c.id === selectedCustomer
            );

            return (

              <div
                key={bill.id}
                style={{
                  marginBottom: "25px",
                  border: "1px solid #ddd",
                  padding: "10px"
                }}
              >

                <p>
                  <strong>Date:</strong>{" "}
                  {bill.createdAt?.seconds
                    ? new Date(
                        bill.createdAt.seconds * 1000
                      ).toLocaleDateString()
                    : ""}
                </p>

                <p>
                  <strong>Total:</strong> ₹{bill.totalAmount}
                </p>

                <p>
                  <strong>Type:</strong> {bill.type}
                </p>


                <table border="1" width="100%" cellPadding="5">

                  <thead>

                    <tr>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Qty</th>
                      <th>Total</th>
                    </tr>

                  </thead>

                  <tbody>

                    {bill.items?.map((item, index) => (

                      <tr key={index}>
                        <td>{item.productName}</td>
                        <td>₹{item.price}</td>
                        <td>{item.quantity}</td>
                        <td>₹{item.total}</td>
                      </tr>

                    ))}

                  </tbody>

                </table>

                <br />

                <button
                  onClick={() =>
                    generatePDF(bill, customer?.name)
                  }
                >
                  Download
                </button>

              </div>

            );

          })}

        </>

      )}

    </div>

  );

}

export default KhathaHistory;