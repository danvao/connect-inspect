# Amazon Connect Runtime Exporter

Chrome extension MVP for exporting Amazon Connect runtime configuration from the signed-in console at:

```text
https://invest-america.my.connect.aws/*
```

No AWS API keys or IAM credentials are required. The extension reads the visible console page through the active Chrome session.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

```text
/Users/danielvazquez/Documents/Codex/2026-09-11/nec/outputs/ai-prompts-capture-extension
```

If the Amazon Connect tab was already open before loading the extension, refresh the tab once.

## Open The Fixed Side Panel

After loading or reloading the extension:

1. Click the extension icon in Chrome.
2. Chrome opens the extension in the right side panel.
3. Keep the side panel open while navigating Amazon Connect.

The side panel should stay open when Amazon Connect reloads or changes sections.

The side panel locks itself to the Chrome tab from which it was opened. If you switch to another browser tab, the panel may remain visible because Chrome side panels are window-level UI, but exporter actions continue targeting the original locked Amazon Connect tab instead of the newly active tab. Screenshot validation temporarily reactivates the locked tab before each screenshot so it does not capture the wrong page.

## Output Folder And Reports

Use `Choose output folder` to select where generated files should be written.

If Chrome allows folder access, files are written directly to that folder. If folder access is unavailable or fails, the extension falls back to Chrome downloads.

Every export operation also writes a report file:

```text
amazon-connect-export-report-*.json
```

The report includes:

- operation kind
- output target
- files generated
- byte sizes
- SHA-256 hash per file
- section summaries
- warnings

This report is intended as the easiest "latest export manifest" to import or review before deciding whether a full re-export is necessary.

## Current MVP Features

