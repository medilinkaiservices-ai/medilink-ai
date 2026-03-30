const DOCTORS_KEY = "medilinkHospitalDoctors";
const SERVICES_KEY = "medilinkHospitalServices";
const APPOINTMENTS_KEY = "medilinkHospitalAppointments";
const DIRECTORY_KEY = "medilinkHospitalDirectory";

function readList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch (error) {
    console.error(`Unable to read ${key}`, error);
    return [];
  }
}

function writeList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getHospitalDoctors() {
  return readList(DOCTORS_KEY);
}

export function saveHospitalDoctors(doctors) {
  writeList(DOCTORS_KEY, doctors);
}

export function getHospitalServices() {
  return readList(SERVICES_KEY);
}

export function saveHospitalServices(services) {
  writeList(SERVICES_KEY, services);
}

export function getHospitalAppointments() {
  return readList(APPOINTMENTS_KEY);
}

export function saveHospitalAppointments(appointments) {
  writeList(APPOINTMENTS_KEY, appointments);
}

export function getHospitalDirectory() {
  return readList(DIRECTORY_KEY);
}

export function saveHospitalDirectory(directory) {
  writeList(DIRECTORY_KEY, directory);
}
