const { buildCanonicalCaseId, normalizeCitationText } = require("./relationService");
const { normalizeSearchText } = require("./legalUtils");

const ANALYSIS_VERSION = "judgment_pipeline_v1";

const COURT_ALIASES = [
  ["supreme court of india", "Supreme Court"],
  ["supreme court", "Supreme Court"],
  ["delhi high court", "Delhi High Court"],
  ["high court of delhi", "Delhi High Court"],
  ["bombay high court", "Bombay High Court"],
  ["high court of bombay", "Bombay High Court"],
  ["karnataka high court", "Karnataka High Court"],
  ["high court of karnataka", "Karnataka High Court"],
  ["madras high court", "Madras High Court"],
  ["high court of madras", "Madras High Court"],
  ["consumer commission", "Consumer Commission"],
  ["ncdrc", "Consumer Commission"],
  ["national commission", "Consumer Commission"],
  ["tribunal", "Tribunal"]
];

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toUniqueStrings(values = [], limit = 12) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function capitalizeWord(word = "") {
  return String(word || "")
    .split("-")
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : "")
    .join("-");
}

function toTitleCase(value) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((item) => {
      const lowered = item.toLowerCase();
      if (["of", "and", "the", "for"].includes(lowered)) {
        return lowered;
      }
      if (/^[ivxlcdm]+$/i.test(item)) {
        return item.toUpperCase();
      }
      return capitalizeWord(item);
    })
    .join(" ")
    .replace(/\bSc\b/g, "SC")
    .replace(/\bHc\b/g, "HC")
    .replace(/\bCpc\b/g, "CPC")
    .replace(/\bCrpc\b/g, "CrPC")
    .replace(/\bBns\b/g, "BNS")
    .replace(/\bBnss\b/g, "BNSS")
    .replace(/\bBsa\b/g, "BSA")
    .trim();
}

function canonicalizeCourtName(value, fallback = "") {
  const rawValue = normalizeWhitespace(value || fallback);
  const lowered = rawValue.toLowerCase();
  const alias = COURT_ALIASES.find(([needle]) => lowered.includes(needle));
  if (alias) return alias[1];
  if (!rawValue) return "";
  if (/supreme/i.test(rawValue)) return "Supreme Court";
  if (/high court/i.test(rawValue)) return toTitleCase(rawValue);
  return toTitleCase(rawValue);
}

