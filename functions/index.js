const functions = require("firebase-functions");
const axios = require("axios");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const cors = require("cors")({ origin: true });
const { createCopilotApp } = require("./copilot/app");
const { LEGAL_SYSTEM_PROMPTS } = require("./legalCorpus");
const { LEGAL_JUDGMENTS_SEED } = require("./legalJudgmentsSeed");
const { parseJudgmentSourcePayload } = require("./legalJudgmentParsers");
const {
  buildCanonicalCaseId,
  syncCaseRelationsForJudgments
} = require("./relationService");
const {
  getCaseValidity,
  precomputeCaseValidity
} = require("./validityEngine");
const { createLegalCaseValidityHandler } = require("./legalCaseValidityApi");
const { createLegalCaseCitationsHandler } = require("./legalCaseCitationsApi");
const { buildArgumentSet } = require("./argumentEngine");
const { createLegalArgumentBuilderHandler } = require("./legalArgumentBuilderApi");
const { analyzeCaseStrength } = require("./strengthEngine");
const { createLegalCaseStrengthHandler } = require("./legalCaseStrengthApi");
const { predictCaseOutcome } = require("./predictionEngine");
const { createLegalCasePredictionHandler } = require("./legalCasePredictionApi");
const { analyzeFilingReadiness } = require("./readinessEngine");
const { createLegalFilingReadinessHandler } = require("./legalFilingReadinessApi");
const { evaluateAuthorityGuardrails } = require("./authorityGuardrailService");
const { createLegalAuthorityGuardrailsHandler } = require("./legalAuthorityGuardrailsApi");
const { analyzeMatterContradictions } = require("./contradictionEngine");
const { createLegalMatterConsistencyHandler } = require("./legalMatterConsistencyApi");
const { analyzeEvidenceCoverage } = require("./coverageMatrixEngine");
const { createLegalEvidenceCoverageHandler } = require("./legalEvidenceCoverageApi");
const { analyzeDraftValidation } = require("./draftValidationEngine");
const { createLegalDraftValidationHandler } = require("./legalDraftValidationApi");
const { analyzeFinalFilingPack } = require("./filingPackEngine");
const { createLegalFilingPackHandler } = require("./legalFilingPackApi");
const { listLegalReviews, listLegalReviewSnapshots, upsertLegalReview } = require("./reviewWorkflowService");
const { createLegalReviewWorkflowHandler } = require("./legalReviewWorkflowApi");
const { generateDraft } = require("./draftEngine");
const { analyzeDocument, buildDocumentAnalysisMemo } = require("./documentAnalyzerEngine");
const { createLegalDocumentAnalyzeHandler } = require("./legalDocumentAnalyzeApi");
const { buildTraceability } = require("./traceabilityService");
const {
  classifyCaseNature,
  normalizeSearchText,
  retrieveLegalContext,
  getLegacyLawNotice
} = require("./legalUtils");
const {
  getConfigValue,
  getGeminiKey,
  getOpenAIKey,
  getOpenAIModel,
  getRazorpayKeyId,
  getRazorpayKeySecret,
  getWhatsappToken,
  getWhatsappPhoneNumberId,
  getLegalLiveRetrievalEnabled
} = require("./configRuntime");

admin.initializeApp();

