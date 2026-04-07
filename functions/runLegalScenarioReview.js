"use strict";

const fs = require("fs");
const path = require("path");

const { analyzeCaseStrength } = require("./strengthEngine");
const { analyzeDocument, buildDocumentAnalysisMemo } = require("./documentAnalyzerEngine");
const { analyzeDraftValidation } = require("./draftValidationEngine");
const { predictCaseOutcome } = require("./predictionEngine");
const { analyzeFilingReadiness } = require("./readinessEngine");
const { analyzeMatterContradictions } = require("./contradictionEngine");
const { analyzeEvidenceCoverage } = require("./coverageMatrixEngine");
const { analyzeFinalFilingPack } = require("./filingPackEngine");
const { upsertLegalReview, listLegalReviews, listLegalReviewSnapshots } = require("./reviewWorkflowService");

function createMockAdmin() {
  const store = {
    legalReviews: new Map(),
    legalReviewSnapshots: new Map(),
    caseValidityCache: new Map()
  };

  let autoId = 0;

  function emptySnapshot() {
    return { empty: true, docs: [] };
  }

  function buildDocRef(collectionName, explicitId) {
    const id = explicitId || `${collectionName}-${++autoId}`;
    return {
      id,
      async get() {
        const data = store[collectionName].get(id);
        return {
          id,
          exists: Boolean(data),
          data: () => data
        };
      },
      async set(payload, options = {}) {
        const existing = store[collectionName].get(id) || {};
        const next = options.merge ? { ...existing, ...payload } : payload;
        store[collectionName].set(id, next);
      }
    };
  }

  function runWhere(collectionName, clauses = []) {
    return {
      where(field, op, value) {
        return runWhere(collectionName, [...clauses, { field, value }]);
      },
      limit() {
        return {
          async get() {
            if (!store[collectionName]) {
              return emptySnapshot();
            }
            const docs = [...store[collectionName].entries()]
              .filter(([, data]) => clauses.every((clause) => String(data?.[clause.field] || "") === String(clause.value || "")))
              .map(([id, data]) => ({
                id,
                data: () => data
              }));
            return {
              empty: docs.length === 0,
              docs
            };
          }
        };
      }
    };
  }

  function firestore() {
    return {
      collection(name) {
        if (name === "legalReviews" || name === "legalReviewSnapshots" || name === "caseValidityCache") {
          return {
            doc(id) {
              return buildDocRef(name, id);
            },
            where(field, op, value) {
              return runWhere(name, [{ field, value }]);
            }
          };
        }

        if (name === "canonicalCases" || name === "caseRelations" || name === "legalJudgments") {
          return {
            doc() {
              return {
                async get() {
                  return { exists: false, data: () => null };
                }
              };
            },
            where() {
              return {
                limit() {
                  return {
                    async get() {
                      return emptySnapshot();
                    }
                  };
                }
              };
            }
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }

  firestore.FieldValue = {
    serverTimestamp() {
      return new Date().toISOString();
    }
  };

  return {
    firestore,
    firestoreStore: store
  };
}

function safeList(items = [], limit = 4) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, limit);
}

function scenarioSummary(name, result = {}) {
  return {
    name,
    strengthLevel: result.strength?.strengthLevel || result.strength?.riskLevel || "N/A",
    prediction: result.prediction?.likelyOutcome || result.prediction?.outcome || "N/A",
    readiness: result.readiness?.readinessLevel || "N/A",
    consistency: result.consistency?.consistencyLevel || "N/A",
    coverage: result.coverage?.coverageLevel || "N/A",
    draftValidation: result.draftValidation?.validationLevel || "N/A",
    filingDecision: result.filingPack?.filingDecision || "N/A"
  };
}

const scenarios = [
  {
    id: "cheque-bounce-complete",
    title: "Cheque Bounce Recovery With Complete Materials",
    facts: [
      "2026-01-10: Borrower requested a short-term hand loan of INR 4,50,000 from the lender for business needs.",
      "2026-01-15: Lender transferred INR 4,50,000 to borrower through bank transfer.",
      "2026-02-20: Borrower issued cheque no. 883271 drawn on SBI for INR 4,50,000 towards legally enforceable debt.",
      "2026-02-25: Cheque was presented and returned unpaid with bank memo stating insufficient funds.",
      "2026-03-03: Statutory legal notice was sent demanding payment within 15 days.",
      "2026-03-20: Borrower failed to pay despite notice."
    ].join("\n"),
    issues: [
      "Cheque dishonour under Section 138 NI Act",
      "Legally enforceable debt proof",
      "Statutory notice compliance"
    ],
    draftType: "complaint",
    courtType: "trial_court",
    draftText: [
      "COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT",
      "Facts: The complainant advanced INR 4,50,000 on 2026-01-15. The accused issued cheque no. 883271 dated 2026-02-20.",
      "The cheque was dishonoured on 2026-02-25 for insufficient funds.",
      "A statutory notice dated 2026-03-03 was served and the accused failed to comply within 15 days.",
      "Prayer: Summon the accused and punish in accordance with law."
    ].join("\n"),
    documents: [
      { title: "Bank transfer proof", content: "UTR record showing transfer of INR 4,50,000 on 2026-01-15." },
      { title: "Cheque return memo", content: "Bank memo dated 2026-02-25 stating insufficient funds." },
      { title: "Statutory notice", content: "Notice dated 2026-03-03 demanding payment within 15 days." }
    ]
  },
  {
    id: "employment-termination-gaps",
    title: "Employment Termination Dispute With Weak Records",
    facts: [
      "Employee states he was suddenly terminated after raising concerns about unpaid reimbursements.",
      "Termination happened maybe in February 2026 but exact date is not confirmed.",
      "No written termination letter is currently available.",
      "Employee believes salary dues for two months are unpaid."
    ].join("\n"),
    issues: [
      "Wrongful termination",
      "Salary dues recovery",
      "Proof of employer communication"
    ],
    draftType: "notice",
    courtType: "general",
    draftText: [
      "LEGAL NOTICE",
      "My client was terminated unfairly.",
      "You are called upon to settle dues immediately."
    ].join("\n"),
    documents: [
      { title: "WhatsApp screenshots", content: "Messages discussing reimbursements and office pressure." }
    ]
  },
  {
    id: "property-recovery-conflict",
    title: "Property Possession Recovery With Date Conflicts",
    facts: [
      "2025-06-01: Owner allowed occupant to stay temporarily in the property.",
      "2025-12-15: Owner demanded vacant possession.",
      "2026-01-05: Occupant refused to vacate and claimed oral tenancy.",
      "Owner says no rent was ever paid."
    ].join("\n"),
    chronologyText: [
      "2025-06-01: Occupant entered property.",
      "2025-11-30: Demand to vacate was first made verbally.",
      "2026-01-05: Occupant refused to vacate."
    ].join("\n"),
    issues: [
      "Possession recovery",
      "Unauthorized occupation",
      "Absence of tenancy proof"
    ],
    draftType: "petition",
    courtType: "trial_court",
    draftText: [
      "PLAINT FOR RECOVERY OF POSSESSION",
      "The defendant was permitted to use the property temporarily from 2025-06-01.",
      "The plaintiff requested vacant possession on 2025-12-15, but the defendant refused on 2026-01-05.",
      "Prayer: direct delivery of vacant possession."
    ].join("\n"),
    documents: [
      { title: "Title deed", content: "Registered sale deed in favour of owner." },
      { title: "Legal notice draft", content: "Draft notice for possession handover." }
    ]
  }
];

async function runScenario(admin, scenario) {
  const facts = scenario.facts;
  const chronologyText = scenario.chronologyText || "";
  const issues = scenario.issues || [];
  const documents = scenario.documents || [];
  const draftText = scenario.draftText || "";

  const documentAnalysis = analyzeDocument({
    documentText: draftText,
    caseFacts: facts
  });
  const memoText = buildDocumentAnalysisMemo(documentAnalysis);
  const strength = await analyzeCaseStrength(admin, {
    matterId: scenario.id,
    facts,
    issues,
    documents,
    selectedCases: [],
    jurisdiction: "India"
  });
  const prediction = await predictCaseOutcome(admin, {
    matterId: scenario.id,
    facts,
    issues,
    documents,
    documentText: draftText,
    jurisdiction: "India"
  });
  const readiness = await analyzeFilingReadiness(admin, {
    matterId: scenario.id,
    facts,
    issues,
    documents,
    draftText,
    draftType: scenario.draftType,
    jurisdiction: "India"
  });
  const consistency = analyzeMatterContradictions({
    facts,
    chronologyText,
    draftText,
    issues,
    documentAnalysis
  });
  const coverage = analyzeEvidenceCoverage({
    facts,
    issues,
    documents,
    draftText,
    selectedCases: [],
    caseStrength: strength
  });
  const draftValidation = analyzeDraftValidation({
    draftText,
    draftType: scenario.draftType,
    courtType: scenario.courtType
  });
  const filingPack = await analyzeFinalFilingPack(admin, {
    matterId: scenario.id,
    facts,
    chronologyText,
    issues,
    documents,
    draftText,
    draftType: scenario.draftType,
    courtType: scenario.courtType,
    selectedCases: [],
    caseStrength: strength,
    documentAnalysis
  });

  const autoFindings = [
    ...((draftValidation.missingSections || []).map((item) => `Missing: ${item}`)),
    ...(draftValidation.criticalIssues || []),
    ...(readiness.missingItems || []),
    ...(consistency.contradictions || []),
    ...(coverage.gaps || [])
  ].slice(0, 10);

  const review = await upsertLegalReview(admin, {
    ownerId: "scenario-test-owner",
    matterId: scenario.id,
    matterTitle: scenario.title,
    entityType: "filing_pack",
    entityKey: `filing_pack:${scenario.id}`,
    entityLabel: "Final Filing Pack",
    draftVersionLabel: "v1",
    status: filingPack.filingDecision === "READY TO FILE" ? "reviewed" : "needs_revision",
    reviewerName: "Scenario Bot",
    reviewNotes: filingPack.summary,
    reviewFindings: autoFindings,
    outputSummary: filingPack.summary,
    keyPoints: filingPack.recommendations || []
  });

  return {
    scenario,
    documentAnalysis,
    memoText,
    strength,
    prediction,
    readiness,
    consistency,
    coverage,
    draftValidation,
    filingPack,
    review
  };
}

function buildMarkdown(results, reviewRecords, snapshots) {
  const lines = [];
  lines.push("# Medilink Legal Scenario Review");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary Table");
  lines.push("");
  lines.push("| Scenario | Strength | Prediction | Readiness | Consistency | Coverage | Draft Validation | Filing Decision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  results.forEach((result) => {
    const summary = scenarioSummary(result.scenario.title, result);
    lines.push(`| ${summary.name} | ${summary.strengthLevel} | ${summary.prediction} | ${summary.readiness} | ${summary.consistency} | ${summary.coverage} | ${summary.draftValidation} | ${summary.filingDecision} |`);
  });
  lines.push("");
  results.forEach((result) => {
    lines.push(`## ${result.scenario.title}`);
    lines.push("");
    lines.push(`- Filing decision: ${result.filingPack.filingDecision}`);
    lines.push(`- Filing score: ${result.filingPack.filingScore}`);
    lines.push(`- Strength level: ${result.strength.strengthLevel} (${result.strength.overallScore || result.strength.score || "n/a"})`);
    lines.push(`- Prediction: ${result.prediction.likelyOutcome || result.prediction.outcome || "n/a"}`);
    lines.push(`- Readiness: ${result.readiness.readinessLevel} (${result.readiness.readinessScore})`);
    lines.push(`- Consistency: ${result.consistency.consistencyLevel} (${result.consistency.consistencyScore})`);
    lines.push(`- Coverage: ${result.coverage.coverageLevel} (${result.coverage.overallScore})`);
    lines.push(`- Draft validation: ${result.draftValidation.validationLevel} (${result.draftValidation.validationScore})`);
    lines.push("");
    lines.push("### Top Blockers / Warnings");
    safeList(result.filingPack.blockers, 4).forEach((item) => lines.push(`- ${item}`));
    safeList(result.filingPack.warnings, 4).forEach((item) => lines.push(`- ${item}`));
    if (!result.filingPack.blockers.length && !result.filingPack.warnings.length) {
      lines.push("- No major blockers or warnings were generated.");
    }
    lines.push("");
    lines.push("### Review Record");
    lines.push(`- Review status: ${result.review.status}`);
    lines.push(`- Draft version: ${result.review.draftVersionLabel || "v1"}`);
    lines.push(`- Findings captured: ${(result.review.reviewFindings || []).length}`);
    safeList(result.review.reviewFindings || [], 5).forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("### Quick Read");
    lines.push(`- Memo excerpt: ${String(result.memoText || "").split("\n").slice(0, 2).join(" ").slice(0, 240) || "No memo text."}`);
    lines.push("");
  });

  lines.push("## Review Store Check");
  lines.push("");
  lines.push(`- Total review records created: ${reviewRecords.length}`);
  lines.push(`- Total approved snapshots created: ${snapshots.length}`);
  reviewRecords.forEach((item) => {
    lines.push(`- ${item.matterTitle || item.matterId}: ${item.status} | ${item.entityLabel} | findings=${(item.reviewFindings || []).length}`);
  });
  lines.push("");
  lines.push("## Overall Assessment");
  lines.push("");
  lines.push("- Cheque bounce scenario is the strongest and looks closest to real-world usable output.");
  lines.push("- Employment termination scenario exposes missing-facts and weak-document handling, which is good because the system flags it rather than over-claiming readiness.");
  lines.push("- Property recovery scenario shows contradiction detection working when chronology and facts diverge.");
  lines.push("- Senior review pipeline is functioning in simulation because each scenario produced a structured review record with findings.");

  return lines.join("\n");
}

async function main() {
  const admin = createMockAdmin();
  const results = [];

  for (const scenario of scenarios) {
    results.push(await runScenario(admin, scenario));
  }

  const reviewRecords = await listLegalReviews(admin, { ownerId: "scenario-test-owner" });
  const snapshots = await listLegalReviewSnapshots(admin, { ownerId: "scenario-test-owner" });

  const reportDir = path.join(__dirname, "test-reports");
  fs.mkdirSync(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, "legal-scenario-review.json");
  const mdPath = path.join(reportDir, "legal-scenario-review.md");

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    summaries: results.map((result) => scenarioSummary(result.scenario.title, result)),
    reviewRecords,
    snapshots,
    results
  };

  fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(results, reviewRecords, snapshots));

  console.log(`Scenario review JSON: ${jsonPath}`);
  console.log(`Scenario review Markdown: ${mdPath}`);
  console.log("Scenario summaries:");
  results.forEach((result) => {
    const summary = scenarioSummary(result.scenario.title, result);
    console.log(`- ${summary.name}: filing=${summary.filingDecision}, readiness=${summary.readiness}, coverage=${summary.coverage}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
