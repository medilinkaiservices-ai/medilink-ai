const INTEGRATION_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/integrationSync",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/integrationSync"
];

async function postIntegrationAction(payload) {
  let lastError = null;

  for (const endpoint of INTEGRATION_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Integration request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not reach integration service.");
}

export function saveIntegrationConfig(payload) {
  return postIntegrationAction({
    ...payload,
    action: "saveConfig"
  });
}

export function testIntegrationConnection(payload) {
  return postIntegrationAction({
    ...payload,
    action: "testConnection"
  });
}

export function runIntegrationSync(payload) {
  return postIntegrationAction({
    ...payload,
    action: "runSync"
  });
}
