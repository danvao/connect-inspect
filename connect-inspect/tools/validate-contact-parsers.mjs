import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseContactSearchCsv } from "../lib/contact-search-csv-parser.js";
import { parseContactTranscriptJson } from "../lib/contact-transcript-parser.js";
import {
  analyticsContactsCsv,
  buildAnalyticsDashboard,
  detectCallQualityFlags,
  runCompletionMessage,
  validateCallQueueState,
  validateCapturedContact
} from "../features/call-analytics.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const csv = await readFile(join(root, "test-fixtures/contact-search.csv"), "utf8");
const contactIndex = parseContactSearchCsv(csv, "contact-search.csv");

assert.equal(contactIndex.rowCount, 3);
assert.equal(contactIndex.contactCount, 3);
assert.equal(contactIndex.uniqueContactCount, 2);
assert.equal(contactIndex.duplicateCount, 1);
assert.equal(contactIndex.contacts[0].contactId, "11111111-1111-4111-8111-111111111111");
assert.match(contactIndex.contacts[0].detailUrl, /contact-trace-records\/details\/11111111-1111-4111-8111-111111111111/);

const transcriptJson = JSON.parse(await readFile(join(root, "test-fixtures/contact-transcript.json"), "utf8"));
const transcript = parseContactTranscriptJson(transcriptJson, "contact-transcript.json");

assert.equal(transcript.contactId, "11111111-1111-4111-8111-111111111111");
assert.equal(transcript.summary, "The customer asked what an investment account is. The bot answered with a concise definition.");
assert.equal(transcript.conversationTurns.length, 2);
assert.deepEqual(transcript.references.aiAgentIds, ["44444444-4444-4444-8444-444444444444"]);
assert.deepEqual(transcript.references.promptIds, ["55555555-5555-4555-8555-555555555555"]);
assert.deepEqual(transcript.references.flowIds, ["33333333-3333-4333-8333-333333333333"]);

const completeCaptureValidation = validateCapturedContact(
  { contactId: transcript.contactId, channel: "Voice" },
  {
    transcript: transcriptJson,
    contactTranscript: transcript
  }
);
assert.equal(completeCaptureValidation.status, "success");

const chatCaptureValidation = validateCapturedContact(
  { contactId: "99999999-9999-4999-8999-999999999999", channel: "Chat" },
  {
    transcript: {},
    contactTranscript: {}
  }
);
assert.equal(chatCaptureValidation.status, "out_of_scope");

const queue = {
  totalContacts: 4,
  pendingContacts: 1,
  outOfScopeContacts: 1,
  skippedContacts: 0,
  capturedContacts: 1,
  failedContacts: 1,
  contacts: [
    {
      contactId: transcript.contactId,
      status: "done",
      channel: "Voice",
      capturedAt: "2026-09-13T20:00:00.000Z",
      aiAgentIds: transcript.references.aiAgentIds,
      promptIds: transcript.references.promptIds,
      flowIds: transcript.references.flowIds,
      conversationTurnCount: transcript.conversationTurns.length,
      summary: transcript.summary,
      qualityFlags: detectCallQualityFlags({
        summary: "The call ended without resolution after an unrelated question was declined.",
        conversationTurns: transcript.conversationTurns
      })
    },
    {
      contactId: "99999999-9999-4999-8999-999999999999",
      status: "out_of_scope",
      channel: "Chat",
      capturedAt: "2026-09-13T20:01:00.000Z",
      conversationTurnCount: 0,
      summary: "",
      promptIds: [],
      aiAgentIds: [],
      flowIds: []
    },
    {
      contactId: "22222222-2222-4222-8222-222222222222",
      status: "pending"
    },
    {
      contactId: "33333333-3333-4333-8333-333333333333",
      status: "failed",
      error: "Network transcript was not found."
    }
  ]
};

const queueValidation = validateCallQueueState(queue);
assert.equal(queueValidation.status, "error");
assert.equal(queueValidation.capturedContacts, 1);
assert.equal(queueValidation.voiceScopeCapturedContacts, 1);
assert.equal(queueValidation.outOfScopeChannelCount, 1);
assert.equal(queueValidation.pendingContacts, 1);
assert.equal(queueValidation.failedContacts, 1);
assert.equal(queueValidation.warningContacts.length, 1);
assert.equal(queueValidation.missingSummaryCount, 0);
assert.equal(queueValidation.missingPromptCount, 0);
assert.match(runCompletionMessage(queueValidation, queue, [{ status: "done" }, { status: "failed" }]), /Completed with errors/);

const dashboard = buildAnalyticsDashboard(queue, [{ contactId: transcript.contactId, status: "done" }]);
assert.equal(dashboard.summary.uniquePromptCount, 1);
assert.equal(dashboard.summary.uniqueAgentCount, 1);
assert.equal(dashboard.summary.uniqueFlowCount, 1);
assert.equal(dashboard.summary.voiceScopeCapturedContacts, 1);
assert.equal(dashboard.summary.outOfScopeChannelCount, 1);
assert.equal(dashboard.byPrompt["55555555-5555-4555-8555-555555555555"].count, 1);
assert.equal(dashboard.contacts.length, 2);
assert.match(analyticsContactsCsv(dashboard.contacts), /contactId,capturedAt,channel,status/);

console.log(JSON.stringify({
  status: "ok",
  contactSearch: {
    rows: contactIndex.rowCount,
    uniqueContacts: contactIndex.uniqueContactCount,
    duplicates: contactIndex.duplicateCount
  },
  transcript: {
    contactId: transcript.contactId,
    turns: transcript.conversationTurns.length,
    aiAgentIds: transcript.references.aiAgentIds.length,
    promptIds: transcript.references.promptIds.length,
    flowIds: transcript.references.flowIds.length
  },
  analytics: {
    queueStatus: queueValidation.status,
    dashboardContacts: dashboard.contacts.length,
    promptCount: dashboard.summary.uniquePromptCount,
    outOfScopeChannelCount: dashboard.summary.outOfScopeChannelCount
  }
}, null, 2));
