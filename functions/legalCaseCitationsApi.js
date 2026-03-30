const functions = require("firebase-functions");
const {
  resolveCanonicalCaseId,
  listCaseRelations
} = require("./relationService");
const { getCaseValidity } = require("./validityEngine");

function groupRelations(relations = [], relationType = "", direction = "outgoing") {
  return relations
    .filter((item) => item.relationType === relationType)
    .map((item) => ({
      caseId: direction === "outgoing" ? item.targetCaseId : item.sourceCaseId,
      title: item.targetLabel || item.sourceLabel || item.targetCaseId || item.sourceCaseId,
      citation: item.targetLabel || item.sourceLabel || "",
      relationType: item.relationType,
      court: item.court || "",
      date: item.date || "",
      strengthScore: Number(item.strengthScore || 0),
      reasonCode: item.reasonCode || ""
    }))
    .sort((a, b) => Number(b.strengthScore || 0) - Number(a.strengthScore || 0));
}

async function loadCanonicalMetadata(admin, canonicalCaseId) {
  if (!canonicalCaseId) return null;

  const canonicalDoc = await admin.firestore()
    .collection("canonicalCases")
    .doc(canonicalCaseId)
    .get()
    .catch(() => null);

  if (canonicalDoc?.exists) {
    return canonicalDoc.data() || {};
  }

  const judgmentSnap = await admin.firestore()
    .collection("legalJudgments")
    .where("canonicalCaseId", "==", canonicalCaseId)
    .limit(1)
    .get()
    .catch(() => null);

  return judgmentSnap && !judgmentSnap.empty ? judgmentSnap.docs[0].data() || {} : null;
}

function createLegalCaseCitationsHandler(admin) {
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
      const rawCaseId = String(req.params?.caseId || req.path.split("/").slice(-2)[0] || "").trim();
      if (!rawCaseId) {
        return res.status(400).json({ error: "Missing caseId." });
      }

      const canonicalCaseId = await resolveCanonicalCaseId(admin, rawCaseId);
      const forceRefresh = ["1", "true", "yes"].includes(String(req.query?.refresh || "").toLowerCase());
      const [relations, validity, metadata] = await Promise.all([
        listCaseRelations(admin, canonicalCaseId),
        getCaseValidity(admin, { canonicalCaseId }, { forceRefresh }).catch(() => ({
          status: "CAUTION",
          riskLevel: "MEDIUM",
          confidenceScore: 35
        })),
        loadCanonicalMetadata(admin, canonicalCaseId)
      ]);

      const citedCases = groupRelations(relations.outgoing, "cited", "outgoing");
      const followedCases = groupRelations(relations.outgoing, "followed", "outgoing");
      const distinguishedCases = groupRelations(relations.outgoing, "distinguished", "outgoing");
      const citedBy = groupRelations(relations.incoming, "cited", "incoming");
      const followedBy = groupRelations(relations.incoming, "followed", "incoming");
      const overruledBy = groupRelations(relations.incoming, "overruled", "incoming");

      return res.status(200).json({
        canonicalCaseId,
        canonicalCitation: metadata?.citation || canonicalCaseId,
        caseName: metadata?.title || rawCaseId,
        alternateCitations: Array.isArray(metadata?.aliases) ? metadata.aliases.filter(Boolean).slice(0, 12) : [],
        status: validity.status || "CAUTION",
        riskLevel: validity.riskLevel || "MEDIUM",
        confidenceScore: validity.confidenceScore || 0,
        freshness: validity.freshness || {
          lastVerifiedAt: "",
          verificationFreshness: "unknown",
          lastSourceUpdateAt: "",
          sourceFreshness: "unknown",
          lastTreatmentDate: "",
          treatmentFreshness: "unknown",
          sourceType: "stored"
        },
        metrics: {
          citedByCount: citedBy.length,
          followedByCount: followedBy.length,
          overruledByCount: overruledBy.length
        },
        relations: {
          citedCases,
          citedBy,
          followedCases,
          followedBy,
          overruledBy,
          distinguishedCases
        }
      });
    } catch (error) {
      functions.logger.error("Case citations API error:", error.message);
      return res.status(500).json({ error: "Could not load case citations." });
    }
  };
}

module.exports = {
  createLegalCaseCitationsHandler
};
