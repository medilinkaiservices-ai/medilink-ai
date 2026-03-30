import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchHospitals } from "../utils/hospitalApi";
import { activateDevelopmentRole } from "../utils/session";

function HospitalAccess() {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState("");

  useEffect(() => {
    const loadHospitals = async () => {
      try {
        const list = await fetchHospitals();
        setHospitals(list);
      } catch (error) {
        console.error("Failed to load hospital access list:", error);
        setHospitals([]);
      }
    };

    loadHospitals();
  }, []);

  const visibleHospitals = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return hospitals;

    return hospitals.filter((hospital) => {
      return (
        (hospital.hospitalName || "").toLowerCase().includes(keyword) ||
        (hospital.adminName || "").toLowerCase().includes(keyword) ||
        (hospital.city || "").toLowerCase().includes(keyword) ||
        (hospital.phone || "").includes(keyword) ||
        (hospital.emergencyPhone || "").includes(keyword)
      );
    });
  }, [hospitals, search]);

  const handleOpenHospital = (hospital) => {
    setOpeningId(hospital.id);

    activateDevelopmentRole("hospital", {
      name: hospital.adminName || "Hospital admin",
      phone: hospital.phone || hospital.emergencyPhone || "",
      hospitalName: hospital.hospitalName || "Hospital",
      city: hospital.city || "",
      emergencyPhone: hospital.emergencyPhone || "",
      departments: hospital.departments || [],
      hospitalId: hospital.id
    });

    navigate("/hospital/dashboard");
  };

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Development hospital access</div>
          <h1>Open any hospital workspace</h1>
          <p className="muted-copy">
            During development you can jump into any hospital panel, inspect profile,
            doctors, services and appointments without separate login.
          </p>
          <div className="account-actions">
            <Link className="header-link" to="/customer/account">
              Back to customer account
            </Link>
          </div>
        </div>
        <div className="auth-card">
          <label>
            Search hospital
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Hospital name, admin, city or phone"
            />
          </label>
          <div className="muted-copy">
            {visibleHospitals.length} hospital workspaces available in this development view.
          </div>
        </div>
      </section>

      <section className="seller-product-grid">
        {visibleHospitals.map((hospital) => (
          <div key={hospital.id} className="soft-panel seller-product-card">
            <div className="seller-product-head">
              <h3>{hospital.hospitalName || "Hospital"}</h3>
              <span className="order-status-pill">hospital</span>
            </div>
            <p className="muted-copy">
              Admin: {hospital.adminName || "Not set"}<br />
              Phone: {hospital.phone || "Not set"}<br />
              City: {hospital.city || "Not set"}
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={openingId === hospital.id}
              onClick={() => handleOpenHospital(hospital)}
            >
              {openingId === hospital.id ? "Opening..." : "Open hospital workspace"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default HospitalAccess;
