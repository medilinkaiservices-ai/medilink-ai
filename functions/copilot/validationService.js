"use strict";

const RULE_CONFIG = require("./legalValidationRules.json");

function normalizeText(value = "") {
  return String(value || "").replace(/\r/g, "\n");
}

function toLowerText(value = "") {
  return normalizeText(value).toLowerCase();
}

function uniq(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];
}

function hasPlaceholder(value = "") {
  const text = String(value || "").trim().toLowerCase();
  return !text || /\[.*?\]|assumption|to be inserted|not provided|placeholder|to be added|to be determined/.test(text);
}

function humanizeKey(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFormatting(value = "") {
  return String(value || "").replace(/\*\*/g, "").trim();
}

function cleanExtractedValue(value = "") {
  const cleaned = stripFormatting(value).replace(/^[\s:.-]+|[\s,.;]+$/g, "").trim();
  return cleaned && !hasPlaceholder(cleaned) ? cleaned : "";
}

function normalizeAgeValue(value = "") {
  return cleanExtractedValue(value).replace(/\byears?\b/gi, "").trim();
}

function extractBlockByHeading(sourceText = "", heading = "", stopHeadings = []) {
  if (!heading) return "";
  const stopPattern = stopHeadings.length
    ? stopHeadings.map((item) => escapeRegExp(item)).join("|")
    : "$^";
  const regex = new RegExp(`${escapeRegExp(heading)}\\s*:?\\s*([\\s\\S]{0,500}?)(?=\\n\\s*(?:${stopPattern})\\s*:|$)`, "i");
  return String(sourceText.match(regex)?.[1] || "").trim();
}

function detectPropertyBoundaries(documentText = "") {
  const text = normalizeText(documentText);
  const directions = ["North", "South", "East", "West"];

  const results = directions.map((direction) => {
    const match = text.match(new RegExp(`${direction}\\s*:\\s*([^\\n]+)`, "i"));
    const value = match ? String(match[1] || "").trim() : "";
    return {
      direction,
      value,
      present: Boolean(value) && !hasPlaceholder(value)
    };
  });

  return {
    fields: results,
    complete: results.every((item) => item.present)
  };
}

function extractCombinedMemoryText(memory = {}) {
  const generatedDocuments = Array.isArray(memory.generatedDocuments)
    ? memory.generatedDocuments.map((item) => item?.content || "").filter(Boolean).join("\n\n")
    : "";

  return normalizeText([
    memory.caseType,
    memory.factsSummary,
    memory.jurisdiction,
    memory.stage,
    memory.reliefSought,
    memory.workspaceSummary,
    memory.workspaceDraft,
    generatedDocuments,
    memory.parties?.claimant,
    memory.parties?.respondent
  ].filter(Boolean).join("\n\n"));
}

function detectCauseOfActionDate(documentText = "") {
  const text = normalizeText(documentText);
  const focusSlice = text.match(/cause of action[\s\S]{0,400}/i)?.[0] || text;
  return /(\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)? day of [A-Za-z]+,?\s*\d{4}\b|\b[A-Za-z]+ \d{1,2}, \d{4}\b)/i.test(focusSlice);
}

function detectSections(documentText = "") {
  const text = toLowerText(documentText);
  return {
    sender_details: /from|sender/.test(text),
    recipient_details: /to|recipient/.test(text),
    subject: /subject/.test(text),
    factual_background: /facts|background/.test(text),
    facts: /facts|factual background|brief facts|facts of the case/.test(text),
    legal_response: /legal|grounds|response/.test(text),
    reservation_of_rights: /rights|reserved/.test(text),
    parties: /complainant|plaintiff|respondent|defendant|petitioner|accused/.test(text),
    cause_of_action: /cause of action/.test(text),
    jurisdiction: /jurisdiction/.test(text),
    grounds: /grounds/.test(text),
    prayer: /prayer|relief/.test(text),
    title: /affidavit/.test(text),
    deponent_details: /deponent/.test(text),
    statements_on_oath: /solemnly affirm|state as follows/.test(text),
    verification: /verification|verified at/.test(text),
    schedule_of_property: /schedule of property|schedule property|property schedule/.test(text),
    valuation: /valuation|court fee|value of the suit|valued at/.test(text),
    addresses: /residing at|address/.test(text)
  };
}

