function normalizeIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeDocuments(documents = []) {
  return (Array.isArray(documents) ? documents : []).map((item) => {
    if (typeof item === "string") {
      return {
        title: item,
        content: item
      };
    }

    return {
      title: String(item?.title || item?.fileName || "").trim(),
      content: String(item?.content || item?.text || item?.summary || "").trim()
    };
  }).filter((item) => item.title || item.content);
}

function tokenizeIssue(issue = "") {
  return String(issue || "")
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.replace(/[^a-z0-9]/g, ""))
    .filter((item) => item.length > 3);
}

function matchesIssue(issue = "", text = "") {
  const tokens = tokenizeIssue(issue);
  const lowered = String(text || "").toLowerCase();
  if (!tokens.length) return false;
  return tokens.some((token) => lowered.includes(token));
}

function deriveCoverageStatus(parts = []) {
  const yesCount = parts.filter(Boolean).length;
  if (yesCount >= 4) return "STRONG";
  if (yesCount >= 2) return "PARTIAL";
  return "WEAK";
}

function analyzeEvidenceCoverage(input = {}) {
  const issues = normalizeIssues(input.issues);
  const facts = String(input.facts || "").trim();
  const draftText = String(input.draftText || "").trim();
  const documents = normalizeDocuments(input.documents);
  const selectedCases = Array.isArray(input.selectedCases) ? input.selectedCases : [];
  const riskAnalysis = Array.isArray(input.caseStrength?.riskAnalysis) ? input.caseStrength.riskAnalysis : [];
  const argumentSections = [
    ...((input.argumentOutput?.petitionerArguments || [])),
    ...((input.argumentOutput?.respondentArguments || []))
  ];

  const sourceIssues = issues.length ? issues : ["General matter coverage"];

  const matrix = sourceIssues.map((issue) => {
    const issueFacts = matchesIssue(issue, facts);
    const issueDocs = documents.filter((item) => matchesIssue(issue, `${item.title} ${item.content}`));
    const issueAuthorities = selectedCases.filter((item) => matchesIssue(issue, `${item.title || ""} ${item.summary || ""} ${item.ratioNote || ""} ${(item.issueTags || []).join(" ")}`));
    const issueArguments = argumentSections.filter((section) => matchesIssue(issue, `${section.issue || ""} ${(section.arguments || []).map((entry) => `${entry.title || ""} ${entry.reasoning || ""}`).join(" ")}`));
    const issueRisks = riskAnalysis.filter((item) => matchesIssue(issue, item));
    const issueDraftSupport = matchesIssue(issue, draftText);

    const coverageStatus = deriveCoverageStatus([
      issueFacts,
      issueDocs.length > 0,
      issueAuthorities.length > 0,
      issueArguments.length > 0,
      issueDraftSupport
    ]);

    return {
      issue,
      coverageStatus,
      factSupport: issueFacts ? "YES" : "NO",
      documentSupport: issueDocs.length ? "YES" : "NO",
      authoritySupport: issueAuthorities.length ? "YES" : "NO",
      argumentSupport: issueArguments.length ? "YES" : "NO",
      draftSupport: issueDraftSupport ? "YES" : "NO",
      riskReviewed: issueRisks.length ? "YES" : "NO",
      matchedDocuments: issueDocs.slice(0, 3).map((item) => item.title || "Document"),
      matchedAuthorities: issueAuthorities.slice(0, 3).map((item) => item.title || item.citation || "Authority"),
      notes: [
        issueFacts ? "Facts mention this issue." : "Facts do not clearly cover this issue.",
        issueDocs.length ? `Documents support this issue: ${issueDocs.slice(0, 2).map((item) => item.title || "Document").join(", ")}.` : "No document support is clearly mapped to this issue.",
        issueAuthorities.length ? `Authorities mapped: ${issueAuthorities.slice(0, 2).map((item) => item.title || item.citation || "Authority").join(", ")}.` : "Authority support is thin or not mapped issue-wise.",
        issueArguments.length ? "Arguments are already built around this issue." : "Arguments are not yet clearly developed for this issue.",
        issueRisks.length ? "Risk review exists for this issue." : "Risk review should be added for this issue.",
        issueDraftSupport ? "Draft text reflects this issue." : "Current draft does not clearly reflect this issue."
      ].filter(Boolean)
    };
  });

  const strongCount = matrix.filter((item) => item.coverageStatus === "STRONG").length;
  const weakCount = matrix.filter((item) => item.coverageStatus === "WEAK").length;
  const overallScore = Math.max(0, Math.min(100, Math.round(
    matrix.length
      ? matrix.reduce((sum, item) => sum + (item.coverageStatus === "STRONG" ? 100 : item.coverageStatus === "PARTIAL" ? 60 : 25), 0) / matrix.length
      : 35
  )));

  return {
    overallScore,
    coverageLevel: overallScore >= 75 ? "WELL COVERED" : overallScore >= 50 ? "PARTIAL COVERAGE" : "GAP HEAVY",
    summary: overallScore >= 75
      ? "Most issues have facts, materials, and authority support aligned."
      : overallScore >= 50
        ? "Some issues are covered well, but several still need evidence, authority, or draft support."
        : "Multiple issues remain under-supported and should be strengthened before filing or final advice.",
    matrix,
    gaps: matrix
      .filter((item) => item.coverageStatus !== "STRONG")
      .map((item) => `${item.issue}: facts=${item.factSupport}, docs=${item.documentSupport}, authority=${item.authoritySupport}, draft=${item.draftSupport}`)
      .slice(0, 8),
    suggestions: matrix
      .filter((item) => item.coverageStatus !== "STRONG")
      .flatMap((item) => {
        const suggestions = [];
        if (item.documentSupport === "NO") suggestions.push(`Add document support for issue: ${item.issue}.`);
        if (item.authoritySupport === "NO") suggestions.push(`Map at least one strong authority to issue: ${item.issue}.`);
        if (item.draftSupport === "NO") suggestions.push(`Ensure the draft expressly addresses issue: ${item.issue}.`);
        if (item.riskReviewed === "NO") suggestions.push(`Add opponent-risk analysis for issue: ${item.issue}.`);
        return suggestions;
      })
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 10),
    stats: {
      issueCount: matrix.length,
      strongCount,
      weakCount
    }
  };
}

module.exports = {
  analyzeEvidenceCoverage
};
