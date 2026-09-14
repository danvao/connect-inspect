import { toCsv } from "../lib/csv.js";

export function summarizeCallQueue(queue) {
  return {
    totalContacts: queue?.totalContacts || 0,
    pendingContacts: queue?.pendingContacts || 0,
    outOfScopeContacts: queue?.outOfScopeContacts || 0,
    skippedContacts: queue?.skippedContacts || 0,
    capturedContacts: queue?.capturedContacts || 0,
    failedContacts: queue?.failedContacts || 0,
    firstPending: queue?.contacts?.find((contact) => contact.status === "pending")?.contactId || ""
  };
}

export function validateCapturedContact(contact, result) {
  const warnings = [];
  const transcript = result.contactTranscript || {};
  if (!contact.contactId) warnings.push("Missing contactId.");
  if (!warnings.length && !isVoiceAnalyticsContact(contact)) {
    return {
      status: "out_of_scope",
      analyticsScope: "non-voice",
      reason: `Channel ${contact.channel || "unknown"} is outside the current voice analytics scope.`,
      warnings: []
    };
  }
  if (!result.transcript) warnings.push("Missing raw transcript response.");
  if (!transcript.summary) warnings.push("Missing call summary.");
  if (!Array.isArray(transcript.conversationTurns) || transcript.conversationTurns.length === 0) warnings.push("No conversation turns found.");
  if (!transcript.references?.aiAgentIds?.length) warnings.push("No AI agent ID detected.");
  if (!transcript.references?.promptIds?.length) warnings.push("No prompt ID detected.");
  if (!transcript.references?.flowIds?.length) warnings.push("No flow ID detected.");
  return {
    status: warnings.length ? "warning" : "success",
    warnings
  };
}

export function validateCallQueueState(queue) {
  const contacts = queue?.contacts || [];
  if (!contacts.length) {
    return {
      status: "error",
      totalContacts: 0,
      capturedContacts: 0,
      pendingContacts: 0,
      failedContacts: 0,
      missingSummaryCount: 0,
      missingTurnCount: 0,
      missingPromptCount: 0,
      missingAgentCount: 0,
      missingFlowCount: 0,
      fallbackCount: 0,
      warnings: ["Import Contact CSV first. No call queue is loaded."]
    };
  }
  const captured = contacts.filter((contact) => contact.status === "done");
  const voiceCaptured = captured.filter(isVoiceAnalyticsContact);
  const nonVoiceContacts = contacts.filter((contact) => !isVoiceAnalyticsContact(contact));
  const failed = contacts.filter((contact) => contact.status === "failed");
  const pending = contacts.filter((contact) => contact.status === "pending" || contact.status === "capturing");
  const missingSummary = voiceCaptured.filter((contact) => !contact.summary);
  const missingTurns = voiceCaptured.filter((contact) => !contact.conversationTurnCount);
  const missingPrompt = voiceCaptured.filter((contact) => !(contact.promptIds || []).length);
  const missingAgent = voiceCaptured.filter((contact) => !(contact.aiAgentIds || []).length);
  const missingFlow = voiceCaptured.filter((contact) => !(contact.flowIds || []).length);
  const fallbackCount = voiceCaptured.filter((contact) => contact.usedNavigationFallback).length;
  const warningContacts = buildWarningContacts(voiceCaptured, failed);
  const warnings = [
    ...failed.slice(0, 25).map((contact) => `${contact.contactId}: ${contact.error || "failed"}`),
    ...(missingSummary.length ? [`${missingSummary.length} captured contacts are missing summaries.`] : []),
    ...(missingTurns.length ? [`${missingTurns.length} captured contacts have no conversation turns.`] : []),
    ...(missingPrompt.length ? [`${missingPrompt.length} captured contacts have no prompt ID.`] : []),
    ...(missingAgent.length ? [`${missingAgent.length} captured contacts have no AI agent ID.`] : []),
    ...(missingFlow.length ? [`${missingFlow.length} captured contacts have no flow ID.`] : []),
    ...(fallbackCount ? [`${fallbackCount} captured contacts used navigation fallback.`] : [])
  ];
  const status = failed.length
    ? "error"
    : (warnings.length
      ? "warning"
      : (!captured.length && pending.length
        ? "ready"
        : (captured.length && pending.length ? "partial" : "complete")));
  return {
    status,
    totalContacts: contacts.length,
    capturedContacts: captured.length,
    voiceScopeCapturedContacts: voiceCaptured.length,
    outOfScopeChannelCount: nonVoiceContacts.length,
    pendingContacts: pending.length,
    failedContacts: failed.length,
    missingSummaryCount: missingSummary.length,
    missingTurnCount: missingTurns.length,
    missingPromptCount: missingPrompt.length,
    missingAgentCount: missingAgent.length,
    missingFlowCount: missingFlow.length,
    fallbackCount,
    warningContacts,
    warnings
  };
}

