"use strict";

const admin = require("firebase-admin");
const caseMemoryService = require("./caseMemoryService");
const workflowEngine = require("./workflowEngine");
const { buildContext } = require("./contextBuilder");
const caseLawMapper = require("./caseLawMapper");
const promptBuilder = require("./promptBuilder");
const { formatList, formatSections, formatJudgments, formatParties } = require("./promptBuilder");
const { executeWithResponseFilter } = require("./aiResponseFilter");
const { createExecutor, getActiveProvider } = require("./aiExecution");
const { validateDocument, autoFixDocument } = require("./validationService");

function extractOwnerId(req) {
  return String(req.body?.ownerId || req.headers["x-owner-id"] || "anonymous").trim();
}

function sendError(res, error, status = 500) {
  return res.status(status).json({
    ok: false,
    error: error.message || "Request failed"
  });
}

function normalizeTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreJudgmentMatch(item, searchQuery = "") {
  const queryTokens = normalizeTokens(searchQuery);
  const haystack = normalizeTokens([
    item.title,
    item.case_name,
    item.caseName,
    item.citation,
    item.summary,
    item.ratioNote,
    item.holding,
    Array.isArray(item.issueTags) ? item.issueTags.join(" ") : "",
    item.court
  ].join(" "));

  return queryTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

async function fetchScopedJudgments({ searchQuery = "", limit = 8 } = {}) {
  try {
    const snapshot = await admin.firestore()
      .collection("legalJudgments")
      .limit(60)
      .get();

    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .map((item) => ({
        ...item,
        matchScore: scoreJudgmentMatch(item, searchQuery)
      }))
      .filter((item) => item.matchScore > 0)
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return String(b.judgmentDate || "").localeCompare(String(a.judgmentDate || ""));
      })
      .slice(0, limit);
  } catch (error) {
    return [];
  }
}

