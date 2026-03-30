import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "../firebase";

export async function createHospital(profile) {
  const ref = await addDoc(collection(db, "hospitals"), {
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
    createdAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateHospitalProfile(hospitalId, profile) {
  await updateDoc(doc(db, "hospitals", hospitalId), {
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
