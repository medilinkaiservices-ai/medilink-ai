const { analyzeCaseStrength } = require("./strengthEngine");
const { buildArgumentSet } = require("./argumentEngine");
const { analyzeDocument } = require("./documentAnalyzerEngine");

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function normalizeIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeAuthorities(authorities = []) {
  return (Array.isArray(authorities) ? authorities : [])
    .map((item) => ({
      caseId: String(item.caseId || item.canonicalCaseId || item.id || "").trim(),
      title: String(item.title || "").trim(),
      citation: String(item.citation || "").trim(),
      status: String(item.status || item.validityStatus || "").trim(),
      riskLevel: String(item.riskLevel || "").trim(),
      confidenceScore: Number(item.confidenceScore || 0)
    }))
    .filter((item) => item.caseId || item.title || item.citation);
}

function deriveEvidenceScore(strengthResult = {}, documentAnalysis = {}) {
  let score = Number(strengthResult.scoreBreakdown?.evidenceStrength || 25);
  const keyFactors = [];
  const weaknesses = [];

  if (documentAnalysis.keyFacts?.length) {
    score += 10;
    keyFactors.push("Document analysis extracted concrete factual anchors.");
  }

  if (documentAnalysis.obligations?.length) {
    score += 8;
    keyFactors.push("Document text contains obligation language that can support enforcement.");
  }

  if ((strengthResult.missingEvidence || []).length) {
    score -= Math.min(25, strengthResult.missingEvidence.length * 7);
    weaknesses.push(...strengthResult.missingEvidence.map((item) => `Missing evidence reduces predictability: ${item}.`));
  }

  if ((documentAnalysis.missingPoints || []).length) {
    score -= Math.min(15, documentAnalysis.missingPoints.length * 4);
    weaknesses.push(...documentAnalysis.missingPoints.map((item) => `Document gap affects evidentiary position: ${item}.`));
  }

  return {
    score: clampScore(score),
    keyFactors,
    weaknesses
  };
}

function deriveAuthorityScore(strengthResult = {}, authorities = []) {
  const review = authorities.length ? authorities : (strengthResult.authorityReview || []);
  if (!review.length) {
    return {
      score: 30,
      keyFactors: [],
      weaknesses: ["No meaningful authority set was supplied for prediction."],
      strengths: []
    };
  }

  let score = 0;
  const keyFactors = [];
  const strengths = [];
  const weaknesses = [];

  review.forEach((item) => {
    const status = String(item.status || "").toUpperCase();
    if (status === "GOOD LAW") {
      score += 24;
      strengths.push(`Good-law authority supports the matter: ${item.title || item.citation}.`);
    } else if (status === "BAD LAW") {
      score -= 26;
      weaknesses.push(`Bad-law authority weakens outcome confidence: ${item.title || item.citation}.`);
    } else {
      score += 10;
      keyFactors.push(`Authority requires caution review: ${item.title || item.citation}.`);
    }
  });

  return {
    score: clampScore(score),
    keyFactors,
    strengths,
    weaknesses
  };
}

function deriveConsistencyScore(facts = "", documentAnalysis = {}, strengthResult = {}) {
  let score = Number(strengthResult.scoreBreakdown?.consistency || 25);
  const keyFactors = [];
  const weaknesses = [];
  const factText = String(facts || "");

  if (factText.length > 160) {
    score += 10;
    keyFactors.push("Fact narrative is developed enough for issue-level prediction.");
  }

  if (documentAnalysis.contradictionsWithCase?.length) {
    score -= Math.min(30, documentAnalysis.contradictionsWithCase.length * 8);
    weaknesses.push(...documentAnalysis.contradictionsWithCase.map((item) => `Fact/document mismatch flagged: ${item}`));
  }

  if (/unknown|unclear|maybe|perhaps|not sure/i.test(factText)) {
    score -= 12;
    weaknesses.push("Uncertain factual narration reduces prediction confidence.");
  }

  return {
    score: clampScore(score),
    keyFactors,
    weaknesses
  };
}

function deriveRiskPenalty(strengthResult = {}, argumentSet = {}, documentAnalysis = {}) {
  const riskItems = [
    ...(strengthResult.riskAnalysis || []),
    ...(documentAnalysis.risks || []),
    ...(argumentSet.warnings || [])
  ].filter(Boolean);

  const penalty = Math.min(35, riskItems.length * 5);

  return {
    score: clampScore(100 - penalty),
    riskItems
  };
}

