# Amazon Connect Runtime Exporter Implementation Guide

## Purpose

The extension documents Amazon Connect runtime configuration and contact analytics from the signed-in console session. It is useful because the team changes prompts, guardrails, flows, agents, and related routing assets frequently, while test calls need to be tied back to the exact prompt, agent, and flow involved.

The extension avoids AWS API keys. It works through Chrome on the already-authenticated Amazon Connect console.

## Main Workflows

### Configuration Export

Use the `Configuration` tab to capture operational configuration:

- AI prompts
- AI agents
- Guardrails
- Contact flows
- Flow modules
- Conversational AI bots
- Phone numbers
- Queues
- Hours of operation

The full configuration export navigates through supported index pages, captures visible/index data, opens detail pages, and saves JSON/CSV summaries. For flows and modules, the extension also supports the official flow JSON export/import path where available.

If a detail page resolves to `You can’t access this page`, the run continues and records the attempted page in `accessDeniedUrls` inside `scan.json` or `validation.json`. Each record includes the section, item name, attempted URL, captured URL, title, message, and timestamp so permission gaps can be reviewed after the run.

Phone numbers use a section-specific index extractor. It reads Amazon Connect `#/edit?...` links and visible table fields to capture phone number, type, country, contact flow ID, phone number ARN, and related route metadata when available.

### Call Analytics Export

Use the `Analytics` tab for call/contact data:

1. Open a Contact Search period such as month, week, or today.
2. Click `Export Contact CSV`.
3. Import the downloaded CSV with `Import Contact CSV`.
4. Confirm the queue with `Dry run call queue` or `Validate call queue`.
5. Capture calls with `Capture next call`, `Capture 5 calls`, `Capture 25 calls`, `Capture 100 calls`, or `Capture N`.
6. Review `Build analytics dashboard` output.

For an unattended weekly run, use `Start weekly full run`.

That button:

1. Opens week-to-date Contact search.
2. Requests the native CSV export.
3. Shows a prompt telling the operator to import the downloaded CSV.
4. Continues automatically after CSV import.
5. Builds an initial dashboard.
6. Runs the full configuration export.
7. Captures all pending contacts in the imported CSV.
8. Builds the final dashboard.

The queue is stored at:

```text
contact-search/queues/latest-call-queue.json
```

If that file does not exist, analytics capture buttons need a CSV import first.

If Chrome shows a file or directory not found error during import, the selected output folder handle is stale. Click `Choose output folder`, select the same Connect exports folder again, and retry the CSV import. When possible, the extension falls back to Chrome downloads and lists the save warning in the import result.

The Contact CSV import creates the in-memory call queue before writing output files. If saving fails, the queue can still be used in the current extension session and is also backed up in extension storage when Chrome storage quota allows it.

## Queue States

Each contact in the queue has one of these statuses:

- `pending`: ready to capture.
- `capturing`: currently being processed.
- `done`: transcript/details were captured and normalized.
- `failed`: capture failed and can be retried.
- `skipped`: intentionally ignored, or internally used when a contact is already found in the selected output folder history.

When a newly imported CSV shows zero pending contacts, check the `already captured` count in the side panel. Contacts can be marked this way automatically when their `Contact ID` already exists in the loaded history. Use `Recapture already captured` to force only those historical contacts back to `pending` and capture them again.

Validation uses higher-level states:

- `ready`: CSV imported, no captured contacts yet.
- `partial`: some contacts captured and some still pending.
- `complete`: all contacts captured and no validation warnings.
- `warning`: captured contacts exist but some are missing summary, turns, prompt, agent, or flow.
- `error`: queue is missing or contacts failed.

When a run says `Completed with data warnings`, the export finished, but some contacts were incomplete. Review `Contacts With Warnings` in:

```text
runs/{timestamp}-{kind}/run-summary.md
analytics/latest-dashboard.md
```

## Direct Contact Capture

For speed, call capture does not normally open each contact page. It uses the contact ID from the CSV and fetches the observed Amazon Connect internal endpoints directly from the authenticated browser session:

```text
/ctr/api/contact/details/{contactId}/transcript
/ctr/api/ctr-details/{contactId}
```

If direct capture fails, the extension falls back to opening the contact trace detail page and capturing from the page context.

## Output Structure

Important output locations:

```text
runs/{timestamp}-{kind}/
_history/latest-report.json
contact-search/queues/latest-call-queue.json
contact-records/{contactId}/transcript.json
contact-records/{contactId}/summary.json
contact-records/{contactId}/conversation-turns.json
analytics/latest-dashboard.json
analytics/latest-dashboard.md
analytics/latest-contacts.csv
analytics/latest-contacts.jsonl
analytics/by-prompt/
analytics/by-agent/
analytics/by-flow/
```

