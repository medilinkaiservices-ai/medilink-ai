import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

/* FIREBASE CONFIG */

const firebaseConfig = {
  apiKey: "AIzaSyCOnGRbT2x8KlPTDblNsUMX5Mh8ZUZm7U0",
  authDomain: "medilink-ai-b3cf9.firebaseapp.com",
  projectId: "medilink-ai-b3cf9",
  storageBucket: "medilink-ai-b3cf9.firebasestorage.app",
  messagingSenderId: "582914813196",
  appId: "1:582914813196:web:ecf7f32058caf629f4ed29"
};

/* INITIALIZE APP */

const app = initializeApp(firebaseConfig);

/* EXPORT SERVICES */

export const auth = getAuth(app);          // Firebase Auth
export const db = getFirestore(app);       // Firestore Database
export const functions = getFunctions(app); // Cloud Functions
export const storage = getStorage(app);    // Firebase Storage