function deriveConfidenceScore(componentScores = [], facts = "", authorities = []) {
  let score = componentScores.length
    ? componentScores.reduce((sum, item) => sum + Number(item || 0), 0) / componentScores.length
    : 35;

  if (String(facts || "").trim().length < 80) {
    score -= 10;
  }
  if (!authorities.length) {
    score -= 8;
  }

  return clampScore(score);
}

function deriveRiskLevel(winProbability) {
  if (winProbability >= 70) return "LOW";
  if (winProbability >= 45) return "MEDIUM";
  return "HIGH";
}

async function predictCaseOutcome(admin, input = {}) {
  const facts = String(input.facts || "").trim();
  const issues = normalizeIssues(input.issues);
  const documentAnalysis = input.documentAnalysis && typeof input.documentAnalysis === "object"
    ? input.documentAnalysis
    : analyzeDocument({
        documentText: String(input.documentText || "").trim(),
        caseFacts: facts
      });

  const strengthResult = input.caseStrength && typeof input.caseStrength === "object"
    ? input.caseStrength
    : await analyzeCaseStrength(admin, {
        matterId: String(input.matterId || "").trim(),
        facts,
        issues,
        documents: Array.isArray(input.documents) ? input.documents : [],
        selectedCases: Array.isArray(input.authorities) ? input.authorities : [],
        jurisdiction: String(input.jurisdiction || "").trim()
      });

  const argumentSet = input.arguments && typeof input.arguments === "object"
    ? input.arguments
    : await buildArgumentSet(admin, {
        matterId: String(input.matterId || "").trim(),
        facts,
        issues,
        jurisdiction: String(input.jurisdiction || "").trim(),
        selectedCases: Array.isArray(input.authorities) ? input.authorities : [],
        mode: "court-ready"
      }).catch(() => ({ warnings: [], petitionerArguments: [], respondentArguments: [] }));

  const normalizedAuthorities = normalizeAuthorities(input.authorities || strengthResult.authorityReview || argumentSet.authorityReview || []);
  const evidenceFit = deriveEvidenceScore(strengthResult, documentAnalysis);
  const authorityFit = deriveAuthorityScore(strengthResult, normalizedAuthorities);
  const consistencyFit = deriveConsistencyScore(facts, documentAnalysis, strengthResult);
  const riskFit = deriveRiskPenalty(strengthResult, argumentSet, documentAnalysis);

  const winProbability = clampScore(
    (evidenceFit.score * 0.4) +
    (authorityFit.score * 0.25) +
    (consistencyFit.score * 0.2) +
    (riskFit.score * 0.15)
  );

  const strengths = [
    ...(strengthResult.strengths || []),
    ...authorityFit.strengths
  ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 8);

  const weaknesses = [
    ...(strengthResult.weaknesses || []),
    ...evidenceFit.weaknesses,
    ...authorityFit.weaknesses,
    ...consistencyFit.weaknesses
  ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 10);

  const keyFactors = [
    ...evidenceFit.keyFactors,
    ...authorityFit.keyFactors,
    ...consistencyFit.keyFactors,
    ...(strengthResult.riskAnalysis || []).slice(0, 2)
  ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 8);

  const improvementSuggestions = [
    ...(strengthResult.suggestions || []),
    ...((documentAnalysis.missingPoints || []).map((item) => `Address the document gap: ${item}.`)),
    ...(riskFit.riskItems.slice(0, 3).map((item) => `Mitigate risk proactively: ${item}`))
  ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 10);

  return {
    winProbability,
    riskLevel: deriveRiskLevel(winProbability),
    confidenceScore: deriveConfidenceScore(
      [evidenceFit.score, authorityFit.score, consistencyFit.score, riskFit.score],
      facts,
      normalizedAuthorities
    ),
    keyFactors,
    strengths,
    weaknesses,
    improvementSuggestions,
    scoreBreakdown: {
      evidenceStrength: evidenceFit.score,
      authorityQuality: authorityFit.score,
      consistency: consistencyFit.score,
      riskPenaltyAdjusted: riskFit.score
    }
  };
}

module.exports = {
  predictCaseOutcome
};
