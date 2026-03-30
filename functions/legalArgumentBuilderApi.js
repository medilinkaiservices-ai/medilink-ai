const functions = require("firebase-functions");
const { buildArgumentSet } = require("./argumentEngine");

function createLegalArgumentBuilderHandler(admin) {
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
      const result = await buildArgumentSet(admin, req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      functions.logger.error("Argument builder API error:", error.message);
      return res.status(500).json({ error: "Could not generate arguments." });
    }
  };
}

module.exports = {
  createLegalArgumentBuilderHandler
};
