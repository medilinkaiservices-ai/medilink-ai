import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

function getCurrentUid() {
  return auth.currentUser?.uid || null;
}

export async function upsertCustomerProfile(profile) {
  const phone = String(profile.phone || "").replace(/\D/g, "").slice(-10);

  if (!phone) {
    throw new Error("Customer phone is required.");
  }

  await setDoc(
    doc(db, "customers", phone),
    {
      uid: profile.uid || getCurrentUid() || "",
      name: profile.name || "",
      phone,
      email: profile.email || "",
      area: profile.area || "",
      authProvider: profile.authProvider || "local",
      otpVerified: Boolean(profile.otpVerified),
      updatedAt: serverTimestamp(),
      createdAt: profile.joinedAt ? profile.joinedAt : serverTimestamp()
    },
    { merge: true }
  );
}

export async function fetchCustomers() {
  try {
    const snapshot = await getDocs(collection(db, "customers"));
    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return [];
  }
}
