import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHospitals } from "../utils/hospitalApi";

function HospitalsPage() {
  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState([]);

  useEffect(() => {
    fetchHospitals()
      .then(setDirectory)
      .catch((error) => console.error("Failed to load hospitals:", error));
  }, []);

  const filteredHospitals = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return directory;

    return directory.filter((hospital) => {
      const name = (hospital.hospitalName || "").toLowerCase();
      const city = (hospital.city || "").toLowerCase();
      const departments = (hospital.departments || []).join(" ").toLowerCase();

      return (
        name.includes(keyword) ||
        city.includes(keyword) ||
        departments.includes(keyword)
      );
    });
  }, [directory, search]);

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Hospital discovery</div>
          <h1>Browse hospitals professionally</h1>
          <p className="muted-copy">
            Search hospitals, emergency contacts and departments from one clean directory.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Total hospitals</div>
          <div className="identity-value">{filteredHospitals.length}</div>
          <div className="identity-label">Focus</div>
          <div className="identity-value">Departments and appointments</div>
        </div>
      </section>

      <div className="seller-products-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search hospital, city or department"
        />
      </div>

      <section className="hospital-public-grid">
        {filteredHospitals.map((hospital) => (
          <Link
            key={hospital.id}
            className="hospital-card action-card"
            to={`/hospitals/${encodeURIComponent(hospital.id)}`}
          >
            <div className="eyebrow">Hospital profile</div>
            <h3>{hospital.hospitalName}</h3>
            <p className="muted-copy">{hospital.about || "Professional care profile."}</p>
            <p className="muted-copy">City: {hospital.city || "Not set"}</p>
            <p className="muted-copy">
              Departments: {(hospital.departments || []).join(", ") || "General care"}
            </p>
            <span className="card-cta">Open hospital</span>
          </Link>
        ))}
      </section>
    </div>
  );
}

export default HospitalsPage;
