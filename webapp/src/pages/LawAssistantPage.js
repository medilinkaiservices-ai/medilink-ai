import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getStoredAccount,
  getStoredProfile,
  registerRole,
  setLastActiveRole
} from "../utils/session";
import { analyzeCaseStrength, analyzeDraftValidation, analyzeEvidenceCoverage, analyzeFilingPackReadiness, analyzeFilingReadiness, analyzeLegalDocument, analyzeMatterConsistency, buildArguments, evaluateAuthorityGuardrails, fetchCaseCitations, fetchCaseValidity, listLegalReviewSnapshots, listLegalReviews, predictCaseOutcome, runLegalAction, saveLegalReview } from "../utils/legalApi";

const PUBLIC_DISCLAIMER = "This is not a substitute for a qualified lawyer";
const APPROVAL_ROLE_OPTIONS = [
  { value: "reviewer", label: "Reviewer" },
  { value: "senior_lawyer", label: "Senior Lawyer" },
  { value: "partner", label: "Partner" }
];

const LAWYER_TABS = [
  { id: "intake", label: "Matter Intake" },
  { id: "judgments", label: "Latest Judgments" },
  { id: "citations", label: "Citations" },
  { id: "case-studies", label: "Case Studies" },
  { id: "memo", label: "Research Memo" },
  { id: "arguments", label: "Argument Builder" },
  { id: "strength", label: "Case Strength" },
  { id: "prediction", label: "Case Prediction" },
  { id: "readiness", label: "Filing Readiness" },
  { id: "consistency", label: "Matter Consistency" },
  { id: "coverage", label: "Evidence Coverage" },
  { id: "notice", label: "Notice Pack" },
  { id: "research", label: "AI Legal Research" },
  { id: "draft", label: "Draft Generator" },
  { id: "draft-validation", label: "Draft Validation" },
  { id: "filing-pack", label: "Final Filing Pack" },
  { id: "history", label: "Draft History" },
  { id: "mapping", label: "Legacy Mapping" },
  { id: "templates", label: "Template Library" },
  { id: "analyzer", label: "Case Analyzer" },
  { id: "document", label: "Document Analyzer" },
  { id: "clients", label: "Client Management" },
  { id: "workflow", label: "Workflow" },
  { id: "memory", label: "Smart Memory" },
  { id: "audit", label: "Audit Logs" }
];

const DRAFT_TEMPLATES = [
  {
    id: "petition-basic",
    title: "Writ Petition (Basic)",
    draftType: "petition",
    body:
`IN THE HON'BLE [COURT NAME]
WRIT PETITION NO. [___] OF [YEAR]

PETITIONER: [Name]
RESPONDENTS: [Names]

FACTS:
1. [Insert chronology]
2. [Insert legal injury]

GROUNDS:
A. Violation of Article 14 / 21.
B. [Statutory non-compliance]

PRAYER:
i) [Primary relief]
ii) [Interim relief]

PLACE:
DATE:
COUNSEL FOR PETITIONER:`
  },
  {
    id: "notice-recovery",
    title: "Legal Notice (Recovery)",
    draftType: "notice",
    body:
`LEGAL NOTICE
To: [Recipient]

Under instructions from my client [Client Name], this notice is issued:
1. That on [date], [transaction facts].
2. That an amount of INR [amount] is due and payable.
3. Despite reminders, payment is not made.

You are called upon to pay INR [amount] within [15] days, failing which civil/criminal remedies shall be initiated at your cost and risk.

COUNSEL:
DATE:`
  },
  {
    id: "agreement-service",
    title: "Service Agreement",
    draftType: "agreement",
    body:
`SERVICE AGREEMENT
This Agreement is made on [date] between [Party A] and [Party B].

1. Scope of Services
2. Fees and Payment Terms
3. Confidentiality
4. Term and Termination
5. Indemnity
6. Governing Law and Jurisdiction

SIGNED:
Party A:
Party B:`
  },
  {
    id: "affidavit-standard",
    title: "Affidavit Format",
    draftType: "affidavit",
    body:
`AFFIDAVIT
I, [Name], aged [__], residing at [address], do hereby solemnly affirm:
1. [Statement of facts]
2. [Supporting declarations]
3. [Verification]

Verified at [place] on [date] that contents are true to my knowledge.

DEPONENT`
  }
];

const LEGACY_SECTION_MAP = [
  {
    legacy: "IPC Section 379",
    current: "BNS Section 303",
    topic: "Theft",
    note: "Use the current BNS theft provision instead of the repealed IPC citation."
  },
  {
    legacy: "IPC Section 420",
    current: "BNS cheating provisions",
    topic: "Cheating / fraud",
    note: "Re-check the exact current BNS section before final drafting or advice."
  },
  {
    legacy: "CrPC Section 154",
    current: "BNSS Section 173",
    topic: "FIR / information in cognizable cases",
    note: "This is the current procedural starting point for police reporting under BNSS."
  },
  {
    legacy: "CrPC Section 156 / 156(3)",
    current: "BNSS Section 175",
    topic: "Police investigation power",
    note: "Cross-check Magistrate-related procedure carefully under BNSS before filing."
  },
  {
    legacy: "Indian Evidence Act",
    current: "Bharatiya Sakshya Adhiniyam, 2023",
    topic: "Evidence",
    note: "Use BSA as the current evidence-law reference, especially for document and electronic evidence issues."
  }
];

const CASE_STUDIES = [
  {
    id: "cheque-bounce",
    title: "Cheque Bounce Recovery",
    category: "Notice + complaint",
    summary: "A borrower issued a cheque toward repayment, the cheque was dishonoured, and statutory notice needs to be prepared with recovery strategy.",
    facts:
`Client advanced INR 4,50,000 as a friendly loan.
Borrower issued cheque dated 2026-01-15.
Cheque returned unpaid on 2026-01-18 for insufficient funds.
Client wants legal notice and next complaint steps under cheque dishonour law.`,
    chronology:
`2025-11-10: Loan advanced to borrower
2026-01-15: Borrower issued cheque
2026-01-18: Cheque dishonoured
2026-01-20: Bank return memo received`,
    issues: [
      "Statutory notice timing",
      "Legally enforceable debt proof",
      "Cheque dishonour complaint strategy"
    ]
  },
  {
    id: "consumer-deficiency",
    title: "Consumer Service Deficiency",
    category: "Consumer matter",
    summary: "A hospital package was paid for, but critical promised services were not delivered and refund plus compensation options are being explored.",
    facts:
`Client paid for a diagnostic and consultation package.
Hospital delayed reports and denied one included consultation.
Client seeks refund, compensation, and notice strategy.`,
    chronology:
`2026-02-01: Package booked and payment completed
2026-02-03: Diagnostic sample collected
2026-02-08: Reports delayed beyond promised timeline
2026-02-10: Consultation denied despite package inclusion`,
    issues: [
      "Deficiency in service",
      "Refund and compensation",
      "Consumer notice and forum strategy"
    ]
  },
  {
    id: "employment-dues",
    title: "Employment Salary Dues",
    category: "Recovery + labour",
    summary: "An employee resigned after repeated salary defaults and now needs a dues recovery notice with supporting chronology.",
    facts:
`Employee worked for six months with repeated delayed salary credits.
Final two months salary and reimbursement remain unpaid after resignation.
Client wants legal notice and escalation options.`,
    chronology:
`2025-09-01: Employment started
2026-02-01: First serious salary delay noticed
2026-03-05: Employee resigned
2026-03-20: Final dues still unpaid`,
    issues: [
      "Salary dues recovery",
      "Proof of employment and arrears",
      "Notice before escalation"
    ]
  }
];

function renderList(items = []) {
  if (!items.length) return <li>Not available</li>;
  return items.map((item, index) => <li key={`${String(item)}-${index}`}>{item}</li>);
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function saveTextFile(fileName, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openExternalLink(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function sanitizeReviewKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildReviewEntityKey(entityType, parts = []) {
  const normalized = parts
    .map((item) => sanitizeReviewKeyPart(item))
    .filter(Boolean);
  return [sanitizeReviewKeyPart(entityType), ...normalized].filter(Boolean).join(":");
}

function buildReviewSummaryText(output) {
  if (!output) return "";
  if (output.summary) return String(output.summary).slice(0, 400);
  if (output.factSummary) return String(output.factSummary).slice(0, 400);
  if (output.draft) return String(output.draft).slice(0, 400);
  if (output.keyFactors?.length) return output.keyFactors.slice(0, 3).join(" ").slice(0, 400);
  if (output.issueList?.length) return output.issueList.slice(0, 4).join(" ").slice(0, 400);
  return "";
}

function getLocalReviewStorageKey(ownerId) {
  return `medilink-legal-reviews:${String(ownerId || "anonymous").trim()}`;
}

function readLocalReviews(ownerId) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getLocalReviewStorageKey(ownerId));
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalReviews(ownerId, reviews) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getLocalReviewStorageKey(ownerId), JSON.stringify(reviews || []));
}

function getDateSeverity(value) {
  if (!value) return { label: "No date", type: "neutral", diff: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  const diff = Math.floor((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `Overdue by ${Math.abs(diff)} day(s)`, type: "danger", diff };
  if (diff <= 3) return { label: `Due in ${diff} day(s)`, type: "warning", diff };
  return { label: `${diff} day(s) left`, type: "ok", diff };
}

function buildChronology(rawText) {
  return String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*[:|-]\s*(.+)$/);
      if (match) {
        return {
          id: `chrono-${index}`,
          date: match[1],
          event: match[2].trim()
        };
      }
      return {
        id: `chrono-${index}`,
        date: "",
        event: line
      };
    })
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
}

function formatFirestoreDate(value) {
  if (!value) return "Not available";
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-IN");
  }
  if (value?._seconds) {
    return new Date(value._seconds * 1000).toLocaleString("en-IN");
  }
  return "Not available";
}

function formatFreshnessDate(value) {
  const text = String(value || "").trim();
  if (!text) return "Not available";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? text
    : parsed.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function getFreshnessTone(level) {
  if (level === "fresh") {
    return { label: "Fresh", background: "#dff6e6", color: "#1f7a3d" };
  }
  if (level === "recent") {
    return { label: "Recent", background: "#fff5d6", color: "#8a6500" };
  }
  if (level === "stale") {
    return { label: "Stale", background: "#fde3e3", color: "#9f1d1d" };
  }
  return { label: "Unknown", background: "#e8eef7", color: "#2b4f81" };
}

function renderFreshnessBadge(label, level, value) {
  const tone = getFreshnessTone(level);
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: "999px",
        background: tone.background,
        color: tone.color,
        fontSize: "0.85rem"
      }}
    >
      {label}: {tone.label}{value ? ` • ${formatFreshnessDate(value)}` : ""}
    </span>
  );
}

