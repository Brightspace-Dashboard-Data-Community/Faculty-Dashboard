/**
 * LDAA Report Engine — activity aggregation + PDF for Your Institution Faculty Dashboard.
 */
(function (global) {
  "use strict";

  var API = global.BrightspaceApi;
  var LE = API && API.LE;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function maxDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return new Date(a) >= new Date(b) ? a : b;
  }

  async function pMap(items, mapper, concurrency) {
    var results = new Array(items.length);
    var i = 0;
    var workers = [];
    var n = Math.min(concurrency || 4, items.length || 1);
    for (var w = 0; w < n; w++) {
      workers.push(
        (async function () {
          while (i < items.length) {
            var idx = i++;
            try {
              results[idx] = await mapper(items[idx], idx);
            } catch (e) {
              results[idx] = null;
            }
          }
        })()
      );
    }
    await Promise.all(workers);
    return results;
  }

  function normalizeClasslist(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  function isStudentRole(member) {
    var role = (member.Role && (member.Role.Name || member.RoleName)) || "";
    if (!role) return true;
    if (/^student|learner/i.test(role)) return true;
    if (/instructor|designer|admin|grader|ta\b|faculty|teacher/i.test(role)) return false;
    return true;
  }

  function detectThirdPartyTools(toc) {
    var tools = [];
    if (!toc) return tools;
    function walk(nodes) {
      if (!nodes) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n && n.TypeIdentifier === "Topic" && n.Url && /lti|external/i.test(String(n.Url))) {
          var title = n.Title || n.ShortTitle || "LTI tool";
          if (tools.indexOf(title) < 0) tools.push(title);
        }
        if (n && n.Modules) walk(n.Modules);
        if (n && n.Topics) walk(n.Topics);
      }
    }
    if (Array.isArray(toc)) walk(toc);
    else if (toc.Modules) walk(toc.Modules);
    return tools;
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Objects)) return data.Objects;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  function entityUserId(entityWrap) {
    var entity = (entityWrap && (entityWrap.Entity || entityWrap.entity)) || entityWrap || {};
    var id =
      entity.EntityId != null
        ? entity.EntityId
        : entity.Identifier != null
          ? entity.Identifier
          : entity.Id != null
            ? entity.Id
            : entity.UserId != null
              ? entity.UserId
              : null;
    if (id == null && entity.SubmittedBy) {
      id = entity.SubmittedBy.Identifier || entity.SubmittedBy.Id;
    }
    return id != null ? String(id) : null;
  }

  function submissionDateFromEntity(entityWrap) {
    if (!entityWrap) return null;
    var best = entityWrap.CompletionDate || entityWrap.completionDate || null;
    var submissions = entityWrap.Submissions || entityWrap.submissions || [];
    for (var i = 0; i < submissions.length; i++) {
      var sub = submissions[i] || {};
      var d =
        sub.SubmissionDate ||
        sub.SubmittedDate ||
        sub.DateSubmitted ||
        sub.CreationDate ||
        sub.CreatedDate ||
        null;
      best = maxDate(best, d);
    }
    // Flat per-user response shapes
    best = maxDate(
      best,
      entityWrap.SubmissionDate ||
        entityWrap.SubmittedDate ||
        entityWrap.DateSubmitted ||
        entityWrap.CreatedDate ||
        null
    );
    return best;
  }

  function attemptDate(att) {
    if (!att) return null;
    // D2L QuizAttemptData uses Started / Completed (not SubmissionDate)
    return (
      att.Completed ||
      att.Started ||
      att.SubmittedDate ||
      att.SubmissionDate ||
      att.CompletionDate ||
      att.EndDate ||
      att.StartDate ||
      null
    );
  }

  var FACULTY_WITHDRAWAL_LINE =
    "Use this date when you submit a faculty withdrawal and when you assign a final grade of F.";

  function emptyContentAccess(ouId, userId) {
    return {
      rows: [],
      opened: 0,
      total: 0,
      visitsKnown: false,
      timeKnown: false,
      lastVisited: null,
      source: "",
      reportPath:
        "/d2l/lms/content/reports/statistics_users_details.d2l?userId=" +
        encodeURIComponent(userId) +
        "&ou=" +
        encodeURIComponent(ouId)
    };
  }

  function isContentTopicNode(node) {
    if (!node) return false;
    if (node.ModuleId != null && node.TopicId == null && (node.Modules || node.Topics)) return false;
    if (node.TopicId != null) return true;
    if (node.Type === 1) return true;
    if (node.TypeIdentifier === "Topic") return true;
    if (node.TopicType != null && !node.Modules) return true;
    return false;
  }

  function indexContentTopics(toc) {
    var topics = [];
    function walk(nodes, moduleName) {
      if (!nodes || !nodes.length) return;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var title = node.Title || node.Name || node.ShortTitle || "Untitled";
        if (isContentTopicNode(node)) {
          var ids = [];
          if (node.TopicId != null) ids.push(String(node.TopicId));
          if (node.Id != null && ids.indexOf(String(node.Id)) < 0) ids.push(String(node.Id));
          if (node.Identifier != null && ids.indexOf(String(node.Identifier)) < 0) ids.push(String(node.Identifier));
          topics.push({
            id: ids[0] || "",
            ids: ids,
            title: title,
            module: moduleName || ""
          });
          continue;
        }
        var children = [];
        if (Array.isArray(node.Modules)) children = children.concat(node.Modules);
        if (Array.isArray(node.Topics)) children = children.concat(node.Topics);
        var nextModule = moduleName ? moduleName + " › " + title : title;
        walk(children, nextModule);
      }
    }
    var roots = [];
    if (Array.isArray(toc)) roots = toc;
    else if (toc && Array.isArray(toc.Modules)) roots = toc.Modules;
    else if (toc && Array.isArray(toc.Structure)) roots = toc.Structure;
    walk(roots, "");
    return topics;
  }

  function progressIds(row) {
    if (!row) return [];
    var keys = ["ObjectId", "TopicId", "ContentObjectId", "Id"];
    var ids = [];
    for (var i = 0; i < keys.length; i++) {
      if (row[keys[i]] == null || row[keys[i]] === "") continue;
      var id = String(row[keys[i]]);
      if (ids.indexOf(id) < 0) ids.push(id);
    }
    return ids;
  }

  function firstNumber(row, keys) {
    if (!row) return null;
    for (var i = 0; i < keys.length; i++) {
      if (row[keys[i]] == null || row[keys[i]] === "") continue;
      var n = Number(row[keys[i]]);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  function formatDuration(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string" && /[a-z:]/i.test(value)) return String(value).trim();
    var n = Number(value);
    if (isNaN(n) || n < 0) return "";
    var sec = Math.round(n);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function pad(x) {
      return x < 10 ? "0" + x : String(x);
    }
    if (!h && !m && !s) return "";
    return h + ":" + pad(m) + ":" + pad(s);
  }

  function parseLooseDate(text) {
    if (text == null) return null;
    var t = String(text).trim();
    if (!t || /^(n\/a|na|none|never|not visited|—|-)$/i.test(t)) return null;
    var d = new Date(t);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function parseVisitCell(text) {
    if (text == null) return null;
    var raw = String(text).replace(/,/g, "").trim();
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
    return Number(raw);
  }

  function normName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function headerIndex(headers, pattern, avoid) {
    for (var i = 0; i < headers.length; i++) {
      if (avoid && avoid.test(headers[i])) continue;
      if (pattern.test(headers[i])) return i;
    }
    return -1;
  }

  function rowsFromHeaderGrid(grid) {
    if (!grid || grid.length < 2) return null;
    var headerAt = -1;
    for (var h = 0; h < Math.min(grid.length, 4); h++) {
      var joined = grid[h].join(" ");
      if (/visit/i.test(joined) && /topic|content|module|name|item/i.test(joined)) {
        headerAt = h;
        break;
      }
    }
    if (headerAt < 0) return null;
    var headers = grid[headerAt];
    var lastIdx = headerIndex(headers, /last/i);
    var topicIdx = headerIndex(headers, /topic|content|name|item/i, /last|visit|time/i);
    var moduleIdx = headerIndex(headers, /module|folder|unit/i, /last|visit|time/i);
    var visitIdx = headerIndex(headers, /visit/i, /last/i);
    var timeIdx = headerIndex(headers, /time/i, /last/i);
    if (topicIdx < 0) topicIdx = 0;
    if (moduleIdx === topicIdx) moduleIdx = -1;
    var rows = [];
    var currentModule = "";
    var visitsKnown = false;
    var timeKnown = false;
    for (var r = headerAt + 1; r < grid.length; r++) {
      var cells = grid[r];
      var filled = [];
      for (var c = 0; c < cells.length; c++) {
        if (cells[c]) filled.push(cells[c]);
      }
      if (!filled.length) continue;
      var visitVal = visitIdx >= 0 ? parseVisitCell(cells[visitIdx]) : null;
      var timeVal = timeIdx >= 0 ? formatDuration(cells[timeIdx]) : "";
      var lastRaw = lastIdx >= 0 ? cells[lastIdx] : "";
      if (filled.length === 1 && visitVal == null && !lastRaw) {
        currentModule = filled[0];
        continue;
      }
      var title = cells[topicIdx] || filled[0];
      if (!title) continue;
      if (visitVal != null) visitsKnown = true;
      if (timeVal) timeKnown = true;
      rows.push({
        module: moduleIdx >= 0 && cells[moduleIdx] ? cells[moduleIdx] : currentModule,
        title: title,
        visits: visitVal,
        timeSpent: timeVal,
        date: parseLooseDate(lastRaw),
        dateLabel: lastRaw || ""
      });
    }
    if (!rows.length) return null;
    return { rows: rows, visitsKnown: visitsKnown, timeKnown: timeKnown, source: "statistics" };
  }

  function parseCsvGrid(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;
    var s = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!s || s.charAt(0) === "<") return [];
    var firstLine = s.split(/\r?\n/)[0] || "";
    if (!/visit/i.test(firstLine) || !/topic|content|module|name/i.test(firstLine)) return [];
    var tabCount = (firstLine.match(/\t/g) || []).length;
    var commaCount = (firstLine.match(/,/g) || []).length;
    var delimiter = tabCount > commaCount ? "\t" : ",";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') {
            cell += '"';
            i++;
          } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) {
        row.push(cell.trim());
        cell = "";
      } else if (ch === "\n") {
        row.push(cell.trim());
        if (row.join("")) rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") cell += ch;
    }
    if (cell || row.length) {
      row.push(cell.trim());
      if (row.join("")) rows.push(row);
    }
    return rows;
  }

  function statisticsPath(ouId, userId) {
    return (
      "/d2l/lms/content/reports/statistics_users_details.d2l?userId=" +
      encodeURIComponent(userId) +
      "&ou=" +
      encodeURIComponent(ouId)
    );
  }

  function decodeStatsText(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function statsRowFromLabels(labels, isModule, currentModule) {
    if (!labels || labels.length < 4) return null;
    var title = labels[0];
    if (!title) return null;
    var visitsRaw = labels[labels.length - 3];
    var timeRaw = labels[labels.length - 2];
    var lastRaw = labels[labels.length - 1];
    var moduleName = isModule ? title : currentModule;
    var visits = parseVisitCell(visitsRaw);
    var timeSpent = timeRaw && timeRaw !== "-" && timeRaw !== "—" ? timeRaw : "";
    var date = parseLooseDate(lastRaw);
    return {
      module: moduleName,
      title: isModule ? "Entire module" : title,
      isModule: !!isModule,
      visits: visits,
      timeSpent: timeSpent,
      date: date,
      dateLabel: !date && lastRaw && lastRaw !== "-" && lastRaw !== "—" ? lastRaw : "",
      opened: (visits != null && visits > 0) || !!date
    };
  }

  function rowsFromStatsTable(table) {
    if (!table || !table.querySelectorAll) return null;
    var trs = table.querySelectorAll("tr");
    var rows = [];
    var currentModule = "";
    for (var r = 0; r < trs.length; r++) {
      var tr = trs[r];
      if (tr.querySelector("th")) continue;
      var labels = tr.querySelectorAll("label");
      var texts = [];
      for (var i = 0; i < labels.length; i++) {
        var text = (labels[i].textContent || "").replace(/\s+/g, " ").trim();
        if (text) texts.push(text);
      }
      var isModule = /\bd_ggl1\b/.test(tr.className || "");
      if (isModule && texts[0]) currentModule = texts[0];
      var row = statsRowFromLabels(texts, isModule, currentModule);
      if (row) rows.push(row);
    }
    if (!rows.length) return null;
    return { rows: rows, visitsKnown: true, timeKnown: true, source: "statistics", outline: true };
  }

  function findStatsTable(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    var tables = doc.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var heads = tables[i].querySelectorAll("th");
      var joined = "";
      for (var h = 0; h < heads.length; h++) joined += " " + (heads[h].textContent || "");
      if (/title/i.test(joined) && /visits/i.test(joined) && /last visited/i.test(joined)) return tables[i];
    }
    return null;
  }

  function parseStatisticsMarkup(html) {
    if (!html || !/last visited/i.test(html) || !/>\s*Visits\s*</i.test(html)) return null;
    var headerAt = html.search(/last visited/i);
    var start = html.lastIndexOf("<table", headerAt);
    var end = html.indexOf("</table>", headerAt);
    if (start < 0 || end < 0) return null;
    var table = html.slice(start, end);
    var rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    var rows = [];
    var currentModule = "";
    var match;
    while ((match = rowRe.exec(table))) {
      var attrs = match[1] || "";
      var body = match[2] || "";
      if (/<th\b/i.test(body)) continue;
      var labels = [];
      var labelRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
      var labelMatch;
      while ((labelMatch = labelRe.exec(body))) {
        var text = decodeStatsText(labelMatch[1]);
        if (text) labels.push(text);
      }
      var isModule = /\bd_ggl1\b/.test(attrs);
      if (isModule && labels[0]) currentModule = labels[0];
      var row = statsRowFromLabels(labels, isModule, currentModule);
      if (row) rows.push(row);
    }
    if (!rows.length) return null;
    return { rows: rows, visitsKnown: true, timeKnown: true, source: "statistics", outline: true };
  }

  function loadStatisticsFrame(path) {
    return new Promise(function (resolve) {
      if (typeof document === "undefined" || !document.body) {
        resolve(null);
        return;
      }
      var iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.title = "Content statistics";
      iframe.style.cssText =
        "position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none;";
      var settled = false;
      var poll;
      var giveUp;
      function finish(value) {
        if (settled) return;
        settled = true;
        if (poll) window.clearInterval(poll);
        if (giveUp) window.clearTimeout(giveUp);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve(value);
      }
      function tryRead() {
        var doc;
        try {
          doc = iframe.contentDocument;
        } catch (e) {
          finish(null);
          return;
        }
        if (!doc) return;
        var table = findStatsTable(doc);
        if (!table) return;
        finish(rowsFromStatsTable(table));
      }
      iframe.onload = function () {
        tryRead();
      };
      poll = window.setInterval(tryRead, 300);
      giveUp = window.setTimeout(function () {
        finish(null);
      }, 15000);
      document.body.appendChild(iframe);
      iframe.src = path;
    });
  }

  function parseContentStatisticsHtml(html) {
    if (!html || !/<table[\s>]/i.test(html) || typeof DOMParser === "undefined") return null;
    var parsed;
    try {
      parsed = new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return null;
    }
    var tables = parsed.querySelectorAll("table");
    var best = null;
    for (var t = 0; t < tables.length; t++) {
      var trs = tables[t].querySelectorAll("tr");
      var grid = [];
      for (var r = 0; r < trs.length; r++) {
        var cells = trs[r].querySelectorAll("th, td");
        var line = [];
        for (var c = 0; c < cells.length; c++) {
          line.push((cells[c].textContent || "").replace(/\s+/g, " ").trim());
        }
        grid.push(line);
      }
      var found = rowsFromHeaderGrid(grid);
      if (found && (!best || found.rows.length > best.rows.length)) best = found;
    }
    return best;
  }

  function downloadHrefFromHtml(html) {
    if (!html || typeof DOMParser === "undefined") return "";
    var parsed;
    try {
      parsed = new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return "";
    }
    var links = parsed.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var text = (links[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      var href = links[i].getAttribute("href") || "";
      var looksLikeDownload = text === "download" || text.indexOf("download") >= 0 || /csv|export/i.test(href);
      if (!looksLikeDownload) continue;
      if (!/statistics|content\/reports|export|\.csv/i.test(href) && text.indexOf("download") < 0) continue;
      try {
        var url = new URL(href, window.location.origin + "/d2l/lms/content/reports/statistics_users_details.d2l");
        if (url.origin !== window.location.origin) continue;
        if (url.pathname.indexOf("/d2l/") !== 0) continue;
        return url.pathname + url.search;
      } catch (e) {
        /* skip */
      }
    }
    return "";
  }

  async function loadContentStatistics(ouId, userId) {
    var path = statisticsPath(ouId, userId);
    var fromFrame = null;
    try {
      fromFrame = await loadStatisticsFrame(path);
    } catch (e) {
      fromFrame = null;
    }
    if (fromFrame && fromFrame.rows && fromFrame.rows.length) return fromFrame;

    var html = "";
    try {
      var res = await fetch(path, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
      if (res.ok) html = await res.text();
    } catch (e) {
      html = "";
    }
    var fromMarkup = parseStatisticsMarkup(html);
    if (fromMarkup && fromMarkup.rows.length) return fromMarkup;
    if (html && typeof DOMParser !== "undefined") {
      try {
        var parsedDoc = new DOMParser().parseFromString(html, "text/html");
        var table = findStatsTable(parsedDoc);
        var fromDoc = rowsFromStatsTable(table);
        if (fromDoc && fromDoc.rows.length) return fromDoc;
      } catch (e) {
        /* fall through */
      }
    }
    var fromCsv = rowsFromHeaderGrid(parseCsvGrid(html));
    if (fromCsv) {
      fromCsv.source = "statistics";
      return fromCsv;
    }
    return parseContentStatisticsHtml(html);
  }

  function takeStatMatch(stats, title, moduleName) {
    var n = normName(title);
    var m = normName(moduleName);
    if (!n) return null;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < stats.length; i++) {
        var row = stats[i];
        if (row._used) continue;
        var sn = normName(row.title);
        var sm = normName(row.module);
        var titleMatch = pass === 0 ? sn === n : sn.indexOf(n) >= 0 || n.indexOf(sn) >= 0;
        if (!titleMatch) continue;
        if (m && sm && sm !== m && m.indexOf(sm) < 0 && sm.indexOf(m) < 0) continue;
        row._used = true;
        return row;
      }
    }
    return null;
  }

  async function collectContentAccess(ouId, userId, toc) {
    var access = emptyContentAccess(ouId, userId);
    var catalog = indexContentTopics(toc);
    var statsPack = null;
    var progressRows = [];
    try {
      statsPack = await loadContentStatistics(ouId, userId);
    } catch (e) {
      statsPack = null;
    }
    try {
      progressRows = asArray(await API.contentUserProgress(ouId, userId));
    } catch (e) {
      progressRows = [];
    }

    var progressById = {};
    for (var p = 0; p < progressRows.length; p++) {
      var prow = progressRows[p];
      var pids = progressIds(prow);
      if (!pids.length) continue;
      var prog = {
        visits: firstNumber(prow, ["NumRealVisits", "NumVisits", "VisitCount", "Visits", "TotalVisits"]),
        date:
          prow.LastVisited ||
          prow.LastAccessed ||
          prow.LastVisitDate ||
          prow.DateAccessed ||
          prow.CompletedDate ||
          prow.DateCompleted ||
          null,
        time: formatDuration(prow.TotalTime || prow.TimeSpent || prow.Duration),
        read: !!(prow.IsRead || prow.Visited || prow.IsVisited || prow.Completed || prow.IsComplete)
      };
      for (var pi = 0; pi < pids.length; pi++) progressById[pids[pi]] = prog;
    }

    var stats = (statsPack && statsPack.rows) || [];
    var rows = [];
    var outline = !!(statsPack && statsPack.outline && stats.length);
    if (outline) {
      rows = stats;
      access.source = "statistics";
      access.outline = true;
    } else if (catalog.length) {
      for (var i = 0; i < catalog.length; i++) {
        var topic = catalog[i];
        var prog = {};
        var topicIds = topic.ids && topic.ids.length ? topic.ids : topic.id ? [topic.id] : [];
        for (var idn = 0; idn < topicIds.length; idn++) {
          if (progressById[topicIds[idn]]) {
            prog = progressById[topicIds[idn]];
            break;
          }
        }
        var stat = takeStatMatch(stats, topic.title, topic.module);
        var visits = stat && stat.visits != null ? stat.visits : prog.visits != null ? prog.visits : null;
        var date = prog.date || (stat && stat.date) || null;
        var timeSpent = (stat && stat.timeSpent) || prog.time || "";
        var opened = (visits != null && visits > 0) || !!date || !!prog.read;
        rows.push({
          module: (stat && stat.module) || topic.module || "",
          title: topic.title,
          visits: visits,
          timeSpent: timeSpent,
          date: date,
          dateLabel: (stat && stat.dateLabel) || "",
          opened: opened
        });
      }
      for (var s = 0; s < stats.length; s++) {
        if (stats[s]._used) continue;
        rows.push({
          module: stats[s].module || "",
          title: stats[s].title,
          visits: stats[s].visits,
          timeSpent: stats[s].timeSpent || "",
          date: stats[s].date,
          dateLabel: stats[s].dateLabel || "",
          opened: (stats[s].visits != null && stats[s].visits > 0) || !!stats[s].date
        });
      }
      access.source = statsPack ? "statistics" : progressRows.length ? "userprogress" : "";
    } else if (stats.length) {
      for (var j = 0; j < stats.length; j++) {
        rows.push({
          module: stats[j].module || "",
          title: stats[j].title,
          visits: stats[j].visits,
          timeSpent: stats[j].timeSpent || "",
          date: stats[j].date,
          dateLabel: stats[j].dateLabel || "",
          opened: (stats[j].visits != null && stats[j].visits > 0) || !!stats[j].date
        });
      }
      access.source = "statistics";
    } else {
      var ids = Object.keys(progressById);
      for (var k = 0; k < ids.length; k++) {
        var item = progressById[ids[k]];
        var openedOnly = (item.visits != null && item.visits > 0) || !!item.date || item.read;
        if (!openedOnly) continue;
        rows.push({
          module: "",
          title: "Topic " + ids[k],
          visits: item.visits,
          timeSpent: item.time || "",
          date: item.date,
          dateLabel: "",
          opened: true
        });
      }
      access.source = rows.length ? "userprogress" : "";
    }

    var opened = 0;
    var topicTotal = 0;
    var visitsKnown = !!(statsPack && statsPack.visitsKnown);
    var timeKnown = !!(statsPack && statsPack.timeKnown);
    for (var n = 0; n < rows.length; n++) {
      if (rows[n].opened || (rows[n].visits != null && rows[n].visits > 0) || rows[n].date) {
        rows[n].opened = true;
      }
      if (!rows[n].isModule) {
        topicTotal++;
        if (rows[n].opened) opened++;
      }
      if (rows[n].visits != null) visitsKnown = true;
      if (rows[n].timeSpent) timeKnown = true;
      if (rows[n].date) access.lastVisited = maxDate(access.lastVisited, rows[n].date);
    }
    if (!outline) {
      rows.sort(function (a, b) {
        if (a.opened !== b.opened) return a.opened ? -1 : 1;
        var ad = a.date ? new Date(a.date).getTime() : 0;
        var bd = b.date ? new Date(b.date).getTime() : 0;
        if (ad !== bd) return bd - ad;
        var am = (a.module || "") + " " + a.title;
        var bm = (b.module || "") + " " + b.title;
        return am.localeCompare(bm);
      });
    }
    access.rows = rows;
    access.opened = opened;
    access.total = topicTotal || rows.length;
    access.visitsKnown = visitsKnown;
    access.timeKnown = timeKnown;
    return access;
  }

  async function findLastAccess(ouId, userId, hintIso) {
    if (hintIso) return hintIso;
    // Prefer classlist LastAccessed (same source as Course Health / Students widgets)
    try {
      var cl = await API.classlist(ouId);
      var members = normalizeClasslist(cl);
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        if (String(m.Identifier || m.UserId) === String(userId) && m.LastAccessed) {
          return m.LastAccessed;
        }
      }
    } catch (e) {
      /* fall through */
    }
    try {
      var paged = await API.classlistPaged(ouId);
      var objs = asArray(paged);
      for (var j = 0; j < objs.length; j++) {
        var s = objs[j];
        if (String(s.Identifier || s.UserId) === String(userId) && s.LastAccessed) {
          return s.LastAccessed;
        }
      }
    } catch (e) {
      /* fall through */
    }
    try {
      var access = await API.lastAccess(ouId, userId);
      return (access && (access.LastAccessed || access.LastAccess || access.DateLastAccessed)) || null;
    } catch (e) {
      return null;
    }
  }

  async function collectStudentDetail(options) {
    var ouId = options.orgUnitId;
    var userId = options.userId;
    var onProgress = options.onProgress || function () {};
    var uid = String(userId);

    var detail = {
      lastDiscussion: null,
      lastAssignment: null,
      lastQuiz: null,
      lastLogin: null,
      discussions: [],
      assignments: [],
      quizzes: [],
      grades: [],
      finalGrade: null,
      thirdParty: { tools: [], hasActivity: false, lastActivityDate: null, activity: [] },
      contentAccess: emptyContentAccess(ouId, userId)
    };

    onProgress("Loading course access…", 5);
    detail.lastLogin = await findLastAccess(ouId, userId, options.lastAccessedHint || null);

    onProgress("Scanning assignments…", 15);
    var folders = [];
    try {
      folders = asArray(await API.dropboxFolders(ouId));
    } catch (e) {
      folders = [];
    }

    await pMap(
      folders,
      async function (folder) {
        var folderId = folder.Id != null ? folder.Id : folder.FolderId;
        if (folderId == null) return;
        var folderName = folder.Name || "Assignment";
        var foundDate = null;

        // Primary: list all submissions for the folder and match this student
        try {
          var subs = asArray(await API.dropboxSubs(ouId, folderId));
          for (var i = 0; i < subs.length; i++) {
            var wrap = subs[i];
            if (entityUserId(wrap) !== uid) continue;
            foundDate = submissionDateFromEntity(wrap);
            break;
          }
        } catch (e) {
          /* try per-user fallback */
        }

        // Fallback: per-user submissions endpoint
        if (!foundDate) {
          try {
            var one = await API.dropboxSub(ouId, folderId, userId);
            if (one) foundDate = submissionDateFromEntity(one);
          } catch (e) {
            /* no submission */
          }
        }

        if (foundDate) {
          detail.assignments.push({ name: folderName, date: foundDate });
          detail.lastAssignment = maxDate(detail.lastAssignment, foundDate);
        }
      },
      4
    );

    onProgress("Scanning quizzes…", 35);
    var quizList = [];
    try {
      quizList = asArray(await API.quizzes(ouId));
    } catch (e) {
      quizList = [];
    }

    await pMap(
      quizList,
      async function (quiz) {
        var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
        if (qid == null) return;
        try {
          var attempts = asArray(await API.quizAttempts(ouId, qid));
          for (var i = 0; i < attempts.length; i++) {
            var att = attempts[i];
            var attUid =
              att.UserId != null
                ? String(att.UserId)
                : att.User && att.User.Id != null
                  ? String(att.User.Id)
                  : null;
            if (attUid !== uid) continue;
            var when = attemptDate(att);
            if (!when) continue;
            detail.quizzes.push({
              name: quiz.Name || "Quiz",
              date: when,
              score: att.Score != null ? String(att.Score) : ""
            });
            detail.lastQuiz = maxDate(detail.lastQuiz, when);
          }
        } catch (e) {
          /* skip quiz */
        }
      },
      4
    );

    onProgress("Scanning discussions…", 55);
    var forums = [];
    try {
      forums = asArray(await API.forums(ouId));
    } catch (e) {
      forums = [];
    }

    for (var fi = 0; fi < forums.length; fi++) {
      var forum = forums[fi];
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      try {
        var topics = asArray(await API.forumTopics(ouId, fid));
        for (var ti = 0; ti < topics.length; ti++) {
          var topic = topics[ti];
          var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
          if (tid == null) continue;
          try {
            var posts = asArray(await API.topicPosts(ouId, fid, tid));
            for (var pi = 0; pi < posts.length; pi++) {
              var post = posts[pi];
              var poster = post.PostingUserId || post.UserId || post.UserIdentifier;
              if (String(poster) !== uid) continue;
              var pDate = post.PostDate || post.DatePosted;
              if (pDate) {
                detail.discussions.push({
                  forum: forum.Name || "",
                  topic: topic.Name || "",
                  date: pDate
                });
                detail.lastDiscussion = maxDate(detail.lastDiscussion, pDate);
              }
            }
          } catch (e) {
            /* skip topic */
          }
        }
      } catch (e) {
        /* skip forum */
      }
    }

    onProgress("Loading gradebook…", 75);
    try {
      var grades = asArray(await API.gradeValues(ouId, userId));
      for (var gi = 0; gi < grades.length; gi++) {
        var g = grades[gi];
        if (!g) continue;
        var gDate = g.LastModified || g.GradedDate || null;
        detail.grades.push({
          name: g.GradeObjectName || "Grade item",
          date: gDate,
          score: g.PointsNumerator != null ? String(g.PointsNumerator) : ""
        });
        if (
          gDate &&
          /lti|publisher|external|mindtap|cengage|pearson|mcgraw|wiley|zookal/i.test(
            String(g.GradeObjectName || "")
          )
        ) {
          detail.thirdParty.activity.push({
            tool: g.GradeObjectName,
            column: g.GradeObjectName,
            date: gDate,
            score: g.PointsNumerator != null ? String(g.PointsNumerator) : ""
          });
          detail.thirdParty.lastActivityDate = maxDate(detail.thirdParty.lastActivityDate, gDate);
          detail.thirdParty.hasActivity = true;
        }
      }
    } catch (e) {
      /* optional */
    }

    try {
      var finalG = await API.gradeFinal(ouId, userId);
      if (finalG && finalG.DisplayedGrade) detail.finalGrade = finalG.DisplayedGrade;
      else if (finalG && finalG.PointsNumerator != null) detail.finalGrade = String(finalG.PointsNumerator);
    } catch (e) {
      /* optional */
    }

    onProgress("Checking integrated tools…", 88);
    var toc = null;
    try {
      toc = await API.contentToc(ouId);
      detail.thirdParty.tools = detectThirdPartyTools(toc);
    } catch (e) {
      /* optional */
    }

    onProgress("Reading content module access…", 94);
    try {
      detail.contentAccess = await collectContentAccess(ouId, userId, toc);
    } catch (e) {
      detail.contentAccess = emptyContentAccess(ouId, userId);
    }

    onProgress("Done", 100);
    return detail;
  }

  function overallLda(detail) {
    var academic = [
      detail.lastDiscussion,
      detail.lastAssignment,
      detail.lastQuiz,
      detail.thirdParty && detail.thirdParty.lastActivityDate
    ].filter(Boolean);
    if (!academic.length) return null;
    academic.sort(function (a, b) {
      return new Date(b) - new Date(a);
    });
    return academic[0];
  }

  /* Official Your Institution Creative Guide (2024) palette */
  var BRAND = {
    green: [0, 87, 73],
    greenLight: [0, 149, 122],
    mint: [154, 216, 206],
    tan: [200, 198, 183],
    black: [25, 51, 48],
    cream: [244, 243, 239],
    white: [255, 255, 255],
    muted: [90, 98, 94],
    line: [214, 220, 216],
    alert: [153, 27, 27],
    alertBg: [254, 242, 242],
    successBg: [232, 245, 240],
    recencyOk: [0, 149, 122],
    recencyWarn: [180, 83, 9],
    recencyLate: [153, 27, 27]
  };

  function daysAgo(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function recencyColor(iso) {
    var n = daysAgo(iso);
    if (n == null) return BRAND.muted;
    if (n <= 7) return BRAND.recencyOk;
    if (n <= 13) return BRAND.recencyWarn;
    return BRAND.recencyLate;
  }

  function recencyLabel(iso) {
    var n = daysAgo(iso);
    if (n == null) return "";
    if (n === 0) return "today";
    if (n === 1) return "1 day ago";
    return n + " days ago";
  }

  function sortByDateDesc(items, key) {
    return (items || []).slice().sort(function (a, b) {
      return new Date(b[key] || 0) - new Date(a[key] || 0);
    });
  }

  function fillTriangle(doc, x1, y1, x2, y2, x3, y3) {
    if (typeof doc.triangle === "function") {
      doc.triangle(x1, y1, x2, y2, x3, y3, "F");
      return;
    }
    doc.lines(
      [
        [x2 - x1, y2 - y1],
        [x3 - x2, y3 - y2],
        [x1 - x3, y1 - y3]
      ],
      x1,
      y1,
      [1, 1],
      "F",
      true
    );
  }

  function applyColor(doc, method, rgb) {
    doc[method].apply(doc, rgb);
  }

  async function renderLDAReport(options) {
    var student = options.student || {};
    var course = options.course || {};
    var detail = options.detail || {};
    var preparedBy = options.preparedBy || "";
    var jsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDF) throw new Error("jsPDF library not loaded");

    var Brand = global.FacultyDashboardPdfBrand;
    var duckLogo = Brand ? await Brand.loadDuckLogo() : null;

    var doc = new jsPDF({ unit: "pt", format: "letter" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var contentW = pageW - margin * 2;
    var y = 0;
    var lda = overallLda(detail);
    var generatedAt = new Date();
    var studentName = student.DisplayName || "Unknown student";
    var studentId = student.OrgDefinedId || student.Identifier || "—";
    var courseCode = course.Code || "";
    var courseName = course.Name || courseCode || "Course";
    var pageNum = 1;
    var tp = detail.thirdParty || {};

    doc.setProperties({
      title: "LDAA Report — " + studentName,
      subject: "Last Date of Academic Activity",
      author: "Your Institution Faculty Dashboard",
      creator: "Your Institution eLearning Office",
      keywords: "LDAA, FERPA, Your Institution"
    });

    function drawPageBase() {
      applyColor(doc, "setFillColor", BRAND.cream);
      doc.rect(0, 0, pageW, pageH, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, 7, pageH, "F");
    }

    function drawDeltaMark(cx, cy, radius) {
      applyColor(doc, "setFillColor", BRAND.white);
      doc.circle(cx, cy, radius, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      fillTriangle(
        doc,
        cx,
        cy - radius * 0.62,
        cx + radius * 0.62,
        cy + radius * 0.48,
        cx - radius * 0.62,
        cy + radius * 0.48
      );
      applyColor(doc, "setFillColor", BRAND.white);
      fillTriangle(
        doc,
        cx,
        cy - radius * 0.28,
        cx + radius * 0.28,
        cy + radius * 0.28,
        cx - radius * 0.28,
        cy + radius * 0.28
      );
    }

    function placeDuck(x, y, height) {
      if (!Brand || !duckLogo) return 0;
      return Brand.drawDuck(doc, duckLogo, x, y, height);
    }

    function drawCoverHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 88, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 88, pageW, 5, "F");
      applyColor(doc, "setFillColor", BRAND.mint);
      doc.rect(0, 93, pageW, 2, "F");

      var duckH = 52;
      var duckW = placeDuck(margin, 18, duckH);
      var textX = duckW ? margin + duckW + 10 : margin + 46;
      if (!duckW) {
        drawDeltaMark(margin + 18, 44, 18);
      }

      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("YOUR INSTITUTION", textX, 38);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("eLearning Office  ·  Faculty Dashboard", textX, 54);

      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("CONFIDENTIAL", pageW - margin, 32, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("FERPA-protected education record", pageW - margin, 46, { align: "right" });
      doc.text("[campus location]", pageW - margin, 58, { align: "right" });
    }

    function drawContinuedHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 32, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 32, pageW, 3, "F");
      var duckW = placeDuck(margin, 5, 22);
      var textX = duckW ? margin + duckW + 8 : margin;
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("YOUR INSTITUTION  ·  LDAA Report", textX, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.mint);
      var contLabel = studentName + (courseCode ? "  ·  " + courseCode : "");
      if (doc.getTextWidth(contLabel) > 280) {
        contLabel = doc.splitTextToSize(contLabel, 280)[0];
      }
      doc.text(contLabel, pageW - margin, 20, { align: "right" });
    }

    function drawFooter() {
      var fy = pageH - 28;
      applyColor(doc, "setDrawColor", BRAND.greenLight);
      doc.setLineWidth(1.1);
      doc.line(margin, fy, pageW - margin, fy);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Your Institution  ·  eLearning Office  ·  Faculty Dashboard", margin, fy + 12);
      doc.text("Page " + pageNum, pageW - margin, fy + 12, { align: "right" });
    }

    function ensureSpace(needed) {
      if (y + needed <= pageH - 46) return;
      drawFooter();
      doc.addPage();
      pageNum += 1;
      drawContinuedHeader();
      y = 50;
    }

    function sectionTitle(text) {
      ensureSpace(28);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, 4, 14, "F");
      applyColor(doc, "setTextColor", BRAND.green);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(text, margin + 12, y + 11);
      y += 22;
    }

    drawCoverHeader();
    y = 114;

    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Last Date of Academic Activity", margin, y);
    y += 16;
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Official report for a faculty withdrawal and a final grade of F", margin, y);
    var genStamp =
      generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      "  ·  " +
      generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    doc.text(genStamp, pageW - margin, y, { align: "right" });
    y += 18;

    var idH = 72;
    ensureSpace(idH + 8);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, idH, 6, 6, "F");
    applyColor(doc, "setFillColor", BRAND.greenLight);
    doc.rect(margin, y, 6, idH, "F");

    var col1 = margin + 18;
    var col2 = margin + contentW / 2 + 8;
    applyColor(doc, "setTextColor", BRAND.greenLight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("STUDENT", col1, y + 16);
    doc.text("COURSE", col2, y + 16);

    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    var nameFit = doc.splitTextToSize(studentName, contentW / 2 - 28);
    doc.text(nameFit[0], col1, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.text("ID  " + studentId, col1, y + 50);
    if (student.Email) {
      doc.text(String(student.Email), col1, y + 62);
    }

    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    var codeLines = doc.splitTextToSize(courseCode || courseName, contentW / 2 - 28);
    doc.text(codeLines[0], col2, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    applyColor(doc, "setTextColor", BRAND.muted);
    if (courseName && courseName !== courseCode) {
      var nameLines = doc.splitTextToSize(courseName, contentW / 2 - 28);
      doc.text(nameLines.slice(0, 2), col2, y + 48);
    }
    y += idH + 16;

    var hasLda = !!lda;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    var useLines = doc.splitTextToSize(FACULTY_WITHDRAWAL_LINE, contentW - 36);
    var boxH = 66 + useLines.length * 12;
    ensureSpace(boxH + 8);
    applyColor(doc, "setFillColor", hasLda ? BRAND.successBg : BRAND.alertBg);
    doc.roundedRect(margin, y, contentW, boxH, 6, 6, "F");
    applyColor(doc, "setFillColor", hasLda ? BRAND.green : BRAND.alert);
    doc.rect(margin, y, 7, boxH, "F");

    applyColor(doc, "setTextColor", hasLda ? BRAND.green : BRAND.alert);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("OVERALL LAST DATE OF ACADEMIC ACTIVITY", margin + 20, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(useLines, margin + 20, y + 32);
    var dateY = y + 32 + useLines.length * 12 + 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(hasLda ? 16 : 14);
    doc.text(hasLda ? fmtDateLong(lda) : "No academic activity on record", margin + 20, dateY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    if (hasLda) {
      doc.text(
        recencyLabel(lda) + "  ·  Academic events only (login and content views are not counted)",
        margin + 20,
        dateY + 14
      );
    } else {
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.text(
        "No discussion, assignment, quiz, or integrated-tool gradebook activity was found.",
        margin + 20,
        dateY + 14
      );
    }
    y += boxH + 16;

    sectionTitle("Academic activity");
    var contentAccess = detail.contentAccess || emptyContentAccess("", "");
    var tableRows = [
      ["Last discussion post", detail.lastDiscussion, true],
      ["Last assignment submitted", detail.lastAssignment, true],
      ["Last quiz submitted", detail.lastQuiz, true],
      ["Last course access (login)", detail.lastLogin, false],
      ["Last content module access", contentAccess.lastVisited, false]
    ];
    var rowH = 22;
    ensureSpace(20 + tableRows.length * rowH);
    applyColor(doc, "setFillColor", BRAND.green);
    doc.rect(margin, y, contentW, 20, "F");
    applyColor(doc, "setTextColor", BRAND.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("EVENT", margin + 10, y + 13);
    doc.text("COUNTS TOWARD LDA", margin + 248, y + 13);
    doc.text("DATE", pageW - margin - 10, y + 13, { align: "right" });
    y += 20;

    for (var r = 0; r < tableRows.length; r++) {
      applyColor(doc, "setFillColor", r % 2 === 0 ? BRAND.white : [236, 242, 239]);
      doc.rect(margin, y, contentW, rowH, "F");
      applyColor(doc, "setDrawColor", BRAND.line);
      doc.setLineWidth(0.4);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);

      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(tableRows[r][0], margin + 10, y + 14);

      doc.setFontSize(8);
      if (tableRows[r][2]) {
        applyColor(doc, "setTextColor", BRAND.green);
        doc.setFont("helvetica", "bold");
        doc.text("Yes", margin + 248, y + 14);
      } else {
        applyColor(doc, "setTextColor", BRAND.muted);
        doc.setFont("helvetica", "italic");
        doc.text("Informational only", margin + 248, y + 14);
      }

      var iso = tableRows[r][1];
      var dateStr = iso ? fmtDate(iso) : "None on record";
      if (iso) {
        var ago = recencyLabel(iso);
        if (ago) dateStr += "  (" + ago + ")";
      }
      applyColor(doc, "setTextColor", iso ? recencyColor(iso) : BRAND.muted);
      doc.setFont("helvetica", iso ? "bold" : "italic");
      doc.setFontSize(9);
      doc.text(dateStr, pageW - margin - 10, y + 14, { align: "right" });
      y += rowH;
    }
    y += 14;

    sectionTitle("Activity counts");
    var kpis = [
      ["Discussion posts", (detail.discussions || []).length],
      ["Assignments", (detail.assignments || []).length],
      ["Quiz attempts", (detail.quizzes || []).length],
      ["Graded items", (detail.grades || []).length]
    ];
    var gap = 8;
    var tileW = (contentW - gap * 3) / 4;
    var tileH = 48;
    ensureSpace(tileH + 8);
    for (var k = 0; k < kpis.length; k++) {
      var tx = margin + k * (tileW + gap);
      applyColor(doc, "setFillColor", BRAND.white);
      doc.roundedRect(tx, y, tileW, tileH, 5, 5, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(tx, y, tileW, 3, "F");
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(kpis[k][0].toUpperCase(), tx + tileW / 2, y + 16, { align: "center" });
      applyColor(doc, "setTextColor", BRAND.green);
      doc.setFontSize(16);
      doc.text(String(kpis[k][1]), tx + tileW / 2, y + 36, { align: "center" });
    }
    y += tileH + 14;

    if (detail.finalGrade) {
      ensureSpace(28);
      applyColor(doc, "setFillColor", BRAND.white);
      doc.roundedRect(margin, y, contentW, 24, 4, 4, "F");
      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Final / displayed grade:", margin + 12, y + 16);
      doc.setFont("helvetica", "bold");
      applyColor(doc, "setTextColor", BRAND.green);
      doc.text(String(detail.finalGrade), margin + 128, y + 16);
      y += 34;
    }

    function drawItemTable(title, items, nameFn) {
      if (!items || !items.length) return;
      sectionTitle(title);
      var sorted = sortByDateDesc(items, "date");
      var headerH = 18;
      var dateW = 120;
      ensureSpace(headerH + 20);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, contentW, headerH, "F");
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("ITEM", margin + 10, y + 12);
      doc.text("DATE", pageW - margin - 10, y + 12, { align: "right" });
      y += headerH;
      for (var i = 0; i < sorted.length; i++) {
        var label = nameFn(sorted[i]);
        var lines = doc.splitTextToSize(String(label || ""), contentW - dateW - 16);
        var rowHeight = Math.max(16, lines.length * 11 + 6);
        ensureSpace(rowHeight);
        applyColor(doc, "setFillColor", i % 2 === 0 ? BRAND.white : [236, 242, 239]);
        doc.rect(margin, y, contentW, rowHeight, "F");
        applyColor(doc, "setTextColor", BRAND.black);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(lines, margin + 10, y + 11);
        applyColor(doc, "setTextColor", recencyColor(sorted[i].date));
        doc.setFont("helvetica", "bold");
        doc.text(fmtDate(sorted[i].date), pageW - margin - 10, y + 11, { align: "right" });
        y += rowHeight;
      }
      y += 8;
    }

    function contentRowLabel(row) {
      var name = row.title || "Topic";
      return row.module ? row.module + " — " + name : name;
    }

    function drawContentAccess() {
      if (!contentAccess.rows || !contentAccess.rows.length) return;
      sectionTitle("Content module access");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      applyColor(doc, "setTextColor", BRAND.muted);
      var summary =
        "Opened " +
        contentAccess.opened +
        " of " +
        contentAccess.total +
        " topics. Module rows are the module total from Content statistics. Content views do not count toward the last date of academic activity.";
      if (!contentAccess.visitsKnown) {
        summary +=
          " Brightspace did not return a visit count, so the times-opened column is blank. Last access dates are still listed.";
      }
      var summaryLines = doc.splitTextToSize(summary, contentW);
      ensureSpace(summaryLines.length * 11 + 8);
      doc.text(summaryLines, margin, y + 10);
      y += summaryLines.length * 11 + 12;

      var showVisits = !!contentAccess.visitsKnown;
      var showTime = !!contentAccess.timeKnown;
      var dateW = 108;
      var visitsW = showVisits ? 52 : 0;
      var timeW = showTime ? 62 : 0;
      var textW = contentW - dateW - visitsW - timeW - 20;
      var headerH = 18;
      ensureSpace(headerH + 20);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, contentW, headerH, "F");
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("MODULE / TOPIC", margin + 10, y + 12);
      var colX = pageW - margin - 10;
      doc.text("LAST ACCESSED", colX, y + 12, { align: "right" });
      colX -= dateW;
      if (showTime) {
        doc.text("AVG TIME", colX, y + 12, { align: "right" });
        colX -= timeW;
      }
      if (showVisits) {
        doc.text("VISITS", colX, y + 12, { align: "right" });
      }
      y += headerH;

      for (var i = 0; i < contentAccess.rows.length; i++) {
        var row = contentAccess.rows[i];
        var lines = doc.splitTextToSize(contentRowLabel(row), textW);
        var rowHeight = Math.max(16, lines.length * 11 + 6);
        ensureSpace(rowHeight);
        applyColor(doc, "setFillColor", i % 2 === 0 ? BRAND.white : [236, 242, 239]);
        doc.rect(margin, y, contentW, rowHeight, "F");
        applyColor(doc, "setTextColor", row.opened ? BRAND.black : BRAND.muted);
        doc.setFont("helvetica", row.isModule ? "bold" : "normal");
        doc.setFontSize(8);
        doc.text(lines, margin + 10, y + 11);
        var valueX = pageW - margin - 10;
        var when = row.date ? fmtDate(row.date) : row.opened ? row.dateLabel || "Date not returned" : "Not opened";
        applyColor(doc, "setTextColor", row.date ? recencyColor(row.date) : BRAND.muted);
        doc.setFont("helvetica", row.date ? "bold" : "italic");
        doc.text(when, valueX, y + 11, { align: "right" });
        valueX -= dateW;
        doc.setFont("helvetica", "normal");
        applyColor(doc, "setTextColor", BRAND.black);
        if (showTime) {
          doc.text(row.timeSpent || "—", valueX, y + 11, { align: "right" });
          valueX -= timeW;
        }
        if (showVisits) {
          doc.text(row.visits != null ? String(row.visits) : "—", valueX, y + 11, { align: "right" });
        }
        y += rowHeight;
      }
      y += 8;
    }

    drawItemTable("Discussion posts", detail.discussions, function (item) {
      return [item.forum || item.forum, item.topic || item.topic].filter(Boolean).join(" — ") || "Discussion post";
    });
    drawItemTable("Assignments submitted", detail.assignments, function (item) {
      return item.name || "Assignment";
    });
    drawItemTable("Quiz attempts", detail.quizzes, function (item) {
      var n = item.name || "Quiz";
      var score = item.score || item.score;
      return score ? n + "  ·  score " + score : n;
    });
    drawContentAccess();

    if ((tp.tools && tp.tools.length) || tp.hasActivity) {
      sectionTitle("Integrated / third-party tools");
      var toolList = (tp.tools || []).join(", ") || "Integrated tool activity in the gradebook";
      var tpLines = doc.splitTextToSize(
        (tp.hasActivity
          ? "Student activity was found in the gradebook from integrated tools. Most recent: " +
            fmtDate(tp.lastActivityDate) +
            ". "
          : "Tools were detected in this course, but no matching gradebook activity was found for this student. Verify LDAA in the tool itself. ") +
          "Detected: " +
          toolList +
          ".",
        contentW - 24
      );
      var tpH = Math.max(44, 20 + tpLines.length * 11);
      ensureSpace(tpH + 8);
      applyColor(doc, "setFillColor", tp.hasActivity ? BRAND.successBg : [255, 248, 225]);
      doc.roundedRect(margin, y, contentW, tpH, 5, 5, "F");
      applyColor(doc, "setFillColor", tp.hasActivity ? BRAND.green : BRAND.recencyWarn);
      doc.rect(margin, y, 5, tpH, "F");
      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(tpLines, margin + 14, y + 16);
      y += tpH + 12;
    }

    if (preparedBy) {
      ensureSpace(20);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text("Prepared by " + preparedBy, margin, y + 8);
      y += 18;
    }

    var ferpa =
      "This report contains education records protected under the Family Educational Rights and Privacy Act. " +
      "Use only for legitimate educational purposes at Your Institution. Do not share outside authorized college " +
      "personnel without consent or as otherwise permitted by law. Course login and content views are informational " +
      "and are not counted toward Last Date of Academic Activity.";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    var ferpaLines = doc.splitTextToSize(ferpa, contentW - 28);
    var ferpaH = 22 + ferpaLines.length * 10;
    ensureSpace(ferpaH + 8);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, ferpaH, 5, 5, "F");
    applyColor(doc, "setFillColor", BRAND.tan);
    doc.rect(margin, y, 5, ferpaH, "F");
    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("FERPA NOTICE", margin + 14, y + 14);
    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(ferpaLines, margin + 14, y + 26);

    drawFooter();

    var filename =
      "LDAA_" +
      (student.OrgDefinedId || student.Identifier || "student") +
      "_" +
      (course.Code || course.OrgUnitId || "course") +
      ".pdf";
    doc.save(filename.replace(/[^\w.-]+/g, "_"));
  }

  global.LdaaReport = {
    collectStudentDetail: collectStudentDetail,
    renderLDAReport: renderLDAReport,
    overallLda: overallLda,
    fmtDate: fmtDate,
    normalizeClasslist: normalizeClasslist,
    isStudentRole: isStudentRole,
    escapeHtml: escapeHtml,
    facultyWithdrawalLine: FACULTY_WITHDRAWAL_LINE,
    contentStatistics: loadContentStatistics
  };

  global.BSP = global.BSP || {};
  global.BSP.report = global.LdaaReport;
})(window);
