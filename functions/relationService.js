function normalizeCaseIdentifier(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bv(?:s|\.|ersus)?\b/g, " versus ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCitationText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\[(\d{4})\]/g, "($1)")
    .trim();
}

function extractCitationVariants(record = {}) {
  const variants = new Set();
  const rawValues = [
    record.citation,
    record.neutralCitation,
    ...(Array.isArray(record.parallelCitations) ? record.parallelCitations : []),
    ...(Array.isArray(record.citationAliases) ? record.citationAliases : [])
  ];

  rawValues.forEach((value) => {
    const normalized = normalizeCitationText(value);
    if (!normalized) return;
    variants.add(normalized);
    variants.add(normalized.replace(/[.,]/g, ""));
  });

  return [...variants];
}

function extractTitleAliases(record = {}) {
  const values = [
    record.title,
    record.caseTitle,
    record.caseName,
    ...(Array.isArray(record.titleAliases) ? record.titleAliases : [])
  ];

  const aliases = new Set();
  values.forEach((value) => {
    const normalized = normalizeCaseIdentifier(value);
    if (normalized) aliases.add(normalized);
  });
  return [...aliases];
}

function buildCanonicalCaseId(record = {}) {
  const citationKey = extractCitationVariants(record)
    .map((value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, ""))
    .find(Boolean);
  if (citationKey) {
    return `case-${citationKey}`.slice(0, 180);
  }

  const titleKey = extractTitleAliases(record)[0] || "";
  const courtKey = normalizeCaseIdentifier(record.court || "");
  return `case-${courtKey || "unknown"}-${titleKey || "untitled"}`.slice(0, 180);
}

function buildCanonicalCaseIdFromText(text, court = "") {
  return buildCanonicalCaseId({
    title: String(text || "").trim(),
    court
  });
}

function buildCanonicalAliasSet(record = {}) {
  return [
    ...extractCitationVariants(record).map((value) => normalizeCaseIdentifier(value)).filter(Boolean),
    ...extractTitleAliases(record)
  ].filter((value, index, list) => list.indexOf(value) === index);
}

function normalizeRelationType(value) {
  const relationType = String(value || "").trim().toLowerCase();
  if (["cited", "followed", "distinguished", "overruled"].includes(relationType)) {
    return relationType;
  }
  return "cited";
}

function getRelationStrengthScore(relationType, index = 0, label = "") {
  const type = normalizeRelationType(relationType);
  const text = String(label || "").toLowerCase();
  const partialPenalty = /partly|partially|in part|limited to|limited on facts/.test(text) ? 1 : 0;

  if (type === "overruled") return Math.max(5 - index - partialPenalty, 2);
  if (type === "followed") return Math.max(4 - index, 2);
  if (type === "distinguished") return Math.max(3 - index, 1);
  return Math.max(2 - index, 1);
}

function buildRelationReason(relationType, label = "") {
  const text = String(label || "").trim();
  if (!text) return "";
  if (normalizeRelationType(relationType) === "overruled" && /partly|partially|in part|limited/i.test(text)) {
    return "partial_overrule";
  }
  if (normalizeRelationType(relationType) === "distinguished") {
    return "fact_distinction";
  }
  return "";
}

function buildCaseRelationDocsFromJudgment(judgment = {}) {
  const sourceCaseId = String(judgment.canonicalCaseId || buildCanonicalCaseId(judgment)).trim();
  const court = String(judgment.court || "").trim();
  const date = String(judgment.judgmentDate || "").trim();
  const relationMap = [
    { relationType: "cited", values: judgment.citedBy || [] },
    { relationType: "followed", values: judgment.followedBy || [] },
    { relationType: "distinguished", values: judgment.distinguishedBy || [] },
    { relationType: "overruled", values: judgment.overruledBy || [] }
  ];

  return relationMap.flatMap(({ relationType, values }) =>
    (Array.isArray(values) ? values : [])
      .map((value, index) => {
        const targetLabel = String(value || "").trim();
        if (!targetLabel) return null;
        const targetCaseId = buildCanonicalCaseIdFromText(targetLabel, court);
        return {
          id: `${sourceCaseId}-${relationType}-${targetCaseId}`.slice(0, 220),
          sourceCaseId,
          targetCaseId,
          relationType,
          court,
          date,
          strengthScore: getRelationStrengthScore(relationType, index, targetLabel),
          targetLabel,
          reasonCode: buildRelationReason(relationType, targetLabel),
          canonicalTargetAlias: normalizeCaseIdentifier(targetLabel)
        };
      })
      .filter(Boolean)
  );
}

