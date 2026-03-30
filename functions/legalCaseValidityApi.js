const functions = require("firebase-functions");
const { getCaseValidity } = require("./validityEngine");

function createLegalCaseValidityHandler(admin) {
  return async (req, res) => {
    res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
      const caseId = String(req.params?.caseId || req.path.split("/").pop() || "").trim();
      if (!caseId) {
        return res.status(400).json({ error: "Missing caseId." });
      }

      const forceRefresh = ["1", "true", "yes"].includes(String(req.query?.refresh || "").toLowerCase());
      const result = await getCaseValidity(admin, { canonicalCaseId: caseId }, { forceRefresh });
      return res.status(200).json(result);
    } catch (error) {
      functions.logger.error("Case validity API error:", error.message);
      return res.status(500).json({ error: "Could not compute case validity." });
    }
  };
}

module.exports = {
  createLegalCaseValidityHandler
};
