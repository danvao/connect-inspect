const ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]+:\d+:[^\s"',)]+/gi;

export function parseFlowJson(flowJson, sourceFileName = "") {
  const actions = Array.isArray(flowJson?.Actions) ? flowJson.Actions : [];
  const metadataActions = flowJson?.Metadata?.ActionMetadata || {};
  const allText = JSON.stringify(flowJson);
  const arns = unique(allText.match(ARN_PATTERN) || []);

  const references = {
    aiAgentArns: arns.filter((arn) => arn.includes(":ai-agent/")),
    wisdomAssistantArns: arns.filter((arn) => arn.includes(":assistant/")),
    lexBotAliasArns: arns.filter((arn) => arn.includes(":bot-alias/") || arn.includes(":bot-alias/")),
    lambdaArns: arns.filter((arn) => arn.includes(":function:")),
    queueArns: arns.filter((arn) => arn.includes("/queue/")),
    contactFlowArns: arns.filter((arn) => arn.includes("/contact-flow/"))
  };

  return {
    sourceFileName,
    version: flowJson?.Version || "",
    startAction: flowJson?.StartAction || "",
    actionCount: actions.length,
    metadataActionCount: Object.keys(metadataActions).length,
    actionTypes: countBy(actions.map((action) => action.Type || "Unknown")),
    references,
    messages: extractMessages(actions),
    runtimeChain: buildRuntimeChain(references),
    warnings: buildWarnings(flowJson, references)
  };
}

function buildRuntimeChain(references) {
  return {
    flow: {
      referencedContactFlows: references.contactFlowArns
    },
    lex: {
      botAliases: references.lexBotAliasArns
    },
    aiAgents: references.aiAgentArns.map(parseVersionedArn),
    queues: references.queueArns,
    lambdas: references.lambdaArns
  };
}

function parseVersionedArn(arn) {
  const [baseArn, version = ""] = arn.split(/:(?=[^:]+$)/);
  const id = baseArn.split("/").pop() || "";
  return { arn, baseArn, id, version };
}

function extractMessages(actions) {
  const messages = [];
  for (const action of actions) {
    const json = JSON.stringify(action);
    const ssmlMatches = json.match(/<speak[\s\S]*?<\/speak>/gi) || [];
    for (const ssml of ssmlMatches) {
      messages.push({
        actionId: action.Identifier || action.id || "",
        actionType: action.Type || "",
        format: "ssml",
        text: ssml
      });
    }
  }
  return messages;
}

function buildWarnings(flowJson, references) {
  const warnings = [];
  if (!flowJson?.Actions) warnings.push("No Actions array found in imported flow JSON.");
  if (!references.aiAgentArns.length) warnings.push("No AI Agent ARN found in flow JSON.");
  if (!references.lexBotAliasArns.length) warnings.push("No Lex bot alias ARN found in flow JSON.");
  return warnings;
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function unique(values) {
  return [...new Set(values)];
}