Each run also writes:

```text
runs/{timestamp}-{kind}/report.json
runs/{timestamp}-{kind}/run-summary.md
```

The Markdown summary is intended for quick human review. The JSON report is intended for automation and audits.

## Extension Structure

The extension is being split by feature so long-running workflows stay easier to maintain.

Current layout:

```text
popup.js
features/call-analytics.js
lib/contact-search-csv-parser.js
lib/contact-transcript-parser.js
lib/flow-parser.js
lib/csv.js
lib/downloads.js
lib/hash.js
```

`popup.js` coordinates Chrome UI, tab navigation, progress tracking, permissions, and file writes.

`features/call-analytics.js` owns pure call analytics behavior: queue summaries, captured-contact validation, run completion messages, quality flags, analytics dashboard generation, dashboard Markdown, contacts CSV, and contacts JSONL.

The next good modularization targets are configuration scanning, run report generation, screenshot validation, and output-directory/history persistence.

## Diagnostics Plan

The extension includes a diagnostics workflow so failures can be investigated without guessing or relying only on model tokens.

Use `Run diagnostics` when:

- The selected output folder does not receive files.
- CSV import appears to do nothing.
- A run remains stuck in `Starting`.
- Chrome downloads fallback appears blocked.
- The side panel is open but the Amazon Connect page is not responding.

Diagnostics should always produce an in-extension report, even when file-system writes fail. The report is shown in `Last result` and stored as `latestDiagnosticsReport` in Chrome extension storage when quota allows it.

Current diagnostics checks:

- Extension storage read/write round trip.
- Selected output folder permission.
- Real output folder write test under `_health/`.
- Chrome downloads fallback.
- Locked Chrome tab state.
- Content script page detection.
- Synthetic Contact Search CSV parser test.
- Current call queue summary.
- Optional diagnostics report write under `_diagnostics/`.

Use `Download diagnostics report` to export the latest diagnostics JSON and Markdown through Chrome Downloads. This path intentionally avoids the selected output folder so the report can still be shared when folder permissions are broken.

Planned next diagnostics improvements:

- Add a run watchdog that marks a run as `stalled` if progress does not change for a fixed time window.
- Attach a compact diagnostics snapshot to critical errors.
- Add per-button capability checks so disabled or hidden controls can explain why they are unavailable.

## Why The Analytics Dashboard Matters

The dashboard turns raw contact transcripts into operational evidence:

- Which prompts were used in calls.
- Which AI agents were invoked.
- Which flows routed the interaction.
- Which calls lacked summary, transcript turns, prompt ID, agent ID, or flow ID.
- Which calls show quality flags such as technical issues, unresolved conversations, negative experiences, refusals, or fallback behavior.

The cross-reference folders make prompt/agent/flow usage searchable without rereading every transcript.

Current analytics scope is voice-only for prompt/agent/flow validation and detail capture. Contact Search CSV files can include other channels such as chat, and those contacts are still imported for inventory completeness, but they are marked `out_of_scope` and are not opened in the contact detail page. Missing summary, turns, prompt ID, agent ID, or flow ID are not treated as data warnings for non-voice channels. Chat analytics should be handled as a separate future workflow because Amazon Connect exposes chat transcript data differently from voice contact transcript data.

## Raw Archive Toggle

`Archive raw run JSON` controls whether large contact transcript captures are duplicated inside each `runs/...` folder.

When enabled:

- The run folder contains full raw JSON per contact.
- This is best for audit-heavy testing.

When disabled:

- The normalized `contact-records/{contactId}/` files are still saved.
- The run folder is smaller.
- This is better for long-running contact exports.

## Recommended Operating Pattern

For normal monitoring:

1. Export Contact CSV for the chosen period.
2. Import the CSV.
3. Run `Validate call queue`.
4. Capture a small test batch.
5. Review `analytics/latest-dashboard.md`.
6. Run a larger batch with raw archive disabled if storage size matters.
7. Use `Retry failed` only after reviewing failures.

For configuration changes:

1. Run a configuration export.
2. Capture contact analytics.
3. Use prompt/agent/flow IDs from analytics to identify which configuration files matter.
4. Review the related prompt or guardrail files for improvement.

## Local Verification

Run these checks from the extension folder:

```text
npm test
npm run check
```

The tests use synthetic fixtures and do not include customer data.
