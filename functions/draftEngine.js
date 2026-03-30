function splitFactLines(facts = "") {
  return String(facts || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferSections(text = "") {
  const lowered = String(text || "").toLowerCase();
  const sections = [];

  if (/cheque|138|dishonou?r|bank memo|notice/i.test(lowered)) {
    sections.push("Section 138 of the Negotiable Instruments Act, 1881");
  }
  if (/injunction|interim/i.test(lowered)) {
    sections.push("Order XXXIX Rules 1 and 2 CPC");
  }
  if (/specific performance|agreement to sell/i.test(lowered)) {
    sections.push("Specific Relief Act, 1963");
  }
  if (/consumer|deficiency/i.test(lowered)) {
    sections.push("Consumer Protection Act, 2019");
  }
  if (/writ|article 226/i.test(lowered)) {
    sections.push("Article 226 of the Constitution of India");
  }

  return sections.length ? sections : ["Applicable statutory provisions to be verified from the final brief."];
}

function buildFactsParagraphs(lines = []) {
  if (!lines.length) {
    return ["The material facts are to be inserted after client verification."];
  }

  return lines.map((line, index) => `${index + 1}. ${line}`);
}

function buildGrounds(sections = [], facts = "") {
  const body = String(facts || "").trim() || "The pleaded facts disclose a legal cause requiring formal relief.";
  return [
    `Because the disclosed facts attract ${sections.join(", ")}, the claim is legally maintainable.`,
    `Because the record shows: ${body.slice(0, 280)}.`,
    "Because the opposite party's failure or omission has created a clear cause of action requiring legal remedy."
  ];
}

function buildPetitionDraft({ mode, facts, sections }) {
  const factLines = splitFactLines(facts);
  const editable = mode === "editable";
  return [
    "IN THE COURT OF THE HON'BLE [COURT NAME]",
    editable ? "[JURISDICTION TO BE INSERTED]" : "AT [JURISDICTION TO BE CONFIRMED]",
    "",
    editable ? "[CAUSE TITLE]" : "CIVIL / CRIMINAL ORIGINAL JURISDICTION",
    "",
    "[PETITIONER / PLAINTIFF NAME]",
    "Petitioner / Plaintiff",
    "",
    "VERSUS",
    "",
    "[RESPONDENT / DEFENDANT NAME]",
    "Respondent / Defendant",
    "",
    "PETITION / PLAINT",
    "",
    "MOST RESPECTFULLY SHOWETH:",
    "",
    "FACTS OF THE CASE",
    ...buildFactsParagraphs(factLines),
    "",
    "LEGAL GROUNDS",
    ...buildGrounds(sections, facts).map((item, index) => `${String.fromCharCode(65 + index)}. ${item}`),
    "",
    "CAUSE OF ACTION",
    "The cause of action arose when the acts and omissions stated above gave rise to a legally enforceable grievance within the jurisdiction of this Hon'ble Court.",
    "",
    "PRAYER",
    editable ? "[SPECIFIC RELIEFS TO BE INSERTED]" : "It is therefore prayed that this Hon'ble Court may be pleased to grant appropriate relief in accordance with law and the facts stated herein.",
    "",
    "PLACE:",
    "DATE:",
    "",
    "COUNSEL FOR THE PETITIONER / PLAINTIFF",
    "[SIGNATURE BLOCK]"
  ].join("\n");
}

function buildNoticeDraft({ mode, facts, sections }) {
  const factLines = splitFactLines(facts);
  const editable = mode === "editable";
  return [
    "LEGAL NOTICE",
    "",
    editable ? "FROM: [CLIENT / ADVOCATE DETAILS]" : "FROM: COUNSEL FOR THE CLAIMANT / COMPLAINANT",
    editable ? "TO: [RECIPIENT DETAILS]" : "TO: THE OPPOSITE PARTY / NOTICEE",
    "",
    "SUBJECT:",
    editable ? "[SUBJECT TO BE INSERTED]" : "Notice calling upon you to comply with your legal obligations",
    "",
    "UNDER INSTRUCTIONS from and on behalf of my client, I hereby state as follows:",
    "",
    "FACTS",
    ...buildFactsParagraphs(factLines),
    "",
    "LEGAL BASIS",
    ...sections.map((item, index) => `${index + 1}. ${item}.`),
    "",
    "CAUSE OF ACTION",
    "Your acts / omissions described above have given rise to a continuing legal cause requiring immediate compliance and remedial action.",
    "",
    "DEMAND / PRAYER",
    editable
      ? "[DEMAND / COMPLIANCE CLAUSE TO BE INSERTED]"
      : "You are hereby finally called upon to comply within the legally permissible period, failing which my client shall be constrained to initiate appropriate civil / criminal proceedings at your cost and risk.",
    "",
    "PLACE:",
    "DATE:",
    "",
    "COUNSEL FOR THE NOTICE ISSUER",
    "[SIGNATURE BLOCK]"
  ].join("\n");
}

function buildAgreementDraft({ mode, facts }) {
  const editable = mode === "editable";
  return [
    "AGREEMENT",
    "",
    editable ? "[DATE AND PLACE TO BE INSERTED]" : "THIS AGREEMENT is made on the date to be finally inserted after verification.",
    "",
    "BETWEEN",
    "[FIRST PARTY DETAILS]",
    "",
    "AND",
    "",
    "[SECOND PARTY DETAILS]",
    "",
    "RECITALS",
    ...(splitFactLines(facts).length ? buildFactsParagraphs(splitFactLines(facts)) : ["1. The parties intend to record their rights and obligations in writing."]),
    "",
    "OPERATIVE CLAUSES",
    "1. Scope and obligations",
    "2. Consideration and payment terms",
    "3. Representations and warranties",
    "4. Default and remedies",
    "5. Governing law and jurisdiction",
    "",
    "SIGNATURE BLOCK",
    editable ? "[SIGNATURES / WITNESSES TO BE INSERTED]" : "SIGNED by the parties after final legal verification."
  ].join("\n");
}

function buildAffidavitDraft({ mode, facts }) {
  const editable = mode === "editable";
  return [
    "AFFIDAVIT",
    "",
    editable ? "[DEPONENT DETAILS TO BE INSERTED]" : "I, the deponent named below, do hereby solemnly affirm and state as follows:",
    "",
    ...buildFactsParagraphs(splitFactLines(facts)),
    "",
    "VERIFICATION",
    "The contents stated above are true and correct to my knowledge and belief, and nothing material has been concealed therefrom.",
    "",
    "PLACE:",
    "DATE:",
    "",
    "DEPONENT",
    editable ? "[ATTESTATION BLOCK TO BE INSERTED]" : "[SIGNATURE BLOCK]"
  ].join("\n");
}

function generateDraft(payload = {}) {
  const draftType = String(payload.draftType || "petition").trim().toLowerCase();
  const mode = String(payload.mode || "court-ready").trim().toLowerCase() === "editable" ? "editable" : "court-ready";
  const facts = String(payload.facts || "").trim();
  const sections = inferSections(facts);

  const draft = draftType === "notice"
    ? buildNoticeDraft({ mode, facts, sections })
    : draftType === "agreement"
      ? buildAgreementDraft({ mode, facts })
      : draftType === "affidavit"
        ? buildAffidavitDraft({ mode, facts })
        : buildPetitionDraft({ mode, facts, sections });

  return {
    draft,
    mode,
    sections
  };
}

module.exports = {
  generateDraft
};