export function buildWarningContacts(captured, failed) {
  const items = [];
  for (const contact of failed) {
    items.push({
      contactId: contact.contactId,
      status: contact.status,
      reasons: [contact.error || "Capture failed."],
      channel: contact.channel || "",
      contactStatus: contact.contactStatus || ""
    });
  }
  for (const contact of captured) {
    const reasons = [];
    if (!contact.summary) reasons.push("Missing summary");
    if (!contact.conversationTurnCount) reasons.push("No conversation turns");
    if (!(contact.promptIds || []).length) reasons.push("No prompt ID");
    if (!(contact.aiAgentIds || []).length) reasons.push("No AI agent ID");
    if (!(contact.flowIds || []).length) reasons.push("No flow ID");
    if (contact.usedNavigationFallback) reasons.push("Used navigation fallback");
    if (!reasons.length) continue;
    items.push({
      contactId: contact.contactId,
      status: contact.status,
      reasons,
      channel: contact.channel || "",
      contactStatus: contact.contactStatus || "",
      capturedAt: contact.capturedAt || ""
    });
  }
  return items;
}

export function runCompletionMessage(validation, queueSummary, results = []) {
  const captured = results.filter((result) => result.status === "done").length || queueSummary.capturedContacts || 0;
  const attempted = results.length || captured;
  const failed = queueSummary.failedContacts || results.filter((result) => result.status === "failed").length || 0;
  if (validation?.status === "warning") {
    return `Completed with data warnings - ${captured}${attempted ? `/${attempted}` : ""} captured / ${failed} failed`;
  }
  if (validation?.status === "error") {
    return `Completed with errors - ${captured}${attempted ? `/${attempted}` : ""} captured / ${failed} failed`;
  }
  return `Completed - ${captured}${attempted ? `/${attempted}` : ""} captured / ${failed} failed`;
}

export function detectCallQualityFlags(contactTranscript) {
  const text = [
    contactTranscript.summary || "",
    ...(contactTranscript.conversationTurns || []).map((turn) => turn.text || "")
  ].join(" ").toLowerCase();
  const flags = [];
  if (/technical issue|error|encountered a problem|could not process|unable to process/.test(text)) flags.push("technical-issue");
  if (/dissatisfaction|not interested|frustrated|unhappy|bad experience|complaint/.test(text)) flags.push("negative-experience");
  if (/without resolution|no resolution|ended without|could not do|could not help|cannot help/.test(text)) flags.push("unresolved");
  if (/unrelated question|declined|outside|not able to answer|only help with/.test(text)) flags.push("out-of-scope-or-refusal");
  if (/fallback|did not understand|try again|repeat/.test(text)) flags.push("fallback-or-understanding");
  return [...new Set(flags)];
}

export function buildAnalyticsDashboard(queue, currentRunResults = []) {
  const contacts = queue?.contacts || [];
  const captured = contacts.filter((contact) => contact.status === "done");
  const voiceCaptured = captured.filter(isVoiceAnalyticsContact);
  const nonVoiceContacts = contacts.filter((contact) => !isVoiceAnalyticsContact(contact));
  const reportableContacts = contacts.filter((contact) => contact.status === "done" || contact.status === "out_of_scope");
  const byPrompt = aggregateContactsByIds(voiceCaptured, "promptIds");
  const byAgent = aggregateContactsByIds(voiceCaptured, "aiAgentIds");
  const byFlow = aggregateContactsByIds(voiceCaptured, "flowIds");
  const qualityFlags = aggregateQualityFlags(voiceCaptured);
  const runResultContacts = currentRunResults.filter((result) => result.contactId);
  const validation = validateCallQueueState(queue);
  return {
    generatedAt: new Date().toISOString(),
    source: { section: "contact-search", mode: "analytics-dashboard" },
    summary: {
      ...summarizeCallQueue(queue),
      uniquePromptCount: Object.keys(byPrompt).length,
      uniqueAgentCount: Object.keys(byAgent).length,
      uniqueFlowCount: Object.keys(byFlow).length,
      qualityFlagCount: Object.values(qualityFlags).reduce((sum, item) => sum + item.count, 0),
      currentRunContactCount: runResultContacts.length,
      voiceScopeCapturedContacts: voiceCaptured.length,
      outOfScopeChannelCount: nonVoiceContacts.length,
      validationStatus: validation.status
    },
    validation,
    warningContacts: validation.warningContacts || [],
    byPrompt,
    byAgent,
    byFlow,
    qualityFlags,
    currentRunResults: runResultContacts,
    contacts: reportableContacts.map(compactAnalyticsContact)
  };
}

