function normalizeCourtType(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (/supreme/.test(text)) return "supreme_court";
  if (/high/.test(text)) return "high_court";
  if (/district|trial|civil judge|magistrate/.test(text)) return "trial_court";
  return "general";
}

function findSection(text = "", pattern) {
  return pattern.test(String(text || ""));
}

function buildCheck(key, label, passed, note, severity = "info") {
  return { key, label, passed: Boolean(passed), note, severity };
}

function getRequiredChecks({ draftType, courtType, draftText }) {
  const text = String(draftText || "");
  const lowered = text.toLowerCase();

  const checks = [];

  if (draftType === "petition") {
    checks.push(
      buildCheck("heading", "Court heading present", findSection(text, /in the court|in the hon'?ble|before the hon'?ble/i), "Draft should begin with a proper court heading.", "high"),
      buildCheck("parties", "Party block present", findSection(text, /versus|petitioner|plaintiff|respondent|defendant/i), "Party names / roles should be shown clearly.", "high"),
      buildCheck("facts", "Structured facts present", findSection(text, /facts of the case|facts|most respectfully showeth/i), "Facts section should be clearly structured.", "high"),
      buildCheck("signature", "Signature block present", findSection(text, /signature block|counsel for|deponent|signed by|advocate for/i), "Signature / counsel block should be present.", "medium")
    );
    checks.push(
      buildCheck("grounds", "Legal grounds present", findSection(text, /legal grounds|grounds/i), "Petitions should contain a dedicated legal grounds section.", "high"),
      buildCheck("cause", "Cause of action present", findSection(text, /cause of action/i), "Cause of action section is expected in petitions.", "high"),
      buildCheck("prayer", "Prayer section present", findSection(text, /prayer|relief/i), "Petitions should end with clear prayers / reliefs.", "high"),
      buildCheck("verification", "Verification support present", findSection(text, /verification|verified at|solemnly affirm/i), "Petition filing packs often need verification / affidavit support.", "medium")
    );
  }

  if (draftType === "notice") {
    checks.push(
      buildCheck("notice_heading", "Notice heading present", findSection(text, /legal notice|notice/i), "Legal notice should clearly identify itself as a notice.", "medium"),
      buildCheck("parties", "Party block present", findSection(text, /from:|to:|noticee|opposite party|claimant|complainant/i), "Notice should clearly identify sender and recipient roles.", "high"),
      buildCheck("facts", "Structured facts present", findSection(text, /facts|under instructions|i hereby state as follows/i), "Facts section should be clearly structured.", "high"),
      buildCheck("signature", "Signature block present", findSection(text, /signature block|counsel for|signed by|advocate for|notice issuer/i), "Signature / counsel block should be present.", "medium")
    );
    checks.push(
      buildCheck("subject", "Subject line present", findSection(text, /subject:/i), "Legal notices should carry a clear subject line.", "high"),
      buildCheck("legal_basis", "Legal basis present", findSection(text, /legal basis|section 138|negotiable instruments act|consumer protection act|article 226|specific relief/i), "Notice should identify the core legal basis.", "high"),
      buildCheck("demand", "Demand / compliance clause present", findSection(text, /demand|called upon|comply within|failing which/i), "Notice should include a clear compliance demand and consequence clause.", "high")
    );
  }

  if (draftType === "affidavit") {
    checks.push(
      buildCheck("signature", "Signature block present", findSection(text, /signature block|deponent|signed by/i), "Signature / deponent block should be present.", "medium")
    );
    checks.push(
      buildCheck("verification", "Verification paragraph present", findSection(text, /verification|true and correct|knowledge and belief/i), "Affidavit must contain a verification paragraph.", "high"),
      buildCheck("deponent", "Deponent block present", findSection(text, /deponent/i), "Affidavit should contain a deponent block.", "high")
    );
  }

  if (draftType === "agreement") {
    checks.push(
      buildCheck("parties", "Party structure present", findSection(text, /between|party of the first part|party of the second part/i), "Agreement should clearly identify both parties.", "high"),
      buildCheck("signature", "Signature block present", findSection(text, /signature|signed by|witness/i), "Agreement should contain signatures / witness blocks.", "medium")
    );
    checks.push(
      buildCheck("payment", "Payment / consideration clause present", findSection(text, /payment|consideration|fees/i), "Agreement should include payment / consideration language.", "high"),
      buildCheck("jurisdiction", "Jurisdiction clause present", findSection(text, /jurisdiction|governing law/i), "Agreement should include jurisdiction / governing law.", "medium")
    );
  }

  if ((courtType === "high_court" || courtType === "supreme_court") && draftType === "petition") {
    checks.push(
      buildCheck("jurisdiction_line", "Jurisdiction line present", findSection(text, /jurisdiction/i), "Higher court filings should state jurisdiction clearly.", "medium")
    );
  }

  if (courtType === "trial_court" && draftType === "petition") {
    checks.push(
      buildCheck("cause_title", "Cause title / case title present", findSection(text, /case no|suit no|complaint no|cause title/i), "Trial-court filings usually need a clearer cause title / case numbering block.", "medium")
    );
  }

  if (/section 138|cheque|dishonou?r/i.test(lowered)) {
    checks.push(
      buildCheck("ni_act_reference", "Correct NI Act reference present", findSection(text, /section 138 of the negotiable instruments act|negotiable instruments act/i), "Cheque dishonour drafts should cite the correct NI Act provision.", "high")
    );
  }

  return checks;
}

function analyzeDraftValidation(input = {}) {
  const draftText = String(input.draftText || "").trim();
  const draftType = String(input.draftType || "petition").trim().toLowerCase() || "petition";
  const courtType = normalizeCourtType(input.courtType || input.court || "");

  if (!draftText) {
    return {
      validationScore: 20,
      validationLevel: "NEEDS WORK",
      summary: "No draft text was provided for validation.",
      checks: [],
      missingSections: ["Draft text missing"],
      criticalIssues: ["Draft validation cannot run until draft text is available."],
      suggestions: ["Generate or paste the draft before running court-specific validation."],
      courtType,
      draftType
    };
  }

  const checks = getRequiredChecks({ draftType, courtType, draftText });
  const passedCount = checks.filter((item) => item.passed).length;
  const validationScore = Math.max(0, Math.min(100, Math.round((passedCount / checks.length) * 100)));
  const missingSections = checks.filter((item) => !item.passed).map((item) => item.label);
  const criticalIssues = checks.filter((item) => !item.passed && item.severity === "high").map((item) => item.note);
  const suggestions = checks
    .filter((item) => !item.passed)
    .map((item) => item.note)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 10);

  return {
    validationScore,
    validationLevel: validationScore >= 80 ? "COURT READY" : validationScore >= 55 ? "REVIEW REQUIRED" : "NEEDS WORK",
    summary: validationScore >= 80
      ? "The draft appears structurally close to court-ready, subject to lawyer finalisation."
      : validationScore >= 55
        ? "The draft has core structure but still needs targeted correction before use."
        : "The draft is missing important court-facing sections or formatting blocks.",
    checks,
    missingSections,
    criticalIssues,
    suggestions,
    courtType,
    draftType
  };
}

module.exports = {
  analyzeDraftValidation
};
