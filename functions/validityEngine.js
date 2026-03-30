const {
  buildCanonicalCaseId,
  listCaseRelations,
  resolveCanonicalCaseId
} = require("./relationService");

const CACHE_TTL_MS = 1000 * 60 * 60 * 12;

function toIsoString(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function getFreshnessLevel(dateValue, staleAfterDays = 30) {
  const iso = toIsoString(dateValue);
  if (!iso) return "unknown";
  const ageDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 7) return "fresh";
  if (ageDays <= staleAfterDays) return "recent";
  return "stale";
}

async function loadFreshnessMetadata(admin, canonicalCaseId, relations = []) {
  const [canonicalSnap, cacheSnap, judgmentSnap] = await Promise.all([
    admin.firestore().collection("canonicalCases").doc(canonicalCaseId).get().catch(() => null),
    admin.firestore().collection("caseValidityCache").doc(canonicalCaseId).get().catch(() => null),
    admin.firestore().collection("legalJudgments").where("canonicalCaseId", "==", canonicalCaseId).limit(1).get().catch(() => null)
  ]);

  const canonicalData = typeof canonicalSnap?.data === "function" ? (canonicalSnap.data() || {}) : (canonicalSnap?.data || {});
  const cacheData = typeof cacheSnap?.data === "function" ? (cacheSnap.data() || {}) : (cacheSnap?.data || {});
  const judgmentData = judgmentSnap && !judgmentSnap.empty ? judgmentSnap.docs[0].data() || {} : {};
  const relationDates = relations
    .map((item) => String(item.date || "").trim())
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  const lastTreatmentDate = relationDates[0] ? relationDates[0].toISOString() : "";
  const lastSourceUpdateAt = toIsoString(canonicalData.updatedAt || judgmentData.updatedAt || "");
  const lastVerifiedAt = toIsoString(cacheData.computedAt || cacheData.updatedAt || "");

  return {
    lastVerifiedAt,
    verificationFreshness: getFreshnessLevel(lastVerifiedAt, 30),
    lastSourceUpdateAt,
    sourceFreshness: getFreshnessLevel(lastSourceUpdateAt, 60),
    lastTreatmentDate,
    treatmentFreshness: getFreshnessLevel(lastTreatmentDate, 365),
    sourceType: judgmentData.sourceType || canonicalData.sourceType || "stored"
  };
}

function getRecencyWeight(dateValue) {
  const text = String(dateValue || "").trim();
  if (!text) return 1;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return 1;
  const years = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (years <= 3) return 1.6;
  if (years <= 8) return 1.35;
  if (years <= 15) return 1.15;
  return 1;
}

function getBaseRelationWeight(type) {
  if (type === "followed") return 2;
  if (type === "cited") return 1;
  if (type === "distinguished") return -1;
  if (type === "overruled") return -6;
  return 0;
}

function buildSignalEntry(relation, caseMap, polarity = "positive") {
  const relatedCase = caseMap.get(relation.sourceCaseId) || caseMap.get(relation.targetCaseId) || null;
  return {
    caseId: relation.sourceCaseId,
    relationType: relation.relationType,
    title: relatedCase?.title || relation.targetLabel || relation.sourceCaseId,
    citation: relatedCase?.citation || "",
    court: relation.court || relatedCase?.court || "",
    date: relation.date || relatedCase?.judgmentDate || "",
    strengthScore: Number(relation.strengthScore || 0),
    reasonCode: relation.reasonCode || "",
    weight: polarity === "negative" ? -Math.abs(relation.weightedScore || 0) : Math.abs(relation.weightedScore || 0)
  };
}

async function loadCaseMap(admin, caseIds = []) {
  const uniqueIds = [...new Set(caseIds.filter(Boolean))];
  const caseMap = new Map();

  await Promise.all(uniqueIds.map(async (caseId) => {
    try {
      const snap = await admin.firestore().collection("legalJudgments").where("canonicalCaseId", "==", caseId).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        caseMap.set(caseId, { id: doc.id, ...doc.data() });
        return;
      }

      const aliasSnap = await admin.firestore().collection("canonicalCases").doc(caseId).get();
      if (aliasSnap.exists) {
        caseMap.set(caseId, aliasSnap.data() || {});
      }
    } catch {
      // ignore missing case lookups
    }
  }));

  return caseMap;
}

function getStrongOverrule(relations = []) {
  return relations.find((item) =>
    item.relationType === "overruled" &&
    item.reasonCode !== "partial_overrule" &&
    Math.abs(item.weightedScore) >= 14
  ) || null;
}

function summarizeStatus({ strongOverruled, partialOverruledCount, positiveScore, negativeScore, status }) {
  if (strongOverruled) {
    return "A strong overruling signal exists in later treatment. This authority is unsafe to rely on without exceptional manual verification.";
  }
  if (partialOverruledCount > 0) {
    return "Later treatment suggests partial overruling or material limitation. Use only for unaffected propositions after checking the later cases.";
  }
  if (status === "GOOD LAW") {
    return "Positive treatment outweighs negative signals, and the authority appears reasonably safe to rely on subject to standard verification.";
  }
  if (negativeScore > 0 && positiveScore > 0) {
    return "The case has mixed positive and negative treatment. Validate the exact proposition and factual context before reliance.";
  }
  return "Citation-treatment data is limited or mixed, so the authority should be treated with caution until manually verified.";
}

function deriveRiskLevel(status, negativeScore, partialOverruledCount) {
  if (status === "BAD LAW") return "HIGH";
  if (partialOverruledCount > 0 || negativeScore >= 6) return "HIGH";
  if (status === "GOOD LAW") return "LOW";
  return "MEDIUM";
}

