"use strict";

const WORKFLOW_STATES = Object.freeze({
  INTAKE: "intake",
  CONTEXT_READY: "context_ready",
  DRAFT: "draft",
  VALIDATE: "validate",
  FILING: "filing"
});

const DOCUMENT_TYPES = Object.freeze([
  "notice",
  "complaint",
  "affidavit"
]);

module.exports = {
  WORKFLOW_STATES,
  DOCUMENT_TYPES
};
