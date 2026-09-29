/**
 * Your Institution Faculty Dashboard — Inactive Student Audit
 * Course last-access audit + outreach CSV export.
 */
(function () {
  "use strict";

  var API = window.BrightspaceApi;

  var state = {
    courseId: null,
    courseLabel: "",
    courseCode: "",
    rows: [],
    filtered: [],
    contentBusy: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setStatus(msg) {
    var el = $("isaStatus");
    if (el) el.textContent = msg || "";
  }

  function normalizeClasslist(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  function isStudentRole(member) {
    var role = (member.Role && (member.Role.Name || member.RoleName)) || member.RoleName || "";
    if (!role) return true;
    if (/^student|learner/i.test(role)) return true;
    if (/instructor|designer|admin|grader|ta\b|faculty|teacher/i.test(role)) return false;
    return true;
  }

  function displayName(s) {
    var last = s.LastName || "";
    var first = s.FirstName || "";
    if (last && first) return last + ", " + first;
    return s.DisplayName || "Student";
  }

  function daysSince(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var ms = Date.now() - d.getTime();
    var days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days < 0 ? 0 : days;
  }

  function fmtDate(iso) {
    if (!iso) return "Never";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function bucketFor(days) {
    if (days === null) return { id: "never", label: "Never accessed", priority: 5, className: "isa-badge--never" };
    if (days >= 21) return { id: "21", label: "21+ days", priority: 4, className: "isa-badge--critical" };
    if (days >= 14) return { id: "14", label: "14+ days", priority: 3, className: "isa-badge--high" };
    if (days >= 7) return { id: "7", label: "7+ days", priority: 2, className: "isa-badge--warn" };
    if (days >= 3) return { id: "3", label: "3+ days", priority: 1, className: "isa-badge--mild" };
    return { id: "active", label: "Active", priority: 0, className: "isa-badge--active" };
  }

  function buildRows(list) {
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var last = s.LastAccessed || null;
      var days = daysSince(last);
      var bucket = bucketFor(days);
      rows.push({
        userId: s.Identifier || s.UserId,
        name: displayName(s),
        orgId: s.OrgDefinedId || s.OrgDefinedID || "",
        email: s.Email || s.EmailAddress || "",
        lastAccess: last,
        daysInactive: days,
        bucket: bucket
      });
    }
    rows.sort(function (a, b) {
      if (b.bucket.priority !== a.bucket.priority) return b.bucket.priority - a.bucket.priority;
      var ad = a.daysInactive == null ? 9999 : a.daysInactive;
      var bd = b.daysInactive == null ? 9999 : b.daysInactive;
      if (bd !== ad) return bd - ad;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }

  function filterInactive(rows, thresholdDays) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.daysInactive === null || r.daysInactive >= thresholdDays) out.push(r);
    }
    return out;
  }

  function countBuckets(rows) {
    var c = { never: 0, d21: 0, d14: 0, d7: 0, d3: 0, active: 0, total: rows.length };
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].bucket.id;
      if (id === "never") c.never++;
      else if (id === "21") c.d21++;
      else if (id === "14") c.d14++;
      else if (id === "7") c.d7++;
      else if (id === "3") c.d3++;
      else c.active++;
    }
    return c;
  }

  function contentVisitLabel(row) {
    if (row.contentError) return "Unavailable";
    if (!row.contentLoaded) return "—";
    if (!row.contentVisit) return "Not opened";
    return fmtDate(row.contentVisit);
  }

  function latestContentVisit(pack) {
    var rows = pack && pack.rows ? pack.rows : [];
    if (!rows.length) return { loaded: false, date: null };
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i] || rows[i].isModule || !rows[i].date) continue;
      if (!best || new Date(rows[i].date) > new Date(best)) best = rows[i].date;
    }
    return { loaded: true, date: best };
  }

  function renderResults() {
    var panel = $("isaResultsPanel");
    var host = $("isaResultsContent");
    var threshold = parseInt($("isaWindow").value, 10) || 7;
    state.filtered = filterInactive(state.rows, threshold);
    var counts = countBuckets(state.rows);
    var inactiveCount = state.filtered.length;

    panel.hidden = false;
    $("isaExportBtn").disabled = inactiveCount === 0;
    $("isaCopyEmailsBtn").disabled = inactiveCount === 0;
    var contentBtn = $("isaContentBtn");
    if (contentBtn) contentBtn.disabled = state.contentBusy || !state.rows.length;

    var kpiHtml =
      '<div class="ldaa-kpi-grid" role="group" aria-label="Class access summary">' +
      '<div class="ldaa-kpi"><div class="ldaa-kpi-label">Enrolled</div><div class="ldaa-kpi-value">' +
      counts.total +
      '</div></div>' +
      '<div class="ldaa-kpi isa-kpi--never"><div class="ldaa-kpi-label">Never accessed</div><div class="ldaa-kpi-value">' +
      counts.never +
      '</div></div>' +
      '<div class="ldaa-kpi isa-kpi--critical"><div class="ldaa-kpi-label">21+ days</div><div class="ldaa-kpi-value">' +
      counts.d21 +
      '</div></div>' +
      '<div class="ldaa-kpi isa-kpi--high"><div class="ldaa-kpi-label">14+ days</div><div class="ldaa-kpi-value">' +
      counts.d14 +
      '</div></div>' +
      '<div class="ldaa-kpi isa-kpi--warn"><div class="ldaa-kpi-label">7+ days</div><div class="ldaa-kpi-value">' +
      counts.d7 +
      '</div></div>' +
      '<div class="ldaa-kpi isa-kpi--mild"><div class="ldaa-kpi-label">3+ days</div><div class="ldaa-kpi-value">' +
      counts.d3 +
      "</div></div>" +
      "</div>";

    var summary =
      '<div class="isa-summary" role="status">' +
      "<strong>" +
      inactiveCount +
      "</strong> student" +
      (inactiveCount === 1 ? "" : "s") +
      " match the <strong>" +
      threshold +
      "+ day</strong> (or never accessed) outreach filter in " +
      escapeHtml(state.courseLabel) +
      "." +
      "</div>";

    if (!inactiveCount) {
      host.innerHTML =
        kpiHtml +
        summary +
        '<div class="tool-empty"><i class="fas fa-check-circle" aria-hidden="true" style="color:#0f5b46;margin-right:6px;"></i>' +
        "No inactive students in this window. Everyone has accessed the course more recently.</div>";
      return;
    }

    var rowsHtml = "";
    for (var i = 0; i < state.filtered.length; i++) {
      var r = state.filtered[i];
      var daysLabel =
        r.daysInactive === null ? "—" : r.daysInactive === 0 ? "Today" : r.daysInactive + " days";
      var emailCell = r.email
        ? '<a href="mailto:' +
          escapeHtml(r.email) +
          '">' +
          escapeHtml(r.email) +
          "</a>"
        : '<span class="isa-muted">No email</span>';
      rowsHtml +=
        "<tr>" +
        "<td>" +
        escapeHtml(r.name) +
        (r.orgId ? '<div class="isa-muted">' + escapeHtml(r.orgId) + "</div>" : "") +
        "</td>" +
        "<td>" +
        emailCell +
        "</td>" +
        "<td>" +
        escapeHtml(fmtDate(r.lastAccess)) +
        "</td>" +
        "<td>" +
        escapeHtml(contentVisitLabel(r)) +
        "</td>" +
        "<td>" +
        escapeHtml(daysLabel) +
        "</td>" +
        '<td><span class="isa-badge ' +
        r.bucket.className +
        '">' +
        escapeHtml(r.bucket.label) +
        "</span></td>" +
        "</tr>";
    }

    host.innerHTML =
      kpiHtml +
      summary +
      '<div class="isa-table-wrap">' +
      '<table class="dd-table isa-table" aria-label="Inactive students for outreach">' +
      "<thead><tr>" +
      "<th scope=\"col\">Student</th>" +
      "<th scope=\"col\">Email</th>" +
      "<th scope=\"col\">Last access</th>" +
      "<th scope=\"col\">Last content visit</th>" +
      "<th scope=\"col\">Days inactive</th>" +
      "<th scope=\"col\">Status</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>";
  }

  async function runAudit() {
    var courseSelect = $("isaCourse");
    var ouId = courseSelect.value;
    if (!ouId) return;

    var opt = courseSelect.options[courseSelect.selectedIndex];
    state.courseId = ouId;
    state.courseLabel = opt ? opt.textContent : "";
    var codeMatch = state.courseLabel.match(/\(([^)]+)\)\s*$/);
    state.courseCode = codeMatch ? codeMatch[1] : "";

    $("isaRunBtn").disabled = true;
    $("isaResultsPanel").hidden = true;
    setStatus("Loading classlist…");

    try {
      var raw = await API.classlist(ouId);
      var list = normalizeClasslist(raw).filter(isStudentRole);
      state.rows = buildRows(list);
      renderResults();
      setStatus(
        list.length +
          " student(s) loaded · " +
          state.filtered.length +
          " flagged for outreach."
      );
    } catch (e) {
      console.error("[ISA] audit failed", e);
      setStatus("Could not load classlist for this course.");
      $("isaResultsPanel").hidden = true;
    } finally {
      $("isaRunBtn").disabled = !$("isaCourse").value;
    }
  }

  async function loadContentVisits() {
    if (!state.courseId || !state.rows.length || state.contentBusy) return;
    if (!window.LdaaReport || !window.LdaaReport.contentStatistics) {
      setStatus("Content statistics reader is not available on this page.");
      return;
    }
    state.contentBusy = true;
    var contentBtn = $("isaContentBtn");
    if (contentBtn) contentBtn.disabled = true;
    try {
      for (var i = 0; i < state.rows.length; i++) {
        setStatus("Content statistics " + (i + 1) + " of " + state.rows.length + "…");
        var row = state.rows[i];
        try {
          var pack = await window.LdaaReport.contentStatistics(state.courseId, row.userId);
          var visit = latestContentVisit(pack);
          row.contentLoaded = visit.loaded;
          row.contentVisit = visit.date;
          row.contentError = !visit.loaded;
        } catch (err) {
          row.contentLoaded = false;
          row.contentVisit = null;
          row.contentError = true;
        }
        renderResults();
      }
      setStatus("Content visits loaded. Inactivity is still based on course login.");
    } finally {
      state.contentBusy = false;
      if ($("isaContentBtn")) $("isaContentBtn").disabled = !state.rows.length;
    }
  }

  function csvEscape(val) {
    var s = String(val == null ? "" : val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.filtered.length) return;
    var header = [
      "Student Name",
      "OrgDefinedId",
      "Email",
      "Last Access",
      "Last Content Visit",
      "Days Inactive",
      "Status",
      "Course Name",
      "Course Code",
      "OrgUnitId"
    ];
    var lines = [header.join(",")];
    for (var i = 0; i < state.filtered.length; i++) {
      var r = state.filtered[i];
      lines.push(
        [
          csvEscape(r.name),
          csvEscape(r.orgId),
          csvEscape(r.email),
          csvEscape(r.lastAccess ? fmtDate(r.lastAccess) : "Never"),
          csvEscape(contentVisitLabel(r)),
          csvEscape(r.daysInactive === null ? "" : r.daysInactive),
          csvEscape(r.bucket.label),
          csvEscape(state.courseLabel),
          csvEscape(state.courseCode),
          csvEscape(state.courseId)
        ].join(",")
      );
    }
    var blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    var safeCode = (state.courseCode || "course").replace(/[^\w.-]+/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = "Inactive_Outreach_" + safeCode + "_" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    setStatus("Downloaded outreach CSV (" + state.filtered.length + " students).");
  }

  async function copyEmails() {
    var emails = [];
    for (var i = 0; i < state.filtered.length; i++) {
      if (state.filtered[i].email) emails.push(state.filtered[i].email);
    }
    if (!emails.length) {
      setStatus("No email addresses available on the flagged list.");
      return;
    }
    var text = emails.join("; ");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setStatus("Copied " + emails.length + " email address(es) to clipboard.");
    } catch (e) {
      console.error("[ISA] copy failed", e);
      setStatus("Could not copy emails — try selecting them from the table.");
    }
  }

  async function init() {
    var courseSelect = $("isaCourse");
    if (window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(courseSelect);
    }

    courseSelect.addEventListener("change", function () {
      $("isaRunBtn").disabled = !courseSelect.value;
      $("isaResultsPanel").hidden = true;
      state.rows = [];
      state.filtered = [];
      state.contentBusy = false;
      if ($("isaContentBtn")) $("isaContentBtn").disabled = true;
      setStatus(courseSelect.value ? "Ready — choose a window and run the audit." : "");
    });

    $("isaWindow").addEventListener("change", function () {
      if (state.rows.length) renderResults();
    });

    $("isaRunBtn").addEventListener("click", runAudit);
    if ($("isaContentBtn")) $("isaContentBtn").addEventListener("click", loadContentVisits);
    $("isaExportBtn").addEventListener("click", exportCsv);
    $("isaCopyEmailsBtn").addEventListener("click", copyEmails);

    try {
      var me = await API.whoami();
      var meta = $("isaHeaderMeta");
      if (meta && me) {
        meta.textContent =
          "Signed in as " + ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
    } catch (e) {
      /* optional */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
