import React, { useState, useEffect } from "react";
import Chatbot from "../webapp/src/components/Chatbot";
import { getStoredProfile } from "../utils/session";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase"; // Assuming firebase.js is correctly configured

function HospitalDashboard() {
  const profile = getStoredProfile("hospital");
  const [hospitalDoctors, setHospitalDoctors] = useState([]);
  const [hospitalServices, setHospitalServices] = useState([]);
  const [hospitalAppointments, setHospitalAppointments] = useState([]);

  useEffect(() => {
    const fetchHospitalData = async () => {
      if (profile?.hospitalId) {
        // Fetch doctors
        const doctorsQuery = query(collection(db, "hospitalDoctors"), where("hospitalId", "==", profile.hospitalId));
        const doctorSnapshot = await getDocs(doctorsQuery);
        const doctorsList = doctorSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setHospitalDoctors(doctorsList);

        // Fetch services
        const servicesQuery = query(collection(db, "hospitalServices"), where("hospitalId", "==", profile.hospitalId));
        const serviceSnapshot = await getDocs(servicesQuery);
        const servicesList = serviceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setHospitalServices(servicesList);

        // Fetch appointments
        const appointmentsQuery = query(collection(db, "hospitalAppointments"), where("hospitalId", "==", profile.hospitalId));
        const appointmentSnapshot = await getDocs(appointmentsQuery);
        const appointmentsList = appointmentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setHospitalAppointments(appointmentsList);
      }
    };
    fetchHospitalData();
  }, [profile?.hospitalId]);

  const hospitalContext = {
    hospitalName: profile?.hospitalName || "Your Hospital",
    services: hospitalServices.map(s => `${s.serviceName} (${s.department})`).join(', ') || "No services listed.",
    doctors: hospitalDoctors.map(d => `${d.name} (${d.specialty}, ${d.timing})`).join(', ') || "No doctors listed.",
    timings: `${profile?.openTime || '9:00 AM'} - ${profile?.closeTime || '5:00 PM'}`,
    appointmentAvailability: hospitalAppointments.filter(a => a.status === "Pending review").length > 0 ? "Pending appointments" : "No pending appointments"
  };

  return (
    <div className="page-shell">
      <div className="soft-panel">
        <h1>Hospital Dashboard</h1>
        <p>Welcome, {profile?.hospitalName || profile?.name}!</p>
      </div>
      <div style={{ marginTop: "20px" }}>
        <h2>Hospital Assistant</h2>
        <Chatbot role="hospital" contextData={hospitalContext} />
      </div>
    </div>
  );
}

export default HospitalDashboard;