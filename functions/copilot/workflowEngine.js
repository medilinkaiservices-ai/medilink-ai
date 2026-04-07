"use strict";

const { WORKFLOW_STATES } = require("./constants");

const TRANSITIONS = Object.freeze({
  [WORKFLOW_STATES.INTAKE]: [WORKFLOW_STATES.CONTEXT_READY],
  [WORKFLOW_STATES.CONTEXT_READY]: [WORKFLOW_STATES.DRAFT, WORKFLOW_STATES.FILING],
  [WORKFLOW_STATES.DRAFT]: [WORKFLOW_STATES.DRAFT, WORKFLOW_STATES.VALIDATE, WORKFLOW_STATES.FILING],
  [WORKFLOW_STATES.VALIDATE]: [WORKFLOW_STATES.DRAFT, WORKFLOW_STATES.FILING],
  [WORKFLOW_STATES.FILING]: []
});

function computeMissingCriticalFields(memory = {}) {
  const missing = [];

  if (!String(memory.caseType || "").trim()) missing.push("caseType");
  if (!String(memory.factsSummary || "").trim()) missing.push("factsSummary");
  if (!String(memory.jurisdiction || "").trim()) missing.push("jurisdiction");
  if (!String(memory.stage || "").trim() && !String(memory.documentType || "").trim()) {
    missing.push("stage_or_documentType");
  }

  return missing;
}

function canTransition(fromState, toState) {
  return Boolean(TRANSITIONS[fromState]?.includes(toState));
}

function assertTransition(fromState, toState) {
  if (!canTransition(fromState, toState)) {
    throw new Error(`Invalid workflow transition: ${fromState} -> ${toState}`);
  }
}

function getAllowedActions(state, memory = {}) {
  const missingCriticalFields = computeMissingCriticalFields(memory);
  const hasDraft = Boolean(String(memory.workspaceDraft || "").trim())
    || (Array.isArray(memory.generatedDocuments) && memory.generatedDocuments.length > 0);
  const hasValidation = Boolean(memory.validationState && memory.validationState.status !== "not_run");

  switch (state) {
    case WORKFLOW_STATES.INTAKE:
      return missingCriticalFields.length ? ["submit_intake"] : ["build_context"];
    case WORKFLOW_STATES.CONTEXT_READY:
      return [
        "generate_notice",
        "prepare_complaint",
        "prepare_affidavit",
        "validate_existing_draft",
        "filing_guidance"
      ];
    case WORKFLOW_STATES.DRAFT:
      return [
        "regenerate_draft",
        "validate_draft",
        "filing_guidance",
        ...(hasDraft ? ["edit_draft"] : [])
      ];
    case WORKFLOW_STATES.VALIDATE:
      return [
        "fix_draft",
        "regenerate_draft",
        "filing_guidance",
        ...(hasValidation ? ["view_validation_report"] : [])
      ];
    case WORKFLOW_STATES.FILING:
      return ["view_filing_guidance", ...(hasDraft ? ["regenerate_draft"] : [])];
    default:
      return [];
  }
}

function deriveNextState({ currentState, action, memory = {} }) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (normalizedAction === "submit_intake" || normalizedAction === "build_context") {
    return computeMissingCriticalFields(memory).length ? WORKFLOW_STATES.INTAKE : WORKFLOW_STATES.CONTEXT_READY;
  }
  if (["generate_notice", "prepare_complaint", "prepare_affidavit", "regenerate_draft", "edit_draft"].includes(normalizedAction)) {
    return WORKFLOW_STATES.DRAFT;
  }
  if (["validate_draft", "validate_existing_draft", "view_validation_report", "fix_draft"].includes(normalizedAction)) {
    return WORKFLOW_STATES.VALIDATE;
  }
  if (["filing_guidance", "view_filing_guidance"].includes(normalizedAction)) {
    return WORKFLOW_STATES.FILING;
  }
  return currentState;
}

module.exports = {
  WORKFLOW_STATES,
  TRANSITIONS,
  computeMissingCriticalFields,
  canTransition,
  assertTransition,
  getAllowedActions,
  deriveNextState
};
