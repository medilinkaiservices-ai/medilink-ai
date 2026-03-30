const cors = require("cors")({ origin: true });
const { listLegalReviews, listLegalReviewSnapshots, upsertLegalReview } = require("./reviewWorkflowService");

function createLegalReviewWorkflowHandler() {
  return (req, res) => {
    res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    return cors(req, res, async () => {
      try {
        const admin = require("firebase-admin");

        if (req.method === "GET") {
          const mode = String(req.query.mode || "reviews").trim().toLowerCase();
          if (mode === "snapshots") {
            const snapshots = await listLegalReviewSnapshots(admin, {
              ownerId: String(req.query.ownerId || "anonymous").trim(),
              matterId: String(req.query.matterId || "").trim(),
              entityType: String(req.query.entityType || "").trim()
            });
            return res.status(200).json({ snapshots });
          }
          const reviews = await listLegalReviews(admin, {
            ownerId: String(req.query.ownerId || "anonymous").trim(),
            matterId: String(req.query.matterId || "").trim(),
            entityType: String(req.query.entityType || "").trim()
          });
          return res.status(200).json({ reviews });
        }

        if (req.method === "POST") {
          const review = await upsertLegalReview(admin, req.body || {});
          return res.status(200).json({ review });
        }

        return res.status(405).send("Method Not Allowed");
      } catch (error) {
        return res.status(500).json({
          error: error.message || "Unable to process legal review workflow request."
        });
      }
    });
  };
}

module.exports = {
  createLegalReviewWorkflowHandler
};
