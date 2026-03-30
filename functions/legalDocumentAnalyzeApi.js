const functions = require("firebase-functions");
const { analyzeDocument, buildDocumentAnalysisMemo } = require("./documentAnalyzerEngine");

function createLegalDocumentAnalyzeHandler() {
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
      const analysis = analyzeDocument(req.body || {});
      const wantsMemo = String(req.query.format || req.body?.format || "").trim().toLowerCase() === "memo";

      if (wantsMemo) {
        return res.status(200).json({
          ...analysis,
          format: "memo",
          memoTitle: "Document Analysis Memo",
          memoText: buildDocumentAnalysisMemo(analysis, {
            matterLabel: req.body?.matterLabel,
            clientLabel: req.body?.clientLabel
          })
        });
      }

      return res.status(200).json(analysis);
    } catch (error) {
      functions.logger.error("Document analyze API error:", error.message);
      return res.status(500).json({ error: "Could not analyze document." });
    }
  };
}

module.exports = {
  createLegalDocumentAnalyzeHandler
};
