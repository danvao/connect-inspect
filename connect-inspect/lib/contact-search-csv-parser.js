const APP_ORIGIN = "https://invest-america.my.connect.aws";

export function parseContactSearchCsv(csvText, sourceFileName = "") {
  const rows = parseCsv(csvText);
  const contacts = rows.map((row, index) => normalizeContactRow(row, index + 1)).filter((row) => row.contactId);
  const uniqueContacts = uniqueBy(contacts, (contact) => contact.contactId);
  return {
    sourceFileName,
    importedAt: new Date().toISOString(),
    rowCount: rows.length,
    contactCount: contacts.length,
    uniqueContactCount: uniqueContacts.length,
    duplicateCount: contacts.length - uniqueContacts.length,
    contacts: uniqueContacts,
    warnings: contacts.length === 0 ? ["No contacts were found in the CSV."] : []
  };
}

function normalizeContactRow(row, rowNumber) {
  const contactId = clean(row["Contact ID"] || row.contactId || row.ContactId || "");
  return compactObject({
    rowNumber,
    contactId,
    channel: clean(row.Channel),
    contactStatus: clean(row["Contact status"]),
    initiationTimestamp: clean(row["Initiation timestamp"]),
    systemPhoneNumber: cleanPhone(row["System phone number"]),
    queue: clean(row.Queue),
    agent: clean(row.Agent),
    customerPhoneNumber: cleanPhone(row["Customer phone number"]),
    disconnectTimestamp: clean(row["Disconnect timestamp"]),
    contactDuration: clean(row["Contact duration"]),
    systemEmailAddress: clean(row["System email address"]),
    customerEmailAddress: clean(row["Customer email address"]),
    detailUrl: contactId ? `${APP_ORIGIN}/contact-trace-records/details/${encodeURIComponent(contactId)}?tz=America/Mexico_City` : ""
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const input = String(text || "").replace(/^\ufeff/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map(clean);
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function clean(value) {
  return String(value ?? "").replace(/^\t?'/, "").trim();
}

function cleanPhone(value) {
  return clean(value).replace(/\s+/g, " ");
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== ""));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
