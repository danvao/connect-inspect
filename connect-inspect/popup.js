import { toCsv, metadataRows } from "./lib/csv.js";
import { sha256Hex } from "./lib/hash.js";
import { downloadDataUrl, downloadText, jsonText, sanitizeFilenamePart, timestampSlug } from "./lib/downloads.js";
import { parseFlowJson } from "./lib/flow-parser.js";
import { parseContactTranscriptJson } from "./lib/contact-transcript-parser.js";
import { parseContactSearchCsv } from "./lib/contact-search-csv-parser.js";
import {
  analyticsContactsCsv,
  analyticsContactsJsonl,
  analyticsDashboardMarkdown,
  buildAnalyticsDashboard,
  detectCallQualityFlags,
  isVoiceAnalyticsContact,
  runCompletionMessage,
  summarizeCallQueue,
  validateCallQueueState,
  validateCapturedContact
} from "./features/call-analytics.js";

const DIRECTORY_HANDLE_KEY = "outputDirectory";
const DIRECTORY_DB_NAME = "amazon-connect-exporter";
const DIRECTORY_STORE_NAME = "handles";
const APP_ORIGIN = "https://invest-america.my.connect.aws";
const SAVE_TIMEOUT_MS = 15000;
const STORAGE_KEYS = {
  history: "connectExportHistory",
  outputTargetLabel: "connectOutputTargetLabel",
  callQueue: "connectCallQueue",
  latestDiagnosticsReport: "connectLatestDiagnosticsReport"
};

const state = {
  activeTab: null,
  lockedTabId: null,
  lockedWindowId: null,
  detected: null,
  lastResult: null,
  lastBaseName: "",
  currentRun: null,
  latestDiagnosticsReport: null,
  scanRunning: false,
  stopRequested: false,
  callQueue: null,
  pendingCsvAutomation: null,
  archiveRawRuns: true,
  outputDirectoryHandle: null,
  persistedDirectoryHandle: null,
  history: null,
  outputTargetLabel: "Chrome downloads"
};

const els = {
  sectionBadge: document.getElementById("sectionBadge"),
  currentUrl: document.getElementById("currentUrl"),
  detectedSection: document.getElementById("detectedSection"),
  chooseOutputFolder: document.getElementById("chooseOutputFolder"),
  loadHistory: document.getElementById("loadHistory"),
  validateLastRun: document.getElementById("validateLastRun"),
  runDiagnostics: document.getElementById("runDiagnostics"),
  downloadDiagnostics: document.getElementById("downloadDiagnostics"),
  stopRun: document.getElementById("stopRun"),
  outputTarget: document.getElementById("outputTarget"),
  historyStatus: document.getElementById("historyStatus"),
  queueStatus: document.getElementById("queueStatus"),
  smokeScan: document.getElementById("smokeScan"),
  scanFive: document.getElementById("scanFive"),
  scanAll: document.getElementById("scanAll"),
  validationScan: document.getElementById("validationScan"),
  captureIndex: document.getElementById("captureIndex"),
  captureAllIndex: document.getElementById("captureAllIndex"),
  captureDetail: document.getElementById("captureDetail"),
  captureNetworkTranscript: document.getElementById("captureNetworkTranscript"),
  identifyVersions: document.getElementById("identifyVersions"),
  exportFlowJson: document.getElementById("exportFlowJson"),
  exportContactSearchCsv: document.getElementById("exportContactSearchCsv"),
  startWeeklyLongRun: document.getElementById("startWeeklyLongRun"),
  flowJsonInput: document.getElementById("flowJsonInput"),
  contactTranscriptInput: document.getElementById("contactTranscriptInput"),
  contactSearchCsvInput: document.getElementById("contactSearchCsvInput"),
  dryRunCallQueue: document.getElementById("dryRunCallQueue"),
  captureNextCall: document.getElementById("captureNextCall"),
  captureFiveCalls: document.getElementById("captureFiveCalls"),
  captureTwentyFiveCalls: document.getElementById("captureTwentyFiveCalls"),
  captureHundredCalls: document.getElementById("captureHundredCalls"),
  captureCallLimit: document.getElementById("captureCallLimit"),
  captureCustomCalls: document.getElementById("captureCustomCalls"),
  resumePendingCalls: document.getElementById("resumePendingCalls"),
  recaptureAlreadyCapturedCalls: document.getElementById("recaptureAlreadyCapturedCalls") || document.getElementById("resetSkippedCalls"),
  retryFailedCalls: document.getElementById("retryFailedCalls"),
  resetFailedCalls: document.getElementById("resetFailedCalls"),
  skipFailedCalls: document.getElementById("skipFailedCalls"),
  validateCallQueue: document.getElementById("validateCallQueue"),
  buildAnalyticsDashboard: document.getElementById("buildAnalyticsDashboard"),
  runImportedCsvAutomation: document.getElementById("runImportedCsvAutomation"),
  archiveRawRuns: document.getElementById("archiveRawRuns"),
  downloadLast: document.getElementById("downloadLast"),
  resultBox: document.getElementById("resultBox"),
  versionsPanel: document.getElementById("versionsPanel"),
  versionsList: document.getElementById("versionsList"),
  exportSelectedVersions: document.getElementById("exportSelectedVersions"),
  runTrackerPanel: document.getElementById("runTrackerPanel"),
  runTrackerStatus: document.getElementById("runTrackerStatus"),
  runTrackerProgress: document.getElementById("runTrackerProgress"),
  runTrackerDetails: document.getElementById("runTrackerDetails")
};

init();

async function init() {
  bindEvents();
  bindTabRefreshEvents();
  await lockToInitialTab();
  await restorePersistedState().catch((error) => {
    state.outputDirectoryHandle = null;
    state.persistedDirectoryHandle = null;
    state.outputTargetLabel = "Chrome downloads";
    els.outputTarget.textContent = state.outputTargetLabel;
    updateHistoryStatus(null);
    console.warn("Could not restore persisted output folder.", error);
  });
  await detectPage();
}

async function lockToInitialTab() {
  if (state.lockedTabId) return state.activeTab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab available to lock the side panel.");
  state.activeTab = tab;
  state.lockedTabId = tab.id;
  state.lockedWindowId = tab.windowId;
  return tab;
}

function bindEvents() {
  document.querySelectorAll("[data-view-tab]").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.viewTab));
  });
  document.querySelectorAll("[data-nav], [data-contact-search-period]").forEach((button) => {
    button.addEventListener("click", async () => {
      const destinationPath = navPathForButton(button);
      await navigateTo(destinationPath);
      const section = runtimeSectionForPath(destinationPath);
      if (section) {
        await ensureRuntimeSectionActive(section);
        await detectPage({ silent: true });
      }
    });
  });
  els.chooseOutputFolder.addEventListener("click", chooseOutputFolder);
  els.loadHistory.addEventListener("click", () => loadHistoryFromOutputFolder({ requestPermission: true }));
  els.validateLastRun.addEventListener("click", validateLastRunFromFolder);
  els.runDiagnostics.addEventListener("click", runDiagnostics);
  els.downloadDiagnostics.addEventListener("click", downloadDiagnosticsReport);
  els.stopRun.addEventListener("click", requestStopRun);
  els.smokeScan.addEventListener("click", () => scanSections({ detailLimit: 1, kind: "SMOKE_SCAN_SECTIONS" }));
  els.scanFive.addEventListener("click", () => scanSections({ detailLimit: 5, kind: "SCAN_FIVE_DETAILS_PER_SECTION" }));
  els.scanAll.addEventListener("click", () => scanSections({ detailLimit: null, kind: "FULL_CONFIG_EXPORT" }));
  els.validationScan.addEventListener("click", validationScreenshotScan);
  els.captureIndex.addEventListener("click", () => runCapture("CAPTURE_INDEX"));
  els.captureAllIndex.addEventListener("click", () => runCapture("CAPTURE_ALL_INDEX"));
  els.captureDetail.addEventListener("click", () => runCapture("CAPTURE_DETAIL"));
  els.captureNetworkTranscript.addEventListener("click", () => runCapture("CAPTURE_NETWORK_TRANSCRIPT"));
  els.identifyVersions.addEventListener("click", identifyVersions);
  els.exportFlowJson.addEventListener("click", () => runCapture("EXPORT_FLOW_JSON", { download: false }));
  els.exportContactSearchCsv.addEventListener("click", () => runCapture("EXPORT_CONTACT_SEARCH_CSV", { download: true }));
  els.startWeeklyLongRun.addEventListener("click", startWeeklyLongRun);
  els.dryRunCallQueue.addEventListener("click", dryRunCallQueue);
  els.captureNextCall.addEventListener("click", () => captureCallQueue({ limit: 1 }));
  els.captureFiveCalls.addEventListener("click", () => captureCallQueue({ limit: 5 }));
  els.captureTwentyFiveCalls.addEventListener("click", () => captureCallQueue({ limit: 25 }));
  els.captureHundredCalls.addEventListener("click", () => captureCallQueue({ limit: 100 }));
  els.captureCustomCalls.addEventListener("click", () => captureCallQueue({ limit: readCustomCallLimit() }));
  els.resumePendingCalls.addEventListener("click", () => captureCallQueue({ limit: readCustomCallLimit() }));
  els.recaptureAlreadyCapturedCalls.addEventListener("click", () => recaptureAlreadyCapturedCallQueue());
  els.retryFailedCalls.addEventListener("click", () => retryFailedCallQueue());
  els.resetFailedCalls.addEventListener("click", () => updateFailedContacts("pending", "failed-reset"));
  els.skipFailedCalls.addEventListener("click", () => updateFailedContacts("skipped", "failed-skipped"));
  els.validateCallQueue.addEventListener("click", validateCurrentCallQueue);
  els.buildAnalyticsDashboard.addEventListener("click", buildAnalyticsDashboardFromQueue);
  els.runImportedCsvAutomation.addEventListener("click", () => runImportedCsvAutomation({ includeConfigExport: true, captureAllPending: true }));
  els.archiveRawRuns.addEventListener("change", () => {
    state.archiveRawRuns = Boolean(els.archiveRawRuns.checked);
  });
  els.downloadLast.addEventListener("click", downloadLastResult);
  els.exportSelectedVersions.addEventListener("click", exportSelectedVersions);
  els.flowJsonInput.addEventListener("click", resetFileInputBeforePick);
  els.contactTranscriptInput.addEventListener("click", resetFileInputBeforePick);
  els.contactSearchCsvInput.addEventListener("click", resetFileInputBeforePick);
  els.flowJsonInput.addEventListener("change", importFlowJson);
  els.contactTranscriptInput.addEventListener("change", importContactTranscriptJson);
  els.contactSearchCsvInput.addEventListener("change", importContactSearchCsv);
}

function resetFileInputBeforePick(event) {
  event.target.value = "";
}

function setActiveView(viewName) {
  const view = viewName === "analytics" ? "analytics" : "config";
  document.body.dataset.activeView = view;
  updateQueueStatus(state.callQueue);
  document.querySelectorAll("[data-view-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTab === view);
  });
  document.querySelectorAll(".configPanel").forEach((panel) => {
    panel.classList.toggle("hidden", view !== "config");
  });
  document.querySelectorAll(".analyticsPanel").forEach((panel) => {
    panel.classList.toggle("hidden", view !== "analytics");
  });
}

function navPathForButton(button) {
  if (button.dataset.contactSearchPeriod) {
    return buildContactSearchPath(button.dataset.contactSearchPeriod);
  }
  return button.dataset.nav;
}

function buildContactSearchPath(relativePeriod, date = new Date()) {
  const params = new URLSearchParams({
    completedFilter: "1",
    inProgressFilter: "1",
    relativeAmount: "1",
    relativePeriod,
    relativeStartTime: date.toISOString(),
    relativeUnit: "HOUR",
    timeZone: "America/Mexico_City",
    timestampType: "INITIATED",
    type: "RELATIVE_TIME"
  });
  return `/contact-search?${params.toString()}`;
}

async function chooseOutputFolder() {
  try {
    if (!window.showDirectoryPicker) {
      throw new Error("This Chrome context does not expose folder selection. Falling back to Chrome downloads.");
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await setOutputDirectoryHandle(handle);
    let historyWarning = "";
    try {
      await loadHistoryFromOutputFolder({ silent: true, requestPermission: false });
    } catch (historyError) {
      historyWarning = `Folder selected, but history could not be loaded yet: ${friendlyErrorMessage(historyError)}`;
    }
    let writeTest = null;
    try {
      writeTest = await testOutputFolderWrite();
    } catch (writeError) {
      writeTest = {
        status: "failed",
        warning: friendlyErrorMessage(writeError)
      };
    }
    printResult({
      status: "Output folder selected",
      target: state.outputTargetLabel,
      history: state.history ? summarizeHistory(state.history) : null,
      writeTest,
      warning: historyWarning,
      note: "This folder will be remembered. Chrome may ask for permission again after browser or extension restarts."
    });
  } catch (error) {
    state.outputDirectoryHandle = null;
    state.outputTargetLabel = "Chrome downloads";
    els.outputTarget.textContent = state.outputTargetLabel;
    setError(error);
  }
}

async function restorePersistedState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.history,
    STORAGE_KEYS.outputTargetLabel,
    STORAGE_KEYS.callQueue,
    STORAGE_KEYS.latestDiagnosticsReport
  ]);
  if (stored[STORAGE_KEYS.history]) {
    state.history = stored[STORAGE_KEYS.history];
    updateHistoryStatus(state.history);
  }
  if (stored[STORAGE_KEYS.callQueue]) {
    state.callQueue = stored[STORAGE_KEYS.callQueue];
    updateQueueStatus(state.callQueue);
  }
  if (stored[STORAGE_KEYS.latestDiagnosticsReport]) {
    state.latestDiagnosticsReport = stored[STORAGE_KEYS.latestDiagnosticsReport];
    els.downloadDiagnostics.disabled = false;
  }

  const handle = await readDirectoryHandle().catch(() => null);
  if (!handle) {
    if (stored[STORAGE_KEYS.outputTargetLabel]) {
      state.outputTargetLabel = stored[STORAGE_KEYS.outputTargetLabel];
      els.outputTarget.textContent = `${state.outputTargetLabel} (reselect)`;
    }
    return;
  }

  state.persistedDirectoryHandle = handle;
  const permission = await queryDirectoryPermission(handle);
  state.outputTargetLabel = handle.name || stored[STORAGE_KEYS.outputTargetLabel] || "Selected folder";

  if (permission === "granted") {
    state.outputDirectoryHandle = handle;
    els.outputTarget.textContent = state.outputTargetLabel;
    await loadHistoryFromOutputFolder({ silent: true, requestPermission: false, preserveResult: true }).catch(() => {});
  } else {
    els.outputTarget.textContent = `${state.outputTargetLabel} (permission needed)`;
  }
}

async function setOutputDirectoryHandle(handle) {
  state.outputDirectoryHandle = handle;
  state.persistedDirectoryHandle = handle;
  state.outputTargetLabel = handle.name || "Selected folder";
  els.outputTarget.textContent = state.outputTargetLabel;
  await persistDirectoryHandle(handle);
  await chrome.storage.local.set({ [STORAGE_KEYS.outputTargetLabel]: state.outputTargetLabel });
}

