#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const runDir = process.argv[2];

if (!runDir) {
  console.error("Usage: node tools/validate-run-offline.mjs <run-folder>");
  process.exit(1);
}

const validationPath = path.join(runDir, "validation.json");
if (!existsSync(validationPath)) {
  console.error(`Could not find validation.json in ${runDir}`);
  process.exit(1);
}

const validation = readJson(validationPath);
const checks = [];

for (const section of validation.sections || []) {
  if (section.index) {
    checks.push(validateCapture({
      runDir,
      kind: "index",
      sectionLabel: section.label,
      targetLabel: "index",
      fileBaseName: section.index.fileBaseName,
      textSnapshot: section.index.textSnapshot,
      screenshot: section.index.screenshot,
      expectedValues: indexExpectedValues(section.index)
    }));
  }

  for (const detail of section.details || []) {
    if (detail.skipped) continue;
    const detailJson = detail.fileBaseName
      ? readJsonIfExists(path.join(runDir, "details", `${detail.fileBaseName}.json`))
      : null;
    checks.push(validateCapture({
      runDir,
      kind: "detail",
      sectionLabel: section.label,
      targetLabel: detail.target || "detail",
      fileBaseName: detail.fileBaseName,
      textSnapshot: detail.textSnapshot,
      screenshot: detail.screenshot,
      expectedValues: detailExpectedValues(detailJson, detail)
    }));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  runDir,
  sourceCapturedAt: validation.capturedAt || "",
  sourceMode: validation.mode || "",
  checkCount: checks.length,
  passedCount: checks.filter((check) => check.status === "pass").length,
  warningCount: checks.filter((check) => check.status === "warning").length,
  failedCount: checks.filter((check) => check.status === "fail").length,
  checks
};

writeFileSync(path.join(runDir, "offline-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(runDir, "offline-validation-report.md"), markdownReport(report));

console.log(`${report.failedCount ? "FAIL" : report.warningCount ? "WARN" : "PASS"} ${report.passedCount}/${report.checkCount} checks passed`);
console.log(path.join(runDir, "offline-validation-report.md"));

function validateCapture({ runDir, kind, sectionLabel, targetLabel, fileBaseName, textSnapshot, screenshot, expectedValues }) {
  const textPath = resolveRunPath(runDir, textSnapshot) || inferTextSnapshotPath(runDir, screenshot);
  const screenshotPath = resolveRunPath(runDir, screenshot);
  const textResult = getTextForValidation(textPath, screenshotPath);
  const expected = normalizeExpectedValues(expectedValues);

  if (!textResult.text) {
    return {
      status: "warning",
      kind,
      section: sectionLabel,
      target: targetLabel,
      fileBaseName,
      textSnapshot: textPath || "",
      screenshot: screenshotPath || "",
      checked: 0,
      matched: 0,
      missing: expected,
      notes: [textResult.note || "No text snapshot or OCR text was available."]
    };
  }

  const normalizedText = normalizeForCompare(textResult.text);
  const matched = [];
  const missing = [];

  for (const value of expected) {
    const normalizedValue = normalizeForCompare(value);
    if (!normalizedValue || normalizedText.includes(normalizedValue)) {
      matched.push(value);
      continue;
    }
    const partial = partialNeedle(normalizedValue);
    if (partial && normalizedText.includes(partial)) matched.push(value);
    else missing.push(value);
  }

  const matchRatio = expected.length ? matched.length / expected.length : 1;
  const status = missing.length === 0 ? "pass" : (matchRatio >= 0.7 ? "warning" : "fail");
  return {
    status,
    kind,
    section: sectionLabel,
    target: targetLabel,
    fileBaseName,
    textSource: textResult.source,
    textSnapshot: textPath || "",
    screenshot: screenshotPath || "",
    checked: expected.length,
    matched: matched.length,
    matchRatio,
    missing,
    notes: textResult.note ? [textResult.note] : []
  };
}

function indexExpectedValues(indexSummary) {
  return [
    indexSummary.title,
    String(indexSummary.itemCount || "")
  ];
}

function detailExpectedValues(detailJson, detailSummary) {
  const values = [
    detailSummary.title,
    detailSummary.sourceItem?.name,
    detailSummary.sourceItem?.id,
    detailSummary.sourceItem?.arn
  ];

  if (!detailJson) return values;

  addObjectValues(values, detailJson.overview);
  addObjectValues(values, detailJson.source, ["url", "title", "section", "pageMode", "mode"]);
  addObjectValues(values, detailJson.conversationalAi);
  addObjectValues(values, detailJson.flow);
  addObjectValues(values, detailJson.queue);
  addObjectValues(values, detailJson.hours);
  addControlInventoryValues(values, detailJson.controls);

  for (const table of detailJson.tables || []) {
    if (isEphemeralVersionHistoryTable(table)) continue;
    for (const header of table.headers || []) values.push(header);
    for (const row of table.rows || []) addObjectValues(values, row, ["url", "id", "arn"]);
  }

  return values;
}

function isEphemeralVersionHistoryTable(table) {
  const headers = (table.headers || []).map((header) => normalizeForCompare(header));
  return headers.includes("version") && headers.includes("status") && headers.includes("last updated");
}

function addControlInventoryValues(values, controls) {
  if (!controls || typeof controls !== "object") return;
  for (const [group, items] of Object.entries(controls)) {
    if (group === "buttons") continue;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.label) values.push(item.label);
      if (item.name) values.push(item.name);
      if (group === "tabs" && item.selected === "true" && item.label) values.push(item.label);
    }
  }
}

function addObjectValues(values, object, skipKeys = []) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return;
  const skip = new Set([
    ...skipKeys,
    "actions",
    "capturedAt",
    "confidenceScoreThreshold",
    "contentHash",
    "hash",
    "identityHash",
    "max",
    "min",
    "note",
    "promptHash",
    "source",
    "step",
    "text",
    "value",
    "warning",
    "warnings",
    "yaml"
  ]);
  for (const [key, value] of Object.entries(object)) {
    if (skip.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object") addObjectValues(values, item);
        else values.push(String(item));
      }
      continue;
    }
    if (typeof value === "object") {
      addObjectValues(values, value);
      continue;
    }
    values.push(String(value));
  }
}

