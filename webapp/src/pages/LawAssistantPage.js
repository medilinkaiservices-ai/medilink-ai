import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getStoredAccount,
  getStoredProfile,
  registerRole,
  setLastActiveRole
} from "../utils/session";
import { analyzeCaseStrength, analyzeDraftValidation, analyzeEvidenceCoverage, analyzeFilingPackReadiness, analyzeFilingReadiness, analyzeLegalDocument, analyzeMatterConsistency, buildArguments, evaluateAuthorityGuardrails, fetchCaseCitations, fetchCaseValidity, listLegalReviewSnapshots, listLegalReviews, predictCaseOutcome, runCopilotChat, runLegalAction, saveLegalReview } from "../utils/legalApi";
import { buildCopilotContext, fetchCopilotActions, fetchFilingGuidance, generateCopilotDraft, getCopilotSession, sendCopilotChatMessage, startCopilotSession, submitCopilotIntake, validateCopilotDraft } from "../utils/copilotApi";
import { endpointConfig } from "../utils/endpointConfig";

const PUBLIC_DISCLAIMER = "This is not a substitute for a qualified lawyer";
const LOCAL_COPILOT_ONLY = endpointConfig.useLocalCopilotOnly;
const APPROVAL_ROLE_OPTIONS = [
  { value: "reviewer", label: "Reviewer" },
  { value: "senior_lawyer", label: "Senior Lawyer" },
  { value: "partner", label: "Partner" }
];
const REVIEW_STATUS_OPTIONS = [
  { value: "ai_draft", label: "AI Draft" },
  { value: "needs_revision", label: "Needs Revision" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" }
];
const FIRM_ESCALATION_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "senior_review", label: "Senior Review" },
  { value: "partner_hold", label: "Partner Hold" },
  { value: "urgent", label: "Urgent" }
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
  },
  {
    id: "complaint-cheque",
    title: "Complaint Format",
    draftType: "complaint",
    body:
`IN THE COURT OF THE HON'BLE [COURT NAME]
AT [PLACE]

COMPLAINT UNDER SECTION [___]

COMPLAINANT: [Name]

VERSUS

ACCUSED: [Name]

FACTS OF THE CASE:
1. [Transaction background]
2. [Default / dishonour / breach facts]
3. [Cause for complaint]

GROUNDS:
1. [Statutory basis]
2. [Supporting legal basis]

PRAYER:
It is therefore prayed that appropriate process and relief be granted in accordance with law.

PLACE:
DATE:

COUNSEL FOR THE COMPLAINANT`
  }
];

const COPILOT_STARTERS = [
  "Build draft",
  "Ask missing facts",
  "Find laws",
  "Review draft"
];

function detectTeluguTone(text = "") {
  const value = String(text || "").toLowerCase();
  return /telugu|cheppu|enti|enduku|ela|ivvu|vaddu|sambandham|deniki|inka|kavali|chesi/.test(value);
}

function formatAuthorityLabel(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return [item.title, item.citation].filter(Boolean).join(" | ");
}

function normalizeWorkspaceSnapshot({ facts = "", output = null } = {}) {
  const safeOutput = output || {};
  const applicableSections = Array.isArray(safeOutput.applicableSections) ? safeOutput.applicableSections.map(String) : [];
  const caseLaws = Array.isArray(safeOutput.caseLaws) ? safeOutput.caseLaws.map(formatAuthorityLabel).filter(Boolean) : [];
  const retrievedAuthorities = Array.isArray(safeOutput.retrievedAuthorities)
    ? safeOutput.retrievedAuthorities.map((item) => ({
        title: item?.title || "",
        citation: item?.citation || "",
        label: [item?.title, item?.citation].filter(Boolean).join(" | ")
      })).filter((item) => item.label)
    : [];
  const citations = Array.isArray(safeOutput.citations)
    ? safeOutput.citations.map((item) => ({
        title: item?.title || "",
        citation: item?.citation || "",
        label: [item?.title, item?.citation].filter(Boolean).join(" | ")
      })).filter((item) => item.label)
    : [];
  const bestCases = Array.isArray(safeOutput.bestCases)
    ? safeOutput.bestCases.map((item) => ({
        title: item?.title || "",
        citation: item?.citation || "",
        label: [item?.title, item?.citation].filter(Boolean).join(" | ")
      })).filter((item) => item.label)
    : [];
  const relatedJudgments = Array.isArray(safeOutput.relatedJudgments)
    ? safeOutput.relatedJudgments.map((item) => ({
        title: item?.title || "",
        citation: item?.citation || "",
        label: [item?.title, item?.citation].filter(Boolean).join(" | ")
      })).filter((item) => item.label)
    : [];

  const visibleAuthorities = [
    ...applicableSections.map((item) => ({ title: item, citation: "", label: item, source: "applicableSections" })),
    ...caseLaws.map((item) => ({ title: item, citation: "", label: item, source: "caseLaws" })),
    ...retrievedAuthorities.map((item) => ({ ...item, source: "retrievedAuthorities" })),
    ...citations.map((item) => ({ ...item, source: "citations" })),
    ...bestCases.map((item) => ({ ...item, source: "bestCases" })),
    ...relatedJudgments.map((item) => ({ ...item, source: "relatedJudgments" }))
  ].filter((item, index, list) => list.findIndex((entry) => entry.label.toLowerCase() === item.label.toLowerCase()) === index);

  return {
    facts: String(facts || ""),
    output: safeOutput,
    applicableSections,
    caseLaws,
    visibleAuthorities,
    visibleAuthorityLabels: visibleAuthorities.map((item) => item.label)
  };
}

function buildStructuredLines(title, items = [], wantsTelugu = false) {
  if (!items.length) {
    return wantsTelugu
      ? `${title}: clear items levu.`
      : `${title}: no clear items yet.`;
  }
  return `${title}:\n- ${items.join("\n- ")}`;
}

function buildAuthorityDiagnosis(authorityName = "", { issueLooksCheque = false, wantsTelugu = false } = {}) {
  const label = String(authorityName || "").trim();
  const lower = label.toLowerCase();

  if (!label) return "";

  if (/article 21|maneka gandhi/.test(lower)) {
    return wantsTelugu
      ? [
          `Authority: ${label}`,
          "Current relevance: noise / irrelevant",
          "Why it appeared: retrieval layer broad constitutional fairness / due-process authority ni pick chesindi.",
          "Should keep?: no, usually remove cheyyali for Section 138 matter.",
          "Better replacement: NI Act Section 138, Section 139, and cheque dishonour case law on notice, debt, and presumption."
        ].join("\n")
      : [
          `Authority: ${label}`,
          "Current relevance: noise / irrelevant",
          "Why it appeared: the retrieval layer likely over-matched broad constitutional fairness or due-process material.",
          "Should keep?: no, it should usually be removed for a Section 138 matter.",
          "Better replacement: NI Act Section 138, Section 139, and cheque dishonour case law on notice, debt, and presumption."
        ].join("\n");
  }

  if (/consumer protection/.test(lower)) {
    return wantsTelugu
      ? [
          `Authority: ${label}`,
          "Current relevance: usually irrelevant",
          "Why it appeared: system broad service/compensation style keyword ni consumer-law side ki map chesi undachu.",
          "Should keep?: only if the facts truly involve consumer deficiency, otherwise remove.",
          "Better replacement: NI Act and cheque dishonour complaint / notice authorities."
        ].join("\n")
      : [
          `Authority: ${label}`,
          "Current relevance: usually irrelevant",
          "Why it appeared: the system may have matched broad service or compensation language to consumer-law material.",
          "Should keep?: only if the facts truly involve consumer deficiency; otherwise remove.",
          "Better replacement: NI Act and cheque dishonour notice / complaint authorities."
        ].join("\n");
  }

  if (/bnss section 173|fir|cognizable/.test(lower)) {
    return wantsTelugu
      ? [
          `Authority: ${label}`,
          "Current relevance: usually noise for cheque dishonour",
          "Why it appeared: complaint / police / reporting keywords ni system over-match chesi undachu.",
          "Should keep?: no, unless separate FIR or police refusal facts unnayi.",
          "Better replacement: NI Act notice and complaint-compliance authorities."
        ].join("\n")
      : [
          `Authority: ${label}`,
          "Current relevance: usually noise for cheque dishonour",
          "Why it appeared: the system likely over-matched complaint, police, or reporting terminology.",
          "Should keep?: no, unless there are separate FIR or police-refusal facts.",
          "Better replacement: NI Act notice and complaint-compliance authorities."
        ].join("\n");
  }

  if (/bharatiya sakshya adhiniyam|evidence/.test(lower)) {
    return wantsTelugu
      ? [
          `Authority: ${label}`,
          "Current relevance: supporting authority, primary kaadu",
          "Why it appeared: cheque, memo, notice service, and debt proof documents ni prove cheyyadaniki evidence layer support ga use avvachu.",
          "Should keep?: yes, but only as supporting law.",
          "Better placement: supporting laws section, not primary laws."
        ].join("\n")
      : [
          `Authority: ${label}`,
          "Current relevance: supporting authority, not primary",
          "Why it appeared: it can support proof questions around the cheque, memo, notice service, and debt documents.",
          "Should keep?: yes, but only as supporting law.",
          "Better placement: supporting laws section, not the primary law list."
        ].join("\n");
  }

  if (/negotiable instruments|section 138|section 139|cheque dishonour/.test(lower)) {
    return wantsTelugu
      ? [
          `Authority: ${label}`,
          "Current relevance: core / primary",
          "Why it appeared: ee issue cheque dishonour / Section 138 NI Act matter kabatti direct ga relevant.",
          "Should keep?: yes.",
          "Better placement: primary laws."
        ].join("\n")
      : [
          `Authority: ${label}`,
          "Current relevance: core / primary",
          "Why it appeared: this matter is directly about cheque dishonour / Section 138 NI Act.",
          "Should keep?: yes.",
          "Better placement: primary laws."
        ].join("\n");
  }

  return wantsTelugu
    ? [
        `Authority: ${label}`,
        `Current relevance: ${issueLooksCheque ? "verify carefully; may be supporting or noise" : "context-dependent"}`,
        "Why it appeared: retrieval layer current facts ki related ani score chesi include chesi undachu.",
        "Should keep?: verify against the actual issue before relying on it.",
        "Better replacement: issue-specific primary law and directly matching case law."
      ].join("\n")
    : [
        `Authority: ${label}`,
        `Current relevance: ${issueLooksCheque ? "verify carefully; it may be supporting or noise" : "context-dependent"}`,
        "Why it appeared: the retrieval layer likely scored it as related to the current facts.",
        "Should keep?: verify it against the actual issue before relying on it.",
        "Better replacement: issue-specific primary law and directly matching case law."
      ].join("\n");
}

function extractAuthorityToRemove(message = "") {
  const text = String(message || "").trim();
  const patterns = [
    /(?:remove|delete)\s+(.+?)\s+(?:from|nundi|authority|output|workspace|research|list)/i,
    /(.+?)\s+(?:remove chey|remove cheyyi|delete chey|teesey|this authority remove chey)/i,
    /(article 21|maneka gandhi|consumer protection act|bnss section 173|bharatiya sakshya adhiniyam|section 138|section 139|negotiable instruments act)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }

  return "";
}

