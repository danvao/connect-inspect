# Validation Review - 2026-09-14

## Guardrail and AI-Agent Artifact Review - 2026-09-28

Reviewed the existing normalized export directory containing three guardrail details and 22 AI-agent detail artifacts.

### Guardrails

- The three captures contained useful configuration rather than only page text.
- Coverage included identity, ARN, status, versions, content-filter strengths, denied topics, sensitive-information behavior, contextual grounding, word filters, and blocked messaging.
- The source detail files also contained duplicated text and console navigation links. These remain useful as evidence but should not be the primary analysis input.
- A dedicated `-configuration.json` artifact is now generated with normalized fields only.

### AI Agents

- Valid captures contained identity and ARN, type, locale, related prompts, orchestration tools, security profiles, and version history.
- The previous extractor incorrectly copied the tools table into `securityProfiles` because that table contains a Permissions column. Table classification now uses the complete header shape.
- Related prompts were previously available only inside generic tables. They are now normalized under `configuration.prompts` with IDs and URLs.
- Three stale `captured-current.json` artifacts used `-` placeholders for required overview fields. Each had a later valid detail capture, but the older validator did not flag the placeholders. Placeholder-only values are now treated as missing data.

### Result

Guardrail exports were substantively useful but unnecessarily noisy. AI-agent exports were partially useful but required normalization and one table-classification correction. New manual downloads preserve the full detail JSON as evidence and add a cleaner `-configuration.json` file with an explicit `complete` or `warning` validation status.

## Source Run

- Run inspected: `20260914T024131Z-validation_screenshots`
- Mode: `validation-screenshots`
- Expected screenshots: `22`
- Screenshots generated: `22`
- Run warnings observed in `validation.json`: none

Note: during the review, the original Desktop export run folder was no longer present in `Connect exports`. The observations below are based on the JSON files and screenshots inspected before that folder disappeared from the filesystem view.

## High-Level Result

The navigation and screenshot capture workflow completed successfully. The validation found extraction-quality issues in a few fields, not navigation failures.

## Confirmed Matches

### Flow Modules Index

Screenshot showed:

- `Modules (1)`
- Row: `module test`
- Status: `Saved`
- Tool: `-`

Extracted JSON matched the visible index row and count.

### Flow Module Details

Screenshot showed:

- Active tab: `Details`
- Name: `module test`
- Type: `Modules`
- ARN for the flow module
- Tags area with no visible tags

Extracted JSON matched name, type, and ARN. Empty tags were not incorrectly fabricated.

### Conversational AI Index

Screenshot showed:

- `Conversational AI (18)`
- Columns: `Name`, `Status`, `Description`, `Latest version`, `Actions`
- First row: `a-self-service-lf`, `Available`, latest version `1`

Extracted JSON matched the index count and first visible row.

### Conversational AI Aliases

Screenshot showed two aliases:

- `connect-ai`, associated version `1`, use in flow/modules `Enabled`
- `TestBotAlias`, associated version `DRAFT`, use in flow/modules `Disabled`

Extracted table rows matched the screenshot.

### Conversational AI Versions

Screenshot showed two versions:

- `1`, associated alias `connect-ai`, created `08/27/26, 09:46:03 AM UTC`
- `DRAFT`, associated alias `TestBotAlias`, created `08/27/26, 09:38:46 AM UTC`

Extracted table rows matched the screenshot.

## Issues Found And Fixed

### Empty Tables Were Captured As Real Rows

Affected screenshots:

- Flow module `Versions`: visible empty state `No results were found`
- Flow module `Aliases`: visible empty state `No results were found`

Previous extraction:

- Stored `No results were found` as a table row.

Fix:

- Added empty-state filtering in `readTableElement()` via `isEmptyStateTableRow()`.
- Future exports should return no table rows for those empty states.

### Conversational AI Description Noise

Affected pages:

- Conversational AI `Details`
- Conversational AI `Aliases`
- Conversational AI `Versions`

Previous extraction examples:

- Details description became `a-self-service-lf` even though the visible description was empty.
- Aliases description became `on`.
- Versions description became `versionActions`.

Fix:

- `readConversationalAiOverview()` now reads description only on the `Details` page.
- It rejects helper/placeholder text and rejects a description equal to the entity name.
- Aliases, Versions, and Configuration no longer attempt to infer an overview description.

### Conversational AI Configuration Was Too Sparse

Screenshot showed visible configuration data such as:

- Language: `English (US)`, `Built`
- Warning: `English (US) has unbuilt changes`
- Confidence score threshold: `0.4`
- Speech-to-Text: `Amazon`
- Intent list and prompt snippets
- Fulfillment / Code Hooks / Input Context / Output Context states

Previous extraction:

- Captured mostly only page and bot ID.

Fix:

- Added stronger extraction for language/status pairs.
- Added numeric threshold detection for `Confidence score threshold`.
- Added inline status detection for `Amazon Connect AI agent in Connect intent`.
- Expanded prompt snippet capture for visible Conversational AI prompt fields.
- Expanded helper-text rejection so prompt helper descriptions are not mistaken for values.

## Still Not Fully Solved

### Designer Canvas Blocks

Flow module designer screenshots visibly show blocks such as:

- `Entry`
- `Create task`
- `Get customer input`

The extension still does not parse the visual canvas into block-level configuration. For flow/module runtime logic, the reliable source should remain the official JSON export from Amazon Connect.

### Conversational AI Configuration Needs One More Live Validation

The parser has been improved, but it should be rerun against the live page to confirm whether Amazon Connect exposes those values as text/control values in the DOM consistently.

## Recommended Next Test

1. Reload the unpacked Chrome extension.
2. Run `Validation screenshots`.
3. Check these specific files:
   - Flow module aliases JSON should have no rows when the UI says `No results were found`.
   - Flow module versions JSON should have no rows when the UI says `No results were found`.
   - Conversational AI aliases/versions overview should not contain a bogus `description`.
   - Conversational AI configuration should include at least language/status and confidence threshold when visible.
