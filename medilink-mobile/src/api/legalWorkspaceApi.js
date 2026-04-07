const PROJECT_ID = "medilink-ai-b3cf9";
const FUNCTIONS_REGION = "us-central1";
const LEGAL_ASSISTANT_ENDPOINT = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net/legalAssistant`;

async function callLegalAssistant(payload) {
  const response = await fetch(LEGAL_ASSISTANT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `legalAssistant failed with ${response.status}`);
  }

  return response.json();
}

function buildMatterResearchQuery(matter = {}) {
  const title = String(matter.title || "").trim();
  const type = String(matter.caseDetails?.type || "").trim();
  const court = String(matter.caseDetails?.court || "").trim();
  const issues = Array.isArray(matter.research?.issues) ? matter.research.issues.slice(0, 3).join(" ") : "";
  const facts = String(matter.caseDetails?.facts || "").trim().slice(0, 220);

  return [title, type, court, issues, facts].filter(Boolean).join(" | ");
}

export async function listRemoteCases(ownerId) {
  const response = await callLegalAssistant({
    action: "cases_list",
    ownerId
  });
  return Array.isArray(response.cases) ? response.cases : [];
}

export async function listRemoteClients(ownerId) {
  const response = await callLegalAssistant({
    action: "clients_list",
    ownerId
  });
  return Array.isArray(response.clients) ? response.clients : [];
}

export async function saveRemoteClient(ownerId, matter) {
  return callLegalAssistant({
    action: "client_upsert",
    ownerId,
    client: {
      id: matter.clientId || "",
      name: matter.client || "",
      phone: matter.profile?.phone || "",
      notes: matter.profile?.note || ""
    }
  });
}

function buildPersistedWorkspaceState(workspaceState = {}) {
  return {
    draftStatus: workspaceState?.draftStatus || "",
    validation: workspaceState?.validation || "",
    filingPack: workspaceState?.filingPack || "",
    currentDraft: workspaceState?.currentDraft || "",
    draftHistory: Array.isArray(workspaceState?.draftHistory) ? workspaceState.draftHistory.slice(0, 10) : [],
    validationReport: workspaceState?.validationReport || null,
    filingChecklist: Array.isArray(workspaceState?.filingChecklist) ? workspaceState.filingChecklist : [],
    savedNotes: Array.isArray(workspaceState?.savedNotes) ? workspaceState.savedNotes.slice(0, 20) : [],
    lastOpenedAt: workspaceState?.lastOpenedAt || ""
  };
}

function buildPersistedMatterSnapshot(matter = {}, workspaceState = null) {
  return {
    matter: {
      title: matter.title || "",
      client: matter.client || "",
      clientId: matter.clientId || "",
      stage: matter.stage || "Draft",
      status: matter.status || "",
      profile: {
        phone: matter.profile?.phone || "",
        location: matter.profile?.location || "",
        note: matter.profile?.note || ""
      },
      caseDetails: {
        type: matter.caseDetails?.type || "",
        court: matter.caseDetails?.court || "",
        nextDate: matter.caseDetails?.nextDate || "",
        facts: matter.caseDetails?.facts || "",
        documents: matter.caseDetails?.documents || ""
      },
      research: {
        issues: Array.isArray(matter.research?.issues) ? matter.research.issues : [],
        authorities: Array.isArray(matter.research?.authorities) ? matter.research.authorities : [],
        citations: Array.isArray(matter.research?.citations) ? matter.research.citations : [],
        arguments: Array.isArray(matter.research?.arguments) ? matter.research.arguments : []
      },
      finalSummary: {
        draftStatus: matter.finalSummary?.draftStatus || "",
        validation: matter.finalSummary?.validation || "",
        filingPack: matter.finalSummary?.filingPack || ""
      },
      lastOpenedAt: matter.lastOpenedAt || ""
    },
    workspace: buildPersistedWorkspaceState(workspaceState || matter.workspaceState || {})
  };
}

export async function saveRemoteCase(ownerId, matter, clientId = "", workspaceState = null) {
  return callLegalAssistant({
    action: "case_upsert",
    ownerId,
    caseItem: {
      id: matter.id || "",
      clientId,
      title: matter.title || "",
      stage: matter.stage || "Draft",
      notes: [
        matter.status || "",
        matter.caseDetails?.type ? `Type: ${matter.caseDetails.type}` : "",
        matter.caseDetails?.court ? `Court: ${matter.caseDetails.court}` : "",
        matter.caseDetails?.facts ? `Facts: ${matter.caseDetails.facts}` : "",
        matter.caseDetails?.documents ? `Documents: ${matter.caseDetails.documents}` : ""
      ].filter(Boolean).join("\n"),
      nextHearingDate: matter.caseDetails?.nextDate || "",
      workspaceState: buildPersistedMatterSnapshot(matter, workspaceState)
    }
  });
}

export async function retrieveLiveJudgments(ownerId, matter, options = {}) {
  const query = buildMatterResearchQuery(matter);
  if (!query) {
    return {
      judgments: [],
      fetchedSources: [],
      sourceMode: "cache",
      importReport: null,
      query: ""
    };
  }

  const response = await callLegalAssistant({
    action: "judgments_live_retrieve",
    ownerId,
    sourceId: options.sourceId || "all",
    limit: Math.min(Number(options.limit || 6), 10),
    useAiEnrichment: options.useAiEnrichment !== false,
    maxAiEnrichmentRecords: Math.min(Math.max(Number(options.maxAiEnrichmentRecords || 3), 0), 6),
    query
  });

  return {
    judgments: Array.isArray(response.judgments) ? response.judgments : [],
    fetchedSources: Array.isArray(response.fetchedSources) ? response.fetchedSources : [],
    sourceMode: response.sourceMode || "cache",
    importReport: response.importReport || null,
    query
  };
}

function buildCaseDetailsFromNotes(notesText = "") {
  const notes = String(notesText || "");
  const typeMatch = notes.match(/Type:\s*(.+)/i);
  const courtMatch = notes.match(/Court:\s*(.+)/i);
  const factsMatch = notes.match(/Facts:\s*(.+)/i);
  const docsMatch = notes.match(/Documents:\s*(.+)/i);

  return {
    type: typeMatch?.[1]?.trim() || "General Matter",
    court: courtMatch?.[1]?.trim() || "Not set",
    nextDate: "Not scheduled",
    facts: factsMatch?.[1]?.trim() || "Facts pending",
    documents: docsMatch?.[1]?.trim() || "Documents pending"
  };
}

export function mergeRemoteCasesIntoMatters(localMatters, remoteCases) {
  const existingById = new Map(localMatters.map((item) => [item.id, item]));

  const remoteMapped = remoteCases.map((item) => {
    const existing = existingById.get(item.id);
    const caseDetails = buildCaseDetailsFromNotes(item.notes);
    const snapshotRoot = item.workspaceState && typeof item.workspaceState === "object" ? item.workspaceState : {};
    const snapshotMatter = snapshotRoot.matter && typeof snapshotRoot.matter === "object" ? snapshotRoot.matter : snapshotRoot;
    const snapshotWorkspace = snapshotRoot.workspace && typeof snapshotRoot.workspace === "object" ? snapshotRoot.workspace : null;
    const snapshotCaseDetails = snapshotMatter.caseDetails && typeof snapshotMatter.caseDetails === "object" ? snapshotMatter.caseDetails : {};
    const snapshotProfile = snapshotMatter.profile && typeof snapshotMatter.profile === "object" ? snapshotMatter.profile : {};
    const snapshotResearch = snapshotMatter.research && typeof snapshotMatter.research === "object" ? snapshotMatter.research : null;
    const snapshotFinalSummary = snapshotMatter.finalSummary && typeof snapshotMatter.finalSummary === "object" ? snapshotMatter.finalSummary : null;

    return {
      id: item.id,
      title: item.title || snapshotMatter.title || existing?.title || "Untitled Matter",
      client: snapshotMatter.client || existing?.client || "Synced Client",
      clientId: item.clientId || snapshotMatter.clientId || existing?.clientId || "",
      stage: item.stage || snapshotMatter.stage || existing?.stage || "Draft",
      status: snapshotMatter.status || existing?.status || "Synced from legal workspace",
      profile: {
        phone: snapshotProfile.phone || existing?.profile?.phone || "Not provided",
        location: snapshotProfile.location || existing?.profile?.location || "Not provided",
        note: snapshotProfile.note || existing?.profile?.note || "Synced case profile pending enrichment."
      },
      caseDetails: {
        ...(existing?.caseDetails || {}),
        ...snapshotCaseDetails,
        ...caseDetails,
        nextDate: item.nextHearingDate || snapshotCaseDetails.nextDate || existing?.caseDetails?.nextDate || "Not scheduled"
      },
      research: snapshotResearch || existing?.research || {
        issues: ["Issues pending"],
        authorities: ["Authorities pending"],
        citations: ["Citations pending"],
        arguments: ["Arguments pending"]
      },
      finalSummary: snapshotFinalSummary || existing?.finalSummary || {
        draftStatus: "Draft not generated",
        validation: "Awaiting review",
        filingPack: "No pack yet"
      },
      lastOpenedAt: snapshotMatter.lastOpenedAt || existing?.lastOpenedAt || item.updatedAt || null,
      workspaceState: snapshotWorkspace || existing?.workspaceState || null
    };
  });

  const remoteIds = new Set(remoteMapped.map((item) => item.id));
  const localOnly = localMatters.filter((item) => !remoteIds.has(item.id));
  return [...remoteMapped, ...localOnly];
}
