import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ConnectModal from "../components/ConnectModal";
import Chatbot from "../components/Chatbot";
import { fetchHospitalAppointments, fetchHospitalDoctors, fetchHospitals, fetchHospitalServices } from "../utils/hospitalApi";

function HospitalPublicProfile() {
  const { hospitalId } = useParams();
  const [hospital, setHospital] = useState(undefined);
  const [doctors, setDoctors] = useState([]);
  const [services, setServices] = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const timingLabel = hospital?.alwaysOpen ? "Open 24/7" : `${hospital?.openTime || "--"} to ${hospital?.closeTime || "--"}`;
  const locationLabel = [hospital?.address, hospital?.city].filter(Boolean).join(", ");
  const departmentHighlights = (hospital?.departments || []).slice(0, 4);

  const hospitalContext = {
    hospitalName: hospital?.hospitalName || "this Hospital",
    services: services.length > 0 ? services.map(s => `${s.serviceName} (${s.availability || "Available"})`) : ["Services info coming soon."],
    doctors: doctors.map(d => ({
      name: d.name,
      specialty: d.specialty,
      timings: d.timing // Map 'timing' to 'timings' for backend compatibility
    })),
    timings: timingLabel,
    location: locationLabel,
    departments: hospital?.departments || [],
    hospitalId: hospital?.id || hospitalId,
    appointmentAvailability: `${queueCount} appointments in queue.`,
    assistantMode: "hybrid"
  };

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

  if (hospital === null) return <Navigate to="/hospitals" replace />;
  if (hospital === undefined) return <div className="page-shell"><div className="soft-panel">Loading hospital...</div></div>;

  return (
    <div className="page-shell hospital-public-shell">
      <section className="account-hero hospital-public-hero premium-hospital-public-hero">
        <div className="hospital-public-hero-main">
          <div className="hospital-public-kicker-row">
            <div className="eyebrow">Hospital profile</div>
            <span className="hospital-public-live-pill">{hospital.alwaysOpen ? "24/7 care" : "Appointments open"}</span>
          </div>
          <h1>{hospital.hospitalName}</h1>
          <p className="muted-copy">{hospital.about || "Trusted hospital support for appointments, consultations, diagnostics, and treatment guidance."}</p>
          <div className="hospital-public-quickfacts">
            <div className="hospital-public-quickfact">
              <span>Timings</span>
              <strong>{timingLabel}</strong>
            </div>
            <div className="hospital-public-quickfact">
              <span>Emergency</span>
              <strong>{hospital.emergencyPhone || "Call hospital"}</strong>
            </div>
            <div className="hospital-public-quickfact">
              <span>Location</span>
              <strong>{hospital.city || "Ask hospital"}</strong>
            </div>
          </div>
          <div className="account-actions hospital-public-actions">
            <Link className="header-pill" to={`/hospitals/${encodeURIComponent(hospital.id)}/book`}>Book appointment</Link>
            <button className="header-link" onClick={() => setIsConnectOpen(true)}>Call or WhatsApp</button>
            <Link className="header-link" to="/hospitals">Back to hospitals</Link>
          </div>
          {departmentHighlights.length ? (
            <div className="hospital-public-departments">
              {departmentHighlights.map((department) => (
                <span key={department} className="hospital-public-department-chip">{department}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="identity-card hospital-public-summary premium-hospital-public-summary">
          <div className="hospital-public-summary-note">
            <span>Address</span>
            <strong>{locationLabel || "Address not added"}</strong>
          </div>
          <div className="hospital-public-summary-note">
            <span>Ambulance</span>
            <strong>{hospital.ambulanceAvailable ? "Available" : "Not listed"}</strong>
          </div>
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

      <section className="hospital-public-grid hospital-public-grid-premium">
        <div className="soft-panel hospital-public-card hospital-public-card-featured">
          <div className="hospital-public-card-head">
            <div>
              <div className="section-title">Doctors</div>
              <p className="muted-copy">Choose the right specialty and timing before booking.</p>
            </div>
            <Link className="header-link" to={`/hospitals/${encodeURIComponent(hospital.id)}/book`}>Book now</Link>
          </div>
          <div className="hospital-doctor-grid">
            {doctors.map((doctor) => (
              <div key={doctor.id} className="hospital-doctor-card premium-hospital-doctor-card">
                <div className="hospital-public-doctor-head">
                  <div className="hospital-public-doctor-avatar">
                    {doctor.photoUrl || doctor.imageUrl ? (
                      <img src={doctor.photoUrl || doctor.imageUrl} alt={doctor.name || "Doctor"} className="hospital-public-doctor-image" />
                    ) : (
                      <span>{(doctor.name || "D").slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="hospital-public-doctor-copy">
                    <h3>{doctor.name}</h3>
                    <span className="order-status-pill">{doctor.specialty || "Specialist"}</span>
                  </div>
                </div>
                <p className="muted-copy">Qualification: {doctor.qualification || "Not set"}</p>
                <p className="muted-copy">Timings: {doctor.timing || "Not set"}</p>
                <p className="muted-copy">Fee: {doctor.fee ? `Rs. ${doctor.fee}` : "Contact hospital"}</p>
              </div>
            ))}
          </div>
          {doctors.length === 0 && <p className="muted-copy">Doctor directory coming soon.</p>}
        </div>

        <div className="soft-panel hospital-public-card">
          <div className="hospital-public-card-head">
            <div>
              <div className="section-title">Services & departments</div>
              <p className="muted-copy">Fast overview of consultations, diagnostics, and treatment areas.</p>
            </div>
          </div>
          {services.map((service) => <div key={service.id} className="list-row"><span>{service.serviceName}</span><small>{service.availability || service.type || "Service"}</small></div>)}
          {departmentHighlights.map((department) => <div key={department} className="list-row"><span>{department}</span><small>Department</small></div>)}
          {services.length === 0 && departmentHighlights.length === 0 ? <p className="muted-copy">Services will appear here.</p> : null}
        </div>

        <div className="soft-panel hospital-public-card">
          <div className="hospital-public-card-head">
            <div>
              <div className="section-title">Hospital details</div>
              <p className="muted-copy">Useful contact and visit information for patients and families.</p>
            </div>
          </div>
          <div className="list-row"><span>Emergency number</span><small>{hospital.emergencyPhone || "Not listed"}</small></div>
          <div className="list-row"><span>General contact</span><small>{hospital.phone || "Not listed"}</small></div>
          <div className="list-row"><span>Timings</span><small>{timingLabel}</small></div>
          <div className="list-row"><span>Ambulance support</span><small>{hospital.ambulanceAvailable ? "Available" : "Not listed"}</small></div>
          <div className="list-row"><span>Address</span><small>{locationLabel || "Not added"}</small></div>
        </div>
      </section>
      <Chatbot role="hospital" contextData={hospitalContext} floating />
    </div>
  );
}

export default HospitalPublicProfile;