function computeConfidenceScore(status, positiveScore, negativeScore, signalCount) {
  const base = status === "BAD LAW" ? 72 : status === "GOOD LAW" ? 58 : 38;
  const spread = Math.max(0, positiveScore - negativeScore);
  const volume = Math.min(signalCount * 4, 18);
  const penalty = Math.min(negativeScore * 3, 24);
  const value = status === "BAD LAW"
    ? base + Math.min(negativeScore * 2, 22) + volume
    : status === "GOOD LAW"
      ? base + Math.min(spread * 2, 26) + volume - Math.min(negativeScore, 8)
      : base + Math.min(Math.abs(positiveScore - negativeScore) * 2, 16) + Math.min(signalCount * 2, 12) - Math.floor(penalty / 3);

  return Math.max(20, Math.min(100, Math.round(value)));
}

async function computeCaseValidity(admin, caseRecord = {}) {
  const requestedCaseId = String(caseRecord.canonicalCaseId || buildCanonicalCaseId(caseRecord)).trim();
  const canonicalCaseId = await resolveCanonicalCaseId(admin, caseRecord || requestedCaseId);
  const relations = await listCaseRelations(admin, canonicalCaseId);
  const incoming = relations.incoming || [];

  if (!incoming.length) {
    return {
      requestedCaseId,
      canonicalCaseId,
      status: "CAUTION",
      riskLevel: "MEDIUM",
      confidenceScore: 35,
      summary: "No citation-treatment data is available yet. Verify the current status manually before reliance.",
      topPositiveCases: [],
      topNegativeCases: [],
      signalBreakdown: {
        positiveScore: 0,
        negativeScore: 0,
        netScore: 0,
        signalCount: 0,
        partialOverruledCount: 0
      }
    };
  }

  const weighted = incoming.map((relation) => {
    const base = getBaseRelationWeight(relation.relationType);
    const recency = getRecencyWeight(relation.date);
    const strength = Math.max(Number(relation.strengthScore || 1), 1);
    const partialModifier = relation.reasonCode === "partial_overrule" ? 0.55 : 1;
    return {
      ...relation,
      weightedScore: base * recency * strength * partialModifier
    };
  });

  const strongOverruled = getStrongOverrule(weighted);
  const partialOverruled = weighted.filter((item) => item.relationType === "overruled" && item.reasonCode === "partial_overrule");
  const positiveScore = weighted.filter((item) => item.weightedScore > 0).reduce((sum, item) => sum + item.weightedScore, 0);
  const negativeScore = Math.abs(weighted.filter((item) => item.weightedScore < 0).reduce((sum, item) => sum + item.weightedScore, 0));
  const netScore = positiveScore - negativeScore;
  const signalCount = weighted.length;

  const relatedIds = weighted.flatMap((item) => [item.sourceCaseId, item.targetCaseId]);
  const caseMap = await loadCaseMap(admin, relatedIds);
  const freshness = await loadFreshnessMetadata(admin, canonicalCaseId, incoming);

  let status = "CAUTION";
  if (strongOverruled) {
    status = "BAD LAW";
  } else if (partialOverruled.length) {
    status = "CAUTION";
  } else if (netScore >= 8 && positiveScore >= negativeScore * 1.5) {
    status = "GOOD LAW";
  } else if (negativeScore >= positiveScore || Math.abs(netScore) < 3) {
    status = "CAUTION";
  } else if (positiveScore > negativeScore) {
    status = "GOOD LAW";
  }

  const riskLevel = deriveRiskLevel(status, negativeScore, partialOverruled.length);
  const confidenceScore = computeConfidenceScore(status, positiveScore, negativeScore, signalCount);
  const summary = summarizeStatus({
    strongOverruled,
    partialOverruledCount: partialOverruled.length,
    positiveScore,
    negativeScore,
    status
  });

  const topPositiveCases = weighted
    .filter((item) => item.weightedScore > 0)
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 5)
    .map((item) => buildSignalEntry(item, caseMap, "positive"));

  const topNegativeCases = weighted
    .filter((item) => item.weightedScore < 0)
    .sort((a, b) => a.weightedScore - b.weightedScore)
    .slice(0, 5)
    .map((item) => buildSignalEntry(item, caseMap, "negative"));

  return {
    requestedCaseId,
    canonicalCaseId,
    status,
    riskLevel,
    confidenceScore,
    summary,
    freshness,
    topPositiveCases,
    topNegativeCases,
    signalBreakdown: {
      positiveScore: Number(positiveScore.toFixed(2)),
      negativeScore: Number(negativeScore.toFixed(2)),
      netScore: Number(netScore.toFixed(2)),
      signalCount,
      partialOverruledCount: partialOverruled.length
    }
  };
}

async function getCaseValidity(admin, caseRecord = {}, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const canonicalCaseId = await resolveCanonicalCaseId(admin, caseRecord);
  const cacheRef = admin.firestore().collection("caseValidityCache").doc(canonicalCaseId);

  if (!forceRefresh) {
    const cacheSnap = await cacheRef.get().catch(() => null);
    if (cacheSnap?.exists) {
      const data = cacheSnap.data() || {};
      if (data.computedAt && (Date.now() - new Date(data.computedAt).getTime()) < CACHE_TTL_MS) {
        return data;
      }
    }
  }

  const result = await computeCaseValidity(admin, {
    ...caseRecord,
    canonicalCaseId
  });

  await cacheRef.set({
    ...result,
    computedAt: new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return result;
}

async function precomputeCaseValidity(admin, caseRecords = []) {
  let computedCount = 0;
  for (const record of caseRecords) {
    await getCaseValidity(admin, record, { forceRefresh: true });
    computedCount += 1;
  }
  return computedCount;
}

module.exports = {
  getCaseValidity,
  computeCaseValidity,
  precomputeCaseValidity
};
