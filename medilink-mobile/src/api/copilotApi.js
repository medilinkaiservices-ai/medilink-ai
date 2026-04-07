const PROJECT_ID = "medilink-ai-b3cf9";
const FUNCTIONS_REGION = "us-central1";
const LEGAL_COPILOT_ENDPOINT = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net/legalCopilot/copilot`;
const COPILOT_TIMEOUT_MS = 90000;

async function callCopilot(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COPILOT_TIMEOUT_MS);

  try {
    const response = await fetch(`${LEGAL_COPILOT_ENDPOINT}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Copilot request failed with ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Copilot backend timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startCopilotSession(payload = {}) {
  return callCopilot("/session/start", {
    method: "POST",
    body: payload
  });
}

export function submitCopilotIntake(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/intake`, {
    method: "POST",
    body: payload
  });
}

export function buildCopilotContext(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/context`, {
    method: "POST",
    body: payload
  });
}

export function sendCopilotChatMessage(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/chat`, {
    method: "POST",
    body: payload
  });
}

export function generateCopilotDraft(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/draft`, {
    method: "POST",
    body: payload
  });
}

export function validateCopilotDraft(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/validate`, {
    method: "POST",
    body: payload
  });
}

export function autoFixCopilotDraft(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/autofix`, {
    method: "POST",
    body: payload
  });
}

export function fetchFilingGuidance(sessionId, payload = {}) {
  return callCopilot(`/session/${encodeURIComponent(sessionId)}/filing`, {
    method: "POST",
    body: payload
  });
}