function formatCopilotSectionLabel(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function adaptCopilotValidationReport(report = {}) {
  const missingSections = Array.isArray(report.missingSections) ? report.missingSections.map(formatCopilotSectionLabel) : [];
  const citationIssues = Array.isArray(report.citationIssues) ? report.citationIssues : [];
  const unsupportedClaims = Array.isArray(report.unsupportedClaims) ? report.unsupportedClaims : [];
  const suggestedFixes = Array.isArray(report.suggestedFixes) ? report.suggestedFixes : [];
  const passed = String(report.status || "").toLowerCase() === "passed";
  const validationScore = Math.max(35, 100 - (missingSections.length * 12) - (citationIssues.length * 8) - (unsupportedClaims.length * 8));

  return {
    validationScore,
    validationLevel: passed ? "READY FOR REVIEW" : "REVIEW REQUIRED",
    summary: passed
      ? "Copilot validation found the core structure present for the current draft."
      : "Copilot validation found section gaps or support issues that should be fixed before filing.",
    checks: [
      {
        label: "Structural completeness",
        status: missingSections.length ? "warning" : "pass",
        detail: missingSections.length ? `Missing: ${missingSections.join(", ")}` : "Required sections detected."
      },
      {
        label: "Authority support",
        status: citationIssues.length ? "warning" : "pass",
        detail: citationIssues[0] || "No scoped citation issue was flagged."
      }
    ],
    missingSections,
    criticalIssues: [...citationIssues, ...unsupportedClaims],
    suggestions: suggestedFixes.length ? suggestedFixes : ["Run one final lawyer review before filing."]
  };
}

function buildCopilotReply(message, context = {}) {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return "Share the matter facts, upload a screenshot, or ask me to build a working draft from the current workspace.";
  }

  const hasDraft = Boolean(context.draft);
  const hasFacts = Boolean(context.facts);
  const snapshot = normalizeWorkspaceSnapshot({ facts: context.facts, output: context.output });
  const applicableSections = snapshot.applicableSections;
  const caseLaws = snapshot.caseLaws;
  const allAuthorities = snapshot.visibleAuthorityLabels;
  const lower = normalized.toLowerCase();
  const wantsTelugu = detectTeluguTone(normalized);
  const issueLooksCheque = /cheque|check|dishonou?r|bank memo|section 138|negotiable instruments/.test(`${context.facts || ""} ${normalized}`.toLowerCase());
  const hasArticle21 = allAuthorities.some((item) => /article 21|maneka gandhi/i.test(String(item)));
  const noiseAuthorities = allAuthorities.filter((item) => /article 14|article 21|constitution|maneka gandhi|d\.k\. basu|lalita kumari/i.test(String(item)));
  const niAuthorities = allAuthorities.filter((item) => /section 138|negotiable instruments|cheque|dishonou?r/i.test(String(item)));
  const suggestedChequeReplacements = [
    "Negotiable Instruments Act, 1881 - Section 138",
    "Negotiable Instruments Act, 1881 - Section 139",
    "Cheque dishonour case law on legally enforceable debt, statutory notice, and presumption"
  ];
  const asksPrimary = /primary laws|main laws|primary act|main act/.test(lower);
  const asksSupporting = /supporting laws|secondary laws|supporting act/.test(lower);
  const asksRemove = /remove|entries|irrelevant authorities|remove cheyyalsina/.test(lower);
  const asksRewrite = /rewrite|clean research format|clean format/.test(lower);
  const asksMissing = /missing facts|confirm cheyyalsina|facts enti|clarif/.test(lower);
  const asksComplete = /complete information|complete ga|anni cheppu|full details/.test(lower);
  const isMultiAsk = [asksPrimary, asksSupporting, asksRemove, asksRewrite, asksMissing, asksComplete].filter(Boolean).length >= 2;

  const explicitAuthorityMatch = normalized.match(/article 21|maneka gandhi|consumer protection act|bnss section 173|bharatiya sakshya adhiniyam|section 138|section 139|negotiable instruments act/i);
  const asksWhyIncluded = /enduku|why.*include|why.*appear|why.*came|why did ai|deniki|ela relevant/.test(lower);

  if (explicitAuthorityMatch && asksWhyIncluded) {
    return buildAuthorityDiagnosis(explicitAuthorityMatch[0], { issueLooksCheque, wantsTelugu });
  }

  if (/irrelevant authorities evi|which authorities are irrelevant/.test(lower) && issueLooksCheque) {
    const relevantItems = [
      "Negotiable Instruments Act, 1881 - Section 138",
      "Negotiable Instruments Act, 1881 - Section 139",
      "Cheque dishonour case law on notice, debt, and presumption"
    ];
    const irrelevantItems = [
      "Constitution of India - Article 21 -> constitutional liberty issue kaadu",
      "Maneka Gandhi v. Union of India -> Article 21 due-process case, Section 138 matter ki usually irrelevant",
      "Consumer Protection Act, 2019 -> cheque dishonour matter consumer deficiency case kaadu unless distinct facts exist",
      "BNSS Section 173 -> FIR / cognizable reporting provision, cheque notice workflow ki usually direct relation ledu"
    ];
    return wantsTelugu
      ? [
          buildStructuredLines("Relevant authorities", relevantItems, true),
          buildStructuredLines("Irrelevant / remove cheyyalsina authorities", irrelevantItems, true)
        ].join("\n\n")
      : [
          buildStructuredLines("Relevant authorities", relevantItems),
          buildStructuredLines("Irrelevant / removable authorities", irrelevantItems)
        ].join("\n\n");
  }

  if (isMultiAsk && issueLooksCheque) {
    const primaryLaws = [
      "Negotiable Instruments Act, 1881 - Section 138",
      "Negotiable Instruments Act, 1881 - Section 139"
    ];
    const supportingLaws = [
      "Evidence / proof principles only for cheque, memo, notice service, and debt documents",
      "Procedural complaint timing and notice-compliance checks only if needed"
    ];
    const removeEntries = noiseAuthorities.length
      ? noiseAuthorities.map((item) => `${item} -> cheque dishonour matter ki direct relation ledu`)
      : ["Current visible output lo obvious irrelevant authority detect avvaledu"];
    const missingFacts = [
      "Cheque exact date",
      "Dishonour / return memo date",
      "Bank return reason",
      "Statutory notice date",
      "Notice service proof",
      "Legally enforceable debt proof",
      "15 days lopu payment jariginda leda"
    ];
    const cleanRewrite = [
      "Issue: cheque dishonour / Section 138 NI Act",
      "Primary laws: Section 138 and Section 139 NI Act",
      "Key checks: legally enforceable debt, cheque issuance, dishonour memo, statutory notice, service, non-payment within prescribed period",
      "Remove constitutional / FIR / consumer-law noise unless facts expressly justify them"
    ];

    return wantsTelugu
      ? [
          buildStructuredLines("Primary laws", primaryLaws, true),
          buildStructuredLines("Supporting laws", supportingLaws, true),
          buildStructuredLines("Remove cheyyalsina entries", removeEntries, true),
          buildStructuredLines("Confirm cheyyalsina missing facts", missingFacts, true),
          buildStructuredLines("Clean research format", cleanRewrite, true)
        ].join("\n\n")
      : [
          buildStructuredLines("Primary laws", primaryLaws),
          buildStructuredLines("Supporting laws", supportingLaws),
          buildStructuredLines("Entries to remove", removeEntries),
          buildStructuredLines("Missing facts to confirm", missingFacts),
          buildStructuredLines("Clean research format", cleanRewrite)
        ].join("\n\n");
  }

  if (/article 21|maneka gandhi/.test(lower)) {
    if (issueLooksCheque && hasArticle21) {
      return wantsTelugu
        ? "Cheque dishonour / Section 138 matter lo Article 21 leda Maneka Gandhi usually relevant kaadu. Mee case lo constitutional issue leda personal liberty issue unte tappite idi noise laga consider cheyyali, remove cheyyadam better."
        : "For a cheque dishonour / Section 138 matter, Article 21 or Maneka Gandhi usually looks irrelevant. This authority should likely be excluded unless your case specifically raises constitutional or personal-liberty issues.";
    }
    if (hasArticle21) {
      return wantsTelugu
        ? "Current workspace lo Article 21 vachindante retrieval constitutional liberty / fair procedure line nundi authority ni pick chesindi ani artham. Mee matter arrest, detention, State action, leda constitutional process gurinchi kaakapothe idi noise ayye chance ekkuva."
        : "Article 21 appears in the current workspace because a retrieved authority is linked to life, liberty, or fair-procedure jurisprudence. If your matter is not about constitutional process, arrest, detention, or State action, this may be noise.";
    }
    return wantsTelugu
      ? "Current workspace context batti Article 21 clear ga avasaram ledu. Cheque dishonour matters lo focus NI Act mariyu directly relevant cheque dishonour case law meeda undali."
      : "Article 21 is not clearly needed from the current workspace context. For cheque dishonour matters, the focus should normally stay on the Negotiable Instruments Act and directly relevant case law.";
  }

  if (/why.*relevant|relevant aa|irrelevant|remove/.test(lower)) {
    if (issueLooksCheque && hasArticle21) {
      return wantsTelugu
        ? `Current research output noisy ga undi. Ee cheque dishonour matter lo ${niAuthorities.join(", ") || "NI Act authorities"} matrame maintain cheyyi. ${noiseAuthorities.join(", ")} lanti constitutional authorities ni facts expressly justify chesthe tappite remove cheyyali.`
        : `The current research output looks noisy. For this cheque dishonour matter, keep ${niAuthorities.join(", ") || "Section 138 NI Act and directly related cheque dishonour authorities"}; remove ${noiseAuthorities.join(", ") || "Article 21 and similar constitutional material"} unless the facts expressly justify them.`;
    }
    if (!allAuthorities.length && !applicableSections.length && !caseLaws.length) {
      return wantsTelugu
        ? "Workspace lo inka grounded research saripodu. First research run cheyyi, tarvata e authorities relevant, evi remove cheyyalo clear ga cheptha."
        : "There is not enough grounded research in the workspace yet. Run research first, then I can tell you which authorities are relevant and which should be removed.";
    }
  }

  if (/replace|instead|alternative|better authority|better case|em pettali/.test(lower)) {
    if (issueLooksCheque) {
      return wantsTelugu
        ? `Ee matter lo better replacements: ${suggestedChequeReplacements.join(", ")}. Focus legally enforceable debt, statutory notice timeline, service proof, and presumption line meeda undali.`
        : `Better replacements for this matter are: ${suggestedChequeReplacements.join(", ")}. The focus should stay on legally enforceable debt, statutory notice, service proof, and presumption-related case law.`;
    }
  }

  if (/summary|workspace|current output|ippudu situation|enti present/.test(lower)) {
    const factsLine = hasFacts ? String(context.facts).split("\n")[0].trim() : "";
    const authorityLine = niAuthorities.slice(0, 3).join(", ") || applicableSections.slice(0, 3).join(", ");
    return wantsTelugu
      ? `Current workspace summary: issue "${factsLine || "facts pending"}". Relevant side lo ${authorityLine || "clear authorities inka raaledu"}. ${noiseAuthorities.length ? `Noise ga kanipistunnavi: ${noiseAuthorities.join(", ")}.` : "Obvious noise ippudu detect avvaledu."}`
      : `Current workspace summary: issue "${factsLine || "facts pending"}". Relevant side currently points to ${authorityLine || "no clear authorities yet"}. ${noiseAuthorities.length ? `Possible noise detected: ${noiseAuthorities.join(", ")}.` : "No obvious noise is currently detected."}`;
  }

  if (/temporary draft|build draft|working draft/.test(lower)) {
    if (hasDraft) {
      return wantsTelugu
        ? "Workspace lo already working draft undi. Next nenu tone refine cheyyagalanu, legal basis add cheyyagalanu, leda specific section rewrite cheyyagalanu."
        : "A working draft already exists in the workspace. I can refine tone, add legal basis, or rewrite any section next.";
    }
    return hasFacts
      ? (wantsTelugu
          ? "Current facts ni working draft ga marchadaniki ready ga unnanu. Draft workflow run chesi result vasthe section by section refine cheddam."
          : "I am ready to turn the current facts into a working draft. Use Run AI in the draft workflow, and I will help refine the result section by section.")
      : (wantsTelugu
          ? "Working draft build cheyyadaniki konchem facts kavali. Issue, dates, parties, relief enti anedi paste cheyyi."
          : "I need at least brief matter facts before I can build a working draft. Paste the issue, dates, parties, and the relief you want.");
  }

  if (/missing facts|clarif|questions/.test(lower)) {
    if (issueLooksCheque) {
      return wantsTelugu
        ? "Cheque dishonour matter ki confirm cheyyalsina key facts: cheque date, dishonour date, return reason, notice date, notice service proof, amount, legally enforceable debt proof, payment within 15 days jariginda leda."
        : "For a cheque dishonour matter, confirm these key facts: cheque date, dishonour date, return reason, notice date, service proof, amount, proof of legally enforceable debt, and whether payment was made within 15 days.";
    }
    return wantsTelugu
      ? "High-value facts confirm cheyyali: exact dates, party details, amount involved, notices already sent aa, proof unda, civil only aa leda criminal remedies kuda consider cheyyala."
      : "High-value facts to confirm: exact dates, party details, amount involved, notices already sent, proof available, and whether you want civil-only or criminal remedies.";
  }

  if (/relevant laws|sections|laws/.test(lower)) {
    if (issueLooksCheque && applicableSections.length) {
      const filtered = applicableSections.filter((item) => !/article 14|article 21|constitution/i.test(String(item)));
      return filtered.length
        ? (wantsTelugu
            ? `Current cheque dishonour matter lo grounded legal focus idi undali: ${filtered.join(", ")}. Constitutional authorities ikkada usually exclude cheyyali.`
            : `For the current cheque dishonour matter, the grounded legal focus should stay on: ${filtered.join(", ")}. Constitutional authorities should usually be excluded here.`)
        : (wantsTelugu
            ? "Current cheque dishonour matter lo NI Act, especially Section 138 meeda focus undali. Facts justify chesthe matrame closely related supporting law add cheyyali."
            : "For the current cheque dishonour matter, focus on the Negotiable Instruments Act, especially Section 138, and only closely related supporting law if the facts justify it.");
    }
    return hasFacts
      ? (wantsTelugu
          ? "Issue ni first primary law ki map chestha, tarvata facts justify chesthe supporting law add chestha. Research run avagane authorities ni narrow cheddam."
          : "I will map the issue to primary law first, then supporting law only if the facts justify it. Run research from this workspace and I will help narrow the authorities.")
      : (wantsTelugu
          ? "Facts share chesthe primary Act, supporting provisions, mariyu case-law themes shortlist chestha."
          : "Once you share the facts, I can shortlist the primary Act, supporting provisions, and case-law themes for this matter.");
  }

  if (/rewrite|change|revise|draft/.test(lower)) {
    return hasDraft
      ? (wantsTelugu
          ? "Draft lo em change kavalo direct ga cheppu. Example: tone soft chey, legal basis add chey, criminal allegations remove chey, demand paragraph strong chey."
          : "Tell me what to change in the draft, for example: soften tone, add legal basis, remove criminal allegations, or strengthen the demand paragraph.")
      : (wantsTelugu
          ? "Workspace lo inka draft ledu. Mundhu facts ivvu leda temporary draft build chey, tarvata copy-paste lekunda revise chestha."
          : "There is no draft in the workspace yet. Share facts or build a temporary draft first, then I can revise it without copy-paste.");
  }

  if (issueLooksCheque) {
    return wantsTelugu
      ? `Idi cheque dishonour / Section 138 type matter laga kanipistundi. Present ga focus undalsindi NI Act, notice timeline, service proof, legally enforceable debt, mariyu presumption-related case law meeda. Specific ga adugu: "missing facts enti", "irrelevant authorities evi", "better laws evi", "draft lo em add cheyali".`
      : `This looks like a cheque dishonour / Section 138 matter. The present focus should stay on the NI Act, notice timeline, service proof, legally enforceable debt, and presumption-related case law. You can ask specifically: "what facts are missing", "which authorities are irrelevant", "what should replace them", or "what should be added to the draft".`;
  }

  return wantsTelugu
    ? "Current workspace batti nenu missing facts collect cheyyagalanu, next legal step suggest cheyyagalanu, relevant/irrelevant authorities explain cheyyagalanu, mariyu draft ni revise cheyyadaniki guide cheyyagalanu."
    : "From the current workspace, I can collect missing facts, suggest the next legal step, explain which authorities are relevant or irrelevant, and guide draft revisions.";
}

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
  if (!items.length) return <li>No relevant case laws found.</li>;
  return items.map((item, index) => {
    const value = typeof item === "string"
      ? item
      : [item?.title, item?.citation].filter(Boolean).join(" | ") || item?.label || item?.name || "No relevant case laws found.";
    return <li key={`${String(value)}-${index}`}>{value}</li>;
  });
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

function isServiceUnavailableError(error) {
  const message = String(error?.message || error || "").trim();
  return /failed to fetch|connection refused|err_connection_refused|unable to reach|networkerror/i.test(message);
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

function buildLocalMemorySuggestions({ query = "", memories = [], caseStudies = CASE_STUDIES } = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const sourceItems = (Array.isArray(memories) && memories.length ? memories : caseStudies).map((item, index) => ({
    id: item.id || `memory-suggestion-${index}`,
    title: item.title || item.name || "Case memory",
    summary: item.summary || item.facts || item.clientSummary || "No summary available.",
    tags: Array.isArray(item.tags) && item.tags.length
      ? item.tags
      : Array.isArray(item.issues)
        ? item.issues.slice(0, 4)
        : []
  }));

  const ranked = sourceItems.map((item) => {
    const haystack = `${item.title} ${item.summary} ${(item.tags || []).join(" ")}`.toLowerCase();
    const score = normalizedQuery
      ? normalizedQuery.split(/\s+/).filter(Boolean).reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
      : 0;
    return { ...item, score };
  });

  return ranked
    .filter((item) => !normalizedQuery || item.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 5)
    .map(({ score, ...item }) => item);
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

function buildReviewFindingReasons(findings = []) {
  return (Array.isArray(findings) ? findings : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => {
      const lower = item.toLowerCase();
      if (/missing|not yet|absence|blank|no /.test(lower)) {
        return { title: item, reason: "Required information or support is still missing." };
      }
      if (/risk|weak|contradiction|inconsistent|unsafe/.test(lower)) {
        return { title: item, reason: "This can weaken filing quality or review confidence." };
      }
      if (/deadline|hearing|timeline|limitation|date/.test(lower)) {
        return { title: item, reason: "Timing or procedural readiness needs a senior check." };
      }
      return { title: item, reason: "This point should be reviewed before approval." };
    });
}

function getLocalReviewStorageKey(ownerId) {
  return `medilink-legal-reviews:${String(ownerId || "anonymous").trim()}`;
}

function getLocalReviewDraftStorageKey(ownerId) {
  return `medilink-legal-review-drafts:${String(ownerId || "anonymous").trim()}`;
}

function getLocalSeniorSelectionStorageKey(ownerId) {
  return `medilink-legal-senior-selection:${String(ownerId || "anonymous").trim()}`;
}

function getLocalFirmActionStorageKey(ownerId) {
  return `medilink-legal-firm-actions:${String(ownerId || "anonymous").trim()}`;
}

function getLocalFirmPreferencesStorageKey(ownerId) {
  return `medilink-legal-firm-preferences:${String(ownerId || "anonymous").trim()}`;
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

function readLocalReviewDrafts(ownerId) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(getLocalReviewDraftStorageKey(ownerId));
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalReviewDrafts(ownerId, drafts) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getLocalReviewDraftStorageKey(ownerId), JSON.stringify(drafts || {}));
}

function readLocalSeniorSelection(ownerId) {
  if (typeof window === "undefined") {
    return { selectedMatterId: "", selectedSeniorReviewKey: "" };
  }
  try {
    const raw = window.localStorage.getItem(getLocalSeniorSelectionStorageKey(ownerId));
    const parsed = JSON.parse(raw || "{}");
    return {
      selectedMatterId: String(parsed?.selectedMatterId || ""),
      selectedSeniorReviewKey: String(parsed?.selectedSeniorReviewKey || "")
    };
  } catch {
    return { selectedMatterId: "", selectedSeniorReviewKey: "" };
  }
}

function writeLocalSeniorSelection(ownerId, selection = {}) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getLocalSeniorSelectionStorageKey(ownerId), JSON.stringify({
    selectedMatterId: String(selection.selectedMatterId || ""),
    selectedSeniorReviewKey: String(selection.selectedSeniorReviewKey || "")
  }));
}

function readLocalFirmActions(ownerId) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getLocalFirmActionStorageKey(ownerId));
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalFirmActions(ownerId, actions) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getLocalFirmActionStorageKey(ownerId), JSON.stringify(actions || []));
}

function readLocalFirmPreferences(ownerId) {
  if (typeof window === "undefined") {
    return { firmQueueFilter: "all", firmQueueSort: "priority" };
  }
  try {
    const raw = window.localStorage.getItem(getLocalFirmPreferencesStorageKey(ownerId));
    const parsed = JSON.parse(raw || "{}");
    return {
      firmQueueFilter: String(parsed?.firmQueueFilter || "all"),
      firmQueueSort: String(parsed?.firmQueueSort || "priority")
    };
  } catch {
    return { firmQueueFilter: "all", firmQueueSort: "priority" };
  }
}

function writeLocalFirmPreferences(ownerId, preferences = {}) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getLocalFirmPreferencesStorageKey(ownerId), JSON.stringify({
    firmQueueFilter: String(preferences.firmQueueFilter || "all"),
    firmQueueSort: String(preferences.firmQueueSort || "priority")
  }));
}

function filterAuditLogs(auditLogs = [], auditFilter = "all") {
  if (auditFilter === "all") return auditLogs;
  if (auditFilter === "ok") return (auditLogs || []).filter((item) => item.status === "ok");
  if (auditFilter === "error") return (auditLogs || []).filter((item) => item.status === "error" || item.status === "blocked");
  return (auditLogs || []).filter((item) => item.action === auditFilter);
}

function buildReviewQueue(reviewRecords = [], cases = []) {
  const caseMap = new Map((cases || []).map((item) => [item.id, item]));
  return (reviewRecords || [])
    .map((item) => {
      const matter = caseMap.get(item.matterId) || null;
      const updatedMs = item.updatedAt?.toMillis?.() || Date.parse(item.updatedAt || "") || 0;
      return {
        ...item,
        matter,
        reviewStatus: String(item.status || "ai_draft").toLowerCase(),
        matterLabel: item.matterTitle || matter?.title || item.entityLabel || "General workspace",
        updatedMs,
        riskCount: Array.isArray(item.reviewFindings) ? item.reviewFindings.length : 0
      };
    })
    .sort((left, right) => {
      const statusRank = {
        needs_revision: 0,
        ai_draft: 1,
        reviewed: 2,
        approved: 3
      };
      const leftRank = statusRank[left.reviewStatus] ?? 9;
      const rightRank = statusRank[right.reviewStatus] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return right.updatedMs - left.updatedMs;
    });
}

