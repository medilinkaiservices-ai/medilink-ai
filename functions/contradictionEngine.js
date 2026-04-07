function normalizeLines(text = "") {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildDateMap(lines = [], source) {
  const entries = [];
  lines.forEach((line) => {
    const matches = line.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    matches.forEach((date) => {
      entries.push({ date, line, source });
    });
  });
  return entries;
}

function detectCrossSourceDateConflicts(sources = []) {
  const normalized = sources.flatMap((item) => buildDateMap(item.lines || [], item.label));
  const grouped = new Map();

  normalized.forEach((item) => {
    const bucket = grouped.get(item.date) || [];
    bucket.push(item);
    grouped.set(item.date, bucket);
  });

  const conflicts = [];
  grouped.forEach((items, date) => {
    const uniqueSources = [...new Set(items.map((item) => item.source))];
    if (uniqueSources.length < 2) return;
    const uniqueLines = [...new Set(items.map((item) => item.line.toLowerCase()))];
    if (uniqueLines.length > 1) {
      conflicts.push(`Date reference ${date} appears differently across ${uniqueSources.join(", ")}.`);
    }
  });

  return conflicts.slice(0, 6);
}

function detectMissingIssueCoverage(issues = [], combinedText = "") {
  const lowered = String(combinedText || "").toLowerCase();
  return (Array.isArray(issues) ? issues : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((issue) => {
      const tokens = issue.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
      return tokens.length && !tokens.some((token) => lowered.includes(token));
    })
    .slice(0, 6)
    .map((issue) => `Issue not clearly supported across current matter materials: ${issue}.`);
}

function detectDraftVsFactsConflicts(facts = "", draftText = "") {
  const factLines = normalizeLines(facts).slice(0, 8);
  const loweredDraft = String(draftText || "").toLowerCase();

  return factLines
    .filter((line) => line.length > 20)
    .filter((line) => {
      const key = line.toLowerCase().slice(0, Math.min(line.length, 35));
      return key && !loweredDraft.includes(key);
    })
    .slice(0, 5)
    .map((line) => `Draft does not clearly reflect this fact: ${line}`);
}

function detectArgumentWarnings(argumentOutput = null) {
  if (!argumentOutput || !Array.isArray(argumentOutput.warnings)) return [];
  return argumentOutput.warnings
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => `Argument set warning: ${item}`);
}

function detectNarrativeWeaknesses(facts = "", chronologyText = "", hearingNotes = "") {
  const flags = [];
  const combined = `${facts}\n${chronologyText}\n${hearingNotes}`;

  if (!String(facts || "").trim()) {
    flags.push("Core facts are missing or too thin for a stable matter narrative.");
  }
  if (!String(chronologyText || "").trim()) {
    flags.push("Chronology is missing, which makes sequence-sensitive arguments weaker.");
  }
  if (/unknown|unclear|maybe|perhaps|not sure/i.test(combined)) {
    flags.push("Matter materials contain uncertainty markers that should be resolved before filing.");
  }
  if (!/\b\d{4}-\d{2}-\d{2}\b/.test(combined)) {
    flags.push("No reliable dated events were found across the current matter materials.");
  }

  return flags.slice(0, 6);
}

function buildSuggestions(contradictions = [], missingCoverage = [], weaknesses = []) {
  const suggestions = [];

  if (contradictions.length) {
    suggestions.push("Resolve date and fact mismatches between intake, chronology, and supporting material before drafting the final pleading.");
  }
  if (missingCoverage.length) {
    suggestions.push("Add issue-wise support in facts, documents, or draft text for the uncovered issues.");
  }
  if (weaknesses.some((item) => /chronology/i.test(item))) {
    suggestions.push("Prepare a clean dated chronology and align all drafts and notices to it.");
  }
  if (weaknesses.some((item) => /uncertainty/i.test(item))) {
    suggestions.push("Replace uncertain language with verified facts or mark those statements for lawyer confirmation.");
  }

  return suggestions.slice(0, 6);
}

function analyzeMatterContradictions(input = {}) {
  const facts = String(input.facts || "").trim();
  const chronologyText = String(input.chronologyText || "").trim();
  const hearingNotes = String(input.hearingNotes || "").trim();
  const draftText = String(input.draftText || "").trim();
  const documentSummary = String(input.documentAnalysis?.summary || "").trim();
  const documentContradictions = Array.isArray(input.documentAnalysis?.contradictionsWithCase)
    ? input.documentAnalysis.contradictionsWithCase
    : [];
  const issues = Array.isArray(input.issues) ? input.issues : [];

  const sourceBuckets = [
    { label: "Facts", lines: normalizeLines(facts) },
    { label: "Chronology", lines: normalizeLines(chronologyText) },
    { label: "Hearing notes", lines: normalizeLines(hearingNotes) },
    { label: "Draft", lines: normalizeLines(draftText) }
  ].filter((item) => item.lines.length);

  const contradictions = [
    ...detectCrossSourceDateConflicts(sourceBuckets),
    ...documentContradictions,
    ...detectDraftVsFactsConflicts(facts, draftText),
    ...detectArgumentWarnings(input.argumentOutput)
  ].filter((item, index, list) => list.indexOf(item) === index);

  const missingCoverage = detectMissingIssueCoverage(
    issues,
    [facts, chronologyText, hearingNotes, draftText, documentSummary].filter(Boolean).join("\n")
  );
  const weaknesses = detectNarrativeWeaknesses(facts, chronologyText, hearingNotes);
  const suggestions = buildSuggestions(contradictions, missingCoverage, weaknesses);

  const totalSignals = contradictions.length + missingCoverage.length + weaknesses.length;
  const consistencyScore = Math.max(0, Math.min(100, 88 - (contradictions.length * 14) - (missingCoverage.length * 8) - (weaknesses.length * 6)));

  return {
    consistencyScore,
    consistencyLevel: consistencyScore >= 75 ? "ALIGNED" : consistencyScore >= 50 ? "CAUTION" : "CONFLICTED",
    summary: consistencyScore >= 75
      ? "The current matter materials are broadly aligned, with no major contradiction pattern detected."
      : consistencyScore >= 50
        ? "Some mismatch or coverage gaps exist across facts, chronology, documents, or draft text."
        : "Material contradictions or narrative gaps should be resolved before relying on this matter record.",
    contradictions: contradictions.slice(0, 10),
    missingCoverage,
    narrativeWeaknesses: weaknesses,
    suggestions,
    signalCount: totalSignals
  };
}

module.exports = {
  analyzeMatterContradictions
};
