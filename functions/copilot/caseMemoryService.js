"use strict";

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { createDefaultCaseMemory, createSessionRecord } = require("./schemas");
const { computeMissingCriticalFields, getAllowedActions } = require("./workflowEngine");

function getDb() {
  return admin.firestore();
}

function sessionsCollection() {
  return getDb().collection("copilot_sessions");
}

function memoryCollection() {
  return getDb().collection("case_memory");
}

function now() {
  return FieldValue.serverTimestamp();
}

async function createSession({ ownerId = "anonymous", matterId = null, workflowState } = {}) {
  const sessionRef = sessionsCollection().doc();
  const memoryRef = memoryCollection().doc(sessionRef.id);

  const session = createSessionRecord({ ownerId, matterId, workflowState });
  const memory = createDefaultCaseMemory();

  await getDb().runTransaction(async (tx) => {
    tx.set(sessionRef, {
      ...session,
      createdAt: now(),
      updatedAt: now()
    });
    tx.set(memoryRef, {
      sessionId: sessionRef.id,
      ...memory,
      missingCriticalFields: computeMissingCriticalFields(memory),
      createdAt: now(),
      updatedAt: now()
    });
  });

  return getSession(sessionRef.id);
}

async function getSession(sessionId) {
  const [sessionSnap, memorySnap] = await Promise.all([
    sessionsCollection().doc(sessionId).get(),
    memoryCollection().doc(sessionId).get()
  ]);

  if (!sessionSnap.exists) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session = { id: sessionSnap.id, ...sessionSnap.data() };
  const memory = memorySnap.exists
    ? { sessionId: memorySnap.id, ...memorySnap.data() }
    : { sessionId, ...createDefaultCaseMemory() };

  return {
    session,
    memory,
    allowedActions: getAllowedActions(session.workflowState, memory)
  };
}

async function updateSessionState(sessionId, workflowState, metadata = {}) {
  const sessionRef = sessionsCollection().doc(sessionId);
  await sessionRef.set({
    workflowState,
    ...metadata,
    updatedAt: now()
  }, { merge: true });
}

async function updateCaseMemory(sessionId, patch = {}) {
  const memoryRef = memoryCollection().doc(sessionId);
  const existingSnap = await memoryRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : createDefaultCaseMemory();

  const merged = {
    ...existing,
    ...patch
  };

  merged.missingCriticalFields = computeMissingCriticalFields(merged);
  merged.updatedAt = now();

  await memoryRef.set(merged, { merge: true });
  return getSession(sessionId);
}

async function appendGeneratedDocument(sessionId, document) {
  const current = await getSession(sessionId);
  const generatedDocuments = Array.isArray(current.memory.generatedDocuments)
    ? current.memory.generatedDocuments.slice()
    : [];

  generatedDocuments.push(document);

  return updateCaseMemory(sessionId, {
    generatedDocuments,
    lastAction: "document_generated"
  });
}

module.exports = {
  createSession,
  getSession,
  updateSessionState,
  updateCaseMemory,
  appendGeneratedDocument
};
