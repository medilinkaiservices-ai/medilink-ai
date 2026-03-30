const functions = require("firebase-functions");
const axios = require("axios");
const admin = require("firebase-admin");
const { defineString } = require("firebase-functions/params");

admin.initializeApp();

// Gemini key from firebase.json params
const GEMINI_KEY = defineString("GEMINI_KEY");

// 🌐 Your Web App URL
const WEB_APP_URL = "https://medilink-ai-b3cf9.web.app";

// WhatsApp AI Function
exports.whatsappAI = functions.https.onRequest(async (req, res) => {

  // ✅ Step 1: Webhook verification (GET request)
  if (req.method === "GET") {
    const VERIFY_TOKEN = "medilink_verify_123";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && token === VERIFY_TOKEN) {
      console.log("Webhook verified successfully!");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }

  // ✅ Step 2: Handle incoming WhatsApp messages (POST)
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages[0]) {

      const userMessage = messages[0].text?.body || "";
      const from = messages[0].from;

      console.log("Incoming message:", userMessage, "from:", from);

      let reply = "Sorry, I couldn’t generate a reply.";

      // 🔥 Step 3: Call Gemini API
      try {
        const geminiResponse = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY.value()}`,
          { contents: [{ parts: [{ text: userMessage }] }] },
          { headers: { "Content-Type": "application/json" } }
        );

        reply =
          geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          reply;

      } catch (err) {
        console.error("Gemini error:", err.response?.data || err.message);
        reply = "AI service is not available right now.";
      }

      // ✅ Keyword-based Web App Link Logic
      let finalReply = reply;
      const lowerMsg = userMessage.toLowerCase();

      if (
        lowerMsg.includes("login") ||
        lowerMsg.includes("open") ||
        lowerMsg.includes("app") ||
        lowerMsg.includes("seller") ||
        lowerMsg.includes("register")
      ) {
        finalReply += "\n\n🌐 Open Medilink App:\n" + WEB_APP_URL;
      }

     // 📲 Step 4: Send Professional Button Message

const token =
  "EAAXLhGPUmAIBQZCyueZA9p6k63RA2X672Cq6rjz3Vx1gk3pZBRuIO181SEElPZAYVocryXA5sNEzcO4MtDZBrQE2Yn02jSZAqZCujtQqbOwTOFaGXsIrM5nHh3HO3oIEcSUQ10G7melkMeM7P4RUKUBZB89qZCKd3xtasrXPhqlnoh4eaLLvaOe3q4qVm4SYyWYaAmgnZBPIITZC2xoz9C7WIFdwYopyNZAUMCZB0s8vQ";

const phoneNumberId = "964932490041852";

await axios.post(
  `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
  {
    messaging_product: "whatsapp",
    to: from,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: {
        text: finalReply
      },
      action: {
        name: "cta_url",
        parameters: {
          display_text: "Open Medilink App",
          url: "https://medilink-ai-b3cf9.web.app"
        }
      }
    }
  },
  {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  }
);
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    return res.sendStatus(500);
  }
});


// ==============================
// Seed Categories Function
// ==============================
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
    for (const cat of categories) {
      await admin.firestore()
        .collection("categories")
        .doc(cat.slug)
        .set({
          ...cat,
          active: true,
          createdAt: new Date()
        }, { merge: true });
    }

    res.send("20 Categories seeded successfully ✅");

  } catch (error) {
    console.error(error);
    res.status(500).send("Error seeding categories");
  }
});