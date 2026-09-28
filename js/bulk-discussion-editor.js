/**
 * Bulk Discussion Board Editor — lock/hide/availability + calendar reminders.
 */
(function () {
  "use strict";

  var BE = window.BSP && window.BSP.BulkEditor;
  if (!BE) {
    console.error("[BulkDiscussion] shared helpers missing");
    return;
  }

  var STATE = {
    courseId: null,
    courseLabel: "",
    items: [],
    busy: false
  };

  async function init() {
    await BE.wireCourseSelect("bdeCourse", loadCourse);
    document.getElementById("bdeSaveBtn").addEventListener("click", onSaveAll);
    document.getElementById("bdeCalendarBtn").addEventListener("click", onAddCalendar);
    document.getElementById("bdeLockBtn").addEventListener("click", function () {
      applyFlag(".bde-locked", true);
    });
    document.getElementById("bdeUnlockBtn").addEventListener("click", function () {
      applyFlag(".bde-locked", false);
    });
    document.getElementById("bdeHideBtn").addEventListener("click", function () {
      applyFlag(".bde-hidden", true);
    });
    document.getElementById("bdeShowBtn").addEventListener("click", function () {
      applyFlag(".bde-hidden", false);
    });
    document.getElementById("bdeMustPostOnBtn").addEventListener("click", function () {
      applyFlag(".bde-mustpost", true);
    });
    document.getElementById("bdeMustPostOffBtn").addEventListener("click", function () {
      applyFlag(".bde-mustpost", false);
    });
    document.getElementById("bdeApplyDatesBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var s = document.getElementById("bdeBulkStart").value;
        var e = document.getElementById("bdeBulkEnd").value;
        if (s) tr.querySelector(".bde-start").value = s;
        if (e) tr.querySelector(".bde-end").value = e;
      });
    });

    try {
      var me = await window.BSP.api.whoami();
      var meta = document.getElementById("bdeHeaderMeta");
      if (meta && me) {
        meta.textContent =
          "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
    } catch (e) {
      /* fine */
    }
  }

  function selectedRows() {
    return Array.from(document.querySelectorAll("#bdeEditor tbody tr")).filter(function (tr) {
      var cb = tr.querySelector(".bde-select");
      return cb && cb.checked;
    });
  }

  function applyToSelected(fn) {
    var rows = selectedRows();
    if (!rows.length) {
      document.getElementById("bdeSaveStatus").textContent = "Select one or more topics first.";
      return;
    }
    rows.forEach(function (tr) {
      fn(tr);
      onRowInput.call(tr.querySelector(".bde-start") || tr);
    });
    document.getElementById("bdeSaveStatus").textContent =
      "Applied to " + rows.length + " topic(s). Click Save to commit.";
  }

  function applyFlag(selector, value) {
    applyToSelected(function (tr) {
      var el = tr.querySelector(selector);
      if (el) el.checked = value;
    });
  }

  async function loadCourse(ouId, label) {
    STATE.courseId = ouId;
    STATE.courseLabel = label || "Course " + ouId;
    var card = document.getElementById("bdeEditorCard");
    var heading = document.getElementById("bdeEditorHeading");
    var editor = document.getElementById("bdeEditor");
    var saveBar = document.getElementById("bdeSaveBar");
    card.style.display = "";
    document.getElementById("bdeBulkCard").style.display = "";
    heading.textContent = "Discussions · " + STATE.courseLabel;
    editor.innerHTML =
      '<div class="ldg" role="status"><div class="sp"></div><p>Loading discussion forums…</p></div>';
    saveBar.style.display = "none";
    document.getElementById("bdeSaveStatus").textContent = "";

    try {
      var forums = await window.BSP.api.forums(ouId).catch(function () {
        return [];
      });
      var forumList = Array.isArray(forums) ? forums : (forums && forums.Items) || [];
      var items = [];

      for (var i = 0; i < forumList.length; i++) {
        var f = forumList[i];
        var fid = f && (f.ForumId || f.Id || f.Identifier);
        if (!fid) continue;
        var topics = await window.BSP.api.forumTopics(ouId, fid).catch(function () {
          return [];
        });
        var tlist = Array.isArray(topics) ? topics : (topics && topics.Items) || [];
        for (var j = 0; j < tlist.length; j++) {
          var t = tlist[j];
          items.push({
            forumId: fid,
            forumName: f.Name || "",
            id: t.TopicId || t.Id,
            name: t.Name || "Topic",
            startDate: t.StartDate || null,
            endDate: t.EndDate || null,
            dueDate: t.DueDate || null,
            isLocked: !!t.IsLocked,
            isHidden: !!t.IsHidden,
            mustPost: !!t.MustPostToParticipate,
            displayInCalendar: !!t.DisplayInCalendar,
            original: t
          });
        }
      }

      STATE.items = items;
      renderEditor();
    } catch (e) {
      console.error("[BulkDiscussion] load", e);
      editor.innerHTML =
        '<div class="empty"><h3>Couldn\'t load discussions</h3><p>' +
        BE.escapeHTML(e.message || "Unknown error") +
        "</p></div>";
    }
  }

  function renderEditor() {
    var editor = document.getElementById("bdeEditor");
    var saveBar = document.getElementById("bdeSaveBar");
    if (!STATE.items.length) {
      editor.innerHTML =
        '<div class="empty"><h3>No discussion topics</h3><p>This course has no forums/topics to edit.</p></div>';
      saveBar.style.display = "none";
      return;
    }

    var rows = STATE.items
      .map(function (it, idx) {
        return (
          '<tr data-idx="' +
          idx +
          '">' +
          '<td><input type="checkbox" class="bde-select" aria-label="Select ' +
          BE.escapeHTML(it.name) +
          '"></td>' +
          "<td>" +
          BE.escapeHTML(it.forumName) +
          "</td>" +
          "<td>" +
          BE.escapeHTML(it.name) +
          "</td>" +
          '<td><input type="checkbox" class="bde-locked" ' +
          (it.isLocked ? "checked" : "") +
          ' aria-label="Locked"></td>' +
          '<td><input type="checkbox" class="bde-hidden" ' +
          (it.isHidden ? "checked" : "") +
          ' aria-label="Hidden"></td>' +
          '<td><input type="checkbox" class="bde-mustpost" ' +
          (it.mustPost ? "checked" : "") +
          ' aria-label="Must post to participate"></td>' +
          '<td><input type="date" class="dd-input bde-start" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.startDate)) +
          '"></td>' +
          '<td><input type="date" class="dd-input bde-end" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.endDate)) +
          '"></td>' +
          "</tr>"
        );
      })
      .join("");

    editor.innerHTML =
      '<div class="accom-table-wrap"><table class="dd-table" role="grid">' +
      "<thead><tr>" +
      '<th style="width:4%"><input type="checkbox" id="bdeSelectAll" aria-label="Select all"></th>' +
      "<th>Forum</th>" +
      "<th>Topic</th>" +
      '<th style="width:8%">Locked</th>' +
      '<th style="width:8%">Hidden</th>' +
      '<th style="width:10%">Must post</th>' +
      '<th style="width:12%">Start</th>' +
      '<th style="width:12%">End</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";

    saveBar.style.display = "flex";
    document.getElementById("bdeSelectAll").addEventListener("change", function () {
      var on = this.checked;
      editor.querySelectorAll(".bde-select").forEach(function (cb) {
        cb.checked = on;
      });
    });
    editor
      .querySelectorAll(".bde-locked, .bde-hidden, .bde-mustpost, .bde-start, .bde-end")
      .forEach(function (el) {
        el.addEventListener("input", onRowInput);
        el.addEventListener("change", onRowInput);
      });
  }

  function readRow(tr, it) {
    return {
      start: BE.isoFromDateOnly(tr.querySelector(".bde-start").value, false),
      end: BE.isoFromDateOnly(tr.querySelector(".bde-end").value, true),
      locked: tr.querySelector(".bde-locked").checked,
      hidden: tr.querySelector(".bde-hidden").checked,
      mustPost: tr.querySelector(".bde-mustpost").checked,
      dirty:
        (BE.isoFromDateOnly(tr.querySelector(".bde-start").value, false) || null) !==
          (it.startDate || null) ||
        (BE.isoFromDateOnly(tr.querySelector(".bde-end").value, true) || null) !==
          (it.endDate || null) ||
        tr.querySelector(".bde-locked").checked !== !!it.isLocked ||
        tr.querySelector(".bde-hidden").checked !== !!it.isHidden ||
        tr.querySelector(".bde-mustpost").checked !== !!it.mustPost
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

  async function onSaveAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    BE.setBusy(["bdeSaveBtn", "bdeCalendarBtn"], true);
    var status = document.getElementById("bdeSaveStatus");
    status.textContent = "Saving…";
    try {
      await BE.ensureXsrfToken();
    } catch (e) {
      /* continue */
    }

    var ok = 0;
    var fail = 0;
    var skipped = 0;
    var rows = Array.from(document.querySelectorAll("#bdeEditor tbody tr"));

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
      try {
        var body = BE.buildDiscussionTopicUpdateBody(it.original, {
          StartDate: r.start,
          EndDate: r.end,
          IsLocked: r.locked,
          IsHidden: r.hidden,
          MustPostToParticipate: r.mustPost
        });
        await BE.putJson(
          "/d2l/api/le/" +
            BE.LE +
            "/" +
            encodeURIComponent(STATE.courseId) +
            "/discussions/forums/" +
            encodeURIComponent(it.forumId) +
            "/topics/" +
            encodeURIComponent(it.id),
          body
        );
        it.startDate = r.start;
        it.endDate = r.end;
        it.isLocked = r.locked;
        it.isHidden = r.hidden;
        it.mustPost = r.mustPost;
        Object.assign(it.original, {
          StartDate: r.start,
          EndDate: r.end,
          IsLocked: r.locked,
          IsHidden: r.hidden,
          MustPostToParticipate: r.mustPost
        });
        BE.markRowState(tr, "dd-row-saved");
        ok++;
      } catch (e) {
        console.warn("[BulkDiscussion] save fail", it.name, e);
        BE.markRowState(tr, "dd-row-fail");
        fail++;
      }
    }

    status.textContent =
      "Saved " + ok + ", failed " + fail + (skipped ? ", unchanged " + skipped : "") + ".";
    STATE.busy = false;
    BE.setBusy(["bdeSaveBtn", "bdeCalendarBtn"], false);
  }

  async function onAddCalendar() {
    if (STATE.busy || !STATE.courseId) return;
    var status = document.getElementById("bdeSaveStatus");
    var targets = selectedRows();
    if (!targets.length) {
      targets = Array.from(document.querySelectorAll("#bdeEditor tbody tr"));
    }
    var events = [];
    targets.forEach(function (tr) {
      var idx = parseInt(tr.dataset.idx, 10);
      var it = STATE.items[idx];
      if (!it) return;
      var endVal = tr.querySelector(".bde-end").value;
      var startVal = tr.querySelector(".bde-start").value;
      var anchor = endVal || startVal || BE.dateOnlyFromIso(it.dueDate);
      if (!anchor) return;
      var iso = BE.isoFromDateOnly(anchor, true);
      events.push({ title: "Discussion: " + it.name, start: iso, end: iso });
    });
    if (!events.length) {
      status.textContent = "No selected topics have start/end dates to put on the calendar.";
      return;
    }

    STATE.busy = true;
    BE.setBusy(["bdeSaveBtn", "bdeCalendarBtn"], true);
    status.textContent = "Adding calendar events…";
    try {
      await BE.ensureXsrfToken();
    } catch (e) {
      /* continue */
    }

    var ok = 0;
    var fail = 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      try {
        await BE.postJson(
          "/d2l/api/le/" +
            BE.LE_DROPBOX +
            "/" +
            encodeURIComponent(STATE.courseId) +
            "/calendar/event/",
          {
            Title: ev.title,
            Description: "",
            StartDateTime: ev.start,
            EndDateTime: ev.end,
            StartDay: null,
            EndDay: null,
            GroupId: null,
            RecurrenceInfo: null,
            LocationId: null,
            LocationName: "",
            AssociatedEntity: null,
            VisibilityRestrictions: {
              Type: 1,
              Range: null,
              HiddenRangeUnitType: null,
              StartDate: null,
              EndDate: null
            }
          }
        );
        ok++;
      } catch (e) {
        console.warn("[BulkDiscussion] calendar fail", ev.title, e);
        fail++;
      }
    }
    status.textContent = "Calendar: added " + ok + ", failed " + fail + ".";
    STATE.busy = false;
    BE.setBusy(["bdeSaveBtn", "bdeCalendarBtn"], false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
