chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !chrome.sidePanel?.open) return;
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["DOWNLOAD_BLOB", "DOWNLOAD_DATA_URL"].includes(message.type)) {
    return false;
  }

  const mimeType = message.mimeType || "application/octet-stream";
  const filename = message.filename || "amazon-connect-export.json";
  const url = message.type === "DOWNLOAD_DATA_URL"
    ? message.dataUrl
    : `data:${mimeType};charset=utf-8,${encodeURIComponent(message.content || "")}`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: false
    },
    (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ ok: false, error: error.message });
        return;
      }
      sendResponse({ ok: true, downloadId });
    }
  );

  return true;
});
