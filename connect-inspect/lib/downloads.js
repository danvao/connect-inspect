export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function sanitizeFilenamePart(value) {
  return String(value || "amazon-connect")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "amazon-connect";
}

export async function downloadText(filename, content, mimeType) {
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_BLOB",
    filename,
    content,
    mimeType
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Download failed for ${filename}`);
  }

  return response;
}

export async function downloadDataUrl(filename, dataUrl) {
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_DATA_URL",
    filename,
    dataUrl
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Download failed for ${filename}`);
  }

  return response;
}

export function jsonText(value) {
  return JSON.stringify(value, null, 2);
}
