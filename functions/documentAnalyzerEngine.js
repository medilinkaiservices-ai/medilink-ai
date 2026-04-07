function normalizeLines(text = "") {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueList(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function inferDocumentType(text = "") {
  const lowered = String(text || "").toLowerCase();
  if (/complaint under section|criminal complaint|consumer complaint|private complaint/i.test(lowered)) return "complaint";
  if (/legal notice|hereby called upon|demand/i.test(lowered)) return "notice";
  if (/agreement|between|party of the first part|party of the second part/i.test(lowered)) return "agreement";
  if (/affidavit|deponent|solemnly affirm/i.test(lowered)) return "affidavit";
  if (/petition|most respectfully showeth|prayer/i.test(lowered)) return "petition";
  if (/reply notice|written statement|counter affidavit|reply affidavit/i.test(lowered)) return "reply / response";
  if (/reply notice|without prejudice/i.test(lowered)) return "reply";
  return "general legal document";
}

function extractKeyFacts(lines = []) {
  return uniqueList(lines
    .filter((line) => /\d|dated|issued|paid|served|terminated|dishonou?r|agreement|notice|amount|reply/i.test(line))
    .slice(0, 10));
}

function extractLegalEntities(text = "") {
  const matches = String(text || "").match(/\b(?:[A-Z][A-Za-z.&/-]*\s){0,4}[A-Z][A-Za-z.&/-]*\b/g) || [];
  return uniqueList(matches
    .map((item) => item.trim())
    .filter((item) => item.length > 3 && !/^(LEGAL NOTICE|FACTS|PRAYER|SUBJECT|FROM|TO)$/i.test(item))
    .slice(0, 10));
}

function extractObligations(lines = []) {
  return uniqueList(lines
    .filter((line) => /shall|must|liable|obliged|obligation|required to|within \d+ days|pay|deliver|perform/i.test(line))
    .slice(0, 8));
}

function extractImportantClauses(lines = [], documentType = "") {
  const clauseNeedles = [
    "jurisdiction",
    "termination",
    "payment",
    "indemnity",
    "liability",
    "notice",
    "confidentiality",
    "arbitration"
  ];

  const matched = lines.filter((line) => clauseNeedles.some((needle) => line.toLowerCase().includes(needle)));
  if (matched.length) return matched.slice(0, 8);

  if (documentType === "agreement") {
    return ["Jurisdiction clause should be reviewed carefully.", "Payment and default clauses should be checked against the factual dispute."];
  }
  return [];
}

function extractClauseObjects(lines = [], documentType = "") {
  const clauseNeedles = [
    { needle: "jurisdiction", title: "Jurisdiction" },
    { needle: "termination", title: "Termination" },
    { needle: "payment", title: "Payment" },
    { needle: "indemnity", title: "Indemnity" },
    { needle: "liability", title: "Liability" },
    { needle: "notice", title: "Notice" },
    { needle: "confidentiality", title: "Confidentiality" },
    { needle: "arbitration", title: "Arbitration" }
  ];

  const matched = [];
  lines.forEach((line, index) => {
    const matchedNeedle = clauseNeedles.find((item) => line.toLowerCase().includes(item.needle));
    if (!matchedNeedle) return;
    matched.push({
      clauseTitle: matchedNeedle.title,
      clauseText: line,
      location: `Paragraph ${index + 1}`
    });
  });

  if (matched.length) return matched.slice(0, 8);

  if (documentType === "agreement") {
    return [{
      clauseTitle: "Clause review required",
      clauseText: "Jurisdiction, payment, and default clauses should be reviewed against the dispute facts.",
      location: "Clause-level review pending"
    }];
  }

  return [];
}

function detectMissingPoints(text = "", documentType = "") {
  const lowered = String(text || "").toLowerCase();
  const missing = [];
  const hasPreciseDate = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(text);
  const hasSignaturePlaceholder = /signature pending|signature block|signed by|signature:/i.test(text);

  if (!hasPreciseDate) missing.push("Precise dates");
  if (!hasSignaturePlaceholder) missing.push("Signature block");
  if ((documentType === "agreement" || documentType === "petition") && !/jurisdiction/i.test(lowered)) missing.push("Jurisdiction clause / statement");
  if (documentType === "notice" && !/within|days/i.test(lowered)) missing.push("Compliance timeline");
  if (documentType === "agreement" && !/payment|consideration/i.test(lowered)) missing.push("Payment / consideration clause");

  return missing;
}

function detectRisks(text = "", documentType = "") {
  const lowered = String(text || "").toLowerCase();
  const risks = [];

  if (/may|possibly|subject to/i.test(lowered)) {
    risks.push("Ambiguous or qualified language may weaken enforceability.");
  }
  if (!/date|dated/i.test(lowered)) {
    risks.push("Absence of precise dates may weaken chronology and limitation analysis.");
  }
  if (documentType === "agreement" && !/termination|default/i.test(lowered)) {
    risks.push("Default / termination mechanics may be underdeveloped.");
  }
  if (documentType === "notice" && !/138|negotiable instruments act/i.test(lowered) && /cheque|dishonou?r/i.test(lowered)) {
    risks.push("Cheque dishonour notice may be missing the correct statutory reference.");
  }

  return risks;
}

function buildSuggestedArguments(documentType = "", text = "") {
  const suggestions = [];
  const lowered = String(text || "").toLowerCase();

  if (/cheque|dishonou?r|bank memo/i.test(lowered)) {
    suggestions.push("Use the dishonour event, cheque details, and bank memo facts to support statutory compliance and liability.");
  }
  if (/agreement|payment|breach/i.test(lowered)) {
    suggestions.push("Frame breach, payment default, and contractual obligation arguments clause-wise.");
  }
  if (/notice/i.test(lowered)) {
    suggestions.push("Highlight service, demand, and response timeline to strengthen cause of action.");
  }
  if (!suggestions.length) {
    suggestions.push(`Map the key factual assertions in this ${documentType} to the pleaded legal issues and supporting evidence.`);
  }

  return suggestions;
}

function mapFactsToLegalIssues(text = "", documentType = "") {
  const lowered = String(text || "").toLowerCase();
  const issues = [];

  if (/cheque|dishonou?r|bank memo/i.test(lowered)) {
    issues.push("Cheque dishonour compliance and statutory demand.");
  }
  if (/breach|default|failed to pay|non-payment|dues/i.test(lowered)) {
    issues.push("Breach / default and enforceability of payment obligation.");
  }
  if (/termination|cancelled|rescinded/i.test(lowered)) {
    issues.push("Termination validity and contractual consequence management.");
  }
  if (/notice|served|reply/i.test(lowered)) {
    issues.push("Service of notice and response timeline.");
  }
  if (!issues.length && documentType !== "general legal document") {
    issues.push(`Map the ${documentType} facts to the core statutory or contractual issue before filing.`);
  }

  return issues;
}

function compareWithCaseFacts(documentText = "", caseFacts = "") {
  const docLines = normalizeLines(documentText).map((line) => line.toLowerCase());
  const caseLines = normalizeLines(caseFacts).map((line) => line.toLowerCase());

  const contradictions = caseLines.filter((line) =>
    line && !docLines.some((docLine) => docLine.includes(line.slice(0, Math.min(line.length, 25))))
  );

  return contradictions.length
    ? contradictions.slice(0, 5).map((line) => `Case fact not clearly reflected in document: ${line}`)
    : [];
}

function analyzeDocument(payload = {}) {
  const documentText = String(payload.documentText || payload.rawText || "").trim();
  const caseFacts = String(payload.caseFacts || "").trim();
  const lines = normalizeLines(documentText);
  const documentType = inferDocumentType(documentText);
  const legalEntities = extractLegalEntities(documentText);
  const obligations = extractObligations(lines);
  const importantClauses = extractImportantClauses(lines, documentType);
  const importantClauseRefs = extractClauseObjects(lines, documentType);
  const risks = detectRisks(documentText, documentType);
  const missingPoints = detectMissingPoints(documentText, documentType);
  const suggestedArguments = buildSuggestedArguments(documentType, documentText);
  const legalIssues = mapFactsToLegalIssues(documentText, documentType);
  const contradictionsWithCase = caseFacts ? compareWithCaseFacts(documentText, caseFacts) : [];

  return {
    summary: lines.slice(0, 4).join(" ") || "Document text requires detailed legal review.",
    keyFacts: extractKeyFacts(lines),
    importantClauses,
    importantClauseRefs,
    risks,
    missingPoints,
    suggestedArguments,
    documentType,
    legalEntities,
    obligations,
    legalIssues,
    contradictionsWithCase
  };
}

function formatMemoSection(title, items = [], fallback = "") {
  if (Array.isArray(items) && items.length) {
    return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
  }
  if (fallback) {
    return `${title}\n${fallback}`;
  }
  return "";
}

function buildDocumentAnalysisMemo(analysis = {}, options = {}) {
  const matterLabel = String(options.matterLabel || "").trim();
  const clientLabel = String(options.clientLabel || "").trim();

  return [
    "DOCUMENT ANALYSIS MEMO",
    "",
    matterLabel || clientLabel
      ? `CLIENT / MATTER\n${[
          clientLabel ? `Client: ${clientLabel}` : "",
          matterLabel ? `Matter: ${matterLabel}` : ""
        ].filter(Boolean).join("\n")}`
      : "",
    analysis.summary ? `SUMMARY\n${analysis.summary}` : "",
    formatMemoSection("KEY FACTS", analysis.keyFacts, "No material factual points were extracted with confidence."),
    formatMemoSection("IMPORTANT CLAUSES", analysis.importantClauses, "No clause-level highlights were confidently extracted."),
    formatMemoSection("LEGAL ISSUES IDENTIFIED", analysis.legalIssues, "Issue mapping should be confirmed against the current pleading theory."),
    formatMemoSection("OBLIGATIONS", analysis.obligations, "No express obligation language was clearly detected."),
    formatMemoSection("RISKS", analysis.risks, "No immediate drafting risk was flagged from the available text."),
    formatMemoSection("MISSING POINTS", analysis.missingPoints, "No major structural omissions were detected from the available text."),
    formatMemoSection("CONTRADICTIONS WITH CASE", analysis.contradictionsWithCase, "No clear contradiction with the supplied case facts was detected."),
    formatMemoSection("SUGGESTED LEGAL STRATEGY", analysis.suggestedArguments, "Tie the extracted facts and clauses to the most defensible legal theory before use."),
    "",
    "Prepared for professional legal review. Verify statutory references, final facts, and court-specific drafting requirements before use."
  ].filter(Boolean).join("\n\n");
}

module.exports = {
  analyzeDocument,
  buildDocumentAnalysisMemo
};
