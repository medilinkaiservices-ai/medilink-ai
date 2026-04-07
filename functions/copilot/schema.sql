CREATE TABLE copilot_sessions (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(128) NOT NULL,
  matter_id VARCHAR(128) NULL,
  workflow_state VARCHAR(32) NOT NULL DEFAULT 'intake',
  active_document_type VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE case_memory (
  session_id VARCHAR(64) PRIMARY KEY,
  case_type VARCHAR(128) NULL,
  facts_summary TEXT NULL,
  issues_json JSON NULL,
  jurisdiction VARCHAR(128) NULL,
  stage VARCHAR(128) NULL,
  document_type VARCHAR(32) NULL,
  parties_json JSON NULL,
  relief_sought TEXT NULL,
  generated_documents_json JSON NULL,
  validation_state_json JSON NULL,
  context_packet_json JSON NULL,
  missing_critical_fields_json JSON NULL,
  last_action VARCHAR(64) NULL,
  workflow_state VARCHAR(32) NOT NULL DEFAULT 'intake',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_memory_session
    FOREIGN KEY (session_id) REFERENCES copilot_sessions(id)
);
