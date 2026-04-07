const { LEGAL_CORPUS } = require("./legalCorpus");

const LEGACY_REFERENCE_RULES = [
  {
    id: "ipc-379",
    markers: ["ipc 379", "section 379"],
    currentReference: "Bharatiya Nyaya Sanhita, 2023 - Section 303",
    topic: "Theft"
  },
  {
    id: "ipc-420",
    markers: ["ipc 420", "section 420"],
    currentReference: "Bharatiya Nyaya Sanhita, 2023 - Cheating provisions",
    topic: "Cheating / fraud"
  },
  {
    id: "crpc-154",
    markers: ["crpc 154", "section 154"],
    currentReference: "Bharatiya Nagarik Suraksha Sanhita, 2023 - Section 173",
    topic: "Information in cognizable cases / FIR"
  },
  {
    id: "crpc-156",
    markers: ["crpc 156", "section 156", "156(3)"],
    currentReference: "Bharatiya Nagarik Suraksha Sanhita, 2023 - Section 175",
    topic: "Police investigation power"
  },
  {
    id: "evidence-act",
    markers: ["evidence act", "indian evidence act"],
    currentReference: "Bharatiya Sakshya Adhiniyam, 2023",
    topic: "Evidence"
  }
];

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

function detectQueryProfile(query = "") {
  const lowered = String(query || "").toLowerCase();

  if (/cheque|check|dishonou?r|bank memo|negotiable instruments|section 138/.test(lowered)) {
    return "cheque_dishonour";
  }
  if (/landlord|tenant|rent|deposit|advance deposit|vacated|lease/.test(lowered)) {
    return "rental_dispute";
  }
  if (/promis(?:ed|ing).+job|job fraud|scam|cheating|fraud|dishonestly induc/.test(lowered)) {
    return "fraud";
  }
  if (/lent money|loan|borrowed money|not returning|money recovery|recover money|dues/.test(lowered)) {
    return "civil_recovery";
  }
  if (/agreement|contract|breach|default/.test(lowered)) {
    return "contract";
  }

  return "general";
}

function classifyCaseNature(query = "") {
  const lowered = String(query || "").toLowerCase();

  if (/section 138|cheque|dishonou?r|bank memo|statutory notice|negotiable instruments/.test(lowered)) {
    return "criminal";
  }
  if (/fir|arrest|bail|police complaint|cognizable|criminal|assault|theft|murder|forgery|threat|harassment/.test(lowered)) {
    return "criminal";
  }
  if (/money recovery|recovery suit|specific performance|injunction|declaration|breach of contract|rent|lease|tenant|landlord|civil/.test(lowered)) {
    return "civil";
  }
  if (/agreement|contract|dues|payment|loan|borrowed money|salary|employment dues|property dispute/.test(lowered)) {
    return "civil";
  }

  return "general";
}

function getProfileWeight(profile, entry = {}) {
  const entryText = `${entry.title || ""} ${entry.citation || ""} ${(entry.keywords || []).join(" ")}`.toLowerCase();

  if (profile === "cheque_dishonour") {
    if (/section 138|negotiable instruments|cheque bounce|dishonou?r/.test(entryText)) return 6;
    if (/evidence|electronic/.test(entryText)) return 1;
    if (/theft|cheating|fir|police|article 14|article 21|consumer protection|domestic violence/.test(entryText)) return -4;
  }

  if (profile === "rental_dispute") {
    if (/agreement|contract|specific relief|rent|lease|property|civil/.test(entryText)) return 3;
    if (/theft|cheating|fir|police|section 138|cheque bounce|domestic violence/.test(entryText)) return -4;
  }

  if (profile === "civil_recovery") {
    if (/agreement|contract|specific relief|money|dues|payment/.test(entryText)) return 2;
    if (/theft|fir|police|article 14|article 21|domestic violence/.test(entryText)) return -4;
    if (/cheating|fraud/.test(entryText)) return -1;
  }

  if (profile === "fraud") {
    if (/cheating|fraud|fir|police|cognizable/.test(entryText)) return 4;
    if (/section 138|cheque bounce|domestic violence/.test(entryText)) return -4;
  }

  if (profile === "contract") {
    if (/agreement|contract|consumer protection|specific relief/.test(entryText)) return 2;
    if (/theft|fir|police|domestic violence/.test(entryText)) return -3;
  }

  return 0;
}

