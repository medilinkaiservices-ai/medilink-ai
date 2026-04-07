import { StatusBar } from "expo-status-bar";
import { ActionSheetIOS, ActivityIndicator, Alert, Animated, Dimensions, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { listRemoteCases, listRemoteClients, mergeRemoteCasesIntoMatters, retrieveLiveJudgments, saveRemoteCase, saveRemoteClient } from "./src/api/legalWorkspaceApi";
import { autoFixCopilotDraft, buildCopilotContext, fetchFilingGuidance, generateCopilotDraft, sendCopilotChatMessage, startCopilotSession, submitCopilotIntake, validateCopilotDraft } from "./src/api/copilotApi";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./src/config/firebase";
import { launcherApps, seededMatters } from "./src/data/lawAssistantSeed";
import { getDisplayName, seededAccount } from "./src/data/mobileSession";

const APP_STORAGE_KEY = "@medilink-ai/mobile-app-state-v1";
const SAVED_SNIPPETS_KEY = "@medilink-ai/saved-snippets-v1";

async function storageGetItem(key) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      const webValue = localStorage.getItem(key);
      if (typeof webValue === "string") {
        return webValue;
      }
    } catch (_error) {
    }
  }

  try {
    return await AsyncStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

async function storageSetItem(key, value) {
  const normalizedValue = String(value ?? "");

  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(key, normalizedValue);
    } catch (_error) {
    }
  }

  try {
    await AsyncStorage.setItem(key, normalizedValue);
  } catch (_error) {
  }
}

async function saveSnippetToLibrary(textValue) {
  const value = String(textValue || "").trim();
  if (!value) {
    return;
  }

  try {
    const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const next = [value, ...current.filter((item) => item !== value)].slice(0, 50);
    await storageSetItem(SAVED_SNIPPETS_KEY, JSON.stringify(next));
  } catch (_error) {
  }
}

async function saveExportPacketToFile(fileLabel, content) {
  const safeBase = String(fileLabel || "legal-export")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "legal-export";

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = `${safeBase}-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    return link.download;
  }

  const fileUri = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${safeBase}-${Date.now()}.txt`;
  await FileSystem.writeAsStringAsync(fileUri, String(content || ""), {
    encoding: FileSystem.EncodingType.UTF8
  });
  return fileUri;
}

async function shareExportPacket(content) {
  const textValue = String(content || "");

  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ text: textValue });
      return "shared";
    }

    await Clipboard.setStringAsync(textValue);
    return "copied";
  }

  await Share.share({ message: textValue });
  return "shared";
}

function formatLegalDisplayDate(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getResearchEntryText(entry, fallback = "") {
  if (entry === null || entry === undefined) {
    return fallback;
  }

  if (typeof entry === "string" || typeof entry === "number") {
    return String(entry).trim() || fallback;
  }

  if (Array.isArray(entry)) {
    return entry.map((item) => getResearchEntryText(item)).filter(Boolean).join(", ") || fallback;
  }

  if (typeof entry === "object") {
    return String(
      entry.title ||
        entry.value ||
        entry.label ||
        entry.name ||
        entry.citation ||
        entry.summary ||
        entry.proposition ||
        fallback
    ).trim();
  }

  return String(entry).trim() || fallback;
}

function normalizeStatutoryReferences(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => getResearchEntryText(item)).filter(Boolean);
  }

  return [getResearchEntryText(value)].filter(Boolean);
}

function getInsightTrustLabel(score, requiresReview) {
  if (requiresReview) {
    return "Review";
  }

  if (typeof score !== "number") {
    return "Source";
  }

  if (score >= 0.85) {
    return "High";
  }

  if (score >= 0.65) {
    return "Medium";
  }

  return "Low";
}

function getInsightTrustTone(score, requiresReview) {
  if (requiresReview) {
    return "review";
  }

  if (typeof score !== "number") {
    return "neutral";
  }

  if (score >= 0.85) {
    return "high";
  }

  if (score >= 0.65) {
    return "medium";
  }

  return "low";
}

function getInsightTreatmentDisplay(entry = {}) {
  const raw = `${entry?.treatmentAlertLabel || ""} ${entry?.treatmentAlertTone || ""} ${entry?.treatmentSummary || ""}`.trim().toLowerCase();
  if (!raw) {
    return { label: "Verify", tone: "review" };
  }
  if (/overrul/.test(raw)) {
    return { label: "Overruled", tone: "highrisk" };
  }
  if (/limited/.test(raw)) {
    return { label: "Limited", tone: "highrisk" };
  }
  if (/distinguish|caution/.test(raw)) {
    return { label: "Distinguished", tone: "caution" };
  }
  if (/followed|positive|good|relied|supportive/.test(raw)) {
    return { label: "Followed", tone: "positive" };
  }
  return { label: "Verify", tone: "review" };
}

function normalizeResearchEntry(entry, fallbackLabel = "Insight") {
  const title = getResearchEntryText(entry, `${fallbackLabel} pending`);
  const statutoryReferences = normalizeStatutoryReferences(entry?.statutoryReferences);
  const court = getResearchEntryText(entry?.court);
  const judgmentDate = formatLegalDisplayDate(entry?.judgmentDate);
  const citation = getResearchEntryText(entry?.citation);
  const neutralCitation = getResearchEntryText(entry?.neutralCitation);
  const pinpointRef = getResearchEntryText(entry?.pinpointRef);
  const proposition = getResearchEntryText(entry?.proposition);
  const whyItMatters = getResearchEntryText(entry?.whyItMatters || entry?.practicalUse);
  const sourceUrl = getResearchEntryText(entry?.sourceUrl);
  const treatmentSummary = getResearchEntryText(entry?.treatmentSummary);
  const treatmentAlertLabel = getResearchEntryText(entry?.treatmentAlertLabel);
  const treatmentAlertTone = getResearchEntryText(entry?.treatmentAlertTone);
  const treatmentAlertNote = getResearchEntryText(entry?.treatmentAlertNote);
  const freshnessLabel = getResearchEntryText(entry?.freshnessLabel);
  const stalenessReason = getResearchEntryText(entry?.stalenessReason);
  const freshnessDays = typeof entry?.freshnessDays === "number" ? entry.freshnessDays : undefined;
  const confidenceScore =
    typeof entry?.confidenceScore === "number" ? entry.confidenceScore : undefined;
  const requiresReview = Boolean(entry?.requiresReview);
  const reviewPriority = getResearchEntryText(entry?.reviewPriority);
  const trustLabel = getInsightTrustLabel(confidenceScore, requiresReview);
  const trustTone = getInsightTrustTone(confidenceScore, requiresReview);
  const treatmentDisplay = getInsightTreatmentDisplay({
    treatmentAlertLabel,
    treatmentAlertTone,
    treatmentSummary
  });

  const metaBits = [
    court,
    judgmentDate,
    citation || neutralCitation
  ].filter(Boolean);

  return {
    title,
    court,
    judgmentDate,
    citation,
    neutralCitation,
    proposition: proposition && proposition !== title ? proposition : "",
    whyItMatters,
    summaryText: getResearchEntryText(entry?.summary || entry?.ratioNote || entry?.excerpt || entry?.pinpoint?.excerpt),
    statutoryReferences,
    pinpointRef,
    sourceUrl,
    treatmentSummary,
    treatmentAlertLabel: treatmentDisplay.label,
    treatmentAlertTone: treatmentDisplay.tone,
    treatmentAlertNote,
    freshnessLabel,
    freshnessDays,
    stalenessReason,
    confidenceScore,
    requiresReview,
    reviewPriority,
    trustLabel,
    trustTone,
    metaLine: metaBits.join(" • "),
    sourceLine: sourceUrl ? "Official source linked" : reviewPriority ? `${reviewPriority} review` : "Workspace note",
    hasMetadata: Boolean(metaBits.length || proposition || statutoryReferences.length || pinpointRef || sourceUrl || treatmentSummary || treatmentAlertLabel || freshnessLabel || typeof confidenceScore === "number" || requiresReview)
  };
}

function buildResearchTrustSnapshot(items = []) {
  const normalized = items.map((item) => normalizeResearchEntry(item)).filter((item) => item.hasMetadata);

  if (!normalized.length) {
    return {
      authorityConfidence: "Workspace guidance only",
      reviewState: "Manual legal check recommended",
      sourceCoverage: "No official source metadata loaded"
    };
  }

  const high = normalized.filter((item) => item.trustTone === "high").length;
  const medium = normalized.filter((item) => item.trustTone === "medium").length;
  const review = normalized.filter((item) => item.requiresReview || item.trustTone === "review").length;
  const sourced = normalized.filter((item) => item.sourceUrl || item.metaLine).length;
  const legacy = normalized.filter((item) => /legacy|older authority/i.test(item.freshnessLabel || "")).length;
  const recent = normalized.filter((item) => /recent authority|current authority/i.test(item.freshnessLabel || "")).length;
  const treatmentRisk = normalized.filter((item) => /highrisk|caution|review/i.test((item.treatmentAlertTone || "").replace(/\s+/g, ""))).length;

  return {
    authorityConfidence: high
      ? `${high} high-confidence authorities`
      : medium
        ? `${medium} medium-confidence authorities`
        : "Confidence build-up pending",
    reviewState: review ? `${review} item(s) need manual review` : "No flagged research items",
    sourceCoverage: `${sourced} source-grounded research items loaded`,
    freshnessState: legacy
      ? `${legacy} older / legacy authority item(s) should be treatment-checked`
      : recent
        ? `${recent} recent or current authority item(s) loaded`
        : "Freshness review pending",
    treatmentState: treatmentRisk
      ? `${treatmentRisk} authority item(s) carry treatment caution`
      : "No treatment caution flags surfaced"
  };
}

function buildResearchFocus(type, rawValue) {
  const insight = normalizeResearchEntry(rawValue, type);
  return {
    type,
    value: insight.title,
    insight
  };
}

function buildFocusSupportLine(focus) {
  const insight = focus?.insight;
  if (!insight) {
    return "";
  }

  const segments = [];
  if (insight.proposition) {
    segments.push(`Proposition: ${insight.proposition}`);
  }
  if (insight.pinpointRef) {
    segments.push(`Pinpoint: ${insight.pinpointRef}`);
  }
  if (insight.statutoryReferences?.length) {
    segments.push(`Statutes: ${insight.statutoryReferences.slice(0, 2).join(", ")}`);
  }

  return segments.join(" | ");
}

function buildSupportEntries(matter, matterState, overrideEntries = null) {
  const dedupe = new Set();
  const entries = [];

  const pushEntry = (label, rawValue, rawInsight = null) => {
    const insight = rawInsight?.title ? rawInsight : normalizeResearchEntry(rawValue, label);
    const title = getResearchEntryText(rawValue, insight?.title || `${label} pending`);
    const dedupeKey = `${label}|${title}|${insight?.pinpointRef || ""}`;
    if (!title || isPlaceholderValue(title) || dedupe.has(dedupeKey)) {
      return;
    }
    dedupe.add(dedupeKey);
    entries.push({
      label,
      title,
      summaryText: insight?.summaryText || "",
      proposition: insight?.proposition || "",
      whyItMatters: insight?.whyItMatters || "",
      pinpointRef: insight?.pinpointRef || "",
      statutoryReferences: normalizeStatutoryReferences(insight?.statutoryReferences),
      sourceLine: [insight?.metaLine, insight?.sourceLine].filter(Boolean).join(" | "),
      sourceUrl: insight?.sourceUrl || "",
      treatmentAlertNote: insight?.treatmentAlertNote || "",
      stalenessReason: insight?.stalenessReason || "",
      reviewPriority: insight?.reviewPriority || "",
      trustLabel: insight?.trustLabel || "",
      treatmentAlertLabel: insight?.treatmentAlertLabel || "",
      freshnessLabel: insight?.freshnessLabel || ""
    });
  };

  if (Array.isArray(overrideEntries) && overrideEntries.length) {
    overrideEntries.forEach((entry) => pushEntry(entry.label || "Support", entry.title || entry.value || entry, entry));
    return entries.slice(0, 3);
  }

  if (matterState?.lastResearchFocus?.insight) {
    pushEntry(
      matterState.lastResearchFocus.type || "Support",
      matterState.lastResearchFocus.value,
      matterState.lastResearchFocus.insight
    );
  }

  const authorityEntry = getAuthorityEntries(matter, matterState)?.[0];
  if (authorityEntry) {
    pushEntry("Authority", authorityEntry);
  }

  const citationEntry = getCitationEntries(matter, matterState)?.[0];
  if (citationEntry) {
    pushEntry("Citation", citationEntry);
  }

  return entries.slice(0, 3);
}

function buildSupportEntriesFromBackend(retrievedAuthorities = {}) {
  const entries = [];
  const seen = new Set();

  const pushEntry = (label, rawValue) => {
    if (!rawValue) return;
    const insight = normalizeResearchEntry(rawValue, label);
    const title = insight.title || getResearchEntryText(rawValue, `${label} pending`);
    const dedupeKey = `${label}|${title}|${insight.pinpointRef || ""}`;
    if (!title || seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    entries.push({
      label,
      title,
      summaryText: insight.summaryText || "",
      proposition: insight.proposition || "",
      whyItMatters: insight.whyItMatters || "",
      pinpointRef: insight.pinpointRef || "",
      statutoryReferences: normalizeStatutoryReferences(insight.statutoryReferences),
      sourceLine: [insight.metaLine, insight.sourceLine].filter(Boolean).join(" | "),
      sourceUrl: insight.sourceUrl || "",
      treatmentAlertNote: insight.treatmentAlertNote || "",
      stalenessReason: insight.stalenessReason || "",
      reviewPriority: insight.reviewPriority || "",
      trustLabel: insight.trustLabel || "",
      treatmentAlertLabel: insight.treatmentAlertLabel || "",
      freshnessLabel: insight.freshnessLabel || ""
    });
  };

  (Array.isArray(retrievedAuthorities?.judgments) ? retrievedAuthorities.judgments : []).forEach((item) => pushEntry("Authority", item));
  (Array.isArray(retrievedAuthorities?.sections) ? retrievedAuthorities.sections : []).forEach((item) => pushEntry("Citation", item));

  return entries.slice(0, 4);
}

function buildFocusLoadMessage(focus) {
  const supportLine = buildFocusSupportLine(focus);
  return supportLine
    ? `Loaded ${String(focus?.type || "research").toLowerCase()} into Copilot context: ${focus?.value}. ${supportLine}`
    : `Loaded ${String(focus?.type || "research").toLowerCase()} into Copilot context: ${focus?.value}`;
}

function SupportMapBlock({ title = "Based on", entries = [], compact = false, onEntryPress = null }) {
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }

  return (
    <View style={[styles.supportBlock, compact ? styles.supportBlockCompact : null]}>
      <Text style={styles.supportBlockTitle}>{title}</Text>
      <View style={styles.supportBlockList}>
        {entries.map((entry, index) => (
          <TouchableOpacity
            key={`${entry.label}-${entry.title}-${entry.pinpointRef || index}`}
            activeOpacity={onEntryPress ? 0.9 : 1}
            onPress={onEntryPress ? () => onEntryPress(entry) : undefined}
            style={[styles.supportEntryCard, compact ? styles.supportEntryCardCompact : null]}
          >
            <Text style={styles.supportEntryLabel}>{entry.label}</Text>
            <InteractiveText style={styles.supportEntryTitle}>{entry.title}</InteractiveText>
            {entry.sourceLine ? (
              <InteractiveText style={styles.supportEntryMeta}>{entry.sourceLine}</InteractiveText>
            ) : null}
            {entry.proposition ? (
              <InteractiveText style={styles.supportEntryDetail}>Proposition: {entry.proposition}</InteractiveText>
            ) : null}
            {entry.pinpointRef ? (
              <InteractiveText style={styles.supportEntryDetail}>Pinpoint: {entry.pinpointRef}</InteractiveText>
            ) : null}
            {entry.statutoryReferences?.length ? (
              <InteractiveText style={styles.supportEntryDetail}>
                Statutes: {entry.statutoryReferences.slice(0, 3).join(", ")}
              </InteractiveText>
            ) : null}
            {[entry.trustLabel, entry.treatmentAlertLabel, entry.freshnessLabel].filter(Boolean).length ? (
              <InteractiveText style={styles.supportEntryMeta}>
                {[entry.trustLabel, entry.treatmentAlertLabel, entry.freshnessLabel].filter(Boolean).join(" | ")}
              </InteractiveText>
            ) : null}
            {onEntryPress ? <Text style={styles.supportEntryOpenHint}>View source</Text> : null}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function isPlaceholderValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return true;
  }

  return /pending|to be added|awaiting|not set|not scheduled|no pack yet|issues to be mapped|authorities to be selected|citations to be selected|arguments to be developed/.test(text);
}

function getAuthorityEntries(matter, matterState) {
  const liveItems = matterState?.liveResearch?.judgments;
  if (Array.isArray(liveItems) && liveItems.length) {
    return liveItems;
  }
  return matter?.research?.authorities ?? [];
}

function getCitationEntries(matter, matterState) {
  const liveItems = matterState?.liveResearch?.judgments?.filter((item) => item?.citation || item?.neutralCitation);
  if (Array.isArray(liveItems) && liveItems.length) {
    return liveItems;
  }
  return matter?.research?.citations ?? [];
}

function getResearchLeadValues(matter, matterState) {
  return {
    issue: getResearchEntryText(matter?.research?.issues?.[0], "Core issue review"),
    authority: getResearchEntryText(getAuthorityEntries(matter, matterState)?.[0], "Available authority"),
    citation: getResearchEntryText(getCitationEntries(matter, matterState)?.[0], "Available citation"),
    argument: getResearchEntryText(matter?.research?.arguments?.[0], "Lead argument")
  };
}

function buildMatterTypeChecklist(matter) {
  const typeText = String(matter?.caseDetails?.type || "").toLowerCase();
  const factsText = String(matter?.caseDetails?.facts || "").toLowerCase();
  const docsText = String(matter?.caseDetails?.documents || "").toLowerCase();
  const combinedText = `${factsText} ${docsText}`;

  if (/cheque|bounce|138|negotiable/.test(typeText)) {
    return [
      {
        label: "Notice timeline",
        ready: /notice|postal|service/.test(combinedText),
        text: /notice|postal|service/.test(combinedText)
          ? "Statutory notice and service trail identified"
          : "Confirm statutory notice issue date, service proof, and limitation timeline"
      },
      {
        label: "Dishonour proof",
        ready: /memo|dishonou|return/.test(combinedText),
        text: /memo|dishonou|return/.test(combinedText)
          ? "Dishonour memo / return reason appears in the matter record"
          : "Add bank return memo details and the specific dishonour reason"
      },
      {
        label: "Drawer liability",
        ready: /signatory|drawer|company/.test(combinedText),
        text: /signatory|drawer|company/.test(combinedText)
          ? "Drawer / signatory responsibility is already referenced"
          : "Check drawer identity and add Section 141 averments if the cheque is from a company"
      },
      {
        label: "Jurisdiction",
        ready: false,
        text: "Verify Section 138 jurisdiction and filing forum before final complaint export"
      }
    ];
  }

  if (/injunction|property|possession/.test(typeText)) {
    return [
      {
        label: "Possession proof",
        ready: /possession|tax|photo|deed|receipt/.test(combinedText),
        text: /possession|tax|photo|deed|receipt/.test(combinedText)
          ? "Possession materials are referenced in the matter record"
          : "Add possession proof, revenue/tax records, or photographs to support interim relief"
      },
      {
        label: "Interim test",
        ready: /prima facie|balance|irreparable/.test(combinedText),
        text: /prima facie|balance|irreparable/.test(combinedText)
          ? "Interim injunction factors are already touched in the record"
          : "Frame prima facie case, balance of convenience, and irreparable injury clearly"
      },
      {
        label: "Property identity",
        ready: /survey|boundary|schedule|ancestral/.test(combinedText),
        text: /survey|boundary|schedule|ancestral/.test(combinedText)
          ? "Property identity / schedule details are partly visible"
          : "Confirm schedule, boundaries, survey details, and exact possession description"
      },
      {
        label: "Relief framing",
        ready: false,
        text: "Ensure Order XXXIX and Specific Relief prayer language is aligned with the fact pattern"
      }
    ];
  }

  if (/consumer|refund|service/.test(typeText)) {
    return [
      {
        label: "Payment proof",
        ready: /payment|invoice|advance|receipt/.test(combinedText),
        text: /payment|invoice|advance|receipt/.test(combinedText)
          ? "Payment proof and invoice trail are identified"
          : "Add invoice, receipt, or payment proof for the refund claim"
      },
      {
        label: "Deficiency chronology",
        ready: /follow|delay|ignored|supply/.test(combinedText),
        text: /follow|delay|ignored|supply/.test(combinedText)
          ? "Delay / non-supply chronology is visible in the matter record"
          : "Capture non-supply chronology and repeated follow-up attempts"
      },
      {
        label: "Refund relief",
        ready: /interest|compensation|refund/.test(combinedText),
        text: /interest|compensation|refund/.test(combinedText)
          ? "Refund / interest / compensation framing already appears"
          : "Clarify refund, interest, and compensation reliefs before final notice export"
      },
      {
        label: "Forum check",
        ready: false,
        text: "Verify consumer forum jurisdiction, limitation, and notice posture before filing"
      }
    ];
  }

  return [
    {
      label: "Core pleading review",
      ready: !isPlaceholderValue(matter?.caseDetails?.facts),
      text: !isPlaceholderValue(matter?.caseDetails?.facts)
        ? "Matter facts are available for legal drafting"
        : "Complete the fact matrix before preparing the final draft"
    },
    {
      label: "Document pack",
      ready: !isPlaceholderValue(matter?.caseDetails?.documents),
      text: !isPlaceholderValue(matter?.caseDetails?.documents)
        ? "Supporting documents are listed for review"
        : "Add the supporting document set before export or filing"
    }
  ];
}

function buildUnsupportedDraftExcerpts(draftText = "", supportEntries = [], matterType = "") {
  const text = String(draftText || "").trim();
  if (!text || isPlaceholderValue(text)) {
    return [];
  }

  const stopWords = new Set(["with", "from", "that", "this", "have", "shall", "must", "before", "after", "under", "thereof", "whereof", "petitioner", "respondent", "matter", "draft", "section", "order", "court", "relief"]);
  const supportKeywords = [...new Set(
    (Array.isArray(supportEntries) ? supportEntries : [])
      .flatMap((entry) => [
        entry?.title,
        entry?.proposition,
        entry?.pinpointRef,
        ...(Array.isArray(entry?.statutoryReferences) ? entry.statutoryReferences : [])
      ])
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 4 && !stopWords.has(token))
  )];

  const rawParagraphs = text
    .split(/\n\s*\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 50);
  const paragraphPool = rawParagraphs.length >= 2
    ? rawParagraphs
    : text
        .split(/(?<=[.?!])\s+/)
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter((item) => item.length > 60);
  const loweredMatterType = String(matterType || "").toLowerCase();
  const legalClaimPattern = /injunction|possession|prima facie|balance of convenience|irreparable|section|order|rule|notice|dishonou?r|refund|compensation|liable|entitled|jurisdiction|relief|prayer|annexure|statutory|consumer|property|petition|complaint|cause of action/i;

  return paragraphPool
    .map((paragraph) => {
      const lower = paragraph.toLowerCase();
      const matchCount = supportKeywords.reduce((count, token) => (lower.includes(token) ? count + 1 : count), 0);
      const hasLegalSignal = legalClaimPattern.test(paragraph) || (loweredMatterType && lower.includes(loweredMatterType.split(/\s+/)[0] || ""));
      if (!hasLegalSignal) {
        return null;
      }
      if (supportKeywords.length && matchCount > 0) {
        return null;
      }
      return `${paragraph.slice(0, 170)}${paragraph.length > 170 ? "..." : ""}`;
    })
    .filter(Boolean)
    .slice(0, 3);
}

function buildMatterReadinessSnapshot(matter, matterState) {
  const authorityEntries = getAuthorityEntries(matter, matterState);
  const citationEntries = getCitationEntries(matter, matterState);
  const supportEntries = buildSupportEntries(matter, matterState, matterState?.draftHistory?.[0]?.patchMeta?.supportEntries);
  const currentDraft = String((matterState?.currentDraft ?? buildInitialMatterState(matter).currentDraft) || "");
  const trustSnapshot = buildResearchTrustSnapshot([...authorityEntries, ...citationEntries]);
  const flaggedAuthorities = [...authorityEntries, ...citationEntries].filter((item) => normalizeResearchEntry(item).requiresReview).length;
  const treatmentWarnings = [...authorityEntries, ...citationEntries].filter((item) => {
    const normalized = normalizeResearchEntry(item);
    return /highrisk|caution|review/i.test((normalized.treatmentAlertTone || "").replace(/\s+/g, ""));
  }).length;
  const staleAuthorities = [...authorityEntries, ...citationEntries].filter((item) => {
    const normalized = normalizeResearchEntry(item);
    return /legacy|older authority/i.test(normalized.freshnessLabel || "");
  }).length;
  const draftStatus = matterState?.draftStatus ?? matter.finalSummary?.draftStatus ?? "Draft pending";
  const validationStatus = matterState?.validation ?? matter.finalSummary?.validation ?? "Validation pending";
  const filingStatus = matterState?.filingPack ?? matter.finalSummary?.filingPack ?? "Filing review pending";
  const patchCount = matterState?.draftHistory?.length ?? 0;
  const hasDraft = !isPlaceholderValue(draftStatus);
  const docsReady = !isPlaceholderValue(matter?.caseDetails?.documents);
  const factsReady = !isPlaceholderValue(matter?.caseDetails?.facts);
  const noteReady = !isPlaceholderValue(matter?.profile?.note);
  const issuesReady = Array.isArray(matter?.research?.issues) && matter.research.issues.length > 0;
  const argumentsReady = Array.isArray(matter?.research?.arguments) && matter.research.arguments.length > 0;
  const hasSourceSupport = authorityEntries.length > 0 || citationEntries.length > 0;
  const hasAuthoritySupport = authorityEntries.length > 0;
  const hasCitationSupport = citationEntries.length > 0;
  const hasExplicitSupportMap = supportEntries.length > 0;
  const liveReady = matterState?.liveResearch?.status === "ready";
  const validationReady = !isPlaceholderValue(validationStatus);
  const filingReady = !isPlaceholderValue(filingStatus);
  const matterSpecificChecks = buildMatterTypeChecklist(matter);
  const matterSpecificPending = matterSpecificChecks.filter((item) => !item.ready).length;
  const unsupportedDraftExcerpts = buildUnsupportedDraftExcerpts(currentDraft, supportEntries, matter?.caseDetails?.type);
  const unsupportedPoints = [
    !hasExplicitSupportMap ? "Current draft has no explicit authority-to-draft support map." : null,
    !hasAuthoritySupport ? "No authority is linked directly to this matter yet." : null,
    !hasCitationSupport ? "No citation is linked directly to this matter yet." : null,
    !patchCount ? "No applied Copilot patch is recorded for the current draft." : null,
    unsupportedDraftExcerpts.length ? `${unsupportedDraftExcerpts.length} draft excerpt(s) still look unsupported or need legal grounding.` : null,
    matterSpecificPending ? `${matterSpecificPending} matter-specific legal review point(s) still need support or drafting work.` : null,
    flaggedAuthorities ? `${flaggedAuthorities} authority item(s) are still flagged for manual review.` : null,
    staleAuthorities ? `${staleAuthorities} authority item(s) still need freshness or later-treatment verification.` : null
  ].filter(Boolean);
  const unsupportedCount = unsupportedPoints.length;

  let readinessScore = 0;
  readinessScore += hasDraft ? 20 : 0;
  readinessScore += hasAuthoritySupport ? 20 : 0;
  readinessScore += hasCitationSupport ? 15 : 0;
  readinessScore += docsReady ? 15 : 0;
  readinessScore += factsReady ? 10 : 0;
  readinessScore += issuesReady ? 5 : 0;
  readinessScore += argumentsReady ? 5 : 0;
  readinessScore += noteReady ? 5 : 0;
  readinessScore += patchCount > 0 ? 5 : 0;
  readinessScore += liveReady ? 5 : 0;
  readinessScore += Math.max(0, 8 - matterSpecificPending * 2);
  readinessScore -= flaggedAuthorities * 10;
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  let reviewPriority = "Standard review";
  if (flaggedAuthorities || treatmentWarnings || staleAuthorities || !docsReady || matterSpecificPending >= 2 || unsupportedCount >= 2) {
    reviewPriority = "Priority review";
  } else if (readinessScore >= 80 && validationReady) {
    reviewPriority = "Final review";
  } else if (readinessScore < 50) {
    reviewPriority = "Build draft support";
  }

  let readinessLabel = "Support incomplete";
  let readinessNote = "Select stronger authorities and add a grounded draft patch before filing.";

  if (hasDraft && hasSourceSupport && !flaggedAuthorities && docsReady && !unsupportedCount) {
    readinessLabel = "Research-backed draft ready for review";
    readinessNote = liveReady
      ? "Live authority feed, patch history, and documents are available for final legal review."
      : "Draft and source support are available; verify live authorities before filing.";
  } else if (unsupportedCount) {
    readinessLabel = "Draft support review needed";
    readinessNote = unsupportedPoints[0];
  } else if (flaggedAuthorities) {
    readinessLabel = "Manual authority review needed";
    readinessNote = `${flaggedAuthorities} research item(s) still need manual treatment or freshness verification.`;
  } else if (!docsReady) {
    readinessLabel = "Document review pending";
    readinessNote = "Supporting documents and annexures should be checked before export or filing pack generation.";
  } else if (!hasDraft) {
    readinessLabel = "Draft build-up pending";
    readinessNote = "Use Research and Copilot together to produce a stronger working draft.";
  }

  return {
    draftStatus,
    validationStatus,
    filingStatus,
    readinessLabel,
    readinessNote,
    readinessScore,
    reviewPriority,
    patchCount,
    authorityCount: authorityEntries.length,
    citationCount: citationEntries.length,
    supportEntries,
    unsupportedCount,
    unsupportedPoints,
    unsupportedDraftExcerpts,
    flaggedAuthorities,
    treatmentWarnings,
    staleAuthorities,
    matterSpecificPending,
    matterSpecificChecks,
    trustSnapshot,
    liveReady,
    checklist: [
      factsReady ? "Core facts available" : "Core facts still need to be completed",
      issuesReady ? "Issues mapped for research" : "Issues still need to be mapped",
      hasSourceSupport ? "Authority support loaded" : "Authority support to be added",
      hasCitationSupport ? "Citation support loaded" : "Citation support to be added",
      argumentsReady ? "Arguments are available for refinement" : "Arguments still need to be developed",
      flaggedAuthorities ? `${flaggedAuthorities} authority item(s) need manual review` : "No flagged authority warnings",
      treatmentWarnings ? `${treatmentWarnings} authority item(s) need treatment caution review` : "No treatment caution warnings",
      staleAuthorities ? `${staleAuthorities} authority item(s) need freshness / treatment review` : "No stale authority warnings",
      docsReady ? "Documents available for filing review" : "Documents still need confirmation",
      noteReady ? "Client note captured" : "Client note should be confirmed before filing",
      patchCount ? `${patchCount} draft patch(es) available in history` : "No draft patch history recorded",
      validationReady ? "Validation status available" : "Validation review still pending",
      filingReady ? "Filing pack status available" : "Filing pack status still pending"
    ]
  };
}

function formatWorkspaceSummaryList(values = [], fallback = "Not available") {
  const items = Array.isArray(values)
    ? values.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function buildMatterPendingItems(matter, matterState) {
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const items = [];

  if (isPlaceholderValue(matter?.caseDetails?.facts)) {
    items.push("Core case facts still need to be completed");
  }
  if (isPlaceholderValue(matter?.caseDetails?.court)) {
    items.push("Court or forum details still need confirmation");
  }
  if (isPlaceholderValue(matter?.caseDetails?.documents)) {
    items.push("Supporting documents and annexures still need to be listed");
  }
  if (!readiness.authorityCount) {
    items.push("Authority support still needs to be selected");
  }
  if (!readiness.citationCount) {
    items.push("Citation support still needs to be selected");
  }
  if (isPlaceholderValue(readiness.validationStatus)) {
    items.push("Draft validation has not been completed yet");
  }
  if (isPlaceholderValue(readiness.filingStatus)) {
    items.push("Filing pack has not been prepared yet");
  }

  return items;
}

function buildMatterUpdatePathGuide() {
  return [
    "Case facts, client note, court, and basic matter details -> Profile",
    "Issues, authorities, citations, arguments, and supporting documents -> Research",
    "Draft wording, manual edits, and compare history -> Draft -> Edit Draft",
    "Draft defects, missing sections, and auto-fix flow -> Draft -> Validate Draft / Auto Fix Issues",
    "Validation report, filing checklist, and final export outputs -> Final Summary"
  ];
}

function buildMatterCopilotWorkspaceSummary(matter, matterState) {
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const validationReport = matterState?.validationReport || null;
  const filingChecklist = Array.isArray(matterState?.filingChecklist) ? matterState.filingChecklist : [];
  const latestHistory = matterState?.draftHistory?.[0] || null;
  const pendingItems = buildMatterPendingItems(matter, matterState);
  const issueList = Array.isArray(matter?.research?.issues) ? matter.research.issues.map((item) => getResearchEntryText(item)).filter(Boolean) : [];
  const documentList = isPlaceholderValue(matter?.caseDetails?.documents) ? [] : String(matter.caseDetails.documents).split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  const updatePathGuide = buildMatterUpdatePathGuide();

  return [
    `MATTER TITLE: ${matter.title}`,
    `MATTER STATUS: ${matter.status || "Open matter"}`,
    `CLIENT: ${matter.client || "Not provided"}`,
    `CASE TYPE: ${matter.caseDetails?.type || "Not provided"}`,
    `COURT: ${matter.caseDetails?.court || "Not provided"}`,
    `NEXT DATE / HEARING: ${matter.caseDetails?.nextDate || "Not provided"}`,
    `CURRENT DRAFT STATUS: ${readiness.draftStatus}`,
    `CURRENT VALIDATION STATUS: ${readiness.validationStatus}`,
    `CURRENT FILING STATUS: ${readiness.filingStatus}`,
    `READINESS LABEL: ${readiness.readinessLabel}`,
    `READINESS SCORE: ${readiness.readinessScore}/100`,
    `READINESS NOTE: ${readiness.readinessNote}`,
    `RESEARCH ISSUES:\n${formatWorkspaceSummaryList(issueList, "- No issues mapped")}`,
    `SUPPORTING DOCUMENTS:\n${formatWorkspaceSummaryList(documentList, "- No supporting documents listed")}`,
    `RESEARCH SUPPORT COUNTS: Authorities ${readiness.authorityCount}, Citations ${readiness.citationCount}, Arguments ${readiness.argumentCount}`,
    `UNSUPPORTED DRAFT POINTS:\n${formatWorkspaceSummaryList(readiness.unsupportedPoints, "- No unsupported draft points flagged")}`,
    validationReport
      ? `VALIDATION REPORT STATUS: ${validationReport.statusLabel || validationReport.status || "Completed"}`
      : "VALIDATION REPORT STATUS: Not generated",
    validationReport && validationReport.score != null
      ? `VALIDATION REPORT SCORE: ${validationReport.score}%`
      : "",
    `VALIDATION CRITICAL ERRORS:\n${formatWorkspaceSummaryList(validationReport?.criticalErrors, "- No critical errors flagged")}`,
    `VALIDATION WARNINGS:\n${formatWorkspaceSummaryList(validationReport?.warnings, "- No warnings flagged")}`,
    `VALIDATION MISSING SECTIONS:\n${formatWorkspaceSummaryList(validationReport?.missingSections, "- No missing sections flagged")}`,
    `VALIDATION CITATION ISSUES:\n${formatWorkspaceSummaryList(validationReport?.citationIssues, "- No citation issues flagged")}`,
    `VALIDATION PASSED CHECKS:\n${formatWorkspaceSummaryList(validationReport?.passedChecks, "- No passed checks recorded")}`,
    `VALIDATION SUGGESTIONS:\n${formatWorkspaceSummaryList(validationReport?.suggestions || validationReport?.suggestedFixes, "- No suggestions")}`,
    `FILING CHECKLIST:\n${formatWorkspaceSummaryList(filingChecklist, "- No filing checklist generated")}`,
    `PENDING FILING / CASE ITEMS:\n${formatWorkspaceSummaryList(pendingItems, "- No obvious pending setup items")}`,
    `WHERE TO UPDATE IN APP:\n${formatWorkspaceSummaryList(updatePathGuide, "- Update path guide not available")}`,
    latestHistory?.patch ? `LATEST DRAFT CHANGE NOTE: ${latestHistory.patch}` : "",
    matter.profile?.note ? `PROFILE NOTE: ${matter.profile.note}` : "",
    matter.caseDetails?.facts ? `CASE FACTS: ${matter.caseDetails.facts}` : ""
  ].filter(Boolean).join("\n");
}

function InteractiveText({ children, style, selectAllText = "", selectAllLabel = "Select All", selectable = true }) {
  const textValue = String(children ?? "");
  const fullSelectValue = String(selectAllText || "").trim();

  const openActions = () => {
    if (!textValue.trim()) {
      return;
    }

    const handleCopy = async () => {
      await Clipboard.setStringAsync(textValue);
    };

    const handleShare = async () => {
      await Share.share({ message: textValue });
    };

    const handleSelectAll = async () => {
      await Clipboard.setStringAsync(fullSelectValue || textValue);
      Alert.alert("Copied", fullSelectValue ? "Full conversation copied." : "Selected text copied.");
    };

    const handleSave = async () => {
      await saveSnippetToLibrary(textValue);
      Alert.alert("Saved", "Text saved to notes.");
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy", selectAllLabel, "Share", "Save to Notes"],
          cancelButtonIndex: 0
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            handleCopy();
          } else if (buttonIndex === 2) {
            handleSelectAll();
          } else if (buttonIndex === 3) {
            handleShare();
          } else if (buttonIndex === 4) {
            handleSave();
          }
        }
      );
      return;
    }

    Alert.alert("Text Actions", "Choose an action", [
      { text: "Copy", onPress: handleCopy },
      { text: selectAllLabel, onPress: handleSelectAll },
      { text: "Share", onPress: handleShare },
      { text: "Save to Notes", onPress: handleSave },
      { text: "Cancel", style: "cancel" }
    ]);
  };

  const handleWebContextMenu = (event) => {
    const selectedText = typeof window !== "undefined" && window.getSelection
      ? String(window.getSelection()?.toString?.() || "").trim()
      : "";
    if (selectedText) {
      return;
    }
    event?.preventDefault?.();
    openActions();
  };

  if (Platform.OS === "web") {
    const flattenedStyle = StyleSheet.flatten(style) || {};
    const webTextStyle = {
      display: "block",
      marginTop: flattenedStyle.marginTop ?? 0,
      marginRight: flattenedStyle.marginRight ?? 0,
      marginBottom: flattenedStyle.marginBottom ?? 0,
      marginLeft: flattenedStyle.marginLeft ?? 0,
      paddingTop: flattenedStyle.paddingTop ?? 0,
      paddingRight: flattenedStyle.paddingRight ?? 0,
      paddingBottom: flattenedStyle.paddingBottom ?? 0,
      paddingLeft: flattenedStyle.paddingLeft ?? 0,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflowWrap: "anywhere",
      userSelect: selectable ? "text" : "none",
      WebkitUserSelect: selectable ? "text" : "none",
      cursor: selectable ? "text" : "default",
      color: flattenedStyle.color || "#213351",
      fontSize: flattenedStyle.fontSize || 16,
      lineHeight: flattenedStyle.lineHeight ? `${flattenedStyle.lineHeight}px` : undefined,
      fontWeight: flattenedStyle.fontWeight || "400",
      letterSpacing: flattenedStyle.letterSpacing ?? undefined,
      textTransform: flattenedStyle.textTransform || "none",
      fontStyle: flattenedStyle.fontStyle || "normal",
      textAlign: flattenedStyle.textAlign || "left"
    };

    return React.createElement("div", {
      style: webTextStyle,
      onContextMenu: handleWebContextMenu
    }, textValue);
  }

  return (
    <Text
      selectable={selectable}
      suppressHighlighting
      onLongPress={openActions}
      style={style}
    >
      {children}
    </Text>
  );
}

function buildConversationTranscript(messages = [], heading = "Copilot Conversation") {
  const rows = Array.isArray(messages)
    ? messages
        .map((message) => {
          const roleLabel = message?.role === "user" ? "You" : "Copilot";
          const body = String(message?.text || "").trim();
          const supportBlock = formatSupportEntriesForTranscript(message?.supportEntries, message?.supportTitle || "Based on");
          return body ? `${roleLabel}:\n${body}${supportBlock ? `\n\n${supportBlock}` : ""}` : "";
        })
        .filter(Boolean)
    : [];

  return [heading, ...rows].join("\n\n").trim();
}

function buildCompactConversationTranscript(messages = []) {
  return Array.isArray(messages)
    ? messages
        .map((message, index) => {
          const roleLabel = message?.role === "user" ? "U" : "AI";
          const body = String(message?.text || "").replace(/\s+/g, " ").trim();
          const supportLine = formatSupportEntriesForTranscript(message?.supportEntries, message?.supportTitle || "Based on", true);
          return body ? `${index + 1}. ${roleLabel}: ${body}${supportLine}` : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
}

function formatSupportEntriesForTranscript(entries = [], title = "Based on", compact = false) {
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }

  if (compact) {
    return ` [${title}: ${entries.map((entry) => {
      const parts = [
        entry?.label || "",
        entry?.title || "",
        entry?.pinpointRef ? `Pinpoint ${entry.pinpointRef}` : ""
      ].filter(Boolean);
      return parts.join(" | ");
    }).join(" ; ")}]`;
  }

  return [
    title,
    ...entries.map((entry, index) => {
      const parts = [
        entry?.label ? `${entry.label}:` : `Source ${index + 1}:`,
        entry?.title || "",
        entry?.proposition ? `Proposition: ${entry.proposition}` : "",
        entry?.pinpointRef ? `Pinpoint: ${entry.pinpointRef}` : "",
        Array.isArray(entry?.statutoryReferences) && entry.statutoryReferences.length
          ? `Statutes: ${entry.statutoryReferences.join(", ")}`
          : ""
      ].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
  ].join("\n");
}

function buildSingleMessageTranscript(message = {}) {
  const body = String(message?.text || "").trim();
  const supportBlock = formatSupportEntriesForTranscript(
    message?.supportEntries,
    message?.supportTitle || "Based on"
  );

  if (!body) {
    return supportBlock;
  }

  return supportBlock ? `${body}\n\n${supportBlock}` : body;
}

function normalizeCaseNoteText(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCaseNoteDigest(message = {}, matter = null) {
  const body = normalizeCaseNoteText(message?.text || "");
  if (!body) {
    return "";
  }

  const noteBody = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!noteBody) {
    return "";
  }

  const titlePrefix = matter?.title ? `${matter.title}\n` : "";
  return `${titlePrefix}${noteBody}`.slice(0, 5000).trim();
}

function shouldPromoteSavedMessageToProfileNote(message = {}, noteText = "") {
  const text = String(noteText || "").toLowerCase();
  if (!text.trim()) {
    return false;
  }

  if (message?.role === "user") {
    return true;
  }

  return /father name|full address|property boundaries|verification details|suit valuation|documents|facts|boundary|valuation|survey no|schedule property/.test(text);
}

function buildProfileNoteEntryFromMessage(message = {}, noteText = "") {
  const clean = normalizeCaseNoteText(noteText);
  if (!clean) {
    return "";
  }

  const compact = clean.replace(/\n+/g, " ").trim();
  return compact.length > 800 ? `${compact.slice(0, 797)}...` : compact;
}

function buildResearchIssueEntryFromMessage(message = {}, noteText = "") {
  const raw = String(noteText || message?.text || "").replace(/\r/g, "").trim();
  const quotedMatch = raw.match(/["“](.{20,280}?)["”]/s);
  const candidateFromQuote = quotedMatch ? normalizeCaseNoteText(quotedMatch[1]) : "";
  const candidateLine = raw
    .split(/\n+/)
    .map((line) => normalizeCaseNoteText(line))
    .find((line) => line.length >= 20 && /(injunction|issue|judgment|judgments|provision|provisions|co-sharer|co sharer|partition|property|authority|citation)/i.test(line));
  const clean = normalizeCaseNoteText(candidateFromQuote || candidateLine || raw);
  if (!clean) {
    return "";
  }

  const singleLine = clean.replace(/\n+/g, " ").trim();
  return singleLine.length > 280 ? `${singleLine.slice(0, 277)}...` : singleLine;
}

function buildDraftInsertionFromMessage(message = {}) {
  const clean = normalizeCaseNoteText(message?.text || "");
  if (!clean) {
    return "";
  }

  return `Copilot update:\n${clean}`.trim();
}

function buildResearchInsightKey(entry = {}, fallbackLabel = "Insight") {
  const normalized = normalizeResearchEntry(entry, fallbackLabel);
  return [
    String(normalized.title || "").trim().toLowerCase(),
    String(normalized.citation || "").trim().toLowerCase(),
    String(normalized.pinpointRef || "").trim().toLowerCase(),
    String(normalized.sourceUrl || "").trim().toLowerCase()
  ].join("|");
}

function prependUniqueResearchEntries(existing = [], additions = [], fallbackLabel = "Insight") {
  const current = Array.isArray(existing) ? existing.slice() : [];
  const incoming = Array.isArray(additions) ? additions.filter(Boolean) : [];
  const seen = new Set(current.map((item) => buildResearchInsightKey(item, fallbackLabel)));
  const nextItems = [];

  incoming.forEach((item) => {
    const key = buildResearchInsightKey(item, fallbackLabel);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    nextItems.push(item);
  });

  return nextItems.length ? [...nextItems, ...current] : current;
}

function appendUniqueListItems(existing = [], nextValues = []) {
  const current = Array.isArray(existing) ? existing.slice() : [];
  return (Array.isArray(nextValues) ? nextValues : [nextValues]).reduce(
    (items, value) => appendUniqueListItem(items, value),
    current
  );
}

function buildResearchArgumentsFromSupport(message = {}, supportEntries = []) {
  const values = [];

  (Array.isArray(supportEntries) ? supportEntries : []).forEach((entry) => {
    const proposition = normalizeCaseNoteText(entry?.proposition || "");
    const whyItMatters = normalizeCaseNoteText(entry?.whyItMatters || entry?.summaryText || "");
    if (proposition) {
      values.push(proposition);
    } else if (whyItMatters) {
      values.push(whyItMatters);
    }
  });

  const cleanText = normalizeCaseNoteText(message?.text || "");
  const bulletLine = cleanText
    .split(/\n+/)
    .map((line) => normalizeCaseNoteText(line))
    .find((line) => line.length >= 24 && /(injunction|possession|co-sharer|co sharer|property|authority|citation|judgment|relief)/i.test(line));
  if (bulletLine) {
    values.push(bulletLine);
  }

  return Array.from(new Set(values.filter(Boolean))).slice(0, 3);
}

function buildResearchSupportUpdateFromMessage(message = {}) {
  const supportEntries = Array.isArray(message?.supportEntries) ? message.supportEntries : [];
  const authorities = supportEntries.filter((entry) => /authority/i.test(String(entry?.label || "")));
  const citations = supportEntries.filter((entry) => /citation|section|statute/i.test(String(entry?.label || "")));
  const argumentsList = buildResearchArgumentsFromSupport(message, supportEntries);

  return {
    authorities,
    citations,
    argumentsList
  };
}

function inferAssistantProposedAction({ promptText = "", assistantReply = "", supportEntries = [] } = {}) {
  const prompt = String(promptText || "").trim().toLowerCase();
  const reply = String(assistantReply || "").trim();
  const hasSupport = Array.isArray(supportEntries) && supportEntries.length > 0;
  const request = resolveCopilotRequest(promptText);
  const draftUpdate = request.allowDraftPatch ? extractDraftLikeTextFromReply(reply) : "";
  const assistantTextAction = inferWorkspaceActionFromAssistantText(reply, { supportEntries });

  if (assistantTextAction) {
    return assistantTextAction;
  }

  if (
    hasSupport
    && /(research|authority|authorities|citation|citations|judgment|judgments|case law|support|jodinchu|add cheyyu|update cheyyu)/i.test(prompt)
  ) {
    return "save_support_to_research";
  }

  if (request.allowDraftPatch && draftUpdate) {
    return "apply_to_draft";
  }

  return "";
}

function appendUniqueCaseNote(existing = "", nextValue = "") {
  const current = normalizeCaseNoteText(existing);
  const addition = normalizeCaseNoteText(nextValue);
  if (!addition) {
    return current;
  }
  if (!current) {
    return addition;
  }
  if (current.includes(addition)) {
    return current;
  }
  return `${current}\n\n${addition}`.trim();
}

function appendUniqueListItem(existing = [], nextValue = "") {
  const current = Array.isArray(existing) ? existing.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const addition = String(nextValue || "").trim();
  if (!addition) {
    return current;
  }
  if (current.some((item) => item.toLowerCase() === addition.toLowerCase())) {
    return current;
  }
  return [addition, ...current];
}

function applyResearchSupportUpdateToMatter(matter, messageSource = {}) {
  const update = buildResearchSupportUpdateFromMessage(messageSource);
  const nextAuthorities = prependUniqueResearchEntries(
    matter?.research?.authorities || [],
    update.authorities,
    "Authority"
  );
  const nextCitations = prependUniqueResearchEntries(
    matter?.research?.citations || [],
    update.citations,
    "Citation"
  );
  const nextArguments = appendUniqueListItems(
    matter?.research?.arguments || [],
    update.argumentsList
  );

  const changed =
    nextAuthorities.length !== (Array.isArray(matter?.research?.authorities) ? matter.research.authorities.length : 0)
    || nextCitations.length !== (Array.isArray(matter?.research?.citations) ? matter.research.citations.length : 0)
    || nextArguments.length !== (Array.isArray(matter?.research?.arguments) ? matter.research.arguments.length : 0);

  return {
    changed,
    addedAuthorities: Math.max(0, nextAuthorities.length - (Array.isArray(matter?.research?.authorities) ? matter.research.authorities.length : 0)),
    addedCitations: Math.max(0, nextCitations.length - (Array.isArray(matter?.research?.citations) ? matter.research.citations.length : 0)),
    addedArguments: Math.max(0, nextArguments.length - (Array.isArray(matter?.research?.arguments) ? matter.research.arguments.length : 0)),
    nextMatter: {
      ...matter,
      research: {
        ...(matter?.research || {}),
        authorities: nextAuthorities,
        citations: nextCitations,
        arguments: nextArguments
      }
    }
  };
}

function normalizeCopilotSuggestion(item) {
  if (!item) {
    return null;
  }

  if (typeof item === "string") {
    const value = item.trim();
    return value ? { kind: "prompt", label: value, value } : null;
  }

  if (typeof item === "object") {
    const label = String(item.label || item.value || item.action || "").trim();
    if (!label) {
      return null;
    }

    const kind = item.kind === "action" ? "action" : "prompt";
    return {
      kind,
      label,
      value: String(item.value || label).trim(),
      action: String(item.action || "").trim(),
      source: String(item.source || "").trim(),
      payload: item.payload && typeof item.payload === "object" ? item.payload : null
    };
  }

  return null;
}

function createCopilotPromptSuggestion(label, value = label) {
  return normalizeCopilotSuggestion({ kind: "prompt", label, value });
}

function createCopilotActionSuggestion(label, action, extras = {}) {
  return normalizeCopilotSuggestion({
    kind: "action",
    label,
    action,
    value: extras.value || label,
    source: extras.source || "copilot-tool",
    payload: extras.payload
  });
}

function createCopilotMessage(role, text, extras = {}) {
  const suggestions = Array.isArray(extras.suggestions)
    ? extras.suggestions.map((item) => normalizeCopilotSuggestion(item)).filter(Boolean)
    : [];
  return {
    role,
    text,
    ...(suggestions.length ? { suggestions } : {}),
    ...(extras.supportEntries?.length ? { supportEntries: extras.supportEntries } : {}),
    ...(extras.supportTitle ? { supportTitle: extras.supportTitle } : {}),
    ...(extras.proposedActionId ? { proposedActionId: extras.proposedActionId } : {})
  };
}

function isStaleCopilotMessage(message = {}) {
  const text = String(message?.text || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("android copilot lo local fallback replies disable chesam") ||
    text.includes("real ai backend integration complete ayyaka") ||
    text.includes("ask your doubt directly and i will answer it clearly") ||
    text.includes("select research or ask for draft improvements") ||
    text.includes("copilot is ready. ask a legal question or open a case for matter-specific help")
  );
}

function sanitizeCopilotMessages(messages = [], fallbackMessages = []) {
  const cleaned = Array.isArray(messages)
    ? messages.filter((item) => !isStaleCopilotMessage(item))
    : [];
  return cleaned.length ? cleaned : fallbackMessages;
}

function isTeluguPrompt(promptText = "") {
  return /[\u0C00-\u0C7F]|telugu|cheyyu|cheppu|vivarinchu|ardham/i.test(promptText);
}

function hasEditNegation(promptText = "") {
  const lower = String(promptText || "").trim().toLowerCase();
  return /cheyyaku|cheyakandi|vaddu|vaddhu|don't|do not|dont|no draft change|edit cheyyaku|change cheyyaku|rewrite cheyyaku|draft change cheyyaku/.test(lower);
}

function isGuidancePrompt(promptText = "") {
  const text = String(promptText || "").toLowerCase();
  return /first|how to use|ela|em cheyali|what next|next enti|ardham|understand|meaning|explain|simple|telugu|help|start|warning|final da|malli cases|naku em/.test(text);
}

function isSmallTalkPrompt(promptText = "") {
  const text = String(promptText || "").trim().toLowerCase();
  return /^(hi|hello|hey|hii|hiii|namaste|good morning|good afternoon|good evening|yo)$/.test(text);
}

function hasDraftDocumentCue(promptText = "") {
  const text = String(promptText || "").trim().toLowerCase();
  return /\b(draft|plaint|pleading|petition|complaint|notice|affidavit|written statement|counter|reply notice|document text|cause title)\b/.test(text);
}

function hasDraftSectionCue(promptText = "") {
  const text = String(promptText || "").trim().toLowerCase();
  return /\b(prayer|valuation|cause of action|jurisdiction|schedule(?: of property)?|property schedule|verification|relief|court fee|boundary|boundaries|party address|address details|parties and addresses)\b/.test(text);
}

function isExplicitDraftWritePrompt(promptText = "") {
  const text = String(promptText || "").trim().toLowerCase();
  if (!text || hasEditNegation(text)) {
    return false;
  }

  const hasDocCue = hasDraftDocumentCue(text);
  const hasSectionCue = hasDraftSectionCue(text);
  const hasWriteVerb =
    /\b(generate|create|prepare|redraft|rewrite|revise|edit|modify|change|update|correct|fix|patch|replace|insert|incorporate|merge|apply|improve)\b/.test(text)
    || (/\badd\b/.test(text) && (hasDocCue || hasSectionCue));
  const supportExcerptOnly =
    (/\bexcerpt\b/.test(text) || /\bdraft excerpt\b/.test(text))
    && /\b(support|explain|review|meaning|authority|citation|judgment|judgement|research)\b/.test(text)
    && !/\b(update|replace|apply|insert|merge|draft lo|in draft)\b/.test(text);

  if (supportExcerptOnly) {
    return false;
  }

  return hasWriteVerb && (hasDocCue || hasSectionCue);
}

function resolveCopilotRequest(promptText = "") {
  const text = String(promptText || "").trim();
  const lower = text.toLowerCase();
  const negatedEdit = hasEditNegation(lower);
  const explicitDraftWrite = isExplicitDraftWritePrompt(lower);
  const referencesDraftContent = hasDraftDocumentCue(lower) || hasDraftSectionCue(lower) || /\b(current draft|draft excerpt|excerpt)\b/.test(lower);
  const explicitSupport = /judg|judgement|judgment|citation|citations|authority|authorities|case law|precedent|pinpoint|statute|statutes|section|sections|support|research/.test(lower);
  const wantsOverview = /case gurinchi|matter gurinchi|motham|overall|study chesi|study|summary|facts|facts enti|issue enti/.test(lower);
  const wantsNextStep = /em cheyali|what next|next enti|first|start|ela/.test(lower);
  const wantsSimpleExplain = /ardham|understand|meaning|explain|simple|telugu|only explain|cheppu/.test(lower);

  if (!text) {
    return { intent: "empty", attachSupport: false, allowDraftPatch: false, includeDraftContext: false };
  }

  if (isSmallTalkPrompt(text)) {
    return { intent: "smalltalk", attachSupport: false, allowDraftPatch: false, includeDraftContext: false };
  }

  if (explicitDraftWrite) {
    return { intent: "draft", attachSupport: true, allowDraftPatch: true, includeDraftContext: true };
  }

  if (explicitSupport) {
    return { intent: "support", attachSupport: true, allowDraftPatch: false, includeDraftContext: referencesDraftContent };
  }

  if (negatedEdit || wantsOverview || wantsNextStep || wantsSimpleExplain || isGuidancePrompt(lower)) {
    return { intent: "explain", attachSupport: false, allowDraftPatch: false, includeDraftContext: referencesDraftContent };
  }

  return { intent: "explain", attachSupport: false, allowDraftPatch: false, includeDraftContext: referencesDraftContent };
}

function resolveCopilotWorkspaceAction(promptText = "", messageSource = null) {
  const text = String(promptText || "").trim().toLowerCase();
  if (!text) {
    return "";
  }

  if (
    /draft.*(generate|create|prepare).*(validate|validation)/i.test(text)
    || /(generate|create|prepare).*(draft).*(malli|again)?.*(validate|validation)/i.test(text)
  ) {
    return "generate_then_validate";
  }

  if (
    /(auto[\s-]?fix|fix issues|errors fix|issue fix).*(validate|validation)/i.test(text)
    || /(validate|validation).*(auto[\s-]?fix|fix issues|errors fix|issue fix)/i.test(text)
  ) {
    return "autofix_then_validate";
  }

  if (
    /(case|matter).*(handle|complete|study|review|read|drive|take|finish|close|prepare|manage)/i.test(text)
    || /(filing|final pack).*(take|teskel|tesukell|prepare|ready)/i.test(text)
    || /(case|matter)\s+(ni|motham).*(chudu|chusi|study|handle|complete|chey)/i.test(text)
    || /(filing varaku|final pack varaku|case motham|matter motham|complete case|handle case|one by one|step by step|anni cheseyu|nuvve chey)/i.test(text)
  ) {
    return "drive_case_forward";
  }

  if (/(generate|create|prepare|ready)\s+(the\s+)?draft|draft\s+(generate|create|ready|prepare|chey)/i.test(text)) {
    return "generate_draft";
  }
  if (/(validate|validation)\s+(the\s+)?draft|draft\s+validate|validation\s+chey/i.test(text)) {
    return "validate_draft";
  }
  if (/(auto[\s-]?fix|fix issues|issues fix|errors fix)\s+(the\s+)?draft|draft\s+autofix/i.test(text)) {
    return "autofix_draft";
  }
  if (/(build|prepare|create)\s+(the\s+)?(filing|final)\s+pack|(filing|final)\s+pack\s+(build|prepare|chey)/i.test(text)) {
    return "build_filing_pack";
  }
  if (/(open|show)\s+(the\s+)?draft|draft\s+open/i.test(text)) {
    return "open_draft";
  }
  if (/(open|show)\s+(the\s+)?research|research\s+open/i.test(text)) {
    return "open_research";
  }
  if (/(open|show)\s+(the\s+)?(final\s+summary|summary)|summary\s+open|final summary open/i.test(text)) {
    return "open_summary";
  }
  if (/(open|show)\s+(the\s+)?profile|profile\s+open/i.test(text)) {
    return "open_profile";
  }
  if (
    ((/(research|authority|authorities|citation|citations|judgment|judgments|case law|support)/i.test(text)
      && /(add|save|update|include|jodinchu|jodinchu|cheyyu|chey)/i.test(text))
      || /(authorities|citations)\s+(lo|ki)?\s*(add|save|update)|research\s+lo\s+(authorities|citations).*(add|save|update)/i.test(text))
    && (Array.isArray(messageSource?.supportEntries) ? messageSource.supportEntries.length > 0 : true)
  ) {
    return "save_support_to_research";
  }
  if (
    /(research|authority|authorities|citation|citations|judgment|judgments|case law|support).*(cheyyu|chey|update|continue|run|clear)/i.test(text)
    || /(research update cheyu|research cheyu|support add cheyu|authorities add cheyu|citations add cheyu)/i.test(text)
  ) {
    return "drive_case_forward";
  }
  if (/(save|add|update)\s+(this\s+|these\s+|the\s+)?(detail|details|note|notes)?\s*(to|into|in)?\s*profile|profile\s+lo\s+(save|add|update)|profile\s+(save|add|update)/i.test(text)) {
    return "save_to_profile";
  }
  if (/(add|save|include)\s+(this\s+|the\s+)?(issue|issues|point|points)?\s*(to|into|in)?\s*(research|issue|issues)|research\s+lo\s+(add|save)|issue\s+lo\s+(add|save)|research\s+(save|add)|issue\s+(save|add)/i.test(text)) {
    return "save_to_research";
  }
  if (/(apply|append|insert|paste|add)\s+(this\s+|these\s+|the\s+)?(content|details|text|reply|changes|update)?\s*(to|into|in)?\s*draft|draft\s+ki\s+(apply|add|append|paste)|draft\s+lo\s+(apply|add|append|paste)|draft\s+(apply|append|paste)/i.test(text)) {
    return "apply_to_draft";
  }
  if (/(open|show)\s+(the\s+)?workspace|workspace\s+open|back to workspace/i.test(text)) {
    return "open_workspace";
  }
  return "";
}

function inferWorkspaceActionFromAssistantText(text = "", messageSource = null) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) {
    return "";
  }

  if (/generate.*draft.*validate|draft.*generate.*validate|జనరేట్.*ధృవీక|generate chesi.*validate/i.test(lower)) {
    return "generate_then_validate";
  }

  if (/auto[\s-]?fix.*validate|fix issues.*validate|auto fix issues చేయమంటారా|auto fix/i.test(lower)) {
    return "autofix_then_validate";
  }

  if (/validate draft|draft.*validate|ధృవీకరించ|validation/i.test(lower)) {
    return "validate_draft";
  }

  if (/generate draft|draft generated|draft.*జనరేట్|draft.*prepare/i.test(lower)) {
    return "generate_draft";
  }

  if (/filing pack|final summary|build filing/i.test(lower)) {
    return "build_filing_pack";
  }

  if (
    /research.*update|authorities.*update|citations.*update|research విభాగం.*అప్‌డేట్|authorities.*జోడించ|citations.*జోడించ|research section/i.test(lower)
    || (Array.isArray(messageSource?.supportEntries) && messageSource.supportEntries.length > 0 && /add|save|update|jodinchu|continue/i.test(lower))
  ) {
    return "save_support_to_research";
  }

  if (/profile.*save|profile note/i.test(lower)) {
    return "save_to_profile";
  }

  if (/issue.*add|research issue/i.test(lower)) {
    return "save_to_research";
  }

  if (/apply.*draft|draft.*update|draft.*అప్‌డేట్|revised draft/i.test(lower)) {
    return "apply_to_draft";
  }

  if (/case.*step by step|one by one|anni.*ches|case.*handle|matter.*handle|filing varaku/i.test(lower)) {
    return "drive_case_forward";
  }

  return "";
}

function isApprovalStyleFollowUp(text = "") {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return false;
  }

  return /^(yes|yeah|yep|ok|okay|sure|avunu|sare|haa|ha|go ahead|continue|proceed|chey|cheyyu|cheseyu|add cheyu|update cheyu)$/i.test(value);
}

function isGuidanceOrFreshQuestion(text = "") {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return false;
  }

  return (
    /^(hello|hi|hey)$/i.test(value)
    || /next em cheyali|em cheyali|ippudu em cheyali|what next|next step/i.test(value)
    || /cheppu|explain|clear ga cheppu|study chesi cheppu/i.test(value)
    || /edo okati cheyu|nuvvaina.*cheyu|nuvve cheyu/i.test(value)
  );
}

function wantsAutonomousMatterHandling(text = "") {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return false;
  }

  return (
    /case.*study|matter.*study|study chesi/i.test(value)
    || /case.*handle|matter.*handle|case motham|matter motham/i.test(value)
    || /one by one|step by step|anni cheseyu|continue work|continue cheyu/i.test(value)
    || /nuvve cheyu|nuvvaina.*cheyu|edo okati cheyu/i.test(value)
    || /next em cheyali.*nuvve|what next.*you/i.test(value)
    || /filing varaku|final pack varaku|complete cheyu|teskelu|tesukellu/i.test(value)
  );
}

function inferAssistantBackedWorkspaceAction(promptText = "", messageSource = null) {
  const text = String(promptText || "").trim().toLowerCase();
  if (!text || !messageSource) {
    return "";
  }

  if (messageSource?.proposedActionId && isApprovalStyleFollowUp(text)) {
    return messageSource.proposedActionId;
  }

  const inferredFromAssistantText = isGuidanceOrFreshQuestion(text)
    ? ""
    : inferWorkspaceActionFromAssistantText(messageSource?.text || "", messageSource);
  if (inferredFromAssistantText) {
    return inferredFromAssistantText;
  }

  if (
    Array.isArray(messageSource?.supportEntries)
    && messageSource.supportEntries.length
    && isApprovalStyleFollowUp(text)
  ) {
    return "save_support_to_research";
  }

  return "";
}

function shouldAutoContinueAfterAiReply(promptText = "", proposedActionId = "") {
  const actionId = String(proposedActionId || "").trim();
  if (!actionId) {
    return false;
  }

  if (![
    "drive_case_forward",
    "generate_then_validate",
    "validate_draft",
    "autofix_then_validate",
    "build_filing_pack",
    "save_support_to_research"
  ].includes(actionId)) {
    return false;
  }

  return wantsAutonomousMatterHandling(promptText);
}

function getCopilotActionLabel(actionId = "") {
  switch (actionId) {
    case "generate_draft":
      return "Generate Draft";
    case "generate_then_validate":
      return "Generate Draft + Validate Draft";
    case "drive_case_forward":
      return "Handle Case Step By Step";
    case "validate_draft":
      return "Validate Draft";
    case "autofix_draft":
      return "Auto Fix Issues";
    case "autofix_then_validate":
      return "Auto Fix + Validate";
    case "build_filing_pack":
      return "Build Filing Pack";
    case "open_draft":
      return "Open Draft";
    case "open_research":
      return "Open Research";
    case "open_summary":
      return "Open Final Summary";
    case "open_profile":
      return "Open Profile";
    case "save_to_profile":
      return "Save To Profile";
    case "save_to_research":
      return "Add To Research";
    case "save_support_to_research":
      return "Update Research Support";
    case "apply_to_draft":
      return "Apply To Draft";
    case "open_workspace":
      return "Open Workspace";
    case "open_cases":
      return "Open Cases";
    default:
      return "Continue";
  }
}

function buildCopilotApprovalSuggestions() {
  return [];
}

function buildValidationReportReply(report = {}) {
  const critical = Array.isArray(report.criticalErrors) ? report.criticalErrors.filter(Boolean) : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(Boolean) : [];
  const missing = Array.isArray(report.missingSections) ? report.missingSections.filter(Boolean) : [];
  const status = report.statusLabel || report.status || "Validation completed";
  const score = report.score != null ? `${report.score}%` : "Not scored";

  return [
    `Validation complete. Status: ${status}. Score: ${score}.`,
    critical.length ? `Critical errors: ${critical.join(" | ")}.` : "Critical errors: none.",
    warnings.length ? `Warnings: ${warnings.join(" | ")}.` : "Warnings: none.",
    missing.length ? `Missing sections: ${missing.join(", ")}.` : "Missing sections: none.",
    "Next: review the Draft screen, then use Auto Fix Issues or manual edit if needed."
  ].join(" ");
}

function buildAutoFixReply(fixesApplied = [], report = {}, changed = false) {
  const fixes = Array.isArray(fixesApplied) ? fixesApplied.filter(Boolean) : [];
  const status = report.statusLabel || report.status || "Validation updated";
  return [
    changed
      ? `Auto-fix applied. ${fixes.length ? `${fixes.length} deterministic fix(es) were made.` : "Draft was updated."}`
      : "Auto-fix review complete. No deterministic text changes were applied.",
    fixes.length ? `Fixes: ${fixes.join(" | ")}.` : "",
    `Current validation status: ${status}.`,
    "Next: open Draft to review highlights, then build the filing pack after the review."
  ].filter(Boolean).join(" ");
}

function buildFilingPackReply(checklist = []) {
  const steps = Array.isArray(checklist) ? checklist.filter(Boolean) : [];
  return [
    "Filing pack checklist is ready.",
    steps.length ? `Checklist: ${steps.join(" | ")}.` : "No checklist items were returned.",
    "Next: review Final Summary and export the filing pack once the pending checks are complete."
  ].join(" ");
}

function buildMatterCopilotToolSuggestions(matter, matterState, promptText = "") {
  return [];
}

function isSubstantiveMatterDraft(draftText = "") {
  const text = String(draftText || "").trim();
  if (!text) {
    return false;
  }
  if (/Draft note:\s*Initial AI draft prepared from raw matter details\./i.test(text)) {
    return false;
  }
  if (/\[ASSUMPTION:/i.test(text) && text.length < 800) {
    return false;
  }
  return true;
}

function collectValidationFactRequests(report = {}) {
  const requests = [];
  const addUnique = (value) => {
    const clean = String(value || "").trim();
    if (!clean || requests.includes(clean)) {
      return;
    }
    requests.push(clean);
  };

  const critical = Array.isArray(report.criticalErrors) ? report.criticalErrors : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const allItems = [...critical, ...warnings].map((item) => String(item || ""));

  allItems.forEach((item) => {
    if (/property schedule incomplete|boundary|boundaries/i.test(item)) {
      addUnique("Property boundaries ivvu: North, South, East, West.");
    }
    if (/cause of action/i.test(item)) {
      addUnique("Defendant first interference exact date ivvu.");
    }
    if (/party address|address details|party details|father|age|occupation/i.test(item)) {
      addUnique("Plaintiff mariyu Defendant full address, father name, age, occupation ivvu.");
    }
    if (/placeholder|assumption/i.test(item)) {
      addUnique("Draft lo migilina placeholders replace cheyyadaniki exact factual details ivvu.");
    }
    if (/title dispute|ancestral|unpartitioned/i.test(item)) {
      addUnique("Plaintiff exclusive possession ni support cheyyadaniki cultivation / possession proof facts cheppu.");
    }
    if (/authority|citation|support/i.test(item)) {
      addUnique("Ee civil injunction issue ki relevant judgments leda issue statement ivvu; research lo add chestha.");
    }
  });

  return requests.slice(0, 4);
}

function buildCaseWorkflowReply({
  draftGenerated = false,
  validationReport = null,
  filingChecklist = [],
  filingBuilt = false
} = {}) {
  const report = validationReport || {};
  const critical = Array.isArray(report.criticalErrors) ? report.criticalErrors.filter(Boolean) : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(Boolean) : [];
  const missing = Array.isArray(report.missingSections) ? report.missingSections.filter(Boolean) : [];
  const score = report.score != null ? `${report.score}%` : "Not scored";
  const requests = collectValidationFactRequests(report);

  const lines = [];
  lines.push("Case motham review chesanu.");
  if (draftGenerated) {
    lines.push("Draft generate chesanu.");
  }
  lines.push(`Validation status: ${report.statusLabel || report.status || "Validation completed"}. Score: ${score}.`);

  if (!critical.length && !missing.length && filingBuilt) {
    lines.push("Draft filing-ready stage ki daggaraga undi. Filing pack checklist kuda prepare chesanu.");
    if (Array.isArray(filingChecklist) && filingChecklist.length) {
      lines.push(`Filing checklist: ${filingChecklist.join(" | ")}.`);
    }
    lines.push("Ippudu lawyer review tarvata final export/share cheyyachu.");
    return lines.join(" ");
  }

  if (critical.length) {
    lines.push(`Immediate gaps: ${critical.join(" | ")}.`);
  }
  if (warnings.length) {
    lines.push(`Watch points: ${warnings.join(" | ")}.`);
  }
  if (missing.length) {
    lines.push(`Missing sections: ${missing.join(", ")}.`);
  }

  if (requests.length) {
    lines.push(`Naku ippudu mee nundi kavalsina details: ${requests.join(" | ")} Ivvu, nenu next draft update ki prepare chestha.`);
  } else {
    lines.push("Ippudu remaining gaps ni clear cheyyadaniki konni exact facts ivvu; nenu next draft update ki prepare chestha.");
  }

  return lines.join(" ");
}

function getLatestActionableAssistantMessage(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const text = String(item?.text || "").trim();
    if (item?.role !== "assistant" || !text) {
      continue;
    }
    if (/^Action failed:/i.test(text)) {
      continue;
    }
    if (/^Approved\./i.test(text)) {
      continue;
    }
    if (/ cancel chesa\.$/i.test(text)) {
      continue;
    }
    return item;
  }
  return null;
}

function shouldGenerateDraftPatch(promptText = "") {
  return resolveCopilotRequest(promptText).allowDraftPatch;
}

function shouldAttachSupportToReply(promptText = "") {
  return resolveCopilotRequest(promptText).attachSupport;
}

function classifyCopilotIntent(promptText = "") {
  const request = resolveCopilotRequest(promptText);
  if (request.intent === "draft") return "edit";
  if (request.intent === "support") return "research";
  return request.intent;
}

function deriveCopilotResponseMode(promptText = "") {
  const text = String(promptText || "").trim().toLowerCase();
  const request = resolveCopilotRequest(promptText);
  if (!text) return "Answer";
  if (/handle case workflow|drive case forward/i.test(text)) return "Case workflow";
  if (/autofix|auto fix|fix issues|fix cheyu|fix chey|issues ni fix/i.test(text)) return "Auto-fix";
  if (/validate|validation|report|errors|warnings|check draft/i.test(text)) return "Validation";
  if (/filing|final pack|filing pack|ready to file/i.test(text)) return "Filing pack";
  if (/app|screen|page|option|button|workflow|how to use|ela use|ekkada|settings|next em cheyali/i.test(text)) return "App guidance";
  if (request.intent === "support" || /judg|judgement|judgment|citation|authority|support|research|case law/i.test(text)) return "Research support";
  if (request.intent === "draft") return "Draft update";
  return "Answer";
}

function buildProgressPromptFromActionId(actionId = "") {
  switch (actionId) {
    case "generate_draft":
      return "generate draft";
    case "generate_then_validate":
      return "generate draft and validate draft";
    case "validate_draft":
      return "validate draft";
    case "autofix_draft":
      return "auto fix draft";
    case "autofix_then_validate":
      return "auto fix draft and validate draft";
    case "build_filing_pack":
      return "build filing pack";
    case "open_draft":
      return "open draft";
    case "open_research":
      return "open research";
    case "open_summary":
      return "open final summary";
    case "open_profile":
      return "open profile";
    case "save_to_profile":
      return "save to profile";
    case "save_to_research":
      return "save to research";
    case "save_support_to_research":
      return "update research support";
    case "apply_to_draft":
      return "apply to draft";
    case "drive_case_forward":
      return "handle case workflow";
    default:
      return "";
  }
}

function buildCopilotProgressModel({ promptText = "", matter = null, matterState = null, activeActionId = "" } = {}) {
  const progressPrompt = activeActionId ? buildProgressPromptFromActionId(activeActionId) : promptText;
  const mode = deriveCopilotResponseMode(progressPrompt);
  const readingItems = [];
  const sourceBadges = [];

  if (matter) {
    sourceBadges.push("Case facts");
    readingItems.push("Case facts");
  } else {
    sourceBadges.push("App guide");
    readingItems.push("App guide");
  }
  if (matterState?.currentDraft) {
    sourceBadges.push("Draft");
    readingItems.push("Current draft");
  }
  if (matterState?.lastResearchFocus || matter?.research?.authorities?.length || matter?.research?.citations?.length) {
    sourceBadges.push("Authorities");
    readingItems.push("Research support");
  }
  if (matterState?.validationReport) {
    sourceBadges.push("Validation");
    readingItems.push("Validation issues");
  }
  if (Array.isArray(matterState?.filingChecklist) && matterState.filingChecklist.length) {
    sourceBadges.push("Filing");
    readingItems.push("Filing checklist");
  }
  if (/attachments:/i.test(progressPrompt)) {
    sourceBadges.push("Files");
    readingItems.push("Attachments");
  }
  if (mode === "App guidance") {
    sourceBadges.push("Screen path");
    readingItems.push("Current screen");
  }

  let stageLabels = [
    "Understanding request",
    "Checking workspace",
    "Matching support",
    "Preparing response"
  ];
  let actionSummary = "Workspace ni chusi reply prepare chesthunna.";
  let nextSummary = "Complete reply ni ippude istanu.";

  if (mode === "Draft update") {
    stageLabels = [
      "Reading current draft",
      "Checking change request",
      "Updating draft text",
      "Preparing revised draft"
    ];
    actionSummary = "Current draft ni chusi requested changes merge chesthunna.";
    nextSummary = "Revised draft text ni clear ga chupistha.";
  } else if (mode === "Validation") {
    stageLabels = [
      "Reading draft",
      "Applying legal checks",
      "Finding issues",
      "Preparing report"
    ];
    actionSummary = "Current draft ni legal validation rules tho check chesthunna.";
    nextSummary = "Critical errors, warnings, missing details ni list chestha.";
  } else if (mode === "Auto-fix") {
    stageLabels = [
      "Reading current draft",
      "Finding deterministic fixes",
      "Applying safe fixes",
      "Preparing updated draft"
    ];
    actionSummary = "Safe deterministic fixes apply cheyyadaniki draft ni scan chesthunna.";
    nextSummary = "Auto-fix ayina changes mariyu remaining issues cheptha.";
  } else if (mode === "Filing pack") {
    stageLabels = [
      "Checking draft status",
      "Checking documents",
      "Checking filing readiness",
      "Preparing filing output"
    ];
    actionSummary = "Draft, documents, filing readiness ni combine chesi filing pack prepare chesthunna.";
    nextSummary = "Checklist and ready-to-file status istanu.";
  } else if (mode === "Research support") {
    stageLabels = [
      "Understanding issue",
      "Checking authorities",
      "Matching citations",
      "Preparing supported answer"
    ];
    actionSummary = "Issue ki relevant authorities mariyu citations match chesthunna.";
    nextSummary = "Supported answer and usable legal point istanu.";
  } else if (mode === "App guidance") {
    stageLabels = [
      "Reading current screen",
      "Finding exact option",
      "Matching screen path",
      "Preparing guidance"
    ];
    actionSummary = "Current screen context chusi exact option path kanukuntunna.";
    nextSummary = "Exact screen and next action cheptha.";
  } else if (mode === "Case workflow") {
    stageLabels = [
      "Reading case details",
      "Checking draft and validation",
      "Running next workflow step",
      "Preparing case status"
    ];
    actionSummary = "Case motham study chesi next drafting/validation/filing step run chesthunna.";
    nextSummary = "Case status, immediate gaps, and next lawyer input ni cheptha.";
  }

  return {
    mode,
    sourceBadges: Array.from(new Set(sourceBadges)).slice(0, 5),
    readingItems: Array.from(new Set(readingItems)).slice(0, 5),
    stageLabels,
    actionSummary,
    nextSummary
  };
}

function summarizeLiveStatusMessage(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function CopilotPreparationCard({ model, activeStageIndex = 0, status = "idle", lastMessageText = "" }) {
  if (!model || status === "idle") {
    return null;
  }

  const isWorking = status === "sending" || status === "started";
  const isStopped = status === "error";
  const liveStatus = isWorking
    ? (model.stageLabels[activeStageIndex] || "Preparing response")
    : isStopped
      ? "Copilot stopped"
      : "Copilot done";
  const helperLine = isWorking
    ? (model.actionSummary || model.nextSummary || "")
    : summarizeLiveStatusMessage(lastMessageText) || (isStopped ? "Work stopped before completion." : "Last action completed.");
  const readingLine = model.readingItems?.length ? `Reading: ${model.readingItems.join(" | ")}` : "";

  return (
    <View
      style={[
        styles.chatBubble,
        styles.chatBubbleAssistant,
        styles.copilotProgressCard,
        isStopped ? styles.copilotProgressCardError : null
      ]}
    >
      <View style={styles.copilotProgressHeader}>
        <View style={styles.copilotProgressHeaderCopy}>
          <Text style={styles.chatBubbleRole}>Copilot</Text>
          <Text style={styles.copilotProgressTitle}>
            {isWorking ? "Working live" : isStopped ? "Stopped" : "Last update"}
          </Text>
        </View>
        <View style={styles.copilotProgressModePill}>
          <Text style={styles.copilotProgressModeText}>
            {isWorking ? model.mode : isStopped ? "Error" : "Ready"}
          </Text>
        </View>
      </View>
      <View style={styles.copilotProgressStatusRow}>
        {isWorking ? (
          <ActivityIndicator color="#0f766e" size="small" />
        ) : (
          <View style={[styles.copilotProgressStatusDot, isStopped ? styles.copilotProgressStatusDotError : styles.copilotProgressStatusDotReady]} />
        )}
        <Text style={styles.copilotProgressStatusText}>{liveStatus}</Text>
      </View>
      {helperLine ? (
        <Text style={styles.copilotProgressHelperText}>{helperLine}</Text>
      ) : null}
      {readingLine ? (
        <Text style={styles.copilotProgressReadingText}>{readingLine}</Text>
      ) : null}
    </View>
  );
}

const extraLauncherApps = [
  {
    id: "clients",
    title: "Clients",
    subtitle: "Browse linked clients and start a matter from a selected profile."
  },
  {
    id: "draft",
    title: "Draft",
    subtitle: "Review the current pleading and Copilot updates."
  },
  {
    id: "notes",
    title: "Saved Notes",
    subtitle: "Reuse saved snippets, Copilot notes, and drafting helpers."
  },
  {
    id: "archived",
    title: "Archived",
    subtitle: "Browse archived cases and client profiles, then restore them."
  },
  {
    id: "tools",
    title: "Tools",
    subtitle: "Quick legal helpers, exports, and drafting utilities."
  },
  {
    id: "help",
    title: "Help",
    subtitle: "Quick walkthrough, trust guide, and demo steps in multiple languages."
  }
];

const advancedToolCatalog = [
  {
    id: "judgments",
    title: "Latest Judgments",
    subtitle: "Track recent matched judgments, detail, and comparison.",
    category: "Research Library",
    status: "Connect research feed",
    description: "Open the latest matched authorities, inspect treatment, compare two judgments, and push useful holdings into Research or Copilot."
  },
  {
    id: "citations",
    title: "Citations",
    subtitle: "Check parallel citations, graph, and usable references.",
    category: "Research Library",
    status: "Extend research feed",
    description: "Review canonical citations, alternate citations, and quick citation packs before weaving them into the draft."
  },
    {
      id: "case-studies",
      title: "Case Studies",
      subtitle: "Load similar fact patterns and reusable legal strategy.",
      category: "Research Library",
      status: "Reference ready",
      description: "Show reusable matter studies, litigation structure, and comparable case approaches for fast strategy drafting."
    },
  {
    id: "arguments",
    title: "Argument Builder",
    subtitle: "Turn issues and authorities into stronger pleadings.",
    category: "Draft Support",
    status: "Use research context",
    description: "Generate argument blocks from issues, authorities, and case facts, then send them straight into Copilot or Draft."
  },
  {
    id: "prediction",
    title: "Case Prediction",
    subtitle: "Estimate risk, strengths, and likely case direction.",
    category: "Review & Strategy",
    status: "Insight preview",
    description: "Summarize strengths, risks, likely pressure points, and practical next steps based on case facts and current draft posture."
  },
  {
    id: "mapping",
    title: "Legacy Mapping",
    subtitle: "Map old references, IPC/CrPC style labels, and conversions.",
    category: "Review & Strategy",
    status: "Reference helper",
    description: "Help convert legacy labels and older statutory references into current structured research and drafting notes."
  },
  {
    id: "templates",
    title: "Template Library",
    subtitle: "Open reusable notice, complaint, and petition skeletons.",
    category: "Draft Support",
    status: "Library ready",
    description: "Choose reusable legal templates and send the selected structure into the Draft workspace."
  },
  {
    id: "document",
    title: "Document Analyzer",
    subtitle: "Review uploaded papers, screenshots, and evidence notes.",
    category: "Draft Support",
    status: "Attachment-aware",
    description: "Extract useful points from uploaded documents, screenshots, and annexures, then feed them into Copilot or Research."
  },
  {
    id: "memory",
    title: "Smart Memory",
    subtitle: "Saved drafting memory, repeatable facts, and reusable notes.",
    category: "Research Library",
    status: "Library mode",
    description: "Surface saved snippets, recurring client fact patterns, and reusable drafting memory for quick reuse."
  }
];

const roleConfigs = {
  lawyer: {
    label: "Lawyer",
    homeTitle: "Law Assistant Apps",
    heroTitle: "Workspace Home",
    heroSubtitle: "Open a case, research authorities, improve the draft in Copilot, and finish filing.",
    focusTitle: "Core Apps"
  },
  senior: {
    label: "Senior",
    homeTitle: "Senior Review Apps",
    heroTitle: "Senior Review Home",
    heroSubtitle: "Review associate work, tighten strategy, approve stronger draft updates, and close filing gaps.",
    focusTitle: "Senior Review"
  },
  firm: {
    label: "Firm",
    homeTitle: "Firm Oversight Apps",
    heroTitle: "Firm Dashboard",
    heroSubtitle: "Track matters, monitor filing readiness, review summaries, and keep firm-wide work aligned.",
    focusTitle: "Firm Oversight"
  }
};

const HELP_CONTENT = {
  english: {
    label: "English",
    heroTitle: "How to use this app",
    heroSubtitle: "Start with a matter, review legal support, improve the draft in Copilot, and finish with a filing-ready summary.",
    quickStart: [
      "Open Cases and choose an existing matter or create a new one.",
      "Go to Research and review issues, authorities, citations, and arguments.",
      "Use Copilot to improve the draft with source-backed legal support.",
      "Check Final Summary before sharing or filing."
    ],
    copilot: [
      "Ask Copilot to explain, improve, shorten, or strengthen any section.",
      "Attach photos, screenshots, or files when you need evidence context.",
      "Use supported authorities and propositions before applying draft changes."
    ],
    trust: [
      "Confidence shows how strong the legal support looks.",
      "Freshness warns if an authority may be older and should be rechecked.",
      "Treatment tells you whether an authority is safe, limited, or needs review."
    ],
    demo: [
      "Select a matter",
      "Open Research",
      "Send one authority to Copilot",
      "Apply the draft patch",
      "Open Final Summary and export"
    ]
  },
  telugu: {
    label: "తెలుగు",
    heroTitle: "ఈ యాప్ ఎలా ఉపయోగించాలి",
    heroSubtitle: "మొదట ఒక matter ఎంచుకోండి, legal support చూసి, Copilot తో draft మెరుగుపరచి, చివరగా filing summary తో close చేయండి.",
    quickStart: [
      "Cases లోకి వెళ్లి existing matter ఓపెన్ చేయండి లేదా కొత్త matter create చేయండి.",
      "Research లో issues, authorities, citations, arguments చూడండి.",
      "Copilot తో source support ఉన్న draft changes apply చేయండి.",
      "Final Summary లో readiness check చేసి share/export చేయండి."
    ],
    copilot: [
      "ఏ section explain చేయమన్నా, improve చేయమన్నా, shorten చేయమన్నా Copilot ని అడగండి.",
      "Evidence context కావాలంటే photo, screenshot, file attach చేయండి.",
      "Apply చేసే ముందు supported authority and proposition verify చేయండి."
    ],
    trust: [
      "Confidence అంటే legal support ఎంత strong గా ఉందో చూపిస్తుంది.",
      "Freshness అంటే authority పాతదై ఉండవచ్చు, latest treatment recheck చేయాలి అని signal.",
      "Treatment అంటే authority safe ఆ, limited ఆ, review కావాలా అనేది చూపిస్తుంది."
    ],
    demo: [
      "Matter select చేయండి",
      "Research ఓపెన్ చేయండి",
      "ఒక authority ని Copilot కి పంపండి",
      "Draft patch apply చేయండి",
      "Final Summary లో export/share చేయండి"
    ]
  },
  hindi: {
    label: "हिंदी",
    heroTitle: "ऐप का उपयोग कैसे करें",
    heroSubtitle: "पहले matter चुनें, legal support देखें, Copilot से draft सुधारें, फिर Final Summary से filing readiness चेक करें.",
    quickStart: [
      "Cases में जाकर existing matter खोलें या नया matter बनाएं.",
      "Research में issues, authorities, citations और arguments देखें.",
      "Copilot से source-backed draft changes करें.",
      "Final Summary में readiness देखकर share/export करें."
    ],
    copilot: [
      "Copilot से किसी भी section ko explain, improve, shorten, ya strengthen karne ke liye puchhiye.",
      "Evidence context ke liye photo, screenshot, ya file attach kijiye.",
      "Draft apply karne se pehle supported authority aur proposition dekh lijiye."
    ],
    trust: [
      "Confidence batata hai ki legal support kitna strong hai.",
      "Freshness batata hai ki authority purani ho sakti hai aur recheck zaroori hai.",
      "Treatment batata hai ki authority safe hai, limited hai, ya review chahiye."
    ],
    demo: [
      "Matter select kijiye",
      "Research kholiye",
      "Ek authority Copilot ko bhejiye",
      "Draft patch apply kijiye",
      "Final Summary se export/share kijiye"
    ]
  }
};

function getLauncherAppsForRole(role) {
  if (role === "senior") {
    return [
      { id: "cases", title: "Review Queue", subtitle: "Open matters that need senior review." },
      { id: "copilot", title: "Review Copilot", subtitle: "Refine reasoning, drafting, and strategy." },
      { id: "research", title: "Research Review", subtitle: "Check authorities, citations, and issues." },
      { id: "summary", title: "Approval Summary", subtitle: "Validation, filing pack, and approval view." }
    ];
  }

  if (role === "firm") {
    return [
      { id: "cases", title: "Matters", subtitle: "Browse live matters across the workspace." },
      { id: "clients", title: "Clients", subtitle: "Review linked clients and matter owners." },
      { id: "summary", title: "Reports", subtitle: "Validation, filing pack, and final reports." },
      { id: "tools", title: "Tools", subtitle: "Use firm-wide legal helpers and analysis tools." }
    ];
  }

  return launcherApps;
}

function buildAppCapabilitySummary(role = "lawyer") {
  const roleConfig = roleConfigs[role] ?? roleConfigs.lawyer;
  const launcherTitles = getLauncherAppsForRole(role).map((item) => item.title).join(", ");
  const extraTitles = extraLauncherApps.map((item) => item.title).join(", ");
  const toolTitles = advancedToolCatalog.map((item) => item.title).join(", ");
  const help = HELP_CONTENT.english;

  return [
    `APP ROLE: ${roleConfig.label}`,
    `ROLE HOME: ${roleConfig.heroTitle} - ${roleConfig.heroSubtitle}`,
    `MAIN SECTIONS: ${launcherTitles}`,
    `EXTRA SECTIONS: ${extraTitles}`,
    `TOOLS: ${toolTitles}`,
    `COPILOT USAGE: ${help.copilot.join(" ")}`,
    `QUICK START: ${help.quickStart.join(" ")}`,
    "SETTINGS / APP CONTROL: user can switch role, open cases, clients, archived records, saved notes, tools, help, draft, copilot, research, and final summary.",
    "SCREEN GUIDE: Home shows workspace status and role switch. Cases opens saved matters. Profile shows client and matter overview. Research shows issues, authorities, citations, arguments, documents, and buttons like Generate Draft, Open Draft, Open Copilot, and Final Summary.",
    "DRAFT WORKFLOW: Draft screen shows Pleading text and buttons Generate Draft, Edit Draft, Validate Draft, Auto Fix Issues, Build Filing Pack, Download Draft, and Share Draft.",
    "EDIT DRAFT: Use Edit Draft to open the manual editor. There the user can select text, Delete Selected, Replace Selected, Undo Last, Redo Last, and Save Draft.",
    "COPILOT WORKFLOW: Copilot screen is used to ask legal doubts, ask app-usage doubts, improve draft wording, save notes, copy one response, copy full chat, open snapshot, attach files, and apply suggested patch when Draft patch ready is shown.",
    "FINAL SUMMARY WORKFLOW: Final Summary shows readiness, validation and filing, unsupported review, checklist, final actions, and buttons like Validation Report, Filing Pack, Documents, Arguments, Case Summary, and Share Summary.",
    "DOCUMENTS / EXPORTS: documents, draft, validation report, filing pack, arguments pack, and case summary can be shared or downloaded from Draft or Final Summary depending on the output type.",
    "TOOLS GUIDE: Latest Judgments, Citations, Case Studies, Argument Builder, Case Prediction, Legacy Mapping, Template Library, Document Analyzer, and Smart Memory are available from Tools.",
    "HELP GUIDE: Help screen explains quick start, Copilot usage, trust signals, and best demo flow in multiple languages.",
    "WHEN USER ASKS WHERE AN OPTION IS: answer with exact screen name and exact button label, for example Research -> Generate Draft, Draft -> Edit Draft, Draft -> Validate Draft, Draft -> Auto Fix Issues, Draft -> Build Filing Pack, Final Summary -> Validation Report.",
    "WHEN USER ASKS HOW TO USE THE APP: explain step by step from Cases -> Research -> Copilot -> Draft -> Final Summary using plain language."
  ].join("\n");
}

function describeScreenPurpose(screen, options = {}) {
  const activeMatter = options.activeMatter || null;
  const selectedTool = options.selectedTool || null;

  switch (screen) {
    case "home":
      return "Home shows workspace status, role switch, recent matters, and quick launch actions.";
    case "cases":
      return "Cases shows saved matters and lets the user open a case workspace.";
    case "workspace":
      return activeMatter
        ? `${activeMatter.title} workspace shows matter overview, draft snapshot, research status, and quick navigation.`
        : "Workspace shows the active matter overview and quick navigation.";
    case "profile":
      return activeMatter
        ? `${activeMatter.title} profile shows client details, matter summary, and saved case notes.`
        : "Profile shows client details, matter summary, and saved notes.";
    case "details":
      return activeMatter
        ? `${activeMatter.title} details shows case facts, party details, valuation inputs, and property or transaction details.`
        : "Details shows case facts, party details, and matter-specific fields.";
    case "research":
      return activeMatter
        ? `${activeMatter.title} research shows issues, authorities, citations, arguments, draft status, and document list.`
        : "Research shows issues, authorities, citations, arguments, and documents.";
    case "draft":
      return activeMatter
        ? `${activeMatter.title} draft shows the current pleading text, edit tools, validation, autofix, and filing actions.`
        : "Draft shows the current pleading text and draft actions.";
    case "summary":
      return activeMatter
        ? `${activeMatter.title} final summary shows readiness, validation report, filing pack, arguments, case summary, and final export actions.`
        : "Final Summary shows readiness, validation, filing, and exports.";
    case "copilot":
      return activeMatter
        ? `${activeMatter.title} copilot is used for matter questions, draft updates, app guidance, note saving, and patch suggestions.`
        : "General Copilot is used for app guidance and general legal questions.";
    case "notes":
      return "Saved Notes shows reusable snippets and notes saved from Copilot or workspace screens.";
    case "tools":
      return "Tools shows advanced legal utilities like judgments, citations, argument builder, and smart memory.";
    case "tool-workspace":
      return selectedTool
        ? `${selectedTool.title} tool workspace shows tool output and actions to send insights into research or Copilot.`
        : "Tool workspace shows a selected advanced tool output.";
    case "help":
      return "Help explains quick start, Copilot usage, trust signals, and the best demo flow.";
    case "clients":
      return "Clients shows client records and lets the user open or manage client-linked matters.";
    case "archived":
      return "Archived shows hidden matters and clients that can be restored later.";
    default:
      return "Workspace context is available for app guidance questions.";
  }
}

function getScreenActionHints(screen, options = {}) {
  const activeMatter = options.activeMatter || null;
  const selectedTool = options.selectedTool || null;

  switch (screen) {
    case "home":
      return ["Open Cases", "Open Tools", "Help"];
    case "cases":
      return ["Open Case", "Create Case"];
    case "workspace":
      return activeMatter
        ? ["Profile", "Details", "Research", "Draft", "Final Summary", "Open Copilot"]
        : ["Open Cases"];
    case "profile":
      return ["Open Details", "Open Research", "Open Draft", "Open Copilot"];
    case "details":
      return ["Open Profile", "Open Research", "Open Draft", "Open Copilot"];
    case "research":
      return ["Generate Draft", "Open Draft", "Open Copilot", "Final Summary", "Download Documents", "Share Documents"];
    case "draft":
      return ["Generate Draft", "Edit Draft", "Validate Draft", "Auto Fix Issues", "Build Filing Pack", "Download Draft", "Share Draft", "Open Copilot", "Final Summary"];
    case "summary":
      return ["Validation Report", "Filing Pack", "Documents", "Arguments", "Case Summary", "Share Summary", "Open Draft", "Open Copilot"];
    case "copilot":
      return ["Send", "Copy Full Chat", "Open Snapshot", "Copy", "Save Note", "Attach"];
    case "notes":
      return ["Use in Copilot"];
    case "tools":
      return ["Open Tool", activeMatter ? "Open Research" : "Open Cases", activeMatter ? "Open Copilot" : "Case List", activeMatter ? "Open Draft" : "Case List"];
    case "tool-workspace":
      return selectedTool ? ["Send to Copilot", "Use in Research", "Save Insight"] : ["Open Tools"];
    case "help":
      return ["Open Cases", activeMatter ? "Open Copilot" : "Open Cases"];
    case "clients":
      return ["Open Client", "Create Client"];
    case "archived":
      return ["Restore Case", "Restore Client"];
    default:
      return [];
  }
}

function buildScreenAwareCopilotContext({ screen = "home", sourceScreen = "", activeMatter = null, selectedTool = null } = {}) {
  const effectiveSource = sourceScreen && sourceScreen !== screen ? sourceScreen : "";
  const currentPurpose = describeScreenPurpose(screen, { activeMatter, selectedTool });
  const currentActions = getScreenActionHints(screen, { activeMatter, selectedTool });
  const sourcePurpose = effectiveSource
    ? describeScreenPurpose(effectiveSource, { activeMatter, selectedTool })
    : "";
  const sourceActions = effectiveSource
    ? getScreenActionHints(effectiveSource, { activeMatter, selectedTool })
    : [];

  return [
    `CURRENT SCREEN: ${screen}`,
    currentPurpose ? `CURRENT SCREEN PURPOSE: ${currentPurpose}` : "",
    currentActions.length ? `CURRENT SCREEN ACTIONS: ${currentActions.join(", ")}` : "",
    effectiveSource ? `COPILOT OPENED FROM: ${effectiveSource}` : "",
    sourcePurpose ? `SOURCE SCREEN PURPOSE: ${sourcePurpose}` : "",
    sourceActions.length ? `SOURCE SCREEN ACTIONS: ${sourceActions.join(", ")}` : "",
    activeMatter ? `ACTIVE MATTER TITLE: ${activeMatter.title}` : "",
    selectedTool ? `ACTIVE TOOL: ${selectedTool.title}` : ""
  ].filter(Boolean).join("\n");
}

function AppCard({ title, subtitle, onPress, compact = false }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.appCard, compact ? styles.appCardCompact : null]}
    >
      <View style={styles.appCardIcon}>
        <Text style={styles.appCardIconText}>{title.slice(0, 1)}</Text>
      </View>
      <Text style={styles.appCardTitle}>{title}</Text>
      <InteractiveText style={styles.appCardSubtitle}>{subtitle}</InteractiveText>
    </TouchableOpacity>
  );
}

function ActionRow({ title, subtitle, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.actionRow}>
      <View style={styles.actionRowCopy}>
        <Text style={styles.actionRowTitle}>{title}</Text>
        <InteractiveText style={styles.actionRowSubtitle}>{subtitle}</InteractiveText>
      </View>
      <Text style={styles.actionRowArrow}>Open</Text>
    </TouchableOpacity>
  );
}

function Pill({ children, active = false }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : null]}>
      <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>{children}</Text>
    </View>
  );
}

function BackBar({ title, subtitle, onBack }) {
  return (
    <View style={styles.backBar}>
      <TouchableOpacity activeOpacity={0.85} onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>
      <View style={styles.backCopy}>
        <Text style={styles.backTitle}>{title}</Text>
        {subtitle ? <Text style={styles.backSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function SectionBlock({ kicker, title, children, rightNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionHeadCopy}>
          {kicker ? <Text style={styles.sectionKicker}>{kicker}</Text> : null}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {rightNode}
      </View>
      {children}
    </View>
  );
}

function CollapsibleBlock({ kicker, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setOpen((current) => !current)} style={styles.collapsibleHead}>
        <View style={styles.sectionHeadCopy}>
          {kicker ? <Text style={styles.sectionKicker}>{kicker}</Text> : null}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Text style={styles.collapsibleToggle}>{open ? "Hide" : "Show"}</Text>
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

function SummaryItem({ label, value }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <InteractiveText style={styles.summaryValue}>{value}</InteractiveText>
    </View>
  );
}

function normalizeDraftLineForDiff(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHighlightedDraftLines(currentText = "", previousText = "") {
  const currentLines = String(currentText || "").split("\n");
  const previousLines = String(previousText || "").split("\n");

  if (!previousLines.length || !String(previousText || "").trim()) {
    return currentLines.map((line) => ({ text: line, changed: false }));
  }

  const currentNormalized = currentLines.map(normalizeDraftLineForDiff);
  const previousNormalized = previousLines.map(normalizeDraftLineForDiff);
  const rowCount = currentNormalized.length;
  const colCount = previousNormalized.length;
  const matrix = Array.from({ length: rowCount + 1 }, () => new Uint16Array(colCount + 1));

  for (let row = 1; row <= rowCount; row += 1) {
    for (let col = 1; col <= colCount; col += 1) {
      if (currentNormalized[row - 1] === previousNormalized[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1] + 1;
      } else {
        matrix[row][col] = Math.max(matrix[row - 1][col], matrix[row][col - 1]);
      }
    }
  }

  const unchangedIndexes = new Set();
  let row = rowCount;
  let col = colCount;

  while (row > 0 && col > 0) {
    if (currentNormalized[row - 1] === previousNormalized[col - 1]) {
      unchangedIndexes.add(row - 1);
      row -= 1;
      col -= 1;
    } else if (matrix[row - 1][col] >= matrix[row][col - 1]) {
      row -= 1;
    } else {
      col -= 1;
    }
  }

  return currentLines.map((line, index) => ({
    text: line,
    changed: !unchangedIndexes.has(index) && Boolean(normalizeDraftLineForDiff(line))
  }));
}

function buildChangedExcerptSummary(currentText = "", previousText = "") {
  const lines = buildHighlightedDraftLines(currentText, previousText);
  const changedIndexes = lines
    .map((item, index) => (item.changed ? index : -1))
    .filter((index) => index >= 0);

  if (!changedIndexes.length) {
    return null;
  }

  const firstIndex = changedIndexes[0];
  let lastIndex = firstIndex;
  for (let index = 1; index < changedIndexes.length; index += 1) {
    if (changedIndexes[index] === lastIndex + 1) {
      lastIndex = changedIndexes[index];
    } else {
      break;
    }
  }

  const currentLines = String(currentText || "").split("\n");
  const previousLines = String(previousText || "").split("\n");
  const excerptStart = Math.max(0, firstIndex - 1);
  const excerptEnd = Math.min(currentLines.length, lastIndex + 2);

  return {
    changedCount: changedIndexes.length,
    currentExcerpt: currentLines.slice(excerptStart, excerptEnd).join("\n").trim(),
    previousExcerpt: previousLines.slice(excerptStart, excerptEnd).join("\n").trim()
  };
}

function tokenizeDraftExcerpt(value = "") {
  return String(value || "")
    .split(/(\s+)/)
    .filter((token) => token.length > 0);
}

function buildWordDiffSegments(currentText = "", previousText = "") {
  const currentTokens = tokenizeDraftExcerpt(currentText);
  const previousTokens = tokenizeDraftExcerpt(previousText);
  const currentComparable = currentTokens.map((token) => normalizeDraftLineForDiff(token));
  const previousComparable = previousTokens.map((token) => normalizeDraftLineForDiff(token));
  const rowCount = currentTokens.length;
  const colCount = previousTokens.length;
  const matrix = Array.from({ length: rowCount + 1 }, () => new Uint16Array(colCount + 1));

  for (let row = 1; row <= rowCount; row += 1) {
    for (let col = 1; col <= colCount; col += 1) {
      if (currentComparable[row - 1] === previousComparable[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1] + 1;
      } else {
        matrix[row][col] = Math.max(matrix[row - 1][col], matrix[row][col - 1]);
      }
    }
  }

  const unchangedCurrent = new Set();
  const unchangedPrevious = new Set();
  let row = rowCount;
  let col = colCount;

  while (row > 0 && col > 0) {
    if (currentComparable[row - 1] === previousComparable[col - 1]) {
      if (currentComparable[row - 1]) {
        unchangedCurrent.add(row - 1);
        unchangedPrevious.add(col - 1);
      }
      row -= 1;
      col -= 1;
    } else if (matrix[row - 1][col] >= matrix[row][col - 1]) {
      row -= 1;
    } else {
      col -= 1;
    }
  }

  return {
    current: currentTokens.map((token, index) => ({
      text: token,
      changed: Boolean(normalizeDraftLineForDiff(token)) && !unchangedCurrent.has(index)
    })),
    previous: previousTokens.map((token, index) => ({
      text: token,
      changed: Boolean(normalizeDraftLineForDiff(token)) && !unchangedPrevious.has(index)
    }))
  };
}

function isCopilotDraftChange(historyItem = null) {
  if (!historyItem || typeof historyItem !== "object") {
    return false;
  }

  const source = String(historyItem?.patchMeta?.source || "").trim().toLowerCase();
  const patchText = String(historyItem?.patch || "").trim().toLowerCase();
  return source === "copilot-chat" || source === "copilot-patch" || (/copilot/.test(patchText) && source !== "manual-editor" && source !== "validation-autofix");
}

function CompareDiffText({ segments = [] }) {
  return (
    <Text selectable style={styles.compareBody}>
      {segments.map((segment, index) => (
        <Text
          key={`segment-${index}`}
          style={segment.changed ? styles.compareBodyChangedWord : null}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function DraftPreviewCard({ text, previousText = "", highlightCopilotChanges = false, onPressHighlightedLine = null }) {
  const displayText = formatDraftDisplayText(text);
  const lines = highlightCopilotChanges
    ? buildHighlightedDraftLines(displayText, formatDraftDisplayText(previousText))
    : displayText.split("\n").map((line) => ({ text: line, changed: false }));

  return (
    <View style={styles.draftPreviewCard}>
      {highlightCopilotChanges ? (
        <View style={styles.draftHighlightBanner}>
          <Text style={styles.draftHighlightBannerText}>Light highlight = latest Copilot update. Tap a highlight to compare.</Text>
        </View>
      ) : null}
      <View>
        {lines.map((line, index) => (
          line.changed && onPressHighlightedLine ? (
            <TouchableOpacity
              key={`draft-line-${index}`}
              activeOpacity={0.92}
              onPress={onPressHighlightedLine}
              style={styles.draftHighlightedLine}
            >
              <InteractiveText style={styles.draftPreviewText} selectAllText={displayText}>
                {line.text || " "}
              </InteractiveText>
            </TouchableOpacity>
          ) : (
            <View
              key={`draft-line-${index}`}
              style={line.changed ? styles.draftHighlightedLine : null}
            >
              <InteractiveText style={styles.draftPreviewText} selectAllText={displayText}>
                {line.text || " "}
              </InteractiveText>
            </View>
          )
        ))}
      </View>
    </View>
  );
}

function DocumentChecklistSection({ matter, matterState, onExport = null }) {
  const documentItems = extractMatterDocumentItems(matter, matterState);

  return (
    <SectionBlock kicker="Documents" title="Matter documents and annexures">
      <View style={styles.summaryStack}>
        {documentItems.length ? (
          documentItems.map((item, index) => (
            <SummaryItem key={`document-${index}`} label={`Document ${index + 1}`} value={item} />
          ))
        ) : (
          <SummaryItem label="Documents" value="No supporting documents listed yet." />
        )}
      </View>
      {onExport ? (
        <View style={styles.microActionRowWrap}>
          <MiniAction label="Download Documents" onPress={() => onExport("documents", "download")} />
          <MiniAction label="Share Documents" onPress={() => onExport("documents", "share")} />
        </View>
      ) : null}
    </SectionBlock>
  );
}

function WorkspaceBanner({ kicker, title, subtitle, status }) {
  return (
    <View style={styles.workspaceBanner}>
      <View style={styles.workspaceBannerHead}>
        <View>
          <Text style={styles.workspaceBannerKicker}>{kicker}</Text>
          <Text style={styles.workspaceBannerTitle}>{title}</Text>
        </View>
        {status ? <Pill active>{status}</Pill> : null}
      </View>
      {subtitle ? <InteractiveText style={styles.workspaceBannerSubtitle}>{subtitle}</InteractiveText> : null}
    </View>
  );
}

function SelectableSummaryItem({ label, value, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.selectableCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <InteractiveText style={styles.summaryValue}>{value}</InteractiveText>
      <View style={styles.selectableFooter}>
        <Text style={styles.summaryAction}>Send to Copilot</Text>
        <Text style={styles.selectableArrow}>Open</Text>
      </View>
    </TouchableOpacity>
  );
}

function LegalInsightCard({ label, item, onPress, onDetailPress, actionLabel = "Send to Copilot" }) {
  const insight = normalizeResearchEntry(item, label);
  const Container = onPress ? TouchableOpacity : View;
  const treatmentTone = String(insight.treatmentAlertTone || "").toLowerCase();

  return (
    <Container
      {...(onPress ? { activeOpacity: 0.9, onPress } : {})}
      style={styles.legalInsightCard}
    >
      <View style={styles.legalInsightHead}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <View style={styles.legalInsightBadgeRow}>
          <View
            style={[
              styles.trustBadge,
              insight.trustTone === "high"
                ? styles.trustBadgeHigh
                : insight.trustTone === "medium"
                  ? styles.trustBadgeMedium
                  : insight.trustTone === "review"
                    ? styles.trustBadgeReview
                    : insight.trustTone === "low"
                      ? styles.trustBadgeLow
                      : null
            ]}
          >
            <Text
              style={[
                styles.trustBadgeText,
                insight.trustTone === "high"
                  ? styles.trustBadgeTextHigh
                  : insight.trustTone === "medium"
                    ? styles.trustBadgeTextMedium
                    : insight.trustTone === "review"
                      ? styles.trustBadgeTextReview
                      : insight.trustTone === "low"
                        ? styles.trustBadgeTextLow
                        : null
              ]}
            >
              {insight.trustLabel}
            </Text>
          </View>
          {insight.treatmentAlertLabel ? (
            <View
              style={[
                styles.trustBadge,
                treatmentTone === "positive"
                  ? styles.trustBadgeHigh
                  : treatmentTone === "caution"
                    ? styles.trustBadgeMedium
                    : treatmentTone === "highrisk"
                      ? styles.trustBadgeLow
                      : treatmentTone === "review"
                        ? styles.trustBadgeReview
                        : null
              ]}
            >
              <Text
                style={[
                  styles.trustBadgeText,
                  treatmentTone === "positive"
                    ? styles.trustBadgeTextHigh
                    : treatmentTone === "caution"
                      ? styles.trustBadgeTextMedium
                      : treatmentTone === "highrisk"
                        ? styles.trustBadgeTextLow
                        : treatmentTone === "review"
                          ? styles.trustBadgeTextReview
                          : null
                ]}
              >
                {insight.treatmentAlertLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <InteractiveText style={styles.summaryValue}>{insight.title}</InteractiveText>
      {insight.metaLine ? (
        <InteractiveText style={styles.legalInsightMeta}>{insight.metaLine}</InteractiveText>
      ) : null}
      {insight.proposition ? (
        <View style={styles.legalInsightInset}>
          <Text style={styles.legalInsightInsetLabel}>Proposition</Text>
          <InteractiveText style={styles.legalInsightInsetText}>{insight.proposition}</InteractiveText>
        </View>
      ) : null}
      {insight.whyItMatters ? (
        <InteractiveText style={styles.legalInsightSupport}>Why it matters: {insight.whyItMatters}</InteractiveText>
      ) : null}
      {insight.freshnessLabel ? (
        <InteractiveText style={styles.legalInsightSupport}>
          Freshness: {insight.freshnessLabel}{typeof insight.freshnessDays === "number" ? ` (${insight.freshnessDays}d)` : ""}
        </InteractiveText>
      ) : null}
      {insight.stalenessReason ? (
        <InteractiveText style={styles.legalInsightSupport}>Freshness note: {insight.stalenessReason}</InteractiveText>
      ) : null}
      {insight.treatmentSummary ? (
        <InteractiveText style={styles.legalInsightSupport}>Treatment: {insight.treatmentSummary}</InteractiveText>
      ) : null}
      {insight.treatmentAlertNote ? (
        <InteractiveText style={styles.legalInsightSupport}>Treatment note: {insight.treatmentAlertNote}</InteractiveText>
      ) : null}
      {insight.pinpointRef ? (
        <InteractiveText style={styles.legalInsightSupport}>Pinpoint: {insight.pinpointRef}</InteractiveText>
      ) : null}
      {insight.statutoryReferences.length ? (
        <View style={styles.legalStatutesRow}>
          {insight.statutoryReferences.slice(0, 3).map((item) => (
            <View key={`${label}-${insight.title}-${item}`} style={styles.legalStatuteChip}>
              <Text style={styles.legalStatuteText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.selectableFooter}>
        <Text style={styles.summaryAction}>{onPress ? actionLabel : insight.sourceLine}</Text>
        <View style={styles.inlineFooterActions}>
          {onDetailPress ? (
            <TouchableOpacity activeOpacity={0.85} onPress={onDetailPress} style={styles.inlineFooterLink}>
              <Text style={styles.inlineFooterLinkText}>View Source</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.selectableArrow}>
            {onPress ? "Open" : insight.requiresReview ? "Verify" : "Ready"}
          </Text>
        </View>
      </View>
    </Container>
  );
}

function AuthorityDetailModal({ visible, detail, onClose }) {
  const insight = detail?.insight;

  if (!visible || !insight) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.detailModalOverlay}>
        <TouchableOpacity activeOpacity={1} style={styles.detailModalBackdrop} onPress={onClose} />
        <View style={styles.detailModalSheet}>
          <View style={styles.detailModalHandle} />
          <View style={styles.detailModalHead}>
            <View style={styles.detailModalHeadCopy}>
              <Text style={styles.sectionKicker}>{detail.label || "Authority"}</Text>
              <Text style={styles.detailModalTitle}>{insight.title}</Text>
            </View>
            <TouchableOpacity activeOpacity={0.85} onPress={onClose} style={styles.detailModalClose}>
              <Text style={styles.detailModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.detailModalBody}>
            <View style={styles.legalInsightBadgeRow}>
              <View
                style={[
                  styles.trustBadge,
                  insight.trustTone === "high"
                    ? styles.trustBadgeHigh
                    : insight.trustTone === "medium"
                      ? styles.trustBadgeMedium
                      : insight.trustTone === "review"
                        ? styles.trustBadgeReview
                        : insight.trustTone === "low"
                          ? styles.trustBadgeLow
                          : null
                ]}
              >
                <Text
                  style={[
                    styles.trustBadgeText,
                    insight.trustTone === "high"
                      ? styles.trustBadgeTextHigh
                      : insight.trustTone === "medium"
                        ? styles.trustBadgeTextMedium
                        : insight.trustTone === "review"
                          ? styles.trustBadgeTextReview
                          : insight.trustTone === "low"
                            ? styles.trustBadgeTextLow
                            : null
                  ]}
                >
                  {insight.trustLabel}
                </Text>
              </View>
              {insight.treatmentAlertLabel ? (
                <View
                  style={[
                    styles.trustBadge,
                    insight.treatmentAlertTone === "positive"
                      ? styles.trustBadgeHigh
                      : insight.treatmentAlertTone === "caution"
                        ? styles.trustBadgeMedium
                        : insight.treatmentAlertTone === "highrisk"
                          ? styles.trustBadgeLow
                          : styles.trustBadgeReview
                  ]}
                >
                  <Text
                    style={[
                      styles.trustBadgeText,
                      insight.treatmentAlertTone === "positive"
                        ? styles.trustBadgeTextHigh
                        : insight.treatmentAlertTone === "caution"
                          ? styles.trustBadgeTextMedium
                          : insight.treatmentAlertTone === "highrisk"
                            ? styles.trustBadgeTextLow
                            : styles.trustBadgeTextReview
                    ]}
                  >
                    {insight.treatmentAlertLabel}
                  </Text>
                </View>
              ) : null}
              {insight.freshnessLabel ? (
                <View style={[styles.trustBadge, styles.trustBadgeReview]}>
                  <Text style={[styles.trustBadgeText, styles.trustBadgeTextReview]}>
                    {insight.freshnessLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            {insight.metaLine ? <InteractiveText style={styles.legalInsightMeta}>{insight.metaLine}</InteractiveText> : null}
            {insight.sourceLine ? <InteractiveText style={styles.detailModalMeta}>{insight.sourceLine}</InteractiveText> : null}
            {insight.proposition ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Proposition</Text>
                <InteractiveText style={styles.legalInsightInsetText}>{insight.proposition}</InteractiveText>
              </View>
            ) : null}
            {insight.pinpointRef ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Pinpoint</Text>
                <InteractiveText style={styles.legalInsightInsetText}>{insight.pinpointRef}</InteractiveText>
              </View>
            ) : null}
            {insight.summaryText ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Excerpt / Summary</Text>
                <InteractiveText style={styles.legalInsightInsetText}>{insight.summaryText}</InteractiveText>
              </View>
            ) : null}
            {insight.whyItMatters ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Why it matters</Text>
                <InteractiveText style={styles.legalInsightInsetText}>{insight.whyItMatters}</InteractiveText>
              </View>
            ) : null}
            {insight.statutoryReferences.length ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Statutes</Text>
                <View style={styles.legalStatutesRow}>
                  {insight.statutoryReferences.map((item) => (
                    <View key={`${insight.title}-${item}`} style={styles.legalStatuteChip}>
                      <Text style={styles.legalStatuteText}>{item}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {insight.treatmentSummary ? (
              <View style={styles.detailModalSection}>
                <Text style={styles.legalInsightInsetLabel}>Treatment summary</Text>
                <InteractiveText style={styles.legalInsightInsetText}>{insight.treatmentSummary}</InteractiveText>
              </View>
            ) : null}
            {insight.treatmentAlertNote ? (
              <InteractiveText style={styles.legalInsightSupport}>Treatment note: {insight.treatmentAlertNote}</InteractiveText>
            ) : null}
            {insight.stalenessReason ? (
              <InteractiveText style={styles.legalInsightSupport}>Freshness note: {insight.stalenessReason}</InteractiveText>
            ) : null}
            {insight.reviewPriority ? (
              <InteractiveText style={styles.legalInsightSupport}>Review priority: {insight.reviewPriority}</InteractiveText>
            ) : null}
          </ScrollView>
          <View style={styles.detailModalActions}>
            {detail.primaryAction ? (
              <TouchableOpacity activeOpacity={0.9} onPress={detail.primaryAction} style={[styles.miniAction, styles.miniActionPrimary]}>
                <Text style={[styles.miniActionText, styles.miniActionTextPrimary]}>{detail.primaryLabel || "Use"}</Text>
              </TouchableOpacity>
            ) : null}
            {insight.sourceUrl ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  Linking.openURL(insight.sourceUrl).catch(() => {});
                }}
                style={styles.miniAction}
              >
                <Text style={styles.miniActionText}>Open Source</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity activeOpacity={0.9} onPress={onClose} style={styles.miniAction}>
              <Text style={styles.miniActionText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildPriorityBanner({ readiness = null, trustSnapshot = null, liveResearch = null } = {}) {
  const reviewState = String(trustSnapshot?.reviewState || "").toLowerCase();
  const freshnessState = String(trustSnapshot?.freshnessState || "").toLowerCase();
  const treatmentState = String(trustSnapshot?.treatmentState || "").toLowerCase();
  const sourceCoverage = String(trustSnapshot?.sourceCoverage || "").toLowerCase();

  if (readiness?.flaggedAuthorities || readiness?.treatmentWarnings || /high-risk|manual review/.test(reviewState) || /treatment caution/.test(treatmentState)) {
    return {
      tone: "risk",
      title: "High-risk authority review",
      note: "At least one selected authority needs treatment or manual review before you rely on it in the draft or filing pack."
    };
  }
  if (readiness?.staleAuthorities || /older|legacy|stale/.test(freshnessState)) {
    return {
      tone: "warning",
      title: "Freshness verification needed",
      note: "Current legal support includes older authorities. Re-check latest treatment and updates before final filing."
    };
  }
  if (readiness?.reviewPriority === "Priority review" || /partial|verify/.test(reviewState) || /seeded|fallback/.test(sourceCoverage) || liveResearch?.status === "error") {
    return {
      tone: "review",
      title: "Verify before filing",
      note: "Research is usable, but final filing should wait until authority support and current source coverage are checked."
    };
  }
  return {
    tone: "good",
    title: "Grounded support ready",
    note: "Selected authorities look usable for drafting. Still verify pinpoint use before filing."
  };
}

function buildFilingDecision(readiness, currentRole = "lawyer") {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const researchReady = readiness.authorityCount > 0 || readiness.citationCount > 0;
  const draftReady = !isPlaceholderValue(readiness.draftStatus);
  const validationReady =
    !isPlaceholderValue(readiness.validationStatus) &&
    !readiness.unsupportedCount &&
    !readiness.flaggedAuthorities;
  const filingReady =
    readiness.readinessScore >= 80 &&
    readiness.reviewPriority === "Final review" &&
    !readiness.unsupportedCount &&
    !readiness.staleAuthorities &&
    !readiness.matterSpecificPending;

  const reasons = [
    readiness.unsupportedCount
      ? `${readiness.unsupportedCount} unsupported draft point(s) still need grounding.`
      : null,
    readiness.matterSpecificPending
      ? `${readiness.matterSpecificPending} matter-specific legal check(s) are still pending.`
      : null,
    readiness.flaggedAuthorities
      ? `${readiness.flaggedAuthorities} authority item(s) still require manual review.`
      : null,
    readiness.staleAuthorities
      ? `${readiness.staleAuthorities} authority item(s) need freshness verification.`
      : null,
    !draftReady ? "Working draft still needs a stronger filing-ready version." : null
  ].filter(Boolean).slice(0, 3);

  let title = isSenior
    ? "Ready for final review"
    : isFirm
      ? "Ready for oversight review"
      : "Ready for final review";
  let note = "Research, draft, and validation signals look strong enough for a final legal pass.";
  let tone = "good";

  if (readiness.unsupportedCount || readiness.matterSpecificPending || !draftReady) {
    title = isSenior ? "Not ready for approval" : isFirm ? "Not ready for final filing" : "Not ready to file";
    note = reasons[0] || readiness.readinessNote;
    tone = "risk";
  } else if (readiness.flaggedAuthorities || readiness.staleAuthorities || readiness.reviewPriority === "Priority review") {
    title = isSenior ? "Review before approval" : "Review before filing";
    note = reasons[0] || readiness.readinessNote;
    tone = "warning";
  }

  return {
    title,
    note,
    tone,
    reasons,
    score: readiness.readinessScore,
    openIssues:
      readiness.unsupportedCount +
      readiness.matterSpecificPending +
      readiness.flaggedAuthorities +
      readiness.staleAuthorities,
    actionLabel: tone === "good" ? null : "Fix now in Copilot",
    actionPrompt:
      readiness.unsupportedDraftExcerpts?.[0] ||
      readiness.unsupportedPoints?.[0] ||
      readiness.readinessNote,
    progress: [
      { label: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", ready: researchReady },
      { label: isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft", ready: draftReady },
      { label: "Validation", ready: validationReady },
      { label: isSenior ? "Approval" : isFirm ? "Filing" : "Filing", ready: filingReady }
    ]
  };
}

function mapScreenToBottomTab(screen) {
  if (screen === "home") return "home";
  if (["cases", "workspace", "profile", "details", "summary", "archived", "clients", "notes"].includes(screen)) {
    return "cases";
  }
  if (["research", "draft", "tools", "tool-workspace"].includes(screen)) {
    return "research";
  }
  if (screen === "copilot") return "copilot";
  return "home";
}

function TrustPriorityBanner({ title, note, tone = "review" }) {
  return (
    <View
      style={[
        styles.priorityBanner,
        tone === "risk"
          ? styles.priorityBannerRisk
          : tone === "warning"
            ? styles.priorityBannerWarning
            : tone === "good"
              ? styles.priorityBannerGood
              : styles.priorityBannerReview
      ]}
    >
      <Text
        style={[
          styles.priorityBannerTitle,
          tone === "risk"
            ? styles.priorityBannerTitleRisk
            : tone === "warning"
              ? styles.priorityBannerTitleWarning
              : tone === "good"
                ? styles.priorityBannerTitleGood
                : styles.priorityBannerTitleReview
        ]}
      >
        {title}
      </Text>
      <InteractiveText
        style={[
          styles.priorityBannerNote,
          tone === "risk"
            ? styles.priorityBannerNoteRisk
            : tone === "warning"
              ? styles.priorityBannerNoteWarning
              : tone === "good"
                ? styles.priorityBannerNoteGood
                : styles.priorityBannerNoteReview
        ]}
      >
        {note}
      </InteractiveText>
    </View>
  );
}

function FilingDecisionCard({ decision, onActionPress }) {
  return (
    <View
      style={[
        styles.decisionCard,
        decision.tone === "risk"
          ? styles.decisionCardRisk
          : decision.tone === "warning"
            ? styles.decisionCardWarning
            : styles.decisionCardGood
      ]}
    >
      <Text style={styles.decisionCardKicker}>File decision</Text>
      <Text style={styles.decisionCardTitle}>{decision.title}</Text>
      <InteractiveText style={styles.decisionCardNote}>{decision.note}</InteractiveText>
      <View style={styles.decisionMetaRow}>
        <View style={styles.decisionMetaCard}>
          <Text style={styles.decisionMetaLabel}>Readiness</Text>
          <Text style={styles.decisionMetaValue}>{decision.score}%</Text>
        </View>
        <View style={styles.decisionMetaCard}>
          <Text style={styles.decisionMetaLabel}>Issues to fix</Text>
          <Text style={styles.decisionMetaValue}>{decision.openIssues}</Text>
        </View>
      </View>
      {decision.reasons.length ? (
        <View style={styles.decisionReasons}>
          {decision.reasons.map((reason, index) => (
            <View key={`${reason}-${index}`} style={styles.decisionReasonRow}>
              <Text style={styles.decisionReasonDot}>-</Text>
              <InteractiveText style={styles.decisionReasonText}>{reason}</InteractiveText>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.decisionProgressRow}>
        {decision.progress.map((item) => (
          <View
            key={item.label}
            style={[
              styles.decisionProgressChip,
              item.ready ? styles.decisionProgressChipReady : styles.decisionProgressChipPending
            ]}
          >
            <Text
              style={[
                styles.decisionProgressLabel,
                item.ready ? styles.decisionProgressLabelReady : styles.decisionProgressLabelPending
              ]}
            >
              {item.ready ? "OK" : "Review"} {item.label}
            </Text>
          </View>
        ))}
      </View>
      {decision.actionLabel && onActionPress ? (
        <View style={styles.decisionActionRow}>
          <TouchableOpacity activeOpacity={0.9} onPress={onActionPress} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>{decision.actionLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function MiniAction({ label, onPress, primary = false }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.miniAction, primary ? styles.miniActionPrimary : null]}
    >
      <Text style={[styles.miniActionText, primary ? styles.miniActionTextPrimary : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PromptChip({ label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.promptChip}>
      <Text style={styles.promptChipText}>{label}</Text>
    </TouchableOpacity>
  );
}

function DrawerHandle({ open, onPress, label = "Actions" }) {
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={styles.drawerHandleWrap}>
      <View style={styles.drawerHandleBar} />
      <Text style={styles.drawerHandleText}>{open ? `Hide ${label}` : `${label}`}</Text>
    </TouchableOpacity>
  );
}

function BottomDrawer({ open, title, actions, onToggle, onActionPress }) {
  return (
    <View pointerEvents="box-none" style={styles.drawerRoot}>
      {open ? <TouchableOpacity activeOpacity={1} onPress={onToggle} style={styles.drawerBackdrop} /> : null}
      <View style={[styles.drawerSheet, open ? styles.drawerSheetOpen : null]}>
        <DrawerHandle open={open} onPress={onToggle} label={title} />
        {open ? (
          <View style={styles.drawerContent}>
            <Text style={styles.drawerTitle}>{title}</Text>
            <View style={styles.drawerActions}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.id}
                  activeOpacity={0.92}
                  onPress={() => onActionPress(action)}
                  style={[styles.drawerActionChip, action.primary ? styles.drawerActionChipPrimary : null]}
                >
                  <Text
                    style={[
                      styles.drawerActionTitle,
                      action.primary ? styles.drawerActionTitlePrimary : null
                    ]}
                  >
                    {action.title}
                  </Text>
                  <Text style={styles.drawerActionSubtitle}>{action.subtitle}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function buildCaseActionSteps(matter) {
  const typeText = String(matter?.caseDetails?.type || "").toLowerCase();

  if (/cheque|bounce|138|negotiable/.test(typeText)) {
    return [
      "Cheque copy mariyu bank return memo ready ga pettukondi.",
      "Legal notice copy mariyu postal proof ready ga pettukondi.",
      "Complaint file cheyyadaniki drawer/signatory details correct ga unnayo check cheyyandi."
    ];
  }

  if (/injunction|property|possession/.test(typeText)) {
    return [
      "Property documents, tax receipts, mariyu possession proof ready ga pettukondi.",
      "Mee possession ni disturb chestunnaru ani clear ga explain cheyyandi.",
      "Court nundi urgent temporary protection kavali ani request cheyyali."
    ];
  }

  if (/consumer|refund|service/.test(typeText)) {
    return [
      "Payment proof, invoices, mariyu chats ready ga pettukondi.",
      "Goods/service ivvaledu ani date-wise record pettukondi.",
      "Refund plus interest/compensation korukuntunnaru ani clear ga prepare cheyyandi."
    ];
  }

  return [
    "Facts ni clear ga okasari arrange cheyyandi.",
    "Supporting documents anni okka place lo pettukondi.",
    "Filing mundu final review cheyyandi."
  ];
}

function buildCaseRiskNote(matter) {
  const typeText = String(matter?.caseDetails?.type || "").toLowerCase();

  if (/cheque|bounce|138|negotiable/.test(typeText)) {
    return "Main check: notice time lo pampinchara, bank memo unda, correct court lo file chesthunara ani verify cheyyali.";
  }

  if (/injunction|property|possession/.test(typeText)) {
    return "Main check: possession proof strong ga undali mariyu urgent loss enduku avutundo clear ga chupinchali.";
  }

  if (/consumer|refund|service/.test(typeText)) {
    return "Main check: payment proof mariyu non-supply chronology clear ga undali.";
  }

  return "Main check: final filing mundu matter details ni once verify cheyyali.";
}

function buildCaseSummaryReply(matter, promptText) {
  const wantsTelugu = isTeluguPrompt(promptText);
  const lower = String(promptText || "").toLowerCase();
  const simpleMode = /lawyer ni kadu|not a lawyer|layman|simple|clear ga|step by step|ardham|ardham kale|naaku teliyadu|naku em teliyadu/.test(lower);
  const ultraSimpleMode = /ardham kale|clear ga|brief ga|inka simple ga|very simple|sulli ga/.test(lower);
  const steps = buildCaseActionSteps(matter);
  const documents = isPlaceholderValue(matter?.caseDetails?.documents) ? "" : matter.caseDetails.documents;
  const riskNote = buildCaseRiskNote(matter);

  if (wantsTelugu || simpleMode) {
    if (ultraSimpleMode) {
      return [
        `${matter.title} ante simple ga: ${matter.caseDetails.facts}.`,
        `Ippudu meeru cheyyalsindi: 1. ${steps[0] || "Documents ready ga pettukondi."} 2. ${steps[1] || "Important proof ready ga pettukondi."} 3. ${steps[2] || "Court file mundu final check cheyyandi."}`,
        documents ? `Mee documents: ${documents}.` : "",
        riskNote
      ].filter(Boolean).join(" ");
    }

    return [
      `${matter.title} simple ga: ${matter.caseDetails.facts}.`,
      steps.length
        ? `Step by step next actions: ${steps.map((item, index) => `${index + 1}. ${item}`).join(" ")}`
        : "Step by step next actions: 1. Facts verify cheyyi. 2. Documents arrange cheyyi. 3. Filing mundu final review cheyyi.",
      documents ? `Mee daggara useful documents: ${documents}.` : "",
      riskNote
    ].filter(Boolean).join(" ");
  }

  return [
    `${matter.title} in simple terms: ${matter.caseDetails.facts}.`,
    steps.length
      ? `Next steps: ${steps.map((item, index) => `${index + 1}. ${item}`).join(" ")}`
      : "Next steps: 1. verify the facts, 2. organise the documents, 3. review before filing.",
    documents ? `Useful documents already noted: ${documents}.` : "",
    `Main check before filing: ${riskNote}`
  ].filter(Boolean).join(" ");
}

function buildMinimalDirectReply(matter, matterState, promptText) {
  const request = resolveCopilotRequest(promptText);
  const wantsTelugu = isTeluguPrompt(promptText);

  if (request.intent === "smalltalk") {
    return wantsTelugu
      ? `Hi. ${matter.title} matter lo meeku em doubt undo direct ga cheppandi, nenu simple ga answer isthanu.`
      : `Hi. Tell me what you need in the ${matter.title} matter and I will answer directly.`;
  }

  if (request.intent === "support") {
    return buildSupportReply(matter, matterState, promptText);
  }

  if (request.intent === "draft") {
    return buildDraftGuidanceReply(matter, matterState, promptText);
  }

  if (request.intent === "explain") {
    return buildCaseSummaryReply(matter, promptText);
  }

  return wantsTelugu
    ? "Mee doubt ni direct ga cheppandi. Mundu answer isthanu; tarvata avasaram unte draft, research, leda next step lo help chestanu."
    : "Tell me your question directly. I will answer first, then help with draft, research, or next steps if needed.";
}

function buildSupportReply(matter, matterState, promptText) {
  const wantsTelugu = isTeluguPrompt(promptText);
  const authorities = getAuthorityEntries(matter, matterState).slice(0, 2);
  const citations = getCitationEntries(matter, matterState).slice(0, 2);

  if (!authorities.length && !citations.length) {
    return wantsTelugu
      ? "Ee matter ki inka usable judgments leda citations link kaaledu. Kavali ante nenu next ga em research focus kavalo clear ga cheptha."
      : "No judgments or citations are loaded for this matter yet.";
  }

  const authorityLine = authorities.length
    ? authorities
        .map((item) => {
          const normalized = normalizeResearchEntry(item, "Authority");
          return `${normalized.title}${normalized.proposition ? ` - ${normalized.proposition}` : ""}${normalized.pinpointRef ? ` (${normalized.pinpointRef})` : ""}`;
        })
        .join(" | ")
    : "";
  const citationLine = citations.length
    ? citations
        .map((item) => {
          const normalized = normalizeResearchEntry(item, "Citation");
          return `${normalized.title}${normalized.proposition ? ` - ${normalized.proposition}` : ""}${normalized.pinpointRef ? ` (${normalized.pinpointRef})` : ""}`;
        })
        .join(" | ")
    : "";

  return wantsTelugu
    ? [
        authorityLine ? `Current judgments: ${authorityLine}.` : "",
        citationLine ? `Current citations: ${citationLine}.` : "",
        "Ivanni ippudu ee matter ki available legal support."
      ].filter(Boolean).join(" ")
    : [
        authorityLine ? `Current judgments: ${authorityLine}.` : "",
        citationLine ? `Current citations: ${citationLine}.` : "",
        "These are the legal support items currently linked to the matter."
      ].filter(Boolean).join(" ");
}

function buildDraftGuidanceReply(matter, matterState, promptText) {
  const wantsTelugu = isTeluguPrompt(promptText);
  const leadValues = getResearchLeadValues(matter, matterState);
  const focusSupport = buildFocusSupportLine(matterState?.lastResearchFocus);

  return wantsTelugu
    ? [
        `Nenu ardham chesukunna main draft focus: ${leadValues.issue}.`,
        `Current facts: ${matter.caseDetails.facts}.`,
        `Best line of argument: ${leadValues.argument}.`,
        focusSupport ? `Useful support: ${focusSupport}.` : ""
      ].filter(Boolean).join(" ")
    : [
        `Main draft focus: ${leadValues.issue}.`,
        `Current facts: ${matter.caseDetails.facts}.`,
        `Best argument to surface: ${leadValues.argument}.`,
        focusSupport ? `Selected support: ${focusSupport}.` : ""
      ].filter(Boolean).join(" ");
}

function buildCopilotReply(matter, matterState, promptText) {
  return buildMinimalDirectReply(matter, matterState, promptText);
}

function buildDraftPatch(matter, matterState, promptText) {
  const leadValues = getResearchLeadValues(matter, matterState);
  const focus = matterState?.lastResearchFocus;
  const statutes = focus?.insight?.statutoryReferences?.length
    ? focus.insight.statutoryReferences.slice(0, 2).join(", ")
    : "";
  const proposition = focus?.insight?.proposition || "";
  const pinpoint = focus?.insight?.pinpointRef || "";
  const authorityTitle = focus?.value || leadValues.authority;
  const sourceMeta = [focus?.insight?.metaLine, focus?.insight?.sourceLine].filter(Boolean).join(" | ");
  const wantsTelugu = /[\u0C00-\u0C7F]|telugu|cheyyu|cheppu|vivarinchu|ardham/i.test(promptText);

  if (wantsTelugu) {
    return [
      `Proposed draft insertion for ${matter.title}:`,
      `Ee pleading lo ${authorityTitle} ni direct ga link cheyyandi.`,
      proposition ? `Use cheyyalsina proposition: ${proposition}.` : "",
      statutes ? `Relevant statutory support: ${statutes}.` : "",
      pinpoint ? `Pinpoint reference verify chesi add cheyyandi: ${pinpoint}.` : "",
      `Lawyer instruction: ${promptText}.`,
      sourceMeta ? `Source trail: ${sourceMeta}.` : ""
    ].filter(Boolean).join(" ");
  }

  return [
    `Proposed draft insertion for ${matter.title}:`,
    `Tie the pleading directly to ${authorityTitle}.`,
    proposition ? `Use this proposition: ${proposition}.` : "",
    statutes ? `Statutory support: ${statutes}.` : "",
    pinpoint ? `Verify and cite this pinpoint: ${pinpoint}.` : "",
    `Lawyer instruction: ${promptText}.`,
    sourceMeta ? `Source trail: ${sourceMeta}.` : ""
  ].filter(Boolean).join(" ");
}

function buildMatterSuggestions(matter, matterState, promptText) {
  return [];
}

function buildGeneralCopilotReply(promptText) {
  const wantsTelugu = isTeluguPrompt(promptText);
  const intent = resolveCopilotRequest(promptText).intent;
  if (intent === "smalltalk") {
    return wantsTelugu
      ? "Hi. Mee doubt direct ga cheppandi, nenu simple ga answer isthanu."
      : "Hi. Tell me your question directly and I will answer simply.";
  }

  if (intent === "support") {
    return wantsTelugu
      ? "Specific matter open unte current judgments, citations, mariyu useful legal support ni direct ga explain chestanu."
      : "Open a specific matter and I will show the current judgments, citations, and legal support.";
  }

  return wantsTelugu
    ? "Mee request ni natural ga cheppandi. Nenu mundu answer isthanu; tarvata avasaram unte draft, research, leda next steps lo help chestanu."
    : "Say your request naturally. I will answer first, then help with draft, research, or next steps if needed.";
}

function formatDraftDisplayText(value) {
  const rawText = String(value || "").replace(/\r/g, "");
  if (!rawText.trim()) {
    return "Draft not generated yet.";
  }

  const cleaned = rawText
    .split("\n")
    .map((line) => {
      let next = line
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^#{1,6}\s*/, "")
        .trimEnd();

      if (/^---+$/.test(next.trim())) {
        return "";
      }

      if (/^"(.*)"$/.test(next.trim())) {
        next = next.trim().slice(1, -1);
      }

      return next;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || "Draft not generated yet.";
}

function extractDraftLikeTextFromReply(value) {
  const rawText = String(value || "").replace(/\r/g, "").trim();
  if (!rawText) {
    return "";
  }

  const withoutSupportTail = rawText
    .replace(/\n+Based on\s*\n[\s\S]*$/i, "")
    .replace(/\n+Loaded source\s*\n[\s\S]*$/i, "")
    .trim();
  const lines = withoutSupportTail.split("\n");
  const startPatterns = [
    /^\s*(?:#{1,6}\s*)?IN THE COURT\b/i,
    /^\s*(?:#{1,6}\s*)?O\.S\.\s*No\./i,
    /^\s*(?:#{1,6}\s*)?C\.C\.\s*No\./i,
    /^\s*(?:#{1,6}\s*)?(?:COMPLAINT|PETITION|APPLICATION|AFFIDAVIT|LEGAL NOTICE|NOTICE)\b/i,
    /^\s*(?:#{1,6}\s*)?\*\*IN THE COURT\b/i,
    /^\s*(?:#{1,6}\s*)?\*\*(?:COMPLAINT|PETITION|APPLICATION|AFFIDAVIT|LEGAL NOTICE|NOTICE)\b/i
  ];
  const startIndex = lines.findIndex((line) => startPatterns.some((pattern) => pattern.test(String(line || "").trim())));
  const candidate = (startIndex >= 0 ? lines.slice(startIndex) : lines).join("\n").trim();

  if (!candidate) {
    return "";
  }

  const sectionMarkers = [
    /parties and addresses/i,
    /facts of the case/i,
    /cause of action/i,
    /grounds for relief/i,
    /prayer/i,
    /verification/i,
    /schedule of property/i,
    /jurisdiction and valuation/i,
    /list of documents/i,
    /nature of the suit/i
  ];
  const markerCount = sectionMarkers.filter((pattern) => pattern.test(candidate)).length;
  const hasCourtHeading = /in the court/i.test(candidate);
  const hasDocumentSignals = /(complaint|petition|affidavit|legal notice|suit for permanent injunction|under section)/i.test(candidate);

  if ((hasCourtHeading && markerCount >= 2) || markerCount >= 4 || (hasDocumentSignals && markerCount >= 3)) {
    return candidate;
  }

  return "";
}

function extractChatDraftUpdate(response, replyText, options = {}) {
  if (!options.allowDraftSync) {
    return "";
  }

  const structuredDraft = String(
    response?.document?.content
      || response?.memory?.workspaceDraft
      || ""
  ).trim();

  if (structuredDraft) {
    return structuredDraft;
  }

  return extractDraftLikeTextFromReply(replyText);
}

function extractMatterDocumentItems(matter, matterState) {
  const rawDocuments = String(matter?.caseDetails?.documents || "")
    .replace(/\r/g, "\n")
    .split(/\n|,(?=(?:[^()]*\([^()]*\))*[^()]*$)|;/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .filter(
      (item) =>
        !/^(name|relation|location|property details|survey no|extent|village|defendant details|client details|court|case type|facts|issue)\s*:/i.test(
          item
        )
    );
  const attachmentDocuments = Array.isArray(matterState?.attachments)
    ? matterState.attachments
        .map((item) => String(item?.name || item?.uri || "").trim())
        .filter(Boolean)
    : [];

  return [...new Set([...rawDocuments, ...attachmentDocuments])];
}

function formatValidationList(items = [], fallback = "- None") {
  return Array.isArray(items) && items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function buildExportPacket(type, matter, matterState) {
  const draftText = formatDraftDisplayText(matterState?.currentDraft ?? buildInitialMatterState(matter).currentDraft);
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const validationStatus = readiness.validationStatus;
  const filingStatus = readiness.filingStatus;
  const draftStatus = readiness.draftStatus;
  const latestHistory = matterState?.draftHistory?.[0];
  const latestSupportEntries = latestHistory?.patchMeta?.supportEntries || buildSupportEntries(matter, matterState);
  const validationReport = matterState?.validationReport || null;
  const authorityEntries = getAuthorityEntries(matter, matterState);
  const citationEntries = getCitationEntries(matter, matterState);
  const issueLines = (matter.research.issues ?? []).map((item) => `- ${getResearchEntryText(item)}`).join("\n") || "- No issues recorded";
  const authorityLines = (authorityEntries ?? []).map((item) => `- ${getResearchEntryText(item)}`).join("\n") || "- No authorities recorded";
  const citationLines = (citationEntries ?? []).map((item) => `- ${getResearchEntryText(item)}`).join("\n") || "- No citations recorded";
  const argumentLines = (matter.research.arguments ?? []).map((item) => `- ${getResearchEntryText(item)}`).join("\n") || "- No arguments recorded";
  const supportLines = latestSupportEntries.length
    ? latestSupportEntries
        .map((entry) => {
          const bits = [entry.title];
          if (entry.proposition) bits.push(`Proposition: ${entry.proposition}`);
          if (entry.pinpointRef) bits.push(`Pinpoint: ${entry.pinpointRef}`);
          if (entry.sourceLine) bits.push(entry.sourceLine);
          return `- ${bits.join(" | ")}`;
        })
        .join("\n")
    : "- No explicit source grounding recorded";
  const unsupportedLines = readiness.unsupportedPoints?.length
    ? readiness.unsupportedPoints.map((item) => `- ${item}`).join("\n")
    : "- No unsupported draft points flagged";
  const unsupportedExcerptLines = readiness.unsupportedDraftExcerpts?.length
    ? readiness.unsupportedDraftExcerpts.map((item) => `- ${item}`).join("\n")
    : "- No unsupported draft excerpts flagged";
  const documentLines = extractMatterDocumentItems(matter, matterState).length
    ? extractMatterDocumentItems(matter, matterState).map((item) => `- ${item}`).join("\n")
    : "- No supporting documents listed yet";
  const validationDetails = validationReport
    ? [
        `VALIDATION STATUS LABEL`,
        validationReport.statusLabel || validationReport.status || "Completed",
        "",
        `DRAFT SCORE`,
        validationReport.score != null ? `${validationReport.score}%` : "Not scored",
        "",
        `CRITICAL ERRORS`,
        formatValidationList(validationReport.criticalErrors, "- No critical errors"),
        "",
        `WARNINGS`,
        formatValidationList(validationReport.warnings, "- No warnings"),
        "",
        `PASSED CHECKS`,
        formatValidationList(validationReport.passedChecks, "- No passed checks recorded"),
        "",
        `SUGGESTIONS`,
        formatValidationList(validationReport.suggestions || validationReport.suggestedFixes, "- No suggestions")
      ].join("\n")
    : "No backend validation report saved yet.";

  const baseHeader = [
    `Case: ${matter.title}`,
    `Client: ${matter.client}`,
    `Matter Type: ${matter.caseDetails.type}`,
    `Court: ${matter.caseDetails.court}`,
    `Stage: ${matter.stage}`,
    `Status: ${matter.status}`
  ].join("\n");

  const sections = {
    draft: `DRAFT PACK\n\n${baseHeader}\nDraft Status: ${draftStatus}\n\nSUPPORTING DOCUMENTS\n${documentLines}\n\nSUPPORTED BY\n${supportLines}\n\nPLEADING TEXT\n${draftText}`,
    share: `CASE SHARE PACK\n\n${baseHeader}\nDraft Status: ${draftStatus}\nValidation: ${validationStatus}\nFiling Pack: ${filingStatus}\nReadiness: ${readiness.readinessLabel}\nReadiness Score: ${readiness.readinessScore}/100\nReview Priority: ${readiness.reviewPriority}\n\nSUPPORTING DOCUMENTS\n${documentLines}\n\nSUPPORTED BY\n${supportLines}\n\nPLEADING TEXT\n${draftText}`,
    validation: `VALIDATION REPORT\n\n${baseHeader}\nDraft Status: ${draftStatus}\nValidation: ${validationStatus}\nReadiness: ${readiness.readinessLabel}\nReadiness Score: ${readiness.readinessScore}/100\nReview Priority: ${readiness.reviewPriority}\n\n${validationDetails}\n\nCHECKLIST\n- ${readiness.checklist.join("\n- ")}\n\nUNSUPPORTED / REVIEW-REQUIRED POINTS\n${unsupportedLines}\n\nUNSUPPORTED DRAFT EXCERPTS\n${unsupportedExcerptLines}\n\nMATTER-SPECIFIC LEGAL CHECKS\n- ${readiness.matterSpecificChecks.map((item) => `${item.label}: ${item.text}`).join("\n- ")}\n\nGENERAL REVIEW\n- Review facts against current pleadings\n- Re-check authorities before filing\n- Confirm client instructions and reliefs\n- Confirm annexures and chronology`,
    filing: `FILING PACK\n\n${baseHeader}\nDraft Status: ${draftStatus}\nValidation: ${validationStatus}\nFiling Pack: ${filingStatus}\nReadiness: ${readiness.readinessLabel}\nReadiness Score: ${readiness.readinessScore}/100\nReview Priority: ${readiness.reviewPriority}\n\nSUPPORTING DOCUMENTS\n${documentLines}\n\nUNSUPPORTED / REVIEW-REQUIRED POINTS\n${unsupportedLines}\n\nUNSUPPORTED DRAFT EXCERPTS\n${unsupportedExcerptLines}\n\nFILING NOTES\n- Next hearing / schedule: ${matter.caseDetails.nextDate}\n- Client note: ${matter.profile.note}\n- Authority support: ${readiness.authorityCount}\n- Citation support: ${readiness.citationCount}\n- Matter-specific pending checks: ${readiness.matterSpecificPending}`,
    documents: `DOCUMENT PACK\n\n${baseHeader}\n\nSUPPORTING DOCUMENTS\n${documentLines}\n\nCORE FACTS\n${matter.caseDetails.facts}`,
    arguments: `ARGUMENTS PACK\n\n${baseHeader}\n\nISSUES\n${issueLines}\n\nARGUMENTS\n${argumentLines}\n\nAUTHORITIES\n${authorityLines}\n\nCITATIONS\n${citationLines}`,
    summary: `CASE SUMMARY\n\n${baseHeader}\nDraft Status: ${draftStatus}\nValidation: ${validationStatus}\nFiling Pack: ${filingStatus}\nReadiness: ${readiness.readinessLabel}\nReadiness Score: ${readiness.readinessScore}/100\nReview Priority: ${readiness.reviewPriority}\nReadiness Note: ${readiness.readinessNote}\n\nSUPPORTING DOCUMENTS\n${documentLines}\n\nSUPPORTED BY\n${supportLines}\n\nUNSUPPORTED / REVIEW-REQUIRED POINTS\n${unsupportedLines}\n\nUNSUPPORTED DRAFT EXCERPTS\n${unsupportedExcerptLines}\n\nCORE FACTS\n${matter.caseDetails.facts}\n\nMATTER-SPECIFIC LEGAL CHECKS\n- ${readiness.matterSpecificChecks.map((item) => `${item.label}: ${item.text}`).join("\n- ")}\n\nLATEST DRAFT CHANGE\n${latestHistory?.patch || "No draft changes applied yet."}`
  };

  return sections[type] ?? `CASE SUMMARY\n\n${baseHeader}`;
}

function buildInitialMatterState(matter) {
  const persistedWorkspace = matter?.workspaceState && typeof matter.workspaceState === "object"
    ? matter.workspaceState
    : {};
  const leadValues = getResearchLeadValues(matter, null);
  return {
    draftStatus: persistedWorkspace.draftStatus || matter.finalSummary.draftStatus,
    validation: persistedWorkspace.validation || matter.finalSummary.validation,
    filingPack: persistedWorkspace.filingPack || matter.finalSummary.filingPack,
    currentDraft: persistedWorkspace.currentDraft || `${matter.title}\n\nClient: ${matter.client}\n\nCore facts: ${matter.caseDetails.facts}\n\nPrimary legal support: ${leadValues.authority || "To be added"}.\n\nDraft note: Initial AI draft prepared from raw matter details.`,
    draftHistory: Array.isArray(persistedWorkspace.draftHistory) ? persistedWorkspace.draftHistory : [],
    copilotPrompt: "",
    suggestedPatch: "",
    suggestedPatchMeta: null,
    copilotSessionId: "",
    copilotSyncStatus: "idle",
    pendingCopilotAction: null,
    validationReport: persistedWorkspace.validationReport || null,
    filingChecklist: Array.isArray(persistedWorkspace.filingChecklist) ? persistedWorkspace.filingChecklist : [],
    lastResearchFocus: null,
    attachments: [],
    savedNotes: Array.isArray(persistedWorkspace.savedNotes) ? persistedWorkspace.savedNotes : [],
    lastOpenedAt: persistedWorkspace.lastOpenedAt || null,
    liveResearch: {
      status: "idle",
      judgments: [],
      fetchedSources: [],
      sourceMode: "cache",
      query: "",
      fetchedAt: null
    },
    chatMessages: [
      {
        role: "assistant",
        text: `Copilot is ready for ${matter.title}. I will use case details, research, draft, validation, and filing status to guide this matter until filing. Ask what is missing, what to fix, or what to do next.`
        }
      ]
    };
  }

function sanitizeMatterStates(rawMatterStates = {}, mattersList = []) {
  const nextState = { ...(rawMatterStates || {}) };

  mattersList.forEach((matter) => {
    const existing = nextState[matter.id];
    if (!existing) return;
    nextState[matter.id] = {
      ...existing,
      chatMessages: sanitizeCopilotMessages(
        existing.chatMessages,
        buildInitialMatterState(matter).chatMessages
      )
    };
  });

  return nextState;
}

function HomeScreen({ currentRole, activeMatter, activeMatterState, recentMatters = [], mattersCount, clientsCount, notesCount, archivedCount, onOpenSection, onQuickOpenMatter, onOpenRecentMatter }) {
  const roleConfig = roleConfigs[currentRole] ?? roleConfigs.lawyer;
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const readiness = activeMatter ? buildMatterReadinessSnapshot(activeMatter, activeMatterState) : null;
  const homeApps = [
    ...(activeMatter ? getLauncherAppsForRole(currentRole).filter((item) => item.id !== "summary") : getLauncherAppsForRole(currentRole)),
    ...extraLauncherApps.filter((item) => ["tools", "help"].includes(item.id))
  ];
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.mobileHeaderCard}>
        <View style={styles.mobileHeaderRow}>
          <View>
            <Text style={styles.mobileHeaderEyebrow}>Law Assistant</Text>
            <Text style={styles.mobileHeaderTitle}>{roleConfig.heroTitle}</Text>
          </View>
          <View style={styles.mobileStatusDot} />
        </View>
        <InteractiveText style={styles.mobileHeaderSubtitle}>
          {roleConfig.heroSubtitle}
        </InteractiveText>
      </View>

      {!activeMatter ? (
        <SectionBlock kicker="Start here" title="How this app works">
          <View style={styles.workspaceInsightCard}>
            <Text style={styles.workspaceInsightTitle}>Simple first step</Text>
            <InteractiveText style={styles.workspaceInsightText}>
              Start with `Cases`, choose or create a matter, review `Research`, improve it in `Copilot`, and finish in `Final Summary`.
            </InteractiveText>
            <View style={styles.microActionRow}>
              <MiniAction label="Open Cases" primary onPress={() => onOpenSection("cases")} />
              <MiniAction label="Open Tools" onPress={() => onOpenSection("tools")} />
              <MiniAction label="Help" onPress={() => onOpenSection("help")} />
            </View>
          </View>
        </SectionBlock>
      ) : null}

      <SectionBlock
        kicker="Home"
        title={activeMatter ? roleConfig.focusTitle : roleConfig.homeTitle}
        rightNode={<Pill>{activeMatter ? activeMatter.title : "Select case"}</Pill>}
      >
        <View style={styles.homeStatsRow}>
          <View style={styles.homeStatPill}>
            <Text style={styles.homeStatLabel}>Cases</Text>
            <Text style={styles.homeStatValue}>{mattersCount}</Text>
          </View>
          <View style={styles.homeStatPill}>
            <Text style={styles.homeStatLabel}>Clients</Text>
            <Text style={styles.homeStatValue}>{clientsCount}</Text>
          </View>
          <View style={styles.homeStatPill}>
            <Text style={styles.homeStatLabel}>Notes</Text>
            <Text style={styles.homeStatValue}>{notesCount}</Text>
          </View>
          <View style={styles.homeStatPill}>
            <Text style={styles.homeStatLabel}>Archived</Text>
            <Text style={styles.homeStatValue}>{archivedCount}</Text>
          </View>
        </View>
        <View style={styles.grid}>
          {homeApps.map((item) => (
            <AppCard
              key={item.id}
              title={item.title}
              subtitle={item.subtitle}
              onPress={() => onOpenSection(item.id)}
            />
          ))}
        </View>
      </SectionBlock>

      {activeMatter ? (
        <SectionBlock
          kicker="Continue"
          title="Last active matter"
          rightNode={<Pill active>{activeMatter.stage}</Pill>}
        >
          <Text style={styles.bodyText}>{activeMatter.client}</Text>
          <Text style={styles.metaText}>{activeMatter.status}</Text>
          <InteractiveText style={styles.metaText}>
            Next: {isSenior ? "Research Review -> Senior Copilot -> Draft Review -> Approval Summary" : isFirm ? "Research Status -> Firm Copilot -> Draft Status -> Matter Summary" : "Research -> Copilot -> Draft -> Final Summary"}
          </InteractiveText>
          <View style={styles.inlineActions}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => onQuickOpenMatter("workspace")} style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>Open Workspace</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={() => onQuickOpenMatter("research")} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Go to Research</Text>
            </TouchableOpacity>
          </View>
        </SectionBlock>
      ) : null}

        {activeMatter ? (
          <SectionBlock
            kicker={isSenior ? "Review Signals" : isFirm ? "Oversight Signals" : "Recent Activity"}
            title={isSenior ? "Latest review signals" : isFirm ? "Latest oversight signals" : "Latest workspace signals"}
          >
            <View style={styles.quickStatsGrid}>
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatLabel}>{isSenior ? "Review" : isFirm ? "Draft" : "Draft"}</Text>
                <Text style={styles.quickStatValue}>{readiness?.draftStatus ?? activeMatterState?.draftStatus ?? activeMatter.finalSummary.draftStatus}</Text>
              </View>
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatLabel}>{isSenior ? "Approval" : isFirm ? "Validation" : "Validation"}</Text>
                <Text style={styles.quickStatValue}>{readiness?.validationStatus ?? activeMatterState?.validation ?? activeMatter.finalSummary.validation}</Text>
              </View>
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatLabel}>{isFirm ? "Updates" : "Patch Count"}</Text>
                <Text style={styles.quickStatValue}>{readiness?.patchCount ?? activeMatterState?.draftHistory?.length ?? 0}</Text>
              </View>
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatLabel}>{isSenior ? "Last Review" : isFirm ? "Last Signal" : "Last Focus"}</Text>
                <Text style={styles.quickStatValue}>{activeMatterState?.lastResearchFocus?.type ?? "General"}</Text>
              </View>
            </View>
            {readiness ? (
              <View style={styles.workspaceInsightCard}>
                <Text style={styles.workspaceInsightTitle}>
                  {isSenior ? "Review readiness" : isFirm ? "Oversight readiness" : "Matter readiness"}
                </Text>
                <InteractiveText style={styles.workspaceInsightText}>
                  {readiness.readinessLabel} | Score {readiness.readinessScore}/100
                </InteractiveText>
                <InteractiveText style={styles.metaText}>
                  {readiness.reviewPriority} | {readiness.readinessNote}
                </InteractiveText>
                {readiness.unsupportedCount ? (
                  <InteractiveText style={styles.metaText}>
                    Unsupported / review-required points: {readiness.unsupportedCount}
                  </InteractiveText>
                ) : null}
              </View>
            ) : null}
            {activeMatterState?.draftHistory?.[0] ? (
              <View style={styles.workspaceInsightCard}>
                <Text style={styles.workspaceInsightTitle}>{isSenior ? "Most recent review update" : isFirm ? "Most recent matter update" : "Most recent draft update"}</Text>
                <InteractiveText style={styles.workspaceInsightText}>
                  {activeMatterState.draftHistory[0].patch || "A recent Copilot update is available."}
                </InteractiveText>
            </View>
          ) : null}
          {activeMatterState?.lastExportAction ? (
            <InteractiveText style={styles.metaText}>Last export: {activeMatterState.lastExportAction}</InteractiveText>
          ) : null}
        </SectionBlock>
      ) : null}

        {activeMatter ? (
          <SectionBlock
            kicker={isSenior ? "Review Access" : isFirm ? "Oversight Access" : "Quick Access"}
            title={isSenior ? "Review shortcuts" : isFirm ? "Oversight shortcuts" : "Matter shortcuts"}
          >
            <View style={styles.grid}>
              <AppCard
                compact
                title="Profile"
                subtitle="Client identity and notes."
                onPress={() => onQuickOpenMatter("profile")}
              />
              <AppCard
                compact
                title="Case Details"
                subtitle="Facts, court, and documents."
                onPress={() => onQuickOpenMatter("details")}
              />
              <AppCard
                compact
                title={isSenior ? "Research Review" : isFirm ? "Research Status" : "Research"}
                subtitle={
                  isSenior
                    ? "Authorities, citations, and argument quality."
                    : isFirm
                      ? "Research depth and status signals."
                      : "Authorities, citations, and arguments."
                }
                onPress={() => onQuickOpenMatter("research")}
              />
              <AppCard
                compact
                title={isSenior ? "Approval Summary" : isFirm ? "Matter Summary" : "Final Summary"}
                subtitle={
                  isSenior
                    ? "Validation and approval outputs."
                    : isFirm
                      ? "Status, filing, and report outputs."
                      : "Validation and filing outputs."
                }
                onPress={() => onQuickOpenMatter("summary")}
              />
            </View>
          </SectionBlock>
        ) : null}

        {recentMatters.length ? (
          <SectionBlock
            kicker={isSenior ? "Recent Reviews" : isFirm ? "Recent Matters" : "Recent"}
            title={isSenior ? "Recent review matters" : isFirm ? "Recent tracked matters" : "Recent matters"}
          >
          <View style={styles.summaryStack}>
            {recentMatters.map((matter) => (
              <TouchableOpacity
                key={`recent-${matter.id}`}
                activeOpacity={0.9}
                onPress={() => onOpenRecentMatter(matter)}
                style={styles.selectableCard}
              >
                <Text style={styles.summaryLabel}>{matter.title}</Text>
                <InteractiveText style={styles.summaryValue}>
                  {matter.client} | {matter.caseDetails.type}
                </InteractiveText>
                <View style={styles.selectableFooter}>
                  <Text style={styles.summaryAction}>{matter.status || "Open matter"}</Text>
                  <Text style={styles.selectableArrow}>Open</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ) : null}
    </ScrollView>
  );
}

function CasesScreen({ currentRole, matters, onBack, onOpenMatter, onCreateCase, onArchiveMatter, onDeleteMatter }) {
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("recent");
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const primaryCaseActionLabel = isSenior ? "Open Review" : isFirm ? "Open Matter" : "Continue Case";

  const filteredMatters = matters.filter((matter) => {
    const searchText = `${matter.title} ${matter.client} ${matter.caseDetails.type} ${matter.status}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

  const sortedMatters = [...filteredMatters].sort((a, b) => {
    const aLastOpened = new Date(a.lastOpenedAt || 0).getTime();
    const bLastOpened = new Date(b.lastOpenedAt || 0).getTime();

    if (filterMode === "active") {
      return String(a.stage || "").localeCompare(String(b.stage || ""));
    }

    if (filterMode === "draft") {
      const aDraftReady = /draft|copilot|summary/i.test(a.status || a.finalSummary?.draftStatus || "") ? 1 : 0;
      const bDraftReady = /draft|copilot|summary/i.test(b.status || b.finalSummary?.draftStatus || "") ? 1 : 0;
      if (bDraftReady !== aDraftReady) {
        return bDraftReady - aDraftReady;
      }
    }

    return bLastOpened - aLastOpened;
  });

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BackBar
          title={isSenior ? "Review Queue" : isFirm ? "Matters" : "Cases"}
          subtitle={
            isSenior
              ? "Pick a matter and open its review workspace."
              : isFirm
                ? "Browse live matters and open their oversight workspace."
                : "Pick a matter and open its mobile workspace."
          }
          onBack={onBack}
        />
      <View style={styles.searchShell}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search case, client, or matter type"
          placeholderTextColor="#7a8ca7"
          style={styles.searchInput}
        />
      </View>
      <View style={styles.casesToolbar}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("recent")} style={[styles.casesToolbarChip, filterMode === "recent" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "recent" ? styles.casesToolbarLabelActive : null]}>Recent</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("active")} style={[styles.casesToolbarChip, filterMode === "active" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "active" ? styles.casesToolbarLabelActive : null]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("draft")} style={[styles.casesToolbarChip, filterMode === "draft" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "draft" ? styles.casesToolbarLabelActive : null]}>Draft Ready</Text>
        </TouchableOpacity>
      </View>
          <SectionBlock
            kicker={isSenior ? "Review" : isFirm ? "Matters" : "Cases"}
            title={isSenior ? "Review queue" : isFirm ? "Live matters" : "Saved matters"}
          >
            <View style={styles.inlineActions}>
              <TouchableOpacity activeOpacity={0.9} onPress={onCreateCase} style={styles.primaryAction}>
          <Text style={styles.primaryActionText}>
            {isFirm ? "New Matter" : currentRole === "senior" ? "New Review Case" : "New Case"}
          </Text>
              </TouchableOpacity>
            </View>
          {sortedMatters.map((matter) => (
            <View
              key={matter.id}
              style={styles.caseCard}
            >
              <View style={styles.caseMetaRow}>
                <Text style={styles.caseTitle}>{matter.title}</Text>
                <Pill>{matter.stage}</Pill>
              </View>
              <InteractiveText style={styles.caseClient}>{matter.client}</InteractiveText>
              <InteractiveText style={styles.caseStatus}>{matter.status}</InteractiveText>
              <InteractiveText style={styles.caseMetaDetail}>{matter.caseDetails.type}</InteractiveText>
              <View style={styles.caseMiniMetaRow}>
                <Pill>{matter.caseDetails.court}</Pill>
                <Pill active>{matter.finalSummary?.draftStatus || "Draft pending"}</Pill>
              </View>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => onOpenMatter(matter)}
                style={styles.casePrimaryAction}
              >
                <Text style={styles.casePrimaryActionText}>{primaryCaseActionLabel}</Text>
              </TouchableOpacity>
              <Text style={styles.casePrimaryHint}>
                {isSenior
                  ? "Open this review workspace and continue approval work."
                  : isFirm
                    ? "Open this matter workspace and continue oversight."
                    : "Open this matter workspace and continue drafting."}
              </Text>
              <View style={styles.caseActionRow}>
                <TouchableOpacity activeOpacity={0.9} onPress={() => onArchiveMatter(matter)} style={styles.caseMiniAction}>
                  <Text style={styles.caseMiniActionText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.9} onPress={() => onDeleteMatter(matter)} style={[styles.caseMiniAction, styles.caseMiniActionDanger]}>
                  <Text style={[styles.caseMiniActionText, styles.caseMiniActionTextDanger]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {!sortedMatters.length ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateTitle}>No cases found</Text>
              <Text style={styles.emptyStateText}>Try another client name, case title, or matter type.</Text>
            </View>
          ) : null}
        </SectionBlock>
      </ScrollView>
  );
}

function ClientsScreen({ currentRole, clients, onBack, onCreateCaseForClient, onArchiveClient }) {
  const [query, setQuery] = useState("");
  const isFirm = currentRole === "firm";
  const filteredClients = clients.filter((client) => {
    const searchText = `${client.name || ""} ${client.phone || ""} ${client.notes || ""}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BackBar
          title="Clients"
          subtitle={isFirm ? "Browse linked clients and matter owners quickly." : "Browse linked clients and start a new matter quickly."}
          onBack={onBack}
        />
      <View style={styles.searchShell}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client name, phone, or note"
          placeholderTextColor="#7a8ca7"
          style={styles.searchInput}
        />
      </View>
      <SectionBlock kicker="Clients" title="Saved client profiles">
        {filteredClients.length ? (
          filteredClients.map((client) => (
            <View key={client.id} style={styles.caseCard}>
              <Text style={styles.caseTitle}>{client.name || "Client"}</Text>
              <InteractiveText style={styles.caseClient}>{client.phone || "Phone not available"}</InteractiveText>
              {client.notes ? <InteractiveText style={styles.caseMetaDetail}>{client.notes}</InteractiveText> : null}
              <View style={styles.caseMiniMetaRow}>
                <Pill>{client.archived ? "Archived" : "Active"}</Pill>
                <Pill active>{client.notes ? "Notes saved" : "Profile basic"}</Pill>
              </View>
              <View style={styles.inlineActions}>
                <TouchableOpacity activeOpacity={0.9} onPress={() => onCreateCaseForClient(client)} style={styles.primaryAction}>
                  <Text style={styles.primaryActionText}>
                    {isFirm ? "New Matter" : currentRole === "senior" ? "Open Review Case" : "New Case"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.9} onPress={() => onArchiveClient(client)} style={styles.secondaryAction}>
                  <Text style={styles.secondaryActionText}>Archive Client</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>No clients found</Text>
            <Text style={styles.emptyStateText}>Create or sync a client first, then start a case from that profile.</Text>
          </View>
        )}
      </SectionBlock>
    </ScrollView>
  );
}

function MatterProfileScreen({ matter, currentRole, onBack }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar
        title={isSenior ? "Review Profile" : isFirm ? "Client Record" : "Profile"}
        subtitle={matter.client}
        onBack={onBack}
      />
      <WorkspaceBanner
        kicker={isSenior ? "Review Profile" : isFirm ? "Client Record" : "Client Profile"}
        title={matter.client}
        subtitle={
          isSenior
            ? "Review client identity, contact context, and notes before final approval."
            : isFirm
              ? "Track client record, contact context, and linked matter-facing notes."
              : "Identity, contact, and client context for the selected matter."
        }
        status={matter.stage}
      />
      <SectionBlock
        kicker={isSenior ? "Review Client" : isFirm ? "Client Record" : "Client"}
        title={isSenior ? "Client review snapshot" : isFirm ? "Matter-linked client profile" : "Matter profile"}
        rightNode={<Pill active>{matter.stage}</Pill>}
      >
        <View style={styles.summaryStack}>
          <SummaryItem label="Phone" value={matter.profile.phone} />
          <SummaryItem label="Location" value={matter.profile.location} />
          <SummaryItem label={isFirm ? "Record Note" : "Client Note"} value={matter.profile.note} />
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function MatterDetailsScreen({ matter, currentRole, onBack, onEdit }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar
        title={isSenior ? "Review Details" : isFirm ? "Matter Details" : "Case Details"}
        subtitle={matter.title}
        onBack={onBack}
      />
      <WorkspaceBanner
        kicker={isSenior ? "Review Details" : isFirm ? "Matter Details" : "Case Details"}
        title={matter.caseDetails.type}
        subtitle={
          isSenior
            ? "Review matter facts, court setup, hearing schedule, and supporting material before approval."
            : isFirm
              ? "Track matter facts, forum details, scheduling, and supporting material from one oversight view."
              : "Matter facts, court information, next steps, and supporting documents."
        }
        status={matter.stage}
      />
      <SectionBlock
        kicker={isSenior ? "Review Matter" : "Matter"}
        title={isSenior ? "Matter setup under review" : isFirm ? "Matter setup snapshot" : "Case setup"}
      >
        <View style={styles.quickStatsGrid}>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Type</Text>
            <Text style={styles.quickStatValue}>{matter.caseDetails.type}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Court</Text>
            <Text style={styles.quickStatValue}>{matter.caseDetails.court}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Next Date</Text>
            <Text style={styles.quickStatValue}>{matter.caseDetails.nextDate}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Stage</Text>
            <Text style={styles.quickStatValue}>{matter.stage}</Text>
          </View>
        </View>
      </SectionBlock>
      <SectionBlock
        kicker={isSenior ? "Review Facts" : "Facts"}
        title={isSenior ? "Matter narrative under review" : isFirm ? "Matter narrative snapshot" : "Matter narrative"}
      >
        <View style={styles.summaryStack}>
          <SummaryItem label="Core Facts" value={matter.caseDetails.facts} />
        </View>
      </SectionBlock>
      <SectionBlock
        kicker={isSenior ? "Review Documents" : "Documents"}
        title={isSenior ? "Supporting material under review" : isFirm ? "Supporting material snapshot" : "Supporting material"}
      >
        <View style={styles.summaryStack}>
          <SummaryItem label="Available Documents" value={matter.caseDetails.documents} />
        </View>
        <View style={styles.inlineActions}>
          <TouchableOpacity activeOpacity={0.9} onPress={onEdit} style={styles.primaryAction}>
                  <Text style={styles.primaryActionText}>
                    {isFirm ? "Edit Matter" : isSenior ? "Edit Review Details" : "Edit Case"}
                  </Text>
          </TouchableOpacity>
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function MatterResearchScreen({
  matter,
  matterState,
  currentRole,
  onBack,
  onOpenCopilot,
  onOpenSummary,
  onOpenDraft,
  onGenerateDraft,
  onSendToCopilot,
  onOpenInsightDetail,
  onExport,
  onAddIssue
}) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showAllAuthorities, setShowAllAuthorities] = useState(false);
  const [showAllCitations, setShowAllCitations] = useState(false);
  const [showAllArguments, setShowAllArguments] = useState(false);
  const [addingIssue, setAddingIssue] = useState(false);
  const [newIssueText, setNewIssueText] = useState("");
  const liveAuthorityEntries = getAuthorityEntries(matter, matterState);
  const liveCitationEntries = getCitationEntries(matter, matterState);
  const trustSnapshot = buildResearchTrustSnapshot([...liveAuthorityEntries, ...liveCitationEntries]);
  const liveResearch = matterState?.liveResearch;
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const priorityBanner = buildPriorityBanner({ readiness, trustSnapshot, liveResearch });
  const visibleIssues = showAllIssues ? matter.research.issues : matter.research.issues.slice(0, 3);
  const visibleAuthorities = showAllAuthorities ? liveAuthorityEntries : liveAuthorityEntries.slice(0, 3);
  const visibleCitations = showAllCitations ? liveCitationEntries : liveCitationEntries.slice(0, 3);
  const visibleArguments = showAllArguments ? matter.research.arguments : matter.research.arguments.slice(0, 2);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar title={isSenior ? "Research Review" : isFirm ? "Research Status" : "Research"} subtitle={matter.title} onBack={onBack} />
      <WorkspaceBanner
        kicker={isSenior ? "Senior Review" : isFirm ? "Firm Oversight" : "Research Workspace"}
        title={isSenior ? "Review draft-linked legal research" : isFirm ? "Track research readiness" : "Draft-linked legal research"}
        subtitle={
          isSenior
            ? "Review issues, authorities, citations, and arguments before approving stronger draft updates."
            : isFirm
              ? "Inspect research depth, authority coverage, and case-readiness signals across the current matter."
              : "Select issues, authorities, citations, and arguments, then send them to Copilot to improve the current draft."
        }
        status={matter.stage}
      />
      <TrustPriorityBanner title={priorityBanner.title} note={priorityBanner.note} tone={priorityBanner.tone} />

      <SectionBlock kicker="Draft" title="AI draft status" rightNode={<Pill active>{matter.finalSummary.draftStatus}</Pill>}>
        <InteractiveText style={styles.bodyText}>
          Stage 1 raw matter nundi AI draft ready ayyindi. Ippudu lawyer research support ni use chesi
          Copilot tho draft improve cheyyachu.
        </InteractiveText>
        <View style={styles.summaryStack}>
          <DraftPreviewCard text={matterState?.currentDraft ?? buildInitialMatterState(matter).currentDraft} />
        </View>
        <View style={styles.microActionRowWrap}>
          <MiniAction label="Generate Draft" primary onPress={onGenerateDraft} />
          <MiniAction label="Open Draft" onPress={onOpenDraft} />
          <TouchableOpacity activeOpacity={0.9} onPress={onOpenCopilot} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>Open Copilot</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={onOpenSummary} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Final Summary</Text>
          </TouchableOpacity>
        </View>
      </SectionBlock>

      <DocumentChecklistSection matter={matter} matterState={matterState} onExport={onExport} />

      <View style={styles.researchQuickBar}>
        <Pill active>Issues</Pill>
        <Pill>Authorities</Pill>
        <Pill>Citations</Pill>
        <Pill>Arguments</Pill>
      </View>

      <SectionBlock kicker="Trust layer" title="Source and verification signals">
        <View style={styles.summaryStack}>
          <SummaryItem label="Authority confidence" value={trustSnapshot.authorityConfidence} />
          <SummaryItem label="Review status" value={trustSnapshot.reviewState} />
          <SummaryItem label="Source coverage" value={trustSnapshot.sourceCoverage} />
          <SummaryItem label="Freshness" value={trustSnapshot.freshnessState} />
          <SummaryItem label="Treatment" value={trustSnapshot.treatmentState} />
          <SummaryItem
            label="Live fetch"
            value={
              liveResearch?.status === "loading"
                ? "Refreshing live judgments"
                : liveResearch?.status === "ready"
                  ? `Live authorities loaded from ${(liveResearch.fetchedSources || []).join(", ") || "official feeds"}`
                  : liveResearch?.status === "error"
                    ? "Live feed unavailable, seeded research shown"
                    : "Seeded research available"
            }
          />
        </View>
        <Text style={styles.metaText}>Verify latest amendments, treatment, and pinpoint paragraphs before filing.</Text>
      </SectionBlock>

      <CollapsibleBlock kicker="Research" title="Issues to review">
        <View style={styles.summaryStack}>
          {visibleIssues.map((item) => (
            <SelectableSummaryItem
              key={item}
              label="Issue"
              value={getResearchEntryText(item)}
              onPress={() => onSendToCopilot("Issue", item)}
            />
          ))}
        </View>
        <View style={styles.microActionRowWrap}>
          <MiniAction
            label={addingIssue ? "Cancel Add" : "Add Issue +"}
            onPress={() => {
              setAddingIssue((current) => !current);
              if (addingIssue) {
                setNewIssueText("");
              }
            }}
          />
          {matter.research.issues.length > 3 ? (
            <MiniAction
              label={showAllIssues ? "Show less" : `View all issues (${matter.research.issues.length})`}
              onPress={() => setShowAllIssues((current) => !current)}
            />
          ) : null}
        </View>
        {addingIssue ? (
          <View style={styles.inlineIssueComposer}>
            <TextInput
              value={newIssueText}
              onChangeText={setNewIssueText}
              placeholder="Add a new issue for research review"
              placeholderTextColor="#7a8ca7"
              style={styles.inlineIssueInput}
              multiline
            />
            <View style={styles.microActionRowWrap}>
              <MiniAction
                label="Save Issue"
                primary
                onPress={() => {
                  const cleanIssue = String(newIssueText || "").trim();
                  if (!cleanIssue) {
                    Alert.alert("Issue missing", "Add cheyyadaniki mundu issue text type cheyyi.");
                    return;
                  }
                  onAddIssue?.(cleanIssue);
                  setNewIssueText("");
                  setAddingIssue(false);
                }}
              />
              <MiniAction
                label="Cancel"
                onPress={() => {
                  setNewIssueText("");
                  setAddingIssue(false);
                }}
              />
            </View>
          </View>
        ) : null}
      </CollapsibleBlock>

      <CollapsibleBlock kicker="Authorities" title="Selected legal support">
        <InteractiveText style={styles.metaText}>
          {showAllAuthorities ? "Showing full authority list for this matter." : `Showing top ${Math.min(3, liveAuthorityEntries.length)} authority items first to keep review focused.`}
        </InteractiveText>
        <View style={styles.summaryStack}>
          {visibleAuthorities.map((item, index) => (
            <LegalInsightCard
              key={`authority-${index}-${getResearchEntryText(item)}`}
              label="Authority"
              item={item}
              onPress={() => onSendToCopilot("Authority", item)}
              onDetailPress={() => onOpenInsightDetail?.("Authority", item)}
            />
          ))}
        </View>
        {liveAuthorityEntries.length > 3 ? (
          <View style={styles.microActionRow}>
            <MiniAction
              label={showAllAuthorities ? "Show fewer authorities" : `View all authorities (${liveAuthorityEntries.length})`}
              onPress={() => setShowAllAuthorities((current) => !current)}
            />
          </View>
        ) : null}
      </CollapsibleBlock>

      <CollapsibleBlock kicker="Citations" title="Relevant citations" defaultOpen={false}>
        <InteractiveText style={styles.metaText}>
          {showAllCitations ? "Showing all linked citations." : `Showing top ${Math.min(3, liveCitationEntries.length)} citations first for quick drafting use.`}
        </InteractiveText>
        <View style={styles.summaryStack}>
          {visibleCitations.map((item, index) => (
            <LegalInsightCard
              key={`citation-${index}-${getResearchEntryText(item)}`}
              label="Citation"
              item={item}
              onPress={() => onSendToCopilot("Citation", item)}
              onDetailPress={() => onOpenInsightDetail?.("Citation", item)}
            />
          ))}
        </View>
        {liveCitationEntries.length > 3 ? (
          <View style={styles.microActionRow}>
            <MiniAction
              label={showAllCitations ? "Show fewer citations" : `View all citations (${liveCitationEntries.length})`}
              onPress={() => setShowAllCitations((current) => !current)}
            />
          </View>
        ) : null}
      </CollapsibleBlock>

      <CollapsibleBlock kicker="Arguments" title="Draft improvement points" defaultOpen={false}>
        <View style={styles.summaryStack}>
          {visibleArguments.map((item) => (
            <SelectableSummaryItem
              key={item}
              label="Argument"
              value={getResearchEntryText(item)}
              onPress={() => onSendToCopilot("Argument", item)}
            />
          ))}
        </View>
        {matter.research.arguments.length > 2 ? (
          <View style={styles.microActionRow}>
            <MiniAction
              label={showAllArguments ? "Show fewer arguments" : `View all arguments (${matter.research.arguments.length})`}
              onPress={() => setShowAllArguments((current) => !current)}
            />
          </View>
        ) : null}
      </CollapsibleBlock>

      {matterState?.lastResearchFocus ? (
        <SectionBlock kicker="Selected" title="Current Copilot context">
          <LegalInsightCard
            label={matterState.lastResearchFocus.type}
            item={matterState.lastResearchFocus.insight || matterState.lastResearchFocus.value}
            onDetailPress={() => onOpenInsightDetail?.(matterState.lastResearchFocus.type, matterState.lastResearchFocus.insight || matterState.lastResearchFocus.value)}
          />
          <View style={styles.microActionRow}>
            <MiniAction label="Open Copilot" primary onPress={onOpenCopilot} />
            <MiniAction label="View Summary" onPress={onOpenSummary} />
          </View>
        </SectionBlock>
      ) : null}
    </ScrollView>
  );
}

function MatterSummaryScreen({
  matter,
  matterState,
  currentRole,
  onBack,
  onExport,
  onOpenInsightDetail,
  onFixUnsupportedExcerpt,
  onOpenDraft,
  onBuildFilingPack,
  onAutoFixIssues
}) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const draftStatus = readiness.draftStatus;
  const validationStatus = readiness.validationStatus;
  const filingStatus = readiness.filingStatus;
  const latestHistory = matterState?.draftHistory?.[0];
  const validationReport = matterState?.validationReport || null;
  const filingChecklist = Array.isArray(matterState?.filingChecklist) ? matterState.filingChecklist : [];
  const trustEntries = [
    ...(getAuthorityEntries(matter, matterState)?.[0] ? [{ label: "Authority", item: getAuthorityEntries(matter, matterState)[0] }] : []),
    ...(getCitationEntries(matter, matterState)?.[0] ? [{ label: "Citation", item: getCitationEntries(matter, matterState)[0] }] : [])
  ];
  const trustSnapshot = buildResearchTrustSnapshot([
    ...(getAuthorityEntries(matter, matterState) ?? []),
    ...(getCitationEntries(matter, matterState) ?? [])
  ]);
  const priorityBanner = buildPriorityBanner({
    readiness,
    trustSnapshot,
    liveResearch: matterState?.liveResearch
  });
  const filingDecision = buildFilingDecision(readiness, currentRole);
  const showPriorityBanner =
    ["risk", "warning"].includes(priorityBanner.tone) && priorityBanner.title !== filingDecision.title;

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar title={isSenior ? "Approval Summary" : isFirm ? "Matter Summary" : "Final Summary"} subtitle={matter.title} onBack={onBack} />
      <WorkspaceBanner
        kicker={isSenior ? "Approval Output" : isFirm ? "Matter Oversight" : "Final Output"}
        title={isSenior ? "Validation and approval summary" : isFirm ? "Matter status and filing summary" : "Validation and filing summary"}
        subtitle={
          isSenior
            ? "Review draft readiness, validation points, and final approval signals from one mobile screen."
            : isFirm
              ? "Track draft status, filing pack readiness, and final matter outputs for oversight."
              : "Track the current draft state, filing pack readiness, and final case outputs from one mobile screen."
        }
        status={draftStatus}
      />
      {showPriorityBanner ? (
        <TrustPriorityBanner title={priorityBanner.title} note={priorityBanner.note} tone={priorityBanner.tone} />
      ) : null}
      <FilingDecisionCard
        decision={filingDecision}
        onActionPress={
          filingDecision.actionLabel && onFixUnsupportedExcerpt
            ? () => onFixUnsupportedExcerpt(filingDecision.actionPrompt)
            : null
        }
      />
      <SectionBlock kicker="Stage 3" title="Validation and filing">
        <View style={styles.reportGrid}>
          <View style={styles.reportCard}>
            <Text style={styles.reportCardLabel}>Draft Status</Text>
            <Text style={styles.reportCardValue}>{draftStatus}</Text>
          </View>
          <View style={styles.reportCard}>
            <Text style={styles.reportCardLabel}>Validation</Text>
            <Text style={styles.reportCardValue}>{validationStatus}</Text>
          </View>
          <View style={styles.reportCard}>
            <Text style={styles.reportCardLabel}>Filing Pack</Text>
            <Text style={styles.reportCardValue}>{filingStatus}</Text>
          </View>
          <View style={styles.reportCard}>
            <Text style={styles.reportCardLabel}>Next Hearing</Text>
            <Text style={styles.reportCardValue}>{matter.caseDetails.nextDate}</Text>
          </View>
        </View>
      </SectionBlock>
      <SectionBlock kicker="Readiness" title="Filing readiness">
        <View style={styles.summaryStack}>
          <SummaryItem label="Readiness" value={readiness.readinessLabel} />
          <SummaryItem label="Readiness Score" value={`${readiness.readinessScore}/100`} />
          <SummaryItem label="Review Priority" value={readiness.reviewPriority} />
          <SummaryItem label="Readiness Note" value={readiness.readinessNote} />
          <SummaryItem label="Unsupported Points" value={readiness.unsupportedCount ? `${readiness.unsupportedCount} item(s)` : "No unsupported draft points flagged"} />
          <SummaryItem label="Authority Support" value={`${readiness.authorityCount} authority item(s)`} />
          <SummaryItem label="Citation Support" value={`${readiness.citationCount} citation item(s)`} />
          <SummaryItem label="Manual Review Flags" value={readiness.flaggedAuthorities ? `${readiness.flaggedAuthorities} item(s)` : "No flagged authority warnings"} />
          <SummaryItem label="Treatment Flags" value={readiness.treatmentWarnings ? `${readiness.treatmentWarnings} item(s)` : "No treatment caution warnings"} />
          <SummaryItem label="Freshness Flags" value={readiness.staleAuthorities ? `${readiness.staleAuthorities} item(s)` : "No stale authority warnings"} />
          <SummaryItem label="Live Feed" value={readiness.liveReady ? "Live authority feed active" : "Seeded / fallback authority mode"} />
        </View>
      </SectionBlock>
      {validationReport ? (
        <SectionBlock kicker="Validation Report" title="Backend validation details">
          <View style={styles.summaryStack}>
            <SummaryItem label="Status" value={validationReport.statusLabel || validationReport.status || "Completed"} />
            <SummaryItem label="Draft Score" value={validationReport.score != null ? `${validationReport.score}%` : "Not scored"} />
            <SummaryItem
              label="Detected Types"
              value={Array.isArray(validationReport.detectedDocumentTypes) && validationReport.detectedDocumentTypes.length
                ? validationReport.detectedDocumentTypes.map((item) => item.type).join(", ")
                : "No document-type signals detected"}
            />
            <SummaryItem
              label="Critical Errors"
              value={Array.isArray(validationReport.criticalErrors) && validationReport.criticalErrors.length ? validationReport.criticalErrors.join(" | ") : "No critical errors flagged"}
            />
            <SummaryItem
              label="Warnings"
              value={Array.isArray(validationReport.warnings) && validationReport.warnings.length ? validationReport.warnings.join(" | ") : "No warnings flagged"}
            />
            <SummaryItem
              label="Passed Checks"
              value={Array.isArray(validationReport.passedChecks) && validationReport.passedChecks.length ? validationReport.passedChecks.join(" | ") : "No passed checks recorded"}
            />
            <SummaryItem
              label="Missing Sections"
              value={Array.isArray(validationReport.missingSections) && validationReport.missingSections.length ? validationReport.missingSections.join(", ") : "No missing sections flagged"}
            />
            <SummaryItem
              label="Citation Issues"
              value={Array.isArray(validationReport.citationIssues) && validationReport.citationIssues.length ? validationReport.citationIssues.join(" | ") : "No citation issues flagged"}
            />
            <SummaryItem
              label="Suggestions"
              value={Array.isArray(validationReport.suggestions || validationReport.suggestedFixes) && (validationReport.suggestions || validationReport.suggestedFixes).length ? (validationReport.suggestions || validationReport.suggestedFixes).join(" | ") : "No suggestions"}
            />
          </View>
          <View style={styles.microActionRowWrap}>
            <MiniAction label="Open Draft" onPress={onOpenDraft} />
            <MiniAction label="Auto Fix Issues" onPress={onAutoFixIssues} />
            <MiniAction label="Build Filing Pack" primary onPress={onBuildFilingPack} />
            <MiniAction label="Download Validation" onPress={() => onExport("validation", "download")} />
          </View>
        </SectionBlock>
      ) : null}
      {filingChecklist.length ? (
        <SectionBlock kicker="Filing Pack" title="Checklist before filing">
          <View style={styles.summaryStack}>
            {filingChecklist.map((item, index) => (
              <SummaryItem key={`filing-check-${index}`} label={`Step ${index + 1}`} value={item} />
            ))}
          </View>
          <View style={styles.microActionRowWrap}>
            <MiniAction label="Download Filing Pack" onPress={() => onExport("filing", "download")} />
            <MiniAction label="Share Filing Pack" onPress={() => onExport("filing", "share")} />
          </View>
        </SectionBlock>
      ) : null}
      {readiness.unsupportedCount ? (
        <SectionBlock kicker="Unsupported review" title="Review-required draft points">
          <View style={styles.summaryStack}>
            {readiness.unsupportedPoints.map((item, index) => (
              <SummaryItem key={`summary-unsupported-${index}`} label={`Point ${index + 1}`} value={item} />
            ))}
            {readiness.unsupportedDraftExcerpts?.map((item, index) => (
              <TouchableOpacity
                key={`summary-unsupported-excerpt-${index}`}
                activeOpacity={0.9}
                onPress={() => onFixUnsupportedExcerpt?.(item)}
                style={styles.selectableCard}
              >
                <Text style={styles.summaryLabel}>{`Excerpt ${index + 1}`}</Text>
                <InteractiveText style={styles.summaryValue}>{item}</InteractiveText>
                <View style={styles.selectableFooter}>
                  <Text style={styles.summaryAction}>Fix in Copilot</Text>
                  <Text style={styles.selectableArrow}>Open</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ) : null}
      <SectionBlock kicker="Checklist" title="Ready-to-file review">
        <View style={styles.summaryStack}>
          <SummaryItem label="Case Type" value={matter.caseDetails.type} />
          <SummaryItem label="Court / Forum" value={matter.caseDetails.court} />
          <SummaryItem label="Documents" value={matter.caseDetails.documents} />
          <SummaryItem label="Client Note" value={matter.profile.note} />
          {readiness.checklist.map((item, index) => (
            <SummaryItem key={`checklist-${index}`} label={`Checklist ${index + 1}`} value={item} />
          ))}
        </View>
      </SectionBlock>
      <DocumentChecklistSection matter={matter} matterState={matterState} onExport={onExport} />
      <SectionBlock kicker="Legal Checks" title="Matter-specific review points">
        <View style={styles.summaryStack}>
          <SummaryItem label="Pending Checks" value={readiness.matterSpecificPending ? `${readiness.matterSpecificPending} item(s) need attention` : "No major matter-specific gaps flagged"} />
          {readiness.matterSpecificChecks.map((item, index) => (
            <SummaryItem
              key={`matter-check-${index}`}
              label={`${item.label}${item.ready ? " | Ready" : " | Pending"}`}
              value={item.text}
            />
          ))}
        </View>
      </SectionBlock>
      <SectionBlock kicker="Draft" title="Current draft preview">
        <DraftPreviewCard text={matterState?.currentDraft ?? buildInitialMatterState(matter).currentDraft} />
        <View style={styles.microActionRow}>
          <MiniAction label="Download Draft" primary onPress={() => onExport("draft", "download")} />
          <MiniAction label="Share Draft" onPress={() => onExport("share", "share")} />
          <MiniAction label="Open Draft" onPress={onOpenDraft} />
        </View>
      </SectionBlock>
      {matterState?.lastResearchFocus ? (
        <SectionBlock kicker="Linked Research" title="Last Copilot source">
          <LegalInsightCard
            label={matterState.lastResearchFocus.type}
            item={matterState.lastResearchFocus.insight || matterState.lastResearchFocus.value}
            onDetailPress={() => onOpenInsightDetail?.(matterState.lastResearchFocus.type, matterState.lastResearchFocus.insight || matterState.lastResearchFocus.value)}
          />
        </SectionBlock>
      ) : null}
      {trustEntries.length ? (
        <SectionBlock kicker="Trust layer" title="Research trust snapshot">
          <View style={styles.summaryStack}>
            {trustEntries.map((entry, index) => (
              <LegalInsightCard
                key={`summary-trust-${entry.label}-${index}-${getResearchEntryText(entry.item)}`}
                label={entry.label}
                item={entry.item}
                onDetailPress={() => onOpenInsightDetail?.(entry.label, entry.item)}
              />
            ))}
            <SummaryItem label="Authority confidence" value={trustSnapshot.authorityConfidence} />
            <SummaryItem label="Review state" value={trustSnapshot.reviewState} />
            <SummaryItem label="Source coverage" value={trustSnapshot.sourceCoverage} />
            <SummaryItem label="Freshness" value={trustSnapshot.freshnessState} />
            <SummaryItem label="Treatment" value={trustSnapshot.treatmentState} />
            <SummaryItem
              label="Source mode"
              value={
                matterState?.liveResearch?.status === "ready"
                  ? `Live feed from ${(matterState.liveResearch.fetchedSources || []).join(", ") || "official feeds"}`
                  : matterState?.liveResearch?.status === "loading"
                    ? "Refreshing live authorities"
                    : "Seeded research snapshot"
              }
            />
          </View>
        </SectionBlock>
      ) : null}
      {latestHistory ? (
        <SectionBlock kicker="Latest Activity" title="Most recent draft update">
          <SummaryItem label="Patch" value={latestHistory.patch || "No patch note recorded."} />
          <SummaryItem label="Timestamp" value={latestHistory.timestamp || "Unknown"} />
        </SectionBlock>
      ) : null}
      <SectionBlock kicker="Outputs" title="Final actions">
        <View style={styles.exportTray}>
          <View style={styles.microActionRowWrap}>
            <MiniAction label="Validation Report" onPress={() => onExport("validation", "download")} />
            <MiniAction label="Filing Pack" onPress={() => onExport("filing", "download")} />
            <MiniAction label="Documents" onPress={() => onExport("documents", "download")} />
            <MiniAction label="Arguments" onPress={() => onExport("arguments", "download")} />
            <MiniAction label="Case Summary" onPress={() => onExport("summary", "download")} />
            <MiniAction label="Share Summary" onPress={() => onExport("summary", "share")} />
          </View>
        </View>
        {matterState?.lastExportAction ? (
          <Text style={styles.metaText}>Last action: {matterState.lastExportAction}</Text>
        ) : null}
      </SectionBlock>
    </ScrollView>
  );
}

function CaseWorkspace({ matter, matterState, currentRole, onBack, onOpenSection }) {
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const primaryShortcuts = currentRole === "senior"
    ? [
        {
          id: "research",
          title: "Research Review",
          subtitle: "Check issues, authorities, citations, and argument quality."
        },
        {
          id: "copilot",
          title: "Senior Copilot",
          subtitle: "Tighten reasoning, send back, or strengthen the draft."
        },
        {
          id: "draft",
          title: "Draft Review",
          subtitle: "Inspect the current pleading and compare changes."
        },
        {
          id: "summary",
          title: "Approval Summary",
          subtitle: "Validation, filing pack, and approval-ready outputs."
        }
      ]
    : currentRole === "firm"
      ? [
          {
            id: "summary",
            title: "Matter Summary",
            subtitle: "Review final status, filing pack, and report readiness."
          },
          {
            id: "research",
            title: "Research Status",
            subtitle: "Inspect issues, authorities, citations, and strategy depth."
          },
          {
            id: "draft",
            title: "Draft Status",
            subtitle: "Review the working pleading and major updates."
          },
          {
            id: "copilot",
            title: "Firm Copilot",
            subtitle: "Ask for strategic guidance and workspace-wide improvements."
          }
        ]
      : [
          {
            id: "research",
            title: "Research",
            subtitle: "Issues, authorities, citations, and arguments."
          },
          {
            id: "copilot",
            title: "Copilot",
            subtitle: "Ask, edit, and improve the draft."
          },
          {
            id: "draft",
            title: "Draft",
            subtitle: "Review the working pleading and history."
          },
          {
            id: "summary",
            title: "Final Summary",
            subtitle: "Validation, filing pack, and exports."
          }
        ];

  const secondaryShortcuts = [
    {
      id: "profile",
      title: "Profile",
      subtitle: `${matter.client} details, phone, location, and notes.`
    },
    {
      id: "details",
      title: "Case Details",
      subtitle: `${matter.caseDetails.type}, facts, court, and documents.`
    }
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar title={matter.title} subtitle={matter.client} onBack={onBack} />
        <WorkspaceBanner
          kicker="Case Workspace"
          title={matter.title}
          subtitle={
            currentRole === "senior"
              ? "Review associate work, tighten strategy, and prepare this matter for approval."
              : currentRole === "firm"
                ? "Track matter progress, filing readiness, and final outputs from one oversight workspace."
                : "Open profile, case details, research, and final outputs from one focused matter workspace."
          }
          status={matter.stage}
        />

        <SectionBlock
          kicker="Primary"
          title={
            currentRole === "senior"
              ? "Review this matter now"
              : currentRole === "firm"
                ? "Track this matter now"
                : "Work on this matter now"
          }
          rightNode={<Pill active>{matter.stage}</Pill>}
        >
        <InteractiveText style={styles.bodyText}>{matter.status}</InteractiveText>
        <View style={styles.workspaceTileGrid}>
          {primaryShortcuts.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.9}
              onPress={() => onOpenSection(item.id)}
              style={[styles.workspaceTile, styles.workspaceTilePrimary]}
            >
              <Text style={styles.workspaceTileTitle}>{item.title}</Text>
              <Text style={styles.workspaceTileSubtitle}>{item.subtitle}</Text>
              <Text style={styles.workspaceTileHint}>Open</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SectionBlock>

      <SectionBlock kicker="Current Matter" title="Quick case summary">
        <View style={styles.quickStatsGrid}>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Client</Text>
            <Text style={styles.quickStatValue}>{matter.client}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Type</Text>
            <Text style={styles.quickStatValue}>{matter.caseDetails.type}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Draft</Text>
            <Text style={styles.quickStatValue}>{readiness.draftStatus}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Validation</Text>
            <Text style={styles.quickStatValue}>{readiness.validationStatus}</Text>
          </View>
        </View>
        <View style={styles.workspaceInsightCard}>
          <Text style={styles.workspaceInsightTitle}>Current matter focus</Text>
          <InteractiveText style={styles.workspaceInsightText}>
            {matter.caseDetails.facts}
          </InteractiveText>
        </View>
        <View style={styles.workspaceInsightCard}>
          <Text style={styles.workspaceInsightTitle}>Readiness snapshot</Text>
          <InteractiveText style={styles.workspaceInsightText}>
            {readiness.readinessLabel} | Score {readiness.readinessScore}/100
          </InteractiveText>
          <InteractiveText style={styles.metaText}>
            {readiness.reviewPriority} | {readiness.readinessNote}
          </InteractiveText>
          {readiness.unsupportedCount ? (
            <InteractiveText style={styles.metaText}>
              Unsupported / review-required points: {readiness.unsupportedCount}
            </InteractiveText>
          ) : null}
        </View>
          <View style={styles.workspaceInsightCard}>
            <Text style={styles.workspaceInsightTitle}>Next best action</Text>
            <InteractiveText style={styles.workspaceInsightText}>
              {currentRole === "senior"
                ? "Start with `Research Review`, move into `Senior Copilot`, inspect the `Draft Review`, and close with `Approval Summary`."
                : currentRole === "firm"
                  ? "Start with `Matter Summary`, review `Research Status`, inspect `Draft Status`, and use `Firm Copilot` for final guidance."
                  : "Start with `Research`, then move into `Copilot`, review the `Draft`, and finish with `Final Summary`."}
            </InteractiveText>
          </View>
        </SectionBlock>

      <SectionBlock kicker="Support" title="Profile and intake details">
        <View style={styles.workspaceTileGrid}>
          {secondaryShortcuts.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.9}
              onPress={() => onOpenSection(item.id)}
              style={styles.workspaceTile}
            >
              <Text style={styles.workspaceTileTitle}>{item.title}</Text>
              <Text style={styles.workspaceTileSubtitle}>{item.subtitle}</Text>
              <Text style={styles.workspaceTileHint}>Open</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function MatterDraftScreen({ matter, matterState, currentRole, onBack, onOpenCopilot, onOpenSummary, onRestoreHistory, onOpenInsightDetail, onFixUnsupportedExcerpt, onGenerateDraft, onValidateDraft, onAutoFixIssues, onBuildFilingPack, onSaveEditedDraft, onExport }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const readiness = buildMatterReadinessSnapshot(matter, matterState);
  const draftText = matterState?.currentDraft ?? buildInitialMatterState(matter).currentDraft;
  const draftHistory = matterState?.draftHistory ?? [];
  const latestHistory = draftHistory?.[0] ?? null;
  const highlightCopilotChanges = isCopilotDraftChange(latestHistory);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [historyCompareVisible, setHistoryCompareVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorText, setEditorText] = useState(draftText);
  const [editorSelection, setEditorSelection] = useState({ start: 0, end: 0 });
  const [replacementText, setReplacementText] = useState("");
  const [editorChangeLog, setEditorChangeLog] = useState([]);
  const [editorUndoStack, setEditorUndoStack] = useState([]);
  const [editorRedoStack, setEditorRedoStack] = useState([]);
  const selectedHistoryExcerpt = selectedHistoryItem
    ? buildChangedExcerptSummary(
        formatDraftDisplayText(draftText),
        formatDraftDisplayText(selectedHistoryItem.previousDraft || "")
      )
    : null;
  const selectedHistoryWordDiff = selectedHistoryExcerpt
    ? buildWordDiffSegments(selectedHistoryExcerpt.currentExcerpt, selectedHistoryExcerpt.previousExcerpt)
    : null;
  const latestSupportEntries = buildSupportEntries(matter, matterState, draftHistory?.[0]?.patchMeta?.supportEntries);

  useEffect(() => {
    if (!editorVisible) {
      setEditorText(draftText);
      setEditorSelection({ start: 0, end: 0 });
      setReplacementText("");
      setEditorChangeLog([]);
      setEditorUndoStack([]);
      setEditorRedoStack([]);
    }
  }, [draftText, editorVisible]);

  const hasSelection = editorSelection.end > editorSelection.start;
  const selectedText = hasSelection ? editorText.slice(editorSelection.start, editorSelection.end) : "";
  const selectedPreview = selectedText.trim()
    ? `${selectedText.trim().slice(0, 140)}${selectedText.trim().length > 140 ? "..." : ""}`
    : "No text selected";

  const openDraftEditor = () => {
    setEditorText(draftText);
    setEditorSelection({ start: 0, end: 0 });
    setReplacementText("");
    setEditorChangeLog([]);
    setEditorUndoStack([]);
    setEditorRedoStack([]);
    setEditorVisible(true);
  };

  const pushEditorUndoSnapshot = () => {
    setEditorRedoStack([]);
    setEditorUndoStack((current) => [
      {
        text: editorText,
        selection: editorSelection,
        replacementText,
        changeLog: editorChangeLog
      },
      ...current
    ].slice(0, 40));
  };

  const handleUndoLastEdit = () => {
    if (!editorUndoStack.length) {
      Alert.alert("Nothing to undo", "Last change ni undo cheyyadaniki editor lo change ledu.");
      return;
    }

    const [previousSnapshot, ...remainingSnapshots] = editorUndoStack;
    setEditorRedoStack((current) => [
      {
        text: editorText,
        selection: editorSelection,
        replacementText,
        changeLog: editorChangeLog
      },
      ...current
    ].slice(0, 40));
    setEditorText(previousSnapshot.text || "");
    setEditorSelection(previousSnapshot.selection || { start: 0, end: 0 });
    setReplacementText(previousSnapshot.replacementText || "");
    setEditorChangeLog(Array.isArray(previousSnapshot.changeLog) ? previousSnapshot.changeLog : []);
    setEditorUndoStack(remainingSnapshots);
  };

  const handleRedoLastEdit = () => {
    if (!editorRedoStack.length) {
      Alert.alert("Nothing to redo", "Undo chesina change ni malli apply cheyyadaniki redo item ledu.");
      return;
    }

    const [nextSnapshot, ...remainingSnapshots] = editorRedoStack;
    setEditorUndoStack((current) => [
      {
        text: editorText,
        selection: editorSelection,
        replacementText,
        changeLog: editorChangeLog
      },
      ...current
    ].slice(0, 40));
    setEditorText(nextSnapshot.text || "");
    setEditorSelection(nextSnapshot.selection || { start: 0, end: 0 });
    setReplacementText(nextSnapshot.replacementText || "");
    setEditorChangeLog(Array.isArray(nextSnapshot.changeLog) ? nextSnapshot.changeLog : []);
    setEditorRedoStack(remainingSnapshots);
  };

  const handleEditorTextChange = (nextText) => {
    if (nextText === editorText) {
      return;
    }

    pushEditorUndoSnapshot();
    setEditorText(nextText);
  };

  const handleDeleteSelectedText = () => {
    if (!hasSelection) {
      Alert.alert("Select text", "Delete cheyyadaniki mundu draft lo text select cheyyi.");
      return;
    }

    pushEditorUndoSnapshot();
    const nextDraft = `${editorText.slice(0, editorSelection.start)}${editorText.slice(editorSelection.end)}`;
    const deletedPreview = selectedText.trim().slice(0, 80);
    setEditorText(nextDraft);
    setEditorSelection({ start: editorSelection.start, end: editorSelection.start });
    setEditorChangeLog((current) => [
      ...current,
      deletedPreview ? `Deleted selected text: ${deletedPreview}` : "Deleted selected text"
    ]);
  };

  const handleReplaceSelectedText = () => {
    if (!hasSelection) {
      Alert.alert("Select text", "Update cheyyadaniki mundu draft lo text select cheyyi.");
      return;
    }
    if (!replacementText.trim()) {
      Alert.alert("Replacement missing", "Selected text place lo pettadaniki new text type cheyyi.");
      return;
    }

    pushEditorUndoSnapshot();
    const nextDraft = `${editorText.slice(0, editorSelection.start)}${replacementText}${editorText.slice(editorSelection.end)}`;
    const nextCursor = editorSelection.start + replacementText.length;
    setEditorText(nextDraft);
    setEditorSelection({ start: nextCursor, end: nextCursor });
    setEditorChangeLog((current) => [
      ...current,
      "Replaced selected text with updated wording"
    ]);
    setReplacementText("");
  };

  const handleSaveDraftEditor = () => {
    const cleanedDraft = String(editorText || "").trim();
    if (!cleanedDraft) {
      Alert.alert("Draft empty", "Empty draft ni save cheyyalem.");
      return;
    }

    onSaveEditedDraft?.(cleanedDraft, {
      actions: editorChangeLog,
      selectedPreview
    });
    setEditorVisible(false);
  };

  const openHistoryCompare = (item) => {
    if (!item) {
      return;
    }
    setSelectedHistoryItem(item);
    setHistoryCompareVisible(true);
  };

    return (
      <>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar title={isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft"} subtitle={matter.title} onBack={onBack} />
      <WorkspaceBanner
        kicker={isSenior ? "Review Draft" : isFirm ? "Draft Oversight" : "Draft Workspace"}
        title={isSenior ? "Current draft under review" : isFirm ? "Current draft status" : "Current working draft"}
        subtitle={
          isSenior
            ? "Inspect the current draft text, compare changes, and push stronger feedback back into Copilot."
            : isFirm
              ? "Review the live draft, track changes, and monitor drafting progress for this matter."
              : "Review the active draft text, then use Copilot to improve or finalize it."
        }
        status={matterState?.draftStatus ?? matter.finalSummary.draftStatus}
      />
      <SectionBlock kicker="Draft" title="Pleading text">
        <DraftPreviewCard
          text={draftText}
          previousText={highlightCopilotChanges ? latestHistory?.previousDraft || "" : ""}
          highlightCopilotChanges={highlightCopilotChanges}
          onPressHighlightedLine={highlightCopilotChanges ? () => openHistoryCompare(latestHistory) : null}
        />
        <View style={styles.microActionRowWrap}>
          <MiniAction label="Generate Draft" primary onPress={onGenerateDraft} />
          <MiniAction label="Edit Draft" onPress={openDraftEditor} />
          <MiniAction label="Validate Draft" onPress={onValidateDraft} />
          <MiniAction label="Auto Fix Issues" onPress={onAutoFixIssues} />
          <MiniAction label="Build Filing Pack" onPress={onBuildFilingPack} />
          <MiniAction label="Download Draft" onPress={() => onExport?.("draft", "download")} />
          <MiniAction label="Share Draft" onPress={() => onExport?.("draft", "share")} />
        </View>
      </SectionBlock>
      <DocumentChecklistSection matter={matter} matterState={matterState} onExport={onExport} />
      {latestSupportEntries.length ? (
        <SectionBlock kicker="Support map" title="Supported by">
          <SupportMapBlock title="Current draft support" entries={latestSupportEntries} onEntryPress={(entry) => onOpenInsightDetail?.(entry.label, entry)} />
        </SectionBlock>
      ) : null}
      {readiness.unsupportedCount ? (
        <SectionBlock kicker="Unsupported review" title="Review-required draft points">
          <View style={styles.summaryStack}>
            {readiness.unsupportedPoints.map((item, index) => (
              <SummaryItem key={`unsupported-${index}`} label={`Point ${index + 1}`} value={item} />
            ))}
            {readiness.unsupportedDraftExcerpts?.map((item, index) => (
              <TouchableOpacity
                key={`unsupported-excerpt-${index}`}
                activeOpacity={0.9}
                onPress={() => onFixUnsupportedExcerpt?.(item)}
                style={styles.selectableCard}
              >
                <Text style={styles.summaryLabel}>{`Excerpt ${index + 1}`}</Text>
                <InteractiveText style={styles.summaryValue}>{item}</InteractiveText>
                <View style={styles.selectableFooter}>
                  <Text style={styles.summaryAction}>Fix in Copilot</Text>
                  <Text style={styles.selectableArrow}>Open</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ) : null}
      {draftHistory.length ? (
        <SectionBlock kicker="History" title="Recent draft changes">
          <View style={styles.summaryStack}>
            {draftHistory.slice(0, 3).map((item, index) => (
              <TouchableOpacity
                key={`${item.timestamp}-${index}`}
                activeOpacity={0.9}
                onPress={() => openHistoryCompare(item)}
                style={styles.selectableCard}
              >
                <Text style={styles.summaryLabel}>{`Version ${draftHistory.length - index}`}</Text>
                <InteractiveText style={styles.summaryValue}>
                  {item.patch || item.previousDraft || "Draft update saved."}
                </InteractiveText>
                {item.patchMeta?.title ? (
                  <InteractiveText style={styles.legalInsightMeta}>{`Source: ${item.patchMeta.title}`}</InteractiveText>
                ) : null}
                {item.patchMeta?.supportEntries?.length ? (
                  <InteractiveText style={styles.legalInsightSupport}>{`Supported by: ${item.patchMeta.supportEntries.map((entry) => entry.title).join(" | ")}`}</InteractiveText>
                ) : null}
                <View style={styles.selectableFooter}>
                  <Text style={styles.summaryAction}>Compare / restore</Text>
                  <Text style={styles.selectableArrow}>Open</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ) : null}
      <SectionBlock kicker="Status" title="Draft progress">
        <View style={styles.quickStatsGrid}>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Draft</Text>
            <Text style={styles.quickStatValue}>{matterState?.draftStatus ?? matter.finalSummary.draftStatus}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Validation</Text>
            <Text style={styles.quickStatValue}>{matterState?.validation ?? matter.finalSummary.validation}</Text>
          </View>
          <View style={styles.quickStatCard}>
            <Text style={styles.quickStatLabel}>Changes</Text>
            <Text style={styles.quickStatValue}>{draftHistory.length ? `${draftHistory.length} saved` : "No edits yet"}</Text>
          </View>
        </View>
        <View style={styles.inlineActions}>
          <TouchableOpacity activeOpacity={0.9} onPress={onOpenCopilot} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>Open Copilot</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={onOpenSummary} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Final Summary</Text>
          </TouchableOpacity>
        </View>
      </SectionBlock>
    </ScrollView>
    <Modal visible={historyCompareVisible} animationType="fade" transparent onRequestClose={() => setHistoryCompareVisible(false)}>
      <View style={styles.detailModalOverlay}>
        <View style={styles.detailModalSheet}>
          <View style={styles.detailModalHead}>
            <View style={styles.detailModalHeadCopy}>
              <Text style={styles.sectionKicker}>Draft Compare</Text>
              <Text style={styles.detailModalTitle}>Copilot draft update</Text>
              <InteractiveText style={styles.detailModalMeta}>
                Highlighted Copilot lines nundi direct compare open ayindi. Ikkada current draft and previous version compare cheyyachu.
              </InteractiveText>
            </View>
            <TouchableOpacity activeOpacity={0.85} onPress={() => setHistoryCompareVisible(false)} style={styles.detailModalClose}>
              <Text style={styles.detailModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          {selectedHistoryItem ? (
            <ScrollView style={styles.detailModalScroll} contentContainerStyle={styles.detailModalScrollContent} showsVerticalScrollIndicator>
              <View style={styles.compareCard}>
                <Text style={styles.compareTitle}>Compare Draft Versions</Text>
                {selectedHistoryExcerpt ? (
                  <View style={styles.compareExcerptCard}>
                    <Text style={styles.compareLabel}>What changed</Text>
                    <InteractiveText style={styles.compareExcerptMeta}>
                      {selectedHistoryExcerpt.changedCount} changed line(s) found in the latest Copilot update.
                    </InteractiveText>
                    <View style={styles.compareExcerptCurrentCard}>
                      <Text style={styles.compareExcerptCurrentLabel}>Changed excerpt now</Text>
                      {selectedHistoryWordDiff?.current?.length ? (
                        <CompareDiffText segments={selectedHistoryWordDiff.current} />
                      ) : (
                        <InteractiveText style={styles.compareBody}>
                          {selectedHistoryExcerpt.currentExcerpt || "No changed excerpt captured."}
                        </InteractiveText>
                      )}
                    </View>
                    <View style={styles.compareExcerptPreviousCard}>
                      <Text style={styles.compareExcerptPreviousLabel}>Same area before</Text>
                      {selectedHistoryWordDiff?.previous?.length ? (
                        <CompareDiffText segments={selectedHistoryWordDiff.previous} />
                      ) : (
                        <InteractiveText style={styles.compareBody}>
                          {selectedHistoryExcerpt.previousExcerpt || "No previous excerpt available."}
                        </InteractiveText>
                      )}
                    </View>
                  </View>
                ) : null}
                <Text style={styles.compareLabel}>Current Draft</Text>
                <InteractiveText style={styles.compareBody}>{draftText}</InteractiveText>
                <Text style={styles.compareLabel}>Selected Previous Version</Text>
                <InteractiveText style={styles.compareBody}>
                  {selectedHistoryItem.previousDraft || "No previous draft snapshot recorded."}
                </InteractiveText>
                <Text style={styles.compareLabel}>Patch / Change Note</Text>
                <InteractiveText style={styles.compareBody}>
                  {selectedHistoryItem.patch || "No patch note recorded."}
                </InteractiveText>
                {selectedHistoryItem.patchMeta ? (
                  <>
                    <Text style={styles.compareLabel}>Source grounding</Text>
                    <InteractiveText style={styles.compareBody}>
                      {selectedHistoryItem.patchMeta.title || selectedHistoryItem.patchMeta.label || selectedHistoryItem.patchMeta.source || "Copilot update"}
                      {selectedHistoryItem.patchMeta.proposition ? ` | Proposition: ${selectedHistoryItem.patchMeta.proposition}` : ""}
                      {selectedHistoryItem.patchMeta.pinpointRef ? ` | Pinpoint: ${selectedHistoryItem.patchMeta.pinpointRef}` : ""}
                      {selectedHistoryItem.patchMeta.sourceLine ? ` | ${selectedHistoryItem.patchMeta.sourceLine}` : ""}
                    </InteractiveText>
                    {selectedHistoryItem.patchMeta.supportEntries?.length ? (
                      <SupportMapBlock title="Supported by" entries={selectedHistoryItem.patchMeta.supportEntries} compact onEntryPress={(entry) => onOpenInsightDetail?.(entry.label, entry)} />
                    ) : null}
                  </>
                ) : null}
              </View>
            </ScrollView>
          ) : null}
          {selectedHistoryItem ? (
            <View style={styles.detailModalActions}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  onRestoreHistory(selectedHistoryItem);
                  setHistoryCompareVisible(false);
                  setSelectedHistoryItem(null);
                }}
                style={styles.primaryAction}
              >
                <Text style={styles.primaryActionText}>Restore This Version</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
    <Modal visible={editorVisible} animationType="slide" transparent onRequestClose={() => setEditorVisible(false)}>
      <View style={styles.detailModalOverlay}>
        <View style={styles.detailModalSheet}>
          <View style={styles.detailModalHead}>
            <View style={styles.detailModalHeadCopy}>
              <Text style={styles.sectionKicker}>Manual Draft Edit</Text>
              <Text style={styles.detailModalTitle}>Edit selected text</Text>
              <InteractiveText style={styles.detailModalMeta}>
                Select any part of the draft, delete it, or replace it with corrected wording.
              </InteractiveText>
            </View>
            <TouchableOpacity activeOpacity={0.85} onPress={() => setEditorVisible(false)} style={styles.detailModalClose}>
              <Text style={styles.detailModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.detailModalScroll} contentContainerStyle={styles.detailModalScrollContent}>
            <View style={styles.draftEditorCard}>
              <Text style={styles.draftEditorLabel}>Selected text</Text>
              <InteractiveText style={styles.draftEditorSelectedPreview}>{selectedPreview}</InteractiveText>
              <Text style={styles.draftEditorMeta}>
                Selection: {editorSelection.start}-{editorSelection.end}
              </Text>
            </View>

            <View style={styles.draftEditorCard}>
              <Text style={styles.draftEditorLabel}>Update selected text</Text>
              <TextInput
                value={replacementText}
                onChangeText={setReplacementText}
                placeholder="Type corrected wording here..."
                placeholderTextColor="#7a8ca7"
                multiline
                style={[styles.formInput, styles.formInputTall, styles.draftEditorReplaceInput]}
              />
              <View style={styles.microActionRowWrap}>
                <MiniAction label="Delete Selected" onPress={handleDeleteSelectedText} />
                <MiniAction label="Replace Selected" primary onPress={handleReplaceSelectedText} />
                <MiniAction label="Undo Last" onPress={handleUndoLastEdit} />
                <MiniAction label="Redo Last" onPress={handleRedoLastEdit} />
              </View>
            </View>

            <View style={styles.draftEditorCard}>
              <Text style={styles.draftEditorLabel}>Editable draft</Text>
              <TextInput
                value={editorText}
                onChangeText={handleEditorTextChange}
                multiline
                autoCorrect
                textAlignVertical="top"
                selection={editorSelection}
                onSelectionChange={(event) => {
                  const nextSelection = event?.nativeEvent?.selection;
                  if (nextSelection) {
                    setEditorSelection(nextSelection);
                  }
                }}
                style={styles.draftEditorInput}
              />
            </View>

            {editorChangeLog.length ? (
              <View style={styles.draftEditorCard}>
                <Text style={styles.draftEditorLabel}>Pending changes</Text>
                {editorChangeLog.map((item, index) => (
                  <InteractiveText key={`${item}-${index}`} style={styles.draftEditorChangeItem}>
                    {`${index + 1}. ${item}`}
                  </InteractiveText>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.detailModalActions}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => setEditorVisible(false)} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={handleSaveDraftEditor} style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>Save Draft</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

function CaseEditorScreen({ currentRole, initialMatter, clients, prefillClient, onBack, onSave }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const [selectedClientId, setSelectedClientId] = useState(initialMatter?.clientId ?? prefillClient?.id ?? "");
  const [client, setClient] = useState(initialMatter?.client ?? prefillClient?.name ?? "");
  const [title, setTitle] = useState(initialMatter?.title ?? "");
  const [type, setType] = useState(initialMatter?.caseDetails.type ?? "");
  const [court, setCourt] = useState(initialMatter?.caseDetails.court ?? "");
  const [facts, setFacts] = useState(initialMatter?.caseDetails.facts ?? "");
  const [documents, setDocuments] = useState(initialMatter?.caseDetails.documents ?? "");
  const [phone, setPhone] = useState(initialMatter?.profile.phone ?? prefillClient?.phone ?? "");
  const [location, setLocation] = useState(initialMatter?.profile.location ?? "");
  const [note, setNote] = useState(initialMatter?.profile.note ?? prefillClient?.notes ?? "");

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar
        title={
          initialMatter
            ? isFirm
              ? "Edit Matter"
              : isSenior
                ? "Review Intake"
                : "Edit Case"
            : isFirm
              ? "New Matter"
              : isSenior
                ? "Review Intake"
                : "New Case"
        }
        subtitle={initialMatter ? initialMatter.title : isFirm ? "Create a new matter" : "Create a new matter"}
        onBack={onBack}
      />
      <WorkspaceBanner
        kicker={isSenior ? "Review Intake" : "Stage 1"}
        title={
          initialMatter
            ? isSenior
              ? "Review and update intake details"
              : isFirm
                ? "Update matter details"
                : "Update case details"
            : isSenior
              ? "Review new intake"
              : isFirm
                ? "Create matter intake"
                : "Create case intake"
        }
        subtitle={
          isSenior
            ? "Review client, facts, forum details, and supporting material before moving the matter into review workflows."
            : isFirm
              ? "Capture client, matter facts, forum details, and documents so oversight and final outputs stay linked."
              : "Add client, matter facts, court details, and documents so the workflow can continue into draft and research."
        }
      />
      <SectionBlock kicker="Client" title={isFirm ? "Client record" : "Profile"}>
        {clients?.length ? (
          <View style={styles.clientPickerRow}>
            {clients.slice(0, 6).map((item) => (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.9}
                onPress={() => {
                  setSelectedClientId(item.id);
                  setClient(item.name || "");
                  setPhone(item.phone || "");
                  setNote(item.notes || "");
                }}
                style={[
                  styles.clientPickerChip,
                  selectedClientId === item.id ? styles.clientPickerChipActive : null
                ]}
              >
                <Text
                  style={[
                    styles.clientPickerChipText,
                    selectedClientId === item.id ? styles.clientPickerChipTextActive : null
                  ]}
                >
                  {item.name || "Client"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View style={styles.formStack}>
          <TextInput value={client} onChangeText={setClient} placeholder="Client name" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={location} onChangeText={setLocation} placeholder="Location" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={note} onChangeText={setNote} placeholder="Client note" placeholderTextColor="#7a8ca7" style={[styles.formInput, styles.formInputTall]} multiline />
        </View>
      </SectionBlock>
      <SectionBlock kicker="Matter" title={isFirm ? "Matter details" : "Case details"}>
        <View style={styles.formStack}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Case title" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={type} onChangeText={setType} placeholder="Matter type" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={court} onChangeText={setCourt} placeholder="Court / forum" placeholderTextColor="#7a8ca7" style={styles.formInput} />
          <TextInput value={facts} onChangeText={setFacts} placeholder="Raw facts" placeholderTextColor="#7a8ca7" style={[styles.formInput, styles.formInputTall]} multiline />
          <TextInput value={documents} onChangeText={setDocuments} placeholder="Documents" placeholderTextColor="#7a8ca7" style={[styles.formInput, styles.formInputTall]} multiline />
        </View>
        <View style={styles.inlineActions}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() =>
              onSave({
                ...initialMatter,
                client: client || "New Client",
                clientId: selectedClientId,
                title: title || "Untitled Matter",
                stage: initialMatter?.stage ?? "Intake",
                status: initialMatter?.status ?? "Intake captured",
                profile: {
                  phone: phone || "Not provided",
                  location: location || "Not provided",
                  note: note || "Client note to be added"
                },
                caseDetails: {
                  type: type || "General Matter",
                  court: court || "Not set",
                  nextDate: initialMatter?.caseDetails.nextDate ?? "Not scheduled",
                  facts: facts || "Facts to be added",
                  documents: documents || "Documents to be added"
                },
                research: initialMatter?.research ?? {
                  issues: ["Issues to be mapped"],
                  authorities: ["Authorities to be selected"],
                  citations: ["Citations to be selected"],
                  arguments: ["Arguments to be developed"]
                },
                finalSummary: initialMatter?.finalSummary ?? {
                  draftStatus: "Draft pending",
                  validation: "Awaiting intake completion",
                  filingPack: "No pack yet"
                }
              })
            }
            style={styles.primaryAction}
          >
            <Text style={styles.primaryActionText}>
              {initialMatter
                ? isFirm
                  ? "Save Matter"
                  : isSenior
                    ? "Save Review Copy"
                    : "Save Changes"
                : isFirm
                  ? "Create Matter"
                  : isSenior
                    ? "Save Intake Review"
                    : "Create Case"}
            </Text>
          </TouchableOpacity>
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function ToolsScreen({ currentRole, activeMatter, onBack, onOpenSection }) {
  const [query, setQuery] = useState("");
  const [toolFilter, setToolFilter] = useState("all");
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const coreTools = isSenior
    ? [
        { id: "cases", title: "Review Queue", subtitle: "Open or switch review matters" },
        { id: "clients", title: "Clients", subtitle: "Browse linked client profiles" },
        { id: "case-editor", title: "New Review Case", subtitle: "Create a new matter intake quickly" },
        { id: "copilot", title: "Senior Copilot", subtitle: "Approval notes and stronger draft reasoning" },
        { id: "research", title: "Research Review", subtitle: "Authorities, citations, and argument quality" },
        { id: "draft", title: "Draft Review", subtitle: "Inspect the current pleading text" },
        { id: "summary", title: "Approval Summary", subtitle: "Validation and approval outputs" },
        { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets and review notes" },
        { id: "archived", title: "Archived", subtitle: "Restore archived matters and clients" },
        { id: "help", title: "Help", subtitle: "Quick walkthrough and trust guide" }
      ]
    : isFirm
      ? [
          { id: "cases", title: "Matters", subtitle: "Open or switch live matters" },
          { id: "clients", title: "Clients", subtitle: "Browse linked client and owner records" },
          { id: "case-editor", title: "New Matter", subtitle: "Create a new matter intake quickly" },
          { id: "copilot", title: "Firm Copilot", subtitle: "Oversight, reports, and workspace guidance" },
          { id: "research", title: "Research Status", subtitle: "Authorities, citations, and strategy signals" },
          { id: "draft", title: "Draft Status", subtitle: "Review current pleading progress" },
          { id: "summary", title: "Matter Summary", subtitle: "Validation, filing, and final reports" },
          { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets and firm notes" },
          { id: "archived", title: "Archived", subtitle: "Restore archived matters and clients" },
          { id: "help", title: "Help", subtitle: "Quick walkthrough and trust guide" }
        ]
      : [
          { id: "cases", title: "Cases", subtitle: "Open or switch saved matters" },
          { id: "clients", title: "Clients", subtitle: "Browse linked client profiles" },
          { id: "case-editor", title: "New Case", subtitle: "Create a new matter intake quickly" },
          { id: "copilot", title: "Copilot", subtitle: "Draft refinement and legal chat" },
          { id: "research", title: "Research", subtitle: "Authorities, citations, and arguments" },
          { id: "draft", title: "Draft", subtitle: "Review current pleading text" },
          { id: "summary", title: "Final Summary", subtitle: "Validation and filing outputs" },
          { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets and Copilot notes" },
          { id: "archived", title: "Archived", subtitle: "Restore archived cases and clients" },
          { id: "help", title: "Help", subtitle: "Quick walkthrough and trust guide" }
        ];

  const groupedAdvancedTools = advancedToolCatalog.reduce((acc, item) => {
    acc[item.category] = [...(acc[item.category] ?? []), item];
    return acc;
  }, {});
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (item) =>
    `${item.title} ${item.subtitle} ${item.category || ""} ${item.status || ""}`.toLowerCase().includes(normalizedQuery);
  const filteredCoreTools = coreTools.filter((item) => matchesQuery(item));
  const filteredAdvancedEntries = Object.entries(groupedAdvancedTools)
    .filter(([group]) => toolFilter === "all" || toolFilter === group)
    .map(([group, items]) => [group, items.filter((item) => matchesQuery(item))])
    .filter(([, items]) => items.length);

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BackBar
          title={isSenior ? "Review Tools" : isFirm ? "Firm Tools" : "Tools"}
          subtitle={activeMatter ? activeMatter.title : "Quick legal utilities"}
          onBack={onBack}
        />
        <WorkspaceBanner
          kicker={isSenior ? "Review Tools" : isFirm ? "Firm Tools" : "Tools"}
          title={isSenior ? "Review and approval utility hub" : isFirm ? "Oversight and reporting utility hub" : "Legal utility hub"}
          subtitle={
            isSenior
              ? "Open review workflows quickly, then explore advanced research and drafting utilities for approval work."
              : isFirm
                ? "Open oversight workflows quickly, then use advanced tools for status checks, reporting, and filing review."
                : "Open core workflows quickly, then explore advanced research and drafting utilities from the web workspace."
          }
          status={activeMatter ? "Matter linked" : "Select matter"}
        />
        <SectionBlock kicker="Overview" title="Tool coverage">
          <View style={styles.quickStatsGrid}>
            <View style={styles.quickStatCard}>
              <Text style={styles.quickStatLabel}>{isSenior ? "Review" : isFirm ? "Oversight" : "Core"}</Text>
              <Text style={styles.quickStatValue}>{coreTools.length}</Text>
            </View>
            <View style={styles.quickStatCard}>
              <Text style={styles.quickStatLabel}>Advanced</Text>
              <Text style={styles.quickStatValue}>{advancedToolCatalog.length}</Text>
            </View>
            <View style={styles.quickStatCard}>
              <Text style={styles.quickStatLabel}>{isFirm ? "Matter Mode" : "Case Mode"}</Text>
              <Text style={styles.quickStatValue}>{activeMatter ? "Linked" : "General"}</Text>
            </View>
          </View>
      </SectionBlock>
      <View style={styles.searchShell}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tools, judgments, prediction, templates..."
          placeholderTextColor="#7a8ca7"
          style={styles.searchInput}
        />
      </View>
      <View style={styles.casesToolbar}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setToolFilter("all")} style={[styles.casesToolbarChip, toolFilter === "all" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, toolFilter === "all" ? styles.casesToolbarLabelActive : null]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setToolFilter("Research Library")} style={[styles.casesToolbarChip, toolFilter === "Research Library" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, toolFilter === "Research Library" ? styles.casesToolbarLabelActive : null]}>Research</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setToolFilter("Draft Support")} style={[styles.casesToolbarChip, toolFilter === "Draft Support" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, toolFilter === "Draft Support" ? styles.casesToolbarLabelActive : null]}>Draft</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setToolFilter("Review & Strategy")} style={[styles.casesToolbarChip, toolFilter === "Review & Strategy" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, toolFilter === "Review & Strategy" ? styles.casesToolbarLabelActive : null]}>Strategy</Text>
        </TouchableOpacity>
      </View>
      <SectionBlock kicker="Core" title="Everyday actions">
        <View style={styles.workspaceTileGrid}>
          {filteredCoreTools.map((item) => (
            <TouchableOpacity key={item.id} activeOpacity={0.9} onPress={() => onOpenSection(item.id)} style={styles.workspaceTile}>
              <Text style={styles.workspaceTileTitle}>{item.title}</Text>
              <Text style={styles.workspaceTileSubtitle}>{item.subtitle}</Text>
              <Text style={styles.workspaceTileHint}>Open</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SectionBlock>
      {filteredAdvancedEntries.map(([group, items]) => (
        <SectionBlock key={group} kicker="Advanced" title={group}>
          <View style={styles.workspaceTileGrid}>
            {items.map((item) => (
              <TouchableOpacity key={item.id} activeOpacity={0.9} onPress={() => onOpenSection(item.id)} style={styles.workspaceTile}>
                <Text style={styles.workspaceTileTitle}>{item.title}</Text>
                <Text style={styles.workspaceTileSubtitle}>{item.subtitle}</Text>
                <Text style={styles.workspaceTileHint}>{item.status}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ))}
      {!filteredCoreTools.length && !filteredAdvancedEntries.length ? (
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateTitle}>No tools found</Text>
          <Text style={styles.emptyStateText}>Try another keyword like judgments, prediction, arguments, or templates.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function HelpScreen({ currentRole, activeMatter, onBack, onOpenSection }) {
  const [language, setLanguage] = useState("english");
  const help = HELP_CONTENT[language] ?? HELP_CONTENT.english;
  const roleLabel = roleConfigs[currentRole]?.label ?? "Lawyer";

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar
        title="Help"
        subtitle={activeMatter ? activeMatter.title : `${roleLabel} walkthrough`}
        onBack={onBack}
      />
      <WorkspaceBanner
        kicker="Guide"
        title={help.heroTitle}
        subtitle={help.heroSubtitle}
        status={activeMatter ? "Matter linked" : "Quick start"}
      />

      <View style={styles.casesToolbar}>
        {Object.entries(HELP_CONTENT).map(([key, value]) => (
          <TouchableOpacity
            key={key}
            activeOpacity={0.9}
            onPress={() => setLanguage(key)}
            style={[styles.casesToolbarChip, language === key ? styles.casesToolbarChipActive : null]}
          >
            <Text style={[styles.casesToolbarLabel, language === key ? styles.casesToolbarLabelActive : null]}>
              {value.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionBlock kicker="Quick Start" title="Use the app in 4 steps">
        <View style={styles.summaryStack}>
          {help.quickStart.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.decisionReasonRow}>
              <Text style={styles.decisionReasonDot}>{index + 1}.</Text>
              <InteractiveText style={styles.decisionReasonText}>{item}</InteractiveText>
            </View>
          ))}
        </View>
        <View style={styles.microActionRow}>
          <MiniAction label="Open Cases" primary onPress={() => onOpenSection("cases")} />
          <MiniAction label="Open Tools" onPress={() => onOpenSection("tools")} />
        </View>
      </SectionBlock>

      <SectionBlock kicker="Copilot" title="How to use Copilot">
        <View style={styles.summaryStack}>
          {help.copilot.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.decisionReasonRow}>
              <Text style={styles.decisionReasonDot}>-</Text>
              <InteractiveText style={styles.decisionReasonText}>{item}</InteractiveText>
            </View>
          ))}
        </View>
      </SectionBlock>

      <SectionBlock kicker="Trust" title="What the trust signals mean">
        <View style={styles.summaryStack}>
          {help.trust.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.decisionReasonRow}>
              <Text style={styles.decisionReasonDot}>-</Text>
              <InteractiveText style={styles.decisionReasonText}>{item}</InteractiveText>
            </View>
          ))}
        </View>
      </SectionBlock>

      <SectionBlock kicker="Demo" title="Best demo flow">
        <View style={styles.summaryStack}>
          {help.demo.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.decisionReasonRow}>
              <Text style={styles.decisionReasonDot}>{index + 1}.</Text>
              <InteractiveText style={styles.decisionReasonText}>{item}</InteractiveText>
            </View>
          ))}
        </View>
        <View style={styles.microActionRow}>
          <MiniAction label="Open Cases" primary onPress={() => onOpenSection("cases")} />
          <MiniAction label="Open Copilot" onPress={() => onOpenSection(activeMatter ? "copilot" : "cases")} />
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function ToolWorkspaceScreen({ tool, currentRole, activeMatter, matterState, onBack, onOpenSection, onSendInsightToCopilot, onUseInsightInResearch, onSaveInsight, onOpenInsightDetail }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const matterLabel = activeMatter ? activeMatter.title : "Select a case to continue";
  const authorityEntries = activeMatter ? getAuthorityEntries(activeMatter, matterState) : [];
  const citationEntries = activeMatter ? getCitationEntries(activeMatter, matterState) : [];
  const toolInsight = (() => {
    if (!activeMatter) {
      return {
        summary: "Select a case first to unlock case-specific legal tool output.",
        points: [
          isSenior ? "Open Review Queue" : isFirm ? "Open Matters" : "Open Cases",
          "Choose a matter",
          "Come back here to use the tool with live context."
        ]
      };
    }

    switch (tool.id) {
      case "prediction":
        return {
          summary: `This matter currently looks best positioned around ${getResearchEntryText(activeMatter.research.arguments?.[0], "the lead argument")}, but validation and draft completion still matter before filing.`,
          points: [
          `Likely strength: ${getResearchEntryText(authorityEntries?.[0], "Authority support to be added")}`,
          `Risk point: ${activeMatter.finalSummary?.validation ?? "Validation review awaited"}`,
            `Best next move: tighten the draft around ${getResearchEntryText(activeMatter.research.issues?.[0], "the first issue")}`
          ]
        };
      case "arguments":
        return {
          summary: "Argument Builder is using the current issue, authority, and citation stack to prepare pleading-ready argument lines.",
          points: [
          getResearchEntryText(activeMatter.research.arguments?.[0], "Primary argument to be developed"),
          getResearchEntryText(activeMatter.research.arguments?.[1], getResearchEntryText(activeMatter.research.issues?.[0], "Secondary argument to be developed")),
            `Support with ${getResearchEntryText(citationEntries?.[0], "the latest citation")}`
          ]
        };
      case "document":
        return {
          summary: `Document Analyzer can work from: ${activeMatter.caseDetails.documents || "No documents attached yet"}`,
          points: [
            "Extract useful fact lines from annexures and screenshots.",
            "Push evidentiary points into Research or Copilot.",
            "Highlight missing documents before filing."
          ]
        };
      case "memory":
        return {
          summary: "Smart Memory uses saved snippets and recurring case patterns to speed up repeat drafting.",
          points: [
            "Reuse saved Copilot notes.",
            "Pin recurring client fact patterns.",
            "Load saved drafting memory back into Copilot."
          ]
        };
      case "judgments":
        return {
          summary: "Judgment workspace focuses on latest matched authorities and usable holdings for the selected matter.",
          points: [
          getResearchEntryText(authorityEntries?.[0], "Primary authority to be selected"),
          getResearchEntryText(authorityEntries?.[1], getResearchEntryText(citationEntries?.[0], "Secondary authority to be selected")),
            "Send strong holdings to Copilot for draft refinement."
          ]
        };
      case "citations":
        return {
          summary: "Citation workspace helps verify, reuse, and insert the most relevant references into draft and arguments.",
          points: [
          getResearchEntryText(citationEntries?.[0], "Primary citation to be selected"),
          getResearchEntryText(citationEntries?.[1], getResearchEntryText(authorityEntries?.[0], "Secondary citation to be selected")),
            "Use the cleanest citation in the next edit."
          ]
        };
      case "case-studies":
        return {
          summary: "Case Studies surfaces similar matter patterns and reusable strategy from the current case type.",
          points: [
            `Current type: ${activeMatter.caseDetails.type}`,
            "Compare relief structure with prior similar matters.",
            "Reuse strategy blocks in Research or Draft."
          ]
        };
      case "templates":
        return {
          summary: "Template Library gives reusable structure for notices, complaints, and petitions.",
          points: [
            "Pick a template skeleton.",
            "Send structure into Draft.",
            "Use Copilot to adapt the template to this matter."
          ]
        };
      case "mapping":
        return {
          summary: "Legacy Mapping helps convert older statutory or procedural labels into the current case workflow.",
          points: [
            "Map old labels to current references.",
            "Normalize legacy notes before filing.",
            "Keep older client records usable."
          ]
        };
      default:
        return {
          summary: tool.description,
          points: ["Open the linked case.", "Review Research.", "Use Copilot to apply the tool output into Draft."]
        };
    }
  })();
  const primaryInsight = toolInsight.points?.[0] || toolInsight.summary;
  const toolEvidenceItems = !activeMatter
    ? []
    : tool.id === "judgments"
      ? authorityEntries.slice(0, 2).map((item) => ({ label: "Authority", item }))
      : tool.id === "citations"
        ? citationEntries.slice(0, 2).map((item) => ({ label: "Citation", item }))
        : tool.id === "prediction" || tool.id === "arguments"
          ? [
              ...(authorityEntries?.[0] ? [{ label: "Authority", item: authorityEntries[0] }] : []),
              ...(citationEntries?.[0] ? [{ label: "Citation", item: citationEntries[0] }] : [])
            ]
          : [];

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BackBar title={tool.title} subtitle={matterLabel} onBack={onBack} />
        <WorkspaceBanner
          kicker={isSenior ? `Senior ${tool.category}` : isFirm ? `Firm ${tool.category}` : tool.category}
          title={tool.title}
          subtitle={
            isSenior
              ? `${tool.description} Use this tool to improve review quality and approval clarity.`
              : isFirm
                ? `${tool.description} Use this tool for oversight, reporting, and filing visibility.`
                : tool.description
          }
          status={tool.status}
        />
      <SectionBlock kicker="What this tool does" title="Workflow fit">
        <View style={styles.summaryStack}>
          <SummaryItem label="Linked case" value={matterLabel} />
          <SummaryItem label="Category" value={tool.category} />
          <SummaryItem label="Status" value={tool.status} />
        </View>
        <View style={styles.inlineActions}>
          <MiniAction label={activeMatter ? "Open Research" : "Open Cases"} onPress={() => onOpenSection(activeMatter ? "research" : "cases")} primary />
        <MiniAction
          label={activeMatter ? "Open Copilot" : currentRole === "firm" ? "Select Matter" : currentRole === "senior" ? "Select Review" : "Select Case"}
          onPress={() => onOpenSection(activeMatter ? "copilot" : "cases")}
        />
          <MiniAction label={activeMatter ? "Open Draft" : "Case List"} onPress={() => onOpenSection(activeMatter ? "draft" : "cases")} />
        </View>
      </SectionBlock>
      <SectionBlock kicker="Live view" title="Tool output">
        <View style={styles.summaryStack}>
          <InteractiveText style={styles.workspaceTileSubtitle}>{toolInsight.summary}</InteractiveText>
          {toolInsight.points.map((point, index) => (
            <View key={`${tool.id}-point-${index}`} style={styles.caseMetaRow}>
              <Text style={styles.caseMetaBullet}>•</Text>
              <InteractiveText style={styles.caseMetaText}>{point}</InteractiveText>
            </View>
          ))}
          <View style={styles.inlineActions}>
            <MiniAction
              label="Send to Copilot"
              primary
              onPress={() => onSendInsightToCopilot(tool.title, primaryInsight)}
            />
            <MiniAction
              label="Use in Research"
              onPress={() => onUseInsightInResearch(tool.title, primaryInsight)}
            />
            <MiniAction
              label="Save Note"
              onPress={() => onSaveInsight(`${tool.title}: ${primaryInsight}`)}
            />
          </View>
        </View>
      </SectionBlock>
      {toolEvidenceItems.length ? (
        <SectionBlock kicker="Linked evidence" title="Authority snapshot">
          <View style={styles.summaryStack}>
            {toolEvidenceItems.map((entry, index) => (
              <LegalInsightCard
                key={`${tool.id}-evidence-${entry.label}-${index}-${getResearchEntryText(entry.item)}`}
                label={entry.label}
                item={entry.item}
                onPress={() => onSendInsightToCopilot(entry.label, entry.item)}
                onDetailPress={() => onOpenInsightDetail?.(entry.label, entry.item)}
              />
            ))}
          </View>
        </SectionBlock>
      ) : null}
      <SectionBlock kicker="Connected actions" title="Use with the rest of the app">
        <View style={styles.summaryStack}>
          <InteractiveText style={styles.workspaceTileSubtitle}>
            {activeMatter
              ? `${tool.title} is now visible as a focused workspace. Start in this tool, then move to Research, Copilot, or Draft with the same selected case.`
              : `${tool.title} works best after selecting a case. Open Cases first, then use this tool with matter-specific facts, research, and draft context.`}
          </InteractiveText>
          <InteractiveText style={styles.workspaceTileSubtitle}>
            Mobile now exposes the same legal tool family as the web app: judgments, citations, case studies, argument building, prediction, document analysis, templates, mapping, and memory.
          </InteractiveText>
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function SavedNotesScreen({ currentRole, activeMatter, matterState, savedSnippets, onBack, onUseNote }) {
  const matterNotes = matterState?.savedNotes ?? [];
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <BackBar
        title={isSenior ? "Review Notes" : isFirm ? "Workspace Notes" : "Saved Notes"}
        subtitle={activeMatter ? activeMatter.title : isFirm ? "Reusable workspace notes" : "Reusable Copilot snippets"}
        onBack={onBack}
      />
      <WorkspaceBanner
        kicker="Notes Library"
        title="Saved drafting snippets"
        subtitle={
          isSenior
            ? "Reuse saved review notes, drafting phrases, and helpful legal text quickly."
            : isFirm
              ? "Reuse saved workspace notes, drafting phrases, and helpful legal text quickly."
              : "Reuse saved Copilot notes, client drafting phrases, and helpful legal text quickly."
        }
        status={activeMatter ? "Matter linked" : "General"}
      />

      {matterNotes.length ? (
        <SectionBlock kicker={isSenior ? "Review Notes" : "Matter Notes"} title={isSenior ? "Current matter review notes" : "Current matter saved notes"}>
          <View style={styles.summaryStack}>
            {matterNotes.map((item, index) => (
              <TouchableOpacity
                key={`${item}-${index}`}
                activeOpacity={0.9}
                onPress={() => onUseNote(item)}
                style={styles.selectableCard}
              >
                <InteractiveText style={styles.summaryValue}>{item}</InteractiveText>
                <View style={styles.selectableFooter}>
                  <Text style={styles.summaryAction}>Use in Copilot</Text>
                  <Text style={styles.selectableArrow}>Open</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBlock>
      ) : null}

        <SectionBlock kicker="Saved" title={isFirm ? "Workspace Library" : "Library"}>
        <View style={styles.summaryStack}>
          {savedSnippets.length ? savedSnippets.map((item, index) => (
            <TouchableOpacity
              key={`${item}-${index}`}
              activeOpacity={0.9}
              onPress={() => onUseNote(item)}
              style={styles.selectableCard}
            >
              <InteractiveText style={styles.summaryValue}>{item}</InteractiveText>
              <View style={styles.selectableFooter}>
                <Text style={styles.summaryAction}>Use in Copilot</Text>
                <Text style={styles.selectableArrow}>Open</Text>
              </View>
            </TouchableOpacity>
          )) : (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateTitle}>No saved notes yet</Text>
              <Text style={styles.emptyStateText}>Save text from Copilot or other screens to build a reusable note library.</Text>
            </View>
          )}
        </View>
      </SectionBlock>
    </ScrollView>
  );
}

function ArchivedScreen({ currentRole, archivedMatters, archivedClients, onBack, onRestoreMatter, onRestoreClient }) {
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";

  const normalizedQuery = query.trim().toLowerCase();
  const filteredMatters = archivedMatters.filter((matter) => {
    const searchText = `${matter.title} ${matter.client} ${matter.caseDetails.type} ${matter.status || ""}`.toLowerCase();
    return searchText.includes(normalizedQuery);
  });
  const filteredClients = archivedClients.filter((client) => {
    const searchText = `${client.name || ""} ${client.phone || ""} ${client.notes || ""}`.toLowerCase();
    return searchText.includes(normalizedQuery);
  });

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BackBar
          title="Archived"
          subtitle={
            isSenior
              ? "Restore archived review matters and clients when needed."
              : isFirm
                ? "Restore archived matters and client records when needed."
                : "Restore archived cases and clients when needed."
          }
          onBack={onBack}
        />
        <WorkspaceBanner
          kicker="Archive"
          title="Archived records"
          subtitle={
            isSenior
              ? "Hidden review matters and clients stay here until you restore them back into the working lists."
              : isFirm
                ? "Hidden matters and client records stay here until you restore them back into the working lists."
                : "Hidden cases and clients stay here until you restore them back into the working lists."
          }
          status={`${archivedMatters.length + archivedClients.length} items`}
        />

      <View style={styles.searchShell}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search archived case, client, phone, or note"
          placeholderTextColor="#7a8ca7"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.casesToolbar}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("all")} style={[styles.casesToolbarChip, filterMode === "all" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "all" ? styles.casesToolbarLabelActive : null]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("cases")} style={[styles.casesToolbarChip, filterMode === "cases" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "cases" ? styles.casesToolbarLabelActive : null]}>Cases</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={() => setFilterMode("clients")} style={[styles.casesToolbarChip, filterMode === "clients" ? styles.casesToolbarChipActive : null]}>
          <Text style={[styles.casesToolbarLabel, filterMode === "clients" ? styles.casesToolbarLabelActive : null]}>Clients</Text>
        </TouchableOpacity>
      </View>

      {filterMode !== "clients" ? (
        <SectionBlock kicker="Cases" title="Archived matters">
          {filteredMatters.length ? (
            filteredMatters.map((matter) => (
              <View key={matter.id} style={styles.caseCard}>
                <Text style={styles.caseTitle}>{matter.title}</Text>
                <InteractiveText style={styles.caseClient}>{matter.client}</InteractiveText>
                <InteractiveText style={styles.caseStatus}>{matter.status || "Archived"}</InteractiveText>
                <InteractiveText style={styles.caseMetaDetail}>{matter.caseDetails.type}</InteractiveText>
                <View style={styles.inlineActions}>
                  <TouchableOpacity activeOpacity={0.9} onPress={() => onRestoreMatter(matter)} style={styles.primaryAction}>
                    <Text style={styles.primaryActionText}>Restore Case</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
            ) : (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateTitle}>{isSenior ? "No archived review matters" : isFirm ? "No archived matters" : "No archived cases"}</Text>
                <Text style={styles.emptyStateText}>
                  {isSenior
                    ? "Archived review matters will appear here so you can restore them later."
                    : "Archived matters will appear here so you can restore them later."}
                </Text>
              </View>
            )}
          </SectionBlock>
      ) : null}

      {filterMode !== "cases" ? (
        <SectionBlock kicker="Clients" title="Archived client profiles">
          {filteredClients.length ? (
            filteredClients.map((client) => (
              <View key={client.id} style={styles.caseCard}>
                <Text style={styles.caseTitle}>{client.name || "Client"}</Text>
                <InteractiveText style={styles.caseClient}>{client.phone || "Phone not available"}</InteractiveText>
                {client.notes ? <InteractiveText style={styles.caseMetaDetail}>{client.notes}</InteractiveText> : null}
                <View style={styles.inlineActions}>
                  <TouchableOpacity activeOpacity={0.9} onPress={() => onRestoreClient(client)} style={styles.primaryAction}>
                    <Text style={styles.primaryActionText}>Restore Client</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
            ) : (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateTitle}>No archived clients</Text>
                <Text style={styles.emptyStateText}>
                  {isFirm ? "Archived client records will appear here for later recovery." : "Archived client profiles will appear here for later recovery."}
                </Text>
              </View>
            )}
        </SectionBlock>
      ) : null}
    </ScrollView>
  );
}

function CopilotScreen({
  currentRole,
  matter,
  matterState,
  generalSyncStatus,
  onBack,
  backLabel = "Back",
  floatingMode = false,
  onOpenCases,
  onMinimize,
  onToggleMaximize,
  isMaximized = false,
  onClose,
  onPromptChange,
  onSendPrompt,
  onApplyChange,
  onDismissPatch,
  onClearChat,
  onPickCamera,
  onPickScreenshot,
  onPickFile,
  generalPrompt,
  generalMessages,
  onGeneralPromptChange,
  onSendGeneralPrompt,
  generalAttachments,
  onPickGeneralCamera,
  onPickGeneralScreenshot,
  onPickGeneralFile,
  onSaveSnippet,
  onSaveMessageNote,
  onSaveMessageToProfile,
  onSaveMessageToResearch,
  onApplyMessageToDraft,
  onUseSuggestion,
  onUseSavedNote,
  onOpenInsightDetail
}) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const title = isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot";
  const subtitle = matter
    ? isSenior
      ? `${matter.title} review and approval assistant`
      : isFirm
        ? `${matter.title} oversight and reporting assistant`
        : `${matter.title} draft improvement assistant`
    : isSenior
      ? "Central review assistant for approval and stronger draft reasoning."
      : isFirm
        ? "Central oversight assistant for matter status and reporting."
        : "Central legal editor for draft improvement.";
  const activeMessages = matter ? (matterState?.chatMessages ?? []) : generalMessages;
  const copilotSyncStatus = matter ? (matterState?.copilotSyncStatus ?? "idle") : (generalSyncStatus || "idle");
  const isPreparingResponse = copilotSyncStatus === "sending";
  const hasStartedConversation = activeMessages.length > 1;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const messagesToRender = hasStartedConversation ? activeMessages : [];
  const scrollRef = useRef(null);
  const composerInputRef = useRef(null);
  const lastConversationTapRef = useRef(0);
  const [patchMinimized, setPatchMinimized] = useState(false);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [sessionReminder, setSessionReminder] = useState("");
  const previousSyncStatusRef = useRef(copilotSyncStatus);
  const promptValue = matter ? (matterState?.copilotPrompt ?? "") : generalPrompt;
  const setPromptValue = matter ? onPromptChange : onGeneralPromptChange;
  const handleSendPress = matter ? onSendPrompt : onSendGeneralPrompt;
  const patchPreview = matterState?.suggestedPatch
    ? `${matterState.suggestedPatch.slice(0, 140)}${matterState.suggestedPatch.length > 140 ? "..." : ""}`
    : "";
  const starterStateTitle = matter
    ? isSenior
      ? "Start with one review instruction"
      : isFirm
        ? "Start with one oversight instruction"
        : "Start with one drafting instruction"
    : "Start with one legal question";
  const starterStateNote = matter
    ? isSenior
      ? "Ask Copilot to review support gaps, sharpen approval notes, or strengthen draft reasoning for this matter."
      : isFirm
        ? "Ask Copilot to review matter status, filing blockers, or reporting clarity for this matter."
        : "Ask Copilot to improve a paragraph, verify legal support, or prepare the next draft step for this matter."
    : "Select a case for matter-specific work, or ask a general legal question to start the conversation.";
  const conversationHeading = matter ? `${matter.title} - Copilot Conversation` : "General Copilot Conversation";
  const fullConversationText = buildConversationTranscript(messagesToRender, conversationHeading);
  const compactConversationText = buildCompactConversationTranscript(messagesToRender);
  const latestUserMessage = [...activeMessages].reverse().find((item) => item.role === "user");
  const latestAssistantMessage = [...activeMessages].reverse().find((item) => item.role === "assistant");
  const progressModel = useMemo(
    () => buildCopilotProgressModel({
      promptText: latestUserMessage?.text || "",
      matter,
      matterState,
      activeActionId: isPreparingResponse && matter ? (matterState?.pendingCopilotAction || "") : ""
    }),
    [latestUserMessage?.text, matter, matterState, isPreparingResponse, matterState?.pendingCopilotAction]
  );
  const [progressStageIndex, setProgressStageIndex] = useState(0);

  useEffect(() => {
    if (matterState?.suggestedPatch) {
      setPatchMinimized(false);
    }
  }, [matterState?.suggestedPatch]);

  useEffect(() => {
    if (!isPreparingResponse || !progressModel?.stageLabels?.length) {
      setProgressStageIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setProgressStageIndex((current) => (current + 1) % progressModel.stageLabels.length);
    }, 950);

    return () => clearInterval(timer);
  }, [isPreparingResponse, progressModel]);

  useEffect(() => {
    const previousStatus = previousSyncStatusRef.current;
    previousSyncStatusRef.current = copilotSyncStatus;

    if (copilotSyncStatus === "sending") {
      setSessionReminder("");
      return;
    }

    if (previousStatus === "sending" && copilotSyncStatus === "ready") {
      setSessionReminder("Session complete");
      return;
    }

    if (previousStatus === "sending" && copilotSyncStatus === "error") {
      setSessionReminder("Session stopped");
    }
  }, [copilotSyncStatus]);
  const handleAttachPress = () => {
    const openGallery = matter ? onPickScreenshot : onPickGeneralScreenshot;
    const openFiles = matter ? onPickFile : onPickGeneralFile;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Gallery", "Files"],
          cancelButtonIndex: 0
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            openGallery();
          } else if (buttonIndex === 2) {
            openFiles();
          }
        }
      );
      return;
    }

    Alert.alert("Attach", "Choose what to upload", [
      { text: "Gallery", onPress: openGallery },
      { text: "Files", onPress: openFiles },
      { text: "Cancel", style: "cancel" }
    ]);
  };

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);

    return () => clearTimeout(timer);
  }, [messagesToRender.length, keyboardVisible, matterState?.suggestedPatch, generalAttachments.length, matterState?.attachments?.length]);

  const handleCopyEntireConversation = async () => {
    if (!fullConversationText.trim()) {
      return;
    }

    await Clipboard.setStringAsync(fullConversationText);
    Alert.alert("Copied", "Full conversation copied.");
  };

  const handleCopySingleMessage = async (message) => {
    const copyText = buildSingleMessageTranscript(message);
    if (!copyText.trim()) {
      return;
    }

    await Clipboard.setStringAsync(copyText);
    Alert.alert("Copied", message?.role === "user" ? "Message copied." : "Copilot response copied.");
  };

  const handleSaveSingleMessage = async (message) => {
    const noteText = buildCaseNoteDigest(message, matter);
    if (!noteText.trim()) {
      return;
    }

    await onSaveMessageNote?.(message, noteText);
  };

  const handleSaveMessageToProfile = async (message) => {
    await onSaveMessageToProfile?.(message);
  };

  const handleSaveMessageToResearch = async (message) => {
    await onSaveMessageToResearch?.(message);
  };

  const handleApplyMessageToDraft = async (message) => {
    await onApplyMessageToDraft?.(message);
  };

  const handleShareEntireConversation = async () => {
    if (!fullConversationText.trim()) {
      return;
    }

    await Share.share({ message: fullConversationText });
  };

  const handleConversationDoubleTap = () => {
    if (!hasStartedConversation) {
      return;
    }

    const now = Date.now();
    if (now - lastConversationTapRef.current < 300) {
      setSnapshotVisible(true);
    }
    lastConversationTapRef.current = now;
  };

  const handleCopilotScroll = (event) => {
    const offsetY = event?.nativeEvent?.contentOffset?.y ?? 0;
    setShowScrollToTop(offsetY > 220);
  };

  const handleScrollToTop = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const compactLiveStatus = isPreparingResponse
    ? (progressModel?.stageLabels?.[progressStageIndex] || "Thinking...")
    : "";
  const compactLiveReading = isPreparingResponse && progressModel?.readingItems?.length
    ? progressModel.readingItems.join(" | ")
    : "";

  const hasActiveWebTextSelection = () => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !window.getSelection) {
      return false;
    }

    try {
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && String(selection.toString() || "").trim());
    } catch (_error) {
      return false;
    }
  };

  const focusComposerInput = () => {
    if (hasActiveWebTextSelection()) {
      return;
    }
    setTimeout(() => {
      composerInputRef.current?.focus?.();
    }, 0);
  };

  useEffect(() => {
    focusComposerInput();
  }, [matter?.id]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboardScreen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 14 : 0}
    >
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        disableScrollViewPanResponder={Platform.OS === "web"}
        scrollEnabled
        scrollEventThrottle={16}
        onScroll={handleCopilotScroll}
        contentContainerStyle={[
          styles.scrollContent,
          styles.copilotScrollContent,
          keyboardVisible ? styles.copilotScrollContentKeyboard : null
        ]}
      >
        {!floatingMode ? <BackBar title={title} subtitle={subtitle} onBack={onBack} /> : null}
        {matter ? (
          <>
            <View style={styles.copilotMatterCard}>
              <View style={styles.copilotMatterCardHead}>
                <View>
                  <Text style={styles.copilotMatterLabel}>Selected Case</Text>
                  <Text style={styles.copilotMatterTitle}>{matter.title}</Text>
                </View>
                <Pill active>{matter.stage}</Pill>
              </View>
              <Text style={styles.copilotMatterMeta}>
                {matter.client} | {matter.caseDetails.type} | {matter.caseDetails.court}
              </Text>
            </View>
            <View style={styles.copilotContextStrip}>
              <Pill active>{matter.title}</Pill>
              <Pill>{matterState?.draftStatus ?? matter.finalSummary.draftStatus}</Pill>
              <Pill>{matterState?.lastResearchFocus ? matterState.lastResearchFocus.type : "General"}</Pill>
            </View>
            {matterState?.lastResearchFocus ? (
              <View style={styles.copilotFocusCard}>
                <Text style={styles.copilotFocusLabel}>Selected legal context</Text>
                <Text style={styles.copilotFocusTitle}>{matterState.lastResearchFocus.value}</Text>
                {matterState.lastResearchFocus?.insight?.proposition ? (
                  <Text style={styles.copilotFocusMeta}>Proposition: {matterState.lastResearchFocus.insight.proposition}</Text>
                ) : null}
                {matterState.lastResearchFocus?.insight?.pinpointRef ? (
                  <Text style={styles.copilotFocusMeta}>Pinpoint: {matterState.lastResearchFocus.insight.pinpointRef}</Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        {!hasStartedConversation ? (
          <View style={styles.copilotWelcomeStrip}>
            <Text style={styles.copilotWelcomeTitle}>
              {matter
                ? isSenior
                  ? "Senior review assistant is ready"
                  : isFirm
                    ? "Firm oversight assistant is ready"
                    : "Copilot can work on this matter"
                : isSenior
                  ? "Senior review assistant is ready"
                  : isFirm
                    ? "Firm oversight assistant is ready"
                    : "Copilot can help here"}
            </Text>
            <Text style={styles.copilotWelcomeText}>
              {matter
                ? isSenior
                  ? "Ask for review notes, stronger reasoning, approval comments, or draft improvements for this case."
                  : isFirm
                    ? "Ask for matter status, filing readiness, report clarity, or stronger oversight suggestions for this case."
                    : "Ask for draft changes, better arguments, citations, judgments, or filing improvements for this case."
                : isSenior
                  ? "Select a case and ask for review, approval, or stronger draft reasoning."
                  : isFirm
                    ? "Select a case and ask for oversight, status, or reporting help."
                    : "Select a case and ask about that matter, or ask a general legal question to begin."}
            </Text>
          </View>
        ) : null}

        {(() => {
          const ChatSurfaceComponent = Platform.OS === "web" ? View : Pressable;
          const chatSurfaceProps = Platform.OS === "web"
            ? {}
            : {
                onPress: handleConversationDoubleTap,
                onTouchEnd: handleConversationDoubleTap
              };

          return (
            <ChatSurfaceComponent
              {...chatSurfaceProps}
              style={[
                styles.chatSurfaceLarge,
                hasStartedConversation ? styles.chatSurfaceLargeStarted : styles.chatSurfaceLargeIdle
              ]}
            >
          <View style={styles.chatSurfaceHeader}>
            <Text style={styles.chatSurfaceTitle}>{hasStartedConversation ? "Conversation" : "Start chat"}</Text>
            {hasStartedConversation ? (
              <View style={styles.chatHeaderActions}>
                <TouchableOpacity activeOpacity={0.9} onPress={onClearChat} style={styles.chatHeaderAction}>
                  <Text style={styles.chatHeaderActionText}>Clear</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          {hasStartedConversation ? (
            <View style={styles.chatQuickActionsCard}>
              <Text style={styles.chatGestureHint}>Use these buttons directly. Native Select All meeda depend avvalsina avasaram ledu.</Text>
              <View style={styles.chatQuickActionsRow}>
                <TouchableOpacity activeOpacity={0.9} onPress={handleCopyEntireConversation} style={styles.chatQuickActionPrimary}>
                  <Text style={styles.chatQuickActionPrimaryText}>Copy Full Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.9} onPress={() => setSnapshotVisible(true)} style={styles.chatQuickActionSecondary}>
                  <Text style={styles.chatQuickActionSecondaryText}>Open Snapshot</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.chatGestureHint}>Double tap conversation kuda snapshot ni open chestundi.</Text>
            </View>
          ) : null}
          {(hasStartedConversation || copilotSyncStatus !== "idle") ? (
            <CopilotPreparationCard
              model={progressModel}
              activeStageIndex={progressStageIndex}
              status={copilotSyncStatus}
              lastMessageText={latestAssistantMessage?.text || ""}
            />
          ) : null}
          {!hasStartedConversation ? (
            <View style={styles.copilotStarterCard}>
              <Text style={styles.copilotStarterTitle}>{starterStateTitle}</Text>
              <InteractiveText style={styles.copilotStarterText}>{starterStateNote}</InteractiveText>
            </View>
          ) : null}
          <View style={styles.chatThread}>
            {messagesToRender.map((message, index) => {
              const BubbleComponent = Platform.OS === "web" ? View : Pressable;
              const bubbleProps = Platform.OS === "web"
                ? {}
                : { onLongPress: () => handleCopySingleMessage(message) };

              return (
                <BubbleComponent
                  key={`${message.role}-${index}`}
                  {...bubbleProps}
                  style={[
                    styles.chatBubble,
                    message.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAssistant
                  ]}
                >
                  <View style={styles.chatBubbleHeader}>
                    <Text style={styles.chatBubbleRole}>{message.role === "user" ? "You" : "Copilot"}</Text>
                    <View style={styles.chatBubbleActionRow}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => handleCopySingleMessage(message)}
                        style={styles.chatBubbleCopyAction}
                      >
                        <Text style={styles.chatBubbleCopyActionText}>Copy</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <InteractiveText
                    style={[
                      styles.chatBubbleText,
                      message.role === "user" ? styles.chatBubbleTextUser : null
                    ]}
                    selectAllText={message.text}
                    selectAllLabel="Copy Message"
                    selectable={Platform.OS === "web"}
                  >
                    {message.text}
                  </InteractiveText>
                  {message.role === "assistant" && message.supportEntries?.length ? (
                    <SupportMapBlock title={message.supportTitle || "Based on"} entries={message.supportEntries} compact onEntryPress={(entry) => onOpenInsightDetail?.(entry.label, entry)} />
                  ) : null}
                </BubbleComponent>
              );
            })}
          </View>
            </ChatSurfaceComponent>
          );
        })()}

      </ScrollView>

        <View pointerEvents="box-none" style={styles.copilotFloatingControls}>
          <TouchableOpacity activeOpacity={0.92} onPress={onBack} style={styles.copilotFloatingButton}>
            <Text style={styles.copilotFloatingButtonText}>{backLabel}</Text>
          </TouchableOpacity>
          {showScrollToTop ? (
            <TouchableOpacity activeOpacity={0.92} onPress={handleScrollToTop} style={styles.copilotFloatingIconButton}>
              <Text style={styles.copilotFloatingIconButtonText}>↑</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <Modal visible={snapshotVisible} animationType="fade" transparent onRequestClose={() => setSnapshotVisible(false)}>
        <View style={styles.detailModalOverlay}>
          <View style={styles.detailModalSheet}>
            <View style={styles.detailModalHead}>
              <View style={styles.detailModalHeadCopy}>
                <Text style={styles.sectionKicker}>Full Page Snapshot</Text>
                <Text style={styles.detailModalTitle}>{matter ? matter.title : "General Copilot"}</Text>
                <InteractiveText style={styles.detailModalMeta}>
                  Fixed full-screen view. Double tap/open chesina ventane screenshot teeseyochu.
                </InteractiveText>
              </View>
              <TouchableOpacity activeOpacity={0.85} onPress={() => setSnapshotVisible(false)} style={styles.detailModalClose}>
                <Text style={styles.detailModalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.detailModalScroll}
              contentContainerStyle={styles.detailModalScrollContent}
              showsVerticalScrollIndicator
            >
              <View style={styles.snapshotStaticBody}>
                <View style={styles.snapshotTranscriptCard}>
                  <Text style={styles.snapshotTranscriptTitle}>Conversation Snapshot</Text>
                  {messagesToRender.length ? (
                    <View style={styles.snapshotTranscriptList}>
                      {messagesToRender.map((message, index) => (
                        <View
                          key={`snapshot-${message.role}-${index}`}
                          style={[
                            styles.chatBubble,
                            message.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAssistant
                          ]}
                        >
                          <View style={styles.chatBubbleHeader}>
                            <Text style={styles.chatBubbleRole}>{message.role === "user" ? "You" : "Copilot"}</Text>
                            <View style={styles.chatBubbleActionRow}>
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() => handleCopySingleMessage(message)}
                                style={styles.chatBubbleCopyAction}
                              >
                                <Text style={styles.chatBubbleCopyActionText}>Copy</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <InteractiveText
                            style={[
                              styles.chatBubbleText,
                              message.role === "user" ? styles.chatBubbleTextUser : null
                            ]}
                            selectAllText={message.text}
                            selectAllLabel="Copy Message"
                            selectable={Platform.OS === "web"}
                          >
                            {message.text}
                          </InteractiveText>
                          {message.role === "assistant" && message.supportEntries?.length ? (
                            <SupportMapBlock
                              title={message.supportTitle || "Based on"}
                              entries={message.supportEntries}
                              compact
                              onEntryPress={(entry) => onOpenInsightDetail?.(entry.label, entry)}
                            />
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.snapshotTranscriptCompact}>No conversation yet.</Text>
                  )}
                </View>
              </View>
            </ScrollView>
            <View style={styles.detailModalActions}>
              <TouchableOpacity activeOpacity={0.9} onPress={handleCopyEntireConversation} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Copy All</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} onPress={handleShareEntireConversation} style={styles.primaryAction}>
                <Text style={styles.primaryActionText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View
        style={[
          styles.copilotFooter,
          keyboardVisible && Platform.OS === "android"
            ? { paddingBottom: Math.max(12, keyboardHeight + 10) }
            : null
        ]}
      >
        {isPreparingResponse ? (
          <View style={styles.copilotLiveStrip}>
            <ActivityIndicator color="#0f766e" size="small" />
            <Text style={styles.copilotLiveStripText}>{compactLiveStatus || "Thinking..."}</Text>
            {compactLiveReading ? (
              <Text style={styles.copilotLiveStripMeta}>{compactLiveReading}</Text>
            ) : null}
          </View>
        ) : null}
        {!isPreparingResponse && sessionReminder ? (
          <View style={styles.copilotSessionReminder}>
            <Text style={styles.copilotSessionReminderText}>{sessionReminder}</Text>
          </View>
        ) : null}
        {matter && matterState?.suggestedPatch ? (
        <View
          style={[
            styles.patchDock,
            keyboardVisible ? styles.patchDockKeyboard : null
          ]}
        >
          <View style={styles.patchDockHeader}>
            <View style={styles.patchDockCopy}>
              <Text style={styles.patchDockTitle}>Draft patch ready</Text>
              <Text style={styles.patchDockHint}>
                {patchMinimized ? "Tap + to review the patch." : "Review or apply this Copilot change."}
              </Text>
              {matterState?.suggestedPatchMeta?.title ? (
                <Text style={styles.patchDockSource}>
                  {matterState.suggestedPatchMeta.title}
                  {matterState.suggestedPatchMeta.proposition ? ` • ${matterState.suggestedPatchMeta.proposition}` : ""}
                  {matterState.suggestedPatchMeta.pinpointRef ? ` • ${matterState.suggestedPatchMeta.pinpointRef}` : ""}
                </Text>
              ) : null}
            </View>
            <View style={styles.patchDockActions}>
              <TouchableOpacity activeOpacity={0.9} onPress={onApplyChange} style={styles.patchApplyButton}>
                <Text style={styles.patchApplyButtonText}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} onPress={() => setPatchMinimized((current) => !current)} style={styles.patchIconButton}>
                <Text style={styles.patchIconButtonText}>{patchMinimized ? "+" : "-"}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} onPress={onDismissPatch} style={styles.patchIconButton}>
                <Text style={styles.patchIconButtonText}>x</Text>
              </TouchableOpacity>
            </View>
          </View>
          {!patchMinimized && matterState?.suggestedPatchMeta?.supportEntries?.length ? (
            <SupportMapBlock title="Supported by" entries={matterState.suggestedPatchMeta.supportEntries} compact onEntryPress={(entry) => onOpenInsightDetail?.(entry.label, entry)} />
          ) : null}
          <Text style={styles.patchDockPreview}>{patchPreview}</Text>
          {!patchMinimized ? <Text style={styles.patchDockBody}>{matterState.suggestedPatch}</Text> : null}
        </View>
        ) : null}

        <View
          style={[
            styles.chatComposerDock,
            keyboardVisible ? styles.chatComposerDockKeyboard : null
          ]}
        >
        <TextInput
          ref={composerInputRef}
          value={promptValue}
          onChangeText={setPromptValue}
          placeholder={matter ? "Ask Copilot to improve the draft..." : "Ask Copilot for legal guidance..."}
          placeholderTextColor="#7f92af"
          multiline
          autoFocus
          blurOnSubmit={false}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (Platform.OS !== "web") {
              handleSendPress?.();
              focusComposerInput();
            }
          }}
          onKeyPress={(event) => {
            if (Platform.OS !== "web") {
              return;
            }
            const key = event?.nativeEvent?.key;
            const shiftKey = Boolean(event?.nativeEvent?.shiftKey);
            if (key === "Enter" && !shiftKey) {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              handleSendPress?.();
              focusComposerInput();
            }
          }}
          onBlur={() => {
            if (Platform.OS === "web") {
              return;
            }
            if (!keyboardVisible) {
              focusComposerInput();
            }
          }}
          contextMenuHidden={false}
          autoCorrect
          style={styles.promptInputLarge}
        />
        {matter ? (
          (matterState?.attachments ?? []).length ? (
            <View style={styles.attachmentRow}>
              {(matterState?.attachments ?? []).map((item, index) => (
                <View key={`${item.name}-${index}`} style={styles.attachmentChip}>
                  <Text style={styles.attachmentChipText}>{item.name}</Text>
                </View>
              ))}
            </View>
          ) : null
        ) : generalAttachments.length ? (
          <View style={styles.attachmentRow}>
            {generalAttachments.map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.attachmentChip}>
                <Text style={styles.attachmentChipText}>{item.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.chatPrimaryRow}>
          {!keyboardVisible ? (
            <>
              <TouchableOpacity activeOpacity={0.9} onPress={onOpenCases} style={styles.chatSecondaryButtonCompact}>
                <Text style={styles.chatSecondaryButtonText}>Cases</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} onPress={matter ? onPickCamera : onPickGeneralCamera} style={styles.chatIconButton}>
                <Text style={styles.chatIconButtonText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} onPress={handleAttachPress} style={styles.chatIconButton}>
                <Text style={styles.chatIconButtonText}>Attach</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleSendPress}
            style={styles.chatSendButtonFill}
          >
            <Text style={styles.chatSendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function BottomNav({ currentRole, activeKey, onPress }) {
  const isSenior = currentRole === "senior";
  const isFirm = currentRole === "firm";
  const items = [
    { id: "home", label: "Home" },
    { id: "cases", label: isSenior ? "Queue" : isFirm ? "Matters" : "Cases" },
    { id: "research", label: isSenior ? "Review" : isFirm ? "Status" : "Research" },
    { id: "copilot", label: isSenior ? "Senior" : isFirm ? "Firm" : "Copilot" }
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          activeOpacity={0.9}
          onPress={() => onPress(item.id)}
          style={[styles.bottomNavItem, activeKey === item.id ? styles.bottomNavItemActive : null]}
        >
          <Text style={[styles.bottomNavText, activeKey === item.id ? styles.bottomNavTextActive : null]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function App() {
  const windowFrame = Dimensions.get("window");
  const initialCopilotDockX = Platform.OS === "web" ? Math.max(windowFrame.width - 470, 16) : 12;
  const initialCopilotDockY = Platform.OS === "web" ? 96 : 82;
  const [matters, setMatters] = useState(seededMatters);
  const [clients, setClients] = useState([]);
  const [screen, setScreen] = useState("home");
  const [currentRole, setCurrentRole] = useState(seededAccount.lastActiveRole || "lawyer");
  const [selectedToolId, setSelectedToolId] = useState(null);
  const [activeMatter, setActiveMatter] = useState(null);
  const [editingMatter, setEditingMatter] = useState(null);
  const [casePrefillClient, setCasePrefillClient] = useState(null);
  const [matterStates, setMatterStates] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [savedSnippets, setSavedSnippets] = useState([]);
  const [generalCopilotPrompt, setGeneralCopilotPrompt] = useState("");
  const [generalAttachments, setGeneralAttachments] = useState([]);
  const [generalCopilotSessionId, setGeneralCopilotSessionId] = useState("");
  const [generalCopilotStatus, setGeneralCopilotStatus] = useState("idle");
  const [lastNonCopilotScreen, setLastNonCopilotScreen] = useState("home");
  const [sessionAccount, setSessionAccount] = useState(null);
  const [authStatus, setAuthStatus] = useState("connecting");
  const [selectedInsightDetail, setSelectedInsightDetail] = useState(null);
  const [copilotDockVisible, setCopilotDockVisible] = useState(false);
  const [copilotDockMinimized, setCopilotDockMinimized] = useState(false);
  const [copilotDockMaximized, setCopilotDockMaximized] = useState(false);
  const liveResearchFetchRef = useRef({});
  const copilotDockPosition = useRef(new Animated.ValueXY({ x: initialCopilotDockX, y: initialCopilotDockY })).current;
  const copilotDockOffsetRef = useRef({ x: initialCopilotDockX, y: initialCopilotDockY });
  const [generalCopilotMessages, setGeneralCopilotMessages] = useState([
    {
      role: "assistant",
                  text: "Copilot is ready. Ask a legal question or open a case for matter-specific help."
    }
  ]);

  const effectiveAccount = sessionAccount ?? seededAccount;
  const effectiveDisplayName =
    sessionAccount?.displayName ||
    sessionAccount?.phone ||
    sessionAccount?.phoneNumber ||
    getDisplayName();
  const activeMatterState = activeMatter ? matterStates[activeMatter.id] : null;
  const visibleScreen = screen === "copilot"
    ? ((lastNonCopilotScreen && lastNonCopilotScreen !== "copilot")
      ? lastNonCopilotScreen
      : (activeMatter ? "workspace" : "home"))
    : screen;
  const selectedTool = selectedToolId
    ? advancedToolCatalog.find((item) => item.id === selectedToolId) ?? null
    : null;
  const archivedMatters = matters.filter((item) => item.archived === true);
  const archivedClients = clients.filter((item) => item.archived === true);
  const recentMatters = [...matters.filter((item) => item.archived !== true)]
        .sort((a, b) => new Date(b.lastOpenedAt || 0).getTime() - new Date(a.lastOpenedAt || 0).getTime())
        .slice(0, 3);
  const sessionLabel =
    authStatus === "connecting"
      ? "Syncing workspace"
      : "Workspace ready";
  const showBottomDrawer = Platform.OS !== "web" && ["workspace", "research", "summary", "draft", "tools", "tool-workspace"].includes(visibleScreen);
  const showBottomNav = Platform.OS !== "web" && !["home", "copilot"].includes(visibleScreen);

  useEffect(() => {
    if (screen !== "copilot") {
      setLastNonCopilotScreen(screen);
    }
  }, [screen]);

  useEffect(() => {
    if (screen !== "copilot") {
      return;
    }

    setCopilotDockVisible(true);
    setCopilotDockMinimized(false);

    const fallbackScreen = (lastNonCopilotScreen && lastNonCopilotScreen !== "copilot")
      ? lastNonCopilotScreen
      : (activeMatter ? "workspace" : "home");

    if (fallbackScreen !== "copilot") {
      setScreen(fallbackScreen);
    }
  }, [screen, lastNonCopilotScreen, activeMatter]);

  useEffect(() => {
    const listenerId = copilotDockPosition.addListener((value) => {
      copilotDockOffsetRef.current = value;
    });

    return () => {
      copilotDockPosition.removeListener(listenerId);
    };
  }, [copilotDockPosition]);

  const openCopilotDock = ({ maximized = false } = {}) => {
    setCopilotDockVisible(true);
    setCopilotDockMinimized(false);
    setCopilotDockMaximized(maximized);
  };

  const copilotDockPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !copilotDockMaximized,
    onMoveShouldSetPanResponder: (_event, gesture) => !copilotDockMaximized && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
    onPanResponderGrant: () => {
      copilotDockPosition.setOffset(copilotDockOffsetRef.current);
      copilotDockPosition.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event(
      [null, { dx: copilotDockPosition.x, dy: copilotDockPosition.y }],
      { useNativeDriver: false }
    ),
    onPanResponderRelease: () => {
      copilotDockPosition.flattenOffset();
    },
    onPanResponderTerminate: () => {
      copilotDockPosition.flattenOffset();
    }
  }), [copilotDockMaximized, copilotDockPosition]);

  const openInsightDetail = (label, item, primaryLabel = "", primaryAction = null) => {
    setSelectedInsightDetail({
      label,
      insight: normalizeResearchEntry(item, label),
      primaryLabel,
      primaryAction: primaryAction
        ? () => {
            setSelectedInsightDetail(null);
            primaryAction();
          }
        : null
    });
  };

  const sendUnsupportedExcerptToCopilot = (excerpt) => {
    if (!activeMatter) {
      setScreen("cases");
      return;
    }
    const prompt = `Strengthen or legally support this draft excerpt:\n\n"${excerpt}"`;
    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        copilotPrompt: prompt
      }
    }));
    setScreen("copilot");
  };

  const openRolePicker = () => {
    const options = [
      { id: "lawyer", label: "Lawyer" },
      { id: "senior", label: "Senior" },
      { id: "firm", label: "Firm" }
    ];

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", ...options.map((item) => item.label)],
          cancelButtonIndex: 0
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            setCurrentRole(options[buttonIndex - 1].id);
          }
        }
      );
      return;
    }

    Alert.alert(
      "Switch Role",
      "Choose the workspace role you want to use.",
      [
        ...options.map((item) => ({
          text: item.label,
          onPress: () => setCurrentRole(item.id)
        })),
        { text: "Cancel", style: "cancel" }
      ]
    );
  };

  useEffect(() => {
    let mounted = true;

    if (Platform.OS === "web") {
      setSessionAccount(null);
      setAuthStatus("fallback");
      return () => {
        mounted = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!mounted) {
        return;
      }

      if (user) {
        setSessionAccount({
          uid: user.uid,
          name: user.displayName || seededAccount.name,
          phone: user.phoneNumber || seededAccount.phone,
          lastActiveRole: seededAccount.lastActiveRole
        });
        setAuthStatus("live");
        return;
      }

      try {
        await signInAnonymously(auth);
      } catch (_error) {
        if (mounted) {
          setSessionAccount(null);
          setAuthStatus("fallback");
        }
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadPersistedState = async () => {
      try {
        const raw = await storageGetItem(APP_STORAGE_KEY);
        if (!raw) {
          if (mounted) {
            setIsHydrated(true);
          }
          return;
        }

        const saved = JSON.parse(raw);
        const restoredMatters = Array.isArray(saved.matters) && saved.matters.length ? saved.matters : seededMatters;
        const restoredScreen = ["home", "cases", "clients", "workspace", "profile", "details", "research", "summary", "copilot", "draft", "notes", "tools", "archived", "tool-workspace", "help"].includes(saved.screen)
          ? saved.screen
          : "home";
        const restoredMatter = saved.activeMatterId
          ? restoredMatters.find((item) => item.id === saved.activeMatterId) ?? null
          : null;
        const rawSnippets = await storageGetItem(SAVED_SNIPPETS_KEY);
        const restoredSnippets = rawSnippets ? JSON.parse(rawSnippets) : [];

        if (!mounted) {
          return;
        }

        setMatters(restoredMatters);
        setClients(saved.clients ?? []);
        setMatterStates(sanitizeMatterStates(saved.matterStates ?? {}, restoredMatters));
        setGeneralCopilotPrompt(saved.generalCopilotPrompt ?? "");
        setGeneralAttachments(saved.generalAttachments ?? []);
          setGeneralCopilotMessages(
            sanitizeCopilotMessages(
              Array.isArray(saved.generalCopilotMessages) ? saved.generalCopilotMessages : [],
              [
                {
                  role: "assistant",
                  text: "Copilot is ready. Ask a legal question or open a case for matter-specific help."
                }
              ]
            )
          );
          setCurrentRole(saved.currentRole ?? seededAccount.lastActiveRole ?? "lawyer");
          setActiveMatter(restoredMatter);
        setSelectedToolId(saved.selectedToolId ?? null);
        setScreen(restoredScreen === "case-editor" ? "home" : restoredScreen);
        setDrawerOpen(false);
        setSavedSnippets(Array.isArray(restoredSnippets) ? restoredSnippets : []);
        setIsHydrated(true);
      } catch (_error) {
        if (mounted) {
          setIsHydrated(true);
        }
      }
    };

    loadPersistedState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeMatter) {
      return;
    }

    const updatedMatter = matters.find((item) => item.id === activeMatter.id) ?? null;
    if (updatedMatter && updatedMatter !== activeMatter) {
      setActiveMatter(updatedMatter);
    }
  }, [matters, activeMatter]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let mounted = true;

    const syncRemoteCases = async () => {
      try {
        const remoteCases = await listRemoteCases(effectiveAccount.uid);
        const remoteClients = await listRemoteClients(effectiveAccount.uid);
        if (!mounted || !remoteCases.length) {
          if (mounted && remoteClients.length) {
            setClients(remoteClients);
            setCloudSyncReady(true);
          } else if (mounted) {
            setCloudSyncReady(true);
          }
          if (!remoteCases.length) {
            return;
          }
        }

        setMatters((current) => mergeRemoteCasesIntoMatters(current, remoteCases));
        setClients(remoteClients);
        setCloudSyncReady(true);
      } catch (_error) {
        if (mounted) {
          setCloudSyncReady(false);
        }
      }
    };

    syncRemoteCases();

    return () => {
      mounted = false;
    };
  }, [isHydrated, effectiveAccount.uid]);

  useEffect(() => {
    if (!isHydrated || !activeMatter) {
      return;
    }

    const fetchKey = `${effectiveAccount.uid}:${activeMatter.id}:${activeMatter.title}:${activeMatter.caseDetails?.type || ""}`;
    const existingState = matterStates[activeMatter.id];
    if (
      liveResearchFetchRef.current[fetchKey] &&
      (existingState?.liveResearch?.status === "ready" || existingState?.liveResearch?.status === "empty")
    ) {
      return;
    }

    let mounted = true;
    liveResearchFetchRef.current[fetchKey] = true;

    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        liveResearch: {
          ...((current[activeMatter.id] ?? buildInitialMatterState(activeMatter)).liveResearch || {}),
          status: "loading"
        }
      }
    }));

    retrieveLiveJudgments(effectiveAccount.uid, activeMatter, { limit: 6, useAiEnrichment: true, maxAiEnrichmentRecords: 3 })
      .then((result) => {
        if (!mounted) {
          return;
        }

        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            liveResearch: {
              status: result.judgments.length ? "ready" : "empty",
              judgments: result.judgments || [],
              fetchedSources: result.fetchedSources || [],
              sourceMode: result.sourceMode || "cache",
              query: result.query || "",
              fetchedAt: new Date().toISOString(),
              importReport: result.importReport || null
            }
          }
        }));
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            liveResearch: {
              ...((current[activeMatter.id] ?? buildInitialMatterState(activeMatter)).liveResearch || {}),
              status: "error",
              fetchedAt: new Date().toISOString()
            }
          }
        }));
      });

    return () => {
      mounted = false;
    };
  }, [isHydrated, activeMatter?.id, effectiveAccount.uid]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const persistState = async () => {
      try {
        await storageSetItem(
          APP_STORAGE_KEY,
          JSON.stringify({
            matters,
            clients,
            screen,
            selectedToolId,
            currentRole,
            activeMatterId: activeMatter?.id ?? null,
            matterStates,
            generalCopilotPrompt,
            generalAttachments,
            generalCopilotMessages
          })
        );
      } catch (_error) {
      }
    };

    persistState();
  }, [isHydrated, matters, clients, screen, selectedToolId, currentRole, activeMatter, matterStates, generalCopilotPrompt, generalAttachments, generalCopilotMessages]);

  const buildCopilotIntakePayload = (matter, matterState, options = {}) => {
    const includeDraft = options.includeDraft === true;
    const sourceScreen = options.sourceScreen || (screen === "copilot" ? lastNonCopilotScreen : screen);
    const screenContext = buildScreenAwareCopilotContext({
      screen,
      sourceScreen,
      activeMatter: matter,
      selectedTool
    });
    return {
      caseType: matter.caseDetails?.type || matter.title || "",
      factsSummary: matter.caseDetails?.facts || "",
      issues: Array.isArray(matter.research?.issues) ? matter.research.issues.map((item) => getResearchEntryText(item)).filter(Boolean) : [],
      jurisdiction: matter.caseDetails?.court || "",
      stage: matter.stage || "",
      documentType: /notice|complaint|petition|affidavit/i.test(String(matter.caseDetails?.type || ""))
        ? String(matter.caseDetails?.type || "").toLowerCase()
        : "notice",
      parties: {
        claimant: matter.client || matter.profile?.name || "",
        respondent: ""
      },
      reliefSought: matter.status || "",
      workspaceSummary: [
        buildAppCapabilitySummary(currentRole),
        screenContext,
        buildMatterCopilotWorkspaceSummary(matter, matterState)
      ].filter(Boolean).join("\n\n"),
      workspaceDraft: includeDraft ? (matterState?.currentDraft || "") : "",
      workspaceAuthorities: [
        ...(Array.isArray(matter.research?.authorities) ? matter.research.authorities : []),
        ...(Array.isArray(matter.research?.citations) ? matter.research.citations : [])
      ].map((item) => getResearchEntryText(item)).filter(Boolean),
      workspaceTab: screen,
      workspaceScreen: screen,
      workspaceSourceScreen: sourceScreen,
      workspaceAvailableActions: getScreenActionHints(sourceScreen || screen, {
        activeMatter: matter,
        selectedTool
      })
    };
  };

  const buildGeneralCopilotIntakePayload = (options = {}) => {
    const sourceScreen = options.sourceScreen || (screen === "copilot" ? lastNonCopilotScreen : screen);
    const screenContext = buildScreenAwareCopilotContext({
      screen,
      sourceScreen,
      activeMatter,
      selectedTool
    });

    return {
      caseType: "General App Guidance",
      factsSummary: "",
      issues: [],
      jurisdiction: "",
      stage: "general",
      documentType: "",
      parties: { claimant: "", respondent: "" },
      reliefSought: "",
      workspaceSummary: [
        buildAppCapabilitySummary(currentRole),
        screenContext
      ].filter(Boolean).join("\n\n"),
      workspaceDraft: "",
      workspaceAuthorities: [],
      workspaceTab: screen,
      workspaceScreen: screen,
      workspaceSourceScreen: sourceScreen,
      workspaceAvailableActions: getScreenActionHints(sourceScreen || screen, {
        activeMatter,
        selectedTool
      })
    };
  };

  const ensureMatterCopilotSession = async (matter, matterState) => {
    const existingSessionId = String(matterState?.copilotSessionId || "").trim();
    if (existingSessionId) {
      return existingSessionId;
    }

    const started = await startCopilotSession({
      ownerId: effectiveAccount.uid,
      matterId: matter.id || null
    });
    const nextSessionId = String(started?.session?.id || started?.sessionId || "").trim();
    if (!nextSessionId) {
      throw new Error("Copilot session was not created.");
    }

    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        copilotSessionId: nextSessionId,
        copilotSyncStatus: "started"
      }
    }));
    return nextSessionId;
  };

  const syncMatterCopilotSession = async (matter, matterState, sessionId, options = {}) => {
    const nextSessionId = sessionId || (await ensureMatterCopilotSession(matter, matterState));
    const payload = buildCopilotIntakePayload(matter, matterState, options);
    await submitCopilotIntake(nextSessionId, payload);
    await buildCopilotContext(nextSessionId, {});
    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        copilotSessionId: nextSessionId,
        copilotSyncStatus: "ready"
      }
    }));
    return nextSessionId;
  };

  const ensureGeneralCopilotSession = async () => {
    if (generalCopilotSessionId) {
      return generalCopilotSessionId;
    }
    const started = await startCopilotSession({
      ownerId: effectiveAccount.uid,
      matterId: null
    });
    const nextSessionId = String(started?.session?.id || started?.sessionId || "").trim();
    if (!nextSessionId) {
      throw new Error("Copilot session was not created.");
    }
    await submitCopilotIntake(nextSessionId, buildGeneralCopilotIntakePayload());
    setGeneralCopilotSessionId(nextSessionId);
    return nextSessionId;
  };

  const handleMatterDraftGeneration = async (matter, matterState) => {
    const baseState = matterState ?? buildInitialMatterState(matter);
    const sessionId = await syncMatterCopilotSession(matter, baseState, baseState.copilotSessionId, { includeDraft: true });
    const response = await generateCopilotDraft(sessionId, { documentType: "complaint" });
    const draftText = String(response?.document?.content || response?.memory?.workspaceDraft || "").trim();
    const generationMeta = response?.generationMeta || null;
    const nextWorkspaceState = {
      ...baseState,
      copilotSessionId: sessionId,
      currentDraft: draftText || baseState.currentDraft,
      draftStatus: generationMeta?.fallbackUsed
        ? `Draft ready (fallback: ${generationMeta.diagnosticCode || "provider unavailable"})`
        : "Draft generated",
      draftHistory: draftText
        ? [
            {
              timestamp: new Date().toISOString(),
              previousDraft: baseState.currentDraft ?? buildInitialMatterState(matter).currentDraft,
              patch: "Fresh draft generated from backend",
              patchMeta: null
            },
            ...(baseState.draftHistory ?? [])
          ].slice(0, 10)
        : (baseState.draftHistory ?? []),
      validation: baseState.validation ?? matter.finalSummary.validation,
      pendingCopilotAction: null,
      filingPack: baseState.filingPack ?? matter.finalSummary.filingPack
    };

    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        ...nextWorkspaceState
      }
    }));
    syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
      stage: "Draft",
      status: nextWorkspaceState.draftStatus
    });
    setScreen("draft");
    return {
      sessionId,
      draftText,
      generationMeta,
      response
    };
  };

  const handleMatterValidation = async (matter, matterState) => {
    const baseState = matterState ?? buildInitialMatterState(matter);
    const sessionId = await syncMatterCopilotSession(matter, baseState, baseState.copilotSessionId, { includeDraft: true });
    const response = await validateCopilotDraft(sessionId, {
      documentType: "complaint",
      documentText: baseState.currentDraft || ""
    });
    const report = response?.report || {};
    const nextWorkspaceState = {
      ...baseState,
      copilotSessionId: sessionId,
      validation: report.statusLabel || report.status || "Validation completed",
      pendingCopilotAction: null,
      validationReport: report
    };
    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        ...nextWorkspaceState
      }
    }));
    syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
      stage: "Final Summary",
      status: nextWorkspaceState.validation
    });
    setScreen("summary");
    return {
      sessionId,
      report,
      response
    };
  };

  const handleMatterAutoFixIssues = async (matter, matterState) => {
    const baseState = matterState ?? buildInitialMatterState(matter);
    const existingDraft = String(baseState.currentDraft || "").trim();
    if (!existingDraft) {
      throw new Error("Generate or open a draft before running auto-fix.");
    }

    const sessionId = await syncMatterCopilotSession(matter, baseState, baseState.copilotSessionId, { includeDraft: true });
    const response = await autoFixCopilotDraft(sessionId, {
      documentType: "complaint",
      documentText: existingDraft
    });
    const fixedDraft = String(response?.document?.content || response?.memory?.workspaceDraft || existingDraft).trim();
    const report = response?.report || {};
    const fixesApplied = Array.isArray(response?.fixesApplied) ? response.fixesApplied : [];
    const nextWorkspaceState = {
      ...baseState,
      copilotSessionId: sessionId,
      currentDraft: fixedDraft || baseState.currentDraft,
      draftStatus: fixesApplied.length
        ? `Auto-fix applied (${fixesApplied.length})`
        : response?.changed
          ? "Auto-fix reviewed current draft"
          : "No deterministic fixes applied",
      validation: report.statusLabel || report.status || "Validation completed",
      validationReport: report,
      pendingCopilotAction: null,
      filingPack: response?.changed ? "Rebuild filing pack after reviewing the auto-fixed draft" : baseState.filingPack,
      filingChecklist: response?.changed ? [] : baseState.filingChecklist,
      draftHistory: response?.changed
        ? [
            {
              timestamp: new Date().toISOString(),
              previousDraft: baseState.currentDraft ?? buildInitialMatterState(matter).currentDraft,
              patch: fixesApplied.length
                ? `Auto-fix applied: ${fixesApplied.join("; ")}`
                : "Auto-fix reviewed current draft",
              patchMeta: {
                source: "validation-autofix",
                fixesApplied
              }
            },
            ...(baseState.draftHistory ?? [])
          ].slice(0, 10)
        : baseState.draftHistory
    };

    setMatterStates((current) => {
      const existing = current[matter.id] ?? buildInitialMatterState(matter);
      const draftChanged = fixedDraft && fixedDraft !== String(existing.currentDraft || "").trim();

      return {
        ...current,
        [matter.id]: {
          ...existing,
          ...nextWorkspaceState,
          filingPack: draftChanged ? "Rebuild filing pack after reviewing the auto-fixed draft" : existing.filingPack,
          filingChecklist: draftChanged ? [] : existing.filingChecklist,
          draftHistory: draftChanged ? nextWorkspaceState.draftHistory : existing.draftHistory
        }
      };
    });
    syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
      stage: "Draft",
      status: nextWorkspaceState.draftStatus
    });
    setScreen("draft");
    return {
      sessionId,
      fixedDraft,
      report,
      fixesApplied,
      changed: Boolean(response?.changed),
      response
    };
  };

  const handleManualDraftEdit = (matter, matterState, nextDraft, editMeta = {}) => {
    const cleanedDraft = String(nextDraft || "").trim();
    if (!cleanedDraft) {
      throw new Error("Draft cannot be empty.");
    }
    const baseState = matterState ?? buildInitialMatterState(matter);
    const nextWorkspaceState = {
      ...baseState,
      currentDraft: cleanedDraft,
      draftStatus: "Draft manually edited",
      validation: "Re-validate edited draft before filing",
      validationReport: null,
      filingPack: "Rebuild filing pack after reviewing manual edits",
      filingChecklist: [],
      draftHistory: [
        {
          timestamp: new Date().toISOString(),
          previousDraft: baseState.currentDraft ?? buildInitialMatterState(matter).currentDraft,
          patch: editMeta.actions?.length
            ? `Manual edit: ${editMeta.actions.join("; ")}`
            : "Manual draft edit from editor",
          patchMeta: {
            source: "manual-editor",
            selectionPreview: editMeta.selectedPreview || ""
          }
        },
        ...(baseState.draftHistory ?? [])
      ].slice(0, 10)
    };

    setMatterStates((current) => {
      const existing = current[matter.id] ?? buildInitialMatterState(matter);
      return {
        ...current,
        [matter.id]: {
          ...existing,
          ...nextWorkspaceState
        }
      };
    });
    syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
      stage: "Draft",
      status: nextWorkspaceState.draftStatus
    });
  };

  const handleMatterFilingPack = async (matter, matterState) => {
    const baseState = matterState ?? buildInitialMatterState(matter);
    const sessionId = await syncMatterCopilotSession(matter, baseState, baseState.copilotSessionId, { includeDraft: true });
    const response = await fetchFilingGuidance(sessionId, {});
    const checklist = Array.isArray(response?.checklist) ? response.checklist : [];
    const nextWorkspaceState = {
      ...baseState,
      copilotSessionId: sessionId,
      filingPack: checklist.length ? "Filing pack checklist ready" : "Filing pack ready",
      pendingCopilotAction: null,
      filingChecklist: checklist
    };
    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        ...nextWorkspaceState
      }
    }));
    syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
      stage: "Final Summary",
      status: nextWorkspaceState.filingPack
    });
    setScreen("summary");
    return {
      sessionId,
      checklist,
      response
    };
  };

  const handleMatterExport = async (type, mode = "share") => {
    if (!activeMatter) return;
    const packet = buildExportPacket(type, activeMatter, activeMatterState);
    const exportLabelByType = {
      draft: "Draft pack",
      share: "Share pack",
      validation: "Validation report",
      filing: "Filing pack",
      documents: "Document pack",
      arguments: "Arguments pack",
      summary: "Case summary"
    };

    if (mode === "download") {
      const fileUri = await saveExportPacketToFile(type, packet);
      setMatterStates((current) => ({
        ...current,
        [activeMatter.id]: {
          ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
          lastExportAction: `Saved ${exportLabelByType[type] ?? "export"}`
        }
      }));
      Alert.alert(
        "Saved",
        Platform.OS === "web"
          ? `Download started for ${fileUri}`
          : `File saved locally.\n${fileUri}`
      );
      return;
    }

    const shareOutcome = await shareExportPacket(packet).catch(() => "failed");
    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        lastExportAction:
          shareOutcome === "copied"
            ? `Copied ${exportLabelByType[type] ?? "export"}`
            : `Shared ${exportLabelByType[type] ?? "export"}`
      }
    }));
    if (shareOutcome === "copied") {
      Alert.alert("Copied", `${exportLabelByType[type] ?? "Export"} copied to clipboard.`);
    }
  };

  const shouldAutoRunMatterAction = (actionId = "") => (
    [
      "drive_case_forward",
      "generate_then_validate",
      "generate_draft",
      "validate_draft",
      "autofix_then_validate",
      "autofix_draft",
      "build_filing_pack",
      "save_support_to_research",
      "save_to_profile",
      "save_to_research",
      "open_draft",
      "open_research",
      "open_summary",
      "open_profile"
    ].includes(String(actionId || "").trim())
  );

  const runMatterCopilotActionInChat = async (matter, matterState, actionId, options = {}) => {
    const failurePrefix = String(options.failurePrefix || "Action failed").trim();

    setMatterStates((current) => ({
      ...current,
      [matter.id]: {
        ...(current[matter.id] ?? buildInitialMatterState(matter)),
        copilotSyncStatus: "sending",
        pendingCopilotAction: actionId || null
      }
    }));

    try {
      const actionResult = await executeMatterCopilotAction(matter, matterState, actionId);
      setMatterStates((current) => ({
        ...current,
        [matter.id]: {
          ...(current[matter.id] ?? buildInitialMatterState(matter)),
          copilotSyncStatus: "ready",
          pendingCopilotAction: null,
          chatMessages: [
            ...((current[matter.id]?.chatMessages) ?? buildInitialMatterState(matter).chatMessages),
            ...(
              actionResult?.text
                ? [createCopilotMessage("assistant", actionResult.text)]
                : []
            )
          ]
        }
      }));
      return actionResult;
    } catch (error) {
      setMatterStates((current) => ({
        ...current,
        [matter.id]: {
          ...(current[matter.id] ?? buildInitialMatterState(matter)),
          copilotSyncStatus: "error",
          pendingCopilotAction: null,
          chatMessages: [
            ...((current[matter.id]?.chatMessages) ?? buildInitialMatterState(matter).chatMessages),
            createCopilotMessage("assistant", `${failurePrefix}: ${String(error?.message || "Unable to complete the action.")}`)
          ]
        }
      }));
      throw error;
    }
  };

  const executeMatterCopilotAction = async (matter, matterState, actionId) => {
    if (!matter) {
      throw new Error("Open a case first.");
    }

    const messageSource = getLatestActionableAssistantMessage(
      matterState?.chatMessages
      || matterStates[matter.id]?.chatMessages
      || buildInitialMatterState(matter).chatMessages
    );

    switch (actionId) {
      case "drive_case_forward": {
        let workingState = matterState ?? buildInitialMatterState(matter);
        let draftGenerated = false;
        let latestValidationReport = workingState.validationReport || null;
        let latestFilingChecklist = workingState.filingChecklist || [];
        let filingBuilt = false;
        const completedSteps = [];

        if (messageSource?.supportEntries?.length) {
          const researchUpdate = applyResearchSupportUpdateToMatter(matter, messageSource);
          if (researchUpdate.changed) {
            replaceMatterRecord(researchUpdate.nextMatter);
            persistMatterRemotely(researchUpdate.nextMatter, buildPersistableMatterState(workingState, researchUpdate.nextMatter));
            completedSteps.push(
              `Research updated (${researchUpdate.addedAuthorities} authorities, ${researchUpdate.addedCitations} citations, ${researchUpdate.addedArguments} arguments)`
            );
          }
        }

        if (!isSubstantiveMatterDraft(workingState.currentDraft)) {
          const draftResult = await handleMatterDraftGeneration(matter, workingState);
          draftGenerated = Boolean(String(draftResult?.draftText || "").trim());
          workingState = {
            ...workingState,
            copilotSessionId: draftResult?.sessionId || workingState.copilotSessionId,
            currentDraft: draftResult?.draftText || workingState.currentDraft
          };
          if (draftGenerated) {
            completedSteps.push("Draft generated");
          }
        }

        const validationResult = await handleMatterValidation(matter, workingState);
        latestValidationReport = validationResult?.report || null;
        workingState = {
          ...workingState,
          copilotSessionId: validationResult?.sessionId || workingState.copilotSessionId,
          validationReport: latestValidationReport
        };
        completedSteps.push("Validation reviewed");

        const needsAutoFix =
          Boolean((latestValidationReport?.criticalErrors || []).filter(Boolean).length)
          || Boolean((latestValidationReport?.warnings || []).filter(Boolean).length);
        if (needsAutoFix) {
          const autoFixResult = await handleMatterAutoFixIssues(matter, workingState);
          workingState = {
            ...workingState,
            copilotSessionId: autoFixResult?.sessionId || workingState.copilotSessionId,
            currentDraft: autoFixResult?.fixedDraft || workingState.currentDraft,
            validationReport: autoFixResult?.report || workingState.validationReport
          };
          if (autoFixResult?.changed) {
            completedSteps.push("Deterministic fixes applied");
            const postFixValidation = await handleMatterValidation(matter, workingState);
            latestValidationReport = postFixValidation?.report || latestValidationReport;
            workingState = {
              ...workingState,
              copilotSessionId: postFixValidation?.sessionId || workingState.copilotSessionId,
              validationReport: latestValidationReport
            };
            completedSteps.push("Validation re-run after fixes");
          }
        }

        const noCriticalErrors = !(latestValidationReport?.criticalErrors || []).filter(Boolean).length;
        const noMissingSections = !(latestValidationReport?.missingSections || []).filter(Boolean).length;
        if (noCriticalErrors && noMissingSections) {
          const filingResult = await handleMatterFilingPack(matter, workingState);
          latestFilingChecklist = filingResult?.checklist || [];
          filingBuilt = true;
          completedSteps.push("Filing pack prepared");
        }

        return {
          silent: true
        };
      }
      case "generate_then_validate": {
        const draftResult = await handleMatterDraftGeneration(matter, matterState);
        const nextState = {
          ...(matterState ?? buildInitialMatterState(matter)),
          copilotSessionId: draftResult?.sessionId || matterState?.copilotSessionId || "",
          currentDraft: draftResult?.draftText || matterState?.currentDraft || ""
        };
        const validationResult = await handleMatterValidation(matter, nextState);
        return {
          silent: true
        };
      }
      case "generate_draft": {
        const result = await handleMatterDraftGeneration(matter, matterState);
        if (!result?.draftText) {
          throw new Error("Draft generation returned no content.");
        }
        return { silent: true };
      }
      case "validate_draft": {
        await handleMatterValidation(matter, matterState);
        return { silent: true };
      }
      case "autofix_then_validate": {
        const autoFixResult = await handleMatterAutoFixIssues(matter, matterState);
        const nextState = {
          ...(matterState ?? buildInitialMatterState(matter)),
          copilotSessionId: autoFixResult?.sessionId || matterState?.copilotSessionId || "",
          currentDraft: autoFixResult?.fixedDraft || matterState?.currentDraft || "",
          validationReport: autoFixResult?.report || null
        };
        const validationResult = await handleMatterValidation(matter, nextState);
        return {
          silent: true
        };
      }
      case "autofix_draft": {
        await handleMatterAutoFixIssues(matter, matterState);
        return { silent: true };
      }
      case "build_filing_pack": {
        await handleMatterFilingPack(matter, matterState);
        return { silent: true };
      }
      case "save_support_to_research": {
        if (!messageSource?.supportEntries?.length) {
          throw new Error("No usable authorities or citations found in the recent AI reply.");
        }

        const researchUpdate = applyResearchSupportUpdateToMatter(matter, messageSource);
        if (!researchUpdate.changed) {
          setScreen("research");
          return { silent: true };
        }

        replaceMatterRecord(researchUpdate.nextMatter);
        persistMatterRemotely(researchUpdate.nextMatter);
        setScreen("research");
        return { silent: true };
      }
      case "save_to_profile": {
        if (!messageSource) {
          throw new Error("No recent AI reply found to save into profile.");
        }

        const noteText = buildCaseNoteDigest(messageSource, matter);
        const profileEntry = buildProfileNoteEntryFromMessage(messageSource, noteText);
        if (!profileEntry) {
          throw new Error("Could not extract a usable profile note from the recent AI reply.");
        }

        const nextMatter = {
          ...matter,
          profile: {
            ...(matter.profile || {}),
            note: appendUniqueCaseNote(matter.profile?.note || "", profileEntry)
          }
        };
        replaceMatterRecord(nextMatter);
        if (nextMatter.clientId) {
          setClients((current) =>
            current.map((item) => (
              item.id === nextMatter.clientId
                ? { ...item, notes: nextMatter.profile?.note || item.notes || "" }
                : item
            ))
          );
        }
        persistMatterRemotely(nextMatter);
        setScreen("profile");
        return { silent: true };
      }
      case "save_to_research": {
        if (!messageSource) {
          throw new Error("No recent AI reply found to save into research.");
        }

        const issueEntry = buildResearchIssueEntryFromMessage(messageSource, buildCaseNoteDigest(messageSource, matter));
        if (!issueEntry) {
          throw new Error("Could not extract a usable research issue from the recent AI reply.");
        }

        const nextMatter = {
          ...matter,
          research: {
            ...(matter.research || {}),
            issues: appendUniqueListItem(matter.research?.issues || [], issueEntry)
          }
        };
        replaceMatterRecord(nextMatter);
        persistMatterRemotely(nextMatter);
        setScreen("research");
        return { silent: true };
      }
      case "apply_to_draft": {
        if (!messageSource) {
          throw new Error("No recent AI reply found to apply into draft.");
        }

        const insertionText = buildDraftInsertionFromMessage(messageSource);
        if (!insertionText) {
          throw new Error("Could not extract usable draft content from the recent AI reply.");
        }

        const baseState = matterState ?? buildInitialMatterState(matter);
        const nextWorkspaceState = {
          ...baseState,
          currentDraft: `${String(baseState.currentDraft || "").trim()}\n\n${insertionText}`.trim(),
          draftStatus: "Draft updated from Copilot action",
          validation: "Re-validate updated draft before filing",
          validationReport: null,
          filingPack: "Rebuild filing pack after reviewing applied draft update",
          filingChecklist: [],
          pendingCopilotAction: null,
          draftHistory: [
            {
              timestamp: new Date().toISOString(),
              previousDraft: baseState.currentDraft ?? buildInitialMatterState(matter).currentDraft,
              patch: `Applied Copilot message to draft: ${String(messageSource?.text || "").trim().slice(0, 120)}`,
              patchMeta: {
                source: "copilot-message-apply"
              }
            },
            ...(baseState.draftHistory ?? [])
          ].slice(0, 10)
        };

        setMatterStates((current) => {
          const existing = current[matter.id] ?? buildInitialMatterState(matter);
          return {
            ...current,
            [matter.id]: {
              ...existing,
              ...nextWorkspaceState
            }
          };
        });
        syncMatterWorkspaceRecord(matter, nextWorkspaceState, {
          stage: "Draft",
          status: nextWorkspaceState.draftStatus
        });
        setScreen("draft");
        return { silent: true };
      }
      case "open_draft":
        setScreen("draft");
        return { silent: true };
      case "open_research":
        setScreen("research");
        return { silent: true };
      case "open_summary":
        setScreen("summary");
        return { silent: true };
      case "open_profile":
        setScreen("profile");
        return { silent: true };
      case "open_workspace":
        setScreen("workspace");
        return { silent: true };
      case "open_cases":
        setScreen("cases");
        return { silent: true };
      default:
        throw new Error("Unsupported action.");
    }
  };

  const refreshSavedSnippetState = async () => {
    try {
      const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
      setSavedSnippets(raw ? JSON.parse(raw) : []);
    } catch (_error) {
    }
  };

  const replaceMatterRecord = (nextMatter) => {
    setMatters((current) => current.map((item) => (item.id === nextMatter.id ? nextMatter : item)));
    if (activeMatter?.id === nextMatter.id) {
      setActiveMatter(nextMatter);
    }
  };

  const buildPersistableMatterState = (workspaceState = {}, matter = null) => {
    const source = workspaceState && typeof workspaceState === "object" ? workspaceState : {};
    return {
      draftStatus: String(source.draftStatus || matter?.finalSummary?.draftStatus || "").trim(),
      validation: String(source.validation || matter?.finalSummary?.validation || "").trim(),
      filingPack: String(source.filingPack || matter?.finalSummary?.filingPack || "").trim(),
      currentDraft: String(source.currentDraft || "").trim(),
      draftHistory: Array.isArray(source.draftHistory) ? source.draftHistory.slice(0, 10) : [],
      validationReport: source.validationReport || null,
      filingChecklist: Array.isArray(source.filingChecklist) ? source.filingChecklist : [],
      savedNotes: Array.isArray(source.savedNotes) ? source.savedNotes.slice(0, 20) : [],
      lastOpenedAt: source.lastOpenedAt || null
    };
  };

  const persistMatterRemotely = (nextMatter, nextWorkspaceState = null) => {
    const workspaceState = buildPersistableMatterState(
      nextWorkspaceState || matterStates[nextMatter.id] || nextMatter.workspaceState || {},
      nextMatter
    );
    saveRemoteCase(effectiveAccount.uid, {
      ...nextMatter,
      workspaceState,
      caseDetails: {
        ...nextMatter.caseDetails,
        nextDate: nextMatter.caseDetails?.nextDate || "Not scheduled"
      }
    }, nextMatter.clientId || "", workspaceState).catch(() => {});
  };

  const syncMatterWorkspaceRecord = (matter, workspaceStatePatch = {}, matterPatch = {}) => {
    if (!matter) {
      return null;
    }

    const existingState = matterStates[matter.id] ?? buildInitialMatterState(matter);
    const nextWorkspaceState = buildPersistableMatterState({
      ...existingState,
      ...workspaceStatePatch
    }, matter);
    const nextMatter = {
      ...matter,
      ...matterPatch,
      finalSummary: {
        ...(matter.finalSummary || {}),
        draftStatus: nextWorkspaceState.draftStatus || matter.finalSummary?.draftStatus || "Draft pending",
        validation: nextWorkspaceState.validation || matter.finalSummary?.validation || "Validation pending",
        filingPack: nextWorkspaceState.filingPack || matter.finalSummary?.filingPack || "Filing review pending"
      },
      workspaceState: nextWorkspaceState
    };

    replaceMatterRecord(nextMatter);
    persistMatterRemotely(nextMatter, nextWorkspaceState);
    return { nextMatter, nextWorkspaceState };
  };

  const appendMatterAssistantMessage = (messageText, suggestions = []) => {
    if (!activeMatter) {
      return;
    }

    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        chatMessages: [
          ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
          createCopilotMessage("assistant", messageText, { suggestions: suggestions.length ? suggestions : [] })
        ]
      }
    }));
  };

  const handleSaveMessageNote = async (message, prebuiltNoteText = "") => {
    const noteText = normalizeCaseNoteText(prebuiltNoteText || buildCaseNoteDigest(message, activeMatter));
    if (!noteText) {
      Alert.alert("Nothing to save", "This message does not contain note content yet.");
      return;
    }

    await saveSnippetToLibrary(noteText);
    await refreshSavedSnippetState();

    if (!activeMatter) {
      Alert.alert("Saved", "Note saved to your reusable snippets.");
      return;
    }

    const promoteToProfile = shouldPromoteSavedMessageToProfileNote(message, noteText);
    const profileNoteEntry = buildProfileNoteEntryFromMessage(message, noteText);
    const nextMatter = {
      ...activeMatter,
      profile: {
        ...(activeMatter.profile || {}),
        note: promoteToProfile
          ? appendUniqueCaseNote(activeMatter.profile?.note || "", profileNoteEntry)
          : (activeMatter.profile?.note || "")
      }
    };

    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        savedNotes: [
          noteText,
          ...((current[activeMatter.id]?.savedNotes ?? []).filter((item) => item !== noteText))
        ].slice(0, 20)
      }
    }));
    setMatters((current) => current.map((item) => (item.id === activeMatter.id ? nextMatter : item)));
    setActiveMatter(nextMatter);

    if (activeMatter.clientId) {
      setClients((current) =>
        current.map((item) => (
          item.id === activeMatter.clientId
            ? { ...item, notes: nextMatter.profile?.note || item.notes || "" }
            : item
        ))
      );
    }

    saveRemoteCase(effectiveAccount.uid, {
      ...nextMatter,
      caseDetails: {
        ...nextMatter.caseDetails,
        nextDate: nextMatter.caseDetails?.nextDate || "Not scheduled"
      }
    }, nextMatter.clientId || "").catch(() => {});

    Alert.alert(
      "Saved",
      promoteToProfile
        ? "Saved to case notes and reusable snippets."
        : "Saved to reusable matter notes."
    );
  };

  const handleSaveMessageToProfile = async (message) => {
    if (!activeMatter) {
      return;
    }

    const noteText = buildCaseNoteDigest(message, activeMatter);
    const profileEntry = buildProfileNoteEntryFromMessage(message, noteText);
    if (!profileEntry) {
      Alert.alert("Nothing to save", "Ee message nundi profile note create cheyyadaniki content ledu.");
      return;
    }

    Alert.alert("Approve save", "Ee message ni Profile note lo save cheyyala?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Approve",
        onPress: () => {
          const nextMatter = {
            ...activeMatter,
            profile: {
              ...(activeMatter.profile || {}),
              note: appendUniqueCaseNote(activeMatter.profile?.note || "", profileEntry)
            }
          };
          replaceMatterRecord(nextMatter);
          if (nextMatter.clientId) {
            setClients((current) =>
              current.map((item) => (
                item.id === nextMatter.clientId
                  ? { ...item, notes: nextMatter.profile?.note || item.notes || "" }
                  : item
              ))
            );
          }
          persistMatterRemotely(nextMatter);
          appendMatterAssistantMessage("Approved. Selected message ni Profile note lo save chesa.");
        }
      }
    ]);
  };

  const handleSaveMessageToResearch = async (message) => {
    if (!activeMatter) {
      return;
    }

    const issueEntry = buildResearchIssueEntryFromMessage(message, buildCaseNoteDigest(message, activeMatter));
    if (!issueEntry) {
      Alert.alert("Nothing to save", "Ee message nundi research issue create cheyyadaniki content ledu.");
      return;
    }

    Alert.alert("Approve save", "Ee message ni Research issues lo add cheyyala?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Approve",
        onPress: () => {
          const nextMatter = {
            ...activeMatter,
            research: {
              ...(activeMatter.research || {}),
              issues: appendUniqueListItem(activeMatter.research?.issues || [], issueEntry)
            }
          };
          replaceMatterRecord(nextMatter);
          persistMatterRemotely(nextMatter);
          appendMatterAssistantMessage("Approved. Selected message ni Research issues lo add chesa.");
        }
      }
    ]);
  };

  const handleApplyMessageToDraft = async (message) => {
    if (!activeMatter) {
      return;
    }

    const insertionText = buildDraftInsertionFromMessage(message);
    if (!insertionText) {
      Alert.alert("Nothing to apply", "Ee message nundi draft ki apply cheyyadaniki content ledu.");
      return;
    }

    Alert.alert("Approve draft update", "Ee message content ni current draft ki append cheyyala?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Approve",
        onPress: () => {
          const currentState = activeMatterState ?? buildInitialMatterState(activeMatter);
          const nextDraft = `${String(currentState.currentDraft || "").trim()}\n\n${insertionText}`.trim();

          setMatterStates((current) => {
            const existing = current[activeMatter.id] ?? buildInitialMatterState(activeMatter);
            return {
              ...current,
              [activeMatter.id]: {
                ...existing,
                currentDraft: nextDraft,
                draftStatus: "Draft updated from Copilot action",
                validation: "Re-validate updated draft before filing",
                validationReport: null,
                filingPack: "Rebuild filing pack after reviewing applied draft update",
                filingChecklist: [],
                draftHistory: [
                  {
                    timestamp: new Date().toISOString(),
                    previousDraft: existing.currentDraft ?? buildInitialMatterState(activeMatter).currentDraft,
                    patch: `Applied Copilot message to draft: ${String(message?.text || "").trim().slice(0, 120)}`,
                    patchMeta: {
                      source: "copilot-message-apply"
                    }
                  },
                  ...(existing.draftHistory ?? [])
                ].slice(0, 10)
              }
            };
          });

          appendMatterAssistantMessage("Approved. Selected message content ni draft lo apply chesa. Next ga Validate Draft run cheyyi.");
        }
      }
    ]);
  };

  const appendMatterAttachment = (attachment) => {
    if (!activeMatter) {
      return;
    }
    setMatterStates((current) => ({
      ...current,
      [activeMatter.id]: {
        ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
        attachments: [...((current[activeMatter.id]?.attachments) ?? []), attachment]
      }
    }));
  };

  const pickCameraAttachment = async (general = false) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    const asset = result.assets[0];
    const attachment = { name: asset.fileName || "camera-photo.jpg", uri: asset.uri, type: "camera" };
    if (general) {
      setGeneralAttachments((current) => [...current, attachment]);
      return;
    }
    appendMatterAttachment(attachment);
  };

  const pickLibraryAttachment = async (general = false) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    const asset = result.assets[0];
    const attachment = { name: asset.fileName || "gallery-item", uri: asset.uri, type: "media" };
    if (general) {
      setGeneralAttachments((current) => [...current, attachment]);
      return;
    }
    appendMatterAttachment(attachment);
  };

  const pickDocumentAttachment = async (general = false) => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    const asset = result.assets[0];
    const attachment = { name: asset.name || "document", uri: asset.uri, type: "file" };
    if (general) {
      setGeneralAttachments((current) => [...current, attachment]);
      return;
    }
    appendMatterAttachment(attachment);
  };

  const drawerActions = useMemo(() => {
    const isSenior = currentRole === "senior";
    const isFirm = currentRole === "firm";
    const homeActions = activeMatter
          ? [
              { id: "home", title: "Home", subtitle: "Launcher", primary: screen === "home" },
            { id: "cases", title: isSenior ? "Review Queue" : isFirm ? "Matters" : "Cases", subtitle: "Browse saved matters" },
              { id: "clients", title: "Clients", subtitle: "Browse linked client profiles" },
              { id: "archived", title: "Archived", subtitle: "Restore hidden records" },
              { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets and notes" },
              { id: "research", title: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", subtitle: "Issues, authorities, citations" },
              { id: "copilot", title: isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot", subtitle: "Current matter editor" },
              { id: "tools", title: "Tools", subtitle: "Quick legal utilities" }
            ]
          : [
              { id: "home", title: "Home", subtitle: "Launcher", primary: screen === "home" },
            { id: "cases", title: isSenior ? "Review Queue" : isFirm ? "Matters" : "Cases", subtitle: "Browse saved matters" },
              { id: "clients", title: "Clients", subtitle: "Browse linked client profiles" },
              { id: "archived", title: "Archived", subtitle: "Restore hidden records" },
              { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets and notes" },
              { id: "tools", title: "Tools", subtitle: "Quick legal utilities" }
            ];

    if (!activeMatter) {
      return homeActions;
    }

      if (screen === "research") {
        return [
          { id: "workspace", title: "Workspace", subtitle: activeMatter.title },
          { id: "copilot", title: isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot", subtitle: "Apply draft changes", primary: true },
          { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets" },
          { id: "draft", title: isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft", subtitle: "Review current draft" },
          { id: "summary", title: isSenior ? "Approval Summary" : isFirm ? "Matter Summary" : "Final Summary", subtitle: "Validation and filing" },
        { id: "cases", title: isSenior ? "Switch Review" : isFirm ? "Switch Matter" : "Switch Case", subtitle: "Browse saved matters" }
        ];
      }

      if (screen === "copilot") {
        return [
          { id: "research", title: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", subtitle: "Return to authorities", primary: true },
          { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets" },
          { id: "summary", title: isSenior ? "Approval Summary" : isFirm ? "Matter Summary" : "Final Summary", subtitle: "Validation and filing" },
          { id: "workspace", title: "Workspace", subtitle: activeMatter.title },
        { id: "cases", title: isSenior ? "Switch Review" : isFirm ? "Switch Matter" : "Switch Case", subtitle: "Browse saved matters" }
        ];
      }

      if (screen === "summary") {
        return [
          { id: "workspace", title: "Workspace", subtitle: activeMatter.title, primary: true },
          { id: "research", title: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", subtitle: "Review authorities" },
          { id: "copilot", title: isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot", subtitle: "Refine draft again" },
          { id: "draft", title: isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft", subtitle: "Review current draft" },
          { id: "cases", title: isSenior ? "Switch Review" : isFirm ? "Switch Matter" : "Switch Case", subtitle: "Browse saved matters" }
        ];
      }

      if (screen === "tool-workspace") {
        return [
          { id: "tools", title: "Tools", subtitle: "Return to toolbox", primary: true },
          { id: "research", title: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", subtitle: "Use this tool in research" },
          { id: "copilot", title: isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot", subtitle: "Send tool output to Copilot" },
          { id: "draft", title: isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft", subtitle: "Review working pleading" },
          { id: "cases", title: isSenior ? "Switch Review" : isFirm ? "Switch Matter" : "Switch Case", subtitle: "Browse saved matters" }
        ];
      }

      return [
        { id: "home", title: "Home", subtitle: "Launcher" },
        { id: "cases", title: isSenior ? "Review Queue" : isFirm ? "Matters" : "Cases", subtitle: "Switch active matter" },
        { id: "clients", title: "Clients", subtitle: "Browse linked client profiles" },
        { id: "archived", title: "Archived", subtitle: "Restore hidden records" },
        { id: "workspace", title: "Workspace", subtitle: activeMatter.title, primary: screen === "workspace" },
        { id: "profile", title: "Profile", subtitle: activeMatter.client },
        { id: "details", title: "Case Details", subtitle: activeMatter.caseDetails.type },
        { id: "research", title: isSenior ? "Research Review" : isFirm ? "Research Status" : "Research", subtitle: "Authorities and arguments" },
        { id: "draft", title: isSenior ? "Draft Review" : isFirm ? "Draft Status" : "Draft", subtitle: "Working pleading text" },
        { id: "notes", title: "Saved Notes", subtitle: "Reusable snippets" },
        { id: "copilot", title: isSenior ? "Senior Copilot" : isFirm ? "Firm Copilot" : "Copilot", subtitle: "Apply draft changes" },
        { id: "summary", title: isSenior ? "Approval Summary" : isFirm ? "Matter Summary" : "Final Summary", subtitle: "Validation and filing" },
        { id: "tools", title: "Tools", subtitle: "Quick legal utilities" }
      ];
    }, [activeMatter, currentRole, screen]);

  const renderFloatingCopilotSurface = () => (
    <CopilotScreen
      currentRole={currentRole}
      matter={activeMatter}
      matterState={activeMatterState}
      generalSyncStatus={generalCopilotStatus}
      onBack={() => setCopilotDockVisible(false)}
      backLabel="Close"
      floatingMode
      onOpenCases={() => setScreen("cases")}
      onPromptChange={(value) => {
        if (!activeMatter) return;
        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            copilotPrompt: value
          }
        }));
      }}
      onSendPrompt={async () => {
        if (!activeMatter) return;
        const currentState = activeMatterState ?? buildInitialMatterState(activeMatter);
        const promptText = (currentState.copilotPrompt || "").trim();
        if (!promptText) return;
        const attachmentLine = (currentState.attachments ?? []).length
          ? ` Attachments: ${(currentState.attachments ?? []).map((item) => item.name).join(", ")}.`
          : "";
        const userMessage = createCopilotMessage("user", `${promptText}${attachmentLine}`);
        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            chatMessages: [
              ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
              userMessage
            ],
            suggestedPatch: "",
            suggestedPatchMeta: null,
            copilotSyncStatus: "sending",
            copilotPrompt: "",
            attachments: []
          }
        }));

        const latestAssistantMessage = getLatestActionableAssistantMessage(
          currentState?.chatMessages || buildInitialMatterState(activeMatter).chatMessages
        );

        try {
          const assistantBackedAction = inferAssistantBackedWorkspaceAction(promptText, latestAssistantMessage);
          if (assistantBackedAction) {
            const actionResult = await executeMatterCopilotAction(activeMatter, currentState, assistantBackedAction);
            const assistantMessage = createCopilotMessage("assistant", actionResult?.text || "Action complete.");
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                copilotSyncStatus: "ready",
                pendingCopilotAction: null,
                chatMessages: [
                  ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                  assistantMessage
                ]
              }
            }));
            return;
          }

          const directToolAction = resolveCopilotWorkspaceAction(promptText, latestAssistantMessage);
          if (directToolAction) {
            await runMatterCopilotActionInChat(activeMatter, currentState, directToolAction, {
              successText: "Action complete."
            });
            return;
          }

          const request = resolveCopilotRequest(promptText);
          const sessionId = await syncMatterCopilotSession(
            activeMatter,
            currentState,
            currentState.copilotSessionId,
            { includeDraft: request.needsDraftContext }
          );
          const history = [
            ...((currentState.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages)),
            userMessage
          ].slice(-8).map((item) => ({ role: item.role, text: item.text }));
          const response = await sendCopilotChatMessage(sessionId, { message: promptText, history });
          const assistantReply = String(response?.reply || "").trim();
          if (!assistantReply) throw new Error("Empty AI reply.");
          const supportEntries = extractChatSupportEntries(response, activeMatter, currentState);
          const proposedActionId = inferProposedAction({ promptText, assistantReply, supportEntries });
          const draftSyncText = extractChatDraftUpdate(response, assistantReply, { allowDraftSync: request.allowDraftPatch });
          const assistantMessage = createCopilotMessage("assistant", assistantReply, {
            supportEntries,
            supportTitle: supportEntries.length ? "Based on" : "",
            proposedActionId
          });

          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(() => {
                const existing = current[activeMatter.id] ?? buildInitialMatterState(activeMatter);
                const nextState = {
                  ...existing,
                  copilotSessionId: sessionId,
                  copilotSyncStatus: "ready",
                  chatMessages: [
                    ...(existing.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages),
                    assistantMessage
                  ]
                };

                if (draftSyncText && draftSyncText !== String(existing.currentDraft || "").trim()) {
                  nextState.currentDraft = draftSyncText;
                  nextState.draftStatus = "Draft updated from Copilot";
                  nextState.validation = "Review updated draft before validation";
                  nextState.validationReport = null;
                  nextState.filingPack = "Rebuild filing pack after draft review";
                  nextState.filingChecklist = [];
                  nextState.draftHistory = [
                    {
                      timestamp: new Date().toISOString(),
                      previousDraft: existing.currentDraft ?? buildInitialMatterState(activeMatter).currentDraft,
                      patch: `Copilot chat updated the draft for: ${promptText}`,
                      patchMeta: { source: "copilot-chat", prompt: promptText, supportEntries }
                    },
                    ...(existing.draftHistory ?? [])
                  ].slice(0, 10);
                }

                return nextState;
              })()
            }
          }));

          if (shouldAutoContinueAfterAiReply(promptText, proposedActionId)) {
            const continuationState = {
              ...currentState,
              copilotSessionId: sessionId,
              currentDraft: draftSyncText || currentState.currentDraft,
              chatMessages: [
                ...((currentState.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages)),
                assistantMessage
              ]
            };
            runMatterCopilotActionInChat(activeMatter, continuationState, proposedActionId).catch(() => {});
          }

          if (draftSyncText && draftSyncText !== String(currentState.currentDraft || "").trim()) {
            const nextWorkspaceState = {
              ...currentState,
              currentDraft: draftSyncText,
              draftStatus: "Draft updated from Copilot",
              validation: "Review updated draft before validation",
              validationReport: null,
              filingPack: "Rebuild filing pack after draft review",
              filingChecklist: [],
              draftHistory: [
                {
                  timestamp: new Date().toISOString(),
                  previousDraft: currentState.currentDraft ?? buildInitialMatterState(activeMatter).currentDraft,
                  patch: `Copilot chat updated the draft for: ${promptText}`,
                  patchMeta: { source: "copilot-chat", prompt: promptText, supportEntries }
                },
                ...(currentState.draftHistory ?? [])
              ].slice(0, 10)
            };
            syncMatterWorkspaceRecord(activeMatter, nextWorkspaceState, {
              stage: "Draft",
              status: nextWorkspaceState.draftStatus
            });
          }
        } catch (error) {
          const assistantReply = `Copilot backend unavailable: ${String(error?.message || "Unable to send message.")}`;
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              copilotSyncStatus: "error",
              chatMessages: [
                ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                createCopilotMessage("assistant", assistantReply)
              ]
            }
          }));
        }
      }}
      onApplyChange={() => {}}
      onDismissPatch={() => {
        if (!activeMatter) return;
        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            suggestedPatch: "",
            suggestedPatchMeta: null
          }
        }));
      }}
      onClearChat={() => {
        if (activeMatter) {
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              chatMessages: [],
              suggestedPatch: "",
              suggestedPatchMeta: null,
              copilotSessionId: "",
              copilotSyncStatus: "idle",
              copilotPrompt: "",
              attachments: []
            }
          }));
          return;
        }
        setGeneralCopilotMessages([]);
        setGeneralCopilotPrompt("");
        setGeneralAttachments([]);
        setGeneralCopilotSessionId("");
        setGeneralCopilotStatus("idle");
      }}
      onPickCamera={() => pickCameraAttachment(false)}
      onPickScreenshot={() => pickLibraryAttachment(false)}
      onPickFile={() => pickDocumentAttachment(false)}
      generalPrompt={generalCopilotPrompt}
      generalMessages={generalCopilotMessages}
      onGeneralPromptChange={setGeneralCopilotPrompt}
      onSendGeneralPrompt={async () => {
        const promptText = generalCopilotPrompt.trim();
        if (!promptText) return;
        const attachmentLine = generalAttachments.length ? ` Attachments: ${generalAttachments.map((item) => item.name).join(", ")}.` : "";
        const userMessage = createCopilotMessage("user", `${promptText}${attachmentLine}`);
        const history = [...generalCopilotMessages, userMessage].slice(-8).map((item) => ({ role: item.role, text: item.text }));
        setGeneralCopilotMessages((current) => [...current, userMessage]);
        setGeneralCopilotPrompt("");
        setGeneralAttachments([]);
        setGeneralCopilotStatus("sending");

        try {
          const sessionId = await ensureGeneralCopilotSession();
          await submitCopilotIntake(sessionId, buildGeneralCopilotIntakePayload());
          await buildCopilotContext(sessionId, {});
          const response = await sendCopilotChatMessage(sessionId, { message: promptText, history });
          const assistantReply = String(response?.reply || "").trim();
          if (!assistantReply) throw new Error("Empty AI reply.");
          setGeneralCopilotStatus("ready");
          setGeneralCopilotMessages((current) => [...current, createCopilotMessage("assistant", assistantReply)]);
        } catch (error) {
          setGeneralCopilotStatus("error");
          setGeneralCopilotMessages((current) => [
            ...current,
            createCopilotMessage("assistant", `Copilot backend unavailable: ${String(error?.message || "Unable to send message.")}`)
          ]);
        }
      }}
      generalAttachments={generalAttachments}
      onPickGeneralCamera={() => pickCameraAttachment(true)}
      onPickGeneralScreenshot={() => pickLibraryAttachment(true)}
      onPickGeneralFile={() => pickDocumentAttachment(true)}
      onSaveSnippet={(value) => {
        if (activeMatter) {
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              savedNotes: [value, ...((current[activeMatter.id]?.savedNotes) ?? [])].slice(0, 20)
            }
          }));
        }
        saveSnippetToLibrary(value).then(async () => {
          try {
            const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
            setSavedSnippets(raw ? JSON.parse(raw) : []);
          } catch (_error) {
          }
        });
      }}
      onSaveMessageNote={(message, noteText) => handleSaveMessageNote(message, noteText).catch((error) => {
        Alert.alert("Save failed", String(error?.message || "Unable to save the note."));
      })}
      onSaveMessageToProfile={(message) => handleSaveMessageToProfile(message).catch((error) => {
        Alert.alert("Save failed", String(error?.message || "Unable to save into profile."));
      })}
      onSaveMessageToResearch={(message) => handleSaveMessageToResearch(message).catch((error) => {
        Alert.alert("Save failed", String(error?.message || "Unable to save into research."));
      })}
      onApplyMessageToDraft={(message) => handleApplyMessageToDraft(message).catch((error) => {
        Alert.alert("Draft update failed", String(error?.message || "Unable to apply the message to draft."));
      })}
      onUseSuggestion={(value) => {
        const suggestion = normalizeCopilotSuggestion(value);
        if (activeMatter && suggestion?.kind === "action" && suggestion.action) {
          runMatterCopilotActionInChat(activeMatter, activeMatterState, suggestion.action, {
            successText: "Action complete."
          }).catch(() => {});
          return;
        }
        const promptValue = suggestion?.value || String(value || "");
        if (activeMatter) {
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              copilotPrompt: promptValue
            }
          }));
          return;
        }
        setGeneralCopilotPrompt(promptValue);
      }}
      onUseSavedNote={(value) => {
        if (!activeMatter) {
          setGeneralCopilotPrompt(value);
          return;
        }
        setMatterStates((current) => ({
          ...current,
          [activeMatter.id]: {
            ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
            copilotPrompt: value
          }
        }));
      }}
      onOpenInsightDetail={(type, value) => openInsightDetail(type, value)}
    />
  );

  let content;

  if (visibleScreen === "cases") {
    content = (
        <CasesScreen
          currentRole={currentRole}
          matters={matters.filter((item) => item.archived !== true)}
        onBack={() => setScreen("home")}
        onCreateCase={() => {
          setEditingMatter(null);
          setCasePrefillClient(null);
          setScreen("case-editor");
        }}
        onArchiveMatter={(matter) => {
          setMatters((current) => current.map((item) => (
            item.id === matter.id ? { ...item, archived: true, status: "Archived" } : item
          )));
          if (activeMatter?.id === matter.id) {
            setActiveMatter(null);
          }
        }}
        onDeleteMatter={(matter) => {
          Alert.alert("Delete Case", `Delete ${matter.title}?`, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                setMatters((current) => current.filter((item) => item.id !== matter.id));
                setMatterStates((current) => {
                  const next = { ...current };
                  delete next[matter.id];
                  return next;
                });
                if (activeMatter?.id === matter.id) {
                  setActiveMatter(null);
                  setScreen("cases");
                }
              }
            }
          ]);
        }}
        onOpenMatter={(matter) => {
          const openedMatter = {
            ...matter,
            lastOpenedAt: new Date().toISOString()
          };
          setMatters((current) => current.map((item) => (item.id === matter.id ? openedMatter : item)));
          setActiveMatter(openedMatter);
          setMatterStates((current) => ({
            ...current,
            [matter.id]: {
              ...(current[matter.id] ?? buildInitialMatterState(openedMatter)),
              lastOpenedAt: new Date().toISOString()
            }
          }));
          setScreen("workspace");
        }}
      />
    );
  } else if (visibleScreen === "archived") {
    content = (
        <ArchivedScreen
          currentRole={currentRole}
          archivedMatters={archivedMatters}
          archivedClients={archivedClients}
        onBack={() => setScreen("home")}
        onRestoreMatter={(matter) => {
          const restoredMatter = {
            ...matter,
            archived: false,
            status: matter.status === "Archived" ? "Matter restored" : matter.status
          };
          setMatters((current) => current.map((item) => (item.id === matter.id ? restoredMatter : item)));
        }}
        onRestoreClient={(client) => {
          setClients((current) => current.map((item) => (item.id === client.id ? { ...item, archived: false } : item)));
        }}
      />
    );
  } else if (visibleScreen === "clients") {
    content = (
        <ClientsScreen
          currentRole={currentRole}
          clients={clients.filter((item) => item.archived !== true)}
        onBack={() => setScreen("home")}
        onCreateCaseForClient={(client) => {
          setEditingMatter(null);
          setCasePrefillClient(client);
          setScreen("case-editor");
        }}
        onArchiveClient={(client) => {
          setClients((current) => current.map((item) => (
            item.id === client.id ? { ...item, archived: true } : item
          )));
        }}
      />
    );
  } else if (visibleScreen === "case-editor") {
    content = (
      <CaseEditorScreen
        currentRole={currentRole}
        initialMatter={editingMatter}
        clients={clients}
        prefillClient={casePrefillClient}
        onBack={() => setScreen(editingMatter ? "details" : casePrefillClient ? "clients" : "cases")}
        onSave={async (savedMatter) => {
          let matterId = savedMatter.id ?? `m${Date.now()}`;
          let finalMatter = { ...savedMatter, id: matterId, lastOpenedAt: new Date().toISOString() };

          setMatters((current) => {
            const exists = current.some((item) => item.id === matterId);
            return exists ? current.map((item) => (item.id === matterId ? finalMatter : item)) : [finalMatter, ...current];
          });
          setActiveMatter(finalMatter);
          setMatterStates((current) => ({
            ...current,
            [matterId]: current[matterId] ?? buildInitialMatterState(finalMatter)
          }));
          setCasePrefillClient(null);
          setScreen("workspace");

          try {
            const clientResponse = await saveRemoteClient(effectiveAccount.uid, finalMatter);
            finalMatter = {
              ...finalMatter,
              clientId: clientResponse?.id || finalMatter.clientId || ""
            };
            setClients((current) => {
              const nextClient = {
                id: finalMatter.clientId,
                name: finalMatter.client,
                phone: finalMatter.profile?.phone || "",
                notes: finalMatter.profile?.note || ""
              };
              const exists = current.some((item) => item.id === nextClient.id);
              if (exists) {
                return current.map((item) => (item.id === nextClient.id ? nextClient : item));
              }
              return [nextClient, ...current];
            });

            const caseResponse = await saveRemoteCase(effectiveAccount.uid, finalMatter, finalMatter.clientId);
            if (caseResponse?.id && caseResponse.id !== matterId) {
              const previousId = matterId;
              matterId = caseResponse.id;
              finalMatter = { ...finalMatter, id: matterId };

              setMatters((current) =>
                current.map((item) => (item.id === previousId ? finalMatter : item))
              );
              setMatterStates((current) => {
                const previousState = current[previousId] ?? buildInitialMatterState(finalMatter);
                const nextState = { ...current };
                delete nextState[previousId];
                nextState[matterId] = previousState;
                return nextState;
              });
            } else {
              setMatters((current) =>
                current.map((item) => (item.id === matterId ? finalMatter : item))
              );
            }

            setActiveMatter(finalMatter);
            setCloudSyncReady(true);
          } catch (_error) {
          }
        }}
      />
    );
  } else if (visibleScreen === "workspace" && activeMatter) {
      content = (
        <CaseWorkspace
          matter={activeMatter}
          matterState={activeMatterState}
          currentRole={currentRole}
          onBack={() => setScreen("cases")}
          onOpenSection={(next) => setScreen(next)}
        />
      );
  } else if (visibleScreen === "profile" && activeMatter) {
    content = <MatterProfileScreen currentRole={currentRole} matter={activeMatter} onBack={() => setScreen("workspace")} />;
  } else if (visibleScreen === "details" && activeMatter) {
    content = (
      <MatterDetailsScreen
        currentRole={currentRole}
        matter={activeMatter}
        onBack={() => setScreen("workspace")}
        onEdit={() => {
          setEditingMatter(activeMatter);
          setScreen("case-editor");
        }}
      />
    );
  } else if (visibleScreen === "draft" && activeMatter) {
      content = (
        <MatterDraftScreen
          matter={activeMatter}
          matterState={activeMatterState}
          currentRole={currentRole}
          onBack={() => setScreen("workspace")}
          onOpenCopilot={() => setScreen("copilot")}
          onOpenSummary={() => setScreen("summary")}
          onGenerateDraft={() => {
            handleMatterDraftGeneration(activeMatter, activeMatterState).catch((error) => {
              Alert.alert("Draft generation failed", String(error?.message || "Unable to generate draft."));
            });
          }}
          onValidateDraft={() => {
            handleMatterValidation(activeMatter, activeMatterState).catch((error) => {
              Alert.alert("Validation failed", String(error?.message || "Unable to validate draft."));
            });
          }}
          onAutoFixIssues={() => {
            handleMatterAutoFixIssues(activeMatter, activeMatterState).catch((error) => {
              Alert.alert("Auto-fix failed", String(error?.message || "Unable to auto-fix the draft."));
            });
          }}
          onBuildFilingPack={() => {
            handleMatterFilingPack(activeMatter, activeMatterState).catch((error) => {
              Alert.alert("Filing pack failed", String(error?.message || "Unable to prepare filing pack."));
            });
          }}
          onSaveEditedDraft={(nextDraft, editMeta) => {
            try {
              handleManualDraftEdit(activeMatter, activeMatterState, nextDraft, editMeta);
            } catch (error) {
              Alert.alert("Draft update failed", String(error?.message || "Unable to save draft edits."));
            }
          }}
          onExport={(type, mode) => {
            handleMatterExport(type, mode).catch((error) => {
              Alert.alert("Export failed", String(error?.message || "Unable to export file."));
            });
          }}
          onOpenInsightDetail={(type, value) => openInsightDetail(type, value)}
          onFixUnsupportedExcerpt={sendUnsupportedExcerptToCopilot}
        onRestoreHistory={(historyItem) => {
          const currentState = activeMatterState ?? buildInitialMatterState(activeMatter);
          const restoredDraft = historyItem.previousDraft || currentState.currentDraft;
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              currentDraft: restoredDraft,
              draftStatus: "Previous draft restored",
              validation: "Review restored draft before export",
              draftHistory: [
                {
                  timestamp: new Date().toISOString(),
                  previousDraft: currentState.currentDraft,
                  patch: `Restored previous version from ${historyItem.timestamp}`
                },
                ...((current[activeMatter.id]?.draftHistory) ?? [])
              ].slice(0, 10)
            }
          }));
        }}
      />
    );
  } else if (visibleScreen === "research" && activeMatter) {
      content = (
        <MatterResearchScreen
          matter={activeMatter}
          matterState={activeMatterState}
          currentRole={currentRole}
          onBack={() => setScreen("workspace")}
          onOpenCopilot={() => setScreen("copilot")}
          onOpenDraft={() => setScreen("draft")}
          onOpenSummary={() => setScreen("summary")}
        onGenerateDraft={() => {
          handleMatterDraftGeneration(activeMatter, activeMatterState).catch((error) => {
            Alert.alert("Draft generation failed", String(error?.message || "Unable to generate draft."));
          });
        }}
        onExport={(type, mode) => {
          handleMatterExport(type, mode).catch((error) => {
            Alert.alert("Export failed", String(error?.message || "Unable to export file."));
          });
        }}
        onAddIssue={(issueText) => {
          const cleanIssue = String(issueText || "").trim();
          if (!cleanIssue) {
            return;
          }
          const nextMatter = {
            ...activeMatter,
            research: {
              ...(activeMatter.research || {}),
              issues: appendUniqueListItem(activeMatter.research?.issues || [], cleanIssue)
            }
          };
          replaceMatterRecord(nextMatter);
          persistMatterRemotely(nextMatter);
          Alert.alert("Issue added", "New research issue add ayyindi.");
        }}
        onSendToCopilot={(type, value) => {
          const focus = buildResearchFocus(type, value);
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              lastResearchFocus: focus,
              draftStatus: current[activeMatter.id]?.draftStatus ?? activeMatter.finalSummary.draftStatus,
              chatMessages: [
                ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                {
                  role: "assistant",
                  text: buildFocusLoadMessage(focus),
                  supportEntries: buildSupportEntries(activeMatter, {
                    ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                    lastResearchFocus: focus
                  }),
                  supportTitle: "Loaded source"
                }
              ]
            }
          }));
          setScreen("copilot");
        }}
        onOpenInsightDetail={(type, value) => {
          openInsightDetail(type, value, "Send to Copilot", () => {
            const focus = buildResearchFocus(type, value);
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                lastResearchFocus: focus,
                draftStatus: current[activeMatter.id]?.draftStatus ?? activeMatter.finalSummary.draftStatus,
                chatMessages: [
                  ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                  {
                    role: "assistant",
                    text: buildFocusLoadMessage(focus),
                    supportEntries: buildSupportEntries(activeMatter, {
                      ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                      lastResearchFocus: focus
                    }),
                    supportTitle: "Loaded source"
                  }
                ]
              }
            }));
            setScreen("copilot");
          });
        }}
      />
    );
  } else if (visibleScreen === "summary" && activeMatter) {
      content = (
        <MatterSummaryScreen
          matter={activeMatter}
          matterState={activeMatterState}
          currentRole={currentRole}
          onBack={() => setScreen("workspace")}
        onOpenDraft={() => setScreen("draft")}
        onBuildFilingPack={() => {
          handleMatterFilingPack(activeMatter, activeMatterState).catch((error) => {
            Alert.alert("Filing pack failed", String(error?.message || "Unable to prepare filing pack."));
          });
        }}
        onAutoFixIssues={() => {
          handleMatterAutoFixIssues(activeMatter, activeMatterState).catch((error) => {
            Alert.alert("Auto-fix failed", String(error?.message || "Unable to auto-fix the draft."));
          });
        }}
        onExport={(type, mode) => {
          handleMatterExport(type, mode).catch((error) => {
            Alert.alert("Export failed", String(error?.message || "Unable to export file."));
          });
        }}
        onOpenInsightDetail={(type, value) => openInsightDetail(type, value)}
        onFixUnsupportedExcerpt={sendUnsupportedExcerptToCopilot}
      />
    );
  } else if (visibleScreen === "copilot") {
      content = (
        <CopilotScreen
          currentRole={currentRole}
          matter={activeMatter}
          matterState={activeMatterState}
          generalSyncStatus={generalCopilotStatus}
          onBack={() => setScreen(activeMatter ? "workspace" : "home")}
        onOpenCases={() => setScreen("cases")}
        onPromptChange={(value) => {
          if (!activeMatter) {
            return;
          }
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              copilotPrompt: value
            }
          }));
        }}
        onSendPrompt={async () => {
          if (!activeMatter) {
            return;
          }
          const currentState = activeMatterState ?? buildInitialMatterState(activeMatter);
          const promptText = (currentState.copilotPrompt || "").trim();
          if (!promptText) {
            return;
          }
          const attachmentLine = (currentState.attachments ?? []).length
            ? ` Attachments: ${(currentState.attachments ?? []).map((item) => item.name).join(", ")}.`
            : "";
          const userMessage = createCopilotMessage("user", `${promptText}${attachmentLine}`);
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              chatMessages: [
                ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                userMessage
              ],
              suggestedPatch: "",
              suggestedPatchMeta: null,
              copilotSyncStatus: "sending",
              copilotPrompt: "",
              attachments: []
            }
          }));

          const latestAssistantMessage = getLatestActionableAssistantMessage(
            currentState?.chatMessages
            || buildInitialMatterState(activeMatter).chatMessages
          );
          const assistantBackedAction = inferAssistantBackedWorkspaceAction(promptText, latestAssistantMessage);
          if (assistantBackedAction) {
            try {
              const actionResult = await executeMatterCopilotAction(activeMatter, currentState, assistantBackedAction);
              const assistantMessage = createCopilotMessage("assistant", actionResult?.text || "Action complete.");

              setMatterStates((current) => ({
                ...current,
                [activeMatter.id]: {
                  ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                  copilotSyncStatus: "ready",
                  pendingCopilotAction: null,
                  chatMessages: [
                    ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                    assistantMessage
                  ]
                }
              }));
            } catch (error) {
              setMatterStates((current) => ({
                ...current,
                [activeMatter.id]: {
                  ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                  copilotSyncStatus: "error",
                  pendingCopilotAction: null,
                  chatMessages: [
                    ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                    createCopilotMessage("assistant", `Action failed: ${String(error?.message || "Unable to complete the action.")}`)
                  ]
                }
              }));
            }
            return;
          }

          const directToolAction = resolveCopilotWorkspaceAction(promptText, latestAssistantMessage);
          if (directToolAction) {
            await runMatterCopilotActionInChat(activeMatter, currentState, directToolAction, {
              successText: "Action complete."
            });
            return;
          }

          try {
            const request = resolveCopilotRequest(promptText);
            const sessionId = await syncMatterCopilotSession(
              activeMatter,
              currentState,
              currentState.copilotSessionId,
              { includeDraft: request.includeDraftContext }
            );
            const history = [
              ...((currentState.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages)),
              userMessage
            ]
              .slice(-8)
              .map((item) => ({ role: item.role, text: item.text }));
            const response = await sendCopilotChatMessage(sessionId, {
              message: promptText,
              history
            });
            const supportEntries = request.attachSupport
              ? buildSupportEntriesFromBackend(response?.retrievedAuthorities)
              : [];
            const assistantReply = String(response?.reply || "").trim();
            if (!assistantReply) {
              throw new Error("Empty AI reply.");
            }
            const proposedActionId = String(response?.proposedActionId || "").trim() || inferAssistantProposedAction({
              promptText,
              assistantReply,
              supportEntries
            });
            const draftSyncText = extractChatDraftUpdate(response, assistantReply, {
              allowDraftSync: request.allowDraftPatch
            });
            const assistantMessage = createCopilotMessage("assistant", assistantReply, {
              supportEntries,
              supportTitle: supportEntries.length ? "Based on" : "",
              proposedActionId
            });

            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(() => {
                  const existing = current[activeMatter.id] ?? buildInitialMatterState(activeMatter);
                  const nextState = {
                    ...existing,
                    copilotSessionId: sessionId,
                    copilotSyncStatus: "ready",
                    chatMessages: [
                      ...(existing.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages),
                      assistantMessage
                    ]
                  };

                  if (draftSyncText && draftSyncText !== String(existing.currentDraft || "").trim()) {
                    nextState.currentDraft = draftSyncText;
                    nextState.draftStatus = "Draft updated from Copilot";
                    nextState.validation = "Review updated draft before validation";
                    nextState.validationReport = null;
                    nextState.filingPack = "Rebuild filing pack after draft review";
                    nextState.filingChecklist = [];
                    nextState.draftHistory = [
                      {
                        timestamp: new Date().toISOString(),
                        previousDraft: existing.currentDraft ?? buildInitialMatterState(activeMatter).currentDraft,
                        patch: `Copilot chat updated the draft for: ${promptText}`,
                        patchMeta: {
                          source: "copilot-chat",
                          prompt: promptText,
                          supportEntries
                        }
                      },
                      ...(existing.draftHistory ?? [])
                    ].slice(0, 10);
                  }

                  return nextState;
                })()
              }
            }));
            if (shouldAutoContinueAfterAiReply(promptText, proposedActionId)) {
              const continuationState = {
                ...currentState,
                copilotSessionId: sessionId,
                currentDraft: draftSyncText || currentState.currentDraft,
                chatMessages: [
                  ...((currentState.chatMessages ?? buildInitialMatterState(activeMatter).chatMessages)),
                  assistantMessage
                ]
              };
              runMatterCopilotActionInChat(activeMatter, continuationState, proposedActionId).catch(() => {});
            }
            if (draftSyncText && draftSyncText !== String(currentState.currentDraft || "").trim()) {
              const nextWorkspaceState = {
                ...currentState,
                currentDraft: draftSyncText,
                draftStatus: "Draft updated from Copilot",
                validation: "Review updated draft before validation",
                validationReport: null,
                filingPack: "Rebuild filing pack after draft review",
                filingChecklist: [],
                draftHistory: [
                  {
                    timestamp: new Date().toISOString(),
                    previousDraft: currentState.currentDraft ?? buildInitialMatterState(activeMatter).currentDraft,
                    patch: `Copilot chat updated the draft for: ${promptText}`,
                    patchMeta: {
                      source: "copilot-chat",
                      prompt: promptText,
                      supportEntries
                    }
                  },
                  ...(currentState.draftHistory ?? [])
                ].slice(0, 10)
              };
              syncMatterWorkspaceRecord(activeMatter, nextWorkspaceState, {
                stage: "Draft",
                status: nextWorkspaceState.draftStatus
              });
            }
          } catch (error) {
            const assistantReply = `Copilot backend unavailable: ${String(error?.message || "Unable to send message.")}`;
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                copilotSyncStatus: "error",
                chatMessages: [
                  ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                  createCopilotMessage("assistant", assistantReply)
                ]
              }
            }));
          }
        }}
        onApplyChange={() => {
          if (!activeMatter) {
            return;
          }
          const currentState = activeMatterState ?? buildInitialMatterState(activeMatter);
          const patch = currentState.suggestedPatch || "Copilot refinement added to draft.";
          const previousDraft = currentState.currentDraft;
          const nextMatter = {
            ...activeMatter,
            stage: "Final Summary",
            status: "Copilot refinement applied"
          };
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              draftStatus: currentState.lastResearchFocus?.insight?.title
                ? "Patched with selected authority support"
                : "Copilot refinement applied",
              validation: currentState.suggestedPatchMeta?.pinpointRef
                ? "Pinpoint selected, final legal review advised"
                : "Validation ready for legal review",
              filingPack: isPlaceholderValue(activeMatter.caseDetails?.documents)
                ? "Documents needed before filing pack"
                : "Filing pack ready for refresh",
              currentDraft: `${currentState.currentDraft}\n\nCopilot update:\n${patch}`,
              draftHistory: [
                {
                  timestamp: new Date().toISOString(),
                  previousDraft,
                  patch,
                  patchMeta: {
                    ...(currentState.suggestedPatchMeta || {}),
                    source: "copilot-patch"
                  }
                },
                ...((current[activeMatter.id]?.draftHistory) ?? [])
              ].slice(0, 10),
              suggestedPatch: "",
              suggestedPatchMeta: null,
              chatMessages: [
                ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                createCopilotMessage(
                  "assistant",
                  currentState.suggestedPatchMeta?.pinpointRef
                    ? "Draft updated with selected legal support. Review the pinpoint, validation, and filing readiness before export."
                    : "Draft updated. Review the final summary and validation before export.",
                  {
                    supportEntries: currentState.suggestedPatchMeta?.supportEntries || [],
                    supportTitle: "Applied with"
                  }
                )
              ]
            }
          }));
          setActiveMatter(nextMatter);
          setMatters((current) => current.map((item) => (item.id === nextMatter.id ? nextMatter : item)));
          saveRemoteCase(effectiveAccount.uid, {
            ...nextMatter,
            caseDetails: {
              ...nextMatter.caseDetails,
              nextDate: nextMatter.caseDetails?.nextDate || "Not scheduled"
            }
          }, nextMatter.clientId || "").catch(() => {});
          setScreen("summary");
        }}
        onDismissPatch={() => {
          if (!activeMatter) {
            return;
          }
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              suggestedPatch: "",
              suggestedPatchMeta: null
            }
          }));
        }}
        onClearChat={() => {
          if (activeMatter) {
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                chatMessages: [],
                suggestedPatch: "",
                suggestedPatchMeta: null,
                copilotSessionId: "",
                copilotSyncStatus: "idle",
                copilotPrompt: "",
                attachments: []
              }
            }));
            return;
          }
          setGeneralCopilotMessages([]);
          setGeneralCopilotPrompt("");
          setGeneralAttachments([]);
          setGeneralCopilotSessionId("");
          setGeneralCopilotStatus("idle");
        }}
        generalPrompt={generalCopilotPrompt}
        generalMessages={generalCopilotMessages}
        onGeneralPromptChange={setGeneralCopilotPrompt}
        onSendGeneralPrompt={async () => {
          const promptText = generalCopilotPrompt.trim();
          if (!promptText) {
            return;
          }
          const attachmentLine = generalAttachments.length
            ? ` Attachments: ${generalAttachments.map((item) => item.name).join(", ")}.`
            : "";
          const userMessage = createCopilotMessage("user", `${promptText}${attachmentLine}`);
          const history = [...generalCopilotMessages, userMessage]
            .slice(-8)
            .map((item) => ({ role: item.role, text: item.text }));
          setGeneralCopilotMessages((current) => [...current, userMessage]);
          setGeneralCopilotPrompt("");
          setGeneralAttachments([]);
          setGeneralCopilotStatus("sending");

          try {
            const sessionId = await ensureGeneralCopilotSession();
            await submitCopilotIntake(sessionId, buildGeneralCopilotIntakePayload());
            await buildCopilotContext(sessionId, {});
            const response = await sendCopilotChatMessage(sessionId, {
              message: promptText,
              history
            });
            const assistantReply = String(response?.reply || "").trim();
            if (!assistantReply) {
              throw new Error("Empty AI reply.");
            }
            setGeneralCopilotStatus("ready");
            setGeneralCopilotMessages((current) => [
              ...current,
              createCopilotMessage("assistant", assistantReply)
            ]);
          } catch (error) {
            setGeneralCopilotStatus("error");
            setGeneralCopilotMessages((current) => [
              ...current,
              createCopilotMessage("assistant", `Copilot backend unavailable: ${String(error?.message || "Unable to send message.")}`)
            ]);
          }
        }}
        onPickCamera={() => pickCameraAttachment(false)}
        onPickScreenshot={() => pickLibraryAttachment(false)}
        onPickFile={() => pickDocumentAttachment(false)}
        generalAttachments={generalAttachments}
        onPickGeneralCamera={() => pickCameraAttachment(true)}
        onPickGeneralScreenshot={() => pickLibraryAttachment(true)}
        onPickGeneralFile={() => pickDocumentAttachment(true)}
        onSaveSnippet={(value) => {
          if (activeMatter) {
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                savedNotes: [
                  value,
                  ...((current[activeMatter.id]?.savedNotes) ?? [])
                ].slice(0, 20)
              }
            }));
            saveSnippetToLibrary(value).then(async () => {
              try {
                const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
                setSavedSnippets(raw ? JSON.parse(raw) : []);
              } catch (_error) {
              }
            });
            return;
          }

          saveSnippetToLibrary(value).then(async () => {
            try {
              const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
              setSavedSnippets(raw ? JSON.parse(raw) : []);
            } catch (_error) {
            }
          });
          setGeneralCopilotMessages((current) => [
            ...current,
            { role: "assistant", text: `Saved note: ${value}` }
          ]);
        }}
        onSaveMessageNote={(message, noteText) => {
          handleSaveMessageNote(message, noteText).catch((error) => {
            Alert.alert("Save failed", String(error?.message || "Unable to save the note."));
          });
        }}
        onSaveMessageToProfile={(message) => {
          handleSaveMessageToProfile(message).catch((error) => {
            Alert.alert("Save failed", String(error?.message || "Unable to save into profile."));
          });
        }}
        onSaveMessageToResearch={(message) => {
          handleSaveMessageToResearch(message).catch((error) => {
            Alert.alert("Save failed", String(error?.message || "Unable to save into research."));
          });
        }}
        onApplyMessageToDraft={(message) => {
          handleApplyMessageToDraft(message).catch((error) => {
            Alert.alert("Draft update failed", String(error?.message || "Unable to apply the message to draft."));
          });
        }}
        onUseSuggestion={(value) => {
          const suggestion = normalizeCopilotSuggestion(value);
          if (activeMatter && suggestion?.kind === "action" && suggestion.action) {
            if (shouldAutoRunMatterAction(suggestion.action)) {
              runMatterCopilotActionInChat(activeMatter, activeMatterState, suggestion.action, {
                successText: "Action complete."
              }).catch(() => {});
              return;
            }

            runMatterCopilotActionInChat(activeMatter, activeMatterState, suggestion.action, {
              successText: "Action complete."
            }).catch(() => {});
            return;
          }

          const promptValue = suggestion?.value || String(value || "");
          if (activeMatter) {
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                copilotPrompt: promptValue
              }
            }));
            return;
          }
          setGeneralCopilotPrompt(promptValue);
        }}
        onUseSavedNote={(value) => {
          if (!activeMatter) {
            setGeneralCopilotPrompt(value);
            return;
          }
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              copilotPrompt: value
            }
          }));
        }}
        onOpenInsightDetail={(type, value) => openInsightDetail(type, value)}
      />
    );
  } else if (visibleScreen === "notes") {
    content = (
      <SavedNotesScreen
          currentRole={currentRole}
          activeMatter={activeMatter}
          matterState={activeMatterState}
        savedSnippets={savedSnippets}
        onBack={() => setScreen(activeMatter ? "workspace" : "home")}
        onUseNote={(value) => {
          if (activeMatter) {
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                copilotPrompt: value
              }
            }));
            setScreen("copilot");
            return;
          }

          setGeneralCopilotPrompt(value);
          setScreen("copilot");
        }}
      />
    );
  } else if (visibleScreen === "tools") {
    content = (
      <ToolsScreen
          currentRole={currentRole}
          activeMatter={activeMatter}
          onBack={() => setScreen(activeMatter ? "workspace" : "home")}
        onOpenSection={(next) => {
          if (advancedToolCatalog.some((item) => item.id === next)) {
            setSelectedToolId(next);
            setScreen("tool-workspace");
            return;
          }
          if ((next === "research" || next === "draft" || next === "summary" || next === "copilot") && !activeMatter) {
            setScreen("cases");
            return;
          }
          if (next === "case-editor") {
            setEditingMatter(null);
          }
          setScreen(next);
        }}
      />
    );
  } else if (visibleScreen === "help") {
    content = (
      <HelpScreen
        currentRole={currentRole}
        activeMatter={activeMatter}
        onBack={() => setScreen(activeMatter ? "workspace" : "home")}
        onOpenSection={(next) => {
          if ((next === "research" || next === "draft" || next === "summary" || next === "copilot") && !activeMatter) {
            setScreen("cases");
            return;
          }
          setScreen(next);
        }}
      />
    );
  } else if (visibleScreen === "tool-workspace" && selectedTool) {
    content = (
      <ToolWorkspaceScreen
          tool={selectedTool}
          currentRole={currentRole}
          activeMatter={activeMatter}
          matterState={activeMatterState}
          onBack={() => setScreen("tools")}
        onOpenSection={(next) => {
          if ((next === "research" || next === "draft" || next === "summary" || next === "copilot") && !activeMatter) {
            setScreen("cases");
            return;
          }
          setScreen(next);
        }}
        onSendInsightToCopilot={(type, value) => {
          if (!activeMatter) {
            setScreen("cases");
            return;
          }
          const focus = buildResearchFocus(type, value);
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              lastResearchFocus: focus,
              chatMessages: [
                ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                {
                  role: "assistant",
                  text: buildFocusLoadMessage(focus),
                  supportEntries: buildSupportEntries(activeMatter, {
                    ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                    lastResearchFocus: focus
                  }),
                  supportTitle: "Loaded source"
                }
              ]
            }
          }));
          setScreen("copilot");
        }}
        onUseInsightInResearch={(type, value) => {
          if (!activeMatter) {
            setScreen("cases");
            return;
          }
          const focus = buildResearchFocus(type, value);
          setMatterStates((current) => ({
            ...current,
            [activeMatter.id]: {
              ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
              lastResearchFocus: focus
            }
          }));
          setScreen("research");
        }}
        onSaveInsight={(value) => {
          saveSnippetToLibrary(value).then(async () => {
            try {
              const raw = await storageGetItem(SAVED_SNIPPETS_KEY);
              setSavedSnippets(raw ? JSON.parse(raw) : []);
            } catch (_error) {
            }
          });
        }}
        onOpenInsightDetail={(type, value) => {
          if (!activeMatter) {
            openInsightDetail(type, value);
            return;
          }
          openInsightDetail(type, value, "Send to Copilot", () => {
            const focus = buildResearchFocus(type, value);
            setMatterStates((current) => ({
              ...current,
              [activeMatter.id]: {
                ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                lastResearchFocus: focus,
                chatMessages: [
                  ...((current[activeMatter.id]?.chatMessages) ?? buildInitialMatterState(activeMatter).chatMessages),
                  {
                    role: "assistant",
                    text: buildFocusLoadMessage(focus),
                    supportEntries: buildSupportEntries(activeMatter, {
                      ...(current[activeMatter.id] ?? buildInitialMatterState(activeMatter)),
                      lastResearchFocus: focus
                    }),
                    supportTitle: "Loaded source"
                  }
                ]
              }
            }));
            setScreen("copilot");
          });
        }}
      />
    );
  } else {
      content = (
        <HomeScreen
          currentRole={currentRole}
          activeMatter={activeMatter}
          activeMatterState={activeMatterState}
          recentMatters={recentMatters}
        mattersCount={matters.filter((item) => item.archived !== true).length}
        clientsCount={clients.filter((item) => item.archived !== true).length}
        notesCount={(savedSnippets?.length ?? 0) + (activeMatterState?.savedNotes?.length ?? 0)}
        archivedCount={archivedMatters.length + archivedClients.length}
        onOpenSection={(sectionId) => {
          if (sectionId === "cases") {
            setScreen("cases");
            return;
          }
          if ((sectionId === "draft" || sectionId === "research" || sectionId === "summary") && !activeMatter) {
            setScreen("cases");
            return;
          }
          if (sectionId === "notes") {
            setScreen("notes");
            return;
          }
          if (sectionId === "tools") {
            setScreen("tools");
            return;
          }
          if (advancedToolCatalog.some((item) => item.id === sectionId)) {
            setSelectedToolId(sectionId);
            setScreen("tool-workspace");
            return;
          }
          setScreen(sectionId);
        }}
        onQuickOpenMatter={(next) => setScreen(next)}
        onOpenRecentMatter={(matter) => {
          const openedMatter = {
            ...matter,
            lastOpenedAt: new Date().toISOString()
          };
          setMatters((current) => current.map((item) => (item.id === matter.id ? openedMatter : item)));
          setActiveMatter(openedMatter);
          setMatterStates((current) => ({
            ...current,
            [matter.id]: {
              ...(current[matter.id] ?? buildInitialMatterState(openedMatter)),
              lastOpenedAt: new Date().toISOString()
            }
          }));
          setScreen("workspace");
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.topIdentityBar}>
        <View>
            <Text style={styles.identityLabel}>Medilink AI</Text>
            <Text style={styles.identityName}>{effectiveDisplayName}</Text>
            <Text style={styles.identityMeta}>{sessionLabel}</Text>
          </View>
        <View style={styles.identityRight}>
          <TouchableOpacity activeOpacity={0.85} onPress={openRolePicker}>
            <Pill active>{roleConfigs[currentRole]?.label ?? "Lawyer"}</Pill>
          </TouchableOpacity>
          <View
            style={[
              styles.sessionDot,
              authStatus === "live"
                ? styles.sessionDotLive
                : authStatus === "fallback"
                  ? styles.sessionDotFallback
                  : styles.sessionDotConnecting
            ]}
          />
        </View>
      </View>
      <View style={styles.appContent}>{content}</View>
      {showBottomNav ? (
        <BottomNav
          currentRole={currentRole}
          activeKey={mapScreenToBottomTab(screen)}
          onPress={(target) => {
            if ((target === "research" || target === "copilot") && !activeMatter) {
              setScreen("cases");
              return;
            }
            setScreen(target);
          }}
        />
      ) : null}
      {showBottomDrawer ? (
        <BottomDrawer
          open={drawerOpen}
          title={activeMatter ? "Workspace Actions" : "App Actions"}
          actions={drawerActions}
          onToggle={() => setDrawerOpen((current) => !current)}
          onActionPress={(action) => {
            setDrawerOpen(false);
            if ((action.id === "research" || action.id === "summary" || action.id === "workspace" || action.id === "profile" || action.id === "details" || action.id === "draft") && !activeMatter) {
              setScreen("cases");
              return;
            }
            if (advancedToolCatalog.some((item) => item.id === action.id)) {
              setSelectedToolId(action.id);
              setScreen("tool-workspace");
              return;
            }
            setScreen(action.id);
          }}
        />
      ) : null}
      <AuthorityDetailModal
        visible={Boolean(selectedInsightDetail)}
        detail={selectedInsightDetail}
        onClose={() => setSelectedInsightDetail(null)}
      />
      {!copilotDockVisible ? (
        <View pointerEvents="box-none" style={styles.copilotDockLayer}>
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => openCopilotDock({ maximized: Platform.OS !== "web" })}
            style={styles.copilotLauncher}
          >
            <Text style={styles.copilotLauncherText}>Copilot</Text>
          </TouchableOpacity>
        </View>
      ) : copilotDockMinimized ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.copilotDockLayer,
            { transform: copilotDockMaximized ? [] : copilotDockPosition.getTranslateTransform() }
          ]}
        >
          <View {...copilotDockPanResponder.panHandlers} style={styles.copilotMiniDock}>
            <TouchableOpacity activeOpacity={0.92} onPress={() => setCopilotDockMinimized(false)} style={styles.copilotMiniDockPrimary}>
              <Text style={styles.copilotMiniDockPrimaryText}>Open Copilot</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.92} onPress={() => setCopilotDockVisible(false)} style={styles.copilotMiniDockClose}>
              <Text style={styles.copilotMiniDockCloseText}>×</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.copilotDockLayer,
            copilotDockMaximized ? styles.copilotDockShellMaximized : null,
            { transform: copilotDockMaximized ? [] : copilotDockPosition.getTranslateTransform() }
          ]}
        >
          <View style={[styles.copilotDockShell, copilotDockMaximized ? styles.copilotDockShellMaximizedCard : null]}>
            <View {...copilotDockPanResponder.panHandlers} style={styles.copilotDockHeader}>
              <View style={styles.copilotDockHeaderCopy}>
                <Text style={styles.chatBubbleRole}>Copilot</Text>
                <Text style={styles.copilotDockTitle}>{activeMatter ? activeMatter.title : "General assistant"}</Text>
                <Text style={styles.copilotDockMeta}>{activeMatter ? "Matter-aware floating assistant" : "Floating legal assistant"}</Text>
              </View>
              <View style={styles.copilotDockHeaderActions}>
                <TouchableOpacity activeOpacity={0.92} onPress={() => setCopilotDockMinimized(true)} style={styles.copilotDockHeaderAction}>
                  <Text style={styles.copilotDockHeaderActionText}>_</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.92} onPress={() => setCopilotDockMaximized((current) => !current)} style={styles.copilotDockHeaderAction}>
                  <Text style={styles.copilotDockHeaderActionText}>{copilotDockMaximized ? "▢" : "□"}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.92} onPress={() => setCopilotDockVisible(false)} style={styles.copilotDockHeaderActionClose}>
                  <Text style={styles.copilotDockHeaderActionCloseText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.copilotDockBody}>
              {renderFloatingCopilotSurface()}
            </View>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#e9f1ff"
  },
  copilotDockLayer: {
    position: "absolute",
    right: 16,
    bottom: 16,
    zIndex: 2000
  },
  copilotLauncher: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#0f766e",
    borderWidth: 1,
    borderColor: "#0b5f59",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  },
  copilotLauncherText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  copilotMiniDock: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    overflow: "hidden"
  },
  copilotMiniDockPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  copilotMiniDockPrimaryText: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800"
  },
  copilotMiniDockClose: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#eef5ff"
  },
  copilotMiniDockCloseText: {
    color: "#4d6484",
    fontSize: 16,
    fontWeight: "800"
  },
  copilotDockShell: {
    width: Platform.OS === "web" ? 430 : 360,
    maxWidth: Platform.OS === "web" ? 430 : "100%",
    height: Platform.OS === "web" ? 700 : 620,
    maxHeight: Platform.OS === "web" ? 700 : 620,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8
  },
  copilotDockShellMaximized: {
    top: 12,
    left: 12,
    right: 12,
    bottom: 12
  },
  copilotDockShellMaximizedCard: {
    width: Platform.OS === "web" ? Math.max(Dimensions.get("window").width - 24, 320) : "100%",
    height: Platform.OS === "web" ? Math.max(Dimensions.get("window").height - 24, 420) : "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    borderRadius: 26
  },
  copilotDockHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f7fbff",
    borderBottomWidth: 1,
    borderBottomColor: "#d5e4ff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  copilotDockHeaderCopy: {
    flex: 1
  },
  copilotDockTitle: {
    marginTop: 4,
    color: "#1d2b4f",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotDockMeta: {
    marginTop: 4,
    color: "#5b708d",
    fontSize: 12,
    fontWeight: "700"
  },
  copilotDockHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  copilotDockHeaderAction: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5ff",
    borderWidth: 1,
    borderColor: "#d6e4ff"
  },
  copilotDockHeaderActionText: {
    color: "#4d6484",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotDockHeaderActionClose: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3"
  },
  copilotDockHeaderActionCloseText: {
    color: "#b91c1c",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotDockBody: {
    flex: 1
  },
  appContent: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 112,
    gap: 16
  },
  topIdentityBar: {
    paddingHorizontal: 18,
    paddingTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  identityLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  identityName: {
    marginTop: 4,
    color: "#1d2b4f",
    fontSize: 18,
    fontWeight: "800"
  },
  identityMeta: {
    marginTop: 4,
    color: "#5a7193",
    fontSize: 12,
    fontWeight: "700"
  },
  identityRight: {
    alignItems: "center",
    gap: 8
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  sessionDotLive: {
    backgroundColor: "#10b981"
  },
  sessionDotFallback: {
    backgroundColor: "#f59e0b"
  },
  sessionDotConnecting: {
    backgroundColor: "#94a3b8"
  },
  mobileHeaderCard: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 24,
    backgroundColor: "#0f766e"
  },
  mobileHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  mobileHeaderEyebrow: {
    color: "#b7fff0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  mobileHeaderTitle: {
    marginTop: 6,
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800"
  },
  mobileHeaderSubtitle: {
    marginTop: 10,
    color: "#dffaf5",
    fontSize: 14,
    lineHeight: 20
  },
  mobileStatusDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#7ef7d6"
  },
  sectionCard: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e6ff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  workspaceBanner: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#0f766e"
  },
  workspaceBannerHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  workspaceBannerKicker: {
    color: "#b7fff0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  workspaceBannerTitle: {
    marginTop: 6,
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "800"
  },
  workspaceBannerSubtitle: {
    marginTop: 10,
    color: "#dffaf5",
    fontSize: 14,
    lineHeight: 20
  },
  priorityBanner: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8
  },
  priorityBannerRisk: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3"
  },
  priorityBannerWarning: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a"
  },
  priorityBannerReview: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe"
  },
  priorityBannerGood: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0"
  },
  priorityBannerTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800"
  },
  priorityBannerTitleRisk: {
    color: "#be123c"
  },
  priorityBannerTitleWarning: {
    color: "#a16207"
  },
  priorityBannerTitleReview: {
    color: "#1d4ed8"
  },
  priorityBannerTitleGood: {
    color: "#047857"
  },
  priorityBannerNote: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600"
  },
  priorityBannerNoteRisk: {
    color: "#9f1239"
  },
  priorityBannerNoteWarning: {
    color: "#854d0e"
  },
  priorityBannerNoteReview: {
    color: "#1e40af"
  },
  priorityBannerNoteGood: {
    color: "#065f46"
  },
  decisionCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10
  },
  decisionCardRisk: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3"
  },
  decisionCardWarning: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a"
  },
  decisionCardGood: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0"
  },
  decisionCardKicker: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  decisionCardTitle: {
    color: "#1d2b4f",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800"
  },
  decisionCardNote: {
    color: "#35527a",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600"
  },
  decisionMetaRow: {
    flexDirection: "row",
    gap: 10
  },
  decisionMetaCard: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe7fb",
    backgroundColor: "rgba(255,255,255,0.64)"
  },
  decisionMetaLabel: {
    color: "#52607a",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  decisionMetaValue: {
    marginTop: 4,
    color: "#1d2b4f",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800"
  },
  decisionReasons: {
    gap: 8
  },
  decisionReasonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  decisionReasonDot: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "900",
    paddingTop: 2
  },
  decisionReasonText: {
    flex: 1,
    color: "#35527a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600"
  },
  decisionProgressRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  decisionProgressChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1
  },
  decisionProgressChipReady: {
    backgroundColor: "#f0fdf4",
    borderColor: "#86efac"
  },
  decisionProgressChipPending: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe"
  },
  decisionProgressLabel: {
    fontSize: 12,
    fontWeight: "800"
  },
  decisionProgressLabelReady: {
    color: "#166534"
  },
  decisionProgressLabelPending: {
    color: "#1d4ed8"
  },
  decisionActionRow: {
    marginTop: 4
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14
  },
  sectionHeadCopy: {
    flex: 1
  },
  collapsibleHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 4
  },
  collapsibleToggle: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 18
  },
  sectionKicker: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  sectionTitle: {
    marginTop: 6,
    color: "#1d2b4f",
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "800"
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  appCard: {
    width: "48%",
    minHeight: 102,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  appCardCompact: {
    minHeight: 96
  },
  appCardIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#dff5f0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12
  },
  appCardIconText: {
    color: "#0f766e",
    fontSize: 16,
    fontWeight: "900"
  },
  actionRow: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  actionRowCopy: {
    flex: 1
  },
  actionRowTitle: {
    color: "#16233f",
    fontSize: 18,
    fontWeight: "800"
  },
  actionRowSubtitle: {
    marginTop: 6,
    color: "#59708f",
    fontSize: 14,
    lineHeight: 20
  },
  actionRowArrow: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800"
  },
  workspaceTileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14
  },
  workspaceTile: {
    width: "48%",
    minHeight: 110,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  workspaceTilePrimary: {
    backgroundColor: "#ecfdf5",
    borderColor: "#b7eadf"
  },
  workspaceTileTitle: {
    color: "#16233f",
    fontSize: 17,
    fontWeight: "800"
  },
  workspaceTileSubtitle: {
    marginTop: 8,
    color: "#59708f",
    fontSize: 13,
    lineHeight: 19
  },
  workspaceTileHint: {
    marginTop: 10,
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  appCardTitle: {
    color: "#16233f",
    fontSize: 18,
    fontWeight: "800"
  },
  appCardSubtitle: {
    marginTop: 8,
    color: "#59708f",
    fontSize: 13,
    lineHeight: 19
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#eff5ff"
  },
  pillActive: {
    backgroundColor: "#d2f7ef"
  },
  pillText: {
    color: "#33517c",
    fontSize: 12,
    fontWeight: "700"
  },
  pillTextActive: {
    color: "#0f766e"
  },
  bodyText: {
    color: "#50627f",
    fontSize: 15,
    lineHeight: 23
  },
  metaText: {
    marginTop: 12,
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "700"
  },
  backBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  backButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e6ff"
  },
  backButtonText: {
    color: "#18294c",
    fontSize: 14,
    fontWeight: "800"
  },
  backCopy: {
    flex: 1
  },
  backTitle: {
    color: "#1d2b4f",
    fontSize: 22,
    fontWeight: "800"
  },
  backSubtitle: {
    marginTop: 4,
    color: "#5f718f",
    fontSize: 14
  },
  caseCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  caseMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10
  },
  caseTitle: {
    flex: 1,
    color: "#16233f",
    fontSize: 18,
    fontWeight: "800"
  },
  caseClient: {
    marginTop: 8,
    color: "#43607f",
    fontSize: 14,
    fontWeight: "600"
  },
  caseStatus: {
    marginTop: 8,
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "700"
  },
  caseMetaDetail: {
    marginTop: 8,
    color: "#59708f",
    fontSize: 13,
    fontWeight: "600"
  },
  caseMiniMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  caseActionRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10
  },
  casePrimaryAction: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#0f766e"
  },
  casePrimaryActionText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center"
  },
  casePrimaryHint: {
    marginTop: 8,
    color: "#5a6f92",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600"
  },
  caseMiniAction: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  caseMiniActionDanger: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3"
  },
  caseMiniActionText: {
    color: "#35527a",
    fontSize: 12,
    fontWeight: "800"
  },
  caseMiniActionTextDanger: {
    color: "#be123c"
  },
  casesToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  searchShell: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e6ff"
  },
  searchPlaceholder: {
    color: "#7a8ca7",
    fontSize: 14,
    fontWeight: "600"
  },
  searchInput: {
    color: "#1d2b4f",
    fontSize: 14,
    fontWeight: "600",
    padding: 0
  },
  inlineIssueComposer: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  inlineIssueInput: {
    minHeight: 84,
    color: "#1d2b4f",
    fontSize: 14,
    lineHeight: 22,
    textAlignVertical: "top"
  },
  formStack: {
    gap: 12
  },
  formInput: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    color: "#1d2b4f",
    fontSize: 15,
    lineHeight: 22
  },
  formInputTall: {
    minHeight: 116,
    textAlignVertical: "top"
  },
  casesToolbarChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  casesToolbarChipActive: {
    backgroundColor: "#d2f7ef",
    borderColor: "#b7eadf"
  },
  casesToolbarLabel: {
    color: "#35527a",
    fontSize: 12,
    fontWeight: "800"
  },
  casesToolbarLabelActive: {
    color: "#0f766e"
  },
  clientPickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  clientPickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  clientPickerChipActive: {
    backgroundColor: "#d2f7ef",
    borderColor: "#b7eadf"
  },
  clientPickerChipText: {
    color: "#35527a",
    fontSize: 12,
    fontWeight: "800"
  },
  clientPickerChipTextActive: {
    color: "#0f766e"
  },
  summaryStack: {
    gap: 10
  },
  emptyStateCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  emptyStateTitle: {
    color: "#16233f",
    fontSize: 16,
    fontWeight: "800"
  },
  emptyStateText: {
    marginTop: 8,
    color: "#59708f",
    fontSize: 14,
    lineHeight: 20
  },
  keyboardScreen: {
    flex: 1
  },
  copilotScrollContent: {
    paddingBottom: 24
  },
  copilotScrollContentKeyboard: {
    paddingBottom: 16
  },
  copilotFooter: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    backgroundColor: "#f5f9ff"
  },
  copilotLiveStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  copilotLiveStripText: {
    color: "#1d2b4f",
    fontSize: 14,
    fontWeight: "800"
  },
  copilotLiveStripMeta: {
    flex: 1,
    color: "#5b708d",
    fontSize: 12,
    fontWeight: "700"
  },
  copilotSessionReminder: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#eefaf6",
    borderWidth: 1,
    borderColor: "#b7eadf",
    alignSelf: "flex-start"
  },
  copilotSessionReminderText: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800"
  },
  copilotFloatingControls: {
    position: "absolute",
    top: Platform.OS === "web" ? 14 : 18,
    right: 18,
    alignItems: "flex-end",
    gap: 10,
    zIndex: 30
  },
  copilotFloatingButton: {
    minWidth: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8
  },
  copilotFloatingButtonText: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center"
  },
  copilotFloatingIconButton: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,118,110,0.96)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10
  },
  copilotFloatingIconButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 22
  },
  quickStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  homeStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10
  },
  homeStatPill: {
    minWidth: "47%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  homeStatLabel: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  homeStatValue: {
    marginTop: 4,
    color: "#16233f",
    fontSize: 18,
    fontWeight: "800"
  },
  quickStatCard: {
    width: "48%",
    minHeight: 92,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  quickStatLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  quickStatValue: {
    marginTop: 8,
    color: "#213351",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700"
  },
  workspaceInsightCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  workspaceInsightTitle: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  workspaceInsightText: {
    marginTop: 8,
    color: "#21434a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600"
  },
  researchQuickBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -4
  },
  summaryItem: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  draftPreviewCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#fdfefe",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    minHeight: 220
  },
  draftHighlightBanner: {
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  draftHighlightBannerText: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4
  },
  draftHighlightedLine: {
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#effcf7"
  },
  draftPreviewText: {
    color: "#213351",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace"
  },
  legalInsightCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#cfe0fb",
    gap: 6
  },
  selectableCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  summaryLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  summaryValue: {
    marginTop: 6,
    color: "#213351",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700"
  },
  legalInsightHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  legalInsightBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end"
  },
  legalInsightMeta: {
    color: "#5a7193",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  legalInsightInset: {
    marginTop: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "#eef6ff",
    borderWidth: 1,
    borderColor: "#d7e6ff"
  },
  legalInsightInsetLabel: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase"
  },
  legalInsightInsetText: {
    marginTop: 6,
    color: "#213351",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  legalInsightSupport: {
    color: "#4f6484",
    fontSize: 13,
    lineHeight: 19
  },
  legalStatutesRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  legalStatuteChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e8f6f2"
  },
  legalStatuteText: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800"
  },
  supportBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  supportBlockCompact: {
    padding: 10,
    marginTop: 8
  },
  supportBlockTitle: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase"
  },
  supportBlockList: {
    gap: 8
  },
  supportEntryCard: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe7fb",
    gap: 4
  },
  supportEntryCardCompact: {
    padding: 8
  },
  supportEntryLabel: {
    color: "#0f766e",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  supportEntryTitle: {
    color: "#1d2b4f",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800"
  },
  supportEntryMeta: {
    color: "#4e6584",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600"
  },
  supportEntryDetail: {
    color: "#21434a",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600"
  },
  supportEntryOpenHint: {
    marginTop: 4,
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800"
  },
  trustBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eef5ff"
  },
  trustBadgeHigh: {
    backgroundColor: "#dcfce7"
  },
  trustBadgeMedium: {
    backgroundColor: "#fef3c7"
  },
  trustBadgeReview: {
    backgroundColor: "#fee2e2"
  },
  trustBadgeLow: {
    backgroundColor: "#fef2f2"
  },
  trustBadgeText: {
    color: "#33517c",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  trustBadgeTextHigh: {
    color: "#166534"
  },
  trustBadgeTextMedium: {
    color: "#92400e"
  },
  trustBadgeTextReview: {
    color: "#b91c1c"
  },
  trustBadgeTextLow: {
    color: "#991b1b"
  },
  summaryAction: {
    marginTop: 10,
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800"
  },
  selectableFooter: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  inlineFooterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  inlineFooterLink: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  inlineFooterLinkText: {
    color: "#35527a",
    fontSize: 11,
    fontWeight: "800"
  },
  selectableArrow: {
    color: "#4e6584",
    fontSize: 12,
    fontWeight: "800"
  },
  detailModalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: "#eef5ff"
  },
  detailModalSheet: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: "#d7e6ff"
  },
  detailModalHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  detailModalHeadCopy: {
    flex: 1
  },
  detailModalTitle: {
    marginTop: 6,
    color: "#1d2b4f",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800"
  },
  detailModalClose: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  detailModalCloseText: {
    color: "#35527a",
    fontSize: 12,
    fontWeight: "800"
  },
  detailModalBody: {
    gap: 12,
    paddingTop: 14,
    paddingBottom: 16
  },
  detailModalScroll: {
    marginTop: 10,
    flex: 1
  },
  detailModalScrollContent: {
    paddingBottom: 12
  },
  detailModalSection: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  detailModalMeta: {
    color: "#59708f",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  detailModalActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: "#e4edff",
    backgroundColor: "#ffffff"
  },
  draftEditorCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  draftEditorLabel: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  draftEditorSelectedPreview: {
    color: "#29426b",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600"
  },
  draftEditorMeta: {
    color: "#6a7f9f",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  draftEditorReplaceInput: {
    minHeight: 96
  },
  draftEditorInput: {
    minHeight: 320,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d5e4ff",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#1d2b4f",
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600"
  },
  draftEditorChangeItem: {
    color: "#35527a",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600"
  },
  snapshotStaticBody: {
    marginTop: 8,
    paddingTop: 8,
    paddingBottom: 8
  },
  snapshotTranscriptCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  snapshotTranscriptList: {
    gap: 12
  },
  snapshotTranscriptTitle: {
    marginBottom: 8,
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  snapshotTranscriptCompact: {
    color: "#1d2b4f",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600"
  },
  chatComposerCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatComposerDock: {
    marginTop: 12,
    padding: 12,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatComposerDockKeyboard: {
    marginTop: 8,
    marginBottom: 12
  },
  chatComposerDockSticky: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    marginTop: 0,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -2 },
    elevation: 16
  },
  chatComposerLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8
  },
  copilotContextCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  copilotContextStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -2
  },
  copilotFocusCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  copilotFocusLabel: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase"
  },
  copilotFocusTitle: {
    marginTop: 6,
    color: "#1d2b4f",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800"
  },
  copilotFocusMeta: {
    marginTop: 6,
    color: "#5a7193",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  copilotMatterCard: {
    marginTop: 2,
    marginBottom: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  copilotMatterCardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  copilotMatterLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  copilotMatterTitle: {
    marginTop: 2,
    color: "#16233f",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800"
  },
  copilotMatterMeta: {
    marginTop: 6,
    color: "#35527a",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600"
  },
  microActionRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10
  },
  chatPrimaryRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  chatSendButtonFill: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f8b80"
  },
  chatSecondaryButtonCompact: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatIconButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatIconButtonText: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800"
  },
  microActionRowWrap: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  attachmentRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  composerToolsRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  attachmentChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#e6f7f2",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  attachmentChipText: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  miniAction: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  miniActionPrimary: {
    backgroundColor: "#d2f7ef",
    borderColor: "#b7eadf"
  },
  miniActionText: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800"
  },
  miniActionTextPrimary: {
    color: "#0f766e"
  },
  copilotReplyCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  copilotReplyText: {
    marginTop: 8,
    color: "#21434a",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600"
  },
  patchDock: {
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 10
  },
  patchDockKeyboard: {
    marginBottom: 12
  },
  patchDockHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  patchDockCopy: {
    flex: 1,
    paddingRight: 6
  },
  patchDockTitle: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  patchDockHint: {
    marginTop: 4,
    color: "#35527a",
    fontSize: 12,
    lineHeight: 18
  },
  patchDockSource: {
    marginTop: 6,
    color: "#0f766e",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700"
  },
  patchDockActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  patchApplyButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#0f8b80"
  },
  patchApplyButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800"
  },
  patchIconButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  patchIconButtonText: {
    color: "#35527a",
    fontSize: 16,
    fontWeight: "800"
  },
  patchDockBody: {
    marginTop: 10,
    color: "#21434a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600"
  },
  patchDockPreview: {
    marginTop: 8,
    color: "#35527a",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  copilotActionPanel: {
    marginTop: 14,
    gap: 10
  },
  drawerRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end"
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(14, 23, 41, 0.18)"
  },
  drawerSheet: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 92,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e6ff",
    minHeight: 62,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12
  },
  drawerSheetOpen: {
    minHeight: 320
  },
  drawerHandleWrap: {
    alignItems: "center",
    gap: 8,
    paddingBottom: 2
  },
  drawerHandleBar: {
    width: 52,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#c9d9f4"
  },
  drawerHandleText: {
    color: "#4b6180",
    fontSize: 11,
    fontWeight: "800"
  },
  drawerContent: {
    paddingTop: 8,
    paddingBottom: 4
  },
  drawerTitle: {
    color: "#1d2b4f",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12
  },
  drawerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  drawerActionChip: {
    width: "48%",
    minHeight: 74,
    padding: 13,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  drawerActionChipPrimary: {
    backgroundColor: "#d2f7ef",
    borderColor: "#b7eadf"
  },
  drawerActionTitle: {
    color: "#16233f",
    fontSize: 14,
    fontWeight: "800"
  },
  drawerActionTitlePrimary: {
    color: "#0f766e"
  },
  drawerActionSubtitle: {
    marginTop: 6,
    color: "#59708f",
    fontSize: 11,
    lineHeight: 17
  },
  reportGrid: {
    gap: 10
  },
  reportCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  reportCardLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  reportCardValue: {
    marginTop: 8,
    color: "#213351",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700"
  },
  bottomNav: {
    ...(Platform.OS === "web"
      ? {
          position: "relative",
          marginHorizontal: 18,
          marginTop: 16,
          marginBottom: 24
        }
      : {
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 88
        }),
    flexDirection: "row",
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e6ff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 2 },
    elevation: 14
  },
  bottomNavItem: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  bottomNavItemActive: {
    backgroundColor: "#d2f7ef"
  },
  bottomNavText: {
    color: "#4e6584",
    fontSize: 11,
    fontWeight: "800"
  },
  bottomNavTextActive: {
    color: "#0f766e"
  },
  inlineActions: {
    marginTop: 14,
    gap: 10
  },
  promptInput: {
    minHeight: 120,
    color: "#1d2b4f",
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top"
  },
  promptInputLarge: {
    minHeight: 54,
    maxHeight: 118,
    color: "#1d2b4f",
    fontSize: 17,
    lineHeight: 24,
    textAlignVertical: "top"
  },
  promptChipRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  chatSurface: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatSurfaceLarge: {
    marginTop: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    minHeight: 360
  },
  chatSurfaceLargeStarted: {
    minHeight: 420
  },
  chatSurfaceLargeIdle: {
    minHeight: 240
  },
  chatSurfaceTitle: {
    color: "#1d2b4f",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10
  },
  chatSurfaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  chatGestureHint: {
    color: "#5a7193",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  chatQuickActionsCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  chatQuickActionsRow: {
    flexDirection: "row",
    gap: 8
  },
  chatQuickActionPrimary: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f8b80"
  },
  chatQuickActionPrimaryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800"
  },
  chatQuickActionSecondary: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatQuickActionSecondaryText: {
    color: "#1d2b4f",
    fontSize: 13,
    fontWeight: "800"
  },
  chatHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  chatHeaderAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatHeaderActionText: {
    color: "#4e6584",
    fontSize: 12,
    fontWeight: "800"
  },
  copilotWelcomeStrip: {
    marginTop: 2,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  copilotWelcomeTitle: {
    color: "#0f766e",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotWelcomeText: {
    marginTop: 6,
    color: "#21434a",
    fontSize: 14,
    lineHeight: 20
  },
  copilotStarterCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 6
  },
  copilotStarterTitle: {
    color: "#1d2b4f",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotStarterText: {
    color: "#5a6f92",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600"
  },
  chatThread: {
    gap: 12
  },
  chatBubble: {
    padding: 14,
    borderRadius: 18,
    maxWidth: "92%"
  },
  chatBubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  chatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#d2f7ef",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  copilotProgressCard: {
    gap: 8,
    minWidth: 280,
    marginTop: 10
  },
  copilotProgressCardError: {
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2"
  },
  copilotProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  copilotProgressHeaderCopy: {
    flex: 1
  },
  copilotProgressTitle: {
    marginTop: 6,
    color: "#1d2b4f",
    fontSize: 15,
    fontWeight: "800"
  },
  copilotProgressModePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#d2f7ef",
    borderWidth: 1,
    borderColor: "#b7eadf"
  },
  copilotProgressModeText: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  copilotProgressStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  copilotProgressStatusText: {
    color: "#35527a",
    fontSize: 14,
    fontWeight: "700"
  },
  copilotProgressStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  copilotProgressStatusDotReady: {
    backgroundColor: "#10b981"
  },
  copilotProgressStatusDotError: {
    backgroundColor: "#ef4444"
  },
  copilotProgressHelperText: {
    color: "#35527a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  copilotProgressReadingText: {
    color: "#5b708d",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  chatBubbleRole: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  chatBubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  chatBubbleActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  chatBubbleCopyAction: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#eef5ff",
    borderWidth: 1,
    borderColor: "#d6e4ff"
  },
  chatBubbleCopyActionText: {
    color: "#4d6484",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  chatBubbleText: {
    marginTop: 8,
    color: "#213351",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600"
  },
  chatBubbleTextUser: {
    color: "#134e4a"
  },
  messageSuggestionsRow: {
    marginTop: 10,
    gap: 8
  },
  messageSuggestionChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  messageSuggestionText: {
    color: "#35527a",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  savedNotesCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  savedNotesTitle: {
    color: "#1d2b4f",
    fontSize: 15,
    fontWeight: "800"
  },
  savedNotesList: {
    marginTop: 10,
    gap: 8
  },
  savedNoteChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  savedNoteChipText: {
    color: "#35527a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  promptChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  promptChipText: {
    color: "#35527a",
    fontSize: 12,
    fontWeight: "800"
  },
  chatSendButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  chatSecondaryButtonText: {
    color: "#1d2b4f",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  exportTray: {
    marginTop: 4,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  compareCard: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d5e4ff",
    gap: 10
  },
  compareExcerptCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#b7eadf",
    gap: 8
  },
  compareExcerptCurrentCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#effcf7",
    borderWidth: 1,
    borderColor: "#b7eadf",
    gap: 6
  },
  compareExcerptPreviousCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
    gap: 6
  },
  compareExcerptCurrentLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  compareExcerptPreviousLabel: {
    color: "#be123c",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  compareTitle: {
    color: "#1d2b4f",
    fontSize: 16,
    fontWeight: "800"
  },
  compareLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  compareBody: {
    color: "#213351",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600"
  },
  compareBodyChangedWord: {
    fontWeight: "900",
    color: "#16233f"
  },
  compareExcerptMeta: {
    color: "#35527a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  primaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#0f766e"
  },
  primaryActionText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center"
  },
  secondaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#eff5ff",
    borderWidth: 1,
    borderColor: "#d5e4ff"
  },
  secondaryActionText: {
    color: "#1d2b4f",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center"
  }
});
