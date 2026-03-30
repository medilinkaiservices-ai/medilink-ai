export const CONNECTOR_TYPES = [
  "Website",
  "Mobile App",
  "POS Software",
  "ERP",
  "CRM",
  "Hospital HMS",
  "Custom Software"
];

export const CONNECTION_METHODS = [
  "API",
  "Webhook",
  "Database Bridge",
  "CSV Import",
  "Manual Sync"
];

export const DATABASE_PROVIDERS = [
  "Firebase",
  "MySQL",
  "PostgreSQL",
  "MongoDB",
  "SQL Server",
  "Oracle",
  "Custom"
];

export const SYNC_DIRECTIONS = [
  "Import into Medilink",
  "Export from Medilink",
  "Two-way sync"
];

export function createDefaultIntegrationConfig(current = {}) {
  return {
    softwareName: current.softwareName || "",
    connectorType: current.connectorType || "Website",
    websiteUrl: current.websiteUrl || "",
    apiBaseUrl: current.apiBaseUrl || "",
    webhookUrl: current.webhookUrl || "",
    connectionMethod: current.connectionMethod || "API",
    databaseProvider: current.databaseProvider || "Firebase",
    databaseName: current.databaseName || "",
    syncDirection: current.syncDirection || "Import into Medilink",
    accessKeyLabel: current.accessKeyLabel || "",
    integrationNotes: current.integrationNotes || "",
    syncEnabled: current.syncEnabled === undefined ? false : Boolean(current.syncEnabled)
  };
}