function renderAuthorities(authorities = [], onRevalidate = null) {
  if (!authorities.length) return <p className="muted-copy">No grounded authorities returned yet.</p>;
  return (
    <div className="law-page-grid">
      {authorities.map((item, index) => (
        <div key={`${item.id || item.citation || item.title}-${index}`} className="law-page-card">
          <strong>{item.title || item.citation || "Authority"}</strong>
          <div className="muted-copy">{item.citation || item.type || "Source"}</div>
          {item.lastVerifiedAt ? <div className="muted-copy">Last checked: {formatFreshnessDate(item.lastVerifiedAt)}</div> : null}
          <p>{item.summary || "No summary available."}</p>
          <div className="law-inline-actions">
            {item.sourceUrl ? (
              <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                Open Source
              </button>
            ) : null}
            {onRevalidate && (item.canonicalCaseId || item.caseId || item.citation) ? (
              <button type="button" className="ghost-button" onClick={() => onRevalidate(item)}>
                Revalidate
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildLocalTraceability({ facts = "", documents = [], authorities = [], scoreBreakdown = null, keyFactors = [], notes = [] }) {
  const factsUsed = String(facts || "")
    .split("\n")
    .map((line, index) => ({ id: `fact-${index}`, label: line.trim() }))
    .filter((item) => item.label)
    .slice(0, 6);

  const documentsReviewed = (Array.isArray(documents) ? documents : [])
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `doc-${index}`,
          title: `Document ${index + 1}`,
          excerpt: item,
          exactReference: "",
          pinpoint: { excerpt: item },
          sourceUrl: ""
        };
      }
      return {
        id: String(item?.id || `doc-${index}`),
        title: String(item?.title || item?.fileName || `Document ${index + 1}`),
        excerpt: String(item?.excerpt || item?.summary || item?.content || item?.text || ""),
        exactReference: String(item?.locationLabel || item?.location || ""),
        sourceUrl: String(item?.sourceUrl || ""),
        pinpoint: item?.pinpoint || {
          excerpt: String(item?.excerpt || item?.summary || item?.content || item?.text || "")
        }
      };
    })
    .filter((item) => item.title || item.excerpt)
    .slice(0, 6);

  const authoritiesRelied = (Array.isArray(authorities) ? authorities : [])
    .map((item, index) => ({
      id: String(item?.id || item?.caseId || item?.canonicalCaseId || `auth-${index}`),
      title: String(item?.title || item?.citation || `Authority ${index + 1}`),
      citation: String(item?.citation || ""),
      proposition: String(item?.whyItMatters || item?.ratioNote || item?.summary || item?.reasoning || ""),
      status: String(item?.status || item?.validityStatus || item?.treatmentStatus || ""),
      lastVerifiedAt: String(item?.lastVerifiedAt || item?.freshness?.lastVerifiedAt || ""),
      freshnessLevel: String(item?.freshness?.verificationFreshness || ""),
      sourceUrl: String(item?.sourceUrl || ""),
      exactReference: String(item?.pinpointRef || item?.referenceLabel || item?.exactReference || item?.keyParagraphs?.[0] || ""),
      pinpoint: item?.pinpoint || {
        paragraphNumber: Number(String(item?.keyParagraphs?.[0] || "").match(/(\d+)/)?.[1] || 0) || null,
        excerpt: String(item?.holdingPoints?.[0] || item?.whyItMatters || item?.ratioNote || item?.summary || "")
      }
    }))
    .slice(0, 8);

  return {
    factsUsed,
    documentsReviewed,
    authoritiesRelied,
    scoreBreakdown,
    keyFactors: (Array.isArray(keyFactors) ? keyFactors : []).map((item, index) => ({ id: `factor-${index}`, label: item })).slice(0, 8),
    reviewerNotes: (Array.isArray(notes) ? notes : []).map((item, index) => ({ id: `note-${index}`, label: item })).slice(0, 6)
  };
}

function renderTraceability(traceability) {
  if (!traceability) return null;

  return (
    <div className="law-list-block">
      <h4>Why This Output</h4>
      {traceability.scoreBreakdown ? (
        <div className="law-extract-meta">
          {Object.entries(traceability.scoreBreakdown).map(([key, value]) => (
            <div key={key}><strong>{key}:</strong> {value}</div>
          ))}
        </div>
      ) : null}
      {traceability.keyFactors?.length ? (
        <>
          <h4>Key Factors Used</h4>
          <ul>{renderList(traceability.keyFactors.map((item) => item.label || item))}</ul>
        </>
      ) : null}
      {traceability.factsUsed?.length ? (
        <>
          <h4>Facts Used</h4>
          <ul>{renderList(traceability.factsUsed.map((item) => item.label || item))}</ul>
        </>
      ) : null}
      {traceability.documentsReviewed?.length ? (
        <>
          <h4>Documents Reviewed</h4>
          <ul>
            {traceability.documentsReviewed.map((item) => (
              <li key={item.id || item.title}>
                <strong>{item.title || "Document"}</strong>
                {item.exactReference ? ` | ${item.exactReference}` : ""}
                {item.sourceUrl ? (
                  <div style={{ marginTop: "6px" }}>
                    <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                      Open Source
                    </button>
                  </div>
                ) : null}
                {item.excerpt ? (
                  <details style={{ marginTop: "6px" }}>
                    <summary>Expand excerpt</summary>
                    <p>{item.excerpt}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {traceability.authoritiesRelied?.length ? (
        <>
          <h4>Authorities Relied</h4>
          <ul>
            {traceability.authoritiesRelied.map((item) => (
              <li key={item.id || item.title}>
                <strong>{item.title || "Authority"}</strong>
                {item.citation ? ` | ${item.citation}` : ""}
                {item.status ? ` | ${item.status}` : ""}
                {item.exactReference ? ` | ${item.exactReference}` : ""}
                {item.lastVerifiedAt ? ` | Last checked ${formatFreshnessDate(item.lastVerifiedAt)}` : ""}
                {item.sourceUrl ? (
                  <div style={{ marginTop: "6px" }}>
                    <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                      Open Source
                    </button>
                  </div>
                ) : null}
                {item.proposition ? <div className="muted-copy" style={{ marginTop: "4px" }}>{item.proposition}</div> : null}
                {item.pinpoint?.excerpt ? (
                  <details style={{ marginTop: "6px" }}>
                    <summary>Expand excerpt</summary>
                    <p>{item.pinpoint.excerpt}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {traceability.reviewerNotes?.length ? (
        <>
          <h4>Reviewer Notes</h4>
          <ul>{renderList(traceability.reviewerNotes.map((item) => item.label || item))}</ul>
        </>
      ) : null}
    </div>
  );
}

function getValidityTone(status) {
  if (status === "GOOD LAW") {
    return { icon: "🟢", label: "Good Law", className: "law-validity-good" };
  }
  if (status === "BAD LAW") {
    return { icon: "🔴", label: "Bad Law", className: "law-validity-bad" };
  }
  return { icon: "🟡", label: "Caution", className: "law-validity-caution" };
}

function getRelationTone(relationType) {
  if (relationType === "followed") {
    return { label: "followed", background: "#dff6e6", color: "#1f7a3d" };
  }
  if (relationType === "overruled") {
    return { label: "overruled", background: "#fde3e3", color: "#9f1d1d" };
  }
  if (relationType === "distinguished") {
    return { label: "distinguished", background: "#fff5d6", color: "#8a6500" };
  }
  return { label: "cited", background: "#e8eef7", color: "#2b4f81" };
}

function buildLocalCitationView(item = {}, validity = null) {
  const canonicalCitation = item?.citation || item?.canonicalCaseId || item?.title || "Citation unavailable";
  const status = validity?.status || (item?.treatmentStatus === "followed" ? "GOOD LAW" : "CAUTION");
  return {
    canonicalCaseId: item?.canonicalCaseId || getJudgmentValidityKey(item),
    canonicalCitation,
    caseName: item?.title || "Selected case",
    alternateCitations: [item?.neutralCitation, ...(item?.parallelCitations || []), item?.citation].filter(Boolean).slice(0, 6),
    status,
    riskLevel: validity?.riskLevel || "MEDIUM",
    confidenceScore: validity?.confidenceScore || 35,
    freshness: validity?.freshness || {
      lastVerifiedAt: "",
      verificationFreshness: "unknown",
      lastSourceUpdateAt: "",
      sourceFreshness: "unknown",
      lastTreatmentDate: item?.judgmentDate || "",
      treatmentFreshness: item?.judgmentDate ? "recent" : "unknown",
      sourceType: item?.sourceType || "local"
    },
    metrics: {
      citedByCount: 0,
      followedByCount: String(item?.treatmentStatus || "").toLowerCase() === "followed" ? 1 : 0,
      overruledByCount: String(item?.treatmentStatus || "").toLowerCase().includes("overrule") ? 1 : 0
    },
    relations: {
      citedCases: [],
      citedBy: [],
      followedCases: [],
      followedBy: [],
      overruledBy: [],
      distinguishedCases: []
    }
  };
}

function getJudgmentValidityKey(item = {}) {
  if (!item) return "";
  return String(item.canonicalCaseId || item.citation || item.title || "").trim();
}

function buildDemoChecklist({ intakeOutput, memoOutput, noticeOutput, relatedJudgments = [] }) {
  return [
    { label: "Matter intake ready", done: Boolean(intakeOutput?.matterTitle) },
    { label: "Research memo generated", done: Boolean(memoOutput?.issueList?.length) },
    { label: "Notice pack prepared", done: Boolean(noticeOutput?.noticeDraft) },
    { label: "Latest judgments matched", done: relatedJudgments.length > 0 }
  ];
}

function buildValueProof({ memoOutput, noticeOutput, relatedJudgments = [], savedDrafts = [] }) {
  return [
    { label: "Research memo delivered", value: memoOutput?.issueList?.length ? "Yes" : "Pending" },
    { label: "Latest judgments matched", value: relatedJudgments.length ? String(relatedJudgments.length) : "0" },
    { label: "Notice/draft ready", value: noticeOutput?.noticeDraft ? "Yes" : savedDrafts.length ? "Saved drafts available" : "Pending" },
    { label: "Lawyer time saved", value: memoOutput || noticeOutput ? "High" : "Starts after first matter" }
  ];
}

function buildLocalMatterIntake({ intakeFacts = "", intakeDocText = "", caseTitle = "" }) {
  const chronologyEntries = buildChronology(intakeFacts);
  const factSummary = String(intakeFacts || intakeDocText || "").trim() || "Matter facts to be confirmed with client.";
  const issueHints = [
    /cheque|dishonou?r|bounce/i.test(factSummary) ? "Statutory notice timing" : "",
    /loan|debt|amount|payment|dues/i.test(factSummary) ? "Legally enforceable debt proof" : "",
    /hospital|consumer|refund|service/i.test(factSummary) ? "Deficiency in service / refund claim" : "",
    /employee|salary|dismiss|termination/i.test(factSummary) ? "Employment dues / service dispute" : ""
  ].filter(Boolean);
  const legalIssues = issueHints.length ? issueHints : ["Identify legal issues from client facts", "Verify documentary proof", "Check procedural path"];

  const matterTitle = caseTitle || (legalIssues[0]?.toLowerCase().includes("notice") ? "Cheque Bounce Recovery" : "New Legal Matter");

  return {
    matterTitle,
    clientSummary: "Client matter prepared from the current facts and uploaded material.",
    factSummary,
    legalIssues,
    reliefsToConsider: [
      "Issue legal notice / demand",
      "Prepare complaint / petition strategy",
      "Preserve records and proof for filing"
    ],
    documentsRequired: [
      "Supporting transaction / correspondence records",
      "Identity and address details",
      "Proof linked to the core dispute"
    ],
    nextSteps: [
      "Review chronology with client",
      "Generate research memo",
      "Prepare notice or draft"
    ],
    chronologyPreview: chronologyEntries.map((item) => `${item.date || "No date"} - ${item.event}`)
  };
}

function buildLocalChronologyResponse({ intakeFacts = "", intakeDocText = "" }) {
  const raw = String(intakeFacts || intakeDocText || "");
  const entries = buildChronology(raw).map((item) => ({
    date: item.date,
    event: item.event,
    source: "workspace"
  }));

  return {
    entries: entries.length ? entries : [{
      date: "",
      event: "Chronology needs client confirmation.",
      source: "workspace"
    }]
  };
}

function buildLocalResearchMemo({ intakeOutput, intakeChronology = [], chronologyText = "", caseTitle = "", caseNotes = "" }) {
  const issues = Array.isArray(intakeOutput?.legalIssues) ? intakeOutput.legalIssues : [];
  const chronologyLines = intakeChronology.length
    ? intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`)
    : String(chronologyText || "").split("\n").map((line) => line.trim()).filter(Boolean);

  return {
    issueList: issues.length ? issues : ["Identify legal issues from client facts", "Check procedural path", "Verify documentary proof"],
    keyAuthorities: issues.length ? issues.map((item) => `${item} | verify latest case law`) : ["Relevant statute and latest judgments to be verified"],
    proceduralNotes: [
      "Verify limitation and notice timing before final filing.",
      "Check jurisdiction and maintainability.",
      "Preserve supporting documents and chronology."
    ],
    riskFlags: [
      "This memo is prepared from the current matter intake, chronology, and issue summary.",
      "Verify current judgments and statutory position before client advice."
    ],
    nextActions: [
      "Run latest judgments matching.",
      "Prepare notice or petition draft.",
      "Review filing timeline with client."
    ],
    latestJudgmentNotes: [],
    bestCases: [],
    relatedJudgments: [],
    factSummary: intakeOutput?.factSummary || caseNotes || "",
    matterTitle: intakeOutput?.matterTitle || caseTitle || "Untitled matter",
    chronologyPreview: chronologyLines
  };
}

function buildLocalJudgmentMatches({ intakeOutput, memoOutput }) {
  const issueTags = Array.isArray(memoOutput?.issueList) && memoOutput.issueList.length
    ? memoOutput.issueList
    : Array.isArray(intakeOutput?.legalIssues)
      ? intakeOutput.legalIssues
      : ["general legal issue"];

  return issueTags.slice(0, 3).map((issue, index) => ({
    id: `local-judgment-${index}`,
    title: `${issue} | Demo authority brief`,
    citation: `Local Demo Digest ${index + 1}`,
    court: "Research Workspace",
    bench: "AI matched brief",
    judgmentDate: new Date().toISOString().slice(0, 10),
    summary: `Working authority brief for ${issue}. Verify the latest Supreme Court or High Court judgment before relying on it.`,
    ratioNote: `Use ${issue} as the core issue while checking the latest live case law.`,
    treatmentStatus: "verify",
    issueTags: [issue],
    practicalUse: ["Use in research memo", "Verify against latest live judgment source"]
  }));
}

function buildLocalNoticePack({ intakeOutput, memoOutput, intakeChronology = [], chronologyText = "", caseTitle = "", caseNotes = "" }) {
  const matterTitle = intakeOutput?.matterTitle || caseTitle || "Legal Notice Draft";
  const factSummary = intakeOutput?.factSummary || caseNotes || "Relevant dispute facts to be verified.";
  const issues = Array.isArray(memoOutput?.issueList) && memoOutput.issueList.length
    ? memoOutput.issueList
    : Array.isArray(intakeOutput?.legalIssues)
      ? intakeOutput.legalIssues
      : ["Legal claim to be verified"];
  const chronologyPreview = intakeChronology.length
    ? intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n")
    : chronologyText || "Chronology to be confirmed.";

  return {
    noticeTitle: matterTitle,
    subjectLine: "Legal notice regarding demand and non-compliance",
    addresseeBlock: "[Name / Entity]\n[Address]",
    noticeDraft:
`LEGAL NOTICE

To,
[Name / Entity]
[Address]

Subject: Legal notice regarding demand and non-compliance.

Under instructions from my client, it is stated that:
1. ${factSummary}
2. The relevant dispute chronology includes:
${chronologyPreview}
3. The primary issues include: ${issues.join(", ")}.

You are called upon to comply / respond within the applicable notice period, failing which appropriate legal proceedings may be initiated.

Counsel for client`,
    annexures: ["Chronology and supporting records", "Underlying transaction documents", "Relevant correspondence"],
    filingReadiness: ["Verify addressee details", "Confirm relief and demand wording", "Review limitation / notice period"],
    retrievedAuthorities: []
  };
}

function buildLocalResearchOutput({ lawyerInput = "", memoOutput, relatedJudgments = [] }) {
  const lines = String(lawyerInput || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const bestCases = relatedJudgments.slice(0, 3).map((item) => ({
    title: item.title,
    citation: item.citation,
    whyItMatters: item.ratioNote || item.summary,
    status: item.treatmentStatus || "verify",
    sourceUrl: item.sourceUrl || "",
    court: item.court || "",
    judgmentDate: item.judgmentDate || ""
  }));
  const authorityClusters = relatedJudgments.length
    ? relatedJudgments.map((item) => ({
        issue: item.issueTags?.[0] || "general issue",
        authorities: [{
          title: item.title,
          citation: item.citation || "No citation",
          status: item.treatmentStatus || "verify",
          whyItMatters: item.ratioNote || item.summary,
          sourceUrl: item.sourceUrl || ""
        }]
      }))
    : [];

  return {
    caseSummary: lines[0] || memoOutput?.factSummary || "Fallback legal research summary generated from current matter context.",
    applicableSections: memoOutput?.issueList || ["Verify applicable statutory provisions"],
    caseLaws: bestCases.length ? bestCases : ["Verify latest leading judgments"],
    judgmentSummary: "Working research response prepared from the current matter, memo, and matched judgments. Verify authorities before final filing or advice.",
    bestCases,
    authorityClusters,
    relatedJudgments,
    traceability: buildLocalTraceability({
      facts: lawyerInput,
      authorities: bestCases,
      keyFactors: [
        lines[0] || "Research summary derived from current matter input.",
        "Matched judgments and current authority notes shaped this response."
      ],
      notes: ["Verify the exact proposition from the full judgment before final reliance."]
    })
  };
}

function buildLocalArgumentOutput({ matterId = "", facts = "", issues = [], jurisdiction = "", selectedCases = [], mode = "detailed" }) {
  const normalizedIssues = Array.isArray(issues) && issues.length ? issues : ["Issue framing pending"];
  const cases = Array.isArray(selectedCases) && selectedCases.length ? selectedCases : [];

  const buildSide = (side) => normalizedIssues.map((issue, index) => ({
    issue,
    side,
    arguments: [{
      title: `${side === "petitioner" ? "Petitioner" : "Respondent"} Argument ${index + 1}`,
      legalBasis: `${jurisdiction || "Applicable jurisdiction"} | ${issue}`,
      caseReferences: cases.slice(0, 3).map((item) => ({
        caseId: item.canonicalCaseId || item.id || "",
        title: item.title || "",
        citation: item.citation || "",
        validityStatus: "CAUTION",
        riskLevel: "MEDIUM"
      })),
      reasoning: `${side === "petitioner" ? "Support" : "Resist"} the issue using the selected facts and authorities. ${String(facts || "").trim() || "Facts should be mapped issue-wise."} ${mode === "court-ready" ? "Keep the final submissions concise." : "Expand the factual bridge and legal fit before filing."}`,
      riskNote: "Verify the latest authority status and factual fit before final reliance."
    }]
  }));

  return {
    matterId,
    mode,
    warnings: cases.length ? [] : ["No selected cases were provided. Argument quality will improve after choosing supporting authorities."],
    authorityReview: cases.map((item) => ({
      caseId: item.canonicalCaseId || item.id || "",
      title: item.title || "",
      citation: item.citation || "",
      status: "CAUTION",
      riskLevel: "MEDIUM",
      confidenceScore: 35
    })),
    petitionerArguments: buildSide("petitioner"),
    respondentArguments: buildSide("respondent")
  };
}

function buildLocalStrengthOutput({ matterId = "", facts = "", issues = [], documents = [], selectedCases = [] }) {
  const hasFacts = Boolean(String(facts || "").trim());
  const hasCases = Array.isArray(selectedCases) && selectedCases.length > 0;
  const hasDocuments = Array.isArray(documents) && documents.length > 0;
  const score = Math.max(15, Math.min(85, (hasFacts ? 30 : 10) + (hasCases ? 25 : 5) + (hasDocuments ? 25 : 5) + ((issues || []).length ? 10 : 0)));

  return {
    matterId,
    overallScore: score,
    strengthLevel: score >= 70 ? "STRONG" : score >= 45 ? "MODERATE" : "WEAK",
    winProbability: score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW",
    strengths: [
      hasFacts ? "Facts are available for structured case analysis." : "",
      hasCases ? "Supporting authorities are available for review." : ""
    ].filter(Boolean),
    weaknesses: [
      hasDocuments ? "" : "No documents were supplied for evidentiary support.",
      hasCases ? "" : "No selected precedent set was supplied."
    ].filter(Boolean),
    missingEvidence: hasDocuments ? [] : ["Primary documentary support"],
    riskAnalysis: [
      hasFacts ? "" : "Incomplete factual matrix may weaken pleadings and interim relief requests.",
      hasCases ? "" : "Opponent may rely on stronger precedent if authority support is not improved."
    ].filter(Boolean),
    suggestions: [
      hasDocuments ? "" : "Collect supporting documents and communication trail.",
      hasCases ? "" : "Add good-law authorities tied to each issue."
    ].filter(Boolean)
  };
}

function buildLocalPredictionOutput({
  facts = "",
  documentAnalysis = null,
  caseStrength = null,
  argumentsOutput = null,
  authorities = []
}) {
  const safeStrength = caseStrength || buildLocalStrengthOutput({
    facts,
    issues: [],
    documents: [],
    selectedCases: authorities
  });
  const safeDocument = documentAnalysis || buildLocalDocumentAnalysis({
    documentText: "",
    caseFacts: facts
  });

  let score = 0;
  score += Number(safeStrength.scoreBreakdown?.evidenceStrength || 25) * 0.4;
  score += Number(safeStrength.scoreBreakdown?.authorityFit || 25) * 0.25;
  score += Number(safeStrength.scoreBreakdown?.consistency || 25) * 0.2;
  score += Math.max(20, 100 - (((safeStrength.riskAnalysis || []).length + (safeDocument.risks || []).length) * 6)) * 0.15;

  const winProbability = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = winProbability >= 70 ? "LOW" : winProbability >= 45 ? "MEDIUM" : "HIGH";
  const confidenceScore = Math.max(20, Math.min(95, Math.round(
    (
      Number(safeStrength.scoreBreakdown?.evidenceStrength || 25) +
      Number(safeStrength.scoreBreakdown?.authorityFit || 25) +
      Number(safeStrength.scoreBreakdown?.consistency || 25)
    ) / 3
  )));

  return {
    winProbability,
    riskLevel,
    confidenceScore,
    keyFactors: [
      safeStrength.strengths?.[0] || "Evidence and authority fit drive the current prediction.",
      safeDocument.obligations?.length ? "Document obligations support enforceability analysis." : "",
      argumentsOutput?.warnings?.length ? argumentsOutput.warnings[0] : ""
    ].filter(Boolean),
    strengths: safeStrength.strengths || [],
    weaknesses: [
      ...(safeStrength.weaknesses || []),
      ...((safeDocument.missingPoints || []).map((item) => `Document gap: ${item}.`))
    ].filter((item, index, list) => list.indexOf(item) === index),
    improvementSuggestions: [
      ...(safeStrength.suggestions || []),
      ...((safeDocument.missingPoints || []).map((item) => `Address missing document point: ${item}.`))
    ].filter((item, index, list) => list.indexOf(item) === index),
    scoreBreakdown: {
      evidenceStrength: Number(safeStrength.scoreBreakdown?.evidenceStrength || 25),
      authorityQuality: Number(safeStrength.scoreBreakdown?.authorityFit || 25),
      consistency: Number(safeStrength.scoreBreakdown?.consistency || 25),
      riskPenaltyAdjusted: Math.max(20, 100 - (((safeStrength.riskAnalysis || []).length + (safeDocument.risks || []).length) * 6))
    },
    traceability: buildLocalTraceability({
      facts,
      authorities,
      scoreBreakdown: {
        evidenceStrength: Number(safeStrength.scoreBreakdown?.evidenceStrength || 25),
        authorityQuality: Number(safeStrength.scoreBreakdown?.authorityFit || 25),
        consistency: Number(safeStrength.scoreBreakdown?.consistency || 25),
        riskPenaltyAdjusted: Math.max(20, 100 - (((safeStrength.riskAnalysis || []).length + (safeDocument.risks || []).length) * 6))
      },
      keyFactors: [
        ...(safeStrength.strengths || []).slice(0, 2),
        ...(safeDocument.risks || []).slice(0, 2)
      ],
      notes: ["Prediction is weighted and explainable, but final strategy still requires lawyer review."]
    })
  };
}

function buildLocalReadinessOutput({
  facts = "",
  issues = [],
  documents = [],
  jurisdiction = "",
  draftText = "",
  draftType = "",
  caseStrength = null
}) {
  const safeStrength = caseStrength || buildLocalStrengthOutput({
    facts,
    issues,
    documents,
    selectedCases: []
  });

  const docText = `${draftText}\n${documents.map((item) => typeof item === "string" ? item : `${item.title || ""} ${item.content || item.summary || ""}`).join("\n")}`.toLowerCase();
  const checklist = [
    { key: "facts", label: "Material facts captured", status: facts.trim() ? "READY" : "MISSING", note: facts.trim() ? "Core facts are available." : "Complete the fact statement before filing." },
    { key: "issues", label: "Issues identified", status: issues.length ? "READY" : "MISSING", note: issues.length ? "Issue list is available." : "Frame the legal issues clearly." },
    { key: "jurisdiction", label: "Jurisdiction checked", status: jurisdiction || /jurisdiction/i.test(docText) ? "READY" : "MISSING", note: jurisdiction || /jurisdiction/i.test(docText) ? "Jurisdiction appears addressed." : "Confirm territorial and subject-matter jurisdiction." },
    { key: "documents", label: "Supporting documents attached", status: documents.length ? "READY" : "MISSING", note: documents.length ? "Supporting records are present." : "Attach the core supporting documents." },
    { key: "limitation", label: "Limitation / timing reviewed", status: /delay|limitation|within \d+ days|dated|date/i.test(`${facts}\n${draftText}`) ? "READY" : "CAUTION", note: /delay|limitation|within \d+ days|dated|date/i.test(`${facts}\n${draftText}`) ? "Timing appears to be considered." : "Review delay, limitation, and statutory deadlines explicitly." },
    { key: "prayer", label: "Prayer / relief section", status: /prayer|relief/i.test(draftText) ? "READY" : "MISSING", note: /prayer|relief/i.test(draftText) ? "Prayer section detected." : "Add a clear prayer / relief section." },
    { key: "annexures", label: "Annexures / enclosures", status: /annexure|enclosure|attached/i.test(draftText) || documents.length > 1 ? "READY" : "CAUTION", note: /annexure|enclosure|attached/i.test(draftText) || documents.length > 1 ? "Annexure support appears available." : "Prepare annexure and enclosure list." }
  ];

  if (String(draftType).toLowerCase() === "notice") {
    checklist.push({
      key: "notice_window",
      label: "Notice timeline stated",
      status: /within\s+\d+\s+days|15 days|30 days|statutory notice/i.test(`${facts}\n${draftText}`) ? "READY" : "MISSING",
      note: /within\s+\d+\s+days|15 days|30 days|statutory notice/i.test(`${facts}\n${draftText}`) ? "Notice compliance period is visible." : "State the exact compliance period before service."
    });
  }

  const readyCount = checklist.filter((item) => item.status === "READY").length;
  const cautionCount = checklist.filter((item) => item.status === "CAUTION").length;
  const readinessScore = Math.max(0, Math.min(100, Math.round(((readyCount + (cautionCount * 0.5)) / checklist.length) * 100)));

  return {
    readinessScore,
    readinessLevel: readinessScore >= 75 ? "READY" : readinessScore >= 45 ? "PARTIAL" : "NOT READY",
    summary: readinessScore >= 75
      ? "The matter appears substantially ready, subject to final lawyer verification."
      : readinessScore >= 45
        ? "The matter is partially ready but still needs targeted filing checks."
        : "The matter is not yet ready for filing or service.",
    checklist,
    missingItems: checklist.filter((item) => item.status === "MISSING").map((item) => item.label),
    criticalRisks: safeStrength.riskAnalysis || [],
    nextSteps: checklist.filter((item) => item.status !== "READY").map((item) => item.note)
  };
}

function buildLocalAuthorityGuardrails(selectedCases = []) {
  const cases = Array.isArray(selectedCases) ? selectedCases : [];
  const blockingWarnings = cases
    .filter((item) => String(item.validityStatus || item.status || item.treatmentStatus || "").toUpperCase().includes("BAD"))
    .map((item) => `Do not rely on ${item.title || item.citation || "this authority"} because it is flagged as bad law.`);
  const cautionWarnings = cases
    .filter((item) => !blockingWarnings.some((warning) => warning.includes(item.title || item.citation || "")))
    .filter((item) => {
      const status = String(item.validityStatus || item.status || item.treatmentStatus || "").toUpperCase();
      return !status || status.includes("CAUTION") || status.includes("VERIFY") || status.includes("DISTINGUISHED") || status.includes("GOOD LAW CHECK NEEDED");
    })
    .map((item) => `Use ${item.title || item.citation || "this authority"} cautiously and verify the exact proposition before final reliance.`);

  return {
    status: blockingWarnings.length ? "BLOCK" : cautionWarnings.length ? "WARN" : "CLEAR",
    blockingWarnings,
    cautionWarnings,
    reviewedAuthorities: cases.map((item) => ({
      caseId: item.caseId || item.canonicalCaseId || item.id || "",
      title: item.title || "",
      citation: item.citation || "",
      status: item.validityStatus || item.status || item.treatmentStatus || "CAUTION",
      riskLevel: item.riskLevel || "MEDIUM",
      confidenceScore: item.confidenceScore || 35,
      summary: item.summary || item.ratioNote || ""
    }))
  };
}

function getStrengthTone(level) {
  if (level === "STRONG") return { color: "#1f7a3d", background: "#dff6e6" };
  if (level === "MODERATE") return { color: "#8a6500", background: "#fff5d6" };
  return { color: "#9f1d1d", background: "#fde3e3" };
}

function buildLocalDocumentAnalysis({ documentText = "", caseFacts = "" }) {
  const lines = String(documentText || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const lowered = String(documentText || "").toLowerCase();
  const documentType = /agreement/i.test(documentText)
    ? "agreement"
    : /legal notice|hereby called upon/i.test(documentText)
      ? "notice"
      : /affidavit/i.test(documentText)
        ? "affidavit"
        : "general legal document";

  const keyFacts = lines.filter((line) => /\d|dated|issued|paid|served|dishonou?r|agreement|notice|amount/i.test(line)).slice(0, 8);
  const importantClauses = lines.filter((line) => /jurisdiction|termination|payment|liability|notice|arbitration|indemnity/i.test(line)).slice(0, 8);
  const importantClauseRefs = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /jurisdiction|termination|payment|liability|notice|arbitration|indemnity/i.test(line))
    .slice(0, 8)
    .map(({ line, index }) => ({
      clauseTitle: line.split(":")[0] || `Clause ${index + 1}`,
      clauseText: line,
      location: `Paragraph ${index + 1}`
    }));
  const risks = [
    !/date|dated/i.test(lowered) ? "Absence of precise dates may weaken chronology and limitation analysis." : "",
    documentType === "agreement" && !/jurisdiction/i.test(lowered) ? "Jurisdiction clause is not clearly visible." : "",
    /may|possibly|subject to/i.test(lowered) ? "Ambiguous or qualified language may weaken enforceability." : ""
  ].filter(Boolean);
  const missingPoints = [
    !/signature|signed/i.test(lowered) ? "Signature block" : "",
    documentType === "notice" && !/within|days/i.test(lowered) ? "Compliance timeline" : "",
    documentType === "agreement" && !/payment|consideration/i.test(lowered) ? "Payment / consideration clause" : ""
  ].filter(Boolean);
  const suggestedArguments = [
    /cheque|dishonou?r|bank memo/i.test(lowered) ? "Use the dishonour event, cheque details, and bank memo facts to support statutory compliance and liability." : "",
    /agreement|payment|breach/i.test(lowered) ? "Frame breach, payment default, and contractual obligation arguments clause-wise." : "",
    /notice/i.test(lowered) ? "Highlight service, demand, and response timeline to strengthen cause of action." : ""
  ].filter(Boolean);
  const legalEntities = lines
    .filter((line) => /client|borrower|noticee|party|petitioner|respondent|complainant|accused|company|bank/i.test(line))
    .slice(0, 8);
  const obligations = lines
    .filter((line) => /shall|must|liable|obliged|required to|within \d+ days|pay|deliver|perform/i.test(line))
    .slice(0, 8);
  const legalIssues = [
    /cheque|dishonou?r/i.test(lowered) ? "Cheque dishonour compliance and liability." : "",
    /breach|default|non-payment|payment/i.test(lowered) ? "Breach / default and enforceability of payment obligation." : "",
    /notice|served|reply/i.test(lowered) ? "Service of notice and response timeline." : ""
  ].filter(Boolean);
  const contradictionsWithCase = caseFacts
    ? String(caseFacts).split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !lowered.includes(line.toLowerCase().slice(0, Math.min(line.length, 20)))).slice(0, 5).map((line) => `Case fact not clearly reflected in document: ${line}`)
    : [];

  return {
    summary: lines.slice(0, 4).join(" ") || "Document text requires detailed legal review.",
    keyFacts,
    importantClauses,
    importantClauseRefs,
    risks,
    missingPoints,
    suggestedArguments: suggestedArguments.length ? suggestedArguments : ["Map the key factual assertions in this document to the pleaded legal issues and supporting evidence."],
    documentType,
    legalEntities,
    obligations,
    legalIssues,
    contradictionsWithCase,
    missingElements: missingPoints,
    legalRisks: risks,
    traceability: buildLocalTraceability({
      facts: caseFacts || documentText,
      documents: [{ title: "Analyzed document", excerpt: documentText }],
      keyFactors: [
        lines.slice(0, 2).join(" ") || "Document text was analyzed directly.",
        ...risks.slice(0, 2)
      ],
      notes: ["Compare the extracted clauses and risks against the final case theory."]
    })
  };
}

function buildLocalMatterConsistencyOutput({
  facts = "",
  chronologyText = "",
  hearingNotes = "",
  draftText = "",
  issues = [],
  documentAnalysis = null,
  argumentOutput = null
}) {
  const contradictions = [];
  const normalizedFacts = String(facts || "").trim();
  const normalizedChronology = String(chronologyText || "").trim();
  const normalizedDraft = String(draftText || "").trim().toLowerCase();

  if (!normalizedFacts) contradictions.push("Core facts are missing or incomplete.");
  if (!normalizedChronology) contradictions.push("Chronology is missing or not yet prepared.");
  if (documentAnalysis?.contradictionsWithCase?.length) {
    contradictions.push(...documentAnalysis.contradictionsWithCase.slice(0, 4));
  }

  const missingCoverage = (Array.isArray(issues) ? issues : [])
    .filter(Boolean)
    .filter((issue) => !normalizedDraft.includes(String(issue).toLowerCase().split(" ")[0]))
    .slice(0, 5)
    .map((issue) => `Issue not clearly reflected in current matter materials: ${issue}.`);

  const narrativeWeaknesses = [
    !/\b\d{4}-\d{2}-\d{2}\b/.test(`${normalizedFacts}\n${normalizedChronology}`) ? "No dated events were clearly found across facts and chronology." : "",
    /unknown|unclear|maybe|perhaps|not sure/i.test(`${normalizedFacts}\n${hearingNotes}`) ? "Matter inputs still contain uncertainty markers." : "",
    Array.isArray(argumentOutput?.warnings) && argumentOutput.warnings.length ? `Argument warning: ${argumentOutput.warnings[0]}` : ""
  ].filter(Boolean);

  const consistencyScore = Math.max(0, Math.min(100, 86 - contradictions.length * 14 - missingCoverage.length * 8 - narrativeWeaknesses.length * 6));

  return {
    consistencyScore,
    consistencyLevel: consistencyScore >= 75 ? "ALIGNED" : consistencyScore >= 50 ? "CAUTION" : "CONFLICTED",
    summary: consistencyScore >= 75
      ? "The current matter materials are broadly aligned."
      : consistencyScore >= 50
        ? "Some mismatch or coverage gaps exist across the current matter materials."
        : "Material contradictions or narrative gaps should be resolved before relying on this matter record.",
    contradictions: contradictions.slice(0, 8),
    missingCoverage,
    narrativeWeaknesses,
    suggestions: [
      contradictions.length ? "Resolve mismatches between facts, chronology, and supporting material before filing." : "",
      missingCoverage.length ? "Add issue-wise support in facts, documents, or draft text for the uncovered issues." : "",
      narrativeWeaknesses.some((item) => /uncertainty/i.test(item)) ? "Replace uncertain language with verified facts or mark it for lawyer confirmation." : "",
      !normalizedChronology ? "Prepare a dated chronology and align all downstream drafts to it." : ""
    ].filter(Boolean),
    signalCount: contradictions.length + missingCoverage.length + narrativeWeaknesses.length
  };
}

function buildLocalCoverageOutput({
  facts = "",
  issues = [],
  documents = [],
  draftText = "",
  selectedCases = [],
  caseStrength = null,
  argumentOutput = null
}) {
  const normalizedIssues = (Array.isArray(issues) ? issues : []).filter(Boolean);
  const sourceIssues = normalizedIssues.length ? normalizedIssues : ["General matter coverage"];
  const loweredFacts = String(facts || "").toLowerCase();
  const loweredDraft = String(draftText || "").toLowerCase();
  const docs = (Array.isArray(documents) ? documents : []).map((item) => typeof item === "string" ? item : `${item.title || ""} ${item.content || item.text || item.summary || ""}`.trim());
  const authorities = Array.isArray(selectedCases) ? selectedCases : [];
  const risks = Array.isArray(caseStrength?.riskAnalysis) ? caseStrength.riskAnalysis : [];
  const argumentSections = [
    ...((argumentOutput?.petitionerArguments || [])),
    ...((argumentOutput?.respondentArguments || []))
  ];

  const matrix = sourceIssues.map((issue) => {
    const needle = String(issue).toLowerCase().split(" ").find((token) => token.length > 3) || String(issue).toLowerCase();
    const factSupport = loweredFacts.includes(needle);
    const documentSupport = docs.some((item) => item.toLowerCase().includes(needle));
    const authoritySupport = authorities.some((item) => `${item.title || ""} ${item.summary || ""} ${item.ratioNote || ""}`.toLowerCase().includes(needle));
    const argumentSupport = argumentSections.some((section) => `${section.issue || ""} ${(section.arguments || []).map((entry) => `${entry.title || ""} ${entry.reasoning || ""}`).join(" ")}`.toLowerCase().includes(needle));
    const draftSupport = loweredDraft.includes(needle);
    const riskReviewed = risks.some((item) => String(item).toLowerCase().includes(needle));
    const yesCount = [factSupport, documentSupport, authoritySupport, argumentSupport, draftSupport].filter(Boolean).length;

    return {
      issue,
      coverageStatus: yesCount >= 4 ? "STRONG" : yesCount >= 2 ? "PARTIAL" : "WEAK",
      factSupport: factSupport ? "YES" : "NO",
      documentSupport: documentSupport ? "YES" : "NO",
      authoritySupport: authoritySupport ? "YES" : "NO",
      argumentSupport: argumentSupport ? "YES" : "NO",
      draftSupport: draftSupport ? "YES" : "NO",
      riskReviewed: riskReviewed ? "YES" : "NO",
      matchedDocuments: [],
      matchedAuthorities: [],
      notes: [
        factSupport ? "Facts mention this issue." : "Facts do not clearly cover this issue.",
        documentSupport ? "Documents support this issue." : "No document support is clearly mapped to this issue.",
        authoritySupport ? "Authorities are mapped to this issue." : "Authority support is thin or not mapped issue-wise.",
        draftSupport ? "Draft text reflects this issue." : "Current draft does not clearly reflect this issue."
      ]
    };
  });

  const overallScore = Math.round(matrix.reduce((sum, item) => sum + (item.coverageStatus === "STRONG" ? 100 : item.coverageStatus === "PARTIAL" ? 60 : 25), 0) / matrix.length);

  return {
    overallScore,
    coverageLevel: overallScore >= 75 ? "WELL COVERED" : overallScore >= 50 ? "PARTIAL COVERAGE" : "GAP HEAVY",
    summary: overallScore >= 75
      ? "Most issues have aligned support."
      : overallScore >= 50
        ? "Some issues are covered well, but several still need evidence, authority, or draft support."
        : "Multiple issues remain under-supported.",
    matrix,
    gaps: matrix.filter((item) => item.coverageStatus !== "STRONG").map((item) => `${item.issue}: facts=${item.factSupport}, docs=${item.documentSupport}, authority=${item.authoritySupport}, draft=${item.draftSupport}`),
    suggestions: matrix.filter((item) => item.coverageStatus !== "STRONG").flatMap((item) => [
      item.documentSupport === "NO" ? `Add document support for issue: ${item.issue}.` : "",
      item.authoritySupport === "NO" ? `Map at least one strong authority to issue: ${item.issue}.` : "",
      item.draftSupport === "NO" ? `Ensure the draft expressly addresses issue: ${item.issue}.` : ""
    ].filter(Boolean)).slice(0, 10),
    stats: {
      issueCount: matrix.length,
      strongCount: matrix.filter((item) => item.coverageStatus === "STRONG").length,
      weakCount: matrix.filter((item) => item.coverageStatus === "WEAK").length
    }
  };
}

function buildLocalDraftValidationOutput({ draftText = "", draftType = "petition", courtType = "" }) {
  const text = String(draftText || "");
  const type = String(draftType || "petition").toLowerCase();
  const checks = [
    { key: "heading", label: "Court heading present", passed: /in the court|in the hon'?ble/i.test(text), note: "Draft should begin with a proper court heading.", severity: "high" },
    { key: "parties", label: "Party block present", passed: /versus|petitioner|plaintiff|respondent|defendant|complainant|accused/i.test(text), note: "Party names / roles should be shown clearly.", severity: "high" },
    { key: "facts", label: "Structured facts present", passed: /facts of the case|facts|most respectfully showeth/i.test(text), note: "Facts section should be clearly structured.", severity: "high" },
    { key: "signature", label: "Signature block present", passed: /signature block|counsel for|deponent|signed by|advocate for/i.test(text), note: "Signature / counsel block should be present.", severity: "medium" }
  ];

  if (type === "petition") {
    checks.push(
      { key: "grounds", label: "Legal grounds present", passed: /legal grounds|grounds/i.test(text), note: "Petitions should contain a dedicated legal grounds section.", severity: "high" },
      { key: "cause", label: "Cause of action present", passed: /cause of action/i.test(text), note: "Cause of action section is expected in petitions.", severity: "high" },
      { key: "prayer", label: "Prayer section present", passed: /prayer|relief/i.test(text), note: "Petitions should end with clear prayers / reliefs.", severity: "high" }
    );
  }

  if (type === "notice") {
    checks.push(
      { key: "subject", label: "Subject line present", passed: /subject:/i.test(text), note: "Legal notices should carry a clear subject line.", severity: "high" },
      { key: "demand", label: "Demand / compliance clause present", passed: /demand|called upon|comply within|failing which/i.test(text), note: "Notice should include a clear compliance demand and consequence clause.", severity: "high" }
    );
  }

  if (type === "affidavit") {
    checks.push(
      { key: "verification", label: "Verification paragraph present", passed: /verification|true and correct|knowledge and belief/i.test(text), note: "Affidavit must contain a verification paragraph.", severity: "high" },
      { key: "deponent", label: "Deponent block present", passed: /deponent/i.test(text), note: "Affidavit should contain a deponent block.", severity: "high" }
    );
  }

  const passedCount = checks.filter((item) => item.passed).length;
  const validationScore = Math.round((passedCount / checks.length) * 100);

  return {
    validationScore,
    validationLevel: validationScore >= 80 ? "COURT READY" : validationScore >= 55 ? "REVIEW REQUIRED" : "NEEDS WORK",
    summary: validationScore >= 80
      ? "The draft appears structurally close to court-ready."
      : validationScore >= 55
        ? "The draft has core structure but still needs targeted correction."
        : "The draft is missing important court-facing sections or formatting blocks.",
    checks,
    missingSections: checks.filter((item) => !item.passed).map((item) => item.label),
    criticalIssues: checks.filter((item) => !item.passed && item.severity === "high").map((item) => item.note),
    suggestions: checks.filter((item) => !item.passed).map((item) => item.note),
    courtType: String(courtType || "general"),
    draftType: type
  };
}

function buildLocalFilingPackOutput({
  readiness = null,
  consistency = null,
  coverage = null,
  draftValidation = null
}) {
  const readinessScore = Number(readiness?.readinessScore || 0);
  const consistencyScore = Number(consistency?.consistencyScore || 0);
  const coverageScore = Number(coverage?.overallScore || 0);
  const draftValidationScore = Number(draftValidation?.validationScore || 0);
  const filingScore = Math.round((readinessScore * 0.3) + (consistencyScore * 0.25) + (coverageScore * 0.2) + (draftValidationScore * 0.25));

  const blockers = [
    ...((readiness?.missingItems || []).slice(0, 4).map((item) => `Readiness blocker: ${item}`)),
    ...((consistency?.contradictions || []).slice(0, 4).map((item) => `Consistency blocker: ${item}`)),
    ...((draftValidation?.criticalIssues || []).slice(0, 4).map((item) => `Draft blocker: ${item}`))
  ];

  return {
    filingScore,
    filingDecision: blockers.length ? "HOLD" : filingScore >= 80 ? "READY TO FILE" : filingScore >= 60 ? "REVIEW BEFORE FILING" : "NOT READY",
    summary: blockers.length
      ? "The filing pack still has blocking issues that should be resolved before filing."
      : filingScore >= 80
        ? "The filing pack appears substantially ready, subject to final lawyer sign-off."
        : "The filing pack is usable for review, but still needs targeted correction before filing.",
    blockers,
    warnings: [...(coverage?.gaps || []).slice(0, 5), ...(readiness?.criticalRisks || []).slice(0, 4)],
    recommendations: [
      ...(readiness?.nextSteps || []).slice(0, 5),
      ...(consistency?.suggestions || []).slice(0, 5),
      ...(coverage?.suggestions || []).slice(0, 5),
      ...(draftValidation?.suggestions || []).slice(0, 5)
    ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 12),
    componentScores: {
      readiness: readinessScore,
      consistency: consistencyScore,
      coverage: coverageScore,
      draftValidation: draftValidationScore,
      authorityFreshness: 35
    },
    readiness,
    consistency,
    coverage,
    draftValidation,
    authorityFreshness: {
      score: 35,
      staleAuthorities: [],
      badAuthorities: [],
      authorityChecks: []
    }
  };
}

function buildDocumentMemoText(analysis = {}, options = {}) {
  const clientLabel = String(options.clientLabel || "").trim();
  const matterLabel = String(options.matterLabel || "").trim();
  const section = (title, items = [], fallback = "") => {
    if (Array.isArray(items) && items.length) {
      return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
    }
    if (fallback) {
      return `${title}\n${fallback}`;
    }
    return "";
  };

  return [
    "DOCUMENT ANALYSIS MEMO",
    "",
    clientLabel || matterLabel
      ? `CLIENT / MATTER\n${[
          clientLabel ? `Client: ${clientLabel}` : "",
          matterLabel ? `Matter: ${matterLabel}` : ""
        ].filter(Boolean).join("\n")}`
      : "",
    analysis.summary ? `SUMMARY\n${analysis.summary}` : "",
    section("KEY FACTS", analysis.keyFacts, "No material factual points were extracted with confidence."),
    section("IMPORTANT CLAUSES", analysis.importantClauses, "No clause-level highlights were confidently extracted."),
    section("LEGAL ISSUES IDENTIFIED", analysis.legalIssues, "Issue mapping should be confirmed against the current pleading theory."),
    section("OBLIGATIONS", analysis.obligations, "No express obligation language was clearly detected."),
    section("RISKS", analysis.risks, "No immediate drafting risk was flagged from the available text."),
    section("MISSING POINTS", analysis.missingPoints, "No major structural omissions were detected from the available text."),
    section("CONTRADICTIONS WITH CASE", analysis.contradictionsWithCase, "No clear contradiction with the supplied case facts was detected."),
    section("SUGGESTED LEGAL STRATEGY", analysis.suggestedArguments, "Tie the extracted facts and clauses to the most defensible legal theory before use."),
    "",
    "Prepared for professional legal review. Verify final facts, statutory references, and filing strategy before use."
  ].filter(Boolean).join("\n\n");
}

function buildLocalDraftOutput({ draftType = "petition", facts = "", mode = "court-ready" }) {
  const normalizedType = String(draftType || "petition").trim().toLowerCase();
  const normalizedMode = String(mode || "court-ready").trim().toLowerCase() === "editable" ? "editable" : "court-ready";
  const lines = String(facts || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const factBlock = (lines.length ? lines : ["Facts to be inserted after client verification."])
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
  const chequeSections = /cheque|138|dishonou?r|bank memo/i.test(facts) ? ["Section 138 of the Negotiable Instruments Act, 1881"] : [];
  const generalSections = chequeSections.length ? chequeSections : ["Applicable statutory provisions to be verified from the final brief."];

  if (normalizedType === "notice") {
    return {
      draft:
`LEGAL NOTICE

FROM:
${normalizedMode === "editable" ? "[CLIENT / ADVOCATE DETAILS]" : "COUNSEL FOR THE CLAIMANT / COMPLAINANT"}

TO:
${normalizedMode === "editable" ? "[NOTICEE DETAILS]" : "THE NOTICEE / OPPOSITE PARTY"}

SUBJECT:
${normalizedMode === "editable" ? "[SUBJECT TO BE INSERTED]" : "Notice calling upon you to discharge your legal liability"}

UNDER INSTRUCTIONS from and on behalf of my client, I hereby state as follows:

FACTS
${factBlock}

LEGAL BASIS
${generalSections.map((item, index) => `${index + 1}. ${item}.`).join("\n")}

CAUSE OF ACTION
The cause of action has arisen from the acts and omissions stated above, which require immediate legal compliance by you.

DEMAND / PRAYER
${normalizedMode === "editable"
  ? "[DEMAND / COMPLIANCE CLAUSE TO BE INSERTED]"
  : "You are hereby finally called upon to comply within the legally permissible period, failing which appropriate proceedings shall be initiated at your cost and risk."}

PLACE:
DATE:

COUNSEL FOR THE NOTICE ISSUER
[SIGNATURE BLOCK]`,
      mode: normalizedMode,
      sections: generalSections
    };
  }

  if (normalizedType === "agreement") {
    return {
      draft:
`AGREEMENT

THIS AGREEMENT is made on the date to be finally inserted after verification.

BETWEEN
[FIRST PARTY DETAILS]

AND

[SECOND PARTY DETAILS]

RECITALS
${factBlock}

OPERATIVE CLAUSES
1. Scope and obligations
2. Consideration and payment terms
3. Representations and warranties
4. Default and remedies
5. Governing law and jurisdiction

SIGNATURE BLOCK
${normalizedMode === "editable" ? "[SIGNATURES / WITNESSES TO BE INSERTED]" : "SIGNED by the parties after final legal verification."}`,
      mode: normalizedMode,
      sections: generalSections
    };
  }

  if (normalizedType === "affidavit") {
    return {
      draft:
`AFFIDAVIT

${normalizedMode === "editable" ? "[DEPONENT DETAILS TO BE INSERTED]" : "I, the deponent named below, do hereby solemnly affirm and state as follows:"}

${factBlock}

VERIFICATION
The contents stated above are true and correct to my knowledge and belief, and nothing material has been concealed therefrom.

PLACE:
DATE:

DEPONENT
[SIGNATURE BLOCK]`,
      mode: normalizedMode,
      sections: generalSections
    };
  }

  return {
    draft:
`IN THE COURT OF THE HON'BLE [COURT NAME]
${normalizedMode === "editable" ? "[JURISDICTION TO BE INSERTED]" : "AT [JURISDICTION TO BE CONFIRMED]"}

[PETITIONER / PLAINTIFF NAME]
Petitioner / Plaintiff

VERSUS

[RESPONDENT / DEFENDANT NAME]
Respondent / Defendant

PETITION / PLAINT

MOST RESPECTFULLY SHOWETH:

FACTS OF THE CASE
${factBlock}

LEGAL GROUNDS
${generalSections.map((item, index) => `${String.fromCharCode(65 + index)}. The facts disclosed above attract ${item}.`).join("\n")}

CAUSE OF ACTION
The cause of action arose when the acts and omissions stated above gave rise to a legally enforceable grievance within the jurisdiction of this Hon'ble Court.

PRAYER
${normalizedMode === "editable"
  ? "[SPECIFIC RELIEFS TO BE INSERTED]"
  : "It is therefore prayed that this Hon'ble Court may be pleased to grant appropriate relief in accordance with law and the facts stated herein."}

PLACE:
DATE:

COUNSEL FOR THE PETITIONER / PLAINTIFF
[SIGNATURE BLOCK]`,
    mode: normalizedMode,
    sections: generalSections
  };
}

function LawAssistantPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const account = getStoredAccount();
  const publicProfile = getStoredProfile("public");
  const lawyerProfile = getStoredProfile("lawyer");

  const queryMode = searchParams.get("mode");
  const [mode, setMode] = useState(queryMode === "lawyer" ? "lawyer" : "public");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [publicProblem, setPublicProblem] = useState("");
  const [publicLocation, setPublicLocation] = useState("");
  const [publicLanguage, setPublicLanguage] = useState("english");
  const [publicDocText, setPublicDocText] = useState("");
  const [publicExtractionMeta, setPublicExtractionMeta] = useState(null);
  const [publicOutput, setPublicOutput] = useState(null);

  const [lawyerTab, setLawyerTab] = useState("research");
  const [lawyerInput, setLawyerInput] = useState("");
  const [lawyerEvidence, setLawyerEvidence] = useState("");
  const [draftType, setDraftType] = useState("petition");
  const [draftMode, setDraftMode] = useState("court-ready");
  const [docText, setDocText] = useState("");
  const [draftCourtType, setDraftCourtType] = useState("general");
  const [documentCompareFacts, setDocumentCompareFacts] = useState("");
  const [documentMemoMode, setDocumentMemoMode] = useState(false);
  const [intakeFacts, setIntakeFacts] = useState("");
  const [intakeDocText, setIntakeDocText] = useState("");
  const [intakeExtractionMeta, setIntakeExtractionMeta] = useState(null);
  const [intakeOutput, setIntakeOutput] = useState(null);
  const [intakeChronology, setIntakeChronology] = useState([]);
  const [memoOutput, setMemoOutput] = useState(null);
  const [argumentOutput, setArgumentOutput] = useState(null);
  const [strengthOutput, setStrengthOutput] = useState(null);
  const [predictionOutput, setPredictionOutput] = useState(null);
  const [readinessOutput, setReadinessOutput] = useState(null);
  const [consistencyOutput, setConsistencyOutput] = useState(null);
  const [coverageOutput, setCoverageOutput] = useState(null);
  const [draftValidationOutput, setDraftValidationOutput] = useState(null);
  const [filingPackOutput, setFilingPackOutput] = useState(null);
  const [authorityGuardrails, setAuthorityGuardrails] = useState({ status: "CLEAR", blockingWarnings: [], cautionWarnings: [], reviewedAuthorities: [] });
  const [reviewRecords, setReviewRecords] = useState([]);
  const [reviewSnapshots, setReviewSnapshots] = useState([]);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [noticeOutput, setNoticeOutput] = useState(null);
  const [lawyerExtractionMeta, setLawyerExtractionMeta] = useState(null);
  const [lawyerOutput, setLawyerOutput] = useState(null);

  const [clients, setClients] = useState([]);
  const [cases, setCases] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [billingConfig, setBillingConfig] = useState({ enabled: false, keyId: "" });

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [caseStage, setCaseStage] = useState("Draft");
  const [caseNextDate, setCaseNextDate] = useState("");
  const [caseNotes, setCaseNotes] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memorySummary, setMemorySummary] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memorySuggestions, setMemorySuggestions] = useState([]);
  const [savedMemories, setSavedMemories] = useState([]);
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [judgments, setJudgments] = useState([]);
  const [relatedJudgments, setRelatedJudgments] = useState([]);
  const [selectedJudgment, setSelectedJudgment] = useState(null);
  const [caseValidityMap, setCaseValidityMap] = useState({});
  const [caseValidityLoadingKey, setCaseValidityLoadingKey] = useState("");
  const [citationView, setCitationView] = useState(null);
  const [citationLoading, setCitationLoading] = useState(false);
  const [citationExpanded, setCitationExpanded] = useState({});
  const [compareJudgments, setCompareJudgments] = useState([]);
  const [judgmentQuery, setJudgmentQuery] = useState("");
  const [judgmentCourt, setJudgmentCourt] = useState("all");
  const [judgmentStatus, setJudgmentStatus] = useState("all");
  const [judgmentDateWindow, setJudgmentDateWindow] = useState("all");
  const [judgmentFeedMode, setJudgmentFeedMode] = useState("demo");
  const [judgmentSourceMode, setJudgmentSourceMode] = useState("cache");
  const [argumentSide, setArgumentSide] = useState("petitioner");
  const [argumentMode, setArgumentMode] = useState("detailed");
  const [judgmentSyncStatus, setJudgmentSyncStatus] = useState(null);
  const [judgmentSources, setJudgmentSources] = useState([]);
  const [judgmentTemplates, setJudgmentTemplates] = useState([]);
  const [auditFilter, setAuditFilter] = useState("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedMatterId, setSelectedMatterId] = useState("");
  const [chronologyText, setChronologyText] = useState("");
  const [hearingNotes, setHearingNotes] = useState("");

  const ownerId = account?.uid || "anonymous";

  const hasRole = useMemo(() => {
    const roles = account?.roles || [];
    return {
      public: roles.includes("public"),
      lawyer: roles.includes("lawyer")
    };
  }, [account]);

  const aiUsage = Number(subscription?.monthlyUsage || 0);
  const aiLimit = Number(subscription?.monthlyLimit || 0);
  const aiRemaining = Math.max(0, aiLimit - aiUsage);
  const isAiTab = ["intake", "memo", "notice", "research", "draft", "analyzer", "document"].includes(lawyerTab);
  const canRunLawyerAi = !isAiTab || !billingConfig.enabled || (subscription?.status === "active" && aiRemaining > 0);
  const workflowAlerts = useMemo(() => {
    const caseAlerts = (cases || [])
      .map((item) => ({
        id: `case-${item.id}`,
        title: item.title || "Untitled case",
        source: "Case hearing",
        severity: getDateSeverity(item.nextHearingDate)
      }))
      .filter((item) => item.severity.diff !== null)
      .sort((a, b) => a.severity.diff - b.severity.diff);

    const taskAlerts = (tasks || [])
      .map((item) => ({
        id: `task-${item.id}`,
        title: item.title || "Untitled task",
        source: "Task deadline",
        severity: getDateSeverity(item.dueDate)
      }))
      .filter((item) => item.severity.diff !== null)
      .sort((a, b) => a.severity.diff - b.severity.diff);

    return [...caseAlerts, ...taskAlerts].slice(0, 8);
  }, [cases, tasks]);
  const selectedMatter = useMemo(
    () => (cases || []).find((item) => item.id === selectedMatterId) || null,
    [cases, selectedMatterId]
  );
  const selectedClient = useMemo(
    () => (clients || []).find((item) => item.id === selectedClientId) || null,
    [clients, selectedClientId]
  );
  const selectedMatterClient = useMemo(
    () => (clients || []).find((item) => item.id === selectedMatter?.clientId) || null,
    [clients, selectedMatter?.clientId]
  );
  const chronologyEntries = useMemo(
    () => buildChronology(chronologyText),
    [chronologyText]
  );
  const selectedMatterTasks = useMemo(() => {
    if (!selectedMatter) return tasks || [];
    const titleNeedle = String(selectedMatter.title || "").toLowerCase();
    return (tasks || []).filter((task) => {
      const taskText = `${task.title || ""} ${task.relatedCaseId || ""}`.toLowerCase();
      return task.relatedCaseId === selectedMatter.id || (titleNeedle && taskText.includes(titleNeedle));
    });
  }, [selectedMatter, tasks]);
  const practiceSummary = useMemo(() => ([
    { label: "Clients", value: clients.length },
    { label: "Matters", value: cases.length },
    { label: "Open tasks", value: tasks.filter((item) => item.status !== "done").length },
    { label: "Drafts", value: savedDrafts.length },
    { label: "Memory", value: savedMemories.length }
  ]), [clients, cases, tasks, savedDrafts, savedMemories]);
  const usageSummary = billingConfig.enabled
    ? `Usage ${aiUsage}/${aiLimit || "--"}`
    : `Free trial check mode | Usage ${aiUsage}/${aiLimit || "--"}`;
  const filteredAuditLogs = useMemo(() => {
    if (auditFilter === "all") return auditLogs;
    if (auditFilter === "ok") return (auditLogs || []).filter((item) => item.status === "ok");
    if (auditFilter === "error") return (auditLogs || []).filter((item) => item.status === "error" || item.status === "blocked");
    return (auditLogs || []).filter((item) => item.action === auditFilter);
  }, [auditFilter, auditLogs]);
  const todayQueue = useMemo(() => {
    const urgentTasks = (tasks || [])
      .filter((item) => item.status !== "done")
      .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")))
      .slice(0, 4)
      .map((item) => ({
        id: `task-${item.id}`,
        title: item.title || "Untitled task",
        meta: item.dueDate || "No deadline",
        type: "task"
      }));

    const urgentMatters = (cases || [])
      .filter((item) => item.nextHearingDate)
      .sort((a, b) => String(a.nextHearingDate || "").localeCompare(String(b.nextHearingDate || "")))
      .slice(0, 4)
      .map((item) => ({
        id: `case-${item.id}`,
        title: item.title || "Untitled case",
        meta: item.nextHearingDate || "No hearing date",
        type: "matter"
      }));

    return [...urgentTasks, ...urgentMatters].slice(0, 6);
  }, [tasks, cases]);
  const resumeDrafts = useMemo(() => (savedDrafts || []).slice(0, 4), [savedDrafts]);
  const redFlagItems = useMemo(() => {
    const matterFlags = (cases || []).flatMap((item) => {
      const flags = [];
      if (!item.nextHearingDate) {
        flags.push({
          id: `matter-no-date-${item.id}`,
          title: item.title || "Untitled case",
          reason: "No next hearing date",
          type: "matter"
        });
      }
      if (!item.notes) {
        flags.push({
          id: `matter-no-notes-${item.id}`,
          title: item.title || "Untitled case",
          reason: "Matter notes missing",
          type: "matter"
        });
      }
      return flags;
    });

    const taskFlags = (tasks || [])
      .filter((item) => item.status !== "done")
      .filter((item) => {
        const severity = getDateSeverity(item.dueDate);
        return severity.type === "danger" || !item.dueDate;
      })
      .map((item) => ({
        id: `task-flag-${item.id}`,
        title: item.title || "Untitled task",
        reason: item.dueDate ? `Overdue or urgent deadline: ${item.dueDate}` : "Task has no deadline",
        type: "task"
      }));

    return [...matterFlags, ...taskFlags].slice(0, 8);
  }, [cases, tasks]);
  const continueMatter = useMemo(() => {
    if (selectedMatter) {
      return {
        id: selectedMatter.id,
        title: selectedMatter.title || "Untitled case",
        meta: selectedMatter.nextHearingDate || selectedMatter.stage || "Open matter"
      };
    }

    const latestMatter = (cases || [])
      .slice()
      .sort((a, b) => String(b.updatedAt?._seconds || 0).localeCompare(String(a.updatedAt?._seconds || 0)))[0];

    if (!latestMatter) return null;

    return {
      id: latestMatter.id,
      title: latestMatter.title || "Untitled case",
      meta: latestMatter.nextHearingDate || latestMatter.stage || "Open matter"
    };
  }, [cases, selectedMatter]);
  const judgmentContextText = useMemo(() => ([
    intakeOutput?.matterTitle,
    intakeOutput?.factSummary,
    Array.isArray(intakeOutput?.legalIssues) ? intakeOutput.legalIssues.join(" ") : "",
    Array.isArray(memoOutput?.issueList) ? memoOutput.issueList.join(" ") : "",
    selectedMatter?.title,
    selectedMatter?.notes,
    lawyerInput
  ].filter(Boolean).join("\n\n")), [intakeOutput, memoOutput, selectedMatter, lawyerInput]);
  const selectedJudgmentValidity = useMemo(() => {
    const key = getJudgmentValidityKey(selectedJudgment);
    return key ? caseValidityMap[key] || null : null;
  }, [caseValidityMap, selectedJudgment]);
  const demoChecklist = useMemo(
    () => buildDemoChecklist({ intakeOutput, memoOutput, noticeOutput, relatedJudgments }),
    [intakeOutput, memoOutput, noticeOutput, relatedJudgments]
  );
  const valueProof = useMemo(
    () => buildValueProof({ memoOutput, noticeOutput, relatedJudgments, savedDrafts }),
    [memoOutput, noticeOutput, relatedJudgments, savedDrafts]
  );
  const selectedArgumentCases = useMemo(() => {
    if (relatedJudgments.length) return relatedJudgments.slice(0, 5);
    if (memoOutput?.relatedJudgments?.length) return memoOutput.relatedJudgments.slice(0, 5);
    if (judgments.length) return judgments.slice(0, 5);
    return [];
  }, [relatedJudgments, memoOutput, judgments]);
  const argumentIssues = useMemo(() => {
    if (memoOutput?.issueList?.length) return memoOutput.issueList;
    if (intakeOutput?.legalIssues?.length) return intakeOutput.legalIssues;
    return [];
  }, [memoOutput, intakeOutput]);
  const memoReviewKey = useMemo(
    () => buildReviewEntityKey("memo", [selectedMatterId || selectedMatter?.id || "workspace", selectedJudgment?.canonicalCaseId || selectedJudgment?.citation || "general"]),
    [selectedJudgment?.canonicalCaseId, selectedJudgment?.citation, selectedMatter?.id, selectedMatterId]
  );
  const predictionReviewKey = useMemo(
    () => buildReviewEntityKey("prediction", [selectedMatterId || selectedMatter?.id || "workspace", caseTitle || intakeOutput?.caseTitle || "general"]),
    [caseTitle, intakeOutput?.caseTitle, selectedMatter?.id, selectedMatterId]
  );
  const readinessReviewKey = useMemo(
    () => buildReviewEntityKey("readiness", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "general"]),
    [draftType, selectedMatter?.id, selectedMatterId]
  );
  const consistencyReviewKey = useMemo(
    () => buildReviewEntityKey("consistency", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "general"]),
    [draftType, selectedMatter?.id, selectedMatterId]
  );
  const coverageReviewKey = useMemo(
    () => buildReviewEntityKey("coverage", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "general"]),
    [draftType, selectedMatter?.id, selectedMatterId]
  );
  const draftValidationReviewKey = useMemo(
    () => buildReviewEntityKey("draft_validation", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "general", draftCourtType || "general"]),
    [draftCourtType, draftType, selectedMatter?.id, selectedMatterId]
  );
  const filingPackReviewKey = useMemo(
    () => buildReviewEntityKey("filing_pack", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "general", draftCourtType || "general"]),
    [draftCourtType, draftType, selectedMatter?.id, selectedMatterId]
  );
  const documentReviewKey = useMemo(
    () => buildReviewEntityKey("document_analysis", [selectedMatterId || selectedMatter?.id || "workspace", docText.slice(0, 60) || lawyerInput.slice(0, 60) || "general"]),
    [docText, lawyerInput, selectedMatter?.id, selectedMatterId]
  );
  const draftReviewKey = useMemo(
    () => buildReviewEntityKey("draft_output", [selectedMatterId || selectedMatter?.id || "workspace", draftType || "draft", draftMode || "court-ready"]),
    [draftMode, draftType, selectedMatter?.id, selectedMatterId]
  );
  const visibleArgumentSections = useMemo(() => (
    argumentSide === "respondent"
      ? argumentOutput?.respondentArguments || []
      : argumentOutput?.petitionerArguments || []
  ), [argumentOutput, argumentSide]);
  const citationTargetCase = useMemo(() => (
    selectedJudgment
    || relatedJudgments[0]
    || judgments[0]
    || memoOutput?.relatedJudgments?.[0]
    || null
  ), [selectedJudgment, relatedJudgments, judgments, memoOutput]);
  const strengthDocuments = useMemo(() => {
    const items = [];
    if (intakeDocText) {
      items.push({ id: "intake-doc", title: "Matter intake document", content: intakeDocText });
    }
    if (docText) {
      items.push({ id: "analysis-doc", title: "Legal analysis document", content: docText });
    }
    return items;
  }, [intakeDocText, docText]);

  useEffect(() => {
    let active = true;

    if (!selectedArgumentCases.length) {
      setAuthorityGuardrails({ status: "CLEAR", blockingWarnings: [], cautionWarnings: [], reviewedAuthorities: [] });
      return undefined;
    }

    evaluateAuthorityGuardrails(selectedArgumentCases)
      .then((response) => {
        if (!active) return;
        setAuthorityGuardrails(response);
      })
      .catch(() => {
        if (!active) return;
        setAuthorityGuardrails(buildLocalAuthorityGuardrails(selectedArgumentCases));
      });

    return () => {
      active = false;
    };
  }, [selectedArgumentCases]);

  useEffect(() => {
    const nextMode = queryMode === "lawyer" ? "lawyer" : "public";
    setMode(nextMode);
  }, [queryMode]);

  useEffect(() => {
    if (mode === "lawyer" && hasRole.lawyer) {
      hydrateLawyerData();
    }
    if (mode === "public" && hasRole.public) {
      setStatus("Public legal guidance mode is ready.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hasRole.lawyer, hasRole.public]);

  useEffect(() => {
    if (mode === "lawyer" && hasRole.lawyer) {
      hydrateLawyerData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgmentQuery, judgmentCourt, judgmentStatus, judgmentDateWindow]);

  useEffect(() => {
    const loadRelatedJudgments = async () => {
      if (!hasRole.lawyer || mode !== "lawyer") return;
      if (!judgmentContextText.trim()) {
        setRelatedJudgments([]);
        return;
      }

      try {
        const response = await runLegalAction("judgments_related", {
          ownerId,
          sourceText: judgmentContextText,
          limit: 4
        });
        setRelatedJudgments(response.judgments || []);
      } catch {
        setRelatedJudgments([]);
      }
    };

    loadRelatedJudgments();
  }, [hasRole.lawyer, judgmentContextText, mode, ownerId]);

  const hydrateLawyerData = async () => {
    try {
      const results = await Promise.allSettled([
        runLegalAction("clients_list", { ownerId }),
        runLegalAction("cases_list", { ownerId }),
        runLegalAction("tasks_list", { ownerId }),
        runLegalAction("subscription_get", { ownerId }),
        runLegalAction("audit_list", { ownerId }),
        runLegalAction("billing_config", { ownerId }),
        runLegalAction("memory_list", { ownerId }),
        runLegalAction("drafts_list", { ownerId }),
        runLegalAction("judgments_list", {
          ownerId,
          query: judgmentQuery,
          court: judgmentCourt,
          status: judgmentStatus,
          dateWindow: judgmentDateWindow
        }),
        runLegalAction("judgments_sync_status", { ownerId }),
        runLegalAction("judgment_sources_list", { ownerId }),
        listLegalReviews({ ownerId, matterId: selectedMatterId || "" }),
        listLegalReviewSnapshots({ ownerId, matterId: selectedMatterId || "" })
      ]);
      const read = (index, fallback) => results[index]?.status === "fulfilled" ? results[index].value : fallback;

      const clientResponse = read(0, { clients: [] });
      const caseResponse = read(1, { cases: [] });
      const taskResponse = read(2, { tasks: [] });
      const subscriptionResponse = read(3, { subscription: null });
      const auditResponse = read(4, { logs: [] });
      const billingResponse = read(5, { enabled: false, keyId: "" });
      const memoryResponse = read(6, { memories: [] });
      const draftResponse = read(7, { drafts: [] });
      const judgmentsResponse = read(8, { judgments: [], feedMode: "demo" });
      const syncStatusResponse = read(9, null);
      const sourceRegistryResponse = read(10, { sources: [], templates: [] });
      const reviewsResponse = read(11, { reviews: readLocalReviews(ownerId) });
      const snapshotsResponse = read(12, { snapshots: [] });

      setClients(clientResponse.clients || []);
      setCases(caseResponse.cases || []);
      setTasks(taskResponse.tasks || []);
      setSavedMemories(memoryResponse.memories || []);
      setSavedDrafts(draftResponse.drafts || []);
      setJudgments(judgmentsResponse.judgments || []);
      setJudgmentFeedMode(judgmentsResponse.feedMode || "demo");
      setJudgmentSourceMode(judgmentsResponse.feedMode === "live" ? "live" : "cache");
      setJudgmentSyncStatus(syncStatusResponse || null);
      setJudgmentSources(sourceRegistryResponse.sources || []);
      setJudgmentTemplates(sourceRegistryResponse.templates || syncStatusResponse.templates || []);
      setSubscription(subscriptionResponse.subscription || null);
      setAuditLogs(auditResponse.logs || []);
      setReviewRecords(reviewsResponse.reviews || []);
      setReviewSnapshots(snapshotsResponse.snapshots || []);
      setBillingConfig({
        enabled: Boolean(billingResponse.enabled),
        keyId: billingResponse.keyId || ""
      });
      const failedCount = results.filter((item) => item.status === "rejected").length;
      setStatus(failedCount ? "" : "Lawyer workspace loaded.");
    } catch {
      setStatus("");
    }
  };

  useEffect(() => {
    if (!ownerId) return;
    if (!reviewRecords.length) {
      const localReviews = readLocalReviews(ownerId);
      if (localReviews.length) {
        setReviewRecords(localReviews);
      }
    }
  }, [ownerId, reviewRecords.length]);

  const getReviewRecord = (entityType, entityKey) => (
    (reviewRecords || []).find((item) => item.entityType === entityType && item.entityKey === entityKey) || null
  );

  const updateReviewDraft = (entityType, entityKey, nextPatch) => {
    const stateKey = `${entityType}:${entityKey}`;
    setReviewDrafts((current) => ({
      ...current,
      [stateKey]: {
        ...(current[stateKey] || {}),
        ...nextPatch
      }
    }));
  };

  const saveReviewRecord = async ({ entityType, entityKey, entityLabel, output, status: nextStatus }) => {
    const stateKey = `${entityType}:${entityKey}`;
    const draft = reviewDrafts[stateKey] || {};
    const approvalRole = String(draft.approvalRole || "").trim().toLowerCase();

    if (nextStatus === "approved" && !approvalRole) {
      setStatus("Select an approval role before marking this output as approved.");
      return;
    }

      const payload = {
        ownerId,
      matterId: selectedMatterId || selectedMatter?.id || "",
      entityType,
      entityKey,
      entityLabel,
      status: nextStatus,
        approvalRole,
        reviewerName: draft.reviewerName || account?.displayName || lawyerProfile?.name || "Lawyer",
        reviewNotes: draft.reviewNotes || "",
        outputSummary: buildReviewSummaryText(output),
        keyPoints: output?.keyFactors || output?.issueList || output?.strengths || output?.keyFacts || [],
        traceability: output?.traceability || null
      };

    try {
      const response = await saveLegalReview(payload);
      const review = response.review || payload;
      setReviewRecords((current) => {
        const others = (current || []).filter((item) => !(item.entityType === entityType && item.entityKey === entityKey));
        const next = [review, ...others];
        writeLocalReviews(ownerId, next);
        return next;
      });
      setStatus(`Review status updated: ${nextStatus.replace("_", " ").toUpperCase()}.`);
      if (nextStatus === "approved") {
        const snapshotResponse = await listLegalReviewSnapshots({ ownerId, matterId: selectedMatterId || selectedMatter?.id || "" }).catch(() => null);
        if (snapshotResponse?.snapshots) {
          setReviewSnapshots(snapshotResponse.snapshots);
        }
      }
    } catch {
      const fallbackReview = {
        ...payload,
        id: `${entityType}:${entityKey}`,
        updatedAt: new Date().toISOString()
      };
      setReviewRecords((current) => {
        const others = (current || []).filter((item) => !(item.entityType === entityType && item.entityKey === entityKey));
        const next = [fallbackReview, ...others];
        writeLocalReviews(ownerId, next);
        return next;
      });
      setStatus(`Review saved locally: ${nextStatus.replace("_", " ").toUpperCase()}.`);
    }
  };

  const renderReviewWorkflow = ({ entityType, entityKey, entityLabel, output }) => {
    if (!entityType || !entityKey || !output) return null;
    const review = getReviewRecord(entityType, entityKey);
    const draftState = reviewDrafts[`${entityType}:${entityKey}`] || {};
    const effectiveStatus = String(review?.status || "ai_draft").toLowerCase();
    const effectiveApprovalRole = String(draftState.approvalRole ?? review?.approvalRole ?? "").trim().toLowerCase();
    const statusLabel = effectiveStatus === "approved"
      ? "Approved"
      : effectiveStatus === "reviewed"
        ? "Reviewed"
        : "AI Draft";
    const statusStyle = effectiveStatus === "approved"
      ? { background: "#dff6e6", color: "#1f7a3d" }
      : effectiveStatus === "reviewed"
        ? { background: "#fff5d6", color: "#8a6500" }
        : { background: "#e8efff", color: "#244b8a" };

    return (
      <div className="law-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h4 style={{ marginBottom: 6 }}>Review Workflow</h4>
            <div className="muted-copy">Mark this output as reviewed or approved with lawyer notes.</div>
          </div>
          <span className="status-chip" style={statusStyle}>{statusLabel}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
          <label className="law-field">
            <span>Reviewer Name</span>
            <input
              type="text"
              value={draftState.reviewerName ?? review?.reviewerName ?? ""}
              onChange={(event) => updateReviewDraft(entityType, entityKey, { reviewerName: event.target.value })}
              placeholder="Enter reviewer name"
            />
          </label>
          <label className="law-field">
            <span>Internal Review Notes</span>
            <textarea
              rows={3}
              value={draftState.reviewNotes ?? review?.reviewNotes ?? ""}
              onChange={(event) => updateReviewDraft(entityType, entityKey, { reviewNotes: event.target.value })}
              placeholder="Add internal notes before client use or filing"
            />
          </label>
          <label className="law-field">
            <span>Approval Role</span>
            <select
              value={effectiveApprovalRole}
              onChange={(event) => updateReviewDraft(entityType, entityKey, { approvalRole: event.target.value })}
            >
              <option value="">Select approval role for final sign-off</option>
              {APPROVAL_ROLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" className="ghost-button" onClick={() => saveReviewRecord({ entityType, entityKey, entityLabel, output, status: "ai_draft" })}>
            Save As AI Draft
          </button>
          <button type="button" className="ghost-button" onClick={() => saveReviewRecord({ entityType, entityKey, entityLabel, output, status: "reviewed" })}>
            Mark Reviewed
          </button>
          <button type="button" className="primary-button" onClick={() => saveReviewRecord({ entityType, entityKey, entityLabel, output, status: "approved" })}>
            Mark Approved
          </button>
        </div>
        {review ? (
          <div className="muted-copy" style={{ marginTop: 10 }}>
            Last saved for {entityLabel}. Reviewer: {review.reviewerName || "Not set"}.
            {review.approvalRole ? ` Approval role: ${String(review.approvalRole).replace(/_/g, " ")}.` : ""}
          </div>
        ) : null}
      </div>
    );
  };

  const renderReviewSnapshots = () => {
    if (!reviewSnapshots.length) {
      return <p className="muted-copy">No approved output snapshots yet.</p>;
    }

    return (
      <div className="law-list-block">
        <h4>Approved Output Snapshots</h4>
        <ul>
          {reviewSnapshots.slice(0, 12).map((item) => (
            <li key={item.id || `${item.entityType}-${item.entityKey}`}>
              <strong>{item.entityLabel || item.entityType || "Output"}</strong>
              {item.reviewerName ? ` | Reviewer: ${item.reviewerName}` : ""}
              {item.approvalRole ? ` | Approval role: ${String(item.approvalRole).replace(/_/g, " ")}` : ""}
              {item.outputSummary ? <div className="muted-copy" style={{ marginTop: "4px" }}>{item.outputSummary}</div> : null}
              {item.traceSnapshot?.factsUsed?.length ? (
                <details style={{ marginTop: "6px" }}>
                  <summary>View source snapshot</summary>
                  <div className="muted-copy">Facts: {item.traceSnapshot.factsUsed.map((entry) => entry.label || entry).join(" | ") || "None"}</div>
                  <div className="muted-copy">Documents: {(item.traceSnapshot.documentsReviewed || []).map((entry) => entry.title || "Document").join(", ") || "None"}</div>
                  <div className="muted-copy">Authorities: {(item.traceSnapshot.authoritiesRelied || []).map((entry) => entry.title || entry.citation || "Authority").join(", ") || "None"}</div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const activateRole = (role) => {
    if (!account) {
      navigate("/login");
      return;
    }

    registerRole(role, {
      uid: account.uid,
      phone: account.phone,
      name: account.name || (role === "lawyer" ? "Lawyer" : "Public User"),
      role,
      onboardedAt: new Date().toISOString()
    });

    setLastActiveRole(role);
    setSearchParams({ mode: role });
    setStatus(`${role === "lawyer" ? "Lawyer" : "Public"} mode activated.`);
  };

  const startVoiceInput = (setter) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = publicLanguage === "telugu" ? "te-IN" : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      setter((previous) => `${previous} ${spoken}`.trim());
      setStatus("Voice dictation captured.");
    };
    recognition.onerror = () => {
      setStatus("Voice capture failed. Please try again.");
    };
    recognition.start();
  };

  const extractFromFile = async (file, setter, metaSetter) => {
    if (!file) return;
    try {
      setBusy(true);
      setStatus("Extracting text from uploaded document...");
      const base64 = await toBase64(file);
      const response = await runLegalAction("document_extract", {
        ownerId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: base64
      });
      setter(String(response.extractedText || "").slice(0, 30000));
      if (metaSetter) {
        metaSetter({
          fileName: response.fileName || file.name,
          mimeType: response.mimeType || file.type || "",
          qualityScore: Number(response.qualityScore || 0),
          pagePreviews: Array.isArray(response.pagePreviews) ? response.pagePreviews : [],
          extractionEngine: response.extractionEngine || "basic"
        });
      }
      setStatus(`Text extracted from ${file.name}.`);
          if (mode === "lawyer") {
            hydrateLawyerData();
          }
    } catch (error) {
      setStatus(error.message || "Could not extract text from file.");
    } finally {
      setBusy(false);
    }
  };

  const askPublicAssistant = async () => {
    try {
      setBusy(true);
      setStatus("Generating legal guidance...");
      const response = await runLegalAction("public_guidance", {
        ownerId,
        language: publicLanguage,
        problem: publicProblem,
        location: publicLocation,
        documentText: publicDocText
      });
      setPublicOutput(response);
      setStatus("Public legal guidance ready.");
    } catch (error) {
      setStatus(error.message || "Public legal guidance failed.");
    } finally {
      setBusy(false);
    }
  };

  const runMatterIntake = async () => {
    if (!canRunLawyerAi) {
      setStatus("Monthly fair-use limit reached for now.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Preparing structured matter intake...");
      const response = await runLegalAction("matter_intake", {
        ownerId,
        rawFacts: intakeFacts,
        documentText: intakeDocText
      });
      setIntakeOutput(response);
      setStatus("Matter intake summary ready.");
      hydrateLawyerData();
    } catch (error) {
      const localIntake = buildLocalMatterIntake({
        intakeFacts,
        intakeDocText,
        caseTitle
      });
      setIntakeOutput(localIntake);
      setStatus("Matter intake summary ready.");
    } finally {
      setBusy(false);
    }
  };

  const runChronologyBuilder = async () => {
    if (!canRunLawyerAi) {
      setStatus("Monthly fair-use limit reached for now.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Building chronology from intake facts...");
      const response = await runLegalAction("chronology_builder", {
        ownerId,
        rawFacts: intakeFacts,
        documentText: intakeDocText
      });
      setIntakeChronology(Array.isArray(response.entries) ? response.entries : []);
      setStatus("Chronology ready.");
    } catch (error) {
      const localChronology = buildLocalChronologyResponse({
        intakeFacts,
        intakeDocText
      });
      setIntakeChronology(Array.isArray(localChronology.entries) ? localChronology.entries : []);
      setStatus("Chronology ready.");
    } finally {
      setBusy(false);
    }
  };

  const runResearchMemo = async () => {
    if (!canRunLawyerAi) {
      setStatus("Monthly fair-use limit reached for now.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Preparing research memo...");
      const response = await runLegalAction("research_memo", {
        ownerId,
        matterTitle: intakeOutput?.matterTitle || caseTitle,
        factSummary: intakeOutput?.factSummary || caseNotes,
        chronologyText: intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n") || chronologyText,
        legalIssues: intakeOutput?.legalIssues || []
      });
      setMemoOutput(response);
      setStatus("Research memo ready.");
      hydrateLawyerData();
    } catch (error) {
      const fallbackMemo = buildLocalResearchMemo({
        intakeOutput,
        intakeChronology,
        chronologyText,
        caseTitle,
        caseNotes
      });
      setMemoOutput(fallbackMemo);
      setStatus(
        String(error.message || "").includes("Unknown legal action")
          ? "Research memo ready."
          : (error.message || "Research memo failed.")
      );
    } finally {
      setBusy(false);
    }
  };

  const loadMemoIntoResearch = () => {
    if (!memoOutput) return;
    const prompt = [
      memoOutput.issueList?.length ? `Issues:\n- ${memoOutput.issueList.join("\n- ")}` : "",
      memoOutput.keyAuthorities?.length ? `Key Authorities:\n- ${memoOutput.keyAuthorities.join("\n- ")}` : "",
      memoOutput.proceduralNotes?.length ? `Procedural Notes:\n- ${memoOutput.proceduralNotes.join("\n- ")}` : "",
      memoOutput.riskFlags?.length ? `Risk Flags:\n- ${memoOutput.riskFlags.join("\n- ")}` : ""
    ].filter(Boolean).join("\n\n");
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus("Research memo moved into research.");
  };

  const runNoticePack = async () => {
    try {
      setBusy(true);
      setStatus("Preparing notice pack...");
      const response = await runLegalAction("notice_pack", {
        ownerId,
        matterTitle: intakeOutput?.matterTitle || caseTitle,
        factSummary: intakeOutput?.factSummary || caseNotes,
        chronologyText: intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n") || chronologyText,
        legalIssues: intakeOutput?.legalIssues || memoOutput?.issueList || []
      });
      setNoticeOutput(response);
      setStatus("Notice pack ready.");
      hydrateLawyerData();
    } catch (error) {
      const fallbackNotice = buildLocalNoticePack({
        intakeOutput,
        memoOutput,
        intakeChronology,
        chronologyText,
        caseTitle,
        caseNotes
      });
      setNoticeOutput(fallbackNotice);
      setStatus(
        String(error.message || "").includes("Unknown legal action")
          ? "Notice pack ready."
          : (error.message || "Notice pack failed.")
      );
    } finally {
      setBusy(false);
    }
  };

  const runArgumentBuilder = async () => {
    if (authorityGuardrails.status === "BLOCK") {
      setStatus("Selected authorities include bad-law cases. Remove or replace them before generating arguments.");
      return;
    }

    const payload = {
      matterId: selectedMatter?.id || "",
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      issues: argumentIssues,
      jurisdiction: selectedJudgment?.court || selectedMatter?.stage || "Indian courts",
      selectedCases: selectedArgumentCases,
      mode: argumentMode
    };

    if (!payload.facts && !payload.issues.length && !payload.selectedCases.length) {
      setStatus("Prepare intake, memo, or selected judgments first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Generating issue-wise arguments...");
      const response = await buildArguments({
        ownerId,
        ...payload
      });
      setArgumentOutput(response);
      setLawyerTab("arguments");
      setStatus("Argument builder output ready.");
    } catch (error) {
      const fallback = buildLocalArgumentOutput(payload);
      setArgumentOutput(fallback);
      setLawyerTab("arguments");
      setStatus(error.message || "Argument builder output ready.");
    } finally {
      setBusy(false);
    }
  };

  const runCaseStrength = async () => {
    if (authorityGuardrails.status === "BLOCK") {
      setStatus("Selected authorities include bad-law cases. Remove or replace them before analyzing strength.");
      return;
    }

    const payload = {
      matterId: selectedMatter?.id || "",
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      issues: argumentIssues,
      documents: strengthDocuments,
      selectedCases: selectedArgumentCases,
      jurisdiction: selectedJudgment?.court || selectedMatter?.stage || "Indian courts"
    };

    if (!payload.facts && !payload.issues.length && !payload.documents.length && !payload.selectedCases.length) {
      setStatus("Prepare facts, documents, or authorities first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Analyzing case strength...");
      const response = await analyzeCaseStrength({
        ownerId,
        ...payload
      });
      setStrengthOutput(response);
      setLawyerTab("strength");
      setStatus("Case strength analysis ready.");
    } catch (error) {
      setStrengthOutput(buildLocalStrengthOutput(payload));
      setLawyerTab("strength");
      setStatus(error.message || "Case strength analysis ready.");
    } finally {
      setBusy(false);
    }
  };

  const runCasePrediction = async () => {
    if (authorityGuardrails.status === "BLOCK") {
      setStatus("Selected authorities include bad-law cases. Remove or replace them before prediction.");
      return;
    }

    const facts = intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts;
    const payload = {
      matterId: selectedMatter?.id || "",
      facts,
      issues: argumentIssues,
      documentAnalysis: lawyerTab === "document" && lawyerOutput?.summary ? lawyerOutput : null,
      caseStrength: strengthOutput,
      arguments: argumentOutput,
      authorities: selectedArgumentCases.length ? selectedArgumentCases : (strengthOutput?.authorityReview || argumentOutput?.authorityReview || []),
      documents: strengthDocuments,
      documentText: docText || "",
      jurisdiction: selectedJudgment?.court || selectedMatter?.stage || "Indian courts"
    };

    if (!payload.facts && !payload.authorities.length && !payload.documents.length) {
      setStatus("Prepare facts, authorities, or supporting material first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Generating case outcome prediction...");
      const response = await predictCaseOutcome({
        ownerId,
        ...payload
      });
      setPredictionOutput(response);
      setLawyerTab("prediction");
      setStatus("Case prediction ready.");
    } catch (error) {
      setPredictionOutput(buildLocalPredictionOutput({
        facts: payload.facts,
        documentAnalysis: payload.documentAnalysis,
        caseStrength: payload.caseStrength,
        argumentsOutput: payload.arguments,
        authorities: payload.authorities
      }));
      setLawyerTab("prediction");
      setStatus(error.message || "Case prediction ready.");
    } finally {
      setBusy(false);
    }
  };

  const runFilingReadiness = async () => {
    const payload = {
      matterId: selectedMatter?.id || "",
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      issues: argumentIssues,
      documents: strengthDocuments,
      jurisdiction: selectedJudgment?.court || selectedMatter?.stage || "Indian courts",
      draftText: lawyerOutput?.draft || noticeOutput?.noticeDraft || "",
      draftType,
      selectedCases: selectedArgumentCases,
      documentAnalysis: lawyerTab === "document" && lawyerOutput?.summary ? lawyerOutput : null,
      caseStrength: strengthOutput
    };

    if (!payload.facts && !payload.documents.length && !payload.draftText) {
      setStatus("Prepare facts, draft text, or supporting material first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Checking filing readiness...");
      const response = await analyzeFilingReadiness({
        ownerId,
        ...payload
      });
      setReadinessOutput(response);
      setLawyerTab("readiness");
      setStatus("Filing readiness report ready.");
    } catch (error) {
      setReadinessOutput(buildLocalReadinessOutput(payload));
      setLawyerTab("readiness");
      setStatus(error.message || "Filing readiness report ready.");
    } finally {
      setBusy(false);
    }
  };

  const runMatterConsistency = async () => {
    const payload = {
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      chronologyText: intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n") || chronologyText,
      hearingNotes,
      draftText: lawyerOutput?.draft || noticeOutput?.noticeDraft || "",
      issues: intakeOutput?.legalIssues || memoOutput?.issueList || [],
      documentAnalysis: lawyerTab === "document" && lawyerOutput?.summary ? lawyerOutput : null,
      argumentOutput
    };

    setBusy(true);
    setStatus("Checking matter consistency across facts, chronology, and draft materials...");
    try {
      const response = await analyzeMatterConsistency(payload);
      setConsistencyOutput(response);
      setLawyerTab("consistency");
      setStatus("Matter consistency review ready.");
    } catch {
      const fallback = buildLocalMatterConsistencyOutput(payload);
      setConsistencyOutput(fallback);
      setLawyerTab("consistency");
      setStatus("Matter consistency review prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  const runEvidenceCoverage = async () => {
    const payload = {
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      issues: intakeOutput?.legalIssues || memoOutput?.issueList || [],
      documents: lawyerEvidence ? [{ id: "evidence-text", title: "Evidence notes", content: lawyerEvidence }] : [],
      draftText: lawyerOutput?.draft || noticeOutput?.noticeDraft || "",
      selectedCases: selectedArgumentCases.length ? selectedArgumentCases : (strengthOutput?.authorityReview || argumentOutput?.authorityReview || []),
      caseStrength: strengthOutput,
      argumentOutput
    };

    setBusy(true);
    setStatus("Building issue-wise evidence coverage matrix...");
    try {
      const response = await analyzeEvidenceCoverage(payload);
      setCoverageOutput(response);
      setLawyerTab("coverage");
      setStatus("Evidence coverage matrix ready.");
    } catch {
      const fallback = buildLocalCoverageOutput(payload);
      setCoverageOutput(fallback);
      setLawyerTab("coverage");
      setStatus("Evidence coverage matrix prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  const runDraftValidation = async () => {
    const payload = {
      draftText: lawyerOutput?.draft || lawyerInput || noticeOutput?.noticeDraft || "",
      draftType,
      courtType: draftCourtType
    };

    setBusy(true);
    setStatus("Validating draft structure against court-ready filing expectations...");
    try {
      const response = await analyzeDraftValidation(payload);
      setDraftValidationOutput(response);
      setLawyerTab("draft-validation");
      setStatus("Draft validation ready.");
    } catch {
      const fallback = buildLocalDraftValidationOutput(payload);
      setDraftValidationOutput(fallback);
      setLawyerTab("draft-validation");
      setStatus("Draft validation prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  const runFilingPackReadiness = async () => {
    const payload = {
      matterId: selectedMatter?.id || selectedMatterId || "",
      facts: intakeOutput?.factSummary || caseNotes || lawyerInput || intakeFacts,
      issues: intakeOutput?.legalIssues || memoOutput?.issueList || [],
      documents: lawyerEvidence ? [{ id: "evidence-text", title: "Evidence notes", content: lawyerEvidence }] : [],
      draftText: lawyerOutput?.draft || noticeOutput?.noticeDraft || "",
      draftType,
      courtType: draftCourtType,
      selectedCases: selectedArgumentCases.length ? selectedArgumentCases : (strengthOutput?.authorityReview || argumentOutput?.authorityReview || []),
      caseStrength: strengthOutput,
      argumentOutput,
      documentAnalysis: lawyerTab === "document" && lawyerOutput?.summary ? lawyerOutput : null,
      hearingNotes,
      chronologyText: intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n") || chronologyText
    };

    setBusy(true);
    setStatus("Running final filing pack gate across readiness, consistency, evidence coverage, draft validation, and authority freshness...");
    try {
      const response = await analyzeFilingPackReadiness(payload);
      setFilingPackOutput(response);
      setLawyerTab("filing-pack");
      setStatus("Final filing pack review ready.");
    } catch {
      const fallback = buildLocalFilingPackOutput({
        readiness: readinessOutput || buildLocalReadinessOutput(payload),
        consistency: consistencyOutput || buildLocalMatterConsistencyOutput(payload),
        coverage: coverageOutput || buildLocalCoverageOutput(payload),
        draftValidation: draftValidationOutput || buildLocalDraftValidationOutput(payload)
      });
      setFilingPackOutput(fallback);
      setLawyerTab("filing-pack");
      setStatus("Final filing pack review prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  const loadCitationView = async (caseItem = citationTargetCase) => {
    if (!caseItem) {
      setStatus("Select or match a case first.");
      return;
    }

    const caseKey = getJudgmentValidityKey(caseItem);
    try {
      setCitationLoading(true);
      setStatus("Loading citation graph...");
      const response = await fetchCaseCitations(caseItem.canonicalCaseId || caseItem.citation || caseItem.title || caseKey);
      setCitationView(response);
      setCitationExpanded({});
      setLawyerTab("citations");
      setStatus("Citation graph ready.");
    } catch (error) {
      const fallbackValidity = caseValidityMap[caseKey] || null;
      setCitationView(buildLocalCitationView(caseItem, fallbackValidity));
      setCitationExpanded({});
      setLawyerTab("citations");
      setStatus(error.message || "Citation graph ready.");
    } finally {
      setCitationLoading(false);
    }
  };

  const revalidateAuthorityNow = async (caseItem = null) => {
    const target = caseItem || selectedJudgment || citationTargetCase;
    const caseKey = getJudgmentValidityKey(target);
    if (!target || !caseKey) {
      setStatus("Select a valid authority first.");
      return;
    }

    setBusy(true);
    setCaseValidityLoadingKey(caseKey);
    setStatus("Revalidating authority against the latest citation-treatment data...");
    try {
      const refreshedValidity = await fetchCaseValidity(target.canonicalCaseId || caseKey, { forceRefresh: true });
      setCaseValidityMap((previous) => ({
        ...previous,
        [caseKey]: refreshedValidity
      }));

      if (citationView && citationView.canonicalCaseId === (target.canonicalCaseId || caseKey)) {
        const refreshedCitations = await fetchCaseCitations(target.canonicalCaseId || caseKey, { forceRefresh: true }).catch(() => null);
        if (refreshedCitations) {
          setCitationView(refreshedCitations);
        } else {
          setCitationView((current) => current ? {
            ...current,
            status: refreshedValidity.status || current.status,
            riskLevel: refreshedValidity.riskLevel || current.riskLevel,
            confidenceScore: refreshedValidity.confidenceScore || current.confidenceScore,
            freshness: refreshedValidity.freshness || current.freshness
          } : current);
        }
      }

      setStatus("Authority revalidated.");
    } catch (error) {
      setStatus(error.message || "Authority revalidation could not be completed.");
    } finally {
      setBusy(false);
      setCaseValidityLoadingKey((current) => (current === caseKey ? "" : current));
    }
  };

  const toggleCitationSection = (sectionKey) => {
    setCitationExpanded((previous) => ({
      ...previous,
      [sectionKey]: !previous[sectionKey]
    }));
  };

  const loadNoticeIntoDraft = () => {
    if (!noticeOutput) return;
    setDraftType("notice");
    setLawyerInput(noticeOutput.noticeDraft || "");
    setLawyerOutput({ draft: noticeOutput.noticeDraft || "" });
    setLawyerTab("draft");
    setStatus("Notice pack moved into draft workspace.");
  };

  const openQueueItem = (item) => {
    if (item.type === "task") {
      const matchedTask = (tasks || []).find((task) => `task-${task.id}` === item.id);
      if (matchedTask?.relatedCaseId) {
        setSelectedMatterId(matchedTask.relatedCaseId);
      }
      setLawyerTab("workflow");
      setStatus(`Opened task queue item: ${item.title}`);
      return;
    }

    const matchedCase = (cases || []).find((caseItem) => `case-${caseItem.id}` === item.id);
    if (matchedCase) {
      setSelectedMatterId(matchedCase.id);
      setLawyerTab("workflow");
      setStatus(`Opened matter queue item: ${matchedCase.title || "matter"}`);
    }
  };

  const continueLastMatter = () => {
    if (!continueMatter) return;
    setSelectedMatterId(continueMatter.id);
    setLawyerTab("workflow");
    setStatus(`Continued ${continueMatter.title}.`);
  };

  const applyCaseStudy = (study, target = "intake") => {
    setIntakeFacts(study.facts || "");
    setChronologyText(study.chronology || "");
    setIntakeChronology(buildChronology(study.chronology || "").map((item) => ({
      date: item.date,
      event: item.event,
      source: "case study"
    })));
    setIntakeOutput({
      matterTitle: study.title,
      clientSummary: study.summary,
      factSummary: study.facts,
      legalIssues: study.issues,
      reliefsToConsider: [],
      documentsRequired: [],
      nextSteps: []
    });

    if (target === "research") {
      setLawyerInput([
        `Case Study: ${study.title}`,
        `Summary: ${study.summary}`,
        `Facts:\n${study.facts}`,
        `Issues:\n- ${study.issues.join("\n- ")}`
      ].join("\n\n"));
      setLawyerTab("research");
      setStatus(`Case study loaded into research: ${study.title}`);
      return;
    }

    setLawyerTab("intake");
    setStatus(`Case study loaded: ${study.title}`);
  };

  const launchDemoMatter = () => {
    const defaultStudy = CASE_STUDIES[0];
    applyCaseStudy(defaultStudy, "intake");
    setStatus(`Demo matter loaded: ${defaultStudy.title}. Start with Matter Intake, then Memo, then Latest Judgments.`);
  };

  const loadJudgmentIntoResearch = (item) => {
    const prompt = [
      `Judgment Watch: ${item.title || "Judgment brief"}`,
      item.citation ? `Citation: ${item.citation}` : "",
      item.court ? `Court: ${item.court}` : "",
      item.bench ? `Bench: ${item.bench}` : "",
      item.judgmentDate ? `Date: ${item.judgmentDate}` : "",
      item.summary ? `Summary:\n${item.summary}` : "",
      item.relevanceNote ? `Why useful:\n${item.relevanceNote}` : "",
      Array.isArray(item.issueTags) && item.issueTags.length ? `Issue Tags:\n- ${item.issueTags.join("\n- ")}` : "",
      "Use this authority brief to identify issues, risks, and filing strategy. Verify the full text and current status before reliance."
    ].filter(Boolean).join("\n\n");
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus(`Judgment brief loaded into research: ${item.title || "authority"}`);
  };

  const openJudgmentDetails = (item) => {
    setSelectedJudgment(item);
    setStatus(`Opened judgment details: ${item.title || "authority"}`);

    const validityKey = getJudgmentValidityKey(item);
    if (!validityKey || caseValidityMap[validityKey]) {
      return;
    }

    setCaseValidityLoadingKey(validityKey);
    fetchCaseValidity(item.canonicalCaseId || validityKey)
      .then((response) => {
        setCaseValidityMap((previous) => ({
          ...previous,
          [validityKey]: response
        }));
      })
      .catch(async () => {
        try {
          const fallback = await runLegalAction("case_validity", {
            ownerId,
            canonicalCaseId: item.canonicalCaseId || "",
            caseId: item.canonicalCaseId || "",
            title: item.title || "",
            citation: item.citation || "",
            court: item.court || ""
          });
          setCaseValidityMap((previous) => ({
            ...previous,
            [validityKey]: fallback
          }));
        } catch {
          setCaseValidityMap((previous) => ({
            ...previous,
            [validityKey]: {
              status: "CAUTION",
              riskLevel: "MEDIUM",
              confidenceScore: 35,
              summary: "Case validity data could not be loaded right now. Verify the authority manually before reliance.",
              topPositiveCases: [],
              topNegativeCases: []
            }
          }));
        }
      })
      .finally(() => {
        setCaseValidityLoadingKey((current) => (current === validityKey ? "" : current));
      });
  };

  const toggleCompareJudgment = (item) => {
    setCompareJudgments((previous) => {
      const exists = previous.some((entry) => entry.id === item.id);
      if (exists) {
        return previous.filter((entry) => entry.id !== item.id);
      }
      if (previous.length >= 3) {
        return [...previous.slice(1), item];
      }
      return [...previous, item];
    });
  };

  const findAuthoritiesFromCurrentMatter = async () => {
    if (!judgmentContextText.trim()) {
      setStatus("Prepare intake, memo, workflow notes, or research facts first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Matching related latest judgments...");
      const response = await runLegalAction("judgments_related", {
        ownerId,
        sourceText: judgmentContextText,
        limit: 6
      });
      setRelatedJudgments(response.judgments || []);
      setLawyerTab("judgments");
      setStatus("Related latest judgments ready.");
    } catch (error) {
      const fallbackJudgments = buildLocalJudgmentMatches({ intakeOutput, memoOutput });
      setRelatedJudgments(fallbackJudgments);
      setLawyerTab("judgments");
      setStatus(
        String(error.message || "").includes("Unknown legal action")
          ? "Related latest judgments ready."
          : (error.message || "Could not match related judgments.")
      );
    } finally {
      setBusy(false);
    }
  };

  const triggerJudgmentSync = async (sourceId = "all") => {
    try {
      setBusy(true);
      setStatus("Creating judgment sync run...");
      const response = await runLegalAction("judgment_sync_run", {
        ownerId,
        sourceId,
        mode: "manual"
      });
      setStatus(`Judgment sync run created: ${response.run?.id || "pending"}`);
      hydrateLawyerData();
    } catch (error) {
      setStatus(error.message || "Could not create judgment sync run.");
    } finally {
      setBusy(false);
    }
  };

  const triggerLiveJudgmentRetrieve = async (sourceId = "all") => {
    try {
      setBusy(true);
      setStatus("Checking live judgment sources...");
      const response = await runLegalAction("judgments_live_retrieve", {
        ownerId,
        sourceId,
        query: judgmentQuery,
        limit: 10
      });
      if (response.judgments?.length) {
        setJudgments(response.judgments);
      }
      setJudgmentSourceMode(response.sourceMode || "cache");
      setStatus(
        response.liveEnabled
          ? response.judgments?.length
            ? `Live judgments loaded from ${response.fetchedSources?.join(", ") || "configured sources"}.`
            : "Live retrieval is enabled, but no live records were returned. Showing cache/demo flow."
          : "Live retrieval is not enabled yet. Using cache/demo flow."
      );
      hydrateLawyerData();
    } catch (error) {
      setStatus(error.message || "Could not run live judgment retrieval.");
    } finally {
      setBusy(false);
    }
  };

  const loadIntakeIntoWorkflow = () => {
    if (!intakeOutput) return;
    setCaseTitle(intakeOutput.matterTitle || "");
    setCaseNotes(
      [
        intakeOutput.clientSummary ? `Client Summary:\n${intakeOutput.clientSummary}` : "",
        intakeOutput.factSummary ? `Fact Summary:\n${intakeOutput.factSummary}` : "",
        intakeOutput.nextSteps?.length ? `Next Steps:\n- ${intakeOutput.nextSteps.join("\n- ")}` : ""
      ].filter(Boolean).join("\n\n")
    );
    if (intakeChronology.length) {
      setChronologyText(intakeChronology.map((item) => `${item.date || ""}${item.date ? ": " : ""}${item.event}`).join("\n"));
    }
    setLawyerTab("workflow");
    setStatus("Matter intake moved into workflow.");
  };

  const loadIntakeIntoResearch = () => {
    if (!intakeOutput) return;
    const prompt = [
      `Matter: ${intakeOutput.matterTitle || "New matter"}`,
      intakeOutput.clientSummary ? `Client Summary:\n${intakeOutput.clientSummary}` : "",
      intakeOutput.factSummary ? `Fact Summary:\n${intakeOutput.factSummary}` : "",
      intakeOutput.legalIssues?.length ? `Legal Issues:\n- ${intakeOutput.legalIssues.join("\n- ")}` : "",
      intakeChronology.length ? `Chronology:\n${intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n")}` : "",
      intakeOutput.documentsRequired?.length ? `Documents Required:\n- ${intakeOutput.documentsRequired.join("\n- ")}` : ""
    ].filter(Boolean).join("\n\n");
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus("Matter intake moved into research.");
  };

  const runLawyerAction = async () => {
    if (!canRunLawyerAi) {
      setStatus("Monthly fair-use limit reached for now.");
      return;
    }

    if (lawyerTab === "draft") {
      const fallbackDraft = buildLocalDraftOutput({
        draftType,
        facts: lawyerInput,
        mode: draftMode
      });
      setLawyerOutput(fallbackDraft);
      setStatus("Lawyer output generated.");
      setBusy(false);
      return;
    }

    try {
      setBusy(true);
      setStatus("Running lawyer AI workflow...");

      let response = null;
      if (lawyerTab === "research") {
        response = await runLegalAction("lawyer_research", { ownerId, caseDetails: lawyerInput });
      }
      if (lawyerTab === "draft") {
        response = await runLegalAction("draft_generator", { ownerId, draftType, facts: lawyerInput, mode: draftMode });
      }
      if (lawyerTab === "analyzer") {
        response = await runLegalAction("case_analyzer", {
          ownerId,
          facts: lawyerInput,
          evidence: lawyerEvidence
        });
      }
      if (lawyerTab === "document") {
        response = await analyzeLegalDocument({
          ownerId,
          documentText: docText || lawyerInput,
          caseFacts: documentCompareFacts || intakeOutput?.factSummary || caseNotes || lawyerInput,
          clientLabel: selectedMatterClient?.name || selectedClient?.name || "",
          matterLabel: selectedMatter?.title || caseTitle || ""
        });
      }

      setLawyerOutput(response);
      if (lawyerTab === "document") {
        setDocumentMemoMode(false);
      }
      if (lawyerTab === "draft" && response?.draft) {
        await runLegalAction("draft_save", {
          ownerId,
          draftItem: {
            title: `${draftType.toUpperCase()} draft ${new Date().toISOString().slice(0, 10)}`,
            draftType,
            facts: lawyerInput,
            content: response.draft,
            relatedCaseId: selectedMatter?.id || ""
          }
        });
      }
      setStatus("Lawyer output generated.");
      hydrateLawyerData();
    } catch (error) {
      if (lawyerTab === "research") {
        const fallbackResearch = buildLocalResearchOutput({
          lawyerInput,
          memoOutput,
          relatedJudgments
        });
        setLawyerOutput(fallbackResearch);
        setStatus("Lawyer output generated.");
      } else if (lawyerTab === "draft") {
        const fallbackDraft = buildLocalDraftOutput({
          draftType,
          facts: lawyerInput,
          mode: draftMode
        });
        setLawyerOutput(fallbackDraft);
        setStatus("Lawyer output generated.");
      } else if (lawyerTab === "analyzer") {
        const localStrength = buildLocalStrengthOutput({
          matterId: selectedMatter?.id || "",
          facts: lawyerInput,
          issues: argumentIssues,
          documents: lawyerEvidence ? [{ id: "evidence-text", title: "Evidence notes", content: lawyerEvidence }] : [],
          selectedCases: selectedArgumentCases
        });
        setLawyerOutput({
          strengths: localStrength.strengths,
          weaknesses: localStrength.weaknesses,
          riskLevel: localStrength.winProbability,
          strategy: localStrength.suggestions
        });
        setStatus("Lawyer output generated.");
      } else if (lawyerTab === "document") {
        const localDocument = buildLocalDocumentAnalysis({
          documentText: docText || lawyerInput,
          caseFacts: documentCompareFacts || intakeOutput?.factSummary || caseNotes || lawyerInput
        });
        setLawyerOutput(localDocument);
        setDocumentMemoMode(false);
        setStatus("Lawyer output generated.");
      } else {
        setStatus(error.message || "Lawyer action failed.");
      }
      hydrateLawyerData();
    } finally {
      setBusy(false);
    }
  };

  const saveClient = async () => {
    if (!clientName.trim()) return;
    await runLegalAction("client_upsert", {
      ownerId,
      client: {
        name: clientName,
        phone: clientPhone,
        notes: clientNotes
      }
    });
    setClientName("");
    setClientPhone("");
    setClientNotes("");
    hydrateLawyerData();
  };

  const saveCase = async () => {
    if (!caseTitle.trim()) return;
    await runLegalAction("case_upsert", {
      ownerId,
      caseItem: {
        clientId: selectedClientId,
        title: caseTitle,
        stage: caseStage,
        notes: caseNotes,
        nextHearingDate: caseNextDate
      }
    });
    const nextSelectedId = selectedMatterId;
    setSelectedClientId("");
    setCaseTitle("");
    setCaseStage("Draft");
    setCaseNextDate("");
    setCaseNotes("");
    if (!nextSelectedId) {
      setSelectedMatterId("");
    }
    hydrateLawyerData();
  };

  const saveTask = async () => {
    if (!taskTitle.trim()) return;
    await runLegalAction("task_upsert", {
      ownerId,
      task: {
        title: taskTitle,
        dueDate: taskDueDate,
        status: "pending",
        relatedCaseId: selectedMatter?.id || ""
      }
    });
    setTaskTitle("");
    setTaskDueDate("");
    hydrateLawyerData();
  };

  const updateTaskStatus = async (taskId, statusValue) => {
    const existingTask = (tasks || []).find((item) => item.id === taskId);
    if (!existingTask) return;

    await runLegalAction("task_upsert", {
      ownerId,
      task: {
        ...existingTask,
        id: taskId,
        status: statusValue
      }
    });
    setStatus(`Task marked as ${statusValue}.`);
    hydrateLawyerData();
  };

  const saveMemory = async () => {
    if (!memoryTitle.trim()) return;
    await runLegalAction("memory_save", {
      ownerId,
      memory: {
        title: memoryTitle,
        summary: memorySummary,
        tags: memoryTitle.split(" ").slice(0, 4)
      }
    });
    setMemoryTitle("");
    setMemorySummary("");
    setStatus("Memory saved.");
    hydrateLawyerData();
  };

  const suggestMemory = async () => {
    const response = await runLegalAction("memory_suggest", {
      ownerId,
      query: memoryQuery
    });
    setMemorySuggestions(response.suggestions || []);
  };

  const loadMemoryIntoResearch = (memoryItem) => {
    const prompt = [
      `Memory Title: ${memoryItem.title || "Untitled memory"}`,
      `Summary: ${memoryItem.summary || "No summary"}`,
      Array.isArray(memoryItem.tags) && memoryItem.tags.length ? `Tags: ${memoryItem.tags.join(", ")}` : ""
    ].filter(Boolean).join("\n");
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus(`Loaded memory "${memoryItem.title || "memory"}" into research.`);
  };

  const applyTemplate = (template) => {
    setSelectedTemplateId(template.id);
    setDraftType(template.draftType);
    setLawyerInput(template.body);
    setLawyerTab("draft");
    setStatus(`Template loaded: ${template.title}`);
  };

  const applyMappingEntry = (entry) => {
    const prompt = `${entry.legacy} is now being checked against ${entry.current} for ${entry.topic}. Verify the current statutory text, section numbering, and any transitional case-law issues before final advice.`;
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus(`Loaded mapping note for ${entry.legacy}.`);
  };

  const loadMatterIntoResearch = () => {
    if (!selectedMatter) return;
    const prompt = [
      `Matter: ${selectedMatter.title || "Untitled case"}`,
      selectedMatterClient ? `Client: ${selectedMatterClient.name || "Unnamed client"} | ${selectedMatterClient.phone || "No phone"}` : "",
      `Stage: ${selectedMatter.stage || "Draft"}`,
      `Next Hearing: ${selectedMatter.nextHearingDate || "Not set"}`,
      selectedMatter.notes ? `Matter Notes:\n${selectedMatter.notes}` : "",
      chronologyEntries.length
        ? `Chronology:\n${chronologyEntries.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n")}`
        : "",
      selectedMatterTasks.length
        ? `Pending Tasks:\n${selectedMatterTasks.map((item) => `- ${item.title || "Task"} (${item.dueDate || "No deadline"})`).join("\n")}`
        : "",
      hearingNotes ? `Hearing Notes:\n${hearingNotes}` : "",
      "Prepare research issues, risks, and next procedural steps."
    ].filter(Boolean).join("\n\n");
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus(`Loaded matter workspace for ${selectedMatter.title || "selected case"} into research.`);
  };

  const exportMatterPrep = () => {
    if (!selectedMatter && !chronologyEntries.length && !selectedMatterTasks.length && !hearingNotes.trim()) {
      return;
    }

    const content = [
      "MATTER PREP SHEET",
      "",
      `Matter: ${selectedMatter?.title || "Not selected"}`,
      `Client: ${selectedMatterClient?.name || "Not linked"}`,
      `Stage: ${selectedMatter?.stage || "Not set"}`,
      `Next Hearing: ${selectedMatter?.nextHearingDate || "Not set"}`,
      `Matter Notes: ${selectedMatter?.notes || "No notes added"}`,
      "",
      "Chronology:",
      chronologyEntries.length
        ? chronologyEntries.map((item) => `- ${item.date || "No date"} | ${item.event}`).join("\n")
        : "Not prepared",
      "",
      "Pending Tasks:",
      selectedMatterTasks.length
        ? selectedMatterTasks.map((item) => `- ${item.title || "Task"} | ${item.dueDate || "No deadline"} | ${item.status || "pending"}`).join("\n")
        : "No linked tasks",
      "",
      "Hearing Prep Notes:",
      hearingNotes || "No notes added"
    ].join("\n");

    saveTextFile("matter-prep-sheet.txt", content);
    setStatus("Matter prep sheet exported.");
  };

  const exportPublicOutput = () => {
    if (!publicOutput) return;
    const content =
`PUBLIC LEGAL GUIDANCE

Explanation:
${publicOutput.explanation || ""}

Applicable Law:
${(publicOutput.law || []).join("\n- ")}

Steps:
${(publicOutput.steps || []).join("\n- ")}

Suggested Actions:
${(publicOutput.suggestedActions || []).join("\n- ")}

Complaint/Notice:
${publicOutput.complaintNotice || ""}

Disclaimer:
${PUBLIC_DISCLAIMER}`;
    saveTextFile("public-legal-guidance.txt", content);
    setStatus("Public guidance exported.");
  };

  const exportLawyerOutput = () => {
    if (!lawyerOutput) return;
    if (lawyerTab === "document") {
      const memoText = lawyerOutput.memoText || buildDocumentMemoText(lawyerOutput, {
        clientLabel: selectedMatterClient?.name || selectedClient?.name || "",
        matterLabel: selectedMatter?.title || caseTitle || ""
      });
      saveTextFile(`document-analysis-memo-${new Date().toISOString().slice(0, 10)}.doc.txt`, memoText);
      setStatus("Document analysis memo exported.");
      return;
    }
    const sections = [
      lawyerOutput.caseSummary ? `Case Summary:\n${lawyerOutput.caseSummary}` : "",
      lawyerOutput.applicableSections?.length ? `Applicable Sections:\n- ${lawyerOutput.applicableSections.join("\n- ")}` : "",
      lawyerOutput.caseLaws?.length ? `Case Laws:\n- ${lawyerOutput.caseLaws.join("\n- ")}` : "",
      lawyerOutput.judgmentSummary ? `Judgment Summary:\n${lawyerOutput.judgmentSummary}` : "",
      lawyerOutput.draft ? `Draft:\n${lawyerOutput.draft}` : "",
      lawyerOutput.strengths?.length ? `Strengths:\n- ${lawyerOutput.strengths.join("\n- ")}` : "",
      lawyerOutput.weaknesses?.length ? `Weaknesses:\n- ${lawyerOutput.weaknesses.join("\n- ")}` : "",
      lawyerOutput.strategy?.length ? `Strategy:\n- ${lawyerOutput.strategy.join("\n- ")}` : "",
      lawyerOutput.riskLevel ? `Risk Level:\n${lawyerOutput.riskLevel}` : "",
      lawyerOutput.summary ? `Document Summary:\n${lawyerOutput.summary}` : ""
    ].filter(Boolean).join("\n\n");
    saveTextFile("lawyer-ai-output.txt", sections || "No output available");
    setStatus("Lawyer output exported.");
  };

  const copyLawyerDraft = async () => {
    if (!lawyerOutput?.draft || !navigator.clipboard) return;
    await navigator.clipboard.writeText(lawyerOutput.draft);
    setStatus("Draft copied.");
  };

  const copyDocumentMemo = async () => {
    if (!lawyerOutput || !navigator.clipboard) return;
    const memoText = lawyerOutput.memoText || buildDocumentMemoText(lawyerOutput, {
      clientLabel: selectedMatterClient?.name || selectedClient?.name || "",
      matterLabel: selectedMatter?.title || caseTitle || ""
    });
    await navigator.clipboard.writeText(memoText);
    setStatus("Document memo copied.");
  };

  const downloadDocumentMemoPdf = () => {
    if (!lawyerOutput) return;
    const memoText = lawyerOutput.memoText || buildDocumentMemoText(lawyerOutput, {
      clientLabel: selectedMatterClient?.name || selectedClient?.name || "",
      matterLabel: selectedMatter?.title || caseTitle || ""
    });
    const pdf = new jsPDF();
    const lines = pdf.splitTextToSize(memoText, 180);
    let y = 18;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("Document Analysis Memo", 14, y);
    y += 10;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);

    lines.forEach((line) => {
      if (y > 280) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(line, 14, y);
      y += 6;
    });

    pdf.save(`document-analysis-memo-${Date.now()}.pdf`);
    setStatus("Document memo PDF downloaded.");
  };

  const generateDocumentMemo = async () => {
    const payload = {
      ownerId,
      documentText: docText || lawyerInput,
      caseFacts: documentCompareFacts || intakeOutput?.factSummary || caseNotes || lawyerInput,
      clientLabel: selectedMatterClient?.name || selectedClient?.name || "",
      matterLabel: selectedMatter?.title || caseTitle || ""
    };

    try {
      setBusy(true);
      setStatus("Generating document analysis memo...");
      const response = await analyzeLegalDocument(payload, { format: "memo" });
      setLawyerOutput({
        ...response,
        memoText: response.memoText || buildDocumentMemoText(response, payload),
        memoTitle: response.memoTitle || "Document Analysis Memo"
      });
      setDocumentMemoMode(true);
      setStatus("Document analysis memo generated.");
    } catch (error) {
      const fallback = buildLocalDocumentAnalysis(payload);
      setLawyerOutput({
        ...fallback,
        format: "memo",
        memoTitle: "Document Analysis Memo",
        memoText: buildDocumentMemoText(fallback, payload)
      });
      setDocumentMemoMode(true);
      setStatus("Document analysis memo generated.");
    } finally {
      setBusy(false);
    }
  };

  const exportClientResearchPack = () => {
    const content = [
      "CLIENT RESEARCH PACK",
      "",
      `Matter: ${intakeOutput?.matterTitle || selectedMatter?.title || caseTitle || "Untitled matter"}`,
      `Client Summary: ${intakeOutput?.clientSummary || selectedMatterClient?.name || "Not added"}`,
      "",
      memoOutput?.issueList?.length ? `Issue List:\n- ${memoOutput.issueList.join("\n- ")}` : "Issue List:\n- Pending",
      "",
      memoOutput?.proceduralNotes?.length ? `Procedural Notes:\n- ${memoOutput.proceduralNotes.join("\n- ")}` : "Procedural Notes:\n- Pending",
      "",
      memoOutput?.bestCases?.length ? `Best Cases:\n- ${memoOutput.bestCases.map((item) => `${item.title} | ${item.citation} | ${item.whyItMatters}`).join("\n- ")}` : "Best Cases:\n- Pending",
      "",
      relatedJudgments.length
        ? `Latest Matched Judgments:\n- ${relatedJudgments.map((item) => `${item.title} | ${item.citation || "No citation"} | ${item.treatmentStatus || "verify"}`).join("\n- ")}`
        : "Latest Matched Judgments:\n- Pending",
      "",
      noticeOutput?.noticeDraft ? `Draft Notice:\n${noticeOutput.noticeDraft}` : "Draft Notice:\nPending",
      "",
      "Prepared using MediLink AI Lawyer Workspace",
      "Lawyer review required before filing or client advice."
    ].join("\n");

    saveTextFile("client-research-pack.txt", content);
    setStatus("Client research pack exported.");
  };

  const exportArgumentOutput = () => {
    if (!argumentOutput) return;

    const sideSections = (label, sections = []) => [
      label,
      ...sections.flatMap((section) => [
        `Issue: ${section.issue || "Issue"}`,
        ...(section.arguments || []).flatMap((entry) => [
          `Title: ${entry.title || "Argument"}`,
          `Legal Basis: ${entry.legalBasis || "Not available"}`,
          `Reasoning: ${entry.reasoning || "Not available"}`,
          `Risk Note: ${entry.riskNote || "Not available"}`,
          entry.caseReferences?.length
            ? `Case References: ${entry.caseReferences.map((item) => item.citation || item.title || item.caseId).join(" | ")}`
            : "Case References: None"
        ])
      ])
    ];

    saveTextFile(`argument-builder-${new Date().toISOString().slice(0, 10)}.txt`, [
      `Matter ID: ${argumentOutput.matterId || "N/A"}`,
      `Mode: ${argumentOutput.mode || "detailed"}`,
      argumentOutput.warnings?.length ? `Warnings:\n- ${argumentOutput.warnings.join("\n- ")}` : "Warnings:\n- None",
      ...sideSections("Petitioner Arguments", argumentOutput.petitionerArguments || []),
      ...sideSections("Respondent Arguments", argumentOutput.respondentArguments || [])
    ].join("\n\n"));
    setStatus("Argument builder output exported.");
  };

  const exportSavedDraft = (draftItem) => {
    if (!draftItem?.content) return;
    const safeName = String(draftItem.title || "lawyer-draft").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    saveTextFile(`${safeName}.txt`, draftItem.content);
    setStatus(`Exported ${draftItem.title || "draft"}.`);
  };

  const openSavedDraft = (draftItem) => {
    setDraftType(draftItem.draftType || "petition");
    setLawyerInput(draftItem.facts || "");
    setLawyerOutput({
      draft: draftItem.content || ""
    });
    if (draftItem.relatedCaseId) {
      setSelectedMatterId(draftItem.relatedCaseId);
    }
    setLawyerTab("draft");
    setStatus(`Loaded draft "${draftItem.title || "draft"}".`);
  };

  const pinCitationToMemory = async (citationText) => {
    try {
      await runLegalAction("memory_save", {
        ownerId,
        memory: {
          title: citationText,
          summary: "Pinned citation from AI output for future case reference.",
          tags: ["citation", "pinned"]
        }
      });
      setStatus("Citation pinned to smart memory.");
    } catch (error) {
      setStatus(error.message || "Failed to pin citation.");
    }
  };

  return (
    <div className="page-shell law-shell">
      <div className="law-header soft-panel">
        <div>
          <div className="eyebrow">Law Assistant</div>
          <h1>AI Legal Research and Drafting Workspace for Busy Lawyers</h1>
          <p className="muted-copy">
            Built to reduce lawyer workload fast: intake, chronology, memo, latest judgments,
            ranked authorities, drafting, workflow, and reusable matter memory in one place.
          </p>
          <p className="muted-copy">
            Current legal references should be checked against BNS, BNSS, and BSA. Older IPC/CrPC citations may still appear in legacy judgments.
          </p>
        </div>
        <div className="law-mode-toggle">
          <button type="button" className={mode === "public" ? "header-pill" : "ghost-button"} onClick={() => setSearchParams({ mode: "public" })}>
            Public User Mode
          </button>
          <button type="button" className={mode === "lawyer" ? "header-pill" : "ghost-button"} onClick={() => setSearchParams({ mode: "lawyer" })}>
            Lawyer Mode
          </button>
        </div>
      </div>

      {!hasRole[mode] ? (
        <div className="soft-panel law-role-card">
          <h3>{mode === "lawyer" ? "Activate Lawyer Role" : "Activate Public Role"}</h3>
          <p className="muted-copy">Login already complete. Finish role signup here to open the dedicated legal module.</p>
          <button type="button" className="primary-button" onClick={() => activateRole(mode)}>
            Signup as {mode === "lawyer" ? "Lawyer" : "Public User"}
          </button>
        </div>
      ) : null}

      {hasRole.public && mode === "public" ? (
        <section className="law-grid">
          <div className="soft-panel">
            <div className="section-title">Public Legal Chat</div>
            <label>
              Language
              <select value={publicLanguage} onChange={(event) => setPublicLanguage(event.target.value)}>
                <option value="english">English</option>
                <option value="telugu">Telugu</option>
              </select>
            </label>
            <label>
              Location
              <input value={publicLocation} onChange={(event) => setPublicLocation(event.target.value)} placeholder="City / District / State" />
            </label>
            <label>
              Legal Problem Description
              <textarea rows={6} value={publicProblem} onChange={(event) => setPublicProblem(event.target.value)} placeholder="Describe your issue" />
            </label>
            <div className="law-inline-actions">
              <button type="button" className="ghost-button" onClick={() => startVoiceInput(setPublicProblem)}>Voice Input</button>
              <label className="ghost-button law-upload-button">
                Upload Document
                <input type="file" hidden onChange={(event) => extractFromFile(event.target.files?.[0], setPublicDocText, setPublicExtractionMeta)} accept=".txt,.md,.json,.csv,.pdf,image/*" />
              </label>
            </div>
            {publicExtractionMeta ? (
              <div className="law-extract-meta">
                <div><strong>OCR Quality:</strong> {publicExtractionMeta.qualityScore}%</div>
                <div><strong>Engine:</strong> {publicExtractionMeta.extractionEngine}</div>
              </div>
            ) : null}
            <label>
              Document Text
              <textarea rows={5} value={publicDocText} onChange={(event) => setPublicDocText(event.target.value)} placeholder="Auto-filled after upload or paste manually" />
            </label>
            <button type="button" className="primary-button" disabled={busy} onClick={askPublicAssistant}>
              {busy ? "Processing..." : "Get Legal Guidance"}
            </button>
          </div>

          <div className="soft-panel">
            <div className="section-title">Structured Output</div>
            {publicOutput ? (
              <>
                <div className="law-inline-actions">
                  <button type="button" className="ghost-button" onClick={exportPublicOutput}>Export Guidance</button>
                </div>
                <h4>Explanation</h4>
                <p>{publicOutput.explanation}</p>
                <h4>Applicable Law</h4>
                <ul>{renderList(publicOutput.law)}</ul>
                {publicOutput.legalVersionNotice ? <div className="law-disclaimer">{publicOutput.legalVersionNotice}</div> : null}
                <h4>Step-by-step Guidance</h4>
                <ul>{renderList(publicOutput.steps)}</ul>
                <h4>Suggested Actions</h4>
                <ul>{renderList(publicOutput.suggestedActions)}</ul>
                <h4>Auto-generated Complaint / Notice</h4>
                <pre className="law-pre">{publicOutput.complaintNotice}</pre>
                <div className="law-disclaimer">{PUBLIC_DISCLAIMER}</div>
                {publicExtractionMeta?.pagePreviews?.length ? (
                  <>
                    <h4>Document Page Preview</h4>
                    <div className="law-page-grid">
                      {publicExtractionMeta.pagePreviews.map((item) => (
                        <div key={`public-page-${item.page}`} className="law-page-card">
                          <strong>Page {item.page}</strong>
                          <p>{item.excerpt}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <p className="muted-copy">Submit your query to generate legal guidance output.</p>
            )}
          </div>
        </section>
      ) : null}

      {hasRole.lawyer && mode === "lawyer" ? (
        <section className="law-grid law-grid-lawyer">
          <aside className="soft-panel law-sidebar">
            <div className="section-title">Lawyer Dashboard</div>
            <div className="law-plan-chip">{usageSummary}</div>
            <div className="law-alerts">
              <div className="law-alerts-title">Tomorrow Demo Mode</div>
              <p className="muted-copy">Load a ready matter and show intake, memo, latest judgments, and notice pack in one smooth flow.</p>
              <button type="button" className="primary-button" onClick={launchDemoMatter}>
                Load Demo Matter
              </button>
              <ul>
                {demoChecklist.map((item) => (
                  <li key={item.label} className={`law-alert-item ${item.done ? "ok" : "warning"}`}>
                    <strong>{item.done ? "Ready" : "Pending"}</strong>: {item.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Practice Snapshot</div>
              <ul>
                {practiceSummary.map((item) => (
                  <li key={item.label} className="law-alert-item ok">
                    <strong>{item.label}</strong>
                    <div>{item.value}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Value Proof</div>
              <ul>
                {valueProof.map((item) => (
                  <li key={item.label} className="law-alert-item ok">
                    <strong>{item.label}</strong>
                    <div>{item.value}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Continue Last Matter</div>
              {continueMatter ? (
                <div className="law-alert-item ok">
                  <strong>{continueMatter.title}</strong>
                  <div>{continueMatter.meta}</div>
                  <button type="button" className="ghost-button" onClick={continueLastMatter}>
                    Continue
                  </button>
                </div>
              ) : (
                <p className="muted-copy">No saved matter to continue yet.</p>
              )}
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Upcoming Alerts</div>
              {workflowAlerts.length ? (
                <ul>
                  {workflowAlerts.map((item) => (
                    <li key={item.id} className={`law-alert-item ${item.severity.type}`}>
                      <strong>{item.source}</strong>: {item.title}
                      <div>{item.severity.label}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No upcoming deadlines yet.</p>
              )}
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Red Flags</div>
              {redFlagItems.length ? (
                <ul>
                  {redFlagItems.map((item) => (
                    <li key={item.id} className="law-alert-item danger">
                      <strong>{item.type === "task" ? "Task" : "Matter"}</strong>: {item.title}
                      <div>{item.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No major red flags detected right now.</p>
              )}
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Today Queue</div>
              {todayQueue.length ? (
                <ul>
                  {todayQueue.map((item) => (
                    <li key={item.id} className="law-alert-item warning">
                      <strong>{item.type === "task" ? "Task" : "Matter"}</strong>: {item.title}
                      <div>{item.meta}</div>
                      <button type="button" className="ghost-button" onClick={() => openQueueItem(item)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No priority queue items right now.</p>
              )}
            </div>
            <div className="law-alerts">
              <div className="law-alerts-title">Resume Work</div>
              {resumeDrafts.length ? (
                <ul>
                  {resumeDrafts.map((item) => (
                    <li key={item.id} className="law-alert-item ok">
                      <strong>{item.draftType || "draft"}</strong>: {item.title || "Untitled draft"}
                      <div>{item.relatedCaseId ? "Matter linked" : "Standalone draft"}</div>
                      <button type="button" className="ghost-button" onClick={() => openSavedDraft(item)}>
                        Resume
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No recent drafts to resume.</p>
              )}
            </div>
            <div className="law-tab-list">
              {LAWYER_TABS.map((tab) => (
                <button key={tab.id} type="button" className={lawyerTab === tab.id ? "header-pill" : "ghost-button"} onClick={() => { setLawyerTab(tab.id); setLawyerOutput(null); }}>
                  {tab.label}
                </button>
              ))}
            </div>
          </aside>

          <div className="soft-panel">
            {lawyerTab === "intake" ? (
              <>
                <div className="section-title">Matter Intake</div>
                {!canRunLawyerAi ? <div className="law-disclaimer">AI limit reached. Upgrade your plan to continue.</div> : null}
                <label>
                  Raw Client Facts
                  <textarea rows={8} value={intakeFacts} onChange={(event) => setIntakeFacts(event.target.value)} placeholder="Paste raw client narration, office notes, call summary, or WhatsApp facts..." />
                </label>
                <div className="law-inline-actions">
                  <button type="button" className="ghost-button" onClick={() => startVoiceInput(setIntakeFacts)}>Voice Intake</button>
                  <label className="ghost-button law-upload-button">
                    Upload Intake Document
                    <input type="file" hidden onChange={(event) => extractFromFile(event.target.files?.[0], setIntakeDocText, setIntakeExtractionMeta)} accept=".txt,.md,.json,.csv,.pdf,image/*" />
                  </label>
                  <button type="button" className="ghost-button" disabled={busy || !canRunLawyerAi} onClick={runChronologyBuilder}>
                    Auto Chronology
                  </button>
                </div>
                {intakeExtractionMeta ? (
                  <div className="law-extract-meta">
                    <div><strong>OCR Quality:</strong> {intakeExtractionMeta.qualityScore}%</div>
                    <div><strong>Engine:</strong> {intakeExtractionMeta.extractionEngine}</div>
                  </div>
                ) : null}
                <label>
                  Intake Document Text
                  <textarea rows={6} value={intakeDocText} onChange={(event) => setIntakeDocText(event.target.value)} placeholder="Auto-filled after upload or paste from client documents..." />
                </label>
                <button type="button" className="primary-button" disabled={busy || !canRunLawyerAi} onClick={runMatterIntake}>
                  {busy ? "Processing..." : "Prepare Matter Sheet"}
                </button>

                {intakeOutput ? (
                  <div className="law-output-block">
                    <h4>Matter Title</h4>
                    <p>{intakeOutput.matterTitle}</p>
                    <h4>Client Summary</h4>
                    <p>{intakeOutput.clientSummary}</p>
                    <h4>Fact Summary</h4>
                    <p>{intakeOutput.factSummary}</p>
                    <h4>Legal Issues</h4>
                    <ul>{renderList(intakeOutput.legalIssues)}</ul>
                    <h4>Reliefs To Consider</h4>
                    <ul>{renderList(intakeOutput.reliefsToConsider)}</ul>
                    <h4>Documents Required</h4>
                    <ul>{renderList(intakeOutput.documentsRequired)}</ul>
                    <h4>Next Steps</h4>
                    <ul>{renderList(intakeOutput.nextSteps)}</ul>
                    {intakeChronology.length ? (
                      <>
                        <h4>Auto Chronology</h4>
                        <ul>
                          {intakeChronology.map((item, index) => (
                            <li key={`${item.date || "nodate"}-${index}`}>
                              {item.date || "No date"} | {item.event} | {item.source || "mixed"}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {intakeOutput.legalVersionNotice ? <div className="law-disclaimer">{intakeOutput.legalVersionNotice}</div> : null}
                    {intakeOutput.retrievedAuthorities?.length ? (
                      <>
                        <h4>Retrieved Authorities</h4>
                        {renderAuthorities(intakeOutput.retrievedAuthorities, revalidateAuthorityNow)}
                      </>
                    ) : null}
                    <div className="law-inline-actions">
                      <button type="button" className="ghost-button" onClick={loadIntakeIntoWorkflow}>Send To Workflow</button>
                      <button type="button" className="ghost-button" onClick={loadIntakeIntoResearch}>Send To Research</button>
                      <button type="button" className="ghost-button" onClick={findAuthoritiesFromCurrentMatter}>
                        Find Related Judgments
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {lawyerTab === "case-studies" ? (
              <>
                <div className="section-title">Case Studies</div>
                <p className="muted-copy">Reusable example matters to learn patterns quickly and preload your workflow with realistic legal scenarios.</p>
                <div className="law-template-grid">
                  {CASE_STUDIES.map((study) => (
                    <div key={study.id} className="soft-panel">
                      <h4>{study.title}</h4>
                      <p className="muted-copy">{study.category}</p>
                      <p>{study.summary}</p>
                      <div className="law-inline-actions">
                        <button type="button" className="primary-button" onClick={() => applyCaseStudy(study, "intake")}>
                          Use In Intake
                        </button>
                        <button type="button" className="ghost-button" onClick={() => applyCaseStudy(study, "research")}>
                          Use In Research
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {lawyerTab === "judgments" ? (
              <>
                <div className="section-title">Latest Judgments</div>
                <p className="muted-copy">Track recent authority briefs by court and issue, then move a useful judgment directly into research.</p>
                <div className="law-inline-actions">
                  <label>
                    Search
                    <input
                      value={judgmentQuery}
                      onChange={(event) => setJudgmentQuery(event.target.value)}
                      placeholder="cheque bounce, arbitration, consumer, service law..."
                    />
                  </label>
                  <label>
                    Court
                    <select value={judgmentCourt} onChange={(event) => setJudgmentCourt(event.target.value)}>
                      <option value="all">All courts</option>
                      <option value="Supreme Court">Supreme Court</option>
                      <option value="Delhi High Court">Delhi High Court</option>
                      <option value="Bombay High Court">Bombay High Court</option>
                      <option value="Karnataka High Court">Karnataka High Court</option>
                      <option value="Consumer Commission">Consumer Commission</option>
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={judgmentStatus} onChange={(event) => setJudgmentStatus(event.target.value)}>
                      <option value="all">All status</option>
                      <option value="followed">Followed</option>
                      <option value="relied on">Relied on</option>
                      <option value="good law check needed">Good law check needed</option>
                      <option value="distinguished risk">Distinguished risk</option>
                    </select>
                  </label>
                  <label>
                    Date Range
                    <select value={judgmentDateWindow} onChange={(event) => setJudgmentDateWindow(event.target.value)}>
                      <option value="all">All dates</option>
                      <option value="30d">Last 30 days</option>
                      <option value="90d">Last 90 days</option>
                      <option value="180d">Last 180 days</option>
                    </select>
                  </label>
                  <button type="button" className="ghost-button" onClick={hydrateLawyerData}>
                    Refresh Feed
                  </button>
                  <button type="button" className="ghost-button" disabled={busy} onClick={() => triggerLiveJudgmentRetrieve("all")}>
                    Live Retrieve
                  </button>
                  <button type="button" className="primary-button" onClick={findAuthoritiesFromCurrentMatter} disabled={busy || !judgmentContextText.trim()}>
                    Match From Current Matter
                  </button>
                  <button type="button" className="ghost-button" onClick={() => loadCitationView(selectedJudgment || relatedJudgments[0] || judgments[0])} disabled={citationLoading || !(selectedJudgment || relatedJudgments[0] || judgments[0])}>
                    Open Citations
                  </button>
                </div>
                <div className="law-disclaimer">
                  {judgmentFeedMode === "live"
                    ? "Live judgment feed loaded. Still verify the full text, latest status, and citation before filing."
                    : "Judgment workspace is using the currently available index. Run Live Retrieve to pull from configured court sources and verify the full text before filing."}
                </div>
                {judgmentSyncStatus ? (
                  <div className="law-extract-meta">
                    <div><strong>Feed Mode:</strong> {judgmentSyncStatus.feedMode || "demo"}</div>
                    <div><strong>Current Source Mode:</strong> {judgmentSourceMode || "cache"}</div>
                    <div><strong>Total Briefs:</strong> {judgmentSyncStatus.totalCount || 0}</div>
                    <div><strong>Latest Date:</strong> {judgmentSyncStatus.latestDate || "Not available"}</div>
                  </div>
                ) : null}
                {judgmentSyncStatus?.sources?.length ? (
                  <div className="law-list-block">
                    <h4>Ingestion Roadmap</h4>
                    <ul>{renderList(judgmentSyncStatus.sources)}</ul>
                  </div>
                ) : null}
                {judgmentSyncStatus?.plannedCollections?.length ? (
                  <div className="law-list-block">
                    <h4>Sync Collections</h4>
                    <ul>{renderList(judgmentSyncStatus.plannedCollections)}</ul>
                  </div>
                ) : null}
                {judgmentTemplates.length ? (
                  <div className="law-list-block">
                    <h4>Import Templates</h4>
                    <ul>
                      {judgmentTemplates.map((item) => (
                        <li key={item.id}>
                          <strong>{item.label || item.id}</strong> | Required: {(item.requiredFields || []).join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="law-disclaimer">
                  Backend supports live court retrieval and direct import through `judgment_import_payload`. New source payloads can be written into the judgment index without changing this UI.
                </div>
                <div className="law-disclaimer">
                  Source examples are available in `functions/legalLiveSources.example.json` and `functions/legalJudgmentImport.example.json`.
                </div>
                {judgmentSources.length ? (
                  <div className="law-list-block">
                    <div className="law-inline-actions">
                      <h4 style={{ margin: 0 }}>Source Registry</h4>
                      <button type="button" className="ghost-button" disabled={busy} onClick={() => triggerJudgmentSync("all")}>
                        Run All Sync
                      </button>
                    </div>
                    <ul>
                      {judgmentSources.map((item) => (
                        <li key={item.id}>
                          {item.name || item.court || "Source"} | {item.status || "planned"} | {item.cadence || "manual"} | Template: {item.importTemplate || "default"}
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ marginLeft: "12px" }}
                            disabled={busy}
                            onClick={() => triggerJudgmentSync(item.id)}
                          >
                            Run Sync
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {judgmentSyncStatus?.recentRuns?.length ? (
                  <div className="law-list-block">
                    <h4>Recent Sync Runs</h4>
                    <ul>
                      {judgmentSyncStatus.recentRuns.map((item) => (
                        <li key={item.id}>
                          {item.sourceId || "all"} | {item.status || "planned"} | {item.startedAt || "Not started"} | {item.notes || "--"}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selectedJudgment ? (
                  <div className="law-output-block">
                    <div className="law-inline-actions">
                      <h4 style={{ margin: 0 }}>Judgment Detail</h4>
                      <button type="button" className="ghost-button" disabled={busy} onClick={() => revalidateAuthorityNow(selectedJudgment)}>
                        Revalidate Now
                      </button>
                      <button type="button" className="ghost-button" onClick={() => setSelectedJudgment(null)}>
                        Close
                      </button>
                    </div>
                    <p><strong>{selectedJudgment.title || "Judgment brief"}</strong></p>
                    <p className="muted-copy">
                      {selectedJudgment.court || "Court not tagged"} | {selectedJudgment.judgmentDate || "No date"} | {selectedJudgment.bench || "Bench not tagged"}
                    </p>
                    <p><strong>Citation:</strong> {selectedJudgment.citation || "No citation yet"}</p>
                    {selectedJudgmentValidity ? (
                      <div className="law-extract-meta">
                        <div>
                          <strong>Validity:</strong> {getValidityTone(selectedJudgmentValidity.status).icon} {getValidityTone(selectedJudgmentValidity.status).label}
                        </div>
                        <div><strong>Risk:</strong> {selectedJudgmentValidity.riskLevel || "MEDIUM"}</div>
                        <div><strong>Confidence:</strong> {selectedJudgmentValidity.confidenceScore || 0}/100</div>
                      </div>
                    ) : null}
                    {selectedJudgmentValidity?.freshness ? (
                      <div className="law-inline-actions" style={{ marginTop: "12px" }}>
                        {renderFreshnessBadge("Good-law check", selectedJudgmentValidity.freshness.verificationFreshness, selectedJudgmentValidity.freshness.lastVerifiedAt)}
                        {renderFreshnessBadge("Source update", selectedJudgmentValidity.freshness.sourceFreshness, selectedJudgmentValidity.freshness.lastSourceUpdateAt)}
                        {renderFreshnessBadge("Treatment date", selectedJudgmentValidity.freshness.treatmentFreshness, selectedJudgmentValidity.freshness.lastTreatmentDate)}
                      </div>
                    ) : null}
                    {!selectedJudgmentValidity && caseValidityLoadingKey === getJudgmentValidityKey(selectedJudgment) ? <p className="muted-copy">Checking case validity...</p> : null}
                    {selectedJudgment.treatmentStatus ? <p><strong>Status:</strong> {selectedJudgment.treatmentStatus}</p> : null}
                    {selectedJudgment.authorityStrength ? <p><strong>Authority Strength:</strong> {selectedJudgment.authorityStrength}</p> : null}
                    {selectedJudgment.treatmentSummary ? <p><strong>Treatment Summary:</strong> {selectedJudgment.treatmentSummary}</p> : null}
                    {selectedJudgment.summary ? <p><strong>Summary:</strong> {selectedJudgment.summary}</p> : null}
                    {selectedJudgment.ratioNote ? <p><strong>Ratio Note:</strong> {selectedJudgment.ratioNote}</p> : null}
                    {selectedJudgment.cautionFlag ? <p><strong>Caution:</strong> {selectedJudgment.cautionFlag}</p> : null}
                    {selectedJudgmentValidity ? (
                      <details>
                        <summary><strong>Why this status?</strong></summary>
                        <p style={{ marginTop: "12px" }}>{selectedJudgmentValidity.summary}</p>
                        <p className="muted-copy">
                          Signals: {selectedJudgmentValidity.signalBreakdown?.signalCount || 0} | Positive score: {selectedJudgmentValidity.signalBreakdown?.positiveScore || 0} | Negative score: {selectedJudgmentValidity.signalBreakdown?.negativeScore || 0}
                        </p>
                        {selectedJudgmentValidity.topPositiveCases?.length ? (
                          <>
                            <h4>Cases supporting validity</h4>
                            <ul>
                              {selectedJudgmentValidity.topPositiveCases.map((item, index) => (
                                <li key={`positive-${item.caseId}-${index}`}>
                                  {(item.title || item.caseId)} | {item.relationType} | {item.court || "Court not tagged"} | {item.date || "No date"}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        {selectedJudgmentValidity.topNegativeCases?.length ? (
                          <>
                            <h4>Cases affecting validity</h4>
                            <ul>
                              {selectedJudgmentValidity.topNegativeCases.map((item, index) => (
                                <li key={`negative-${item.caseId}-${index}`}>
                                  {(item.title || item.caseId)} | {item.relationType} | {item.reasonCode === "partial_overrule" ? "partial impact" : "negative treatment"} | {item.date || "No date"}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </details>
                    ) : null}
                    {selectedJudgment.holdingPoints?.length ? (
                      <>
                        <h4>Holding Points</h4>
                        <ul>{renderList(selectedJudgment.holdingPoints)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.keyParagraphs?.length ? (
                      <>
                        <h4>Key Paragraphs To Verify</h4>
                        <ul>{renderList(selectedJudgment.keyParagraphs)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.citedBy?.length ? (
                      <>
                        <h4>Cited By</h4>
                        <ul>{renderList(selectedJudgment.citedBy)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.followedBy?.length ? (
                      <>
                        <h4>Followed By</h4>
                        <ul>{renderList(selectedJudgment.followedBy)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.distinguishedBy?.length ? (
                      <>
                        <h4>Distinguished By</h4>
                        <ul>{renderList(selectedJudgment.distinguishedBy)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.overruledBy?.length ? (
                      <>
                        <h4>Overruled / Limited By</h4>
                        <ul>{renderList(selectedJudgment.overruledBy)}</ul>
                      </>
                    ) : null}
                    {selectedJudgment.practicalUse?.length ? (
                      <>
                        <h4>Practical Use</h4>
                        <ul>{renderList(selectedJudgment.practicalUse)}</ul>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {compareJudgments.length ? (
                  <div className="law-output-block">
                    <div className="law-inline-actions">
                      <h4 style={{ margin: 0 }}>Compare Judgments</h4>
                      <button type="button" className="ghost-button" onClick={() => setCompareJudgments([])}>
                        Clear Compare
                      </button>
                    </div>
                    <div className="law-template-grid">
                      {compareJudgments.map((item) => (
                        <div key={`compare-${item.id}`} className="soft-panel">
                          <h4>{item.title || "Judgment brief"}</h4>
                          <p><strong>{item.citation || "No citation yet"}</strong></p>
                          <p className="muted-copy">{item.court || "Court"} | {item.judgmentDate || "No date"}</p>
                          {item.treatmentStatus ? <p><strong>Status:</strong> {item.treatmentStatus}</p> : null}
                          {item.ratioNote ? <p><strong>Ratio:</strong> {item.ratioNote}</p> : null}
                          {item.cautionFlag ? <p className="muted-copy">Caution: {item.cautionFlag}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {relatedJudgments.length ? (
                  <>
                    <h4>Related To Current Matter</h4>
                    <div className="law-template-grid">
                      {relatedJudgments.map((item) => (
                        <div key={`related-${item.id}`} className="soft-panel">
                          <h4>{item.title || "Judgment brief"}</h4>
                          <p className="muted-copy">{item.court || "Court not tagged"} | {item.judgmentDate || "No date"} | {item.bench || "Bench not tagged"}</p>
                          <p><strong>{item.citation || "No citation yet"}</strong></p>
                          {caseValidityMap[getJudgmentValidityKey(item)] ? (
                            <p>
                              <strong>Validity:</strong> {getValidityTone(caseValidityMap[getJudgmentValidityKey(item)].status).icon} {getValidityTone(caseValidityMap[getJudgmentValidityKey(item)].status).label}
                            </p>
                          ) : null}
                          {item.sourceType ? <p className="muted-copy">Source Layer: {item.sourceType}</p> : null}
                          <p>{item.summary || "No summary available."}</p>
                          {item.ratioNote ? <p><strong>Ratio Note:</strong> {item.ratioNote}</p> : null}
                          {item.authorityStrength ? <p><strong>Authority Strength:</strong> {item.authorityStrength}</p> : null}
                          {item.practicalUse?.length ? <p className="muted-copy">Practical Use: {item.practicalUse.join(" ")}</p> : null}
                          {item.issueTags?.length ? <p className="muted-copy">Tags: {item.issueTags.join(", ")}</p> : null}
                          <div className="law-inline-actions">
                            <button type="button" className="ghost-button" onClick={() => openJudgmentDetails(item)}>
                              View Details
                            </button>
                            <button type="button" className="ghost-button" onClick={() => toggleCompareJudgment(item)}>
                              Compare
                            </button>
                            <button type="button" className="primary-button" onClick={() => loadJudgmentIntoResearch(item)}>
                              Use In Research
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                <div className="law-template-grid">
                  {judgments.map((item) => (
                    <div key={item.id} className="soft-panel">
                      <h4>{item.title || "Judgment brief"}</h4>
                      <p className="muted-copy">{item.court || "Court not tagged"} | {item.judgmentDate || "No date"} | {item.bench || "Bench not tagged"}</p>
                      <p><strong>{item.citation || "No citation yet"}</strong></p>
                      {caseValidityMap[getJudgmentValidityKey(item)] ? (
                        <p>
                          <strong>Validity:</strong> {getValidityTone(caseValidityMap[getJudgmentValidityKey(item)].status).icon} {getValidityTone(caseValidityMap[getJudgmentValidityKey(item)].status).label}
                        </p>
                      ) : null}
                      {item.sourceType ? <p className="muted-copy">Source Layer: {item.sourceType}</p> : null}
                      <p>{item.summary || "No summary available."}</p>
                      {item.treatmentStatus ? <p><strong>Status:</strong> {item.treatmentStatus}</p> : null}
                      {item.authorityStrength ? <p><strong>Authority Strength:</strong> {item.authorityStrength}</p> : null}
                      {item.ratioNote ? <p><strong>Ratio Note:</strong> {item.ratioNote}</p> : null}
                      {item.cautionFlag ? <p className="muted-copy">Caution: {item.cautionFlag}</p> : null}
                      {item.relevanceNote ? <p className="muted-copy">{item.relevanceNote}</p> : null}
                      {item.practicalUse?.length ? <p className="muted-copy">Practical Use: {item.practicalUse.join(" ")}</p> : null}
                      {item.issueTags?.length ? <p className="muted-copy">Tags: {item.issueTags.join(", ")}</p> : null}
                      <div className="law-inline-actions">
                        <button type="button" className="ghost-button" onClick={() => openJudgmentDetails(item)}>
                          View Details
                        </button>
                        <button type="button" className="ghost-button" onClick={() => toggleCompareJudgment(item)}>
                          Compare
                        </button>
                        <button type="button" className="primary-button" onClick={() => loadJudgmentIntoResearch(item)}>
                          Use In Research
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {judgments.length === 0 ? <p className="muted-copy">No judgments found for this filter yet.</p> : null}
              </>
            ) : null}

            {lawyerTab === "citations" ? (
              <>
                <div className="section-title">Citations</div>
                <p className="muted-copy">See how the selected authority is used, followed, distinguished, or overruled.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={() => loadCitationView()} disabled={citationLoading || !citationTargetCase}>
                    {citationLoading ? "Loading..." : "Load Citations"}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => loadCitationView(selectedJudgment)} disabled={citationLoading || !selectedJudgment}>
                    Use Selected Judgment
                  </button>
                  <button type="button" className="ghost-button" onClick={() => revalidateAuthorityNow(citationTargetCase)} disabled={busy || !(citationTargetCase || citationView)}>
                    Revalidate Now
                  </button>
                </div>
                {citationView ? (
                  <div className="law-output-block">
                    <div className="law-inline-actions" style={{ alignItems: "center" }}>
                      <div>
                        <h4 style={{ marginBottom: "4px" }}>{citationView.caseName || "Selected Case"}</h4>
                        <div className="muted-copy">Canonical Citation: {citationView.canonicalCitation || citationView.canonicalCaseId}</div>
                      </div>
                      <span className={getValidityTone(citationView.status).className}>
                        {getValidityTone(citationView.status).icon} {getValidityTone(citationView.status).label}
                      </span>
                    </div>
                    {citationView.freshness ? (
                      <div className="law-inline-actions" style={{ marginTop: "12px" }}>
                        {renderFreshnessBadge("Good-law check", citationView.freshness.verificationFreshness, citationView.freshness.lastVerifiedAt)}
                        {renderFreshnessBadge("Source update", citationView.freshness.sourceFreshness, citationView.freshness.lastSourceUpdateAt)}
                        {renderFreshnessBadge("Treatment date", citationView.freshness.treatmentFreshness, citationView.freshness.lastTreatmentDate)}
                      </div>
                    ) : null}
                    {citationView.alternateCitations?.length ? (
                      <>
                        <h4>Alternate Citations</h4>
                        <ul>{renderList(citationView.alternateCitations)}</ul>
                      </>
                    ) : null}
                    <div className="law-template-grid">
                      {[
                        { label: "Cited by", value: citationView.metrics?.citedByCount || 0 },
                        { label: "Followed by", value: citationView.metrics?.followedByCount || 0 },
                        { label: "Overruled by", value: citationView.metrics?.overruledByCount || 0 }
                      ].map((item) => (
                        <div key={item.label} className="soft-panel">
                          <h4>{item.label}</h4>
                          <p style={{ fontSize: "28px", margin: "8px 0 0" }}><strong>{item.value}</strong></p>
                        </div>
                      ))}
                    </div>
                    {[
                      { key: "citedCases", label: "Cited Cases" },
                      { key: "citedBy", label: "Cited By" },
                      { key: "followedCases", label: "Followed Cases" },
                      { key: "overruledBy", label: "Overruled By" },
                      { key: "distinguishedCases", label: "Distinguished Cases" }
                    ].map((section) => {
                      const items = citationView.relations?.[section.key] || [];
                      const visibleItems = citationExpanded[section.key] ? items : items.slice(0, 10);
                      return (
                        <div key={section.key} className="law-list-block">
                          <div className="law-inline-actions">
                            <h4 style={{ margin: 0 }}>{section.label}</h4>
                            <span className="muted-copy">{items.length}</span>
                          </div>
                          {items.length ? (
                            <>
                              <ul>
                                {visibleItems.map((item, index) => {
                                  const tone = getRelationTone(item.relationType);
                                  return (
                                    <li key={`${section.key}-${item.caseId || item.citation || index}`}>
                                      <strong>{item.title || item.caseId || "Related case"}</strong>
                                      {item.citation ? ` | ${item.citation}` : ""}
                                      {" "}
                                      <span style={{ padding: "2px 8px", borderRadius: "999px", background: tone.background, color: tone.color }}>
                                        {tone.label}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                              {items.length > 10 ? (
                                <button type="button" className="ghost-button" onClick={() => toggleCitationSection(section.key)}>
                                  {citationExpanded[section.key] ? "Show less" : `View more (${items.length - 10})`}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <p className="muted-copy">No entries yet.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Open a selected or matched judgment to inspect its citation network.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "memo" ? (
              <>
                <div className="section-title">Research Memo</div>
                <p className="muted-copy">Generate a concise working memo from intake, chronology, and issue summary.</p>
                {status ? <div className="law-disclaimer">{status}</div> : null}
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" disabled={busy || !canRunLawyerAi} onClick={runResearchMemo}>
                    {busy ? "Processing..." : "Generate Memo"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runArgumentBuilder} disabled={busy}>
                    Generate Arguments
                  </button>
                  <button type="button" className="ghost-button" onClick={runCaseStrength} disabled={busy}>
                    Case Strength
                  </button>
                  <button type="button" className="ghost-button" onClick={loadMemoIntoResearch} disabled={!memoOutput}>
                    Send To Research
                  </button>
                  <button type="button" className="ghost-button" onClick={findAuthoritiesFromCurrentMatter} disabled={!memoOutput}>
                    Match Latest Judgments
                  </button>
                  <button type="button" className="ghost-button" onClick={exportClientResearchPack} disabled={!memoOutput && !noticeOutput && !relatedJudgments.length}>
                    Export Client Pack
                  </button>
                </div>

                {memoOutput ? (
                  <div className="law-output-block">
                    <h4>Issue List</h4>
                    <ul>{renderList(memoOutput.issueList)}</ul>
                    <h4>Key Authorities</h4>
                    <ul>{renderList(memoOutput.keyAuthorities)}</ul>
                    <h4>Procedural Notes</h4>
                    <ul>{renderList(memoOutput.proceduralNotes)}</ul>
                    <h4>Risk Flags</h4>
                    <ul>{renderList(memoOutput.riskFlags)}</ul>
                    <h4>Next Actions</h4>
                    <ul>{renderList(memoOutput.nextActions)}</ul>
                    {memoOutput.latestJudgmentNotes?.length ? (
                      <>
                        <h4>Latest Judgment Notes</h4>
                        <ul>{renderList(memoOutput.latestJudgmentNotes)}</ul>
                      </>
                    ) : null}
                    {memoOutput.bestCases?.length ? (
                      <>
                        <h4>Best 3 Cases For This Matter</h4>
                        <div className="law-template-grid">
                          {memoOutput.bestCases.map((item, index) => (
                            <div key={`best-case-${item.citation || item.title}-${index}`} className="soft-panel">
                              <h4>{item.title || "Authority"}</h4>
                              <p><strong>{item.citation || "No citation yet"}</strong></p>
                              {(item.court || item.judgmentDate) ? <p className="muted-copy">{item.court || "Court"}{item.judgmentDate ? ` | ${item.judgmentDate}` : ""}</p> : null}
                              <p><strong>Status:</strong> {item.status || "verify"}</p>
                              <p>{item.whyItMatters || "Reason not available yet."}</p>
                              {item.sourceUrl ? (
                                <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                                  Open Source
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {memoOutput.relatedJudgments?.length ? (
                      <>
                        <h4>Matched Latest Judgments</h4>
                        <div className="law-template-grid">
                          {memoOutput.relatedJudgments.map((item) => (
                            <div key={`memo-related-${item.id}`} className="soft-panel">
                              <h4>{item.title || "Judgment brief"}</h4>
                              <p className="muted-copy">{item.court || "Court not tagged"} | {item.judgmentDate || "No date"}</p>
                              <p><strong>{item.citation || "No citation yet"}</strong></p>
                              {item.treatmentStatus ? <p><strong>Status:</strong> {item.treatmentStatus}</p> : null}
                              {item.authorityStrength ? <p><strong>Authority Strength:</strong> {item.authorityStrength}</p> : null}
                              {item.ratioNote ? <p><strong>Ratio Note:</strong> {item.ratioNote}</p> : null}
                              <div className="law-inline-actions">
                                <button type="button" className="ghost-button" onClick={() => openJudgmentDetails(item)}>
                                  View Details
                                </button>
                                <button type="button" className="ghost-button" onClick={() => loadJudgmentIntoResearch(item)}>
                                  Use In Research
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {memoOutput.legalVersionNotice ? <div className="law-disclaimer">{memoOutput.legalVersionNotice}</div> : null}
                    {memoOutput.retrievedAuthorities?.length ? (
                      <>
                        <h4>Retrieved Authorities</h4>
                        {renderAuthorities(memoOutput.retrievedAuthorities, revalidateAuthorityNow)}
                      </>
                    ) : null}
                    {renderTraceability(memoOutput.traceability)}
                    {renderReviewWorkflow({
                      entityType: "memo",
                      entityKey: memoReviewKey,
                      entityLabel: "Research Memo",
                      output: memoOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Use matter intake first, then generate a working research memo here.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "arguments" ? (
              <>
                <div className="section-title">Argument Builder</div>
                <p className="muted-copy">Generate issue-wise submissions for both sides using the current matter facts, issue list, and selected authorities.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runArgumentBuilder} disabled={busy}>
                    {busy ? "Processing..." : "Generate Arguments"}
                  </button>
                  <select value={argumentMode} onChange={(event) => setArgumentMode(event.target.value)}>
                    <option value="detailed">Detailed Mode</option>
                    <option value="court-ready">Court-Ready Mode</option>
                  </select>
                  <button type="button" className={`ghost-button ${argumentSide === "petitioner" ? "law-template-active" : ""}`} onClick={() => setArgumentSide("petitioner")}>
                    Petitioner
                  </button>
                  <button type="button" className={`ghost-button ${argumentSide === "respondent" ? "law-template-active" : ""}`} onClick={() => setArgumentSide("respondent")}>
                    Respondent
                  </button>
                  <button type="button" className="ghost-button" onClick={exportArgumentOutput} disabled={!argumentOutput}>
                    Export Arguments
                  </button>
                </div>
                <div className="law-disclaimer">
                  Selected inputs: Issues {argumentIssues.length || 0} | Cases {selectedArgumentCases.length || 0}. Good-law authorities are preferred automatically; bad-law authorities are de-prioritized.
                </div>
                {authorityGuardrails.status !== "CLEAR" ? (
                  <div className="law-disclaimer" style={{ background: authorityGuardrails.status === "BLOCK" ? "#fde3e3" : "#fff5d6", color: authorityGuardrails.status === "BLOCK" ? "#9f1d1d" : "#8a6500" }}>
                    {authorityGuardrails.status === "BLOCK"
                      ? authorityGuardrails.blockingWarnings[0]
                      : authorityGuardrails.cautionWarnings[0]}
                  </div>
                ) : null}
                {argumentOutput?.warnings?.length ? (
                  <div className="law-list-block">
                    <h4>Authority Warnings</h4>
                    <ul>{renderList(argumentOutput.warnings)}</ul>
                  </div>
                ) : null}
                {argumentOutput?.authorityReview?.length ? (
                  <div className="law-list-block">
                    <h4>Authority Review</h4>
                    <ul>
                      {argumentOutput.authorityReview.map((item) => (
                        <li key={`${item.caseId || item.citation}`}>
                          {item.title || item.citation || "Authority"} | {item.citation || "No citation"} | {item.status || "CAUTION"} | {item.riskLevel || "MEDIUM"} | Confidence {item.confidenceScore || 0}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {visibleArgumentSections.length ? (
                  <div className="law-template-grid">
                    {visibleArgumentSections.map((section, sectionIndex) => (
                      <div key={`${section.side}-${section.issue}-${sectionIndex}`} className="soft-panel">
                        <h4>{section.issue || "Issue"}</h4>
                        {(section.arguments || []).map((entry, entryIndex) => (
                          <div key={`${entry.title}-${entryIndex}`} style={{ marginBottom: "16px" }}>
                            <p><strong>{entry.title || "Argument"}</strong></p>
                            <p><strong>Legal Basis:</strong> {entry.legalBasis || "Not available"}</p>
                            <p><strong>Reasoning:</strong> {entry.reasoning || "Not available"}</p>
                            <p><strong>Risk Note:</strong> {entry.riskNote || "Not available"}</p>
                            {entry.caseReferences?.length ? (
                              <>
                                <h4>Case References</h4>
                                <ul>
                                  {entry.caseReferences.map((caseItem, caseIndex) => (
                                    <li key={`${caseItem.caseId || caseItem.citation}-${caseIndex}`}>
                                      {caseItem.title || caseItem.citation || caseItem.caseId} | {caseItem.citation || "No citation"} | {caseItem.validityStatus || "CAUTION"} | {caseItem.riskLevel || "MEDIUM"}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">Use intake, memo, and judgments first, then generate arguments here.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "strength" ? (
              <>
                <div className="section-title">Case Strength Analyzer</div>
                <p className="muted-copy">Evaluate authority fit, evidence support, factual consistency, and litigation risk from the current matter workspace.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runCaseStrength} disabled={busy}>
                    {busy ? "Processing..." : "Analyze Strength"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runCasePrediction} disabled={busy}>
                    Case Prediction
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingReadiness} disabled={busy}>
                    Filing Readiness
                  </button>
                  <button type="button" className="ghost-button" onClick={runMatterConsistency} disabled={busy}>
                    Matter Consistency
                  </button>
                  <button type="button" className="ghost-button" onClick={runEvidenceCoverage} disabled={busy}>
                    Evidence Coverage
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingPackReadiness} disabled={busy}>
                    Final Filing Pack
                  </button>
                </div>
                {authorityGuardrails.status !== "CLEAR" ? (
                  <div className="law-disclaimer" style={{ background: authorityGuardrails.status === "BLOCK" ? "#fde3e3" : "#fff5d6", color: authorityGuardrails.status === "BLOCK" ? "#9f1d1d" : "#8a6500" }}>
                    {authorityGuardrails.status === "BLOCK"
                      ? authorityGuardrails.blockingWarnings[0]
                      : authorityGuardrails.cautionWarnings[0]}
                  </div>
                ) : null}
                {strengthOutput ? (
                  <div className="law-output-block">
                    <div style={{ marginBottom: "16px" }}>
                      <div className="law-inline-actions" style={{ alignItems: "center" }}>
                        <strong>Overall Score: {strengthOutput.overallScore || 0}/100</strong>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            background: getStrengthTone(strengthOutput.strengthLevel).background,
                            color: getStrengthTone(strengthOutput.strengthLevel).color
                          }}
                        >
                          {strengthOutput.strengthLevel || "WEAK"}
                        </span>
                        <span className="muted-copy">Win Probability: {strengthOutput.winProbability || "LOW"}</span>
                      </div>
                      <div style={{ width: "100%", height: "12px", background: "#e7ebf0", borderRadius: "999px", overflow: "hidden", marginTop: "12px" }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, Number(strengthOutput.overallScore || 0)))}%`,
                            height: "100%",
                            background: getStrengthTone(strengthOutput.strengthLevel).color
                          }}
                        />
                      </div>
                    </div>
                    {strengthOutput.scoreBreakdown ? (
                      <div className="law-extract-meta">
                        <div><strong>Authority Fit:</strong> {strengthOutput.scoreBreakdown.authorityFit || 0}</div>
                        <div><strong>Evidence Strength:</strong> {strengthOutput.scoreBreakdown.evidenceStrength || 0}</div>
                        <div><strong>Consistency:</strong> {strengthOutput.scoreBreakdown.consistency || 0}</div>
                      </div>
                    ) : null}
                    <h4>Strengths</h4>
                    <ul>{renderList(strengthOutput.strengths)}</ul>
                    <h4>Weaknesses</h4>
                    <ul>{renderList(strengthOutput.weaknesses)}</ul>
                    <h4>Missing Evidence</h4>
                    <ul>{renderList(strengthOutput.missingEvidence)}</ul>
                    <h4>Risks</h4>
                    <ul>{renderList(strengthOutput.riskAnalysis)}</ul>
                    <h4>Suggestions</h4>
                    <ul>{renderList(strengthOutput.suggestions)}</ul>
                    {strengthOutput.authorityReview?.length ? (
                      <>
                        <h4>Authority Review</h4>
                        <ul>
                          {strengthOutput.authorityReview.map((item) => (
                            <li key={`${item.caseId || item.citation}`}>
                              {item.title || item.citation || "Authority"} | {item.citation || "No citation"} | {item.status || "CAUTION"} | {item.riskLevel || "MEDIUM"} | Confidence {item.confidenceScore || 0}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted-copy">Run memo, judgments, or intake first, then analyze overall case strength here.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "prediction" ? (
              <>
                <div className="section-title">Case Prediction</div>
                <p className="muted-copy">Outcome probability built from evidence strength, authority quality, factual consistency, and risk indicators.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runCasePrediction} disabled={busy}>
                    {busy ? "Processing..." : "Predict Outcome"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runCaseStrength} disabled={busy}>
                    Refresh Strength
                  </button>
                  <button type="button" className="ghost-button" onClick={runArgumentBuilder} disabled={busy}>
                    Refresh Arguments
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingReadiness} disabled={busy}>
                    Filing Readiness
                  </button>
                  <button type="button" className="ghost-button" onClick={runEvidenceCoverage} disabled={busy}>
                    Evidence Coverage
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingPackReadiness} disabled={busy}>
                    Final Filing Pack
                  </button>
                </div>
                {authorityGuardrails.status !== "CLEAR" ? (
                  <div className="law-disclaimer" style={{ background: authorityGuardrails.status === "BLOCK" ? "#fde3e3" : "#fff5d6", color: authorityGuardrails.status === "BLOCK" ? "#9f1d1d" : "#8a6500" }}>
                    {authorityGuardrails.status === "BLOCK"
                      ? authorityGuardrails.blockingWarnings[0]
                      : authorityGuardrails.cautionWarnings[0]}
                  </div>
                ) : null}
                {predictionOutput ? (
                  <div className="law-output-block">
                    <div style={{ marginBottom: "16px" }}>
                      <div className="law-inline-actions" style={{ alignItems: "center" }}>
                        <strong>Win Probability: {predictionOutput.winProbability || 0}%</strong>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            background: predictionOutput.riskLevel === "LOW" ? "#dff6e6" : predictionOutput.riskLevel === "MEDIUM" ? "#fff5d6" : "#fde3e3",
                            color: predictionOutput.riskLevel === "LOW" ? "#1f7a3d" : predictionOutput.riskLevel === "MEDIUM" ? "#8a6500" : "#9f1d1d"
                          }}
                        >
                          {predictionOutput.riskLevel || "MEDIUM"}
                        </span>
                        <span className="muted-copy">Confidence: {predictionOutput.confidenceScore || 0}/100</span>
                      </div>
                      <div style={{ width: "100%", height: "12px", background: "#e7ebf0", borderRadius: "999px", overflow: "hidden", marginTop: "12px" }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, Number(predictionOutput.winProbability || 0)))}%`,
                            height: "100%",
                            background: predictionOutput.riskLevel === "LOW" ? "#1f7a3d" : predictionOutput.riskLevel === "MEDIUM" ? "#d6a300" : "#c62828"
                          }}
                        />
                      </div>
                    </div>
                    {predictionOutput.scoreBreakdown ? (
                      <div className="law-extract-meta">
                        <div><strong>Evidence Strength:</strong> {predictionOutput.scoreBreakdown.evidenceStrength || 0}</div>
                        <div><strong>Authority Quality:</strong> {predictionOutput.scoreBreakdown.authorityQuality || 0}</div>
                        <div><strong>Consistency:</strong> {predictionOutput.scoreBreakdown.consistency || 0}</div>
                        <div><strong>Risk Adjusted:</strong> {predictionOutput.scoreBreakdown.riskPenaltyAdjusted || 0}</div>
                      </div>
                    ) : null}
                    <h4>Key Factors</h4>
                    <ul>{renderList(predictionOutput.keyFactors)}</ul>
                    <h4>Strengths</h4>
                    <ul>{renderList(predictionOutput.strengths)}</ul>
                    <h4>Weaknesses</h4>
                    <ul>{renderList(predictionOutput.weaknesses)}</ul>
                    <h4>Improvement Suggestions</h4>
                    <ul>{renderList(predictionOutput.improvementSuggestions)}</ul>
                    {renderTraceability(predictionOutput.traceability)}
                    {renderReviewWorkflow({
                      entityType: "prediction",
                      entityKey: predictionReviewKey,
                      entityLabel: "Case Prediction",
                      output: predictionOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Prepare the matter inputs and run the prediction engine to get an explainable outcome estimate.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "readiness" ? (
              <>
                <div className="section-title">Filing Readiness</div>
                <p className="muted-copy">Checklist-driven review of whether the matter is ready for filing or service.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runFilingReadiness} disabled={busy}>
                    {busy ? "Processing..." : "Check Readiness"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runCaseStrength} disabled={busy}>
                    Refresh Strength
                  </button>
                  <button type="button" className="ghost-button" onClick={runCasePrediction} disabled={busy}>
                    Refresh Prediction
                  </button>
                  <button type="button" className="ghost-button" onClick={runMatterConsistency} disabled={busy}>
                    Matter Consistency
                  </button>
                  <button type="button" className="ghost-button" onClick={runEvidenceCoverage} disabled={busy}>
                    Evidence Coverage
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingPackReadiness} disabled={busy}>
                    Final Filing Pack
                  </button>
                </div>
                {readinessOutput ? (
                  <div className="law-output-block">
                    <div style={{ marginBottom: "16px" }}>
                      <div className="law-inline-actions" style={{ alignItems: "center" }}>
                        <strong>Readiness Score: {readinessOutput.readinessScore || 0}/100</strong>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            background: readinessOutput.readinessLevel === "READY" ? "#dff6e6" : readinessOutput.readinessLevel === "PARTIAL" ? "#fff5d6" : "#fde3e3",
                            color: readinessOutput.readinessLevel === "READY" ? "#1f7a3d" : readinessOutput.readinessLevel === "PARTIAL" ? "#8a6500" : "#9f1d1d"
                          }}
                        >
                          {readinessOutput.readinessLevel || "NOT READY"}
                        </span>
                      </div>
                      <div style={{ width: "100%", height: "12px", background: "#e7ebf0", borderRadius: "999px", overflow: "hidden", marginTop: "12px" }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, Number(readinessOutput.readinessScore || 0)))}%`,
                            height: "100%",
                            background: readinessOutput.readinessLevel === "READY" ? "#1f7a3d" : readinessOutput.readinessLevel === "PARTIAL" ? "#d6a300" : "#c62828"
                          }}
                        />
                      </div>
                    </div>
                    <p>{readinessOutput.summary}</p>
                    <h4>Checklist</h4>
                    <ul>
                      {(readinessOutput.checklist || []).map((item) => (
                        <li key={item.key}>
                          <strong>{item.label}</strong> | {item.status}
                          {item.note ? ` | ${item.note}` : ""}
                        </li>
                      ))}
                    </ul>
                    <h4>Missing Items</h4>
                    <ul>{renderList(readinessOutput.missingItems)}</ul>
                    <h4>Critical Risks</h4>
                    <ul>{renderList(readinessOutput.criticalRisks)}</ul>
                    <h4>Next Steps</h4>
                    <ul>{renderList(readinessOutput.nextSteps)}</ul>
                    {renderReviewWorkflow({
                      entityType: "readiness",
                      entityKey: readinessReviewKey,
                      entityLabel: "Filing Readiness",
                      output: readinessOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Run the readiness checker after preparing facts, draft text, and supporting material.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "consistency" ? (
              <>
                <div className="section-title">Matter Consistency</div>
                <p className="muted-copy">Cross-check facts, chronology, hearing notes, documents, and draft text for internal conflicts before advice or filing.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runMatterConsistency} disabled={busy}>
                    {busy ? "Processing..." : "Check Consistency"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingReadiness} disabled={busy}>
                    Filing Readiness
                  </button>
                  <button type="button" className="ghost-button" onClick={runCaseStrength} disabled={busy}>
                    Refresh Strength
                  </button>
                </div>
                {consistencyOutput ? (
                  <div className="law-output-block">
                    <div style={{ marginBottom: "16px" }}>
                      <div className="law-inline-actions" style={{ alignItems: "center" }}>
                        <strong>Consistency Score: {consistencyOutput.consistencyScore || 0}/100</strong>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            background: consistencyOutput.consistencyLevel === "ALIGNED" ? "#dff6e6" : consistencyOutput.consistencyLevel === "CAUTION" ? "#fff5d6" : "#fde3e3",
                            color: consistencyOutput.consistencyLevel === "ALIGNED" ? "#1f7a3d" : consistencyOutput.consistencyLevel === "CAUTION" ? "#8a6500" : "#9f1d1d"
                          }}
                        >
                          {consistencyOutput.consistencyLevel || "CAUTION"}
                        </span>
                        <span className="muted-copy">Signals: {consistencyOutput.signalCount || 0}</span>
                      </div>
                      <div style={{ width: "100%", height: "12px", background: "#e7ebf0", borderRadius: "999px", overflow: "hidden", marginTop: "12px" }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, Number(consistencyOutput.consistencyScore || 0)))}%`,
                            height: "100%",
                            background: consistencyOutput.consistencyLevel === "ALIGNED" ? "#1f7a3d" : consistencyOutput.consistencyLevel === "CAUTION" ? "#d6a300" : "#c62828"
                          }}
                        />
                      </div>
                    </div>
                    <p>{consistencyOutput.summary}</p>
                    <h4>Contradictions</h4>
                    <ul>{renderList(consistencyOutput.contradictions)}</ul>
                    <h4>Missing Coverage</h4>
                    <ul>{renderList(consistencyOutput.missingCoverage)}</ul>
                    <h4>Narrative Weaknesses</h4>
                    <ul>{renderList(consistencyOutput.narrativeWeaknesses)}</ul>
                    <h4>Suggestions</h4>
                    <ul>{renderList(consistencyOutput.suggestions)}</ul>
                    {renderReviewWorkflow({
                      entityType: "consistency",
                      entityKey: consistencyReviewKey,
                      entityLabel: "Matter Consistency",
                      output: consistencyOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Run the matter consistency check after you have facts, chronology, and at least one draft or document view.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "coverage" ? (
              <>
                <div className="section-title">Evidence Coverage</div>
                <p className="muted-copy">Issue-wise matrix showing whether facts, documents, authorities, arguments, risk review, and draft support are actually present.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runEvidenceCoverage} disabled={busy}>
                    {busy ? "Processing..." : "Build Coverage Matrix"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runMatterConsistency} disabled={busy}>
                    Matter Consistency
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingReadiness} disabled={busy}>
                    Filing Readiness
                  </button>
                </div>
                {coverageOutput ? (
                  <div className="law-output-block">
                    <div style={{ marginBottom: "16px" }}>
                      <div className="law-inline-actions" style={{ alignItems: "center" }}>
                        <strong>Coverage Score: {coverageOutput.overallScore || 0}/100</strong>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            background: coverageOutput.coverageLevel === "WELL COVERED" ? "#dff6e6" : coverageOutput.coverageLevel === "PARTIAL COVERAGE" ? "#fff5d6" : "#fde3e3",
                            color: coverageOutput.coverageLevel === "WELL COVERED" ? "#1f7a3d" : coverageOutput.coverageLevel === "PARTIAL COVERAGE" ? "#8a6500" : "#9f1d1d"
                          }}
                        >
                          {coverageOutput.coverageLevel || "PARTIAL COVERAGE"}
                        </span>
                        <span className="muted-copy">Issues: {coverageOutput.stats?.issueCount || 0}</span>
                      </div>
                    </div>
                    <p>{coverageOutput.summary}</p>
                    <div className="law-template-grid">
                      {(coverageOutput.matrix || []).map((item, index) => (
                        <div key={`${item.issue || index}`} className="soft-panel">
                          <h4>{item.issue || "Issue"}</h4>
                          <p><strong>Status:</strong> {item.coverageStatus || "PARTIAL"}</p>
                          <p><strong>Facts:</strong> {item.factSupport}</p>
                          <p><strong>Documents:</strong> {item.documentSupport}</p>
                          <p><strong>Authorities:</strong> {item.authoritySupport}</p>
                          <p><strong>Arguments:</strong> {item.argumentSupport}</p>
                          <p><strong>Draft:</strong> {item.draftSupport}</p>
                          <p><strong>Risk Reviewed:</strong> {item.riskReviewed}</p>
                          {item.matchedDocuments?.length ? <p className="muted-copy">Docs: {item.matchedDocuments.join(", ")}</p> : null}
                          {item.matchedAuthorities?.length ? <p className="muted-copy">Authorities: {item.matchedAuthorities.join(", ")}</p> : null}
                          {item.notes?.length ? <ul>{renderList(item.notes)}</ul> : null}
                        </div>
                      ))}
                    </div>
                    <h4>Coverage Gaps</h4>
                    <ul>{renderList(coverageOutput.gaps)}</ul>
                    <h4>Suggestions</h4>
                    <ul>{renderList(coverageOutput.suggestions)}</ul>
                    {renderReviewWorkflow({
                      entityType: "coverage",
                      entityKey: coverageReviewKey,
                      entityLabel: "Evidence Coverage",
                      output: coverageOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Run the coverage matrix after you have issue framing and at least some documents, authorities, or draft text in the workspace.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "draft-validation" ? (
              <>
                <div className="section-title">Draft Validation</div>
                <p className="muted-copy">Validate the current draft against court-facing structural expectations before filing or sharing.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runDraftValidation} disabled={busy}>
                    {busy ? "Processing..." : "Validate Draft"}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setLawyerTab("draft")}>
                    Back To Draft
                  </button>
                </div>
                {draftValidationOutput ? (
                  <div className="law-output-block">
                    <p><strong>Score:</strong> {draftValidationOutput.validationScore || 0}/100</p>
                    <p><strong>Status:</strong> {draftValidationOutput.validationLevel || "REVIEW REQUIRED"}</p>
                    <p>{draftValidationOutput.summary}</p>
                    <h4>Checks</h4>
                    <ul>
                      {(draftValidationOutput.checks || []).map((item) => (
                        <li key={item.key}>
                          <strong>{item.label}</strong> | {item.passed ? "PASS" : "MISSING"}
                          {item.note ? ` | ${item.note}` : ""}
                        </li>
                      ))}
                    </ul>
                    <h4>Missing Sections</h4>
                    <ul>{renderList(draftValidationOutput.missingSections)}</ul>
                    <h4>Critical Issues</h4>
                    <ul>{renderList(draftValidationOutput.criticalIssues)}</ul>
                    <h4>Suggestions</h4>
                    <ul>{renderList(draftValidationOutput.suggestions)}</ul>
                    {renderReviewWorkflow({
                      entityType: "draft_validation",
                      entityKey: draftValidationReviewKey,
                      entityLabel: "Draft Validation",
                      output: draftValidationOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Run validation from the draft workspace to inspect missing court-facing sections.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "filing-pack" ? (
              <>
                <div className="section-title">Final Filing Pack</div>
                <p className="muted-copy">One final pre-filing gate combining readiness, consistency, coverage, draft validation, and authority freshness.</p>
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" onClick={runFilingPackReadiness} disabled={busy}>
                    {busy ? "Processing..." : "Run Final Filing Gate"}
                  </button>
                  <button type="button" className="ghost-button" onClick={runDraftValidation} disabled={busy}>
                    Draft Validation
                  </button>
                  <button type="button" className="ghost-button" onClick={runFilingReadiness} disabled={busy}>
                    Filing Readiness
                  </button>
                </div>
                {filingPackOutput ? (
                  <div className="law-output-block">
                    <div className="law-inline-actions" style={{ alignItems: "center" }}>
                      <strong>Filing Score: {filingPackOutput.filingScore || 0}/100</strong>
                      <span
                        style={{
                          padding: "6px 12px",
                          borderRadius: "999px",
                          background: filingPackOutput.filingDecision === "READY TO FILE" ? "#dff6e6" : filingPackOutput.filingDecision === "REVIEW BEFORE FILING" ? "#fff5d6" : "#fde3e3",
                          color: filingPackOutput.filingDecision === "READY TO FILE" ? "#1f7a3d" : filingPackOutput.filingDecision === "REVIEW BEFORE FILING" ? "#8a6500" : "#9f1d1d"
                        }}
                      >
                        {filingPackOutput.filingDecision || "HOLD"}
                      </span>
                    </div>
                    <p>{filingPackOutput.summary}</p>
                    <div className="law-extract-meta">
                      <div><strong>Readiness:</strong> {filingPackOutput.componentScores?.readiness || 0}</div>
                      <div><strong>Consistency:</strong> {filingPackOutput.componentScores?.consistency || 0}</div>
                      <div><strong>Coverage:</strong> {filingPackOutput.componentScores?.coverage || 0}</div>
                      <div><strong>Draft Validation:</strong> {filingPackOutput.componentScores?.draftValidation || 0}</div>
                      <div><strong>Authority Freshness:</strong> {filingPackOutput.componentScores?.authorityFreshness || 0}</div>
                    </div>
                    <h4>Blockers</h4>
                    <ul>{renderList(filingPackOutput.blockers)}</ul>
                    <h4>Warnings</h4>
                    <ul>{renderList(filingPackOutput.warnings)}</ul>
                    <h4>Recommendations</h4>
                    <ul>{renderList(filingPackOutput.recommendations)}</ul>
                    {renderReviewWorkflow({
                      entityType: "filing_pack",
                      entityKey: filingPackReviewKey,
                      entityLabel: "Final Filing Pack",
                      output: filingPackOutput
                    })}
                  </div>
                ) : (
                  <p className="muted-copy">Run the final filing gate after draft, authority, and matter-review steps are populated.</p>
                )}
              </>
            ) : null}

            {lawyerTab === "notice" ? (
              <>
                <div className="section-title">Notice Pack</div>
                <p className="muted-copy">Generate a ready-to-review legal notice pack from intake, chronology, and issue summary.</p>
                {status ? <div className="law-disclaimer">{status}</div> : null}
                <div className="law-inline-actions">
                  <button type="button" className="primary-button" disabled={busy} onClick={runNoticePack}>
                    {busy ? "Processing..." : "Generate Notice Pack"}
                  </button>
                  <button type="button" className="ghost-button" disabled={!noticeOutput} onClick={loadNoticeIntoDraft}>
                    Send To Draft
                  </button>
                </div>
                {noticeOutput ? (
                  <div className="law-output-block">
                    <h4>Notice Title</h4>
                    <p>{noticeOutput.noticeTitle}</p>
                    <h4>Subject Line</h4>
                    <p>{noticeOutput.subjectLine}</p>
                    <h4>Addressee Block</h4>
                    <pre className="law-pre">{noticeOutput.addresseeBlock}</pre>
                    <h4>Notice Draft</h4>
                    <pre className="law-pre">{noticeOutput.noticeDraft}</pre>
                    <h4>Annexures</h4>
                    <ul>{renderList(noticeOutput.annexures)}</ul>
                    <h4>Filing / Service Readiness</h4>
                    <ul>{renderList(noticeOutput.filingReadiness)}</ul>
                    {noticeOutput.legalVersionNotice ? <div className="law-disclaimer">{noticeOutput.legalVersionNotice}</div> : null}
                    {noticeOutput.retrievedAuthorities?.length ? (
                      <>
                        <h4>Retrieved Authorities</h4>
                        {renderAuthorities(noticeOutput.retrievedAuthorities, revalidateAuthorityNow)}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted-copy">Use intake and chronology first, then generate the notice pack here.</p>
                )}
              </>
            ) : null}

            {(lawyerTab === "research" || lawyerTab === "draft" || lawyerTab === "analyzer" || lawyerTab === "document") ? (
              <>
                <div className="section-title">{LAWYER_TABS.find((item) => item.id === lawyerTab)?.label}</div>
                {status ? <div className="law-disclaimer">{status}</div> : null}
                {!canRunLawyerAi ? <div className="law-disclaimer">AI limit reached. Upgrade your plan to continue.</div> : null}
                {lawyerTab === "draft" ? (
                  <>
                    <label>
                      Draft Type
                      <select value={draftType} onChange={(event) => setDraftType(event.target.value)}>
                        <option value="petition">Petition</option>
                        <option value="notice">Legal Notice</option>
                        <option value="agreement">Agreement</option>
                        <option value="affidavit">Affidavit</option>
                      </select>
                    </label>
                    <label>
                      Output Mode
                      <select value={draftMode} onChange={(event) => setDraftMode(event.target.value)}>
                        <option value="court-ready">Court-ready</option>
                        <option value="editable">Editable</option>
                      </select>
                    </label>
                    <label>
                      Court Type
                      <select value={draftCourtType} onChange={(event) => setDraftCourtType(event.target.value)}>
                        <option value="general">General</option>
                        <option value="trial_court">Trial Court</option>
                        <option value="high_court">High Court</option>
                        <option value="supreme_court">Supreme Court</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <label>
                  {lawyerTab === "document" ? "Document Text" : "Case Details / Facts"}
                  <textarea rows={8} value={lawyerTab === "document" ? docText : lawyerInput} onChange={(event) => (lawyerTab === "document" ? setDocText(event.target.value) : setLawyerInput(event.target.value))} />
                </label>
                {lawyerTab === "document" ? (
                  <label>
                    Compare With Case Facts
                    <textarea
                      rows={5}
                      value={documentCompareFacts}
                      onChange={(event) => setDocumentCompareFacts(event.target.value)}
                      placeholder="Optional: paste current case facts to highlight gaps or contradictions."
                    />
                  </label>
                ) : null}
                {lawyerTab === "analyzer" ? (
                  <label>
                    Evidence
                    <textarea rows={5} value={lawyerEvidence} onChange={(event) => setLawyerEvidence(event.target.value)} />
                  </label>
                ) : null}
                <div className="law-inline-actions">
                  <button type="button" className="ghost-button" onClick={() => startVoiceInput(lawyerTab === "document" ? setDocText : setLawyerInput)}>Voice Command</button>
                  {lawyerTab === "document" ? (
                    <label className="ghost-button law-upload-button">
                      Upload for Extract
                      <input type="file" hidden onChange={(event) => extractFromFile(event.target.files?.[0], setDocText, setLawyerExtractionMeta)} accept=".txt,.md,.json,.csv,.pdf,image/*" />
                    </label>
                  ) : null}
                  {lawyerTab === "document" ? (
                    <button type="button" className="ghost-button" disabled={busy || !canRunLawyerAi || !(docText || lawyerInput).trim()} onClick={generateDocumentMemo}>
                      Generate Memo
                    </button>
                  ) : null}
                  {lawyerTab === "draft" ? (
                    <button type="button" className="ghost-button" disabled={busy || !(lawyerOutput?.draft || lawyerInput).trim()} onClick={runDraftValidation}>
                      Validate Draft
                    </button>
                  ) : null}
                  <button type="button" className="primary-button" disabled={busy || !canRunLawyerAi} onClick={runLawyerAction}>
                    {busy ? "Processing..." : "Run AI"}
                  </button>
                </div>

                {lawyerOutput ? (
                  <div className="law-output-block">
                    <div className="law-disclaimer">
                      Verification workflow: confirm statutory text, latest amendments, and whether cited case law still holds good before filing or advising.
                    </div>
                    {lawyerExtractionMeta ? (
                      <div className="law-extract-meta">
                        <div><strong>OCR Quality:</strong> {lawyerExtractionMeta.qualityScore}%</div>
                        <div><strong>Engine:</strong> {lawyerExtractionMeta.extractionEngine}</div>
                      </div>
                    ) : null}
                    <div className="law-inline-actions">
                      <button type="button" className="ghost-button" onClick={exportLawyerOutput}>Export Output</button>
                      {lawyerTab === "draft" && lawyerOutput?.draft ? <button type="button" className="ghost-button" onClick={copyLawyerDraft}>Copy Draft</button> : null}
                      {lawyerTab === "draft" && lawyerOutput?.draft ? <button type="button" className="ghost-button" onClick={exportLawyerOutput}>Download Draft</button> : null}
                      {lawyerTab === "document" && lawyerOutput ? <button type="button" className="ghost-button" onClick={copyDocumentMemo}>Copy Memo</button> : null}
                      {lawyerTab === "document" && lawyerOutput ? <button type="button" className="ghost-button" onClick={downloadDocumentMemoPdf}>Download PDF</button> : null}
                    </div>
                    {lawyerOutput.caseSummary ? <><h4>Case Summary</h4><p>{lawyerOutput.caseSummary}</p></> : null}
                    {lawyerOutput.legalVersionNotice ? <div className="law-disclaimer">{lawyerOutput.legalVersionNotice}</div> : null}
                    {lawyerOutput.applicableSections ? <><h4>Applicable Sections</h4><ul>{renderList(lawyerOutput.applicableSections)}</ul></> : null}
                    {lawyerOutput.caseLaws ? <><h4>Case Laws</h4><ul>{renderList(lawyerOutput.caseLaws)}</ul></> : null}
                    {lawyerOutput.judgmentSummary ? <><h4>Judgment Summary</h4><p>{lawyerOutput.judgmentSummary}</p></> : null}
                    {lawyerOutput.bestCases?.length ? (
                      <>
                        <h4>Best Cases</h4>
                        <div className="law-template-grid">
                          {lawyerOutput.bestCases.map((item, index) => (
                            <div key={`research-best-${item.citation || item.title || index}`} className="soft-panel">
                              <h4>{item.title || "Authority"}</h4>
                              <p><strong>{item.citation || "No citation yet"}</strong></p>
                              {(item.court || item.judgmentDate) ? <p className="muted-copy">{item.court || "Court"}{item.judgmentDate ? ` | ${item.judgmentDate}` : ""}</p> : null}
                              <p><strong>Status:</strong> {item.status || "verify"}</p>
                              <p>{item.whyItMatters || "Reason not available yet."}</p>
                              {item.sourceUrl ? (
                                <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                                  Open Source
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {lawyerOutput.authorityClusters?.length ? (
                      <>
                        <h4>Issue-Wise Authority Clusters</h4>
                        <div className="law-template-grid">
                          {lawyerOutput.authorityClusters.map((cluster, index) => (
                            <div key={`cluster-${cluster.issue || index}`} className="soft-panel">
                              <h4>{cluster.issue || "General issue"}</h4>
                              <ul>
                                {(cluster.authorities || []).map((authority, authorityIndex) => (
                                  <li key={`cluster-${cluster.issue || index}-${authorityIndex}`}>
                                    <strong>{authority.title || "Authority"}</strong> | {authority.citation || "No citation"} | {authority.status || "verify"}
                                    {authority.whyItMatters ? ` | ${authority.whyItMatters}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {lawyerOutput.draft ? (
                      <>
                        <h4>Professional Draft</h4>
                        {lawyerOutput.mode ? <p className="muted-copy">Mode: {lawyerOutput.mode}</p> : null}
                        {lawyerOutput.sections?.length ? <p className="muted-copy">Legal Basis: {lawyerOutput.sections.join(", ")}</p> : null}
                        <pre className="law-pre">{lawyerOutput.draft}</pre>
                      </>
                    ) : null}
                    {lawyerTab === "draft" && draftValidationOutput ? (
                      <>
                        <h4>Draft Validation</h4>
                        <p><strong>Score:</strong> {draftValidationOutput.validationScore || 0}/100 | <strong>Status:</strong> {draftValidationOutput.validationLevel || "REVIEW REQUIRED"}</p>
                        <p className="muted-copy">{draftValidationOutput.summary}</p>
                        <ul>
                          {(draftValidationOutput.checks || []).map((item) => (
                            <li key={item.key}>
                              <strong>{item.label}</strong> | {item.passed ? "PASS" : "MISSING"}
                              {item.note ? ` | ${item.note}` : ""}
                            </li>
                          ))}
                        </ul>
                        <h4>Missing Sections</h4>
                        <ul>{renderList(draftValidationOutput.missingSections)}</ul>
                        <h4>Critical Issues</h4>
                        <ul>{renderList(draftValidationOutput.criticalIssues)}</ul>
                        <h4>Suggestions</h4>
                        <ul>{renderList(draftValidationOutput.suggestions)}</ul>
                        {renderReviewWorkflow({
                          entityType: "draft_validation",
                          entityKey: draftValidationReviewKey,
                          entityLabel: "Draft Validation",
                          output: draftValidationOutput
                        })}
                      </>
                    ) : null}
                    {lawyerOutput.strengths ? <><h4>Strengths</h4><ul>{renderList(lawyerOutput.strengths)}</ul></> : null}
                    {lawyerOutput.weaknesses ? <><h4>Weaknesses</h4><ul>{renderList(lawyerOutput.weaknesses)}</ul></> : null}
                    {lawyerOutput.strategy ? <><h4>Suggested Strategy</h4><ul>{renderList(lawyerOutput.strategy)}</ul></> : null}
                    {lawyerOutput.riskLevel ? <><h4>Risk Level</h4><p>{lawyerOutput.riskLevel}</p></> : null}
                    {lawyerOutput.summary ? <><h4>Document Summary</h4><p>{lawyerOutput.summary}</p></> : null}
                    {lawyerTab === "document" && documentMemoMode && lawyerOutput.memoText ? (
                      <>
                        <h4>{lawyerOutput.memoTitle || "Document Analysis Memo"}</h4>
                        <pre className="law-pre">{lawyerOutput.memoText}</pre>
                      </>
                    ) : null}
                    {lawyerOutput.documentType ? <><h4>Document Type</h4><p>{lawyerOutput.documentType}</p></> : null}
                    {lawyerOutput.keyFacts?.length ? <><h4>Key Facts</h4><ul>{renderList(lawyerOutput.keyFacts)}</ul></> : null}
                    {lawyerOutput.legalEntities?.length ? <><h4>Legal Entities</h4><ul>{renderList(lawyerOutput.legalEntities)}</ul></> : null}
                    {lawyerOutput.obligations?.length ? <><h4>Obligations</h4><ul>{renderList(lawyerOutput.obligations)}</ul></> : null}
                    {lawyerOutput.legalIssues?.length ? <><h4>Mapped Legal Issues</h4><ul>{renderList(lawyerOutput.legalIssues)}</ul></> : null}
                    {lawyerOutput.importantClauses?.length ? <><h4>Important Clauses</h4><ul>{renderList(lawyerOutput.importantClauses)}</ul></> : null}
                    {lawyerOutput.importantClauseRefs?.length ? (
                      <>
                        <h4>Extracted Clause References</h4>
                        <ul>
                          {lawyerOutput.importantClauseRefs.map((item, index) => (
                            <li key={`${item.clauseTitle || "clause"}-${index}`}>
                              <strong>{item.clauseTitle || "Clause"}</strong>
                              {item.location ? ` | ${item.location}` : ""}
                              {item.clauseText ? (
                                <details style={{ marginTop: "6px" }}>
                                  <summary>Expand excerpt</summary>
                                  <p>{item.clauseText}</p>
                                </details>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {lawyerOutput.missingElements ? <><h4>Missing Elements</h4><ul>{renderList(lawyerOutput.missingElements)}</ul></> : null}
                    {lawyerOutput.legalRisks ? <><h4>Legal Risks</h4><ul>{renderList(lawyerOutput.legalRisks)}</ul></> : null}
                    {lawyerOutput.missingPoints?.length ? <><h4>Missing Points</h4><ul>{renderList(lawyerOutput.missingPoints)}</ul></> : null}
                    {lawyerOutput.risks?.length ? <><h4>Risks</h4><ul>{renderList(lawyerOutput.risks)}</ul></> : null}
                    {lawyerOutput.suggestedArguments?.length ? <><h4>Suggested Arguments</h4><ul>{renderList(lawyerOutput.suggestedArguments)}</ul></> : null}
                    {lawyerOutput.contradictionsWithCase?.length ? <><h4>Compare With Case Facts</h4><ul>{renderList(lawyerOutput.contradictionsWithCase)}</ul></> : null}
                    {lawyerOutput.retrievedAuthorities?.length ? (
                      <>
                        <h4>Retrieved Authorities</h4>
                        {renderAuthorities(lawyerOutput.retrievedAuthorities, revalidateAuthorityNow)}
                      </>
                    ) : null}
                    {lawyerTab === "document" ? renderTraceability(lawyerOutput.traceability) : null}
                    {lawyerTab === "document" ? renderReviewWorkflow({
                      entityType: "document_analysis",
                      entityKey: documentReviewKey,
                      entityLabel: "Document Analysis",
                      output: lawyerOutput
                    }) : null}
                    {lawyerTab === "draft" ? renderReviewWorkflow({
                      entityType: "draft_output",
                      entityKey: draftReviewKey,
                      entityLabel: "Draft Output",
                      output: lawyerOutput
                    }) : null}
                    {lawyerOutput.relatedJudgments?.length ? (
                      <>
                        <h4>Matched Latest Judgments</h4>
                        <div className="law-template-grid">
                          {lawyerOutput.relatedJudgments.map((item) => (
                            <div key={`research-related-${item.id}`} className="soft-panel">
                              <h4>{item.title || "Judgment brief"}</h4>
                              <p><strong>{item.citation || "No citation yet"}</strong></p>
                              {item.treatmentStatus ? <p><strong>Status:</strong> {item.treatmentStatus}</p> : null}
                              {item.authorityStrength ? <p><strong>Authority Strength:</strong> {item.authorityStrength}</p> : null}
                              {item.ratioNote ? <p><strong>Ratio Note:</strong> {item.ratioNote}</p> : null}
                              <div className="law-inline-actions">
                                <button type="button" className="ghost-button" onClick={() => openJudgmentDetails(item)}>
                                  View Details
                                </button>
                                {item.sourceUrl ? (
                                  <button type="button" className="ghost-button" onClick={() => openExternalLink(item.sourceUrl)}>
                                    Open Source
                                  </button>
                                ) : null}
                                <button type="button" className="ghost-button" onClick={() => toggleCompareJudgment(item)}>
                                  Compare
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {lawyerOutput.citations?.length ? (
                      <>
                        <h4>Citations</h4>
                        <ul className="law-citation-list">
                          {lawyerOutput.citations.map((item, index) => (
                            <li key={`${item.citation || item.title}-${index}`}>
                              <span>{item.citation || item.title}</span>
                              <button type="button" className="ghost-button" onClick={() => pinCitationToMemory(item.citation || item.title || "citation")}>
                                Pin
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {lawyerExtractionMeta?.pagePreviews?.length ? (
                      <>
                        <h4>Page-wise Extraction Preview</h4>
                        <div className="law-page-grid">
                          {lawyerExtractionMeta.pagePreviews.map((item) => (
                            <div key={`lawyer-page-${item.page}`} className="law-page-card">
                              <strong>Page {item.page}</strong>
                              <p>{item.excerpt}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {lawyerTab === "templates" ? (
              <>
                <div className="section-title">Legal Template Library</div>
                <p className="muted-copy">Use court-ready template skeletons and move directly into draft generation.</p>
                <div className="law-template-grid">
                  {DRAFT_TEMPLATES.map((item) => (
                    <div key={item.id} className={`soft-panel ${selectedTemplateId === item.id ? "law-template-active" : ""}`}>
                      <h4>{item.title}</h4>
                      <p className="muted-copy">Type: {item.draftType}</p>
                      <button type="button" className="primary-button" onClick={() => applyTemplate(item)}>
                        Use Template
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {lawyerTab === "mapping" ? (
              <>
                <div className="section-title">Legacy IPC/CrPC to Current Law Mapping</div>
                <p className="muted-copy">Use this quick crosswalk when a client, old pleading, or older judgment still refers to repealed IPC, CrPC, or Evidence Act terminology.</p>
                <div className="law-template-grid">
                  {LEGACY_SECTION_MAP.map((item) => (
                    <div key={item.legacy} className="soft-panel">
                      <h4>{item.legacy}</h4>
                      <p><strong>Current:</strong> {item.current}</p>
                      <p><strong>Topic:</strong> {item.topic}</p>
                      <p className="muted-copy">{item.note}</p>
                      <button type="button" className="primary-button" onClick={() => applyMappingEntry(item)}>
                        Send To Research
                      </button>
                    </div>
                  ))}
                </div>
                <div className="law-disclaimer">
                  This is a working crosswalk for common queries, not a complete statutory conversion table. Always verify exact numbering, text, and transition issues before filing.
                </div>
              </>
            ) : null}

            {lawyerTab === "history" ? (
              <>
                <div className="section-title">Draft History</div>
                <p className="muted-copy">Previously generated drafts can be reopened, reused, and exported from here.</p>
                <div className="law-list-block">
                  <ul>
                    {savedDrafts.map((item) => (
                      <li key={item.id}>
                        <strong>{item.title || "Untitled draft"}</strong> | {item.draftType || "general"}
                        {item.relatedCaseId ? ` | Matter linked` : ""}
                        <div className="law-inline-actions">
                          <button type="button" className="ghost-button" onClick={() => openSavedDraft(item)}>
                            Open
                          </button>
                          <button type="button" className="ghost-button" onClick={() => exportSavedDraft(item)}>
                            Export
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {savedDrafts.length === 0 ? <p className="muted-copy">No saved drafts yet. Generate a draft to build history.</p> : null}
                </div>
              </>
            ) : null}

            {lawyerTab === "clients" ? (
              <>
                <div className="section-title">Client Management</div>
                <label>Client Name<input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                <label>Phone<input value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} /></label>
                <label>Notes<textarea rows={3} value={clientNotes} onChange={(event) => setClientNotes(event.target.value)} /></label>
                <button type="button" className="primary-button" onClick={saveClient}>Add / Update Client</button>
                <div className="law-list-block">
                  <h4>Saved Clients</h4>
                  <ul>
                    {clients.map((item) => {
                      const linkedCases = cases.filter((caseItem) => caseItem.clientId === item.id).length;
                      return <li key={item.id}>{item.name || "Unnamed"} | {item.phone || "No phone"} | Matters: {linkedCases}</li>;
                    })}
                  </ul>
                </div>
              </>
            ) : null}

            {lawyerTab === "workflow" ? (
              <>
                <div className="section-title">Case Tracking & Workflow</div>
                <label>
                  Active Matter
                  <select value={selectedMatterId} onChange={(event) => setSelectedMatterId(event.target.value)}>
                    <option value="">General workspace</option>
                    {cases.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title || "Untitled case"}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMatter ? (
                  <div className="law-extract-meta">
                    <div><strong>Client:</strong> {selectedMatterClient?.name || "Not linked"}</div>
                    <div><strong>Stage:</strong> {selectedMatter.stage || "Draft"}</div>
                    <div><strong>Next Hearing:</strong> {selectedMatter.nextHearingDate || "Not scheduled"}</div>
                  </div>
                ) : null}
                <label>
                  Link Client
                  <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
                    <option value="">No client linked</option>
                    {clients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {(item.name || "Unnamed client")}{item.phone ? ` | ${item.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedClient ? (
                  <div className="law-extract-meta">
                    <div><strong>Selected Client:</strong> {selectedClient.name || "Unnamed client"}</div>
                    <div><strong>Phone:</strong> {selectedClient.phone || "Not available"}</div>
                  </div>
                ) : null}
                <label>Case Title<input value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} /></label>
                <label>Case Stage<input value={caseStage} onChange={(event) => setCaseStage(event.target.value)} /></label>
                <label>Next Hearing Date<input type="date" value={caseNextDate} onChange={(event) => setCaseNextDate(event.target.value)} /></label>
                <label>
                  Matter Notes
                  <textarea rows={4} value={caseNotes} onChange={(event) => setCaseNotes(event.target.value)} placeholder="Reliefs sought, core facts, filing status, client instructions..." />
                </label>
                <button type="button" className="primary-button" onClick={saveCase}>Save Case</button>
                <label>Task Title<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label>
                <label>Task Deadline<input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label>
                <button type="button" className="primary-button" onClick={saveTask}>Save Task Reminder</button>
                <label>
                  Chronology Builder
                  <textarea
                    rows={6}
                    value={chronologyText}
                    onChange={(event) => setChronologyText(event.target.value)}
                    placeholder={"Use one line per event. Example:\n2026-03-01: Client issued notice\n2026-03-12: Reply received"}
                  />
                </label>
                <label>
                  Hearing Prep Notes
                  <textarea
                    rows={4}
                    value={hearingNotes}
                    onChange={(event) => setHearingNotes(event.target.value)}
                    placeholder="Issues to press, pending filings, documents to carry, client questions, likely objections..."
                  />
                </label>
                <div className="law-inline-actions">
                  <button type="button" className="ghost-button" onClick={loadMatterIntoResearch}>Send Matter To Research</button>
                  <button type="button" className="ghost-button" onClick={exportMatterPrep}>Export Matter Prep</button>
                </div>
                <div className="law-list-block">
                  <h4>Cases</h4>
                  <ul>{cases.map((item) => <li key={item.id}>{item.title || "Untitled"} | {(clients.find((client) => client.id === item.clientId)?.name) || "No client"} | {item.stage || "Draft"} | {item.nextHearingDate || "No date"}</li>)}</ul>
                  <h4>{selectedMatter ? "Matter Tasks" : "Tasks"}</h4>
                  <ul>
                    {selectedMatterTasks.map((item) => (
                      <li key={item.id}>
                        {item.title || "Task"} | {item.dueDate || "No deadline"} | {item.status || "pending"}
                        {item.status !== "done" ? (
                          <button type="button" className="ghost-button" onClick={() => updateTaskStatus(item.id, "done")} style={{ marginLeft: "12px" }}>
                            Mark done
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <h4>Chronology Preview</h4>
                  <ul>{chronologyEntries.map((item) => <li key={item.id}>{item.date || "No date"} | {item.event}</li>)}</ul>
                </div>
              </>
            ) : null}

            {lawyerTab === "memory" ? (
              <>
                <div className="section-title">Smart Memory</div>
                <label>Memory Title<input value={memoryTitle} onChange={(event) => setMemoryTitle(event.target.value)} /></label>
                <label>Summary<textarea rows={3} value={memorySummary} onChange={(event) => setMemorySummary(event.target.value)} /></label>
                <button type="button" className="primary-button" onClick={saveMemory}>Save Memory</button>
                <label>Search Similar Cases<input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} /></label>
                <button type="button" className="ghost-button" onClick={suggestMemory}>Suggest Similar Cases</button>
                <div className="law-list-block">
                  <h4>Suggested Matches</h4>
                  <ul>
                    {memorySuggestions.map((item) => (
                      <li key={item.id}>
                        {item.title || "Case"} | {item.summary || "No summary"}
                        <button type="button" className="ghost-button" onClick={() => loadMemoryIntoResearch(item)} style={{ marginLeft: "12px" }}>
                          Use in research
                        </button>
                      </li>
                    ))}
                  </ul>
                  <h4>Saved Memory Bank</h4>
                  <ul>
                    {savedMemories.map((item) => (
                      <li key={item.id}>
                        <strong>{item.title || "Untitled memory"}</strong> | {item.summary || "No summary"}
                        {item.tags?.length ? ` | Tags: ${item.tags.join(", ")}` : ""}
                        <button type="button" className="ghost-button" onClick={() => loadMemoryIntoResearch(item)} style={{ marginLeft: "12px" }}>
                          Open in research
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}


            {lawyerTab === "audit" ? (
              <>
                <div className="section-title">Audit Logs</div>
                <div className="law-inline-actions">
                  <button type="button" className="ghost-button" onClick={hydrateLawyerData}>Refresh Logs</button>
                  <select value={auditFilter} onChange={(event) => setAuditFilter(event.target.value)}>
                    <option value="all">All actions</option>
                    <option value="ok">Successful only</option>
                    <option value="error">Errors / blocked</option>
                    <option value="public_guidance">Public guidance</option>
                    <option value="lawyer_research">Research</option>
                    <option value="draft_generator">Draft generation</option>
                    <option value="document_extract">Document extract</option>
                  </select>
                </div>
                <div className="law-list-block">
                  <ul>
                    {filteredAuditLogs.map((item) => (
                      <li key={item.id}>
                        {item.action || "action"} | {item.status || "ok"} | {formatFirestoreDate(item.createdAt)} | {item.requestSummary || "--"}
                      </li>
                    ))}
                  </ul>
                  {filteredAuditLogs.length === 0 ? <p className="muted-copy">No audit items for this filter yet.</p> : null}
                </div>
                {renderReviewSnapshots()}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {status ? <div className="muted-copy">{status}</div> : null}

      <div className="muted-copy law-safety-note">
        Trust & Safety: citations are guidance-only, verify latest amendments/judgments before filing.
        Public output always includes disclaimer; harmful/illegal requests are blocked; current Indian criminal-law references should be cross-checked under BNS, BNSS, and BSA.
      </div>

      <div className="law-meta soft-panel">
        <div className="section-title">Account & Access</div>
        <p className="muted-copy">Logged in: {account?.name || account?.phone || "Unknown user"}</p>
        <p className="muted-copy">Public profile: {publicProfile ? "Ready" : "Not activated"}</p>
        <p className="muted-copy">Lawyer profile: {lawyerProfile ? "Ready" : "Not activated"}</p>
      </div>
    </div>
  );
}

export default LawAssistantPage;
