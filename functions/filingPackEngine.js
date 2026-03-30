const { analyzeFilingReadiness } = require("./readinessEngine");
const { analyzeMatterContradictions } = require("./contradictionEngine");
const { analyzeEvidenceCoverage } = require("./coverageMatrixEngine");
const { analyzeDraftValidation } = require("./draftValidationEngine");
const { getCaseValidity } = require("./validityEngine");

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

async function evaluateAuthorityFreshness(admin, selectedCases = []) {
  const source = Array.isArray(selectedCases) ? selectedCases : [];
  const results = await Promise.all(source.slice(0, 8).map(async (item) => {
    try {
      return await getCaseValidity(admin, {
        canonicalCaseId: item.canonicalCaseId,
        title: item.title,
        citation: item.citation,
        court: item.court
      });
    } catch {
      return null;
    }
  }));

  const valid = results.filter(Boolean);
  const staleCount = valid.filter((item) => item.freshness?.verificationFreshness === "stale").length;
  const badLawCount = valid.filter((item) => item.status === "BAD LAW").length;

  return {
    score: clampScore(valid.length ? 100 - (staleCount * 18) - (badLawCount * 30) : 35),
    staleAuthorities: valid.filter((item) => item.freshness?.verificationFreshness === "stale").map((item) => item.canonicalCaseId || item.requestedCaseId),
    badAuthorities: valid.filter((item) => item.status === "BAD LAW").map((item) => item.canonicalCaseId || item.requestedCaseId),
    authorityChecks: valid
  };
}

async function analyzeFinalFilingPack(admin, input = {}) {
  const facts = String(input.facts || "").trim();
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const draftText = String(input.draftText || "").trim();
  const draftType = String(input.draftType || "").trim().toLowerCase();
  const courtType = String(input.courtType || input.court || "").trim();
  const selectedCases = Array.isArray(input.selectedCases) ? input.selectedCases : [];

  const [readiness, consistency, coverage, draftValidation, authorityFreshness] = await Promise.all([
    analyzeFilingReadiness(admin, input),
    Promise.resolve(analyzeMatterContradictions(input)),
    Promise.resolve(analyzeEvidenceCoverage({
      facts,
      issues,
      documents,
      draftText,
      selectedCases,
      caseStrength: input.caseStrength || null,
      argumentOutput: input.argumentOutput || null
    })),
    Promise.resolve(analyzeDraftValidation({ draftText, draftType, courtType })),
    evaluateAuthorityFreshness(admin, selectedCases)
  ]);

  const filingScore = clampScore(
    (Number(readiness.readinessScore || 0) * 0.28) +
    (Number(consistency.consistencyScore || 0) * 0.2) +
    (Number(coverage.overallScore || 0) * 0.2) +
    (Number(draftValidation.validationScore || 0) * 0.22) +
    (Number(authorityFreshness.score || 0) * 0.1)
  );

  const blockers = [
    ...(readiness.missingItems || []).slice(0, 5).map((item) => `Readiness blocker: ${item}`),
    ...(consistency.contradictions || []).slice(0, 4).map((item) => `Consistency blocker: ${item}`),
    ...(draftValidation.criticalIssues || []).slice(0, 4).map((item) => `Draft blocker: ${item}`),
    ...(authorityFreshness.badAuthorities || []).slice(0, 4).map((item) => `Authority blocker: ${item} is flagged as bad law.`)
  ].filter((item, index, list) => list.indexOf(item) === index);

  const warnings = [
    ...(coverage.gaps || []).slice(0, 5).map((item) => `Coverage warning: ${item}`),
    ...(authorityFreshness.staleAuthorities || []).slice(0, 4).map((item) => `Authority freshness warning: ${item} should be rechecked before filing.`),
    ...(readiness.criticalRisks || []).slice(0, 4)
  ].filter((item, index, list) => list.indexOf(item) === index);

  const recommendations = [
    ...(readiness.nextSteps || []).slice(0, 5),
    ...(consistency.suggestions || []).slice(0, 5),
    ...(coverage.suggestions || []).slice(0, 5),
    ...(draftValidation.suggestions || []).slice(0, 5)
  ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 12);

  return {
    filingScore,
    filingDecision: blockers.length
      ? "HOLD"
      : filingScore >= 80
        ? "READY TO FILE"
        : filingScore >= 60
          ? "REVIEW BEFORE FILING"
          : "NOT READY",
    summary: blockers.length
      ? "The filing pack still has blocking issues that should be resolved before filing."
      : filingScore >= 80
        ? "The filing pack appears substantially ready, subject to final lawyer sign-off."
        : "The filing pack is usable for review, but still needs targeted correction before filing.",
    blockers,
    warnings,
    recommendations,
    componentScores: {
      readiness: readiness.readinessScore || 0,
      consistency: consistency.consistencyScore || 0,
      coverage: coverage.overallScore || 0,
      draftValidation: draftValidation.validationScore || 0,
      authorityFreshness: authorityFreshness.score || 0
    },
    readiness,
    consistency,
    coverage,
    draftValidation,
    authorityFreshness
  };
}

module.exports = {
  analyzeFinalFilingPack
};
