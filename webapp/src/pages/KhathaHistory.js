import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function formatDate(timestamp) {
  if (timestamp?.seconds) {
    return new Date(timestamp.seconds * 1000).toLocaleString();
  }
  return "Just now";
}

function isPastDue(dateString) {
  if (!dateString) return false;
  const today = new Date();
  const dueDate = new Date(dateString);
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
}

function downloadBillPdf(entry, customerName) {
  const pdf = new jsPDF();
  pdf.setFontSize(16);
  pdf.text("Medilink Khatha Receipt", 14, 20);
  pdf.text(`Customer: ${customerName}`, 14, 30);
  pdf.text(`Date: ${formatDate(entry.createdAt)}`, 14, 38);
  pdf.text(`Type: ${String(entry.type || "").toUpperCase()}`, 14, 46);

  autoTable(pdf, {
    startY: 55,
    head: [["Product", "Price", "Qty", "Total"]],
    body: (entry.items || []).map((item) => [
      item.productName,
      formatCurrency(item.price),
      item.quantity,
      formatCurrency(item.total)
    ])
  });

  pdf.text(`Grand Total: ${formatCurrency(entry.totalAmount)}`, 14, pdf.lastAutoTable.finalY + 10);
  pdf.save(`Khatha_History_${Date.now()}.pdf`);
}

