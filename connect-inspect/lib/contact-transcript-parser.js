const ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]+:\d+:[^\s"',)]+/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function parseContactTranscriptJson(transcriptJson, sourceFileName = "") {
  const interactionLogs = Array.isArray(transcriptJson?.InteractionLogs) ? transcriptJson.InteractionLogs : [];
  const analysisTranscript = Array.isArray(transcriptJson?.Analysis?.transcript) ? transcriptJson.Analysis.transcript : [];
  const allText = JSON.stringify(transcriptJson);
  const arns = unique(allText.match(ARN_PATTERN) || []);
  const aiAgentSpans = collectAiAgentSpans(transcriptJson);
  const references = buildReferences(arns, allText, aiAgentSpans);

  return {
    sourceFileName,
    awsAccountId: transcriptJson?.AWSAccountId || "",
    instanceId: transcriptJson?.InstanceId || "",
    contactId: transcriptJson?.ContactId || "",
    interactionLogsStatus: transcriptJson?.InteractionLogsStatus || "",
    logCount: interactionLogs.length,
    analysisTranscriptCount: analysisTranscript.length,
    channel: transcriptJson?.Analysis?.channel || "",
    eventTypes: countBy(interactionLogs.map((log) => log.EventType || "Unknown")),
    contentTypes: countBy(interactionLogs.map((log) => log.ContentType || "Unknown")),
    sources: countBy(interactionLogs.map((log) => log.Source || "Unknown")),
    actionTypes: countBy(extractActionTypes(interactionLogs)),
    resourceNames: unique(extractValuesByKey(transcriptJson, "ResourceName")),
    summary: transcriptJson?.Analysis?.contactSummary?.automatedInteractionSummary?.content || "",
    sentiment: transcriptJson?.Analysis?.conversationCharacteristics?.sentiment || {},
    sentimentPercentage: transcriptJson?.Analysis?.conversationCharacteristics?.sentimentPercentage || {},
    references,
    aiAgentSpans,
    messages: extractMessages(interactionLogs, analysisTranscript),
    conversationTurns: extractConversationTurns(interactionLogs, analysisTranscript),
    timeline: buildTimeline(interactionLogs),
    warnings: buildWarnings(transcriptJson, references)
  };
}

function extractConversationTurns(interactionLogs, analysisTranscript) {
  const analysisTurns = analysisTranscript
    .filter((item) => item?.content)
    .map((item) => ({
      time: item.absoluteTime || "",
      speaker: item.participantRole || "",
      source: "Analysis",
      text: item.content,
      sentiment: item.sentiment || ""
    }));
  if (analysisTurns.length) return analysisTurns;

  return interactionLogs
    .filter((log) => log?.LogData?.Content)
    .map((log) => ({
      time: log.AbsoluteTime || "",
      speaker: log.Source || "",
      source: log.Source || "",
      text: log.LogData.Content,
      sentiment: ""
    }));
}