export function aggregateContactsByIds(contacts, field) {
  const groups = {};
  for (const contact of contacts) {
    for (const id of contact[field] || []) {
      if (!id) continue;
      groups[id] ||= {
        id,
        count: 0,
        contactIds: [],
        qualityFlags: {},
        latestCapturedAt: ""
      };
      groups[id].count += 1;
      groups[id].contactIds.push(contact.contactId);
      groups[id].latestCapturedAt = latestIso([groups[id].latestCapturedAt, contact.capturedAt]);
      for (const flag of contact.qualityFlags || []) {
        groups[id].qualityFlags[flag] = (groups[id].qualityFlags[flag] || 0) + 1;
      }
    }
  }
  return groups;
}

export function aggregateQualityFlags(contacts) {
  const groups = {};
  for (const contact of contacts) {
    for (const flag of contact.qualityFlags || []) {
      groups[flag] ||= { flag, count: 0, contactIds: [] };
      groups[flag].count += 1;
      groups[flag].contactIds.push(contact.contactId);
    }
  }
  return groups;
}

export function compactAnalyticsContact(contact) {
  return {
    contactId: contact.contactId,
    capturedAt: contact.capturedAt || "",
    channel: contact.channel || "",
    contactStatus: contact.contactStatus || "",
    initiationTimestamp: contact.initiationTimestamp || "",
    contactDuration: contact.contactDuration || "",
    aiAgentIds: contact.aiAgentIds || [],
    promptIds: contact.promptIds || [],
    flowIds: contact.flowIds || [],
    conversationTurnCount: contact.conversationTurnCount || 0,
    qualityFlags: contact.qualityFlags || [],
    summary: contact.summary || "",
    analyticsScope: isVoiceAnalyticsContact(contact) ? "voice" : "non-voice",
    usedNavigationFallback: Boolean(contact.usedNavigationFallback)
  };
}

export function analyticsContactsCsv(contacts) {
  return toCsv(contacts.map((contact) => ({
    contactId: contact.contactId,
    capturedAt: contact.capturedAt,
    channel: contact.channel,
    status: contact.contactStatus,
    initiatedAt: contact.initiationTimestamp,
    duration: contact.contactDuration,
    aiAgentIds: (contact.aiAgentIds || []).join(";"),
    promptIds: (contact.promptIds || []).join(";"),
    flowIds: (contact.flowIds || []).join(";"),
    conversationTurnCount: contact.conversationTurnCount,
    analyticsScope: contact.analyticsScope || "",
    qualityFlags: (contact.qualityFlags || []).join(";"),
    usedNavigationFallback: contact.usedNavigationFallback ? "true" : "false",
    summary: contact.summary
  })));
}

export function analyticsContactsJsonl(contacts) {
  return contacts.map((contact) => JSON.stringify(contact)).join("\n");
}

export function analyticsDashboardMarkdown(dashboard) {
  const summary = dashboard.summary || {};
  const validation = dashboard.validation || {};
  const lines = [
    "# Amazon Connect Analytics Dashboard",
    "",
    `Generated at: ${dashboard.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Total contacts: ${summary.totalContacts || 0}`,
    `- Captured contacts: ${summary.capturedContacts || 0}`,
    `- Pending contacts: ${summary.pendingContacts || 0}`,
    `- Failed contacts: ${summary.failedContacts || 0}`,
    `- Unique prompts: ${summary.uniquePromptCount || 0}`,
    `- Unique agents: ${summary.uniqueAgentCount || 0}`,
    `- Unique flows: ${summary.uniqueFlowCount || 0}`,
    `- Voice-scope captured contacts: ${summary.voiceScopeCapturedContacts || 0}`,
    `- Out-of-scope non-voice contacts: ${summary.outOfScopeChannelCount || 0}`,
    `- Validation: ${summary.validationStatus || validation.status || "unknown"}`,
    "",
    "## Validation",
    "",
    ...(validation.warnings?.length ? validation.warnings.map((warning) => `- ${warning}`) : ["- No warnings."]),
    "",
    "## Contacts With Warnings",
    "",
    ...(validation.warningContacts?.length
      ? validation.warningContacts.map((contact) => `- ${contact.contactId}: ${(contact.reasons || []).join("; ")}`)
      : ["- None"]),
    "",
    "## Prompts",
    "",
    ...markdownIndexRows(dashboard.byPrompt || {}),
    "",
    "## Agents",
    "",
    ...markdownIndexRows(dashboard.byAgent || {}),
    "",
    "## Flows",
    "",
    ...markdownIndexRows(dashboard.byFlow || {}),
    "",
    "## Quality Flags",
    "",
    ...Object.values(dashboard.qualityFlags || {}).sort((a, b) => b.count - a.count).map((item) => `- ${item.flag}: ${item.count}`)
  ];
  return lines.join("\n");
}

export function markdownIndexRows(index) {
  const rows = Object.values(index).sort((a, b) => b.count - a.count);
  if (!rows.length) return ["- None"];
  return rows.map((row) => `- ${row.id}: ${row.count} contacts`);
}

function latestIso(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

export function isVoiceAnalyticsContact(contact) {
  const channel = String(contact?.channel || "").trim();
  if (!channel) return true;
  return /^voice$/i.test(channel);
}
