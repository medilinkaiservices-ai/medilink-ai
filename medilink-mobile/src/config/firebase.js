import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCOnGRbT2x8KlPTDblNsUMX5Mh8ZUZm7U0",
  authDomain: "medilink-ai-b3cf9.firebaseapp.com",
  projectId: "medilink-ai-b3cf9",
  storageBucket: "medilink-ai-b3cf9.firebasestorage.app",
  messagingSenderId: "582914813196",
  appId: "1:582914813196:web:ecf7f32058caf629f4ed29"
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp);
export const storage = getStorage(firebaseApp);

export const FIREBASE_PROJECT = firebaseConfig.projectId;
