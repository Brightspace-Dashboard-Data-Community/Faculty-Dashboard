/**
 * Term Rollover Assistant
 *
 * Workflow:
 *   1. Pick upcoming (target) then past (source) course.
 *   2. Load source inventory; choose items to copy; optionally stage new items.
 *   3. Queue Brightspace Copy Components into the target (package-level API).
 *      Unchecked items are then deleted from the destination.
 *   4. Second pass: PUT / POST / DELETE on the upcoming course
 *      (dates, names, deletes, and new items — including modules & announcements).
 *
 * Copy API (LE 1.82+; tenant latest LE 1.96):
 *   POST /d2l/api/le/{ver}/import/{targetOu}/copy/
 *   GET  /d2l/api/le/{ver}/import/{targetOu}/copy/{jobToken}
 */
(function () {
  "use strict";

  var BE = (window.BSP && window.BSP.BulkEditor) || null;
  var API = (window.BSP && window.BSP.api) || null;

  var LE_COPY_CANDIDATES = ["1.96", "1.93", "1.82"];
  var LE_DROPBOX = (BE && BE.LE_DROPBOX) || "1.82";
  var LE_DEFAULT = (BE && BE.LE) || (API && API.LE) || "1.96";
  // Quiz routes are documented as LE 1.82+ (1.74 obsolete as of LMS v20.26.1).
  var LE_QUIZ = LE_DEFAULT;
  var LE_NEWS = "1.93";
  var REQUEST_GAP_MS = 120;
  var POLL_MS = 2500;
  var POLL_MAX = 180;

  var OTHER_COMPONENTS = [
    { id: "Content", label: "Content modules & topics", defaultOn: true },
    { id: "CourseFiles", label: "Course files", defaultOn: true },
    { id: "Grades", label: "Grade items", defaultOn: true },
    { id: "GradesSettings", label: "Gradebook settings", defaultOn: true },
    { id: "Rubrics", label: "Rubrics", defaultOn: true },
    { id: "News", label: "Announcements", defaultOn: true },
    { id: "Schedule", label: "Calendar / schedule", defaultOn: true },
    { id: "ReleaseConditions", label: "Release conditions", defaultOn: true },
    { id: "IntelligentAgents", label: "Intelligent agents", defaultOn: true },
    { id: "Checklists", label: "Checklists", defaultOn: false },
    { id: "Surveys", label: "Surveys", defaultOn: false },
    { id: "SelfAssessments", label: "Self assessments", defaultOn: false },
    { id: "Awards", label: "Awards", defaultOn: false },
    { id: "Groups", label: "Groups", defaultOn: false },
    { id: "Homepages", label: "Homepages", defaultOn: false },
    { id: "Widgets", label: "Widgets", defaultOn: false },
    { id: "Navbars", label: "Navbars", defaultOn: false },
    { id: "CourseAppearance", label: "Course appearance", defaultOn: false },
    { id: "Links", label: "Links", defaultOn: false },
    { id: "Faq", label: "FAQ", defaultOn: false },
    { id: "Glossary", label: "Glossary", defaultOn: false },
    { id: "AttendanceRegisters", label: "Attendance", defaultOn: false },
    { id: "Competencies", label: "Competencies", defaultOn: false },
    { id: "CompletionTracking", label: "Completion tracking", defaultOn: false },
    { id: "ToolNames", label: "Tool names", defaultOn: false },
    { id: "DisplaySettings", label: "Display settings", defaultOn: false },
    { id: "S3Model", label: "S3 model", defaultOn: false },
    { id: "LearningOutcomes", label: "Learning outcomes", defaultOn: false },
    { id: "LtiLink", label: "LTI links", defaultOn: false },
    { id: "LtiTP", label: "LTI tool providers", defaultOn: false },
    { id: "Forms", label: "Forms", defaultOn: false }
  ];

  var STATE = {
    targetId: null,
    targetLabel: "",
    sourceId: null,
    sourceLabel: "",
    sourceInventory: null,
    editorItems: [],
    forums: [],
    pendingAdds: [],
    targetSnapshot: null,
    busy: false,
    copyLe: null
  };

  var PACKAGE_META = {
    dropbox: {
      includeId: "traCopyDropbox",
      invId: "traInvDropbox",
      type: "assignment",
      label: "assignment",
      emptyLabel: "No assignments found in the source course.",
      component: "Dropbox"
    },
    quizzes: {
      includeId: "traCopyQuizzes",
      invId: "traInvQuizzes",
      type: "quiz",
      label: "quiz",
      emptyLabel: "No quizzes found in the source course.",
      component: "Quizzes"
    },
    discussions: {
      includeId: "traCopyDiscussions",
      invId: "traInvDiscussions",
      type: "discussion",
      label: "discussion topic",
      emptyLabel: "No discussion topics found in the source course.",
      component: "Discussions"
    }
  };

  function escapeHTML(s) {
    if (BE && BE.escapeHTML) return BE.escapeHTML(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function dateOnlyFromIso(iso) {
    if (BE && BE.dateOnlyFromIso) return BE.dateOnlyFromIso(iso);
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function isoFromDateOnly(dateStr, endOfDay) {
    if (BE && BE.isoFromDateOnly) return BE.isoFromDateOnly(dateStr, endOfDay !== false);
    if (!dateStr) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    var h = endOfDay === false ? 0 : 23;
    var min = endOfDay === false ? 0 : 59;
    var dt = new Date(+m[1], +m[2] - 1, +m[3], h, min, 0, 0);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  function fmtDate(iso) {
    if (BE && BE.fmtDate) return BE.fmtDate(iso);
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  function show(el) {
    if (el) el.classList.remove("tra-hidden");
  }

  function setMeta(text) {
    var el = $("traCourseMeta");
    if (el) el.textContent = text || "";
  }

  function setMessage(containerId, text, type) {
    var el = $(containerId);
    if (!el) return;
    if (!text) {
      el.innerHTML = "";
      el.className = "message-container";
      return;
    }
    var cls = "message-container";
    if (type === "error") cls += " message-error";
    else if (type === "success") cls += " message-success";
    el.className = cls;
    el.innerHTML = "<p>" + escapeHTML(text) + "</p>";
  }

  function logLine(msg) {
    var log = $("traCopyLog");
    if (!log) return;
    var stamp = new Date().toLocaleTimeString();
    log.textContent += "[" + stamp + "] " + msg + "\n";
    log.scrollTop = log.scrollHeight;
  }

  async function ensureXsrf() {
    if (BE && BE.ensureXsrfToken) return BE.ensureXsrfToken();
    return localStorage.getItem("XSRF.Token") || "";
  }

  function xsrfHeaders(json) {
    var token = "";
    try {
      token = localStorage.getItem("XSRF.Token") || "";
    } catch (e) {
      /* ignore */
    }
    var h = {
      "X-CSRF-TOKEN": token,
      Accept: "application/json"
    };
    if (json !== false) h["Content-Type"] = "application/json; charset=utf-8";
    return h;
  }

  async function postJson(url, body) {
    await ensureXsrf();
    var send = function () {
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: xsrfHeaders(true),
        body: JSON.stringify(body)
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrf();
      r = await send();
    }
    if (!r.ok) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    if (r.status === 204) return null;
    try {
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function putJson(url, body) {
    if (BE && BE.putJson) return BE.putJson(url, body);
    throw new Error("Bulk editor helpers unavailable");
  }

  async function putMultipart(url, jsonObj) {
    if (BE && BE.putMultipart) return BE.putMultipart(url, jsonObj);
    throw new Error("Multipart helpers unavailable");
  }

  async function postMultipart(url, jsonObj) {
    await ensureXsrf();
    var boundary = "xxBOUNDARYxx" + Date.now();
    var crlf = "\r\n";
    var parts = [];
    parts.push("--" + boundary + crlf);
    parts.push("Content-Type: application/json" + crlf + crlf);
    parts.push(JSON.stringify(jsonObj));
    parts.push(crlf);
    parts.push("--" + boundary + "--" + crlf);
    var body = new Blob(parts);
    var send = function () {
      var headers = xsrfHeaders(false);
      headers["Content-Type"] = "multipart/mixed;boundary=" + boundary;
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: headers,
        body: body
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrf();
      r = await send();
    }
    if (!r.ok) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    if (r.status === 204) return null;
    try {
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function deleteJson(url) {
    await ensureXsrf();
    var send = function () {
      return fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: xsrfHeaders(false)
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrf();
      r = await send();
    }
    if (!r.ok && r.status !== 204) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    return null;
  }

  async function getJson(url) {
    if (API && API.raw) return API.raw(url);
    await ensureXsrf();
    var r = await fetch(url, {
      credentials: "include",
      headers: xsrfHeaders(false)
    });
    if (!r.ok) {
      var err = new Error("HTTP " + r.status + " — " + url);
      err.status = r.status;
      throw err;
    }
    if (r.status === 204) return null;
    return r.json();
  }

  function courseLabel(selectEl) {
    if (!selectEl || selectEl.selectedIndex < 0) return "";
    return (selectEl.options[selectEl.selectedIndex].textContent || "").trim();
  }

  function renderOtherComponents() {
    var grid = $("traOtherGrid");
    if (!grid) return;
    grid.innerHTML = OTHER_COMPONENTS.map(function (c) {
      return (
        '<label class="tra-check-label">' +
        '<input type="checkbox" data-tra-other="' +
        escapeHTML(c.id) +
        '"' +
        (c.defaultOn ? " checked" : "") +
        ">" +
        "<span>" +
        escapeHTML(c.label) +
        ' <code class="tra-code">' +
        escapeHTML(c.id) +
        "</code></span></label>"
      );
    }).join("");
  }

  function selectedOtherComponents() {
    var out = [];
    document.querySelectorAll("[data-tra-other]").forEach(function (input) {
      if (input.checked) out.push(input.getAttribute("data-tra-other"));
    });
    return out;
  }

  function packageItems(pkg) {
    return (STATE.sourceInventory && STATE.sourceInventory[pkg]) || [];
  }

  function packageIncludeOn(pkg) {
    var meta = PACKAGE_META[pkg];
    var el = meta && $(meta.includeId);
    return !!(el && el.checked);
  }

  function itemIsSelected(it) {
    return !it || it.copySelected !== false;
  }

  function packageHasSelectedItems(pkg) {
    var items = packageItems(pkg);
    if (!items.length) return packageIncludeOn(pkg);
    return items.some(itemIsSelected);
  }

  function packageShouldCopy(pkg) {
    return packageIncludeOn(pkg) && packageHasSelectedItems(pkg);
  }

  function unselectedSourceItems(pkg) {
    return packageItems(pkg).filter(function (it) {
      return it.copySelected === false;
    });
  }

  function selectedCount(pkg) {
    return packageItems(pkg).filter(itemIsSelected).length;
  }

  function buildComponentsList() {
    var comps = selectedOtherComponents().slice();
    if (packageShouldCopy("dropbox")) comps.push("Dropbox");
    if (packageShouldCopy("quizzes")) {
      comps.push("Quizzes");
      if (comps.indexOf("QuestionLibrary") < 0) comps.push("QuestionLibrary");
    }
    if (packageShouldCopy("discussions")) comps.push("Discussions");
    var seen = {};
    var unique = [];
    for (var i = 0; i < comps.length; i++) {
      if (!seen[comps[i]]) {
        seen[comps[i]] = true;
        unique.push(comps[i]);
      }
    }
    return unique;
  }

  function copySelectionSummary() {
    var parts = [];
    Object.keys(PACKAGE_META).forEach(function (pkg) {
      var items = packageItems(pkg);
      if (!packageShouldCopy(pkg)) return;
      var noun =
        pkg === "dropbox" ? "assignments" : pkg === "quizzes" ? "quizzes" : "discussion topics";
      parts.push(selectedCount(pkg) + " of " + items.length + " " + noun);
    });
    return parts;
  }

  /** Step 4 always allows rename / delete / add (not gated by package options). */
  function allowStructureEdit() {
    return true;
  }

  function normalizeMatchName(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function sourceMatchKey(it) {
    if (!it) return "";
    if (it.type === "discussion" || it.forumName) {
      return normalizeMatchName(it.forumName) + "||" + normalizeMatchName(it.name);
    }
    return normalizeMatchName(it.name);
  }

  function inventoryListHtml(pkg) {
    var meta = PACKAGE_META[pkg];
    var items = packageItems(pkg);
    var includeOn = packageIncludeOn(pkg);
    var disabled = includeOn ? "" : " disabled";
    var toolbar =
      '<div class="tra-inv-toolbar">' +
      '<button type="button" class="tra-inv-link" data-inv-select="' +
      pkg +
      '" data-inv-mode="all"' +
      disabled +
      ">Select all</button>" +
      '<button type="button" class="tra-inv-link" data-inv-select="' +
      pkg +
      '" data-inv-mode="none"' +
      disabled +
      ">Select none</button>" +
      '<span class="tra-inv-selected" data-inv-count="' +
      pkg +
      '">' +
      (items.length ? selectedCount(pkg) + " of " + items.length + " selected" : "0 items") +
      "</span></div>";

    var list;
    if (!items.length) {
      list = '<p class="form-hint">' + escapeHTML(meta.emptyLabel) + "</p>";
    } else {
      list =
        '<ul class="tra-inv-list">' +
        items
          .map(function (it, idx) {
            var due = it.dueDate ? fmtDate(it.dueDate) : "No due date";
            var checked = itemIsSelected(it) ? " checked" : "";
            return (
              "<li>" +
              '<label class="tra-inv-item">' +
              '<input type="checkbox" data-inv-pkg="' +
              pkg +
              '" data-inv-idx="' +
              idx +
              '"' +
              checked +
              disabled +
              ">" +
              '<span class="tra-inv-name">' +
              escapeHTML(it.name) +
              "</span></label>" +
              '<span class="tra-inv-due">' +
              escapeHTML(due) +
              "</span></li>"
            );
          })
          .join("") +
        "</ul>";
    }

    var addForm =
      '<div class="tra-add-inline">' +
      '<input type="text" class="form-input tra-add-name" data-add-pkg="' +
      pkg +
      '" placeholder="New ' +
      escapeHTML(meta.label) +
      ' name" aria-label="New ' +
      escapeHTML(meta.label) +
      ' name">' +
      '<input type="date" class="form-input tra-add-due" data-add-pkg="' +
      pkg +
      '" aria-label="Due date for new ' +
      escapeHTML(meta.label) +
      '">' +
      '<button type="button" class="form-button form-button-secondary tra-add-pkg-btn" data-add-pkg="' +
      pkg +
      '"><i class="fas fa-plus" aria-hidden="true"></i> Add</button>' +
      "</div>" +
      '<ul class="tra-pending-list" data-pending-pkg="' +
      pkg +
      '"></ul>';

    return (
      toolbar +
      '<div class="tra-inv-scroll">' +
      list +
      "</div>" +
      addForm
    );
  }

  function pendingAddsForPkg(pkg) {
    var type = PACKAGE_META[pkg].type;
    return (STATE.pendingAdds || []).filter(function (p) {
      return p.type === type;
    });
  }

  function renderPendingAdds() {
    Object.keys(PACKAGE_META).forEach(function (pkg) {
      var el = document.querySelector('[data-pending-pkg="' + pkg + '"]');
      if (!el) return;
      var items = pendingAddsForPkg(pkg);
      if (!items.length) {
        el.innerHTML = "";
        return;
      }
      el.innerHTML = items
        .map(function (p) {
          var due = p.newDue ? p.newDue : "No due date";
          return (
            "<li>" +
            '<span><span class="tra-new-badge">New</span> ' +
            escapeHTML(p.newName || p.name) +
            ' <span class="tra-inv-due">' +
            escapeHTML(due) +
            "</span></span>" +
            '<button type="button" class="tra-pending-remove" data-pending-id="' +
            escapeHTML(p.id) +
            '">Remove</button></li>'
          );
        })
        .join("");
    });
  }

  function updatePackageCardState(pkg) {
    var meta = PACKAGE_META[pkg];
    var card = document.querySelector('.tra-package-card[data-package="' + pkg + '"]');
    if (card) card.classList.toggle("is-skipped", !packageIncludeOn(pkg));
    var inv = meta && $(meta.invId);
    if (!inv) return;
    var on = packageIncludeOn(pkg);
    inv.querySelectorAll("input[data-inv-pkg], .tra-inv-link").forEach(function (el) {
      el.disabled = !on;
    });
  }

  function updateSelectedCount(pkg) {
    var el = document.querySelector('[data-inv-count="' + pkg + '"]');
    if (!el) return;
    var items = packageItems(pkg);
    el.textContent = items.length
      ? selectedCount(pkg) + " of " + items.length + " selected"
      : "0 items";
  }

  function setPackageItemSelection(pkg, selected) {
    packageItems(pkg).forEach(function (it) {
      it.copySelected = selected;
    });
    var inv = $(PACKAGE_META[pkg].invId);
    if (inv) {
      inv.querySelectorAll("input[data-inv-pkg]").forEach(function (cb) {
        cb.checked = selected;
      });
    }
    updateSelectedCount(pkg);
  }

  function addPendingFromForm(pkg) {
    var meta = PACKAGE_META[pkg];
    var inv = $(meta.invId);
    if (!inv) return;
    var nameEl = inv.querySelector(".tra-add-name");
    var dueEl = inv.querySelector(".tra-add-due");
    var name = ((nameEl && nameEl.value) || "").trim();
    if (!name) {
      alert("Enter a name for the new " + meta.label + ".");
      if (nameEl) nameEl.focus();
      return;
    }
    STATE.pendingAdds.push({
      id: "pending-" + pkg + "-" + Date.now(),
      type: meta.type,
      name: name,
      newName: name,
      newDue: (dueEl && dueEl.value) || "",
      newStart: "",
      newEnd: "",
      forumId: null
    });
    if (nameEl) nameEl.value = "";
    if (dueEl) dueEl.value = "";
    renderPendingAdds();
  }

  function removePendingAdd(id) {
    STATE.pendingAdds = (STATE.pendingAdds || []).filter(function (p) {
      return p.id !== id;
    });
    renderPendingAdds();
  }

  function renderPackageInventories() {
    Object.keys(PACKAGE_META).forEach(function (pkg) {
      var el = $(PACKAGE_META[pkg].invId);
      if (!el) return;
      el.hidden = false;
      el.innerHTML = inventoryListHtml(pkg);
      updatePackageCardState(pkg);
    });
    renderPendingAdds();
  }

  function onInventoryClick(ev) {
    var selectBtn = ev.target.closest("[data-inv-select]");
    if (selectBtn) {
      ev.preventDefault();
      var pkg = selectBtn.getAttribute("data-inv-select");
      var mode = selectBtn.getAttribute("data-inv-mode");
      if (!packageIncludeOn(pkg)) return;
      setPackageItemSelection(pkg, mode !== "none");
      return;
    }
    var addBtn = ev.target.closest(".tra-add-pkg-btn");
    if (addBtn) {
      ev.preventDefault();
      addPendingFromForm(addBtn.getAttribute("data-add-pkg"));
      return;
    }
    var removeBtn = ev.target.closest("[data-pending-id]");
    if (removeBtn) {
      ev.preventDefault();
      removePendingAdd(removeBtn.getAttribute("data-pending-id"));
    }
  }

  function onInventoryChange(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute("data-inv-pkg") != null) {
      var pkg = el.getAttribute("data-inv-pkg");
      var idx = parseInt(el.getAttribute("data-inv-idx"), 10);
      var items = packageItems(pkg);
      if (items[idx]) items[idx].copySelected = !!el.checked;
      updateSelectedCount(pkg);
    }
  }

  function onInventoryKeydown(ev) {
    if (ev.key !== "Enter") return;
    var el = ev.target;
    if (!el || !el.classList || !el.classList.contains("tra-add-name")) return;
    ev.preventDefault();
    addPendingFromForm(el.getAttribute("data-add-pkg"));
  }

  function wirePackageIncludeToggles() {
    Object.keys(PACKAGE_META).forEach(function (pkg) {
      var el = $(PACKAGE_META[pkg].includeId);
      if (!el) return;
      el.addEventListener("change", function () {
        updatePackageCardState(pkg);
      });
    });
  }

  function setCount(id, n) {
    var el = $(id);
    if (el) el.textContent = String(n) + (n === 1 ? " item" : " items");
  }

  async function loadForumsAndTopics(ouId, storeState) {
    var forums = [];
    try {
      forums = API
        ? await API.forums(ouId)
        : await getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ouId + "/discussions/forums/");
    } catch (e) {
      forums = [];
    }
    if (!Array.isArray(forums)) forums = forums && forums.Items ? forums.Items : [];

    var topics = [];
    var forumMeta = [];
    for (var i = 0; i < forums.length; i++) {
      var fid = forums[i].ForumId || forums[i].Id;
      if (!fid) continue;
      var list = [];
      try {
        list = API
          ? await API.forumTopics(ouId, fid)
          : await getJson(
              "/d2l/api/le/" + LE_DEFAULT + "/" + ouId + "/discussions/forums/" + fid + "/topics/"
            );
      } catch (e) {
        list = [];
      }
      if (!Array.isArray(list)) list = list && list.Items ? list.Items : [];
      forumMeta.push({
        id: fid,
        name: forums[i].Name || "Forum",
        topicCount: list.length,
        original: forums[i]
      });
      for (var t = 0; t < list.length; t++) {
        var topic = list[t];
        topics.push({
          type: "discussion",
          forumId: fid,
          forumName: forums[i].Name || "Forum",
          id: topic.TopicId || topic.Id,
          name: topic.Name || "Untitled topic",
          dueDate: topic.DueDate || topic.EndDate || null,
          original: topic
        });
      }
      await sleep(REQUEST_GAP_MS);
    }
    STATE._lastForums = forumMeta;
    if (storeState !== false) STATE.forums = forumMeta;
    return topics;
  }

  function emptyForumsFromState() {
    return (STATE.forums || []).filter(function (f) {
      return !f.topicCount;
    });
  }

  /** Forums that would have zero topics left after pending topic deletes. */
  function forumsEmptiedByPendingDeletes() {
    var topicItems = STATE.editorItems.filter(function (it) {
      return it.type === "discussion" && !it.isNew;
    });
    var byForum = {};
    topicItems.forEach(function (it) {
      var fid = String(it.forumId);
      if (!byForum[fid]) {
        byForum[fid] = { id: it.forumId, name: it.forumName || ("Forum " + it.forumId), total: 0, deleting: 0 };
      }
      byForum[fid].total++;
      if (it.markDelete) byForum[fid].deleting++;
    });
    var emptied = [];
    Object.keys(byForum).forEach(function (fid) {
      var g = byForum[fid];
      if (g.total > 0 && g.deleting === g.total) emptied.push(g);
    });
    // Also include forums already empty (no topics in editor)
    emptyForumsFromState().forEach(function (f) {
      var already = emptied.some(function (e) {
        return String(e.id) === String(f.id);
      });
      if (!already) emptied.push({ id: f.id, name: f.name, total: 0, deleting: 0 });
    });
    return emptied;
  }

  async function deleteForum(forumId) {
    await deleteJson(
      "/d2l/api/le/" +
        LE_DEFAULT +
        "/" +
        STATE.targetId +
        "/discussions/forums/" +
        encodeURIComponent(forumId)
    );
  }

  /**
   * After topic deletes (or on demand), offer to remove forums with no topics left.
   * @returns {Promise<number>} number of forums removed
   */
  async function suggestRemoveEmptyForums(options) {
    options = options || {};
    var candidates = options.forums || forumsEmptiedByPendingDeletes();
    // Prefer live re-check from course when requested
    if (options.refresh) {
      await loadForumsAndTopics(STATE.targetId);
      candidates = emptyForumsFromState().map(function (f) {
        return { id: f.id, name: f.name };
      });
    }
    if (!candidates.length) return 0;

    var names = candidates
      .map(function (f) {
        return "• " + f.name;
      })
      .join("\n");
    var msg =
      (candidates.length === 1
        ? "This discussion forum has no topics left:\n\n"
        : "These discussion forums have no topics left:\n\n") +
      names +
      "\n\nRemove " +
      (candidates.length === 1 ? "this empty forum" : "these empty forums") +
      " from the course?";
    if (!window.confirm(msg)) return 0;

    var removed = 0;
    for (var i = 0; i < candidates.length; i++) {
      try {
        await deleteForum(candidates[i].id);
        removed++;
      } catch (e) {
        console.error("[TermRollover] forum delete failed", candidates[i], e);
        alert(
          'Could not remove forum "' +
            candidates[i].name +
            '": ' +
            (e.message || e)
        );
      }
      await sleep(REQUEST_GAP_MS);
    }
    return removed;
  }

  function flattenModules(toc) {
    var out = [];
    function walk(modules, depth) {
      if (!Array.isArray(modules)) return;
      for (var i = 0; i < modules.length; i++) {
        var m = modules[i];
        var id = m.ModuleId || m.Id;
        if (id) {
          out.push({
            type: "module",
            id: id,
            name: m.Title || m.Name || "Untitled module",
            startDate: m.StartDateTime || m.ModuleStartDate || null,
            endDate: m.EndDateTime || m.ModuleEndDate || null,
            depth: depth || 0,
            original: m
          });
        }
        if (m.Modules && m.Modules.length) walk(m.Modules, (depth || 0) + 1);
      }
    }
    if (!toc) return out;
    walk(toc.Modules || toc.modules || [], 0);
    return out;
  }

  async function loadModules(ouId) {
    var toc = null;
    try {
      toc = API ? await API.contentToc(ouId) : await getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ouId + "/content/toc");
    } catch (e) {
      toc = null;
    }
    return flattenModules(toc);
  }

  async function loadAnnouncements(ouId) {
    var data = null;
    try {
      data = await getJson("/d2l/api/le/" + LE_NEWS + "/" + encodeURIComponent(ouId) + "/news/");
    } catch (e) {
      try {
        data = await getJson("/d2l/api/le/" + LE_DEFAULT + "/" + encodeURIComponent(ouId) + "/news/");
      } catch (e2) {
        data = [];
      }
    }
    var list = Array.isArray(data) ? data : (data && data.Items) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var full = n;
      // List endpoint often omits Body — fetch each item for full text.
      var bodyText = newsBodyText(n);
      if (!bodyText && n.Id != null) {
        try {
          full = await getJson(
            "/d2l/api/le/" + LE_NEWS + "/" + encodeURIComponent(ouId) + "/news/" + n.Id
          );
          bodyText = newsBodyText(full);
        } catch (e3) {
          try {
            full = await getJson(
              "/d2l/api/le/" + LE_DEFAULT + "/" + encodeURIComponent(ouId) + "/news/" + n.Id
            );
            bodyText = newsBodyText(full);
          } catch (e4) {
            full = n;
          }
        }
        await sleep(REQUEST_GAP_MS);
      }
      out.push({
        type: "announcement",
        id: (full && full.Id) || n.Id,
        name: (full && full.Title) || n.Title || "Announcement",
        startDate: (full && full.StartDate) || n.StartDate || null,
        endDate: (full && full.EndDate) || n.EndDate || null,
        draftBody: bodyText || "",
        original: full || n
      });
    }
    return out;
  }

  async function fetchDropboxFolders(ouId) {
    var dropbox = [];
    try {
      dropbox = API
        ? await API.dropboxFolders(ouId)
        : await getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ouId + "/dropbox/folders/");
    } catch (e) {
      dropbox = [];
    }
    if (!Array.isArray(dropbox)) dropbox = dropbox && dropbox.Objects ? dropbox.Objects : [];
    return dropbox;
  }

  async function fetchQuizzesList(ouId) {
    var quizzes = [];
    try {
      quizzes = API
        ? await API.quizzes(ouId)
        : await getJson("/d2l/api/le/" + LE_QUIZ + "/" + ouId + "/quizzes/");
    } catch (e) {
      quizzes = [];
    }
    if (!Array.isArray(quizzes)) quizzes = quizzes && quizzes.Objects ? quizzes.Objects : [];
    return quizzes;
  }

  function idSet(list, pickId) {
    var set = {};
    (list || []).forEach(function (item) {
      var id = pickId(item);
      if (id != null && id !== "") set[String(id)] = true;
    });
    return set;
  }

  function targetItemId(item, pkg) {
    if (pkg === "discussions") return String(item.forumId) + ":" + String(item.id);
    return String(item.id);
  }

  function pruneNeeded() {
    return Object.keys(PACKAGE_META).some(function (pkg) {
      return packageShouldCopy(pkg) && unselectedSourceItems(pkg).length > 0;
    });
  }

  async function snapshotTargetIds() {
    var ouId = STATE.targetId;
    var savedForums = STATE.forums;
    var dropbox = await fetchDropboxFolders(ouId);
    var quizzes = await fetchQuizzesList(ouId);
    var discussions = await loadForumsAndTopics(ouId, false);
    var forumIds = idSet(STATE._lastForums, function (f) {
      return f.id;
    });
    STATE.forums = savedForums;
    return {
      dropbox: idSet(dropbox, function (f) {
        return f.Id || f.FolderId;
      }),
      quizzes: idSet(quizzes, function (q) {
        return q.QuizId || q.Id;
      }),
      discussions: idSet(discussions, function (d) {
        return String(d.forumId) + ":" + String(d.id);
      }),
      forums: forumIds
    };
  }

  async function pruneUnselectedCopiedItems(snapshot) {
    if (!snapshot) return { removed: 0, failed: 0 };
    var removed = 0;
    var failed = 0;
    var ou = STATE.targetId;

    async function prunePkg(pkg, loadItems, deleteFn) {
      if (!packageShouldCopy(pkg)) return;
      var skipKeys = {};
      unselectedSourceItems(pkg).forEach(function (it) {
        var key = sourceMatchKey(it);
        skipKeys[key] = (skipKeys[key] || 0) + 1;
      });
      if (!Object.keys(skipKeys).length) return;

      logLine(
        "Removing " +
          Object.keys(skipKeys).length +
          " skipped " +
          PACKAGE_META[pkg].component.toLowerCase() +
          " item(s)…"
      );
      var current = await loadItems();
      var preexisting = snapshot[pkg] || {};
      var newlyCopied = current.filter(function (it) {
        return !preexisting[targetItemId(it, pkg)];
      });

      for (var i = 0; i < newlyCopied.length; i++) {
        var item = newlyCopied[i];
        var key = sourceMatchKey(item);
        if (!skipKeys[key]) continue;
        try {
          await deleteFn(item);
          skipKeys[key] -= 1;
          if (skipKeys[key] <= 0) delete skipKeys[key];
          removed++;
          logLine('Removed "' + (item.name || key) + '"');
        } catch (e) {
          failed++;
          logLine('Could not remove "' + (item.name || key) + '": ' + (e.message || e));
        }
        await sleep(REQUEST_GAP_MS);
      }
    }

    await prunePkg(
      "dropbox",
      async function () {
        var dropbox = await fetchDropboxFolders(ou);
        return dropbox.map(function (f) {
          return {
            type: "assignment",
            id: f.Id || f.FolderId,
            name: f.Name || "Untitled assignment"
          };
        });
      },
      function (item) {
        return deleteJson("/d2l/api/le/" + LE_DROPBOX + "/" + ou + "/dropbox/folders/" + item.id);
      }
    );

    await prunePkg(
      "quizzes",
      async function () {
        var quizzes = await fetchQuizzesList(ou);
        return quizzes.map(function (q) {
          return {
            type: "quiz",
            id: q.QuizId || q.Id,
            name: q.Name || "Untitled quiz"
          };
        });
      },
      function (item) {
        return deleteJson("/d2l/api/le/" + LE_QUIZ + "/" + ou + "/quizzes/" + item.id);
      }
    );

    await prunePkg(
      "discussions",
      async function () {
        return loadForumsAndTopics(ou, true);
      },
      function (item) {
        return deleteJson(
          "/d2l/api/le/" +
            LE_DEFAULT +
            "/" +
            ou +
            "/discussions/forums/" +
            item.forumId +
            "/topics/" +
            item.id
        );
      }
    );

    if (packageShouldCopy("discussions") && unselectedSourceItems("discussions").length) {
      try {
        await loadForumsAndTopics(ou, true);
        var emptied = emptyForumsFromState().filter(function (f) {
          return !(snapshot.forums && snapshot.forums[String(f.id)]);
        });
        for (var f = 0; f < emptied.length; f++) {
          await deleteForum(emptied[f].id);
          removed++;
          logLine('Removed empty forum "' + emptied[f].name + '"');
          await sleep(REQUEST_GAP_MS);
        }
      } catch (e) {
        logLine("Empty-forum cleanup skipped: " + (e.message || e));
      }
    }

    return { removed: removed, failed: failed };
  }

  function attachPendingAddsToEditor() {
    (STATE.pendingAdds || []).forEach(function (p) {
      var exists = STATE.editorItems.some(function (it) {
        return it.isNew && it.pendingId === p.id;
      });
      if (exists) return;
      STATE.editorItems.push(
        makeEditorItem({
          isNew: true,
          pendingId: p.id,
          type: p.type,
          id: p.id,
          name: p.newName || p.name,
          newName: p.newName || p.name,
          newDue: p.newDue || "",
          newStart: p.newStart || "",
          newEnd: p.newEnd || "",
          forumId: p.forumId || (STATE.forums.length ? STATE.forums[0].id : null),
          original: null,
          draftBody: ""
        })
      );
    });
  }

  async function loadSourceInventory() {
    var ouId = STATE.sourceId;
    setMeta("Loading materials from " + STATE.sourceLabel + "…");

    var dropbox = await fetchDropboxFolders(ouId);
    var quizzes = await fetchQuizzesList(ouId);
    var discussions = await loadForumsAndTopics(ouId);

    var dropboxItems = dropbox.map(function (f) {
      return {
        type: "assignment",
        id: f.Id || f.FolderId,
        name: f.Name || "Untitled assignment",
        dueDate: f.DueDate || null,
        copySelected: true,
        original: f
      };
    });
    var quizItems = quizzes.map(function (q) {
      return {
        type: "quiz",
        id: q.QuizId || q.Id,
        name: q.Name || "Untitled quiz",
        dueDate: q.DueDate || null,
        copySelected: true,
        original: q
      };
    });
    discussions.forEach(function (d) {
      d.copySelected = true;
    });

    STATE.sourceInventory = {
      dropbox: dropboxItems,
      quizzes: quizItems,
      discussions: discussions
    };

    setCount("traCountDropbox", dropboxItems.length);
    setCount("traCountQuizzes", quizItems.length);
    setCount("traCountDiscussions", discussions.length);
    renderPackageInventories();

    setMeta(
      "Source: " +
        STATE.sourceLabel +
        " · " +
        dropboxItems.length +
        " assignments, " +
        quizItems.length +
        " quizzes, " +
        discussions.length +
        " discussion topics"
    );
  }

  function dateOffsetPayload() {
    var mode = "startDiff";
    var radios = document.querySelectorAll('input[name="traDateOffset"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) mode = radios[i].value;
    }
    if (mode === "startDiff") return { OffsetByStartDateDifference: true };
    if (mode === "days") {
      var days = parseInt(($("traDaysOffset") && $("traDaysOffset").value) || "0", 10);
      if (isNaN(days)) days = 0;
      return { DaysToOffsetDates: days };
    }
    return {};
  }

  async function queueCopyJob(components) {
    var body = Object.assign(
      {
        SourceOrgUnitId: Number(STATE.sourceId),
        Components: components,
        CallbackUrl: null
      },
      dateOffsetPayload()
    );
    var lastErr = null;
    for (var i = 0; i < LE_COPY_CANDIDATES.length; i++) {
      var ver = LE_COPY_CANDIDATES[i];
      var url = "/d2l/api/le/" + ver + "/import/" + STATE.targetId + "/copy/";
      try {
        logLine("POST copy job (LE " + ver + ") with " + components.length + " component(s)…");
        var res = await postJson(url, body);
        STATE.copyLe = ver;
        return res;
      } catch (e) {
        lastErr = e;
        logLine("LE " + ver + " failed: " + (e.message || e));
      }
    }
    throw lastErr || new Error("Copy job request failed");
  }

  async function pollCopyJob(jobToken) {
    var ver = STATE.copyLe || LE_COPY_CANDIDATES[0];
    var url =
      "/d2l/api/le/" + ver + "/import/" + STATE.targetId + "/copy/" + encodeURIComponent(jobToken);
    for (var i = 0; i < POLL_MAX; i++) {
      var statusPayload = await getJson(url);
      var status = (statusPayload && statusPayload.Status) || "";
      logLine("Copy job status: " + status);
      if (status === "COMPLETE") return statusPayload;
      if (status === "FAILED" || status === "CANCELLED") {
        throw new Error("Copy job " + status.toLowerCase());
      }
      await sleep(POLL_MS);
    }
    throw new Error("Copy job timed out while waiting for completion");
  }

  async function runCopy() {
    if (STATE.busy) return;
    if (!STATE.targetId || !STATE.sourceId) {
      alert("Select both the upcoming and past courses first.");
      return;
    }
    if (String(STATE.targetId) === String(STATE.sourceId)) {
      alert("Upcoming and past courses must be different offerings.");
      return;
    }

    var components = buildComponentsList();
    var pendingCount = (STATE.pendingAdds || []).length;
    if (!components.length && !pendingCount) {
      alert("Select at least one item to copy, or add a new item.");
      return;
    }

    var selParts = copySelectionSummary();
    var confirmMsg =
      "Copy from:\n  " +
      STATE.sourceLabel +
      "\n\nInto:\n  " +
      STATE.targetLabel +
      (selParts.length ? "\n\nSelected items:\n  " + selParts.join("\n  ") : "") +
      "\n\nComponents (" +
      components.length +
      "):\n  " +
      (components.length ? components.join(", ") : "(none — new items only)") +
      (pendingCount ? "\n\nNew items to add: " + pendingCount : "") +
      "\n\nBrightspace copies full packages first. Unchecked items are then removed from the upcoming course. Continue?";
    if (!window.confirm(confirmMsg)) return;

    STATE.busy = true;
    show($("traStepCopy"));
    $("traCopyLog").textContent = "";
    setMessage("traCopyMessage", "Queuing Brightspace copy job…");
    $("traStartCopyBtn").disabled = true;

    try {
      await ensureXsrf();
      if (components.length) {
        var snapshot = null;
        if (pruneNeeded()) {
          logLine("Snapshotting the upcoming course so skipped items can be removed after copy…");
          snapshot = await snapshotTargetIds();
        }
        var createRes = await queueCopyJob(components);
        var token = createRes && createRes.JobToken;
        if (!token) throw new Error("No JobToken returned from copy API");
        logLine("Job accepted. Token: " + token);
        setMessage("traCopyMessage", "Copy in progress…");
        await pollCopyJob(token);
        logLine("Copy finished successfully.");
        if (snapshot) {
          setMessage("traCopyMessage", "Copy complete. Removing skipped items…");
          var prune = await pruneUnselectedCopiedItems(snapshot);
          logLine(
            "Removed " +
              prune.removed +
              " skipped item(s)" +
              (prune.failed ? " (" + prune.failed + " failed)" : "") +
              "."
          );
        }
      } else {
        logLine("No packages to copy. Opening the editor to add new items.");
      }
      setMessage(
        "traCopyMessage",
        "Copy complete. Opening the upcoming-course editor…",
        "success"
      );
      await openEditor();
    } catch (e) {
      console.error("[TermRollover] copy failed", e);
      setMessage("traCopyMessage", "Copy failed: " + (e.message || e), "error");
      logLine("ERROR: " + (e.message || e));
    } finally {
      STATE.busy = false;
      $("traStartCopyBtn").disabled = false;
    }
  }

  function dueFieldFor(item) {
    if (item.type === "assignment" || item.type === "quiz" || item.type === "discussion") {
      if (item.type === "discussion") {
        return (item.original && (item.original.DueDate || item.original.EndDate)) || item.dueDate || null;
      }
      return (item.original && item.original.DueDate) || item.dueDate || null;
    }
    if (item.type === "module") return item.startDate || null;
    if (item.type === "announcement") return item.startDate || null;
    return null;
  }

  function availStartFor(item) {
    if (!item) return null;
    if (item.type === "quiz") return (item.original && item.original.StartDate) || item.startDate || null;
    if (item.type === "assignment") {
      return (
        (item.original && item.original.Availability && item.original.Availability.StartDate) ||
        item.startDate ||
        null
      );
    }
    if (item.type === "discussion") {
      return (item.original && item.original.StartDate) || item.startDate || null;
    }
    if (item.type === "module" || item.type === "announcement") {
      return item.startDate || null;
    }
    return null;
  }

  function availEndFor(item) {
    if (!item) return null;
    if (item.type === "quiz") return (item.original && item.original.EndDate) || item.endDate || null;
    if (item.type === "assignment") {
      return (
        (item.original && item.original.Availability && item.original.Availability.EndDate) ||
        item.endDate ||
        null
      );
    }
    if (item.type === "discussion") {
      return (item.original && item.original.EndDate) || item.endDate || null;
    }
    if (item.type === "module" || item.type === "announcement") {
      return item.endDate || null;
    }
    return null;
  }

  function secondaryDateFor(item) {
    return availEndFor(item);
  }

  /** Ensure start ≤ due ≤ end (Brightspace rejects inverted availability windows). */
  function normalizeQuizDateWindow(startIso, dueIso, endIso) {
    var start = startIso || null;
    var due = dueIso || null;
    var end = endIso || null;
    var startMs = start ? new Date(start).getTime() : NaN;
    var dueMs = due ? new Date(due).getTime() : NaN;
    var endMs = end ? new Date(end).getTime() : NaN;
    var fixed = false;

    // If only start/end are set and start > end, swap them.
    if (!isNaN(startMs) && !isNaN(endMs) && startMs > endMs) {
      var tmp = start;
      start = end;
      end = tmp;
      startMs = new Date(start).getTime();
      endMs = new Date(end).getTime();
      fixed = true;
    }

    // Due cannot be after end — extend end.
    if (!isNaN(dueMs) && !isNaN(endMs) && dueMs > endMs) {
      end = due;
      endMs = dueMs;
      fixed = true;
    } else if (!isNaN(dueMs) && isNaN(endMs)) {
      end = due;
      endMs = dueMs;
      fixed = true;
    }

    // Due cannot be before start — pull start earlier (same calendar day @ 00:00).
    if (!isNaN(dueMs) && !isNaN(startMs) && dueMs < startMs) {
      var d = new Date(due);
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
      startMs = new Date(start).getTime();
      fixed = true;
    }

    return { StartDate: start, DueDate: due, EndDate: end, fixed: fixed };
  }

  function dateOnlyCompare(a, b) {
    // Compare YYYY-MM-DD strings lexicographically.
    if (!a || !b) return 0;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  /** Keep UI date fields coherent while typing. */
  function syncActivityDateInputs(item, tr) {
    if (!hasActivityDates(item.type)) return;
    var due = item.newDue != null ? item.newDue : dateOnlyFromIso(dueFieldFor(item));
    var start = item.newStart != null ? item.newStart : dateOnlyFromIso(availStartFor(item));
    var end = item.newEnd != null ? item.newEnd : dateOnlyFromIso(availEndFor(item));
    var changed = false;

    if (start && end && dateOnlyCompare(start, end) > 0) {
      // Prefer keeping the field the user just edited if we can tell; otherwise bump end.
      end = start;
      item.newEnd = end;
      changed = true;
    }
    if (due && end && dateOnlyCompare(due, end) > 0) {
      end = due;
      item.newEnd = end;
      changed = true;
    }
    if (due && start && dateOnlyCompare(due, start) < 0) {
      start = due;
      item.newStart = start;
      changed = true;
    }

    if (tr && changed) {
      var startEl = tr.querySelector(".tra-start-input");
      var endEl = tr.querySelector(".tra-end-input");
      if (startEl && item.newStart != null) startEl.value = item.newStart;
      if (endEl && item.newEnd != null) endEl.value = item.newEnd;
    }
  }

  function resolveEndWithDue(dueIso, endIso) {
    if (!dueIso) return endIso;
    if (!endIso) return dueIso;
    var dueMs = new Date(dueIso).getTime();
    var endMs = new Date(endIso).getTime();
    if (!isNaN(dueMs) && !isNaN(endMs) && dueMs > endMs) return dueIso;
    return endIso;
  }

  function makeEditorItem(partial) {
    return Object.assign(
      {
        isNew: false,
        newName: null,
        newDue: null,
        newStart: null,
        newEnd: null,
        markDelete: false,
        draftBody: "",
        bodyTouched: false
      },
      partial
    );
  }

  function addDraftItem(type) {
    var draft = makeEditorItem({
      isNew: true,
      type: type,
      id: "new-" + type + "-" + Date.now(),
      name: type === "announcement" ? "New announcement" : "New " + type,
      dueDate: null,
      startDate: null,
      endDate: null,
      forumId: STATE.forums.length ? STATE.forums[0].id : null,
      original: null,
      newName: type === "announcement" ? "New announcement" : "New " + type,
      newDue: "",
      newStart: "",
      newEnd: "",
      draftBody: type === "announcement" ? "Announcement body…" : ""
    });
    STATE.editorItems.push(draft);
    renderEditor();
    var status = $("traSaveStatus");
    if (status) status.textContent = "Draft " + type + " added — fill in details, then Apply.";
  }

  function hasActivityDates(type) {
    return type === "assignment" || type === "quiz" || type === "discussion";
  }

  function renderEditor() {
    var root = $("traEditor");
    var saveBar = $("traSaveBar");
    if (!root) return;

    var items = STATE.editorItems || [];
    var structureHint =
      "Dates must stay in order: Available from ≤ Due ≤ Available until. You can rename, delete, or add items here after copy. If dates are entered out of order, the tool corrects them before saving.";

    function section(title, type, css) {
      var rows = items.filter(function (it) {
        return it.type === type;
      });
      if (type === "forum" && !rows.length) return "";

      var structure = allowStructureEdit();
      var activityDates = hasActivityDates(type);
      var dualDate = type === "module" || type === "announcement";
      var colSpan = activityDates ? 6 : 5;
      var showAdd = type !== "forum";

      var head =
        '<tr class="dd-section-header"><td colspan="' +
        colSpan +
        '">' +
        '<div class="tra-section-head">' +
        "<span>" +
        escapeHTML(title) +
        " (" +
        rows.length +
        ")</span>" +
        (showAdd
          ? '<button type="button" class="form-button form-button-secondary tra-add-btn" data-add-type="' +
            escapeHTML(type) +
            '"><i class="fas fa-plus" aria-hidden="true"></i> Add</button>'
          : "") +
        "</div></td></tr>";

      if (!rows.length) {
        return (
          head +
          '<tr><td colspan="' +
          colSpan +
          '" class="form-hint">None yet. Click Add to create one, or reload after copy.</td></tr>'
        );
      }

      var body = rows
        .map(function (it) {
          var globalIdx = items.indexOf(it);

          if (type === "forum") {
            return (
              '<tr data-idx="' +
              globalIdx +
              '" class="tra-empty-forum-row">' +
              '<td class="' +
              css +
              '">forum</td>' +
              "<td><span class=\"tra-inv-name\">" +
              escapeHTML(it.name) +
              '</span><div class="form-hint" style="margin:4px 0 0;">No topics in this forum</div></td>' +
              '<td class="dd-current">Empty</td>' +
              "<td>—</td>" +
              "<td>" +
              '<label class="tra-del-label"><input type="checkbox" class="tra-delete-cb" data-idx="' +
              globalIdx +
              '"' +
              (it.markDelete ? " checked" : "") +
              "> Delete forum</label>" +
              "</td></tr>"
            );
          }

          var primary = dueFieldFor(it);
          var startAvail = availStartFor(it);
          var endAvail = availEndFor(it);
          var nameEditable = structure || it.isNew;
          var nameCell = nameEditable
            ? '<input type="text" class="form-input dd-input tra-name-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(it.newName != null ? it.newName : it.name) +
              '">'
            : '<span class="tra-inv-name">' + escapeHTML(it.name) + "</span>";

          var dueVal = it.newDue != null ? it.newDue : dateOnlyFromIso(primary);
          var startVal = it.newStart != null ? it.newStart : dateOnlyFromIso(startAvail);
          var endVal = it.newEnd != null ? it.newEnd : dateOnlyFromIso(endAvail);

          var dateCell;
          if (activityDates) {
            dateCell =
              '<div class="tra-date-stack">' +
              '<label class="tra-date-label">Due' +
              '<input type="date" class="form-input dd-input tra-due-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(dueVal) +
              '"></label>' +
              '<label class="tra-date-label">Available from' +
              '<input type="date" class="form-input dd-input tra-start-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(startVal) +
              '"></label>' +
              '<label class="tra-date-label">Available until' +
              '<input type="date" class="form-input dd-input tra-end-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(endVal) +
              '"></label>' +
              "</div>";
          } else if (dualDate) {
            dateCell =
              '<div class="tra-date-stack">' +
              '<label class="tra-date-label">Start' +
              '<input type="date" class="form-input dd-input tra-due-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(dueVal) +
              '"></label>' +
              '<label class="tra-date-label">End' +
              '<input type="date" class="form-input dd-input tra-end-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(endVal) +
              '"></label>' +
              "</div>";
          } else {
            dateCell =
              '<input type="date" class="form-input dd-input tra-due-input" data-idx="' +
              globalIdx +
              '" value="' +
              escapeHTML(dueVal) +
              '">';
          }

          var delCell;
          if (it.isNew) {
            delCell = '<span class="tra-new-badge">New</span>';
          } else if (structure) {
            delCell =
              '<label class="tra-del-label"><input type="checkbox" class="tra-delete-cb" data-idx="' +
              globalIdx +
              '"' +
              (it.markDelete ? " checked" : "") +
              "> Delete</label>";
          } else {
            delCell = '<span class="dd-readonly-note">Dates only</span>';
          }

          var currentHtml = it.isNew
            ? "—"
            : "Due: " +
              escapeHTML(fmtDate(primary)) +
              (startAvail || endAvail
                ? "<br>Avail: " +
                  escapeHTML(fmtDate(startAvail)) +
                  " → " +
                  escapeHTML(fmtDate(endAvail))
                : "");

          var typeLabel = it.isNew ? type + " (new)" : type;
          return (
            '<tr data-idx="' +
            globalIdx +
            '"' +
            (it.isNew ? ' class="tra-draft-row"' : "") +
            ">" +
            '<td class="' +
            css +
            '">' +
            escapeHTML(typeLabel) +
            "</td>" +
            "<td>" +
            nameCell +
            (type === "announcement"
              ? '<textarea class="form-textarea tra-body-input" data-idx="' +
                globalIdx +
                '" rows="4" placeholder="Announcement body">' +
                escapeHTML(it.draftBody != null ? it.draftBody : "") +
                "</textarea>"
              : "") +
            "</td>" +
            '<td class="dd-current">' +
            currentHtml +
            "</td>" +
            "<td>" +
            dateCell +
            "</td>" +
            "<td>" +
            delCell +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
      return head + body;
    }

    root.innerHTML =
      '<div class="tra-editor-hint form-hint" style="margin-bottom:0.75rem;">' +
      escapeHTML(structureHint) +
      "</div>" +
      '<table class="dd-table"><thead><tr>' +
      "<th>Type</th><th>Name</th><th>Current</th><th>New dates</th><th></th>" +
      "</tr></thead><tbody>" +
      section("Assignments", "assignment", "dd-type-assignment") +
      section("Quizzes", "quiz", "dd-type-quiz") +
      section("Discussions", "discussion", "dd-type-discussion") +
      section("Empty discussion forums", "forum", "dd-type-forum") +
      section("Modules", "module", "dd-type-module") +
      section("Announcements", "announcement", "dd-type-announcement") +
      "</tbody></table>";

    var emptyCount = emptyForumsFromState().length;
    if (emptyCount) {
      root.innerHTML =
        '<div class="tra-empty-forum-banner" role="status">' +
        '<i class="fas fa-lightbulb" aria-hidden="true"></i> ' +
        escapeHTML(String(emptyCount)) +
        " discussion forum" +
        (emptyCount === 1 ? "" : "s") +
        " with no topics. Check <strong>Delete</strong> on those rows (or use the button) to remove them." +
        ' <button type="button" class="form-button form-button-secondary" id="traMarkEmptyForumsBtn">Mark empty forums for delete</button>' +
        "</div>" +
        root.innerHTML;
    }

    if (saveBar) saveBar.style.display = "";
    wireEditorInputs();
    var markEmptyBtn = $("traMarkEmptyForumsBtn");
    if (markEmptyBtn) {
      markEmptyBtn.addEventListener("click", function () {
        STATE.editorItems.forEach(function (it) {
          if (it.type === "forum" && it.emptyForum) it.markDelete = true;
        });
        renderEditor();
        var st = $("traSaveStatus");
        if (st) st.textContent = "Empty forums marked for delete — click Apply to remove them.";
      });
    }
  }

  function wireEditorInputs() {
    document
      .querySelectorAll(
        ".tra-due-input, .tra-start-input, .tra-end-input, .tra-name-input, .tra-delete-cb, .tra-body-input"
      )
      .forEach(function (el) {
        el.addEventListener("change", onEditorFieldChange);
        el.addEventListener("input", onEditorFieldChange);
      });
    document.querySelectorAll(".tra-add-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addDraftItem(btn.getAttribute("data-add-type"));
      });
    });
  }

  function onEditorFieldChange(ev) {
    var el = ev.target;
    var idx = parseInt(el.getAttribute("data-idx"), 10);
    var item = STATE.editorItems[idx];
    if (!item) return;
    var tr = el.closest("tr");
    if (el.classList.contains("tra-delete-cb")) {
      item.markDelete = !!el.checked;
      if (BE && BE.markRowState) BE.markRowState(tr, item.markDelete ? "dd-changed" : null);
      // If every topic in a forum is marked for delete, offer to remove the forum too.
      if (item.type === "discussion" && item.markDelete && item.forumId) {
        var siblings = STATE.editorItems.filter(function (it) {
          return it.type === "discussion" && String(it.forumId) === String(item.forumId);
        });
        var allMarked =
          siblings.length > 0 &&
          siblings.every(function (it) {
            return it.markDelete;
          });
        if (allMarked) {
          var forumName = item.forumName || "this forum";
          if (
            window.confirm(
              'All topics in "' +
                forumName +
                '" are marked for delete.\n\nAlso remove the empty forum when you Apply?'
            )
          ) {
            var forumItem = STATE.editorItems.find(function (it) {
              return it.type === "forum" && String(it.id) === String(item.forumId);
            });
            if (!forumItem) {
              forumItem = makeEditorItem({
                type: "forum",
                id: item.forumId,
                forumId: item.forumId,
                name: forumName,
                emptyForum: true,
                markDelete: true,
                original: null
              });
              STATE.editorItems.push(forumItem);
            } else {
              forumItem.markDelete = true;
            }
            renderEditor();
          }
        }
      }
      return;
    }
    if (el.classList.contains("tra-name-input")) item.newName = el.value;
    if (el.classList.contains("tra-due-input")) {
      item.newDue = el.value || null;
      syncActivityDateInputs(item, tr);
    }
    if (el.classList.contains("tra-start-input")) {
      item.newStart = el.value || null;
      syncActivityDateInputs(item, tr);
    }
    if (el.classList.contains("tra-end-input")) {
      item.newEnd = el.value || null;
      syncActivityDateInputs(item, tr);
    }
    if (el.classList.contains("tra-body-input")) {
      item.draftBody = el.value;
      var snapshot = item.originalBodySnapshot;
      if (snapshot == null) snapshot = newsBodyText(item.original);
      item.bodyTouched =
        normalizeNewsBodyText(item.draftBody) !== normalizeNewsBodyText(snapshot);
    }

    var changed =
      item.isNew ||
      item.markDelete ||
      (item.newName != null && item.newName !== item.name) ||
      (item.newDue != null && item.newDue !== dateOnlyFromIso(dueFieldFor(item))) ||
      (item.newStart != null && item.newStart !== dateOnlyFromIso(availStartFor(item))) ||
      (item.newEnd != null && item.newEnd !== dateOnlyFromIso(availEndFor(item))) ||
      (item.type === "announcement" &&
        item.bodyTouched &&
        normalizeNewsBodyText(item.draftBody) !==
          normalizeNewsBodyText(
            item.originalBodySnapshot != null
              ? item.originalBodySnapshot
              : newsBodyText(item.original)
          ));
    if (BE && BE.markRowState) BE.markRowState(tr, changed ? "dd-changed" : null);
  }

  async function openEditor() {
    show($("traStepEditor"));
    await loadTargetEditor();
    $("traStepEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadTargetEditor() {
    var ouId = STATE.targetId;
    var meta = $("traEditorMeta");
    if (meta) meta.textContent = "Loading from " + STATE.targetLabel + "…";

    var dropbox = [];
    var quizzes = [];
    try {
      dropbox = API
        ? await API.dropboxFolders(ouId)
        : await getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ouId + "/dropbox/folders/");
    } catch (e) {
      dropbox = [];
    }
    if (!Array.isArray(dropbox)) dropbox = dropbox && dropbox.Objects ? dropbox.Objects : [];

    try {
      quizzes = API
        ? await API.quizzes(ouId)
        : await getJson("/d2l/api/le/" + LE_QUIZ + "/" + ouId + "/quizzes/");
    } catch (e) {
      quizzes = [];
    }
    if (!Array.isArray(quizzes)) quizzes = quizzes && quizzes.Objects ? quizzes.Objects : [];

    var discussions = await loadForumsAndTopics(ouId);
    var modules = await loadModules(ouId);
    var announcements = await loadAnnouncements(ouId);

    STATE.editorItems = []
      .concat(
        dropbox.map(function (f) {
          return makeEditorItem({
            type: "assignment",
            id: f.Id || f.FolderId,
            name: f.Name || "Untitled assignment",
            dueDate: f.DueDate || null,
            startDate: f.Availability && f.Availability.StartDate,
            endDate: f.Availability && f.Availability.EndDate,
            original: f
          });
        })
      )
      .concat(
        quizzes.map(function (q) {
          return makeEditorItem({
            type: "quiz",
            id: q.QuizId || q.Id,
            name: q.Name || "Untitled quiz",
            dueDate: q.DueDate || null,
            startDate: q.StartDate || null,
            endDate: q.EndDate || null,
            original: q
          });
        })
      )
      .concat(
        discussions.map(function (d) {
          return makeEditorItem({
            type: "discussion",
            id: d.id,
            forumId: d.forumId,
            forumName: d.forumName,
            name: d.name,
            dueDate: d.dueDate,
            startDate: d.original && d.original.StartDate,
            endDate: d.original && d.original.EndDate,
            original: d.original
          });
        })
      )
      .concat(
        emptyForumsFromState().map(function (f) {
          return makeEditorItem({
            type: "forum",
            id: f.id,
            forumId: f.id,
            name: f.name,
            original: f.original,
            markDelete: false,
            emptyForum: true
          });
        })
      )
      .concat(
        modules.map(function (m) {
          return makeEditorItem({
            type: "module",
            id: m.id,
            name: m.name,
            startDate: m.startDate,
            endDate: m.endDate,
            depth: m.depth,
            original: m.original
          });
        })
      )
      .concat(
        announcements.map(function (a) {
          return makeEditorItem({
            type: "announcement",
            id: a.id,
            name: a.name,
            startDate: a.startDate,
            endDate: a.endDate,
            draftBody: a.draftBody || "",
            originalBodySnapshot: a.draftBody || "",
            bodyTouched: false,
            original: a.original
          });
        })
      );

    attachPendingAddsToEditor();
    if (meta) {
      meta.textContent =
        "Upcoming: " + STATE.targetLabel + " · " + STATE.editorItems.length + " items";
    }
    renderEditor();
  }

  async function fetchFreshOriginal(item) {
    var ou = STATE.targetId;
    if (item.type === "module") {
      return getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/content/modules/" + item.id);
    }
    if (item.type === "announcement") {
      return getJson("/d2l/api/le/" + LE_NEWS + "/" + ou + "/news/" + item.id).catch(function () {
        return getJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/news/" + item.id);
      });
    }
    // Assignments / quizzes / discussions: use the list readback (item.original).
    // A single-item GET often returns a richer shape that 400s on PUT
    // (JSON Binding Error) — same pattern as Due Date Wizard.
    return item.original;
  }

  /**
   * Build Quiz.QuizData for LE 1.82+ PUT/POST (July 2026 Valence docs).
   * Required extras: PagingTypeId (1.78+), HideQuestionPoints (1.88+),
   * IsSingleSession (1.92+). Do not use obsolete LE 1.74.
   */
  function quizRtFieldLocal(composite) {
    if (BE && typeof BE.richTextOut === "function") {
      return {
        Text: BE.richTextOut(composite && composite.Text),
        IsDisplayed: !!(composite && composite.IsDisplayed)
      };
    }
    var inner = composite && composite.Text;
    var text = { Content: "", Type: "Text" };
    if (typeof inner === "string") {
      text = { Content: inner, Type: /<\w+/.test(inner) ? "Html" : "Text" };
    } else if (inner && typeof inner.Html === "string" && inner.Html.trim()) {
      text = { Content: inner.Html, Type: "Html" };
    } else if (inner && typeof inner.Text === "string" && inner.Text) {
      text = { Content: inner.Text, Type: "Text" };
    } else if (inner && typeof inner.Content === "string") {
      text = { Content: inner.Content, Type: inner.Type || "Text" };
    }
    return { Text: text, IsDisplayed: !!(composite && composite.IsDisplayed) };
  }

  function buildQuizPutBody(orig, overrides) {
    if (BE && typeof BE.buildQuizUpdateBody === "function") {
      var shared = BE.buildQuizUpdateBody(orig, overrides || {});
      var winShared = normalizeQuizDateWindow(shared.StartDate, shared.DueDate, shared.EndDate);
      shared.StartDate = winShared.StartDate;
      shared.DueDate = winShared.DueDate;
      shared.EndDate = winShared.EndDate;
      return shared;
    }
    overrides = overrides || {};
    var flatAttempts =
      orig.AttemptsAllowed && orig.AttemptsAllowed.IsUnlimited
        ? null
        : orig.AttemptsAllowed
          ? Number(orig.AttemptsAllowed.NumberOfAttemptsAllowed)
          : orig.NumberOfAttemptsAllowed != null
            ? Number(orig.NumberOfAttemptsAllowed)
            : null;
    if (flatAttempts != null && (isNaN(flatAttempts) || flatAttempts < 1 || flatAttempts > 10)) {
      flatAttempts = null;
    }
    var autoExport = !!orig.AutoExportToGrades && orig.GradeItemId != null;
    var startDate = overrides.StartDate !== undefined ? overrides.StartDate : orig.StartDate;
    var endDate = overrides.EndDate !== undefined ? overrides.EndDate : orig.EndDate;
    var dueDate = overrides.DueDate !== undefined ? overrides.DueDate : orig.DueDate;
    var windowed = normalizeQuizDateWindow(startDate, dueDate, endDate);
    startDate = windowed.StartDate;
    dueDate = windowed.DueDate;
    endDate = windowed.EndDate;

    var password = orig.Password;
    if (password != null && String(password).trim() === "") password = null;
    var email = orig.NotificationEmail;
    if (email != null && String(email).trim() === "") email = null;

    var displayInCalendar =
      overrides.DisplayInCalendar !== undefined
        ? !!overrides.DisplayInCalendar
        : !!orig.DisplayInCalendar;
    if (displayInCalendar && !startDate && !endDate && dueDate) endDate = dueDate;
    if (displayInCalendar && !startDate && !endDate) displayInCalendar = false;

    var late = orig.LateSubmissionInfo || {};
    var lateOpt = Number(late.LateSubmissionOption);
    if (isNaN(lateOpt) || lateOpt === 1) lateOpt = lateOpt === 1 ? 2 : 0;

    var tl = orig.SubmissionTimeLimit || {};
    var tlValue = Number(tl.TimeLimitValue != null ? tl.TimeLimitValue : tl.TimeLimit);
    if (isNaN(tlValue) || tlValue < 0) tlValue = 0;
    if (tlValue > 9999) tlValue = 9999;
    var tlEnforced = !!(tl.IsEnforced || tl.Enforced);

    var deduction = orig.DeductionPercentage;
    if (deduction != null) {
      deduction = Number(deduction);
      if (isNaN(deduction) || deduction < 0 || deduction > 100) deduction = null;
    }

    return {
      Name: overrides.Name !== undefined ? overrides.Name : orig.Name,
      IsActive: overrides.IsActive !== undefined ? !!overrides.IsActive : !!orig.IsActive,
      SortOrder: orig.SortOrder != null ? Number(orig.SortOrder) || 1 : 1,
      AutoExportToGrades: autoExport,
      GradeItemId: orig.GradeItemId != null ? orig.GradeItemId : null,
      IsAutoSetGraded: !!orig.IsAutoSetGraded,
      Instructions: quizRtFieldLocal(orig.Instructions),
      Description: quizRtFieldLocal(orig.Description),
      Header: quizRtFieldLocal(orig.Header),
      Footer: quizRtFieldLocal(orig.Footer),
      StartDate: startDate || null,
      EndDate: endDate || null,
      DueDate: dueDate || null,
      DisplayInCalendar: displayInCalendar,
      NumberOfAttemptsAllowed: flatAttempts,
      LateSubmissionInfo: { LateSubmissionOption: lateOpt, LateLimitMinutes: null },
      SubmissionTimeLimit: {
        IsEnforced: tlEnforced,
        ShowClock: tl.ShowClock != null ? !!tl.ShowClock : tlEnforced,
        TimeLimitValue: tlValue
      },
      SubmissionGracePeriod:
        typeof orig.SubmissionGracePeriod === "number" ? orig.SubmissionGracePeriod : 0,
      Password: password,
      AllowHints: !!orig.AllowHints,
      DisableRightClick: !!orig.DisableRightClick,
      DisablePagerAndAlerts: !!orig.DisablePagerAndAlerts,
      NotificationEmail: email,
      CalcTypeId: orig.CalcTypeId != null ? Number(orig.CalcTypeId) || 1 : 1,
      RestrictIPAddressRange:
        orig.RestrictIPAddressRange && orig.RestrictIPAddressRange.length
          ? orig.RestrictIPAddressRange
          : null,
      CategoryId: orig.CategoryId != null ? orig.CategoryId : null,
      PreventMovingBackwards: !!orig.PreventMovingBackwards,
      Shuffle: !!orig.Shuffle,
      AllowOnlyUsersWithSpecialAccess: !!orig.AllowOnlyUsersWithSpecialAccess,
      IsRetakeIncorrectOnly: !!orig.IsRetakeIncorrectOnly,
      PagingTypeId: orig.PagingTypeId != null ? Number(orig.PagingTypeId) : 0,
      IsSynchronous: !!orig.IsSynchronous,
      DeductionPercentage: deduction,
      HideQuestionPoints: !!orig.HideQuestionPoints,
      IsSingleSession: !!orig.IsSingleSession
    };
  }

  async function putQuiz(ou, quizId, orig, overrides) {
    var body = buildQuizPutBody(orig, overrides || {});
    await putJson(
      "/d2l/api/le/" +
        LE_QUIZ +
        "/" +
        encodeURIComponent(ou) +
        "/quizzes/" +
        encodeURIComponent(quizId),
      body
    );
    return body;
  }

  function newsBodyText(n) {
    if (!n || !n.Body) return "";
    if (typeof n.Body === "string") return n.Body;
    var t = n.Body.Text;
    if (typeof t === "string") return t;
    // Some tenants nest RichText oddly — never return a non-string.
    if (t && typeof t === "object") {
      if (typeof t.Text === "string") return t.Text;
      if (typeof t.Html === "string") return t.Html;
    }
    if (typeof n.Body.Html === "string") return n.Body.Html;
    return "";
  }

  function newsBodyHtml(n) {
    if (!n || !n.Body) return null;
    if (typeof n.Body === "string") return null;
    var html = n.Body.Html;
    if (html && typeof html === "object") {
      html = html.Html || html.Text || null;
    }
    // Docs: never send empty-string Html for text-only bodies — use null.
    if (html == null || String(html).trim() === "") return null;
    return String(html);
  }

  function normalizeNewsBodyText(s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").trim();
  }

  function newsRichTextOut(orig, editedText) {
    if (editedText !== undefined) {
      var edited = editedText == null ? "" : String(editedText);
      if (/<\w/.test(edited)) {
        return {
          Text: edited.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || edited,
          Html: edited
        };
      }
      return { Text: edited, Html: null };
    }
    return {
      Text: newsBodyText(orig) || "",
      Html: newsBodyHtml(orig)
    };
  }

  function buildNewsUpdateBody(orig, overrides) {
    overrides = overrides || {};
    var bodyOut = newsRichTextOut(orig, overrides.BodyText);

    var startDate =
      overrides.StartDate !== undefined ? overrides.StartDate : orig.StartDate;
    // NewsItemData.StartDate is required (non-null) on PUT.
    if (!startDate) startDate = new Date().toISOString();

    var endDate = overrides.EndDate !== undefined ? overrides.EndDate : orig.EndDate;
    if (endDate === "") endDate = null;

    return {
      Title: String(overrides.Title !== undefined ? overrides.Title : orig.Title || ""),
      Body: bodyOut,
      StartDate: startDate,
      EndDate: endDate,
      IsGlobal: !!orig.IsGlobal,
      IsPublished:
        overrides.IsPublished !== undefined
          ? !!overrides.IsPublished
          : orig.IsPublished !== false,
      ShowOnlyInCourseOfferings: !!orig.ShowOnlyInCourseOfferings,
      IsAuthorInfoShown: !!orig.IsAuthorInfoShown,
      IsPinned: overrides.IsPinned !== undefined ? !!overrides.IsPinned : !!orig.IsPinned,
      IsStartDateShown:
        typeof orig.IsStartDateShown === "boolean" ? orig.IsStartDateShown : true,
      SortOrder: orig.SortOrder != null ? Number(orig.SortOrder) || 0 : 0
    };
  }

  /** PUT news uses JSON body (docs); multipart is for create-with-attachments. */
  async function putNewsItem(ou, newsId, nBody) {
    var url =
      "/d2l/api/le/" + LE_NEWS + "/" + encodeURIComponent(ou) + "/news/" + encodeURIComponent(newsId);
    try {
      return await putJson(url, nBody);
    } catch (jsonErr) {
      // Fall back to multipart (same path Bulk Announcement Scheduler uses).
      try {
        return await putMultipart(url, nBody);
      } catch (multiErr) {
        try {
          console.warn(
            "[TermRollover] news PUT failed. Body sample:",
            JSON.stringify(nBody).slice(0, 600)
          );
        } catch (diag) {
          /* ignore */
        }
        throw jsonErr;
      }
    }
  }

  async function ensureDiscussionForum(ou) {
    if (STATE.forums && STATE.forums.length) return STATE.forums[0].id;
    var created = await postJson(
      "/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/discussions/forums/",
      {
        Name: "Course Discussions",
        Description: { Text: "", Html: null },
        ShowDescriptionInTopics: false,
        StartDate: null,
        EndDate: null,
        PostStartDate: null,
        PostEndDate: null,
        AllowAnonymous: false,
        IsLocked: false,
        IsHidden: false,
        RequiresApproval: false,
        MustPostToParticipate: false,
        DisplayInCalendar: false,
        DisplayPostDatesInCalendar: false,
        StartDateAvailabilityType: null,
        EndDateAvailabilityType: null
      }
    );
    var fid = created && (created.ForumId || created.Id);
    if (!fid) throw new Error("Could not create a discussion forum for new topics");
    STATE.forums = [{ id: fid, name: "Course Discussions", original: created }];
    return fid;
  }

  async function createItem(item) {
    var ou = STATE.targetId;
    var name = (item.newName != null ? item.newName : item.name || "").trim();
    if (!name) throw new Error("New items need a name");
    var dueIso = item.newDue ? isoFromDateOnly(item.newDue, true) : null;
    var startIso = item.newDue ? isoFromDateOnly(item.newDue, false) : null;
    var endIso = item.newEnd ? isoFromDateOnly(item.newEnd, true) : null;

    if (item.type === "assignment") {
      await postJson("/d2l/api/le/" + LE_DROPBOX + "/" + ou + "/dropbox/folders/", {
        CategoryId: null,
        Name: name,
        CustomInstructions: { Content: "", Type: "Text" },
        Availability: null,
        GroupTypeId: null,
        DueDate: dueIso,
        DisplayInCalendar: !!dueIso,
        NotificationEmail: null,
        IsHidden: false,
        Assessment: { ScoreDenominator: 100 },
        IsAnonymous: false,
        DropboxType: 2,
        SubmissionType: 0,
        CompletionType: 0,
        GradeItemId: null,
        AllowOnlyUsersWithSpecialAccess: false
      });
      return;
    }

    if (item.type === "quiz") {
      var emptyRt = { Text: { Content: "", Type: "Text" }, IsDisplayed: false };
      await postJson("/d2l/api/le/" + LE_QUIZ + "/" + ou + "/quizzes/", {
        Name: name,
        IsActive: true,
        SortOrder: 1,
        AutoExportToGrades: false,
        GradeItemId: null,
        IsAutoSetGraded: false,
        Instructions: emptyRt,
        Description: emptyRt,
        Header: emptyRt,
        Footer: emptyRt,
        StartDate: null,
        EndDate: dueIso || null,
        DueDate: dueIso,
        DisplayInCalendar: !!dueIso,
        NumberOfAttemptsAllowed: null,
        LateSubmissionInfo: { LateSubmissionOption: 0, LateLimitMinutes: null },
        SubmissionTimeLimit: { IsEnforced: false, ShowClock: false, TimeLimitValue: 0 },
        SubmissionGracePeriod: 0,
        Password: null,
        AllowHints: false,
        DisableRightClick: false,
        DisablePagerAndAlerts: false,
        NotificationEmail: null,
        CalcTypeId: 1,
        RestrictIPAddressRange: null,
        CategoryId: null,
        PreventMovingBackwards: false,
        Shuffle: false,
        AllowOnlyUsersWithSpecialAccess: false,
        IsRetakeIncorrectOnly: false,
        PagingTypeId: 0,
        IsSynchronous: false,
        DeductionPercentage: null,
        HideQuestionPoints: false,
        IsSingleSession: false
      });
      return;
    }

    if (item.type === "discussion") {
      var forumId = item.forumId || (await ensureDiscussionForum(ou));
      await postJson(
        "/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/discussions/forums/" + forumId + "/topics/",
        {
          Name: name,
          Description: { Content: "", Type: "Text" },
          AllowAnonymousPosts: false,
          StartDate: null,
          EndDate: null,
          IsHidden: false,
          UnlockStartDate: null,
          UnlockEndDate: null,
          RequiresApproval: false,
          ScoreOutOf: null,
          IsAutoScore: false,
          IncludeNonScoredValues: false,
          ScoringType: null,
          IsLocked: false,
          MustPostToParticipate: false,
          RatingType: null,
          DisplayInCalendar: false,
          DisplayUnlockDatesInCalendar: false,
          GroupTypeId: null,
          StartDateAvailabilityType: null,
          EndDateAvailabilityType: null,
          DueDate: dueIso
        }
      );
      return;
    }

    if (item.type === "module") {
      await postJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/content/root/", {
        Title: name,
        ShortTitle: null,
        Type: 0,
        ModuleStartDate: startIso,
        ModuleEndDate: endIso,
        ModuleDueDate: null,
        IsHidden: false,
        IsLocked: false,
        Description: { Content: "", Type: "Text" }
      });
      return;
    }

    if (item.type === "announcement") {
      var bodyText = (item.draftBody || "").trim() || name;
      var payload = {
        Title: name,
        Body: { Text: bodyText, Html: null },
        StartDate: startIso || new Date().toISOString(),
        EndDate: endIso,
        IsGlobal: false,
        IsPublished: true,
        ShowOnlyInCourseOfferings: false,
        IsAuthorInfoShown: false,
        IsPinned: false,
        IsStartDateShown: true,
        SortOrder: 0
      };
      await postMultipart("/d2l/api/le/" + LE_NEWS + "/" + ou + "/news/", payload);
      return;
    }

    throw new Error("Unsupported create type: " + item.type);
  }

  async function applyItemUpdate(item) {
    var ou = STATE.targetId;

    if (item.isNew) {
      if (item.markDelete) return "skipped";
      await createItem(item);
      if (item.pendingId) {
        STATE.pendingAdds = (STATE.pendingAdds || []).filter(function (p) {
          return p.id !== item.pendingId;
        });
      }
      return "created";
    }

    if (item.markDelete) {
      if (item.type === "assignment") {
        await deleteJson("/d2l/api/le/" + LE_DROPBOX + "/" + ou + "/dropbox/folders/" + item.id);
      } else if (item.type === "quiz") {
        await deleteJson("/d2l/api/le/" + LE_QUIZ + "/" + ou + "/quizzes/" + item.id);
      } else if (item.type === "discussion") {
        await deleteJson(
          "/d2l/api/le/" +
            LE_DEFAULT +
            "/" +
            ou +
            "/discussions/forums/" +
            item.forumId +
            "/topics/" +
            item.id
        );
      } else if (item.type === "forum") {
        await deleteForum(item.id);
      } else if (item.type === "module") {
        await deleteJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/content/modules/" + item.id);
      } else if (item.type === "announcement") {
        await deleteJson("/d2l/api/le/" + LE_NEWS + "/" + ou + "/news/" + item.id).catch(function () {
          return deleteJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/news/" + item.id);
        });
      }
      return "deleted";
    }

    var nameChanged = item.newName != null && item.newName !== item.name;
    var dueChanged =
      item.newDue != null &&
      item.newDue !== "" &&
      item.newDue !== dateOnlyFromIso(dueFieldFor(item));
    var startChanged =
      item.newStart != null &&
      item.newStart !== "" &&
      item.newStart !== dateOnlyFromIso(availStartFor(item));
    var endChanged =
      item.newEnd != null &&
      item.newEnd !== "" &&
      item.newEnd !== dateOnlyFromIso(availEndFor(item));
    var bodyChanged = !!(
      item.type === "announcement" &&
      item.bodyTouched &&
      normalizeNewsBodyText(item.draftBody) !==
        normalizeNewsBodyText(
          item.originalBodySnapshot != null
            ? item.originalBodySnapshot
            : newsBodyText(item.original)
        )
    );

    if (!nameChanged && !dueChanged && !startChanged && !endChanged && !bodyChanged) {
      return "skipped";
    }

    // Activity dates: due @ 11:59, available-from @ 00:00, available-until @ 11:59
    var dueIso = dueChanged
      ? isoFromDateOnly(item.newDue, true)
      : dueFieldFor(item) || null;
    var availStartIso = startChanged
      ? isoFromDateOnly(item.newStart, false)
      : availStartFor(item) || null;
    var availEndIso = endChanged
      ? isoFromDateOnly(item.newEnd, true)
      : availEndFor(item) || null;

    if (hasActivityDates(item.type)) {
      var beforeStart = availStartIso;
      var beforeDue = dueIso;
      var beforeEnd = availEndIso;
      var win = normalizeQuizDateWindow(availStartIso, dueIso, availEndIso);
      if (win.fixed) {
        console.info(
          "[TermRollover] adjusted date window for",
          item.name,
          "→ start",
          win.StartDate,
          "due",
          win.DueDate,
          "end",
          win.EndDate
        );
      }
      availStartIso = win.StartDate;
      dueIso = win.DueDate;
      availEndIso = win.EndDate;
      if (availStartIso !== beforeStart) startChanged = true;
      if (dueIso !== beforeDue) dueChanged = true;
      if (availEndIso !== beforeEnd) endChanged = true;
    }

    // Modules / announcements reuse newDue as start and newEnd as end
    var moduleStartIso = dueChanged ? isoFromDateOnly(item.newDue, false) : undefined;
    var moduleEndIso = endChanged ? isoFromDateOnly(item.newEnd, true) : undefined;

    if (item.type === "assignment") {
      var dBody = BE.buildDropboxUpdateBody(item.original, {
        DueDate: dueChanged ? dueIso : undefined,
        StartDate: startChanged ? availStartIso : undefined,
        EndDate: endChanged || dueChanged ? availEndIso : undefined
      });
      if (nameChanged) dBody.Name = item.newName;
      await putJson("/d2l/api/le/" + LE_DROPBOX + "/" + ou + "/dropbox/folders/" + item.id, dBody);
      if (dueChanged) item.original.DueDate = dueIso;
      if (startChanged || endChanged || dueChanged) {
        item.original.Availability = item.original.Availability || {};
        if (availStartIso !== undefined) item.original.Availability.StartDate = availStartIso;
        if (availEndIso !== undefined) item.original.Availability.EndDate = availEndIso;
      }
      if (nameChanged) {
        item.original.Name = item.newName;
        item.name = item.newName;
      }
    } else if (item.type === "quiz") {
      var quizOverrides = {
        DueDate: dueChanged ? dueIso : undefined,
        StartDate: startChanged ? availStartIso : undefined,
        EndDate: endChanged || dueChanged ? availEndIso : undefined,
        Name: nameChanged ? item.newName : undefined
      };
      var savedQuizBody = await putQuiz(ou, item.id, item.original, quizOverrides);
      if (dueChanged) item.original.DueDate = dueIso;
      if (startChanged) item.original.StartDate = availStartIso;
      if (endChanged || dueChanged) {
        item.original.EndDate =
          savedQuizBody && savedQuizBody.EndDate != null ? savedQuizBody.EndDate : availEndIso;
      }
      if (nameChanged) {
        item.original.Name = item.newName;
        item.name = item.newName;
      }
    } else if (item.type === "discussion") {
      var tBody = BE.buildDiscussionTopicUpdateBody(item.original, {
        DueDate: dueChanged ? dueIso : undefined,
        StartDate: startChanged ? availStartIso : undefined,
        EndDate: endChanged || dueChanged ? availEndIso : undefined,
        Name: nameChanged ? item.newName : undefined
      });
      if (tBody.DueDate && tBody.EndDate) {
        tBody.EndDate = resolveEndWithDue(tBody.DueDate, tBody.EndDate);
      }
      await putJson(
        "/d2l/api/le/" +
          LE_DEFAULT +
          "/" +
          ou +
          "/discussions/forums/" +
          item.forumId +
          "/topics/" +
          item.id,
        tBody
      );
      if (dueChanged) item.original.DueDate = dueIso;
      if (startChanged) item.original.StartDate = availStartIso;
      if (endChanged || dueChanged) item.original.EndDate = tBody.EndDate != null ? tBody.EndDate : availEndIso;
      if (nameChanged) {
        item.original.Name = item.newName;
        item.name = item.newName;
      }
    } else if (item.type === "module") {
      var freshM = await fetchFreshOriginal(item);
      var modBody = {
        Title: nameChanged ? item.newName : freshM.Title || item.name,
        ShortTitle: freshM.ShortTitle != null ? freshM.ShortTitle : null,
        Type: 0,
        ModuleStartDate: dueChanged
          ? moduleStartIso
          : freshM.StartDateTime || freshM.ModuleStartDate || null,
        ModuleEndDate: endChanged
          ? moduleEndIso
          : freshM.EndDateTime || freshM.ModuleEndDate || null,
        ModuleDueDate: freshM.ModuleDueDate || null,
        IsHidden: !!freshM.IsHidden,
        IsLocked: !!freshM.IsLocked,
        Description: freshM.Description || { Content: "", Type: "Text" }
      };
      await putJson("/d2l/api/le/" + LE_DEFAULT + "/" + ou + "/content/modules/" + item.id, modBody);
    } else if (item.type === "announcement") {
      var freshN = item.original || (await fetchFreshOriginal(item));
      var nBody = buildNewsUpdateBody(freshN, {
        Title: nameChanged ? item.newName : undefined,
        StartDate: dueChanged ? moduleStartIso : undefined,
        EndDate: endChanged ? moduleEndIso : undefined,
        // Only replace Body when the user edited it; otherwise echo original RichText.
        BodyText: bodyChanged ? item.draftBody : undefined
      });
      if (!dueChanged && freshN.StartDate) nBody.StartDate = freshN.StartDate;
      if (!endChanged) nBody.EndDate = freshN.EndDate || null;
      if (nameChanged) nBody.Title = item.newName;
      await putNewsItem(ou, item.id, nBody);
      if (bodyChanged) {
        item.original.Body = nBody.Body;
        item.originalBodySnapshot = item.draftBody || "";
        item.bodyTouched = false;
      }
      if (nameChanged) {
        item.original.Title = item.newName;
        item.name = item.newName;
      }
      if (dueChanged) {
        item.original.StartDate = nBody.StartDate;
        item.startDate = nBody.StartDate;
      }
      if (endChanged) {
        item.original.EndDate = nBody.EndDate;
        item.endDate = nBody.EndDate;
      }
    }
    return "updated";
  }

  function itemIsPending(it) {
    if (it.isNew) return true;
    if (it.markDelete) return true;
    if (it.newName != null && it.newName !== it.name) return true;
    if (it.newDue != null && it.newDue !== "" && it.newDue !== dateOnlyFromIso(dueFieldFor(it))) {
      return true;
    }
    if (
      it.newStart != null &&
      it.newStart !== "" &&
      it.newStart !== dateOnlyFromIso(availStartFor(it))
    ) {
      return true;
    }
    if (it.newEnd != null && it.newEnd !== "" && it.newEnd !== dateOnlyFromIso(availEndFor(it))) {
      return true;
    }
    if (
      it.type === "announcement" &&
      it.bodyTouched &&
      normalizeNewsBodyText(it.draftBody) !==
        normalizeNewsBodyText(
          it.originalBodySnapshot != null ? it.originalBodySnapshot : newsBodyText(it.original)
        )
    ) {
      return true;
    }
    return false;
  }

  async function applyChanges() {
    if (STATE.busy) return;
    if (!BE) {
      alert("Bulk editor helpers failed to load.");
      return;
    }

    // Re-read announcement textareas so bodyTouched matches what's on screen.
    document.querySelectorAll(".tra-body-input").forEach(function (el) {
      var idx = parseInt(el.getAttribute("data-idx"), 10);
      var it = STATE.editorItems[idx];
      if (!it || it.type !== "announcement") return;
      it.draftBody = el.value;
      var snap =
        it.originalBodySnapshot != null ? it.originalBodySnapshot : newsBodyText(it.original);
      it.bodyTouched =
        normalizeNewsBodyText(it.draftBody) !== normalizeNewsBodyText(snap);
    });

    var pending = STATE.editorItems.filter(itemIsPending);
    if (!pending.length) {
      $("traSaveStatus").textContent = "No changes to apply.";
      return;
    }

    if (
      !window.confirm(
        "Apply " +
          pending.length +
          " change(s) to the upcoming course?\nDeletes cannot be undone from this tool."
      )
    ) {
      return;
    }

    STATE.busy = true;
    $("traSaveBtn").disabled = true;
    var status = $("traSaveStatus");
    var ok = 0;
    var fail = 0;

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var tr = document.querySelector('tr[data-idx="' + STATE.editorItems.indexOf(item) + '"]');
      status.textContent = "Saving " + (i + 1) + " of " + pending.length + "…";
      try {
        await applyItemUpdate(item);
        ok++;
        if (BE.markRowState) BE.markRowState(tr, "dd-row-saved");
      } catch (e) {
        fail++;
        console.error("[TermRollover] update failed", item.name || item.type, item, e);
        if (BE.markRowState) BE.markRowState(tr, "dd-row-fail");
        if (tr) tr.title = (e && e.message) || "Update failed";
      }
      await sleep(REQUEST_GAP_MS);
    }

    status.textContent =
      "Done — " +
      ok +
      " succeeded" +
      (fail ? ", " + fail + " failed (hover red rows for details)" : "") +
      ".";
    STATE.busy = false;
    $("traSaveBtn").disabled = false;

    if (ok) {
      // If topics were deleted, offer to remove forums that are now empty.
      var deletedTopicForums = pending.filter(function (it) {
        return it.type === "discussion" && it.markDelete;
      });
      if (deletedTopicForums.length) {
        try {
          var removed = await suggestRemoveEmptyForums({ refresh: true });
          if (removed) {
            status.textContent +=
              " Removed " + removed + " empty forum" + (removed === 1 ? "" : "s") + ".";
          }
        } catch (e) {
          console.warn("[TermRollover] empty forum cleanup skipped", e);
        }
      }
      await loadTargetEditor();
    }
  }

  function syncCourseButtons() {
    var btn = $("traLoadInventoryBtn");
    if (btn) btn.disabled = !(STATE.targetId && STATE.sourceId && STATE.targetId !== STATE.sourceId);
    var openBtn = $("traOpenEditorOnlyBtn");
    if (openBtn) openBtn.disabled = !STATE.targetId;
  }

  function onTargetChange() {
    var sel = $("traTargetCourse");
    var sourceSel = $("traSourceCourse");
    STATE.targetId = sel.value || null;
    STATE.targetLabel = courseLabel(sel);
    if (sourceSel) {
      sourceSel.disabled = !STATE.targetId;
      for (var i = 0; i < sourceSel.options.length; i++) {
        var opt = sourceSel.options[i];
        if (!opt.value) continue;
        opt.disabled = opt.value === String(STATE.targetId);
      }
      if (sourceSel.value === String(STATE.targetId)) {
        sourceSel.value = "";
        STATE.sourceId = null;
        STATE.sourceLabel = "";
      }
    }
    syncCourseButtons();
    setMeta(STATE.targetId ? "Destination: " + STATE.targetLabel : "");
  }

  function onSourceChange() {
    var sel = $("traSourceCourse");
    STATE.sourceId = sel.value || null;
    STATE.sourceLabel = courseLabel(sel);
    syncCourseButtons();
    if (STATE.sourceId && STATE.targetId) {
      setMeta("Ready to load materials from " + STATE.sourceLabel);
    }
  }

  async function onLoadInventory() {
    if (!STATE.targetId || !STATE.sourceId) return;
    if (STATE.busy) return;
    STATE.busy = true;
    $("traLoadInventoryBtn").disabled = true;
    try {
      await ensureXsrf();
      await loadSourceInventory();
      show($("traStepPackages"));
      $("traStepPackages").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error("[TermRollover] inventory failed", e);
      setMeta("Failed to load materials: " + (e.message || e));
      alert("Could not load course materials. " + (e.message || e));
    } finally {
      STATE.busy = false;
      syncCourseButtons();
    }
  }

  function wireDateOffsetUI() {
    var wrap = $("traDaysWrap");
    function sync() {
      var daysSelected = document.querySelector('input[name="traDateOffset"][value="days"]');
      if (wrap) wrap.hidden = !(daysSelected && daysSelected.checked);
    }
    document.querySelectorAll('input[name="traDateOffset"]').forEach(function (r) {
      r.addEventListener("change", sync);
    });
    sync();
  }

  async function init() {
    console.info("[TermRollover] build 20260823a");
    renderOtherComponents();
    wireDateOffsetUI();
    wirePackageIncludeToggles();

    var packageCards = $("traPackageCards");
    if (packageCards) {
      packageCards.addEventListener("click", onInventoryClick);
      packageCards.addEventListener("change", onInventoryChange);
      packageCards.addEventListener("keydown", onInventoryKeydown);
    }

    var targetSel = $("traTargetCourse");
    var sourceSel = $("traSourceCourse");

    if (window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(targetSel, {
        placeholderLabel: "Select upcoming (destination) course…"
      });
      await window.FacultyDashboardCourses.populateCourseSelect(sourceSel, {
        placeholderLabel: "Select past (source) course…"
      });
      sourceSel.disabled = true;
    }

    targetSel.addEventListener("change", onTargetChange);
    sourceSel.addEventListener("change", onSourceChange);
    $("traLoadInventoryBtn").addEventListener("click", onLoadInventory);
    $("traStartCopyBtn").addEventListener("click", runCopy);

    var openOnly = $("traOpenEditorOnlyBtn");
    if (openOnly) {
      openOnly.disabled = true;
      openOnly.addEventListener("click", async function () {
        if (!STATE.targetId) {
          alert("Select the upcoming (destination) course first.");
          return;
        }
        if (STATE.busy) return;
        STATE.busy = true;
        openOnly.disabled = true;
        try {
          await ensureXsrf();
          show($("traStepPackages"));
          await openEditor();
        } catch (e) {
          console.error("[TermRollover] open editor failed", e);
          alert("Could not open the editor. " + (e.message || e));
        } finally {
          STATE.busy = false;
          syncCourseButtons();
        }
      });
    }

    $("traSaveBtn").addEventListener("click", applyChanges);
    $("traReloadEditorBtn").addEventListener("click", function () {
      loadTargetEditor();
    });

    try {
      if (API && API.whoami) {
        var me = await API.whoami();
        if (me) {
          setMeta(
            "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim()
          );
        }
      }
    } catch (e) {
      /* fine */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
