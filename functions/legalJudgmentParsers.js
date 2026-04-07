function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")));
}

function buildAbsoluteUrl(baseUrl, href) {
  const rawHref = String(href || "").trim();
  if (!rawHref) return "";
  if (/^https?:\/\//i.test(rawHref)) return rawHref;
  try {
    return new URL(rawHref, baseUrl).toString();
  } catch {
    return rawHref;
  }
}

function toUniqueStrings(values = [], limit = 12) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function extractDate(value) {
  const text = normalizeWhitespace(value);
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
    /\b(\d{1,2}-\d{1,2}-\d{4})\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function extractCaseNumber(text = "") {
  const source = normalizeWhitespace(text);
  const patterns = [
    /\b(?:W\.?P\.?|Writ Petition|Crl\.?A\.?|Criminal Appeal|Civil Appeal|C\.?A\.?|LPA|SLP(?:\(C\))?|O\.?S\.?|Suit|RFA|RSA|CRP|CMP|MFA|M\.?A\.?|Appeal|Petition)\s*(?:No\.?|Nos\.?)?\s*[\w./()-]+\s*(?:of\s*\d{4})?/i,
    /\bCase\s*(?:No\.?|Nos\.?)\s*[\w./()-]+\s*(?:of\s*\d{4})?/i,
    /\b[A-Z]{1,6}\s*\d+\/\d{4}\b/
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeWhitespace(match[0]);
  }
  return "";
}

function extractBench(text = "") {
  const source = normalizeWhitespace(text);
  const patterns = [
    /\b(?:Coram|Before|Bench)\s*[:\-]\s*([^|;]+)/i,
    /\b(?:Single Judge|Division Bench|Full Bench|Constitution Bench|Two-Judge Bench|Three-Judge Bench|Seven-Judge Bench|Nine-Judge Bench|Thirteen-Judge Bench)\b/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeWhitespace(match[1] || match[0]);
  }
  return "";
}

function extractNeutralCitation(text = "") {
  const source = normalizeWhitespace(text);
  const patterns = [
    /\b\d{4}\s+SCC\s+OnLine\s+[A-Za-z]+\s+\d+\b/i,
    /\b\d{4}\s+SCC\s+Online\s+[A-Za-z]+\s+\d+\b/i,
    /\b\d{4}\s+[A-Z]{2,6}\s+\d+\b/,
    /\b\d{4}[:\-][A-Z]{2,10}[:\-]\d+\b/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeWhitespace(match[0]);
  }
  return "";
}

function inferPartyNames(title = "") {
  const source = normalizeWhitespace(title);
  const match = source.match(/^(.+?)\s+\b(?:v(?:s\.?|ersus)?)\b\s+(.+)$/i);
  if (!match) return [];
  return toUniqueStrings([match[1], match[2]], 4);
}

function cleanTitleSegment(value = "") {
  return normalizeWhitespace(
    String(value || "")
      .replace(/\buploaded on\b.*$/i, " ")
      .replace(/\bdated\b.*$/i, " ")
      .replace(/\bdownload\b/i, " ")
      .replace(/\bview\b/i, " ")
  );
}

function extractTitleFromText(text = "") {
  const source = cleanTitleSegment(text);
  const lines = source
    .split(/\s+\|\s+|\s+-\s+|;/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

  const preferred = lines.find((item) => /\b(?:v(?:s\.?|ersus)?)\b/i.test(item) && item.length > 8);
  if (preferred) return preferred;

  const fallback = lines
    .filter((item) => item.length > 12 && !extractDate(item) && !extractCaseNumber(item))
    .sort((a, b) => b.length - a.length)[0];
  return fallback || source;
}

function deriveIssueTags(text) {
  const haystack = normalizeWhitespace(text).toLowerCase();
  const mapping = [
    ["cheque", "cheque bounce"],
    ["dishonour", "cheque bounce"],
    ["ni act", "NI Act"],
    ["negotiable instruments", "NI Act"],
    ["contract", "contract"],
    ["specific performance", "specific performance"],
    ["arbitration", "arbitration"],
    ["interim relief", "interim relief"],
    ["injunction", "injunction"],
    ["consumer", "consumer law"],
    ["medical", "medical service"],
    ["service", "service law"],
    ["dismissal", "dismissal"],
    ["employment", "employment dues"],
    ["salary", "salary dues"],
    ["writ", "writ"],
    ["natural justice", "natural justice"],
    ["bail", "bail"],
    ["anticipatory bail", "anticipatory bail"],
    ["f.i.r", "FIR"],
    ["fir", "FIR"],
    ["murder", "criminal law"],
    ["matrimonial", "family law"],
    ["divorce", "family law"],
    ["maintenance", "maintenance"],
    ["property", "property dispute"],
    ["partition", "partition"],
    ["tenancy", "tenancy"],
    ["land acquisition", "land acquisition"],
    ["tax", "tax law"],
    ["gst", "GST"],
    ["insolvency", "insolvency"],
    ["ibc", "IBC"]
  ];

  return mapping
    .filter(([needle]) => haystack.includes(needle))
    .map(([, tag]) => tag)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, 5);
}

function buildSummary(title, court, caseNumber = "") {
  const text = normalizeWhitespace(title);
  const caseMarker = caseNumber ? ` (${caseNumber})` : "";
  return `Official ${court || "court"} judgment brief parsed from public source for ${text}${caseMarker}. Verify the full text and latest treatment before reliance.`;
}

function buildRowSummary(title, court, cellTexts = []) {
  const narrative = cellTexts
    .filter((item) => item.length > 10)
    .slice(0, 3)
    .join(" | ");
  return narrative || buildSummary(title, court);
}

function normalizeRecord(record = {}, source = {}) {
  const title = normalizeWhitespace(record.title || record.caseTitle || record.caseName || extractTitleFromText(record.rawText || ""));
  if (!title) return null;

  const court = normalizeWhitespace(record.court || source.court || source.name);
  const caseNumber = normalizeWhitespace(record.caseNumber || extractCaseNumber([record.rawText, title, record.summary].join(" ")));
  const neutralCitation = normalizeWhitespace(record.neutralCitation || extractNeutralCitation([record.citation, record.rawText, record.summary].join(" ")));
  const citation = normalizeWhitespace(record.citation || neutralCitation || source.name || court);
  const summary = normalizeWhitespace(record.summary || record.headnote || buildSummary(title, court, caseNumber));
  const ratioNote = normalizeWhitespace(record.ratioNote || `Use ${title} as a working authority brief and verify the full ratio from the official judgment text.`);
  const issueTags = Array.isArray(record.issueTags) && record.issueTags.length
    ? record.issueTags.map((item) => normalizeWhitespace(item)).filter(Boolean)
    : deriveIssueTags(`${title} ${summary} ${caseNumber}`);
  const partyNames = Array.isArray(record.partyNames) && record.partyNames.length
    ? toUniqueStrings(record.partyNames)
    : inferPartyNames(title);
  const bench = normalizeWhitespace(record.bench || extractBench([record.rawText, record.summary].join(" ")));
  const parallelCitations = toUniqueStrings(Array.isArray(record.parallelCitations) ? record.parallelCitations : [neutralCitation].filter(Boolean), 6);

  return {
    id: normalizeWhitespace(record.id),
    title,
    caseNumber,
    partyNames,
    citation,
    neutralCitation,
    parallelCitations,
    court,
    bench,
    judgmentDate: normalizeWhitespace(record.judgmentDate || record.date || extractDate(record.rawText || "") || extractDate(title) || extractDate(summary)),
    summary,
    ratioNote,
    relevanceNote: normalizeWhitespace(record.relevanceNote || `Useful for issue spotting and authority shortlisting in ${court || "court"} matters.`),
    treatmentStatus: normalizeWhitespace(record.treatmentStatus || "verify"),
    cautionFlag: normalizeWhitespace(record.cautionFlag || "Verify the full judgment text, current status, and citation before filing."),
    issueTags,
    holdingPoints: Array.isArray(record.holdingPoints) ? record.holdingPoints.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    keyParagraphs: Array.isArray(record.keyParagraphs) ? record.keyParagraphs.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    citedBy: Array.isArray(record.citedBy) ? record.citedBy.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    followedBy: Array.isArray(record.followedBy) ? record.followedBy.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    distinguishedBy: Array.isArray(record.distinguishedBy) ? record.distinguishedBy.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    overruledBy: Array.isArray(record.overruledBy) ? record.overruledBy.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    practicalUse: Array.isArray(record.practicalUse) && record.practicalUse.length
      ? record.practicalUse.map((item) => normalizeWhitespace(item)).filter(Boolean)
      : ["Use in research memo", "Verify before final reliance"],
    sourceUrl: buildAbsoluteUrl(source.endpoint, record.sourceUrl || record.href || record.url || ""),
    sourceType: "live"
  };
}

function parseSupremeCourtHtml(html, source = {}) {
  const records = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(String(html || "")))) {
    const href = match[1];
    const text = stripHtml(match[2]);
    if (!text || text.length < 18) continue;
    if (!/uploaded on|\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}-\d{1,2}-\d{4}|\b(?:v(?:s\.?|ersus)?)\b/i.test(text)) continue;

    const title = extractTitleFromText(text);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    const normalized = normalizeRecord({
      title,
      citation: extractNeutralCitation(text) || "Supreme Court official feed",
      caseNumber: extractCaseNumber(text),
      partyNames: inferPartyNames(title),
      judgmentDate: extractDate(text),
      bench: extractBench(text),
      rawText: text,
      sourceUrl: href
    }, source);

    if (normalized) {
      records.push(normalized);
    }
  }

  return records;
}