function safeJSONParse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = String(rawText || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isUnsafeLegalRequest(text) {
  const input = String(text || "").toLowerCase();
  const banned = [
    "forge document",
    "fake evidence",
    "destroy evidence",
    "bribe judge",
    "threaten witness",
    "how to evade law",
    "illegal weapon"
  ];
  return banned.some((term) => input.includes(term));
}

async function writeLegalAudit(ownerId, action, requestSummary, status, meta = {}) {
  try {
    await admin.firestore().collection("legalAuditLogs").add({
      ownerId: String(ownerId || "anonymous").trim(),
      action: String(action || "").trim(),
      requestSummary: String(requestSummary || "").slice(0, 1200),
      status: String(status || "ok"),
      meta,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    functions.logger.warn("Audit log write failed:", error.message);
  }
}

function getMonthKey() {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

async function getOrCreateLegalSubscription(ownerId) {
  const ref = admin.firestore().collection("legalSubscriptions").doc(ownerId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    const starter = {
      ownerId,
      plan: "trial",
      status: "active",
      monthlyLimit: 120,
      monthlyUsage: 0,
      usageMonth: getMonthKey(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await ref.set(starter, { merge: true });
    return { ref, data: starter };
  }

  const data = snapshot.data() || {};
  if (data.usageMonth !== getMonthKey()) {
    await ref.set({
      monthlyUsage: 0,
      usageMonth: getMonthKey(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      ref,
      data: {
        ...data,
        monthlyUsage: 0,
        usageMonth: getMonthKey()
      }
    };
  }

  return { ref, data };
}

async function ensureLegalQuota(ownerId, action) {
  const aiActions = new Set([
    "lawyer_research",
    "matter_intake",
    "chronology_builder",
    "research_memo",
    "draft_generator",
    "case_analyzer",
    "document_analyzer",
    "document_extract"
  ]);

  if (!aiActions.has(action)) {
    return { allowed: true, reason: "", subscription: null, ref: null };
  }

  if (!getBillingEnabled()) {
    const { ref, data } = await getOrCreateLegalSubscription(ownerId);
    return { allowed: true, reason: "", subscription: data, ref };
  }

  const { ref, data } = await getOrCreateLegalSubscription(ownerId);
  const plan = String(data.plan || "trial").toLowerCase();
  const status = String(data.status || "active").toLowerCase();
  const monthlyLimit = Number(data.monthlyLimit || (plan === "enterprise" ? 100000 : plan === "pro" ? 1500 : 120));
  const monthlyUsage = Number(data.monthlyUsage || 0);

  if (status !== "active") {
    return { allowed: false, reason: "Subscription is not active.", subscription: data, ref };
  }

  if (monthlyUsage >= monthlyLimit) {
    return { allowed: false, reason: "Monthly AI usage limit reached.", subscription: data, ref };
  }

  return { allowed: true, reason: "", subscription: data, ref };
}

async function consumeLegalQuota(ref, subscription) {
  if (!ref || !subscription) return;
  await ref.set({
    monthlyUsage: Number(subscription.monthlyUsage || 0) + 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function getPlanConfig(plan) {
  const key = String(plan || "trial").toLowerCase();
  if (key === "enterprise") {
    return { plan: "enterprise", monthlyLimit: 100000, priceInr: 14999 };
  }
  if (key === "pro") {
    return { plan: "pro", monthlyLimit: 1500, priceInr: 2999 };
  }
  return { plan: "trial", monthlyLimit: 120, priceInr: 0 };
}

function getBillingEnabled() {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret());
}

function buildRazorpayAuthHeader() {
  const keyId = getRazorpayKeyId();
  const keySecret = getRazorpayKeySecret();
  const token = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return `Basic ${token}`;
}

function verifyRazorpayPaymentSignature(orderId, paymentId, signature) {
  const secret = getRazorpayKeySecret();
  const payload = `${orderId}|${paymentId}`;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return digest === signature;
}

function verifyRazorpayWebhookSignature(rawBodyBuffer, signature) {
  const secret = getRazorpayKeySecret();
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBodyBuffer)
    .digest("hex");
  return digest === signature;
}

function sortJudgmentsByDate(items = []) {
  return items.slice().sort((a, b) => String(b.judgmentDate || "").localeCompare(String(a.judgmentDate || "")));
}

function normalizeSortableTimestamp(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?._seconds === "number") {
    return (value._seconds * 1000) + Math.floor(Number(value._nanoseconds || 0) / 1000000);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRecordsByTimestamp(items = [], fieldName) {
  return items.slice().sort((a, b) => normalizeSortableTimestamp(b?.[fieldName]) - normalizeSortableTimestamp(a?.[fieldName]));
}

function sortJudgmentsByRelevance(items = [], query = "") {
  const queryText = String(query || "").trim();
  if (!queryText) {
    return sortJudgmentsByDate(items);
  }

  return items
    .slice()
    .map((item) => ({
      ...item,
      relevanceScore: scoreJudgmentMatch(item, queryText)
    }))
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return String(b.judgmentDate || "").localeCompare(String(a.judgmentDate || ""));
    });
}

function filterJudgments(items = [], {
  query = "",
  court = "all",
  status = "all",
  dateWindow = "all"
} = {}) {
  const normalizedQuery = normalizeSearchText(query).join(" ");
  const normalizedCourt = String(court || "all").trim().toLowerCase();
  const normalizedStatus = String(status || "all").trim().toLowerCase();
  const normalizedDateWindow = String(dateWindow || "all").trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return items.filter((item) => {
    const matchesCourt = normalizedCourt === "all"
      || String(item.court || "").trim().toLowerCase() === normalizedCourt;
    if (!matchesCourt) return false;

    const matchesStatus = normalizedStatus === "all"
      || String(item.treatmentStatus || "").trim().toLowerCase() === normalizedStatus;
    if (!matchesStatus) return false;

    if (normalizedDateWindow !== "all" && item.judgmentDate) {
      const judgmentDate = new Date(item.judgmentDate);
      judgmentDate.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - judgmentDate) / (1000 * 60 * 60 * 24));
      if (normalizedDateWindow === "30d" && diff > 30) return false;
      if (normalizedDateWindow === "90d" && diff > 90) return false;
      if (normalizedDateWindow === "180d" && diff > 180) return false;
    }

    if (!normalizedQuery) return true;

    const haystack = normalizeSearchText([
      item.title,
      item.citation,
      item.court,
      item.bench,
      item.summary,
      item.relevanceNote,
      Array.isArray(item.issueTags) ? item.issueTags.join(" ") : ""
    ].join(" ")).join(" ");

    return normalizedQuery
      .split(" ")
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });
}

function scoreJudgmentMatch(item, sourceText) {
  const sourceTokens = normalizeSearchText(sourceText);
  if (!sourceTokens.length) return 0;

  const titleTokens = normalizeSearchText(item.title);
  const tagTokens = normalizeSearchText(Array.isArray(item.issueTags) ? item.issueTags.join(" ") : "");
  const summaryTokens = normalizeSearchText([
    item.summary,
    item.relevanceNote,
    item.ratioNote,
    Array.isArray(item.practicalUse) ? item.practicalUse.join(" ") : ""
  ].join(" "));
  const citationTokens = normalizeSearchText([item.citation, item.court, item.bench].join(" "));

  return sourceTokens.reduce((score, token) => {
    let nextScore = score;
    if (titleTokens.includes(token)) nextScore += 4;
    if (tagTokens.includes(token)) nextScore += 3;
    if (summaryTokens.includes(token)) nextScore += 2;
    if (citationTokens.includes(token)) nextScore += 1;
    return nextScore;
  }, 0);
}

function computeAuthorityStrength(item = {}) {
  const status = String(item.treatmentStatus || "").toLowerCase();
  const followedCount = Array.isArray(item.followedBy) ? item.followedBy.length : 0;
  const citedCount = Array.isArray(item.citedBy) ? item.citedBy.length : 0;
  const distinguishedCount = Array.isArray(item.distinguishedBy) ? item.distinguishedBy.length : 0;
  const overruledCount = Array.isArray(item.overruledBy) ? item.overruledBy.length : 0;

  let score = 0;
  if (status.includes("landmark")) score += 5;
  if (status.includes("followed")) score += 4;
  else if (status.includes("relied")) score += 3;
  else if (status.includes("good law")) score += 2;
  else if (status.includes("verify")) score += 1;
  if (status.includes("distinguished")) score -= 1;
  score += Math.min(followedCount, 3);
  score += Math.min(citedCount, 2);
  score -= Math.min(distinguishedCount, 2);
  score -= Math.min(overruledCount * 3, 6);

  if (score >= 8) return "High";
  if (score >= 4) return "Medium";
  return "Review";
}

function buildTreatmentSummary(item = {}) {
  const parts = [];
  if (item.treatmentStatus) parts.push(`Status: ${item.treatmentStatus}`);
  if (Array.isArray(item.followedBy) && item.followedBy.length) parts.push(`Followed by ${item.followedBy.length}`);
  if (Array.isArray(item.citedBy) && item.citedBy.length) parts.push(`Cited by ${item.citedBy.length}`);
  if (Array.isArray(item.distinguishedBy) && item.distinguishedBy.length) parts.push(`Distinguished by ${item.distinguishedBy.length}`);
  if (Array.isArray(item.overruledBy) && item.overruledBy.length) parts.push(`Overruled/limited by ${item.overruledBy.length}`);
  return parts.join(" | ");
}

function enrichJudgment(item = {}) {
  return {
    ...item,
    canonicalCaseId: String(item.canonicalCaseId || buildCanonicalCaseId(item)).trim(),
    authorityStrength: computeAuthorityStrength(item),
    treatmentSummary: buildTreatmentSummary(item)
  };
}

async function loadJudgmentLibrary() {
  let judgments = [];

  try {
    const snapshot = await admin.firestore()
      .collection("legalJudgments")
      .limit(120)
      .get();

    judgments = snapshot.docs.map((doc) => enrichJudgment({ id: doc.id, ...doc.data(), sourceType: "live" }));
  } catch (error) {
    functions.logger.warn("legalJudgments library fetch failed:", error.message);
  }

  if (!judgments.length) {
    judgments = LEGAL_JUDGMENTS_SEED.map((item) => enrichJudgment({ ...item }));
  }

  return judgments;
}

async function loadJudgmentSources() {
  try {
    const snapshot = await admin.firestore()
      .collection("legalJudgmentSources")
      .limit(50)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
  } catch (error) {
    functions.logger.warn("legalJudgmentSources fetch failed:", error.message);
  }

  return [
    {
      id: "supreme-court",
      name: "Supreme Court Feed",
      court: "Supreme Court",
      status: "active",
      cadence: "daily",
      importTemplate: "court_standard_v1",
      retrievalMode: "html_sc_latest",
      endpoint: "https://www.sci.gov.in/"
    },
    {
      id: "delhi-high-court",
      name: "Delhi High Court Feed",
      court: "Delhi High Court",
      status: "active",
      cadence: "daily",
      importTemplate: "court_standard_v1",
      retrievalMode: "html_table_latest",
      endpoint: "https://delhihighcourt.nic.in/"
    },
    {
      id: "bombay-high-court",
      name: "Bombay High Court Feed",
      court: "Bombay High Court",
      status: "active",
      cadence: "daily",
      importTemplate: "court_standard_v1",
      retrievalMode: "html_table_latest",
      endpoint: "https://www.bombayhighcourt.nic.in/recentorderjudgment.php"
    },
    {
      id: "karnataka-high-court",
      name: "Karnataka High Court Feed",
      court: "Karnataka High Court",
      status: "active",
      cadence: "daily",
      importTemplate: "court_standard_v1",
      retrievalMode: "html_generic_latest",
      endpoint: "https://karnatakajudiciary.kar.nic.in/newwebsite/"
    },
    {
      id: "madras-high-court",
      name: "Madras High Court Feed",
      court: "Madras High Court",
      status: "active",
      cadence: "daily",
      importTemplate: "court_standard_v1",
      retrievalMode: "html_generic_latest",
      endpoint: "https://www.mhc.tn.gov.in/judis"
    }
  ];
}

function getJudgmentImportTemplates() {
  return [
    {
      id: "court_standard_v1",
      label: "Court Standard V1",
      requiredFields: ["title", "citation", "court", "judgmentDate", "summary"],
      optionalFields: ["bench", "ratioNote", "relevanceNote", "treatmentStatus", "cautionFlag", "issueTags", "holdingPoints", "keyParagraphs", "practicalUse"]
    },
    {
      id: "scc_digest_v1",
      label: "Digest Style V1",
      requiredFields: ["title", "citation", "court", "summary", "issueTags"],
      optionalFields: ["bench", "judgmentDate", "ratioNote", "relevanceNote", "treatmentStatus", "holdingPoints", "keyParagraphs", "practicalUse"]
    }
  ];
}

async function createJudgmentSyncRun({ ownerId, sourceId, mode = "manual" }) {
  const ref = admin.firestore().collection("legalJudgmentSyncRuns").doc();
  const startedAt = new Date().toISOString();
  const payload = {
    ownerId,
    sourceId: String(sourceId || "all").trim() || "all",
    mode: String(mode || "manual").trim() || "manual",
    status: "planned",
    startedAt,
    completedAt: startedAt,
    fetchedCount: 0,
    storedCount: 0,
    notes: "Judgment sync run created for live retrieval or import processing.",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

async function importJudgmentRecords({ ownerId, sourceId, records = [] }) {
  const batch = admin.firestore().batch();
  const normalizedRecords = [];
  let storedCount = 0;

  records.forEach((record, index) => {
    const normalizedRecord = enrichJudgment(record);
    const title = String(normalizedRecord.title || "").trim();
    if (!title) return;

    const citation = String(normalizedRecord.citation || "").trim();
    const docId = String(normalizedRecord.id || `${sourceId || "import"}-${citation || title}-${index}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);

    const ref = admin.firestore().collection("legalJudgments").doc(docId);
    batch.set(ref, {
      title,
      citation,
      canonicalCaseId: String(normalizedRecord.canonicalCaseId || "").trim(),
      court: String(normalizedRecord.court || "").trim(),
      bench: String(normalizedRecord.bench || "").trim(),
      judgmentDate: String(normalizedRecord.judgmentDate || "").trim(),
      summary: String(normalizedRecord.summary || "").trim(),
      ratioNote: String(normalizedRecord.ratioNote || "").trim(),
      relevanceNote: String(normalizedRecord.relevanceNote || "").trim(),
      treatmentStatus: String(normalizedRecord.treatmentStatus || "").trim(),
      cautionFlag: String(normalizedRecord.cautionFlag || "").trim(),
      issueTags: Array.isArray(normalizedRecord.issueTags) ? normalizedRecord.issueTags.map((item) => String(item).trim()).filter(Boolean) : [],
      holdingPoints: Array.isArray(normalizedRecord.holdingPoints) ? normalizedRecord.holdingPoints.map((item) => String(item).trim()).filter(Boolean) : [],
      keyParagraphs: Array.isArray(normalizedRecord.keyParagraphs) ? normalizedRecord.keyParagraphs.map((item) => String(item).trim()).filter(Boolean) : [],
      citedBy: Array.isArray(normalizedRecord.citedBy) ? normalizedRecord.citedBy.map((item) => String(item).trim()).filter(Boolean) : [],
      followedBy: Array.isArray(normalizedRecord.followedBy) ? normalizedRecord.followedBy.map((item) => String(item).trim()).filter(Boolean) : [],
      distinguishedBy: Array.isArray(normalizedRecord.distinguishedBy) ? normalizedRecord.distinguishedBy.map((item) => String(item).trim()).filter(Boolean) : [],
      overruledBy: Array.isArray(normalizedRecord.overruledBy) ? normalizedRecord.overruledBy.map((item) => String(item).trim()).filter(Boolean) : [],
      practicalUse: Array.isArray(normalizedRecord.practicalUse) ? normalizedRecord.practicalUse.map((item) => String(item).trim()).filter(Boolean) : [],
      sourceUrl: String(normalizedRecord.sourceUrl || "").trim(),
      importedBy: ownerId,
      sourceId: String(sourceId || "manual-import").trim(),
      sourceType: "live",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    normalizedRecords.push(normalizedRecord);
    storedCount += 1;
  });

  if (storedCount) {
    await batch.commit();
    await syncCaseRelationsForJudgments(admin, normalizedRecords);
    await precomputeCaseValidity(admin, normalizedRecords.slice(0, 20));
  }

  return storedCount;
}

function normalizeImportedJudgmentRecord(record = {}, source = {}) {
  return {
    id: String(record.id || "").trim(),
    title: String(record.title || record.caseTitle || "").trim(),
    citation: String(record.citation || record.neutralCitation || "").trim(),
    court: String(record.court || source.court || "").trim(),
    bench: String(record.bench || "").trim(),
    judgmentDate: String(record.judgmentDate || record.date || "").trim(),
    summary: String(record.summary || record.headnote || "").trim(),
    ratioNote: String(record.ratioNote || record.holding || "").trim(),
    relevanceNote: String(record.relevanceNote || "").trim(),
    treatmentStatus: String(record.treatmentStatus || "verify").trim(),
    cautionFlag: String(record.cautionFlag || "").trim(),
    issueTags: Array.isArray(record.issueTags) ? record.issueTags : [],
    holdingPoints: Array.isArray(record.holdingPoints) ? record.holdingPoints : [],
    keyParagraphs: Array.isArray(record.keyParagraphs) ? record.keyParagraphs : [],
    citedBy: Array.isArray(record.citedBy) ? record.citedBy : [],
    followedBy: Array.isArray(record.followedBy) ? record.followedBy : [],
    distinguishedBy: Array.isArray(record.distinguishedBy) ? record.distinguishedBy : [],
    overruledBy: Array.isArray(record.overruledBy) ? record.overruledBy : [],
    practicalUse: Array.isArray(record.practicalUse) ? record.practicalUse : [],
    sourceUrl: String(record.sourceUrl || "").trim()
  };
}

async function tryFetchLiveJudgments({ sources = [], query = "", limit = 10 }) {
  if (!getLegalLiveRetrievalEnabled()) {
    return { judgments: [], fetchedSources: [], liveEnabled: false };
  }

  const fetched = [];
  const fetchedSources = [];

  for (const source of sources) {
    const endpoint = String(source.endpoint || "").trim();
    if (!endpoint) continue;

    try {
      const response = await axios.get(endpoint, {
        timeout: 12000,
        headers: {
          "User-Agent": "Medilink-AI-Legal-Research/1.0"
        }
      });

      const parsedRecords = parseJudgmentSourcePayload(response.data, source);
      const records = query
        ? filterJudgments(parsedRecords, { query, court: "all", status: "all", dateWindow: "all" })
        : parsedRecords;

      records.forEach((record) => {
    const normalized = enrichJudgment(normalizeImportedJudgmentRecord(record, source));
    if (normalized.title) {
      fetched.push(normalized);
    }
      });

      if (records.length) {
        fetchedSources.push(source.id || source.name || "source");
      }
    } catch (error) {
      functions.logger.warn("Live judgment fetch failed:", source.id || source.name, error.message);
    }
  }

  return {
    judgments: fetched.slice(0, limit),
    fetchedSources,
    liveEnabled: true
  };
}

function buildRelatedJudgments(judgments, sourceText, limit = 5) {
  return judgments
    .map((item) => ({
      ...item,
      matchScore: scoreJudgmentMatch(item, sourceText)
    }))
    .filter((item) => item.matchScore > 0)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return String(b.judgmentDate || "").localeCompare(String(a.judgmentDate || ""));
    })
    .slice(0, limit);
}

function buildAuthorityClusters(relatedJudgments = []) {
  const map = new Map();

  relatedJudgments.forEach((item) => {
    const tags = Array.isArray(item.issueTags) && item.issueTags.length
      ? item.issueTags
      : ["general"];

    tags.slice(0, 2).forEach((tag) => {
      const key = String(tag || "general").trim() || "general";
      const current = map.get(key) || [];
      current.push({
        title: item.title,
        citation: item.citation,
        status: item.treatmentStatus || "verify",
        whyItMatters: item.ratioNote || item.summary,
        sourceUrl: item.sourceUrl || ""
      });
      map.set(key, current);
    });
  });

  return Array.from(map.entries()).map(([issue, authorities]) => ({
    issue,
    authorities: authorities.slice(0, 3)
  })).slice(0, 5);
}

async function activateLegalPlan(ownerId, plan) {
  const planConfig = getPlanConfig(plan);
  const { ref } = await getOrCreateLegalSubscription(ownerId);
  await ref.set({
    ownerId,
    plan: planConfig.plan,
    status: "active",
    monthlyLimit: planConfig.monthlyLimit,
    usageMonth: getMonthKey(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function callOpenAIJson({ systemPrompt, userPrompt, schemaHint, fallback }) {
  const key = getOpenAIKey();
  if (!key) {
    return fallback;
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/responses",
      {
        model: getOpenAIModel(),
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: `${userPrompt}\n\nReturn JSON only.\n${schemaHint}` }] }
        ],
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        }
      }
    );

    const rawText = response.data?.output_text || "";
    const parsed = safeJSONParse(rawText);
    return parsed || fallback;
  } catch (error) {
    functions.logger.warn("OpenAI call fallback:", error.response?.data || error.message);
    return fallback;
  }
}

async function callOpenAIText({ systemPrompt, userPrompt }) {
  const key = getOpenAIKey();
  const geminiKey = getGeminiKey();

  if (key) {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/responses",
        {
          model: getOpenAIModel(),
          input: [
            { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
            { role: "user", content: [{ type: "input_text", text: userPrompt }] }
          ],
          temperature: 0.4
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json"
          }
        }
      );

      const output = String(response.data?.output_text || "").trim();
      if (output) {
        return output;
      }
      throw new Error("OpenAI returned an empty response.");
    } catch (error) {
      functions.logger.warn("OpenAI text error:", error.response?.data || error.message);
    }
  }

  if (geminiKey) {
    try {
      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: `${systemPrompt}\n\n${userPrompt}`
                }
              ]
            }
          ]
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      const output = String(geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (output) {
        return output;
      }
      throw new Error("Gemini returned an empty response.");
    } catch (error) {
      functions.logger.warn("Gemini text error:", error.response?.data || error.message);
    }
  }

  if (!key && !geminiKey) {
    throw new Error("No AI provider configured for Copilot chat.");
  }

  throw new Error("All Copilot AI providers failed.");
}

async function extractTextWithGemini({ mimeType, dataBase64, fileName = "document" }) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) {
    return "";
  }

  try {
    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: `Extract all readable text from this legal file.\nFile: ${fileName}\nReturn plain text only. Preserve key headings, clauses, and numbering when present.`
              },
              {
                inlineData: {
                  mimeType,
                  data: dataBase64
                }
              }
            ]
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return String(geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  } catch (error) {
    functions.logger.warn("Gemini extraction fallback error:", error.response?.data || error.message);
    return "";
  }
}

function buildPagePreviews(text, maxPages = 6) {
  const value = String(text || "").trim();
  if (!value) return [];

  const byFormFeed = value.split(/\f+/).map((item) => item.trim()).filter(Boolean);
  const source = byFormFeed.length > 1 ? byFormFeed : value.match(/[\s\S]{1,2200}/g) || [];

  return source.slice(0, maxPages).map((chunk, index) => ({
    page: index + 1,
    excerpt: String(chunk || "").slice(0, 700)
  }));
}

function estimateExtractionQuality({ text, mimeType, usedOpenAI, usedGemini }) {
  const value = String(text || "");
  const length = value.trim().length;
  const hasEnoughWords = value.split(/\s+/).filter((item) => item.length > 1).length;
  const noisyChars = (value.match(/[^\w\s.,;:()\-/'"]/g) || []).length;
  const noiseRatio = length ? noisyChars / length : 1;

  let score = 30;
  if (length > 500) score += 20;
  if (length > 3000) score += 15;
  if (hasEnoughWords > 120) score += 15;
  if (noiseRatio < 0.04) score += 10;
  if (noiseRatio > 0.18) score -= 20;
  if (usedOpenAI) score += 6;
  if (usedGemini) score += 5;
  if (String(mimeType || "").includes("pdf")) score += 4;

  return Math.max(0, Math.min(100, score));
}

function mapAuthorities(context = []) {
  return context.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    citation: item.citation,
    summary: item.body
  }));
}

function buildContext(role, contextData) {
  switch (role) {
    case "shop":
      return {
        systemInstruction:
          "You are a helpful shop assistant. Answer only based on the provided shop data. If the user asks something outside this context, politely state that you can only answer questions related to the shop's products and services.",
        context: `Shop Name: ${contextData.shopName || "N/A"}
Products: ${contextData.products ? contextData.products.map((p) => `${p.name} (Price: ${p.price}, Availability: ${p.availability})`).join(", ") : "N/A"}
Offers: ${contextData.offers || "N/A"}
Availability: ${contextData.availability || "N/A"}
City: ${contextData.city || "N/A"}
Area: ${contextData.area || "N/A"}
Address: ${contextData.address || "N/A"}
Description: ${contextData.description || "N/A"}`
      };
    case "hospital":
      if (contextData.assistantMode === "care" || contextData.assistantMode === "hybrid") {
        return {
          systemInstruction:
            contextData.assistantMode === "hybrid"
              ? "You are a hospital assistant for Medilink AI. You must do two jobs in one conversation. First, answer hospital questions about services, doctors, timings, departments, appointments, and hospital information using the provided context. Second, when a patient shares symptoms, switch into hospital care assistant mode. In care assistant mode, you are not a doctor and must never provide a diagnosis, prescribe treatment, or claim certainty. Explain only possible conditions, likely symptom effects, urgency, red-flag symptoms, and which hospital department may be appropriate. Always advise that a licensed clinician must confirm any diagnosis."
              : "You are a hospital care assistant for Medilink AI. You are not a doctor and must never provide a diagnosis, prescribe treatment, or claim certainty. When a patient shares symptoms, explain only possible conditions, likely symptom effects, urgency, red-flag symptoms, and which hospital department may be appropriate. Always advise that a licensed clinician must confirm any diagnosis.",
          context: `Hospital Name: ${contextData.hospitalName || "N/A"}
Departments: ${Array.isArray(contextData.departments) ? contextData.departments.join(", ") : "N/A"}
Services: ${Array.isArray(contextData.services) ? contextData.services.join(", ") : "N/A"}
Doctors: ${Array.isArray(contextData.doctors) ? contextData.doctors.map((d) => `${d.name} (${d.specialty || d.department || "General"})`).join(", ") : "N/A"}
Timings: ${contextData.timings || "N/A"}
Appointment Availability: ${contextData.appointmentAvailability || "N/A"}
Patient Name: ${contextData.patientName || "Unknown"}
Patient Age: ${contextData.patientAge || "Unknown"}
Patient Gender: ${contextData.patientGender || "Unknown"}
Patient Phone: ${contextData.patientPhone || "Unknown"}
Existing Notes: ${contextData.patientNotes || "N/A"}`
        };
      }
      return {
        systemInstruction:
          "You are a helpful hospital assistant. Answer only based on the provided hospital data. If the user asks something outside this context, politely state that you can only answer questions related to the hospital's services, doctors, and appointments.",
        context: `Hospital Name: ${contextData.hospitalName || "N/A"}
Services: ${contextData.services ? contextData.services.join(", ") : "N/A"}
Doctors: ${contextData.doctors ? contextData.doctors.map((d) => `${d.name} (${d.specialty}, Timings: ${d.timings})`).join(", ") : "N/A"}
Timings: ${contextData.timings || "N/A"}
Appointment Availability: ${contextData.appointmentAvailability || "N/A"}`
      };
    case "customer":
      return {
        systemInstruction:
          "You are a helpful Medilink AI marketplace assistant. Answer using the provided customer, product, shop, and hospital context. If the user asks for products, nearby shops, hospitals, appointments, or navigation, use the supplied data directly and be specific.",
        context: `Medilink AI App Features: ${contextData.appFeatures || "N/A"}
Navigation Help: ${contextData.navigationHelp || "N/A"}
General Info: ${contextData.generalInfo || "N/A"}
Customer Area: ${contextData.customerArea || "N/A"}
Shops: ${Array.isArray(contextData.shops) ? contextData.shops.map((shop) => `${shop.name} (${shop.category || "general"}, ${shop.area || shop.city || "location unknown"}, ${shop.orderEnabled || "status unknown"})`).join(", ") : "N/A"}
Products: ${Array.isArray(contextData.products) ? contextData.products.map((product) => `${product.name} (Price: ${product.price}, Shop: ${product.shopName || "Unknown"}, Availability: ${product.availability || "Unknown"})`).join(", ") : "N/A"}
Hospitals: ${Array.isArray(contextData.hospitals) ? contextData.hospitals.map((hospital) => `${hospital.name} (${hospital.city || "city unknown"}, Departments: ${Array.isArray(hospital.departments) ? hospital.departments.join("/") : "N/A"})`).join(", ") : "N/A"}`
      };
    default:
      return null;
  }
}

function buildFallbackReply(role, contextData = {}, userMessage = "") {
  const lowerMessage = userMessage.toLowerCase();

  if (role === "shop") {
    const products = Array.isArray(contextData.products) ? contextData.products : [];
    const tokens = lowerMessage
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2);

    const matchingProducts = products.filter((item) => {
      const haystack = [item.name, item.price, item.availability]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.some((token) => haystack.includes(token));
    });

    if (lowerMessage.includes("offer")) {
      return `Current offers: ${contextData.offers || "No offers are listed for this shop right now."}`;
    }

    if (
      lowerMessage.includes("where") ||
      lowerMessage.includes("location") ||
      lowerMessage.includes("ekkada") ||
      lowerMessage.includes("address")
    ) {
      return `${contextData.shopName || "This shop"} is listed${contextData.area ? ` in ${contextData.area}` : contextData.city ? ` in ${contextData.city}` : ""}${contextData.address ? `, address: ${contextData.address}` : ""}. ${contextData.description ? `About the shop: ${contextData.description}` : ""}`.trim();
    }

    if (matchingProducts.length) {
      return `I found these matching products in ${contextData.shopName || "this shop"}: ${matchingProducts
        .slice(0, 5)
        .map((item) => `${item.name} for Rs. ${item.price} (${item.availability || "availability unknown"})`)
        .join(", ")}.`;
    }

    if (products.length) {
      const productNames = products.slice(0, 5).map((item) => item.name).filter(Boolean);
      if (productNames.length) {
        return `I can help with this shop. Available products include ${productNames.join(", ")}. Ask about price, availability, or offers.`;
      }
    }

    return `I can help with ${contextData.shopName || "this shop"}. Ask about products, pricing, availability, or offers.`;
  }

  if (role === "hospital") {
    if (contextData.assistantMode === "hybrid") {
      return "I can help with this hospital's services, doctors, timings, and appointments. If you share symptoms, I can also explain possible related conditions, likely effects, urgency, and red flags without giving a diagnosis.";
    }
    if (contextData.assistantMode === "care") {
      return "I can help summarize the patient's symptoms, possible related conditions, likely effects, red flags, and follow-up points for the hospital team. I cannot give a diagnosis. Share the symptoms, duration, age, and warning signs.";
    }

    if (Array.isArray(contextData.services) && contextData.services.length) {
      return `I can help with ${contextData.hospitalName || "this hospital"}. Services include ${contextData.services.slice(0, 5).join(", ")}. Ask about doctors, timings, or appointments.`;
    }

    return `I can help with ${contextData.hospitalName || "this hospital"}. Ask about services, doctors, timings, or appointment availability.`;
  }

  if (role === "customer") {
    const products = Array.isArray(contextData.products) ? contextData.products : [];
    const shops = Array.isArray(contextData.shops) ? contextData.shops : [];
    const hospitals = Array.isArray(contextData.hospitals) ? contextData.hospitals : [];
    const tokens = lowerMessage
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2);

    const matchingProducts = products.filter((product) => {
      const haystack = [
        product.name,
        product.shopName,
        product.category,
        product.availability
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.some((token) => haystack.includes(token));
    });

    const matchingShops = shops.filter((shop) => {
      const haystack = [
        shop.name,
        shop.city,
        shop.area,
        shop.category,
        shop.ownerName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.some((token) => haystack.includes(token));
    });

    const matchingHospitals = hospitals.filter((hospital) => {
      const haystack = [
        hospital.name,
        hospital.city,
        ...(Array.isArray(hospital.departments) ? hospital.departments : [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.some((token) => haystack.includes(token));
    });

    if (matchingProducts.length) {
      return `I found these matching products: ${matchingProducts
        .slice(0, 5)
        .map((product) => `${product.name} at ${product.shopName || "a shop"} for Rs. ${product.price} (${product.availability || "availability unknown"})`)
        .join(", ")}.`;
    }

    if (matchingShops.length) {
      return `I found these matching shops${contextData.customerArea ? ` near ${contextData.customerArea}` : ""}: ${matchingShops
        .slice(0, 5)
        .map((shop) => `${shop.name} (${shop.category || "general"}, ${shop.area || shop.city || "location unknown"})`)
        .join(", ")}.`;
    }

    if (matchingHospitals.length) {
      return `I found these hospitals for your request: ${matchingHospitals
        .slice(0, 5)
        .map((hospital) => `${hospital.name} in ${hospital.city || "your area"}`)
        .join(", ")}.`;
    }

    if (products.length) {
      return `I can help with live marketplace data. Available examples include ${products
        .slice(0, 5)
        .map((product) => `${product.name} from ${product.shopName || "a shop"}`)
        .join(", ")}. Ask for a product, shop type, hospital, or area and I will try to match it.`;
    }
  }

  return "I can help with Medilink AI navigation, accounts, hospitals, shops, and appointments. Ask a more specific question and I will do my best to help.";
}

function sanitizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizePatientReport(report = {}, fallbackReply = "") {
  return {
    patientName: String(report.patientName || "").trim(),
    summaryText: String(report.summaryText || fallbackReply || "").trim(),
    urgency: String(report.urgency || "Routine").trim(),
    recommendedDepartment: String(report.recommendedDepartment || "").trim(),
    reportedSymptoms: sanitizeArray(report.reportedSymptoms),
    possibleConditions: sanitizeArray(report.possibleConditions),
    effects: sanitizeArray(report.effects),
    precautions: sanitizeArray(report.precautions),
    followUpQuestions: sanitizeArray(report.followUpQuestions),
    redFlags: sanitizeArray(report.redFlags)
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeIntegrationConfig(config = {}) {
  return {
    softwareName: String(config.softwareName || "").trim(),
    connectorType: String(config.connectorType || "").trim(),
    websiteUrl: String(config.websiteUrl || "").trim(),
    apiBaseUrl: String(config.apiBaseUrl || "").trim(),
    webhookUrl: String(config.webhookUrl || "").trim(),
    connectionMethod: String(config.connectionMethod || "").trim(),
    databaseProvider: String(config.databaseProvider || "").trim(),
    databaseName: String(config.databaseName || "").trim(),
    syncDirection: String(config.syncDirection || "").trim(),
    accessKeyLabel: String(config.accessKeyLabel || "").trim(),
    integrationNotes: String(config.integrationNotes || "").trim(),
    syncEnabled: Boolean(config.syncEnabled)
  };
}

function buildIntegrationTarget(role, entityId) {
  return `${String(role || "unknown").trim()}:${String(entityId || "unknown").trim()}`;
}

function normalizeIntegrationProduct(item = {}) {
  const name =
    item.productName ||
    item.name ||
    item.title ||
    item.product ||
    "";

  return {
    externalId: String(item.id || item.externalId || item.sku || item.barcode || name).trim(),
    productName: String(name || "").trim(),
    barcode: String(item.barcode || item.qrCode || "").trim(),
    category: String(item.category || item.categoryName || "General").trim(),
    brand: String(item.brand || "").trim(),
    unit: String(item.unit || item.pack || "").trim(),
    description: String(item.description || item.about || "").trim(),
    costPrice: Number(item.costPrice || item.purchasePrice || 0),
    price: Number(item.price || item.sellingPrice || item.salePrice || 0),
    mrp: Number(item.mrp || item.listPrice || item.price || 0),
    quantity: Number(item.quantity || item.stock || item.inventory || 0),
    image: String(item.image || item.imageUrl || item.thumbnail || "").trim()
  };
}

async function fetchSellerExternalProducts(apiBaseUrl) {
  const candidateUrls = [
    apiBaseUrl,
    `${apiBaseUrl.replace(/\/$/, "")}/products`,
    `${apiBaseUrl.replace(/\/$/, "")}/api/products`
  ];

  for (const url of candidateUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        const payload = response.data;
        if (Array.isArray(payload)) {
          return payload;
        }
        if (Array.isArray(payload?.products)) {
          return payload.products;
        }
        if (Array.isArray(payload?.data)) {
          return payload.data;
        }
      }
    } catch (error) {
      functions.logger.warn("Seller external products fetch failed:", error.message);
    }
  }

  return [];
}

async function upsertSellerProductsFromIntegration(shopId, integrationConfig) {
  const externalProducts = await fetchSellerExternalProducts(integrationConfig.apiBaseUrl || integrationConfig.websiteUrl);

  if (!externalProducts.length) {
    return {
      importedCount: 0,
      message: "No external products found from the configured API."
    };
  }

  const normalizedProducts = externalProducts
    .map((item) => normalizeIntegrationProduct(item))
    .filter((item) => item.productName);

  const existingSnapshot = await admin
    .firestore()
    .collection("products")
    .where("shopId", "==", shopId)
    .get();

  const existingProducts = existingSnapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    ...doc.data()
  }));

  let importedCount = 0;

  for (const product of normalizedProducts) {
    const match = existingProducts.find((item) => {
      const sameExternalId =
        product.externalId &&
        String(item.externalId || "").trim() === product.externalId;
      const sameBarcode =
        product.barcode &&
        String(item.barcode || "").trim() === product.barcode;
      const sameName =
        normalizeText(item.productName || item.name) === normalizeText(product.productName);

      return sameExternalId || sameBarcode || sameName;
    });

    const payload = {
      productName: product.productName,
      barcode: product.barcode,
      category: product.category,
      brand: product.brand,
      unit: product.unit,
      description: product.description,
      costPrice: product.costPrice,
      price: product.price,
      mrp: product.mrp,
      quantity: product.quantity,
      image: product.image,
      shopId,
      externalId: product.externalId,
      externalSource: integrationConfig.softwareName || integrationConfig.apiBaseUrl || "integration-api",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (match?.ref) {
      await match.ref.set(payload, { merge: true });
    } else {
      await admin.firestore().collection("products").add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    importedCount += 1;
  }

  return {
    importedCount,
    message: `Imported or updated ${importedCount} products into Medilink AI.`
  };
}

function normalizeIntegrationAppointment(item = {}, hospitalId = "", hospitalName = "") {
  const patientName =
    item.patientName ||
    item.name ||
    item.patient ||
    item.bookedByName ||
    "";

  const status = String(
    item.status ||
    item.appointmentStatus ||
    "Pending review"
  ).trim();

  return {
    externalId: String(item.id || item.externalId || item.referenceId || `${patientName}-${item.date || ""}`).trim(),
    hospitalId,
    hospitalName: String(item.hospitalName || hospitalName || "").trim(),
    patientName: String(patientName || "").trim(),
    bookedByName: String(item.bookedByName || patientName || "").trim(),
    bookedByPhone: String(item.bookedByPhone || item.contact || item.phone || "").trim(),
    contact: String(item.contact || item.phone || item.mobile || "").trim(),
    department: String(item.department || item.specialty || "General").trim(),
    date: String(item.date || item.appointmentDate || "").trim(),
    priority: String(item.priority || "Normal").trim(),
    note: String(item.note || item.reason || "").trim(),
    responseNote: String(item.responseNote || item.hospitalNote || "").trim(),
    status
  };
}

async function fetchHospitalExternalAppointments(apiBaseUrl) {
  const candidateUrls = [
    apiBaseUrl,
    `${apiBaseUrl.replace(/\/$/, "")}/appointments`,
    `${apiBaseUrl.replace(/\/$/, "")}/api/appointments`
  ];

  for (const url of candidateUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        const payload = response.data;
        if (Array.isArray(payload)) {
          return payload;
        }
        if (Array.isArray(payload?.appointments)) {
          return payload.appointments;
        }
        if (Array.isArray(payload?.data)) {
          return payload.data;
        }
      }
    } catch (error) {
      functions.logger.warn("Hospital external appointments fetch failed:", error.message);
    }
  }

  return [];
}

async function upsertHospitalAppointmentsFromIntegration(hospitalId, profileName, integrationConfig) {
  const externalAppointments = await fetchHospitalExternalAppointments(
    integrationConfig.apiBaseUrl || integrationConfig.websiteUrl
  );

  if (!externalAppointments.length) {
    return {
      importedCount: 0,
      message: "No external appointments found from the configured API."
    };
  }

  const normalizedAppointments = externalAppointments
    .map((item) => normalizeIntegrationAppointment(item, hospitalId, profileName))
    .filter((item) => item.patientName);

  const existingSnapshot = await admin
    .firestore()
    .collection("hospitalAppointments")
    .where("hospitalId", "==", hospitalId)
    .get();

  const existingAppointments = existingSnapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    ...doc.data()
  }));

  let importedCount = 0;

  for (const appointment of normalizedAppointments) {
    const match = existingAppointments.find((item) => {
      const sameExternalId =
        appointment.externalId &&
        String(item.externalId || "").trim() === appointment.externalId;
      const samePatientAndDate =
        normalizeText(item.patientName) === normalizeText(appointment.patientName) &&
        String(item.date || "").trim() === appointment.date;

      return sameExternalId || samePatientAndDate;
    });

    const payload = {
      hospitalId,
      hospitalName: appointment.hospitalName,
      patientName: appointment.patientName,
      bookedByName: appointment.bookedByName,
      bookedByPhone: appointment.bookedByPhone,
      contact: appointment.contact,
      department: appointment.department,
      date: appointment.date,
      priority: appointment.priority,
      note: appointment.note,
      responseNote: appointment.responseNote,
      status: appointment.status,
      externalId: appointment.externalId,
      externalSource: integrationConfig.softwareName || integrationConfig.apiBaseUrl || "integration-api",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (match?.ref) {
      await match.ref.set(payload, { merge: true });
    } else {
      await admin.firestore().collection("hospitalAppointments").add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    importedCount += 1;
  }

  return {
    importedCount,
    message: `Imported or updated ${importedCount} appointments into Medilink AI.`
  };
}

function buildImageSearchTerms({ query = "", brand = "", category = "" }) {
  const terms = [query, brand, category]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (!terms.length) {
    return [];
  }

  const joined = terms.join(" ");
  return [
    `${joined} product pack shot`,
    `${joined} product`,
    joined
  ];
}

function scoreCatalogMatch(product, query, barcode) {
  let score = 0;
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(product.productName || product.name);
  const normalizedCategory = normalizeText(product.category);
  const productBarcode = String(product.barcode || "").trim();

  if (barcode && productBarcode && productBarcode === String(barcode).trim()) {
    score += 100;
  }

  if (normalizedQuery) {
    if (normalizedName === normalizedQuery) score += 60;
    if (normalizedName.includes(normalizedQuery)) score += 40;
    if (normalizedCategory.includes(normalizedQuery)) score += 20;

    normalizedQuery.split(" ").forEach((token) => {
      if (token.length > 2 && normalizedName.includes(token)) score += 12;
    });
  }

  return score;
}

async function fetchInternetCatalogMatches({ query = "", category = "", barcode = "" }) {
  const results = [];
  const normalizedCategory = normalizeText(category);

  const shouldSearchFood =
    !normalizedCategory ||
    ["groceries", "fruits", "vegetables", "snacks", "healthcare", "personalcare", "babycare"].some((item) =>
      normalizedCategory.includes(item)
    );

  const shouldSearchMedicine =
    normalizedCategory.includes("medicine") || normalizedCategory.includes("health");

  if (shouldSearchFood && (query || barcode)) {
    try {
      const foodUrl = barcode
        ? `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`
        : `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=6`;

      const foodResponse = await axios.get(foodUrl, { timeout: 12000 });
      const foodProducts = barcode
        ? foodResponse.data?.product
          ? [foodResponse.data.product]
          : []
        : foodResponse.data?.products || [];

      foodProducts.slice(0, 6).forEach((item) => {
        results.push({
          source: "internet",
          sourceLabel: "OpenFoodFacts",
          name: item.product_name || item.product_name_en || item.generic_name || "",
          category: category || item.categories_tags?.[0]?.replace(/^en:/, "") || "Groceries",
          barcode: item.code || barcode || "",
          brand: item.brands || "",
          unit: item.quantity || "",
          description: item.generic_name || item.ingredients_text || "",
          image: item.image_front_url || item.image_url || "",
          reason: "Matched from online product catalog."
        });
      });
    } catch (error) {
      functions.logger.warn("OpenFoodFacts search failed:", error.message);
    }
  }

  if (shouldSearchMedicine && query) {
    try {
      const fdaUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodeURIComponent(query)}*&limit=6`;
      const fdaResponse = await axios.get(fdaUrl, { timeout: 12000 });
      const labels = fdaResponse.data?.results || [];

      labels.forEach((item) => {
        results.push({
          source: "internet",
          sourceLabel: "openFDA",
          name:
            item.openfda?.brand_name?.[0] ||
            item.openfda?.generic_name?.[0] ||
            query,
          category: category || "Medicine",
          barcode: "",
          brand: item.openfda?.manufacturer_name?.[0] || "",
          unit: "",
          description: item.purpose?.[0] || item.indications_and_usage?.[0] || "",
          image: "",
          reason: "Matched from online medicine label data."
        });
      });
    } catch (error) {
      functions.logger.warn("openFDA search failed:", error.message);
    }
  }

  const unique = [];
  const seen = new Set();

  results.forEach((item) => {
    const key = `${normalizeText(item.name)}|${normalizeText(item.brand)}|${item.barcode || ""}`;
    if (!item.name || seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return unique.slice(0, 8);
}

async function fetchInternetImageMatches({ query = "", brand = "", category = "" }) {
  const searchTerms = buildImageSearchTerms({ query, brand, category });
  const results = [];
  const seen = new Set();

  for (const term of searchTerms) {
    try {
      const response = await axios.get("https://api.openverse.org/v1/images/", {
        params: {
          q: term,
          page_size: 6,
          mature: false
        },
        timeout: 12000
      });

      const items = Array.isArray(response.data?.results) ? response.data.results : [];
      items.forEach((item) => {
        const imageUrl = item.thumbnail || item.url || "";
        const title = item.title || query || "";
        const key = `${normalizeText(title)}|${imageUrl}`;

        if (!imageUrl || !title || seen.has(key)) {
          return;
        }

        seen.add(key);
        results.push({
          source: "internet-image",
          sourceLabel: "Openverse",
          name: title,
          category: category || "",
          brand: brand || "",
          image: imageUrl,
          imageFull: item.url || imageUrl,
          creator: item.creator || "",
          license: item.license || "",
          reason: `Internet image suggestion for ${query || title}.`
        });
      });
    } catch (error) {
      functions.logger.warn("Openverse image search failed:", error.message);
    }

    if (results.length >= 8) {
      break;
    }
  }

  return results.slice(0, 8);
}

async function buildCatalogSuggestions({ query = "", barcode = "", shopId = "", category = "" }) {
  const snapshot = await admin.firestore().collection("products").limit(250).get();
  const allProducts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const rankedMatches = allProducts
    .map((product) => ({
      product,
      score: scoreCatalogMatch(product, query, barcode)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.product);

  const localMatches = shopId
    ? rankedMatches.filter((item) => item.shopId === shopId).slice(0, 6)
    : rankedMatches.slice(0, 6);

  const internetMatches = await fetchInternetCatalogMatches({ query, barcode, category });
  const inferredBrand = internetMatches[0]?.brand || "";
  const imageSuggestions = await fetchInternetImageMatches({
    query: query || internetMatches[0]?.name || "",
    brand: inferredBrand,
    category
  });

  const geminiKey = getGeminiKey();
  let aiSuggestions = [];

  if (geminiKey && (query || barcode)) {
    try {
      const prompt = `
You help sellers normalize product catalog entries for Medilink AI.
Return only JSON with shape {"suggestions":[{"name":"","category":"","brand":"","unit":"","searchTerms":[],"reason":"","imageHint":""}]}.
Use the user's query, barcode, selected category, Firebase matches, and internet catalog matches to suggest likely product catalog entries.
Keep at most 6 suggestions. No markdown.

User query: ${query || "N/A"}
Barcode: ${barcode || "N/A"}
Selected category: ${category || "N/A"}
Firebase matches: ${rankedMatches.map((item) => `${item.productName || item.name} | category=${item.category || ""} | barcode=${item.barcode || ""} | brand=${item.brand || ""} | unit=${item.unit || ""}`).join("; ") || "N/A"}
Internet catalog matches: ${internetMatches.map((item) => `${item.name} | source=${item.sourceLabel} | category=${item.category || ""} | brand=${item.brand || ""} | barcode=${item.barcode || ""} | unit=${item.unit || ""}`).join("; ") || "N/A"}
      `.trim();

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      const rawText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(rawText);
      aiSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 6) : [];
    } catch (error) {
      functions.logger.warn("Catalog suggestion AI fallback:", error.response?.data || error.message);
    }
  }

  aiSuggestions = aiSuggestions.map((item) => {
    const matchingImage = imageSuggestions.find((imageItem) => {
      const imageName = normalizeText(imageItem.name);
      const itemName = normalizeText(item.name);
      const imageHint = normalizeText(item.imageHint);
      return (
        (itemName && imageName.includes(itemName)) ||
        (imageHint && imageName.includes(imageHint))
      );
    });

    return {
      ...item,
      image: item.image || matchingImage?.image || "",
      imageFull: matchingImage?.imageFull || "",
      sourceLabel: matchingImage?.sourceLabel || ""
    };
  });

  return {
    localMatches: localMatches.map((item) => ({
      id: item.id,
      name: item.productName || item.name || "",
      category: item.category || "",
      barcode: item.barcode || "",
      brand: item.brand || "",
      unit: item.unit || "",
      price: item.price ?? "",
      mrp: item.mrp ?? "",
      costPrice: item.costPrice ?? "",
      quantity: item.quantity ?? "",
      image: item.image || "",
      description: item.description || ""
    })),
    internetMatches,
    imageSuggestions,
    aiSuggestions
  };
}

// WhatsApp AI Function
exports.whatsappAI = functions.https.onRequest(async (req, res) => {
  const geminiKey = getGeminiKey();
  const webAppUrl = getWebAppUrl();
  const whatsappPhoneNumberId = getWhatsappPhoneNumberId();
  const whatsappToken = getWhatsappToken();

  if (!geminiKey) {
    console.error("GEMINI_KEY is not defined in environment params.");
    return res.status(500).send("Configuration error.");
  }

  if (!whatsappPhoneNumberId || !whatsappToken) {
    console.error("WhatsApp runtime params are missing: phone id or token.");
    return res.status(500).send("WhatsApp configuration error.");
  }

  if (req.method === "GET") {
    const verifyToken = "medilink_verify_123";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && token === verifyToken) {
      console.log("Webhook verified successfully!");
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages[0]) {
      const userMessage = messages[0].text?.body || "";
      const from = messages[0].from;

      console.log("Incoming message:", userMessage, "from:", from);

      let reply = "Sorry, I couldn't generate a reply.";

      try {
        const geminiResponse = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          { contents: [{ parts: [{ text: userMessage }] }] },
          { headers: { "Content-Type": "application/json" } }
        );

        reply = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || reply;
      } catch (err) {
        console.error("Gemini error:", err.response?.data || err.message);
        reply = "AI service is not available right now.";
      }

      let finalReply = reply;
      const lowerMsg = userMessage.toLowerCase();

      if (
        webAppUrl
        && (
          lowerMsg.includes("login")
          || lowerMsg.includes("open")
          || lowerMsg.includes("app")
          || lowerMsg.includes("seller")
          || lowerMsg.includes("register")
        )
      ) {
        finalReply += `\n\nOpen Medilink App:\n${webAppUrl}`;
      }

      const messagePayload = webAppUrl
        ? {
            messaging_product: "whatsapp",
            to: from,
            type: "interactive",
            interactive: {
              type: "cta_url",
              body: {
                text: finalReply
              },
              action: {
                name: "cta_url",
                parameters: {
                  display_text: "Open Medilink App",
                  url: webAppUrl
                }
              }
            }
          }
        : {
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: {
              body: finalReply
            }
          };

      await axios.post(
        `https://graph.facebook.com/v20.0/${whatsappPhoneNumberId}/messages`,
        messagePayload,
        {
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json"
          }
        }
      );
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    return res.sendStatus(500);
  }
});

// Modularized seed function
const { seedCategories } = require("./seedCategories");
exports.seedCategories = seedCategories;

// Gemini Chatbot API Function
exports.chat = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const { role, userMessage, contextData = {} } = req.body;
      const geminiKey = getGeminiKey();

      if (!role || !userMessage) {
        return res.status(400).json({ error: "Missing 'role' or 'userMessage'." });
      }

      const promptConfig = buildContext(role, contextData);
      if (!promptConfig) {
        return res.status(400).send("Invalid 'role' provided.");
      }
      const { systemInstruction, context } = promptConfig;
      const isHospitalCareAssistant = role === "hospital" && contextData.assistantMode === "care";

      const fullPrompt = isHospitalCareAssistant
        ? `${systemInstruction}

Context: ${context}

User message: ${userMessage}

Return only JSON with this exact shape:
{"reply":"","patientReport":{"patientName":"","summaryText":"","urgency":"","recommendedDepartment":"","reportedSymptoms":[],"possibleConditions":[],"effects":[],"precautions":[],"followUpQuestions":[],"redFlags":[]}}

Rules:
- "reply" must be patient-friendly and safe.
- Do not diagnose. Use language like "may", "can be related to", or "possible causes".
- Mention emergency care when red-flag symptoms are present.
- No markdown code fences.`
        : `${systemInstruction}\n\nContext: ${context}\n\nUser question: ${userMessage}`;

      functions.logger.log("Sending prompt to Gemini:", fullPrompt);

      if (!geminiKey) {
        functions.logger.warn("Gemini key missing. Falling back to deterministic chat reply.");
        const fallbackReply = buildFallbackReply(role, contextData, userMessage);
        return res.status(200).json({
          reply: fallbackReply,
          fallback: true,
          ...(isHospitalCareAssistant
            ? {
                patientReport: sanitizePatientReport({
                  patientName: contextData.patientName || "",
                  summaryText: fallbackReply,
                  urgency: "Review required"
                }, fallbackReply)
              }
            : {})
        });
      }

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: fullPrompt }] }],
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const rawReply =
        geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I couldn’t generate a reply.";

      functions.logger.log("Gemini reply:", rawReply);

      if (isHospitalCareAssistant) {
        try {
          const parsed = JSON.parse(rawReply);
          const reply = String(parsed.reply || "").trim() || buildFallbackReply(role, contextData, userMessage);
          return res.status(200).json({
            reply,
            patientReport: sanitizePatientReport(parsed.patientReport, reply)
          });
        } catch (parseError) {
          functions.logger.warn("Hospital care JSON parse fallback:", parseError.message);
          return res.status(200).json({
            reply: rawReply,
            patientReport: sanitizePatientReport({
              patientName: contextData.patientName || "",
              summaryText: rawReply,
              urgency: "Review required"
            }, rawReply)
          });
        }
      }

      return res.status(200).json({ reply: rawReply });
    } catch (error) {
      functions.logger.error("Chatbot API error:", error.response?.data || error.message);
      const { role, userMessage, contextData = {} } = req.body || {};

      if (role && userMessage) {
        const fallbackReply = buildFallbackReply(role, contextData, userMessage);
        return res.status(200).json({
          reply: fallbackReply,
          fallback: true,
          ...(role === "hospital" && contextData.assistantMode === "care"
            ? {
                patientReport: sanitizePatientReport({
                  patientName: contextData.patientName || "",
                  summaryText: fallbackReply,
                  urgency: "Review required"
                }, fallbackReply)
              }
            : {})
        });
      }

      return res.status(500).send("Error processing your request.");
    }
  });
});

exports.catalogSuggest = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const { query = "", barcode = "", shopId = "", category = "" } = req.body || {};
      if (!query && !barcode) {
        return res.status(400).json({ error: "Missing query or barcode." });
      }

      const suggestions = await buildCatalogSuggestions({ query, barcode, shopId, category });
      return res.status(200).json(suggestions);
    } catch (error) {
      functions.logger.error("Catalog suggest error:", error.response?.data || error.message);
      return res.status(500).json({ error: "Could not build catalog suggestions." });
    }
  });
});