function inferCourtLevel(court = "") {
  const lowered = String(court || "").toLowerCase();
  if (lowered.includes("supreme court")) return "supreme";
  if (lowered.includes("high court")) return "high";
  if (lowered.includes("tribunal")) return "tribunal";
  if (lowered.includes("commission")) return "commission";
  return "other";
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function normalizeJudgmentDate(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return "";

  const direct = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;

  const monthMap = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };

  const dayMonthYear = raw.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4})\b/);
  if (dayMonthYear) {
    const month = monthMap[dayMonthYear[2].slice(0, 3).toLowerCase()];
    if (month) return `${dayMonthYear[3]}-${month}-${padNumber(dayMonthYear[1])}`;
  }

  const numeric = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (numeric) {
    return `${numeric[3]}-${padNumber(numeric[2])}-${padNumber(numeric[1])}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return [
      parsed.getUTCFullYear(),
      padNumber(parsed.getUTCMonth() + 1),
      padNumber(parsed.getUTCDate())
    ].join("-");
  }

  return "";
}

function computeFreshnessProfile(judgmentDate = "") {
  const normalized = normalizeJudgmentDate(judgmentDate);
  if (!normalized) {
    return {
      freshnessLabel: "Date to be verified",
      freshnessDays: null,
      stalenessReason: "Judgment date missing"
    };
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return {
      freshnessLabel: "Date to be verified",
      freshnessDays: null,
      stalenessReason: "Judgment date unreadable"
    };
  }

  const now = new Date();
  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)));

  if (ageDays <= 180) {
    return {
      freshnessLabel: "Recent authority",
      freshnessDays: ageDays,
      stalenessReason: "Freshness within 6 months"
    };
  }

  if (ageDays <= 730) {
    return {
      freshnessLabel: "Current authority",
      freshnessDays: ageDays,
      stalenessReason: "Freshness within 2 years"
    };
  }

  if (ageDays <= 3650) {
    return {
      freshnessLabel: "Older authority",
      freshnessDays: ageDays,
      stalenessReason: "Check later developments before filing"
    };
  }

  return {
    freshnessLabel: "Legacy authority",
    freshnessDays: ageDays,
    stalenessReason: "Verify treatment and later binding precedents"
  };
}

function buildCitationVariants(record = {}) {
  const variants = toUniqueStrings([
    record.citation,
    record.neutralCitation,
    ...(Array.isArray(record.parallelCitations) ? record.parallelCitations : []),
    ...(Array.isArray(record.citationAliases) ? record.citationAliases : [])
  ], 10);

  return toUniqueStrings(variants.flatMap((item) => {
    const normalized = normalizeCitationText(item);
    return [item, normalized, normalized.replace(/[.,]/g, " ")];
  }), 12);
}

function normalizeParagraphReference(value) {
  const text = normalizeWhitespace(value).replace(/paragraph/gi, "Para").replace(/paras/gi, "Paras");
  if (!text) return "";
  if (/^para/i.test(text)) return text;
  const numberMatch = text.match(/\b\d+[A-Za-z]?\b/);
  return numberMatch ? `Para ${numberMatch[0]}` : text;
}

function extractParagraphReferences(text = "") {
  const source = normalizeWhitespace(text);
  if (!source) return [];
  const matches = source.match(/(?:para(?:graph)?s?)\s*\d+[A-Za-z]?(?:\s*(?:to|-|,|and)\s*\d+[A-Za-z]?)*(?!\d)/gi) || [];
  return toUniqueStrings(matches.map(normalizeParagraphReference), 12);
}

function extractStatutoryReferences(text = "") {
  const source = normalizeWhitespace(text);
  if (!source) return [];

  const matches = [
    ...(source.match(/\bArticle\s+\d+[A-Za-z]?\b/gi) || []),
    ...(source.match(/\bSection\s+\d+[A-Za-z0-9()/-]*\b/gi) || []),
    ...(source.match(/\bOrder\s+[A-Za-z0-9IVXLCDM]+\s+Rule\s+\d+[A-Za-z0-9()/-]*(?:\s*&\s*\d+[A-Za-z0-9()/-]*)?\b/gi) || []),
    ...(source.match(/\b(?:CPC|CrPC|BNSS|BNS|BSA|NI Act|Negotiable Instruments Act|Specific Relief Act|Constitution of India)\b/gi) || [])
  ];

  return toUniqueStrings(matches.map((item) => item.replace(/\s+/g, " ")), 16);
}

function inferMatterTags(record = {}) {
  const haystack = normalizeWhitespace([
    record.title,
    record.citation,
    record.summary,
    record.ratioNote,
    Array.isArray(record.issueTags) ? record.issueTags.join(" ") : "",
    Array.isArray(record.holdingPoints) ? record.holdingPoints.join(" ") : ""
  ].join(" ")).toLowerCase();

  const mapping = [
    ["injunction", "injunction"],
    ["specific performance", "specific performance"],
    ["cheque", "cheque dishonour"],
    ["dishonour", "cheque dishonour"],
    ["ni act", "cheque dishonour"],
    ["consumer", "consumer"],
    ["medical", "medical service"],
    ["arbitration", "arbitration"],
    ["interim relief", "interim relief"],
    ["property", "property dispute"],
    ["partition", "property dispute"],
    ["service law", "service law"],
    ["dismissal", "service dismissal"],
    ["natural justice", "natural justice"],
    ["writ", "writ"],
    ["article 21", "constitutional"],
    ["basic structure", "constitutional"],
    ["maintenance", "family law"],
    ["divorce", "family law"],
    ["tenancy", "tenancy"],
    ["rent", "tenancy"],
    ["gst", "tax"],
    ["tax", "tax"],
    ["insolvency", "insolvency"],
    ["ibc", "insolvency"],
    ["bail", "bail"],
    ["fir", "criminal procedure"],
    ["f.i.r", "criminal procedure"]
  ];

  return toUniqueStrings(mapping.filter(([needle]) => haystack.includes(needle)).map(([, tag]) => tag), 8);
}

function inferReliefType(record = {}) {
  const haystack = normalizeWhitespace([
    record.title,
    record.summary,
    record.ratioNote,
    Array.isArray(record.issueTags) ? record.issueTags.join(" ") : ""
  ].join(" ")).toLowerCase();

  if (/interim relief|status quo|temporary injunction|ad-interim|injunction/.test(haystack)) return "injunction";
  if (/specific performance/.test(haystack)) return "specific performance";
  if (/bail|anticipatory bail/.test(haystack)) return "bail";
  if (/quash|quashing/.test(haystack)) return "quashing";
  if (/recovery|money|dues/.test(haystack)) return "money recovery";
  if (/compensation|damages/.test(haystack)) return "compensation";
  if (/writ|mandamus|certiorari|habeas corpus/.test(haystack)) return "writ relief";
  return "general relief";
}

function inferOutcome(record = {}) {
  const haystack = normalizeWhitespace([
    record.title,
    record.summary,
    record.ratioNote,
    Array.isArray(record.holdingPoints) ? record.holdingPoints.join(" ") : ""
  ].join(" ")).toLowerCase();

  if (/partly allowed|partially allowed|allowed in part/.test(haystack)) return "partly allowed";
  if (/dismissed|rejected/.test(haystack)) return "dismissed";
  if (/allowed|granted|relief granted/.test(haystack)) return "allowed";
  if (/remand|remanded/.test(haystack)) return "remanded";
  if (/interim protection|status quo/.test(haystack)) return "interim relief";
  return "outcome to be verified";
}

function inferTreatmentStatus(record = {}) {
  const raw = normalizeWhitespace(record.treatmentStatus).toLowerCase();
  if (raw) return toTitleCase(raw);
  const outcome = inferOutcome(record);
  if (outcome === "allowed") return "Relied on";
  if (outcome === "dismissed") return "Verify";
  return "Verify";
}

function computeTreatmentAlert(record = {}) {
  const status = normalizeWhitespace(record.treatmentStatus).toLowerCase();
  const caution = normalizeWhitespace(record.cautionFlag).toLowerCase();
  const overruledCount = Array.isArray(record.overruledBy) ? record.overruledBy.length : 0;
  const distinguishedCount = Array.isArray(record.distinguishedBy) ? record.distinguishedBy.length : 0;
  const followedCount = Array.isArray(record.followedBy) ? record.followedBy.length : 0;

  if (overruledCount || /overruled|limited/.test(status) || /overruled|limited/.test(caution)) {
    return {
      treatmentAlertLabel: "High risk",
      treatmentAlertTone: "highRisk",
      treatmentAlertNote: "Treatment indicates the authority may be overruled or limited."
    };
  }

  if (distinguishedCount || /distinguished/.test(status) || /distinguish/.test(caution)) {
    return {
      treatmentAlertLabel: "Caution",
      treatmentAlertTone: "caution",
      treatmentAlertNote: "Authority has distinguishing treatment and should be used carefully."
    };
  }

  if (/verify/.test(status) || /verify/.test(caution)) {
    return {
      treatmentAlertLabel: "Verify",
      treatmentAlertTone: "review",
      treatmentAlertNote: "Treatment should be checked before relying on this authority."
    };
  }

  if (followedCount || /followed|landmark|good law|relied/.test(status)) {
    return {
      treatmentAlertLabel: "Followed",
      treatmentAlertTone: "positive",
      treatmentAlertNote: "Authority treatment appears supportive, but filing use should still be verified."
    };
  }

  return {
    treatmentAlertLabel: "Check",
    treatmentAlertTone: "neutral",
    treatmentAlertNote: "Treatment history should be checked before filing."
  };
}

function buildPropositionNotes(record = {}) {
  const candidates = [];
  const holdingPoints = Array.isArray(record.holdingPoints) ? record.holdingPoints : [];
  const ratioNote = normalizeWhitespace(record.ratioNote);
  const summary = normalizeWhitespace(record.summary);

  holdingPoints.forEach((item) => {
    const normalized = normalizeWhitespace(item);
    if (normalized.length >= 20) {
      candidates.push(normalized);
    }
  });

  [ratioNote, summary].forEach((text) => {
    String(text || "")
      .split(/(?<=[.?!])\s+/)
      .map((item) => normalizeWhitespace(item))
      .filter((item) => item.length >= 32)
      .slice(0, 3)
      .forEach((item) => candidates.push(item));
  });

  const propositionKeywords = [
    "must",
    "cannot",
    "should",
    "requires",
    "mandatory",
    "entitled",
    "liable",
    "relief",
    "injunction",
    "notice",
    "limitation",
    "natural justice",
    "arbitration",
    "specific performance",
    "section",
    "article",
    "rule"
  ];

  return toUniqueStrings(
    candidates.filter((item) => propositionKeywords.some((keyword) => item.toLowerCase().includes(keyword))),
    4
  );
}

function getCourtPriority(record = {}) {
  const level = inferCourtLevel(record.court);
  if (level === "supreme") return 5;
  if (level === "high") return 4;
  if (level === "tribunal") return 3;
  if (level === "commission") return 2;
  return 1;
}

function buildKeywordIndex(record = {}) {
  return toUniqueStrings([
    ...normalizeSearchText(record.title),
    ...normalizeSearchText(record.caseNumber),
    ...normalizeSearchText(record.citation),
    ...normalizeSearchText(record.neutralCitation),
    ...normalizeSearchText(record.summary),
    ...normalizeSearchText(record.ratioNote),
    ...(Array.isArray(record.propositionNotes) ? normalizeSearchText(record.propositionNotes.join(" ")) : []),
    ...(Array.isArray(record.partyNames) ? normalizeSearchText(record.partyNames.join(" ")) : []),
    ...(Array.isArray(record.issueTags) ? normalizeSearchText(record.issueTags.join(" ")) : []),
    ...(Array.isArray(record.matterTags) ? normalizeSearchText(record.matterTags.join(" ")) : []),
    ...(Array.isArray(record.statutoryReferences) ? normalizeSearchText(record.statutoryReferences.join(" ")) : [])
  ], 40);
}

function buildSourceFingerprint(record = {}, source = {}) {
  return normalizeWhitespace([
    source.id || source.name || "",
    record.title || "",
    record.caseNumber || "",
    record.citation || "",
    record.judgmentDate || "",
    record.sourceUrl || ""
  ].join(" | "));
}

function buildDocId(record = {}, sourceId = "", index = 0) {
  const basis = String(record.id || `${sourceId || "judgment"}-${record.citation || record.title || "untitled"}-${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 120);

  return basis || `judgment-${index}`;
}