function buildJudgmentSourceSummary(judgments = []) {
  const sourceCounts = judgments.reduce((acc, item) => {
    const key = String(item.sourceType || "judgment_library").trim() || "judgment_library";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(sourceCounts).map(([source, count]) => `${source}:${count}`);
}

function inferProposedActionId({ message = "", reply = "", contextPacket = {} } = {}) {
  const combined = `${String(message || "")}\n${String(reply || "")}`.toLowerCase();
  const analysisOnly =
    /\b(case study|study the case|study case|review the case|case review|legal guidance|legal strategy|how to argue|how to defend|how to use the law|which law applies|what are the legal issues|strengths and weaknesses|pros and cons|merits|demerits)\b/.test(combined);
  const hasSupport =
    (Array.isArray(contextPacket?.judgments) && contextPacket.judgments.length > 0)
    || (Array.isArray(contextPacket?.sections) && contextPacket.sections.length > 0);
  const supportExcerptOnly =
    /\bexcerpt\b/.test(combined)
    && /\b(support|explain|review|authority|citation|judgment|judgement|research)\b/.test(combined)
    && !/\b(update draft|replace in draft|apply to draft|revised draft|updated draft)\b/.test(combined);

  if (supportExcerptOnly) {
    return "";
  }

  if (analysisOnly) {
    return "";
  }

  if (/draft.*(generate|create|prepare).*(validate|validation)|generate.*draft.*validate/i.test(combined)) {
    return "generate_then_validate";
  }

  if (/auto[\s-]?fix.*validate|fix issues.*validate|auto fix issues/i.test(combined)) {
    return "autofix_then_validate";
  }

  if (/validate draft|draft.*validate|validation|ధృవీకరించ/i.test(combined)) {
    return "validate_draft";
  }

  if (/generate draft|draft generated|draft.*జనరేట్|draft.*prepare/i.test(combined)) {
    return "generate_draft";
  }

  if (/filing pack|final summary|build filing/i.test(combined)) {
    return "build_filing_pack";
  }

  if (hasSupport && /research|authority|authorities|citation|citations|judgment|judgments|case law|support/i.test(combined)) {
    return "save_support_to_research";
  }

  if (/profile/i.test(combined) && /save|update|note/i.test(combined)) {
    return "save_to_profile";
  }

  if (/issue|issues/i.test(combined) && /research|add|save|update/i.test(combined)) {
    return "save_to_research";
  }

  if (/draft|pleading|complaint|petition|notice/i.test(combined) && /updated draft|revised draft|apply|replace|insert/i.test(combined)) {
    return "apply_to_draft";
  }

  if (/case|matter|filing varaku|one by one|step by step|handle/i.test(combined)) {
    return "drive_case_forward";
  }

  return "";
}

function buildFallbackDraft({ memory = {}, documentType = "notice", contextPacket = {} } = {}) {
  const issueLines = Array.isArray(memory.issues) && memory.issues.length
    ? memory.issues.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "1. Issue details to be refined.";
  const sectionRefs = Array.isArray(contextPacket.sections)
    ? contextPacket.sections.slice(0, 4).map((item) => item.label || item.title).filter(Boolean)
    : [];

  if (documentType === "complaint") {
    return [
      "COMPLAINT DRAFT",
      "",
      "PARTIES",
      `Complainant: ${memory.parties?.claimant || "[claimant details]"}`,
      `Respondent: ${memory.parties?.respondent || "[respondent details]"}`,
      "",
      "FACTS",
      memory.factsSummary || "[facts summary required]",
      "",
      "CAUSE OF ACTION",
      memory.reliefSought || "Cause of action should be aligned with the pleaded facts and documents.",
      "",
      "JURISDICTION",
      memory.jurisdiction || "[jurisdiction to be inserted]",
      "",
      "GROUNDS",
      issueLines,
      "",
      "AUTHORITIES",
      sectionRefs.length ? sectionRefs.join("\n") : "Scoped authorities to be inserted after verification.",
      "",
      "PRAYER",
      "The complainant seeks appropriate relief in accordance with law."
    ].join("\n");
  }

  if (documentType === "affidavit") {
    return [
      "AFFIDAVIT",
      "",
      "DEPONENT DETAILS",
      memory.parties?.claimant || "[deponent details]",
      "",
      "STATEMENTS ON OATH",
      "I solemnly affirm and state as follows:",
      memory.factsSummary || "[facts summary required]",
      "",
      "VERIFICATION",
      "Verified that the contents are true to knowledge and belief."
    ].join("\n");
  }

  return [
    "LEGAL NOTICE",
    "",
    "FROM",
    memory.parties?.claimant || "[sender details]",
    "",
    "TO",
    memory.parties?.respondent || "[recipient details]",
    "",
    "SUBJECT",
    memory.caseType || "Legal notice",
    "",
    "FACTUAL BACKGROUND",
    memory.factsSummary || "[facts summary required]",
    "",
    "LEGAL RESPONSE",
    sectionRefs.length ? sectionRefs.join("\n") : "Applicable legal basis to be inserted after verification.",
    "",
    "RESERVATION OF RIGHTS",
    "All rights and remedies are reserved."
  ].join("\n");
}

function classifyGenerationFailure(error) {
  const message = String(error?.message || "").trim();
  const statusCode = Number(error?.response?.status || 0) || null;

  if (!message && !statusCode) {
    return {
      code: "unknown_failure",
      message: "Unknown provider failure"
    };
  }

  if (/No AI provider key is configured/i.test(message)) {
    return {
      code: "provider_not_configured",
      message: "No AI provider key is configured"
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      code: "provider_auth_failed",
      message: message || `Provider request failed with ${statusCode}`
    };
  }

  if (statusCode === 429) {
    return {
      code: "provider_rate_limited",
      message: message || "Provider rate limit reached"
    };
  }

  if (statusCode >= 500) {
    return {
      code: "provider_server_error",
      message: message || `Provider server error ${statusCode}`
    };
  }

  return {
    code: statusCode ? "provider_request_failed" : "executor_failed",
    message: message || "Provider request failed"
  };
}

async function startSession(req, res) {
  try {
    const ownerId = extractOwnerId(req);
    const matterId = req.body?.matterId || null;
    const result = await caseMemoryService.createSession({ ownerId, matterId });
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}

async function getSession(req, res) {
  try {
    const result = await caseMemoryService.getSession(req.params.id);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 404);
  }
}

async function intake(req, res) {
  try {
    const sessionId = req.params.id;
    const patch = {
      caseType: req.body.caseType || null,
      factsSummary: req.body.factsSummary || req.body.userInput || "",
      issues: Array.isArray(req.body.issues) ? req.body.issues : [],
      jurisdiction: req.body.jurisdiction || null,
      stage: req.body.stage || null,
      documentType: req.body.documentType || null,
      parties: req.body.parties && typeof req.body.parties === "object"
        ? {
            claimant: req.body.parties.claimant || "",
            respondent: req.body.parties.respondent || ""
          }
        : {
            claimant: "",
            respondent: ""
          },
      reliefSought: req.body.reliefSought || "",
      workspaceSummary: req.body.workspaceSummary || "",
      workspaceDraft: req.body.workspaceDraft || "",
      workspaceAuthorities: Array.isArray(req.body.workspaceAuthorities) ? req.body.workspaceAuthorities : [],
      workspaceTab: req.body.workspaceTab || "",
      workspaceScreen: req.body.workspaceScreen || req.body.workspaceTab || "",
      workspaceSourceScreen: req.body.workspaceSourceScreen || "",
      workspaceAvailableActions: Array.isArray(req.body.workspaceAvailableActions) ? req.body.workspaceAvailableActions : [],
      lastAction: "submit_intake"
    };

    const updated = await caseMemoryService.updateCaseMemory(sessionId, patch);
    const nextState = workflowEngine.deriveNextState({
      currentState: updated.session.workflowState,
      action: "submit_intake",
      memory: updated.memory
    });

    await caseMemoryService.updateSessionState(sessionId, nextState, {
      activeDocumentType: updated.memory.documentType || null
    });

    return res.status(200).json({
      ok: true,
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function context(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    const retrievalAdapters = {
      fetchJudgments: async ({ searchQuery, issue, jurisdiction, stage, documentType }) => fetchScopedJudgments({
        searchQuery: [searchQuery, issue, jurisdiction, stage, documentType].filter(Boolean).join(" "),
        limit: 8
      })
    };
    const contextPacket = await buildContext({
      memory: current.memory,
      retrievalAdapters,
      caseLawMapper
    });
    const judgmentSourceSummary = buildJudgmentSourceSummary(contextPacket.judgments);

    await caseMemoryService.updateCaseMemory(sessionId, {
      contextPacket: {
        ...contextPacket,
        judgmentSourceSummary
      },
      lastAction: "build_context"
    });
    await caseMemoryService.updateSessionState(sessionId, workflowEngine.WORKFLOW_STATES.CONTEXT_READY);

    return res.status(200).json({
      ok: true,
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function actions(req, res) {
  try {
    const current = await caseMemoryService.getSession(req.params.id);
    return res.status(200).json({
      ok: true,
      workflowState: current.session.workflowState,
      allowedActions: workflowEngine.getAllowedActions(current.session.workflowState, current.memory)
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function chat(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return sendError(res, new Error("Missing copilot message."), 400);
    }

    const externalHistory = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((item) => item && typeof item === "object")
          .slice(-8)
          .map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            text: String(item.text || "").trim()
          }))
          .filter((item) => item.text)
      : [];

    const contextPacket = current.memory.contextPacket || { sections: [], judgments: [], authoritiesSummary: "" };
    const currentDraft = String(
      current.memory.workspaceDraft
      || (current.memory.generatedDocuments?.length
        ? current.memory.generatedDocuments[current.memory.generatedDocuments.length - 1]?.content
        : "")
      || ""
    ).trim();
    const prompt = [
      "You are a legal copilot for an Indian lawyer workspace.",
      "Answer the user's latest message directly and naturally.",
      "Sound warm, smart, and practical, not robotic or over-controlled.",
      "First understand what the user actually meant in everyday language, then answer that meaning directly before suggesting or taking any next step.",
      "Do not ignore the user's wording and jump into a different task just because a related workflow exists.",
      "If the user is frustrated, de-escalate gently, acknowledge the problem briefly, and then solve it.",
      "Prefer clear conversational Telugu-English mixed phrasing when the user writes that way.",
      "Explain things like a capable teammate, not like a policy engine or rigid assistant.",
      "Avoid repetitive refusal-style wording, avoid overusing 'you should go to this screen', and avoid sounding bossy.",
      "When the user asks a question, answer the question first. Only after that, if useful, mention the action you can take.",
      "If the user gives an instruction and also expects an explanation, briefly explain what you understood and then do the task.",
      "Do not start with a capability summary or menu.",
      "Use the active session facts, scoped authorities, and draft only when helpful.",
      "If the user asks about app features, settings, tools, sections, workflow, or how to use the app, answer from the workspace summary and capability notes instead of switching into legal drafting mode.",
      "For app-usage questions, answer like an in-app product guide: be practical, step-by-step, and mention the exact screen name and exact button label when possible.",
      "If the user asks where an option is, tell them the exact path such as Research -> Generate Draft or Draft -> Edit Draft.",
      "If the user asks how draft changes are fixed or applied, explain the exact app flow using the Draft screen, Copilot screen, validation, autofix, filing pack, and final summary actions.",
      "If the user asks you to do a supported workspace action, behave like an active workspace assistant instead of a passive tutorial.",
      "Supported workspace actions include generating a draft, validating a draft, auto-fixing issues, building the filing pack, opening a screen, saving details to profile or research, and applying returned text to the draft.",
      "For supported actions, do not keep telling the user to click buttons if Copilot can handle the action flow.",
      "If the user says things like research cheyu, add cheyyu, validate cheyyu, one by one anni cheseyu, nuvve cheyyu, or filing varaku teskelu, act on the request instead of sending them to a screen.",
      "For normal workspace actions, do not ask for lawyer approval first. Just do the action and report the result clearly.",
      "Behave like the owner of the case workflow, not like a passive explainer.",
      "Your job is to study the loaded matter, identify what is missing, tell the lawyer clearly, and keep moving the case forward until the next real blocker.",
      "Do not wait for the user to invent the next step if the next step is already obvious from the workspace.",
      "If the user asks what next, what is missing, or how to complete the case, give a practical case-status answer, not a generic capability answer.",
      "For matter-specific chats, think like this: what is the case about, what stage is it in, what gaps exist, what can I do now, and what exact lawyer fact is still needed.",
      "Do not over-focus on draft, validation, or filing workflow when the user is asking for case study, legal reasoning, legal strategy, strengths, weaknesses, issues, defences, risks, or which law applies.",
      "For a law-agent style ask, your first job is substantive legal analysis: identify legal issues, applicable law, elements to prove, likely objections, strengths, weaknesses, risks, evidence gaps, and strategic next moves.",
      "When the user asks to study a case, behave like a serious junior counsel: read the facts, identify the cause of action or defence, separate fact issues from law issues, mention what must be proved, and explain where the case is weak or strong.",
      "For case-study requests, prefer legal guidance over workflow guidance.",
      "Only talk about draft generation, validation, autofix, or filing pack after you have first given the actual legal analysis the user asked for.",
      "If the law itself is the important part, explain the law in the context of the current case instead of steering the conversation back to app workflow.",
      "If there is no strong authority yet, still help by analysing the case theory, likely legal position, and what research should target next.",
      "If you can identify defects in the case, draft, research, validation, or filing readiness from the workspace, list them plainly and help fix them instead of speaking in vague generalities.",
      "If the user sounds stuck, take initiative: recommend the next best action and, if it is a supported action, act on it.",
      "Do not keep repeating the same recommendation if it did not help the user. Move to the next useful step or clearly state the blocker.",
      "Do not ask the lawyer to do work that Copilot can already do from the loaded workspace.",
      "When the matter is not filing-ready, say exactly why, what is missing, what you can fix now, and what you still need from the lawyer.",
      "When the user asks to study the case, review the matter as a whole: facts, parties, relief, research, draft, validation, unsupported points, and filing readiness.",
      "But in that review, start from legal understanding of the case, not from document workflow.",
      "After studying the case, answer in a teammate style: current position, problems found, fixes you can do now, missing lawyer inputs, and the next best step.",
      "Never narrate a fake in-progress action such as 'I am validating now' or 'I am updating now'.",
      "Either provide the completed result or ask for the exact missing fact. Do not say an action is still running in chat.",
      "Do not tell the user to manually click Add Issue, Validate Draft, or similar controls when they asked you to do the task yourself.",
      "Avoid button-heavy or menu-heavy guidance unless the user explicitly asks where a button or option is.",
      "If the user asks you to handle the matter, take it forward, complete it, or get it ready for filing, act like the assigned assistant for that case.",
      "For such end-to-end matter requests, first say what you already reviewed in the workspace, then identify the immediate gaps, and then ask only for the exact missing lawyer facts you need next.",
      "Do not hand the work back as a generic to-do list when you can already infer the next drafting or validation step from WORKSPACE SUMMARY.",
      "Prefer 'I will do this now' and 'I need these details from you next' over 'go to this screen and click that button', unless the user explicitly asks for button location.",
      "For a matter-specific conversation, behave like a filing assistant that studies the loaded case details, research, draft, validation, and filing status before answering.",
      "Your default reply pattern should feel like a strong agent teammate: 1) direct answer, 2) short reasoning/explanation, 3) what you will do next or what exact blocker remains.",
      "Do not separate these as robotic headings unless the user asks for a structured list.",
      "When the next action is obvious and supported by the workspace, make that next action easy for the app to continue by clearly implying the action in your reply.",
      "If the user asks you to continue work, assume they want proactive help on the current matter, not just commentary.",
      "If the user says you are not helping, not behaving like AI, too rigid, or asking them to do the work, correct course immediately by becoming more direct, more helpful, and more action-oriented.",
      "When the user asks what to do next, what is missing, how to complete the case, or how to take it to filing/final pack, answer in this order when helpful: current status, mistakes or gaps, missing details needed from the lawyer, exact place in the app to update them, and the next best action.",
      "When missing details are already visible in WORKSPACE SUMMARY, list them directly instead of asking the user to open another screen first.",
      "When the user provides missing case details, use them in the answer and tell the user exactly where those details belong in the app or draft.",
      "If final filing is not ready, explain why in plain language using validation issues, pending items, unsupported draft points, and filing checklist items from WORKSPACE SUMMARY.",
      "If the user asks whether anything is still pending in the draft or case, use WORKSPACE SUMMARY and CURRENT DRAFT to identify the pending gaps before answering.",
      "If the user asks where to paste or save a detail, map it to the exact app path from WORKSPACE SUMMARY such as Profile, Research, Draft -> Edit Draft, Draft -> Validate Draft / Auto Fix Issues, or Final Summary.",
      "Use CURRENT SCREEN, COPILOT OPENED FROM, and AVAILABLE ACTIONS as the primary navigation context for app-usage answers.",
      "If the user asks what to do on this page, explain the actions available on the current screen first.",
      "If the user asks how to go back or what the next step is, prefer the source screen and currently available actions before giving a general app tour.",
      "If validation issues, warnings, critical errors, missing sections, unsupported points, or filing checklist items are present in WORKSPACE SUMMARY and the user asks to see, explain, or check them, list them directly in the reply.",
      "Do not say that you cannot see the validation report, final summary, draft status, or another screen if that information is already present in WORKSPACE SUMMARY.",
      "If the user asks whether the draft was updated, answer using CURRENT DRAFT STATUS and LATEST DRAFT CHANGE NOTE when available.",
      "If the user asks about doubts in using the app, clear the doubt directly. Do not switch into legal case analysis unless the user is asking about the legal matter itself.",
      "If asked for a draft, provide usable draft text directly in the reply.",
      "Do not offer a draft unless the user explicitly asks for a draft, complaint, notice, petition, edit, or pleading text.",
      "If the user asks to explain, review, or legally support an excerpt, answer that excerpt directly and do not rewrite or replace the full workspace draft unless they explicitly ask to update the draft.",
      "If facts are missing, state the missing items plainly instead of inventing them.",
      "Do not say that you cannot update the workspace, cannot sync documents, or that the user must copy and paste from chat history.",
      "If the user asks to update or revise the draft, return the revised draft text directly so the workspace can sync it.",
      "If the user asks to update research, profile, or workspace details, return the exact updated field values or sections to save instead of refusing.",
      "Do not claim that the workspace was already updated unless you are returning the updated content in this same reply.",
      "Do not behave as if your own preferred workflow matters more than the user's request.",
      "If the user's ask is simple, keep the reply simple.",
      "",
      "SESSION FACTS:",
      current.memory.factsSummary || "Not provided",
      "",
      "WORKSPACE SUMMARY:",
      current.memory.workspaceSummary || "Not provided",
      "",
      "CURRENT SCREEN:",
      current.memory.workspaceScreen || current.memory.workspaceTab || "Not provided",
      "",
      "COPILOT OPENED FROM:",
      current.memory.workspaceSourceScreen || "Not provided",
      "",
      "AVAILABLE ACTIONS:",
      formatList(current.memory.workspaceAvailableActions),
      "",
      "CASE TYPE:",
      current.memory.caseType || "Not provided",
      "",
      "ISSUES:",
      formatList(current.memory.issues),
      "",
      "PARTIES:",
      formatParties(current.memory.parties),
      "",
      "RELIEF SOUGHT:",
      current.memory.reliefSought || "Not provided",
      "",
      "CURRENT WORKFLOW STATE:",
      current.session.workflowState || "intake",
      "",
      "CURRENT DRAFT:",
      currentDraft ? currentDraft.slice(0, 5000) : "No draft currently stored",
      "",
      "CURRENT WORKSPACE AUTHORITIES:",
      formatList(current.memory.workspaceAuthorities),
      "",
      "SCOPED SECTIONS:",
      formatSections(contextPacket.sections),
      "",
      "SCOPED JUDGMENTS:",
      formatJudgments(contextPacket.judgments),
      "",
      "AUTHORITY SUMMARY:",
      contextPacket.authoritiesSummary || "No summary available",
      "",
      "RECENT CHAT:",
      externalHistory.length
        ? externalHistory.map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.text}`).join("\n")
        : "No prior chat",
      "",
      "LATEST USER MESSAGE:",
      message
    ].join("\n");

    const executor = createExecutor();
    const reply = await executor(prompt);

    await caseMemoryService.updateCaseMemory(sessionId, {
      lastAction: "chat_reply"
    });

    const proposedActionId = inferProposedActionId({
      message,
      reply,
      contextPacket
    });

    return res.status(200).json({
      ok: true,
      reply: String(reply || "").trim(),
      proposedActionId,
      citations: Array.isArray(contextPacket.judgments)
        ? contextPacket.judgments.map((item) => ({
            citation: item.citation || "",
            title: item.case_name || item.caseName || item.title || ""
          })).filter((item) => item.citation || item.title)
        : [],
      retrievedAuthorities: {
        sections: Array.isArray(contextPacket.sections) ? contextPacket.sections : [],
        judgments: Array.isArray(contextPacket.judgments) ? contextPacket.judgments : [],
        summary: contextPacket.authoritiesSummary || ""
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function draft(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    const documentType = req.body.documentType || current.memory.documentType || "notice";
    const prompt = promptBuilder.buildDraftPrompt({
      memory: current.memory,
      documentType,
      contextPacket: current.memory.contextPacket || { sections: [], judgments: [] }
    });

    const executor = createExecutor();
    const provider = getActiveProvider();
    let outputText = "";
    let attempts = [];
    let generationMeta = {
      mode: "ai",
      provider,
      providerFailed: false,
      fallbackUsed: false,
      failureReason: "",
      diagnosticCode: ""
    };

    try {
      const result = await executeWithResponseFilter({
        executor,
        prompt
      });

      if (result.accepted) {
        outputText = result.output;
        attempts = result.attempts;
      } else {
        outputText = buildFallbackDraft({
          memory: current.memory,
          documentType,
          contextPacket: current.memory.contextPacket || {}
        });
        attempts = result.attempts || [];
        generationMeta = {
          mode: "fallback",
          provider,
          providerFailed: true,
          fallbackUsed: true,
          failureReason: "AI output failed quality checks",
          diagnosticCode: "quality_filter_rejected"
        };
      }
    } catch (error) {
      const failure = classifyGenerationFailure(error);
      outputText = buildFallbackDraft({
        memory: current.memory,
        documentType,
        contextPacket: current.memory.contextPacket || {}
      });
      attempts = [{
        mode: "fallback",
        reason: failure.message || "executor_failed"
      }];
      generationMeta = {
        mode: "fallback",
        provider,
        providerFailed: true,
        fallbackUsed: true,
        failureReason: failure.message,
        diagnosticCode: failure.code
      };
    }

    const document = {
      id: `doc_${Date.now()}`,
      type: documentType,
      content: outputText,
      createdAt: new Date().toISOString()
    };

    await caseMemoryService.appendGeneratedDocument(sessionId, document);
    await caseMemoryService.updateSessionState(sessionId, workflowEngine.WORKFLOW_STATES.DRAFT, {
      activeDocumentType: documentType
    });
    await caseMemoryService.updateCaseMemory(sessionId, {
      workspaceDraft: outputText,
      workspaceTab: "draft",
      lastGenerationMeta: generationMeta
    });

    return res.status(200).json({
      ok: true,
      document,
      attempts,
      generationMeta,
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function validate(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    const documentType = req.body.documentType || current.session.activeDocumentType || current.memory.documentType;
    const documentText = req.body.documentText
      || current.memory.workspaceDraft
      || current.memory.generatedDocuments?.[current.memory.generatedDocuments.length - 1]?.content
      || "";

    const report = validateDocument({
      documentType,
      documentText,
      contextPacket: current.memory.contextPacket,
      memory: current.memory
    });

    await caseMemoryService.updateCaseMemory(sessionId, {
      validationState: {
        status: report.status,
        statusLabel: report.statusLabel,
        score: report.score,
        criticalErrors: report.criticalErrors,
        warnings: report.suggestedFixes,
        reviewWarnings: report.warnings,
        passedChecks: report.passedChecks,
        missingSections: report.missingSections,
        unsupportedClaims: report.unsupportedClaims,
        citationIssues: report.citationIssues,
        proceduralGaps: report.proceduralGaps
      },
      lastAction: "validate_draft"
    });
    await caseMemoryService.updateSessionState(sessionId, workflowEngine.WORKFLOW_STATES.VALIDATE);

    return res.status(200).json({
      ok: true,
      report,
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function filing(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    await caseMemoryService.updateSessionState(sessionId, workflowEngine.WORKFLOW_STATES.FILING);

    return res.status(200).json({
      ok: true,
      checklist: [
        "Verify jurisdiction and limitation",
        "Attach citations and supporting annexures",
        "Check party details and signatures",
        "Confirm document-type specific filing requirements"
      ],
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function autofix(req, res) {
  try {
    const sessionId = req.params.id;
    const current = await caseMemoryService.getSession(sessionId);
    const documentType = req.body.documentType || current.session.activeDocumentType || current.memory.documentType || "complaint";
    const documentText = req.body.documentText
      || current.memory.workspaceDraft
      || current.memory.generatedDocuments?.[current.memory.generatedDocuments.length - 1]?.content
      || "";

    if (!String(documentText || "").trim()) {
      return sendError(res, new Error("No draft available for auto-fix."), 400);
    }

    const result = autoFixDocument({
      documentType,
      documentText,
      contextPacket: current.memory.contextPacket,
      memory: current.memory
    });

    const document = {
      id: `doc_${Date.now()}`,
      type: documentType,
      content: result.documentText,
      createdAt: new Date().toISOString(),
      generatedBy: "validation_autofix",
      fixesApplied: result.fixesApplied
    };

    await caseMemoryService.appendGeneratedDocument(sessionId, document);
    await caseMemoryService.updateCaseMemory(sessionId, {
      workspaceDraft: result.documentText,
      workspaceTab: "draft",
      validationState: {
        status: result.report.status,
        statusLabel: result.report.statusLabel,
        score: result.report.score,
        criticalErrors: result.report.criticalErrors,
        warnings: result.report.suggestedFixes,
        reviewWarnings: result.report.warnings,
        passedChecks: result.report.passedChecks,
        missingSections: result.report.missingSections,
        unsupportedClaims: result.report.unsupportedClaims,
        citationIssues: result.report.citationIssues,
        proceduralGaps: result.report.proceduralGaps
      },
      lastAction: "autofix_draft",
      lastAutoFix: {
        changed: result.changed,
        fixesApplied: result.fixesApplied,
        appliedAt: new Date().toISOString()
      }
    });
    await caseMemoryService.updateSessionState(sessionId, workflowEngine.WORKFLOW_STATES.VALIDATE, {
      activeDocumentType: documentType
    });

    return res.status(200).json({
      ok: true,
      document,
      changed: result.changed,
      fixesApplied: result.fixesApplied,
      initialReport: result.initialReport,
      report: result.report,
      ...(await caseMemoryService.getSession(sessionId))
    });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = {
  startSession,
  getSession,
  intake,
  context,
  actions,
  chat,
  draft,
  validate,
  autofix,
  filing
};
