import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export async function fetchSellerKhathaSummary(shopId) {
  if (!shopId) {
    return {
      totalCustomers: 0,
      totalCredit: 0,
      totalDebit: 0,
      outstanding: 0,
      topCustomers: []
    };
  }

  const snapshot = await getDocs(collection(db, "sellers", shopId, "customers"));
  const customers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

  const totalCredit = customers.reduce((sum, item) => sum + Number(item.totalCredit || 0), 0);
  const totalDebit = customers.reduce((sum, item) => sum + Number(item.totalDebit || 0), 0);
  const outstanding = customers.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const topCustomers = [...customers]
    .filter((item) => Number(item.balance || 0) > 0)
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .slice(0, 5);

  return {
    totalCustomers: customers.length,
    totalCredit,
    totalDebit,
    outstanding,
    topCustomers
  };
}

export async function fetchCustomerKhathaSummary(phone) {
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) {
    return {
      totalBalance: 0,
      totalCredit: 0,
      totalDebit: 0,
      shops: []
    };
  }

  const sellersSnapshot = await getDocs(collection(db, "sellers"));
  const sellers = sellersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

  const matches = await Promise.all(
    sellers.map(async (seller) => {
      const customerRef = await getDoc(doc(db, "sellers", seller.id, "customers", cleanPhone));
      if (!customerRef.exists()) {
        return null;
      }

      const data = customerRef.data();
      return {
        shopId: seller.id,
        shopName: seller.shopName || seller.ownerName || "Shop",
        ownerPhone: seller.ownerPhone || seller.phone || "",
        balance: Number(data.balance || 0),
        totalCredit: Number(data.totalCredit || 0),
        totalDebit: Number(data.totalDebit || 0),
        mobile: data.mobile || cleanPhone
      };
    })
  );

  const shops = matches.filter(Boolean);
  return {
    totalBalance: shops.reduce((sum, item) => sum + Number(item.balance || 0), 0),
    totalCredit: shops.reduce((sum, item) => sum + Number(item.totalCredit || 0), 0),
    totalDebit: shops.reduce((sum, item) => sum + Number(item.totalDebit || 0), 0),
    shops
  };
}