function detectDocumentTypes(documentText = "") {
  const text = toLowerText(documentText);
  return Object.entries(RULE_CONFIG.documentTypeSignals || {})
    .map(([type, signals]) => {
      const matchedSignals = (Array.isArray(signals) ? signals : [])
        .filter((signal) => text.includes(String(signal || "").toLowerCase()));
      return {
        type,
        matchedSignals
      };
    })
    .filter((item) => item.matchedSignals.length)
    .sort((a, b) => b.matchedSignals.length - a.matchedSignals.length);
}

function resolveProfileKey(documentType = "", detectedTypes = []) {
  const explicit = String(documentType || "").trim().toLowerCase();
  if (explicit && RULE_CONFIG.profiles?.[explicit]) {
    return explicit;
  }
  if (explicit === "plaint" || explicit === "petition" || explicit === "ia") {
    return "complaint";
  }

  const detectedPrimary = detectedTypes[0]?.type || "";
  if (detectedPrimary && RULE_CONFIG.profiles?.[detectedPrimary]) {
    return detectedPrimary;
  }
  if (["plaint", "petition", "ia"].includes(detectedPrimary)) {
    return "complaint";
  }

  return "complaint";
}

function buildCriticalityMap(profile = {}) {
  const criticalSections = new Set(Array.isArray(profile.critical) ? profile.critical : []);
  return (sectionKey) => criticalSections.has(sectionKey);
}

function safePush(target, value) {
  if (value) target.push(value);
}

function computeScore({ criticalErrors = [], warnings = [] }) {
  return Math.max(0, 100 - (criticalErrors.length * 24) - (warnings.length * 9));
}

function replaceFirstMatchingLine(text, matcher, replacement) {
  const lines = normalizeText(text).split("\n");
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (!replaced && matcher.test(line)) {
      replaced = true;
      return replacement;
    }
    return line;
  });
  return {
    text: nextLines.join("\n"),
    replaced
  };
}

function insertAfterFirstMatchingLine(text, matcher, insertion) {
  const lines = normalizeText(text).split("\n");
  const nextLines = [];
  let inserted = false;

  lines.forEach((line) => {
    nextLines.push(line);
    if (!inserted && matcher.test(line)) {
      nextLines.push(insertion);
      inserted = true;
    }
  });

  return {
    text: nextLines.join("\n"),
    inserted
  };
}

function cleanDraftWhitespace(text = "") {
  return normalizeText(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractValuationCandidate(sourceText = "") {
  const text = normalizeText(sourceText);
  const contextualSlice = text.match(/(?:valuation|court fee|value of the suit)[\s\S]{0,180}/i)?.[0] || text;
  const match = contextualSlice.match(/(Rs\.?\s*[\d,]+(?:\/-)?(?:\s*\([^)]+\))?[^.\n]*)/i)
    || text.match(/(Rs\.?\s*[\d,]+(?:\/-)?(?:\s*\([^)]+\))?[^.\n]*)/i);
  const candidate = String(match?.[1] || "").trim();
  return candidate && !hasPlaceholder(candidate) ? candidate : "";
}

function extractCauseOfActionCandidate(sourceText = "") {
  const text = normalizeText(sourceText);
  const contextualSlice = text.match(/(?:cause of action|arose on|dated|on)\s*[\s\S]{0,160}/i)?.[0] || text;
  const match = contextualSlice.match(/(\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b[A-Za-z]+ \d{1,2}, \d{4}\b|\b\d{1,2}(?:st|nd|rd|th)? day of [A-Za-z]+,?\s*\d{4}\b)/i);
  return String(match?.[1] || "").trim();
}