exports.integrationSync = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const {
        action = "",
        role = "",
        entityId = "",
        profileName = "",
        integrationConfig = {}
      } = req.body || {};

      if (!action || !role || !entityId) {
        return res.status(400).json({ error: "Missing action, role, or entityId." });
      }

      const sanitizedConfig = sanitizeIntegrationConfig(integrationConfig);
      const targetKey = buildIntegrationTarget(role, entityId);
      const profileRef = admin.firestore().collection("integrationProfiles").doc(targetKey);

      if (action === "saveConfig") {
        await profileRef.set({
          role,
          entityId,
          profileName: String(profileName || "").trim(),
          integrationConfig: sanitizedConfig,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
          ok: true,
          message: "Integration config saved.",
          targetKey
        });
      }

      if (action === "testConnection") {
        const candidateUrl = sanitizedConfig.apiBaseUrl || sanitizedConfig.websiteUrl || sanitizedConfig.webhookUrl;

        if (!candidateUrl) {
          return res.status(200).json({
            ok: true,
            reachable: false,
            mode: sanitizedConfig.connectionMethod || "Manual",
            message: "No API or website URL found. Save a valid URL to test the connection."
          });
        }

        try {
          const response = await axios.get(candidateUrl, {
            timeout: 10000,
            validateStatus: () => true
          });

          return res.status(200).json({
            ok: true,
            reachable: response.status >= 200 && response.status < 500,
            statusCode: response.status,
            mode: sanitizedConfig.connectionMethod || "API",
            message: `Connection test finished with HTTP ${response.status}.`
          });
        } catch (error) {
          return res.status(200).json({
            ok: true,
            reachable: false,
            mode: sanitizedConfig.connectionMethod || "API",
            message: `Connection test failed: ${error.message}`
          });
        }
      }

      if (action === "runSync") {
        let syncResult = null;

        if (
          role === "seller" &&
          sanitizedConfig.syncEnabled &&
          (sanitizedConfig.connectionMethod === "API" || sanitizedConfig.connectionMethod === "Manual Sync")
        ) {
          syncResult = await upsertSellerProductsFromIntegration(entityId, sanitizedConfig);
        }

        if (
          role === "hospital" &&
          sanitizedConfig.syncEnabled &&
          (sanitizedConfig.connectionMethod === "API" || sanitizedConfig.connectionMethod === "Manual Sync")
        ) {
          syncResult = await upsertHospitalAppointmentsFromIntegration(entityId, profileName, sanitizedConfig);
        }

        const jobRef = await admin.firestore().collection("integrationSyncJobs").add({
          role,
          entityId,
          profileName: String(profileName || "").trim(),
          targetKey,
          integrationConfig: sanitizedConfig,
          status: sanitizedConfig.syncEnabled ? (syncResult ? "completed" : "queued") : "draft",
          syncDirection: sanitizedConfig.syncDirection || "Import into Medilink",
          connectionMethod: sanitizedConfig.connectionMethod || "Manual",
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessage: sanitizedConfig.syncEnabled
            ? syncResult?.message || "Sync request queued. Build provider-specific connector next."
            : "Sync saved as draft. Enable integration before running live sync."
        });

        await profileRef.set({
          role,
          entityId,
          profileName: String(profileName || "").trim(),
          integrationConfig: sanitizedConfig,
          lastSyncJobId: jobRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
          ok: true,
          jobId: jobRef.id,
          status: sanitizedConfig.syncEnabled ? (syncResult ? "completed" : "queued") : "draft",
          importedCount: syncResult?.importedCount || 0,
          message: sanitizedConfig.syncEnabled
            ? syncResult?.message || "Integration sync request queued."
            : "Integration saved, but sync remains draft until enabled."
        });
      }

      return res.status(400).json({ error: "Unknown integration action." });
    } catch (error) {
      functions.logger.error("Integration sync error:", error.response?.data || error.message);
      return res.status(500).json({ error: "Could not process integration request." });
    }
  });
});

