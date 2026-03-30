const { getCaseValidity } = require("./validityEngine");
const { buildArgumentSet } = require("./argumentEngine");

function normalizeDocuments(documents = []) {
  return (Array.isArray(documents) ? documents : [])
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `doc-${index}`,
          title: item.trim(),
          content: item.trim(),
          type: "text"
        };
      }

      return {
        id: String(item?.id || `doc-${index}`).trim(),
        title: String(item?.title || item?.fileName || "").trim(),
        content: String(item?.content || item?.text || item?.summary || "").trim(),
        type: String(item?.type || item?.mimeType || "text").trim()
      };
    })
    .filter((item) => item.title || item.content);
}

function normalizeIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeSelectedCases(selectedCases = []) {
  return (Array.isArray(selectedCases) ? selectedCases : [])
    .map((item) => ({
      id: String(item.id || "").trim(),
      canonicalCaseId: String(item.canonicalCaseId || "").trim(),
      title: String(item.title || "").trim(),
      citation: String(item.citation || "").trim(),
      summary: String(item.summary || "").trim(),
      ratioNote: String(item.ratioNote || item.whyItMatters || "").trim(),
      issueTags: Array.isArray(item.issueTags) ? item.issueTags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
      court: String(item.court || "").trim()
    }))
    .filter((item) => item.title || item.citation || item.canonicalCaseId);
}

function scoreAuthorityFit(cases = []) {
  if (!cases.length) {
    return {
      score: 30,
      strengths: [],
      weaknesses: ["No selected authorities were provided."],
      warnings: ["Add at least one supporting precedent to improve authority strength."]
    };
  }

  let score = 0;
  const strengths = [];
  const weaknesses = [];
  const warnings = [];

  cases.forEach((item) => {
    const status = item.validity?.status || "CAUTION";
    if (status === "GOOD LAW") {
      score += 22;
      strengths.push(`Good-law authority available: ${item.title || item.citation}.`);
    } else if (status === "CAUTION") {
      score += 10;
      warnings.push(`Authority requires caution check: ${item.title || item.citation}.`);
    } else {
      score -= 25;
      weaknesses.push(`Bad-law authority weakens the case set: ${item.title || item.citation}.`);
    }
  });

  return {
    score: Math.max(0, Math.min(100, score)),
    strengths,
    weaknesses,
    warnings
  };
}

function scoreEvidenceStrength(facts, issues = [], documents = []) {
  const factText = String(facts || "").toLowerCase();
  const documentText = documents.map((item) => `${item.title} ${item.content}`).join(" ").toLowerCase();
  const issueNeedles = issues.map((item) => item.toLowerCase()).filter(Boolean);

  let score = documents.length ? 55 : 25;
  const strengths = [];
  const weaknesses = [];
  const missingEvidence = [];

  if (!documents.length) {
    weaknesses.push("No supporting documents were provided.");
    missingEvidence.push("Primary documentary support");
  }

  const evidenceHints = [
    { needle: "agreement", label: "written agreement" },
    { needle: "payment", label: "payment proof" },
    { needle: "notice", label: "legal notice / reply proof" },
    { needle: "email", label: "email or message trail" },
    { needle: "invoice", label: "invoice / bill records" },
    { needle: "ownership", label: "title or ownership documents" }
  ];

  evidenceHints.forEach((item) => {
    const relevant = factText.includes(item.needle) || issueNeedles.some((issue) => issue.includes(item.needle));
    if (!relevant) return;

    if (documentText.includes(item.needle)) {
      score += 8;
      strengths.push(`Document support appears available for ${item.label}.`);
    } else {
      score -= 8;
      weaknesses.push(`Document support is missing for ${item.label}.`);
      missingEvidence.push(item.label);
    }
  });

  return {
    score: Math.max(0, Math.min(100, score)),
    strengths,
    weaknesses,
    missingEvidence: missingEvidence.filter((item, index, list) => list.indexOf(item) === index)
  };
}

function scoreConsistency(facts = "") {
  const text = String(facts || "").trim();
  const lowered = text.toLowerCase();
  let score = text.length > 120 ? 65 : 35;
  const weaknesses = [];
  const strengths = [];

  if (!text) {
    return {
      score: 15,
      strengths: [],
      weaknesses: ["Facts are incomplete or missing."],
      warnings: ["Complete the fact matrix before relying on the strength score."]
    };
  }

  if (/(unknown|maybe|perhaps|not sure|unclear)/i.test(text)) {
    score -= 18;
    weaknesses.push("Narrative contains uncertainty markers that weaken factual confidence.");
  } else {
    strengths.push("Fact narrative appears sufficiently specific for initial legal analysis.");
  }

  if (/however.{0,20}however/i.test(lowered) || /but.{0,20}but/i.test(lowered)) {
    score -= 12;
    weaknesses.push("Possible internal inconsistency or repetitive qualification detected in the facts.");
  }

  if (/\d{4}-\d{2}-\d{2}/.test(text)) {
    score += 10;
    strengths.push("Chronology markers are present in the fact narrative.");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    strengths,
    weaknesses,
    warnings: []
  };
}