function computeConfidenceScore(record = {}, warnings = [], errors = []) {
  let score = 35;
  if (record.title) score += 12;
  if (record.citation) score += 8;
  if (record.neutralCitation) score += 4;
  if (record.court) score += 8;
  if (record.caseNumber) score += 4;
  if (Array.isArray(record.partyNames) && record.partyNames.length) score += 4;
  if (record.judgmentDate) score += 10;
  if (record.summary) score += 10;
  if (record.ratioNote) score += 5;
  if (Array.isArray(record.issueTags) && record.issueTags.length) score += 5;
  if (Array.isArray(record.matterTags) && record.matterTags.length) score += 5;
  if (Array.isArray(record.statutoryReferences) && record.statutoryReferences.length) score += 6;
  if (Array.isArray(record.keyParagraphs) && record.keyParagraphs.length) score += 4;
  if (Array.isArray(record.propositionNotes) && record.propositionNotes.length) score += 6;
  if (record.sourceUrl) score += 4;
  score -= warnings.length * 4;
  score -= errors.length * 10;
  return Math.max(5, Math.min(100, score));
}

function buildValidation(normalized = {}, source = {}) {
  const warnings = [];
  const errors = [];

  if (!normalized.title) errors.push("missing_title");
  if (!normalized.court) errors.push("missing_court");
  if (!normalized.summary) warnings.push("missing_summary");
  if (!normalized.citation) warnings.push("missing_citation");
  if (!normalized.judgmentDate) warnings.push("missing_judgment_date");
  if (!normalized.sourceUrl && source.endpoint) warnings.push("missing_source_url");
  if (!normalized.issueTags.length) warnings.push("missing_issue_tags");
  if (!normalized.statutoryReferences.length) warnings.push("missing_statutory_references");
  if (!normalized.keyParagraphs.length) warnings.push("missing_key_paragraphs");
  if (normalized.summary && normalized.summary.length < 60) warnings.push("thin_summary");
  if (normalized.courtLevel === "other") warnings.push("unmapped_court_level");

  const confidenceScore = computeConfidenceScore(normalized, warnings, errors);
  const requiresReview = Boolean(errors.length || confidenceScore < 62 || warnings.length >= 4);
  const reviewPriority = errors.length ? "high" : confidenceScore < 45 ? "high" : confidenceScore < 70 ? "medium" : "low";

  return {
    errors,
    warnings,
    confidenceScore,
    requiresReview,
    reviewPriority,
    completenessScore: Math.max(0, Math.min(100, confidenceScore + (errors.length ? -5 : 5)))
  };
}