function isProfileRelevant(profile, entry = {}) {
  const entryText = `${entry.title || ""} ${entry.citation || ""} ${entry.body || ""} ${(entry.keywords || []).join(" ")}`.toLowerCase();
  if (profile === "cheque_dishonour") {
    if (/article 14|article 21|constitution|fundamental rights|maneka gandhi|d\.k\. basu|lalita kumari|consumer protection|domestic violence|theft|cheating|fir|police/.test(entryText)) return false;
    if (/section 138|negotiable instruments|cheque bounce|dishonou?r|statutory notice/.test(entryText)) return true;
    if (/evidence|electronic/.test(entryText)) return true;
  }
  if (profile === "civil_recovery") {
    if (/agreement|contract|specific relief|money|dues|payment|recovery/.test(entryText)) return true;
    if (/fir|police|domestic violence|section 138/.test(entryText)) return false;
  }
  if (profile === "rental_dispute") {
    if (/rent|lease|tenant|landlord|specific relief|property|civil/.test(entryText)) return true;
    if (/fir|police|section 138|domestic violence/.test(entryText)) return false;
  }
  if (profile === "fraud") {
    if (/cheating|fraud|fir|police|cognizable|investigation/.test(entryText)) return true;
    if (/section 138|cheque bounce|rent|lease|tenant|landlord|domestic violence/.test(entryText)) return false;
  }
  if (profile === "contract") {
    if (/agreement|contract|specific relief|consumer protection|civil/.test(entryText)) return true;
    if (/fir|police|theft|murder|section 138|domestic violence/.test(entryText)) return false;
  }
  return true;
}

function retrieveLegalContext(query, limit = 6) {
  const tokens = normalizeSearchText(query);
  if (!tokens.length) {
    return LEGAL_CORPUS.slice(0, limit);
  }

  const profile = detectQueryProfile(query);

  const ranked = LEGAL_CORPUS
    .map((entry) => {
      const haystack = normalizeSearchText(
        `${entry.title} ${entry.body} ${(entry.keywords || []).join(" ")} ${entry.citation}`
      );
      const tokenScore = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
      const phraseScore = String(query || "").toLowerCase().includes("section 138") && /section 138/i.test(entry.citation || "") ? 4 : 0;
      const profileWeight = getProfileWeight(profile, entry);
      const score = tokenScore + phraseScore + profileWeight;
      return { entry, score };
    })
    .filter((item) => item.score > 0 && isProfileRelevant(profile, item.entry))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);

  if (ranked.length) {
    return ranked;
  }

  const caseNature = classifyCaseNature(query);
  const narrowedFallback = LEGAL_CORPUS
    .filter((entry) => {
      const entryText = `${entry.title || ""} ${entry.citation || ""} ${entry.body || ""} ${(entry.keywords || []).join(" ")}`.toLowerCase();
      if (profile !== "general") return isProfileRelevant(profile, entry);
      if (/cheque|check|dishonou?r|bank memo|negotiable instruments|section 138/.test(String(query || "").toLowerCase())) {
        return !/article 14|article 21|constitution|fundamental rights|maneka gandhi|d\.k\. basu|lalita kumari|consumer protection|domestic violence|theft|cheating|fir|police/.test(entryText);
      }
      if (caseNature === "civil") return !/fir|police|cognizable|arrest|criminal law|theft|murder/.test(entryText);
      if (caseNature === "criminal") return !/rent|lease|tenant|landlord|specific relief|civil recovery/.test(entryText);
      return true;
    })
    .slice(0, limit);

  return narrowedFallback.length ? narrowedFallback : LEGAL_CORPUS.slice(0, limit);
}

function getLegacyReferenceMatches(query) {
  const input = String(query || "").toLowerCase();
  return LEGACY_REFERENCE_RULES.filter((rule) => rule.markers.some((marker) => input.includes(marker)));
}

function getLegacyLawNotice(query) {
  const matches = getLegacyReferenceMatches(query);
  if (!matches.length) {
    return "";
  }

  const mappedReferences = matches
    .map((item) => `${item.topic}: ${item.currentReference}`)
    .join("; ");

  return `This query appears to use legacy IPC/CrPC/Evidence Act terminology. Cross-check the current position under BNS, BNSS, and BSA before advising, drafting, or filing. Relevant current references: ${mappedReferences}.`;
}

module.exports = {
  LEGACY_REFERENCE_RULES,
  classifyCaseNature,
  normalizeSearchText,
  retrieveLegalContext,
  getLegacyReferenceMatches,
  getLegacyLawNotice
};
