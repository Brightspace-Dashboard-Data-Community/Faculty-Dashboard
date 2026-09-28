/**
 * Bulk Gradebook Editor — structure fields only (not student scores).
 */
(function () {
  "use strict";

  var BE = window.BSP && window.BSP.BulkEditor;
  if (!BE) {
    console.error("[BulkGradebook] shared helpers missing");
    return;
  }

  var STATE = {
    courseId: null,
    courseLabel: "",
    items: [],
    busy: false,
    isWeighted: false
  };

  function gradeId(g) {
    return g.Id != null ? g.Id : g.GradeObjectId;
  }

  function gradeTypeLabel(g) {
    var t = g.GradeType || g.GradeObjectTypeName || g.GradeObjectType;
    if (t === 1 || t === "1" || t === "Numeric") return "Numeric";
    if (t === 2 || t === "2" || t === "PassFail") return "PassFail";
    if (t === 3 || t === "3" || t === "SelectBox") return "SelectBox";
    if (t === 4 || t === "4" || t === "Text") return "Text";
    if (t === 5 || t === "5" || /Formula/i.test(String(t))) return "Formula";
    if (t === 6 || t === "6" || /Calculated/i.test(String(t))) return "Calculated";
    if (t === 7 || t === "7" || /Final/i.test(String(t))) return "Final";
    if (t === 8 || t === "8" || /Category/i.test(String(t))) return "Category";
    return String(t || "Item");
  }

  function isEditable(g) {
    var label = gradeTypeLabel(g);
    return label === "Numeric" || label === "PassFail" || label === "SelectBox" || label === "Text";
  }

  async function init() {
    await BE.wireCourseSelect("bgeCourse", loadCourse);
    document.getElementById("bgeSaveBtn").addEventListener("click", onSaveAll);
    document.getElementById("bgeApplyPointsBtn").addEventListener("click", function () {
      var v = document.getElementById("bgeBulkPoints").value;
      if (v === "") {
        document.getElementById("bgeSaveStatus").textContent = "Enter max points first.";
        return;
      }
      applyToSelected(function (tr) {
        var input = tr.querySelector(".bge-points");
        if (input && !input.disabled) input.value = v;
      });
    });
    document.getElementById("bgeApplyWeightBtn").addEventListener("click", function () {
      var v = document.getElementById("bgeBulkWeight").value;
      if (v === "") {
        document.getElementById("bgeSaveStatus").textContent = "Enter weight first.";
        return;
      }
      applyToSelected(function (tr) {
        var input = tr.querySelector(".bge-weight");
        if (input && !input.disabled) input.value = v;
      });
    });
    document.getElementById("bgeHideBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var cb = tr.querySelector(".bge-hidden");
        if (cb && !cb.disabled) cb.checked = true;
      });
    });
    document.getElementById("bgeShowBtn").addEventListener("click", function () {
      applyToSelected(function (tr) {
        var cb = tr.querySelector(".bge-hidden");
        if (cb && !cb.disabled) cb.checked = false;
      });
    });

    try {
      var me = await window.BSP.api.whoami();
      var meta = document.getElementById("bgeHeaderMeta");
      if (meta && me) {
        meta.textContent =
          "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
    } catch (e) {
      /* fine */
    }
  }

  function selectedRows() {
    return Array.from(document.querySelectorAll("#bgeEditor tbody tr")).filter(function (tr) {
      var cb = tr.querySelector(".bge-select");
      return cb && cb.checked && !tr.classList.contains("dd-row-readonly");
    });
  }

  function applyToSelected(fn) {
    var rows = selectedRows();
    if (!rows.length) {
      document.getElementById("bgeSaveStatus").textContent = "Select one or more editable items first.";
      return;
    }
    rows.forEach(function (tr) {
      fn(tr);
      onRowInput.call(tr.querySelector(".bge-name") || tr);
    });
    document.getElementById("bgeSaveStatus").textContent =
      "Applied to " + rows.length + " item(s). Click Save to commit.";
  }

  async function loadCourse(ouId, label) {
    STATE.courseId = ouId;
    STATE.courseLabel = label || "Course " + ouId;
    var card = document.getElementById("bgeEditorCard");
    var heading = document.getElementById("bgeEditorHeading");
    var editor = document.getElementById("bgeEditor");
    var saveBar = document.getElementById("bgeSaveBar");
    card.style.display = "";
    document.getElementById("bgeBulkCard").style.display = "";
    heading.textContent = "Gradebook · " + STATE.courseLabel;
    editor.innerHTML =
      '<div class="ldg" role="status"><div class="sp"></div><p>Loading grade items…</p></div>';
    saveBar.style.display = "none";
    document.getElementById("bgeSaveStatus").textContent = "";

    try {
      var setup = null;
      try {
        setup = await window.BSP.api.raw(
          "/d2l/api/le/" +
            BE.LE_GRADES +
            "/" +
            encodeURIComponent(ouId) +
            "/grades/setup/"
        );
      } catch (e) {
        try {
          setup = await window.BSP.api.raw(
            "/d2l/api/le/" + BE.LE + "/" + encodeURIComponent(ouId) + "/grades/setup/"
          );
        } catch (e2) {
          setup = null;
        }
      }
      STATE.isWeighted =
        !!(setup && (setup.GradingSystem === "Weighted" || setup.GradingSystem === 2));

      var data = await window.BSP.api.raw(
        "/d2l/api/le/" + BE.LE_GRADES + "/" + encodeURIComponent(ouId) + "/grades/"
      ).catch(function () {
        return window.BSP.api.raw(
          "/d2l/api/le/" + BE.LE + "/" + encodeURIComponent(ouId) + "/grades/"
        );
      });
      var list = Array.isArray(data) ? data : [];

      STATE.items = list.map(function (g) {
        return {
          id: gradeId(g),
          name: g.Name || "Item",
          shortName: g.ShortName || "",
          maxPoints: g.MaxPoints != null ? g.MaxPoints : "",
          weight: g.Weight != null ? g.Weight : "",
          isBonus: !!g.IsBonus,
          exclude: !!g.ExcludeFromFinalGradeCalculation,
          isHidden: !!g.IsHidden,
          typeLabel: gradeTypeLabel(g),
          editable: isEditable(g),
          original: g
        };
      });
      renderEditor();
    } catch (e) {
      console.error("[BulkGradebook] load", e);
      editor.innerHTML =
        '<div class="empty"><h3>Couldn\'t load gradebook</h3><p>' +
        BE.escapeHTML(e.message || "Unknown error") +
        "</p></div>";
    }
  }

  function renderEditor() {
    var editor = document.getElementById("bgeEditor");
    var saveBar = document.getElementById("bgeSaveBar");
    if (!STATE.items.length) {
      editor.innerHTML =
        '<div class="empty"><h3>No grade items</h3><p>This course has an empty gradebook.</p></div>';
      saveBar.style.display = "none";
      return;
    }

    var weightHeader = STATE.isWeighted
      ? '<th style="width:9%">Weight</th>'
      : '<th style="width:9%">Weight</th>';

    var rows = STATE.items
      .map(function (it, idx) {
        if (!it.editable) {
          return (
            '<tr data-idx="' +
            idx +
            '" class="dd-row-readonly">' +
            "<td></td>" +
            "<td>" +
            BE.escapeHTML(it.typeLabel) +
            "</td>" +
            "<td colspan=\"6\"><strong>" +
            BE.escapeHTML(it.name) +
            '</strong> <span class="dd-readonly-note">Read-only (' +
            BE.escapeHTML(it.typeLabel) +
            ")</span></td>" +
            "</tr>"
          );
        }
        return (
          '<tr data-idx="' +
          idx +
          '">' +
          '<td><input type="checkbox" class="bge-select" aria-label="Select ' +
          BE.escapeHTML(it.name) +
          '"></td>' +
          "<td>" +
          BE.escapeHTML(it.typeLabel) +
          "</td>" +
          '<td><input type="text" class="dd-input bge-name" value="' +
          BE.escapeHTML(it.name) +
          '" aria-label="Name"></td>' +
          '<td><input type="text" class="dd-input bge-short" value="' +
          BE.escapeHTML(it.shortName) +
          '" aria-label="Short name" style="max-width:120px"></td>' +
          '<td><input type="number" class="dd-input bge-points" min="0" step="0.01" value="' +
          BE.escapeHTML(String(it.maxPoints)) +
          '" style="max-width:100px"></td>' +
          '<td><input type="number" class="dd-input bge-weight" min="0" step="0.01" value="' +
          BE.escapeHTML(String(it.weight)) +
          '" style="max-width:100px"' +
          (STATE.isWeighted ? "" : " disabled") +
          "></td>" +
          '<td><input type="checkbox" class="bge-bonus" ' +
          (it.isBonus ? "checked" : "") +
          ' aria-label="Bonus"></td>' +
          '<td><input type="checkbox" class="bge-exclude" ' +
          (it.exclude ? "checked" : "") +
          ' aria-label="Exclude from final"></td>' +
          '<td><input type="checkbox" class="bge-hidden" ' +
          (it.isHidden ? "checked" : "") +
          ' aria-label="Hidden"></td>' +
          "</tr>"
        );
      })
      .join("");

    editor.innerHTML =
      '<p class="form-hint" style="margin-top:0">Scheme: <strong>' +
      (STATE.isWeighted ? "Weighted" : "Points") +
      "</strong></p>" +
      '<div class="accom-table-wrap"><table class="dd-table" role="grid">' +
      "<thead><tr>" +
      '<th style="width:4%"><input type="checkbox" id="bgeSelectAll" aria-label="Select all"></th>' +
      '<th style="width:9%">Type</th>' +
      "<th>Name</th>" +
      '<th style="width:10%">Short</th>' +
      '<th style="width:9%">Points</th>' +
      weightHeader +
      '<th style="width:7%">Bonus</th>' +
      '<th style="width:8%">Exclude</th>' +
      '<th style="width:7%">Hidden</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";

    saveBar.style.display = "flex";
    document.getElementById("bgeSelectAll").addEventListener("change", function () {
      var on = this.checked;
      editor.querySelectorAll(".bge-select").forEach(function (cb) {
        cb.checked = on;
      });
    });
    editor
      .querySelectorAll(
        ".bge-name, .bge-short, .bge-points, .bge-weight, .bge-bonus, .bge-exclude, .bge-hidden"
      )
      .forEach(function (el) {
        el.addEventListener("input", onRowInput);
        el.addEventListener("change", onRowInput);
      });
  }

  function readRow(tr, it) {
    var name = (tr.querySelector(".bge-name").value || "").trim();
    var shortName = (tr.querySelector(".bge-short").value || "").trim();
    var maxPoints = tr.querySelector(".bge-points").value;
    var weight = tr.querySelector(".bge-weight").value;
    var bonus = tr.querySelector(".bge-bonus").checked;
    var exclude = tr.querySelector(".bge-exclude").checked;
    var hidden = tr.querySelector(".bge-hidden").checked;
    var dirty =
      name !== (it.name || "") ||
      shortName !== (it.shortName || "") ||
      String(maxPoints) !== String(it.maxPoints) ||
      String(weight) !== String(it.weight) ||
      bonus !== !!it.isBonus ||
      exclude !== !!it.exclude ||
      hidden !== !!it.isHidden;
    return {
      name: name,
      shortName: shortName,
      maxPoints: maxPoints,
      weight: weight,
      bonus: bonus,
      exclude: exclude,
      hidden: hidden,
      dirty: dirty
    };
  }

  function onRowInput() {
    var tr = this.closest("tr");
    if (tr.classList.contains("dd-row-readonly")) return;
    var idx = parseInt(tr.dataset.idx, 10);
    var it = STATE.items[idx];
    if (!it) return;
    var r = readRow(tr, it);
    BE.markRowState(tr, r.dirty ? "dd-changed" : null);
  }

  async function onSaveAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    BE.setBusy(["bgeSaveBtn"], true);
    var status = document.getElementById("bgeSaveStatus");
    status.textContent = "Saving…";
    try {
      await BE.ensureXsrfToken();
    } catch (e) {
      /* continue */
    }

    var ok = 0;
    var fail = 0;
    var skipped = 0;
    var rows = Array.from(document.querySelectorAll("#bgeEditor tbody tr"));

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (tr.classList.contains("dd-row-readonly")) continue;
      var idx = parseInt(tr.dataset.idx, 10);
      var it = STATE.items[idx];
      if (!it || !it.editable) continue;
      var r = readRow(tr, it);
      if (!r.dirty) {
        skipped++;
        continue;
      }
      if (!r.name) {
        BE.markRowState(tr, "dd-row-fail");
        fail++;
        continue;
      }

      try {
        var overrides = {
          Name: r.name,
          ShortName: r.shortName,
          MaxPoints: r.maxPoints === "" ? 0 : Number(r.maxPoints),
          IsBonus: r.bonus,
          ExcludeFromFinalGradeCalculation: r.exclude,
          IsHidden: r.hidden
        };
        if (STATE.isWeighted && r.weight !== "") {
          overrides.Weight = Number(r.weight);
        }
        var body = BE.buildGradeItemUpdateBody(it.original, overrides);
        await BE.putJson(
          "/d2l/api/le/" +
            BE.LE_GRADES +
            "/" +
            encodeURIComponent(STATE.courseId) +
            "/grades/" +
            encodeURIComponent(it.id),
          body
        );
        it.name = r.name;
        it.shortName = r.shortName;
        it.maxPoints = overrides.MaxPoints;
        it.weight = overrides.Weight != null ? overrides.Weight : it.weight;
        it.isBonus = r.bonus;
        it.exclude = r.exclude;
        it.isHidden = r.hidden;
        Object.assign(it.original, {
          Name: it.name,
          ShortName: it.shortName,
          MaxPoints: it.maxPoints,
          IsBonus: it.isBonus,
          ExcludeFromFinalGradeCalculation: it.exclude,
          IsHidden: it.isHidden
        });
        if (overrides.Weight != null) it.original.Weight = overrides.Weight;
        BE.markRowState(tr, "dd-row-saved");
        ok++;
      } catch (e) {
        console.warn("[BulkGradebook] save fail", it.name, e);
        BE.markRowState(tr, "dd-row-fail");
        fail++;
      }
    }

    status.textContent =
      "Saved " + ok + ", failed " + fail + (skipped ? ", unchanged " + skipped : "") + ".";
    STATE.busy = false;
    BE.setBusy(["bgeSaveBtn"], false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