- Navigate to the main supported Amazon Connect sections from the popup.
- Run from Chrome's fixed right side panel.
- Run a smoke scan across the main sections: full index plus first item detail.
- Run a larger validation scan: full index plus first 5 item details per section.
- Run a full configuration export across supported sections: full index plus every navigable detail page.
- Write an export report/manifest for each capture run.
- Detect current Amazon Connect section.
- Capture visible index tables as JSON and CSV.
- Capture all visible paginated index pages with `Capture all pages`.
- Capture current detail page as JSON.
- Identify versions on AI prompts, AI agents, and guardrails by opening the version dropdown when possible.
- Export AI prompt text as YAML when captured from a prompt detail page.
- Import official Contact Flow JSON export and produce a runtime map.
- Import Contact transcript JSON and produce a call runtime map with contact flows, Lex bot aliases, AI agent IDs, AI prompt IDs, transcript messages, summary, and sentiment fields.
- Trigger the official Contact Flow JSON export from a flow designer/detail page.
- Generate scan summaries and SHA-256 hashes for identity/content comparison.
- Treat the Flows area as three separate configuration sources: Contact flows, Flow modules, and Conversational AI.
- For Conversational AI bots, capture `Details`, `Configuration`, `Aliases`, and `Versions` during automated detail scans. Analytics is intentionally excluded from configuration scans.
- During screenshot validation, save a text snapshot beside each screenshot under `screen-text/` so JSON-vs-screen validation can run offline without using an LLM.
- Capture the Phone numbers index as runtime routing context. Phone number rows are parsed from the Amazon Connect `#/edit?...` links and table fields so the index can be captured even when the page is rendered by a custom web component. The official Amazon Connect CSV export includes `Phone Number`, `Description`, `Phone Type`, `Active Channels`, `Contact flow/IVR`, and `Country`.
- When a detail page opens as `You can’t access this page`, the scan report records an `accessDeniedUrls` list with the section, item name, attempted URL, captured URL, title, and timestamp. This is expected when the signed-in user lacks permission for specific resources.
- Capture Contact search result pages as analytics context. Keep this separate from `Full config export`. The official Amazon Connect CSV export includes `Contact ID`, `Channel`, `Contact status`, `Initiation timestamp`, `System phone number`, `Queue`, `Agent`, `Customer phone number`, `Disconnect timestamp`, `Contact duration`, `System email address`, and `Customer email address`.
- `Export Contact CSV` clicks the native Amazon Connect `Download CSV` button on Contact search. Use this as the reliable index export path for calls while the DOM index reader is limited by the Contact search web component.
- `Import Contact CSV` reads the native Contact search CSV, normalizes contacts, dedupes by `Contact ID`, and writes `contact-search/queues/latest-call-queue.json`.
- The call queue supports dry runs and configurable captures (`Capture next call`, `Capture 5 calls`, `Capture 25 calls`, `Capture 100 calls`, or `Capture N`). Queue contact states are `pending`, `capturing`, `done`, `failed`, `skipped`, or `out_of_scope`.
- `Start weekly full run` opens week-to-date Contact search, exports the CSV, waits for manual CSV import, then continues with dashboard/config export/call capture automatically.
- Failed contacts can be retried, reset to pending, or skipped. `Resume pending` continues from the first pending contact using the configured `Calls to capture` value.
- `Validate call queue` checks captured calls for missing summaries, turns, prompt IDs, agent IDs, flow IDs, endpoint failures, and navigation fallback usage. Data warnings list the affected contact IDs.
- Current call analytics scope is voice-only. Non-voice contacts such as chat remain in the imported queue as `out_of_scope`, but they are not opened, captured, or validated for missing summary/turn/prompt/agent/flow fields until chat analytics is implemented separately.
- `Build analytics dashboard` writes `analytics/latest-dashboard.json`, `analytics/latest-dashboard.md`, `analytics/latest-contacts.csv`, and `analytics/latest-contacts.jsonl`.
- Cross-reference indexes are written under `analytics/by-prompt/`, `analytics/by-agent/`, and `analytics/by-flow/` so prompt/agent/flow usage can be counted without re-reading every transcript.
- The `Archive raw run JSON` toggle controls whether full contact transcript JSON is duplicated inside each `runs/...` folder. Normalized contact files under `contact-records/{contactId}/` are still saved.
- Long-running scans and call queues can be stopped with `Stop after current item`; the current page/call finishes first, then the run report is saved with a warning.
- Captured transcripts are normalized under `contact-records/{contactId}/` with `transcript.json`, `summary.json`, and `conversation-turns.json`.
- Contact search navigation includes dynamic relative-period presets: today, week to date, last two weeks, month to date, and last month. Dedupe call history by `Contact ID`; keep the latest capture metadata to avoid reprocessing already captured contacts.
- Capture Contact trace record details as call analytics context. The detail capture focuses on summary/trace/flow references, ARNs, IDs, phone numbers, tables, and links; audio is intentionally out of scope for this extractor.
- Contact transcript imports are the preferred source for call-to-configuration mapping when available. They can expose `AiAgentId`, `PromptId`, contact flow ARN, Lex bot alias ARN, `Analysis.contactSummary`, and `Analysis.transcript` even when the details page does not expose those fields to the DOM.
- `Capture network transcript` listens for the contact transcript JSON response while a contact detail page loads. If no transcript has been observed, reload the contact detail page with the extension enabled and run the capture again.
- The observed contact transcript endpoint uses the CTR prefix: `/ctr/api/contact/details/{contactId}/transcript`.
- The contact metadata endpoint observed in DevTools is `/ctr/api/ctr-details/{contactId}` and is captured alongside the transcript when available.
- Local validation is available from this folder with `npm test` and `npm run check`. The parser test uses synthetic fixtures only, so no customer data is committed.

For a fuller implementation and operations guide, see:

```text
docs/implementation-guide.md
```

## Supported Pages