function buildSeniorReviewFacts(reviewItem = null) {
  if (!reviewItem) return [];
  const notes = String(reviewItem.matter?.notes || "").trim();
  return notes
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildSeniorRiskFlags(reviewItem = null) {
  if (!reviewItem) return [];
  const outputSummary = String(reviewItem.outputSummary || "").trim();
  const findings = Array.isArray(reviewItem.reviewFindings) ? reviewItem.reviewFindings : [];
  const flags = [...findings];
  if (!reviewItem.matter?.nextHearingDate) {
    flags.push("Next hearing / deadline is missing on this matter.");
  }
  if (!reviewItem.reviewNotes) {
    flags.push("No internal review note has been added yet.");
  }
  if (!outputSummary) {
    flags.push("Output summary is blank, so senior review context is weak.");
  }
  return Array.from(new Set(flags)).slice(0, 8);
}

function buildReviewRecordPayload({
  ownerId = "",
  selectedMatterId = "",
  selectedMatter = null,
  caseTitle = "",
  entityType = "",
  entityKey = "",
  entityLabel = "",
  status = "ai_draft",
  approvalRole = "",
  reviewerName = "",
  reviewNotes = "",
  reviewFindings = [],
  assignedReviewer = "",
  escalationLevel = "routine",
  partnerStatus = "pending",
  output = null,
  draftVersionLabel = ""
} = {}) {
  return {
    ownerId,
    matterId: selectedMatterId || selectedMatter?.id || "",
    matterTitle: selectedMatter?.title || caseTitle || "",
    entityType,
    entityKey,
    entityLabel,
    draftVersionLabel,
    status,
    approvalRole,
    reviewerName,
    reviewNotes,
    assignedReviewer,
    escalationLevel,
    partnerStatus,
    reviewFindings: Array.isArray(reviewFindings)
      ? reviewFindings.map((item) => String(item || "").trim()).filter(Boolean)
      : String(reviewFindings || "").split(/\n+/).map((item) => item.trim()).filter(Boolean),
    outputSummary: buildReviewSummaryText(output),
    keyPoints: output?.keyFactors || output?.issueList || output?.strengths || output?.keyFacts || output?.missingSections || [],
    traceability: output?.traceability || null
  };
}

function buildReviewSnapshotRecord(review = {}, output = null) {
  const traceability = output?.traceability || review?.traceability || null;
  return {
    id: review.id || `${review.entityType || "output"}:${review.entityKey || Date.now()}`,
    entityType: review.entityType || "",
    entityKey: review.entityKey || "",
    entityLabel: review.entityLabel || review.entityType || "Output",
    matterId: review.matterId || "",
    matterTitle: review.matterTitle || "",
    reviewerName: review.reviewerName || "",
    approvalRole: review.approvalRole || "",
    outputSummary: review.outputSummary || buildReviewSummaryText(output),
    traceSnapshot: traceability,
    approvedAt: review.updatedAt || new Date().toISOString()
  };
}

function upsertReviewSnapshotList(currentSnapshots = [], snapshot = null) {
  if (!snapshot) return currentSnapshots || [];
  const others = (currentSnapshots || []).filter((item) => {
    const currentId = item?.id || `${item?.entityType || ""}:${item?.entityKey || ""}`;
    const nextId = snapshot.id || `${snapshot.entityType || ""}:${snapshot.entityKey || ""}`;
    return currentId !== nextId;
  });
  return [snapshot, ...others];
}

function buildApprovedSnapshotsFromReviews(reviewRecords = []) {
  return (Array.isArray(reviewRecords) ? reviewRecords : [])
    .filter((item) => String(item?.status || "").trim().toLowerCase() === "approved")
    .map((item) => buildReviewSnapshotRecord(item))
    .sort((left, right) => {
      const leftMs = Date.parse(left.approvedAt || "") || 0;
      const rightMs = Date.parse(right.approvedAt || "") || 0;
      return rightMs - leftMs;
    });
}

function canApproveReview({ nextStatus = "", approvalRole = "" } = {}) {
  if (String(nextStatus || "").trim().toLowerCase() !== "approved") {
    return true;
  }
  return Boolean(String(approvalRole || "").trim());
}

function buildReviewStatusPresentation(status = "") {
  const effectiveStatus = String(status || "ai_draft").toLowerCase();
  if (effectiveStatus === "approved") {
    return {
      status: effectiveStatus,
      label: "Approved",
      style: { background: "#dff6e6", color: "#1f7a3d" }
    };
  }
  if (effectiveStatus === "reviewed") {
    return {
      status: effectiveStatus,
      label: "Reviewed",
      style: { background: "#fff5d6", color: "#8a6500" }
    };
  }
  if (effectiveStatus === "needs_revision") {
    return {
      status: effectiveStatus,
      label: "Needs Revision",
      style: { background: "#fde3e3", color: "#9f1d1d" }
    };
  }
  return {
    status: effectiveStatus,
    label: "AI Draft",
    style: { background: "#e8efff", color: "#244b8a" }
  };
}

function buildReviewQueueSummary(reviewQueue = []) {
  const items = Array.isArray(reviewQueue) ? reviewQueue : [];
  return {
    total: items.length,
    needsRevision: items.filter((item) => item.reviewStatus === "needs_revision").length,
    reviewed: items.filter((item) => item.reviewStatus === "reviewed").length,
    approved: items.filter((item) => item.reviewStatus === "approved").length
  };
}

function buildFirmDashboard({
  reviewRecords = [],
  reviewSnapshots = [],
  cases = [],
  tasks = [],
  auditLogs = [],
  firmActionHistory = []
} = {}) {
  const reviewQueue = buildReviewQueue(reviewRecords, cases);
  const queueSummary = buildReviewQueueSummary(reviewQueue);
  const approvedSnapshots = Array.isArray(reviewSnapshots) && reviewSnapshots.length
    ? reviewSnapshots
    : buildApprovedSnapshotsFromReviews(reviewRecords);
  const pendingTasks = (Array.isArray(tasks) ? tasks : []).filter((item) => String(item?.status || "").toLowerCase() !== "done");
  const urgentDeadlines = (Array.isArray(cases) ? cases : [])
    .map((item) => {
      const severity = getDateSeverity(item?.nextHearingDate || "");
      return {
        id: item?.id || item?.title || "",
        title: item?.title || "Matter",
        nextHearingDate: item?.nextHearingDate || "",
        severity
      };
    })
    .filter((item) => item.severity.diff !== null && item.severity.diff <= 7)
    .sort((left, right) => (left.severity.diff ?? 999) - (right.severity.diff ?? 999))
    .slice(0, 6);
  const recentAudit = (Array.isArray(auditLogs) ? auditLogs : [])
    .slice()
    .sort((left, right) => {
      const leftMs = Date.parse(left?.createdAt || left?.timestamp || "") || 0;
      const rightMs = Date.parse(right?.createdAt || right?.timestamp || "") || 0;
      return rightMs - leftMs;
    })
    .slice(0, 6);
  const recentFirmActions = (Array.isArray(firmActionHistory) ? firmActionHistory : [])
    .slice()
    .sort((left, right) => (Date.parse(right?.createdAt || "") || 0) - (Date.parse(left?.createdAt || "") || 0))
    .slice(0, 8);
  const approvalCoverage = queueSummary.total
    ? Math.round((approvedSnapshots.length / queueSummary.total) * 100)
    : 0;

  return {
    queueSummary,
    approvedSnapshots,
    pendingTasks,
    urgentDeadlines,
    recentAudit,
    recentFirmActions,
    attentionItems: reviewQueue.filter((item) => ["needs_revision", "ai_draft"].includes(item.reviewStatus)).slice(0, 6),
    metrics: [
      { label: "Active Matters", value: (Array.isArray(cases) ? cases : []).length, tone: "neutral" },
      { label: "Review Queue", value: queueSummary.total, tone: "neutral" },
      { label: "Need Revision", value: queueSummary.needsRevision, tone: queueSummary.needsRevision ? "danger" : "ok" },
      { label: "Pending Tasks", value: pendingTasks.length, tone: pendingTasks.length > 5 ? "warning" : "neutral" },
      { label: "Approved", value: approvedSnapshots.length, tone: "ok" },
      { label: "Coverage", value: `${approvalCoverage}%`, tone: approvalCoverage >= 60 ? "ok" : "warning" }
    ],
    routingSummary: {
      partnerHold: reviewQueue.filter((item) => item.escalationLevel === "partner_hold").length,
      urgent: reviewQueue.filter((item) => item.escalationLevel === "urgent").length,
      seniorReview: reviewQueue.filter((item) => item.escalationLevel === "senior_review").length
    }
  };
}

function buildFirmQueueView(reviewQueue = [], attentionItems = [], { filter = "all", sort = "priority" } = {}) {
  let items;
  if (filter === "all") {
    items = attentionItems;
  } else if (filter === "urgent") {
    items = (reviewQueue || []).filter((item) => item.escalationLevel === "urgent");
  } else if (filter === "partner_hold") {
    items = (reviewQueue || []).filter((item) => item.escalationLevel === "partner_hold" || item.partnerStatus === "ready_for_partner");
  } else if (filter === "approved") {
    items = (reviewQueue || []).filter((item) => item.reviewStatus === "approved");
  } else if (filter === "assigned") {
    items = (reviewQueue || []).filter((item) => String(item.assignedReviewer || "").trim());
  } else {
    items = attentionItems;
  }

  const next = [...(items || [])];
  if (sort === "latest") {
    next.sort((left, right) => (right.updatedMs || 0) - (left.updatedMs || 0));
  } else if (sort === "risk") {
    next.sort((left, right) => (right.riskCount || 0) - (left.riskCount || 0));
  } else {
    next.sort((left, right) => {
      const statusRank = {
        needs_revision: 0,
        ai_draft: 1,
        reviewed: 2,
        approved: 3
      };
      const leftRank = statusRank[left.reviewStatus] ?? 9;
      const rightRank = statusRank[right.reviewStatus] ?? 9;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (right.updatedMs || 0) - (left.updatedMs || 0);
    });
  }
  return next.slice(0, 8);
}

function buildSnapshotTraceSummary(snapshot = {}) {
  const facts = Array.isArray(snapshot?.traceSnapshot?.factsUsed)
    ? snapshot.traceSnapshot.factsUsed.map((entry) => entry?.label || entry).filter(Boolean)
    : [];
  const documents = Array.isArray(snapshot?.traceSnapshot?.documentsReviewed)
    ? snapshot.traceSnapshot.documentsReviewed.map((entry) => entry?.title || "Document").filter(Boolean)
    : [];
  const authorities = Array.isArray(snapshot?.traceSnapshot?.authoritiesRelied)
    ? snapshot.traceSnapshot.authoritiesRelied.map((entry) => entry?.title || entry?.citation || "Authority").filter(Boolean)
    : [];

  return {
    factsLine: facts.join(" | ") || "None",
    documentsLine: documents.join(", ") || "None",
    authoritiesLine: authorities.join(", ") || "None",
    hasTrace: facts.length > 0 || documents.length > 0 || authorities.length > 0
  };
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

function buildMemoryResearchPrompt(memoryItem = {}) {
  return [
    `Memory Title: ${memoryItem.title || "Untitled memory"}`,
    `Summary: ${memoryItem.summary || "No summary"}`,
    Array.isArray(memoryItem.tags) && memoryItem.tags.length ? `Tags: ${memoryItem.tags.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

function buildMatterResearchPrompt({
  selectedMatter = null,
  selectedMatterClient = null,
  chronologyEntries = [],
  selectedMatterTasks = [],
  hearingNotes = ""
} = {}) {
  if (!selectedMatter) return "";
  return [
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
}

function buildMatterPrepSheet({
  selectedMatter = null,
  selectedMatterClient = null,
  chronologyEntries = [],
  selectedMatterTasks = [],
  hearingNotes = ""
} = {}) {
  if (!selectedMatter && !chronologyEntries.length && !selectedMatterTasks.length && !String(hearingNotes || "").trim()) {
    return "";
  }

  return [
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
}

function buildClientUpsertPayload({ name = "", phone = "", notes = "" } = {}) {
  return {
    name: String(name || "").trim(),
    phone: String(phone || "").trim(),
    notes: String(notes || "").trim()
  };
}

function buildCaseUpsertPayload({
  clientId = "",
  title = "",
  stage = "Draft",
  notes = "",
  nextHearingDate = ""
} = {}) {
  return {
    clientId: String(clientId || "").trim(),
    title: String(title || "").trim(),
    stage: String(stage || "Draft").trim() || "Draft",
    notes: String(notes || "").trim(),
    nextHearingDate: String(nextHearingDate || "").trim()
  };
}

function buildTaskUpsertPayload({
  title = "",
  dueDate = "",
  status = "pending",
  relatedCaseId = ""
} = {}) {
  return {
    title: String(title || "").trim(),
    dueDate: String(dueDate || "").trim(),
    status: String(status || "pending").trim() || "pending",
    relatedCaseId: String(relatedCaseId || "").trim()
  };
}

function buildTaskStatusUpdatePayload(existingTask = null, statusValue = "") {
  if (!existingTask) return null;
  return {
    ...existingTask,
    id: existingTask.id,
    status: String(statusValue || "").trim()
  };
}

function buildMemorySavePayload({ title = "", summary = "" } = {}) {
  const safeTitle = String(title || "").trim();
  return {
    title: safeTitle,
    summary: String(summary || "").trim(),
    tags: safeTitle ? safeTitle.split(/\s+/).slice(0, 4) : []
  };
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

function renderAuthorities(authorities = [], onRevalidate = null, onOpenDetails = null, onCompare = null) {
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
            {onOpenDetails ? (
              <button type="button" className="ghost-button" onClick={() => onOpenDetails(item)}>
                View Details
              </button>
            ) : null}
            {onCompare ? (
              <button type="button" className="ghost-button" onClick={() => onCompare(item)}>
                Compare
              </button>
            ) : null}
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
    caseLaws: bestCases,
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
  const inferredType = /legal notice|subject:|noticee|called upon|under instructions/i.test(text)
    ? "notice"
    : /verification|deponent|solemnly affirm/i.test(text)
      ? "affidavit"
      : /between|party of the first part|party of the second part|governing law/i.test(text)
        ? "agreement"
        : /complaint under section|complainant|accused|take cognizance|issue appropriate process/i.test(text)
          ? "complaint"
        : /in the court|in the hon'?ble|before the hon'?ble|petitioner|respondent|plaintiff|defendant/i.test(text)
          ? "petition"
          : "";
  const type = inferredType || String(draftType || "petition").toLowerCase();
  const checks = [
    {
      key: "heading",
      label: type === "notice" ? "Notice heading present" : "Court heading present",
      passed: type === "notice" ? /legal notice/i.test(text) : /in the court|in the hon'?ble/i.test(text),
      note: type === "notice" ? "Notice should begin with a clear legal notice heading." : "Draft should begin with a proper court heading.",
      severity: "high"
    },
    {
      key: "parties",
      label: "Party block present",
      passed: type === "notice"
        ? /from:|to:|noticee|recipient/i.test(text)
        : /versus|petitioner|plaintiff|respondent|defendant|complainant|accused/i.test(text),
      note: type === "notice" ? "Notice should clearly identify sender and recipient roles." : "Party names / roles should be shown clearly.",
      severity: "high"
    },
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

  if (type === "complaint") {
    checks.push(
      { key: "complaint-heading", label: "Complaint heading present", passed: /complaint under section|criminal complaint|private complaint/i.test(text), note: "Complaint drafts should clearly identify the complaint heading and statutory basis.", severity: "high" },
      { key: "cause", label: "Cause of action present", passed: /cause of action/i.test(text), note: "Complaint drafts should explain why process is invoked.", severity: "high" },
      { key: "prayer", label: "Prayer / process clause present", passed: /prayer|take cognizance|issue appropriate process|issue process/i.test(text), note: "Complaint drafts should end with a prayer or process clause.", severity: "high" }
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
    draftType: type,
    inferredDraftType: inferredType || type
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

function sanitizeFilingPackOutput(response = null, { payload = {}, localSnapshot = null, draftValidation = null } = {}) {
  const blockers = Array.isArray(response?.blockers) ? response.blockers : [];
  const warnings = Array.isArray(response?.warnings) ? response.warnings : [];
  const draftExists = Boolean(String(payload?.draftText || "").trim());
  const validationAvailable = Number(draftValidation?.validationScore || 0) > 0;
  const combinedSignals = [...blockers, ...warnings].map((item) => String(item || "").toLowerCase());
  const contradictoryDraftSignal = combinedSignals.some((item) => (
    /draft validation cannot run|draft text isn'?t available|draft text is not available|draft unavailable|no draft text|draft text missing|missing section before filing: draft text|draft.*missing/i.test(item)
  ));
  const remoteDraftValidationScore = Number(response?.componentScores?.draftValidation || 0);
  const contradictoryValidationScore = validationAvailable && remoteDraftValidationScore > 0
    ? remoteDraftValidationScore + 20 < Number(draftValidation?.validationScore || 0)
    : false;

  if (draftExists && validationAvailable && (contradictoryDraftSignal || contradictoryValidationScore) && localSnapshot) {
    return localSnapshot;
  }

  return response || localSnapshot;
}

function deriveRoleAccess(account = null) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  return {
    public: roles.includes("public"),
    lawyer: roles.includes("lawyer"),
    senior: roles.includes("senior"),
    firm: roles.includes("firm")
  };
}

function selectSeniorReviewItem(reviewQueue = [], selectedMatterId = "", selectedSeniorReviewKey = "") {
  if (!Array.isArray(reviewQueue) || !reviewQueue.length) return null;
  const exactReview = reviewQueue.find((item) => `${item.entityType}:${item.entityKey}` === selectedSeniorReviewKey);
  if (exactReview) return exactReview;
  const exactMatter = reviewQueue.find((item) => item.matterId === selectedMatterId);
  return exactMatter || reviewQueue[0];
}

function buildResearchPromptFromIntake(intakeOutput = null, intakeChronology = []) {
  if (!intakeOutput) return "";
  return [
    `Matter: ${intakeOutput.matterTitle || "New matter"}`,
    intakeOutput.clientSummary ? `Client Summary:\n${intakeOutput.clientSummary}` : "",
    intakeOutput.factSummary ? `Fact Summary:\n${intakeOutput.factSummary}` : "",
    intakeOutput.legalIssues?.length ? `Legal Issues:\n- ${intakeOutput.legalIssues.join("\n- ")}` : "",
    intakeChronology.length ? `Chronology:\n${intakeChronology.map((item) => `${item.date || "No date"} - ${item.event}`).join("\n")}` : "",
    intakeOutput.documentsRequired?.length ? `Documents Required:\n- ${intakeOutput.documentsRequired.join("\n- ")}` : ""
  ].filter(Boolean).join("\n\n");
}

function dedupeStrings(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index);
}

function truncateWorkspaceText(value = "", limit = 12000) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated]`;
}

function buildWorkspaceResearchText({
  intakeOutput = null,
  intakeChronology = [],
  chronologyText = "",
  caseNotes = "",
  intakeFacts = "",
  lawyerInput = "",
  selectedMatter = null,
  selectedMatterClient = null,
  selectedClient = null,
  caseTitle = ""
} = {}) {
  const intakePrompt = buildResearchPromptFromIntake(intakeOutput, intakeChronology);
  if (intakePrompt) {
    return intakePrompt;
  }

  return [
    selectedMatter?.title || caseTitle ? `Matter: ${selectedMatter?.title || caseTitle}` : "",
    selectedMatterClient?.name || selectedClient?.name ? `Client: ${selectedMatterClient?.name || selectedClient?.name}` : "",
    caseNotes ? `Matter Notes:\n${caseNotes}` : "",
    intakeFacts ? `Raw Intake Facts:\n${intakeFacts}` : "",
    chronologyText ? `Chronology:\n${chronologyText}` : "",
    lawyerInput ? `Current Notes:\n${lawyerInput}` : ""
  ].filter(Boolean).join("\n\n").trim();
}

function buildSharedWorkspaceState({
  lawyerTab = "research",
  lawyerInput = "",
  docText = "",
  lawyerOutput = null,
  intakeOutput = null,
  intakeChronology = [],
  chronologyText = "",
  caseNotes = "",
  intakeFacts = "",
  memoOutput = null,
  noticeOutput = null,
  selectedMatter = null,
  selectedMatterClient = null,
  selectedClient = null,
  caseTitle = "",
  caseStage = "",
  draftType = "",
  hearingNotes = "",
  relatedJudgments = [],
  selectedArgumentCases = [],
  copilotSessionData = null
} = {}) {
  const currentText = String(lawyerTab === "document" ? docText : lawyerInput || "").trim();
  const researchText = truncateWorkspaceText(buildWorkspaceResearchText({
    intakeOutput,
    intakeChronology,
    chronologyText,
    caseNotes,
    intakeFacts,
    lawyerInput,
    selectedMatter,
    selectedMatterClient,
    selectedClient,
    caseTitle
  }), 12000);
  const factsSummary = truncateWorkspaceText(
    intakeOutput?.factSummary || caseNotes || currentText || intakeFacts || researchText,
    6000
  );
  const chronologyValue = truncateWorkspaceText(
    intakeChronology.map((item) => `${item.date || "No date"} - ${item.event || ""}`).join("\n") || chronologyText || "",
    3000
  );
  const draftText = truncateWorkspaceText(lawyerOutput?.draft || noticeOutput?.noticeDraft || "", 15000);
  const authoritySnapshot = normalizeWorkspaceSnapshot({ facts: factsSummary, output: lawyerOutput });
  const workspaceAuthorities = dedupeStrings([
    ...authoritySnapshot.visibleAuthorityLabels,
    ...((memoOutput?.bestCases || []).map((item) => formatAuthorityLabel(item))),
    ...((selectedArgumentCases || []).map((item) => formatAuthorityLabel(item))),
    ...((relatedJudgments || []).map((item) => formatAuthorityLabel(item)))
  ]).slice(0, 24);
  const issues = dedupeStrings([
    ...(Array.isArray(intakeOutput?.legalIssues) ? intakeOutput.legalIssues : []),
    ...(Array.isArray(memoOutput?.issueList) ? memoOutput.issueList : []),
    ...(Array.isArray(lawyerOutput?.legalIssues) ? lawyerOutput.legalIssues : [])
  ]).slice(0, 8);
  const matterTitle = String(selectedMatter?.title || intakeOutput?.matterTitle || caseTitle || "").trim();
  const clientLabel = String(selectedMatterClient?.name || selectedClient?.name || "").trim();
  const documentType = String(
    lawyerTab === "notice"
      ? "notice"
      : lawyerTab === "draft"
        ? draftType || "complaint"
        : lawyerTab === "document"
          ? "memo"
          : lawyerTab === "draft-validation" || lawyerTab === "filing-pack"
            ? draftType || ""
            : copilotSessionData?.session?.activeDocumentType || copilotSessionData?.memory?.documentType || ""
  ).trim();
  const workspaceSummary = truncateWorkspaceText([
    matterTitle ? `Matter: ${matterTitle}` : "",
    clientLabel ? `Client: ${clientLabel}` : "",
    factsSummary ? `Facts Summary:\n${factsSummary}` : researchText ? `Research Intake:\n${researchText}` : "",
    issues.length ? `Issues:\n- ${issues.join("\n- ")}` : "",
    chronologyValue ? `Chronology:\n${chronologyValue}` : "",
    hearingNotes ? `Hearing Notes:\n${hearingNotes}` : "",
    workspaceAuthorities.length ? `Visible Authorities:\n- ${workspaceAuthorities.join("\n- ")}` : ""
  ].filter(Boolean).join("\n\n"), 12000);

  return {
    activeTab: lawyerTab,
    currentText,
    researchText,
    factsSummary,
    chronologyText: chronologyValue,
    draftText,
    issues,
    workspaceSummary,
    workspaceAuthorities,
    matterTitle,
    clientLabel,
    jurisdiction: String(selectedMatter?.court || selectedMatter?.forum || "").trim() || "India",
    stage: String(selectedMatter?.stage || caseStage || lawyerTab || "").trim() || null,
    documentType: documentType || null,
    reliefSought: String(selectedMatter?.notes || caseNotes || "").trim()
  };
}

function buildCopilotIntakePayloadFromWorkspace(workspaceState = {}) {
  return {
    caseType: workspaceState.matterTitle || null,
    factsSummary: workspaceState.factsSummary || "",
    issues: Array.isArray(workspaceState.issues) ? workspaceState.issues : [],
    jurisdiction: workspaceState.jurisdiction || "India",
    stage: workspaceState.stage || null,
    documentType: workspaceState.documentType || null,
    parties: {
      claimant: workspaceState.clientLabel || "",
      respondent: ""
    },
    reliefSought: workspaceState.reliefSought || "",
    workspaceSummary: workspaceState.workspaceSummary || "",
    workspaceAuthorities: Array.isArray(workspaceState.workspaceAuthorities) ? workspaceState.workspaceAuthorities : [],
    workspaceDraft: workspaceState.draftText || "",
    workspaceTab: workspaceState.activeTab || ""
  };
}

function buildWorkspaceForwardMessage({ label = "Current workspace", value = "", workspaceState = {} } = {}) {
  const rawText = String(value || "").trim();
  const fallbackText = rawText
    || (label === "Matter facts" ? (workspaceState.factsSummary || workspaceState.researchText || workspaceState.workspaceSummary) : "")
    || (label === "Current draft" ? workspaceState.draftText : "")
    || (label === "Current references" ? (workspaceState.workspaceAuthorities || []).join("\n") : "")
    || workspaceState.currentText
    || workspaceState.workspaceSummary
    || workspaceState.factsSummary;
  const text = truncateWorkspaceText(fallbackText, 16000);

  if (!text) return "";
  return `${label}:\n${text}`;
}

function withSourceKey(output = null, sourceKey = "") {
  if (!output) return output;
  return {
    ...output,
    sourceKey
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

  if (normalizedType === "complaint") {
    return {
      draft:
`IN THE COURT OF THE HON'BLE [COURT NAME]
${normalizedMode === "editable" ? "[JURISDICTION TO BE INSERTED]" : "AT [JURISDICTION TO BE CONFIRMED]"}

COMPLAINT UNDER SECTION [STATUTORY PROVISION TO BE VERIFIED]

[COMPLAINANT NAME]
Complainant

VERSUS

[ACCUSED NAME]
Accused

MOST RESPECTFULLY SHOWETH:

FACTS OF THE CASE
${factBlock}

LEGAL BASIS
${generalSections.map((item, index) => `${index + 1}. ${item}.`).join("\n")}

CAUSE OF ACTION
The acts and omissions stated above give rise to the present complaint and require legal process in accordance with law.

PRAYER
${normalizedMode === "editable"
  ? "[PRAYER / PROCESS CLAUSE TO BE INSERTED]"
  : "It is therefore prayed that this Hon'ble Court may be pleased to take cognizance / issue appropriate process and grant consequential relief in accordance with law."}

PLACE:
DATE:

COUNSEL FOR THE COMPLAINANT
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
  const voiceRecognitionRef = useRef(null);
  const reviewRecordsRef = useRef([]);

  const account = getStoredAccount();
  const publicProfile = getStoredProfile("public");
  const lawyerProfile = getStoredProfile("lawyer");

  const queryMode = searchParams.get("mode");
  const normalizeWorkspaceMode = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return ["public", "lawyer", "senior", "firm"].includes(normalized) ? normalized : "public";
  };
  const [mode, setMode] = useState(normalizeWorkspaceMode(queryMode));
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
  const [lastFilingPackAutoSyncKey, setLastFilingPackAutoSyncKey] = useState("");
  const [authorityGuardrails, setAuthorityGuardrails] = useState({ status: "CLEAR", blockingWarnings: [], cautionWarnings: [], reviewedAuthorities: [] });
  const [reviewRecords, setReviewRecords] = useState([]);
  const [reviewSnapshots, setReviewSnapshots] = useState([]);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewSyncMode, setReviewSyncMode] = useState("remote");
  const [firmActionHistory, setFirmActionHistory] = useState([]);
  const [firmQueueFilter, setFirmQueueFilter] = useState("all");
  const [firmQueueSort, setFirmQueueSort] = useState("priority");
  const [noticeOutput, setNoticeOutput] = useState(null);
  const [lawyerExtractionMeta, setLawyerExtractionMeta] = useState(null);
  const [lawyerOutput, setLawyerOutput] = useState(null);
  const [copilotChatOpen, setCopilotChatOpen] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState([
    {
      id: "copilot-welcome",
      role: "assistant",
      text: "Law related ga em kavalo direct ga adugu. Nenu straight ga reply istha."
    }
  ]);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotAttachmentMeta, setCopilotAttachmentMeta] = useState(null);
  const [copilotSessionId, setCopilotSessionId] = useState("");
  const [copilotSessionData, setCopilotSessionData] = useState(null);
  const [copilotAllowedActions, setCopilotAllowedActions] = useState([]);
  const [copilotSessionBusy, setCopilotSessionBusy] = useState(false);
  const [copilotDraftMeta, setCopilotDraftMeta] = useState(null);
  const [copilotBackendUnavailable, setCopilotBackendUnavailable] = useState(false);

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
  const [selectedSeniorReviewKey, setSelectedSeniorReviewKey] = useState("");
  const [chronologyText, setChronologyText] = useState("");
  const [hearingNotes, setHearingNotes] = useState("");

  const ownerId = account?.uid || "anonymous";
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
  const sharedWorkspaceState = useMemo(() => buildSharedWorkspaceState({
    lawyerTab,
    lawyerInput,
    docText,
    lawyerOutput,
    intakeOutput,
    intakeChronology,
    chronologyText,
    caseNotes,
    intakeFacts,
    memoOutput,
    noticeOutput,
    selectedMatter,
    selectedMatterClient,
    selectedClient,
    caseTitle,
    caseStage,
    draftType,
    hearingNotes,
    relatedJudgments,
    copilotSessionData
  }), [
    lawyerTab,
    lawyerInput,
    docText,
    lawyerOutput,
    intakeOutput,
    intakeChronology,
    chronologyText,
    caseNotes,
    intakeFacts,
    memoOutput,
    noticeOutput,
    selectedMatter,
    selectedMatterClient,
    selectedClient,
    caseTitle,
    caseStage,
    draftType,
    hearingNotes,
    relatedJudgments,
    copilotSessionData
  ]);
  const copilotContext = useMemo(() => ({
    facts: sharedWorkspaceState.factsSummary || sharedWorkspaceState.researchText,
    draft: sharedWorkspaceState.draftText,
    output: lawyerOutput,
    tab: lawyerTab
  }), [sharedWorkspaceState.draftText, sharedWorkspaceState.factsSummary, sharedWorkspaceState.researchText, lawyerOutput, lawyerTab]);
  const showCopilotStarters = copilotMessages.length <= 1;

  const hasRole = useMemo(() => deriveRoleAccess(account), [account]);

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
  const copilotContextPacket = useMemo(
    () => copilotSessionData?.memory?.contextPacket || { sections: [], judgments: [], authoritiesSummary: "" },
    [copilotSessionData]
  );
  const copilotIntakePayload = useMemo(
    () => buildCopilotIntakePayloadFromWorkspace(sharedWorkspaceState),
    [sharedWorkspaceState]
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
  const filteredAuditLogs = useMemo(() => filterAuditLogs(auditLogs, auditFilter), [auditFilter, auditLogs]);
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
  const draftValidationStateKey = useMemo(() => JSON.stringify({
    draft: sharedWorkspaceState.draftText || sharedWorkspaceState.currentText || "",
    facts: sharedWorkspaceState.factsSummary || "",
    issues: sharedWorkspaceState.issues.join("|"),
    draftType,
    courtType: draftCourtType
  }), [
    sharedWorkspaceState.currentText,
    sharedWorkspaceState.draftText,
    sharedWorkspaceState.factsSummary,
    sharedWorkspaceState.issues,
    draftType,
    draftCourtType
  ]);
  const filingPackAutoSyncKey = useMemo(() => JSON.stringify({
    tab: lawyerTab,
    facts: sharedWorkspaceState.factsSummary || "",
    draft: sharedWorkspaceState.draftText || "",
    issues: sharedWorkspaceState.issues.join("|"),
    validation: draftValidationOutput?.validationScore || 0,
    readiness: readinessOutput?.readinessScore || 0,
    consistency: consistencyOutput?.consistencyScore || 0,
    coverage: coverageOutput?.coverageScore || 0,
    chronology: sharedWorkspaceState.chronologyText || "",
    selectedCases: selectedArgumentCases.map((item) => item?.canonicalCaseId || item?.id || item?.citation || item?.title || "").join("|")
  }), [
    lawyerTab,
    sharedWorkspaceState.factsSummary,
    sharedWorkspaceState.draftText,
    sharedWorkspaceState.issues,
    sharedWorkspaceState.chronologyText,
    draftValidationOutput,
    readinessOutput,
    consistencyOutput,
    coverageOutput,
    selectedArgumentCases
  ]);
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
  const reviewQueue = useMemo(() => buildReviewQueue(reviewRecords, cases), [cases, reviewRecords]);
  const reviewQueueSummary = useMemo(() => buildReviewQueueSummary(reviewQueue), [reviewQueue]);
  const firmDashboard = useMemo(
    () => buildFirmDashboard({ reviewRecords, reviewSnapshots, cases, tasks, auditLogs, firmActionHistory }),
    [reviewRecords, reviewSnapshots, cases, tasks, auditLogs, firmActionHistory]
  );
  const seniorSelectedReview = useMemo(
    () => selectSeniorReviewItem(reviewQueue, selectedMatterId, selectedSeniorReviewKey),
    [reviewQueue, selectedMatterId, selectedSeniorReviewKey]
  );
  const firmSelectedReview = useMemo(
    () => selectSeniorReviewItem(reviewQueue, selectedMatterId, selectedSeniorReviewKey),
    [reviewQueue, selectedMatterId, selectedSeniorReviewKey]
  );
  const firmSelectedReviewStateKey = firmSelectedReview ? `${firmSelectedReview.entityType}:${firmSelectedReview.entityKey}` : "";
  const firmSelectedDraft = firmSelectedReviewStateKey ? (reviewDrafts[firmSelectedReviewStateKey] || {}) : {};
  const firmSelectedStatusPresentation = useMemo(
    () => buildReviewStatusPresentation(firmSelectedReview?.status || "ai_draft"),
    [firmSelectedReview?.status]
  );
  const filteredFirmAttentionItems = useMemo(
    () => buildFirmQueueView(reviewQueue, firmDashboard.attentionItems, { filter: firmQueueFilter, sort: firmQueueSort }),
    [reviewQueue, firmDashboard.attentionItems, firmQueueFilter, firmQueueSort]
  );
  const seniorReviewFacts = useMemo(() => buildSeniorReviewFacts(seniorSelectedReview), [seniorSelectedReview]);
  const seniorRiskFlags = useMemo(() => buildSeniorRiskFlags(seniorSelectedReview), [seniorSelectedReview]);
  const seniorRiskDetails = useMemo(
    () => buildReviewFindingReasons(seniorRiskFlags),
    [seniorRiskFlags]
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

    if (LOCAL_COPILOT_ONLY) {
      setAuthorityGuardrails({ status: "CLEAR", blockingWarnings: [], cautionWarnings: [], reviewedAuthorities: [] });
      return undefined;
    }

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

  useEffect(() => () => {
    if (voiceRecognitionRef.current) {
      try {
        voiceRecognitionRef.current.stop();
      } catch {
        // Ignore shutdown failures for speech-recognition cleanup.
      }
      voiceRecognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    const nextMode = normalizeWorkspaceMode(queryMode);
    if (nextMode === "lawyer" && mode !== "lawyer") {
      setLawyerTab("workflow");
      setCitationView(null);
      setCitationExpanded({});
    }
    setMode(nextMode);
  }, [mode, queryMode]);

  useEffect(() => {
    if ((mode === "lawyer" || mode === "senior" || mode === "firm") && (hasRole.lawyer || hasRole.senior || hasRole.firm)) {
      if (LOCAL_COPILOT_ONLY) {
        setStatus(
          mode === "senior"
            ? "Local senior review mode is ready."
            : mode === "firm"
              ? "Local firm command mode is ready."
              : "Local copilot-only mode is ready."
        );
        return;
      }
      hydrateLawyerData();
    }
    if (mode === "public" && hasRole.public) {
      setStatus("Public legal guidance mode is ready.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hasRole.firm, hasRole.lawyer, hasRole.public, hasRole.senior]);

  useEffect(() => {
    if ((mode === "lawyer" || mode === "senior" || mode === "firm") && (hasRole.lawyer || hasRole.senior || hasRole.firm)) {
      if (LOCAL_COPILOT_ONLY) return;
      hydrateLawyerData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgmentQuery, judgmentCourt, judgmentStatus, judgmentDateWindow, mode, hasRole.firm, hasRole.lawyer, hasRole.senior]);

  useEffect(() => {
    const loadRelatedJudgments = async () => {
      if (LOCAL_COPILOT_ONLY) {
        setRelatedJudgments([]);
        return;
      }
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
        setRelatedJudgments(buildLocalJudgmentMatches({ intakeOutput, memoOutput }));
      }
    };

    loadRelatedJudgments();
  }, [hasRole.lawyer, intakeOutput, judgmentContextText, memoOutput, mode, ownerId]);

  const hydrateLawyerData = async () => {
    if (LOCAL_COPILOT_ONLY) {
      setClients([]);
      setCases([]);
      setTasks([]);
      setJudgments([]);
      setReviewRecords([]);
      setReviewSnapshots([]);
      setJudgmentSyncStatus(null);
      setJudgmentSources([]);
      setSubscription(null);
      setBillingConfig({ enabled: false, keyId: "" });
      setSavedMemories([]);
      setSavedDrafts([]);
      setStatus("Local copilot-only mode is ready.");
      return;
    }

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
      const normalizedReviews = reviewsResponse.reviews || [];
      const normalizedSnapshots = snapshotsResponse.snapshots?.length
        ? snapshotsResponse.snapshots
        : buildApprovedSnapshotsFromReviews(normalizedReviews);

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
      setReviewRecords(normalizedReviews);
      setReviewSnapshots(normalizedSnapshots);
      setBillingConfig({
        enabled: Boolean(billingResponse.enabled),
        keyId: billingResponse.keyId || ""
      });
      const failedCount = results.filter((item) => item.status === "rejected").length;
      const mainWorkspaceReady = [0, 1, 2, 8, 9, 10].every((index) => results[index]?.status === "fulfilled");
      if (mainWorkspaceReady) {
        setStatus(failedCount ? "Lawyer workspace loaded. Some optional panels could not be refreshed." : "Lawyer workspace loaded.");
      } else {
        setStatus("Lawyer workspace loaded in local fallback mode.");
      }
    } catch {
      setStatus("Lawyer workspace loaded in local fallback mode.");
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

  useEffect(() => {
    reviewRecordsRef.current = Array.isArray(reviewRecords) ? reviewRecords : [];
  }, [reviewRecords]);

  useEffect(() => {
    if (!ownerId) return;
    setReviewDrafts(readLocalReviewDrafts(ownerId));
    const persistedSelection = readLocalSeniorSelection(ownerId);
    setFirmActionHistory(readLocalFirmActions(ownerId));
    const persistedFirmPreferences = readLocalFirmPreferences(ownerId);
    setFirmQueueFilter(persistedFirmPreferences.firmQueueFilter);
    setFirmQueueSort(persistedFirmPreferences.firmQueueSort);
    setSelectedSeniorReviewKey(persistedSelection.selectedSeniorReviewKey);
    setSelectedMatterId((current) => current || persistedSelection.selectedMatterId || "");
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId) return;
    writeLocalReviewDrafts(ownerId, reviewDrafts);
  }, [ownerId, reviewDrafts]);

  useEffect(() => {
    if (!ownerId) return;
    writeLocalSeniorSelection(ownerId, { selectedMatterId, selectedSeniorReviewKey });
  }, [ownerId, selectedMatterId, selectedSeniorReviewKey]);

  useEffect(() => {
    if (!ownerId) return;
    writeLocalFirmActions(ownerId, firmActionHistory);
  }, [ownerId, firmActionHistory]);

  useEffect(() => {
    if (!ownerId) return;
    writeLocalFirmPreferences(ownerId, { firmQueueFilter, firmQueueSort });
  }, [ownerId, firmQueueFilter, firmQueueSort]);

  const appendFirmAction = useCallback((entry = {}) => {
    if (!ownerId) return;
    setFirmActionHistory((current) => ([
      {
        id: entry.id || `${entry.action || "firm-action"}:${Date.now()}`,
        createdAt: entry.createdAt || new Date().toISOString(),
        actor: entry.actor || account?.name || lawyerProfile?.name || "Firm User",
        ...entry
      },
      ...(current || [])
    ].slice(0, 40)));
  }, [account?.name, lawyerProfile?.name, ownerId]);

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

  const upsertReviewRecordLocally = useCallback((review) => {
    if (!review?.entityType || !review?.entityKey) return review;
    setReviewRecords((current) => {
      const others = (current || []).filter((item) => !(item.entityType === review.entityType && item.entityKey === review.entityKey));
      const next = [review, ...others];
      writeLocalReviews(ownerId, next);
      return next;
    });
    return review;
  }, [ownerId]);

  const saveReviewRecord = async ({ entityType, entityKey, entityLabel, output, status: nextStatus, draftOverrides = null }) => {
    const stateKey = `${entityType}:${entityKey}`;
    const draft = {
      ...(reviewDrafts[stateKey] || {}),
      ...(draftOverrides || {})
    };
    const existingReview = getReviewRecord(entityType, entityKey);
    const approvalRole = String(draft.approvalRole || "").trim().toLowerCase();

    if (!canApproveReview({ nextStatus, approvalRole })) {
      setStatus("Select an approval role before marking this output as approved.");
      return;
    }

      const payload = buildReviewRecordPayload({
        ownerId,
        selectedMatterId,
        selectedMatter,
        caseTitle,
        entityType,
        entityKey,
        entityLabel,
        status: nextStatus,
        approvalRole,
      reviewerName: draft.reviewerName || account?.displayName || lawyerProfile?.name || "Lawyer",
      reviewNotes: draft.reviewNotes || "",
      reviewFindings: draft.reviewFindings || "",
      assignedReviewer: draft.assignedReviewer || existingReview?.assignedReviewer || "",
      escalationLevel: draft.escalationLevel || existingReview?.escalationLevel || "routine",
      partnerStatus: draft.partnerStatus || existingReview?.partnerStatus || (nextStatus === "approved" && approvalRole === "partner" ? "partner_approved" : "pending"),
      output
    });

    const fallbackReview = {
      ...payload,
      id: `${entityType}:${entityKey}`,
      updatedAt: new Date().toISOString()
    };

    const persistLocalReview = () => {
      upsertReviewRecordLocally(fallbackReview);
      setReviewDrafts((current) => ({
        ...current,
        [stateKey]: {
          reviewerName: fallbackReview.reviewerName || payload.reviewerName || "",
          reviewNotes: fallbackReview.reviewNotes || payload.reviewNotes || "",
          reviewFindings: Array.isArray(fallbackReview.reviewFindings) ? fallbackReview.reviewFindings.join("\n") : payload.reviewFindings.join("\n"),
          approvalRole: fallbackReview.approvalRole || approvalRole || "",
          assignedReviewer: fallbackReview.assignedReviewer || payload.assignedReviewer || "",
          escalationLevel: fallbackReview.escalationLevel || payload.escalationLevel || "routine",
          partnerStatus: fallbackReview.partnerStatus || payload.partnerStatus || "pending"
        }
      }));
      appendFirmAction({
        action: nextStatus === "approved" ? "review_approved" : nextStatus === "reviewed" ? "review_routed" : "review_saved_local",
        entityType,
        entityKey,
        entityLabel,
        status: nextStatus,
        assignedReviewer: fallbackReview.assignedReviewer || payload.assignedReviewer || "",
        escalationLevel: fallbackReview.escalationLevel || payload.escalationLevel || "routine",
        partnerStatus: fallbackReview.partnerStatus || payload.partnerStatus || "pending"
      });
      if (nextStatus === "approved") {
        const localSnapshot = buildReviewSnapshotRecord(fallbackReview, output);
        setReviewSnapshots((current) => upsertReviewSnapshotList(current, localSnapshot));
      }
      setStatus(`Review saved locally: ${nextStatus.replace("_", " ").toUpperCase()}.`);
    };

    if (reviewSyncMode === "local") {
      persistLocalReview();
      return;
    }

    try {
      const response = await saveLegalReview(payload);
      const review = response.review || payload;
      setReviewRecords((current) => {
        const others = (current || []).filter((item) => !(item.entityType === entityType && item.entityKey === entityKey));
        const next = [review, ...others];
        writeLocalReviews(ownerId, next);
        return next;
      });
      setReviewDrafts((current) => ({
        ...current,
        [stateKey]: {
          reviewerName: review.reviewerName || payload.reviewerName || "",
          reviewNotes: review.reviewNotes || payload.reviewNotes || "",
          reviewFindings: Array.isArray(review.reviewFindings) ? review.reviewFindings.join("\n") : payload.reviewFindings.join("\n"),
          approvalRole: review.approvalRole || approvalRole || "",
          assignedReviewer: review.assignedReviewer || payload.assignedReviewer || "",
          escalationLevel: review.escalationLevel || payload.escalationLevel || "routine",
          partnerStatus: review.partnerStatus || payload.partnerStatus || "pending"
        }
      }));
      appendFirmAction({
        action: nextStatus === "approved" ? "review_approved" : nextStatus === "reviewed" ? "review_routed" : "review_saved",
        entityType,
        entityKey,
        entityLabel,
        status: nextStatus,
        assignedReviewer: review.assignedReviewer || payload.assignedReviewer || "",
        escalationLevel: review.escalationLevel || payload.escalationLevel || "routine",
        partnerStatus: review.partnerStatus || payload.partnerStatus || "pending"
      });
      setStatus(`Review status updated: ${nextStatus.replace("_", " ").toUpperCase()}.`);
      if (nextStatus === "approved") {
        const snapshotResponse = await listLegalReviewSnapshots({ ownerId, matterId: selectedMatterId || selectedMatter?.id || "" }).catch(() => null);
        if (snapshotResponse?.snapshots) {
          setReviewSnapshots(snapshotResponse.snapshots);
        } else {
          const localSnapshot = buildReviewSnapshotRecord(review, output);
          setReviewSnapshots((current) => upsertReviewSnapshotList(current, localSnapshot));
        }
      }
    } catch {
      setReviewSyncMode("local");
      persistLocalReview();
    }
  };

  const autoUpsertReviewRecord = useCallback(async ({
    entityType,
    entityKey,
    entityLabel,
    output,
    status = "ai_draft",
    reviewNotes = "",
    reviewFindings = [],
    draftVersionLabel = ""
  }) => {
    if (!entityType || !entityKey || !output) return;

    const existing = (reviewRecordsRef.current || []).find((item) => item.entityType === entityType && item.entityKey === entityKey) || null;
    const inferredDraftVersionLabel = draftVersionLabel || (() => {
      if (!["draft_output", "draft_validation", "filing_pack"].includes(entityType)) return "";
      const matchingDrafts = (savedDrafts || []).filter((item) => {
        const sameMatter = String(item.relatedCaseId || "").trim() === String(selectedMatterId || selectedMatter?.id || "").trim();
        const sameType = String(item.draftType || "").trim().toLowerCase() === String(draftType || "").trim().toLowerCase();
        return sameMatter && sameType;
      });
      return matchingDrafts.length ? `v${matchingDrafts.length}` : "v1";
    })();
    const normalizedStatus = String(existing?.status || status || "ai_draft").trim().toLowerCase();
    const normalizedFindings = Array.isArray(reviewFindings)
      ? reviewFindings.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    const payload = buildReviewRecordPayload({
      ownerId,
      selectedMatterId,
      selectedMatter,
      caseTitle,
      entityType,
      entityKey,
      entityLabel,
      draftVersionLabel: existing?.draftVersionLabel || inferredDraftVersionLabel,
      status: normalizedStatus === "approved" ? "reviewed" : normalizedStatus,
      approvalRole: existing?.approvalRole || "",
      reviewerName: existing?.reviewerName || account?.displayName || lawyerProfile?.name || "Lawyer",
      reviewNotes: existing?.reviewNotes || reviewNotes || "",
      reviewFindings: existing?.reviewFindings?.length ? existing.reviewFindings : normalizedFindings,
      output
    });

    const fallbackReview = {
      ...payload,
      id: `${entityType}:${entityKey}`,
      updatedAt: new Date().toISOString()
    };

    if (reviewSyncMode === "local") {
      upsertReviewRecordLocally(fallbackReview);
      return;
    }

    try {
      const response = await saveLegalReview(payload);
      const review = response.review || payload;
      setReviewRecords((current) => {
        const others = (current || []).filter((item) => !(item.entityType === entityType && item.entityKey === entityKey));
        const next = [review, ...others];
        writeLocalReviews(ownerId, next);
        return next;
      });
    } catch {
      setReviewSyncMode("local");
      upsertReviewRecordLocally(fallbackReview);
    }
  }, [
    account?.displayName,
    caseTitle,
    draftType,
    lawyerProfile?.name,
    ownerId,
    reviewSyncMode,
    upsertReviewRecordLocally,
    savedDrafts,
    selectedMatter,
    selectedMatterId
  ]);

  const renderReviewWorkflow = ({ entityType, entityKey, entityLabel, output }) => {
    if (!entityType || !entityKey || !output) return null;
    const review = getReviewRecord(entityType, entityKey);
    const draftState = reviewDrafts[`${entityType}:${entityKey}`] || {};
    const statusPresentation = buildReviewStatusPresentation(review?.status || "ai_draft");
    const effectiveApprovalRole = String(draftState.approvalRole ?? review?.approvalRole ?? "").trim().toLowerCase();

    return (
      <div className="law-card review-workflow-card">
        <div className="review-workflow-header">
          <div>
            <h4 style={{ marginBottom: 6 }}>Review Workflow</h4>
            <div className="muted-copy">Mark this output as reviewed or approved with lawyer notes.</div>
          </div>
          <span className="status-chip" style={statusPresentation.style}>{statusPresentation.label}</span>
        </div>
        <div className="review-workflow-grid">
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
            <span>Risk Flags / Missing Items</span>
            <textarea
              rows={3}
              value={draftState.reviewFindings ?? (Array.isArray(review?.reviewFindings) ? review.reviewFindings.join("\n") : "")}
              onChange={(event) => updateReviewDraft(entityType, entityKey, { reviewFindings: event.target.value })}
              placeholder="One point per line: missing fact, weak citation, risky statement, filing gap..."
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
          <label className="law-field">
            <span>Current Review Status</span>
            <select
              value={String(review?.status || "ai_draft").toLowerCase()}
              onChange={(event) => saveReviewRecord({ entityType, entityKey, entityLabel, output, status: event.target.value })}
            >
              {REVIEW_STATUS_OPTIONS.map((item) => (
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
        {Array.isArray(review?.reviewFindings) && review.reviewFindings.length ? (
          <div className="muted-copy" style={{ marginTop: 10 }}>
            Current flagged items: {review.reviewFindings.join(" | ")}
          </div>
        ) : null}
      </div>
    );
  };

  const renderReviewSnapshots = (snapshotList = reviewSnapshots) => {
    if (!snapshotList.length) {
      return <p className="muted-copy">No approved output snapshots yet.</p>;
    }

    return (
      <div className="law-list-block">
        <h4>Approved Output Snapshots</h4>
        <ul>
          {snapshotList.slice(0, 12).map((item) => {
            const traceSummary = buildSnapshotTraceSummary(item);
            return (
              <li key={item.id || `${item.entityType}-${item.entityKey}`}>
                <strong>{item.entityLabel || item.entityType || "Output"}</strong>
                {item.reviewerName ? ` | Reviewer: ${item.reviewerName}` : ""}
                {item.approvalRole ? ` | Approval role: ${String(item.approvalRole).replace(/_/g, " ")}` : ""}
                {item.outputSummary ? <div className="muted-copy" style={{ marginTop: "4px" }}>{item.outputSummary}</div> : null}
                {traceSummary.hasTrace ? (
                  <details style={{ marginTop: "6px" }}>
                    <summary>View source snapshot</summary>
                    <div className="muted-copy">Facts: {traceSummary.factsLine}</div>
                    <div className="muted-copy">Documents: {traceSummary.documentsLine}</div>
                    <div className="muted-copy">Authorities: {traceSummary.authoritiesLine}</div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderSeniorReviewWorkspace = () => (
    <section className="law-grid law-grid-lawyer">
      <aside className="soft-panel law-sidebar senior-review-sidebar">
        <div className="section-title">Senior Review Queue</div>
        <div className="law-plan-chip">
          {reviewQueueSummary.total} items | {reviewQueueSummary.needsRevision} need revision
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Priority Review Items</div>
          {reviewQueue.length ? (
            <ul>
              {reviewQueue.slice(0, 8).map((item) => {
                const isSelected = `${item.entityType}:${item.entityKey}` === `${seniorSelectedReview?.entityType}:${seniorSelectedReview?.entityKey}`;
                return (
                <li
                  key={item.id}
                  className={`law-alert-item senior-review-queue-item ${item.reviewStatus === "approved" ? "ok" : item.reviewStatus === "reviewed" ? "warning" : "danger"}`}
                  style={isSelected ? { border: "1px solid #2d7ff9", boxShadow: "0 0 0 2px rgba(45,127,249,0.12)" } : undefined}
                >
                  <strong>{item.entityLabel || item.entityType || "Output"}</strong>
                  <div className="muted-copy">{item.matterLabel}</div>
                  {item.draftVersionLabel ? <div>Version: {item.draftVersionLabel}</div> : null}
                  <div className="senior-review-queue-status">Status: {String(item.reviewStatus).replace(/_/g, " ")}</div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setSelectedMatterId(item.matterId || "");
                      setSelectedSeniorReviewKey(`${item.entityType}:${item.entityKey}`);
                    }}
                  >
                    Open review
                  </button>
                </li>
              )})}
            </ul>
          ) : (
            <p className="muted-copy">No review records yet. Associate outputs will start appearing here once saved into review workflow.</p>
          )}
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Approved Snapshots</div>
          <p className="muted-copy">{reviewSnapshots.length} approved records available for sign-off history.</p>
        </div>
      </aside>

      <div className="soft-panel senior-review-shell">
        <div className="section-title">Senior Review Workspace</div>
        <p className="muted-copy">Review-first view for validating junior output, flagging issues, and approving matter work product.</p>

        {seniorSelectedReview ? (
          <>
            <div className="law-extract-meta senior-review-meta">
              <div><strong>Matter:</strong> {seniorSelectedReview.matterLabel}</div>
              <div><strong>Output:</strong> {seniorSelectedReview.entityLabel || seniorSelectedReview.entityType || "Output"}</div>
              <div><strong>Status:</strong> {String(seniorSelectedReview.reviewStatus).replace(/_/g, " ")}</div>
              <div><strong>Reviewer:</strong> {seniorSelectedReview.reviewerName || "Not assigned"}</div>
            </div>

            <div className="senior-review-summary-grid">
              <div className="law-card">
                <div className="senior-review-card-label">Matter Context</div>
                <h4>Matter Summary</h4>
                <p className="muted-copy">{seniorSelectedReview.matter?.notes || seniorSelectedReview.outputSummary || "No matter summary available yet."}</p>
                <h4>Key Facts</h4>
                <ul>{renderList(seniorReviewFacts)}</ul>
              </div>

              <div className="law-card">
                <div className="senior-review-card-label">Review Record</div>
                <h4>Review Notes</h4>
                <p className="muted-copy">{seniorSelectedReview.reviewNotes || "No internal review note saved yet."}</p>
                <h4>Output Summary</h4>
                <p>{seniorSelectedReview.outputSummary || "No output summary available yet."}</p>
                {seniorSelectedReview.draftVersionLabel ? <p className="muted-copy">Current version: {seniorSelectedReview.draftVersionLabel}</p> : null}
              </div>

              <div className="law-card">
                <div className="senior-review-card-label">Decision Signals</div>
                <h4>Risk Flags</h4>
                <ul className="senior-review-risk-list">
                  {seniorRiskDetails.length ? seniorRiskDetails.map((item) => (
                    <li key={item.title}>
                      <strong>{item.title}</strong>
                      <div className="muted-copy">{item.reason}</div>
                    </li>
                  )) : <li>No active risk flags.</li>}
                </ul>
                <div className="law-inline-actions senior-review-quick-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => saveReviewRecord({
                      entityType: seniorSelectedReview.entityType,
                      entityKey: seniorSelectedReview.entityKey,
                      entityLabel: seniorSelectedReview.entityLabel,
                      output: seniorSelectedReview,
                      status: "needs_revision"
                    })}
                  >
                    Send Back For Revision
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => saveReviewRecord({
                      entityType: seniorSelectedReview.entityType,
                      entityKey: seniorSelectedReview.entityKey,
                      entityLabel: seniorSelectedReview.entityLabel,
                      output: seniorSelectedReview,
                      status: "approved"
                    })}
                  >
                    Approve Output
                  </button>
                </div>
              </div>
            </div>

            <div className="senior-review-workflow-wrap">
              {renderReviewWorkflow({
                entityType: seniorSelectedReview.entityType,
                entityKey: seniorSelectedReview.entityKey,
                entityLabel: seniorSelectedReview.entityLabel || seniorSelectedReview.entityType || "Output",
                output: seniorSelectedReview
              })}
            </div>
          </>
        ) : (
          <p className="muted-copy">No review items available yet. Save any associate output into the review workflow and it will appear here.</p>
        )}
      </div>
    </section>
  );

  const renderFirmWorkspace = () => (
    <section className="law-grid law-grid-lawyer">
      <aside className="soft-panel law-sidebar senior-review-sidebar">
        <div className="section-title">Firm Command Center</div>
        <div className="law-plan-chip">
          {firmDashboard.metrics[0].value} matters | {firmDashboard.queueSummary.total} review items | {firmDashboard.approvedSnapshots.length} approved
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Urgent Deadlines</div>
          {firmDashboard.urgentDeadlines.length ? (
            <ul>
              {firmDashboard.urgentDeadlines.map((item) => (
                <li key={item.id} className={`law-alert-item senior-review-queue-item ${item.severity.type === "danger" ? "danger" : item.severity.type === "warning" ? "warning" : ""}`}>
                  <strong>{item.title}</strong>
                  <div className="muted-copy">{item.nextHearingDate || "No date set"}</div>
                  <div className="senior-review-queue-status">{item.severity.label}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">No urgent matter deadlines in the next 7 days.</p>
          )}
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Recent Sign-off History</div>
          <p className="muted-copy">{firmDashboard.approvedSnapshots.length} approved records available across the firm workspace.</p>
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Routing Pressure</div>
          <p className="muted-copy">Partner hold: {firmDashboard.routingSummary.partnerHold} | Senior review: {firmDashboard.routingSummary.seniorReview} | Urgent: {firmDashboard.routingSummary.urgent}</p>
        </div>
        <div className="law-alerts">
          <div className="law-alerts-title">Queue View</div>
          <div className="firm-filter-stack">
            <label className="law-field">
              <span>Filter</span>
              <select value={firmQueueFilter} onChange={(event) => setFirmQueueFilter(event.target.value)}>
                <option value="all">All attention items</option>
                <option value="urgent">Urgent only</option>
                <option value="partner_hold">Partner hold</option>
                <option value="assigned">Assigned reviews</option>
                <option value="approved">Approved items</option>
              </select>
            </label>
            <label className="law-field">
              <span>Sort</span>
              <select value={firmQueueSort} onChange={(event) => setFirmQueueSort(event.target.value)}>
                <option value="priority">Sort by priority</option>
                <option value="latest">Sort by latest</option>
                <option value="risk">Sort by risk count</option>
              </select>
            </label>
          </div>
        </div>
      </aside>

      <div className="soft-panel senior-review-shell">
        <div className="section-title">Firm Operations Workspace</div>
        <p className="muted-copy">Portfolio-wide view for review pressure, sign-off history, and near-term delivery risk.</p>

        <div className="firm-metric-grid">
          {firmDashboard.metrics.map((item) => (
            <div key={item.label} className={`law-card firm-metric-card ${item.tone}`}>
              <div className="senior-review-card-label">{item.label}</div>
              <strong className="firm-metric-value">{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="senior-review-summary-grid firm-summary-grid">
          <div className="law-card">
            <div className="senior-review-card-label">Review Pressure</div>
            <h4>Items Needing Attention</h4>
            {filteredFirmAttentionItems.length ? (
              <ul className="senior-review-risk-list">
                {filteredFirmAttentionItems.map((item) => (
                  <li key={`${item.entityType}:${item.entityKey}`}>
                    <strong>{item.entityLabel || item.entityType || "Output"}</strong>
                    <div className="muted-copy">{item.matterLabel}</div>
                    <div className="muted-copy">Status: {String(item.reviewStatus).replace(/_/g, " ")}</div>
                    {item.assignedReviewer ? <div className="muted-copy">Assigned: {item.assignedReviewer}</div> : null}
                    {item.escalationLevel && item.escalationLevel !== "routine" ? <div className="muted-copy">Escalation: {String(item.escalationLevel).replace(/_/g, " ")}</div> : null}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setSelectedMatterId(item.matterId || "");
                        setSelectedSeniorReviewKey(`${item.entityType}:${item.entityKey}`);
                      }}
                    >
                      Open routing
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted-copy">No high-pressure review items right now.</p>}
          </div>

          <div className="law-card">
            <div className="senior-review-card-label">Task Load</div>
            <h4>Pending Task Snapshot</h4>
            {firmDashboard.pendingTasks.length ? (
              <ul className="senior-review-risk-list">
                {firmDashboard.pendingTasks.slice(0, 6).map((item) => (
                  <li key={item.id || `${item.title}-${item.dueDate}`}>
                    <strong>{item.title || "Task"}</strong>
                    <div className="muted-copy">{item.relatedCaseId || "Unlinked matter"}</div>
                    <div className="muted-copy">{item.dueDate || "No deadline"}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted-copy">No pending firm tasks at the moment.</p>}
          </div>

          <div className="law-card">
            <div className="senior-review-card-label">Governance</div>
            <h4>Recent Audit Activity</h4>
            {firmDashboard.recentFirmActions.length ? (
              <ul className="senior-review-risk-list firm-action-timeline">
                {firmDashboard.recentFirmActions.map((item, index) => (
                  <li key={`${item.id || item.action || "firm-action"}-${index}`}>
                    <strong>{String(item.action || "firm_action").replace(/_/g, " ")}</strong>
                    <div className="muted-copy">{item.entityLabel || item.entityType || "Firm workflow item"}</div>
                    <div className="muted-copy">{item.actor || "Firm user"} | {item.createdAt || "No timestamp"}</div>
                    {item.assignedReviewer ? <div className="muted-copy">Assigned: {item.assignedReviewer}</div> : null}
                    {item.partnerStatus && item.partnerStatus !== "pending" ? <div className="muted-copy">Partner state: {String(item.partnerStatus).replace(/_/g, " ")}</div> : null}
                  </li>
                ))}
              </ul>
            ) : firmDashboard.recentAudit.length ? (
              <ul className="senior-review-risk-list">
                {firmDashboard.recentAudit.map((item, index) => (
                  <li key={`${item.id || item.action || "audit"}-${index}`}>
                    <strong>{item.action || "Audit event"}</strong>
                    <div className="muted-copy">{item.status || "logged"}</div>
                    <div className="muted-copy">{item.createdAt || item.timestamp || "No timestamp"}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted-copy">No recent audit records loaded.</p>}
          </div>
        </div>

        <div className="senior-review-workflow-wrap">
          {firmSelectedReview ? (
            <div className="law-card review-workflow-card">
              <div className="review-workflow-header">
                <div>
                  <h4 style={{ marginBottom: 6 }}>Firm Routing Desk</h4>
                  <div className="muted-copy">Assign reviewers, escalate strategically, and finalize partner-level sign-off.</div>
                </div>
                <span className="status-chip" style={firmSelectedStatusPresentation.style}>
                  {firmSelectedStatusPresentation.label}
                </span>
              </div>
              <div className="law-extract-meta senior-review-meta">
                <div><strong>Selected:</strong> {firmSelectedReview.entityLabel || firmSelectedReview.entityType || "Output"}</div>
                <div><strong>Matter:</strong> {firmSelectedReview.matterLabel}</div>
                <div><strong>Assigned:</strong> {firmSelectedDraft.assignedReviewer || firmSelectedReview.assignedReviewer || "Unassigned"}</div>
                <div><strong>Escalation:</strong> {String(firmSelectedDraft.escalationLevel || firmSelectedReview.escalationLevel || "routine").replace(/_/g, " ")}</div>
              </div>
              <div className="law-inline-actions firm-routing-status-row">
                <span className="status-chip firm-routing-chip firm-routing-chip-escalation">
                  {String(firmSelectedDraft.escalationLevel || firmSelectedReview.escalationLevel || "routine").replace(/_/g, " ")}
                </span>
                <span className="status-chip firm-routing-chip firm-routing-chip-partner">
                  {String(firmSelectedDraft.partnerStatus || firmSelectedReview.partnerStatus || "pending").replace(/_/g, " ")}
                </span>
                {String(firmSelectedDraft.assignedReviewer || firmSelectedReview.assignedReviewer || "").trim()
                  ? <span className="status-chip firm-routing-chip firm-routing-chip-assigned">Assigned</span>
                  : null}
              </div>
              <div className="review-workflow-grid">
                <label className="law-field">
                  <span>Assigned Reviewer</span>
                  <input
                    type="text"
                    value={firmSelectedDraft.assignedReviewer ?? firmSelectedReview.assignedReviewer ?? ""}
                    onChange={(event) => updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, { assignedReviewer: event.target.value })}
                    placeholder="Associate, senior, or partner owner"
                  />
                </label>
                <label className="law-field">
                  <span>Escalation Level</span>
                  <select
                    value={firmSelectedDraft.escalationLevel ?? firmSelectedReview.escalationLevel ?? "routine"}
                    onChange={(event) => updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, { escalationLevel: event.target.value })}
                  >
                    {FIRM_ESCALATION_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="law-field">
                  <span>Partner Decision State</span>
                  <select
                    value={firmSelectedDraft.partnerStatus ?? firmSelectedReview.partnerStatus ?? "pending"}
                    onChange={(event) => updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, { partnerStatus: event.target.value })}
                  >
                    <option value="pending">Pending</option>
                    <option value="ready_for_partner">Ready for Partner</option>
                    <option value="partner_approved">Partner Approved</option>
                  </select>
                </label>
                <label className="law-field">
                  <span>Partner Approval Role</span>
                  <select
                    value={firmSelectedDraft.approvalRole ?? firmSelectedReview.approvalRole ?? ""}
                    onChange={(event) => updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, { approvalRole: event.target.value })}
                  >
                    <option value="">Select sign-off role</option>
                    {APPROVAL_ROLE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="law-inline-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    appendFirmAction({
                      action: "routing_saved",
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      assignedReviewer: firmSelectedDraft.assignedReviewer || firmSelectedReview.assignedReviewer || "",
                      escalationLevel: firmSelectedDraft.escalationLevel || firmSelectedReview.escalationLevel || "routine",
                      partnerStatus: firmSelectedDraft.partnerStatus || firmSelectedReview.partnerStatus || "pending"
                    });
                    saveReviewRecord({
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      output: firmSelectedReview,
                      status: firmSelectedReview.status || "ai_draft"
                    });
                  }}
                >
                  Save Firm Routing
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    const nextDraft = { escalationLevel: "partner_hold", approvalRole: "partner", partnerStatus: "ready_for_partner" };
                    updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, nextDraft);
                    appendFirmAction({
                      action: "partner_escalated",
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      escalationLevel: "partner_hold",
                      partnerStatus: "ready_for_partner"
                    });
                    saveReviewRecord({
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      output: firmSelectedReview,
                      status: "reviewed",
                      draftOverrides: nextDraft
                    });
                  }}
                >
                  Escalate To Partner
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    const nextDraft = { approvalRole: "partner", partnerStatus: "partner_approved" };
                    updateReviewDraft(firmSelectedReview.entityType, firmSelectedReview.entityKey, nextDraft);
                    appendFirmAction({
                      action: "partner_approved",
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      escalationLevel: firmSelectedDraft.escalationLevel || firmSelectedReview.escalationLevel || "routine",
                      partnerStatus: "partner_approved"
                    });
                    saveReviewRecord({
                      entityType: firmSelectedReview.entityType,
                      entityKey: firmSelectedReview.entityKey,
                      entityLabel: firmSelectedReview.entityLabel,
                      output: firmSelectedReview,
                      status: "approved",
                      draftOverrides: nextDraft
                    });
                  }}
                >
                  Partner Approve
                </button>
              </div>
              <div className="muted-copy" style={{ marginTop: 10 }}>
                Current partner state: {String(firmSelectedDraft.partnerStatus || firmSelectedReview.partnerStatus || "pending").replace(/_/g, " ")}.
              </div>
            </div>
          ) : null}
          {renderReviewSnapshots(firmDashboard.approvedSnapshots)}
        </div>
      </div>
    </section>
  );

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !memoOutput) return;
    autoUpsertReviewRecord({
      entityType: "memo",
      entityKey: memoReviewKey,
      entityLabel: "Research Memo",
      output: memoOutput,
      reviewFindings: memoOutput.riskFlags || []
    });
  }, [autoUpsertReviewRecord, hasRole.lawyer, memoOutput, memoReviewKey, mode]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !strengthOutput) return;
    autoUpsertReviewRecord({
      entityType: "strength",
      entityKey: buildReviewEntityKey("strength", [selectedMatterId || selectedMatter?.id || "workspace", caseTitle || intakeOutput?.caseTitle || "general"]),
      entityLabel: "Case Strength",
      output: strengthOutput,
      reviewFindings: strengthOutput.weaknesses || []
    });
  }, [autoUpsertReviewRecord, caseTitle, hasRole.lawyer, intakeOutput?.caseTitle, mode, selectedMatter?.id, selectedMatterId, strengthOutput]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !predictionOutput) return;
    autoUpsertReviewRecord({
      entityType: "prediction",
      entityKey: predictionReviewKey,
      entityLabel: "Case Prediction",
      output: predictionOutput,
      reviewFindings: predictionOutput.riskDrivers || predictionOutput.risks || []
    });
  }, [autoUpsertReviewRecord, hasRole.lawyer, mode, predictionOutput, predictionReviewKey]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !readinessOutput) return;
    autoUpsertReviewRecord({
      entityType: "readiness",
      entityKey: readinessReviewKey,
      entityLabel: "Filing Readiness",
      output: readinessOutput,
      reviewFindings: readinessOutput.missingItems || readinessOutput.criticalGaps || []
    });
  }, [autoUpsertReviewRecord, hasRole.lawyer, mode, readinessOutput, readinessReviewKey]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !consistencyOutput) return;
    autoUpsertReviewRecord({
      entityType: "consistency",
      entityKey: consistencyReviewKey,
      entityLabel: "Matter Consistency",
      output: consistencyOutput,
      reviewFindings: consistencyOutput.contradictions || consistencyOutput.riskFlags || []
    });
  }, [autoUpsertReviewRecord, consistencyOutput, consistencyReviewKey, hasRole.lawyer, mode]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !coverageOutput) return;
    autoUpsertReviewRecord({
      entityType: "coverage",
      entityKey: coverageReviewKey,
      entityLabel: "Evidence Coverage",
      output: coverageOutput,
      reviewFindings: coverageOutput.missingEvidence || coverageOutput.gaps || []
    });
  }, [autoUpsertReviewRecord, coverageOutput, coverageReviewKey, hasRole.lawyer, mode]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !draftValidationOutput) return;
    autoUpsertReviewRecord({
      entityType: "draft_validation",
      entityKey: draftValidationReviewKey,
      entityLabel: "Draft Validation",
      output: draftValidationOutput,
      reviewFindings: [
        ...((draftValidationOutput.missingSections || []).map((item) => `Missing: ${item}`)),
        ...(draftValidationOutput.criticalIssues || [])
      ]
    });
  }, [autoUpsertReviewRecord, draftValidationOutput, draftValidationReviewKey, hasRole.lawyer, mode]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !filingPackOutput) return;
    autoUpsertReviewRecord({
      entityType: "filing_pack",
      entityKey: filingPackReviewKey,
      entityLabel: "Final Filing Pack",
      output: filingPackOutput,
      reviewFindings: filingPackOutput.missingItems || filingPackOutput.risks || []
    });
  }, [autoUpsertReviewRecord, filingPackOutput, filingPackReviewKey, hasRole.lawyer, mode]);

  useEffect(() => {
    if (!hasRole.lawyer || mode === "public" || !lawyerOutput) return;

    if (lawyerTab === "document") {
      autoUpsertReviewRecord({
        entityType: "document_analysis",
        entityKey: documentReviewKey,
        entityLabel: "Document Analysis",
        output: lawyerOutput,
        reviewFindings: [
          ...(lawyerOutput.missingElements || []),
          ...(lawyerOutput.legalRisks || []),
          ...(lawyerOutput.contradictionsWithCase || [])
        ]
      });
      return;
    }

    if (lawyerTab === "draft" && String(lawyerOutput.draft || "").trim()) {
      autoUpsertReviewRecord({
        entityType: "draft_output",
        entityKey: draftReviewKey,
        entityLabel: "Draft Output",
        output: lawyerOutput,
        reviewFindings: lawyerOutput.risks || []
      });
      return;
    }

    if (lawyerTab === "research") {
      autoUpsertReviewRecord({
        entityType: "research_output",
        entityKey: buildReviewEntityKey("research_output", [selectedMatterId || selectedMatter?.id || "workspace", caseTitle || lawyerInput.slice(0, 60) || "general"]),
        entityLabel: "AI Legal Research",
        output: lawyerOutput,
        reviewFindings: []
      });
    }
  }, [
    autoUpsertReviewRecord,
    caseTitle,
    documentReviewKey,
    draftReviewKey,
    hasRole.lawyer,
    lawyerInput,
    lawyerOutput,
    lawyerTab,
    mode,
    selectedMatter?.id,
    selectedMatterId
  ]);

  useEffect(() => {
    if (mode !== "lawyer") return;
    if (lawyerTab !== "research") return;
    if (String(lawyerInput || "").trim()) return;
    const prompt = buildResearchPromptFromIntake(intakeOutput, intakeChronology);
    if (!prompt) return;
    setLawyerInput(prompt);
  }, [intakeChronology, intakeOutput, lawyerInput, lawyerTab, mode]);

  const activateRole = (role) => {
    if (!account) {
      navigate("/login");
      return;
    }

    registerRole(role, {
      uid: account.uid,
      phone: account.phone,
      name: account.name || (role === "firm" ? "Firm Admin" : role === "senior" ? "Senior Lawyer" : role === "lawyer" ? "Lawyer" : "Public User"),
      role,
      onboardedAt: new Date().toISOString()
    });

    setLastActiveRole(role);
    setSearchParams({ mode: role });
    setStatus(`${role === "firm" ? "Firm command" : role === "senior" ? "Senior review" : role === "lawyer" ? "Lawyer" : "Public"} mode activated.`);
  };

  const startVoiceInput = (setter) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus("Voice input is not supported in this browser.");
      return;
    }

    if (voiceRecognitionRef.current) {
      try {
        voiceRecognitionRef.current.stop();
      } catch {
        // Ignore stale speech-recognition instances while switching sessions.
      }
      voiceRecognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    let capturedTranscript = false;
    recognition.lang = publicLanguage === "telugu" ? "te-IN" : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setStatus("Listening... speak now.");
    };
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      capturedTranscript = Boolean(String(spoken || "").trim());
      setter((previous) => `${previous} ${spoken}`.trim());
      setStatus(capturedTranscript ? "Voice dictation captured." : "No speech was captured.");
    };
    recognition.onerror = (event) => {
      const reason = String(event?.error || "").trim().toLowerCase();
      if (reason === "not-allowed" || reason === "service-not-allowed") {
        setStatus("Microphone permission is blocked. Allow mic access and try again.");
      } else if (reason === "no-speech") {
        setStatus("No speech detected. Try again and speak a little closer to the mic.");
      } else if (reason === "audio-capture") {
        setStatus("No working microphone was detected.");
      } else {
        setStatus("Voice capture failed. Please try again.");
      }
    };
    recognition.onend = () => {
      if (voiceRecognitionRef.current === recognition) {
        voiceRecognitionRef.current = null;
      }
      if (!capturedTranscript) {
        setStatus((current) => current || "Voice capture stopped.");
      }
    };
    voiceRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      voiceRecognitionRef.current = null;
      setStatus("Voice input could not start. Refresh once and try again.");
    }
  };

  const extractFromFile = async (file, setter, metaSetter) => {
    if (!file) return;
    const isPlainTextLike = /text|json|csv|markdown|md|xml/i.test(file.type || "") || /\.(txt|md|json|csv|xml)$/i.test(file.name || "");
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
      if (isPlainTextLike) {
        try {
          const fallbackText = String(await file.text()).slice(0, 30000);
          setter(fallbackText);
          if (metaSetter) {
            metaSetter({
              fileName: file.name,
              mimeType: file.type || "text/plain",
              qualityScore: 100,
              pagePreviews: [],
              extractionEngine: "local-text"
            });
          }
          setStatus(error?.message ? `Loaded ${file.name} locally. ${error.message}` : `Loaded ${file.name} locally.`);
          return;
        } catch {
          // Fall through to the generic extraction failure status below.
        }
      }
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
      draftText: sharedWorkspaceState.draftText || sharedWorkspaceState.currentText || "",
      draftType,
      courtType: draftCourtType
    };

    setBusy(true);
    setStatus("Validating draft structure against court-ready filing expectations...");
    try {
      const response = await analyzeDraftValidation(payload);
      setDraftValidationOutput(withSourceKey(response, draftValidationStateKey));
      setLawyerTab("draft-validation");
      setStatus("Draft validation ready.");
    } catch {
      const fallback = buildLocalDraftValidationOutput(payload);
      setDraftValidationOutput(withSourceKey(fallback, draftValidationStateKey));
      setLawyerTab("draft-validation");
      setStatus("Draft validation prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  const runFilingPackReadiness = async () => {
    const payload = {
      matterId: selectedMatter?.id || selectedMatterId || "",
      facts: sharedWorkspaceState.factsSummary || sharedWorkspaceState.researchText || sharedWorkspaceState.currentText,
      issues: sharedWorkspaceState.issues,
      documents: lawyerEvidence ? [{ id: "evidence-text", title: "Evidence notes", content: lawyerEvidence }] : [],
      draftText: sharedWorkspaceState.draftText,
      draftType,
      courtType: draftCourtType,
      selectedCases: selectedArgumentCases.length ? selectedArgumentCases : (strengthOutput?.authorityReview || argumentOutput?.authorityReview || []),
      caseStrength: strengthOutput,
      argumentOutput,
      documentAnalysis: lawyerTab === "document" && lawyerOutput?.summary ? lawyerOutput : null,
      hearingNotes,
      chronologyText: sharedWorkspaceState.chronologyText
    };
    const freshReadiness = buildLocalReadinessOutput(payload);
    const freshConsistency = buildLocalMatterConsistencyOutput(payload);
    const freshCoverage = buildLocalCoverageOutput(payload);
    const freshDraftValidation = buildLocalDraftValidationOutput(payload);
    const localFilingSnapshot = buildLocalFilingPackOutput({
      readiness: freshReadiness,
      consistency: freshConsistency,
      coverage: freshCoverage,
      draftValidation: freshDraftValidation
    });

    setBusy(true);
    setStatus("Running final filing pack gate across readiness, consistency, evidence coverage, draft validation, and authority freshness...");
    try {
      const response = await analyzeFilingPackReadiness(payload);
      setFilingPackOutput(withSourceKey(sanitizeFilingPackOutput(response, {
        payload,
        localSnapshot: localFilingSnapshot,
        draftValidation: freshDraftValidation
      }), filingPackAutoSyncKey));
      setLawyerTab("filing-pack");
      setStatus("Final filing pack review ready.");
    } catch {
      setFilingPackOutput(withSourceKey(localFilingSnapshot, filingPackAutoSyncKey));
      setLawyerTab("filing-pack");
      setStatus("Final filing pack review prepared with local fallback.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (draftValidationOutput?.sourceKey && draftValidationOutput.sourceKey !== draftValidationStateKey) {
      setDraftValidationOutput(null);
    }
  }, [draftValidationOutput?.sourceKey, draftValidationStateKey]);

  useEffect(() => {
    if (filingPackOutput?.sourceKey && filingPackOutput.sourceKey !== filingPackAutoSyncKey) {
      setFilingPackOutput(null);
    }
  }, [filingPackOutput?.sourceKey, filingPackAutoSyncKey]);

  useEffect(() => {
    if (lawyerTab !== "filing-pack" || busy) return;

    const hasSourceMaterial = Boolean(
      String(
        sharedWorkspaceState.draftText
        || sharedWorkspaceState.factsSummary
        || sharedWorkspaceState.researchText
        || sharedWorkspaceState.currentText
        || ""
      ).trim()
    );

    if (!hasSourceMaterial) return;
    if (filingPackAutoSyncKey === lastFilingPackAutoSyncKey) return;

    setLastFilingPackAutoSyncKey(filingPackAutoSyncKey);
    runFilingPackReadiness();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lawyerTab, busy, filingPackAutoSyncKey, lastFilingPackAutoSyncKey]);

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
      setStatus(
        error?.message
          ? `Citation graph unavailable. Showing local citation fallback. ${error.message}`
          : "Citation graph unavailable. Showing local citation fallback."
      );
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
      const fallbackValidity = caseValidityMap[caseKey] || {
        status: "CAUTION",
        riskLevel: "MEDIUM",
        confidenceScore: 35,
        summary: "Live validation is unavailable right now. Treat this authority as caution until manually verified.",
        topPositiveCases: [],
        topNegativeCases: []
      };
      setCaseValidityMap((previous) => ({
        ...previous,
        [caseKey]: fallbackValidity
      }));
      setCitationView(buildLocalCitationView(target, fallbackValidity));
      setStatus(
        error?.message
          ? `Authority revalidation unavailable. Showing local fallback. ${error.message}`
          : "Authority revalidation unavailable. Showing local fallback."
      );
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
    setLawyerTab("judgments");
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
    setLawyerTab("judgments");
    setStatus(`Compare queue updated: ${item.title || item.citation || "authority"}`);
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
      if (isServiceUnavailableError(error)) {
        setJudgmentSyncStatus((current) => ({
          ...(current || {}),
          lastRun: {
            id: `local-sync-${Date.now()}`,
            sourceId,
            mode: "local-fallback",
            createdAt: new Date().toISOString(),
            status: "offline"
          }
        }));
        setStatus("Live sync service is unavailable right now. Continue with current local/demo judgment data.");
      } else {
        setStatus(error.message || "Could not create judgment sync run.");
      }
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
      const fallbackJudgments = buildLocalJudgmentMatches({ intakeOutput, memoOutput });
      if (fallbackJudgments.length) {
        setJudgments(fallbackJudgments);
      }
      setJudgmentFeedMode("demo");
      setJudgmentSourceMode("local");
      setStatus(
        error?.message
          ? `Live retrieval unavailable. Showing local fallback judgments. ${error.message}`
          : "Live retrieval unavailable. Showing local fallback judgments."
      );
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
    const prompt = sharedWorkspaceState.researchText || buildResearchPromptFromIntake(intakeOutput, intakeChronology);
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

  const refreshCopilotSessionState = async (sessionId) => {
    if (!sessionId) return null;
    const [sessionResponse, actionResponse] = await Promise.all([
      getCopilotSession(sessionId),
      fetchCopilotActions(sessionId)
    ]);
    setCopilotSessionData(sessionResponse || null);
    setCopilotAllowedActions(Array.isArray(actionResponse?.allowedActions) ? actionResponse.allowedActions : []);
    return sessionResponse || null;
  };

  const ensureCopilotSession = useCallback(async () => {
    if (copilotSessionId) return copilotSessionId;
    const started = await startCopilotSession({
      ownerId,
      matterId: selectedMatter?.id || null
    });
    const nextSessionId = String(started?.session?.id || started?.sessionId || "").trim();
    if (!nextSessionId) {
      throw new Error("Copilot session was not created.");
    }
    setCopilotSessionId(nextSessionId);
    setCopilotSessionData(started || null);
    setCopilotBackendUnavailable(false);
    return nextSessionId;
  }, [copilotSessionId, ownerId, selectedMatter?.id]);

  const syncCopilotSession = async (sessionId, options = {}) => {
    const nextSessionId = sessionId || (await ensureCopilotSession());
    const shouldBuildContext = options.buildContext !== false;
    const intakeResponse = await submitCopilotIntake(nextSessionId, copilotIntakePayload);
    let latest = intakeResponse || null;

    if (shouldBuildContext && String(copilotIntakePayload.factsSummary || "").trim()) {
      latest = await buildCopilotContext(nextSessionId, {});
    }

    setCopilotSessionData(latest || null);
    await refreshCopilotSessionState(nextSessionId);
    return nextSessionId;
  };

  useEffect(() => {
    if (!copilotChatOpen || copilotSessionId || copilotSessionBusy || copilotBackendUnavailable) return;

    let active = true;
    setCopilotSessionBusy(true);
    ensureCopilotSession()
      .then((sessionId) => {
        if (!active) return;
        return refreshCopilotSessionState(sessionId);
      })
      .catch((error) => {
        if (!active) return;
        setCopilotBackendUnavailable(true);
        setStatus(error?.message || "Unable to start copilot session.");
      })
      .finally(() => {
        if (active) {
          setCopilotSessionBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [copilotBackendUnavailable, copilotChatOpen, copilotSessionBusy, copilotSessionId, ensureCopilotSession]);

  useEffect(() => {
    const latestDocument = Array.isArray(copilotSessionData?.memory?.generatedDocuments) && copilotSessionData.memory.generatedDocuments.length
      ? copilotSessionData.memory.generatedDocuments[copilotSessionData.memory.generatedDocuments.length - 1]
      : null;
    const latestDraft = String(copilotSessionData?.memory?.workspaceDraft || latestDocument?.content || "").trim();
    if (latestDraft) {
      setLawyerOutput((current) => ({
        ...(current || {}),
        draft: latestDraft
      }));
    }
    if (copilotSessionData?.memory?.lastGenerationMeta) {
      setCopilotDraftMeta(copilotSessionData.memory.lastGenerationMeta);
    }

    const validationState = copilotSessionData?.memory?.validationState;
    if (validationState && validationState.status && validationState.status !== "not_run") {
      setDraftValidationOutput(withSourceKey(adaptCopilotValidationReport({
        status: validationState.status,
        missingSections: validationState.missingSections,
        unsupportedClaims: validationState.unsupportedClaims,
        citationIssues: validationState.citationIssues,
        suggestedFixes: validationState.warnings
      }), draftValidationStateKey));
    }
  }, [copilotSessionData, draftValidationStateKey]);

  const openCopilotChat = () => {
    setCopilotChatOpen(true);
  };

  const closeCopilotChat = () => {
    setCopilotChatOpen(false);
  };

  const sendCopilotMessage = async (rawMessage = "") => {
    const messageSource = String(rawMessage || copilotInput || "");
    const message = messageSource.trim();
    if (!message) return;
    const shouldClearComposer = !rawMessage;

    if (shouldClearComposer) {
      setCopilotInput("");
    }

    const authorityToRemove = extractAuthorityToRemove(message);
    const wantsNoiseCleanup = /noise|noice|irrelevant|unnecessary|only relevant|relevant ga unna vati|vatine chupinchu|clean up|cleanup/.test(message.toLowerCase())
      && /remove|delete|teesey|chupinchu|unchey|clean/i.test(message.toLowerCase());
    const isRemoveAuthorityAction = Boolean(authorityToRemove) && /remove|delete|teesey/i.test(message);
    const isBulkNoiseCleanupAction = wantsNoiseCleanup && !authorityToRemove;

    if (isBulkNoiseCleanupAction) {
      const noisePattern = /article 14|article 21|constitution|maneka gandhi|d\.k\. basu|lalita kumari|consumer protection|bnss section 173|section 173/i;
      let removedLabels = [];

      setLawyerOutput((current) => {
        if (!current) return current;

        const nextOutput = {
          ...current,
          applicableSections: (Array.isArray(current.applicableSections) ? current.applicableSections : []).filter((item) => {
            const match = noisePattern.test(String(item || ""));
            if (match) removedLabels.push(String(item));
            return !match;
          }),
          citations: (Array.isArray(current.citations) ? current.citations : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`.trim();
            const match = noisePattern.test(label);
            if (match) removedLabels.push(label);
            return !match;
          }),
          caseLaws: (Array.isArray(current.caseLaws) ? current.caseLaws : []).filter((item) => {
            const label = formatAuthorityLabel(item);
            const match = noisePattern.test(label);
            if (match) removedLabels.push(label);
            return !match;
          }),
          retrievedAuthorities: (Array.isArray(current.retrievedAuthorities) ? current.retrievedAuthorities : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`.trim();
            const match = noisePattern.test(label);
            if (match) removedLabels.push(label);
            return !match;
          }),
          bestCases: (Array.isArray(current.bestCases) ? current.bestCases : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`.trim();
            const match = noisePattern.test(label);
            if (match) removedLabels.push(label);
            return !match;
          }),
          relatedJudgments: (Array.isArray(current.relatedJudgments) ? current.relatedJudgments : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`.trim();
            const match = noisePattern.test(label);
            if (match) removedLabels.push(label);
            return !match;
          })
        };

        return nextOutput;
      });

      removedLabels = Array.from(new Set(removedLabels.filter(Boolean)));

      const userMessage = {
        id: `copilot-user-${Date.now()}`,
        role: "user",
        text: message
      };
      const assistantMessage = {
        id: `copilot-assistant-${Date.now() + 1}`,
        role: "assistant",
        text: removedLabels.length
          ? `Current workspace nundi unnecessary noise remove chesanu. Ivi delete ayyayi: ${removedLabels.join(", ")}. Ippudu relevant authorities meeda focus cheyyachu.`
          : "Current visible workspace lo obvious noise items dorakaledu. Kani nenu next relevant-only summary ivvagalanu."
      };

      setCopilotMessages((current) => [...current, userMessage, assistantMessage]);
      return;
    }

    if (isRemoveAuthorityAction) {
      const needle = authorityToRemove.toLowerCase();
      let removed = false;

      setLawyerOutput((current) => {
        if (!current) return current;

        const matchesAuthority = (value = "") => {
          const label = String(value || "").toLowerCase();
          return label.includes(needle)
            || needle.includes(label)
            || (/article 21/.test(needle) && /article 21/.test(label))
            || (/maneka gandhi/.test(needle) && /maneka gandhi/.test(label))
            || (/consumer protection/.test(needle) && /consumer protection/.test(label))
            || (/bnss section 173|section 173/.test(needle) && /(bnss section 173|section 173|information in cognizable cases)/.test(label))
            || (/bharatiya sakshya adhiniyam|bsa|evidence/.test(needle) && /(bharatiya sakshya adhiniyam|bsa|evidence)/.test(label));
        };

        const nextOutput = {
          ...current,
          applicableSections: (Array.isArray(current.applicableSections) ? current.applicableSections : []).filter((item) => {
            const keep = !matchesAuthority(item);
            if (!keep) removed = true;
            return keep;
          }),
          citations: (Array.isArray(current.citations) ? current.citations : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`;
            const keep = !matchesAuthority(label);
            if (!keep) removed = true;
            return keep;
          }),
          caseLaws: (Array.isArray(current.caseLaws) ? current.caseLaws : []).filter((item) => {
            const label = formatAuthorityLabel(item);
            const keep = !matchesAuthority(label);
            if (!keep) removed = true;
            return keep;
          }),
          retrievedAuthorities: (Array.isArray(current.retrievedAuthorities) ? current.retrievedAuthorities : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`;
            const keep = !matchesAuthority(label);
            if (!keep) removed = true;
            return keep;
          }),
          bestCases: (Array.isArray(current.bestCases) ? current.bestCases : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`;
            const keep = !matchesAuthority(label);
            if (!keep) removed = true;
            return keep;
          }),
          relatedJudgments: (Array.isArray(current.relatedJudgments) ? current.relatedJudgments : []).filter((item) => {
            const label = `${item?.title || ""} ${item?.citation || ""}`;
            const keep = !matchesAuthority(label);
            if (!keep) removed = true;
            return keep;
          })
        };

        return nextOutput;
      });

      const userMessage = {
        id: `copilot-user-${Date.now()}`,
        role: "user",
        text: message
      };
      const assistantMessage = {
        id: `copilot-assistant-${Date.now() + 1}`,
        role: "assistant",
        text: removed
          ? `"${authorityToRemove}" ni current workspace nundi remove chesanu. Miku kavali ante next relevant replacement authority kuda suggest chestha.`
          : `"${authorityToRemove}" exact match current visible workspace lo dorakaledu. Different label tho undemo verify cheyyi.`
      };

      setCopilotMessages((current) => [...current, userMessage, assistantMessage]);
      return;
    }

    const userMessage = {
      id: `copilot-user-${Date.now()}`,
      role: "user",
      text: message
    };
    setCopilotMessages((current) => [...current, userMessage]);

    let assistantText = "";
    if (copilotBackendUnavailable) {
      assistantText = buildCopilotReply(message, copilotContext);
      const assistantMessage = {
        id: `copilot-assistant-${Date.now() + 1}`,
        role: "assistant",
        text: `Local copilot mode:\n${assistantText}`
      };
      setCopilotMessages((current) => [...current, assistantMessage]);
      if (shouldClearComposer) {
        setCopilotInput("");
      }
      setStatus("Copilot is running in local fallback mode.");
      return;
    }
    try {
      setCopilotSessionBusy(true);
      const sessionId = await ensureCopilotSession();
      const normalizedMessage = message.toLowerCase();
      const shouldSyncFirst = Boolean(String(copilotIntakePayload.factsSummary || "").trim());

      if (shouldSyncFirst) {
        await syncCopilotSession(sessionId, { buildContext: true });
      } else {
        await refreshCopilotSessionState(sessionId);
      }

      if (/allowed actions|em actions|what can you do|next actions|workflow/.test(normalizedMessage)) {
        assistantText = copilotAllowedActions.length
          ? `Current copilot workflow lo available actions: ${copilotAllowedActions.join(", ")}.`
          : "Current session lo first intake/context complete avvali. Facts or matter summary share chesthe next actions unlock avutayi.";
      } else if (/build context|prepare context|context ready|research context/.test(normalizedMessage)) {
        const response = await buildCopilotContext(sessionId, {});
        setCopilotSessionData(response || null);
        await refreshCopilotSessionState(sessionId);
        const sections = Array.isArray(response?.memory?.contextPacket?.sections) ? response.memory.contextPacket.sections : [];
        const judgments = Array.isArray(response?.memory?.contextPacket?.judgments) ? response.memory.contextPacket.judgments : [];
        assistantText = `Context ready. ${sections.length} section references and ${judgments.length} judgment references current matter ki attach అయ్యాయి.`;
      } else if (/validate|review draft|check draft|missing sections/.test(normalizedMessage)) {
        const response = await validateCopilotDraft(sessionId, {
          documentType: copilotIntakePayload.documentType || draftType || "notice",
          documentText: copilotContext.draft || lawyerOutput?.draft || ""
        });
        const report = response?.report || {};
        const missingSections = Array.isArray(report.missingSections) ? report.missingSections : [];
        const fixes = Array.isArray(report.suggestedFixes) ? report.suggestedFixes : [];
        setDraftValidationOutput(withSourceKey(adaptCopilotValidationReport(report), draftValidationStateKey));
        setLawyerTab("draft-validation");
        setCopilotSessionData(response || null);
        await refreshCopilotSessionState(sessionId);
        assistantText = [
          `Validation status: ${report.status || "unknown"}.`,
          missingSections.length ? `Missing sections: ${missingSections.join(", ")}.` : "No major section gaps flagged.",
          fixes.length ? `Suggested fixes: ${fixes.slice(0, 3).join(", ")}.` : ""
        ].filter(Boolean).join(" ");
      } else if (/filing|file chey|readiness|checklist|final step/.test(normalizedMessage)) {
        const response = await fetchFilingGuidance(sessionId, {});
        const checklist = Array.isArray(response?.checklist) ? response.checklist : [];
        setCopilotSessionData(response || null);
        await refreshCopilotSessionState(sessionId);
        await runFilingPackReadiness();
        assistantText = checklist.length
          ? `Filing checklist ready:\n- ${checklist.join("\n- ")}`
          : "Filing guidance request complete ayyindi.";
      } else if (/draft|notice|complaint|petition|affidavit|generate document|prepare draft/.test(normalizedMessage)) {
        const requestedDocumentType = /notice/.test(normalizedMessage)
          ? "notice"
          : /affidavit/.test(normalizedMessage)
            ? "affidavit"
            : /petition/.test(normalizedMessage)
              ? "petition"
              : "complaint";
        const response = await generateCopilotDraft(sessionId, {
          documentType: requestedDocumentType
        });
        const draftText = String(response?.document?.content || "").trim();
        setCopilotDraftMeta(response?.generationMeta || null);
        setDraftType(requestedDocumentType);
        setDraftValidationOutput(null);
        setFilingPackOutput(null);
        if (draftText) {
          setLawyerOutput((current) => ({
            ...(current || {}),
            draft: draftText
          }));
        }
        setLawyerTab("draft");
        setCopilotSessionData(response || null);
        await refreshCopilotSessionState(sessionId);
        assistantText = draftText
          ? response?.generationMeta?.fallbackUsed
            ? `Session-based ${requestedDocumentType} draft ready using fallback mode. Provider: ${response.generationMeta.provider || "unknown"}. Code: ${response.generationMeta.diagnosticCode || "fallback"}. Reason: ${response.generationMeta.failureReason || "provider unavailable"}. Draft tab lo continue refine cheyyachu.`
            : `Session-based ${requestedDocumentType} draft ready. Draft tab lo continue refine cheyyachu.`
          : "Draft generation attempt complete ayyindi kani usable text raaledu.";
      } else {
        const historyPayload = copilotMessages.slice(-8).map((item) => ({
          role: item.role,
          text: item.text
        }));
        const response = sessionId
          ? await sendCopilotChatMessage(sessionId, {
              message,
              history: historyPayload
            })
          : await runCopilotChat({
              ownerId,
              message,
              facts: copilotContext.facts,
              draft: copilotContext.draft,
              output: copilotContext.output,
              tab: copilotContext.tab,
              history: historyPayload
            });

        assistantText = String(response?.reply || "").trim();
        if (!assistantText) {
          assistantText = buildCopilotReply(message, copilotContext);
        }
        if (response?.draft && String(response.draft).trim()) {
          setLawyerOutput((current) => ({
            ...(current || {}),
            draft: String(response.draft).trim()
          }));
        }
      }
    } catch (error) {
      const detail = String(error?.message || "").trim();
      const localFallback = buildCopilotReply(message, copilotContext);
      setCopilotBackendUnavailable(true);
      assistantText = detail
        ? `Copilot backend unreachable: ${detail}\n\nLocal fallback:\n${localFallback}`
        : localFallback;
      setStatus("Copilot backend request failed.");
    } finally {
      setCopilotSessionBusy(false);
    }

    const assistantMessage = {
      id: `copilot-assistant-${Date.now() + 1}`,
      role: "assistant",
      text: assistantText
    };

    setCopilotMessages((current) => [...current, assistantMessage]);
    if (shouldClearComposer) {
      setCopilotInput("");
    }
  };

  const handleCopilotSubmit = (event) => {
    event.preventDefault();
    sendCopilotMessage();
  };

  const handleCopilotKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleCopilotSubmit(event);
    }
  };

  const handleCopilotFileUpload = async (file) => {
    if (!file) return;
    await extractFromFile(
      file,
      (extractedText) => {
        const text = String(extractedText || "").trim();
        if (!text) return;
        setCopilotInput((current) => current ? `${current}\n\n${text}` : text);
        setCopilotMessages((current) => [
          ...current,
          {
            id: `copilot-file-${Date.now()}`,
            role: "assistant",
            text: `Loaded ${file.name}. I added the extracted text into the chat composer so you can ask questions or use it for draft changes.`
          }
        ]);
        setCopilotChatOpen(true);
      },
      setCopilotAttachmentMeta
    );
  };

  const sendWorkspaceToCopilot = (value = "", label = "Current workspace") => {
    const message = buildWorkspaceForwardMessage({
      label,
      value,
      workspaceState: sharedWorkspaceState
    });
    if (!message) {
      setStatus(`${label} is empty right now.`);
      return;
    }

    setCopilotChatOpen(true);
    sendCopilotMessage(message);
  };

  const saveClient = async () => {
    if (!clientName.trim()) return;
    const payload = buildClientUpsertPayload({
      name: clientName,
      phone: clientPhone,
      notes: clientNotes
    });
    try {
      await runLegalAction("client_upsert", {
        ownerId,
        client: payload
      });
      setClientName("");
      setClientPhone("");
      setClientNotes("");
      hydrateLawyerData();
      setStatus("Client saved.");
    } catch (error) {
      const fallbackClient = {
        ...payload,
        id: payload.id || `client-${Date.now()}`
      };
      setClients((current) => [fallbackClient, ...(current || []).filter((item) => item.id !== fallbackClient.id)]);
      setClientName("");
      setClientPhone("");
      setClientNotes("");
      setStatus(error?.message ? `Client saved locally. ${error.message}` : "Client saved locally.");
    }
  };

  const saveCase = async () => {
    if (!caseTitle.trim()) return;
    const payload = buildCaseUpsertPayload({
      clientId: selectedClientId,
      title: caseTitle,
      stage: caseStage,
      notes: caseNotes,
      nextHearingDate: caseNextDate
    });
    const nextSelectedId = selectedMatterId;
    try {
      await runLegalAction("case_upsert", {
        ownerId,
        caseItem: payload
      });
      setSelectedClientId("");
      setCaseTitle("");
      setCaseStage("Draft");
      setCaseNextDate("");
      setCaseNotes("");
      if (!nextSelectedId) {
        setSelectedMatterId("");
      }
      hydrateLawyerData();
      setStatus("Case saved.");
    } catch (error) {
      const fallbackCase = {
        ...payload,
        id: payload.id || `case-${Date.now()}`
      };
      setCases((current) => [fallbackCase, ...(current || []).filter((item) => item.id !== fallbackCase.id)]);
      setSelectedClientId("");
      setCaseTitle("");
      setCaseStage("Draft");
      setCaseNextDate("");
      setCaseNotes("");
      if (!nextSelectedId) {
        setSelectedMatterId(fallbackCase.id);
      }
      setStatus(error?.message ? `Case saved locally. ${error.message}` : "Case saved locally.");
    }
  };

  const saveTask = async () => {
    if (!taskTitle.trim()) return;
    const payload = buildTaskUpsertPayload({
      title: taskTitle,
      dueDate: taskDueDate,
      status: "pending",
      relatedCaseId: selectedMatter?.id || ""
    });
    try {
      await runLegalAction("task_upsert", {
        ownerId,
        task: payload
      });
      setTaskTitle("");
      setTaskDueDate("");
      hydrateLawyerData();
      setStatus("Task saved.");
    } catch (error) {
      const fallbackTask = {
        ...payload,
        id: payload.id || `task-${Date.now()}`
      };
      setTasks((current) => [fallbackTask, ...(current || []).filter((item) => item.id !== fallbackTask.id)]);
      setTaskTitle("");
      setTaskDueDate("");
      setStatus(error?.message ? `Task saved locally. ${error.message}` : "Task saved locally.");
    }
  };

  const updateTaskStatus = async (taskId, statusValue) => {
    const existingTask = (tasks || []).find((item) => item.id === taskId);
    if (!existingTask) return;
    const nextTask = buildTaskStatusUpdatePayload(existingTask, statusValue);
    if (!nextTask) return;

    try {
      await runLegalAction("task_upsert", {
        ownerId,
        task: nextTask
      });
      setStatus(`Task marked as ${statusValue}.`);
      hydrateLawyerData();
    } catch (error) {
      setTasks((current) => (current || []).map((item) => item.id === taskId ? nextTask : item));
      setStatus(error?.message ? `Task updated locally. ${error.message}` : `Task updated locally as ${statusValue}.`);
    }
  };

  const saveMemory = async () => {
    if (!memoryTitle.trim()) return;
    const payload = buildMemorySavePayload({
      title: memoryTitle,
      summary: memorySummary
    });
    try {
      await runLegalAction("memory_save", {
        ownerId,
        memory: payload
      });
      setMemoryTitle("");
      setMemorySummary("");
      setStatus("Memory saved.");
      hydrateLawyerData();
    } catch (error) {
      const fallbackMemory = {
        ...payload,
        id: payload.id || `memory-${Date.now()}`
      };
      setSavedMemories((current) => [fallbackMemory, ...(current || []).filter((item) => item.id !== fallbackMemory.id)]);
      setMemoryTitle("");
      setMemorySummary("");
      setStatus(error?.message ? `Memory saved locally. ${error.message}` : "Memory saved locally.");
    }
  };

  const suggestMemory = async () => {
    try {
      const response = await runLegalAction("memory_suggest", {
        ownerId,
        query: memoryQuery
      });
      setMemorySuggestions(response.suggestions || []);
      setStatus("Suggested similar cases ready.");
    } catch (error) {
      const localSuggestions = buildLocalMemorySuggestions({
        query: memoryQuery,
        memories: savedMemories
      });
      setMemorySuggestions(localSuggestions);
      setStatus(
        isServiceUnavailableError(error)
          ? "Suggested similar cases prepared with local fallback."
          : (error?.message || "Could not suggest similar cases.")
      );
    }
  };

  const loadMemoryIntoResearch = (memoryItem) => {
    const prompt = buildMemoryResearchPrompt(memoryItem);
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
    const prompt = buildMatterResearchPrompt({
      selectedMatter,
      selectedMatterClient,
      chronologyEntries,
      selectedMatterTasks,
      hearingNotes
    });
    setLawyerInput(prompt);
    setLawyerTab("research");
    setStatus(`Loaded matter workspace for ${selectedMatter.title || "selected case"} into research.`);
  };

  const exportMatterPrep = () => {
    const content = buildMatterPrepSheet({
      selectedMatter,
      selectedMatterClient,
      chronologyEntries,
      selectedMatterTasks,
      hearingNotes
    });
    if (!content) {
      return;
    }

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
          ...buildMemorySavePayload({
            title: citationText,
            summary: "Pinned citation from AI output for future case reference."
          }),
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
            Associate Mode
          </button>
          <button type="button" className={mode === "senior" ? "header-pill" : "ghost-button"} onClick={() => setSearchParams({ mode: "senior" })}>
            Senior Review Mode
          </button>
          <button type="button" className={mode === "firm" ? "header-pill" : "ghost-button"} onClick={() => setSearchParams({ mode: "firm" })}>
            Firm Mode
          </button>
        </div>
      </div>

      {!hasRole[mode] ? (
        <div className="soft-panel law-role-card">
          <h3>{mode === "public" ? "Activate Public Role" : mode === "senior" ? "Activate Senior Review Role" : mode === "firm" ? "Activate Firm Role" : "Activate Lawyer Role"}</h3>
          <p className="muted-copy">Login already complete. Finish role signup here to open the dedicated legal module.</p>
          <button type="button" className="primary-button" onClick={() => activateRole(mode === "public" ? "public" : mode === "senior" ? "senior" : mode === "firm" ? "firm" : "lawyer")}>
            Signup as {mode === "public" ? "Public User" : mode === "senior" ? "Senior Reviewer" : mode === "firm" ? "Firm Admin" : "Lawyer"}
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
                <button key={tab.id} type="button" className={lawyerTab === tab.id ? "header-pill" : "ghost-button"} onClick={() => { setLawyerTab(tab.id); }}>
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
                        {renderAuthorities(intakeOutput.retrievedAuthorities, revalidateAuthorityNow, openJudgmentDetails, toggleCompareJudgment)}
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
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setCitationView(null);
                      setCitationExpanded({});
                      setLawyerTab("judgments");
                      setStatus("Returned to latest judgments.");
                    }}
                  >
                    Back To Judgments
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
                    {(copilotContextPacket.authoritiesSummary || copilotContextPacket.sections?.length || copilotContextPacket.judgments?.length) ? (
                      <>
                        <h4>Copilot Session Context</h4>
                        <div className="soft-panel" style={{ marginBottom: "16px" }}>
                          <p className="muted-copy">
                            Session-backed retrieval summary for the active matter. Use this to cross-check what the copilot attached before drafting or validating.
                          </p>
                          {copilotContextPacket.authoritiesSummary ? <p>{copilotContextPacket.authoritiesSummary}</p> : null}
                          <div className="law-extract-meta">
                            <div><strong>Sections:</strong> {copilotContextPacket.sections?.length || 0}</div>
                            <div><strong>Judgments:</strong> {copilotContextPacket.judgments?.length || 0}</div>
                            <div><strong>Workflow:</strong> {copilotSessionData?.session?.workflowState || "intake"}</div>
                          </div>
                          {copilotContextPacket.judgmentSourceSummary?.length ? (
                            <p className="muted-copy">
                              <strong>Judgment Sources:</strong> {copilotContextPacket.judgmentSourceSummary.join(", ")}
                            </p>
                          ) : null}
                          {copilotContextPacket.sections?.length ? (
                            <>
                              <h4>Scoped Sections</h4>
                              <ul>{renderList(copilotContextPacket.sections.slice(0, 6))}</ul>
                            </>
                          ) : null}
                          {copilotContextPacket.judgments?.length ? (
                            <>
                              <h4>Scoped Judgments</h4>
                              <ul>
                                {copilotContextPacket.judgments.slice(0, 5).map((item, index) => (
                                  <li key={`copilot-context-judgment-${item.case_name || item.caseName || item.title || index}`}>
                                    <strong>{[item.case_name || item.caseName || item.title, item.citation].filter(Boolean).join(" | ")}</strong>
                                    {(item.authorityStatus || item.riskLevel) ? ` | ${item.authorityStatus || "verify"} | Risk ${item.riskLevel || "unknown"}` : ""}
                                    {item.judgmentDate ? ` | ${item.judgmentDate}` : ""}
                                    {item.sourceType ? ` | Source ${item.sourceType}` : ""}
                                    {item.holding ? <div className="muted-copy">{item.holding}</div> : null}
                                    {item.authorityWarning ? <div className="muted-copy">Caution: {item.authorityWarning}</div> : null}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      </>
                    ) : null}
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
                        {renderAuthorities(memoOutput.retrievedAuthorities, revalidateAuthorityNow, openJudgmentDetails, toggleCompareJudgment)}
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
                        {renderAuthorities(noticeOutput.retrievedAuthorities, revalidateAuthorityNow, openJudgmentDetails, toggleCompareJudgment)}
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
                        <option value="complaint">Complaint</option>
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
                  <button type="button" className="primary-button law-copilot-launch" onClick={openCopilotChat}>
                    Open Copilot Chat
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendWorkspaceToCopilot(lawyerTab === "document" ? docText : lawyerInput, lawyerTab === "document" ? "Document text" : "Matter facts")}
                  >
                    Send Current Text
                  </button>
                  {lawyerOutput?.draft ? (
                    <button type="button" className="ghost-button" onClick={() => sendWorkspaceToCopilot(lawyerOutput.draft, "Current draft")}>
                      Send Draft
                    </button>
                  ) : null}
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
                    {lawyerTab === "draft" && copilotDraftMeta?.fallbackUsed ? (
                      <div className="law-disclaimer" style={{ background: "#fff5d6", color: "#8a6500" }}>
                        AI provider output was not available, so this draft was generated in fallback mode.
                        {copilotDraftMeta.provider ? ` Provider: ${copilotDraftMeta.provider}.` : ""}
                        {copilotDraftMeta.diagnosticCode ? ` Code: ${copilotDraftMeta.diagnosticCode}.` : ""}
                        {copilotDraftMeta.failureReason ? ` Reason: ${copilotDraftMeta.failureReason}.` : ""}
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
                        {renderAuthorities(lawyerOutput.retrievedAuthorities, revalidateAuthorityNow, openJudgmentDetails, toggleCompareJudgment)}
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

      {hasRole.senior && mode === "senior" ? renderSeniorReviewWorkspace() : null}
      {hasRole.firm && mode === "firm" ? renderFirmWorkspace() : null}

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

      {mode === "lawyer" && copilotChatOpen ? (
        <div className="law-copilot-overlay" role="dialog" aria-modal="true" aria-label="Lawyer copilot chat">
          <div className="law-copilot-sheet">
            <div className="law-copilot-header">
              <button type="button" className="ghost-button law-copilot-back" onClick={closeCopilotChat}>
                Back
              </button>
              <div>
                <strong>Copilot Chat</strong>
                <p className="muted-copy">Use chat, screenshots, and workspace text to drive drafting changes.</p>
                <p className="muted-copy">
                  Session: {copilotBackendUnavailable ? "local-fallback" : copilotSessionId || "starting..."} | State: {copilotBackendUnavailable ? "local" : copilotSessionData?.session?.workflowState || "intake"}
                  {copilotSessionBusy ? " | Syncing..." : ""}
                </p>
              </div>
            </div>
            {copilotBackendUnavailable ? (
              <div className="law-disclaimer">
                Copilot backend is unavailable right now. Chat will continue in local fallback mode until the backend is reachable again.
              </div>
            ) : null}

            {showCopilotStarters ? (
              <div className="law-copilot-starters">
                {COPILOT_STARTERS.map((item) => (
                  <button key={item} type="button" className="law-plan-chip law-copilot-starter-chip" onClick={() => sendCopilotMessage(item)}>
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            {showCopilotStarters ? (
              <div className="law-copilot-context">
                <button type="button" className="ghost-button" onClick={() => sendWorkspaceToCopilot(lawyerTab === "document" ? docText : lawyerInput, lawyerTab === "document" ? "Document text" : "Matter facts")}>
                  Use Current Text
                </button>
                {lawyerOutput?.draft ? (
                  <button type="button" className="ghost-button" onClick={() => sendWorkspaceToCopilot(lawyerOutput.draft, "Current draft")}>
                    Use Draft
                  </button>
                ) : null}
                {lawyerOutput?.applicableSections?.length ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendWorkspaceToCopilot(lawyerOutput.applicableSections.join("\n"), "Current references")}
                  >
                    Use References
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="law-copilot-messages">
              {copilotMessages.map((item) => (
                <div key={item.id} className={item.role === "user" ? "law-copilot-bubble mine" : "law-copilot-bubble"}>
                  <div className="law-copilot-bubble-role">{item.role === "user" ? "You" : "Copilot"}</div>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>

            <form className="law-copilot-composer" onSubmit={handleCopilotSubmit}>
              {copilotAttachmentMeta ? (
                <div className="law-copilot-attachment">
                  <strong>{copilotAttachmentMeta.fileName || "Uploaded file"}</strong>
                  <span>
                    {copilotAttachmentMeta.mimeType || "document"}
                    {copilotAttachmentMeta.qualityScore ? ` | OCR ${copilotAttachmentMeta.qualityScore}%` : ""}
                  </span>
                </div>
              ) : null}
              <textarea
                rows={3}
                value={copilotInput}
                onChange={(event) => setCopilotInput(event.target.value)}
                onKeyDown={handleCopilotKeyDown}
                placeholder="Ask for draft changes, missing facts, legal basis, screenshot review, or reference guidance..."
              />
              <div className="law-inline-actions">
                <label className="ghost-button law-upload-button">
                  Attach File
                  <input
                    type="file"
                    hidden
                    onChange={(event) => handleCopilotFileUpload(event.target.files?.[0])}
                    accept=".txt,.md,.json,.csv,.pdf,image/*"
                  />
                </label>
                <button type="submit" className="primary-button">Send</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LawAssistantPage;
export {
  buildCaseUpsertPayload,
  buildClientUpsertPayload,
  getLocalReviewDraftStorageKey,
  getLocalSeniorSelectionStorageKey,
  getLocalFirmPreferencesStorageKey,
  readLocalFirmActions,
  readLocalFirmPreferences,
  readLocalReviewDrafts,
  writeLocalReviewDrafts,
  readLocalSeniorSelection,
  writeLocalSeniorSelection,
  writeLocalFirmActions,
  writeLocalFirmPreferences,
  buildReviewStatusPresentation,
  buildReviewQueue,
  buildReviewRecordPayload,
  buildReviewSnapshotRecord,
  buildFirmDashboard,
  buildFirmQueueView,
  buildApprovedSnapshotsFromReviews,
  buildReviewQueueSummary,
  buildSnapshotTraceSummary,
  buildSeniorReviewFacts,
  buildSeniorRiskFlags,
  buildCopilotIntakePayloadFromWorkspace,
  buildLocalCoverageOutput,
  buildLocalDocumentAnalysis,
  buildLocalJudgmentMatches,
  buildMatterPrepSheet,
  buildMatterResearchPrompt,
  buildMemoryResearchPrompt,
  buildLocalMemorySuggestions,
  buildMemorySavePayload,
  buildLocalNoticePack,
  buildLocalPredictionOutput,
  buildLocalResearchMemo,
  buildLocalResearchOutput,
  buildLocalMatterConsistencyOutput,
  buildLocalReadinessOutput,
  buildLocalStrengthOutput,
  buildChronology,
  buildReviewFindingReasons,
  buildReviewSummaryText,
  filterAuditLogs,
  getDateSeverity,
  buildResearchPromptFromIntake,
  buildTaskStatusUpdatePayload,
  buildTaskUpsertPayload,
  canApproveReview,
  buildSharedWorkspaceState,
  buildWorkspaceForwardMessage,
  deriveRoleAccess,
  buildLocalDraftValidationOutput,
  buildLocalFilingPackOutput,
  sanitizeFilingPackOutput,
  selectSeniorReviewItem,
  upsertReviewSnapshotList
};