function printThermalReceipt(entry, customerName, shopName) {
  const receiptWindow = window.open("", "_blank", "width=420,height=720");
  if (!receiptWindow) return;

  const rows = (entry.items || []).map((item) => `
    <tr>
      <td>${item.productName}</td>
      <td>${item.quantity}</td>
      <td>${Number(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  receiptWindow.document.write(`
    <html>
      <head>
        <title>Thermal Receipt</title>
        <style>
          body { font-family: monospace; padding: 12px; color: #000; }
          h2, p { margin: 0 0 8px; text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          td, th { border-bottom: 1px dashed #000; padding: 6px 0; font-size: 12px; text-align: left; }
          .summary { margin-top: 12px; font-weight: bold; }
          .right { text-align: right; }
        </style>
      </head>
      <body onload="window.print(); window.close();">
        <h2>${shopName || "Medilink Shop"}</h2>
        <p>Khatha ${String(entry.type || "").toUpperCase()} Receipt</p>
        <p>Customer: ${customerName}</p>
        <p>Date: ${formatDate(entry.createdAt)}</p>
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th class="right">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="summary">Grand Total: ${Number(entry.totalAmount || 0).toFixed(2)}</p>
      </body>
    </html>
  `);
  receiptWindow.document.close();
}

function KhathaHistory() {
  const sellerProfile = getStoredProfile("seller");
  const shopId = sellerProfile?.shopId || "";
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    if (!shopId) return undefined;

    const unsubscribe = onSnapshot(collection(db, "sellers", shopId, "customers"), (snapshot) => {
      setCustomers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    return () => unsubscribe();
  }, [shopId]);

  useEffect(() => {
    if (!shopId || !selectedCustomer) {
      setTransactions([]);
      return undefined;
    }

    const transactionQuery = query(
      collection(db, "sellers", shopId, "customers", selectedCustomer, "transactions"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(transactionQuery, (snapshot) => {
      setTransactions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    return () => unsubscribe();
  }, [shopId, selectedCustomer]);

  const selectedCustomerData = useMemo(
    () => customers.find((item) => item.id === selectedCustomer) || null,
    [customers, selectedCustomer]
  );

  const totalKhatha = useMemo(() => {
    return customers.reduce(
      (accumulator, customer) => {
        accumulator.credit += Number(customer.totalCredit || 0);
        accumulator.debit += Number(customer.totalDebit || 0);
        accumulator.balance += Number(customer.balance || 0);
        return accumulator;
      },
      { credit: 0, debit: 0, balance: 0 }
    );
  }, [customers]);

  const customerWiseSummary = useMemo(() => {
    return [...customers].sort((first, second) => Number(second.balance || 0) - Number(first.balance || 0));
  }, [customers]);

  const outstandingAlerts = useMemo(() => {
    return customerWiseSummary.filter((customer) => Number(customer.balance || 0) > 0).slice(0, 5);
  }, [customerWiseSummary]);

  const overdueTransactions = useMemo(() => {
    return transactions.filter((entry) => entry.type === "credit" && entry.dueDate && isPastDue(entry.dueDate));
  }, [transactions]);

  const openReminder = async (customer) => {
    const phone = String(customer.mobile || "").replace(/\D/g, "");
    if (!phone) return;
    const fullPhone = phone.length === 10 ? `91${phone}` : phone;
    const text = `Hello ${customer.name}, your khatha balance at ${sellerProfile?.shopName || "our shop"} is ${formatCurrency(customer.balance)}. Please clear payment when possible.`;
    try {
      if (shopId && customer.id) {
        await updateDoc(doc(db, "sellers", shopId, "customers", customer.id), {
          lastReminderAt: serverTimestamp(),
          lastReminderStatus: "sent"
        });
      }
    } catch (error) {
      console.error("Failed to track khatha reminder:", error);
    }
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <SellerShell
      title="Khatha history"
      subtitle="View customer-wise ledger, total khatha book, debit and credit history, and download receipts."
    >
      <div className="seller-stats-grid">
        <div className="soft-panel">
          <div className="eyebrow">Total Credit</div>
          <div className="seller-stat-value">{formatCurrency(totalKhatha.credit)}</div>
        </div>
        <div className="soft-panel">
          <div className="eyebrow">Total Debit</div>
          <div className="seller-stat-value">{formatCurrency(totalKhatha.debit)}</div>
        </div>
        <div className="soft-panel">
          <div className="eyebrow">Khatha Book Balance</div>
          <div className="seller-stat-value">{formatCurrency(totalKhatha.balance)}</div>
        </div>
      </div>

      <div className="seller-two-column">
        <div className="auth-card">
          <div className="soft-panel">
            <div className="section-title">Outstanding alerts</div>
            {!outstandingAlerts.length ? <p className="muted-copy">No pending khatha balances right now.</p> : null}
            {outstandingAlerts.map((customer) => (
              <div key={`alert-${customer.id}`} className="list-row">
                <span>{customer.name}</span>
                <small>{formatCurrency(customer.balance)}</small>
              </div>
            ))}
          </div>
          <div className="section-title">Customer-wise khatha book</div>
          {!customerWiseSummary.length ? <p className="muted-copy">No khatha customers added yet.</p> : null}
          {customerWiseSummary.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="soft-panel"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => setSelectedCustomer(customer.id)}
            >
              <div className="seller-product-head">
                <strong>{customer.name}</strong>
                <span className="order-status-pill">{formatCurrency(customer.balance)}</span>
              </div>
              <p className="muted-copy">Mobile: {customer.mobile}</p>
              <p className="muted-copy">
                Credit {formatCurrency(customer.totalCredit)} | Debit {formatCurrency(customer.totalDebit)}
              </p>
            </button>
          ))}
        </div>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">Selected customer ledger</div>
            {!selectedCustomerData ? <p className="muted-copy">Select customer to see history.</p> : null}
            {selectedCustomerData ? (
              <>
                <p className="muted-copy">Name: {selectedCustomerData.name}</p>
                <p className="muted-copy">Mobile: {selectedCustomerData.mobile}</p>
                <p className="muted-copy">Credit: {formatCurrency(selectedCustomerData.totalCredit)}</p>
                <p className="muted-copy">Debit: {formatCurrency(selectedCustomerData.totalDebit)}</p>
                <p className="muted-copy">Balance: {formatCurrency(selectedCustomerData.balance)}</p>
                <p className="muted-copy">Overdue entries: {overdueTransactions.length}</p>
                <p className="muted-copy">Last reminder: {selectedCustomerData.lastReminderAt ? formatDate(selectedCustomerData.lastReminderAt) : "Not sent"}</p>
                {Number(selectedCustomerData.balance || 0) > 0 ? (
                  <button type="button" className="header-link" style={{ marginTop: "12px" }} onClick={() => openReminder(selectedCustomerData)}>
                    Send payment reminder
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="soft-panel">
            <div className="section-title">Transaction history</div>
            {!selectedCustomer && <p className="muted-copy">Select a customer from khatha book.</p>}
            {selectedCustomer && !transactions.length ? <p className="muted-copy">No transaction history found.</p> : null}
            {transactions.map((entry) => (
              <div key={entry.id} className="soft-panel" style={{ padding: "16px", marginTop: "10px" }}>
                <div className="seller-product-head">
                  <strong>{String(entry.type || "").toUpperCase()}</strong>
                  <span className="order-status-pill">{formatCurrency(entry.totalAmount)}</span>
                </div>
                <p className="muted-copy">{formatDate(entry.createdAt)}</p>
                {entry.dueDate ? <p className="muted-copy">Due date: {entry.dueDate} {isPastDue(entry.dueDate) ? "| Overdue" : ""}</p> : null}
                {entry.paymentNote ? <p className="muted-copy">Note: {entry.paymentNote}</p> : null}
                {(entry.items || []).map((item, index) => (
                  <div key={`${entry.id}-${index}`} className="list-row">
                    <span>{item.productName} x {item.quantity}</span>
                    <small>{formatCurrency(item.total)}</small>
                  </div>
                ))}
                <button
                  type="button"
                  className="header-link"
                  style={{ marginTop: "12px" }}
                  onClick={() => downloadBillPdf(entry, selectedCustomerData?.name || "Customer")}
                >
                  Download receipt
                </button>
                <button
                  type="button"
                  className="header-link"
                  style={{ marginTop: "12px", marginLeft: "8px" }}
                  onClick={() => printThermalReceipt(entry, selectedCustomerData?.name || "Customer", sellerProfile?.shopName || sellerProfile?.name || "Medilink Shop")}
                >
                  Thermal print
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default KhathaHistory;
