const { getCaseValidity } = require("./validityEngine");

function normalizeIssueList(issues = []) {
  return (Array.isArray(issues) ? issues : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeSelectedCases(selectedCases = []) {
  return (Array.isArray(selectedCases) ? selectedCases : [])
    .map((item) => ({
      id: String(item.id || "").trim(),
      canonicalCaseId: String(item.canonicalCaseId || "").trim(),
      title: String(item.title || "").trim(),
      citation: String(item.citation || "").trim(),
      court: String(item.court || "").trim(),
      judgmentDate: String(item.judgmentDate || "").trim(),
      summary: String(item.summary || "").trim(),
      ratioNote: String(item.ratioNote || item.whyItMatters || "").trim(),
      issueTags: Array.isArray(item.issueTags) ? item.issueTags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
      treatmentStatus: String(item.treatmentStatus || item.status || "").trim()
    }))
    .filter((item) => item.title || item.citation || item.canonicalCaseId);
}

function pickIssueCases(issue, selectedCases = []) {
  const needle = String(issue || "").toLowerCase();
  const matched = selectedCases.filter((item) => {
    const haystack = [
      item.title,
      item.summary,
      item.ratioNote,
      item.citation,
      ...(item.issueTags || [])
    ].join(" ").toLowerCase();
    return needle && haystack.includes(needle);
  });

  return matched.length ? matched : selectedCases.slice(0, 4);
}

function buildAuthorityWarning(caseItem) {
  const validity = caseItem.validity || {};
  if (validity.status === "BAD LAW") {
    return `Avoid relying on ${caseItem.title || caseItem.citation || "this authority"} because it is flagged as bad law.`;
  }
  if (validity.status === "CAUTION") {
    return `Use ${caseItem.title || caseItem.citation || "this authority"} cautiously and verify the exact proposition before final reliance.`;
  }
  return "";
}

function filterUsableCases(selectedCases = []) {
  const usableCases = selectedCases.filter((item) => item.validity?.status !== "BAD LAW");
  const warnings = selectedCases
    .filter((item) => item.validity?.status !== "GOOD LAW")
    .map((item) => buildAuthorityWarning(item))
    .filter(Boolean);

  return { usableCases, warnings };
}

function buildArgumentTitle(issue, side, index) {
  const prefix = side === "petitioner" ? "Petitioner" : "Respondent";
  return `${prefix} Argument ${index + 1}: ${issue}`;
}

function buildLegalBasis(issue, jurisdiction, cases = []) {
  const citations = cases
    .slice(0, 2)
    .map((item) => item.citation || item.title)
    .filter(Boolean)
    .join("; ");

  return [
    jurisdiction ? `${jurisdiction} jurisdiction principles` : "Applicable legal principles",
    issue ? `Issue focus: ${issue}` : "",
    citations ? `Authorities: ${citations}` : ""
  ].filter(Boolean).join(" | ");
}

function buildReasoning({ side, facts, issue, caseItem, mode }) {
  const concise = String(mode || "detailed").toLowerCase() === "court-ready";
  const sideFrame = side === "petitioner"
    ? "The petitioner can align the pleaded facts with the governing principle"
    : "The respondent can resist relief by narrowing the factual and legal fit";

  const ratioLine = caseItem?.ratioNote || caseItem?.summary || "The selected authority supplies a relevant principle, but its exact ratio should be verified from the full text.";
  const factLine = String(facts || "").trim() || "Material facts should be mapped issue-wise from the matter record.";

  if (concise) {
    return `${sideFrame} on ${issue}. ${ratioLine} Facts to stress: ${factLine.slice(0, 220)}.`;
  }

  return `${sideFrame} on the issue of ${issue} by relying on ${caseItem?.title || caseItem?.citation || "the selected authority"}. ${ratioLine} The factual bridge should be stated expressly: ${factLine}. The final submission should show why the principle applies to this record and why the opposing reading is weaker on law or fact.`;
}

function buildRiskNote(side, caseItem, warnings = []) {
  const caseWarning = buildAuthorityWarning(caseItem);
  if (caseWarning) return caseWarning;
  if (warnings.length) return warnings[0];
  return side === "petitioner"
    ? "Check maintainability, factual proof, and whether the cited proposition is still current."
    : "Check whether the petitioner has stronger later authority or a better factual fit on the same point.";
}

function buildIssueArguments({ issue, side, facts, jurisdiction, cases, warnings, mode }) {
  const preferredCases = cases
    .slice()
    .sort((a, b) => {
      const aScore = a.validity?.status === "GOOD LAW" ? 2 : a.validity?.status === "CAUTION" ? 1 : 0;
      const bScore = b.validity?.status === "GOOD LAW" ? 2 : b.validity?.status === "CAUTION" ? 1 : 0;
      return bScore - aScore;
    })
    .slice(0, 3);

  return preferredCases.map((caseItem, index) => ({
    title: buildArgumentTitle(issue, side, index),
    legalBasis: buildLegalBasis(issue, jurisdiction, preferredCases),
    caseReferences: preferredCases.map((item) => ({
      caseId: item.canonicalCaseId || item.id || "",
      title: item.title || "",
      citation: item.citation || "",
      validityStatus: item.validity?.status || "CAUTION",
      riskLevel: item.validity?.riskLevel || "MEDIUM"
    })),
    reasoning: buildReasoning({ side, facts, issue, caseItem, mode }),
    riskNote: buildRiskNote(side, caseItem, warnings)
  }));
}

async function enrichCasesWithValidity(admin, selectedCases = []) {
  return Promise.all(selectedCases.map(async (item) => {
    const validity = await getCaseValidity(admin, {
      canonicalCaseId: item.canonicalCaseId,
      title: item.title,
      citation: item.citation,
      court: item.court
    }).catch(() => ({
      status: "CAUTION",
      riskLevel: "MEDIUM",
      confidenceScore: 35,
      summary: "Validity could not be verified automatically."
    }));

    return {
      ...item,
      validity
    };
  }));
}

async function buildArgumentSet(admin, input = {}) {
  const issues = normalizeIssueList(input.issues);
  const selectedCases = normalizeSelectedCases(input.selectedCases);
  const facts = String(input.facts || "").trim();
  const jurisdiction = String(input.jurisdiction || "").trim();
  const matterId = String(input.matterId || "").trim();
  const mode = String(input.mode || "detailed").trim() || "detailed";

  const casesWithValidity = await enrichCasesWithValidity(admin, selectedCases);
  const { usableCases, warnings } = filterUsableCases(casesWithValidity);

  const issueSource = issues.length
    ? issues
    : ["Issue framing pending. Confirm the live dispute issues before final filing."];

  const petitionerArguments = issueSource.map((issue) => {
    const issueCases = pickIssueCases(issue, usableCases);
    return {
      issue,
      side: "petitioner",
      arguments: buildIssueArguments({
        issue,
        side: "petitioner",
        facts,
        jurisdiction,
        cases: issueCases,
        warnings,
        mode
      })
    };
  });

  const respondentArguments = issueSource.map((issue) => {
    const issueCases = pickIssueCases(issue, usableCases);
    return {
      issue,
      side: "respondent",
      arguments: buildIssueArguments({
        issue,
        side: "respondent",
        facts,
        jurisdiction,
        cases: issueCases,
        warnings,
        mode
      })
    };
  });

  return {
    matterId,
    mode,
    warnings,
    authorityReview: casesWithValidity.map((item) => ({
      caseId: item.canonicalCaseId || item.id || "",
      title: item.title || "",
      citation: item.citation || "",
      status: item.validity?.status || "CAUTION",
      riskLevel: item.validity?.riskLevel || "MEDIUM",
      confidenceScore: item.validity?.confidenceScore || 0
    })),
    petitionerArguments,
    respondentArguments
  };
}

module.exports = {
  buildArgumentSet,
  normalizeIssueList,
  normalizeSelectedCases
};