async function upsertCanonicalCase(admin, record = {}) {
  const canonicalCaseId = String(record.canonicalCaseId || buildCanonicalCaseId(record)).trim();
  if (!admin || !canonicalCaseId) return canonicalCaseId;

  const aliasSet = buildCanonicalAliasSet(record);
  await admin.firestore().collection("canonicalCases").doc(canonicalCaseId).set({
    canonicalCaseId,
    title: String(record.title || record.caseTitle || record.caseName || "").trim(),
    citation: String(record.citation || record.neutralCitation || "").trim(),
    court: String(record.court || "").trim(),
    aliases: aliasSet,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return canonicalCaseId;
}

async function syncCaseRelationsForJudgments(admin, judgments = []) {
  if (!admin || !judgments.length) return 0;

  let count = 0;
  for (const judgment of judgments) {
    const canonicalCaseId = await upsertCanonicalCase(admin, judgment);
    const docs = buildCaseRelationDocsFromJudgment({
      ...judgment,
      canonicalCaseId
    });

    if (!docs.length) continue;

    const batch = admin.firestore().batch();
    docs.forEach((item) => {
      const ref = admin.firestore().collection("caseRelations").doc(item.id);
      batch.set(ref, {
        sourceCaseId: item.sourceCaseId,
        targetCaseId: item.targetCaseId,
        relationType: item.relationType,
        court: item.court,
        date: item.date,
        strengthScore: item.strengthScore,
        targetLabel: item.targetLabel,
        reasonCode: item.reasonCode,
        canonicalTargetAlias: item.canonicalTargetAlias,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      count += 1;
    });
    await batch.commit();
  }

  return count;
}

async function resolveCanonicalCaseId(admin, recordOrCaseId) {
  const rawValue = String(recordOrCaseId?.canonicalCaseId || recordOrCaseId?.citation || recordOrCaseId?.title || recordOrCaseId || "").trim();
  const directCaseId = String(recordOrCaseId?.canonicalCaseId || "").trim();
  if (directCaseId) return directCaseId;

  const derivedFromRecord = typeof recordOrCaseId === "object" && recordOrCaseId
    ? buildCanonicalCaseId(recordOrCaseId)
    : "";

  if (!admin) return derivedFromRecord || buildCanonicalCaseIdFromText(rawValue);

  const aliasNeedles = typeof recordOrCaseId === "object" && recordOrCaseId
    ? buildCanonicalAliasSet(recordOrCaseId)
    : [normalizeCaseIdentifier(rawValue)].filter(Boolean);

  for (const alias of aliasNeedles) {
    const snapshot = await admin.firestore()
      .collection("canonicalCases")
      .where("aliases", "array-contains", alias)
      .limit(1)
      .get()
      .catch(() => null);
    if (snapshot && !snapshot.empty) {
      return snapshot.docs[0].id;
    }
  }

  return derivedFromRecord || buildCanonicalCaseIdFromText(rawValue);
}

async function listCaseRelations(admin, canonicalCaseId) {
  if (!admin || !canonicalCaseId) return { outgoing: [], incoming: [] };

  const [outgoingSnap, incomingSnap] = await Promise.all([
    admin.firestore().collection("caseRelations").where("sourceCaseId", "==", canonicalCaseId).limit(250).get(),
    admin.firestore().collection("caseRelations").where("targetCaseId", "==", canonicalCaseId).limit(250).get()
  ]);

  return {
    outgoing: outgoingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    incoming: incomingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  };
}

module.exports = {
  normalizeCaseIdentifier,
  normalizeCitationText,
  buildCanonicalCaseId,
  buildCanonicalCaseIdFromText,
  buildCanonicalAliasSet,
  normalizeRelationType,
  buildCaseRelationDocsFromJudgment,
  upsertCanonicalCase,
  syncCaseRelationsForJudgments,
  resolveCanonicalCaseId,
  listCaseRelations
};
