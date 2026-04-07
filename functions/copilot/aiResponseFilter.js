"use strict";

const BLOCKED_PATTERNS = [
  /\bshall i proceed\b/i,
  /\bshould i proceed\b/i,
  /\bwould you like me to start\b/i,
  /\bplease confirm\b/i,
  /\bconfirm to continue\b/i,
  /\btype start\b/i,
  /\blet me know if you want me to\b/i,
  /\bi can begin once you confirm\b/i,
  /\bdo you want me to proceed\b/i,
  /\bmay i continue\b/i
];

const EMPTY_OUTPUT_PATTERNS = [
  /^\s*(sure|okay|alright|understood|i can help)\.?\s*$/i,
  /^\s*(please confirm|confirm to proceed|shall i proceed).*/i
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsBlockedLanguage(text) {
  const normalized = normalizeText(text);
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasMeaningfulOutput(text, minimumLength = 120) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.length < minimumLength) return false;
  return !EMPTY_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function validateResponse(text) {
  const blocked = containsBlockedLanguage(text);
  const meaningful = hasMeaningfulOutput(text);

  return {
    accepted: !blocked && meaningful,
    blocked,
    meaningful,
    reason: blocked
      ? "blocked_language"
      : meaningful
        ? null
        : "empty_or_low_value_output"
  };
}

function buildRepairPrompt({ originalPrompt, rejectedOutput }) {
  return [
    "The previous response failed quality rules.",
    "",
    "Rejected response:",
    rejectedOutput || "[empty]",
    "",
    "Retry now with these mandatory rules:",
    "- Generate the full requested legal output immediately",
    "- Do not ask for confirmation",
    "- Do not ask whether to proceed",
    "- Do not describe what you will do",
    "- Use only the provided case facts and authorities",
    "- If critical facts are missing, state assumptions and continue",
    "",
    "Original prompt:",
    originalPrompt
  ].join("\n");
}

async function executeWithResponseFilter({
  executor,
  prompt,
  maxAttempts = 2,
  minimumLength = 120
}) {
  if (typeof executor !== "function") {
    throw new Error("executor must be a function");
  }

  let activePrompt = prompt;
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const output = await executor(activePrompt);
    const result = validateResponse(output, minimumLength);

    attempts.push({
      attempt,
      accepted: result.accepted,
      reason: result.reason,
      outputPreview: normalizeText(output).slice(0, 280)
    });

    if (result.accepted) {
      return {
        accepted: true,
        output,
        attempts
      };
    }

    activePrompt = buildRepairPrompt({
      originalPrompt: prompt,
      rejectedOutput: output
    });
  }

  return {
    accepted: false,
    output: "",
    attempts
  };
}

module.exports = {
  BLOCKED_PATTERNS,
  containsBlockedLanguage,
  hasMeaningfulOutput,
  validateResponse,
  buildRepairPrompt,
  executeWithResponseFilter
};
