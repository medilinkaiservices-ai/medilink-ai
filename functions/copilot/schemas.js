"use strict";

const { WORKFLOW_STATES } = require("./constants");

function createDefaultCaseMemory(overrides = {}) {
  return {
    caseType: null,
    factsSummary: "",
    issues: [],
    jurisdiction: null,
    stage: null,
    documentType: null,
    parties: {
      claimant: "",
      respondent: ""
    },
    reliefSought: "",
    generatedDocuments: [],
    validationState: {
      status: "not_run",
      warnings: [],
      missingSections: [],
      unsupportedClaims: [],
      citationIssues: []
    },
    workspaceSummary: "",
    workspaceDraft: "",
    workspaceAuthorities: [],
    workspaceTab: "",
    workspaceScreen: "",
    workspaceSourceScreen: "",
    workspaceAvailableActions: [],
    contextPacket: {
      sections: [],
      judgments: [],
      authoritiesSummary: ""
    },
    missingCriticalFields: [],
    lastAction: "session_started",
    workflowState: WORKFLOW_STATES.INTAKE,
    ...overrides
  };
}

function createSessionRecord({ ownerId = "anonymous", matterId = null, workflowState = WORKFLOW_STATES.INTAKE } = {}) {
  return {
    ownerId,
    matterId,
    workflowState,
    activeDocumentType: null,
    createdAt: null,
    updatedAt: null
  };
}

module.exports = {
  createDefaultCaseMemory,
  createSessionRecord
};
