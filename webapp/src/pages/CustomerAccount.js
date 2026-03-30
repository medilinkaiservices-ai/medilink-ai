import React from "react";
import { Link, Navigate } from "react-router-dom";
import { getStoredAccount, getStoredProfile } from "../utils/session";

function CustomerAccount() {
  const account = getStoredAccount();
  const profile = getStoredProfile("customer");

  if (!account || !profile) {
    return <Navigate to="/register/customer" replace />;
  }

  const cards = [
    {
      title: "Saved profile",
      text: "Keep customer identity, phone, locality and future addresses in one place."
    },
    {
      title: "Orders and repeats",
      text: "We can add order history, re-order flow and favorite shops next."
    },
    {
      title: "Khatha and payments",
      text: "Your account page is ready for khatha balance and payment tracking."
    },
    {
      title: "Hospital discovery",
      text: "Browse hospitals and send appointment requests from your customer flow."
    },
    {
      title: "Appointment tracking",
      text: "See hospital booking requests and current status from your account."
    }
  ];

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Customer space</div>
          <h1>{profile.name}'s account</h1>
          <p className="muted-copy">
            This is your dedicated customer page. We will keep expanding this with
            customer-specific features as you tell me what you want next.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Mobile</div>
          <div className="identity-value">{profile.phone}</div>
          <div className="identity-label">Area</div>
          <div className="identity-value">{profile.area || "Add locality later"}</div>
          <div className="identity-label">Roles</div>
          <div className="identity-value">{account.roles.join(", ")}</div>
        </div>
      </section>

      <section className="card-grid">
        {cards.map((card) => (
          <div key={card.title} className="soft-panel">
            <h3>{card.title}</h3>
            <p className="muted-copy">{card.text}</p>
          </div>
        ))}
      </section>

      <section className="account-actions">
        <Link className="header-pill" to="/connect">
          Open Medilink Chat
        </Link>
        <Link className="header-pill" to="/search">
          Search medicines
        </Link>
        <Link className="header-link" to="/cart">
          Open cart
        </Link>
        <Link className="header-link" to="/hospitals">
          Explore hospitals
        </Link>
        <Link className="header-link" to="/customer/appointments">
          My appointments
        </Link>
        <Link className="header-link" to="/customer/notifications">
          Notifications
        </Link>
        <Link className="header-link" to="/register/seller">
          Add seller role
        </Link>
        <Link className="header-link" to="/seller/access">
          Open any seller
        </Link>
        <Link className="header-link" to="/hospital/access">
          Open any hospital
        </Link>
      </section>
    </div>
  );
}

export default CustomerAccount;
