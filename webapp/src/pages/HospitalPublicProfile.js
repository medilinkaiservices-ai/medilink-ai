import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ConnectModal from "../components/ConnectModal";
import {
  fetchHospitalAppointments,
  fetchHospitalDoctors,
  fetchHospitals,
  fetchHospitalServices
} from "../utils/hospitalApi";

function HospitalPublicProfile() {
  const { hospitalId } = useParams();
  const [hospital, setHospital] = useState(undefined);
  const [doctors, setDoctors] = useState([]);
  const [services, setServices] = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [doctorFilter, setDoctorFilter] = useState("");
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const hospitals = await fetchHospitals();
      const match = hospitals.find((item) => item.id === hospitalId);

      if (!match) {
        setHospital(null);
        return;
      }

      setHospital(match);

      const [doctorList, serviceList, appointmentList] = await Promise.all([
        fetchHospitalDoctors(hospitalId),
        fetchHospitalServices(hospitalId),
        fetchHospitalAppointments(hospitalId)
      ]);

      setDoctors(doctorList.slice(0, 4));
      setServices(serviceList.slice(0, 4));
      setQueueCount(appointmentList.length);
    };

    loadData().catch((error) => {
      console.error("Failed to load hospital public data:", error);
      setHospital(null);
    });
  }, [hospitalId]);

  if (hospital === null) {
    return <Navigate to="/hospitals" replace />;
  }

  if (hospital === undefined) {
    return <div className="page-shell"><div className="soft-panel">Loading hospital...</div></div>;
  }

  const visibleDoctors = doctors.filter((doctor) => {
    if (!doctorFilter.trim()) return true;

    const keyword = doctorFilter.trim().toLowerCase();
    return (
      (doctor.name || "").toLowerCase().includes(keyword) ||
      (doctor.specialty || "").toLowerCase().includes(keyword)
    );
  });

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Hospital profile</div>
          <h1>{hospital.hospitalName}</h1>
          <p className="muted-copy">
            {hospital.about || "Professional hospital profile for appointments, doctors and services."}
          </p>
          <div className="account-actions">
            <Link className="header-pill" to={`/hospitals/${encodeURIComponent(hospital.id)}/book`}>
              Book appointment
            </Link>
            <button className="header-link" onClick={() => setIsConnectOpen(true)}>
              Connect
            </button>
            <Link className="header-link" to="/hospitals">
              Back to hospitals
            </Link>
          </div>
        </div>
        <div className="identity-card">
          <div className="identity-label">City</div>
          <div className="identity-value">{hospital.city || "Not set"}</div>
          <div className="identity-label">Emergency</div>
          <div className="identity-value">{hospital.emergencyPhone || "Not set"}</div>
          <div className="identity-label">Timings</div>
          <div className="identity-value">
            {hospital.alwaysOpen ? "Open 24/7" : `${hospital.openTime || "--"} to ${hospital.closeTime || "--"}`}
          </div>
          <div className="identity-label">Queue size</div>
          <div className="identity-value">{queueCount}</div>
        </div>
      </section>

      <ConnectModal
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        entityName={hospital.hospitalName || "Hospital"}
        targetId={hospital.id}
        phone={hospital.phone || hospital.emergencyPhone}
        whatsappPhone={hospital.emergencyPhone || hospital.phone}
        mode="hospital"
        shareTitle={hospital.hospitalName || "Hospital"}
        defaultMessage={`Hello ${hospital.hospitalName || "hospital"}, I would like to connect regarding treatment or appointment support.`}
      />

      <section className="hospital-public-grid">
        <div className="soft-panel">
          <div className="section-title">Departments</div>
          <div className="list-row">
            <span>Ambulance support</span>
            <small>{hospital.ambulanceAvailable ? "Available" : "Not listed"}</small>
          </div>
          <div className="list-row">
            <span>Address</span>
            <small>{hospital.address || "Not added"}</small>
          </div>
          {(hospital.departments || []).map((department) => (
            <div key={department} className="list-row">
              <span>{department}</span>
              <small>Available</small>
            </div>
          ))}
          {(hospital.departments || []).length === 0 && (
            <p className="muted-copy">Department details coming soon.</p>
          )}
        </div>

        <div className="soft-panel">
          <div className="section-title">Doctors</div>
          <input
            type="text"
            value={doctorFilter}
            onChange={(event) => setDoctorFilter(event.target.value)}
            placeholder="Search doctor or specialty"
            style={{ marginBottom: "14px" }}
          />
          <div className="hospital-doctor-grid">
            {visibleDoctors.map((doctor) => (
              <div key={doctor.id} className="hospital-doctor-card">
                <div className="seller-product-head">
                  <h3>{doctor.name}</h3>
                  <span className="order-status-pill">{doctor.specialty}</span>
                </div>
                <p className="muted-copy">Experience: {doctor.experience || "Not set"}</p>
                <p className="muted-copy">Qualification: {doctor.qualification || "Not set"}</p>
                <p className="muted-copy">Timings: {doctor.timing || "Not set"}</p>
                <p className="muted-copy">
                  Fee: {doctor.fee ? `Rs. ${doctor.fee}` : "Contact hospital"}
                </p>
                <p className="muted-copy">Mode: {doctor.consultationMode || "In-person"}</p>
              </div>
            ))}
          </div>
          {doctors.length === 0 && <p className="muted-copy">Doctor directory coming soon.</p>}
          {doctors.length > 0 && visibleDoctors.length === 0 && (
            <p className="muted-copy">No doctors matched your search.</p>
          )}
        </div>

        <div className="soft-panel">
          <div className="section-title">Services</div>
          {services.map((service) => (
            <div key={service.id} className="list-row">
              <span>{service.serviceName}</span>
              <small>{service.availability || service.type || "Service"}</small>
            </div>
          ))}
          {services.length === 0 && <p className="muted-copy">Services will appear here.</p>}
        </div>
      </section>
    </div>
  );
}

export default HospitalPublicProfile;
