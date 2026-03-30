const { getCaseValidity } = require("./validityEngine");

function normalizeSelectedCases(selectedCases = []) {
  return (Array.isArray(selectedCases) ? selectedCases : [])
    .map((item) => ({
      caseId: String(item.caseId || item.canonicalCaseId || item.id || "").trim(),
      canonicalCaseId: String(item.canonicalCaseId || item.caseId || item.id || "").trim(),
      title: String(item.title || "").trim(),
      citation: String(item.citation || "").trim(),
      court: String(item.court || "").trim()
    }))
    .filter((item) => item.caseId || item.title || item.citation);
}

async function evaluateAuthorityGuardrails(admin, selectedCases = []) {
  const normalizedCases = normalizeSelectedCases(selectedCases);
  const evaluations = await Promise.all(normalizedCases.map(async (item) => {
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

  const blockingAuthorities = evaluations.filter((item) => item.validity?.status === "BAD LAW");
  const cautionAuthorities = evaluations.filter((item) => item.validity?.status === "CAUTION");

  return {
    status: blockingAuthorities.length ? "BLOCK" : cautionAuthorities.length ? "WARN" : "CLEAR",
    blockingWarnings: blockingAuthorities.map((item) => `Do not rely on ${item.title || item.citation || "this authority"} because it is flagged as bad law.`),
    cautionWarnings: cautionAuthorities.map((item) => `Use ${item.title || item.citation || "this authority"} cautiously and verify the exact proposition before final reliance.`),
    reviewedAuthorities: evaluations.map((item) => ({
      caseId: item.caseId || item.canonicalCaseId,
      title: item.title,
      citation: item.citation,
      status: item.validity?.status || "CAUTION",
      riskLevel: item.validity?.riskLevel || "MEDIUM",
      confidenceScore: item.validity?.confidenceScore || 0,
      summary: item.validity?.summary || ""
    }))
  };
}

module.exports = {
  evaluateAuthorityGuardrails
};
