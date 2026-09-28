/**
 * Bulk Announcement Scheduler — publish windows / pin / draft for news items.
 */
(function () {
  "use strict";

  var BE = window.BSP && window.BSP.BulkEditor;
  if (!BE) {
    console.error("[BulkAnnouncements] shared helpers missing");
    return;
  }

  var LE_NEWS = "1.93";

  var STATE = {
    courseId: null,
    courseLabel: "",
    items: [],
    busy: false
  };

  async function init() {
    await BE.wireCourseSelect("basCourse", loadCourse);
    document.getElementById("basSaveBtn").addEventListener("click", onSaveAll);
    document.getElementById("basApplyDatesBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var s = document.getElementById("basBulkStart").value;
        var e = document.getElementById("basBulkEnd").value;
        if (s) tr.querySelector(".bas-start").value = s;
        if (e) tr.querySelector(".bas-end").value = e;
      });
    });
    document.getElementById("basPublishBtn").addEventListener("click", function () {
      applyFlag(".bas-published", true);
    });
    document.getElementById("basDraftBtn").addEventListener("click", function () {
      applyFlag(".bas-published", false);
    });
    document.getElementById("basPinBtn").addEventListener("click", function () {
      applyFlag(".bas-pinned", true);
    });
    document.getElementById("basUnpinBtn").addEventListener("click", function () {
      applyFlag(".bas-pinned", false);
    });

    try {
      var me = await window.BSP.api.whoami();
      var meta = document.getElementById("basHeaderMeta");
      if (meta && me) {
        meta.textContent =
          "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
    } catch (e) {
      /* fine */
    }
  }

  function selectedRows() {
    return Array.from(document.querySelectorAll("#basEditor tbody tr")).filter(function (tr) {
      var cb = tr.querySelector(".bas-select");
      return cb && cb.checked;
    });
  }

  function applyToSelected(fn) {
    var rows = selectedRows();
    if (!rows.length) {
      document.getElementById("basSaveStatus").textContent = "Select one or more announcements first.";
      return;
    }
    rows.forEach(function (tr) {
      fn(tr);
      onRowInput.call(tr.querySelector(".bas-start") || tr);
    });
    document.getElementById("basSaveStatus").textContent =
      "Applied to " + rows.length + " announcement(s). Click Save to commit.";
  }

  function applyFlag(selector, value) {
    applyToSelected(function (tr) {
      var el = tr.querySelector(selector);
      if (el) el.checked = value;
    });
  }

  function newsBodyText(n) {
    if (!n || !n.Body) return "";
    if (typeof n.Body === "string") return n.Body;
    return n.Body.Text || n.Body.Html || "";
  }

  function newsBodyHtml(n) {
    if (!n || !n.Body) return null;
    if (typeof n.Body === "string") return null;
    return n.Body.Html || null;
  }

  async function loadCourse(ouId, label) {
    STATE.courseId = ouId;
    STATE.courseLabel = label || "Course " + ouId;
    var card = document.getElementById("basEditorCard");
    var heading = document.getElementById("basEditorHeading");
    var editor = document.getElementById("basEditor");
    var saveBar = document.getElementById("basSaveBar");
    card.style.display = "";
    document.getElementById("basBulkCard").style.display = "";
    heading.textContent = "Announcements · " + STATE.courseLabel;
    editor.innerHTML =
      '<div class="ldg" role="status"><div class="sp"></div><p>Loading announcements…</p></div>';
    saveBar.style.display = "none";
    document.getElementById("basSaveStatus").textContent = "";

    try {
      var data = await window.BSP.api
        .raw("/d2l/api/le/" + LE_NEWS + "/" + encodeURIComponent(ouId) + "/news/")
        .catch(function () {
          return window.BSP.api.raw(
            "/d2l/api/le/" + BE.LE + "/" + encodeURIComponent(ouId) + "/news/"
          );
        });
      var list = Array.isArray(data) ? data : (data && data.Items) || [];

      STATE.items = list.map(function (n) {
        return {
          id: n.Id,
          title: n.Title || "Announcement",
          startDate: n.StartDate || null,
          endDate: n.EndDate || null,
          isPublished: n.IsPublished !== false,
          isPinned: !!n.IsPinned,
          original: n
        };
      });
      renderEditor();
    } catch (e) {
      console.error("[BulkAnnouncements] load", e);
      editor.innerHTML =
        '<div class="empty"><h3>Couldn\'t load announcements</h3><p>' +
        BE.escapeHTML(e.message || "Unknown error") +
        "</p></div>";
    }
  }

  function renderEditor() {
    var editor = document.getElementById("basEditor");
    var saveBar = document.getElementById("basSaveBar");
    if (!STATE.items.length) {
      editor.innerHTML =
        '<div class="empty"><h3>No announcements</h3><p>This course has no news items yet.</p></div>';
      saveBar.style.display = "none";
      return;
    }

    var rows = STATE.items
      .map(function (it, idx) {
        return (
          '<tr data-idx="' +
          idx +
          '">' +
          '<td><input type="checkbox" class="bas-select" aria-label="Select ' +
          BE.escapeHTML(it.title) +
          '"></td>' +
          "<td>" +
          BE.escapeHTML(it.title) +
          "</td>" +
          '<td><input type="date" class="dd-input bas-start" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.startDate)) +
          '"></td>' +
          '<td><input type="date" class="dd-input bas-end" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.endDate)) +
          '"></td>' +
          '<td><input type="checkbox" class="bas-published" ' +
          (it.isPublished ? "checked" : "") +
          ' aria-label="Published"></td>' +
          '<td><input type="checkbox" class="bas-pinned" ' +
          (it.isPinned ? "checked" : "") +
          ' aria-label="Pinned"></td>' +
          "</tr>"
        );
      })
      .join("");

    editor.innerHTML =
      '<div class="accom-table-wrap"><table class="dd-table" role="grid">' +
      "<thead><tr>" +
      '<th style="width:4%"><input type="checkbox" id="basSelectAll" aria-label="Select all"></th>' +
      "<th>Title</th>" +
      '<th style="width:14%">Start</th>' +
      '<th style="width:14%">End</th>' +
      '<th style="width:10%">Published</th>' +
      '<th style="width:8%">Pinned</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";

    saveBar.style.display = "flex";
    document.getElementById("basSelectAll").addEventListener("change", function () {
      var on = this.checked;
      editor.querySelectorAll(".bas-select").forEach(function (cb) {
        cb.checked = on;
      });
    });
    editor
      .querySelectorAll(".bas-start, .bas-end, .bas-published, .bas-pinned")
      .forEach(function (el) {
        el.addEventListener("input", onRowInput);
        el.addEventListener("change", onRowInput);
      });
  }

  function readRow(tr, it) {
    var start = BE.isoFromDateOnly(tr.querySelector(".bas-start").value, false);
    var end = BE.isoFromDateOnly(tr.querySelector(".bas-end").value, true);
    var published = tr.querySelector(".bas-published").checked;
    var pinned = tr.querySelector(".bas-pinned").checked;
    return {
      start: start,
      end: end,
      published: published,
      pinned: pinned,
      dirty:
        (start || null) !== (it.startDate || null) ||
        (end || null) !== (it.endDate || null) ||
        published !== !!it.isPublished ||
        pinned !== !!it.isPinned
    };
  }

  function onRowInput() {
    var tr = this.closest("tr");
    var idx = parseInt(tr.dataset.idx, 10);
    var it = STATE.items[idx];
    if (!it) return;
    var r = readRow(tr, it);
    BE.markRowState(tr, r.dirty ? "dd-changed" : null);
  }

  function buildNewsUpdateBody(orig, overrides) {
    var text = newsBodyText(orig);
    var html = newsBodyHtml(orig);
    return {
      Title: orig.Title,
      Body: { Text: text, Html: html },
      StartDate: overrides.StartDate,
      EndDate: overrides.EndDate,
      IsGlobal: !!orig.IsGlobal,
      IsPublished: !!overrides.IsPublished,
      ShowOnlyInCourseOfferings: !!orig.ShowOnlyInCourseOfferings,
      IsAuthorInfoShown: !!orig.IsAuthorInfoShown,
      IsPinned: !!overrides.IsPinned,
      IsStartDateShown:
        typeof orig.IsStartDateShown === "boolean" ? orig.IsStartDateShown : true,
      SortOrder: orig.SortOrder != null ? orig.SortOrder : null
    };
  }

  async function onSaveAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    BE.setBusy(["basSaveBtn"], true);
    var status = document.getElementById("basSaveStatus");
    status.textContent = "Saving…";
    try {
      await BE.ensureXsrfToken();
    } catch (e) {
      /* continue */
    }

    var ok = 0;
    var fail = 0;
    var skipped = 0;
    var rows = Array.from(document.querySelectorAll("#basEditor tbody tr"));

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var idx = parseInt(tr.dataset.idx, 10);
      var it = STATE.items[idx];
      if (!it) continue;
      var r = readRow(tr, it);
      if (!r.dirty) {
        skipped++;
        continue;
      }
      if (!r.start) {
        BE.markRowState(tr, "dd-row-fail");
        fail++;
        continue;
      }

      try {
        var body = buildNewsUpdateBody(it.original, {
          StartDate: r.start,
          EndDate: r.end,
          IsPublished: r.published,
          IsPinned: r.pinned
        });
        await BE.putMultipart(
          "/d2l/api/le/" +
            LE_NEWS +
            "/" +
            encodeURIComponent(STATE.courseId) +
            "/news/" +
            encodeURIComponent(it.id),
          body
        );
        it.startDate = r.start;
        it.endDate = r.end;
        it.isPublished = r.published;
        it.isPinned = r.pinned;
        Object.assign(it.original, {
          StartDate: r.start,
          EndDate: r.end,
          IsPublished: r.published,
          IsPinned: r.pinned
        });
        BE.markRowState(tr, "dd-row-saved");
        ok++;
      } catch (e) {
        console.warn("[BulkAnnouncements] save fail", it.title, e);
        BE.markRowState(tr, "dd-row-fail");
        fail++;
      }
    }

    status.textContent =
      "Saved " + ok + ", failed " + fail + (skipped ? ", unchanged " + skipped : "") + ".";
    STATE.busy = false;
    BE.setBusy(["basSaveBtn"], false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
