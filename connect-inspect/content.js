(() => {
  if (window.__AMAZON_CONNECT_EXPORTER_LOADED__) return;
  window.__AMAZON_CONNECT_EXPORTER_LOADED__ = true;

  const APP_ORIGIN = "https://invest-america.my.connect.aws";
  const LONG_FIELD_LIMIT = 240;
  const NETWORK_CAPTURE_LIMIT = 20;
  const networkTranscriptCaptures = [];

  installNetworkCaptureBridge();

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getUrl() {
    return window.location.href;
  }

  function installNetworkCaptureBridge() {
    if (window.__AMAZON_CONNECT_EXPORTER_NETWORK_BRIDGE__) return;
    window.__AMAZON_CONNECT_EXPORTER_NETWORK_BRIDGE__ = true;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const message = event.data || {};
      if (message.source !== "amazon-connect-exporter-network" || message.type !== "CONTACT_TRANSCRIPT_JSON") return;
      const capture = {
        capturedAt: nowIso(),
        url: message.url || "",
        status: message.status || 0,
        method: message.method || "",
        body: message.body || null
      };
      if (!isContactTranscriptJson(capture.body)) return;
      networkTranscriptCaptures.unshift(capture);
      networkTranscriptCaptures.splice(NETWORK_CAPTURE_LIMIT);
    });

    const script = document.createElement("script");
    script.textContent = `(() => {
      if (window.__AMAZON_CONNECT_EXPORTER_NETWORK_PATCHED__) return;
      window.__AMAZON_CONNECT_EXPORTER_NETWORK_PATCHED__ = true;

      const originalFetch = window.fetch;
      if (typeof originalFetch === "function") {
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          inspectResponse("fetch", requestUrl(args[0]), response);
          return response;
        };
      }

      const OriginalXHR = window.XMLHttpRequest;
      if (typeof OriginalXHR === "function") {
        window.XMLHttpRequest = function() {
          const xhr = new OriginalXHR();
          let method = "";
          let url = "";
          const originalOpen = xhr.open;
          xhr.open = function(nextMethod, nextUrl, ...rest) {
            method = nextMethod || "";
            url = String(nextUrl || "");
            return originalOpen.call(xhr, nextMethod, nextUrl, ...rest);
          };
          xhr.addEventListener("load", () => {
            try {
              inspectText(method || "xhr", url, xhr.status, xhr.responseText);
            } catch (_) {}
          });
          return xhr;
        };
        window.XMLHttpRequest.prototype = OriginalXHR.prototype;
      }

      function requestUrl(input) {
        if (typeof input === "string") return input;
        if (input && typeof input.url === "string") return input.url;
        return "";
      }

      function inspectResponse(method, url, response) {
        try {
          const contentType = response.headers?.get?.("content-type") || "";
          const interestingUrl = /transcript|contact-trace|contact-lens|interaction|analysis/i.test(String(url || ""));
          if (!interestingUrl && !/json/i.test(contentType)) return;
          response.clone().text().then((text) => inspectText(method, url, response.status, text)).catch(() => {});
        } catch (_) {}
      }

      function inspectText(method, url, status, text) {
        if (!text || text.length < 50) return;
        if (!/ContactId|InteractionLogs|AIAgentSpansData|AiAgentId|PromptId|contactSummary/i.test(text)) return;
        let body;
        try {
          body = JSON.parse(text);
        } catch (_) {
          return;
        }
        if (!isContactTranscriptJson(body)) return;
        window.postMessage({
          source: "amazon-connect-exporter-network",
          type: "CONTACT_TRANSCRIPT_JSON",
          method,
          url: String(url || ""),
          status,
          body
        }, "*");
      }

      function isContactTranscriptJson(value) {
        const text = JSON.stringify(value || {});
        return Boolean(value && typeof value === "object" && /ContactId/.test(text) && /InteractionLogs|AIAgentSpansData|AiAgentId|PromptId|contactSummary|transcript/i.test(text));
      }
    })();`;

    const inject = () => {
      const root = document.documentElement || document.head || document.body;
      if (!root) return false;
      root.appendChild(script);
      script.remove();
      return true;
    };
    if (!inject()) {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    }
  }

  function isContactTranscriptJson(value) {
    if (!value || typeof value !== "object") return false;
    const text = JSON.stringify(value);
    return /ContactId/.test(text) && /InteractionLogs|AIAgentSpansData|AiAgentId|PromptId|contactSummary|transcript/i.test(text);
  }

  function classifyUrl(url = getUrl()) {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const hash = parsed.hash;

    if (path === "/q-connect/ai-prompts") return { section: "ai-prompts", mode: "index" };
    if (/^\/q-connect\/ai-prompts\/[^/]+\/edit$/.test(path)) return { section: "ai-prompts", mode: "edit" };
    if (/^\/q-connect\/ai-prompts\/[^/]+$/.test(path)) return { section: "ai-prompts", mode: "detail" };

    if (path === "/q-connect/ai-agents") return { section: "ai-agents", mode: "index" };
    if (/^\/q-connect\/ai-agents\/[^/]+\/edit$/.test(path)) return { section: "ai-agents", mode: "edit" };
    if (/^\/q-connect\/ai-agents\/[^/]+$/.test(path)) return { section: "ai-agents", mode: "detail" };

    if (path === "/q-connect/guardrails") return { section: "guardrails", mode: "index" };
    if (/^\/q-connect\/guardrails\/[^/]+\/edit$/.test(path)) return { section: "guardrails", mode: "edit" };
    if (/^\/q-connect\/guardrails\/[^/]+$/.test(path)) return { section: "guardrails", mode: "detail" };

    if (path === "/contact-flows" && hash === "#modules") return { section: "flow-modules", mode: "index" };
    if (path === "/contact-flows" && hash === "#bots") return { section: "conversational-ai", mode: "index" };
    if (path === "/contact-flows" && hash === "#contactFlows") return { section: "contact-flows", mode: "index" };
    if (path === "/contact-flows") return { section: inferVisibleFlowsSection(), mode: "index" };
    if (path === "/contact-flows/edit") return { section: "contact-flows", mode: "detail" };
    if (path === "/flow-modules/edit" || /^\/contact-flow-modules\/edit$/.test(path) || /^\/contact-flows\/modules\/edit$/.test(path)) {
      return { section: "flow-modules", mode: parsed.searchParams.get("tab") || "detail" };
    }

    if (path === "/prompts") return { section: "audio-prompts", mode: "index" };
    if (path === "/numbers") return { section: "phone-numbers", mode: hash && hash !== "#/" ? "detail" : "index" };
    if (path === "/contact-search") return { section: "contact-search", mode: "index" };
    if (/^\/contact-trace-records\/details\/[^/]+$/.test(path)) return { section: "contact-records", mode: "detail" };
    if (path === "/queues") return { section: "queues", mode: "index" };
    if (path === "/queues/edit") return { section: "queues", mode: "detail" };
    if (path === "/operating-hours") return { section: "hours-of-operation", mode: "index" };
    if (/^\/operating-hours\/[^/]+\/edit$/.test(path)) return { section: "hours-of-operation", mode: "detail" };
    if (path === "/predefined-attributes") return { section: "predefined-attributes", mode: "index" };
    if (path === "/predefined-attributes/edit") return { section: "predefined-attributes", mode: "detail" };
    if (path === "/views") return { section: "views", mode: "index" };
    if (/^\/views\/[^/]+$/.test(path)) return { section: "views", mode: "detail" };
    if (/^\/bots\/details\/[^/]+$/.test(path)) return { section: "conversational-ai", mode: "detail" };
    if (/^\/bots\/configuration\/[^/]+(?:\/.*)?$/.test(path)) return { section: "conversational-ai", mode: "configuration" };
    if (/^\/bots\/aliases\/[^/]+$/.test(path)) return { section: "conversational-ai", mode: "aliases" };
    if (/^\/bots\/versions\/[^/]+$/.test(path)) return { section: "conversational-ai", mode: "versions" };
    if (/^\/bots\/advance-configuration\/[^/]+$/.test(path)) return { section: "conversational-ai", mode: "advanced" };
    if (/^\/historical-changes\//.test(path)) return { section: "historical-changes", mode: "index" };

    return { section: "unknown", mode: "unknown" };
  }

  function inferVisibleFlowsSection() {
    if (typeof document === "undefined") return "contact-flows";
    const text = normalizeText(document.body?.innerText || "");
    if (/Conversational AI \(\d+\)|Create Conversational AI bot|Search by Conversational AI bot name/i.test(text)) return "conversational-ai";
    if (/Modules \(\d+\)|Create flow module|Flow modules are reusable/i.test(text)) return "flow-modules";
    if (/Flows \(\d+\)|Create flow|A flow defines the customer experience/i.test(text)) return "contact-flows";
    return "contact-flows";
  }

  function getPageTitle() {
    const headings = queryAllDeep("h1")
      .map((heading) => normalizeText(heading.innerText || heading.textContent))
      .filter(Boolean)
      .filter((text) => !["Amazon Connect Customer", "Workspaces"].includes(text));
    return headings[0] || normalizeText(document.title);
  }

  function allLinks() {
    return queryAllDeep("a[href]")
      .map((link) => ({
        text: normalizeText(link.innerText || link.textContent),
        href: link.href
      }))
      .filter((link) => link.href && link.href.startsWith(APP_ORIGIN));
  }

  function queryAllDeep(selector, root = document) {
    const results = [];
    const seenRoots = new Set();
    function visit(nextRoot) {
      if (!nextRoot || seenRoots.has(nextRoot)) return;
      seenRoots.add(nextRoot);
      if (nextRoot.querySelectorAll) {
        results.push(...nextRoot.querySelectorAll(selector));
        const elements = nextRoot.querySelectorAll("*");
        for (const element of elements) {
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      }
    }
    visit(root);
    return [...new Set(results)];
  }

  function inferIdFromHref(href) {
    if (!href) return "";
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (last === "edit") {
      return url.searchParams.get("id") || parts[parts.length - 2] || "";
    }
    return decodeURIComponent(last);
  }

  function inferArnFromHref(href) {
    if (!href) return "";
    const url = new URL(href);
    const id = url.searchParams.get("id") || "";
    return id.startsWith("arn:") ? id : "";
  }

  function readTables() {
    const semanticTables = queryAllDeep("table, [role='table'], [role='grid']");
    return semanticTables.map(readTableElement).filter((table) => table.rows.length);
  }

  function readTableElement(tableEl) {
    const headerCells = [
      ...tableEl.querySelectorAll("thead th, [role='columnheader']")
    ].map((cell) => normalizeText(cell.innerText || cell.textContent)).filter(Boolean);

    const rowElements = tableEl.querySelectorAll("tbody tr").length
      ? [...tableEl.querySelectorAll("tbody tr")]
      : [...tableEl.querySelectorAll("[role='row'], tr")].filter((row) => {
          return row.querySelector("[role='cell'], td");
        });

    const rows = rowElements.map((row) => {
      const cells = [...row.querySelectorAll("td, [role='cell']")];
      const values = alignTableValues(
        cells.map((cell) => normalizeText(cell.innerText || cell.textContent)),
        headerCells
      );
      const rowLinks = [...row.querySelectorAll("a[href]")].map((link) => ({
        text: normalizeText(link.innerText || link.textContent),
        href: link.href
      }));
      const object = {};
      values.forEach((value, index) => {
        const key = headerCells[index] || `column_${index + 1}`;
        object[toCamelKey(key)] = value;
      });
      const primaryLink = rowLinks.find((link) => link.text && link.href.startsWith(APP_ORIGIN)) || rowLinks[0];
      if (primaryLink) {
        object.url = primaryLink.href;
        object.id = inferIdFromHref(primaryLink.href);
        object.arn = inferArnFromHref(primaryLink.href);
      }
      return object;
    })
      .filter((row) => Object.values(row).some(Boolean))
      .filter((row) => !isEmptyStateTableRow(row));

    return {
      headers: headerCells,
      rows
    };
  }

  function isEmptyStateTableRow(row) {
    const valueText = normalizeText(Object.entries(row)
      .filter(([key]) => !["url", "id", "arn"].includes(key))
      .map(([, value]) => value)
      .join(" "));
    return /^(No results were found|No results found|There are no results|Loading .*)$/i.test(valueText);
  }

  function alignTableValues(values, headers) {
    const aligned = [...values];
    while (aligned.length > headers.length && aligned[0] === "") {
      aligned.shift();
    }
    while (aligned.length > headers.length && aligned[aligned.length - 1] === "") {
      aligned.pop();
    }
    return aligned;
  }

  function fallbackRowsFromLinks(section) {
    if (section === "phone-numbers") return phoneNumberRowsFromLinks();

    const patterns = {
      "ai-prompts": /\/q-connect\/ai-prompts\/[^/#?]+$/,
      "ai-agents": /\/q-connect\/ai-agents\/[^/#?]+$/,
      "guardrails": /\/q-connect\/guardrails\/[^/#?]+$/,
      "contact-flows": /\/contact-flows\/edit\?/,
      "flow-modules": /\/(?:flow-modules|contact-flow-modules|contact-flows\/modules)\/edit\?/,
      "conversational-ai": /\/bots\/details\/[^/#?]+$/,
      "phone-numbers": /\/numbers/,
      "queues": /\/queues\/edit\?/,
      "hours-of-operation": /\/operating-hours\/[^/]+\/edit$/,
      "views": /\/views\/[^/#?]+$/,
      "lex-bots": /\/bots\/details\/[^/#?]+$/
    };
    const pattern = patterns[section];
    if (!pattern) return [];
    const seen = new Set();
    return allLinks().filter((link) => {
      const linkUrl = new URL(link.href);
      return pattern.test(linkUrl.pathname + linkUrl.search + linkUrl.hash);
    })
      .filter((link) => {
        const key = `${link.text}|${link.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((link) => ({
        name: link.text,
        url: link.href,
        id: inferIdFromHref(link.href),
        arn: inferArnFromHref(link.href)
      }));
  }

  function phoneNumberRowsFromLinks() {
    const seen = new Set();
    return allLinks()
      .map((link) => phoneNumberRowFromHref(link.href, link.text))
      .filter((row) => row.phoneNumber || row.id || row.numberArn)
      .filter((row) => {
        const key = row.id || row.numberArn || row.phoneNumber || row.url;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function phoneNumberRowFromHref(href, linkText = "") {
    if (!href) return {};
    const url = new URL(href);
    if (url.pathname !== "/numbers") return {};
    const hashUrl = new URL(url.hash.replace(/^#/, "") || "/", url.origin);
    if (!/\/edit$/i.test(hashUrl.pathname)) return {};
    const params = hashUrl.searchParams;
    const phoneNumber = params.get("number") || normalizeText(linkText);
    const id = params.get("id") || "";
    const numberArn = params.get("numberArn") || "";
    const flowId = params.get("flowId") || "";
    return compactObject({
      name: phoneNumber,
      phoneNumber,
      description: params.get("numberDescription") || "",
      phoneType: params.get("type") || "",
      country: params.get("country") || "",
      contactFlowId: flowId,
      activeChannels: "",
      url: href,
      id,
      arn: numberArn,
      numberArn,
      sourcePhoneNumberArn: params.get("sourcePhoneNumberArn") || "",
      section: "phone-numbers"
    });
  }

  function toCamelKey(label) {
    const cleaned = normalizeText(label)
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
      .replace(/^[A-Z]/, (chr) => chr.toLowerCase());
    return cleaned || "value";
  }

  function getIndexRows(section) {
    const tables = readTables();
    const rows = tables.flatMap((table) => table.rows);
    if (rows.length) {
      return rows
        .map((row) => enrichIndexRow(row, section))
        .filter((row) => isValidIndexItem(row, section));
    }
    if (section === "contact-search") {
      const contactRows = contactSearchRowsFromText();
      if (contactRows.length) {
        return contactRows
          .map((row) => enrichIndexRow(row, section))
          .filter((row) => isValidIndexItem(row, section));
      }
      return [];
    }
    return fallbackRowsFromLinks(section)
      .map((row) => enrichIndexRow(row, section))
      .filter((row) => isValidIndexItem(row, section));
  }

  function contactSearchRowsFromText() {
    const lines = getVisibleTextLines(document.body);
    const rows = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)) continue;
      const windowLines = lines.slice(index, index + 16);
      const row = {
        contactID: line,
        id: line,
        url: buildContactTraceUrl(line)
      };
      const channel = windowLines.find((value) => /^(Voice|Chat|Task|Email)$/i.test(value));
      const status = windowLines.find((value) => /^(Completed|In progress|Failed)$/i.test(value));
      const timestamp = windowLines.find((value) => /^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value));
      const phone = windowLines.find((value) => /^\+?\d[\d\s().-]{7,}$/.test(value));
      if (channel) row.channel = channel;
      if (status) row.contactStatus = status;
      if (timestamp) row.initiationTimestamp = timestamp;
      if (phone) row.systemPhoneNumber = phone;
      rows.push(row);
    }
    return rows;
  }

  function enrichIndexRow(row, section) {
    const href = row.url || "";
    const inferredId = href ? inferIdFromHref(href) : "";
    const inferredArn = href ? inferArnFromHref(href) : "";
    const normalized = { ...row };
    normalized.name = normalized.name || normalized.column_1 || normalized.Name || "";
    if (section === "phone-numbers") {
      normalized.phoneNumber = normalized.phoneNumber || normalized.phoneNumberIvR || normalized.phoneNumberIVR || normalized.phone || normalized.name || "";
      normalized.name = normalized.name || normalized.phoneNumber;
      normalized.status = normalized.status || normalized.activeChannels || normalized.phoneType || "";
      if (!normalized.id && normalized.url) {
        const parsedPhone = phoneNumberRowFromHref(normalized.url, normalized.name);
        Object.assign(normalized, compactObject({ ...normalized, ...parsedPhone }));
      }
    }
    if (section === "contact-search") {
      const contactId = normalized.contactID || normalized.contactId || normalized.contact || normalized.name || "";
      if (contactId) {
        normalized.id = normalized.id || contactId;
        normalized.name = normalized.name || contactId;
        normalized.url = normalized.url || buildContactTraceUrl(contactId);
      }
    }
    normalized.id = normalized.id || inferredId;
    normalized.arn = normalized.arn || inferredArn;
    normalized.url = normalized.url || "";
    normalized.section = section;
    return normalized;
  }

  function buildContactTraceUrl(contactId) {
    const cleanId = normalizeText(contactId);
    if (!cleanId) return "";
    const currentUrl = new URL(window.location.href);
    const timeZone = currentUrl.searchParams.get("timeZone") || currentUrl.searchParams.get("tz") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return `${APP_ORIGIN}/contact-trace-records/details/${encodeURIComponent(cleanId)}?tz=${encodeURIComponent(timeZone)}`;
  }

  function isValidIndexItem(row, section) {
    const name = normalizeText(row.name);
    const url = normalizeText(row.url);
    const id = normalizeText(row.id);
    const status = normalizeText(row.status);
    const text = normalizeText(Object.values(row).join(" "));

    if (/Loading default AI agent configurations/i.test(text)) return false;
    if (/No results were found|No (?:AI Agents|AI Prompts|AI Guardrails|Conversational AI bots|matches|items|records)/i.test(text)) return false;
    if (["flow-modules", "conversational-ai"].includes(section)) {
      return Boolean(name || status) && !/^No\b/i.test(text);
    }
    if (section === "contact-search") {
      return Boolean(
        row.contactID
          || row.contactId
          || row.id
          || row.channel
          || row.contactStatus
          || row.initiationTimestamp
          || row.systemPhoneNumber
          || row.customerPhoneNumber
      ) && !/^No\b/i.test(text);
    }

    const sectionsWithLinks = new Set([
      "ai-prompts",
      "ai-agents",
      "guardrails",
      "contact-flows",
      "flow-modules",
      "conversational-ai",
      "phone-numbers",
      "queues",
      "hours-of-operation",
      "views",
      "lex-bots"
    ]);

    if (section === "phone-numbers") {
      return Boolean(url || id || row.phoneNumber || row.numberArn) && Boolean(name || row.phoneNumber || row.phoneType || row.country);
    }

    if (sectionsWithLinks.has(section)) {
      return Boolean(url || id) && Boolean(name || status);
    }

    return Boolean(name || url || id);
  }

  function getEmptyIndexState(section) {
    const text = normalizeText(document.body.innerText || "");
    const title = getPageTitle();
    const zeroCountPatterns = {
      "ai-prompts": /Prompts \(0\)/i,
      "ai-agents": /AI Agents \(0\)/i,
      "guardrails": /AI Guardrails \(0\)/i,
      "contact-flows": /Flows \(0\)/i,
      "flow-modules": /Modules \(0\)/i,
      "conversational-ai": /Conversational AI \(0\)|Bots \(0\)/i,
      "phone-numbers": /Phone numbers \(0\)/i,
      "contact-search": /(?:Contacts|Search results) \(0\)/i,
      "queues": /Queues \(0\)/i,
      "hours-of-operation": /Hours of operation \(0\)/i
    };
    const emptyMessage = /No results were found|No results found|No (?:matches|items|records) (?:were )?found/i.test(text);
    const zeroCount = Boolean(zeroCountPatterns[section]?.test(text) || zeroCountPatterns[section]?.test(title));
    const hasSectionSignal = sectionIndexSignal(section, text, title);

    return {
      empty: hasSectionSignal && (emptyMessage || zeroCount),
      reason: emptyMessage ? "empty-message-visible" : (zeroCount ? "zero-count-visible" : ""),
      zeroCount,
      emptyMessage
    };
  }

  function captureIndex() {
    const detected = classifyUrl();
    const items = getIndexRows(detected.section);
    const emptyState = getEmptyIndexState(detected.section);
    return wrapResult(detected, "index", {
      title: getPageTitle(),
      captureScope: "visible-page",
      pagination: readPaginationText(),
      searchContext: detected.section === "contact-search" ? readContactSearchState() : undefined,
      items,
      emptyState,
      tables: readTables().map((table) => ({ headers: table.headers, rowCount: table.rows.length }))
    });
  }

  async function captureAllIndex() {
    const detected = classifyUrl();
    const warnings = [];
    const allItems = [];
    const seen = new Set();

    await waitForIndexRows(detected.section);
    await clickPageOneIfAvailable();
    await sleep(1100);
    await waitForIndexRows(detected.section);

    const pageLimit = maxIndexPages(detected.section);
    let reachedPageLimit = false;
    for (let page = 1; page <= pageLimit; page += 1) {
      const pageItems = getIndexRows(detected.section);
      for (const item of pageItems) {
        const key = item.url || item.id || item.arn || `${item.name}|${item.status}|${item.lastUpdated}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allItems.push({ ...item, capturedPage: page });
      }

      const moved = await clickNextPageIfAvailable();
      if (!moved) break;
      if (page === pageLimit) reachedPageLimit = true;
      await waitForIndexChange(pageItems);
    }

    await clickPageOneIfAvailable();
    await sleep(650);

    const emptyState = getEmptyIndexState(detected.section);
    if (allItems.length === 0 && !emptyState.empty) warnings.push("No rows captured from paginated index.");
    if (reachedPageLimit) warnings.push(`Reached page limit (${pageLimit}) before pagination stopped.`);

    return wrapResult(detected, "index-all", {
      title: getPageTitle(),
      captureScope: "all-pages",
      pagination: readPaginationText(),
      searchContext: detected.section === "contact-search" ? readContactSearchState() : undefined,
      items: allItems,
      emptyState,
      tables: readTables().map((table) => ({ headers: table.headers, rowCount: table.rows.length })),
      warnings
    });
  }

  function maxIndexPages(section) {
    if (section === "contact-search") return 250;
    return 25;
  }

  async function waitForIndexRows(section) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 9000) {
      const rows = getIndexRows(section);
      if (rows.length > 0) return rows;
      if (getEmptyIndexState(section).empty) return rows;
      await sleep(350);
    }
    return [];
  }

  async function exportFlowJson() {
    const detected = classifyUrl();
    if (detected.section !== "contact-flows" || detected.mode !== "detail") {
      throw new Error("Open a contact flow detail/designer page before exporting Flow JSON.");
    }

    if (document.body.innerText.includes("Unsaved Changes")) {
      throw new Error("Unsaved Changes modal detected. Cancel or resolve it before exporting.");
    }

    const flowName = getPageTitle();
    const flowActions = findButtonByText(/^Flow actions$/i);
    if (!flowActions) {
      throw new Error("Could not find the Flow actions button.");
    }

    flowActions.click();
    await sleep(500);

    const jsonItem = findMenuItemByText(/^JSON$/i) || findMenuItemByText(/Export.*JSON|JSON.*Export/i);
    if (!jsonItem) {
      const exportItem = findMenuItemByText(/^Export(?: \(beta\))?$/i);
      if (!exportItem) {
        throw new Error("Could not find Export > JSON in the Flow actions menu.");
      }
      exportItem.click();
      await sleep(500);
    }

    const jsonItemAfterExport = findMenuItemByText(/^JSON$/i) || findMenuItemByText(/Export.*JSON|JSON.*Export/i);
    if (!jsonItemAfterExport) {
      throw new Error("Could not find JSON export option.");
    }
    jsonItemAfterExport.click();
    await sleep(800);

    const exportButton = findButtonByText(/^Export$/i);
    if (exportButton && !isDisabled(exportButton)) {
      exportButton.click();
      await sleep(500);
    }

    return wrapResult(detected, "flow-json-export-clicked", {
      title: flowName,
      flow: readFlowDetail(),
      note: "Triggered the official Amazon Connect JSON export. Check Chrome downloads. Import the downloaded JSON to build the runtime map."
    });
  }

  async function exportContactSearchCsv() {
    const detected = classifyUrl();
    if (detected.section !== "contact-search") {
      throw new Error("Open Contact search before exporting CSV.");
    }

    const buttons = queryAllDeep("button, [role='button']");
    const csvButton = buttons.find((button) => {
      const text = normalizeText(button.innerText || button.textContent);
      const aria = normalizeText(button.getAttribute("aria-label") || "");
      const testId = normalizeText(button.getAttribute("data-testid") || "");
      return /Download CSV/i.test(`${text} ${aria} ${testId}`) || /download-csv/i.test(testId);
    });
    if (!csvButton) {
      throw new Error("Could not find the Contact search Download CSV button.");
    }

    csvButton.click();
    await sleep(500);
    return wrapResult(detected, "contact-search-csv-export-clicked", {
      title: getPageTitle(),
      captureScope: "native-csv-download",
      searchContext: readContactSearchState(),
      note: "Clicked the native Amazon Connect Download CSV button. Check Chrome downloads for the CSV."
    });
  }

  function findButtonByText(pattern) {
    return queryAllDeep("button, [role='button']").find((button) => {
      const text = normalizeText(button.innerText || button.textContent || button.getAttribute("aria-label"));
      return pattern.test(text);
    });
  }

  function findMenuItemByText(pattern) {
    return queryAllDeep("[role='menuitem'], [role='option'], li, button, a")
      .find((element) => {
        const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
        return pattern.test(text);
      });
  }

  async function clickPageOneIfAvailable() {
    const buttons = queryAllDeep("button, [role='button']");
    const pageOne = buttons.find((button) => {
      const text = normalizeText(button.innerText || button.textContent);
      const aria = normalizeText(button.getAttribute("aria-label"));
      return aria === "Go to page 1" || text === "1";
    });
    if (!pageOne || isDisabled(pageOne)) return false;
    pageOne.click();
    return true;
  }

  async function clickNextPageIfAvailable() {
    const buttons = queryAllDeep("button, [role='button']");
    const next = buttons.find((button) => {
      const text = normalizeText(button.innerText || button.textContent);
      const aria = normalizeText(button.getAttribute("aria-label"));
      return /^Next page$/i.test(aria) || /^Next$/i.test(text);
    });
    if (!next || isDisabled(next)) return false;
    next.click();
    return true;
  }

  function isDisabled(element) {
    return element.disabled
      || element.getAttribute("aria-disabled") === "true"
      || String(element.className || "").includes("disabled")
      || element.closest("[aria-disabled='true']");
  }

  async function waitForIndexChange(previousItems) {
    const previousKey = previousItems.map((item) => item.url || item.name).join("|");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      await sleep(350);
      const nextKey = getIndexRows(classifyUrl().section).map((item) => item.url || item.name).join("|");
      if (nextKey && nextKey !== previousKey) return true;
    }
    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readPaginationText() {
    const body = normalizeText(document.body.innerText);
    const range = body.match(/\b\d+\s*[-/]\s*\d+\s+of\s+\d+\b/i);
    const simple = body.match(/\bDisplaying items\s+\d+\s+to\s+\d+\s+of\b/i);
    return normalizeText(range?.[0] || simple?.[0] || "");
  }

  async function captureDetail() {
    const detected = classifyUrl();
    await waitForDetailRender(detected);
    const overview = readOverview(detected);
    const tables = readTables();
    const text = normalizeText(document.body.innerText);
    const versions = await findAllVersions();
    const detail = {
      title: getPageTitle(),
      overview,
      controls: readControlInventory(),
      tables: tables.map((table) => ({ headers: table.headers, rows: table.rows })),
      versions,
      tags: readTags(),
      links: allLinks().slice(0, 200)
    };
    const accessDenied = readAccessDeniedState();
    if (accessDenied.denied) {
      detail.accessDenied = accessDenied;
    }

    if (detected.section === "ai-prompts") {
      detail.prompt = readPromptText();
    }
    if (detected.section === "guardrails") {
      detail.guardrail = readGuardrailSections(text, tables);
    }
    if (detected.section === "ai-agents") {
      detail.agent = readAgentSections(text, tables, detail.links);
    }
    if (["contact-flows", "flow-modules"].includes(detected.section)) {
      detail.flow = readFlowDetail();
    }
    if (detected.section === "conversational-ai") {
      detail.conversationalAi = readConversationalAiSections(text, tables, detected);
    }
    if (detected.section === "contact-records") {
      detail.contactRecord = readContactTraceSections(text, tables);
    }

    detail.warnings = validateDetailCapture(detected, detail);

    return wrapResult(detected, "detail", detail);
  }

  async function captureNetworkTranscript(options = {}) {
    const detected = classifyUrl();
    const contactId = normalizeText(options.contactId || contactIdFromCurrentUrl());
    if (!contactId) throw new Error("No contact ID found for transcript capture.");
    const matchingNetworkCaptures = networkTranscriptCaptures.filter((capture) => capture.body?.ContactId === contactId);
    const directCapture = matchingNetworkCaptures[0] ? null : await fetchContactTranscriptDirectly(contactId).catch((error) => ({
      capturedAt: nowIso(),
      url: "",
      status: 0,
      method: "direct-fetch",
      error: error.message || String(error),
      body: null
    }));
    const detailCapture = await fetchContactDetailsDirectly(contactId).catch((error) => ({
      capturedAt: nowIso(),
      url: "",
      status: 0,
      method: "direct-fetch-details",
      error: error.message || String(error),
      body: null
    }));
    const captures = directCapture?.body
      ? [directCapture, ...matchingNetworkCaptures]
      : matchingNetworkCaptures;
    const latest = captures[0] || null;
    return wrapResult(
      { section: "contact-records", mode: "network-transcript", pageMode: detected.mode },
      "network-transcript",
      {
        title: options.contactId ? `Contact ${contactId}` : getPageTitle(),
        captureScope: options.contactId ? "direct-network-by-contact-id" : "network",
        requestedContactId: contactId,
        networkCaptureCount: captures.length,
        networkCaptures: captures.map((capture) => ({
          capturedAt: capture.capturedAt,
          url: capture.url,
          status: capture.status,
          method: capture.method,
          contactId: capture.body?.ContactId || "",
          error: capture.error || ""
        })),
        transcript: latest?.body || null,
        contactDetails: detailCapture?.body || null,
        directFetchError: directCapture?.error || "",
        contactDetailsFetchError: detailCapture?.error || "",
        note: latest
          ? "Captured contact transcript JSON from page network activity or direct transcript endpoint."
          : "No contact transcript JSON has been observed yet. Reload the contact detail page with the extension active."
      }
    );
  }

  async function fetchContactTranscriptDirectly(contactId = contactIdFromCurrentUrl()) {
    if (!contactId) throw new Error("No contact ID found for direct transcript fetch.");
    const candidates = [
      `${APP_ORIGIN}/ctr/api/contact/details/${encodeURIComponent(contactId)}/transcript`,
      `${APP_ORIGIN}/ctr/api/contact/details/${encodeURIComponent(contactId)}/avi/transcript`,
      `${APP_ORIGIN}/ctrl/api/contact/details/${encodeURIComponent(contactId)}/avi/transcript`,
      `${APP_ORIGIN}/ctrl/api/contact/details/${encodeURIComponent(contactId)}/transcript`,
      `${APP_ORIGIN}/ctrl/api/contact/details/${encodeURIComponent(contactId)}/chat/transcript`,
      `${APP_ORIGIN}/ctrl/api/contact/details/${encodeURIComponent(contactId)}/voice/transcript`,
      `${APP_ORIGIN}/api/contact/details/${encodeURIComponent(contactId)}/transcript`
    ];

    const errors = [];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        });
        const text = await response.text();
        if (!response.ok) {
          errors.push(`${url}: HTTP ${response.status}`);
          continue;
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch (error) {
          errors.push(`${url}: non-json response`);
          continue;
        }
        const normalizedBody = normalizeTranscriptResponse(body, contactId);
        if (!isContactTranscriptJson(normalizedBody)) {
          errors.push(`${url}: response did not look like contact transcript JSON`);
          continue;
        }
        const capture = {
          capturedAt: nowIso(),
          url,
          status: response.status,
          method: "direct-fetch",
          body: normalizedBody
        };
        networkTranscriptCaptures.unshift(capture);
        networkTranscriptCaptures.splice(NETWORK_CAPTURE_LIMIT);
        return capture;
      } catch (error) {
        errors.push(`${url}: ${error.message || String(error)}`);
      }
    }
    throw new Error(`Could not fetch transcript directly. ${errors.join(" | ")}`);
  }

  async function fetchContactDetailsDirectly(contactId = contactIdFromCurrentUrl()) {
    if (!contactId) throw new Error("No contact ID found for direct contact details fetch.");
    const url = `${APP_ORIGIN}/ctr/api/ctr-details/${encodeURIComponent(contactId)}`;
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`${url}: non-json response`);
    }
    return {
      capturedAt: nowIso(),
      url,
      status: response.status,
      method: "direct-fetch-details",
      body
    };
  }

  function normalizeTranscriptResponse(body, contactId) {
    if (isContactTranscriptJson(body)) return body;
    if (Array.isArray(body)) {
      return {
        ContactId: contactId,
        InteractionLogs: body
      };
    }
    if (Array.isArray(body?.transcript)) {
      return {
        ContactId: body.ContactId || body.contactId || contactId,
        InteractionLogs: body.transcript,
        Analysis: body.Analysis || body.analysis || {}
      };
    }
    if (Array.isArray(body?.InteractionLogs)) return body;
    if (body?.LogData && (body.AbsoluteTime || body.EventType || body.LogType)) {
      return {
        ContactId: body.ContactId || contactId,
        InteractionLogs: [body]
      };
    }
    return body;
  }

  function contactIdFromCurrentUrl() {
    const url = new URL(window.location.href);
    const parts = url.pathname.split("/").filter(Boolean);
    const detailIndex = parts.findIndex((part) => part === "details");
    if (detailIndex >= 0 && parts[detailIndex + 1]) return decodeURIComponent(parts[detailIndex + 1]);
    return "";
  }

  async function waitForDetailRender(detected) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 6000) {
      const title = getPageTitle();
      const text = document.body.innerText || "";
      if (detected.section === "ai-prompts" && (readPromptFromEditableSurface() || readPromptFromLineText())) return true;
      if (detected.section === "guardrails" && text.includes("Content filters")) return true;
      if (detected.section === "ai-agents" && (text.includes("Overview") || text.includes("Security Profiles"))) {
        if (!/Loading (?:Security Profiles|AI Prompts|AI Guardrails)|Checking permissions/i.test(text)) return true;
      }
      if (["contact-flows", "flow-modules"].includes(detected.section) && (text.includes("Flow actions") || text.includes("About this flow") || text.includes("About this module") || text.includes("ARN"))) return true;
      if (detected.section === "conversational-ai" && /Conversational AI bot ARN|Define your Conversational AI bot|Aliases \(\d+\)|Versions \(\d+\)|Intent|Bot|ARN/i.test(text)) return true;
      if (detected.section === "contact-records" && /Contact details|Contact ID|Trace details|Flow|Attributes|Summary/i.test(text)) return true;
      if (!/^Customer -|^Amazon Connect Customer$/i.test(title)) return true;
      await sleep(350);
    }
    return false;
  }

  function readOverview(detected = classifyUrl()) {
    if (detected.section === "queues") return readQueueOverview();
    if (detected.section === "hours-of-operation") return readHoursOverview();
    if (detected.section === "phone-numbers") return readPhoneNumberOverview();
    if (detected.section === "contact-records") return readContactTraceOverview();
    if (["contact-flows", "flow-modules"].includes(detected.section)) return readFlowOverview();
    if (detected.section === "conversational-ai") return readConversationalAiOverview();
    return readStructuredOverview();
  }

  function readStructuredOverview() {
    const labels = [
      "Name",
      "Description",
      "Last modified",
      "Last updated",
      "Assistant ID",
      "Assistant ARN",
      "AI Prompt ID",
      "AI Prompt ARN",
      "AI Guardrail ID",
      "AI Guardrail ARN",
      "AI Agent ID",
      "AI Agent ARN",
      "Status",
      "Type",
      "Origin",
      "Locale",
      "Model ID",
      "ARN",
      "Timezone"
    ];
    const lines = getOverviewLines();
    const overview = {};

    for (const label of labels) {
      const value = valueAfterLabelLine(lines, label, labels);
      if (value) overview[toCamelKey(label)] = value;
    }

    overview.idFromUrl = inferIdFromCurrentUrl();
    overview.arnFromUrl = inferArnFromCurrentUrl();
    return compactObject(overview);
  }

  function readPhoneNumberOverview() {
    const url = new URL(window.location.href);
    const hashUrl = new URL(url.hash.replace(/^#/, "") || "/", url.origin);
    const params = hashUrl.searchParams;
    const lines = getVisibleTextLines(document.body);
    const phoneNumber = params.get("number") || valueAfterFirstMatchingLabel(lines, /^Phone number$/i);
    const flowId = params.get("flowId") || "";
    return compactObject({
      phoneNumber,
      description: params.get("numberDescription") || readControlValueByLabel(/^Description$/i) || valueAfterFirstMatchingLabel(lines, /^Description$/i),
      phoneType: params.get("type") || valueAfterFirstMatchingLabel(lines, /^Phone type$/i),
      country: params.get("country") || valueAfterFirstMatchingLabel(lines, /^Country$/i),
      activeChannels: valueAfterFirstMatchingLabel(lines, /^Active channels$/i),
      contactFlow: readControlValueByLabel(/^(Contact flow|Contact flow\/IVR)$/i) || valueAfterFirstMatchingLabel(lines, /^(Contact flow|Contact flow\/IVR)$/i),
      flowId,
      idFromUrl: params.get("id") || inferIdFromCurrentUrl(),
      numberArn: params.get("numberArn") || firstLineMatching(lines, /^arn:aws:connect:.*phone-number\//),
      sourcePhoneNumberArn: params.get("sourcePhoneNumberArn") || "",
      hashRoute: hashUrl.pathname
    });
  }

  function readContactSearchState() {
    const url = new URL(window.location.href);
    const params = Object.fromEntries(url.searchParams.entries());
    const lines = getVisibleTextLines(document.body);
    return compactObject({
      savedSearchName: findSavedSearchName(lines),
      query: compactObject(params),
      type: params.type,
      timestampType: params.timestampType,
      timeZone: params.timeZone,
      relativePeriod: params.relativePeriod,
      relativeAmount: params.relativeAmount,
      relativeUnit: params.relativeUnit,
      relativeStartTime: params.relativeStartTime,
      completedFilter: params.completedFilter,
      inProgressFilter: params.inProgressFilter
    });
  }

  function readContactTraceOverview() {
    const url = new URL(window.location.href);
    const lines = getVisibleTextLines(document.body);
    const labels = [
      "Contact ID",
      "Initial contact ID",
      "Previous contact ID",
      "Channel",
      "Contact status",
      "Initiation timestamp",
      "Disconnect timestamp",
      "Contact duration",
      "System phone number",
      "Customer phone number",
      "Queue",
      "Agent",
      "Disconnect reason"
    ];
    const overview = {
      contactId: inferIdFromCurrentUrl(),
      timeZone: url.searchParams.get("tz") || url.searchParams.get("timeZone") || "",
      title: getPageTitle()
    };
    for (const label of labels) {
      const value = valueAfterLabelLine(lines, label, labels);
      if (value) overview[toCamelKey(label)] = value;
    }
    return compactObject(overview);
  }

  function findSavedSearchName(lines) {
    const explicit = valueAfterFirstMatchingLabel(lines, /^(Saved search|Search name)$/i, {
      reject: /Save search|Manage saved searches|Search name/i
    });
    if (explicit) return explicit;
    const candidates = lines.filter((line) => /^september$/i.test(line));
    return candidates[0] || "";
  }

  function getOverviewLines() {
    return getSectionLines("Overview", [
      "Content filters",
      "Prompt",
      "Security Profiles",
      "Tools",
      "Prompts",
      "Guardrails",
      "Tags",
      "Versions",
      "About this flow",
      "Denied topics",
      "Word filters",
      "Sensitive information filters",
      "Contextual grounding check",
      "Blocked messaging"
    ], (windowLines) => windowLines.includes("Name") || windowLines.includes("Status"));
  }

  function getSectionLines(startLabel, boundaryLabels, predicate = null) {
    const lines = getVisibleTextLines(document.body);
    const startIndexes = [];
    lines.forEach((line, index) => {
      if (line === startLabel || line.startsWith(`${startLabel} (`)) startIndexes.push(index);
    });

    const selectedStart = startIndexes.find((index) => {
      if (!predicate) return true;
      return predicate(lines.slice(index + 1, index + 35));
    }) ?? startIndexes[0];

    if (selectedStart === undefined) return [];

    let endIndex = lines.length;
    for (let index = selectedStart + 1; index < lines.length; index += 1) {
      if (isBoundaryLine(lines[index], boundaryLabels)) {
        endIndex = index;
        break;
      }
    }

    return lines.slice(selectedStart + 1, endIndex);
  }

  function isBoundaryLine(line, boundaryLabels) {
    return boundaryLabels.some((label) => line === label || line.startsWith(`${label} (`) || line.startsWith(`${label} -`));
  }

  function getVisibleTextLines(root) {
    return String(root?.innerText || root?.textContent || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
  }

  function valueAfterLabelLine(lines, label, allLabels = []) {
    const index = lines.findIndex((line) => line === label);
    if (index < 0) return "";

    const valueLines = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (allLabels.includes(line)) break;
      if (isLikelyHelperText(line)) continue;
      valueLines.push(line);
    }

    return normalizeFieldValue(valueLines.join(" "));
  }

  function normalizeFieldValue(value) {
    const normalized = normalizeText(value)
      .replace(/\bCopied\b/gi, "")
      .replace(/\bCopy\b/gi, "")
      .trim();
    return normalized.length > LONG_FIELD_LIMIT ? normalized.slice(0, LONG_FIELD_LIMIT) : normalized;
  }

  function isLikelyHelperText(value) {
    return /^(?:Character count:|Name must be|Description must be|Learn more$|optional$|Maximum \d+ characters|Valid characters:|Enter description$|Describe the purpose|The message the Conversational AI bot will play|Provide messages to acknowledge)/i.test(normalizeText(value));
  }

  function readQueueOverview() {
    const lines = getVisibleTextLines(document.body);
    return compactObject({
      name: readControlValueByLabel(/^Name$/i)
        || valueAfterFirstMatchingLabel(lines, /^Name$/i, { reject: /must be|Character count|Description/i }),
      description: readControlValueByLabel(/^Description\b/i)
        || valueAfterFirstMatchingLabel(lines, /^Description\b/i, { reject: /must be|Character count|optional$/i }),
      status: findChoiceAfterLabel(lines, "Status", ["Enabled", "Disabled"]),
      hoursOfOperation: readControlValueByLabel(/^Hours of operation$/i)
        || valueAfterFirstMatchingLabel(lines, /^Hours of operation$/i, {
        afterText: "Set the hours of operation and timezone for a queue.",
        reject: /Learn more|Set the hours|Hours of operation$/i
      }),
      arn: firstLineMatching(lines, /^arn:aws:connect:/),
      idFromUrl: inferIdFromCurrentUrl(),
      arnFromUrl: inferArnFromCurrentUrl()
    });
  }

  function readHoursOverview() {
    const lines = getVisibleTextLines(document.body);
    return compactObject({
      name: readControlValueByLabel(/^Name$/i)
        || valueAfterFirstMatchingLabel(lines, /^Name$/i, { reject: /Character count/i }),
      description: readControlValueByLabel(/^Description$/i)
        || valueAfterFirstMatchingLabel(lines, /^Description$/i, { reject: /Character count/i }),
      timeZone: readControlValueByLabel(/^Time zone$/i)
        || valueAfterFirstMatchingLabel(lines, /^Time zone$/i),
      arn: firstLineMatching(lines, /^arn:aws:connect:/),
      operationalHours: readOperationalHours(lines),
      idFromUrl: inferIdFromCurrentUrl(),
      arnFromUrl: inferArnFromCurrentUrl()
    });
  }

  function readFlowOverview() {
    const detected = classifyUrl();
    const aboutLines = getSectionLines("About this flow", ["Tags"], (windowLines) => windowLines.includes("Name"));
    const moduleLines = aboutLines.length
      ? []
      : getSectionLines("About this module", ["Tags"], (windowLines) => windowLines.includes("Name"));
    const lines = aboutLines.length ? aboutLines : (moduleLines.length ? moduleLines : getVisibleTextLines(document.body));
    const canReadDescription = detected.section !== "flow-modules" || ["detail", "details"].includes(detected.mode);
    const description = canReadDescription
      ? (readControlValueByLabel(/^Description$/i) || valueAfterFirstMatchingLabel(lines, /^Description$/i))
      : "";
    const controlName = readControlValueByLabel(/^Name$/i) || valueAfterFirstMatchingLabel(lines, /^Name$/i);
    const pageTitle = getPageTitle();
    const name = controlName && controlName !== description ? controlName : pageTitle;
    return compactObject({
      name,
      description,
      type: valueAfterFirstMatchingLabel(lines, /^Type$/i),
      arn: firstLineMatching(lines, /^arn:aws:connect:/) || inferArnFromCurrentUrl(),
      idFromUrl: inferIdFromCurrentUrl(),
      arnFromUrl: inferArnFromCurrentUrl()
    });
  }

  function valueAfterFirstMatchingLabel(lines, labelPattern, options = {}) {
    const startIndex = options.afterText
      ? lines.findIndex((line) => line === options.afterText)
      : -1;
    const searchStart = startIndex >= 0 ? startIndex + 1 : 0;
    const index = lines.findIndex((line, lineIndex) => lineIndex >= searchStart && labelPattern.test(line));
    if (index < 0) return "";

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line || options.reject?.test(line) || isLikelyHelperText(line)) continue;
      if (/^(Name|Description|Status|ARN|Settings|Operational hours|Overrides|Tags|Type|Time zone)$/i.test(line)) break;
      return normalizeFieldValue(line);
    }

    return "";
  }

  function findChoiceAfterLabel(lines, label, choices) {
    const index = lines.findIndex((line) => line === label);
    if (index < 0) return "";
    const choiceSet = new Set(choices);
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      if (choiceSet.has(lines[cursor])) return lines[cursor];
    }
    return "";
  }

  function firstLineMatching(lines, pattern) {
    return lines.find((line) => pattern.test(line)) || "";
  }

  function readControlValueByLabel(labelPattern) {
    const root = getMainContentRoot();
    const labels = [...root.querySelectorAll("label, span, div, p, strong, b")]
      .filter((element) => {
        const text = normalizeText(element.innerText || element.textContent);
        return text && text.length < 80 && labelPattern.test(text);
      });

    for (const label of labels) {
      const value = readAssociatedControlValue(label);
      if (isUsefulControlValue(value)) return value;
    }

    return "";
  }

  function getMainContentRoot() {
    return document.querySelector("main, [role='main']") || document.body;
  }

  function readAssociatedControlValue(label) {
    const controls = [];

    if (label.tagName === "LABEL" && label.control) controls.push(label.control);
    if (label.id) {
      controls.push(...document.querySelectorAll(`[aria-labelledby~="${cssEscape(label.id)}"]`));
    }
    const forId = label.getAttribute("for");
    if (forId) {
      const direct = document.getElementById(forId);
      if (direct) controls.push(direct);
    }

    const directContainer = label.closest("label, [class*='form'], [class*='field'], [class*='control'], [class*='awsui']") || label.parentElement;
    if (directContainer) controls.push(...findControlsInScope(directContainer, label));

    let scope = label.parentElement;
    for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
      controls.push(...findControlsInScope(scope, label));
    }

    for (const control of uniqueElements(controls)) {
      const value = readControlValue(control);
      if (isUsefulControlValue(value)) return value;
    }

    return "";
  }

  function findControlsInScope(scope, label) {
    const controls = [...scope.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='combobox'], button[aria-haspopup='listbox'], button[aria-expanded]")]
      .filter((control) => control !== label && !isDisabled(control));
    return controls;
  }

  function readControlValue(control) {
    if (!control) return "";
    const tag = control.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return normalizeFieldValue(control.value || control.getAttribute("value") || "");
    }
    if (control.getAttribute("contenteditable") === "true") {
      return normalizeFieldValue(control.innerText || control.textContent || "");
    }
    return normalizeFieldValue(control.innerText || control.textContent || control.getAttribute("aria-label") || "");
  }

  function isUsefulControlValue(value) {
    const normalized = normalizeText(value);
    if (!normalized || isLikelyHelperText(normalized)) return false;
    if (/^(?:Search|Search for|Select|Cancel|Save|Create|Add|Edit|Delete|Learn more)$/i.test(normalized)) return false;
    if (/^(?:Name|Description|Status|ARN|Type|Time zone|Hours of operation)$/i.test(normalized)) return false;
    if (/must be between|Character count|optional$/i.test(normalized)) return false;
    return true;
  }

  function readControlInventory() {
    const root = getMainContentRoot();
    const inventory = {
      sliders: [],
      toggles: [],
      checkboxes: [],
      radios: [],
      comboboxes: [],
      tabs: []
    };

    const sliders = [...root.querySelectorAll("input[type='range'], [role='slider']")]
      .filter(isConfigurationSlider)
      .map(readSliderControl);
    const toggles = [...root.querySelectorAll("button[role='switch'], [role='switch'], input[type='checkbox'][role='switch']")].map((control) => readBooleanControl(control, "toggle"));
    const checkboxes = [...root.querySelectorAll("input[type='checkbox']:not([role='switch']), [role='checkbox']")].map((control) => readBooleanControl(control, "checkbox"));
    const radios = [...root.querySelectorAll("input[type='radio'], [role='radio']")].map(readRadioControl);
    const comboboxes = [...root.querySelectorAll("select, [role='combobox'], button[aria-haspopup='listbox'], button[aria-expanded][aria-controls]")].map(readComboboxControl);
    const tabs = [...root.querySelectorAll("[role='tab']")].map(readTabControl);

    inventory.sliders = compactControlList(sliders);
    inventory.toggles = compactControlList(toggles);
    inventory.checkboxes = compactControlList(checkboxes);
    inventory.radios = compactControlList(radios);
    inventory.comboboxes = compactControlList(comboboxes);
    inventory.tabs = compactControlList(tabs);

    return compactObject(inventory);
  }

  function isConfigurationSlider(control) {
    if (control.matches("input[type='range']")) return true;
    const min = Number(control.getAttribute("aria-valuemin") || control.getAttribute("min") || 0);
    const max = Number(control.getAttribute("aria-valuemax") || control.getAttribute("max") || 0);
    if (Number.isFinite(max) && max > 1000) return false;
    if (Number.isFinite(min) && min >= 100) return false;
    return Boolean(control.getAttribute("aria-valuenow") || control.getAttribute("aria-valuetext"));
  }

  function readSliderControl(control) {
    return compactObject({
      label: controlLabel(control),
      name: controlName(control),
      value: controlValueAttribute(control, ["aria-valuenow", "aria-valuetext", "value"]),
      min: control.getAttribute("min") || control.getAttribute("aria-valuemin") || "",
      max: control.getAttribute("max") || control.getAttribute("aria-valuemax") || "",
      step: control.getAttribute("step") || "",
      disabled: isDisabled(control),
      source: controlSource(control)
    });
  }

  function readBooleanControl(control, type) {
    return compactObject({
      label: controlLabel(control),
      name: controlName(control),
      checked: controlCheckedState(control),
      value: readControlValue(control),
      disabled: isDisabled(control),
      source: type
    });
  }

  function readRadioControl(control) {
    return compactObject({
      label: controlLabel(control),
      name: controlName(control),
      checked: controlCheckedState(control),
      value: readControlValue(control) || control.getAttribute("value") || control.getAttribute("aria-label") || "",
      disabled: isDisabled(control),
      source: controlSource(control)
    });
  }

  function readComboboxControl(control) {
    return compactObject({
      label: controlLabel(control),
      name: controlName(control),
      value: readControlValue(control),
      expanded: control.getAttribute("aria-expanded") || "",
      disabled: isDisabled(control),
      source: controlSource(control)
    });
  }

  function readTabControl(control) {
    return compactObject({
      label: controlLabel(control) || readControlValue(control),
      selected: control.getAttribute("aria-selected") || "",
      disabled: isDisabled(control),
      source: "tab"
    });
  }

  function compactControlList(items) {
    const seen = new Set();
    return items
      .map((item) => compactObject(item))
      .filter((item) => Object.keys(item).some((key) => !["source"].includes(key)))
      .filter((item) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 200);
  }

  function controlValueAttribute(control, attributes) {
    for (const attribute of attributes) {
      const value = attribute === "value" ? control.value : control.getAttribute(attribute);
      if (value !== undefined && value !== null && value !== "") return normalizeFieldValue(value);
    }
    return "";
  }

  function controlCheckedState(control) {
    if ("checked" in control) return Boolean(control.checked);
    const ariaChecked = control.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;
    return "";
  }

  function controlName(control) {
    const name = normalizeText(control.getAttribute("name") || control.getAttribute("id") || control.getAttribute("data-testid") || "");
    return isGeneratedControlToken(name) ? "" : name;
  }

  function controlSource(control) {
    const role = control.getAttribute("role");
    if (role) return role;
    const type = control.getAttribute("type");
    return type ? `${control.tagName.toLowerCase()}[type=${type}]` : control.tagName.toLowerCase();
  }

  function controlLabel(control) {
    const direct = normalizeText(control.getAttribute("aria-label") || control.getAttribute("title") || "");
    if (direct) return direct;

    const labelledBy = control.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map((id) => normalizeText(document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || ""))
        .filter(Boolean)
        .join(" ");
      if (text) return truncateControlLabel(text);
    }

    if (control.id) {
      const label = document.querySelector(`label[for="${cssEscape(control.id)}"]`);
      const text = normalizeText(label?.innerText || label?.textContent || "");
      if (text) return truncateControlLabel(text);
    }

    const closestLabel = control.closest("label");
    const closestLabelText = normalizeText(closestLabel?.innerText || closestLabel?.textContent || "");
    if (closestLabelText) return truncateControlLabel(closestLabelText);

    return truncateControlLabel(nearbyControlLabel(control));
  }

  function nearbyControlLabel(control) {
    let element = control.parentElement;
    for (let depth = 0; element && depth < 4; depth += 1, element = element.parentElement) {
      const candidates = [...element.querySelectorAll("label, legend, strong, b, span, div")]
        .filter((candidate) => candidate !== control && !candidate.contains(control))
        .map((candidate) => normalizeText(candidate.innerText || candidate.textContent))
        .filter((text) => text && text.length <= 120)
        .filter((text) => !/^(Info|Edit|Cancel|Save|Create|Add|Delete|Search)$/i.test(text));
      if (candidates.length) return candidates[0];
    }
    return "";
  }

  function truncateControlLabel(label) {
    const normalized = normalizeText(label);
    if (isGeneratedControlToken(normalized) || isTechnicalControlLabel(normalized)) return "";
    return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
  }

  function isGeneratedControlToken(value) {
    return /^(?:trigger|input):r[a-z0-9]+:$|^(?:trigger|input|formField|awsui-radio)?[:\w-]*\d{2,}(?:-\d+){1,}|^:r[a-z0-9]+:$/i.test(normalizeText(value));
  }

  function isTechnicalControlLabel(value) {
    return /^(Show path|Query actions for first tab|Undo History|List of Notes|Flow display settings|Block Library|Create|Edit|Cancel|Save|Delete)$/i.test(normalizeText(value));
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function readOperationalHours(lines) {
    const start = lines.findIndex((line) => line === "Operational hours");
    if (start < 0) return [];
    const end = lines.findIndex((line, index) => index > start && /^Overrides(?: \(\d+\))?$/.test(line));
    const scoped = lines.slice(start, end > start ? end : start + 80);
    const day = readControlValueByLabel(/^Day$/i) || valueAfterFirstMatchingLabel(scoped, /^Day$/i);
    const startTime = readControlValueByLabel(/^Start time$/i) || valueAfterFirstMatchingLabel(scoped, /^Start time$/i);
    const endTime = readControlValueByLabel(/^End time$/i) || valueAfterFirstMatchingLabel(scoped, /^End time$/i);
    const periods = scoped.filter((line) => /^(?:AM|PM)$/i.test(line));
    const row = compactObject({
      day,
      startTime,
      startPeriod: periods[0] || "",
      endTime,
      endPeriod: periods[1] || ""
    });
    return Object.keys(row).length ? [row] : [];
  }

  function getOverviewText() {
    const text = document.body.innerText || "";
    const overviewIndex = text.indexOf("Overview");
    if (overviewIndex < 0) return text;

    const boundaryLabels = [
      "Content filters",
      "Prompt",
      "Security Profiles",
      "Tools",
      "Prompts",
      "Guardrails",
      "Tags",
      "Versions",
      "About this flow",
      "Denied topics",
      "Word filters",
      "Sensitive information filters",
      "Contextual grounding check",
      "Blocked messaging"
    ];

    const starts = boundaryLabels
      .map((label) => text.indexOf(label, overviewIndex + "Overview".length))
      .filter((index) => index > overviewIndex);
    const endIndex = starts.length ? Math.min(...starts) : text.length;
    return text.slice(overviewIndex + "Overview".length, endIndex);
  }

  function extractValueAfterLabel(text, label, nextLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`${escaped}\\s+([\\s\\S]{1,600}?)(?=\\s+(?:${next})\\s+|\\n\\s*(?:${next})\\s+|$)`, "i");
    const match = text.match(pattern);
    const value = normalizeText(match?.[1] || "");
    return value.length > LONG_FIELD_LIMIT ? value.slice(0, LONG_FIELD_LIMIT) : value;
  }

  function inferIdFromCurrentUrl() {
    const url = new URL(window.location.href);
    if (url.searchParams.get("id")) return url.searchParams.get("id");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "bots" && parts[1]) return decodeURIComponent(parts[2] || parts[1]);
    const last = parts[parts.length - 1] || "";
    if (last === "edit") return decodeURIComponent(parts[parts.length - 2] || "");
    return decodeURIComponent(last);
  }

  function inferArnFromCurrentUrl() {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id") || "";
    return id.startsWith("arn:") ? id : "";
  }

  function findVisibleVersions() {
    const text = document.body.innerText || "";
    const versionPattern = /\b(?:V|Version )\d+:\s*[^,\n]+?:\s*(?:Published|Saved as draft|Draft)|\bVersion\s+\d+\s+(?:Published|Saved as draft|Draft)\s+[\d/]+[^,\n]*|Latest:\s*(?:Draft|Published)/gi;
    const versions = [];
    const seen = new Set();
    for (const match of text.matchAll(versionPattern)) {
      const label = normalizeText(match[0]);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      versions.push({
        label,
        isLatest: /^Latest:/i.test(label),
        selected: /Selected/i.test(label),
        default: /Latest:\s*Published/i.test(label)
      });
    }
    return versions;
  }

  async function findAllVersions() {
    const versions = new Map();
    addVersionsToMap(versions, findVisibleVersions());

    const pageButtons = getVersionPaginationButtons();
    if (pageButtons.length > 1) {
      for (const pageButton of pageButtons) {
        if (isDisabled(pageButton)) continue;
        const pageNumber = normalizeText(pageButton.innerText || pageButton.textContent);
        pageButton.click();
        await sleep(500);
        addVersionsToMap(versions, findVisibleVersions(), pageNumber);
      }
      const firstPage = getVersionPaginationButtons().find((button) => normalizeText(button.innerText || button.textContent) === "1");
      if (firstPage && !isDisabled(firstPage)) {
        firstPage.click();
        await sleep(350);
      }
    }

    return [...versions.values()];
  }

  function addVersionsToMap(map, versions, pageNumber = "") {
    for (const version of versions) {
      const key = version.label;
      if (!key || map.has(key)) continue;
      map.set(key, pageNumber ? { ...version, capturedPage: pageNumber } : version);
    }
  }

  function getVersionPaginationButtons() {
    const headings = [...document.querySelectorAll("h1,h2,h3,[role='heading']")];
    const versionsHeading = headings.find((heading) => /^Versions\b/i.test(normalizeText(heading.innerText || heading.textContent)));
    const root = versionsHeading?.parentElement || document.body;
    const buttons = [...root.querySelectorAll("button, [role='button']")];
    const numericButtons = buttons.filter((button) => /^\d+$/.test(normalizeText(button.innerText || button.textContent)));
    if (numericButtons.length > 1) return numericButtons;

    return [...document.querySelectorAll("button, [role='button']")]
      .filter((button) => /^\d+$/.test(normalizeText(button.innerText || button.textContent)))
      .slice(-5);
  }

  function readPromptText() {
    const text = readPromptFromEditableSurface() || readPromptFromLineText();
    return {
      text,
      contentLength: text.length,
      yaml: `prompt: |\n${indentYamlBlock(text)}\n`
    };
  }

  function readPromptFromEditableSurface() {
    const candidates = [
      ...document.querySelectorAll("textarea"),
      ...document.querySelectorAll("[contenteditable='true']"),
      ...document.querySelectorAll("pre"),
      ...document.querySelectorAll("code")
    ];

    for (const element of candidates) {
      const text = String(element.value || element.innerText || element.textContent || "").trim();
      if (looksLikePromptContent(text)) return text;
    }

    return "";
  }

  function readPromptFromLineText() {
    const lines = String(document.body.innerText || "").replace(/\r\n/g, "\n").split("\n");
    const promptHeadingIndexes = [];
    lines.forEach((line, index) => {
      if (normalizeText(line) === "Prompt") promptHeadingIndexes.push(index);
    });

    const candidates = [];
    for (const startIndex of promptHeadingIndexes) {
      const nextBoundary = findNextLineBoundary(lines, startIndex + 1, ["Tags", "Versions"]);
      const text = lines.slice(startIndex + 1, nextBoundary).join("\n").trim();
      if (looksLikePromptContent(text)) candidates.push(text);
    }

    if (candidates.length) {
      return candidates.sort((a, b) => b.length - a.length)[0];
    }

    const body = String(document.body.innerText || "");
    const match = body.match(/(?:^|\n)\s*((?:system|prompt|messages|user|assistant):\s*\|[\s\S]+?)(?=\n\s*(?:Tags|Versions)\b|$)/i);
    return (match?.[1] || "").trim();
  }

  function findNextLineBoundary(lines, startIndex, labels) {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = normalizeText(lines[index]);
      if (labels.some((label) => line === label || line.startsWith(`${label} (`))) {
        return index;
      }
    }
    return lines.length;
  }

  function looksLikePromptContent(text) {
    const normalized = String(text || "").trim();
    if (normalized.length < 20) return false;
    return /(?:^|\n)\s*(?:system|prompt|messages|user|assistant):\s*\|/i.test(normalized)
      || normalized.includes("You are ")
      || normalized.includes("<identity>")
      || normalized.includes("<scope>");
  }

  function indentYamlBlock(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
  }

  function readTags() {
    const rows = readTables().flatMap((table) => table.rows);
    return rows.filter((row) => {
      const keys = Object.keys(row).map((key) => key.toLowerCase());
      return keys.includes("key") && keys.includes("value");
    });
  }

  function readGuardrailSections(text, tables = []) {
    const contentFilterLines = getSectionLines("Content filters", ["Denied topics"], (windowLines) => windowLines.includes("Harmful categories"));
    const deniedTopicLines = getSectionLines("Denied topics", ["Word filters", "Sensitive information filters"]);
    const wordFilterLines = getSectionLines("Word filters", ["Sensitive information filters"]);
    const sensitiveLines = getSectionLines("Sensitive information filters", ["Contextual grounding check", "Blocked messaging", "Tags"]);
    const contextualLines = getSectionLines("Contextual grounding check", ["Blocked messaging", "Tags"]);
    const blockedLines = getSectionLines("Blocked messaging", ["Tags", "Versions"]);

    const deniedTopicRows = rowsFromTable(tables, (headers) => headers.includes("definition") && headers.includes("sample phrases"));
    const sensitiveInformationRows = rowsFromTable(tables, (headers) => headers.includes("pii type") && headers.includes("guardrail behavior"));
    const deniedTopicCount = readGuardrailSectionCount(deniedTopicLines);
    const sensitiveInformationTypeCount = readGuardrailSectionCount(sensitiveLines);
    const deniedTopics = deniedTopicCount === 0 ? [] : removeGuardrailPlaceholderRows(deniedTopicRows);
    const sensitiveInformationTypes = sensitiveInformationTypeCount === 0
      ? []
      : removeGuardrailPlaceholderRows(sensitiveInformationRows);
    const versions = rowsFromTable(tables, (headers) => headers.includes("version") && headers.includes("status"));

    return compactObject({
      contentFiltersParsed: parseGuardrailContentFilters(contentFilterLines),
      deniedTopics,
      deniedTopicCount,
      sensitiveInformationTypes,
      sensitiveInformationTypeCount,
      versions,
      wordFiltersParsed: parseGuardrailWordFilters(wordFilterLines),
      contextualGroundingParsed: parseGuardrailContextualGrounding(contextualLines),
      blockedMessagingParsed: parseGuardrailBlockedMessaging(blockedLines),
      deniedTopicsText: deniedTopicLines.join(" "),
      wordFiltersText: wordFilterLines.join(" "),
      sensitiveInformationText: sensitiveLines.join(" "),
      contextualGroundingText: contextualLines.join(" "),
      blockedMessagingText: blockedLines.join(" "),
      contentFilters: extractBetween(text, "Content filters", "Denied topics"),
      deniedTopicsRaw: extractBetween(text, "Denied topics", "Word filters"),
      wordFilters: extractBetween(text, "Word filters", "Sensitive information filters"),
      sensitiveInformationFilters: extractBetween(text, "Sensitive information filters", "Contextual grounding check"),
      contextualGrounding: extractBetween(text, "Contextual grounding check", "Blocked messaging"),
      blockedMessaging: extractBetween(text, "Blocked messaging", "Tags")
    });
  }

  function readAgentSections(text, tables, links = []) {
    const tableSummaries = {
      prompts: [],
      tools: [],
      securityProfiles: [],
      versions: []
    };
    for (const table of tables) {
      const headers = table.headers.map((header) => header.toLowerCase());
      const headerText = headers.join("|");
      if (headers.includes("instructions") || headers.includes("namespace")) {
        tableSummaries.tools.push(...table.rows);
        continue;
      }
      if (headers.includes("version") && headers.includes("status") && !headers.includes("name")) {
        tableSummaries.versions.push(...table.rows);
        continue;
      }
      if (headers.includes("name") && headers.includes("status") && headers.includes("version") && headers.includes("type")) {
        tableSummaries.prompts.push(...table.rows.filter((row) => row.url || row.id || row.name));
        continue;
      }
      if (headers.includes("name") && headers.includes("description") && !headerText.includes("instructions")) {
        tableSummaries.securityProfiles.push(...table.rows);
      }
    }
    const relatedPromptLinks = links
      .filter((link) => /\/q-connect\/ai-prompts\//.test(link.href || ""))
      .map((link) => ({ name: link.text || "", url: link.href || "", id: idFromPath(link.href || "") }));
    const relatedGuardrails = links
      .filter((link) => /\/q-connect\/guardrails\//.test(link.href || ""))
      .map((link) => ({ name: link.text || "", url: link.href || "", id: idFromPath(link.href || "") }));
    tableSummaries.prompts.push(...relatedPromptLinks);
    return compactObject({
      overviewText: extractBetween(text, "Overview", "Security Profiles"),
      prompts: dedupeObjects(tableSummaries.prompts, (item) => item.id || item.url || item.name),
      tools: dedupeObjects(tableSummaries.tools, (item) => item.name),
      securityProfiles: dedupeObjects(tableSummaries.securityProfiles, (item) => item.name),
      versions: dedupeObjects(tableSummaries.versions, (item) => item.version || item.name),
      relatedGuardrails: dedupeObjects(relatedGuardrails, (item) => item.id || item.url || item.name)
    });
  }

  function rowsFromTable(tables, predicate) {
    return tables
      .filter((table) => predicate(table.headers.map((header) => header.toLowerCase())))
      .flatMap((table) => table.rows || []);
  }

  function idFromPath(href) {
    try {
      return new URL(href, APP_ORIGIN).pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      return "";
    }
  }

  function readFlowDetail() {
    const url = new URL(window.location.href);
    const arn = url.searchParams.get("id") || "";
    return compactObject({
      arn,
      contactFlowId: arn.split("/").pop() || "",
      tab: url.searchParams.get("tab") || "",
      warning: "Flow definition is not visible in the Details tab. Import the official JSON export to build the runtime map."
    });
  }

  function readConversationalAiOverview() {
    const lines = getVisibleTextLines(document.body);
    const pageTitle = getPageTitle();
    const arn = firstLineMatching(lines, /^arn:aws:lex:/);
    const detected = classifyUrl();
    const name = readControlValueByLabel(/^Name$/i)
      || valueAfterFirstMatchingLabel(lines, /^Name$/i, { reject: /Maximum/i })
      || pageTitle;
    const rawDescription = detected.mode === "detail"
      ? (readControlValueByLabel(/^Description\b/i)
        || valueAfterFirstMatchingLabel(lines, /^Description\b/i, { reject: /Maximum|optional$|Describe the purpose/i }))
      : "";
    const description = rawDescription && rawDescription !== name ? rawDescription : "";
    return compactObject({
      name,
      description,
      version: valueAfterFirstMatchingLabel(lines, /^Version$/i),
      status: findChoiceAfterLabel(lines, "Status", ["Available", "Unavailable", "Building", "Failed"]),
      arn,
      botId: arn.split("/").pop() || inferIdFromCurrentUrl(),
      coppa: detected.mode === "detail" ? readCheckedRadioChoice(["Yes", "No"]) : "",
      page: detected.mode
    });
  }

  function readConversationalAiSections(text, tables, detected) {
    const lines = getVisibleTextLines(document.body);
    const tableSummaries = {};
    for (const table of tables) {
      const headers = table.headers.map((header) => header.toLowerCase()).join("|");
      if (headers.includes("alias") && headers.includes("associated version")) tableSummaries.aliases = table.rows;
      if (headers.includes("version") && headers.includes("created date")) tableSummaries.versions = table.rows;
    }

    return compactObject({
      page: detected.mode,
      botId: inferIdFromCurrentUrl(),
      arn: firstLineMatching(lines, /^arn:aws:lex:/),
      languages: readConversationalAiLanguages(lines),
      confidenceScoreThreshold: readConfidenceScoreThreshold(lines),
      speechModel: readSpeechModel(lines),
      connectAiAgentIntentStatus: readConnectAiAgentIntentStatus(lines),
      intents: readConversationalAiIntents(lines),
      prompts: readConversationalAiPromptSnippets(lines),
      configurationFlags: readConversationalAiConfigurationFlags(lines),
      ...tableSummaries
    });
  }

  function readConversationalAiLanguages(lines) {
    const languages = [];
    const joined = lines.join(" ");
    for (const match of joined.matchAll(/\b([A-Z][A-Za-z]+ \([A-Z]{2}\))\s+(Built|Unbuilt|Building|Failed)\b/g)) {
      languages.push({ name: match[1], status: match[2] });
    }
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (/^[A-Za-z]+(?: \([A-Z]{2}\))$/.test(lines[index])) {
        const status = /^(Built|Unbuilt|Building|Failed)$/i.test(lines[index + 1]) ? lines[index + 1] : "";
        languages.push(compactObject({ name: lines[index], status }));
      }
    }
    return dedupeObjects(languages, (item) => item.name);
  }

  function readConversationalAiIntents(lines) {
    const start = lines.findIndex((line) => /^Intent(?:\s+Info)?$/i.test(line));
    if (start < 0) return [];
    const end = lines.findIndex((line, index) => index > start && /^(Details|Prompts|Additional Conversational AI bot configuration)$/i.test(line));
    const scoped = lines.slice(start + 1, end > start ? end : start + 40);
    const intents = scoped
      .filter((line) => /^[A-Za-z0-9][A-Za-z0-9_-]{1,100}$/.test(line))
      .filter((line) => !/^(Info|Add|Edit|Built|Disabled|Enabled|Intent)$/i.test(line))
      .map((name) => ({ name }));
    return dedupeObjects(intents, (item) => item.name);
  }

  function readConversationalAiPromptSnippets(lines) {
    const snippets = {};
    const labels = [
      ["initialResponseMessage", /^Initial response message$/i],
      ["confirmationResponseMessage", /^Confirmation response message$/i],
      ["declinationResponseMessage", /^Declination response message$/i],
      ["closingResponseMessage", /^Closing response message$/i]
    ];
    for (const [key, pattern] of labels) {
      const value = valueAfterFirstMatchingLabel(lines, pattern, {
        reject: /message the Conversational AI bot will play|Provide messages|Confirmation prompt|Declination response|Fulfillment/i
      });
      if (value) snippets[key] = value;
    }
    return snippets;
  }

  function readConversationalAiConfigurationFlags(lines) {
    const flags = {};
    for (const label of ["Fulfillment", "Code Hooks", "Input Context", "Output Context"]) {
      const index = lines.findIndex((line) => line === label);
      if (index >= 0) {
        const value = lines.slice(index + 1, index + 4).find((line) => /^(Enabled|Disabled|Inactive)$/i.test(line));
        if (value) flags[toCamelKey(label)] = value;
      }
    }
    return flags;
  }

  function readSpeechModel(lines) {
    const speechToText = firstLineMatching(lines, /^Speech-to-Text:/i);
    if (speechToText) return speechToText.replace(/^Speech-to-Text:\s*/i, "");
    return valueAfterFirstMatchingLabel(lines, /^Speech model$/i, { reject: /Configure/i });
  }

  function readConnectAiAgentIntentStatus(lines) {
    const joined = lines.join(" ");
    const inline = joined.match(/Amazon Connect AI agent in Connect intent\s*-\s*(Enabled|Disabled)/i);
    if (inline?.[1]) return inline[1];
    const index = lines.findIndex((line) => /^Amazon Connect AI agent in Connect intent$/i.test(line));
    if (index < 0) return "";
    return lines.slice(index + 1, index + 8).find((line) => /Enabled|Disabled|not supported/i.test(line)) || "";
  }

  function readConfidenceScoreThreshold(lines) {
    const sliderValue = readSliderValueByLabel(/Confidence score threshold/i);
    if (/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(sliderValue)) return sliderValue;
    const direct = valueAfterFirstMatchingLabel(lines, /^Confidence score threshold$/i, {
      reject: /determines|confidence/i
    });
    if (/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(direct)) return direct;
    const index = lines.findIndex((line) => /^Confidence score threshold$/i.test(line));
    if (index < 0) return direct;
    return lines.slice(index + 1, index + 20).find((line) => /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(line)) || direct;
  }

  function readSliderValueByLabel(labelPattern) {
    const sliders = readControlInventory().sliders || [];
    return sliders.find((slider) => labelPattern.test(slider.label || ""))?.value || "";
  }

  function readCheckedRadioChoice(choices) {
    const choiceSet = new Set(choices);
    const controls = [
      ...document.querySelectorAll("input[type='radio']:checked"),
      ...document.querySelectorAll("[role='radio'][aria-checked='true']")
    ];
    for (const control of controls) {
      const labelText = normalizeText(
        control.getAttribute("aria-label")
        || control.closest("label")?.innerText
        || control.parentElement?.innerText
        || ""
      );
      for (const choice of choiceSet) {
        if (new RegExp(`\\b${choice}\\b`, "i").test(labelText)) return choice;
      }
    }
    return "";
  }

  function dedupeObjects(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseGuardrailContentFilters(lines) {
    const sectionText = lines.join(" ");
    const filters = {};
    const pairs = [
      ["promptFilters", /Prompt filters\s+(Enabled|Disabled)/i],
      ["responseFilters", /Response filters\s+(Enabled|Disabled)/i],
      ["promptAttacks", /Prompt attacks\s+(Enabled|Disabled)/i],
      ["promptAttackStrength", /Prompt attacks\s+(?:Enabled|Disabled)\s+Filter strength\s+([A-Za-z]+)/i]
    ];

    for (const [key, pattern] of pairs) {
      const match = sectionText.match(pattern);
      if (match?.[1]) filters[key] = match[1];
    }

    const categories = ["Hate", "Insults", "Sexual", "Violence", "Misconduct"];
    for (const category of categories) {
      const promptMatch = sectionText.match(new RegExp(`${category} filter for prompts\\s+([A-Za-z]+)`, "i"));
      const responseMatch = sectionText.match(new RegExp(`${category} filter for responses\\s+([A-Za-z]+)`, "i"));
      if (promptMatch?.[1]) filters[`${category.toLowerCase()}PromptStrength`] = promptMatch[1];
      if (responseMatch?.[1]) filters[`${category.toLowerCase()}ResponseStrength`] = responseMatch[1];
    }

    return compactObject(filters);
  }

  function readGuardrailSectionCount(lines) {
    for (const line of lines) {
      const match = normalizeText(line).match(/(?:^|\s)\((\d+)\)(?:\s|$)/);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function removeGuardrailPlaceholderRows(rows) {
    return rows.filter((row) => {
      const values = Object.values(row || {}).map((value) => normalizeText(value)).filter(Boolean);
      return values.length > 0 && values.some((value) => !/^(?:Not Found|No results(?: were found)?|-|–|—)$/i.test(value));
    });
  }

  function parseGuardrailWordFilters(lines) {
    const text = lines.join(" ");
    const profanityFilter = text.match(/Profanity filter\s+(Enabled|Disabled)/i)?.[1] || "";
    return compactObject({ profanityFilter });
  }

  function parseGuardrailContextualGrounding(lines) {
    const text = lines.join(" ");
    return compactObject({
      groundingCheck: text.match(/Grounding check\s+(Enabled|Disabled)/i)?.[1] || "",
      relevanceCheck: text.match(/Relevance check\s+(Enabled|Disabled)/i)?.[1] || ""
    });
  }

  function parseGuardrailBlockedMessaging(lines) {
    const text = lines.join(" ");
    return compactObject({
      blockedPrompts: text.match(/Messaging shown for blocked prompts\s+(.+?)(?=\s+Messaging shown for blocked responses|$)/i)?.[1] || "",
      blockedResponses: text.match(/Messaging shown for blocked responses\s+(.+)$/i)?.[1] || ""
    });
  }

  function readContactTraceSections(text, tables) {
    const lines = getVisibleTextLines(document.body);
    const links = allLinks();
    return compactObject({
      summary: readContactSummary(lines, text),
      traceDetails: readTraceLikeSection(text, ["Trace details", "Trace", "Contact trace"], ["Flow", "Transcript", "Attributes", "Recording", "Contact details"]),
      flowView: readTraceLikeSection(text, ["Flow", "Flow view"], ["Trace details", "Transcript", "Attributes", "Recording", "Contact details"]),
      attributes: readTraceLikeSection(text, ["Attributes", "Contact attributes"], ["Flow", "Trace details", "Transcript", "Recording", "Contact details"]),
      references: readContactTraceReferences(text, links),
      tables: tables.map((table) => ({ headers: table.headers, rows: table.rows }))
    });
  }

  function readContactSummary(lines, text) {
    const summaryLabels = [
      /^Summary$/i,
      /^Contact summary$/i,
      /^Generated summary$/i,
      /^Transcript summary$/i
    ];
    for (const pattern of summaryLabels) {
      const value = valueAfterFirstMatchingLabel(lines, pattern, {
        reject: /^(Summary|Contact summary|Generated summary|Transcript summary)$/i
      });
      if (value) return value;
    }
    return readTraceLikeSection(text, ["Summary", "Contact summary"], ["Trace details", "Flow", "Transcript", "Attributes", "Recording"]);
  }

  function readTraceLikeSection(text, startLabels, endLabels) {
    const normalized = normalizeText(text);
    for (const startLabel of startLabels) {
      const startIndex = normalized.search(new RegExp(`\\b${escapeRegExp(startLabel)}\\b`, "i"));
      if (startIndex < 0) continue;
      let endIndex = normalized.length;
      for (const endLabel of endLabels) {
        const candidate = normalized.slice(startIndex + startLabel.length).search(new RegExp(`\\b${escapeRegExp(endLabel)}\\b`, "i"));
        if (candidate >= 0) {
          endIndex = Math.min(endIndex, startIndex + startLabel.length + candidate);
        }
      }
      const value = normalizeText(normalized.slice(startIndex + startLabel.length, endIndex));
      if (value) return value.length > 6000 ? `${value.slice(0, 6000)}...` : value;
    }
    return "";
  }

  function readContactTraceReferences(text, links) {
    const normalized = normalizeText(text);
    const arns = uniqueMatches(normalized, /arn:aws:[^\s,;)"']+/g);
    const uuids = uniqueMatches(normalized, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
    const phoneNumbers = uniqueMatches(normalized, /\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g);
    const promptArns = arns.filter((arn) => /(?:ai-prompt|aiprompt)/i.test(arn));
    const aiAgentArns = arns.filter((arn) => /(?:ai-agent|aiagent)/i.test(arn));
    const flowArns = arns.filter((arn) => /contact-flow|flow-module/i.test(arn));
    const botArns = arns.filter((arn) => /:bot\//i.test(arn));
    const queueArns = arns.filter((arn) => /:queue\//i.test(arn));
    const aiAgentIds = uniqueValues([
      ...idsFromNamedFields(normalized, ["AiAgentId", "AIAgentId", "aiAgentId"]),
      ...wisdomResourceIds(aiAgentArns, "ai-agent")
    ]);
    const promptIds = uniqueValues([
      ...idsFromNamedFields(normalized, ["PromptId", "AIPromptId", "aiPromptId"]),
      ...wisdomResourceIds(promptArns, "ai-prompt")
    ]);
    const flowIds = uniqueValues(flowArns.map((arn) => arn.split("/").pop()).filter(Boolean));
    return compactObject({
      arns,
      uuids,
      phoneNumbers,
      aiAgentIds,
      promptIds,
      flowIds,
      aiAgentArns,
      promptArns,
      flowArns,
      botArns,
      queueArns,
      aiAgentLinks: aiAgentIds.map((id) => `${APP_ORIGIN}/q-connect/ai-agents/${encodeURIComponent(id)}`),
      promptLinks: promptIds.map((id) => `${APP_ORIGIN}/q-connect/ai-prompts/${encodeURIComponent(id)}`),
      flowLinks: flowArns.map((arn) => `${APP_ORIGIN}/contact-flows/edit?id=${encodeURIComponent(arn)}&actionId=&tab=designer`),
      links: links
        .filter((link) => /(?:contact-flows|flow-modules|q-connect|bots|queues|numbers)/.test(link.href))
        .slice(0, 100)
    });
  }

  function uniqueMatches(text, pattern) {
    return [...new Set([...String(text || "").matchAll(pattern)].map((match) => normalizeText(match[0]).replace(/[),.;]+$/, "")))];
  }

  function uniqueValues(values) {
    return [...new Set(values.map((value) => normalizeText(value).replace(/[:),.;]+$/, "")).filter(Boolean))];
  }

  function idsFromNamedFields(text, names) {
    const ids = [];
    for (const name of names) {
      const pattern = new RegExp(`["']?${escapeRegExp(name)}["']?\\s*[:=]\\s*["']?([0-9a-f-]{36})["']?`, "gi");
      for (const match of String(text || "").matchAll(pattern)) {
        if (match[1]) ids.push(match[1]);
      }
    }
    return ids;
  }

  function wisdomResourceIds(arns, resourceType) {
    return arns.map((arn) => {
      const match = String(arn).match(new RegExp(`${escapeRegExp(resourceType)}/[^/]+/([^/:]+)(?::[^/]+)?$`, "i"));
      return match?.[1] || "";
    }).filter(Boolean);
  }

  function extractBetween(text, startLabel, endLabel) {
    const start = text.indexOf(startLabel);
    if (start < 0) return "";
    const end = text.indexOf(endLabel, start + startLabel.length);
    const value = text.slice(start + startLabel.length, end > start ? end : undefined);
    return normalizeText(value);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compactObject(object) {
    return Object.fromEntries(
      Object.entries(object).filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        return value !== undefined && value !== null && value !== "";
      })
    );
  }

  function validateDetailCapture(detected, detail) {
    const warnings = [];
    const overview = detail.overview || {};

    const requiredOverviewFields = {
      "ai-prompts": ["name", "status", "type"],
      "ai-agents": ["name", "status", "type"],
      "guardrails": ["name", "status"]
    };

    if (requiredOverviewFields[detected.section]) {
      const missing = requiredOverviewFields[detected.section].filter((field) => !isMeaningfulCapturedValue(overview[field]));
      if (missing.length) warnings.push(`Overview may be incomplete. Missing: ${missing.join(", ")}.`);
    }

    if (detected.section === "ai-prompts") {
      if (!detail.prompt?.text) warnings.push("Prompt text was not captured.");
      if (!overview.modelId && !overview.modelID) warnings.push("AI prompt model ID was not captured from overview.");
    }

    if (detected.section === "guardrails") {
      if (!hasObjectContent(detail.guardrail?.contentFiltersParsed) && !detail.guardrail?.contentFilters) {
        warnings.push("Guardrail content filters were not captured.");
      }
      if (!detail.guardrail?.deniedTopicsText && !detail.guardrail?.deniedTopics) {
        warnings.push("Guardrail denied topics were not captured.");
      }
      if (!detail.guardrail?.versions?.length) warnings.push("Guardrail version history was not captured.");
    }

    if (detected.section === "ai-agents") {
      if (!isMeaningfulCapturedValue(overview.aIAgentID) && !isMeaningfulCapturedValue(overview.idFromUrl)) warnings.push("AI agent ID was not captured.");
      if (!isMeaningfulCapturedValue(overview.aIAgentARN)) warnings.push("AI agent ARN was not captured.");
      if (/orchestration/i.test(overview.type || "") && !detail.agent?.prompts?.length) {
        warnings.push("No related orchestration prompt was captured.");
      }
      if (/orchestration/i.test(overview.type || "") && !detail.agent?.tools?.length) {
        warnings.push("No orchestration tools were captured.");
      }
    }

    if (detected.section === "contact-flows") {
      if (!overview.name || !overview.type || !overview.arn) {
        warnings.push("Flow details page metadata may be incomplete.");
      }
    }

    if (detected.section === "flow-modules") {
      if (!overview.name || !overview.arn) {
        warnings.push("Flow module details page metadata may be incomplete.");
      }
    }

    if (detected.section === "conversational-ai" && detected.mode === "detail") {
      if (!overview.name || !overview.status || !overview.arn) {
        warnings.push("Conversational AI bot details page metadata may be incomplete.");
      }
    }

    if (detail.accessDenied?.denied) {
      warnings.push(`Access denied page detected: ${detail.accessDenied.url}`);
    }

    if (detected.section === "queues") {
      const suspicious = ["name", "description", "status", "hoursOfOperation", "arn"]
        .filter((field) => !overview[field] || isLikelyHelperText(overview[field]));
      if (suspicious.length) warnings.push(`Queue form values may be incomplete: ${suspicious.join(", ")}.`);
    }

    if (detected.section === "hours-of-operation") {
      const suspicious = ["name", "description", "timeZone", "arn"]
        .filter((field) => !overview[field] || isLikelyHelperText(overview[field]));
      if (suspicious.length) warnings.push(`Hours of operation values may be incomplete: ${suspicious.join(", ")}.`);
    }

    return warnings;
  }

  function isMeaningfulCapturedValue(value) {
    const normalized = normalizeText(value);
    return Boolean(normalized && !/^(?:-|–|—|n\/a|none|null|undefined)$/i.test(normalized));
  }

  function hasObjectContent(value) {
    return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
  }

  async function identifyVersions() {
    const detected = classifyUrl();
    await openVersionDropdownIfAvailable();
    await sleep(350);
    const versions = await findAllVersions();
    closeOpenDropdowns();
    return wrapResult(detected, "versions", {
      title: getPageTitle(),
      versions,
      note: versions.length ? "Version labels were detected from the visible page/dropdown." : "No version labels detected."
    });
  }

  async function openVersionDropdownIfAvailable() {
    const buttons = [...document.querySelectorAll("button, [role='button']")];
    const versionButton = buttons.find((button) => {
      const text = normalizeText(button.innerText || button.textContent);
      return /^Latest:\s*(Draft|Published)/i.test(text) || /^V\d+:/i.test(text);
    });
    if (!versionButton || isDisabled(versionButton)) return false;
    if (versionButton.getAttribute("aria-expanded") !== "true") {
      versionButton.click();
    }
    return true;
  }

  function closeOpenDropdowns() {
    document.body.click();
  }

  async function activateFlowsTab(section) {
    const labels = {
      "contact-flows": "Flows",
      "flow-modules": "Modules",
      "conversational-ai": "Conversational AI"
    };
    const label = labels[section];
    if (!label) return { activated: false, reason: "not-a-flows-tab-section" };

    const currentState = getPageReadyState({ section, mode: "index" });
    if (currentState.ready) {
      return {
        activated: true,
        alreadyActive: true,
        section,
        readiness: currentState
      };
    }

    const candidates = queryAllDeep("[role='tab'], button")
      .filter((element) => normalizeText(element.innerText || element.textContent) === label)
      .filter((element) => !element.closest("nav, [aria-label*='Navigation' i], [aria-label*='menu' i]"));
    const tab = candidates.find((element) => !isDisabled(element));
    if (!tab) return { activated: false, reason: `tab-not-found:${label}` };

    tab.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      await sleep(250);
      const state = getPageReadyState({ section, mode: "index" });
      if (state.ready) {
        return {
          activated: true,
          waitedMs: Date.now() - startedAt,
          section,
          readiness: state
        };
      }
    }

    return {
      activated: false,
      reason: `tab-content-not-ready:${label}`,
      waitedMs: Date.now() - startedAt,
      section,
      readiness: getPageReadyState({ section, mode: "index" })
    };
  }

  async function waitForPageReady(expected = {}) {
    const timeoutMs = expected.timeoutMs || 15000;
    const startedAt = Date.now();
    let lastState = null;

    while (Date.now() - startedAt < timeoutMs) {
      lastState = getPageReadyState(expected);
      if (lastState.ready) {
        await sleep(400);
        return {
          ...lastState,
          waitedMs: Date.now() - startedAt,
          timedOut: false
        };
      }
      await sleep(300);
    }

    return {
      ...(lastState || getPageReadyState(expected)),
      waitedMs: Date.now() - startedAt,
      timedOut: true
    };
  }

  function getPageReadyState(expected = {}) {
    const detected = classifyUrl();
    const section = expected.section || detected.section;
    const mode = expected.mode || detected.mode;
    const text = document.body.innerText || "";
    const normalizedText = normalizeText(text);
    const title = getPageTitle();
    const rows = mode === "index" ? getIndexRows(section) : [];
    const emptyState = mode === "index" ? getEmptyIndexState(section) : { empty: false };

    if (hasBlockingLoadingState(normalizedText)) {
      return { ready: false, reason: "loading-visible", detected, title, rowCount: rows.length, emptyState };
    }

    if (/Loading|Cargando/i.test(normalizedText) && rows.length === 0) {
      return { ready: false, reason: "loading-visible", detected, title, rowCount: rows.length, emptyState };
    }

    if (mode === "index") {
      const ready = (rows.length > 0 || emptyState.empty) && sectionIndexSignal(section, normalizedText, title);
      return {
        ready,
        reason: ready ? (emptyState.empty && rows.length === 0 ? "index-empty" : "index-ready") : "index-not-ready",
        detected,
        title,
        rowCount: rows.length,
        emptyState
      };
    }

    if (["detail", "edit", "advanced", "configuration", "aliases", "versions"].includes(mode)) {
      const ready = detailSignal(section, normalizedText, title);
      return {
        ready,
        reason: ready ? "detail-ready" : "detail-not-ready",
        detected,
        title,
        rowCount: 0
      };
    }

    return {
      ready: section !== "unknown",
      reason: section !== "unknown" ? "known-page" : "unknown-page",
      detected,
      title,
      rowCount: rows.length
    };
  }

  function hasBlockingLoadingState(text) {
    return /Loading (?:aliases|versions|Security Profiles|AI Prompts|AI Guardrails|default AI agent configurations)|Checking permissions/i.test(text);
  }

  function sectionIndexSignal(section, text, title) {
    const signals = {
      "ai-prompts": /Prompts \(\d+\)|AI Prompts/i,
      "ai-agents": /AI Agents \(\d+\)|AI Agents/i,
      "guardrails": /AI Guardrails \(\d+\)|AI Guardrails/i,
      "contact-flows": /Flows \(\d+\)|Flows/i,
      "flow-modules": /Modules \(\d+\)|Modules/i,
      "conversational-ai": /Conversational AI|Bots \(\d+\)|Bot/i,
      "phone-numbers": /Phone numbers|Phone number|Claim a number/i,
      "contact-search": /Contact search|Search results|Contact ID|Initiation timestamp|Contact status/i,
      "contact-records": /Contact details|Contact ID|Trace details|Flow/i,
      "queues": /Queues \(\d+\)|Queues/i,
      "hours-of-operation": /Hours of operation \(\d+\)|Hours of operation/i
    };
    const pattern = signals[section];
    if (!pattern) return true;
    return pattern.test(text) || pattern.test(title);
  }

  function detailSignal(section, text, title) {
    if (section === "ai-prompts") return /Overview/i.test(text) && /AI Prompt ARN|Prompt/i.test(text);
    if (section === "ai-agents") return /Overview/i.test(text) && /AI Agent ARN|Security Profiles|Tools|Prompts|Guardrails/i.test(text);
    if (section === "guardrails") return /Overview/i.test(text) && /Content filters|AI Guardrail ARN/i.test(text);
    if (section === "contact-flows") return /Flow actions|About this flow|ARN/i.test(text);
    if (section === "flow-modules") return /Flow actions|About this module|Latest:|Module|ARN|Versions|Aliases|Settings/i.test(text);
    if (section === "conversational-ai") return /Bot|Version|Locale|Intent|ARN/i.test(text);
    if (section === "phone-numbers") return /Phone number|ARN|Description|Contact flow|Target ARN|Claimed|Country|Type/i.test(text);
    if (section === "contact-search") return /Contact ID|Contact details|Transcript|Contact status|Initiation timestamp/i.test(text);
    if (section === "contact-records") return /Contact details|Contact ID|Trace details|Flow|Attributes|Summary/i.test(text);
    if (section === "queues") return /ARN|Queue|Hours of operation|Outbound caller config/i.test(text);
    if (section === "hours-of-operation") return /Hours of operation details|Operational hours|ARN/i.test(text);
    if (section === "lex-bots") return /Bot|Version|Locale|Intent/i.test(text);
    return !/^Customer -|^Amazon Connect Customer$/i.test(title);
  }

  function wrapResult(detected, mode, payload) {
    const payloadWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const { warnings, ...restPayload } = payload;
    return {
      capturedAt: nowIso(),
      source: {
        url: getUrl(),
        title: document.title,
        section: detected.section,
        pageMode: detected.mode,
        mode
      },
      ...restPayload,
      warnings: [...payloadWarnings, ...buildWarnings(detected)]
    };
  }

  function buildWarnings(detected) {
    const warnings = [];
    if (detected.section === "unknown") warnings.push("Unsupported or unknown Amazon Connect page.");
    if (document.body.innerText.includes("Unsaved Changes")) {
      warnings.push("Unsaved Changes modal detected. Do not confirm navigation from automation.");
    }
    return warnings;
  }

  function readAccessDeniedState() {
    const text = normalizeText(document.body.innerText || "");
    const denied = /You can[’']t access this page|You do not have permissions?|Access denied|not authorized/i.test(text);
    return compactObject({
      denied,
      url: getUrl(),
      title: getPageTitle(),
      capturedAt: nowIso(),
      message: denied ? firstAccessDeniedLine(text) : ""
    });
  }

  function firstAccessDeniedLine(text) {
    const lines = String(text || "").split(/(?<=\.)\s+|\n+/).map(normalizeText).filter(Boolean);
    return lines.find((line) => /You can[’']t access this page|You do not have permissions?|Access denied|not authorized/i.test(line)) || "";
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.type) return false;
      if (message.type === "DETECT_PAGE") {
        sendResponse({
          ok: true,
          detected: classifyUrl(),
          title: getPageTitle(),
          url: getUrl()
        });
        return false;
      }
      if (message.type === "GET_VISIBLE_TEXT") {
        sendResponse({
          ok: true,
          result: {
            capturedAt: nowIso(),
            url: getUrl(),
            title: getPageTitle(),
            detected: classifyUrl(),
            text: getVisibleTextLines(document.body).join("\n")
          }
        });
        return false;
      }
      if (message.type === "WAIT_FOR_PAGE_READY") {
        waitForPageReady(message.expected || {})
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "ACTIVATE_FLOWS_TAB") {
        activateFlowsTab(message.section)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "CAPTURE_INDEX") {
        sendResponse({ ok: true, result: captureIndex() });
        return false;
      }
      if (message.type === "CAPTURE_ALL_INDEX") {
        captureAllIndex()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "EXPORT_FLOW_JSON") {
        exportFlowJson()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "EXPORT_CONTACT_SEARCH_CSV") {
        exportContactSearchCsv()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "CAPTURE_DETAIL") {
        captureDetail()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "CAPTURE_NETWORK_TRANSCRIPT") {
        captureNetworkTranscript({ contactId: message.contactId || "" })
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      if (message.type === "IDENTIFY_VERSIONS") {
        identifyVersions()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      return false;
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
      return false;
    }
  });
})();