async function ensureOutputDirectoryHandle({ requestPermission = false } = {}) {
  const handle = state.outputDirectoryHandle || state.persistedDirectoryHandle;
  if (!handle) return null;

  let permission = await queryDirectoryPermission(handle);
  if (permission !== "granted" && requestPermission && handle.requestPermission) {
    permission = await handle.requestPermission({ mode: "readwrite" });
  }

  if (permission === "granted") {
    state.outputDirectoryHandle = handle;
    state.persistedDirectoryHandle = handle;
    state.outputTargetLabel = handle.name || state.outputTargetLabel || "Selected folder";
    els.outputTarget.textContent = state.outputTargetLabel;
    return handle;
  }

  state.outputDirectoryHandle = null;
  if (handle.name) {
    state.outputTargetLabel = handle.name;
    els.outputTarget.textContent = `${handle.name} (permission needed)`;
  }
  return null;
}

async function testOutputFolderWrite() {
  if (!state.outputDirectoryHandle) {
    throw new Error("No output folder is currently selected.");
  }
  const filename = `_health/output-folder-write-test-${timestampSlug()}.json`;
  const payload = jsonText({
    status: "ok",
    target: state.outputTargetLabel,
    testedAt: new Date().toISOString()
  });
  const savedFilename = await withTimeout(
    writeTextToDirectory(filename, payload),
    SAVE_TIMEOUT_MS,
    `Timed out while testing output folder write: ${filename}`
  );
  return {
    status: "ok",
    file: savedFilename
  };
}

async function queryDirectoryPermission(handle) {
  if (!handle?.queryPermission) return "denied";
  return handle.queryPermission({ mode: "readwrite" });
}

async function loadHistoryFromOutputFolder(options = {}) {
  const { silent = false, requestPermission = false, preserveResult = false } = options;
  const handle = await ensureOutputDirectoryHandle({ requestPermission });
  if (!handle) {
    throw new Error("Choose or reconnect an output folder before loading history.");
  }

  if (!silent) {
    printResult({ status: "Loading history", target: handle.name || state.outputTargetLabel });
  }

  const history = await buildHistoryFromDirectory(handle);
  state.history = history;
  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: history,
    [STORAGE_KEYS.outputTargetLabel]: state.outputTargetLabel
  });
  updateHistoryStatus(history);

  if (!silent && !preserveResult) {
    state.lastResult = history;
    state.lastBaseName = `amazon-connect-history-${timestampSlug()}`;
    printResult({
      status: "History loaded",
      ...summarizeHistory(history)
    });
  }

  return history;
}

async function runDiagnostics() {
  const startedAt = new Date();
  const report = {
    reportVersion: 1,
    kind: "EXTENSION_DIAGNOSTICS",
    startedAt: startedAt.toISOString(),
    completedAt: "",
    status: "running",
    target: state.outputTargetLabel,
    detected: state.detected || null,
    lockedTabId: state.lockedTabId || null,
    checks: {},
    findings: [],
    recommendations: []
  };

  printResult({
    status: "Running diagnostics",
    startedAt: report.startedAt,
    target: report.target
  });

  report.checks.extensionStorage = await diagnosticCheck("extensionStorage", async () => {
    const key = "connectDiagnosticsStorageProbe";
    const value = { checkedAt: new Date().toISOString(), nonce: crypto.randomUUID() };
    await chrome.storage.local.set({ [key]: value });
    const stored = await chrome.storage.local.get([key]);
    await chrome.storage.local.remove(key);
    if (stored[key]?.nonce !== value.nonce) throw new Error("Storage round trip mismatch.");
    return { stored: true };
  });

  report.checks.outputFolderPermission = await diagnosticCheck("outputFolderPermission", async () => {
    const handle = state.outputDirectoryHandle || state.persistedDirectoryHandle;
    if (!handle) {
      return { selected: false, target: state.outputTargetLabel, permission: "none" };
    }
    const permission = await queryDirectoryPermission(handle);
    return { selected: true, name: handle.name || state.outputTargetLabel, permission };
  });

  report.checks.outputFolderWrite = await diagnosticCheck("outputFolderWrite", async () => {
    const handle = await ensureOutputDirectoryHandle({ requestPermission: true });
    if (!handle) throw new Error("No writable output folder is selected.");
    return testOutputFolderWrite();
  });

  report.checks.chromeDownloadsFallback = await diagnosticCheck("chromeDownloadsFallback", async () => {
    const filename = `amazon-connect-diagnostics-download-test-${timestampSlug()}.txt`;
    await withTimeout(
      downloadText(filename, `diagnostics test ${new Date().toISOString()}`, "text/plain"),
      SAVE_TIMEOUT_MS,
      `Timed out while testing Chrome downloads fallback: ${filename}`
    );
    return { downloaded: true, filename };
  });

  report.checks.lockedTab = await diagnosticCheck("lockedTab", async () => {
    const tab = await getLockedTab();
    return {
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url || "",
      title: tab.title || ""
    };
  });

  report.checks.contentScript = await diagnosticCheck("contentScript", async () => {
    const response = await sendToContent("DETECT_PAGE");
    if (!response?.ok) throw new Error(response?.error || "Content script did not return page detection.");
    return {
      detected: response.detected,
      title: response.title || "",
      url: response.url || ""
    };
  });

  report.checks.csvParser = await diagnosticCheck("csvParser", async () => {
    const csv = [
      "Contact ID,Channel,Contact status,Initiation timestamp",
      "11111111-1111-4111-8111-111111111111,Voice,Completed,2026-09-14T00:00:00Z",
      "11111111-1111-4111-8111-111111111111,Voice,Completed,2026-09-14T00:00:00Z",
      "22222222-2222-4222-8222-222222222222,Chat,Completed,2026-09-14T00:01:00Z"
    ].join("\n");
    const parsed = parseContactSearchCsv(csv, "diagnostics.csv");
    return {
      rows: parsed.rowCount,
      contacts: parsed.contactCount,
      uniqueContacts: parsed.uniqueContactCount,
      duplicates: parsed.duplicateCount,
      firstContactId: parsed.contacts[0]?.contactId || ""
    };
  });

  report.checks.callQueue = await diagnosticCheck("callQueue", async () => {
    const summary = summarizeCallQueue(state.callQueue);
    return {
      loaded: Boolean(state.callQueue?.contacts?.length),
      summary,
      skippedBreakdown: skippedQueueBreakdown(state.callQueue)
    };
  });

  report.checks.outputReportWrite = await diagnosticCheck("outputReportWrite", async () => {
    const handle = await ensureOutputDirectoryHandle({ requestPermission: false });
    if (!handle) throw new Error("No writable output folder is selected.");
    const path = `_diagnostics/latest-diagnostics.json`;
    const snapshot = { ...report, completedAt: new Date().toISOString(), status: "partial" };
    const savedFilename = await withTimeout(
      writeTextToDirectory(path, jsonText(snapshot)),
      SAVE_TIMEOUT_MS,
      `Timed out while writing diagnostics report: ${path}`
    );
    return { saved: true, filename: savedFilename };
  });

  finalizeDiagnostics(report);
  await persistDiagnosticsReport(report);
  state.lastResult = report;
  state.lastBaseName = `amazon-connect-diagnostics-${timestampSlug(startedAt)}`;
  els.downloadLast.disabled = false;
  els.downloadDiagnostics.disabled = false;
  printResult(report);
}

async function diagnosticCheck(name, fn) {
  const startedAt = new Date();
  try {
    const details = await fn();
    return {
      name,
      status: "ok",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      details
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      error: friendlyErrorMessage(error)
    };
  }
}

function finalizeDiagnostics(report) {
  const checks = Object.values(report.checks || {});
  const failed = checks.filter((check) => check.status === "failed");
  report.completedAt = new Date().toISOString();
  report.status = failed.length ? "warning" : "ok";
  report.findings = failed.map((check) => `${check.name}: ${check.error}`);
  const recommendations = [];
  if (report.checks.outputFolderWrite?.status === "failed") {
    recommendations.push("Reconnect the output folder with Choose output folder, then rerun diagnostics.");
  }
  if (report.checks.chromeDownloadsFallback?.status === "failed") {
    recommendations.push("Check Chrome download permissions and whether automatic downloads are blocked.");
  }
  if (report.checks.contentScript?.status === "failed") {
    recommendations.push("Open an Amazon Connect tab and reopen the side panel from that tab.");
  }
  if (report.checks.callQueue?.details?.loaded === false) {
    recommendations.push("Import a Contact Search CSV before running call capture.");
  }
  report.recommendations = recommendations;
  report.markdown = diagnosticsMarkdown(report);
  return report;
}

async function persistDiagnosticsReport(report) {
  state.latestDiagnosticsReport = report;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.latestDiagnosticsReport]: report });
  } catch (error) {
    report.storageWarning = `Could not store diagnostics report in extension storage: ${friendlyErrorMessage(error)}`;
  }
}

async function downloadDiagnosticsReport() {
  try {
    const report = state.latestDiagnosticsReport;
    if (!report) throw new Error("No diagnostics report available. Run diagnostics first.");
    const baseName = `amazon-connect-diagnostics-${timestampSlug(new Date(report.startedAt || Date.now()))}`;
    await downloadText(`${baseName}.json`, jsonText(report), "application/json");
    await downloadText(`${baseName}.md`, report.markdown || diagnosticsMarkdown(report), "text/markdown");
    printResult({
      status: "Diagnostics report downloaded",
      files: [`${baseName}.json`, `${baseName}.md`]
    });
  } catch (error) {
    setError(error);
  }
}

function diagnosticsMarkdown(report) {
  const lines = [
    "# Amazon Connect Exporter Diagnostics",
    "",
    `Status: ${report.status || "unknown"}`,
    `Started at: ${report.startedAt || ""}`,
    `Completed at: ${report.completedAt || ""}`,
    `Target: ${report.target || ""}`,
    `Locked tab: ${report.lockedTabId || ""}`,
    "",
    "## Checks",
    ""
  ];
  for (const check of Object.values(report.checks || {})) {
    lines.push(`- ${check.name}: ${check.status}${check.error ? ` - ${check.error}` : ""}`);
  }
  lines.push("", "## Findings", "");
  lines.push(...(report.findings?.length ? report.findings.map((finding) => `- ${finding}`) : ["- None"]));
  lines.push("", "## Recommendations", "");
  lines.push(...(report.recommendations?.length ? report.recommendations.map((item) => `- ${item}`) : ["- None"]));
  return lines.join("\n");
}

async function buildHistoryFromDirectory(directoryHandle) {
  const resourceMap = new Map();
  const contactMap = new Map();
  const history = {
    loadedAt: new Date().toISOString(),
    folderName: directoryHandle.name || state.outputTargetLabel,
    reportCount: 0,
    scanCount: 0,
    detailCount: 0,
    jsonCount: 0,
    resources: [],
    contacts: [],
    versions: [],
    files: [],
    latestCapturedAt: "",
    warnings: []
  };

  for await (const entry of walkDirectoryFiles(directoryHandle)) {
    const { name, handle } = entry;
    const baseName = name.split("/").pop() || name;
    if (!name.toLowerCase().endsWith(".json")) continue;
    history.jsonCount += 1;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      const fileRecord = summarizeHistoryFile(name, file, data);
      history.files.push(fileRecord);
      if (isExportReport(data, baseName)) history.reportCount += 1;
      if (isScanManifest(data, baseName)) history.scanCount += 1;
      const contact = extractHistoryContact(data, name, file);
      if (contact?.contactId && !contactMap.has(contact.contactId)) {
        contactMap.set(contact.contactId, contact);
        history.contacts.push(contact);
      }
      if (isDetailCapture(data, name)) {
        const resource = extractHistoryResource(data, name, file);
        if (resourceMap.has(resource.historyKey)) {
          resourceMap.get(resource.historyKey).files.push(name);
          continue;
        }
        resourceMap.set(resource.historyKey, resource);
        history.detailCount += 1;
        history.resources.push(resource);
        for (const version of resource.versions) {
          history.versions.push({
            resourceKey: resource.key,
            section: resource.section,
            name: resource.name,
            id: resource.id,
            arn: resource.arn,
            label: version.label,
            default: Boolean(version.default),
            capturedAt: resource.capturedAt,
            fileName: resource.fileName
          });
        }
      }
    } catch (error) {
      history.warnings.push(`Could not read ${name}: ${error?.message || String(error)}`);
    }
  }

  history.resources.sort((a, b) => `${a.section}|${a.name}`.localeCompare(`${b.section}|${b.name}`));
  history.contacts.sort((a, b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")));
  history.latestCapturedAt = latestIso(history.resources.map((resource) => resource.capturedAt));
  history.summary = summarizeHistory(history);
  return history;
}

async function* walkDirectoryFiles(directoryHandle, prefix = "") {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      yield* walkDirectoryFiles(handle, path);
    } else {
      yield { name: path, handle };
    }
  }
}

function summarizeHistoryFile(name, file, data) {
  return {
    name,
    bytes: file.size,
    modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : "",
    capturedAt: data.capturedAt || data.startedAt || data.loadedAt || "",
    kind: data.kind || data.mode || data.source?.mode || ""
  };
}

function extractHistoryContact(data, fileName, file) {
  const contact = data.contactTranscript || (data.contactId && data.references ? data : null);
  const contactId = contact?.contactId || data.transcript?.ContactId || data.ContactId || "";
  if (!contactId) return null;
  const references = contact?.references || {};
  return {
    contactId,
    fileName,
    bytes: file.size,
    capturedAt: data.capturedAt || contact.capturedAt || "",
    sourceMode: data.source?.mode || contact.source?.mode || "",
    hasTranscript: Boolean(data.transcript || contact.messages?.length),
    hasContactDetails: Boolean(data.contactDetails || contact.contactDetails),
    aiAgentIds: references.aiAgentIds || [],
    promptIds: references.promptIds || [],
    flowIds: references.flowIds || [],
    summary: contact.summary || ""
  };
}

function isExportReport(data, baseName) {
  return baseName.startsWith("amazon-connect-export-report-")
    || (data?.reportVersion && data?.kind && Array.isArray(data?.files));
}

function isScanManifest(data, baseName) {
  return /amazon-connect-(?:smoke-scan|scan-first)/.test(baseName)
    || (Array.isArray(data?.sections) && String(data?.mode || "").includes("scan"));
}

function isDetailCapture(data, name) {
  if (name.endsWith("-summary.json")) return false;
  return data?.source?.mode === "detail";
}

function extractHistoryResource(data, fileName, file) {
  const overview = data.overview || {};
  const source = data.source || {};
  const section = source.section || "";
  const name = valueFromFields(overview, ["name"]) || data.title || fileName.replace(/\.json$/i, "");
  const id = valueFromFields(overview, [
    "AI Prompt ID",
    "AI Agent ID",
    "Guardrail ID",
    "Queue ID",
    "Hours ID",
    "ID"
  ]) || idFromUrl(source.url || "");
  const arn = valueFromFields(overview, [
    "AI Prompt ARN",
    "AI Agent ARN",
    "Guardrail ARN",
    "Queue ARN",
    "ARN"
  ]);
  const versions = Array.isArray(data.versions)
    ? data.versions.map((version) => ({
      label: version.label || version.text || String(version),
      default: Boolean(version.default)
    })).filter((version) => version.label)
    : [];

  const key = [section, arn || id || name].filter(Boolean).join("|");
  const versionSlug = versionSlugForResult(data);
  const historyKey = [
    key,
    versionSlug,
    data.capturedAt || "",
    data.prompt?.contentHash || ""
  ].join("|");
  return {
    key,
    historyKey,
    versionSlug,
    fileName,
    files: [fileName],
    bytes: file.size,
    capturedAt: data.capturedAt || "",
    section,
    mode: source.mode || "",
    pageMode: source.pageMode || "",
    url: source.url || "",
    name,
    id,
    arn,
    status: valueFromFields(overview, ["status"]),
    type: valueFromFields(overview, ["type"]),
    lastModified: valueFromFields(overview, ["last modified", "lastModified"]),
    modelId: valueFromFields(overview, ["model id", "modelId"]),
    promptHash: data.prompt?.contentHash || "",
    versionCount: versions.length,
    versions
  };
}