function extractBoundaryCandidates(sourceText = "") {
  const text = normalizeText(sourceText);
  return ["North", "South", "East", "West"].reduce((acc, direction) => {
    const match = text.match(new RegExp(`${direction}\\s*:\\s*([^\\n]+)`, "i"));
    const value = String(match?.[1] || "").trim();
    if (value && !hasPlaceholder(value)) {
      acc[direction] = value;
    }
    return acc;
  }, {});
}

function extractLabeledValue(blockText = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(blockText || "").match(pattern);
    const candidate = cleanExtractedValue(match?.[1] || "");
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function extractPartyDetails(sourceText = "", roleLabel = "", fallbackName = "") {
  const block = extractBlockByHeading(sourceText, `${roleLabel} additional details`, [
    "Plaintiff additional details",
    "Defendant additional details",
    "Suit valuation",
    "Property boundaries",
    "Verification details"
  ]);

  let fatherName = extractLabeledValue(block, [/father(?:'s)? name\s*:\s*([^\n]+)/i]);
  let age = normalizeAgeValue(extractLabeledValue(block, [/age\s*:\s*([^\n]+)/i]));
  let address = extractLabeledValue(block, [/full address\s*:\s*([^\n]+)/i, /address\s*:\s*([^\n]+)/i]);

  if ((!fatherName || !age || !address) && fallbackName) {
    const contextualRegex = new RegExp(
      `${escapeRegExp(fallbackName)}[\\s\\S]{0,220}?S\\/o\\s*(?:\\*\\*)?([^\\n,*]+?)(?:\\*\\*)?[,\\n][\\s\\S]{0,120}?Aged about\\s*(?:\\*\\*)?([^\\n,*]+?)(?:\\*\\*)?\\s*years?[\\s\\S]{0,160}?Residing at\\s*(?:\\*\\*)?([^\\n]+?)(?:\\*\\*)?(?:,|\\n)`,
      "i"
    );
    const contextualMatch = String(sourceText || "").match(contextualRegex);
    fatherName = fatherName || cleanExtractedValue(contextualMatch?.[1] || "");
    age = age || normalizeAgeValue(contextualMatch?.[2] || "");
    address = address || cleanExtractedValue(contextualMatch?.[3] || "");
  }

  return {
    name: cleanExtractedValue(fallbackName),
    fatherName,
    age,
    address
  };
}

function ordinalize(dayNumber) {
  const day = Number(dayNumber);
  if (!Number.isFinite(day)) return String(dayNumber || "").trim();
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  const mod = day % 10;
  if (mod === 1) return `${day}st`;
  if (mod === 2) return `${day}nd`;
  if (mod === 3) return `${day}rd`;
  return `${day}th`;
}

function formatVerificationDate(value = "") {
  const cleaned = cleanExtractedValue(value);
  if (!cleaned) return "";
  if (/day of/i.test(cleaned)) return cleaned;
  if (/^[A-Za-z]+\s+\d{1,2},\s*\d{4}$/i.test(cleaned)) return cleaned;

  const match = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!match) {
    return cleaned;
  }

  const day = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const monthDate = new Date(year, monthIndex, day);
  if (Number.isNaN(monthDate.getTime())) {
    return cleaned;
  }

  return `${ordinalize(day)} day of ${monthDate.toLocaleString("en-IN", { month: "long" })}, ${year}`;
}

function extractVerificationDetails(sourceText = "") {
  const block = extractBlockByHeading(sourceText, "Verification details", [
    "Plaintiff additional details",
    "Defendant additional details",
    "Suit valuation",
    "Property boundaries"
  ]);
  const place = extractLabeledValue(block, [/place\s*:\s*([^\n]+)/i]);
  const date = formatVerificationDate(extractLabeledValue(block, [/date\s*:\s*([^\n]+)/i]));
  return { place, date };
}

function inferPartyNameFromDraft(documentText = "", role = "claimant") {
  const text = normalizeText(documentText);
  const claimantMatch = text.match(/between[\s\S]{0,120}?\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}\s*\n\s*S\/o/i)
    || text.match(/complainant[\s:\-]*\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}/i)
    || text.match(/plaintiff[\s:\-]*\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}/i);
  const respondentMatch = text.match(/\n\s*and\s*\n[\s\S]{0,120}?\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}\s*\n\s*S\/o/i)
    || text.match(/accused[\s:\-]*\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}/i)
    || text.match(/defendant[\s:\-]*\*{0,2}([A-Za-z][A-Za-z\s.'-]+)\*{0,2}/i);

  return cleanExtractedValue(role === "respondent" ? respondentMatch?.[1] : claimantMatch?.[1]);
}

function replaceExplicitPlaceholderTokens(text = "", replacements = {}) {
  let nextText = String(text || "");
  Object.entries(replacements).forEach(([token, value]) => {
    if (!value) return;
    const matcher = new RegExp(escapeRegExp(token), "g");
    nextText = nextText.replace(matcher, value);
  });
  return nextText;
}

function replaceFieldAfterName(text = "", partyName = "", fieldPattern = "", replacement = "") {
  if (!partyName || !fieldPattern || !replacement) {
    return text;
  }

  const regex = new RegExp(
    `(${escapeRegExp(partyName)}[\\s\\S]{0,280}?${fieldPattern}\\s*)(?:\\*\\*)?\\[[^\\]]+\\](?:\\*\\*)?`,
    "gi"
  );
  return String(text || "").replace(regex, `$1${replacement}`);
}

function applyPartyDetailsToDraft(text = "", claimant = {}, respondent = {}) {
  let nextText = String(text || "");

  nextText = replaceExplicitPlaceholderTokens(nextText, {
    "[PLAINTIFF'S FATHER'S NAME]": claimant.fatherName,
    "[PLAINTIFF'S AGE]": claimant.age,
    "[PLAINTIFF'S COMPLETE ADDRESS]": claimant.address,
    "[DEFENDANT'S FATHER'S NAME]": respondent.fatherName,
    "[DEFENDANT'S AGE]": respondent.age,
    "[DEFENDANT'S COMPLETE ADDRESS]": respondent.address
  });

  nextText = replaceFieldAfterName(nextText, claimant.name, "(?:S\\/o|D\\/o|son of)", claimant.fatherName);
  nextText = replaceFieldAfterName(nextText, claimant.name, "Aged about", claimant.age);
  nextText = replaceFieldAfterName(nextText, claimant.name, "Residing at", claimant.address);
  nextText = replaceFieldAfterName(nextText, respondent.name, "(?:S\\/o|D\\/o|son of)", respondent.fatherName);
  nextText = replaceFieldAfterName(nextText, respondent.name, "Aged about", respondent.age);
  nextText = replaceFieldAfterName(nextText, respondent.name, "Residing at", respondent.address);

  return nextText;
}

function applyVerificationDetailsToDraft(text = "", details = {}) {
  const place = cleanExtractedValue(details.place || "");
  const date = formatVerificationDate(details.date || "");
  if (!place && !date) {
    return text;
  }

  const replacementLine = date
    ? `Verified at ${place || "[PLACE]"} on this the ${date}.`
    : `Verified at ${place}.`;

  if (/Verified at .*$/im.test(text)) {
    return String(text).replace(/Verified at .*$/im, replacementLine);
  }

  return cleanDraftWhitespace(`${text}\n\n${replacementLine}`);
}

function removeIaMixedContent(documentText = "") {
  const paragraphs = normalizeText(documentText)
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  const filtered = paragraphs.filter((paragraph) => !/order xxxix|order 39|temporary injunction|interim injunction|interlocutory application|i\.a\./i.test(paragraph));
  return {
    text: cleanDraftWhitespace(filtered.join("\n\n")),
    changed: filtered.length !== paragraphs.length
  };
}

function autoFixDocument({ documentType, documentText, contextPacket, memory = {} }) {
  const initialReport = validateDocument({
    documentType,
    documentText,
    contextPacket,
    memory
  });

  let nextText = cleanDraftWhitespace(documentText);
  const fixesApplied = [];
  const sourceText = extractCombinedMemoryText(memory);
  const plaintLike = ["plaint", "complaint"].includes(initialReport.primaryDocumentType) || /plaint|suit for permanent injunction/i.test(nextText);
  const claimantName = cleanExtractedValue(memory.parties?.claimant || inferPartyNameFromDraft(nextText, "claimant"));
  const respondentName = cleanExtractedValue(memory.parties?.respondent || inferPartyNameFromDraft(nextText, "respondent"));
  const claimantDetails = extractPartyDetails(sourceText, "Plaintiff", claimantName);
  const respondentDetails = extractPartyDetails(sourceText, "Defendant", respondentName);
  const verificationDetails = extractVerificationDetails(sourceText);

  if (initialReport.criticalErrors.includes("IA content mixed with plaint.") && plaintLike) {
    const removed = removeIaMixedContent(nextText);
    if (removed.changed) {
      nextText = removed.text;
      fixesApplied.push("Removed interim / IA content from the main plaint");
    }
  }

  if (initialReport.criticalErrors.includes("Suit valuation required.")) {
    const valuationCandidate = extractValuationCandidate(sourceText);
    if (valuationCandidate) {
      const valuationLine = `The value of the suit for the purpose of jurisdiction and court fee is fixed at ${valuationCandidate}.`;
      const replacement = replaceFirstMatchingLine(nextText, /value of the suit|valuation|court fee/i, valuationLine);
      nextText = replacement.replaced
        ? replacement.text
        : cleanDraftWhitespace(`${nextText}\n\nJURISDICTION AND VALUATION\n${valuationLine}`);
      fixesApplied.push("Inserted suit valuation from workspace facts");
    }
  }

  if (initialReport.criticalErrors.includes("Cause of action not defined with a usable date.")) {
    const causeDate = extractCauseOfActionCandidate(sourceText);
    if (causeDate) {
      const causeLine = `The cause of action first arose on ${causeDate} and continues thereafter.`;
      if (/cause of action/i.test(nextText)) {
        const insertion = insertAfterFirstMatchingLine(nextText, /cause of action/i, causeLine);
        nextText = insertion.inserted ? insertion.text : nextText;
      } else {
        nextText = cleanDraftWhitespace(`${nextText}\n\nCAUSE OF ACTION\n${causeLine}`);
      }
      fixesApplied.push("Inserted cause of action date from workspace facts");
    }
  }

  if (initialReport.criticalErrors.includes("Property schedule incomplete.")) {
    const boundaries = extractBoundaryCandidates(sourceText);
    const directions = ["North", "South", "East", "West"];
    const hasAllBoundaries = directions.every((direction) => boundaries[direction]);

    if (hasAllBoundaries) {
      directions.forEach((direction) => {
        const lineReplacement = `${direction}: ${boundaries[direction]}`;
        const replaced = replaceFirstMatchingLine(nextText, new RegExp(`^\\s*${direction}\\s*:`, "i"), lineReplacement);
        nextText = replaced.replaced ? replaced.text : cleanDraftWhitespace(`${nextText}\n${lineReplacement}`);
      });
      if (!/schedule of property|schedule property|property schedule/i.test(nextText)) {
        nextText = cleanDraftWhitespace(`${nextText}\n\nSCHEDULE OF PROPERTY\nNorth: ${boundaries.North}\nSouth: ${boundaries.South}\nEast: ${boundaries.East}\nWest: ${boundaries.West}`);
      }
      fixesApplied.push("Inserted property boundaries from workspace facts");
    }
  }

  const partyFilledText = applyPartyDetailsToDraft(nextText, claimantDetails, respondentDetails);
  if (partyFilledText !== nextText) {
    nextText = partyFilledText;
    fixesApplied.push("Filled party placeholders from workspace facts");
  }

  const verificationFilledText = applyVerificationDetailsToDraft(nextText, verificationDetails);
  if (verificationFilledText !== nextText) {
    nextText = verificationFilledText;
    fixesApplied.push("Filled verification place and date from workspace facts");
  }

  nextText = cleanDraftWhitespace(nextText);
  const report = validateDocument({
    documentType,
    documentText: nextText,
    contextPacket,
    memory
  });

  return {
    documentText: nextText,
    initialReport,
    report,
    fixesApplied,
    changed: nextText !== cleanDraftWhitespace(documentText)
  };
}

function validateDocument({ documentType, documentText, contextPacket, memory = {} }) {
  const normalizedDocumentType = String(documentType || "").trim().toLowerCase();
  const documentBody = normalizeText(documentText);
  const lowerText = toLowerText(documentBody);
  const profileKey = resolveProfileKey(normalizedDocumentType, detectDocumentTypes(documentBody));
  const profile = RULE_CONFIG.profiles?.[profileKey];

  if (!profile) {
    throw new Error(`Unsupported document type: ${documentType}`);
  }

  const detectedSections = detectSections(documentBody);
  const documentSignals = detectDocumentTypes(documentBody);
  const primaryDocumentType = documentSignals[0]?.type || normalizedDocumentType || profileKey;
  const isCriticalSection = buildCriticalityMap(profile);
  const missingSections = [];
  const weakSections = [];
  const unsupportedClaims = [];
  const citationIssues = [];
  const proceduralGaps = [];
  const criticalErrors = [];
  const warnings = [];
  const passedChecks = [];
  const suggestions = [];

  (profile.required || []).forEach((sectionKey) => {
    if (detectedSections[sectionKey]) {
      safePush(passedChecks, `${humanizeKey(sectionKey)} present`);
      return;
    }

    missingSections.push(sectionKey);
    if (isCriticalSection(sectionKey)) {
      criticalErrors.push(`${humanizeKey(sectionKey)} missing from the draft.`);
      suggestions.push(`Add a complete ${humanizeKey(sectionKey).toLowerCase()} section.`);
    } else {
      warnings.push(`${humanizeKey(sectionKey)} section should be strengthened or added.`);
      weakSections.push(sectionKey);
      suggestions.push(`Review and complete the ${humanizeKey(sectionKey).toLowerCase()} section.`);
    }
  });

  const authoritiesText = JSON.stringify(contextPacket || {}).toLowerCase();
  if (/section \d+/i.test(documentBody) && !authoritiesText.includes("section")) {
    citationIssues.push("Document references sections not present in the scoped context.");
    warnings.push("Section references should be rechecked against the scoped authorities.");
    suggestions.push("Verify every cited section against the selected legal support.");
  } else if (/section \d+/i.test(documentBody)) {
    passedChecks.push("Section references appear grounded in the scoped context");
  }

  const boundaryInfo = detectPropertyBoundaries(documentBody);
  const propertyContextText = `${toLowerText(memory.caseType)} ${toLowerText(memory.factsSummary)} ${lowerText}`;
  const propertyMatter = /injunction|property|land|survey|ancestral|schedule property|agricultural/.test(propertyContextText);

  if (propertyMatter) {
    if (!boundaryInfo.complete) {
      criticalErrors.push("Property schedule incomplete.");
      proceduralGaps.push("Property boundaries are incomplete or still placeholder-based.");
      suggestions.push("Add complete North, South, East, and West boundaries in the schedule of property.");
    } else {
      passedChecks.push("Property boundaries present");
    }
  }

  if (detectedSections.valuation && !hasPlaceholder(documentBody.match(/(?:valuation|court fee|value of the suit)[^\n]*/i)?.[0] || "")) {
    passedChecks.push("Suit valuation present");
  } else if (profileKey === "complaint") {
    criticalErrors.push("Suit valuation required.");
    proceduralGaps.push("Valuation / court fee details are missing or still placeholders.");
    suggestions.push("Insert the suit valuation and court-fee basis before filing.");
  }

  if (detectedSections.cause_of_action && detectCauseOfActionDate(documentBody)) {
    passedChecks.push("Cause of action date present");
  } else if (profileKey === "complaint") {
    criticalErrors.push("Cause of action not defined with a usable date.");
    proceduralGaps.push("Cause of action date is missing or unclear.");
    suggestions.push("Add the cause of action date and link it to the pleaded incident chronology.");
  }

  if (detectedSections.parties) {
    passedChecks.push("Parties section present");
  }

  if (detectedSections.addresses && !hasPlaceholder(documentBody.match(/(?:residing at|address)[^\n]*/i)?.[0] || "")) {
    passedChecks.push("Address details present");
  } else if (profileKey !== "notice") {
    warnings.push("Party address details look incomplete.");
    suggestions.push("Confirm complete addresses for all parties before filing.");
  }

  const plaintLikeDocument = ["plaint", "complaint"].includes(primaryDocumentType) || /plaint|suit for permanent injunction|plaintiff above named/i.test(documentBody);
  const hasIaContent = /order xxxix|order 39|temporary injunction|interim injunction|interlocutory application|i\.a\./i.test(lowerText);
  if (plaintLikeDocument && hasIaContent) {
    criticalErrors.push("IA content mixed with plaint.");
    unsupportedClaims.push("Interim / Order XXXIX content appears inside the main plaint.");
    suggestions.push("Generate a separate I.A. / interlocutory application instead of mixing interim relief content into the plaint.");
  } else if (plaintLikeDocument) {
    passedChecks.push("No obvious IA mix detected inside the plaint");
  }

  const distinctTypes = uniq(documentSignals.map((item) => item.type));
  if (distinctTypes.length >= 2) {
    warnings.push(`Multiple document types detected: ${distinctTypes.join(", ")}.`);
    suggestions.push("Split plaint, affidavit, petition, and I.A. content into separate documents.");
  } else if (distinctTypes.length === 1) {
    passedChecks.push(`Primary document type detected as ${distinctTypes[0]}`);
  }

  const injunctionAncestral = /injunction/.test(propertyContextText) && /ancestral|unpartitioned/.test(propertyContextText);
  if (injunctionAncestral) {
    warnings.push("Possible title dispute detected for ancestral / unpartitioned property.");
    suggestions.push("Consider whether declaration or partition relief is needed in addition to injunction.");
  }

  if (/\[.*?\]|assumption|to be inserted|not provided|placeholder/i.test(documentBody)) {
    warnings.push("Draft still contains placeholders or assumption markers.");
    suggestions.push("Replace all placeholders and assumptions before filing.");
  } else {
    passedChecks.push("No visible placeholders detected");
  }

  const dedupedCriticalErrors = uniq(criticalErrors);
  const dedupedWarnings = uniq(warnings.filter((item) => !dedupedCriticalErrors.includes(item)));
  const dedupedPassedChecks = uniq(passedChecks);
  const dedupedSuggestions = uniq(suggestions);
  const score = computeScore({
    criticalErrors: dedupedCriticalErrors,
    warnings: dedupedWarnings
  });

  let status = "passed";
  let statusLabel = "Validation passed";
  if (dedupedCriticalErrors.length) {
    status = "critical";
    statusLabel = "Needs correction before filing";
  } else if (dedupedWarnings.length) {
    status = "warnings";
    statusLabel = "Needs review before filing";
  }

  return {
    status,
    statusLabel,
    score,
    counts: {
      errors: dedupedCriticalErrors.length,
      warnings: dedupedWarnings.length
    },
    primaryDocumentType,
    detectedDocumentTypes: documentSignals.map((item) => ({
      type: item.type,
      matchedSignals: item.matchedSignals
    })),
    missingSections,
    weakSections,
    unsupportedClaims: uniq(unsupportedClaims),
    citationIssues: uniq(citationIssues),
    proceduralGaps: uniq(proceduralGaps),
    criticalErrors: dedupedCriticalErrors,
    warnings: dedupedWarnings,
    passedChecks: dedupedPassedChecks,
    suggestions: dedupedSuggestions,
    suggestedFixes: dedupedSuggestions
  };
}

module.exports = {
  validateDocument,
  autoFixDocument
};