- `/contact-flows`
- `/contact-flows/edit?...`
- `/contact-flows#contactFlows`
- `/contact-flows#modules`
- `/contact-flows#bots`
- `/flow-modules/edit?...`
- `/bots/details/{id}`
- `/bots/configuration/{id}`
- `/bots/aliases/{id}`
- `/bots/versions/{id}`
- `/q-connect/ai-prompts`
- `/q-connect/ai-prompts/{id}`
- `/q-connect/ai-agents`
- `/q-connect/ai-agents/{id}`
- `/q-connect/guardrails`
- `/q-connect/guardrails/{id}`
- `/numbers#/`
- `/contact-search?...`
- `/contact-trace-records/details/{contactId}?tz=...`
- `/queues`
- `/queues/edit?...`
- `/operating-hours`
- `/operating-hours/{id}/edit`
- `/predefined-attributes`
- `/views`
- `/historical-changes/...`

## Safety Rules

The extension is designed for read-only capture.

Do not automate or click:

- `Publish`
- `Save`
- `Delete`
- `Create`
- `Add`
- `Remove`
- `Confirm`

If Amazon Connect shows `Unsaved Changes`, cancel or stop. Do not confirm through automation.

## Recommended Test Order

1. From any Amazon Connect page, click `Smoke scan sections`.
2. Confirm it downloads one full index and one first-item detail per section.
3. Click `Validation screenshots` after extractor changes to confirm representative screens.
4. Click `Full config export` for the normal complete configuration run.
5. Open `/q-connect/ai-prompts`, or click `AI Prompts` in the extension navigation.
6. Run `Capture all pages`.
7. Open one prompt detail page.
8. Run `Identify versions`.
9. Run `Capture detail` and confirm the YAML download.
10. Export a flow JSON manually from Amazon Connect, or click `Export Flow JSON` from a flow page.
11. Use `Import Flow JSON` in the extension to generate the runtime map.

For flow JSON, you can also open a flow designer/detail page and click `Export Flow JSON`. This triggers Amazon Connect's official JSON download. After the download finishes, use `Import Flow JSON` to parse it into a runtime map.

## Supporting Documentation

- `docs/screenshot-analysis-prompt.md`: prompt template for turning Amazon Connect screenshots into English configuration reports during manual validation.
- `docs/amazon-connect-config-report.md`: example/manual analysis report generated from Amazon Connect screenshots, useful as a target format for screenshot validation and future Analytics documentation.
- `docs/validation-review-2026-09-14.md`: latest screenshot-vs-extraction validation notes and extraction fixes.

## Offline Screenshot Validation

After running `Validation screenshots`, the extension writes:

```text
runs/<run-id>/screenshots/...
runs/<run-id>/screen-text/...
runs/<run-id>/validation.json
```

Use the local validator to compare extracted JSON against the saved visible-text snapshots:

```bash
node /Users/danielvazquez/Documents/Codex/2026-09-11/nec/outputs/ai-prompts-capture-extension/tools/validate-run-offline.mjs "/Users/danielvazquez/Desktop/Connect exports/runs/<run-id>"
```

It writes:

```text
offline-validation-report.json
offline-validation-report.md
```

The validator does not call an AI model. It first uses `screen-text/*.txt`, which is more reliable than OCR because it comes from the Amazon Connect page DOM. If no text snapshot exists, it can optionally use local `tesseract` OCR if installed; otherwise it marks the check as a warning instead of guessing.

## Known MVP Limits

- Pagination is automated for standard numeric/Next-page index tables, but should be verified per section.
- Version-by-version navigation is not automated yet. The extension records selected version labels as the next step.
- Smoke scan captures only the first detail item per section.
- `Scan 5 details/section` captures only the first 5 detail items per section.
- `Full config export` can take substantially longer because it opens every navigable detail target.
- Flow JSON export is imported manually for now.
- `Export Flow JSON` triggers the official download, but Chrome does not let the extension read the downloaded file from disk automatically. Import the downloaded JSON afterward.
- Folder selection is persisted when Chrome grants file-system access. If Chrome revokes it or the extension is reloaded in a way that loses the handle, select the output folder again.
- Guardrail tabs are summarized from visible DOM. Hidden tabs may need to be opened before capture.
- Conversational AI analytics is a future extension section, separate from configuration capture.
- Offline validation compares JSON to visible text, not visual layout. Keep screenshots for human review of layout/canvas details.
