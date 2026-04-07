"use strict";

function pickFirst(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function normalize(raw = {}) {
  const treatmentStatus = pickFirst(raw.treatmentStatus, raw.status, raw.validityStatus);
  const riskLevel = pickFirst(raw.riskLevel);
  const warning = pickFirst(raw.cautionFlag, raw.warning, raw.relevanceNote);
  return {
    case_name: pickFirst(raw.case_name, raw.caseName, raw.title),
    court: pickFirst(raw.court),
    citation: pickFirst(raw.citation),
    judgmentDate: pickFirst(raw.judgmentDate, raw.date),
    facts_summary: pickFirst(raw.facts_summary, raw.summary, raw.factsSummary),
    issue: pickFirst(raw.issue, raw.issueSummary),
    holding: pickFirst(raw.holding, raw.holdingSummary),
    ratio: pickFirst(raw.ratio, raw.ratioNote),
    relevance: pickFirst(raw.relevance, raw.relevanceNote),
    jurisdiction: pickFirst(raw.jurisdiction, raw.court),
    stage: pickFirst(raw.stage),
    issueTags: Array.isArray(raw.issueTags) ? raw.issueTags : [],
    sourceType: pickFirst(raw.sourceType, raw.source, "judgment_library"),
    sourceUrl: pickFirst(raw.sourceUrl),
    authorityStatus: treatmentStatus || "verify",
    riskLevel: riskLevel || "unknown",
    authorityWarning: warning || ""
  };
}

module.exports = {
  normalize
};
