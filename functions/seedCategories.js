const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.seedCategories = functions.https.onRequest(async (req, res) => {

  const categories = [
    { name: "Milk & Dairy", slug: "milk", priority: 1 },
    { name: "Vegetables", slug: "vegetables", priority: 2 },
    { name: "Fruits", slug: "fruits", priority: 3 },
    { name: "Kirana / Grocery", slug: "kirana", priority: 4 },
    { name: "Electrician", slug: "electrician", priority: 5 },
    { name: "Plumber", slug: "plumber", priority: 6 },
    { name: "Mechanic", slug: "mechanic", priority: 7 },
    { name: "Hotel / Tiffins", slug: "hotel", priority: 8 },
    { name: "Medical / Pharmacy", slug: "medical", priority: 9 },
    { name: "General Store", slug: "general", priority: 10 },
    { name: "Mobile Shop", slug: "mobile", priority: 11 },
    { name: "Electronics", slug: "electronics", priority: 12 },
    { name: "Beauty Parlour", slug: "beauty", priority: 13 },
    { name: "Carpenter", slug: "carpenter", priority: 14 },
    { name: "Hardware", slug: "hardware", priority: 15 },
    { name: "Fertilizers & Seeds", slug: "fertilizers", priority: 16 },
    { name: "Transport", slug: "transport", priority: 17 },
    { name: "Real Estate", slug: "realestate", priority: 18 },
    { name: "Tailor", slug: "tailor", priority: 19 },
    { name: "Others", slug: "others", priority: 20 }
  ];

  try {
    const db = admin.firestore();
    const batch = db.batch();
    const collection = db.collection("categories");

    categories.forEach((cat) => {
      const docRef = collection.doc(cat.slug);
      batch.set(docRef, {
        ...cat,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    await batch.commit();
    res.send("20 Categories seeded successfully ✅");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error seeding categories");
  }
});