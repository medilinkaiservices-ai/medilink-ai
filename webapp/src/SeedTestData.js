import { db } from "./firebase";
import { doc, setDoc } from "firebase/firestore";

export const seedShops = async () => {
  try {
    for (let i = 1; i <= 20; i++) {
      await setDoc(doc(db, "sellers", `shop${i}`), {
        shopName: `Test Shop ${i}`,
        ownerName: `Owner ${i}`,
        ownerPhone: `90000000${i}`,
        address: "Main Area",
        city: "Mahabubabad",
        description: "Auto generated test shop",
        isActive: true
      });
    }

    alert("20 Test Shops Created 🚀");
  } catch (error) {
    console.error(error);
  }
};