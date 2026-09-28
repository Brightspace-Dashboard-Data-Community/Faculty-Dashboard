/**
 * LDAA Period Report — date-range academic activity for a class or one student.
 * Assignments, quizzes, discussions, and last course login within the selected window.
 */
(function () {
  "use strict";

  var API = window.BrightspaceApi;
  var GREEN = [15, 91, 70];
  var coursesById = {};
  var lastReport = null;
  var snapshotFilter = "all";
  var instructorName = "";

  function $(id) {
    return document.getElementById(id);
  }

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toYmd(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseYmdStart(ymd) {
    var p = String(ymd || "").split("-");
    if (p.length !== 3) return null;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseYmdEnd(ymd) {
    var p = String(ymd || "").split("-");
    if (p.length !== 3) return null;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 23, 59, 59, 999);
    return isNaN(d.getTime()) ? null : d;
  }

  function mondayOf(d) {
    var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = copy.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    return copy;
  }

  function addDays(d, n) {
    var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    );
  }

  function inRange(iso, startMs, endMs) {
    if (!iso) return false;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return t >= startMs && t <= endMs;
  }

  function maxDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return new Date(a) >= new Date(b) ? a : b;
  }

  function asArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Objects)) return data.Objects;
    if (Array.isArray(data.Items)) return data.Items;
    if (Array.isArray(data.Quizzes)) return data.Quizzes;
    if (Array.isArray(data.Forums)) return data.Forums;
    if (Array.isArray(data.Topics)) return data.Topics;
    if (Array.isArray(data.Posts)) return data.Posts;
    if (Array.isArray(data.Attempts)) return data.Attempts;
    if (Array.isArray(data.Submissions)) return data.Submissions;
    return [];
  }

  function toRelativeApiUrl(nextPath) {
    if (!nextPath) return null;
    var s = String(nextPath);
    if (s.indexOf("/d2l/api/") >= 0) {
      var parts = s.split("/d2l/api/");
      return "/d2l/api/" + parts[1];
    }
    if (s.indexOf("/") === 0) return s;
    return null;
  }

  async function fetchOptional(url) {
    try {
      return await API.raw(url);
    } catch (e) {
      return null;
    }
  }

  async function fetchAllPaged(firstUrl, maxPages) {
    maxPages = maxPages || 40;
    var all = [];
    var url = firstUrl;
    var pages = 0;
    var seen = {};
    while (url && pages < maxPages) {
      if (seen[url]) break;
      seen[url] = true;
      pages++;
      var data = await fetchOptional(url);
      if (!data) break;
      var items = asArray(data);
      for (var i = 0; i < items.length; i++) all.push(items[i]);
      var next = data.Next || (data.PagingInfo && data.PagingInfo.HasMoreItems && data.PagingInfo.Bookmark);
      if (!next) break;
      var rel = toRelativeApiUrl(next);
      if (rel) {
        url = rel;
      } else {
        var bookmark = data.PagingInfo && data.PagingInfo.Bookmark ? data.PagingInfo.Bookmark : next;
        var base = firstUrl.replace(/([?&])bookmark=[^&]*/g, "$1").replace(/[?&]$/, "");
        var sep = base.indexOf("?") >= 0 ? "&" : "?";
        url = base + sep + "bookmark=" + encodeURIComponent(bookmark);
      }
    }
    return all;
  }

  function mapPool(items, limit, fn) {
    var i = 0;
    var results = new Array(items.length);
    function next() {
      if (i >= items.length) return Promise.resolve();
      var idx = i++;
      return Promise.resolve(fn(items[idx], idx))
        .then(function (val) {
          results[idx] = val;
          return next();
        })
        .catch(function () {
          results[idx] = null;
          return next();
        });
    }
    var n = Math.min(limit, items.length);
    if (!n) return Promise.resolve(results);
    var runners = [];
    for (var r = 0; r < n; r++) runners.push(next());
    return Promise.all(runners).then(function () {
      return results;
    });
  }

  function setStatus(type, text) {
    var el = $("lprMessage");
    if (!el) return;
    el.style.display = "block";
    el.className = "message-container" + (type ? " message-" + type : "");
    el.textContent = text;
  }

  function studentUserId(member) {
    if (!member) return "";
    var id = member.Identifier != null ? member.Identifier : member.UserId != null ? member.UserId : member.Id;
    return id != null ? String(id) : "";
  }

  function isDemoStudent(member) {
    if (!member) return false;
    return (member.FirstName || "").trim() === "ZZDemo" && (member.LastName || "").trim() === "ZZStudent";
  }

  function isStudentRole(member) {
    var roleName = (
      (member.Role && (member.Role.Name || member.RoleName)) ||
      member.RoleName ||
      member.ClasslistRoleDisplayName ||
      ""
    ).toLowerCase();
    if (/instructor|designer|admin|grader|ta\b|faculty|teacher/.test(roleName)) return false;
    if (/^student|learner/.test(roleName) || roleName.indexOf("student") >= 0) return true;
    var rid = member.RoleId != null ? member.RoleId : member.Role && member.Role.Id;
    if (rid === 3 || rid === 5 || rid === 101) return true;
    if (!roleName) return true;
    return false;
  }

  function displayName(s) {
    var last = s.LastName || "";
    var first = s.FirstName || "";
    if (last && first) return last + ", " + first;
    return s.DisplayName || "Student";
  }

  function entityUserId(wrap) {
    if (!wrap) return "";
    var entity = wrap.Entity || wrap.entity || wrap;
    var id =
      entity.EntityId != null
        ? entity.EntityId
        : entity.Identifier != null
          ? entity.Identifier
          : entity.Id != null
            ? entity.Id
            : entity.UserId != null
              ? entity.UserId
              : wrap.SubmittedBy && (wrap.SubmittedBy.Identifier || wrap.SubmittedBy.Id);
    return id != null ? String(id) : "";
  }

  function submissionDatesFromEntity(wrap) {
    var dates = [];
    if (!wrap) return dates;
    var submissions = wrap.Submissions || wrap.submissions || [];
    for (var i = 0; i < submissions.length; i++) {
      var sub = submissions[i] || {};
      var d =
        sub.SubmissionDate ||
        sub.SubmittedDate ||
        sub.DateSubmitted ||
        sub.CreationDate ||
        sub.CreatedDate ||
        null;
      if (d) dates.push(d);
    }
    var flat =
      wrap.SubmissionDate ||
      wrap.SubmittedDate ||
      wrap.DateSubmitted ||
      wrap.CompletionDate ||
      wrap.CreatedDate ||
      null;
    if (flat && !dates.length) dates.push(flat);
    return dates;
  }

  function attemptDate(att) {
    if (!att) return null;
    return (
      att.Completed ||
      att.AttemptDate ||
      att.DateCompleted ||
      att.Started ||
      att.SubmittedDate ||
      att.SubmissionDate ||
      att.CompletionDate ||
      att.EndDate ||
      null
    );
  }

  function flattenAttempts(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row && Array.isArray(row.Attempts) && row.Attempts.length) {
        for (var j = 0; j < row.Attempts.length; j++) {
          var att = row.Attempts[j] || {};
          if (att.UserId == null && row.UserId != null) att.UserId = row.UserId;
          if (!att.User && row.User) att.User = row.User;
          out.push(att);
        }
      } else if (row) {
        out.push(row);
      }
    }
    return out;
  }

  function attemptUserId(att) {
    if (!att) return "";
    if (att.UserId != null) return String(att.UserId);
    if (att.User && att.User.Id != null) return String(att.User.Id);
    if (att.User && att.User.Identifier != null) return String(att.User.Identifier);
    return "";
  }

  function postUserId(post) {
    if (!post) return "";
    var id =
      post.PostingUserId != null
        ? post.PostingUserId
        : post.UserId != null
          ? post.UserId
          : post.UserIdentifier != null
            ? post.UserIdentifier
            : null;
    return id != null ? String(id) : "";
  }

  function classifyLastAccess(iso, startMs, endMs) {
    if (!iso) return { inPeriod: null, note: "never" };
    var t = new Date(iso).getTime();
    if (isNaN(t)) return { inPeriod: null, note: "never" };
    if (t >= startMs && t <= endMs) return { inPeriod: iso, note: "in-period" };
    if (t < startMs) return { inPeriod: null, note: "before" };
    return { inPeriod: null, note: "after" };
  }

  function loginLabel(note) {
    if (note === "in-period") return "";
    if (note === "before") return "No access in period";
    if (note === "after") return "Later access recorded";
    return "Never accessed";
  }

  async function loadClasslist(orgUnitId) {
    var raw = [];
    try {
      raw = asArray(await API.classlist(orgUnitId));
    } catch (e) {
      raw = [];
    }
    if (!raw.length) {
      try {
        raw = asArray(await API.classlistPaged(orgUnitId));
      } catch (e) {
        raw = [];
      }
    }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var m = raw[i];
      if (!isStudentRole(m) || isDemoStudent(m)) continue;
      var uid = studentUserId(m);
      if (!uid) continue;
      out.push({
        userId: uid,
        lastName: m.LastName || "",
        firstName: m.FirstName || "",
        displayName: displayName(m),
        orgDefinedId: m.OrgDefinedId || m.OrgDefinedID || "",
        email: m.Email || m.EmailAddress || "",
        lastAccessed: m.LastAccessed || m.LastAccessedDate || null
      });
    }
    out.sort(function (a, b) {
      return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName);
    });
    return out;
  }

  async function collectPeriodActivity(orgUnitId, startMs, endMs, onProgress) {
    var le = API.LE;
    var byUser = {};

    function bucket(uid) {
      if (!byUser[uid]) {
        byUser[uid] = { assignments: [], quizzes: [], discussions: [] };
      }
      return byUser[uid];
    }

    onProgress("Scanning assignment folders…");
    var folders = asArray(await fetchOptional("/d2l/api/le/" + le + "/" + orgUnitId + "/dropbox/folders/"));
    await mapPool(folders, 3, async function (folder, idx) {
      onProgress("Reading assignment " + (idx + 1) + " of " + folders.length + "…");
      var fid = folder.Id != null ? folder.Id : folder.FolderId;
      if (fid == null) return;
      var name = folder.Name || folder.FolderName || "Assignment";
      var subs = await fetchAllPaged(
        "/d2l/api/le/" + le + "/" + orgUnitId + "/dropbox/folders/" + fid + "/submissions/?activeOnly=true",
        20
      );
      if (!subs.length) {
        subs = await fetchAllPaged(
          "/d2l/api/le/" + le + "/" + orgUnitId + "/dropbox/folders/" + fid + "/submissions/paged/?activeOnly=true",
          20
        );
      }
      for (var i = 0; i < subs.length; i++) {
        var wrap = subs[i];
        var uid = entityUserId(wrap);
        if (!uid) continue;
        var dates = submissionDatesFromEntity(wrap);
        for (var d = 0; d < dates.length; d++) {
          if (!inRange(dates[d], startMs, endMs)) continue;
          bucket(uid).assignments.push({ name: name, date: dates[d] });
        }
      }
    });

    onProgress("Scanning quizzes…");
    var quizzes = asArray(await fetchOptional("/d2l/api/le/" + le + "/" + orgUnitId + "/quizzes/"));
    await mapPool(quizzes, 3, async function (quiz, idx) {
      onProgress("Reading quiz " + (idx + 1) + " of " + quizzes.length + "…");
      var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
      if (qid == null) return;
      var name = quiz.Name || "Quiz";
      var attempts = flattenAttempts(
        await fetchAllPaged("/d2l/api/le/" + le + "/" + orgUnitId + "/quizzes/" + qid + "/attempts/", 30)
      );
      for (var i = 0; i < attempts.length; i++) {
        var att = attempts[i];
        var uid = attemptUserId(att);
        if (!uid) continue;
        var when = attemptDate(att);
        if (!inRange(when, startMs, endMs)) continue;
        bucket(uid).quizzes.push({ name: name, date: when });
      }
    });

    onProgress("Scanning discussion boards…");
    var forums = asArray(
      await fetchOptional("/d2l/api/le/" + le + "/" + orgUnitId + "/discussions/forums/")
    );
    for (var f = 0; f < forums.length; f++) {
      var forum = forums[f];
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      var forumName = forum.Name || "Forum";
      var topics = asArray(
        await fetchOptional("/d2l/api/le/" + le + "/" + orgUnitId + "/discussions/forums/" + fid + "/topics/")
      );
      for (var t = 0; t < topics.length; t++) {
        var topic = topics[t];
        var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
        if (tid == null) continue;
        var topicName = topic.Name || "Topic";
        onProgress("Reading discussion: " + forumName + " / " + topicName + "…");
        var posts = [];
        for (var page = 1; page <= 15; page++) {
          var pageData = await fetchOptional(
            "/d2l/api/le/" +
              le +
              "/" +
              orgUnitId +
              "/discussions/forums/" +
              fid +
              "/topics/" +
              tid +
              "/posts/?pageSize=200&pageNumber=" +
              page
          );
          var chunk = asArray(pageData);
          if (!chunk.length) break;
          for (var p = 0; p < chunk.length; p++) posts.push(chunk[p]);
          if (chunk.length < 200) break;
        }
        for (var i = 0; i < posts.length; i++) {
          var post = posts[i];
          if (post.IsDeleted) continue;
          var uid = postUserId(post);
          if (!uid) continue;
          var pDate = post.PostDate || post.DatePosted || post.DateCreated;
          if (!inRange(pDate, startMs, endMs)) continue;
          bucket(uid).discussions.push({
            name: forumName + " — " + topicName,
            date: pDate
          });
        }
      }
    }

    return byUser;
  }

  function latestDate(items) {
    var best = null;
    for (var i = 0; i < items.length; i++) best = maxDate(best, items[i].date);
    return best;
  }

  function sortByDateDesc(items) {
    return (items || []).slice().sort(function (a, b) {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }

  function buildStudentRow(student, activity, startMs, endMs) {
    var bucket = activity[student.userId] || { assignments: [], quizzes: [], discussions: [] };
    var assignments = sortByDateDesc(bucket.assignments);
    var quizzes = sortByDateDesc(bucket.quizzes);
    var discussions = sortByDateDesc(bucket.discussions);
    var lastAssignment = latestDate(assignments);
    var lastQuiz = latestDate(quizzes);
    var lastDiscussion = latestDate(discussions);
    var ldaa = lastAssignment;
    ldaa = maxDate(ldaa, lastQuiz);
    ldaa = maxDate(ldaa, lastDiscussion);
    var access = classifyLastAccess(student.lastAccessed, startMs, endMs);
    return {
      userId: student.userId,
      lastName: student.lastName,
      firstName: student.firstName,
      displayName: student.displayName,
      orgDefinedId: student.orgDefinedId,
      email: student.email,
      lastAssignment: lastAssignment,
      lastQuiz: lastQuiz,
      lastDiscussion: lastDiscussion,
      ldaa: ldaa,
      lastLoginInPeriod: access.inPeriod,
      lastKnownAccess: student.lastAccessed,
      loginNote: access.note,
      assignmentCount: assignments.length,
      quizCount: quizzes.length,
      discussionCount: discussions.length,
      hasActivity: !!(assignments.length || quizzes.length || discussions.length),
      activities: {
        assignments: assignments,
        quizzes: quizzes,
        discussions: discussions
      }
    };
  }

  function selectedScope() {
    var el = document.querySelector('input[name="lprScope"]:checked');
    return el ? el.value : "class";
  }

  function selectedCourse() {
    var id = $("lprCourse").value;
    return id ? coursesById[id] || null : null;
  }

  function applyPreset(kind) {
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var start;
    var end;
    if (kind === "thisWeek") {
      start = mondayOf(today);
      end = addDays(start, 6);
    } else if (kind === "lastWeek") {
      end = addDays(mondayOf(today), -1);
      start = mondayOf(end);
    } else {
      end = today;
      start = addDays(today, -6);
    }
    $("lprStart").value = toYmd(start);
    $("lprEnd").value = toYmd(end);
  }

  function syncScopeUi() {
    var scope = selectedScope();
    var group = $("lprStudentGroup");
    var cards = document.querySelectorAll("#lprForm .cr-type-card");
    for (var i = 0; i < cards.length; i++) {
      var input = cards[i].querySelector("input");
      if (input && input.checked) cards[i].classList.add("is-selected");
      else cards[i].classList.remove("is-selected");
    }
    if (group) group.hidden = scope !== "student";
  }

  function fillStudentSelect(students) {
    var sel = $("lprStudent");
    sel.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = students.length ? "Select a student…" : "No students in classlist";
    sel.appendChild(placeholder);
    for (var i = 0; i < students.length; i++) {
      var s = students[i];
      var opt = document.createElement("option");
      opt.value = s.userId;
      opt.textContent = s.displayName + (s.orgDefinedId ? " (" + s.orgDefinedId + ")" : "");
      sel.appendChild(opt);
    }
    sel.disabled = !students.length;
  }

  async function onCourseChange() {
    var course = selectedCourse();
    var sel = $("lprStudent");
    lastReport = null;
    $("lprPreviewSection").hidden = true;
    if (!course) {
      sel.innerHTML = '<option value="">Select a course first…</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML = '<option value="">Loading classlist…</option>';
    sel.disabled = true;
    try {
      var students = await loadClasslist(course.OrgUnit.Id);
      course._students = students;
      fillStudentSelect(students);
      setStatus("", students.length + " student(s) loaded. Choose a date range and run the report.");
    } catch (e) {
      console.error(e);
      sel.innerHTML = '<option value="">Failed to load classlist</option>';
      setStatus("error", "Could not load classlist.");
    }
  }

  function kpiHtml(label, value, extraClass) {
    return (
      '<div class="cr-kpi' +
      (extraClass ? " " + extraClass : "") +
      '"><div class="cr-kpi-label">' +
      escapeHtml(label) +
      '</div><div class="cr-kpi-value">' +
      escapeHtml(value) +
      "</div></div>"
    );
  }

  function activityListHtml(items, emptyText) {
    if (!items.length) {
      return '<p class="cr-muted">' + escapeHtml(emptyText) + "</p>";
    }
    var html = '<ul class="lpr-activity-list">';
    for (var i = 0; i < items.length; i++) {
      html +=
        "<li><span class=\"lpr-activity-name\">" +
        escapeHtml(items[i].name) +
        '</span><time datetime="' +
        escapeHtml(items[i].date) +
        '">' +
        escapeHtml(fmtDateTime(items[i].date)) +
        "</time></li>";
    }
    html += "</ul>";
    return html;
  }

  function filteredRows(report) {
    var rows = report.rows;
    if (snapshotFilter === "active") {
      return rows.filter(function (r) {
        return r.hasActivity;
      });
    }
    if (snapshotFilter === "none") {
      return rows.filter(function (r) {
        return !r.hasActivity;
      });
    }
    return rows;
  }

  function renderPreview(report) {
    var rows = filteredRows(report);
    var withAct = 0;
    var noAct = 0;
    var withLogin = 0;
    for (var c = 0; c < report.rows.length; c++) {
      if (report.rows[c].hasActivity) withAct++;
      else noAct++;
      if (report.rows[c].lastLoginInPeriod) withLogin++;
    }

    var html =
      '<div class="cr-kpis">' +
      kpiHtml("Students", String(report.rows.length)) +
      kpiHtml("With academic activity", String(withAct)) +
      kpiHtml("No activity in period", String(noAct), noAct ? "lpr-kpi-alert" : "") +
      kpiHtml("Login in period", String(withLogin)) +
      "</div>";

    html +=
      '<div class="cr-panel"><p class="lpr-period-meta"><strong>' +
      escapeHtml(report.course.name) +
      "</strong> · " +
      escapeHtml(report.course.code || "") +
      " · " +
      escapeHtml(report.rangeLabel) +
      (report.scope === "student" ? " · one student" : " · entire class") +
      "</p>" +
      '<p class="cr-muted">Snapshot dates are the latest submission in the selected window. Last login is shown only when Brightspace last course access falls inside the window. Login does not count toward LDAA.</p>' +
      '<div class="lpr-filter-bar" role="group" aria-label="Snapshot filter">' +
      '<button type="button" class="lpr-filter' +
      (snapshotFilter === "all" ? " is-active" : "") +
      '" data-filter="all">All</button>' +
      '<button type="button" class="lpr-filter' +
      (snapshotFilter === "active" ? " is-active" : "") +
      '" data-filter="active">Has activity</button>' +
      '<button type="button" class="lpr-filter' +
      (snapshotFilter === "none" ? " is-active" : "") +
      '" data-filter="none">No activity</button>' +
      "</div>" +
      '<div class="cr-table-wrap"><table class="cr-table" aria-label="LDAA period snapshot"><thead><tr>' +
      "<th>Student</th><th>ID</th><th>Assignment</th><th>Quiz</th><th>Discussion</th><th>Last login</th><th>LDAA</th>" +
      "</tr></thead><tbody>";

    if (!rows.length) {
      html += '<tr><td colspan="7" class="cr-muted">No students match this filter.</td></tr>';
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html +=
        '<tr' +
        (r.hasActivity ? "" : ' class="lpr-row-none"') +
        "><td>" +
        escapeHtml(r.displayName) +
        "</td><td>" +
        escapeHtml(r.orgDefinedId || "—") +
        "</td><td>" +
        escapeHtml(fmtDate(r.lastAssignment)) +
        "</td><td>" +
        escapeHtml(fmtDate(r.lastQuiz)) +
        "</td><td>" +
        escapeHtml(fmtDate(r.lastDiscussion)) +
        "</td><td>" +
        (r.lastLoginInPeriod
          ? escapeHtml(fmtDate(r.lastLoginInPeriod))
          : '<span class="cr-muted">' + escapeHtml(loginLabel(r.loginNote)) + "</span>") +
        "</td><td>" +
        (r.ldaa ? "<strong>" + escapeHtml(fmtDate(r.ldaa)) + "</strong>" : "—") +
        "</td></tr>";
    }
    html += "</tbody></table></div></div>";

    html += '<div class="cr-panel"><h3>Detailed results</h3>';
    html +=
      '<p class="cr-muted">Every assignment submission, quiz attempt, and discussion post dated in the selected period.</p>';
    var detailRows = report.rows;
    for (var d = 0; d < detailRows.length; d++) {
      var st = detailRows[d];
      var total = st.assignmentCount + st.quizCount + st.discussionCount;
      html +=
        '<details class="lpr-detail-card"' +
        (report.scope === "student" || detailRows.length === 1 ? " open" : "") +
        "><summary><span>" +
        escapeHtml(st.displayName) +
        (st.orgDefinedId ? ' <span class="cr-muted">(' + escapeHtml(st.orgDefinedId) + ")</span>" : "") +
        '</span><span class="lpr-detail-count">' +
        (st.hasActivity ? total + " activit" + (total === 1 ? "y" : "ies") : "No activity") +
        "</span></summary>";
      if (!st.hasActivity) {
        html += '<p class="cr-muted">No assignments, quizzes, or discussion posts were submitted in this period.</p>';
      } else {
        html +=
          '<div class="lpr-detail-grid"><section><h4>Assignments</h4>' +
          activityListHtml(st.activities.assignments, "None in this period") +
          "</section><section><h4>Quizzes</h4>" +
          activityListHtml(st.activities.quizzes, "None in this period") +
          "</section><section><h4>Discussions</h4>" +
          activityListHtml(st.activities.discussions, "None in this period") +
          "</section></div>";
      }
      html += "</details>";
    }
    html += "</div>";
    return html;
  }

  function refreshPreview() {
    if (!lastReport) return;
    $("lprPreview").innerHTML = renderPreview(lastReport);
  }

  function sanitizeFilenamePart(s) {
    return (s || "course").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").substring(0, 80);
  }

  function reportFilename(report, ext) {
    return (
      "LDAA_Period_" +
      sanitizeFilenamePart(report.course.code || report.course.name) +
      "_" +
      toYmd(report.start) +
      "_to_" +
      toYmd(report.end) +
      "." +
      ext
    );
  }

  function triggerDownload(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 2000);
  }

  function escapeCsvField(val) {
    var s = val == null ? "" : String(val);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function activitySummary(row) {
    var parts = [];
    function add(type, items) {
      for (var i = 0; i < items.length; i++) {
        parts.push(type + ": " + items[i].name + " (" + fmtDateTime(items[i].date) + ")");
      }
    }
    add("Assignment", row.activities.assignments);
    add("Quiz", row.activities.quizzes);
    add("Discussion", row.activities.discussions);
    return parts.join("; ");
  }

  function snapshotExportRows(report) {
    var sem = semesterApi() ? semesterApi().getSemesterCodeFromCourseCode(report.course.code) : "";
    var rows = [];
    for (var i = 0; i < report.rows.length; i++) {
      var r = report.rows[i];
      rows.push({
        Semester: sem,
        CourseName: report.course.name,
        CourseCode: report.course.code,
        CourseId: report.course.id,
        PeriodStart: toYmd(report.start),
        PeriodEnd: toYmd(report.end),
        LastName: r.lastName,
        FirstName: r.firstName,
        OrgDefinedId: r.orgDefinedId,
        UserId: r.userId,
        LastAssignmentDate: r.lastAssignment ? fmtDate(r.lastAssignment) : "",
        LastQuizDate: r.lastQuiz ? fmtDate(r.lastQuiz) : "",
        LastDiscussionDate: r.lastDiscussion ? fmtDate(r.lastDiscussion) : "",
        LastLoginInPeriod: r.lastLoginInPeriod ? fmtDate(r.lastLoginInPeriod) : "",
        LastKnownCourseAccess: r.lastKnownAccess ? fmtDateTime(r.lastKnownAccess) : "",
        LoginNote: loginLabel(r.loginNote),
        LdaaInPeriod: r.ldaa ? fmtDate(r.ldaa) : "",
        AssignmentCount: r.assignmentCount,
        QuizCount: r.quizCount,
        DiscussionCount: r.discussionCount,
        HasAcademicActivity: r.hasActivity ? "Yes" : "No",
        Activities: activitySummary(r)
      });
    }
    return rows;
  }

  function detailExportRows(report) {
    var rows = [];
    for (var i = 0; i < report.rows.length; i++) {
      var r = report.rows[i];
      function add(type, items) {
        for (var j = 0; j < items.length; j++) {
          rows.push({
            LastName: r.lastName,
            FirstName: r.firstName,
            OrgDefinedId: r.orgDefinedId,
            ActivityType: type,
            ActivityName: items[j].name,
            SubmittedAt: fmtDateTime(items[j].date)
          });
        }
      }
      add("Assignment", r.activities.assignments);
      add("Quiz", r.activities.quizzes);
      add("Discussion", r.activities.discussions);
      if (!r.hasActivity) {
        rows.push({
          LastName: r.lastName,
          FirstName: r.firstName,
          OrgDefinedId: r.orgDefinedId,
          ActivityType: "",
          ActivityName: "No academic activity in period",
          SubmittedAt: ""
        });
      }
    }
    return rows;
  }

  var SNAPSHOT_COLS = [
    "Semester",
    "CourseName",
    "CourseCode",
    "CourseId",
    "PeriodStart",
    "PeriodEnd",
    "LastName",
    "FirstName",
    "OrgDefinedId",
    "UserId",
    "LastAssignmentDate",
    "LastQuizDate",
    "LastDiscussionDate",
    "LastLoginInPeriod",
    "LastKnownCourseAccess",
    "LoginNote",
    "LdaaInPeriod",
    "AssignmentCount",
    "QuizCount",
    "DiscussionCount",
    "HasAcademicActivity",
    "Activities"
  ];

  var DETAIL_COLS = ["LastName", "FirstName", "OrgDefinedId", "ActivityType", "ActivityName", "SubmittedAt"];

  function rowsToCsv(rows, columns) {
    var lines = [columns.map(escapeCsvField).join(",")];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var line = [];
      for (var c = 0; c < columns.length; c++) line.push(escapeCsvField(row[columns[c]]));
      lines.push(line.join(","));
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  function exportCsv(report) {
    var csv = rowsToCsv(snapshotExportRows(report), SNAPSHOT_COLS);
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), reportFilename(report, "csv"));
  }

  function exportXlsx(report) {
    if (!window.XLSX) throw new Error("Excel library failed to load. Refresh the page and try again.");
    var wb = window.XLSX.utils.book_new();
    var snap = window.XLSX.utils.json_to_sheet(snapshotExportRows(report), { header: SNAPSHOT_COLS });
    var detail = window.XLSX.utils.json_to_sheet(detailExportRows(report), { header: DETAIL_COLS });
    window.XLSX.utils.book_append_sheet(wb, snap, "Snapshot");
    window.XLSX.utils.book_append_sheet(wb, detail, "Activity Detail");
    window.XLSX.writeFile(wb, reportFilename(report, "xlsx"));
  }

  function pdfSafe(s) {
    return String(s == null ? "" : s).replace(/[^\x20-\x7E]/g, function (ch) {
      if (ch === "–" || ch === "—" || ch === "−") return "-";
      if (ch === "’" || ch === "‘") return "'";
      if (ch === "“" || ch === "”") return '"';
      return " ";
    });
  }

  function getJsPdfCtor() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  async function exportPdf(report) {
    var JsPDF = getJsPdfCtor();
    if (!JsPDF) throw new Error("PDF library failed to load. Refresh the page and try again.");
    var Brand = window.FacultyDashboardPdfBrand;
    var duckLogo = Brand ? await Brand.loadDuckLogo() : null;
    var doc = new JsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var y = 0;
    var pageNum = 1;

    doc.setProperties({
      title: "LDAA Period Report — " + report.course.name,
      subject: "Last Date of Academic Activity for " + report.rangeLabel,
      author: "Your Institution Faculty Dashboard",
      creator: "Your Institution eLearning Office",
      keywords: "LDAA, attendance, FERPA, Your Institution"
    });

    function drawChrome(isCover) {
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(0, 0, pageW, isCover ? 78 : 50, "F");
      var duckH = isCover ? 46 : 28;
      var duckY = isCover ? 16 : 11;
      var textX = margin;
      if (Brand && duckLogo) {
        var duckW = Brand.drawDuck(doc, duckLogo, margin, duckY, duckH);
        if (duckW) textX = margin + duckW + 12;
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(isCover ? 16 : 11);
      doc.text("Your Institution Faculty Dashboard", textX, isCover ? 28 : 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(isCover ? 13 : 9);
      doc.text("LDAA Period Report", textX, isCover ? 48 : 38);
      if (isCover) {
        doc.setFontSize(9);
        doc.text(pdfSafe(report.course.name), textX, 64);
      }
    }

    function drawFooter() {
      doc.setDrawColor(15, 91, 70);
      doc.setLineWidth(0.8);
      doc.line(margin, pageH - 28, pageW - margin, pageH - 28);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(90, 98, 94);
      doc.text("Your Institution  ·  eLearning Office  ·  FERPA education record", margin, pageH - 14);
      doc.text("Page " + pageNum, pageW - margin, pageH - 14, { align: "right" });
    }

    function newPage() {
      drawFooter();
      doc.addPage();
      pageNum += 1;
      drawChrome(false);
      y = 72;
    }

    function need(h) {
      if (y + h > pageH - 42) newPage();
    }

    drawChrome(true);
    drawFooter();
    y = 100;
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Course: " + pdfSafe(report.course.name) + "  (" + pdfSafe(report.course.code || "-") + ")", margin, y);
    y += 14;
    doc.text(
      "Period: " +
        pdfSafe(report.rangeLabel) +
        "    Scope: " +
        (report.scope === "student" ? "One student" : "Entire class") +
        "    Generated: " +
        report.generatedAt.toLocaleString("en-US"),
      margin,
      y
    );
    y += 14;
    if (instructorName) {
      doc.text("Prepared by: " + pdfSafe(instructorName), margin, y);
      y += 14;
    }
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Snapshot shows the latest assignment, quiz, and discussion date in the window. LDAA is the latest of those three. Last login is informational and is shown only when last course access falls in the period.",
      margin,
      y,
      { maxWidth: pageW - margin * 2 }
    );
    y += 28;

    var withAct = 0;
    var noAct = 0;
    var withLogin = 0;
    for (var n = 0; n < report.rows.length; n++) {
      if (report.rows[n].hasActivity) withAct++;
      else noAct++;
      if (report.rows[n].lastLoginInPeriod) withLogin++;
    }
    var cards = [
      ["Students", String(report.rows.length)],
      ["With activity", String(withAct)],
      ["No activity", String(noAct)],
      ["Login in period", String(withLogin)]
    ];
    var cardW = 150;
    var gap = 12;
    for (var k = 0; k < cards.length; k++) {
      var cx = margin + k * (cardW + gap);
      doc.setFillColor(232, 245, 240);
      doc.roundedRect(cx, y, cardW, 42, 6, 6, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(15, 91, 70);
      doc.text(cards[k][0], cx + 10, y + 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 91, 70);
      doc.text(cards[k][1], cx + 10, y + 34);
    }
    y += 58;

    need(28);
    doc.setFillColor(232, 245, 240);
    doc.rect(margin, y, pageW - margin * 2, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.text("Period snapshot", margin + 8, y + 15);
    y += 28;

    var colW = [150, 78, 86, 86, 86, 100, 86];
    var headers = ["Student", "ID", "Assignment", "Quiz", "Discussion", "Last login", "LDAA"];
    function drawTableHeader() {
      need(20);
      doc.setFillColor(232, 245, 240);
      doc.rect(margin, y, pageW - margin * 2, 18, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      var tx = margin + 6;
      for (var h = 0; h < headers.length; h++) {
        doc.text(headers[h], tx, y + 12);
        tx += colW[h];
      }
      y += 18;
    }
    drawTableHeader();
    doc.setFont("helvetica", "normal");
    for (var r = 0; r < report.rows.length; r++) {
      need(16);
      if (y === 72) drawTableHeader();
      var row = report.rows[r];
      if (!row.hasActivity) doc.setFillColor(254, 242, 242);
      else if (r % 2 === 1) doc.setFillColor(248, 250, 252);
      if (!row.hasActivity || r % 2 === 1) {
        doc.rect(margin, y - 3, pageW - margin * 2, 16, "F");
      }
      doc.setTextColor(row.hasActivity ? 30 : 153, row.hasActivity ? 41 : 27, row.hasActivity ? 59 : 27);
      var cells = [
        pdfSafe(row.displayName).substring(0, 28),
        pdfSafe(row.orgDefinedId || "-").substring(0, 14),
        pdfSafe(fmtDate(row.lastAssignment)),
        pdfSafe(fmtDate(row.lastQuiz)),
        pdfSafe(fmtDate(row.lastDiscussion)),
        pdfSafe(row.lastLoginInPeriod ? fmtDate(row.lastLoginInPeriod) : loginLabel(row.loginNote)).substring(0, 22),
        pdfSafe(fmtDate(row.ldaa))
      ];
      var tx = margin + 6;
      for (var c = 0; c < cells.length; c++) {
        doc.setFont("helvetica", c === 6 && row.ldaa ? "bold" : "normal");
        doc.text(cells[c], tx, y + 9);
        tx += colW[c];
      }
      y += 16;
    }

    y += 16;
    need(36);
    doc.setFillColor(232, 245, 240);
    doc.rect(margin, y, pageW - margin * 2, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.text("Detailed results", margin + 8, y + 15);
    y += 30;

    for (var s = 0; s < report.rows.length; s++) {
      var st = report.rows[s];
      need(36);
      doc.setFillColor(15, 91, 70);
      doc.rect(margin, y, 4, 16, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 91, 70);
      doc.text(
        pdfSafe(st.displayName) + (st.orgDefinedId ? "  (" + pdfSafe(st.orgDefinedId) + ")" : ""),
        margin + 12,
        y + 12
      );
      y += 20;
      if (!st.hasActivity) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text("No assignments, quizzes, or discussion posts in this period.", margin + 12, y);
        y += 16;
        continue;
      }
      function writeGroup(title, items) {
        need(18);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 91, 70);
        doc.text(title, margin + 12, y);
        y += 12;
        if (!items.length) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text("None in this period.", margin + 18, y);
          y += 12;
          return;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(30, 41, 59);
        for (var i = 0; i < items.length; i++) {
          need(12);
          doc.text(pdfSafe(fmtDateTime(items[i].date)), margin + 18, y);
          doc.text(pdfSafe(items[i].name).substring(0, 90), margin + 130, y);
          y += 11;
        }
        y += 4;
      }
      writeGroup("Assignments", st.activities.assignments);
      writeGroup("Quizzes", st.activities.quizzes);
      writeGroup("Discussions", st.activities.discussions);
      y += 6;
    }

    drawFooter();
    doc.save(reportFilename(report, "pdf"));
  }

  async function runReport() {
    var course = selectedCourse();
    if (!course) {
      setStatus("error", "Please select a course.");
      return;
    }
    var start = parseYmdStart($("lprStart").value);
    var end = parseYmdEnd($("lprEnd").value);
    if (!start || !end) {
      setStatus("error", "Please choose a start and end date.");
      return;
    }
    if (end.getTime() < start.getTime()) {
      setStatus("error", "The end date must be on or after the start date.");
      return;
    }
    var scope = selectedScope();
    var students = course._students;
    if (!students) {
      setStatus("", "Loading classlist…");
      students = await loadClasslist(course.OrgUnit.Id);
      course._students = students;
      fillStudentSelect(students);
    }
    if (scope === "student") {
      var uid = $("lprStudent").value;
      if (!uid) {
        setStatus("error", "Select a student, or switch to Entire class.");
        return;
      }
      students = students.filter(function (s) {
        return s.userId === uid;
      });
    }
    if (!students.length) {
      setStatus("error", "No students to include.");
      return;
    }

    var btn = $("lprRunBtn");
    var label = $("lprRunLabel");
    btn.disabled = true;
    if (label) label.textContent = "Running…";
    $("lprPreviewSection").hidden = true;
    snapshotFilter = "all";

    try {
      var activity = await collectPeriodActivity(course.OrgUnit.Id, start.getTime(), end.getTime(), function (msg) {
        setStatus("", msg);
      });
      setStatus("", "Building snapshot…");
      var rows = [];
      for (var i = 0; i < students.length; i++) {
        rows.push(buildStudentRow(students[i], activity, start.getTime(), end.getTime()));
      }
      lastReport = {
        course: {
          id: String(course.OrgUnit.Id),
          name: course.OrgUnit.Name || "",
          code: course.OrgUnit.Code || ""
        },
        start: start,
        end: end,
        rangeLabel: start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) +
          " – " +
          end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        scope: scope,
        rows: rows,
        generatedAt: new Date()
      };
      $("lprPreviewTitle").textContent = "Period snapshot · " + lastReport.rangeLabel;
      $("lprPreview").innerHTML = renderPreview(lastReport);
      $("lprPreviewSection").hidden = false;
      var withAct = rows.filter(function (r) {
        return r.hasActivity;
      }).length;
      setStatus(
        "success",
        "Report ready: " +
          rows.length +
          " student(s), " +
          withAct +
          " with academic activity in this period. Review the snapshot below, then export CSV, Excel, or PDF."
      );
    } catch (err) {
      console.error(err);
      setStatus(
        "error",
        "Report failed: " + (err.message || String(err)) + ". Ensure you are signed in to Brightspace and try again."
      );
    } finally {
      btn.disabled = false;
      if (label) label.textContent = "Run report";
    }
  }

  async function init() {
    applyPreset("7days");
    syncScopeUi();

    var form = $("lprForm");
    var courseSel = $("lprCourse");
    if (!form || !courseSel) return;
    if (!API || !window.FacultyDashboardCourses) {
      setStatus("error", "Dashboard libraries failed to load. Refresh the page and try again.");
      return;
    }

    var scopeInputs = form.querySelectorAll('input[name="lprScope"]');
    for (var i = 0; i < scopeInputs.length; i++) {
      scopeInputs[i].addEventListener("change", syncScopeUi);
    }

    var presets = form.querySelectorAll(".lpr-preset");
    for (var p = 0; p < presets.length; p++) {
      presets[p].addEventListener("click", function () {
        applyPreset(this.getAttribute("data-preset"));
      });
    }

    courseSel.addEventListener("change", onCourseChange);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runReport();
    });

    $("lprPreview").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      snapshotFilter = btn.getAttribute("data-filter") || "all";
      refreshPreview();
    });

    $("lprCsvBtn").addEventListener("click", function () {
      if (!lastReport) return;
      try {
        exportCsv(lastReport);
      } catch (err) {
        setStatus("error", err.message || String(err));
      }
    });
    $("lprXlsxBtn").addEventListener("click", function () {
      if (!lastReport) return;
      try {
        exportXlsx(lastReport);
      } catch (err) {
        setStatus("error", err.message || String(err));
      }
    });
    $("lprPdfBtn").addEventListener("click", function () {
      if (!lastReport) return;
      exportPdf(lastReport).catch(function (err) {
        console.error(err);
        setStatus("error", err.message || String(err));
      });
    });

    try {
      var courses = await window.FacultyDashboardCourses.populateCourseSelect(courseSel, {
        placeholderLabel: "Select a course…"
      });
      for (var c = 0; c < courses.length; c++) {
        var ou = courses[c].OrgUnit;
        if (ou && ou.Id != null) coursesById[String(ou.Id)] = courses[c];
      }
    } catch (e) {
      console.error(e);
      setStatus("error", "Could not load courses. Sign in to Brightspace and refresh.");
    }

    try {
      var me = await API.whoami();
      if (me) instructorName = ((me.FirstName || "") + " " + (me.LastName || "")).trim();
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
