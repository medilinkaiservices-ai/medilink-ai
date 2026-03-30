import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

export async function fetchWholesaleBillByNumber(billNumber) {
  const cleanBillNumber = String(billNumber || "").trim();
  if (!cleanBillNumber) return null;

  const snapshot = await getDocs(
    query(collection(db, "wholesaleBills"), where("billNumber", "==", cleanBillNumber))
  );

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data()
  };
}
