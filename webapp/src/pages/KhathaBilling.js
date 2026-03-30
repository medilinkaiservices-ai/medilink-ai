import React, { useState, useEffect } from "react";
import { db } from "../firebase";

import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  serverTimestamp
} from "firebase/firestore";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function KhathaBilling() {

  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState("");

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);

  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [type, setType] = useState("credit");

  const [billItems, setBillItems] = useState([]);

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


  /* LOAD CUSTOMERS + PRODUCTS */

  useEffect(() => {

    if (!shopId) return;

    const unsubCustomers = onSnapshot(
      collection(db, "sellers", shopId, "customers"),
      snap => {

        setCustomers(
          snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }
    );

    const productQuery = query(
      collection(db, "products"),
      where("shopId", "==", shopId)
    );

    const unsubProducts = onSnapshot(productQuery, snap => {

      setProducts(
        snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      );

    });

    return () => {
      unsubCustomers();
      unsubProducts();
    };

  }, [shopId]);


  /* ADD ITEM */

  const addItemToBill = () => {

    if (!selectedProduct) {
      alert("Select product ❌");
      return;
    }

    if (!price || quantity <= 0) {
      alert("Enter valid price & quantity ❌");
      return;
    }

    const product = products.find(p => p.id === selectedProduct);

    const item = {

      productName: product?.productName || "Unknown",
      price: Number(price),
      quantity: Number(quantity),
      total: Number(price) * Number(quantity)

    };

    setBillItems(prev => [...prev, item]);

    setSelectedProduct("");
    setPrice("");
    setQuantity(1);
  };


  const totalAmount = billItems.reduce(
    (sum, item) => sum + item.total,
    0
  );


  /* SAVE BILL */

  const saveTransaction = async () => {

    if (!selectedCustomer) {
      alert("Select customer ❌");
      return;
    }

    if (billItems.length === 0) {
      alert("Add at least one item ❌");
      return;
    }

    try {

      const customer = customers.find(c => c.id === selectedCustomer);

      /* SAVE TRANSACTIONS */

      for (let item of billItems) {

        await addDoc(

          collection(
            db,
            "sellers",
            shopId,
            "customers",
            selectedCustomer,
            "transactions"
          ),

          {
            productName: item.productName,
            price: item.price,
            quantity: item.quantity,
            totalAmount: item.total,
            type,
            createdAt: serverTimestamp()
          }

        );

      }

      /* SAVE BILL */

      await addDoc(

        collection(
          db,
          "sellers",
          shopId,
          "customers",
          selectedCustomer,
          "bills"
        ),

        {
          items: billItems,
          totalAmount,
          type,
          createdAt: serverTimestamp()
        }

      );


      /* GENERATE PDF */

      const pdf = new jsPDF();

      pdf.setFontSize(16);
      pdf.text("Bill Receipt", 14, 20);

      pdf.text(`Customer: ${customer?.name}`, 14, 30);
      pdf.text(`Date: ${new Date().toLocaleDateString()}`, 14, 38);
      pdf.text(`Type: ${type.toUpperCase()}`, 14, 46);

      autoTable(pdf, {
        startY: 55,
        head: [["Product", "Price", "Qty", "Total"]],
        body: billItems.map(item => [
          item.productName,
          `₹${item.price}`,
          item.quantity,
          `₹${item.total}`
        ])
      });

      pdf.text(
        `Grand Total: ₹${totalAmount}`,
        14,
        pdf.lastAutoTable.finalY + 10
      );

      pdf.save(`Bill_${Date.now()}.pdf`);

      alert("Transaction Saved & PDF Downloaded ✅");

      setBillItems([]);
      setSelectedCustomer("");
      setSelectedProduct("");
      setPrice("");
      setQuantity(1);

    } catch (error) {

      console.error(error);
      alert("Error saving transaction ❌");

    }

  };


  return (

    <div className="card">

      <h2>Khatha Billing</h2>

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


      {/* PRODUCT SELECT */}

      <select
        value={selectedProduct}
        onChange={(e) => {

          const id = e.target.value;

          setSelectedProduct(id);

          const product = products.find(p => p.id === id);

          if (product) setPrice(product.price);

        }}
      >

        <option value="">Select Product</option>

        {products.map(p => (
          <option key={p.id} value={p.id}>
            {p.productName}
          </option>
        ))}

      </select>

      <br /><br />

      <input
        type="number"
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />

      <input
        type="number"
        placeholder="Quantity"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />

      <button onClick={addItemToBill}>
        Add Item
      </button>

      <br /><br />


      {billItems.length > 0 && (

        <table width="100%">

          <thead>

            <tr>
              <th>Product</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>

          </thead>

          <tbody>

            {billItems.map((item, index) => (

              <tr key={index}>
                <td>{item.productName}</td>
                <td>₹{item.price}</td>
                <td>{item.quantity}</td>
                <td>₹{item.total}</td>
              </tr>

            ))}

          </tbody>

        </table>

      )}

      <br />

      <strong>Total: ₹{totalAmount}</strong>

      <br /><br />

      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        <option value="credit">Credit</option>
        <option value="debit">Debit</option>
      </select>

      <br /><br />

      <button onClick={saveTransaction}>
        Save Bill
      </button>

    </div>

  );

}

export default KhathaBilling;