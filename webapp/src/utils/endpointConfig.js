const API_MODE = String(process.env.REACT_APP_API_MODE || "local").trim().toLowerCase();
const PROJECT_ID = String(process.env.REACT_APP_FIREBASE_PROJECT_ID || "medilink-ai-b3cf9").trim();
const FUNCTIONS_REGION = String(process.env.REACT_APP_FUNCTIONS_REGION || "us-central1").trim();
const LOCAL_FUNCTIONS_BASE = String(
  process.env.REACT_APP_FUNCTIONS_BASE
  || `http://127.0.0.1:5201/${PROJECT_ID}/${FUNCTIONS_REGION}`
).trim();
const CLOUD_FUNCTIONS_BASE = String(
  process.env.REACT_APP_CLOUD_FUNCTIONS_BASE
  || `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`
).trim();

function buildEndpoint(functionName) {
  return API_MODE === "cloud"
    ? `${CLOUD_FUNCTIONS_BASE}/${functionName}`
    : `${LOCAL_FUNCTIONS_BASE}/${functionName}`;
}

export const endpointConfig = {
  apiMode: API_MODE,
  useLocalCopilotOnly: String(process.env.REACT_APP_LOCAL_COPILOT_ONLY || "false").trim().toLowerCase() === "true",
  legalAssistant: buildEndpoint("legalAssistant"),
  legalCaseValidity: buildEndpoint("legalCaseValidity"),
  legalCaseCitations: buildEndpoint("legalCaseCitations"),
  legalArgumentBuilder: buildEndpoint("legalArgumentBuilder"),
  legalCaseStrength: buildEndpoint("legalCaseStrength"),
  legalCasePrediction: buildEndpoint("legalCasePrediction"),
  legalFilingReadiness: buildEndpoint("legalFilingReadiness"),
  legalAuthorityGuardrails: buildEndpoint("legalAuthorityGuardrails"),
  legalReviewWorkflow: buildEndpoint("legalReviewWorkflow"),
  legalMatterConsistency: buildEndpoint("legalMatterConsistency"),
  legalEvidenceCoverage: buildEndpoint("legalEvidenceCoverage"),
  legalDraftValidation: buildEndpoint("legalDraftValidation"),
  legalFilingPack: buildEndpoint("legalFilingPack"),
  legalDocumentAnalyze: buildEndpoint("legalDocumentAnalyze"),
  legalCopilot: `${buildEndpoint("legalCopilot")}/copilot`
};
