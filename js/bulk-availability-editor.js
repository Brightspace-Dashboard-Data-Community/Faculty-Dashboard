/**
 * Bulk Availability Editor — assignments + quizzes start/end, publish, calendar.
 */
(function () {
  "use strict";

  var BE = window.BSP && window.BSP.BulkEditor;
  if (!BE) {
    console.error("[BulkAvailability] shared helpers missing");
    return;
  }

  var STATE = {
    courseId: null,
    courseLabel: "",
    items: [],
    busy: false
  };

  function folderStart(f) {
    return (f.Availability && f.Availability.StartDate) || f.StartDate || null;
  }
  function folderEnd(f) {
    return (f.Availability && f.Availability.EndDate) || f.EndDate || null;
  }

  async function init() {
    await BE.wireCourseSelect("baeCourse", loadCourse);
    document.getElementById("baeSaveBtn").addEventListener("click", onSaveAll);
    document.getElementById("baeApplyDatesBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var s = document.getElementById("baeBulkStart").value;
        var e = document.getElementById("baeBulkEnd").value;
        if (s) tr.querySelector(".bae-start").value = s;
        if (e) tr.querySelector(".bae-end").value = e;
      });
    });
    document.getElementById("baePublishBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var cb = tr.querySelector(".bae-active");
        if (cb && !cb.disabled) cb.checked = true;
      });
    });
    document.getElementById("baeUnpublishBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var cb = tr.querySelector(".bae-active");
        if (cb && !cb.disabled) cb.checked = false;
      });
    });
    document.getElementById("baeCalOnBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        tr.querySelector(".bae-cal").checked = true;
      });
    });
    document.getElementById("baeCalOffBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        tr.querySelector(".bae-cal").checked = false;
      });
    });

    try {
      var me = await window.BSP.api.whoami();
      var meta = document.getElementById("baeHeaderMeta");
      if (meta && me) {
        meta.textContent =
          "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
    } catch (e) {
      /* fine */
    }
  }

  function selectedRows() {
    return Array.from(document.querySelectorAll("#baeEditor tbody tr")).filter(function (tr) {
      var cb = tr.querySelector(".bae-select");
      return cb && cb.checked;
    });
  }

  function applyToSelected(fn) {
    var rows = selectedRows();
    if (!rows.length) {
      document.getElementById("baeSaveStatus").textContent = "Select one or more rows first.";
      return;
    }
    rows.forEach(function (tr) {
      fn(tr);
      onRowInput.call(tr.querySelector(".bae-start") || tr);
    });
    document.getElementById("baeSaveStatus").textContent =
      "Applied to " + rows.length + " row(s). Click Save to commit.";
  }

  async function loadCourse(ouId, label) {
    STATE.courseId = ouId;
    STATE.courseLabel = label || "Course " + ouId;
    var card = document.getElementById("baeEditorCard");
    var heading = document.getElementById("baeEditorHeading");
    var editor = document.getElementById("baeEditor");
    var saveBar = document.getElementById("baeSaveBar");
    var status = document.getElementById("baeSaveStatus");
    card.style.display = "";
    document.getElementById("baeBulkCard").style.display = "";
    heading.textContent = "Availability · " + STATE.courseLabel;
    editor.innerHTML =
      '<div class="ldg" role="status"><div class="sp"></div><p>Loading assignments and quizzes…</p></div>';
    saveBar.style.display = "none";
    status.textContent = "";

    try {
      var folders = await window.BSP.api.dropboxFolders(ouId).catch(function () {
        return [];
      });
      var quizList = await window.BSP.api.quizzes(ouId).catch(function () {
        return [];
      });
      var quizzes = (quizList && quizList.Objects) || quizList || [];

      var assignments = (folders || []).map(function (f) {
        return {
          type: "assignment",
          id: f.Id,
          name: f.Name || "Assignment " + f.Id,
          startDate: folderStart(f),
          endDate: folderEnd(f),
          isActive: true,
          displayInCalendar: !!f.DisplayInCalendar,
          original: f
        };
      });
      var quizItems = quizzes.map(function (q) {
        return {
          type: "quiz",
          id: q.QuizId,
          name: q.Name || "Quiz " + q.QuizId,
          startDate: q.StartDate || null,
          endDate: q.EndDate || null,
          isActive: q.IsActive !== false,
          displayInCalendar: !!q.DisplayInCalendar,
          original: q
        };
      });

      STATE.items = assignments.concat(quizItems);
      renderEditor();
    } catch (e) {
      console.error("[BulkAvailability] load", e);
      editor.innerHTML =
        '<div class="empty"><h3>Couldn\'t load items</h3><p>' +
        BE.escapeHTML(e.message || "Unknown error") +
        "</p></div>";
    }
  }

  function renderEditor() {
    var editor = document.getElementById("baeEditor");
    var saveBar = document.getElementById("baeSaveBar");
    if (!STATE.items.length) {
      editor.innerHTML =
        '<div class="empty"><h3>No assignments or quizzes</h3><p>This course has nothing to edit.</p></div>';
      saveBar.style.display = "none";
      return;
    }

    var rows = STATE.items
      .map(function (it, idx) {
        var typeCls = it.type === "quiz" ? "dd-type-quiz" : "dd-type-assignment";
        var typeLbl = it.type === "quiz" ? "Quiz" : "Assignment";
        var activeCell =
          it.type === "quiz"
            ? '<input type="checkbox" class="bae-active" ' +
              (it.isActive ? "checked" : "") +
              ' aria-label="Published">'
            : '<span class="dd-readonly-note">n/a</span><input type="checkbox" class="bae-active" checked disabled hidden>';
        return (
          '<tr data-idx="' +
          idx +
          '">' +
          '<td><input type="checkbox" class="bae-select" aria-label="Select ' +
          BE.escapeHTML(it.name) +
          '"></td>' +
          '<td><span class="' +
          typeCls +
          '">' +
          typeLbl +
          "</span></td>" +
          "<td>" +
          BE.escapeHTML(it.name) +
          "</td>" +
          '<td><input type="date" class="dd-input bae-start" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.startDate)) +
          '"></td>' +
          '<td><input type="date" class="dd-input bae-end" value="' +
          BE.escapeHTML(BE.dateOnlyFromIso(it.endDate)) +
          '"></td>' +
          "<td>" +
          activeCell +
          "</td>" +
          '<td><input type="checkbox" class="bae-cal" ' +
          (it.displayInCalendar ? "checked" : "") +
          ' aria-label="Display in calendar"></td>' +
          "</tr>"
        );
      })
      .join("");

    editor.innerHTML =
      '<div class="accom-table-wrap"><table class="dd-table" role="grid">' +
      "<thead><tr>" +
      '<th style="width:4%"><input type="checkbox" id="baeSelectAll" aria-label="Select all"></th>' +
      '<th style="width:10%">Type</th>' +
      "<th>Name</th>" +
      '<th style="width:14%">Start</th>' +
      '<th style="width:14%">End</th>' +
      '<th style="width:10%">Published</th>' +
      '<th style="width:10%">Calendar</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";

    saveBar.style.display = "flex";
    document.getElementById("baeSelectAll").addEventListener("change", function () {
      var on = this.checked;
      editor.querySelectorAll(".bae-select").forEach(function (cb) {
        cb.checked = on;
      });
    });
    editor.querySelectorAll(".bae-start, .bae-end, .bae-active, .bae-cal").forEach(function (el) {
      el.addEventListener("input", onRowInput);
      el.addEventListener("change", onRowInput);
    });
  }

  function onRowInput() {
    var tr = this.closest ? this.closest("tr") : this;
    if (!tr || !tr.dataset) return;
    var idx = parseInt(tr.dataset.idx, 10);
    var it = STATE.items[idx];
    if (!it) return;
    var start = BE.isoFromDateOnly(tr.querySelector(".bae-start").value, false);
    var end = BE.isoFromDateOnly(tr.querySelector(".bae-end").value, true);
    var active = tr.querySelector(".bae-active").checked;
    var cal = tr.querySelector(".bae-cal").checked;
    var dirty =
      (start || null) !== (it.startDate || null) ||
      (end || null) !== (it.endDate || null) ||
      active !== !!it.isActive ||
      cal !== !!it.displayInCalendar;
    BE.markRowState(tr, dirty ? "dd-changed" : null);
  }

  async function onSaveAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    BE.setBusy(["baeSaveBtn"], true);
    var status = document.getElementById("baeSaveStatus");
    status.textContent = "Saving…";
    try {
      await BE.ensureXsrfToken();
    } catch (e) {
      /* continue */
    }

    var ok = 0;
    var fail = 0;
    var skipped = 0;
    var rows = Array.from(document.querySelectorAll("#baeEditor tbody tr"));

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var idx = parseInt(tr.dataset.idx, 10);
      var it = STATE.items[idx];
      if (!it) continue;
      var start = BE.isoFromDateOnly(tr.querySelector(".bae-start").value, false);
      var end = BE.isoFromDateOnly(tr.querySelector(".bae-end").value, true);
      var active = tr.querySelector(".bae-active").checked;
      var cal = tr.querySelector(".bae-cal").checked;
      var dirty =
        (start || null) !== (it.startDate || null) ||
        (end || null) !== (it.endDate || null) ||
        active !== !!it.isActive ||
        cal !== !!it.displayInCalendar;
      if (!dirty) {
        skipped++;
        continue;
      }

      try {
        if (it.type === "assignment") {
          var dBody = BE.buildDropboxUpdateBody(it.original, {
            StartDate: start,
            EndDate: end,
            DisplayInCalendar: cal
          });
          await BE.putJson(
            "/d2l/api/le/" +
              BE.LE_DROPBOX +
              "/" +
              encodeURIComponent(STATE.courseId) +
              "/dropbox/folders/" +
              encodeURIComponent(it.id),
            dBody
          );
        } else {
          var qBody = BE.buildQuizUpdateBody(it.original, {
            StartDate: start,
            EndDate: end,
            IsActive: active,
            DisplayInCalendar: cal
          });
          await BE.putJson(
            "/d2l/api/le/" +
              BE.LE +
              "/" +
              encodeURIComponent(STATE.courseId) +
              "/quizzes/" +
              encodeURIComponent(it.id),
            qBody
          );
        }
        it.startDate = start;
        it.endDate = end;
        it.isActive = active;
        it.displayInCalendar = cal;
        if (it.type === "assignment") {
          it.original.Availability = it.original.Availability || {};
          it.original.Availability.StartDate = start;
          it.original.Availability.EndDate = end;
          it.original.DisplayInCalendar = cal;
        } else {
          it.original.StartDate = start;
          it.original.EndDate = end;
          it.original.IsActive = active;
          it.original.DisplayInCalendar = cal;
        }
        BE.markRowState(tr, "dd-row-saved");
        ok++;
      } catch (e) {
        console.warn("[BulkAvailability] save fail", it.name, e);
        BE.markRowState(tr, "dd-row-fail");
        fail++;
      }
    }

    status.textContent =
      "Saved " + ok + ", failed " + fail + (skipped ? ", unchanged " + skipped : "") + ".";
    STATE.busy = false;
    BE.setBusy(["baeSaveBtn"], false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
