function uniqueBy(items = [], getKey = (item) => JSON.stringify(item)) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncateText(value = "", maxLength = 220) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function detectParagraphReference(text = "") {
  const match = String(text || "").match(/(?:para(?:graph)?|¶)\s*\.?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function detectPageReference(text = "") {
  const match = String(text || "").match(/page\s*\.?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function buildExcerpt(value = "", maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return truncateText(text, maxLength);
}

function normalizePinpoint(pinpoint = {}, fallbackText = "") {
  const paragraphNumber = Number(pinpoint?.paragraphNumber || detectParagraphReference(fallbackText) || 0) || null;
  const pageNumber = Number(pinpoint?.pageNumber || detectPageReference(fallbackText) || 0) || null;
  const excerpt = buildExcerpt(pinpoint?.excerpt || fallbackText, 180);

  if (!paragraphNumber && !pageNumber && !excerpt) {
    return null;
  }

  return {
    paragraphNumber,
    pageNumber,
    excerpt
  };
}

function buildReferenceLabel({ paragraphNumber = null, pageNumber = null, location = "" } = {}) {
  if (location) return String(location).trim();
  if (paragraphNumber && pageNumber) return `Para ${paragraphNumber}, Page ${pageNumber}`;
  if (paragraphNumber) return `Para ${paragraphNumber}`;
  if (pageNumber) return `Page ${pageNumber}`;
  return "";
}

function buildTraceability({ facts = "", documents = [], authorities = [], scoreBreakdown = null, keyFactors = [], notes = [] }) {
  const factLines = String(facts || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line, index) => ({
      id: `fact-${index}`,
      label: truncateText(line, 180)
    }));

  const normalizedDocuments = (Array.isArray(documents) ? documents : [])
    .map((item, index) => {
      if (typeof item === "string") {
        const pinpoint = normalizePinpoint({}, item);
      return {
        id: `doc-${index}`,
        title: truncateText(item, 80) || `Document ${index + 1}`,
        excerpt: pinpoint?.excerpt || "",
        exactReference: "",
        pinpoint,
        sourceUrl: ""
      };
      }

      const title = String(item?.title || item?.fileName || item?.name || `Document ${index + 1}`).trim();
      const excerptSource = item?.excerpt || item?.summary || item?.content || item?.text || "";
      const pinpoint = normalizePinpoint(item?.pinpoint || item?.location, excerptSource);
      return {
        id: String(item?.id || `doc-${index}`).trim(),
        title: truncateText(title, 80),
        excerpt: pinpoint?.excerpt || buildExcerpt(excerptSource, 180),
        exactReference: buildReferenceLabel({
          paragraphNumber: pinpoint?.paragraphNumber,
          pageNumber: pinpoint?.pageNumber,
          location: String(item?.locationLabel || item?.location || "").trim()
        }),
        pinpoint,
        sourceUrl: String(item?.sourceUrl || "").trim()
      };
    })
    .filter((item) => item.title || item.excerpt)
    .slice(0, 6);

  const normalizedAuthorities = uniqueBy((Array.isArray(authorities) ? authorities : [])
    .map((item, index) => ({
      id: String(item?.caseId || item?.canonicalCaseId || item?.id || `auth-${index}`).trim(),
      title: truncateText(item?.title || item?.citation || `Authority ${index + 1}`, 100),
      citation: truncateText(item?.citation || "", 120),
      proposition: truncateText(item?.whyItMatters || item?.ratioNote || item?.summary || item?.reasoning || "", 180),
      status: String(item?.status || item?.validityStatus || item?.treatmentStatus || "").trim(),
      sourceUrl: String(item?.sourceUrl || "").trim(),
      exactReference: buildReferenceLabel({
        paragraphNumber: Number(item?.pinpoint?.paragraphNumber || item?.paragraphNumber || detectParagraphReference(item?.referenceText || item?.pinpointRef || item?.pinpoint || "")) || null,
        pageNumber: Number(item?.pinpoint?.pageNumber || item?.pageNumber || detectPageReference(item?.referenceText || item?.pinpointRef || item?.pinpoint || "")) || null,
        location: String(item?.pinpointRef || item?.referenceLabel || "").trim()
      }),
      pinpoint: normalizePinpoint(item?.pinpoint || {}, item?.pinpoint?.excerpt || item?.holdingPoints?.[0] || item?.whyItMatters || item?.ratioNote || item?.summary || item?.reasoning || "")
    }))
    .filter((item) => item.title), (item) => item.id || `${item.title}|${item.citation}`)
    .slice(0, 8);

  return {
    factsUsed: factLines,
    documentsReviewed: normalizedDocuments,
    authoritiesRelied: normalizedAuthorities,
    scoreBreakdown: scoreBreakdown || undefined,
    keyFactors: uniqueBy((Array.isArray(keyFactors) ? keyFactors : []).map((item, index) => ({
      id: `factor-${index}`,
      label: truncateText(item, 180)
    })), (item) => item.label).slice(0, 8),
    reviewerNotes: uniqueBy((Array.isArray(notes) ? notes : []).map((item, index) => ({
      id: `note-${index}`,
      label: truncateText(item, 180)
    })), (item) => item.label).slice(0, 6)
  };
}

module.exports = {
  buildTraceability,
  detectParagraphReference,
  detectPageReference,
  normalizePinpoint
};