function parseTableHtml(html, source = {}) {
  const records = [];
  const seen = new Set();
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(String(html || "")))) {
    const row = rowMatch[1];
    const cellTexts = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((item) => stripHtml(item[1]))
      .filter(Boolean)
      .filter((item) => !/^(view|download|pdf)$/i.test(item));

    if (!cellTexts.length) continue;

    const title = extractTitleFromText(cellTexts.join(" | "));
    if (!title) continue;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    const judgmentDate = cellTexts.map((item) => extractDate(item)).find(Boolean) || "";
    const caseNumber = cellTexts.map((item) => extractCaseNumber(item)).find(Boolean) || "";
    const citation = cellTexts.map((item) => extractNeutralCitation(item)).find(Boolean)
      || cellTexts.find((item) => item !== title && item.length > 4)
      || `${source.court || source.name} official feed`;
    const bench = cellTexts.map((item) => extractBench(item)).find(Boolean) || "";
    const hrefMatch = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);

    const normalized = normalizeRecord({
      title,
      caseNumber,
      citation,
      neutralCitation: extractNeutralCitation(cellTexts.join(" | ")),
      bench,
      judgmentDate,
      summary: buildRowSummary(title, source.court || source.name, cellTexts),
      rawText: cellTexts.join(" | "),
      sourceUrl: hrefMatch ? hrefMatch[1] : ""
    }, source);

    if (normalized) {
      records.push(normalized);
    }
  }

  return records;
}

