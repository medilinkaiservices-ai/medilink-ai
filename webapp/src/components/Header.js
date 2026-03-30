import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredAccount, getStoredProfile, setLastActiveRole } from "../utils/session";

function Header() {
  const location = useLocation();
  const [cartCount, setCartCount] = useState(0);
  const [account, setAccount] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const updateCart = () => {
      const cart = JSON.parse(localStorage.getItem("cart")) || [];
      setCartCount(cart.length);
    };

    const updateAccount = () => {
      setAccount(getStoredAccount());
    };

    updateCart();
    updateAccount();

    window.addEventListener("cartUpdated", updateCart);
    window.addEventListener("storage", updateAccount);

    return () => {
      window.removeEventListener("cartUpdated", updateCart);
      window.removeEventListener("storage", updateAccount);
    };
  }, []);

  useEffect(() => {
    setAccount(getStoredAccount());
  }, [location.pathname]);

  useEffect(() => {
    const activePhone = account?.lastActiveRole
      ? getStoredProfile(account.lastActiveRole)?.phone || account.phone
      : account?.phone;

    if (!activePhone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(
      activePhone,
      setUnreadCount,
      (error) => console.error("Failed to subscribe to header unread count:", error)
    );
  }, [account?.lastActiveRole, account?.phone]);

  const roleLinks = useMemo(() => {
    if (!account?.roles?.length) return [];

    return account.roles.map((role) => ({
      role,
      label:
        role === "seller"
          ? "Seller Space"
          : role === "hospital"
            ? "Hospital Space"
            : "Customer Account",
      to:
        role === "seller"
          ? "/seller/dashboard"
          : role === "hospital"
            ? "/hospital/dashboard"
            : "/customer/account"
    }));
  }, [account]);

  const handleRoleSwitch = (role) => {
    setLastActiveRole(role);
    setAccount(getStoredAccount());
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(16px)",
        background: "rgba(245, 247, 251, 0.92)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.2)"
      }}
    >
      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap"
        }}
      >
        <Link
          to="/"
          style={{
            textDecoration: "none",
            color: "#0f172a",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}
        >
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #0f766e, #14b8a6)",
              color: "white",
              display: "grid",
              placeItems: "center",
              fontWeight: 700
            }}
          >
            M
          </div>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>Medilink AI</div>
            <div style={{ fontSize: "12px", color: "#475569" }}>
              Customer and seller marketplace
            </div>
          </div>
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            justifyContent: "flex-end"
          }}
        >
          <Link className="header-link" to="/search">
            Search
          </Link>
          <Link className="header-link" to="/cart">
            Cart ({cartCount})
          </Link>
          {!account && (
            <>
              <Link className="header-link" to="/register/customer">
                Join Customer
              </Link>
              <Link className="header-link" to="/register/hospital">
                Join Hospital
              </Link>
              <Link className="header-pill" to="/register/seller">
                Join Seller
              </Link>
            </>
          )}
          {account && (
            <>
              <Link className="header-link" to="/connect">
                Medilink Chat{unreadCount > 0 ? ` (${unreadCount})` : ""}
              </Link>
              <Link className="header-link" to="/customer/notifications">
                Alerts
              </Link>
              {roleLinks.map((link) => (
                <Link
                  key={link.role}
                  className="header-link"
                  to={link.to}
                  onClick={() => handleRoleSwitch(link.role)}
                >
                  {link.label}
                </Link>
              ))}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "999px",
                  background: "#e2e8f0",
                  color: "#0f172a",
                  fontSize: "13px",
                  fontWeight: 600
                }}
              >
                {account.name || account.phone}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Header;
