const cors = require("cors")({ origin: true });
const { analyzeMatterContradictions } = require("./contradictionEngine");

function createLegalMatterConsistencyHandler() {
  return (req, res) => {
    res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    return cors(req, res, async () => {
      if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
      }

      try {
        return res.status(200).json(analyzeMatterContradictions(req.body || {}));
      } catch (error) {
        return res.status(500).json({
          error: error.message || "Could not process matter consistency request."
        });
      }
    });
  };
}

module.exports = {
  createLegalMatterConsistencyHandler
};
