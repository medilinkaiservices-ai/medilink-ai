import React from "react";
import Chatbot from "../webapp/src/components/Chatbot";
import { getStoredAccount } from "../utils/session";

function CustomerDashboard() {
  const account = getStoredAccount();
  const customerContext = {
    appFeatures: "Order tracking, saved addresses, chat with sellers/hospitals, notifications.",
    navigationHelp: "Use the top navigation bar to access different sections. Your account details are here.",
    generalInfo: "Medilink AI is a multi-role platform for customers, sellers, and hospitals."
  };

  return (
    <div className="page-shell">
      <div className="soft-panel">
        <h1>Customer Dashboard</h1>
        <p>Welcome, {account?.name || account?.phone}!</p>
      </div>
      <div style={{ marginTop: "20px" }}>
        <h2>Customer Assistant</h2>
        <Chatbot role="customer" contextData={customerContext} />
      </div>
    </div>
  );
}

export default CustomerDashboard;