const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { evaluateAuthorityGuardrails } = require("./authorityGuardrailService");

function createLegalAuthorityGuardrailsHandler() {
  return async (req, res) => {
    res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
      return res.status(200).json(await evaluateAuthorityGuardrails(admin, req.body?.selectedCases || []));
    } catch (error) {
      functions.logger.error("Authority guardrails API error:", error.message);
      return res.status(500).json({ error: "Could not evaluate authority guardrails." });
    }
  };
}

module.exports = {
  createLegalAuthorityGuardrailsHandler
};