function buildPreview(record = {}, validation = {}) {
  const freshness = computeFreshnessProfile(record.judgmentDate);
  const treatment = computeTreatmentAlert(record);
  return {
    title: record.title,
    caseNumber: record.caseNumber,
    partyNames: record.partyNames,
    citation: record.citation,
    court: record.court,
    judgmentDate: record.judgmentDate,
    issueTags: record.issueTags,
    matterTags: record.matterTags,
    statutoryReferences: record.statutoryReferences,
    propositionNotes: record.propositionNotes,
    reliefType: record.reliefType,
    outcome: record.outcome,
    treatmentAlertLabel: treatment.treatmentAlertLabel,
    treatmentAlertTone: treatment.treatmentAlertTone,
    treatmentAlertNote: treatment.treatmentAlertNote,
    freshnessLabel: freshness.freshnessLabel,
    freshnessDays: freshness.freshnessDays,
    stalenessReason: freshness.stalenessReason,
    confidenceScore: validation.confidenceScore,
    requiresReview: validation.requiresReview,
    reviewPriority: validation.reviewPriority,
    warnings: validation.warnings,
    errors: validation.errors
  };
}

function buildStorageDoc(record = {}, validation = {}, source = {}, context = {}) {
  const sourceId = String(context.sourceId || source.id || "manual-import").trim() || "manual-import";
  const sourceType = String(context.sourceType || record.sourceType || "live").trim() || "live";
  const aiEnriched = Boolean(context.aiEnriched);
  const freshness = computeFreshnessProfile(record.judgmentDate);
  const treatment = computeTreatmentAlert(record);

  return {
    title: record.title,
    caseNumber: record.caseNumber,
    partyNames: record.partyNames,
    citation: record.citation,
    neutralCitation: record.neutralCitation || record.citation,
    parallelCitations: record.parallelCitations,
    citationAliases: record.citationAliases,
    citationVariants: record.citationVariants,
    canonicalCaseId: record.canonicalCaseId,
    court: record.court,
    courtLevel: record.courtLevel,
    bench: record.bench,
    judgmentDate: record.judgmentDate,
    summary: record.summary,
    ratioNote: record.ratioNote,
    relevanceNote: record.relevanceNote,
    treatmentStatus: record.treatmentStatus,
    cautionFlag: record.cautionFlag,
    issueTags: record.issueTags,
    matterTags: record.matterTags,
    holdingPoints: record.holdingPoints,
    propositionNotes: record.propositionNotes,
    keyParagraphs: record.keyParagraphs,
    citedBy: record.citedBy,
    followedBy: record.followedBy,
    distinguishedBy: record.distinguishedBy,
    overruledBy: record.overruledBy,
    practicalUse: record.practicalUse,
    statutoryReferences: record.statutoryReferences,
    reliefType: record.reliefType,
    outcome: record.outcome,
    courtPriority: record.courtPriority,
    keywordIndex: record.keywordIndex,
    sourceUrl: record.sourceUrl,
    sourceType,
    sourceId,
    sourceFingerprint: record.sourceFingerprint,
    treatmentAlertLabel: treatment.treatmentAlertLabel,
    treatmentAlertTone: treatment.treatmentAlertTone,
    treatmentAlertNote: treatment.treatmentAlertNote,
    freshnessLabel: freshness.freshnessLabel,
    freshnessDays: freshness.freshnessDays,
    stalenessReason: freshness.stalenessReason,
    validationWarnings: validation.warnings,
    validationErrors: validation.errors,
    requiresReview: validation.requiresReview,
    reviewPriority: validation.reviewPriority,
    confidenceScore: validation.confidenceScore,
    completenessScore: validation.completenessScore,
    analysisVersion: ANALYSIS_VERSION,
    aiEnriched,
    aiSummary: normalizeWhitespace(record.aiSummary || ""),
    propositionNotes: Array.isArray(record.propositionNotes) ? record.propositionNotes : [],
    importedBy: context.importedBy || "",
    updatedAt: context.updatedAt
  };
}