function buildRiskFactors({ facts, issues = [], argumentSet }) {
  const text = String(facts || "").toLowerCase();
  const risks = [];
  const suggestions = [];

  if (!text) {
    risks.push("Incomplete facts may lead to weak pleadings or poor issue framing.");
    suggestions.push("Finalize a clear chronology and fact statement.");
  }

  if (/delay|late|years later|after long time/i.test(facts || "")) {
    risks.push("Delay or limitation objections may weaken relief.");
    suggestions.push("Explain delay clearly and collect documents showing continuing cause or justified delay.");
  }

  if (/oral|verbal/i.test(text)) {
    risks.push("An oral arrangement may be challenged for lack of documentary proof.");
    suggestions.push("Collect corroborative communication, witnesses, or conduct-based evidence.");
  }

  issues.forEach((issue) => {
    if (/jurisdiction/i.test(issue)) {
      risks.push("Jurisdiction objections may arise at the threshold.");
      suggestions.push("Confirm territorial and subject-matter jurisdiction before filing.");
    }
    if (/injunction|interim/i.test(issue)) {
      risks.push("Interim relief may fail without urgency and balance-of-convenience proof.");
      suggestions.push("Collect urgency documents and immediate-prejudice material.");
    }
  });

  const respondentIssues = (argumentSet?.respondentArguments || []).flatMap((section) =>
    (section.arguments || []).map((item) => item.riskNote).filter(Boolean)
  );
  risks.push(...respondentIssues.slice(0, 3));

  return {
    risks: risks.filter((item, index, list) => list.indexOf(item) === index),
    suggestions: suggestions.filter((item, index, list) => list.indexOf(item) === index)
  };
}

function getStrengthLevel(score) {
  if (score >= 70) return "STRONG";
  if (score >= 45) return "MODERATE";
  return "WEAK";
}

function getWinProbability(score) {
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

async function enrichCasesWithValidity(admin, selectedCases = []) {
  return Promise.all(selectedCases.map(async (item) => ({
    ...item,
    validity: await getCaseValidity(admin, {
      canonicalCaseId: item.canonicalCaseId,
      title: item.title,
      citation: item.citation,
      court: item.court
    }).catch(() => ({
      status: "CAUTION",
      riskLevel: "MEDIUM",
      confidenceScore: 35,
      summary: "Validity could not be verified automatically."
    }))
  })));
}

async function analyzeCaseStrength(admin, input = {}) {
  const matterId = String(input.matterId || "").trim();
  const facts = String(input.facts || "").trim();
  const issues = normalizeIssues(input.issues);
  const documents = normalizeDocuments(input.documents);
  const jurisdiction = String(input.jurisdiction || "").trim();
  const selectedCases = normalizeSelectedCases(input.selectedCases);
  const casesWithValidity = await enrichCasesWithValidity(admin, selectedCases);

  const authorityFit = scoreAuthorityFit(casesWithValidity);
  const evidenceFit = scoreEvidenceStrength(facts, issues, documents);
  const consistencyFit = scoreConsistency(facts);
  const argumentSet = await buildArgumentSet(admin, {
    matterId,
    facts,
    issues,
    jurisdiction,
    selectedCases: casesWithValidity,
    mode: "court-ready"
  }).catch(() => ({ petitionerArguments: [], respondentArguments: [], warnings: [] }));
  const riskFactors = buildRiskFactors({ facts, issues, argumentSet });

  const overallScore = Math.max(0, Math.min(100, Math.round(
    (authorityFit.score * 0.35) +
    (evidenceFit.score * 0.35) +
    (consistencyFit.score * 0.2) +
    (riskFactors.risks.length ? Math.max(10, 25 - (riskFactors.risks.length * 3)) : 10)
  )));

  return {
    matterId,
    overallScore,
    strengthLevel: getStrengthLevel(overallScore),
    winProbability: getWinProbability(overallScore),
    scoreBreakdown: {
      authorityFit: authorityFit.score,
      evidenceStrength: evidenceFit.score,
      consistency: consistencyFit.score
    },
    strengths: [
      ...authorityFit.strengths,
      ...evidenceFit.strengths,
      ...consistencyFit.strengths
    ].filter((item, index, list) => list.indexOf(item) === index),
    weaknesses: [
      ...authorityFit.weaknesses,
      ...evidenceFit.weaknesses,
      ...consistencyFit.weaknesses
    ].filter((item, index, list) => list.indexOf(item) === index),
    missingEvidence: evidenceFit.missingEvidence,
    riskAnalysis: riskFactors.risks,
    suggestions: [
      ...authorityFit.warnings,
      ...consistencyFit.warnings,
      ...riskFactors.suggestions
    ].filter((item, index, list) => list.indexOf(item) === index),
    authorityReview: casesWithValidity.map((item) => ({
      caseId: item.canonicalCaseId || item.id || "",
      title: item.title || "",
      citation: item.citation || "",
      status: item.validity?.status || "CAUTION",
      riskLevel: item.validity?.riskLevel || "MEDIUM",
      confidenceScore: item.validity?.confidenceScore || 0
    }))
  };
}

module.exports = {
  analyzeCaseStrength
};
