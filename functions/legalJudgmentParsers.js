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

function buildSummary(title, court) {
  const text = normalizeWhitespace(title);
  return `Official ${court || "court"} judgment brief parsed from public source for ${text}. Verify the full text and latest treatment before reliance.`;
}

function normalizeRecord(record = {}, source = {}) {
  const title = normalizeWhitespace(record.title || record.caseTitle || record.caseName);
  if (!title) return null;

  const court = normalizeWhitespace(record.court || source.court || source.name);
  const summary = normalizeWhitespace(record.summary || record.headnote || buildSummary(title, court));
  const ratioNote = normalizeWhitespace(record.ratioNote || `Use ${title} as a working authority brief and verify the full ratio from the official judgment text.`);
  const issueTags = Array.isArray(record.issueTags) && record.issueTags.length
    ? record.issueTags.map((item) => normalizeWhitespace(item)).filter(Boolean)
    : deriveIssueTags(`${title} ${summary}`);

  return {
    id: normalizeWhitespace(record.id),
    title,
    citation: normalizeWhitespace(record.citation || record.neutralCitation || source.name || court),
    court,
    bench: normalizeWhitespace(record.bench),
    judgmentDate: normalizeWhitespace(record.judgmentDate || record.date || extractDate(title) || extractDate(summary)),
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
    if (!/uploaded on|\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}-\d{1,2}-\d{4}/i.test(text)) continue;

    const parts = text.split(/\s+-\s+/).map((item) => normalizeWhitespace(item)).filter(Boolean);
    const title = parts[0] || text;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    const datePart = parts.find((item) => extractDate(item)) || "";
    const citationParts = parts.slice(1).filter((item) => item !== datePart && !/uploaded on/i.test(item));

    const normalized = normalizeRecord({
      title,
      citation: citationParts.join(" | ") || "Supreme Court official feed",
      judgmentDate: extractDate(datePart || text),
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

    const title = cellTexts
      .filter((item) => item.length > 12 && !extractDate(item))
      .sort((a, b) => b.length - a.length)[0];

    if (!title) continue;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    const judgmentDate = cellTexts.map((item) => extractDate(item)).find(Boolean) || "";
    const citation = cellTexts.find((item) => item !== title && item.length > 4) || `${source.court || source.name} official feed`;
    const hrefMatch = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);

    const normalized = normalizeRecord({
      title,
      citation,
      judgmentDate,
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
    if (!extractDate(text) && text.split(" ").length < 3) continue;
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());

    const normalized = normalizeRecord({
      title: text,
      citation: `${source.court || source.name} official feed`,
      judgmentDate: extractDate(text),
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
  parseTableHtml
};
