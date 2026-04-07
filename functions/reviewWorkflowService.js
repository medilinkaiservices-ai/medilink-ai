const crypto = require("crypto");

const REVIEW_STATUSES = ["ai_draft", "needs_revision", "reviewed", "approved"];
const APPROVAL_ROLES = ["reviewer", "senior_lawyer", "partner"];

function normalizeReviewStatus(value) {
  const status = String(value || "ai_draft").trim().toLowerCase();
  return REVIEW_STATUSES.includes(status) ? status : "ai_draft";
}

function normalizeApprovalRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return APPROVAL_ROLES.includes(role) ? role : "";
}

function buildReviewDocId({ ownerId, entityType, entityKey, matterId }) {
  const rawKey = [
    String(ownerId || "anonymous").trim(),
    String(entityType || "general").trim(),
    String(entityKey || "").trim(),
    String(matterId || "").trim()
  ].join("|");

  return crypto.createHash("sha1").update(rawKey).digest("hex");
}

function buildReviewSummary(input = {}) {
  const baseSummary = String(input.outputSummary || input.summary || "").trim();
  if (baseSummary) {
    return baseSummary.slice(0, 800);
  }

  const notes = Array.isArray(input.keyPoints) ? input.keyPoints : [];
  return notes.slice(0, 4).join(" ").slice(0, 800);
}

function buildTraceSnapshot(payload = {}) {
  const traceability = payload.traceability && typeof payload.traceability === "object" ? payload.traceability : null;
  return {
    factsUsed: Array.isArray(traceability?.factsUsed) ? traceability.factsUsed.slice(0, 8) : [],
    documentsReviewed: Array.isArray(traceability?.documentsReviewed) ? traceability.documentsReviewed.slice(0, 8) : [],
    authoritiesRelied: Array.isArray(traceability?.authoritiesRelied) ? traceability.authoritiesRelied.slice(0, 8) : [],
    scoreBreakdown: traceability?.scoreBreakdown || null,
    keyFactors: Array.isArray(traceability?.keyFactors) ? traceability.keyFactors.slice(0, 8) : [],
    reviewerNotes: Array.isArray(traceability?.reviewerNotes) ? traceability.reviewerNotes.slice(0, 6) : []
  };
}

function normalizeReviewFindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function writeReviewSnapshot(admin, reviewRecord = {}, payload = {}) {
  const snapshotRef = admin.firestore().collection("legalReviewSnapshots").doc();
  await snapshotRef.set({
    ownerId: reviewRecord.ownerId,
    matterId: reviewRecord.matterId || "",
    reviewId: reviewRecord.id || "",
    entityType: reviewRecord.entityType || "",
    entityKey: reviewRecord.entityKey || "",
    entityLabel: reviewRecord.entityLabel || "",
    draftVersionLabel: reviewRecord.draftVersionLabel || "",
    status: reviewRecord.status || "approved",
    reviewerName: reviewRecord.reviewerName || "",
    approvalRole: reviewRecord.approvalRole || "",
    reviewNotes: reviewRecord.reviewNotes || "",
    reviewFindings: Array.isArray(reviewRecord.reviewFindings) ? reviewRecord.reviewFindings : [],
    outputSummary: reviewRecord.outputSummary || "",
    traceabilityNote: reviewRecord.traceabilityNote || "",
    traceSnapshot: buildTraceSnapshot(payload),
    snapshotCreatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function upsertLegalReview(admin, payload = {}) {
  const ownerId = String(payload.ownerId || "anonymous").trim();
  const entityType = String(payload.entityType || "").trim();
  const entityKey = String(payload.entityKey || "").trim();

  if (!entityType || !entityKey) {
    throw new Error("Missing review entity details.");
  }

  const status = normalizeReviewStatus(payload.status);
  const approvalRole = normalizeApprovalRole(payload.approvalRole);

  if (status === "approved") {
    if (!String(payload.reviewerName || "").trim()) {
      throw new Error("Reviewer name is required for final approval.");
    }

    if (!approvalRole) {
      throw new Error("Approval role required for final approval.");
    }
  }

  const reviewId = buildReviewDocId({
    ownerId,
    entityType,
    entityKey,
    matterId: payload.matterId
  });
  const ref = admin.firestore().collection("legalReviews").doc(reviewId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await ref.get().catch(() => null);
  const existingData = existing?.data?.() || existing?.data?.() || {};

  const reviewRecord = {
    ownerId,
    matterId: String(payload.matterId || "").trim(),
    entityType,
    entityId: String(payload.entityId || "").trim(),
    entityKey,
    entityLabel: String(payload.entityLabel || entityType).trim(),
    matterTitle: String(payload.matterTitle || "").trim(),
    draftVersionLabel: String(payload.draftVersionLabel || "").trim(),
    status,
    approvalRole,
    reviewerName: String(payload.reviewerName || "").trim(),
    reviewNotes: String(payload.reviewNotes || "").trim(),
    reviewFindings: normalizeReviewFindings(payload.reviewFindings),
    outputSummary: buildReviewSummary(payload),
    traceabilityNote: String(payload.traceabilityNote || "").trim(),
    updatedAt: now,
    createdAt: existing?.exists ? (existingData.createdAt || now) : now,
    reviewedAt: status === "reviewed" || status === "approved" ? now : null,
    approvedAt: status === "approved" ? now : null
  };

  await ref.set(reviewRecord, { merge: true });
  const snapshot = await ref.get();
  const savedReview = {
    id: snapshot.id,
    ...snapshot.data()
  };

  if (savedReview.status === "approved") {
    await writeReviewSnapshot(admin, savedReview, payload).catch(() => null);
  }

  return savedReview;
}

async function listLegalReviews(admin, { ownerId, matterId = "", entityType = "" } = {}) {
  const trimmedOwnerId = String(ownerId || "anonymous").trim();
  let query = admin.firestore()
    .collection("legalReviews")
    .where("ownerId", "==", trimmedOwnerId);

  if (matterId) {
    query = query.where("matterId", "==", String(matterId).trim());
  }

  if (entityType) {
    query = query.where("entityType", "==", String(entityType).trim());
  }

  const snapshot = await query.limit(120).get();
  const reviews = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));

  reviews.sort((left, right) => {
    const leftMs = left.updatedAt?.toMillis?.() || 0;
    const rightMs = right.updatedAt?.toMillis?.() || 0;
    return rightMs - leftMs;
  });

  return reviews;
}

async function listLegalReviewSnapshots(admin, { ownerId, matterId = "", entityType = "" } = {}) {
  const trimmedOwnerId = String(ownerId || "anonymous").trim();
  let query = admin.firestore()
    .collection("legalReviewSnapshots")
    .where("ownerId", "==", trimmedOwnerId);

  if (matterId) {
    query = query.where("matterId", "==", String(matterId).trim());
  }

  if (entityType) {
    query = query.where("entityType", "==", String(entityType).trim());
  }

  const snapshot = await query.limit(120).get();
  const items = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));

  items.sort((left, right) => {
    const leftMs = left.snapshotCreatedAt?.toMillis?.() || 0;
    const rightMs = right.snapshotCreatedAt?.toMillis?.() || 0;
    return rightMs - leftMs;
  });

  return items;
}

module.exports = {
  APPROVAL_ROLES,
  REVIEW_STATUSES,
  normalizeApprovalRole,
  normalizeReviewStatus,
  upsertLegalReview,
  listLegalReviews,
  listLegalReviewSnapshots
};