function normalizeJudgmentRecord(record = {}, source = {}) {
  const title = normalizeWhitespace(record.title || record.caseTitle || record.caseName);
  const caseNumber = normalizeWhitespace(record.caseNumber);
  const partyNames = toUniqueStrings(Array.isArray(record.partyNames) ? record.partyNames : [], 6);
  const citation = normalizeWhitespace(record.citation || record.neutralCitation);
  const neutralCitation = normalizeWhitespace(record.neutralCitation || record.citation);
  const court = canonicalizeCourtName(record.court, source.court || source.name);
  const summary = normalizeWhitespace(record.summary || record.headnote || `Official ${court || "court"} judgment record for ${title || "untitled matter"}.`);
  const ratioNote = normalizeWhitespace(record.ratioNote || record.holding);
  const rawIssueTags = Array.isArray(record.issueTags) ? record.issueTags : [];
  const issueTags = toUniqueStrings(rawIssueTags.length ? rawIssueTags : inferMatterTags({
    ...record,
    title,
    summary,
    ratioNote
  }), 8);

  const keyParagraphs = toUniqueStrings([
    ...(Array.isArray(record.keyParagraphs) ? record.keyParagraphs : []),
    ...extractParagraphReferences(`${summary} ${ratioNote} ${Array.isArray(record.holdingPoints) ? record.holdingPoints.join(" ") : ""}`)
  ].map(normalizeParagraphReference), 12);

  const statutoryReferences = extractStatutoryReferences([
    title,
    summary,
    ratioNote,
    Array.isArray(record.holdingPoints) ? record.holdingPoints.join(" ") : "",
    Array.isArray(record.keyParagraphs) ? record.keyParagraphs.join(" ") : ""
  ].join(" "));

  const matterTags = toUniqueStrings([
    ...(Array.isArray(record.matterTags) ? record.matterTags : []),
    ...inferMatterTags({
      ...record,
      title,
      summary,
      ratioNote,
      issueTags
    })
  ], 8);

  const propositionNotes = toUniqueStrings([
    ...(Array.isArray(record.propositionNotes) ? record.propositionNotes : []),
    ...buildPropositionNotes({
      ...record,
      title,
      summary,
      ratioNote,
      holdingPoints: Array.isArray(record.holdingPoints) ? record.holdingPoints : []
    })
  ], 4);

  const normalized = {
    id: normalizeWhitespace(record.id),
    title,
    caseNumber,
    partyNames,
    citation,
    neutralCitation,
    parallelCitations: toUniqueStrings(Array.isArray(record.parallelCitations) ? record.parallelCitations : [], 8),
    citationAliases: toUniqueStrings(Array.isArray(record.citationAliases) ? record.citationAliases : [], 8),
    citationVariants: buildCitationVariants({ ...record, citation, neutralCitation }),
    court,
    courtLevel: inferCourtLevel(court),
    bench: normalizeWhitespace(record.bench),
    judgmentDate: normalizeJudgmentDate(record.judgmentDate || record.date),
    summary,
    ratioNote,
    relevanceNote: normalizeWhitespace(record.relevanceNote || `Useful for ${matterTags[0] || "issue"} research and authority selection.`),
    treatmentStatus: inferTreatmentStatus(record),
    cautionFlag: normalizeWhitespace(record.cautionFlag || "Verify the full judgment, current treatment, and exact citation before filing."),
    issueTags,
    matterTags,
    holdingPoints: toUniqueStrings(Array.isArray(record.holdingPoints) ? record.holdingPoints : [], 10),
    propositionNotes,
    keyParagraphs,
    citedBy: toUniqueStrings(Array.isArray(record.citedBy) ? record.citedBy : [], 12),
    followedBy: toUniqueStrings(Array.isArray(record.followedBy) ? record.followedBy : [], 12),
    distinguishedBy: toUniqueStrings(Array.isArray(record.distinguishedBy) ? record.distinguishedBy : [], 12),
    overruledBy: toUniqueStrings(Array.isArray(record.overruledBy) ? record.overruledBy : [], 12),
    practicalUse: toUniqueStrings(Array.isArray(record.practicalUse) ? record.practicalUse : [
      "Use in research memo",
      "Verify before final reliance"
    ], 8),
    statutoryReferences,
    reliefType: inferReliefType({ ...record, title, summary, ratioNote, issueTags }),
    outcome: inferOutcome({ ...record, title, summary, ratioNote }),
    courtPriority: getCourtPriority({ court }),
    sourceUrl: normalizeWhitespace(record.sourceUrl || record.url || ""),
    sourceType: normalizeWhitespace(record.sourceType || (source.retrievalMode ? "live" : "manual")),
    sourceFingerprint: "",
    keywordIndex: []
  };

  normalized.canonicalCaseId = buildCanonicalCaseId(normalized);
  normalized.sourceFingerprint = buildSourceFingerprint(normalized, source);
  normalized.keywordIndex = buildKeywordIndex(normalized);
  return normalized;
}

