const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");

// Create an Express app to handle the chatbot requests
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.post("/", async (req, res) => {
  const { role, userMessage, contextData } = req.body;

  // Placeholder for AI logic (e.g., Gemini or OpenAI API call)
  const reply = `I am the ${role} assistant. I received your message: "${userMessage}". How can I help you with the provided context?`;

  res.json({ reply });
});

// Export the 'chat' function
// Access locally via: http://localhost:5001/medilink-ai-b3cf9/us-central1/chat
exports.chat = functions.https.onRequest(app);