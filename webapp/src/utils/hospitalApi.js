import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { auth, db } from "../firebase";

function getCurrentUid() {
  return auth.currentUser?.uid || null;
}

export async function createHospital(profile) {
  const ref = await addDoc(collection(db, "hospitals"), {
    ownerUid: getCurrentUid() || "guest",
    hospitalName: profile.hospitalName,
    adminName: profile.name,
    phone: profile.phone,
    city: profile.city || "",
    emergencyPhone: profile.emergencyPhone || "",
    departments: profile.departments || [],
    about: profile.about || "",
    address: profile.address || "",
    openTime: profile.openTime || "",
    closeTime: profile.closeTime || "",
    alwaysOpen: Boolean(profile.alwaysOpen),
    ambulanceAvailable: Boolean(profile.ambulanceAvailable),
    integrationConfig: profile.integrationConfig || null,
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateHospitalProfile(hospitalId, profile) {
  await updateDoc(doc(db, "hospitals", hospitalId), {
    ownerUid: getCurrentUid() || profile.ownerUid || "guest",
    hospitalName: profile.hospitalName,
    adminName: profile.name,
    phone: profile.phone,
    city: profile.city || "",
    emergencyPhone: profile.emergencyPhone || "",
    departments: profile.departments || [],
    about: profile.about || "",
    address: profile.address || "",
    openTime: profile.openTime || "",
    closeTime: profile.closeTime || "",
    alwaysOpen: Boolean(profile.alwaysOpen),
    ambulanceAvailable: Boolean(profile.ambulanceAvailable),
    integrationConfig: profile.integrationConfig || null,
    updatedAt: serverTimestamp()
  });
}

export async function fetchHospitals() {
  try {
    const snapshot = await getDocs(collection(db, "hospitals"));
    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch hospitals:", error);
    return [];
  }
}

export async function fetchHospitalDoctors(hospitalId) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "hospitalDoctors"), where("hospitalId", "==", hospitalId))
    );

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch hospital doctors:", error);
    return [];
  }
}

export async function createHospitalDoctor(hospitalId, doctor) {
  const ref = await addDoc(collection(db, "hospitalDoctors"), {
    hospitalId,
    ownerUid: getCurrentUid() || "guest",
    ...doctor,
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function deleteHospitalDoctor(doctorId) {
  await deleteDoc(doc(db, "hospitalDoctors", doctorId));
}

export async function fetchHospitalServices(hospitalId) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "hospitalServices"), where("hospitalId", "==", hospitalId))
    );

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch hospital services:", error);
    return [];
  }
}

export async function createHospitalService(hospitalId, service) {
  const ref = await addDoc(collection(db, "hospitalServices"), {
    hospitalId,
    ownerUid: getCurrentUid() || "guest",
    ...service,
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function deleteHospitalService(serviceId) {
  await deleteDoc(doc(db, "hospitalServices", serviceId));
}

export async function fetchHospitalAppointments(hospitalId) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "hospitalAppointments"), where("hospitalId", "==", hospitalId))
    );

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch hospital appointments:", error);
    return [];
  }
}

export async function createHospitalAppointment(appointment) {
  const ref = await addDoc(collection(db, "hospitalAppointments"), {
    ...appointment,
    ownerUid: getCurrentUid() || appointment.ownerUid || "guest",
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateHospitalAppointmentStatus(appointmentId, status) {
  await updateDoc(doc(db, "hospitalAppointments", appointmentId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export async function updateHospitalAppointment(appointmentId, patch) {
  await updateDoc(doc(db, "hospitalAppointments", appointmentId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function fetchAppointmentsByPhone(phone) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "hospitalAppointments"), where("bookedByPhone", "==", phone))
    );

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch appointments by phone:", error);
    return [];
  }
}

function normalizePatientLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPatientSummaryId(hospitalId, patientName, patientPhone) {
  return [hospitalId, normalizePatientLookupValue(patientName), String(patientPhone || "").replace(/\D/g, "").slice(-10)]
    .filter(Boolean)
    .join("__")
    .replace(/\s+/g, "-");
}

export async function saveHospitalPatientSummary({
  hospitalId,
  hospitalName,
  patientName,
  patientPhone,
  patientAge,
  patientGender,
  patientNotes,
  latestMessage,
  aiReply,
  report
}) {
  const cleanPatientName = String(patientName || "").trim();
  if (!hospitalId || !cleanPatientName) {
    throw new Error("hospitalId and patientName are required to save patient summary.");
  }

  const summaryId = buildPatientSummaryId(hospitalId, cleanPatientName, patientPhone);
  const ref = doc(db, "hospitalPatientSummaries", summaryId);

  await setDoc(ref, {
    hospitalId,
    hospitalName: hospitalName || "",
    patientName: cleanPatientName,
    patientPhone: String(patientPhone || "").trim(),
    patientAge: String(patientAge || "").trim(),
    patientGender: String(patientGender || "").trim(),
    patientNotes: String(patientNotes || "").trim(),
    patientLookupName: normalizePatientLookupValue(cleanPatientName),
    latestMessage: String(latestMessage || "").trim(),
    aiReply: String(aiReply || "").trim(),
    summaryText: String(report?.summaryText || "").trim(),
    urgency: String(report?.urgency || "Routine").trim(),
    recommendedDepartment: String(report?.recommendedDepartment || "").trim(),
    reportedSymptoms: Array.isArray(report?.reportedSymptoms) ? report.reportedSymptoms : [],
    possibleConditions: Array.isArray(report?.possibleConditions) ? report.possibleConditions : [],
    effects: Array.isArray(report?.effects) ? report.effects : [],
    precautions: Array.isArray(report?.precautions) ? report.precautions : [],
    followUpQuestions: Array.isArray(report?.followUpQuestions) ? report.followUpQuestions : [],
    redFlags: Array.isArray(report?.redFlags) ? report.redFlags : [],
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    ownerUid: getCurrentUid() || "guest"
  }, { merge: true });

  await addDoc(collection(db, "hospitalAiReports"), {
    hospitalId,
    hospitalName: hospitalName || "",
    patientName: cleanPatientName,
    patientPhone: String(patientPhone || "").trim(),
    patientAge: String(patientAge || "").trim(),
    patientGender: String(patientGender || "").trim(),
    patientNotes: String(patientNotes || "").trim(),
    latestMessage: String(latestMessage || "").trim(),
    aiReply: String(aiReply || "").trim(),
    report: report || {},
    summaryId,
    ownerUid: getCurrentUid() || "guest",
    createdAt: serverTimestamp()
  });

  return summaryId;
}

export async function fetchHospitalPatientSummaries(hospitalId) {
  try {
    const snapshot = await getDocs(
      query(collection(db, "hospitalPatientSummaries"), where("hospitalId", "==", hospitalId), limit(20))
    );

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch hospital patient summaries:", error);
    return [];
  }
}
