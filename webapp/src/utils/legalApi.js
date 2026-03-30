const LEGAL_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalAssistant",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalAssistant"
];

const CASE_VALIDITY_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalCaseValidity",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalCaseValidity"
];

const CASE_CITATIONS_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalCaseCitations",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalCaseCitations"
];

const ARGUMENT_BUILDER_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalArgumentBuilder",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalArgumentBuilder"
];

const CASE_STRENGTH_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalCaseStrength",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalCaseStrength"
];

const CASE_PREDICTION_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalCasePrediction",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalCasePrediction"
];

const FILING_READINESS_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalFilingReadiness",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalFilingReadiness"
];

const AUTHORITY_GUARDRAILS_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalAuthorityGuardrails",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalAuthorityGuardrails"
];

const REVIEW_WORKFLOW_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalReviewWorkflow",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalReviewWorkflow"
];

const MATTER_CONSISTENCY_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalMatterConsistency",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalMatterConsistency"
];

const EVIDENCE_COVERAGE_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalEvidenceCoverage",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalEvidenceCoverage"
];

const DRAFT_VALIDATION_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalDraftValidation",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalDraftValidation"
];

const FILING_PACK_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalFilingPack",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalFilingPack"
];

const DOCUMENT_ANALYZE_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/legalDocumentAnalyze",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/legalDocumentAnalyze"
];

async function callLegalEndpoint(payload) {
  let lastError = null;

  for (const endpoint of LEGAL_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach legal assistant service.");
}

export async function runLegalAction(action, payload = {}) {
  return callLegalEndpoint({ action, ...payload });
}

export async function fetchCaseValidity(caseId, options = {}) {
  const normalizedCaseId = encodeURIComponent(String(caseId || "").trim());
  if (!normalizedCaseId) {
    throw new Error("Missing case identifier.");
  }

  let lastError = null;
  const suffix = options.forceRefresh ? `/${normalizedCaseId}?refresh=true` : `/${normalizedCaseId}`;

  for (const endpoint of CASE_VALIDITY_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}${suffix}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach case validity service.");
}

export async function fetchCaseCitations(caseId, options = {}) {
  const normalizedCaseId = encodeURIComponent(String(caseId || "").trim());
  if (!normalizedCaseId) {
    throw new Error("Missing case identifier.");
  }

  let lastError = null;
  const suffix = options.forceRefresh ? `/${normalizedCaseId}/citations?refresh=true` : `/${normalizedCaseId}/citations`;

  for (const endpoint of CASE_CITATIONS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}${suffix}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach case citations service.");
}

export async function buildArguments(payload = {}) {
  let lastError = null;

  for (const endpoint of ARGUMENT_BUILDER_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("argument_builder", payload).catch(() => {
    throw lastError || new Error("Unable to reach argument builder service.");
  });
}

export async function analyzeCaseStrength(payload = {}) {
  let lastError = null;

  for (const endpoint of CASE_STRENGTH_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("case_strength", payload).catch(() => {
    throw lastError || new Error("Unable to reach case strength service.");
  });
}

export async function predictCaseOutcome(payload = {}) {
  let lastError = null;

  for (const endpoint of CASE_PREDICTION_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("case_prediction", payload).catch(() => {
    throw lastError || new Error("Unable to reach case prediction service.");
  });
}

export async function analyzeFilingReadiness(payload = {}) {
  let lastError = null;

  for (const endpoint of FILING_READINESS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("filing_readiness", payload).catch(() => {
    throw lastError || new Error("Unable to reach filing readiness service.");
  });
}

export async function evaluateAuthorityGuardrails(selectedCases = []) {
  let lastError = null;

  for (const endpoint of AUTHORITY_GUARDRAILS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ selectedCases })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("authority_guardrails", { selectedCases }).catch(() => {
    throw lastError || new Error("Unable to reach authority guardrails service.");
  });
}

export async function analyzeLegalDocument(payload = {}, options = {}) {
  let lastError = null;
  const suffix = String(options.format || "").trim().toLowerCase() === "memo" ? "?format=memo" : "";

  for (const endpoint of DOCUMENT_ANALYZE_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}${suffix}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("document_analyzer", {
    ...payload,
    format: options.format
  }).catch(() => {
    throw lastError || new Error("Unable to reach document analyzer service.");
  });
}

export async function listLegalReviews(options = {}) {
  let lastError = null;
  const query = new URLSearchParams();
  query.set("ownerId", String(options.ownerId || "anonymous").trim());
  if (options.matterId) query.set("matterId", String(options.matterId).trim());
  if (options.entityType) query.set("entityType", String(options.entityType).trim());

  for (const endpoint of REVIEW_WORKFLOW_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("review_list", options).catch(() => {
    throw lastError || new Error("Unable to reach legal review workflow service.");
  });
}

export async function listLegalReviewSnapshots(options = {}) {
  let lastError = null;
  const query = new URLSearchParams();
  query.set("ownerId", String(options.ownerId || "anonymous").trim());
  query.set("mode", "snapshots");
  if (options.matterId) query.set("matterId", String(options.matterId).trim());
  if (options.entityType) query.set("entityType", String(options.entityType).trim());

  for (const endpoint of REVIEW_WORKFLOW_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("review_snapshot_list", options).catch(() => {
    throw lastError || new Error("Unable to reach legal review snapshot service.");
  });
}

export async function saveLegalReview(payload = {}) {
  let lastError = null;

  for (const endpoint of REVIEW_WORKFLOW_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("review_upsert", payload).catch(() => {
    throw lastError || new Error("Unable to save legal review state.");
  });
}

export async function analyzeMatterConsistency(payload = {}) {
  let lastError = null;

  for (const endpoint of MATTER_CONSISTENCY_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("matter_consistency", payload).catch(() => {
    throw lastError || new Error("Unable to reach matter consistency service.");
  });
}

export async function analyzeEvidenceCoverage(payload = {}) {
  let lastError = null;

  for (const endpoint of EVIDENCE_COVERAGE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("evidence_coverage", payload).catch(() => {
    throw lastError || new Error("Unable to reach evidence coverage service.");
  });
}

export async function analyzeDraftValidation(payload = {}) {
  let lastError = null;

  for (const endpoint of DRAFT_VALIDATION_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("draft_validation", payload).catch(() => {
    throw lastError || new Error("Unable to reach draft validation service.");
  });
}

export async function analyzeFilingPackReadiness(payload = {}) {
  let lastError = null;

  for (const endpoint of FILING_PACK_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  return runLegalAction("filing_pack_readiness", payload).catch(() => {
    throw lastError || new Error("Unable to reach filing pack readiness service.");
  });
}
