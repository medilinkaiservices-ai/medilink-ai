import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getRoleHomePath, getStoredAccount, setLastActiveRole } from "../utils/session";

function RoleSelect() {
  const navigate = useNavigate();
  const account = getStoredAccount();

  if (!account) {
    return <Navigate to="/login" replace />;
  }

  if (!account.roles?.length) {
    return <Navigate to="/law-assistant" replace />;
  }

  if (account.roles.length === 1) {
    return <Navigate to={getRoleHomePath(account.roles[0])} replace />;
  }

  const roleCards = account.roles.map((role) => ({
    role,
    title:
      role === "seller"
        ? "Seller Space"
        : role === "hospital"
          ? "Hospital Space"
          : role === "lawyer"
            ? "Lawyer Workspace"
            : role === "public"
              ? "Public Legal Help"
          : "Customer Space",
    description:
      role === "seller"
        ? "Manage your shop profile, products, offers, and seller QR."
        : role === "hospital"
          ? "Open hospital operations, appointments, and hospital QR."
          : role === "lawyer"
            ? "Run legal research, drafting, case analysis, workflow, and smart memory."
            : role === "public"
              ? "Ask legal questions in simple language with step-by-step guidance."
          : "Access your customer account, orders, hospitals, and customer QR."
  }));

  return (
    <div className="page-shell">
      <div className="auth-layout">
        <div>
          <div className="eyebrow">Choose your role</div>
          <h1>Open the right Medilink AI space</h1>
          <p className="muted-copy">
            One OTP login can hold customer, seller, hospital, public legal, and lawyer access together.
          </p>
        </div>

        <div className="feature-stack">
          {roleCards.map((item) => (
            <button
              key={item.role}
              type="button"
              className="soft-panel"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                setLastActiveRole(item.role);
                navigate(getRoleHomePath(item.role));
              }}
            >
              <div className="section-title">{item.title}</div>
              <div className="muted-copy">{item.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RoleSelect;