function valueFromFields(object, labels) {
  const entries = Object.entries(object || {});
  for (const label of labels) {
    const normalizedLabel = normalizeFieldName(label);
    const match = entries.find(([key]) => normalizeFieldName(key) === normalizedLabel);
    if (match) {
      const value = flattenFieldValue(match[1]);
      if (!isPlaceholderValue(value)) return value;
    }
  }
  return "";
}

function normalizeFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function flattenFieldValue(value) {
  if (Array.isArray(value)) return value.map(flattenFieldValue).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return value.value || value.text || JSON.stringify(value);
  }
  return String(value ?? "").trim();
}

function isPlaceholderValue(value) {
  return /^[-–—]$/.test(String(value || "").trim());
}

function idFromUrl(url) {
  const matches = String(url || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return matches?.at(-1) || "";
}

function latestIso(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function summarizeHistory(history) {
  const sectionCounts = {};
  for (const resource of history.resources || []) {
    sectionCounts[resource.section || "unknown"] = (sectionCounts[resource.section || "unknown"] || 0) + 1;
  }
  return {
    loadedAt: history.loadedAt,
    folderName: history.folderName,
    reports: history.reportCount || 0,
    scans: history.scanCount || 0,
    jsonFiles: history.jsonCount || 0,
    resources: history.resources?.length || 0,
    contacts: history.contacts?.length || 0,
    versions: history.versions?.length || 0,
    latestCapturedAt: history.latestCapturedAt || "",
    sections: sectionCounts,
    warnings: history.warnings || []
  };
}

function updateHistoryStatus(history) {
  if (!els.historyStatus) return;
  if (!history) {
    els.historyStatus.textContent = "Not loaded";
    return;
  }
  const summary = history.summary || summarizeHistory(history);
  els.historyStatus.textContent = `${summary.resources} resources / ${summary.contacts || 0} contacts`;
}

async function validateLastRunFromFolder() {
  try {
    const handle = await ensureOutputDirectoryHandle({ requestPermission: true });
    if (!handle) throw new Error("Choose or reconnect an output folder before validating the latest run.");
    const report = await readJsonFromDirectory(handle, "_history/latest-report.json");
    const validation = validateReport(report, null, {
      expectedScreenshots: expectedScreenshotsForReport(report, null)
    });
    completeRunTracker({
      status: validation.status,
      message: `Latest ${report.kind} validation: ${validation.status}`,
      ...validation
    });
    printResult({
      status: "Latest run validation",
      report: "_history/latest-report.json",
      kind: report.kind,
      validation
    });
  } catch (error) {
    failRunTracker(error);
    setError(error);
  }
}

async function readJsonFromDirectory(directoryHandle, filePath) {
  const fileHandle = await getFileHandleByPath(directoryHandle, filePath);
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function getFileHandleByPath(directoryHandle, filePath) {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  let current = directoryHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return current.getFileHandle(fileName);
}

async function persistDirectoryHandle(handle) {
  const db = await openDirectoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, "readwrite");
    transaction.objectStore(DIRECTORY_STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readDirectoryHandle() {
  const db = await openDirectoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, "readonly");
    const request = transaction.objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function clearPersistedDirectoryHandle() {
  const db = await openDirectoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, "readwrite");
    transaction.objectStore(DIRECTORY_STORE_NAME).delete(DIRECTORY_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function openDirectoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        db.createObjectStore(DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bindTabRefreshEvents() {
  chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (!state.lockedTabId || tabId !== state.lockedTabId) return;
    if (changeInfo.status === "complete" || changeInfo.url) {
      detectPage().catch(setError);
    }
  });

  chrome.tabs.onRemoved?.addListener((tabId) => {
    if (tabId !== state.lockedTabId) return;
    state.activeTab = null;
    state.lockedTabId = null;
    state.lockedWindowId = null;
    state.detected = { section: "unknown", mode: "unknown" };
    els.currentUrl.textContent = "Locked tab was closed";
    els.detectedSection.textContent = "unknown / unknown";
    els.sectionBadge.textContent = "closed";
    setButtons(state.detected);
    setError(new Error("The Amazon Connect tab attached to this side panel was closed. Reopen the side panel from the desired tab."));
  });

  window.addEventListener("focus", () => {
    detectPage().catch(setError);
  });
}

async function navigateTo(path, options = {}) {
  try {
    const tab = await getLockedTab();
    const destination = new URL(path, "https://invest-america.my.connect.aws").href;
    if (!options.silent) printResult({ status: "Navigating", destination });
    await chrome.tabs.update(tab.id, { url: destination });
    await waitForTabLoad(tab.id);
    await detectPage({ silent: options.silent });
    return true;
  } catch (error) {
    if (options.silent) throw error;
    setError(error);
    return false;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 800);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function detectPage(options = {}) {
  try {
    const { silent = false } = options;
    const tab = await getLockedTab();
    const response = await sendToContent("DETECT_PAGE");
    if (!response?.ok) throw new Error(response?.error || "Could not detect page.");
    state.detected = response.detected;
    els.currentUrl.textContent = `${response.url || tab.url || "-"}${state.lockedTabId ? `\nLocked tab: ${state.lockedTabId}` : ""}`;
    els.detectedSection.textContent = `${response.detected.section} / ${response.detected.mode}`;
    els.sectionBadge.textContent = response.detected.section;
    setButtons(response.detected);
    if (!silent) {
      printResult({ status: "Ready", detected: response.detected, title: response.title });
    }
  } catch (error) {
    setError(error);
  }
}

async function getLockedTab() {
  if (!state.lockedTabId) {
    return lockToInitialTab();
  }
  try {
    const tab = await chrome.tabs.get(state.lockedTabId);
    state.activeTab = tab;
    state.lockedWindowId = tab.windowId;
    return tab;
  } catch (error) {
    state.activeTab = null;
    state.lockedTabId = null;
    state.lockedWindowId = null;
    throw new Error("The tab attached to this side panel is no longer available. Reopen the side panel from the Amazon Connect tab.");
  }
}

function setButtons(detected) {
  const supportsIndex = detected.mode === "index";
  const supportsDetail = ["detail", "edit", "advanced", "configuration", "aliases", "versions", "designer", "settings"].includes(detected.mode);
  const supportsVersions = supportsDetail && ["ai-prompts", "ai-agents", "guardrails"].includes(detected.section);
  const supportsFlowJsonExport = detected.section === "contact-flows" && detected.mode === "detail";
  const supportsContactSearchCsvExport = detected.section === "contact-search" && detected.mode === "index";
  const supportsNetworkTranscript = detected.section === "contact-records";

  els.smokeScan.disabled = state.scanRunning;
  els.scanFive.disabled = state.scanRunning;
  els.scanAll.disabled = state.scanRunning;
  els.validationScan.disabled = state.scanRunning;
  els.validateLastRun.disabled = state.scanRunning;
  els.runDiagnostics.disabled = state.scanRunning;
  els.downloadDiagnostics.disabled = !state.latestDiagnosticsReport;
  els.stopRun.disabled = !state.scanRunning || state.stopRequested;
  els.captureIndex.disabled = !supportsIndex;
  els.captureAllIndex.disabled = !supportsIndex;
  els.captureDetail.disabled = !supportsDetail;
  els.captureNetworkTranscript.disabled = !supportsNetworkTranscript;
  els.identifyVersions.disabled = !supportsVersions;
  els.exportFlowJson.disabled = !supportsFlowJsonExport;
  els.exportContactSearchCsv.disabled = !supportsContactSearchCsvExport;
  els.dryRunCallQueue.disabled = state.scanRunning;
  els.captureNextCall.disabled = state.scanRunning;
  els.captureFiveCalls.disabled = state.scanRunning;
  els.captureTwentyFiveCalls.disabled = state.scanRunning;
  els.captureHundredCalls.disabled = state.scanRunning;
  els.captureCustomCalls.disabled = state.scanRunning;
  els.captureCallLimit.disabled = state.scanRunning;
  els.resumePendingCalls.disabled = state.scanRunning;
  els.recaptureAlreadyCapturedCalls.disabled = state.scanRunning;
  els.retryFailedCalls.disabled = state.scanRunning;
  els.resetFailedCalls.disabled = state.scanRunning;
  els.skipFailedCalls.disabled = state.scanRunning;
  els.validateCallQueue.disabled = state.scanRunning;
  els.buildAnalyticsDashboard.disabled = state.scanRunning;
  els.startWeeklyLongRun.disabled = state.scanRunning;
  els.runImportedCsvAutomation.disabled = state.scanRunning;
}

function readCustomCallLimit() {
  const value = Number.parseInt(els.captureCallLimit?.value || "25", 10);
  if (!Number.isFinite(value) || value < 1) return 25;
  return Math.min(1000, value);
}

function requestStopRun() {
  state.stopRequested = true;
  updateRunTracker({
    status: "running",
    message: "Stop requested. The current item will finish first.",
    summary: { stopRequested: true }
  });
  setButtons(state.detected || { section: "unknown", mode: "unknown" });
}

async function sendToContent(type, payload = {}) {
  const tab = await getLockedTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  } catch (error) {
    if (!String(error?.message || error).includes("Receiving end does not exist")) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(tab.id, { type, ...payload });
  }
}

async function runCapture(type, options = {}) {
  try {
    const report = createExportReport(type);
    const result = await captureFromContent(type);
    state.lastResult = result;
    state.lastBaseName = buildBaseName(result);
    if (options.download !== false) {
      await downloadCapture(result, state.lastBaseName, report);
      await saveExportReport(report);
      els.downloadLast.disabled = false;
    }
    renderVersions(result.versions || []);
    printResult(summarizeResult(result));
  } catch (error) {
    setError(error);
  }
}

async function startWeeklyLongRun() {
  try {
    state.pendingCsvAutomation = {
      type: "weekly-full-run",
      createdAt: new Date().toISOString(),
      includeConfigExport: true,
      captureAllPending: true
    };
    state.archiveRawRuns = false;
    if (els.archiveRawRuns) els.archiveRawRuns.checked = false;
    setActiveView("analytics");
    printResult({
      status: "Starting weekly full run",
      step: "Opening week-to-date Contact search and exporting CSV.",
      nextStep: "When Chrome finishes downloading the CSV, click Import Contact CSV and select that file. The extension will continue automatically.",
      archiveRawRuns: state.archiveRawRuns
    });
    await navigateTo(buildContactSearchPath("WEEK_TO_DATE"), { silent: true });
    await waitForPageReady({ section: "contact-search", mode: "index", timeoutMs: 18000 });
    await runCapture("EXPORT_CONTACT_SEARCH_CSV", { download: true });
    printResult({
      status: "CSV export requested",
      period: "WEEK_TO_DATE",
      nextStep: "Import the downloaded Contact Search CSV to continue the automatic run.",
      pendingAutomation: state.pendingCsvAutomation
    });
  } catch (error) {
    state.pendingCsvAutomation = null;
    setError(error);
  }
}

async function captureFromContent(type, payload = {}) {
  const response = await sendToContent(type, payload);
  if (!response?.ok) throw new Error(response?.error || "Capture failed.");
  return enrichResult(response.result);
}

function getRuntimeSections() {
  return [
    { label: "AI Prompts", section: "ai-prompts", path: "/q-connect/ai-prompts" },
    { label: "AI Agents", section: "ai-agents", path: "/q-connect/ai-agents" },
    { label: "Guardrails", section: "guardrails", path: "/q-connect/guardrails" },
    { label: "Contact flows", section: "contact-flows", path: "/contact-flows#contactFlows" },
    { label: "Flow modules", section: "flow-modules", path: "/contact-flows#modules" },
    { label: "Conversational AI", section: "conversational-ai", path: "/contact-flows#bots" },
    { label: "Phone numbers", section: "phone-numbers", path: "/numbers#/" },
    { label: "Queues", section: "queues", path: "/queues" },
    { label: "Hours", section: "hours-of-operation", path: "/operating-hours" }
  ];
}

function runtimeSectionForPath(path) {
  return getRuntimeSections().find((section) => section.path === path && ["contact-flows", "flow-modules", "conversational-ai"].includes(section.section)) || null;
}

function startRunTracker(kind, totalSections) {
  state.currentRun = {
    status: "running",
    kind,
    startedAt: new Date().toISOString(),
    totalSections,
    sectionIndex: 0,
    sectionLabel: "",
    stage: "starting",
    itemIndex: 0,
    itemTotal: 0,
    message: "Starting"
  };
  renderRunTracker();
}

function updateRunTracker(update = {}) {
  state.currentRun = {
    ...(state.currentRun || {}),
    ...update,
    updatedAt: new Date().toISOString()
  };
  renderRunTracker();
}

function completeRunTracker(summary = {}) {
  state.currentRun = {
    ...(state.currentRun || {}),
    status: summary.status || "success",
    completedAt: new Date().toISOString(),
    stage: "complete",
    message: summary.message || "Completed",
    summary
  };
  renderRunTracker();
}

function failRunTracker(error, summary = {}) {
  state.currentRun = {
    ...(state.currentRun || {}),
    status: "failed",
    completedAt: new Date().toISOString(),
    stage: "failed",
    message: error?.message || String(error),
    summary
  };
  renderRunTracker();
}

function renderRunTracker() {
  const run = state.currentRun;
  if (!run || !els.runTrackerPanel) return;
  els.runTrackerPanel.classList.remove("hidden", "trackerSuccess", "trackerWarning", "trackerError");
  if (run.status === "success") els.runTrackerPanel.classList.add("trackerSuccess");
  if (run.status === "warning") els.runTrackerPanel.classList.add("trackerWarning");
  if (run.status === "failed") els.runTrackerPanel.classList.add("trackerError");

  const sectionText = run.totalSections
    ? `Section ${Math.min(run.sectionIndex || 0, run.totalSections)} of ${run.totalSections}${run.sectionLabel ? `: ${run.sectionLabel}` : ""}`
    : "";
  const itemText = run.itemTotal
    ? `Detail ${run.itemIndex || 0} of ${run.itemTotal}`
    : "";
  els.runTrackerStatus.textContent = run.message
    ? `${run.message} - ${run.kind || "run"}`
    : `${run.status || "running"} - ${run.kind || "run"}`;
  els.runTrackerProgress.value = calculateRunProgress(run);
  els.runTrackerDetails.textContent = JSON.stringify({
    message: run.message,
    stage: run.stage,
    section: sectionText,
    item: itemText,
    completed: run.completed ?? null,
    total: run.total ?? null,
    throughput: run.throughput || null,
    elapsedSeconds: elapsedSeconds(run.startedAt, run.completedAt),
    summary: run.summary || null
  }, null, 2);
}

function calculateRunProgress(run) {
  if (["success", "warning", "failed"].includes(run.status)) return 100;
  const totalSections = Math.max(1, run.totalSections || 1);
  const sectionIndex = Math.max(0, (run.sectionIndex || 1) - 1);
  const stageWeight = {
    navigating: 0.05,
    waiting: 0.15,
    "capturing-index": 0.25,
    "saving-index": 0.35,
    "opening-detail": 0.45,
    "capturing-detail": 0.65,
    "saving-detail": 0.8,
    "capturing-call": 0.65,
    screenshot: 0.88,
    report: 0.95,
    "returning-home": 0.98
  }[run.stage] || 0.1;
  const itemBonus = run.itemTotal ? Math.min(0.3, ((run.itemIndex || 0) / run.itemTotal) * 0.3) : 0;
  return Math.min(99, Math.round(((sectionIndex + Math.min(0.98, stageWeight + itemBonus)) / totalSections) * 100));
}

function elapsedSeconds(startedAt, completedAt = null) {
  if (!startedAt) return 0;
  const end = completedAt ? new Date(completedAt) : new Date();
  return Math.max(0, Math.round((end - new Date(startedAt)) / 1000));
}

function validateReport(report, primaryResult = null, options = {}) {
  const warnings = uniqueStrings([
    ...(report?.warnings || []),
    ...(report?.summary?.warnings || []),
    ...(primaryResult?.warnings || [])
  ].filter(Boolean));
  const sections = Array.isArray(primaryResult?.sections)
    ? primaryResult.sections
    : (Array.isArray(report?.summary?.sections) ? report.summary.sections : []);
  const screenshotErrors = sections.flatMap((section) => [
    section.index?.screenshotError,
    section.detail?.screenshotError,
    ...(section.details || []).map((detail) => detail.screenshotError)
  ].filter(Boolean));
  const detailCount = sections.reduce((sum, section) => {
    if (Array.isArray(section.details)) return sum + section.details.filter((detail) => !detail.skipped).length;
    return sum + (section.detail && !section.detail.skipped ? 1 : 0);
  }, 0);
  const expectedScreenshots = options.expectedScreenshots || 0;
  const screenshotCount = (report?.files || []).filter((file) => file.mimeType === "image/png").length;
  const missingExpectedFiles = [];
  if ((report?.generatedFileCount || 0) <= 0) missingExpectedFiles.push("No files generated.");
  if (expectedScreenshots && screenshotCount < expectedScreenshots) {
    missingExpectedFiles.push(`Expected ${expectedScreenshots} screenshots, found ${screenshotCount}.`);
  }
  const status = warnings.length || screenshotErrors.length || missingExpectedFiles.length
    ? "warning"
    : "success";
  return {
    status,
    warningCount: warnings.length,
    warnings,
    warningContacts: primaryResult?.validation?.warningContacts || primaryResult?.warningContacts || [],
    missingExpectedFiles,
    screenshotCount,
    expectedScreenshots,
    screenshotErrors,
    sectionCount: sections.length,
    detailCount,
    generatedFileCount: report?.generatedFileCount || 0,
    totalBytes: report?.totalBytes || 0,
    runFolder: report?.runFolder || ""
  };
}

async function returnHomeAfterRun() {
  const shouldShowReturning = state.currentRun?.status === "running";
  if (shouldShowReturning) {
    updateRunTracker({ stage: "returning-home", message: "Returning to Amazon Connect home" });
  }
  await navigateTo("/home", { silent: true });
  await detectPage({ silent: true });
}

async function scanSections({ detailLimit, kind }) {
  const sections = getRuntimeSections();
  const scanAllDetails = detailLimit === null || detailLimit === undefined;
  const detailLimitLabel = scanAllDetails ? "all" : String(detailLimit);
  const runMode = kind === "FULL_CONFIG_EXPORT"
    ? "full-config-export"
    : (detailLimit === 1
      ? "smoke-scan-first-detail"
      : (scanAllDetails ? "scan-all-details-per-section" : `scan-first-${detailLimit}-details-per-section`));
  const run = {
    capturedAt: new Date().toISOString(),
    mode: runMode,
    detailLimit: scanAllDetails ? "all" : detailLimit,
    fullConfigExport: kind === "FULL_CONFIG_EXPORT",
    sections: [],
    accessDeniedUrls: [],
    warnings: []
  };
  const report = createExportReport(kind);

  state.scanRunning = true;
  state.stopRequested = false;
  startRunTracker(kind, sections.length);
  setButtons(state.detected || { section: "unknown", mode: "unknown" });

  try {
    for (const [sectionIndex, section] of sections.entries()) {
      if (state.stopRequested) {
        run.warnings.push("Run stopped by user.");
        break;
      }
      updateRunTracker({
        sectionIndex: sectionIndex + 1,
        sectionLabel: section.label,
        stage: "navigating",
        itemIndex: 0,
        itemTotal: 0,
        message: `Opening ${section.label} index`
      });
      printResult({
        status: "Scanning section",
        section: section.label,
        detailLimit: detailLimitLabel,
        completed: run.sections.length,
        total: sections.length
      });

      await navigateTo(section.path, { silent: true });
      await ensureRuntimeSectionActive(section);
      updateRunTracker({ stage: "waiting", message: `Waiting for ${section.label} index` });
      const indexReady = await waitForPageReady({ section: section.section, mode: "index", timeoutMs: 18000 });
      updateRunTracker({ stage: "capturing-index", message: `Capturing ${section.label} index` });
      const indexResult = await captureFromContent("CAPTURE_ALL_INDEX");
      assertExpectedSection(indexResult, section);
      appendReadinessWarning(indexResult, indexReady, section.label, "index");
      const indexBaseName = buildBaseName(indexResult);
      updateRunTracker({ stage: "saving-index", message: `Saving ${section.label} index` });
      await downloadCapture(indexResult, indexBaseName, report);

      const indexItems = indexResult.items || [];
      const indexItemsWithUrls = indexItems.filter((item) => item.url);
      const selectedIndexItems = scanAllDetails ? indexItemsWithUrls : indexItemsWithUrls.slice(0, detailLimit);
      const detailTargets = selectedIndexItems.flatMap((item) => detailTargetsForItem(item, section));
      const nonNavigableItems = indexItems.filter((item) => !item.url);
      const sectionSummary = {
        label: section.label,
        index: {
          title: indexResult.title,
          url: indexResult.source?.url,
          itemCount: indexResult.items?.length || 0,
          fileBaseName: indexBaseName,
          readiness: indexReady,
          detailLimit: detailLimitLabel,
          selectedItems: selectedIndexItems.map((item) => ({
            name: item.name,
            id: item.id,
            arn: item.arn,
            url: item.url
          })),
          selectedTargetCount: detailTargets.length,
          nonNavigableItemCount: nonNavigableItems.length,
          nonNavigableItems: nonNavigableItems.slice(0, 25).map((item) => ({
            name: item.name,
            status: item.status,
            type: item.type,
            description: item.description,
            id: item.id,
            arn: item.arn
          })),
          warnings: indexResult.warnings || []
        },
        details: []
      };

      for (const [detailIndex, target] of detailTargets.entries()) {
        if (state.stopRequested) {
          run.warnings.push("Run stopped by user before finishing all detail targets.");
          break;
        }
        const item = target.item;
        updateRunTracker({
          stage: "opening-detail",
          itemIndex: detailIndex + 1,
          itemTotal: detailTargets.length,
          message: `Opening ${section.label} ${target.label} ${detailIndex + 1} of ${detailTargets.length}`
        });
        printResult({
          status: "Scanning detail",
          section: section.label,
          target: target.label,
          item: item.name || item.id || item.url,
          detailNumber: sectionSummary.details.length + 1,
          detailLimit: detailLimitLabel
        });
        await navigateTo(target.url, { silent: true });
        updateRunTracker({ stage: "waiting", message: `Waiting for ${section.label} ${target.label} ${detailIndex + 1}` });
        const detailReady = await waitForPageReady({ section: section.section, mode: "detail", timeoutMs: 18000 });
        updateRunTracker({ stage: "capturing-detail", message: `Capturing ${section.label} ${target.label} ${detailIndex + 1}` });
        const detailResult = await captureFromContent("CAPTURE_DETAIL");
        appendReadinessWarning(detailResult, detailReady, section.label, "detail");
        const detailBaseName = buildBaseName(detailResult);
        updateRunTracker({ stage: "saving-detail", message: `Saving ${section.label} ${target.label} ${detailIndex + 1}` });
        await downloadCapture(detailResult, detailBaseName, report);
        sectionSummary.details.push({
          target: target.label,
          sourceItem: {
            name: item.name,
            id: item.id,
            arn: item.arn,
            url: item.url
          },
          title: detailResult.title,
          url: detailResult.source?.url,
          fileBaseName: detailBaseName,
          readiness: detailReady,
          versionCount: detailResult.versions?.length || 0,
          promptHash: detailResult.prompt?.contentHash || "",
          accessDenied: detailResult.accessDenied || null,
          warnings: detailResult.warnings || []
        });
        if (detailResult.accessDenied?.denied) {
          const record = buildAccessDeniedRecord(section, target, item, detailResult);
          sectionSummary.accessDeniedUrls ||= [];
          sectionSummary.accessDeniedUrls.push(record);
          run.accessDeniedUrls.push(record);
        }
      }

      if (!detailTargets.length) {
        sectionSummary.details.push({
          skipped: true,
          reason: indexResult.emptyState?.empty
            ? "Index is empty."
            : nonNavigableItems.length
            ? "Index items were captured, but no navigable detail URLs were exposed by the page."
            : "No first item URL found."
        });
      }

      run.sections.push(sectionSummary);
    }

    state.lastResult = run;
    state.lastBaseName = kind === "FULL_CONFIG_EXPORT"
      ? `amazon-connect-full-config-export-${timestampSlug()}`
      : (detailLimit === 1
      ? `amazon-connect-smoke-scan-${timestampSlug()}`
      : (scanAllDetails
        ? `amazon-connect-scan-all-details-${timestampSlug()}`
        : `amazon-connect-scan-first-${detailLimit}-details-${timestampSlug()}`));
    updateRunTracker({ stage: "report", message: "Writing scan report" });
    await saveTextFile(`${report.runFolder}/scan.json`, jsonText(run), "application/json", report);
    await saveExportReport(report, run);
    const validation = report.validation || validateReport(report, run);
    els.downloadLast.disabled = false;
    completeRunTracker({
      status: validation.status,
      message: `${kind} completed`,
      ...validation
    });
    printResult({
      status: `${kind} complete`,
      validation,
      accessDeniedUrls: run.accessDeniedUrls || [],
      sections: run.sections.map((section) => ({
        label: section.label,
        itemCount: section.index.itemCount,
        detailCount: section.details?.filter((detail) => !detail.skipped).length || 0,
        accessDeniedCount: section.accessDeniedUrls?.length || 0,
        details: (section.details || []).map((detail) => detail.title || detail.reason || "")
      }))
    });
  } catch (error) {
    run.warnings.push(error?.message || String(error));
    state.lastResult = run;
    state.lastBaseName = `amazon-connect-${run.mode}-failed-${timestampSlug()}`;
    await saveTextFile(`${report.runFolder}/scan-failed.json`, jsonText(run), "application/json", report).catch(() => {});
    await saveExportReport(report, run).catch(() => {});
    failRunTracker(error, report.validation || validateReport(report, run));
    setError(error);
  } finally {
    state.scanRunning = false;
    state.stopRequested = false;
    await returnHomeAfterRun().catch(() => {});
    setButtons(state.detected || { section: "unknown", mode: "unknown" });
  }
}

async function validationScreenshotScan() {
  const sections = getRuntimeSections();
  const run = {
    capturedAt: new Date().toISOString(),
    mode: "validation-screenshots",
    sections: [],
    expectedScreenshots: 0,
    accessDeniedUrls: [],
    warnings: []
  };
  const report = createExportReport("VALIDATION_SCREENSHOTS");

  state.scanRunning = true;
  state.stopRequested = false;
  startRunTracker("VALIDATION_SCREENSHOTS", sections.length);
  setButtons(state.detected || { section: "unknown", mode: "unknown" });

  try {
    for (const [sectionIndex, section] of sections.entries()) {
      if (state.stopRequested) {
        run.warnings.push("Run stopped by user.");
        break;
      }
      updateRunTracker({
        sectionIndex: sectionIndex + 1,
        sectionLabel: section.label,
        stage: "navigating",
        itemIndex: 0,
        itemTotal: 1,
        message: `Opening ${section.label} index`
      });
      printResult({
        status: "Capturing validation index",
        section: section.label,
        completed: run.sections.length,
        total: sections.length
      });

      await navigateTo(section.path, { silent: true });
      await ensureRuntimeSectionActive(section);
      updateRunTracker({ stage: "waiting", message: `Waiting for ${section.label} index` });
      const indexReady = await waitForPageReady({ section: section.section, mode: "index", timeoutMs: 18000 });
      updateRunTracker({ stage: "capturing-index", message: `Capturing ${section.label} index JSON` });
      const indexResult = await captureFromContent("CAPTURE_ALL_INDEX");
      assertExpectedSection(indexResult, section);
      appendReadinessWarning(indexResult, indexReady, section.label, "validation-index");
      const indexBaseName = buildBaseName(indexResult);
      updateRunTracker({ stage: "saving-index", message: `Saving ${section.label} index JSON` });
      await downloadCapture(indexResult, indexBaseName, report);
      updateRunTracker({ stage: "screenshot", message: `Taking ${section.label} index screenshot` });
      const indexScreenshot = await trySaveVisibleScreenshot(
        `${report.runFolder}/screenshots/index/${section.section}.png`,
        report,
        `${section.label} index`
      );
      const indexTextSnapshot = await trySaveVisibleTextSnapshot(
        `${report.runFolder}/screen-text/index/${section.section}.txt`,
        report,
        `${section.label} index`
      );

      run.expectedScreenshots += 1;
      const firstItem = (indexResult.items || []).find((item) => item.url);
      const detailTargets = firstItem ? detailTargetsForItem(firstItem, section) : [];
      const sectionSummary = {
        label: section.label,
        index: {
          title: indexResult.title,
          url: indexResult.source?.url,
          itemCount: indexResult.items?.length || 0,
          fileBaseName: indexBaseName,
          screenshot: indexScreenshot.savedFilename || "",
          screenshotError: indexScreenshot.error || "",
          textSnapshot: indexTextSnapshot.savedFilename || "",
          textSnapshotError: indexTextSnapshot.error || "",
          readiness: indexReady,
          warnings: indexResult.warnings || []
        },
        details: []
      };

      if (detailTargets.length) {
        run.expectedScreenshots += detailTargets.length;
        for (const [detailIndex, target] of detailTargets.entries()) {
          if (state.stopRequested) {
            run.warnings.push("Run stopped by user before finishing all validation detail targets.");
            break;
          }
          const item = target.item;
          updateRunTracker({
            stage: "opening-detail",
            itemIndex: detailIndex + 1,
            itemTotal: detailTargets.length,
            message: `Opening ${section.label} ${target.label} validation detail`
          });
          printResult({
            status: "Capturing validation detail",
            section: section.label,
            target: target.label,
            item: item.name || item.id || item.url
          });
          await navigateTo(target.url, { silent: true });
          updateRunTracker({ stage: "waiting", message: `Waiting for ${section.label} ${target.label}` });
          const detailReady = await waitForPageReady({ section: section.section, mode: "detail", timeoutMs: 18000 });
          updateRunTracker({ stage: "capturing-detail", message: `Capturing ${section.label} ${target.label} JSON` });
          const detailResult = await captureFromContent("CAPTURE_DETAIL");
          appendReadinessWarning(detailResult, detailReady, section.label, "validation-detail");
          const detailBaseName = buildBaseName(detailResult);
          updateRunTracker({ stage: "saving-detail", message: `Saving ${section.label} ${target.label} JSON` });
          await downloadCapture(detailResult, detailBaseName, report);
          updateRunTracker({ stage: "screenshot", message: `Taking ${section.label} ${target.label} screenshot` });
          const detailScreenshot = await trySaveVisibleScreenshot(
            `${report.runFolder}/screenshots/details/${section.section}-${target.label}-${resourceSlugForResult(detailResult)}.png`,
            report,
            `${section.label} ${target.label}`
          );
          const detailTextSnapshot = await trySaveVisibleTextSnapshot(
            `${report.runFolder}/screen-text/details/${section.section}-${target.label}-${resourceSlugForResult(detailResult)}.txt`,
            report,
            `${section.label} ${target.label}`
          );
          sectionSummary.details.push({
            target: target.label,
            sourceItem: {
              name: item.name,
              id: item.id,
              arn: item.arn,
              url: item.url
            },
            title: detailResult.title,
            url: detailResult.source?.url,
            fileBaseName: detailBaseName,
            screenshot: detailScreenshot.savedFilename || "",
            screenshotError: detailScreenshot.error || "",
            textSnapshot: detailTextSnapshot.savedFilename || "",
            textSnapshotError: detailTextSnapshot.error || "",
            readiness: detailReady,
            versionCount: detailResult.versions?.length || 0,
            promptHash: detailResult.prompt?.contentHash || "",
            accessDenied: detailResult.accessDenied || null,
            warnings: detailResult.warnings || []
          });
          if (detailResult.accessDenied?.denied) {
            const record = buildAccessDeniedRecord(section, target, item, detailResult);
            sectionSummary.accessDeniedUrls ||= [];
            sectionSummary.accessDeniedUrls.push(record);
            run.accessDeniedUrls.push(record);
          }
        }
      } else {
        sectionSummary.details.push({
          skipped: true,
          reason: indexResult.emptyState?.empty ? "Index is empty." : "No first item URL found."
        });
      }

      run.sections.push(sectionSummary);
    }

    state.lastResult = run;
    state.lastBaseName = `amazon-connect-validation-screenshots-${timestampSlug()}`;
    updateRunTracker({ stage: "report", message: "Writing validation report" });
    await saveTextFile(`${report.runFolder}/validation.json`, jsonText(run), "application/json", report);
    await saveExportReport(report, run);
    const validation = report.validation || validateReport(report, run, { expectedScreenshots: run.expectedScreenshots });
    els.downloadLast.disabled = false;
    completeRunTracker({
      status: validation.status,
      message: "Validation screenshots completed",
      ...validation
    });
    printResult({
      status: "Validation screenshots complete",
      runFolder: report.runFolder,
      validation,
      accessDeniedUrls: run.accessDeniedUrls || [],
      sections: run.sections.map((section) => ({
        label: section.label,
        accessDeniedCount: section.accessDeniedUrls?.length || 0,
        indexScreenshot: section.index.screenshot,
        detailScreenshots: (section.details || []).map((detail) => ({
          target: detail.target || "",
          screenshot: detail.screenshot || "",
          textSnapshot: detail.textSnapshot || "",
          detail: detail.title || detail.reason || ""
        }))
      }))
    });
  } catch (error) {
    run.warnings.push(error?.message || String(error));
    state.lastResult = run;
    state.lastBaseName = `amazon-connect-validation-screenshots-failed-${timestampSlug()}`;
    await saveTextFile(`${report.runFolder}/validation-failed.json`, jsonText(run), "application/json", report).catch(() => {});
    await saveExportReport(report, run).catch(() => {});
    failRunTracker(error, report.validation || validateReport(report, run, { expectedScreenshots: run.expectedScreenshots || sections.length * 2 }));
    setError(error);
  } finally {
    state.scanRunning = false;
    state.stopRequested = false;
    await returnHomeAfterRun().catch(() => {});
    setButtons(state.detected || { section: "unknown", mode: "unknown" });
  }
}

function buildAccessDeniedRecord(section, target, item, detailResult) {
  return {
    capturedAt: detailResult.accessDenied?.capturedAt || detailResult.capturedAt || new Date().toISOString(),
    section: section.label,
    sectionKey: section.section,
    target: target.label || "",
    itemName: item.name || "",
    itemId: item.id || "",
    itemArn: item.arn || "",
    attemptedUrl: target.url || item.url || "",
    capturedUrl: detailResult.accessDenied?.url || detailResult.source?.url || "",
    title: detailResult.accessDenied?.title || detailResult.title || "",
    message: detailResult.accessDenied?.message || "Access denied page detected."
  };
}

async function saveVisibleScreenshot(filename, report = null) {
  const tab = await getLockedTab();
  if (!tab?.windowId) throw new Error("No locked tab window available for screenshot.");
  await chrome.tabs.update(tab.id, { active: true });
  await pause(350);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return saveDataUrlFile(filename, dataUrl, "image/png", report);
}

async function trySaveVisibleScreenshot(filename, report = null, label = "screen") {
  try {
    return await saveVisibleScreenshot(filename, report);
  } catch (error) {
    const message = `Screenshot failed for ${label}: ${error?.message || String(error)}`;
    if (report) report.warnings.push(message);
    return {
      filename,
      savedFilename: "",
      error: message
    };
  }
}

async function saveVisibleTextSnapshot(filename, report = null) {
  const response = await sendToContent("GET_VISIBLE_TEXT");
  if (!response?.ok) throw new Error(response?.error || "Visible text capture failed.");
  const snapshot = response.result || {};
  const text = [
    `# ${snapshot.title || "Amazon Connect screen"}`,
    "",
    `Captured at: ${snapshot.capturedAt || ""}`,
    `URL: ${snapshot.url || ""}`,
    `Detected: ${snapshot.detected?.section || "unknown"} / ${snapshot.detected?.mode || "unknown"}`,
    "",
    snapshot.text || ""
  ].join("\n");
  return saveTextFile(filename, text, "text/plain", report);
}

async function trySaveVisibleTextSnapshot(filename, report = null, label = "screen") {
  try {
    return await saveVisibleTextSnapshot(filename, report);
  } catch (error) {
    const message = `Visible text snapshot failed for ${label}: ${error?.message || String(error)}`;
    if (report) report.warnings.push(message);
    return {
      filename,
      savedFilename: "",
      error: message
    };
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detailTargetsForItem(item, section) {
  if (!item?.url) return [];

  if (section.section === "conversational-ai") {
    const botId = botIdFromItem(item);
    if (!botId) return [{ label: "details", url: item.url, item }];
    return [
      { label: "details", url: absolutePath(`/bots/details/${encodeURIComponent(botId)}`), item },
      { label: "configuration", url: absolutePath(`/bots/configuration/${encodeURIComponent(botId)}`), item },
      { label: "aliases", url: absolutePath(`/bots/aliases/${encodeURIComponent(botId)}`), item },
      { label: "versions", url: absolutePath(`/bots/versions/${encodeURIComponent(botId)}`), item }
    ];
  }

  if (section.section === "flow-modules") {
    return ["designer", "details", "versions", "aliases"].map((tab) => ({
      label: tab,
      url: flowEditorTabUrl(item.url, tab),
      item
    }));
  }

  return [{ label: "detail", url: legacyDetailUrlForItem(item, section), item }];
}

function detailUrlForItem(item, section) {
  return detailTargetsForItem(item, section)[0]?.url || item.url;
}

function flowEditorTabUrl(href, tab) {
  const url = new URL(href);
  url.searchParams.set("tab", tab);
  return url.href;
}

function botIdFromItem(item) {
  if (item.id && !String(item.id).includes("/")) return String(item.id);
  try {
    const url = new URL(item.url);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function absolutePath(path) {
  return new URL(path, APP_ORIGIN).href;
}

function legacyDetailUrlForItem(item, section) {
  if (section.section === "contact-flows") {
    const url = new URL(item.url);
    url.searchParams.set("tab", "details");
    return url.href;
  }
  return item.url;
}

async function waitForPageReady(expected) {
  const response = await sendToContent("WAIT_FOR_PAGE_READY", { expected });
  if (!response?.ok) {
    return {
      ready: false,
      timedOut: true,
      reason: response?.error || "readiness-message-failed"
    };
  }
  return response.result;
}

async function ensureRuntimeSectionActive(section) {
  if (!["contact-flows", "flow-modules", "conversational-ai"].includes(section.section)) return null;
  if (state.currentRun?.status === "running") {
    updateRunTracker({ stage: "activating-tab", message: `Activating ${section.label} tab` });
  }
  const response = await sendToContent("ACTIVATE_FLOWS_TAB", { section: section.section });
  if (!response?.ok) {
    return {
      activated: false,
      reason: response?.error || "activate-tab-message-failed"
    };
  }
  return response.result;
}

function appendReadinessWarning(result, readiness, label, stage) {
  result.readiness = readiness;
  if ((readiness?.timedOut || readiness?.ready === false) && !hasUsefulCaptureDespiteReadiness(result)) {
    result.warnings = result.warnings || [];
    result.warnings.push(`Readiness timeout for ${label} ${stage}: ${readiness?.reason || "unknown"}`);
  }
}

function assertExpectedSection(result, section) {
  const actual = result?.source?.section;
  if (actual && actual !== section.section) {
    throw new Error(`Expected ${section.label} (${section.section}) but captured ${actual}. The Amazon Connect tab did not activate correctly.`);
  }
}

function hasUsefulCaptureDespiteReadiness(result) {
  const overview = result?.overview || {};
  if (result?.source?.mode === "index-all" && Array.isArray(result.items) && result.items.length) return true;
  if (result?.source?.mode === "index-all" && result.emptyState?.empty) return true;
  if (result?.source?.mode === "detail") {
    if (result.source?.section === "ai-prompts") {
      return Boolean(overview.name && overview.status && overview.type && result.prompt?.text);
    }
    if (result.source?.section === "guardrails") {
      return Boolean(overview.name && overview.status && result.guardrail);
    }
    if (["contact-flows", "flow-modules"].includes(result.source?.section)) {
      return Boolean(overview.name && overview.type && overview.arn);
    }
    if (result.source?.section === "conversational-ai" || result.source?.section === "lex-bots") {
      return Boolean(overview.name || result.title);
    }
    return Boolean(overview.name || result.title);
  }
  return false;
}

async function enrichResult(result) {
  const cloned = structuredClone(result);
  if (cloned.prompt?.text) {
    cloned.prompt.contentHash = await sha256Hex(cloned.prompt.text);
  }
  if (cloned.transcript && cloned.source?.section === "contact-records") {
    const contactTranscript = parseContactTranscriptJson(cloned.transcript, "network-capture");
    contactTranscript.capturedAt = cloned.capturedAt || new Date().toISOString();
    contactTranscript.contentHash = await sha256Hex(JSON.stringify(cloned.transcript));
    contactTranscript.source = {
      section: "contact-records",
      mode: "network-transcript-parsed",
      url: cloned.source?.url || "",
      networkUrl: cloned.networkCaptures?.[0]?.url || ""
    };
    if (cloned.contactDetails) {
      contactTranscript.contactDetails = cloned.contactDetails;
    }
    cloned.contactTranscript = contactTranscript;
  }
  if (cloned.items?.length) {
    for (const item of cloned.items) {
      if (item.name || item.id || item.arn || item.url) {
        item.identityHash = await sha256Hex(`${item.section || ""}|${item.id || ""}|${item.arn || ""}|${item.name || ""}|${item.url || ""}`);
      }
    }
  }
  cloned.scanSummary = buildScanSummary(cloned);
  return cloned;
}

function buildScanSummary(result) {
  return {
    capturedAt: result.capturedAt,
    title: result.title || "",
    section: result.source?.section || "",
    mode: result.source?.mode || "",
    pageMode: result.source?.pageMode || "",
    captureScope: result.captureScope || "",
    url: result.source?.url || "",
    itemCount: result.items?.length || 0,
    versionCount: result.versions?.length || 0,
    contactId: result.contactTranscript?.contactId || result.transcript?.ContactId || "",
    aiAgentIds: result.contactTranscript?.references?.aiAgentIds || [],
    promptIds: result.contactTranscript?.references?.promptIds || [],
    promptHash: result.prompt?.contentHash || "",
    warnings: result.warnings || []
  };
}

async function downloadCapture(result, baseName, report = null) {
  const runBasePath = captureRunBasePath(result, baseName, report);
  const shouldArchiveRawRun = state.archiveRawRuns || result.source?.section !== "contact-records";
  if (shouldArchiveRawRun) {
    await saveTextFile(`${runBasePath}.json`, jsonText(result), "application/json", report);
  }

  if (Array.isArray(result.items)) {
    await saveTextFile(`${runBasePath}.csv`, toCsv(metadataRows(result.items)), "text/csv", report);
  }

  if (result.scanSummary) {
    await saveTextFile(`${runBasePath}-summary.json`, jsonText(result.scanSummary), "application/json", report);
  }

  if (result.prompt?.yaml) {
    const promptName = sanitizeFilenamePart(result.overview?.name || result.title || "prompt");
    await saveTextFile(`${runBasePath}-${promptName}.yaml`, result.prompt.yaml, "text/yaml", report);
  }

  if (result.contactTranscript?.contactId) {
    await saveNormalizedContactTranscript(result, report);
  }

  await saveNormalizedCapture(result, report);
}

async function saveNormalizedContactTranscript(result, report) {
  if (!report?.runFolder) return;
  const contactId = sanitizePathSegment(result.contactTranscript.contactId);
  const basePath = `contact-records/${contactId}`;
  await saveTextFile(`${basePath}/transcript.json`, jsonText(result), "application/json", report);
  await saveTextFile(`${basePath}/summary.json`, jsonText(summarizeContactTranscript(result.contactTranscript)), "application/json", report);
  await saveTextFile(`${basePath}/conversation-turns.json`, jsonText(result.contactTranscript.conversationTurns || []), "application/json", report);
}

function captureRunBasePath(result, baseName, report) {
  if (!report?.runFolder) return baseName;
  if (isIndexResult(result)) return `${report.runFolder}/index/${baseName}`;
  if (isDetailResult(result)) return `${report.runFolder}/details/${baseName}`;
  return `${report.runFolder}/${baseName}`;
}

async function saveNormalizedCapture(result, report) {
  if (!report?.runFolder) return;
  const section = sanitizePathSegment(result.source?.section || "amazon-connect");
  const capturedAtSlug = timestampSlug(new Date(result.capturedAt || Date.now()));

  if (isIndexResult(result)) {
    const indexBasePath = `${section}/_index/${capturedAtSlug}`;
    await saveTextFile(`${indexBasePath}.json`, jsonText(result), "application/json", report);
    if (Array.isArray(result.items)) {
      await saveTextFile(`${indexBasePath}.csv`, toCsv(metadataRows(result.items)), "text/csv", report);
    }
    if (result.scanSummary) {
      await saveTextFile(`${indexBasePath}-summary.json`, jsonText(result.scanSummary), "application/json", report);
    }
    return;
  }

  if (!isDetailResult(result)) return;
  const resourceSlug = resourceSlugForResult(result);
  const versionSlug = versionSlugForResult(result);
  const detailBasePath = `${section}/${resourceSlug}/${versionSlug}`;
  await saveTextFile(`${detailBasePath}.json`, jsonText(result), "application/json", report);
  if (result.scanSummary) {
    await saveTextFile(`${detailBasePath}-summary.json`, jsonText(result.scanSummary), "application/json", report);
  }
  if (result.prompt?.yaml) {
    await saveTextFile(`${detailBasePath}-prompt.yaml`, result.prompt.yaml, "text/yaml", report);
  }
}

function resourceSlugForResult(result) {
  const overview = result.overview || {};
  const name = result.title || valueFromFields(overview, ["name"]) || "resource";
  const id = valueFromFields(overview, [
    "AI Prompt ID",
    "AI Agent ID",
    "Guardrail ID",
    "Queue ID",
    "Hours ID",
    "ID"
  ]) || idFromUrl(result.source?.url || "");
  const nameSlug = sanitizePathSegment(name).slice(0, 80);
  const idSlug = sanitizePathSegment(id).slice(0, 36);
  return idSlug ? `${nameSlug}--${idSlug}` : nameSlug;
}

function versionSlugForResult(result) {
  const overview = result.overview || {};
  const arn = valueFromFields(overview, [
    "AI Prompt ARN",
    "AI Agent ARN",
    "Guardrail ARN",
    "Queue ARN",
    "ARN"
  ]);
  const pageSlug = detailPageSlug(result);
  if (/:\$SAVED$/i.test(arn)) return "latest-draft";
  if (/:\$LATEST$/i.test(arn)) return "latest-published";
  const selectedVersion = (result.versions || []).find((version) => version.selected);
  if (selectedVersion?.label) return sanitizePathSegment(selectedVersion.label).slice(0, 80);
  const base = ["contact-flows", "phone-numbers", "queues", "hours-of-operation"].includes(result.source?.section) ? "current" : "captured-current";
  return pageSlug ? `${base}-${pageSlug}` : base;
}

function detailPageSlug(result) {
  const section = result.source?.section;
  const pageMode = result.source?.pageMode;
  if (!["flow-modules", "conversational-ai"].includes(section)) return "";
  if (!pageMode || pageMode === "unknown") return "";
  return sanitizePathSegment(pageMode).slice(0, 40);
}

function isIndexResult(result) {
  return /^index/.test(String(result.source?.mode || ""));
}

function isDetailResult(result) {
  return result.source?.mode === "detail";
}

async function identifyVersions() {
  try {
    const response = await sendToContent("IDENTIFY_VERSIONS");
    if (!response?.ok) throw new Error(response?.error || "Could not identify versions.");
    const result = response.result;
    const report = createExportReport("IDENTIFY_VERSIONS");
    state.lastResult = result;
    state.lastBaseName = buildBaseName(result);
    renderVersions(result.versions || []);
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}-versions.json`, jsonText(result), "application/json", report);
    await saveExportReport(report);
    els.downloadLast.disabled = false;
    printResult(summarizeResult(result));
  } catch (error) {
    setError(error);
  }
}

function renderVersions(versions) {
  els.versionsList.innerHTML = "";
  if (!versions.length) {
    els.versionsPanel.classList.add("hidden");
    return;
  }

  els.versionsPanel.classList.remove("hidden");
  for (const version of versions) {
    const id = `version-${crypto.randomUUID()}`;
    const label = document.createElement("label");
    label.className = "checkItem";
    label.htmlFor = id;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.value = version.label;
    input.checked = version.default || /Latest:\s*Published/i.test(version.label);

    const span = document.createElement("span");
    span.textContent = version.label;

    label.append(input, span);
    els.versionsList.append(label);
  }
}

async function exportSelectedVersions() {
  try {
    const selected = [...els.versionsList.querySelectorAll("input:checked")].map((input) => input.value);
    if (!selected.length) throw new Error("Select at least one version.");
    const payload = {
      capturedAt: new Date().toISOString(),
      source: state.lastResult?.source || {},
      selectedVersions: selected,
      note: "This MVP records selected version labels. Version-by-version navigation/export is the next implementation step."
    };
    const report = createExportReport("EXPORT_SELECTED_VERSIONS");
    await saveTextFile(`${report.runFolder}/${state.lastBaseName || "amazon-connect"}-selected-versions.json`, jsonText(payload), "application/json", report);
    await saveExportReport(report, payload);
    printResult(payload);
  } catch (error) {
    setError(error);
  }
}

async function importFlowJson(event) {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const json = JSON.parse(text);
    const runtimeMap = parseFlowJson(json, file.name);
    runtimeMap.capturedAt = new Date().toISOString();
    runtimeMap.source = {
      section: "contact-flows",
      mode: "flow-json-import",
      fileName: file.name
    };
    runtimeMap.contentHash = await sha256Hex(text);
    state.lastResult = runtimeMap;
    state.lastBaseName = `amazon-connect-runtime-map-${sanitizeFilenamePart(file.name.replace(/\.json$/i, ""))}-${timestampSlug()}`;
    const report = createExportReport("IMPORT_FLOW_JSON");
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(runtimeMap), "application/json", report);
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}-summary.json`, jsonText(summarizeRuntimeMap(runtimeMap)), "application/json", report);
    await saveExportReport(report, runtimeMap);
    els.downloadLast.disabled = false;
    printResult(summarizeRuntimeMap(runtimeMap));
  } catch (error) {
    setError(error);
  } finally {
    event.target.value = "";
  }
}

async function importContactTranscriptJson(event) {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const json = JSON.parse(text);
    const contactMap = parseContactTranscriptJson(json, file.name);
    contactMap.capturedAt = new Date().toISOString();
    contactMap.source = {
      section: "contact-records",
      mode: "contact-transcript-import",
      fileName: file.name
    };
    contactMap.contentHash = await sha256Hex(text);
    state.lastResult = contactMap;
    state.lastBaseName = `amazon-connect-contact-transcript-${sanitizeFilenamePart(contactMap.contactId || file.name.replace(/\\.json$/i, ""))}-${timestampSlug()}`;
    const report = createExportReport("IMPORT_CONTACT_TRANSCRIPT_JSON");
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(contactMap), "application/json", report);
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}-summary.json`, jsonText(summarizeContactTranscript(contactMap)), "application/json", report);
    await saveExportReport(report, contactMap);
    els.downloadLast.disabled = false;
    printResult(summarizeContactTranscript(contactMap));
  } catch (error) {
    setError(error);
  } finally {
    event.target.value = "";
  }
}

async function importContactSearchCsv(event) {
  try {
    const file = event.target.files?.[0];
    if (!file) {
      printResult({ status: "No Contact CSV selected" });
      return;
    }
    printResult({
      status: "Importing Contact CSV",
      fileName: file.name,
      size: file.size,
      target: state.outputTargetLabel
    });
    const text = await file.text();
    const contactIndex = parseContactSearchCsv(text, file.name);
    contactIndex.contentHash = await sha256Hex(text);
    contactIndex.source = {
      section: "contact-search",
      mode: "contact-search-csv-import",
      fileName: file.name
    };
    const queue = buildCallQueue(contactIndex);
    contactIndex.queueSummary = summarizeCallQueue(queue);
    state.callQueue = queue;
    state.lastResult = contactIndex;
    state.lastBaseName = `amazon-connect-contact-search-csv-${timestampSlug()}`;
    await persistCallQueue(queue);
    updateQueueStatus(queue);

    const report = createExportReport("IMPORT_CONTACT_SEARCH_CSV");
    const saveWarnings = [];
    try {
      await ensureOutputDirectoryHandle({ requestPermission: true });
      await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(contactIndex), "application/json", report);
      await saveTextFile(`${report.runFolder}/${state.lastBaseName}-queue.json`, jsonText(queue), "application/json", report);
      await saveTextFile(`contact-search/csv/${timestampSlug()}-${sanitizePathSegment(file.name, { preserveExtension: true })}`, text, "text/csv", report);
      await saveTextFile(`contact-search/queues/latest-call-queue.json`, jsonText(queue), "application/json", report);
      await saveExportReport(report, contactIndex);
    } catch (saveError) {
      saveWarnings.push(`Import succeeded, but saving files failed: ${friendlyErrorMessage(saveError)}`);
      report.warnings.push(...saveWarnings);
    }
    els.downloadLast.disabled = false;
    updateQueueStatus(queue);
    const skippedBreakdown = skippedQueueBreakdown(queue);
    printResult({
      status: "Contact search CSV imported",
      ...contactIndex.queueSummary,
      alreadyCaptured: skippedBreakdown.alreadyCaptured,
      manuallySkipped: skippedBreakdown.manuallySkipped,
      saveWarnings: [...(report.warnings || []), ...saveWarnings],
      nextStep: state.pendingCsvAutomation
        ? "Continuing pending automation."
        : (contactIndex.queueSummary.pendingContacts
          ? "Validate or capture the call queue when ready."
          : "No voice contacts are pending. Non-voice contacts are kept in the queue as out of scope and will not be opened.")
    });
    if (state.pendingCsvAutomation) {
      const automation = state.pendingCsvAutomation;
      state.pendingCsvAutomation = null;
      await runImportedCsvAutomation(automation);
    }
  } catch (error) {
    setError(error);
  } finally {
    event.target.value = "";
  }
}

function buildCallQueue(contactIndex) {
  const capturedIds = new Set((state.history?.contacts || []).map((contact) => contact.contactId));
  const contacts = (contactIndex.contacts || []).map((contact) => {
    const alreadyCaptured = capturedIds.has(contact.contactId);
    const inVoiceScope = isVoiceAnalyticsContact(contact);
    if (!inVoiceScope) {
      return {
        ...contact,
        status: "out_of_scope",
        analyticsScope: "non-voice",
        skipReason: "non-voice-channel"
      };
    }
    return {
      ...contact,
      analyticsScope: "voice",
      status: alreadyCaptured ? "skipped" : "pending",
      skipReason: alreadyCaptured ? "already-captured" : ""
    };
  });
  return {
    createdAt: new Date().toISOString(),
    sourceFileName: contactIndex.sourceFileName,
    sourceHash: contactIndex.contentHash || "",
    totalContacts: contacts.length,
    pendingContacts: contacts.filter((contact) => contact.status === "pending").length,
    outOfScopeContacts: contacts.filter((contact) => contact.status === "out_of_scope").length,
    skippedContacts: contacts.filter((contact) => contact.status === "skipped").length,
    capturedContacts: 0,
    failedContacts: 0,
    contacts
  };
}

async function persistCallQueue(queue) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.callQueue]: queue });
  } catch (error) {
    console.warn("Could not persist call queue in extension storage", error);
  }
}

async function dryRunCallQueue() {
  try {
    const queue = await ensureCallQueue();
    const summary = summarizeCallQueue(queue);
    const validation = validateCallQueueState(queue);
    const sample = queue.contacts.filter((contact) => contact.status === "pending").slice(0, 10);
    printResult({
      status: "Call queue dry run",
      ...summary,
      validation,
      sample
    });
  } catch (error) {
    setError(error);
  }
}

async function ensureCallQueue() {
  if (state.callQueue) {
    updateQueueStatus(state.callQueue);
    return state.callQueue;
  }
  const handle = await ensureOutputDirectoryHandle({ requestPermission: true });
  if (!handle) throw new Error("Import Contact CSV first. If you already imported it, choose or reconnect the same output folder so the extension can read contact-search/queues/latest-call-queue.json.");
  let queue;
  try {
    queue = await readJsonFromDirectory(handle, "contact-search/queues/latest-call-queue.json");
  } catch (error) {
    throw new Error("Import Contact CSV first. The call queue file contact-search/queues/latest-call-queue.json was not found in the selected output folder.");
  }
  state.callQueue = queue;
  await persistCallQueue(queue);
  updateQueueStatus(queue);
  return queue;
}

async function captureCallQueue({ limit = 1 } = {}) {
  const report = createExportReport(limit === 1 ? "CAPTURE_NEXT_CALL" : `CAPTURE_${limit}_CALLS`);
  try {
    const queue = await ensureCallQueue();
    const pending = queue.contacts.filter((contact) => contact.status === "pending").slice(0, limit);
    if (!pending.length) {
      refreshQueueCounts(queue);
      const summary = summarizeCallQueue(queue);
      const skippedBreakdown = skippedQueueBreakdown(queue);
      const resetHint = skippedBreakdown.alreadyCaptured
        ? ` ${skippedBreakdown.alreadyCaptured} contacts are already captured in this output folder history. Click Recapture already captured if you want to capture them again.`
        : " Import a new Contact CSV or reset skipped/failed contacts before capturing.";
      throw new Error(`No pending contacts in the current queue: ${queueStatusText(summary, skippedBreakdown)}.${resetHint}`);
    }

    state.scanRunning = true;
    state.stopRequested = false;
    startRunTracker(report.kind, pending.length);
    const results = [];
    const runStartedAt = Date.now();
    for (const [index, contact] of pending.entries()) {
      if (state.stopRequested) {
        results.push({ status: "stopped", reason: "Run stopped by user." });
        break;
      }
      const itemStartedAt = Date.now();
      updateRunTracker({
        status: "running",
        sectionLabel: `Contact ${index + 1}/${pending.length}`,
        phase: contact.contactId,
        stage: "capturing-call",
        itemIndex: index + 1,
        itemTotal: pending.length,
        completed: index,
        total: pending.length,
        throughput: callRunThroughput(runStartedAt, index, pending.length)
      });
      try {
        contact.status = "capturing";
        const result = await captureFromContent("CAPTURE_NETWORK_TRANSCRIPT", { contactId: contact.contactId })
          .catch(async (error) => {
            await navigateTo(contact.detailUrl, { silent: true });
            await waitForPageReady({ section: "contact-records", mode: "detail", timeoutMs: 16000 });
            const fallbackResult = await captureFromContent("CAPTURE_NETWORK_TRANSCRIPT");
            fallbackResult.directCaptureFallbackError = error.message || String(error);
            return fallbackResult;
          });
        result.sourceContact = contact;
        const baseName = buildBaseName(result);
        await downloadCapture(result, baseName, report);
        contact.status = "done";
        contact.capturedAt = result.capturedAt;
        contact.resultFileBaseName = baseName;
        contact.aiAgentIds = result.contactTranscript?.references?.aiAgentIds || [];
        contact.promptIds = result.contactTranscript?.references?.promptIds || [];
        contact.flowIds = result.contactTranscript?.references?.flowIds || [];
        contact.summary = result.contactTranscript?.summary || "";
        contact.conversationTurnCount = result.contactTranscript?.conversationTurns?.length || 0;
        contact.logCount = result.contactTranscript?.logCount || 0;
        contact.captureScope = result.captureScope || "";
        contact.usedNavigationFallback = Boolean(result.directCaptureFallbackError);
        contact.directCaptureFallbackError = result.directCaptureFallbackError || "";
        contact.qualityFlags = detectCallQualityFlags(result.contactTranscript || {});
        contact.validation = validateCapturedContact(contact, result);
        contact.captureDurationMs = Date.now() - itemStartedAt;
        results.push({
          contactId: contact.contactId,
          status: "done",
          aiAgentIds: contact.aiAgentIds,
          promptIds: contact.promptIds,
          flowIds: contact.flowIds,
          conversationTurnCount: contact.conversationTurnCount,
          qualityFlags: contact.qualityFlags,
          validation: contact.validation,
          usedNavigationFallback: contact.usedNavigationFallback
        });
      } catch (error) {
        contact.status = "failed";
        contact.error = error.message || String(error);
        contact.failedAt = new Date().toISOString();
        results.push({ contactId: contact.contactId, status: "failed", error: contact.error });
      }
      updateRunTracker({
        status: "running",
        sectionLabel: `Contact ${Math.min(index + 1, pending.length)}/${pending.length}`,
        completed: index + 1,
        total: pending.length,
        itemIndex: index + 1,
        itemTotal: pending.length,
        throughput: callRunThroughput(runStartedAt, index + 1, pending.length)
      });
    }

    refreshQueueCounts(queue);
    updateQueueStatus(queue);
    await persistCallQueue(queue);
    await saveTextFile(`contact-search/queues/latest-call-queue.json`, jsonText(queue), "application/json", report);
    const queueValidation = validateCallQueueState(queue);
    const analyticsDashboard = buildAnalyticsDashboard(queue, results);
    await saveAnalyticsArtifacts(analyticsDashboard, report);
    const queueReport = {
      capturedAt: new Date().toISOString(),
      source: { section: "contact-records", mode: "call-queue-run" },
      queueSummary: summarizeCallQueue(queue),
      validation: queueValidation,
      analyticsDashboardSummary: analyticsDashboard.summary,
      results,
      warnings: [
        ...results.filter((result) => result.status === "failed").map((result) => `${result.contactId}: ${result.error}`),
        ...results.filter((result) => result.status === "stopped").map((result) => result.reason),
        ...queueValidation.warnings
      ]
    };
    state.lastResult = queueReport;
    state.lastBaseName = `amazon-connect-call-queue-${timestampSlug()}`;
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(queueReport), "application/json", report);
    await saveExportReport(report, queueReport);
    completeRunTracker({
      status: queueReport.warnings.length ? "warning" : "success",
      message: runCompletionMessage(queueValidation, summarizeCallQueue(queue), results),
      ...queueReport.queueSummary,
      validation: queueValidation,
      warningContacts: queueValidation.warningContacts || [],
      warnings: queueReport.warnings
    });
    printResult(queueReport);
  } catch (error) {
    failRunTracker(error);
    setError(error);
  } finally {
    state.scanRunning = false;
    state.stopRequested = false;
    setButtons(state.detected || { section: "unknown", mode: "unknown" });
  }
}

function refreshQueueCounts(queue) {
  queue.pendingContacts = queue.contacts.filter((contact) => contact.status === "pending").length;
  queue.outOfScopeContacts = queue.contacts.filter((contact) => contact.status === "out_of_scope").length;
  queue.skippedContacts = queue.contacts.filter((contact) => contact.status === "skipped").length;
  queue.capturedContacts = queue.contacts.filter((contact) => contact.status === "done").length;
  queue.failedContacts = queue.contacts.filter((contact) => contact.status === "failed").length;
  queue.updatedAt = new Date().toISOString();
}

function updateQueueStatus(queue) {
  if (!els.queueStatus) return;
  if (!queue?.contacts?.length) {
    els.queueStatus.textContent = "Import Contact CSV first";
    return;
  }
  const summary = summarizeCallQueue(queue);
  const validation = validateCallQueueState(queue);
  els.queueStatus.textContent = `${validation.status}: ${queueStatusText(summary, skippedQueueBreakdown(queue))}`;
}

function skippedQueueBreakdown(queue) {
  const skippedContacts = (queue?.contacts || []).filter((contact) => contact.status === "skipped");
  const alreadyCaptured = skippedContacts.filter((contact) => contact.skipReason === "already-captured").length;
  return {
    alreadyCaptured,
    manuallySkipped: Math.max(0, skippedContacts.length - alreadyCaptured)
  };
}

function queueStatusText(summary, skippedBreakdown = {}) {
  const parts = [
    `${summary.totalContacts} total`,
    `${summary.capturedContacts} captured`,
    `${summary.pendingContacts} pending`
  ];
  if (summary.outOfScopeContacts) parts.push(`${summary.outOfScopeContacts} out of scope`);
  if (skippedBreakdown.alreadyCaptured) parts.push(`${skippedBreakdown.alreadyCaptured} already captured`);
  if (skippedBreakdown.manuallySkipped) parts.push(`${skippedBreakdown.manuallySkipped} skipped`);
  if (!skippedBreakdown.alreadyCaptured && !skippedBreakdown.manuallySkipped) parts.push(`${summary.skippedContacts} skipped`);
  parts.push(`${summary.failedContacts} failed`);
  return parts.join(" / ");
}

function callRunThroughput(startedAtMs, completed, total) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
  const averageSeconds = completed ? (Date.now() - startedAtMs) / completed / 1000 : 0;
  const remaining = Math.max(0, total - completed);
  const etaSeconds = averageSeconds ? Math.round(remaining * averageSeconds) : null;
  return {
    completed,
    total,
    elapsedSeconds,
    averageSecondsPerContact: averageSeconds ? Number(averageSeconds.toFixed(2)) : null,
    etaSeconds
  };
}

async function retryFailedCallQueue() {
  try {
    const queue = await updateFailedContacts("pending", "failed-retry");
    const failedReset = queue.contacts.filter((contact) => contact.retryReason === "failed-retry" && contact.status === "pending").length;
    if (!failedReset) {
      printResult({ status: "No failed contacts to retry", ...summarizeCallQueue(queue) });
      return;
    }
    await captureCallQueue({ limit: Math.min(readCustomCallLimit(), failedReset) });
  } catch (error) {
    setError(error);
  }
}

async function recaptureAlreadyCapturedCallQueue() {
  try {
    const { queue, updated } = await updateAlreadyCapturedContacts("pending", "already-captured-recapture");
    if (!updated) {
      printResult({ status: "No already captured contacts to recapture", ...summarizeCallQueue(queue) });
      return;
    }
    printResult({
      status: "Already captured contacts moved to pending",
      updated,
      ...summarizeCallQueue(queue),
      nextStep: "Capture pending calls when ready."
    });
  } catch (error) {
    setError(error);
  }
}

async function updateAlreadyCapturedContacts(nextStatus, reason) {
  const report = createExportReport(`CALL_QUEUE_${String(reason || "UPDATE").toUpperCase()}`);
  const queue = await ensureCallQueue();
  let updated = 0;
  for (const contact of queue.contacts) {
    if (contact.status !== "skipped" || contact.skipReason !== "already-captured") continue;
    if (!isVoiceAnalyticsContact(contact)) continue;
    updated += 1;
    contact.status = nextStatus;
    contact.retryReason = reason;
    contact.updatedAt = new Date().toISOString();
    if (nextStatus === "pending") {
      delete contact.skipReason;
    }
  }
  refreshQueueCounts(queue);
  updateQueueStatus(queue);
  await persistCallQueue(queue);
  await saveTextFile(`contact-search/queues/latest-call-queue.json`, jsonText(queue), "application/json", report);
  const validation = validateCallQueueState(queue);
  const dashboard = buildAnalyticsDashboard(queue, []);
  await saveAnalyticsArtifacts(dashboard, report);
  const result = {
    capturedAt: new Date().toISOString(),
    source: { section: "contact-search", mode: "call-queue-update" },
    updated,
    nextStatus,
    reason,
    queueSummary: summarizeCallQueue(queue),
    validation,
    warnings: validation.warnings
  };
  state.lastResult = result;
  state.lastBaseName = `amazon-connect-call-queue-update-${timestampSlug()}`;
  await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(result), "application/json", report);
  await saveExportReport(report, result);
  return { queue, updated };
}

async function updateFailedContacts(nextStatus, reason) {
  const report = createExportReport(`CALL_QUEUE_${String(reason || "UPDATE").toUpperCase()}`);
  const queue = await ensureCallQueue();
  let updated = 0;
  for (const contact of queue.contacts) {
    if (contact.status !== "failed") continue;
    updated += 1;
    contact.status = nextStatus;
    contact.skipReason = nextStatus === "skipped" ? reason : "";
    contact.retryReason = reason;
    contact.updatedAt = new Date().toISOString();
    if (nextStatus === "pending") {
      delete contact.error;
      delete contact.failedAt;
    }
  }
  refreshQueueCounts(queue);
  updateQueueStatus(queue);
  await persistCallQueue(queue);
  await saveTextFile(`contact-search/queues/latest-call-queue.json`, jsonText(queue), "application/json", report);
  const validation = validateCallQueueState(queue);
  const dashboard = buildAnalyticsDashboard(queue, []);
  await saveAnalyticsArtifacts(dashboard, report);
  const result = {
    capturedAt: new Date().toISOString(),
    source: { section: "contact-search", mode: "call-queue-update" },
    updated,
    nextStatus,
    reason,
    queueSummary: summarizeCallQueue(queue),
    validation,
    warnings: validation.warnings
  };
  state.lastResult = result;
  state.lastBaseName = `amazon-connect-call-queue-update-${timestampSlug()}`;
  await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(result), "application/json", report);
  await saveExportReport(report, result);
  printResult(result);
  return queue;
}

async function validateCurrentCallQueue() {
  try {
    const report = createExportReport("VALIDATE_CALL_QUEUE");
    const queue = await ensureCallQueue();
    updateQueueStatus(queue);
    const validation = validateCallQueueState(queue);
    const result = {
      capturedAt: new Date().toISOString(),
      source: { section: "contact-search", mode: "call-queue-validation" },
      queueSummary: summarizeCallQueue(queue),
      validation,
      warnings: validation.warnings
    };
    state.lastResult = result;
    state.lastBaseName = `amazon-connect-call-queue-validation-${timestampSlug()}`;
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(result), "application/json", report);
    await saveExportReport(report, result);
    printResult(result);
  } catch (error) {
    setError(error);
  }
}

async function buildAnalyticsDashboardFromQueue() {
  try {
    const report = createExportReport("BUILD_ANALYTICS_DASHBOARD");
    const queue = await ensureCallQueue();
    updateQueueStatus(queue);
    const dashboard = buildAnalyticsDashboard(queue, []);
    await saveAnalyticsArtifacts(dashboard, report);
    state.lastResult = dashboard;
    state.lastBaseName = `amazon-connect-analytics-dashboard-${timestampSlug()}`;
    await saveTextFile(`${report.runFolder}/${state.lastBaseName}.json`, jsonText(dashboard), "application/json", report);
    await saveExportReport(report, dashboard);
    printResult({
      status: "Analytics dashboard built",
      ...dashboard.summary
    });
  } catch (error) {
    setError(error);
  }
}

async function runImportedCsvAutomation(options = {}) {
  const {
    includeConfigExport = true,
    captureAllPending = true
  } = options;
  try {
    const queue = await ensureCallQueue();
    updateQueueStatus(queue);
    const initialValidation = validateCallQueueState(queue);
    printResult({
      status: "Automatic run started",
      queue: summarizeCallQueue(queue),
      validation: initialValidation,
      steps: [
        "Build initial dashboard",
        includeConfigExport ? "Run full configuration export" : "Skip configuration export",
        captureAllPending ? "Capture all pending calls" : "Skip call capture",
        "Build final dashboard"
      ]
    });

    await buildAnalyticsDashboardFromQueue();

    if (includeConfigExport) {
      await scanSections({ detailLimit: null, kind: "FULL_CONFIG_EXPORT" });
    }

    if (captureAllPending) {
      const nextQueue = await ensureCallQueue();
      const pendingCount = nextQueue.contacts.filter((contact) => contact.status === "pending").length;
      if (pendingCount) {
        await captureCallQueue({ limit: pendingCount });
      } else {
        printResult({
          status: "No pending calls to capture",
          queue: summarizeCallQueue(nextQueue)
        });
      }
    }

    await buildAnalyticsDashboardFromQueue();
    const finalQueue = await ensureCallQueue();
    const finalValidation = validateCallQueueState(finalQueue);
    completeRunTracker({
      status: finalValidation.status === "complete" ? "success" : finalValidation.status,
      message: runCompletionMessage(finalValidation, summarizeCallQueue(finalQueue)),
      queueSummary: summarizeCallQueue(finalQueue),
      warningContacts: finalValidation.warningContacts || [],
      warnings: finalValidation.warnings || []
    });
    printResult({
      status: "Automatic run complete",
      queue: summarizeCallQueue(finalQueue),
      validation: finalValidation
    });
  } catch (error) {
    failRunTracker(error);
    setError(error);
  }
}

async function saveAnalyticsArtifacts(dashboard, report) {
  await saveTextFile(`analytics/latest-dashboard.json`, jsonText(dashboard), "application/json", report);
  await saveTextFile(`analytics/latest-dashboard.md`, analyticsDashboardMarkdown(dashboard), "text/plain", report);
  await saveTextFile(`analytics/latest-contacts.csv`, analyticsContactsCsv(dashboard.contacts || []), "text/csv", report);
  await saveTextFile(`analytics/latest-contacts.jsonl`, analyticsContactsJsonl(dashboard.contacts || []), "application/jsonl", report);
  await saveCrossIndexFiles("prompt", dashboard.byPrompt || {}, report);
  await saveCrossIndexFiles("agent", dashboard.byAgent || {}, report);
  await saveCrossIndexFiles("flow", dashboard.byFlow || {}, report);
}

async function saveCrossIndexFiles(kind, index, report) {
  const directory = `analytics/by-${kind}`;
  await saveTextFile(`${directory}/index.json`, jsonText(index), "application/json", report);
  for (const [id, value] of Object.entries(index)) {
    await saveTextFile(`${directory}/${sanitizePathSegment(id)}.json`, jsonText(value), "application/json", report);
  }
}

function summarizeRuntimeMap(runtimeMap) {
  return {
    capturedAt: runtimeMap.capturedAt,
    sourceFileName: runtimeMap.sourceFileName,
    version: runtimeMap.version,
    startAction: runtimeMap.startAction,
    actionCount: runtimeMap.actionCount,
    aiAgentCount: runtimeMap.references?.aiAgentArns?.length || 0,
    lexBotAliasCount: runtimeMap.references?.lexBotAliasArns?.length || 0,
    queueCount: runtimeMap.references?.queueArns?.length || 0,
    lambdaCount: runtimeMap.references?.lambdaArns?.length || 0,
    warnings: runtimeMap.warnings || []
  };
}

function summarizeContactTranscript(contactMap) {
  return {
    capturedAt: contactMap.capturedAt,
    sourceFileName: contactMap.sourceFileName,
    contactId: contactMap.contactId,
    channel: contactMap.channel,
    logCount: contactMap.logCount,
    analysisTranscriptCount: contactMap.analysisTranscriptCount,
    conversationTurnCount: contactMap.conversationTurns?.length || 0,
    flowCount: contactMap.references?.contactFlowArns?.length || 0,
    aiAgentIds: contactMap.references?.aiAgentIds || [],
    promptIds: contactMap.references?.promptIds || [],
    lexBotAliasCount: contactMap.references?.lexBotAliasArns?.length || 0,
    summary: contactMap.summary,
    warnings: contactMap.warnings || []
  };
}

function createExportReport(kind) {
  const startedAt = new Date();
  const kindSlug = sanitizeFilenamePart(String(kind || "export").toLowerCase());
  return {
    reportVersion: 1,
    kind,
    startedAt: startedAt.toISOString(),
    completedAt: "",
    runFolder: `runs/${timestampSlug(startedAt)}-${kindSlug}`,
    outputTarget: state.outputTargetLabel,
    files: [],
    summary: {},
    warnings: []
  };
}

async function saveTextFile(filename, content, mimeType, report = null, options = {}) {
  const text = String(content ?? "");
  const record = {
    filename,
    savedFilename: filename,
    mimeType,
    bytes: new TextEncoder().encode(text).byteLength,
    sha256: await sha256Hex(text),
    savedAt: new Date().toISOString(),
    target: state.outputTargetLabel,
    method: state.outputDirectoryHandle ? "file-system-access" : "chrome-downloads"
  };

  try {
    if (state.outputDirectoryHandle) {
      record.savedFilename = await withTimeout(
        writeTextToDirectory(filename, text),
        SAVE_TIMEOUT_MS,
        `Timed out while writing ${filename}`
      );
    } else {
      record.savedFilename = sanitizeOutputFilename(filename);
      await withTimeout(
        downloadText(record.savedFilename, text, mimeType),
        SAVE_TIMEOUT_MS,
        `Timed out while downloading ${record.savedFilename}`
      );
    }
  } catch (error) {
    record.method = "chrome-downloads-fallback";
    record.warning = friendlySaveWarning(error);
    if (report) report.warnings.push(record.warning);
    disconnectOutputFolderAfterWriteFailure();
    record.savedFilename = sanitizeOutputFilename(filename);
    try {
      await withTimeout(
        downloadText(record.savedFilename, text, mimeType),
        SAVE_TIMEOUT_MS,
        `Timed out while downloading ${record.savedFilename}`
      );
    } catch (downloadError) {
      throw new Error(`Could not save ${filename}. ${friendlySaveWarning(error)} Fallback download also failed: ${downloadError?.message || String(downloadError)}`);
    }
  }

  if (report && !options.skipReportRecord) {
    report.files.push(record);
  }

  return record;
}

async function saveDataUrlFile(filename, dataUrl, mimeType, report = null, options = {}) {
  const blob = await dataUrlToBlob(dataUrl);
  const record = {
    filename,
    savedFilename: filename,
    mimeType,
    bytes: blob.size,
    sha256: await sha256Hex(dataUrl),
    savedAt: new Date().toISOString(),
    target: state.outputTargetLabel,
    method: state.outputDirectoryHandle ? "file-system-access" : "chrome-downloads"
  };

  try {
    if (state.outputDirectoryHandle) {
      record.savedFilename = await withTimeout(
        writeBlobToDirectory(filename, blob),
        SAVE_TIMEOUT_MS,
        `Timed out while writing ${filename}`
      );
    } else {
      record.savedFilename = sanitizeOutputFilename(filename);
      await withTimeout(
        downloadDataUrl(record.savedFilename, dataUrl),
        SAVE_TIMEOUT_MS,
        `Timed out while downloading ${record.savedFilename}`
      );
    }
  } catch (error) {
    record.method = "chrome-downloads-fallback";
    record.warning = friendlySaveWarning(error);
    if (report) report.warnings.push(record.warning);
    disconnectOutputFolderAfterWriteFailure();
    record.savedFilename = sanitizeOutputFilename(filename);
    try {
      await withTimeout(
        downloadDataUrl(record.savedFilename, dataUrl),
        SAVE_TIMEOUT_MS,
        `Timed out while downloading ${record.savedFilename}`
      );
    } catch (downloadError) {
      throw new Error(`Could not save ${filename}. ${friendlySaveWarning(error)} Fallback download also failed: ${downloadError?.message || String(downloadError)}`);
    }
  }

  if (report && !options.skipReportRecord) {
    report.files.push(record);
  }

  return record;
}

function friendlySaveWarning(error) {
  const message = error?.message || String(error);
  if (/requested file or directory could not be found|notfound/i.test(message)) {
    return "Selected output folder is no longer available. Reconnect it with Choose output folder; this file was saved through Chrome downloads instead.";
  }
  if (/permission|denied|notallowed|security/i.test(message)) {
    return "Selected output folder permission is no longer available. Reconnect it with Choose output folder; this file was saved through Chrome downloads instead.";
  }
  return `Selected folder write failed: ${message}`;
}

function disconnectOutputFolderAfterWriteFailure() {
  if (!state.outputDirectoryHandle) return;
  const previousLabel = state.outputTargetLabel || state.outputDirectoryHandle.name || "Selected folder";
  state.outputDirectoryHandle = null;
  state.persistedDirectoryHandle = null;
  state.outputTargetLabel = `${previousLabel} (reconnect needed)`;
  if (els.outputTarget) els.outputTarget.textContent = state.outputTargetLabel;
  void clearPersistedDirectoryHandle();
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message || `Operation timed out after ${timeoutMs} ms.`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function writeTextToDirectory(filename, text) {
  const safePath = sanitizeOutputPath(filename);
  const parts = safePath.split("/").filter(Boolean);
  const safeName = parts.pop() || "amazon-connect-export.json";
  let directoryHandle = state.outputDirectoryHandle;
  for (const part of parts) {
    directoryHandle = await directoryHandle.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
  return safePath;
}

async function writeBlobToDirectory(filename, blob) {
  const safePath = sanitizeOutputPath(filename);
  const parts = safePath.split("/").filter(Boolean);
  const safeName = parts.pop() || "amazon-connect-export.png";
  let directoryHandle = state.outputDirectoryHandle;
  for (const part of parts) {
    directoryHandle = await directoryHandle.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return safePath;
}

function sanitizeOutputFilename(filename) {
  const rawName = String(filename || "amazon-connect-export.json")
    .split("/")
    .filter(Boolean)
    .join("-");
  return sanitizePathSegment(rawName, { preserveExtension: true, maxLength: 180 });
}

function sanitizeOutputPath(filename) {
  return String(filename || "amazon-connect-export.json")
    .split("/")
    .filter(Boolean)
    .map((part, index, parts) => sanitizePathSegment(part, {
      preserveExtension: index === parts.length - 1,
      maxLength: index === parts.length - 1 ? 180 : 100
    }))
    .join("/");
}

function sanitizePathSegment(value, options = {}) {
  const { preserveExtension = false, maxLength = 120 } = options;
  const rawName = String(value || "amazon-connect");
  const extensionMatch = rawName.match(/(\.(?:json|csv|yaml|yml|txt|png))$/i);
  const extension = preserveExtension && extensionMatch ? extensionMatch[1] : "";
  const rawBase = extension ? rawName.slice(0, -extension.length) : rawName;
  const cleanBase = rawBase
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "amazon-connect-export";
  return `${truncateFilenameBase(cleanBase, maxLength)}${extension}`;
}

function truncateFilenameBase(value, maxLength) {
  if (value.length <= maxLength) return value;
  const tailLength = 64;
  const headLength = Math.max(1, maxLength - tailLength - 1);
  return `${value.slice(0, headLength)}-${value.slice(-tailLength)}`;
}

async function saveExportReport(report, primaryResult = null) {
  report.completedAt = new Date().toISOString();
  report.outputTarget = state.outputTargetLabel;
  report.summary = buildExportReportSummary(report, primaryResult);
  report.validation = validateReport(report, primaryResult, {
    expectedScreenshots: expectedScreenshotsForReport(report, primaryResult)
  });
  await saveTextFile(`${report.runFolder}/run-summary.md`, runSummaryMarkdown(report, primaryResult), "text/markdown", report);
  report.generatedFileCount = report.files.length;
  report.totalBytes = report.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  report.validation = validateReport(report, primaryResult, {
    expectedScreenshots: expectedScreenshotsForReport(report, primaryResult)
  });
  await saveTextFile(`${report.runFolder}/report.json`, jsonText(report), "application/json", null, { skipReportRecord: true });
  await saveTextFile(`_history/latest-report.json`, jsonText(report), "application/json", null, { skipReportRecord: true });
  if (state.outputDirectoryHandle) {
    await loadHistoryFromOutputFolder({ silent: true, requestPermission: false, preserveResult: true }).catch(() => {});
  }
  return report;
}

function runSummaryMarkdown(report, primaryResult = null) {
  const result = primaryResult || {};
  const summary = report.summary || {};
  const validation = report.validation || {};
  const queueSummary = result.queueSummary || summary.queueSummary || {};
  const dashboardSummary = result.analyticsDashboardSummary || result.summary || null;
  const results = Array.isArray(result.results) ? result.results : [];
  const warningContacts = report.validation?.warningContacts || result.validation?.warningContacts || [];
  const completedAt = report.completedAt || new Date().toISOString();
  const seconds = report.startedAt ? Math.round((new Date(completedAt) - new Date(report.startedAt)) / 1000) : "";
  const warnings = uniqueStrings([
    ...(report.warnings || []),
    ...(summary.warnings || []),
    ...(result.warnings || []),
    ...(validation.warnings || [])
  ]);
  const lines = [
    `# ${report.kind || "Amazon Connect export"} Run Summary`,
    "",
    `- Started: ${report.startedAt || ""}`,
    `- Completed: ${completedAt}`,
    `- Duration seconds: ${seconds}`,
    `- Output target: ${report.outputTarget || ""}`,
    `- Run folder: ${report.runFolder || ""}`,
    `- Files generated: ${report.files?.length || 0}`,
    `- Validation: ${validation.status || "unknown"}`,
    "",
    "## Queue",
    "",
    `- Total contacts: ${queueSummary.totalContacts ?? ""}`,
    `- Captured contacts: ${queueSummary.capturedContacts ?? ""}`,
    `- Pending contacts: ${queueSummary.pendingContacts ?? ""}`,
    `- Failed contacts: ${queueSummary.failedContacts ?? ""}`,
    "",
    "## Analytics",
    ""
  ];

  if (dashboardSummary) {
    lines.push(
      `- Unique prompts: ${dashboardSummary.uniquePromptCount ?? ""}`,
      `- Unique agents: ${dashboardSummary.uniqueAgentCount ?? ""}`,
      `- Unique flows: ${dashboardSummary.uniqueFlowCount ?? ""}`,
      `- Quality flags: ${dashboardSummary.qualityFlagCount ?? ""}`,
      ""
    );
  } else {
    lines.push("- No analytics dashboard summary for this run.", "");
  }

  lines.push("## Warnings", "");
  lines.push(...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- None"]));
  lines.push("", "## Contacts With Warnings", "");
  if (warningContacts.length) {
    for (const contact of warningContacts) {
      lines.push(`- ${contact.contactId || "(no contact id)"}: ${(contact.reasons || []).join("; ")}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("", "## Captured Contacts", "");
  if (results.length) {
    for (const item of results) {
      const ids = [
        ...(item.promptIds || []).map((id) => `prompt:${id}`),
        ...(item.aiAgentIds || []).map((id) => `agent:${id}`),
        ...(item.flowIds || []).map((id) => `flow:${id}`)
      ].join(", ");
      lines.push(`- ${item.contactId || "(no contact id)"}: ${item.status || ""}${ids ? ` (${ids})` : ""}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("", "## Key Files", "");
  for (const filename of [
    "analytics/latest-dashboard.md",
    "analytics/latest-dashboard.json",
    "analytics/latest-contacts.csv",
    "contact-search/queues/latest-call-queue.json"
  ]) {
    lines.push(`- ${filename}`);
  }
  return lines.join("\n");
}

function expectedScreenshotsForReport(report, primaryResult) {
  if (report.kind !== "VALIDATION_SCREENSHOTS") return 0;
  if (primaryResult?.expectedScreenshots) return primaryResult.expectedScreenshots;
  if (report.summary?.expectedScreenshots) return report.summary.expectedScreenshots;
  const sections = primaryResult?.sections || report.summary?.sections || [];
  if (sections.length) {
    return sections.reduce((sum, section) => {
      const detailCount = Array.isArray(section.details)
        ? section.details.filter((detail) => !detail.skipped).length
        : (section.detail && !section.detail.skipped ? 1 : 0);
      return sum + 1 + detailCount;
    }, 0);
  }
  return getRuntimeSections().length * 2;
}

function buildExportReportSummary(report, primaryResult) {
  const result = primaryResult || state.lastResult || {};
  return {
    fileCount: report.files.length,
    totalBytes: report.files.reduce((sum, file) => sum + (file.bytes || 0), 0),
    sections: summarizeReportSections(result),
    expectedScreenshots: result.expectedScreenshots || 0,
    source: result.source || {},
    itemCount: result.items?.length || 0,
    contactCount: result.contacts?.length || result.queueSummary?.totalContacts || (result.contactTranscript?.contactId ? 1 : 0),
    queueSummary: result.queueSummary || null,
    contactId: result.contactTranscript?.contactId || result.contactId || "",
    versionCount: result.versions?.length || 0,
    promptHash: result.prompt?.contentHash || "",
    warnings: [
      ...(report.warnings || []),
      ...(result.warnings || [])
    ]
  };
}

function summarizeReportSections(result) {
  if (!Array.isArray(result.sections)) return [];
  return result.sections.map((section) => ({
    label: section.label,
    itemCount: section.index?.itemCount || 0,
    indexFileBaseName: section.index?.fileBaseName || "",
    detailCount: Array.isArray(section.details)
      ? section.details.filter((detail) => !detail.skipped).length
      : (section.detail && !section.detail.skipped ? 1 : 0),
    details: (Array.isArray(section.details) ? section.details : [section.detail].filter(Boolean)).map((detail) => ({
      target: detail.target || "",
      title: detail.title || "",
      sourceName: detail.sourceItem?.name || "",
      fileBaseName: detail.fileBaseName || "",
      screenshot: detail.screenshot || "",
      screenshotError: detail.screenshotError || "",
      readiness: detail.readiness || null,
      versionCount: detail.versionCount || 0,
      promptHash: detail.promptHash || "",
      warnings: detail.warnings || []
    })),
    warnings: [
      ...(section.index?.warnings || []),
      ...(section.detail?.warnings || []),
      ...(section.details || []).flatMap((detail) => detail.warnings || [])
    ]
  }));
}

async function downloadLastResult() {
  try {
    if (!state.lastResult) throw new Error("No result available.");
    const report = createExportReport("REDOWNLOAD_LAST_RESULT");
    await saveTextFile(`${report.runFolder}/${state.lastBaseName || buildBaseName(state.lastResult)}-redownload.json`, jsonText(state.lastResult), "application/json", report);
    await saveExportReport(report, state.lastResult);
  } catch (error) {
    setError(error);
  }
}

function buildBaseName(result) {
  const section = sanitizeFilenamePart(result.source?.section || "amazon-connect");
  const mode = sanitizeFilenamePart(result.source?.mode || "capture");
  const pageMode = isDetailResult(result) ? sanitizeFilenamePart(result.source?.pageMode || "") : "";
  const title = sanitizeFilenamePart(result.title || result.overview?.name || "");
  const parts = ["amazon-connect", section, mode, pageMode, title, timestampSlug()].filter(Boolean);
  return parts.join("-");
}

function summarizeResult(result) {
  return {
    capturedAt: result.capturedAt,
    title: result.title,
    section: result.source?.section,
    mode: result.source?.mode,
    pageMode: result.source?.pageMode,
    captureScope: result.captureScope || "",
    itemCount: result.items?.length || 0,
    versionCount: result.versions?.length || 0,
    promptHash: result.prompt?.contentHash || "",
    warnings: result.warnings || []
  };
}

function printResult(value) {
  els.resultBox.classList.remove("error");
  els.resultBox.textContent = JSON.stringify(value, null, 2);
}

function setError(error) {
  els.resultBox.classList.add("error");
  els.resultBox.textContent = friendlyErrorMessage(error);
}

function friendlyErrorMessage(error) {
  const message = error?.message || String(error);
  if (/requested file or directory could not be found|notfound/i.test(message)) {
    return `${message}\n\nThe selected output folder is no longer available to Chrome. Click Choose output folder, select the Connect exports folder again, then retry the import.`;
  }
  if (/permission|denied|notallowed|security/i.test(message)) {
    return `${message}\n\nChrome needs permission to write to the selected output folder. Click Choose output folder and select the folder again.`;
  }
  return message;
}