exports.legalAssistant = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const body = req.body || {};
      const action = String(body.action || "").trim();
      const ownerId = String(body.ownerId || "anonymous").trim();

      if (!action) {
        return res.status(400).json({ error: "Missing action." });
      }

      const userTextForSafety = [
        body.problem,
        body.caseDetails,
        body.facts,
        body.evidence,
        body.documentText,
        body.query
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(" ");

      if (isUnsafeLegalRequest(userTextForSafety)) {
        await writeLegalAudit(ownerId, action, userTextForSafety, "blocked", {
          reason: "unsafe_request"
        });
        return res.status(400).json({
          error: "Request blocked by legal safety policy."
        });
      }

      const quota = await ensureLegalQuota(ownerId, action);
      if (!quota.allowed) {
        await writeLegalAudit(ownerId, action, userTextForSafety, "blocked", {
          reason: quota.reason
        });
        return res.status(402).json({
          error: quota.reason,
          subscription: quota.subscription || null
        });
      }

      if (action === "public_guidance") {
        const problem = String(body.problem || "").trim();
        const location = String(body.location || "").trim();
        const language = String(body.language || "english").toLowerCase();
        const documentText = String(body.documentText || "").trim();
        const disclaimText = "This is not a substitute for a qualified lawyer.";

        if (!problem) {
          return res.status(400).json({ error: "Missing legal problem description." });
        }

        const context = retrieveLegalContext(`${problem} ${location} ${documentText}`, 7);
        const legacyLawNotice = getLegacyLawNotice(`${problem} ${location} ${documentText}`);
        const contextText = context
          .map((item, index) => `${index + 1}. ${item.citation}\n${item.body}`)
          .join("\n\n");

        const fallback = {
          explanation: language === "telugu"
            ? "మీ సమస్యకు సంబంధించిన చట్టపరమైన సమాచారం క్రింద ఇచ్చాం. ఖచ్చితమైన కేసు సలహా కోసం న్యాయవాదిని సంప్రదించండి."
            : "Here is general legal guidance based on Indian law references. For case-specific advice, consult a qualified lawyer.",
          law: context.map((item) => item.citation),
          steps: [
            language === "telugu" ? "సాక్ష్యాలు, డాక్యుమెంట్లు సేకరించండి." : "Collect supporting evidence and documents.",
            language === "telugu" ? "స్థానిక పోలీస్ స్టేషన్ లేదా సంబంధిత అధికారికి ఫిర్యాదు చేయండి." : "File a complaint with the local police station or relevant authority.",
            language === "telugu" ? "నోటీస్ లేదా ఫిర్యాదు డ్రాఫ్ట్‌ను న్యాయవాదితో రివ్యూ చేయండి." : "Review your notice/complaint draft with a lawyer."
          ],
          suggestedActions: [
            language === "telugu" ? "లీగల్ నోటీస్ పంపడం పరిగణించండి." : "Consider issuing a legal notice.",
            language === "telugu" ? "లీగల్ ఎయిడ్ సెంటర్‌ను సంప్రదించండి." : "Contact a legal aid center if needed."
          ],
          complaintNotice: language === "telugu"
            ? "కు,\nస్టేషన్ హౌస్ ఆఫీసర్,\n[పోలీస్ స్టేషన్ పేరు]\nవిషయం: [సమస్య] పై ఫిర్యాదు.\nనాకు [తేదీ] నాడు [ఘటన] జరిగింది. చట్టపరమైన చర్యలు తీసుకోవాలి."
            : "To,\nStation House Officer,\n[Police Station Name]\nSubject: Complaint regarding [issue].\nI respectfully submit that on [date], [incident details]. Kindly take legal action.",
          disclaimer: disclaimText,
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title }))
        };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.public,
          userPrompt: `Language: ${language}\nLocation: ${location || "Not provided"}\nProblem: ${problem}\nDocument Text: ${documentText || "N/A"}\n\nRetrieved legal references:\n${contextText}`,
          schemaHint: "{\"explanation\":\"\",\"law\":[],\"steps\":[],\"suggestedActions\":[],\"complaintNotice\":\"\",\"disclaimer\":\"This is not a substitute for a qualified lawyer.\"}",
          fallback
        });

        await writeLegalAudit(ownerId, action, `${location} | ${problem}`, "ok", {
          language
        });

        return res.status(200).json({
          explanation: String(aiResponse.explanation || fallback.explanation),
          law: Array.isArray(aiResponse.law) && aiResponse.law.length ? aiResponse.law : fallback.law,
          steps: Array.isArray(aiResponse.steps) && aiResponse.steps.length ? aiResponse.steps : fallback.steps,
          suggestedActions: Array.isArray(aiResponse.suggestedActions) && aiResponse.suggestedActions.length
            ? aiResponse.suggestedActions
            : fallback.suggestedActions,
          complaintNotice: String(aiResponse.complaintNotice || fallback.complaintNotice),
          disclaimer: disclaimText,
          legalVersionNotice: legacyLawNotice,
          citations: fallback.citations,
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "lawyer_research") {
        const caseDetails = String(body.caseDetails || "").trim();
        if (!caseDetails) {
          return res.status(400).json({ error: "Missing case details." });
        }

        const caseNature = classifyCaseNature(caseDetails);
        const context = retrieveLegalContext(caseDetails, 8);
        const judgments = await loadJudgmentLibrary();
        const relatedJudgments = buildRelatedJudgments(judgments, caseDetails, 5);
        const filteredJudgments = relatedJudgments.filter((item) => {
          const judgmentText = `${item.title || ""} ${item.citation || ""} ${item.summary || ""} ${(item.issueTags || []).join(" ")}`.toLowerCase();
          if (caseNature === "civil") {
            return !/fir|police|arrest|criminal law|cognizable|murder|theft/.test(judgmentText);
          }
          if (caseNature === "criminal") {
            return !/rent|lease|tenant|landlord|specific performance|civil recovery/.test(judgmentText);
          }
          return true;
        });
        const authorityClusters = buildAuthorityClusters(filteredJudgments);
        const legacyLawNotice = getLegacyLawNotice(caseDetails);
        const contextText = context.map((item) => `${item.citation}\n${item.body}`).join("\n\n");
        const fallbackBestCases = filteredJudgments.slice(0, 3).map((item) => ({
          title: item.title,
          citation: item.citation,
          whyItMatters: item.ratioNote || item.summary,
          status: item.treatmentStatus || "verify",
          sourceUrl: item.sourceUrl || "",
          court: item.court || "",
          judgmentDate: item.judgmentDate || ""
        }));
        const fallback = {
          caseSummary: "Initial legal research summary generated from Indian law references.",
          applicableSections: context.map((item) => item.citation),
          caseLaws: fallbackBestCases,
          judgmentSummary: "Use cited references to expand arguments and verify latest judicial position.",
          bestCases: fallbackBestCases,
          authorityClusters: authorityClusters.map((cluster) => ({
            issue: cluster.issue,
            authorities: cluster.authorities.map((item) => ({
              title: item.title,
              citation: item.citation,
              status: item.status,
              whyItMatters: item.whyItMatters,
              sourceUrl: item.sourceUrl || ""
            }))
          }))
        };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `You are a legal research assistant.\n\nSTRICT RULES:\n- Only include laws directly relevant to the user's issue.\n- Do not include unrelated laws.\n- Do not suggest FIR or police steps for civil disputes.\n- If the case is about Section 138 / cheque dishonour, only include the Negotiable Instruments Act, directly relevant procedural law if necessary, and matching case law.\n\nCase classification: ${caseNature}\n\nCase details:\n${caseDetails}\n\nRetrieved context:\n${contextText}\n\nLatest matching judgments:\n${filteredJudgments.map((item) => `- ${item.title} | ${item.citation} | ${item.ratioNote || item.summary}`).join("\n") || "No related judgments found."}`,
          schemaHint: "{\"caseSummary\":\"\",\"applicableSections\":[],\"caseLaws\":[],\"judgmentSummary\":\"\",\"bestCases\":[],\"authorityClusters\":[{\"issue\":\"\",\"authorities\":[]}]}",
          fallback
        });

        const normalizedBestCases = Array.isArray(aiResponse.bestCases) && aiResponse.bestCases.length
          ? aiResponse.bestCases
          : fallback.bestCases;
        const normalizedCaseLaws = normalizedBestCases.length
          ? normalizedBestCases
          : (Array.isArray(aiResponse.caseLaws) && aiResponse.caseLaws.length ? aiResponse.caseLaws : []);
        const normalizedJudgmentSummary = String(aiResponse.judgmentSummary || "").trim()
          || (filteredJudgments.length
            ? "Matched judgments are shown below. Verify the exact proposition and latest treatment before reliance."
            : fallback.judgmentSummary);

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, caseDetails, "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          caseSummary: String(aiResponse.caseSummary || fallback.caseSummary),
          applicableSections: Array.isArray(aiResponse.applicableSections) ? aiResponse.applicableSections : fallback.applicableSections,
          caseLaws: normalizedCaseLaws,
          judgmentSummary: normalizedJudgmentSummary,
          bestCases: normalizedBestCases,
          authorityClusters: Array.isArray(aiResponse.authorityClusters) ? aiResponse.authorityClusters : fallback.authorityClusters,
          relatedJudgments: filteredJudgments,
          caseNature,
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context),
          traceability: buildTraceability({
            facts: caseDetails,
            authorities: [
              ...filteredJudgments.slice(0, 5).map((item) => ({
                title: item.title,
                citation: item.citation,
                whyItMatters: item.ratioNote || item.summary,
                status: item.treatmentStatus || "verify",
                pinpointRef: item.keyParagraphs?.[0] || "",
                pinpoint: {
                  paragraphNumber: Number(String(item.keyParagraphs?.[0] || "").match(/(\d+)/)?.[1] || 0) || null,
                  excerpt: item.holdingPoints?.[0] || item.ratioNote || item.summary || ""
                }
              })),
              ...context.slice(0, 5).map((item) => ({
                title: item.title,
                citation: item.citation,
                summary: item.body
              }))
            ],
            keyFactors: [
              String(aiResponse.caseSummary || fallback.caseSummary),
              String(aiResponse.judgmentSummary || fallback.judgmentSummary)
            ],
            notes: ["Verify the cited proposition from the full text before filing."]
          })
        });
      }

      if (action === "copilot_chat") {
        const message = String(body.message || "").trim();
        const facts = String(body.facts || "").trim();
        const draft = String(body.draft || "").trim();
        const tab = String(body.tab || "").trim();
        const workspaceOutput = body.output && typeof body.output === "object" ? body.output : {};
        const history = Array.isArray(body.history) ? body.history : [];

        if (!message) {
          return res.status(400).json({ error: "Missing copilot message." });
        }

        const workspaceAuthorities = [
          ...(Array.isArray(workspaceOutput.applicableSections) ? workspaceOutput.applicableSections : []),
          ...(Array.isArray(workspaceOutput.citations) ? workspaceOutput.citations.map((item) => `${item?.title || ""} ${item?.citation || ""}`.trim()) : []),
          ...(Array.isArray(workspaceOutput.bestCases) ? workspaceOutput.bestCases.map((item) => `${item?.title || ""} ${item?.citation || ""}`.trim()) : []),
          ...(Array.isArray(workspaceOutput.retrievedAuthorities) ? workspaceOutput.retrievedAuthorities.map((item) => `${item?.title || ""} ${item?.citation || ""}`.trim()) : [])
        ].filter(Boolean).slice(0, 20);

        const context = retrieveLegalContext(`${facts}\n${message}\n${draft}`, 8);
        const contextText = context.map((item) => `${item.citation}\n${item.body}`).join("\n\n");
        const recentHistory = history
          .filter((item) => item && typeof item === "object")
          .slice(-8)
          .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${String(item.text || "").trim()}`)
          .filter(Boolean)
          .join("\n");
        const replyText = await callOpenAIText({
          systemPrompt: `${LEGAL_SYSTEM_PROMPTS.lawyer}

You are an open-ended legal copilot inside a lawyer workspace.
- Answer the user's actual question directly.
- Do not begin with capability blurbs, menus, or phrases like "I can help with...".
- Behave like a natural AI assistant first, and a legal workspace copilot second.
- Use recent chat, workspace facts, draft text, visible authorities, and retrieved context only when useful.
- If the user asks for a draft, provide the draft in the reply itself with usable headings and text.
- If the user asks for explanation, explain plainly first, then relevance, then practical use.
- If the user asks what is unnecessary, separate relevant and irrelevant material clearly.
- If the user's question is broad, answer broadly instead of narrowing it.
- Match the user's language and tone unless they ask otherwise.`,
          userPrompt: `Recent chat:
${recentHistory || "No prior chat."}

Current tab:
${tab || "general"}

Workspace facts:
${facts || "No facts currently available."}

Current draft:
${draft || "No draft currently available."}

Visible authorities:
${workspaceAuthorities.join("\n") || "No visible authorities."}

Retrieved legal context:
${contextText || "No additional context."}

Latest user message:
${message}`
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, message, "ok", {
          tab,
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          reply: replyText,
          draft: "",
          suggestions: [],
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "matter_intake") {
        const rawFacts = String(body.rawFacts || "").trim();
        const documentText = String(body.documentText || "").trim();
        const intakeText = `${rawFacts}\n${documentText}`.trim();

        if (!intakeText) {
          return res.status(400).json({ error: "Missing intake facts or document text." });
        }

        const context = retrieveLegalContext(intakeText, 8);
        const legacyLawNotice = getLegacyLawNotice(intakeText);
        const fallback = {
          matterTitle: "New legal matter",
          clientSummary: "Client facts captured for initial legal review.",
          factSummary: rawFacts || documentText.slice(0, 800),
          legalIssues: context.slice(0, 4).map((item) => item.title),
          reliefsToConsider: ["Identify immediate relief", "Check notice / complaint requirement", "Prepare filing strategy"],
          documentsRequired: ["Identity documents", "Underlying transaction records", "Relevant correspondence"],
          nextSteps: ["Verify facts and documents", "Prepare chronology", "Move to research and draft stage"]
        };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Prepare a lawyer intake summary from these facts and documents.\n\nFacts:\n${rawFacts || "N/A"}\n\nDocument Text:\n${documentText || "N/A"}`,
          schemaHint: "{\"matterTitle\":\"\",\"clientSummary\":\"\",\"factSummary\":\"\",\"legalIssues\":[],\"reliefsToConsider\":[],\"documentsRequired\":[],\"nextSteps\":[]}",
          fallback
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, intakeText.slice(0, 2000), "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          matterTitle: String(aiResponse.matterTitle || fallback.matterTitle),
          clientSummary: String(aiResponse.clientSummary || fallback.clientSummary),
          factSummary: String(aiResponse.factSummary || fallback.factSummary),
          legalIssues: Array.isArray(aiResponse.legalIssues) ? aiResponse.legalIssues : fallback.legalIssues,
          reliefsToConsider: Array.isArray(aiResponse.reliefsToConsider) ? aiResponse.reliefsToConsider : fallback.reliefsToConsider,
          documentsRequired: Array.isArray(aiResponse.documentsRequired) ? aiResponse.documentsRequired : fallback.documentsRequired,
          nextSteps: Array.isArray(aiResponse.nextSteps) ? aiResponse.nextSteps : fallback.nextSteps,
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "chronology_builder") {
        const rawFacts = String(body.rawFacts || "").trim();
        const documentText = String(body.documentText || "").trim();
        const chronologySource = `${rawFacts}\n${documentText}`.trim();

        if (!chronologySource) {
          return res.status(400).json({ error: "Missing facts or document text for chronology." });
        }

        const fallbackEntries = chronologySource
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 12)
          .map((line, index) => ({
            date: "",
            event: line,
            source: index < 3 ? "client facts" : "document"
          }));

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Create a strict legal chronology from the following material. Extract only clear events. Use YYYY-MM-DD when a reliable date is available, otherwise leave date blank.\n\nFacts:\n${rawFacts || "N/A"}\n\nDocument Text:\n${documentText || "N/A"}`,
          schemaHint: "{\"entries\":[{\"date\":\"\",\"event\":\"\",\"source\":\"client facts|document|mixed\"}]}",
          fallback: { entries: fallbackEntries }
        });

        const entries = Array.isArray(aiResponse.entries) && aiResponse.entries.length
          ? aiResponse.entries.map((item) => ({
              date: String(item.date || "").trim(),
              event: String(item.event || "").trim(),
              source: String(item.source || "").trim() || "mixed"
            })).filter((item) => item.event)
          : fallbackEntries;

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, chronologySource.slice(0, 2000), "ok", {
          entryCount: entries.length
        });

        return res.status(200).json({ entries });
      }

      if (action === "research_memo") {
        const matterTitle = String(body.matterTitle || "").trim();
        const factSummary = String(body.factSummary || "").trim();
        const chronologyText = String(body.chronologyText || "").trim();
        const legalIssues = Array.isArray(body.legalIssues)
          ? body.legalIssues.map((item) => String(item).trim()).filter(Boolean)
          : [];
        const memoSource = `${matterTitle}\n${factSummary}\n${chronologyText}\n${legalIssues.join("\n")}`.trim();

        if (!memoSource) {
          return res.status(400).json({ error: "Missing matter details for research memo." });
        }

        const context = retrieveLegalContext(memoSource, 8);
        const judgments = await loadJudgmentLibrary();
        const relatedJudgments = buildRelatedJudgments(judgments, memoSource, 4);
        const legacyLawNotice = getLegacyLawNotice(memoSource);
        const fallback = {
          issueList: legalIssues.length ? legalIssues : context.slice(0, 4).map((item) => item.title),
          keyAuthorities: context.map((item) => item.citation),
          proceduralNotes: ["Verify limitation and maintainability.", "Check forum and jurisdiction.", "Prepare supporting documents and chronology."],
          riskFlags: ["Facts require documentary verification before final reliance."],
          nextActions: ["Expand authorities issue-wise.", "Prepare draft notice/petition.", "Confirm filing or notice strategy with client."],
          latestJudgmentNotes: relatedJudgments.map((item) => `${item.title} | ${item.citation} | ${item.ratioNote || item.summary}`)
        };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Prepare a concise lawyer research memo.\n\nMatter: ${matterTitle || "Untitled matter"}\n\nFact Summary:\n${factSummary || "N/A"}\n\nChronology:\n${chronologyText || "N/A"}\n\nLegal Issues:\n${legalIssues.join("\n") || "N/A"}\n\nLatest matching judgments:\n${relatedJudgments.map((item) => `- ${item.title} | ${item.citation} | ${item.ratioNote || item.summary}`).join("\n") || "No related judgments found."}`,
          schemaHint: "{\"issueList\":[],\"keyAuthorities\":[],\"proceduralNotes\":[],\"riskFlags\":[],\"nextActions\":[],\"latestJudgmentNotes\":[]}",
          fallback
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, memoSource.slice(0, 2000), "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          issueList: Array.isArray(aiResponse.issueList) ? aiResponse.issueList : fallback.issueList,
          keyAuthorities: Array.isArray(aiResponse.keyAuthorities) ? aiResponse.keyAuthorities : fallback.keyAuthorities,
          proceduralNotes: Array.isArray(aiResponse.proceduralNotes) ? aiResponse.proceduralNotes : fallback.proceduralNotes,
          riskFlags: Array.isArray(aiResponse.riskFlags) ? aiResponse.riskFlags : fallback.riskFlags,
          nextActions: Array.isArray(aiResponse.nextActions) ? aiResponse.nextActions : fallback.nextActions,
          latestJudgmentNotes: Array.isArray(aiResponse.latestJudgmentNotes) ? aiResponse.latestJudgmentNotes : fallback.latestJudgmentNotes,
          relatedJudgments,
          bestCases: relatedJudgments.slice(0, 3).map((item) => ({
            title: item.title,
            citation: item.citation,
            whyItMatters: item.ratioNote || item.summary,
            status: item.treatmentStatus || "verify",
            sourceUrl: item.sourceUrl || "",
            court: item.court || "",
            judgmentDate: item.judgmentDate || ""
          })),
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "notice_pack") {
        const matterTitle = String(body.matterTitle || "").trim();
        const factSummary = String(body.factSummary || "").trim();
        const chronologyText = String(body.chronologyText || "").trim();
        const issues = Array.isArray(body.legalIssues) ? body.legalIssues.map((item) => String(item).trim()).filter(Boolean) : [];
        const noticeSource = `${matterTitle}\n${factSummary}\n${chronologyText}\n${issues.join("\n")}`.trim();

        if (!noticeSource) {
          return res.status(400).json({ error: "Missing matter details for notice pack." });
        }

        const context = retrieveLegalContext(noticeSource, 8);
        const legacyLawNotice = getLegacyLawNotice(noticeSource);
        const fallback = {
          noticeTitle: matterTitle || "Legal Notice Draft",
          subjectLine: "Legal notice regarding dispute and demand",
          addresseeBlock: "[Name / Entity]\n[Address]",
          noticeDraft:
`LEGAL NOTICE\n\nTo,\n[Name / Entity]\n[Address]\n\nSubject: Legal notice regarding dispute and demand.\n\nUnder instructions from my client, it is stated that:\n1. ${factSummary || "Relevant facts are set out here."}\n2. The dispute requires immediate compliance / response.\n3. Failing compliance, appropriate legal proceedings may follow.\n\nYou are called upon to respond within [15] days.\n\nCounsel for client`,
          annexures: ["Client documents", "Relevant correspondence", "Chronology and supporting records"],
          filingReadiness: ["Verify addressee details", "Confirm demand / relief wording", "Review service mode and limitation"]
        };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Prepare a legal notice pack.\n\nMatter: ${matterTitle || "Untitled matter"}\n\nFact Summary:\n${factSummary || "N/A"}\n\nChronology:\n${chronologyText || "N/A"}\n\nIssues:\n${issues.join("\n") || "N/A"}`,
          schemaHint: "{\"noticeTitle\":\"\",\"subjectLine\":\"\",\"addresseeBlock\":\"\",\"noticeDraft\":\"\",\"annexures\":[],\"filingReadiness\":[]}",
          fallback
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, noticeSource.slice(0, 2000), "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          noticeTitle: String(aiResponse.noticeTitle || fallback.noticeTitle),
          subjectLine: String(aiResponse.subjectLine || fallback.subjectLine),
          addresseeBlock: String(aiResponse.addresseeBlock || fallback.addresseeBlock),
          noticeDraft: String(aiResponse.noticeDraft || fallback.noticeDraft),
          annexures: Array.isArray(aiResponse.annexures) ? aiResponse.annexures : fallback.annexures,
          filingReadiness: Array.isArray(aiResponse.filingReadiness) ? aiResponse.filingReadiness : fallback.filingReadiness,
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "draft_generator") {
        const draftType = String(body.draftType || "petition").trim();
        const facts = String(body.facts || "").trim();
        const mode = String(body.mode || "court-ready").trim() || "court-ready";
        const context = retrieveLegalContext(`${draftType} ${facts}`, 6);
        const legacyLawNotice = getLegacyLawNotice(`${draftType} ${facts}`);
        const draftFallback = generateDraft({ draftType, facts, mode });
        const fallback = { draft: draftFallback.draft, sections: draftFallback.sections, mode: draftFallback.mode };

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Draft type: ${draftType}\nMode: ${mode}\nFacts:\n${facts}\n\nPrepare a court-ready Indian legal draft with proper heading, parties, subject, facts, legal grounds, cause of action, prayer, and signature block. Use only legally relevant sections.`,
          schemaHint: "{\"draft\":\"\",\"sections\":[],\"mode\":\"court-ready|editable\"}",
          fallback
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, `${draftType} ${facts}`, "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          draft: String(aiResponse.draft || fallback.draft),
          sections: Array.isArray(aiResponse.sections) && aiResponse.sections.length ? aiResponse.sections : fallback.sections,
          mode: String(aiResponse.mode || fallback.mode),
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context)
        });
      }

      if (action === "draft_save") {
        const draftItem = body.draftItem || {};
        const id = String(draftItem.id || "").trim() || admin.firestore().collection("legalDrafts").doc().id;
        await admin.firestore().collection("legalDrafts").doc(id).set({
          ownerId,
          title: String(draftItem.title || "").trim(),
          draftType: String(draftItem.draftType || "general").trim(),
          facts: String(draftItem.facts || "").trim(),
          content: String(draftItem.content || "").trim(),
          relatedCaseId: String(draftItem.relatedCaseId || "").trim(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return res.status(200).json({ ok: true, id });
      }

      if (action === "drafts_list") {
        const snapshot = await admin.firestore()
          .collection("legalDrafts")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        return res.status(200).json({
          drafts: sortRecordsByTimestamp(
            snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
            "updatedAt"
          )
        });
      }

      if (action === "case_analyzer") {
        const result = await analyzeCaseStrength(admin, {
          matterId: String(body.matterId || "").trim(),
          facts: String(body.facts || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documents: body.evidence ? [String(body.evidence || "").trim()] : [],
          selectedCases: Array.isArray(body.selectedCases) ? body.selectedCases : [],
          jurisdiction: String(body.jurisdiction || "").trim()
        });

        return res.status(200).json({
          overallScore: result.overallScore,
          strengthLevel: result.strengthLevel,
          winProbability: result.winProbability,
          strengths: result.strengths,
          weaknesses: result.weaknesses,
          missingEvidence: result.missingEvidence,
          riskAnalysis: result.riskAnalysis,
          suggestions: result.suggestions
        });
      }

      if (action === "document_analyzer") {
        const documentText = String(body.documentText || "").trim();
        if (!documentText) {
          return res.status(400).json({ error: "Missing document text." });
        }

        const context = retrieveLegalContext(documentText, 6);
        const legacyLawNotice = getLegacyLawNotice(documentText);
        const fallback = analyzeDocument({
          documentText,
          caseFacts: String(body.caseFacts || "").trim()
        });

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Analyze this legal document and return structured lawyer-ready insights.\n\nDocument text:\n${documentText}\n\nCurrent case facts for comparison:\n${String(body.caseFacts || "").trim() || "N/A"}`,
          schemaHint: "{\"summary\":\"\",\"keyFacts\":[],\"importantClauses\":[],\"risks\":[],\"missingPoints\":[],\"suggestedArguments\":[],\"documentType\":\"\",\"legalEntities\":[],\"obligations\":[],\"legalIssues\":[],\"contradictionsWithCase\":[]}",
          fallback
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, documentText, "ok", {
          citations: context.map((item) => item.citation)
        });

        return res.status(200).json({
          summary: String(aiResponse.summary || fallback.summary),
          keyFacts: Array.isArray(aiResponse.keyFacts) ? aiResponse.keyFacts : fallback.keyFacts,
          importantClauses: Array.isArray(aiResponse.importantClauses) ? aiResponse.importantClauses : fallback.importantClauses,
          importantClauseRefs: Array.isArray(aiResponse.importantClauseRefs) ? aiResponse.importantClauseRefs : fallback.importantClauseRefs,
          risks: Array.isArray(aiResponse.risks) ? aiResponse.risks : fallback.risks,
          missingPoints: Array.isArray(aiResponse.missingPoints) ? aiResponse.missingPoints : fallback.missingPoints,
          suggestedArguments: Array.isArray(aiResponse.suggestedArguments) ? aiResponse.suggestedArguments : fallback.suggestedArguments,
          documentType: String(aiResponse.documentType || fallback.documentType),
          legalEntities: Array.isArray(aiResponse.legalEntities) ? aiResponse.legalEntities : fallback.legalEntities,
          obligations: Array.isArray(aiResponse.obligations) ? aiResponse.obligations : fallback.obligations,
          legalIssues: Array.isArray(aiResponse.legalIssues) ? aiResponse.legalIssues : fallback.legalIssues,
          contradictionsWithCase: Array.isArray(aiResponse.contradictionsWithCase) ? aiResponse.contradictionsWithCase : fallback.contradictionsWithCase,
          missingElements: Array.isArray(aiResponse.missingPoints) ? aiResponse.missingPoints : fallback.missingPoints,
          legalRisks: Array.isArray(aiResponse.risks) ? aiResponse.risks : fallback.risks,
          legalVersionNotice: legacyLawNotice,
          citations: context.map((item) => ({ citation: item.citation, title: item.title })),
          retrievedAuthorities: mapAuthorities(context),
          traceability: buildTraceability({
            facts: String(body.caseFacts || "").trim() || documentText,
            documents: [{ title: "Analyzed document", excerpt: documentText }],
            authorities: context.slice(0, 5).map((item) => ({
              title: item.title,
              citation: item.citation,
              summary: item.body
            })),
            keyFactors: [
              String(aiResponse.summary || fallback.summary),
              ...(Array.isArray(aiResponse.risks) ? aiResponse.risks : fallback.risks || []).slice(0, 2)
            ],
            notes: ["Compare the extracted clauses and risks against the final pleading theory."]
          }),
          ...(String(body.format || "").trim().toLowerCase() === "memo"
            ? {
                format: "memo",
                memoTitle: "Document Analysis Memo",
                memoText: buildDocumentAnalysisMemo({
                  summary: String(aiResponse.summary || fallback.summary),
                  keyFacts: Array.isArray(aiResponse.keyFacts) ? aiResponse.keyFacts : fallback.keyFacts,
                  importantClauses: Array.isArray(aiResponse.importantClauses) ? aiResponse.importantClauses : fallback.importantClauses,
                  risks: Array.isArray(aiResponse.risks) ? aiResponse.risks : fallback.risks,
                  missingPoints: Array.isArray(aiResponse.missingPoints) ? aiResponse.missingPoints : fallback.missingPoints,
                  suggestedArguments: Array.isArray(aiResponse.suggestedArguments) ? aiResponse.suggestedArguments : fallback.suggestedArguments,
                  documentType: String(aiResponse.documentType || fallback.documentType),
                  legalEntities: Array.isArray(aiResponse.legalEntities) ? aiResponse.legalEntities : fallback.legalEntities,
                  obligations: Array.isArray(aiResponse.obligations) ? aiResponse.obligations : fallback.obligations,
                  legalIssues: Array.isArray(aiResponse.legalIssues) ? aiResponse.legalIssues : fallback.legalIssues,
                  contradictionsWithCase: Array.isArray(aiResponse.contradictionsWithCase) ? aiResponse.contradictionsWithCase : fallback.contradictionsWithCase
                }, {
                  matterLabel: String(body.matterLabel || "").trim(),
                  clientLabel: String(body.clientLabel || "").trim()
                })
              }
            : {})
        });
      }

      if (action === "client_upsert") {
        const client = body.client || {};
        const id = String(client.id || "").trim() || admin.firestore().collection("legalClients").doc().id;
        const payload = {
          ownerId,
          name: String(client.name || "").trim(),
          phone: String(client.phone || "").trim(),
          email: String(client.email || "").trim(),
          notes: String(client.notes || "").trim(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await admin.firestore().collection("legalClients").doc(id).set(payload, { merge: true });
        return res.status(200).json({ ok: true, id });
      }

      if (action === "clients_list") {
        const snapshot = await admin.firestore()
          .collection("legalClients")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        return res.status(200).json({
          clients: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        });
      }

      if (action === "case_upsert") {
        const caseItem = body.caseItem || {};
        const id = String(caseItem.id || "").trim() || admin.firestore().collection("legalCases").doc().id;
        await admin.firestore().collection("legalCases").doc(id).set({
          ownerId,
          clientId: String(caseItem.clientId || "").trim(),
          title: String(caseItem.title || "").trim(),
          stage: String(caseItem.stage || "Draft").trim(),
          notes: String(caseItem.notes || "").trim(),
          nextHearingDate: String(caseItem.nextHearingDate || "").trim(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({ ok: true, id });
      }

      if (action === "cases_list") {
        const snapshot = await admin.firestore()
          .collection("legalCases")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        return res.status(200).json({
          cases: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        });
      }

      if (action === "task_upsert") {
        const task = body.task || {};
        const id = String(task.id || "").trim() || admin.firestore().collection("legalTasks").doc().id;
        await admin.firestore().collection("legalTasks").doc(id).set({
          ownerId,
          title: String(task.title || "").trim(),
          dueDate: String(task.dueDate || "").trim(),
          status: String(task.status || "pending").trim(),
          relatedCaseId: String(task.relatedCaseId || "").trim(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return res.status(200).json({ ok: true, id });
      }

      if (action === "tasks_list") {
        const snapshot = await admin.firestore()
          .collection("legalTasks")
          .where("ownerId", "==", ownerId)
          .limit(200)
          .get();

        return res.status(200).json({
          tasks: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        });
      }

      if (action === "memory_save") {
        const memory = body.memory || {};
        const id = admin.firestore().collection("legalMemory").doc().id;
        await admin.firestore().collection("legalMemory").doc(id).set({
          ownerId,
          title: String(memory.title || "").trim(),
          summary: String(memory.summary || "").trim(),
          tags: Array.isArray(memory.tags) ? memory.tags.map((item) => String(item).trim()).filter(Boolean) : [],
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ ok: true, id });
      }

      if (action === "memory_suggest") {
        const query = String(body.query || "").trim();
        const snapshot = await admin.firestore()
          .collection("legalMemory")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        const tokens = normalizeSearchText(query);
        const memories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const scored = memories
          .map((entry) => {
            const haystack = normalizeSearchText(`${entry.title} ${entry.summary} ${(entry.tags || []).join(" ")}`);
            const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
            return { entry, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((item) => item.entry);

        return res.status(200).json({ suggestions: scored });
      }

      if (action === "memory_list") {
        const snapshot = await admin.firestore()
          .collection("legalMemory")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        return res.status(200).json({
          memories: sortRecordsByTimestamp(
            snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
            "createdAt"
          )
        });
      }

      if (action === "judgments_list") {
        const query = String(body.query || "").trim();
        const court = String(body.court || "all").trim() || "all";
        const status = String(body.status || "all").trim() || "all";
        const dateWindow = String(body.dateWindow || "all").trim() || "all";
        const judgments = await loadJudgmentLibrary();

        const filtered = sortJudgmentsByRelevance(filterJudgments(judgments, { query, court, status, dateWindow }), query).slice(0, 40);
        const usingDemoFeed = filtered.every((item) => {
          const type = String(item.sourceType || "").toLowerCase();
          return type === "demo" || type === "historic";
        });

        await writeLegalAudit(ownerId, action, `${court} | ${status} | ${dateWindow} | ${query}`.trim(), "ok", {
          resultCount: filtered.length,
          usingDemoFeed
        });

        return res.status(200).json({
          judgments: filtered,
          usingDemoFeed,
          feedMode: usingDemoFeed ? "demo" : "live"
        });
      }

      if (action === "judgments_related") {
        const sourceText = String(body.sourceText || "").trim();
        const limit = Math.min(Number(body.limit || 5), 10);
        const judgments = await loadJudgmentLibrary();
        const related = buildRelatedJudgments(judgments, sourceText, limit);

        await writeLegalAudit(ownerId, action, sourceText.slice(0, 1200), "ok", {
          resultCount: related.length
        });

        return res.status(200).json({
          judgments: related
        });
      }

      if (action === "case_validity") {
        const caseId = String(body.caseId || body.canonicalCaseId || "").trim();
        const title = String(body.title || "").trim();
        const citation = String(body.citation || "").trim();
        const court = String(body.court || "").trim();
        const forceRefresh = Boolean(body.forceRefresh);

        if (!caseId && !title && !citation) {
          return res.status(400).json({ error: "Missing case identifier." });
        }

        const result = await getCaseValidity(admin, {
          canonicalCaseId: caseId,
          title,
          citation,
          court
        }, { forceRefresh });

        await writeLegalAudit(ownerId, action, caseId || citation || title, "ok", {
          status: result.status,
          canonicalCaseId: result.canonicalCaseId
        });

        return res.status(200).json(result);
      }

      if (action === "argument_builder") {
        const matterId = String(body.matterId || "").trim();
        const facts = String(body.facts || "").trim();
        const jurisdiction = String(body.jurisdiction || "").trim();
        const issues = Array.isArray(body.issues) ? body.issues.map((item) => String(item).trim()).filter(Boolean) : [];
        const selectedCases = Array.isArray(body.selectedCases) ? body.selectedCases : [];
        const mode = String(body.mode || "detailed").trim() || "detailed";

        if (!facts && !issues.length && !selectedCases.length) {
          return res.status(400).json({ error: "Missing argument-builder inputs." });
        }

        const structuredFallback = await buildArgumentSet(admin, {
          matterId,
          facts,
          issues,
          jurisdiction,
          selectedCases,
          mode
        });

        const selectedCaseText = selectedCases
          .map((item) => `- ${item.title || "Case"} | ${item.citation || "No citation"} | ${item.ratioNote || item.summary || "No ratio summary"}`)
          .join("\n");

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Build structured legal arguments for both petitioner and respondent.\n\nMatter ID: ${matterId || "N/A"}\nJurisdiction: ${jurisdiction || "N/A"}\nMode: ${mode}\nFacts:\n${facts || "N/A"}\n\nIssues:\n${issues.join("\n") || "N/A"}\n\nSelected authorities:\n${selectedCaseText || "N/A"}\n\nReturn issue-wise arguments for both sides using only the provided issues and authorities. Avoid generic advocacy language.`,
          schemaHint: "{\"petitionerArguments\":[{\"issue\":\"\",\"side\":\"petitioner\",\"arguments\":[{\"title\":\"\",\"legalBasis\":\"\",\"caseReferences\":[],\"reasoning\":\"\",\"riskNote\":\"\"}]}],\"respondentArguments\":[{\"issue\":\"\",\"side\":\"respondent\",\"arguments\":[{\"title\":\"\",\"legalBasis\":\"\",\"caseReferences\":[],\"reasoning\":\"\",\"riskNote\":\"\"}]}],\"warnings\":[]}",
          fallback: structuredFallback
        });

        const result = {
          ...structuredFallback,
          petitionerArguments: Array.isArray(aiResponse.petitionerArguments) && aiResponse.petitionerArguments.length
            ? aiResponse.petitionerArguments
            : structuredFallback.petitionerArguments,
          respondentArguments: Array.isArray(aiResponse.respondentArguments) && aiResponse.respondentArguments.length
            ? aiResponse.respondentArguments
            : structuredFallback.respondentArguments,
          warnings: Array.isArray(aiResponse.warnings) && aiResponse.warnings.length
            ? aiResponse.warnings
            : structuredFallback.warnings
        };

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, `${matterId} | ${jurisdiction} | ${issues.join(", ")}`.slice(0, 1200), "ok", {
          issueCount: issues.length,
          selectedCaseCount: selectedCases.length,
          mode
        });

        return res.status(200).json(result);
      }

      if (action === "case_strength") {
        const matterId = String(body.matterId || "").trim();
        const facts = String(body.facts || "").trim();
        const issues = Array.isArray(body.issues) ? body.issues.map((item) => String(item).trim()).filter(Boolean) : [];
        const documents = Array.isArray(body.documents) ? body.documents : [];
        const selectedCases = Array.isArray(body.selectedCases) ? body.selectedCases : [];
        const jurisdiction = String(body.jurisdiction || "").trim();

        if (!facts && !issues.length && !selectedCases.length && !documents.length) {
          return res.status(400).json({ error: "Missing case-strength inputs." });
        }

        const structuredFallback = await analyzeCaseStrength(admin, {
          matterId,
          facts,
          issues,
          documents,
          selectedCases,
          jurisdiction
        });

        const aiResponse = await callOpenAIJson({
          systemPrompt: LEGAL_SYSTEM_PROMPTS.lawyer,
          userPrompt: `Refine a practical case-strength analysis for a lawyer. Keep it explainable and grounded in the supplied matter details.\n\nMatter ID: ${matterId || "N/A"}\nJurisdiction: ${jurisdiction || "N/A"}\nFacts:\n${facts || "N/A"}\n\nIssues:\n${issues.join("\n") || "N/A"}\n\nDocuments:\n${documents.map((item) => typeof item === "string" ? item : `${item.title || item.fileName || "Document"} | ${item.summary || item.content || ""}`).join("\n") || "N/A"}\n\nSelected cases:\n${selectedCases.map((item) => `${item.title || "Case"} | ${item.citation || "No citation"} | ${item.ratioNote || item.summary || ""}`).join("\n") || "N/A"}\n\nReturn only practical strengths, weaknesses, missing evidence, risks, and suggestions.`,
          schemaHint: "{\"strengths\":[],\"weaknesses\":[],\"missingEvidence\":[],\"riskAnalysis\":[],\"suggestions\":[]}",
          fallback: structuredFallback
        });

        const result = {
          ...structuredFallback,
          strengths: Array.isArray(aiResponse.strengths) && aiResponse.strengths.length ? aiResponse.strengths : structuredFallback.strengths,
          weaknesses: Array.isArray(aiResponse.weaknesses) && aiResponse.weaknesses.length ? aiResponse.weaknesses : structuredFallback.weaknesses,
          missingEvidence: Array.isArray(aiResponse.missingEvidence) && aiResponse.missingEvidence.length ? aiResponse.missingEvidence : structuredFallback.missingEvidence,
          riskAnalysis: Array.isArray(aiResponse.riskAnalysis) && aiResponse.riskAnalysis.length ? aiResponse.riskAnalysis : structuredFallback.riskAnalysis,
          suggestions: Array.isArray(aiResponse.suggestions) && aiResponse.suggestions.length ? aiResponse.suggestions : structuredFallback.suggestions
        };

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, `${matterId} | ${jurisdiction} | ${issues.join(", ")}`.slice(0, 1200), "ok", {
          overallScore: result.overallScore,
          selectedCaseCount: selectedCases.length,
          documentCount: documents.length
        });

        return res.status(200).json(result);
      }

      if (action === "case_prediction") {
        const result = await predictCaseOutcome(admin, {
          matterId: String(body.matterId || "").trim(),
          facts: String(body.facts || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documentAnalysis: body.documentAnalysis || null,
          caseStrength: body.caseStrength || null,
          arguments: body.arguments || null,
          authorities: Array.isArray(body.authorities) ? body.authorities : [],
          documents: Array.isArray(body.documents) ? body.documents : [],
          documentText: String(body.documentText || "").trim(),
          jurisdiction: String(body.jurisdiction || "").trim()
        });

        return res.status(200).json({
          ...result,
          traceability: buildTraceability({
            facts: String(body.facts || "").trim(),
            documents: Array.isArray(body.documents) ? body.documents : [],
            authorities: Array.isArray(body.authorities) ? body.authorities : [],
            scoreBreakdown: result.scoreBreakdown,
            keyFactors: result.keyFactors,
            notes: ["Prediction is weighted and explainable, but still requires lawyer review before strategic decisions."]
          })
        });
      }

      if (action === "filing_readiness") {
        const result = await analyzeFilingReadiness(admin, {
          matterId: String(body.matterId || "").trim(),
          facts: String(body.facts || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documents: Array.isArray(body.documents) ? body.documents : [],
          jurisdiction: String(body.jurisdiction || "").trim(),
          draftText: String(body.draftText || "").trim(),
          draftType: String(body.draftType || "").trim(),
          selectedCases: Array.isArray(body.selectedCases) ? body.selectedCases : [],
          documentAnalysis: body.documentAnalysis || null,
          caseStrength: body.caseStrength || null
        });

        return res.status(200).json(result);
      }

      if (action === "authority_guardrails") {
        return res.status(200).json(await evaluateAuthorityGuardrails(admin, Array.isArray(body.selectedCases) ? body.selectedCases : []));
      }

      if (action === "matter_consistency") {
        return res.status(200).json(analyzeMatterContradictions({
          facts: String(body.facts || "").trim(),
          chronologyText: String(body.chronologyText || "").trim(),
          hearingNotes: String(body.hearingNotes || "").trim(),
          draftText: String(body.draftText || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documentAnalysis: body.documentAnalysis || null,
          argumentOutput: body.argumentOutput || null
        }));
      }

      if (action === "evidence_coverage") {
        return res.status(200).json(analyzeEvidenceCoverage({
          facts: String(body.facts || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documents: Array.isArray(body.documents) ? body.documents : [],
          draftText: String(body.draftText || "").trim(),
          selectedCases: Array.isArray(body.selectedCases) ? body.selectedCases : [],
          caseStrength: body.caseStrength || null,
          argumentOutput: body.argumentOutput || null
        }));
      }

      if (action === "draft_validation") {
        return res.status(200).json(analyzeDraftValidation({
          draftText: String(body.draftText || "").trim(),
          draftType: String(body.draftType || "").trim(),
          courtType: String(body.courtType || body.court || "").trim()
        }));
      }

      if (action === "filing_pack_readiness") {
        const result = await analyzeFinalFilingPack(admin, {
          matterId: String(body.matterId || "").trim(),
          facts: String(body.facts || "").trim(),
          issues: Array.isArray(body.issues) ? body.issues : [],
          documents: Array.isArray(body.documents) ? body.documents : [],
          draftText: String(body.draftText || "").trim(),
          draftType: String(body.draftType || "").trim(),
          courtType: String(body.courtType || body.court || "").trim(),
          selectedCases: Array.isArray(body.selectedCases) ? body.selectedCases : [],
          caseStrength: body.caseStrength || null,
          argumentOutput: body.argumentOutput || null,
          documentAnalysis: body.documentAnalysis || null,
          hearingNotes: String(body.hearingNotes || "").trim(),
          chronologyText: String(body.chronologyText || "").trim()
        });
        return res.status(200).json(result);
      }

      if (action === "review_upsert") {
        const review = await upsertLegalReview(admin, {
          ownerId,
          matterId: String(body.matterId || "").trim(),
          entityType: String(body.entityType || "").trim(),
          entityId: String(body.entityId || "").trim(),
          entityKey: String(body.entityKey || "").trim(),
          entityLabel: String(body.entityLabel || "").trim(),
          status: String(body.status || "ai_draft").trim(),
          approvalRole: String(body.approvalRole || "").trim(),
          reviewerName: String(body.reviewerName || "").trim(),
          reviewNotes: String(body.reviewNotes || "").trim(),
          outputSummary: String(body.outputSummary || "").trim(),
          traceabilityNote: String(body.traceabilityNote || "").trim(),
          keyPoints: Array.isArray(body.keyPoints) ? body.keyPoints : [],
          traceability: body.traceability && typeof body.traceability === "object" ? body.traceability : null
        });

        await writeLegalAudit(ownerId, action, `${review.entityType} | ${review.entityKey}`.slice(0, 1200), "ok", {
          reviewId: review.id,
          reviewStatus: review.status
        });

        return res.status(200).json({ review });
      }

      if (action === "review_list") {
        const reviews = await listLegalReviews(admin, {
          ownerId,
          matterId: String(body.matterId || "").trim(),
          entityType: String(body.entityType || "").trim()
        });
        return res.status(200).json({ reviews });
      }

      if (action === "review_snapshot_list") {
        const snapshots = await listLegalReviewSnapshots(admin, {
          ownerId,
          matterId: String(body.matterId || "").trim(),
          entityType: String(body.entityType || "").trim()
        });
        return res.status(200).json({ snapshots });
      }

      if (action === "judgments_sync_status") {
        const judgments = await loadJudgmentLibrary();
        const sources = await loadJudgmentSources();
        const runsSnapshot = await admin.firestore()
          .collection("legalJudgmentSyncRuns")
          .orderBy("createdAt", "desc")
          .limit(5)
          .get()
          .catch(() => null);
        const liveCount = judgments.filter((item) => String(item.sourceType || "").toLowerCase() === "live").length;
        const demoCount = judgments.length - liveCount;
        const latestDate = sortJudgmentsByDate(judgments)[0]?.judgmentDate || "";
        const recentRuns = runsSnapshot?.docs?.map((doc) => ({ id: doc.id, ...doc.data() })) || [];

        return res.status(200).json({
          feedMode: liveCount ? "live" : "demo",
          totalCount: judgments.length,
          liveCount,
          demoCount,
          latestDate,
          plannedCollections: ["legalJudgments", "legalJudgmentSyncRuns", "legalJudgmentSources"],
          templates: getJudgmentImportTemplates(),
          sources: [
            "Supreme Court public feed",
            "High Court public feed",
            liveCount ? "Firestore legalJudgments collection" : "Curated demo judgment feed"
          ],
          sourceRegistry: sources,
          recentRuns
        });
      }

      if (action === "judgment_sources_list") {
        const sources = await loadJudgmentSources();
        return res.status(200).json({
          sources,
          templates: getJudgmentImportTemplates()
        });
      }

      if (action === "judgment_sync_run") {
        const sourceId = String(body.sourceId || "all").trim() || "all";
        const run = await createJudgmentSyncRun({
          ownerId,
          sourceId,
          mode: String(body.mode || "manual").trim() || "manual"
        });

        await writeLegalAudit(ownerId, action, sourceId, "ok", {
          runId: run.id,
          sourceId
        });

        return res.status(200).json({
          ok: true,
          run
        });
      }

      if (action === "judgment_import_payload") {
        const sourceId = String(body.sourceId || "manual-import").trim() || "manual-import";
        const records = Array.isArray(body.records) ? body.records : [];

        if (!records.length) {
          return res.status(400).json({ error: "Missing judgment records." });
        }

        const storedCount = await importJudgmentRecords({
          ownerId,
          sourceId,
          records
        });

        const run = await createJudgmentSyncRun({
          ownerId,
          sourceId,
          mode: "import"
        });

        await admin.firestore().collection("legalJudgmentSyncRuns").doc(run.id).set({
          status: "completed",
          fetchedCount: records.length,
          storedCount,
          notes: "Connector-ready import payload processed.",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await writeLegalAudit(ownerId, action, sourceId, "ok", {
          storedCount,
          fetchedCount: records.length
        });

        return res.status(200).json({
          ok: true,
          storedCount,
          runId: run.id
        });
      }

      if (action === "judgments_live_retrieve") {
        const query = String(body.query || "").trim();
        const sourceId = String(body.sourceId || "all").trim() || "all";
        const limit = Math.min(Number(body.limit || 10), 20);
        const allSources = await loadJudgmentSources();
        const selectedSources = sourceId === "all"
          ? allSources
          : allSources.filter((item) => item.id === sourceId);

        const liveResult = await tryFetchLiveJudgments({
          sources: selectedSources,
          query,
          limit
        });

        if (liveResult.judgments.length) {
          const storedCount = await importJudgmentRecords({
            ownerId,
            sourceId,
            records: liveResult.judgments
          });

          const run = await createJudgmentSyncRun({
            ownerId,
            sourceId,
            mode: "live-retrieve"
          });

          await admin.firestore().collection("legalJudgmentSyncRuns").doc(run.id).set({
            status: "completed",
            fetchedCount: liveResult.judgments.length,
            storedCount,
            notes: `Live retrieval completed from ${liveResult.fetchedSources.join(", ") || sourceId}.`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

        await writeLegalAudit(ownerId, action, `${sourceId} | ${query}`, "ok", {
          fetchedCount: liveResult.judgments.length,
          fetchedSources: liveResult.fetchedSources,
          liveEnabled: liveResult.liveEnabled
        });

        return res.status(200).json({
          judgments: liveResult.judgments,
          fetchedSources: liveResult.fetchedSources,
          liveEnabled: liveResult.liveEnabled,
          sourceMode: liveResult.judgments.length ? "live" : "cache"
        });
      }

      if (action === "document_extract") {
        const mimeType = String(body.mimeType || "").trim().toLowerCase();
        const dataBase64 = String(body.dataBase64 || "").trim();
        const fileName = String(body.fileName || "document").trim();

        if (!mimeType || !dataBase64) {
          return res.status(400).json({ error: "Missing mimeType or dataBase64." });
        }

        let extractedText = "";
        let usedOpenAI = false;
        let usedGemini = false;
        const openAIKey = getOpenAIKey();
        const isImage = mimeType.startsWith("image/");
        const isPlainText = mimeType.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(fileName);
        const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);

        if (isPlainText) {
          extractedText = Buffer.from(dataBase64, "base64").toString("utf8");
        } else if (isImage && openAIKey) {
          try {
            const imageDataUrl = `data:${mimeType};base64,${dataBase64}`;
            const ocrResponse = await axios.post(
              "https://api.openai.com/v1/responses",
              {
                model: getOpenAIModel(),
                input: [
                  {
                    role: "user",
                    content: [
                      { type: "input_text", text: "Extract all readable text from this legal document image. Return plain text only." },
                      { type: "input_image", image_url: imageDataUrl }
                    ]
                  }
                ],
                temperature: 0
              },
              {
                headers: {
                  Authorization: `Bearer ${openAIKey}`,
                  "Content-Type": "application/json"
                }
              }
            );
            extractedText = String(ocrResponse.data?.output_text || "").trim();
            usedOpenAI = Boolean(extractedText);
          } catch (error) {
            functions.logger.warn("Image extraction fallback:", error.response?.data || error.message);
          }
        }

        if (!extractedText && (isImage || isPdf)) {
          extractedText = await extractTextWithGemini({
            mimeType: isPdf ? "application/pdf" : mimeType,
            dataBase64,
            fileName
          });
          usedGemini = Boolean(extractedText);
        }

        if (!extractedText && isPdf) {
          extractedText = "PDF detected but OCR extraction returned empty content. Try a clearer scan or upload page images.";
        }

        if (!extractedText) {
          extractedText = "Could not extract text from file. Try TXT, searchable PDF, or high-resolution image.";
        }

        const pagePreviews = buildPagePreviews(extractedText);
        const qualityScore = estimateExtractionQuality({
          text: extractedText,
          mimeType,
          usedOpenAI,
          usedGemini
        });

        await consumeLegalQuota(quota.ref, quota.subscription);
        await writeLegalAudit(ownerId, action, fileName, "ok", { mimeType, qualityScore });
        return res.status(200).json({
          extractedText: extractedText.slice(0, 50000),
          mimeType,
          fileName,
          qualityScore,
          pagePreviews,
          extractionEngine: usedOpenAI ? "openai" : usedGemini ? "gemini" : "basic"
        });
      }

      if (action === "subscription_get") {
        const { data } = await getOrCreateLegalSubscription(ownerId);
        return res.status(200).json({ subscription: data });
      }

      if (action === "billing_config") {
        return res.status(200).json({
          enabled: getBillingEnabled(),
          keyId: getRazorpayKeyId() || "",
          supportedPlans: ["pro", "enterprise"]
        });
      }

      if (action === "billing_create_order") {
        const requestedPlan = String(body.plan || "").trim().toLowerCase();
        const planConfig = getPlanConfig(requestedPlan);
        if (!["pro", "enterprise"].includes(planConfig.plan)) {
          return res.status(400).json({ error: "Only paid plans are allowed for order creation." });
        }
        if (!getBillingEnabled()) {
          return res.status(500).json({ error: "Billing is not configured on server." });
        }

        const receipt = `legal_${ownerId.slice(0, 12)}_${Date.now()}`;
        const amountPaise = Math.round(planConfig.priceInr * 100);
        const orderResponse = await axios.post(
          "https://api.razorpay.com/v1/orders",
          {
            amount: amountPaise,
            currency: "INR",
            receipt,
            notes: {
              ownerId,
              plan: planConfig.plan
            }
          },
          {
            headers: {
              Authorization: buildRazorpayAuthHeader(),
              "Content-Type": "application/json"
            }
          }
        );

        const order = orderResponse.data || {};
        await admin.firestore().collection("legalPaymentOrders").doc(order.id).set({
          ownerId,
          plan: planConfig.plan,
          priceInr: planConfig.priceInr,
          amountPaise,
          currency: "INR",
          receipt,
          razorpayOrderId: order.id,
          status: "created",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await writeLegalAudit(ownerId, action, `plan=${planConfig.plan}`, "ok", {
          orderId: order.id,
          amountPaise
        });

        return res.status(200).json({
          enabled: true,
          keyId: getRazorpayKeyId(),
          order: {
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt
          },
          plan: planConfig.plan,
          amountInr: planConfig.priceInr
        });
      }

      if (action === "billing_verify_payment") {
        const orderId = String(body.orderId || "").trim();
        const paymentId = String(body.paymentId || "").trim();
        const signature = String(body.signature || "").trim();

        if (!orderId || !paymentId || !signature) {
          return res.status(400).json({ error: "Missing orderId, paymentId, or signature." });
        }

        if (!getBillingEnabled()) {
          return res.status(500).json({ error: "Billing is not configured on server." });
        }

        const isValid = verifyRazorpayPaymentSignature(orderId, paymentId, signature);
        if (!isValid) {
          await writeLegalAudit(ownerId, action, `order=${orderId}`, "blocked", { reason: "invalid_signature" });
          return res.status(400).json({ error: "Invalid payment signature." });
        }

        const orderRef = admin.firestore().collection("legalPaymentOrders").doc(orderId);
        const orderSnapshot = await orderRef.get();
        if (!orderSnapshot.exists) {
          return res.status(404).json({ error: "Order not found." });
        }

        const orderData = orderSnapshot.data() || {};
        if (String(orderData.ownerId || "") !== ownerId) {
          return res.status(403).json({ error: "Order owner mismatch." });
        }

        await orderRef.set({
          paymentId,
          signature,
          status: "paid",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await activateLegalPlan(ownerId, orderData.plan || "trial");
        const { data } = await getOrCreateLegalSubscription(ownerId);
        await writeLegalAudit(ownerId, action, `order=${orderId}`, "ok", { paymentId });

        return res.status(200).json({
          ok: true,
          message: "Payment verified and plan activated.",
          subscription: data
        });
      }

      if (action === "subscription_update") {
        const nextPlan = String(body.plan || "trial").trim().toLowerCase();
        const allowedPlans = ["trial", "pro", "enterprise"];
        if (!allowedPlans.includes(nextPlan)) {
          return res.status(400).json({ error: "Invalid plan." });
        }

        if (nextPlan !== "trial") {
          return res.status(400).json({ error: "Paid plans must be activated through payment verification." });
        }

        const planConfig = getPlanConfig(nextPlan);

        const { ref } = await getOrCreateLegalSubscription(ownerId);
        await ref.set({
          ownerId,
          plan: nextPlan,
          status: "active",
          monthlyLimit: planConfig.monthlyLimit,
          usageMonth: getMonthKey(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await writeLegalAudit(ownerId, action, `plan=${nextPlan}`, "ok", {
          priceInr: planConfig.priceInr
        });

        const snapshot = await ref.get();
        return res.status(200).json({
          ok: true,
          subscription: snapshot.data(),
          paymentNote: "Trial activated."
        });
      }

      if (action === "audit_list") {
        const snapshot = await admin.firestore()
          .collection("legalAuditLogs")
          .where("ownerId", "==", ownerId)
          .limit(100)
          .get();

        return res.status(200).json({
          logs: sortRecordsByTimestamp(
            snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
            "createdAt"
          )
        });
      }

      return res.status(400).json({ error: "Unknown legal action." });
    } catch (error) {
      functions.logger.error("Legal assistant error:", error.response?.data || error.message);
      const body = req.body || {};
      const action = String(body.action || "unknown").trim();
      await writeLegalAudit(
        String(body.ownerId || "anonymous").trim(),
        action,
        String(body.problem || body.caseDetails || body.facts || body.documentText || body.query || ""),
        "error",
        { message: error.message }
      );
      if (action === "copilot_chat") {
        return res.status(500).json({
          error: error.message || "Copilot chat failed.",
          details: error.response?.data || null
        });
      }
      return res.status(500).json({ error: "Could not process legal assistant request." });
    }
  });
});

exports.legalCaseValidity = functions.https.onRequest(createLegalCaseValidityHandler(admin));
exports.legalCaseCitations = functions.https.onRequest(createLegalCaseCitationsHandler(admin));
exports.legalArgumentBuilder = functions.https.onRequest(createLegalArgumentBuilderHandler(admin));
exports.legalCaseStrength = functions.https.onRequest(createLegalCaseStrengthHandler(admin));
exports.legalCasePrediction = functions.https.onRequest(createLegalCasePredictionHandler());
exports.legalFilingReadiness = functions.https.onRequest(createLegalFilingReadinessHandler());
exports.legalAuthorityGuardrails = functions.https.onRequest(createLegalAuthorityGuardrailsHandler());
exports.legalDocumentAnalyze = functions.https.onRequest(createLegalDocumentAnalyzeHandler());

exports.legalBillingWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    if (!getBillingEnabled()) {
      return res.status(500).send("Billing not configured");
    }

    const signature = String(req.headers["x-razorpay-signature"] || "").trim();
    if (!signature || !req.rawBody) {
      return res.status(400).send("Missing signature or raw body");
    }

    const valid = verifyRazorpayWebhookSignature(req.rawBody, signature);
    if (!valid) {
      return res.status(400).send("Invalid webhook signature");
    }

    const event = req.body?.event || "";
    const paymentEntity = req.body?.payload?.payment?.entity || null;

    if (event === "payment.captured" && paymentEntity?.order_id) {
      const orderId = String(paymentEntity.order_id);
      const orderRef = admin.firestore().collection("legalPaymentOrders").doc(orderId);
      const orderSnapshot = await orderRef.get();
      if (!orderSnapshot.exists) {
        return res.status(200).send("Order not tracked");
      }

      const orderData = orderSnapshot.data() || {};
      const ownerId = String(orderData.ownerId || "").trim();
      if (!ownerId) {
        return res.status(200).send("Missing owner");
      }

      await orderRef.set({
        status: "paid",
        paymentId: String(paymentEntity.id || ""),
        webhookConfirmed: true,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await activateLegalPlan(ownerId, String(orderData.plan || "trial"));
      await writeLegalAudit(ownerId, "billing_webhook", `order=${orderId}`, "ok", {
        event,
        paymentId: String(paymentEntity.id || "")
      });
    }

    return res.status(200).send("ok");
  } catch (error) {
    functions.logger.error("Billing webhook error:", error.message);
    return res.status(500).send("Webhook error");
  }
});

exports.catalogDocumentImport = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const geminiKey = getGeminiKey();
      const { dataBase64 = "", mimeType = "", fileName = "" } = req.body || {};

      if (!geminiKey) {
        return res.status(500).json({ error: "Gemini key missing." });
      }

      if (!dataBase64 || !mimeType) {
        return res.status(400).json({ error: "Missing document data or mime type." });
      }

      const prompt = `
You extract product entries from bills, invoices, catalog photos, PDFs, and business documents for Medilink AI.
Return only JSON with shape:
{"products":[{"productName":"","barcode":"","category":"","brand":"","unit":"","description":"","costPrice":0,"price":0,"mrp":0,"quantity":0}]}

Rules:
- Extract as many products as clearly visible.
- If selling price is not available, keep price equal to mrp or costPrice when possible.
- If fields are missing, use empty string or 0.
- No markdown. No extra commentary.
      `.trim();

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [
            {
              parts: [
                { text: `File name: ${fileName || "document"}\n${prompt}` },
                {
                  inlineData: {
                    mimeType,
                    data: dataBase64
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      const rawText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(rawText);
      const products = Array.isArray(parsed.products) ? parsed.products.slice(0, 30) : [];

      return res.status(200).json({ products });
    } catch (error) {
      functions.logger.error("Catalog document import error:", error.response?.data || error.message);
      return res.status(500).json({ error: "Could not extract products from document." });
    }
  });
});

exports.legalReviewWorkflow = functions.https.onRequest(createLegalReviewWorkflowHandler());
exports.legalMatterConsistency = functions.https.onRequest(createLegalMatterConsistencyHandler());
exports.legalEvidenceCoverage = functions.https.onRequest(createLegalEvidenceCoverageHandler());
exports.legalDraftValidation = functions.https.onRequest(createLegalDraftValidationHandler());
exports.legalFilingPack = functions.https.onRequest(createLegalFilingPackHandler(admin));
exports.legalCopilot = functions.https.onRequest(createCopilotApp());
