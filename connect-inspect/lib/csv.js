export function toCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = collectHeaders(safeRows);
  const lines = [headers.map(escapeCell).join(",")];

  for (const row of safeRows) {
    lines.push(headers.map((header) => escapeCell(flattenValue(row[header]))).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function collectHeaders(rows) {
  const headers = [];
  const seen = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

function flattenValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function metadataRows(items) {
  return (items || []).map((item) => {
    const row = {};
    for (const [key, value] of Object.entries(item || {})) {
      if (typeof value === "string" && value.length > 500) {
        row[key] = `${value.slice(0, 500)}...`;
      } else if (Array.isArray(value) || (value && typeof value === "object")) {
        row[key] = JSON.stringify(value);
      } else {
        row[key] = value ?? "";
      }
    }
    return row;
  });
}
