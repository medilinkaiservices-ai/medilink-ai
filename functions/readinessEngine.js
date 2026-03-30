const { analyzeDocument } = require("./documentAnalyzerEngine");
const { analyzeCaseStrength } = require("./strengthEngine");

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function normalizeIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeDocuments(documents = []) {
  return (Array.isArray(documents) ? documents : []).map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `doc-${index}`,
        title: `Document ${index + 1}`,
        content: item,
        type: "text"
      };
    }

    return {
      id: String(item?.id || `doc-${index}`).trim(),
      title: String(item?.title || item?.fileName || `Document ${index + 1}`).trim(),
      content: String(item?.content || item?.text || item?.summary || "").trim(),
      type: String(item?.type || item?.mimeType || "text").trim()
    };
  }).filter((item) => item.title || item.content);
}

function buildChecklistItem(key, label, status, note) {
  return { key, label, status, note };
}

function deriveStatus(ok, caution = false) {
  if (ok) return "READY";
  if (caution) return "CAUTION";
  return "MISSING";
}

async function analyzeFilingReadiness(admin, input = {}) {
  const matterId = String(input.matterId || "").trim();
  const facts = String(input.facts || "").trim();
  const issues = normalizeIssues(input.issues);
  const documents = normalizeDocuments(input.documents);
  const jurisdiction = String(input.jurisdiction || "").trim();
  const draftText = String(input.draftText || "").trim();
  const draftType = String(input.draftType || "").trim().toLowerCase();
  const selectedCases = Array.isArray(input.selectedCases) ? input.selectedCases : [];

  const documentAnalysis = input.documentAnalysis && typeof input.documentAnalysis === "object"
    ? input.documentAnalysis
    : analyzeDocument({
        documentText: draftText || documents.map((item) => item.content).join("\n"),
        caseFacts: facts
      });

  const strength = input.caseStrength && typeof input.caseStrength === "object"
    ? input.caseStrength
    : await analyzeCaseStrength(admin, {
        matterId,
        facts,
        issues,
        documents,
        selectedCases,
        jurisdiction
      });

  const docText = `${draftText}\n${documents.map((item) => `${item.title}\n${item.content}`).join("\n")}`.toLowerCase();
  const factPresent = Boolean(facts);
  const issuesPresent = issues.length > 0;
  const jurisdictionPresent = Boolean(jurisdiction) || /jurisdiction/i.test(docText);
  const chronologyPresent = /\d{4}-\d{2}-\d{2}|dated|date/i.test(facts) || /chronology/i.test(docText);
  const documentsPresent = documents.length > 0;
  const authorityPresent = selectedCases.length > 0 || (strength.authorityReview || []).length > 0;
  const limitationReviewed = /limitation|delay|within \d+ days|time barred/i.test(docText) || (strength.riskAnalysis || []).some((item) => /delay|limitation/i.test(item));
  const prayerPresent = /prayer|relief/i.test(draftText);
  const affidavitPresent = draftType === "affidavit" || /affidavit|deponent|verification/i.test(draftText);
  const annexuresPresent = /annexure|enclosure|attached/i.test(draftText) || documents.length > 1;
  const vakalatPresent = /vakalat|counsel for|advocate for/i.test(draftText);
  const noticeWindowPresent = draftType === "notice"
    ? /within\s+\d+\s+days|15 days|30 days|statutory notice/i.test(draftText || facts)
    : true;

  const checklist = [
    buildChecklistItem("facts", "Material facts captured", deriveStatus(factPresent), factPresent ? "Core facts are available." : "Complete the fact statement before filing."),
    buildChecklistItem("issues", "Issues identified", deriveStatus(issuesPresent), issuesPresent ? "Issue list is available." : "Frame the legal issues clearly."),
    buildChecklistItem("jurisdiction", "Jurisdiction checked", deriveStatus(jurisdictionPresent, Boolean(jurisdiction)), jurisdictionPresent ? "Jurisdiction is available or mentioned." : "Confirm territorial and subject-matter jurisdiction."),
    buildChecklistItem("chronology", "Chronology / dates available", deriveStatus(chronologyPresent, factPresent), chronologyPresent ? "Dates or chronology markers are present." : "Add reliable dates and sequence of events."),
    buildChecklistItem("documents", "Supporting documents attached", deriveStatus(documentsPresent, factPresent), documentsPresent ? "Supporting records are present." : "Attach the core supporting documents."),
    buildChecklistItem("authorities", "Authorities selected", deriveStatus(authorityPresent, issuesPresent), authorityPresent ? "Authority support is available." : "Select at least one relevant good-law authority."),
    buildChecklistItem("limitation", "Limitation / timing reviewed", deriveStatus(limitationReviewed, factPresent), limitationReviewed ? "Timing risk appears to be considered." : "Check delay, limitation, and statutory deadlines explicitly."),
    buildChecklistItem("prayer", "Prayer / relief section", deriveStatus(prayerPresent, Boolean(draftText)), prayerPresent ? "Prayer section detected." : "Add a clear prayer / relief section."),
    buildChecklistItem("annexures", "Annexures / enclosures", deriveStatus(annexuresPresent, documentsPresent), annexuresPresent ? "Annexures or enclosures appear available." : "Prepare annexure and enclosure list."),
    buildChecklistItem("vakalat", "Counsel / representation block", deriveStatus(vakalatPresent, Boolean(draftText)), vakalatPresent ? "Counsel block is visible." : "Add counsel / representation details where required.")
  ];

  if (draftType === "notice") {
    checklist.push(buildChecklistItem(
      "notice_window",
      "Notice timeline stated",
      deriveStatus(noticeWindowPresent, Boolean(draftText)),
      noticeWindowPresent ? "Notice compliance period is visible." : "State the exact compliance period before service."
    ));
  }

  if (draftType === "petition" || draftType === "affidavit") {
    checklist.push(buildChecklistItem(
      "affidavit_verification",
      "Verification / affidavit support",
      deriveStatus(affidavitPresent, Boolean(draftText)),
      affidavitPresent ? "Verification / affidavit language appears present." : "Add verification / affidavit support where required."
    ));
  }

  const readyCount = checklist.filter((item) => item.status === "READY").length;
  const cautionCount = checklist.filter((item) => item.status === "CAUTION").length;
  const missingItems = checklist.filter((item) => item.status === "MISSING");
  const readinessScore = clampScore(((readyCount * 1) + (cautionCount * 0.5)) / checklist.length * 100);

  return {
    matterId,
    readinessScore,
    readinessLevel: readinessScore >= 75 ? "READY" : readinessScore >= 45 ? "PARTIAL" : "NOT READY",
    summary: readinessScore >= 75
      ? "The matter appears substantially ready, subject to final lawyer verification."
      : readinessScore >= 45
        ? "The matter is partially ready but still needs targeted filing checks."
        : "The matter is not yet ready for filing or service.",
    checklist,
    missingItems: missingItems.map((item) => item.label),
    criticalRisks: [
      ...(strength.riskAnalysis || []).slice(0, 4),
      ...(documentAnalysis.risks || []).slice(0, 3)
    ].filter((item, index, list) => list.indexOf(item) === index),
    nextSteps: missingItems.map((item) => item.note).slice(0, 8)
  };
}

module.exports = {
  analyzeFilingReadiness
};
