import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredProfile } from "../utils/session";

const navItems = [
  { to: "/hospital/dashboard", label: "Overview" },
  { to: "/hospital/inbox", label: "Chat box" },
  { to: "/hospital/profile", label: "Profile" },
  { to: "/hospital/doctors", label: "Doctors" },
  { to: "/hospital/services", label: "Services" },
  { to: "/hospital/appointments", label: "Appointments" },
  { to: "/hospital/qr", label: "QR code" }
];

function HospitalShell({ title, subtitle, actions, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const profile = getStoredProfile("hospital");
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!profile?.phone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(profile.phone, setUnreadCount, (error) =>
      console.error("Failed to subscribe to hospital unread count:", error)
    );
  }, [profile?.phone]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!profile) return <Navigate to="/hospital/access" replace />;

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/hospital/dashboard");
  };

  return (
    <div className="page-shell">
      <div className="seller-layout premium-seller-layout">
        <aside className="seller-sidebar premium-seller-sidebar">
          <div className={menuOpen ? "hospital-mobile-nav-backdrop active" : "hospital-mobile-nav-backdrop"} onClick={() => setMenuOpen(false)} />

          <div className={menuOpen ? "hospital-mobile-nav-panel active" : "hospital-mobile-nav-panel"}>
          <div className="shell-section-label">Workspace</div>
          <nav className="seller-nav premium-seller-nav">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              const label = item.to === "/hospital/inbox" && unreadCount > 0 ? `${item.label} (${unreadCount})` : item.label;
              return <Link key={item.to} className={isActive ? "hospital-nav-link active" : "hospital-nav-link"} to={item.to}>{label}</Link>;
            })}
          </nav>
          </div>
        </aside>

        <main className="seller-main">
          <div className="seller-topbar premium-seller-topbar">
            <div className="hospital-shell-titleblock">
              <div className="eyebrow">Hospital workspace</div>
              <div className="hospital-shell-name">{profile.hospitalName || profile.name}</div>
              <h1>{title}</h1>
              {subtitle && <p className="muted-copy">{subtitle}</p>}
            </div>
            <div className="seller-top-actions hospital-shell-actions">
              <button
                type="button"
                className="hospital-mobile-menu-button"
                onClick={() => setMenuOpen((current) => !current)}
              >
                {menuOpen ? "Close menu" : "Menu"}
              </button>
              <button type="button" className="hospital-simple-back" onClick={handleBack}>
                Back
              </button>
              {actions}
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export default HospitalShell;