function buildJudgmentEnrichmentRequest(record = {}, source = {}) {
  const fallback = {
    issueTags: record.issueTags || [],
    matterTags: record.matterTags || [],
    reliefType: record.reliefType || "general relief",
    outcome: record.outcome || "outcome to be verified",
    statutoryReferences: record.statutoryReferences || [],
    propositionNotes: Array.isArray(record.holdingPoints) ? record.holdingPoints.slice(0, 3) : [],
    keyParagraphs: Array.isArray(record.keyParagraphs) ? record.keyParagraphs.slice(0, 5) : [],
    aiSummary: normalizeWhitespace(record.summary || ""),
    practicalUse: Array.isArray(record.practicalUse) ? record.practicalUse.slice(0, 4) : []
  };

  return {
    systemPrompt: "You normalize Indian court-judgment metadata into concise, filing-safe JSON. Use only the supplied record. Do not invent citations, parties, or law. If uncertain, preserve the fallback meaning and keep conservative wording.",
    userPrompt: `Source court: ${source.court || source.name || "unknown"}\nTitle: ${record.title || ""}\nCase number: ${record.caseNumber || ""}\nParty names: ${(record.partyNames || []).join(" | ")}\nCitation: ${record.citation || ""}\nNeutral citation: ${record.neutralCitation || ""}\nBench: ${record.bench || ""}\nJudgment date: ${record.judgmentDate || ""}\nSummary: ${record.summary || ""}\nRatio note: ${record.ratioNote || ""}\nExisting issue tags: ${(record.issueTags || []).join(", ")}\nExisting statutory references: ${(record.statutoryReferences || []).join(", ")}\nHolding points: ${(record.holdingPoints || []).join(" | ")}\nKey paragraphs: ${(record.keyParagraphs || []).join(", ")}\nPractical use: ${(record.practicalUse || []).join(" | ")}`,
    schemaHint: `Return an object with keys: issueTags(string[] max 8), matterTags(string[] max 8), reliefType(string), outcome(string), statutoryReferences(string[] max 12), propositionNotes(string[] max 4), keyParagraphs(string[] max 6), aiSummary(string max 420), practicalUse(string[] max 5).`,
    fallback
  };
}