function parseGenericHtml(html, source = {}) {
  const records = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(String(html || "")))) {
    const text = stripHtml(match[2]);
    if (!text || text.length < 16) continue;
    if (!extractDate(text) && text.split(" ").length < 3 && !/\b(?:v(?:s\.?|ersus)?)\b/i.test(text)) continue;
    const title = extractTitleFromText(text);
    if (!title) continue;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    const normalized = normalizeRecord({
      title,
      caseNumber: extractCaseNumber(text),
      citation: extractNeutralCitation(text) || `${source.court || source.name} official feed`,
      neutralCitation: extractNeutralCitation(text),
      judgmentDate: extractDate(text),
      bench: extractBench(text),
      rawText: text,
      sourceUrl: match[1]
    }, source);

    if (normalized) {
      records.push(normalized);
    }
  }

  return records;
}

function parseJudgmentSourcePayload(data, source = {}) {
  const mode = normalizeWhitespace(source.retrievalMode || "json_api").toLowerCase();

  if (mode === "json_api") {
    const records = Array.isArray(data?.records) ? data.records : Array.isArray(data) ? data : [];
    return records.map((item) => normalizeRecord(item, source)).filter(Boolean);
  }

  if (mode === "html_sc_latest") {
    return parseSupremeCourtHtml(data, source);
  }

  if (mode === "html_table_latest") {
    return parseTableHtml(data, source);
  }

  return parseGenericHtml(data, source);
}

module.exports = {
  parseJudgmentSourcePayload,
  parseSupremeCourtHtml,
  parseTableHtml,
  parseGenericHtml,
  normalizeRecord,
  extractCaseNumber,
  extractNeutralCitation,
  inferPartyNames
};
