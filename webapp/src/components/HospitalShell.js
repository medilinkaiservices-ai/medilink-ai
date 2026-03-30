import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { subscribeToUnreadCount } from "../utils/chatApi";
import { getStoredProfile } from "../utils/session";

const navItems = [
  { to: "/hospital/dashboard", label: "Overview" },
  { to: "/hospital/inbox", label: "Inbox" },
  { to: "/hospital/profile", label: "Profile" },
  { to: "/hospital/doctors", label: "Doctors" },
  { to: "/hospital/services", label: "Services" },
  { to: "/hospital/appointments", label: "Appointments" }
];

function HospitalShell({ title, subtitle, actions, children }) {
  const location = useLocation();
  const profile = getStoredProfile("hospital");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profile?.phone) {
      setUnreadCount(0);
      return undefined;
    }

    return subscribeToUnreadCount(
      profile.phone,
      setUnreadCount,
      (error) => console.error("Failed to subscribe to hospital unread count:", error)
    );
  }, [profile?.phone]);

  if (!profile) {
    return <Navigate to="/hospital/access" replace />;
  }

  return (
    <div className="page-shell">
      <div className="seller-layout">
        <aside className="seller-sidebar">
          <div className="hospital-sidebar-card">
            <div className="eyebrow">Hospital workspace</div>
            <h2>{profile.hospitalName || profile.name}</h2>
            <p className="muted-copy">
              Manage hospital identity, services, doctors and appointment readiness.
            </p>
          </div>

          <nav className="seller-nav">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              const label = item.to === "/hospital/inbox" && unreadCount > 0
                ? `${item.label} (${unreadCount})`
                : item.label;

              return (
                <Link
                  key={item.to}
                  className={isActive ? "hospital-nav-link active" : "hospital-nav-link"}
                  to={item.to}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="seller-main">
          <div className="seller-topbar">
            <div>
              <div className="eyebrow">Hospital side</div>
              <h1>{title}</h1>
              {subtitle && <p className="muted-copy">{subtitle}</p>}
            </div>
            {actions && <div className="seller-top-actions">{actions}</div>}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

export default HospitalShell;
