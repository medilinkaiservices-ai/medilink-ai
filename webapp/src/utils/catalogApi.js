const LOCAL_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/catalogSuggest",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/catalogSuggest"
];

const DOCUMENT_IMPORT_ENDPOINTS = [
  "http://127.0.0.1:5201/medilink-ai-b3cf9/us-central1/catalogDocumentImport",
  "https://us-central1-medilink-ai-b3cf9.cloudfunctions.net/catalogDocumentImport"
];

export async function fetchCatalogSuggestions(payload) {
  let lastError = null;

  for (const endpoint of LOCAL_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Suggestion request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not fetch product suggestions.");
}

export async function importCatalogFromDocument(payload) {
  let lastError = null;

  for (const endpoint of DOCUMENT_IMPORT_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Document import failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not import products from document.");
}
