import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function buildBillPdf(customerName, type, items, totalAmount) {
  const pdf = new jsPDF();
  pdf.setFontSize(16);
  pdf.text("Medilink Khatha Bill", 14, 20);
  pdf.text(`Customer: ${customerName}`, 14, 30);
  pdf.text(`Date: ${new Date().toLocaleDateString()}`, 14, 38);
  pdf.text(`Entry Type: ${String(type || "").toUpperCase()}`, 14, 46);

  autoTable(pdf, {
    startY: 55,
    head: [["Product", "Price", "Qty", "Total"]],
    body: items.map((item) => [
      item.productName,
      formatCurrency(item.price),
      item.quantity,
      formatCurrency(item.total)
    ])
  });

  pdf.text(`Grand Total: ${formatCurrency(totalAmount)}`, 14, pdf.lastAutoTable.finalY + 10);
  pdf.save(`Khatha_Bill_${Date.now()}.pdf`);
}

function printThermalBill(customerName, type, items, totalAmount, shopName) {
  const receiptWindow = window.open("", "_blank", "width=420,height=720");
  if (!receiptWindow) return;

  const rows = items.map((item) => `
    <tr>
      <td>${item.productName}</td>
      <td>${item.quantity}</td>
      <td>${Number(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  receiptWindow.document.write(`
    <html>
      <head>
        <title>Thermal Bill</title>
        <style>
          body { font-family: monospace; padding: 12px; color: #000; }
          h2, p { margin: 0 0 8px; text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          td, th { border-bottom: 1px dashed #000; padding: 6px 0; font-size: 12px; text-align: left; }
          .right { text-align: right; }
          .summary { margin-top: 12px; font-weight: bold; }
        </style>
      </head>
      <body onload="window.print(); window.close();">
        <h2>${shopName || "Medilink Shop"}</h2>
        <p>Khatha ${String(type || "").toUpperCase()} Receipt</p>
        <p>Customer: ${customerName}</p>
        <p>Date: ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr><th>Item</th><th>Qty</th><th class="right">Total</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="summary">Grand Total: ${Number(totalAmount || 0).toFixed(2)}</p>
      </body>
    </html>
  `);
  receiptWindow.document.close();
}

function KhathaBilling() {
  const sellerProfile = getStoredProfile("seller");
  const shopId = sellerProfile?.shopId || "";
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState("credit");
  const [billNumber, setBillNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [billItems, setBillItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [customerForm, setCustomerForm] = useState({
    name: "",
    mobile: ""
  });

  useEffect(() => {
    if (!shopId) return undefined;

    const unsubscribeCustomers = onSnapshot(collection(db, "sellers", shopId, "customers"), (snapshot) => {
      setCustomers(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }))
      );
    });

    const productsQuery = query(collection(db, "products"), where("shopId", "==", shopId));
    const unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }))
      );
    });

    return () => {
      unsubscribeCustomers();
      unsubscribeProducts();
    };
  }, [shopId]);

  const selectedCustomerData = useMemo(
    () => customers.find((item) => item.id === selectedCustomer) || null,
    [customers, selectedCustomer]
  );

  const totalAmount = useMemo(
    () => billItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [billItems]
  );

  const customerTotals = useMemo(() => {
    const totalCredit = customers.reduce((sum, item) => sum + Number(item.totalCredit || 0), 0);
    const totalDebit = customers.reduce((sum, item) => sum + Number(item.totalDebit || 0), 0);
    return {
      totalCustomers: customers.length,
      totalCredit,
      totalDebit,
      outstanding: totalCredit - totalDebit
    };
  }, [customers]);

  const handleCustomerFormChange = (field, value) => {
    setCustomerForm((current) => ({
      ...current,
      [field]: field === "mobile" ? value.replace(/[^0-9]/g, "").slice(0, 10) : value
    }));
  };

  const handleCreateCustomer = async () => {
    const name = customerForm.name.trim();
    const mobile = customerForm.mobile.trim();

    if (!shopId) {
      setStatus("Seller shop not found.");
      return;
    }

    if (!name || mobile.length !== 10) {
      setStatus("Enter customer name and valid 10 digit mobile number.");
      return;
    }

    try {
      await setDoc(doc(db, "sellers", shopId, "customers", mobile), {
        name,
        mobile,
        balance: 0,
        totalCredit: 0,
        totalDebit: 0,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      }, { merge: true });

      setSelectedCustomer(mobile);
      setCustomerForm({ name: "", mobile: "" });
      setStatus(`Customer ${name} added to khatha book.`);
    } catch (error) {
      console.error("Failed to create customer:", error);
      setStatus("Could not add customer.");
    }
  };

  const addItemToBill = () => {
    if (!selectedProduct) {
      setStatus("Select product first.");
      return;
    }

    if (!price || Number(price) <= 0 || Number(quantity) <= 0) {
      setStatus("Enter valid price and quantity.");
      return;
    }

    const product = products.find((item) => item.id === selectedProduct);
    const item = {
      productId: selectedProduct,
      productName: product?.productName || "Unknown product",
      barcode: product?.barcode || "",
      category: product?.category || "",
      brand: product?.brand || "",
      unit: product?.unit || "",
      description: product?.description || "",
      image: product?.image || "",
      mrp: Number(product?.mrp || price || 0),
      costPrice: Number(product?.costPrice || price || 0),
      price: Number(price),
      quantity: Number(quantity),
      total: Number(price) * Number(quantity)
    };

    setBillItems((current) => [...current, item]);
    setSelectedProduct("");
    setPrice("");
    setQuantity(1);
    setStatus(`Added ${item.productName} to bill.`);
  };

  const handleSaveBill = async () => {
    if (!shopId || !selectedCustomer) {
      setStatus("Select customer before saving bill.");
      return;
    }

    if (!billItems.length) {
      setStatus("Add at least one item to bill.");
      return;
    }

    try {
      setLoading(true);
      const customer = selectedCustomerData;
      const resolvedBillNumber = billNumber.trim() || `BILL-${Date.now()}`;
      const previousCredit = Number(customer?.totalCredit || 0);
      const previousDebit = Number(customer?.totalDebit || 0);
      const nextCredit = type === "credit" ? previousCredit + totalAmount : previousCredit;
      const nextDebit = type === "debit" ? previousDebit + totalAmount : previousDebit;
      const nextBalance = nextCredit - nextDebit;

      await addDoc(collection(db, "sellers", shopId, "customers", selectedCustomer, "transactions"), {
        billNumber: resolvedBillNumber,
        items: billItems,
        totalAmount,
        type,
        dueDate,
        paymentNote: paymentNote.trim(),
        customerName: customer?.name || "",
        createdAt: serverTimestamp()
      });

      await addDoc(collection(db, "sellers", shopId, "customers", selectedCustomer, "bills"), {
        billNumber: resolvedBillNumber,
        items: billItems,
        totalAmount,
        type,
        dueDate,
        paymentNote: paymentNote.trim(),
        customerName: customer?.name || "",
        createdAt: serverTimestamp()
      });

      await addDoc(collection(db, "wholesaleBills"), {
        billNumber: resolvedBillNumber,
        sourceShopId: shopId,
        sourceShopName: sellerProfile?.shopName || sellerProfile?.name || "Wholesale Shop",
        retailerCustomerId: selectedCustomer,
        retailerCustomerName: customer?.name || "",
        retailerCustomerPhone: customer?.mobile || "",
        items: billItems,
        totalAmount,
        type,
        dueDate,
        paymentNote: paymentNote.trim(),
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, "sellers", shopId, "customers", selectedCustomer), {
        balance: nextBalance,
        totalCredit: nextCredit,
        totalDebit: nextDebit,
        lastTransactionType: type,
        lastTransactionAmount: totalAmount,
        updatedAt: serverTimestamp()
      });

      buildBillPdf(customer?.name || "Customer", type, billItems, totalAmount);
      printThermalBill(
        customer?.name || "Customer",
        type,
        billItems,
        totalAmount,
        sellerProfile?.shopName || sellerProfile?.name || "Medilink Shop"
      );
      setBillItems([]);
      setBillNumber("");
      setType("credit");
      setDueDate("");
      setPaymentNote("");
      setStatus(`Saved ${type} bill for ${customer?.name || "customer"}.`);
    } catch (error) {
      console.error("Failed to save khatha bill:", error);
      setStatus("Could not save khatha bill.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SellerShell
      title="Khatha billing"
      subtitle="Create debit or credit bills, add customers to khatha book, and maintain outstanding balances customer-wise."
    >
      <div className="seller-stats-grid">
        <div className="soft-panel">
          <div className="eyebrow">Customers</div>
          <div className="seller-stat-value">{customerTotals.totalCustomers}</div>
        </div>
        <div className="soft-panel">
          <div className="eyebrow">Total Credit</div>
          <div className="seller-stat-value">{formatCurrency(customerTotals.totalCredit)}</div>
        </div>
        <div className="soft-panel">
          <div className="eyebrow">Outstanding</div>
          <div className="seller-stat-value">{formatCurrency(customerTotals.outstanding)}</div>
        </div>
      </div>

      <div className="seller-two-column">
        <div className="auth-card">
          <div className="section-title">Customer and billing</div>

          <div className="soft-panel">
            <div className="section-title">Add customer to khatha book</div>
            <div className="seller-form-grid">
              <label>
                Customer name
                <input
                  value={customerForm.name}
                  onChange={(event) => handleCustomerFormChange("name", event.target.value)}
                  placeholder="Customer name"
                />
              </label>
              <label>
                Mobile number
                <input
                  value={customerForm.mobile}
                  onChange={(event) => handleCustomerFormChange("mobile", event.target.value)}
                  placeholder="10 digit mobile"
                />
              </label>
            </div>
            <button type="button" className="header-link" onClick={handleCreateCustomer}>
              Add customer
            </button>
          </div>

          <label>
            Select customer
            <select value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}>
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} ({customer.mobile}) | Balance {formatCurrency(customer.balance)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Entry type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="credit">Credit bill</option>
              <option value="debit">Debit payment</option>
            </select>
          </label>

          <label>
            Bill number
            <input
              value={billNumber}
              onChange={(event) => setBillNumber(event.target.value)}
              placeholder="Optional custom bill number"
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Due date
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <label>
              Payment note
              <input
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                placeholder={type === "debit" ? "Partial payment / UPI / cash note" : "Optional note"}
              />
            </label>
          </div>

          <label>
            Select product
            <select
              value={selectedProduct}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedProduct(nextId);
                const product = products.find((item) => item.id === nextId);
                setPrice(product?.price ? String(product.price) : "");
              }}
            >
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.productName} | {formatCurrency(product.price)}
                </option>
              ))}
            </select>
          </label>

          <div className="seller-form-grid">
            <label>
              Price
              <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label>
              Quantity
              <input value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          </div>

          <div className="seller-inline-actions">
            <button type="button" className="header-link" onClick={addItemToBill}>
              Add item to bill
            </button>
            <button type="button" className="primary-button" disabled={loading} onClick={handleSaveBill}>
              {loading ? "Saving..." : "Save khatha bill"}
            </button>
          </div>

          {status ? <p className="muted-copy">{status}</p> : null}
        </div>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">Current bill</div>
            {!billItems.length ? <p className="muted-copy">Add products to prepare bill.</p> : null}
            {billItems.map((item, index) => (
              <div key={`${item.productId}-${index}`} className="list-row">
                <span>{item.productName} x {item.quantity}</span>
                <small>{formatCurrency(item.total)}</small>
              </div>
            ))}
            <p className="muted-copy" style={{ marginTop: "12px" }}>
              Bill type: {type === "credit" ? "Credit added to khatha" : "Debit/payment received"}
            </p>
            <p className="muted-copy">Bill number: {billNumber || "Auto generated on save"}</p>
            {dueDate ? <p className="muted-copy">Due date: {dueDate}</p> : null}
            {paymentNote ? <p className="muted-copy">Note: {paymentNote}</p> : null}
            <p className="muted-copy">
              Total: {formatCurrency(totalAmount)}
            </p>
          </div>

          <div className="soft-panel">
            <div className="section-title">Selected customer summary</div>
            {!selectedCustomerData ? <p className="muted-copy">Select customer to view khatha summary.</p> : null}
            {selectedCustomerData ? (
              <>
                <p className="muted-copy">Name: {selectedCustomerData.name}</p>
                <p className="muted-copy">Mobile: {selectedCustomerData.mobile}</p>
                <p className="muted-copy">Credit: {formatCurrency(selectedCustomerData.totalCredit)}</p>
                <p className="muted-copy">Debit: {formatCurrency(selectedCustomerData.totalDebit)}</p>
                <p className="muted-copy">Balance: {formatCurrency(selectedCustomerData.balance)}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default KhathaBilling;
