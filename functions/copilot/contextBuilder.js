"use strict";

const { getLegacyLawNotice, retrieveLegalContext } = require("../legalUtils");

function normalizeTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenizeIssueInputs(memory = {}) {
  return normalizeTokens([
    memory.caseType,
    memory.factsSummary,
    Array.isArray(memory.issues) ? memory.issues.join(" ") : "",
    memory.jurisdiction,
    memory.stage,
    memory.documentType,
    memory.reliefSought
  ].filter(Boolean).join(" "));
}

function classifyIssues(memory = {}) {
  const facts = String(memory.factsSummary || "");
  const issues = Array.isArray(memory.issues) ? memory.issues : [];
  const tokens = tokenizeIssueInputs(memory);

  const classifierMap = [
    { issue: "cheque_dishonour", match: ["cheque", "dishonour", "dishonor", "bank", "memo", "negotiable", "138"] },
    { issue: "money_recovery", match: ["recovery", "dues", "loan", "borrowed", "payment", "refund"] },
    { issue: "contract_breach", match: ["contract", "breach", "agreement", "service"] },
    { issue: "consumer_dispute", match: ["consumer", "refund", "deficiency", "possession"] },
    { issue: "property_dispute", match: ["property", "possession", "title", "sale"] },
    { issue: "employment_dispute", match: ["employee", "termination", "salary", "employment"] },
    { issue: "criminal_complaint", match: ["fir", "police", "arrest", "criminal", "forgery", "threat"] }
  ];

  const detected = classifierMap
    .filter((entry) => entry.match.some((token) => tokens.includes(token)))
    .map((entry) => entry.issue);

  return {
    primaryIssue: detected[0] || issues[0] || memory.caseType || "general_legal_issue",
    secondaryIssues: detected.slice(1)
  };
}

function inferDocumentType(memory = {}) {
  const explicit = String(memory.documentType || "").trim().toLowerCase();
  if (explicit) return explicit;

  const combined = [memory.caseType, memory.factsSummary, memory.reliefSought]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/notice|legal notice|demand notice/.test(combined)) return "notice";
  if (/complaint|section 138|dishonou?r/.test(combined)) return "complaint";
  if (/affidavit|sworn|deponent/.test(combined)) return "affidavit";
  return "general";
}

function scoreItem(item, memory, issueBundle) {
  const haystack = normalizeTokens([
    item.title,
    item.label,
    item.summary,
    item.issue,
    item.holding,
    item.ratio,
    item.jurisdiction,
    item.stage
  ].join(" "));

  let score = 0;
  const issueTokens = normalizeTokens([issueBundle.primaryIssue, ...issueBundle.secondaryIssues, memory.caseType].join(" "));
  const factTokens = normalizeTokens(memory.factsSummary).slice(0, 20);
  const jurisdictionTokens = normalizeTokens(memory.jurisdiction);
  const stageTokens = normalizeTokens(memory.stage);
  const documentType = inferDocumentType(memory);

  for (const token of issueTokens) {
    if (haystack.includes(token)) score += 5;
  }
  for (const token of factTokens) {
    if (haystack.includes(token)) score += 1;
  }
  for (const token of jurisdictionTokens) {
    if (haystack.includes(token)) score += 3;
  }
  for (const token of stageTokens) {
    if (haystack.includes(token)) score += 2;
  }
  if (String(item.documentType || "").toLowerCase() === documentType) {
    score += 2;
  }
  if (documentType === "complaint" && /section 138|negotiable instruments|dishonou?r|notice/.test(String(item.label || item.title || "").toLowerCase())) {
    score += 6;
  }
  if (documentType === "notice" && /notice|demand|payment|reply/.test(String(item.label || item.title || "").toLowerCase())) {
    score += 4;
  }
  if (/article 14|article 21|maneka gandhi|d\.?\s*k\.?\s*basu|consumer protection/.test(String(item.label || item.title || "").toLowerCase())
    && issueBundle.primaryIssue === "cheque_dishonour") {
    score -= 8;
  }

  return score;
}

function limitAndRank(items, memory, issueBundle, limit) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ ...item, relevanceScore: scoreItem(item, memory, issueBundle) }))
    .filter((item) => item.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

function buildSearchQuery(memory = {}, issueBundle = {}) {
  return [
    memory.caseType,
    memory.factsSummary,
    Array.isArray(memory.issues) ? memory.issues.join(" ") : "",
    issueBundle.primaryIssue,
    memory.jurisdiction,
    memory.stage,
    inferDocumentType(memory),
    memory.reliefSought
  ].filter(Boolean).join(" ");
}

async function buildContext({ memory, retrievalAdapters = {}, caseLawMapper }) {
  const issueBundle = classifyIssues(memory);
  const documentType = inferDocumentType(memory);
  const searchQuery = buildSearchQuery(memory, issueBundle);
  const legacyLawNotice = getLegacyLawNotice(searchQuery);

  const defaultSections = retrieveLegalContext(
    searchQuery,
    8
  ).map((entry) => ({
    title: entry.title || "",
    label: entry.citation ? `${entry.title} | ${entry.citation}` : entry.title,
    summary: entry.body || "",
    jurisdiction: memory.jurisdiction || "",
    stage: memory.stage || "",
    documentType,
    sourceType: "legal_corpus"
  }));

  const rawSections = typeof retrievalAdapters.fetchSections === "function"
    ? await retrievalAdapters.fetchSections({
        issue: issueBundle.primaryIssue,
        jurisdiction: memory.jurisdiction,
        stage: memory.stage,
        documentType,
        searchQuery
      })
    : defaultSections;

  const rawJudgments = typeof retrievalAdapters.fetchJudgments === "function"
    ? await retrievalAdapters.fetchJudgments({
        issue: issueBundle.primaryIssue,
        jurisdiction: memory.jurisdiction,
        stage: memory.stage,
        documentType,
        searchQuery
      })
    : [];

  const normalizedJudgments = Array.isArray(rawJudgments)
    ? rawJudgments.map((item) => caseLawMapper.normalize(item))
    : [];

  const sections = limitAndRank(rawSections, memory, issueBundle, 5);
  const judgments = limitAndRank(normalizedJudgments, memory, issueBundle, 8);
  const cautionCount = judgments.filter((item) => /overruled|distinguished|caution|bad law/i.test(String(item.authorityStatus || item.authorityWarning || ""))).length;

  return {
    issueBundle,
    documentType,
    searchQuery,
    sections,
    judgments,
    authoritiesSummary: [
      `Primary issue: ${issueBundle.primaryIssue}`,
      `Document type: ${documentType}`,
      `Sections selected: ${sections.length}`,
      `Judgments selected: ${judgments.length}`,
      cautionCount ? `Caution authorities: ${cautionCount}` : "",
      legacyLawNotice || ""
    ].filter(Boolean).join(" | "),
    legacyLawNotice
  };
}

module.exports = {
  classifyIssues,
  buildContext
};
