import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearStoredSession, getStoredAccount, getStoredProfile, setLastActiveRole } from "../utils/session";
import { logoutPhoneAuth } from "../utils/phoneAuth";

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [hospitalProfile, setHospitalProfile] = useState(null);
  const [sellerProfile, setSellerProfile] = useState(null);

  useEffect(() => {
    const updateAccount = () => {
      setAccount(getStoredAccount());
      setHospitalProfile(getStoredProfile("hospital"));
      setSellerProfile(getStoredProfile("seller"));
    };

    updateAccount();

    window.addEventListener("storage", updateAccount);

    return () => {
      window.removeEventListener("storage", updateAccount);
    };
  }, []);

  useEffect(() => {
    setAccount(getStoredAccount());
    setHospitalProfile(getStoredProfile("hospital"));
    setSellerProfile(getStoredProfile("seller"));
  }, [location.pathname]);

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

  const activeRoleLabel = useMemo(() => {
    if (account?.lastActiveRole === "seller") return "Seller workspace";
    if (account?.lastActiveRole === "hospital") return "Hospital workspace";
    if (account?.lastActiveRole === "customer") return "Customer workspace";
    return "Workspace";
  }, [account?.lastActiveRole]);

  const activeWorkspaceName = useMemo(() => {
    if (account?.lastActiveRole === "hospital") {
      return hospitalProfile?.hospitalName || hospitalProfile?.name || "";
    }
    if (account?.lastActiveRole === "seller") {
      return sellerProfile?.shopName || sellerProfile?.name || "";
    }
    return "";
  }, [account?.lastActiveRole, hospitalProfile, sellerProfile]);

  const workspaceLabel = account?.lastActiveRole === "seller" ? "Seller workspace" : "Hospital workspace";

  const handleRoleSwitch = (role) => {
    setLastActiveRole(role);
    setAccount(getStoredAccount());
  };

  const handleLogout = async () => {
    try {
      await logoutPhoneAuth();
    } catch (error) {
      console.error("Logout issue:", error);
    } finally {
      clearStoredSession();
      setAccount(null);
      navigate("/");
    }
  };

  const hiddenHeaderRoutes = [
    /^\/$/,
    /^\/search$/,
    /^\/shop\/[^/]+$/,
    /^\/hospitals\/[^/]+$/
  ];

  if (hiddenHeaderRoutes.some((pattern) => pattern.test(location.pathname))) {
    return null;
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(16px)",
        background: "linear-gradient(180deg, rgba(247, 250, 252, 0.96), rgba(241, 246, 255, 0.92))",
        borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
        boxShadow: "0 14px 34px rgba(15, 23, 42, 0.05)"
      }}
    >
      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "16px 16px 14px",
          display: "grid",
          gap: "14px"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px"
          }}
        >
          <Link
            to="/"
            style={{
              textDecoration: "none",
              color: "#0f172a",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              minWidth: 0
            }}
          >
            <div
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "18px",
                background: "linear-gradient(135deg, #0f766e, #14b8a6)",
                color: "white",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                boxShadow: "0 14px 26px rgba(20, 184, 166, 0.24)"
              }}
            >
              M
            </div>
            <div style={{ minWidth: 0 }}>
              {activeWorkspaceName ? (
                <>
                  <div
                    style={{
                      fontSize: "29px",
                      fontWeight: 800,
                      color: "#0f766e",
                      lineHeight: 1.02,
                      letterSpacing: "-0.04em",
                      textWrap: "balance"
                    }}
                  >
                    {activeWorkspaceName}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      fontWeight: 800,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      marginTop: "5px"
                    }}
                  >
                    {workspaceLabel}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.03em" }}>Medilink AI</div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", fontWeight: 700 }}>
                    {activeRoleLabel}
                  </div>
                </>
              )}
            </div>
          </Link>

          {account ? (
            <div
              style={{
                padding: "11px 16px",
                borderRadius: "20px",
                background: "linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(226, 236, 255, 0.92))",
                color: "#0f172a",
                fontSize: "14px",
                fontWeight: 800,
                letterSpacing: "0.01em",
                border: "1px solid rgba(59, 130, 246, 0.12)",
                boxShadow: "0 12px 22px rgba(37, 99, 235, 0.06)",
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
            >
              <strong style={{ fontWeight: 800 }}>{account.name || account.phone}</strong>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "nowrap",
            overflowX: "auto",
            paddingBottom: "4px"
          }}
        >
          <Link className="header-link" to="/">
            Home
          </Link>
          {!account && (
            <>
              <Link className="header-link" to="/register/customer">
                Join Customer
              </Link>
              <Link className="header-link" to="/login">
                Login OTP
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
              {account.lastActiveRole === "customer" ? (
                <Link className="header-link" to="/customer/notifications">
                  Hospital Alerts
                </Link>
              ) : null}
              <div className="role-switcher" style={{ position: "relative", flexShrink: 0 }}>
                <select
                  style={{
                    minWidth: "146px",
                    padding: "11px 36px 11px 16px",
                    borderRadius: "20px",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "linear-gradient(135deg, #ffffff, #eef4ff)",
                    color: "#0f172a",
                    fontWeight: 700,
                    fontSize: "14px",
                    boxShadow: "0 12px 24px rgba(15, 23, 42, 0.06)",
                    outline: "none",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    cursor: "pointer"
                  }}
                  value={account.lastActiveRole || ""}
                  onChange={(e) => {
                    const selected = roleLinks.find((link) => link.role === e.target.value);
                    if (selected) {
                      handleRoleSwitch(selected.role);
                      navigate(selected.to);
                    }
                  }}
                >
                  <option value="" disabled>Switch Space</option>
                  {roleLinks.map((link) => (
                    <option key={link.role} value={link.role}>
                      {link.label}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    position: "absolute",
                    right: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                    color: "#334155",
                    fontSize: "12px",
                    fontWeight: 900
                  }}
                >
                  â–¾
                </span>
              </div>
              <button
                onClick={handleLogout}
                type="button"
                style={{
                  padding: "11px 16px",
                  borderRadius: "20px",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "linear-gradient(135deg, #ffffff, #fff1f2)",
                  color: "#0f172a",
                  fontSize: "14px",
                  fontWeight: 700,
                  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.05)",
                  flexShrink: 0
                }}
              >
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Header;