function buildReferences(arns, allText, aiAgentSpans) {
  const aiAgentArns = arns.filter((arn) => /:ai-agent\//i.test(arn));
  const promptArns = arns.filter((arn) => /:ai-prompt\//i.test(arn));
  const contactFlowArns = arns.filter((arn) => /\/contact-flow\//i.test(arn));
  const lexBotAliasArns = arns.filter((arn) => /:bot-alias\//i.test(arn));
  const queueArns = arns.filter((arn) => /\/queue\//i.test(arn));

  const aiAgentIds = unique([
    ...extractNamedUuidValues(allText, ["AiAgentId", "AIAgentId", "aiAgentId"]),
    ...aiAgentSpans.map((span) => span.aiAgentId),
    ...aiAgentArns.map((arn) => wisdomResourceId(arn, "ai-agent"))
  ].filter(Boolean));
  const promptIds = unique([
    ...extractNamedUuidValues(allText, ["PromptId", "AIPromptId", "aiPromptId"]),
    ...aiAgentSpans.map((span) => span.promptId),
    ...promptArns.map((arn) => wisdomResourceId(arn, "ai-prompt"))
  ].filter(Boolean));
  const flowIds = unique(contactFlowArns.map((arn) => arn.split("/").pop()).filter(Boolean));

  return {
    arns,
    aiAgentArns,
    promptArns,
    contactFlowArns,
    lexBotAliasArns,
    queueArns,
    aiAgentIds,
    promptIds,
    flowIds,
    aiAgentLinks: aiAgentIds.map((id) => `https://invest-america.my.connect.aws/q-connect/ai-agents/${encodeURIComponent(id)}`),
    promptLinks: promptIds.map((id) => `https://invest-america.my.connect.aws/q-connect/ai-prompts/${encodeURIComponent(id)}`),
    flowLinks: contactFlowArns.map((arn) => `https://invest-america.my.connect.aws/contact-flows/edit?id=${encodeURIComponent(arn)}&actionId=&tab=designer`),
    uuids: unique(allText.match(UUID_PATTERN) || [])
  };
}

function collectAiAgentSpans(root) {
  const spans = [];
  walk(root, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const aiAgentId = value.AiAgentId || value.AIAgentId || value.aiAgentId || "";
    const promptId = value.PromptId || value.AIPromptId || value.aiPromptId || "";
    const aiAgentArn = value.AiAgentArn || value.AIAgentArn || value.aiAgentArn || "";
    const promptArn = value.PromptArn || value.AIPromptArn || value.promptArn || "";
    if (aiAgentId || promptId || aiAgentArn || promptArn) {
      spans.push({
        aiAgentId,
        aiAgentArn,
        promptId,
        promptArn,
        startTime: value.StartTime || value.startTime || "",
        endTime: value.EndTime || value.endTime || "",
        spanId: value.SpanId || value.spanId || ""
      });
    }
  });
  return uniqueObjects(spans, (span) => `${span.aiAgentId}|${span.promptId}|${span.aiAgentArn}|${span.promptArn}|${span.startTime}`);
}

function extractMessages(interactionLogs, analysisTranscript) {
  const messages = [];
  for (const log of interactionLogs) {
    const content = log?.LogData?.Content;
    if (!content) continue;
    messages.push({
      absoluteTime: log.AbsoluteTime || "",
      source: log.Source || "",
      eventType: log.EventType || "",
      content
    });
  }
  for (const item of analysisTranscript) {
    if (!item?.content) continue;
    messages.push({
      absoluteTime: item.absoluteTime || "",
      source: item.participantRole || "",
      eventType: item.type || "AnalysisTranscript",
      sentiment: item.sentiment || "",
      content: item.content
    });
  }
  return messages;
}

function buildTimeline(interactionLogs) {
  return interactionLogs.map((log) => ({
    absoluteTime: log.AbsoluteTime || "",
    source: log.Source || "",
    eventType: log.EventType || "",
    contentType: log.ContentType || "",
    resourceName: log.LogData?.ResourceName || "",
    resourceArn: log.LogData?.ResourceArn || "",
    actionType: log.LogData?.Action?.Type || "",
    actionIdentifier: log.LogData?.Action?.Identifier || "",
    executionResult: log.LogData?.Action?.ExecutionResult || ""
  }));
}

function extractActionTypes(interactionLogs) {
  return interactionLogs.map((log) => log?.LogData?.Action?.Type).filter(Boolean);
}

function extractValuesByKey(root, key) {
  const values = [];
  walk(root, (value) => {
    if (value && typeof value === "object" && !Array.isArray(value) && value[key]) values.push(value[key]);
  });
  return values;
}

function extractNamedUuidValues(text, names) {
  const values = [];
  for (const name of names) {
    const pattern = new RegExp(`["']?${escapeRegExp(name)}["']?\\s*[:=]\\s*["']?([0-9a-f-]{36})["']?`, "gi");
    for (const match of String(text || "").matchAll(pattern)) {
      if (match[1]) values.push(match[1]);
    }
  }
  return values;
}

function wisdomResourceId(arn, resourceType) {
  const match = String(arn).match(new RegExp(`${escapeRegExp(resourceType)}/[^/]+/([^/:]+)(?::[^/]+)?$`, "i"));
  return match?.[1] || "";
}

function buildWarnings(transcriptJson, references) {
  const warnings = [];
  if (!transcriptJson?.ContactId) warnings.push("No ContactId found in transcript JSON.");
  if (!references.contactFlowArns.length) warnings.push("No contact flow ARN found in transcript JSON.");
  if (!references.aiAgentIds.length) warnings.push("No AI agent ID found in transcript JSON.");
  if (!references.promptIds.length) warnings.push("No AI prompt ID found in transcript JSON.");
  return warnings;
}

function walk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visitor);
  }
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueObjects(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
