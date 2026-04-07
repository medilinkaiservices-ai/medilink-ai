"use strict";

function formatList(items = []) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  return safeItems.length ? safeItems.map((item) => `- ${item}`).join("\n") : "- None";
}

function formatSections(items = []) {
  return formatList(items.map((item) => item.label || item.title || item.code || ""));
}

function formatJudgments(items = []) {
  return formatList(items.map((item) => [item.case_name, item.citation, item.holding].filter(Boolean).join(" | ")));
}

function formatParties(parties = {}) {
  return formatList([
    parties?.claimant ? `Claimant: ${parties.claimant}` : "",
    parties?.respondent ? `Respondent: ${parties.respondent}` : ""
  ]);
}

function buildGroundingRules(contextPacket = {}) {
  const rules = [
    "Use only the supplied facts and scoped authorities.",
    "Do not add FIR, police, constitutional, consumer, or unrelated remedies unless the facts clearly require them.",
    "If facts are missing, mark them as assumptions or placeholders instead of inventing specifics.",
    "Prefer current Indian law references and flag legacy citations for verification."
  ];

  if (contextPacket?.legacyLawNotice) {
    rules.push(`Legacy-law caution: ${contextPacket.legacyLawNotice}`);
  }

  if (String(contextPacket?.documentType || "").toLowerCase() === "complaint") {
    rules.push("For complaints, keep court-facing structure, jurisdiction, cause of action, grounds, and prayer explicit.");
  }
  if (String(contextPacket?.documentType || "").toLowerCase() === "notice") {
    rules.push("For notices, keep sender/recipient, subject, factual background, demand, and reservation of rights explicit.");
  }

  return rules;
}

function buildBasePrompt({ memory, task, rules = [], contextPacket }) {
  return [
    "You are a legal copilot for an Indian lawyer workspace.",
    "Generate usable professional work product directly.",
    "",
    "MATTER TYPE:",
    memory.caseType || contextPacket.documentType || "Not provided",
    "",
    "CASE FACTS:",
    memory.factsSummary || "Not provided",
    "",
    "WORKSPACE SUMMARY:",
    memory.workspaceSummary || "Not provided",
    "",
    "ISSUES:",
    formatList(memory.issues),
    "",
    "PARTIES:",
    formatParties(memory.parties),
    "",
    "RELIEF SOUGHT:",
    memory.reliefSought || "Not provided",
    "",
    "JURISDICTION:",
    memory.jurisdiction || "Not provided",
    "",
    "STAGE:",
    memory.stage || "Not provided",
    "",
    "DOCUMENT TYPE:",
    contextPacket.documentType || memory.documentType || "Not provided",
    "",
    "CURRENT WORKSPACE AUTHORITIES:",
    formatList(memory.workspaceAuthorities),
    "",
    "CURRENT DRAFT:",
    memory.workspaceDraft || "Not provided",
    "",
    "TASK:",
    task,
    "",
    "AUTHORITIES:",
    "SECTIONS:",
    formatSections(contextPacket.sections),
    "",
    "JUDGMENTS:",
    formatJudgments(contextPacket.judgments),
    "",
    "AUTHORITY SUMMARY:",
    contextPacket.authoritiesSummary || "No summary available",
    "",
    "RULES:",
    formatList([
      "generate full output",
      "do not ask for confirmation",
      "stay within context",
      ...buildGroundingRules(contextPacket),
      ...rules
    ])
  ].join("\n");
}

function buildDraftPrompt({ memory, documentType, contextPacket }) {
  return buildBasePrompt({
    memory,
    task: `Draft a complete ${documentType} for this matter.`,
    contextPacket: {
      ...contextPacket,
      documentType
    },
    rules: [
      `produce a full ${documentType}`,
      "cite only supplied authorities",
      "mark assumptions explicitly if facts are missing",
      "use headings and lawyer-ready structure",
      "keep the draft internally consistent with the supplied facts"
    ]
  });
}

function buildValidationPrompt({ memory, documentType, documentText, contextPacket }) {
  return [
    buildBasePrompt({
      memory,
      task: `Validate the attached ${documentType}.`,
      contextPacket: {
        ...contextPacket,
        documentType
      },
      rules: [
        "do not rewrite unless asked",
        `validate against ${documentType} structure`,
        "check for unsupported claims and citation gaps",
        "flag missing sections, weak support, and internal inconsistency"
      ]
    }),
    "",
    "DOCUMENT TEXT:",
    documentText || "Not provided"
  ].join("\n");
}

module.exports = {
  formatList,
  formatSections,
  formatJudgments,
  formatParties,
  buildDraftPrompt,
  buildValidationPrompt
};