function mergeJudgmentAiEnrichment(record = {}, aiPayload = {}) {
  if (!aiPayload || typeof aiPayload !== "object") return { ...record };

  const merged = {
    ...record,
    issueTags: toUniqueStrings([...(record.issueTags || []), ...((aiPayload.issueTags || []))], 8),
    matterTags: toUniqueStrings([...(record.matterTags || []), ...((aiPayload.matterTags || []))], 8),
    statutoryReferences: toUniqueStrings([...(record.statutoryReferences || []), ...((aiPayload.statutoryReferences || []))], 16),
    propositionNotes: toUniqueStrings(aiPayload.propositionNotes || [], 4),
    keyParagraphs: toUniqueStrings([...(record.keyParagraphs || []), ...((aiPayload.keyParagraphs || []))].map(normalizeParagraphReference), 12),
    practicalUse: toUniqueStrings([...(record.practicalUse || []), ...((aiPayload.practicalUse || []))], 8),
    aiSummary: normalizeWhitespace(aiPayload.aiSummary || record.aiSummary || ""),
    reliefType: normalizeWhitespace(aiPayload.reliefType || record.reliefType),
    outcome: normalizeWhitespace(aiPayload.outcome || record.outcome)
  };

  merged.keywordIndex = buildKeywordIndex(merged);
  return merged;
}

function analyzeJudgmentRecord(record = {}, source = {}, context = {}) {
  const normalized = normalizeJudgmentRecord(record, source);
  const validation = buildValidation(normalized, source);
  const docId = buildDocId(normalized, context.sourceId || source.id, context.importIndex || 0);
  const storageDoc = buildStorageDoc(normalized, validation, source, {
    sourceId: context.sourceId || source.id,
    sourceType: context.sourceType || normalized.sourceType,
    importedBy: context.importedBy || "",
    updatedAt: context.updatedAt,
    aiEnriched: Boolean(context.aiEnriched)
  });

  return {
    docId,
    normalizedRecord: normalized,
    storageDoc,
    validation,
    preview: buildPreview(normalized, validation)
  };
}

module.exports = {
  ANALYSIS_VERSION,
  analyzeJudgmentRecord,
  buildJudgmentEnrichmentRequest,
  buildPropositionNotes,
  computeFreshnessProfile,
  computeTreatmentAlert,
  mergeJudgmentAiEnrichment,
  normalizeJudgmentRecord,
  normalizeJudgmentDate,
  canonicalizeCourtName,
  extractStatutoryReferences,
  inferMatterTags,
  inferReliefType,
  inferOutcome
};
