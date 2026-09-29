/**
 * Your Institution Faculty Dashboard — Student LDAA Lookup
 * Tab 1: currently enrolled students (original report).
 * Tab 2: previously removed students — enroll Student - LDAA Report (role 172), auto-download, then require unenroll.
 */
(function () {
  "use strict";

  var API = window.BrightspaceApi;
  var Report = window.LdaaReport;
  var LDA_ROLE_ID = 172;
  var LDA_ROLE_NAME = "Student - LDAA Report";

  var state = {
    instructorName: "",
    courseId: null,
    courseLabel: "",
    students: [],
    selectedStudent: null,
    lastDetail: null,
    removed: {
      courseId: null,
      courseLabel: "",
      user: null,
      enrolled: false,
      locked: false,
      busy: false
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg) {
    var el = $("ldaaStatus");
    if (el) el.textContent = msg || "";
  }

  function setRemovedStatus(msg) {
    var el = $("ldaaRemovedStatus");
    if (el) el.textContent = msg || "";
  }

  function httpMessage(err, fallback) {
    if (!err) return fallback;
    if (err.status === 403) {
      return "Brightspace denied this action (HTTP 403). You may not have permission to search users or assign Student - LDAA Report (role 172). Contact the eLearning Office.";
    }
    if (err.status === 404) return "Brightspace could not find that record (HTTP 404).";
    return err.message || fallback;
  }

  function userIdFromRecord(u) {
    if (!u) return null;
    var id = u.UserId != null ? u.UserId : u.Identifier != null ? u.Identifier : u.Id;
    return id != null && id !== "" ? String(id) : null;
  }

  function displayNameFromRecord(u) {
    if (!u) return "User";
    var last = u.LastName || "";
    var first = u.FirstName || "";
    if (last && first) return last + ", " + first;
    return u.DisplayName || u.UniqueName || "User";
  }

  function orgDefinedIdFromRecord(u) {
    return (u && (u.OrgDefinedId || u.OrgDefinedID)) || "";
  }

  function enrollmentRoleId(enr) {
    if (!enr) return null;
    if (enr.Role && enr.Role.Id != null) return parseInt(enr.Role.Id, 10);
    if (enr.RoleId != null) return parseInt(enr.RoleId, 10);
    return null;
  }

  function isLocked() {
    return !!state.removed.locked;
  }

  function showLock(bodyText) {
    var overlay = $("ldaaLockOverlay");
    var body = $("ldaaLockBody");
    if (body && bodyText) body.textContent = bodyText;
    if (overlay) overlay.hidden = false;
    var btn = $("ldaaLockUnenrollBtn");
    if (btn) btn.focus();
  }

  function hideLock() {
    var overlay = $("ldaaLockOverlay");
    if (overlay) overlay.hidden = true;
    var status = $("ldaaLockStatus");
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
  }

  function lockPage() {
    state.removed.locked = true;
    try {
      history.pushState({ ldaaLock: true }, "");
    } catch (e) {
      /* ignore */
    }
    var name = state.removed.user ? displayNameFromRecord(state.removed.user) : "This user";
    showLock(
      "The LDAA report downloaded. " +
        name +
        " is temporarily enrolled with " +
        LDA_ROLE_NAME +
        " (role " +
        LDA_ROLE_ID +
        "). Unenroll them before leaving this page."
    );
  }

  function unlockPage() {
    state.removed.locked = false;
    state.removed.enrolled = false;
    hideLock();
  }

  function updateProcessButton() {
    var btn = $("ldaaProcessBtn");
    if (!btn) return;
    btn.disabled = !state.removed.courseId || !state.removed.user || state.removed.busy || state.removed.locked;
  }

  function switchTab(which) {
    if (isLocked() && which !== "removed") {
      showLock("Unenroll the " + LDA_ROLE_NAME + " user before leaving this tab.");
      return;
    }
    var enrolled = which === "enrolled";
    $("ldaaTabEnrolled").classList.toggle("active", enrolled);
    $("ldaaTabRemoved").classList.toggle("active", !enrolled);
    $("ldaaTabEnrolled").setAttribute("aria-selected", enrolled ? "true" : "false");
    $("ldaaTabRemoved").setAttribute("aria-selected", enrolled ? "false" : "true");
    $("ldaaPanelEnrolled").classList.toggle("active", enrolled);
    $("ldaaPanelRemoved").classList.toggle("active", !enrolled);
    $("ldaaPanelEnrolled").hidden = !enrolled;
    $("ldaaPanelRemoved").hidden = enrolled;
  }

  async function loadStudentsForCourse(ouId) {
    state.courseId = ouId;
    state.selectedStudent = null;
    state.lastDetail = null;
    $("ldaaDetailPanel").hidden = true;

    var studentSelect = $("ldaaStudent");
    studentSelect.innerHTML = '<option value="">Loading classlist…</option>';
    studentSelect.disabled = true;
    $("ldaaViewBtn").disabled = true;

    if (!ouId) {
      studentSelect.innerHTML = '<option value="">Select a course first…</option>';
      return;
    }

    try {
      var raw = await API.classlist(ouId);
      var list = Report.normalizeClasslist(raw).filter(Report.isStudentRole);
      list.sort(function (a, b) {
        return ((a.LastName || "") + (a.FirstName || "")).localeCompare((b.LastName || "") + (b.FirstName || ""));
      });
      state.students = list;

      studentSelect.innerHTML = "";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = list.length ? "Select a student…" : "No students in classlist";
      studentSelect.appendChild(placeholder);

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var uid = s.Identifier || s.UserId;
        var opt = document.createElement("option");
        opt.value = String(uid);
        var last = s.LastName || "";
        var first = s.FirstName || "";
        var name = last && first ? last + ", " + first : s.DisplayName || "Student " + uid;
        opt.textContent = name + (s.OrgDefinedId ? " (" + s.OrgDefinedId + ")" : "");
        studentSelect.appendChild(opt);
      }
      studentSelect.disabled = !list.length;
      setStatus(list.length + " student(s) loaded.");
    } catch (e) {
      console.error("[LDAA] classlist failed", e);
      studentSelect.innerHTML = '<option value="">Failed to load classlist</option>';
      setStatus("Could not load classlist.");
    }
  }

  function getSelectedStudent() {
    var uid = $("ldaaStudent").value;
    if (!uid) return null;
    for (var i = 0; i < state.students.length; i++) {
      var s = state.students[i];
      if (String(s.Identifier || s.UserId) === String(uid)) {
        var last = s.LastName || "";
        var first = s.FirstName || "";
        return {
          UserId: s.Identifier || s.UserId,
          OrgDefinedId: s.OrgDefinedId || s.OrgDefinedID || "",
          DisplayName: s.DisplayName || (last && first ? last + ", " + first : last || first) || "Student",
          Email: s.Email || s.EmailAddress || "",
          LastAccessed: s.LastAccessed || null
        };
      }
    }
    return null;
  }

  function fmtActivityCell(iso) {
    if (!iso) return '<span style="color:#94a3b8">— none on record —</span>';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    var color = days <= 7 ? "#059669" : days <= 13 ? "#d97706" : "#dc2626";
    var dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return (
      '<strong style="color:' +
      color +
      '">' +
      Report.escapeHtml(dateStr) +
      '</strong> <span style="color:#64748b;font-size:0.82rem">(' +
      days +
      " day" +
      (days === 1 ? "" : "s") +
      " ago)</span>"
    );
  }

  function sortByDateDesc(items) {
    return (items || []).slice().sort(function (a, b) {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }

  function renderNamedList(title, items, nameFn) {
    if (!items || !items.length) return "";
    var sorted = sortByDateDesc(items);
    return (
      '<h4 class="ldaa-section-title">' +
      Report.escapeHtml(title) +
      " (" +
      sorted.length +
      ")</h4>" +
      '<table class="replace-strings-table ldaa-detail-table"><thead><tr><th>Item</th><th>Date</th></tr></thead><tbody>' +
      sorted
        .map(function (item) {
          return (
            "<tr><td>" +
            Report.escapeHtml(nameFn(item)) +
            "</td><td>" +
            fmtActivityCell(item.date) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>"
    );
  }

  function renderContentAccess(detail, courseId, userId, userName) {
    var access = detail.contentAccess || {};
    var rows = access.rows || [];
    var reportPath =
      access.reportPath ||
      "/d2l/lms/content/reports/statistics_users_details.d2l?userId=" +
        encodeURIComponent(userId || "") +
        "&ou=" +
        encodeURIComponent(courseId || "") +
        (userName ? "&userName=" + encodeURIComponent(userName) : "");
    var link =
      '<p class="ldaa-note"><a href="' +
      Report.escapeHtml(reportPath) +
      '" target="_blank" rel="noopener noreferrer">Open Content statistics in Brightspace</a></p>';
    if (!rows.length) {
      return (
        '<h4 class="ldaa-section-title">Content module access</h4>' +
        '<p class="ldaa-note">Brightspace did not return content-module access for this student. The Content statistics page still has the web view and the download.</p>' +
        link
      );
    }
    var note = access.outline
      ? "Opened " +
        (access.opened || 0) +
        " of " +
        (access.total || rows.length) +
        " topics. Bold rows are the module total from Content statistics. Opening content does not count toward the last date of academic activity."
      : "Opened " +
        (access.opened || 0) +
        " of " +
        (access.total || rows.length) +
        " topics. Opening a module does not count toward the last date of academic activity.";
    if (!access.visitsKnown) {
      note +=
        " Visit counts were not in the data Brightspace returned to this page. Last access dates are listed. Use the Content statistics link if you need the times-opened download.";
    }
    var showVisits = !!access.visitsKnown;
    var showTime = !!access.timeKnown;
    var head =
      "<tr><th>Module</th><th>Topic</th>" +
      (showVisits ? "<th>Visits</th>" : "") +
      (showTime ? "<th>Avg time</th>" : "") +
      "<th>Last accessed</th></tr>";
    var body = rows
      .map(function (row) {
        var when = row.date
          ? fmtActivityCell(row.date)
          : row.opened
            ? Report.escapeHtml(row.dateLabel || "Date not returned")
            : "Not opened";
        return (
          "<tr" +
          (row.isModule ? ' class="ldaa-module-row"' : "") +
          "><td>" +
          Report.escapeHtml(row.module || "—") +
          "</td><td>" +
          Report.escapeHtml(row.title || "Topic") +
          "</td>" +
          (showVisits ? "<td>" + (row.visits != null ? Report.escapeHtml(String(row.visits)) : "—") + "</td>" : "") +
          (showTime ? "<td>" + Report.escapeHtml(row.timeSpent || "—") + "</td>" : "") +
          "<td>" +
          when +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<h4 class="ldaa-section-title">Content module access</h4>' +
      '<p class="ldaa-note">' +
      Report.escapeHtml(note) +
      "</p>" +
      '<table class="replace-strings-table ldaa-detail-table"><thead>' +
      head +
      "</thead><tbody>" +
      body +
      "</tbody></table>" +
      link
    );
  }

  function renderDetail(student, detail, courseLabel) {
    var host = $("ldaaDetailContent");
    var lda = Report.overallLda(detail);
    var contentAccess = detail.contentAccess || {};
    var rows = [
      ["Last discussion post", detail.lastDiscussion, true],
      ["Last assignment submitted", detail.lastAssignment, true],
      ["Last quiz submitted", detail.lastQuiz, true],
      ["Last course access (login)", detail.lastLogin, false],
      ["Last content module access", contentAccess.lastVisited, false]
    ];

    host.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;padding:12px 16px;background:#e8f5f0;border-left:4px solid #0f5b46;border-radius:8px;margin-bottom:14px">' +
      '<div><div style="font-weight:600;color:#0f5b46">' +
      Report.escapeHtml(student.DisplayName) +
      (student.OrgDefinedId
        ? ' <span style="color:#64748b;font-weight:400">(' + Report.escapeHtml(student.OrgDefinedId) + ")</span>"
        : "") +
      '</div><div style="font-size:0.86rem;color:#64748b;margin-top:2px">' +
      Report.escapeHtml(courseLabel || "") +
      "</div></div>" +
      '<button type="button" class="form-button" id="ldaaPdfBtn"><i class="fas fa-file-pdf" aria-hidden="true"></i> Generate PDF</button>' +
      "</div>" +
      '<table class="replace-strings-table ldaa-detail-table" aria-label="Activity dates"><tbody>' +
      rows
        .map(function (row) {
          return (
            "<tr><td>" +
            Report.escapeHtml(row[0]) +
            (row[2]
              ? ""
              : '<br><span style="color:#64748b;font-size:0.78rem;font-style:italic">informational — not counted toward LDA</span>') +
            "</td><td>" +
            fmtActivityCell(row[1]) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      '<div class="ldaa-overall" role="region" aria-label="Overall LDA">' +
      '<div class="ldaa-overall-label">Overall Last Date of Academic Activity</div>' +
      '<div style="font-size:0.85rem;color:#991b1b;margin-top:4px">' +
      Report.escapeHtml(Report.facultyWithdrawalLine || "Use this date when you submit a faculty withdrawal and when you assign a final grade of F.") +
      "</div>" +
      '<div class="ldaa-overall-date">' +
      (lda ? Report.fmtDate(lda) : "No academic activity on record") +
      "</div></div>" +
      '<div class="ldaa-kpi-grid">' +
      '<div class="ldaa-kpi"><div class="ldaa-kpi-label">Discussion posts</div><div class="ldaa-kpi-value">' +
      (detail.discussions || []).length +
      '</div></div><div class="ldaa-kpi"><div class="ldaa-kpi-label">Assignments</div><div class="ldaa-kpi-value">' +
      (detail.assignments || []).length +
      '</div></div><div class="ldaa-kpi"><div class="ldaa-kpi-label">Quiz attempts</div><div class="ldaa-kpi-value">' +
      (detail.quizzes || []).length +
      '</div></div><div class="ldaa-kpi"><div class="ldaa-kpi-label">Graded items</div><div class="ldaa-kpi-value">' +
      (detail.grades || []).length +
      "</div></div></div>" +
      (detail.finalGrade
        ? '<p style="background:#f8fafc;padding:10px 14px;border-radius:8px"><strong>Final grade:</strong> ' +
          Report.escapeHtml(detail.finalGrade) +
          "</p>"
        : "") +
      renderNamedList("Discussion posts", detail.discussions, function (item) {
        return [item.forum, item.topic].filter(Boolean).join(" — ") || "Discussion post";
      }) +
      renderNamedList("Assignments submitted", detail.assignments, function (item) {
        return item.name || "Assignment";
      }) +
      renderNamedList("Quiz attempts", detail.quizzes, function (item) {
        return item.score ? (item.name || "Quiz") + " · score " + item.score : item.name || "Quiz";
      }) +
      renderContentAccess(detail, state.courseId, student.UserId || student.Identifier, student.DisplayName);

    $("ldaaPdfBtn").addEventListener("click", onGeneratePdf);
  }

  async function collectDetail(courseId, userId, lastAccessedHint, onProgress) {
    return Report.collectStudentDetail({
      orgUnitId: courseId,
      userId: userId,
      lastAccessedHint: lastAccessedHint || null,
      onProgress: onProgress || function () {}
    });
  }

  async function generatePdf(student, courseId, courseLabel, detail) {
    var parts = (courseLabel || "").match(/\(([^)]+)\)/);
    await Report.renderLDAReport({
      student: student,
      course: {
        Code: parts ? parts[1] : courseLabel,
        Name: courseLabel,
        OrgUnitId: courseId
      },
      detail: detail,
      preparedBy: state.instructorName
    });
  }

  async function onViewDetails() {
    var student = getSelectedStudent();
    if (!student || !state.courseId) return;

    state.selectedStudent = student;
    $("ldaaDetailPanel").hidden = false;
    $("ldaaDetailContent").innerHTML =
      '<div class="tool-loading"><div class="spinner" aria-hidden="true"></div><span>Collecting activity data…</span></div>';
    $("ldaaViewBtn").disabled = true;

    try {
      var detail = await collectDetail(state.courseId, student.UserId, student.LastAccessed, setStatus);
      state.lastDetail = detail;
      renderDetail(student, detail, state.courseLabel);
      setStatus("Activity loaded.");
    } catch (e) {
      console.error("[LDAA] detail failed", e);
      $("ldaaDetailContent").innerHTML =
        '<div class="tool-empty"><strong>Could not load activity</strong><p>' +
        Report.escapeHtml(e.message || "Unknown error") +
        "</p></div>";
    } finally {
      $("ldaaViewBtn").disabled = false;
    }
  }

  async function onGeneratePdf() {
    if (!state.selectedStudent || !state.lastDetail) return;
    var btn = $("ldaaPdfBtn");
    if (btn) btn.disabled = true;
    try {
      await generatePdf(state.selectedStudent, state.courseId, state.courseLabel, state.lastDetail);
    } catch (e) {
      console.error("[LDAA] PDF failed", e);
      setStatus(e.message || "Could not generate the PDF.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clearRemovedUser() {
    if (isLocked()) {
      showLock();
      return;
    }
    state.removed.user = null;
    var selected = $("ldaaRemovedSelected");
    if (selected) selected.classList.remove("show");
    var results = $("ldaaRemovedResults");
    if (results) {
      results.innerHTML = "";
      results.classList.remove("show");
      results.hidden = true;
    }
    updateProcessButton();
  }

  function selectRemovedUser(user) {
    state.removed.user = user;
    $("ldaaRemovedSelectedName").textContent = displayNameFromRecord(user);
    var extra = [];
    var orgId = orgDefinedIdFromRecord(user);
    if (orgId) extra.push("OrgDefinedId: " + orgId);
    if (user.UniqueName) extra.push(user.UniqueName);
    $("ldaaRemovedSelectedMeta").textContent = extra.join(" · ");
    $("ldaaRemovedSelected").classList.add("show");
    var results = $("ldaaRemovedResults");
    results.innerHTML = "";
    results.classList.remove("show");
    results.hidden = true;
    updateProcessButton();
  }

  async function onSearchRemoved() {
    if (isLocked()) {
      showLock();
      return;
    }
    var orgId = ($("ldaaOrgDefinedId").value || "").trim();
    clearRemovedUser();
    if (!orgId) {
      setRemovedStatus("Enter an OrgDefinedId to search.");
      return;
    }
    setRemovedStatus("Searching…");
    $("ldaaSearchBtn").disabled = true;
    try {
      var user = await API.findUserByOrgDefinedId(orgId);
      if (!user) {
        setRemovedStatus("No user found for that OrgDefinedId.");
        return;
      }
      selectRemovedUser(user);
      setRemovedStatus("User selected. Choose a course, then process the LDAA report.");
    } catch (e) {
      console.error("[LDAA] user search failed", e);
      setRemovedStatus(httpMessage(e, "Could not search by OrgDefinedId."));
    } finally {
      $("ldaaSearchBtn").disabled = false;
    }
  }

  async function fetchEnrollmentSafe(courseId, userId) {
    try {
      return await API.getEnrollment(courseId, userId);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function unenrollRemovedUser() {
    var courseId = state.removed.courseId;
    var user = state.removed.user;
    var uid = userIdFromRecord(user);
    if (!courseId || !uid) throw new Error("Missing course or user for unenroll.");
    await API.unenroll(courseId, uid);
    unlockPage();
    setRemovedStatus("Unenrolled " + displayNameFromRecord(user) + ". They are no longer in the course.");
  }

  async function onProcessRemoved() {
    if (state.removed.busy || isLocked()) return;
    var courseId = state.removed.courseId;
    var user = state.removed.user;
    var uid = userIdFromRecord(user);
    if (!courseId || !uid) return;

    state.removed.busy = true;
    updateProcessButton();

    try {
      setRemovedStatus("Checking current enrollment…");
      var existing = null;
      try {
        existing = await fetchEnrollmentSafe(courseId, uid);
      } catch (e) {
        if (e.status !== 403) throw e;
      }

      var roleId = enrollmentRoleId(existing);
      if (existing && roleId && roleId !== LDA_ROLE_ID) {
        setRemovedStatus(
          displayNameFromRecord(user) +
            " is still enrolled in this course. Use the Currently enrolled tab instead."
        );
        return;
      }

      if (!existing || roleId !== LDA_ROLE_ID) {
        setRemovedStatus("Enrolling " + LDA_ROLE_NAME + " (role " + LDA_ROLE_ID + ")…");
        await API.enroll(courseId, uid, LDA_ROLE_ID);
      }
      state.removed.enrolled = true;
      state.removed.locked = true;

      var student = {
        UserId: uid,
        OrgDefinedId: orgDefinedIdFromRecord(user),
        DisplayName: displayNameFromRecord(user),
        Email: user.ExternalEmail || user.Email || ""
      };

      setRemovedStatus("Collecting academic activity…");
      var detail = await collectDetail(courseId, uid, null, setRemovedStatus);

      setRemovedStatus("Downloading LDAA report…");
      await generatePdf(student, courseId, state.removed.courseLabel, detail);
      setRemovedStatus("Report downloaded. Unenroll this user before leaving the page.");
      lockPage();
    } catch (e) {
      console.error("[LDAA] removed-student process failed", e);
      if (state.removed.enrolled) {
        state.removed.locked = true;
        setRemovedStatus(
          httpMessage(e, "Processing stopped.") +
            " The user may still have " +
            LDA_ROLE_NAME +
            " (role " +
            LDA_ROLE_ID +
            "). Unenroll them before leaving."
        );
        lockPage();
      } else {
        setRemovedStatus(httpMessage(e, "Could not process the removed-student report."));
      }
    } finally {
      state.removed.busy = false;
      updateProcessButton();
    }
  }

  async function onLockUnenroll() {
    var btn = $("ldaaLockUnenrollBtn");
    var status = $("ldaaLockStatus");
    if (btn) btn.disabled = true;
    if (status) {
      status.classList.remove("is-error");
      status.textContent = "Unenrolling…";
    }
    try {
      await unenrollRemovedUser();
    } catch (e) {
      console.error("[LDAA] unenroll failed", e);
      if (status) {
        status.classList.add("is-error");
        status.textContent = httpMessage(e, "Could not unenroll. Stay on this page and try again.");
      }
    } finally {
      if (btn) btn.disabled = false;
      updateProcessButton();
    }
  }

  async function init() {
    var courseSelect = $("ldaaCourse");
    var removedCourseSelect = $("ldaaRemovedCourse");
    if (window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(courseSelect);
      await window.FacultyDashboardCourses.populateCourseSelect(removedCourseSelect);
    }

    $("ldaaTabEnrolled").addEventListener("click", function () {
      switchTab("enrolled");
    });
    $("ldaaTabRemoved").addEventListener("click", function () {
      switchTab("removed");
    });

    courseSelect.addEventListener("change", function () {
      var ouId = courseSelect.value;
      var opt = courseSelect.options[courseSelect.selectedIndex];
      state.courseLabel = opt ? opt.textContent : "";
      loadStudentsForCourse(ouId);
    });

    $("ldaaStudent").addEventListener("change", function () {
      $("ldaaViewBtn").disabled = !$("ldaaStudent").value;
    });
    $("ldaaViewBtn").addEventListener("click", onViewDetails);

    removedCourseSelect.addEventListener("change", function () {
      if (isLocked()) {
        removedCourseSelect.value = state.removed.courseId || "";
        showLock();
        return;
      }
      var ouId = removedCourseSelect.value;
      var opt = removedCourseSelect.options[removedCourseSelect.selectedIndex];
      state.removed.courseId = ouId || null;
      state.removed.courseLabel = opt ? opt.textContent : "";
      updateProcessButton();
    });

    $("ldaaSearchBtn").addEventListener("click", onSearchRemoved);
    $("ldaaOrgDefinedId").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSearchRemoved();
      }
    });
    $("ldaaRemovedClearBtn").addEventListener("click", function () {
      if (isLocked()) {
        showLock();
        return;
      }
      $("ldaaOrgDefinedId").value = "";
      clearRemovedUser();
      setRemovedStatus("");
    });
    $("ldaaProcessBtn").addEventListener("click", onProcessRemoved);
    $("ldaaLockUnenrollBtn").addEventListener("click", onLockUnenroll);

    window.addEventListener("beforeunload", function (e) {
      if (!isLocked()) return;
      e.preventDefault();
      e.returnValue = "Unenroll the Student - LDAA Report user before leaving this page.";
    });

    window.addEventListener("popstate", function () {
      if (!isLocked()) return;
      try {
        history.pushState({ ldaaLock: true }, "");
      } catch (err) {
        /* ignore */
      }
      showLock("Unenroll the Student - LDAA Report user before leaving this page.");
    });

    document.addEventListener(
      "click",
      function (e) {
        if (!isLocked()) return;
        var link = e.target.closest("a[href]");
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        showLock("Unenroll the Student - LDAA Report user before leaving this page.");
      },
      true
    );

    document.addEventListener("keydown", function (e) {
      if (!isLocked()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    try {
      var me = await API.whoami();
      var meta = $("ldaaHeaderMeta");
      if (me) {
        state.instructorName = ((me.FirstName || "") + " " + (me.LastName || "")).trim();
      }
      if (meta && state.instructorName) {
        meta.textContent = "Signed in as " + state.instructorName;
      }
    } catch (e) {
      /* optional */
    }

    updateProcessButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