function normalizeExpectedValues(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "-")
    .filter((value) => value.length <= 180)
    .filter((value) => !/^https?:\/\//i.test(value))
    .filter((value) => !/^(true|false|detail|index|all-pages|visible-page)$/i.test(value))
    .filter((value) => !/^Flow definition is not visible/i.test(value))
    .filter((value) => !/^Loading /i.test(value))
    .filter((value) => !/^Version \d+ Published /i.test(value))
    .filter((value) => !/^(Confirmation prompt|Declination response|Fulfillment)$/i.test(value))
    .filter((value) => !isGeneratedControlToken(value))
    .filter((value) => !isTechnicalControlLabel(value))
    .filter((value) => {
      const key = normalizeForCompare(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isGeneratedControlToken(value) {
  return /^(?:trigger|input):r[a-z0-9]+:$|^(?:trigger|input|formField|awsui-radio)?[:\w-]*\d{2,}(?:-\d+){1,}|^:r[a-z0-9]+:$/i.test(String(value || "").trim());
}

function isTechnicalControlLabel(value) {
  return /^(Show path|Query actions for first tab|Undo History|List of Notes|Flow display settings|Block Library|Create|Edit|Cancel|Save|Delete)$/i.test(String(value || "").trim());
}

function getTextForValidation(textPath, screenshotPath) {
  if (textPath && existsSync(textPath)) {
    return {
      source: "screen-text",
      text: readFileSync(textPath, "utf8"),
      note: ""
    };
  }

  const ocr = ocrScreenshot(screenshotPath);
  if (ocr) {
    return {
      source: "ocr",
      text: ocr,
      note: "Used local OCR because no screen-text snapshot was found."
    };
  }

  return {
    source: "none",
    text: "",
    note: "No screen-text snapshot was found and no local OCR engine was available."
  };
}

function ocrScreenshot(screenshotPath) {
  if (!screenshotPath || !existsSync(screenshotPath)) return "";
  const tesseract = commandPath("tesseract");
  if (!tesseract) return "";
  try {
    return execFileSync(tesseract, [screenshotPath, "stdout", "-l", "eng", "--psm", "6"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
  }
}

function commandPath(command) {
  try {
    return execFileSync("command", ["-v", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true
    }).trim();
  } catch {
    return "";
  }
}

function resolveRunPath(runDir, maybeRelative) {
  if (!maybeRelative) return "";
  if (path.isAbsolute(maybeRelative)) return maybeRelative;
  if (maybeRelative.startsWith(`runs${path.sep}`) || maybeRelative.startsWith("runs/")) {
    return path.join(outputRootForRun(runDir), maybeRelative);
  }
  return path.join(runDir, maybeRelative);
}

function inferTextSnapshotPath(runDir, screenshot) {
  const screenshotPath = resolveRunPath(runDir, screenshot);
  if (!screenshotPath) return "";
  return screenshotPath
    .replace(`${path.sep}screenshots${path.sep}`, `${path.sep}screen-text${path.sep}`)
    .replace(/\.png$/i, ".txt");
}

function outputRootForRun(runDir) {
  const normalized = path.resolve(runDir);
  const marker = `${path.sep}runs${path.sep}`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return normalized;
  return normalized.slice(0, markerIndex);
}

function normalizeForCompare(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partialNeedle(normalizedValue) {
  const parts = normalizedValue.split(" ").filter(Boolean);
  if (parts.length < 4) return "";
  return parts.slice(0, 8).join(" ");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonIfExists(file) {
  return existsSync(file) ? readJson(file) : null;
}

function markdownReport(report) {
  const lines = [
    "# Offline Validation Report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Source run: ${report.runDir}`,
    `- Checks: ${report.checkCount}`,
    `- Passed: ${report.passedCount}`,
    `- Warnings: ${report.warningCount}`,
    `- Failed: ${report.failedCount}`,
    "",
    "## Results",
    ""
  ];

  for (const check of report.checks) {
    lines.push(`### ${check.status.toUpperCase()} - ${check.section} / ${check.target}`);
    lines.push("");
    lines.push(`- Kind: ${check.kind}`);
    lines.push(`- Text source: ${check.textSource || "none"}`);
    lines.push(`- Checked values: ${check.checked}`);
    lines.push(`- Matched values: ${check.matched}`);
    if (check.notes?.length) {
      for (const note of check.notes) lines.push(`- Note: ${note}`);
    }
    if (check.missing?.length) {
      lines.push("- Missing values:");
      for (const value of check.missing.slice(0, 30)) lines.push(`  - \`${value}\``);
      if (check.missing.length > 30) lines.push(`  - ...and ${check.missing.length - 30} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
