/**
 * D2L Faculty Dashboard - Analytics / Action Center
 * Dual purpose: Action Center (what to do next) + Insight Center (what's happening)
 */

(function () {
  'use strict';

  // =========================
  // API VERSION CONSTANTS
  // =========================
  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";
  var API_VERSION_GRADES_BULK = "1.86";

  // =========================
  // THRESHOLD CONSTANTS
  // =========================
  var DEFAULT_FAILING_THRESHOLD = 70; // Default failing threshold (%)
  var INACTIVE_3D_DAYS = 3;
  var INACTIVE_7D_DAYS = 7;
  var DROP_OFF_LOOKBACK_DAYS = 14;
  var DROP_OFF_RECENT_DAYS = 3;

  // =========================
  // SEMESTER FILTERING
  // =========================
  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function defaultSemesterCode() {
    return semesterApi() ? semesterApi().getActiveCode() : "26/FA";
  }

  // Get role ID from enrollment item
  function getRoleId(item) {
    if (item && item.Access) {
      if (typeof item.Access.ClasslistRoleId !== "undefined" && item.Access.ClasslistRoleId !== null) {
        var n = parseInt(item.Access.ClasslistRoleId, 10);
        if (!isNaN(n)) return n;
      }
      if (item.Access.ClasslistRoleName) {
        var roleName = (item.Access.ClasslistRoleName || "").toLowerCase();
        if (roleName.indexOf("instructor") >= 0 && roleName.indexOf("evaluator") === -1) {
          return 102;
        }
      }
    }
    return null;
  }

  // =========================
  // CHECK IF COURSE IS MERGED OR CANCELLED (should be excluded from analytics)
  // =========================
  function isMergedOrCancelledCourse(course) {
    if (!course || !course.OrgUnit) return false;
    var code = (course.OrgUnit.Code || "").toUpperCase();
    var name = (course.OrgUnit.Name || "").toUpperCase();
    // Check if course code or name contains MERGED or CXLD
    return code.indexOf("MERGED") >= 0 || code.indexOf("CXLD") >= 0 ||
           name.indexOf("MERGED") >= 0 || name.indexOf("CXLD") >= 0;
  }

  // Exclude demo/test student from all metrics and display
  function isDemoStudent(student) {
    if (!student) return false;
    var first = (student.firstName || "").trim();
    var last = (student.lastName || "").trim();
    var full = (first + " " + last).trim();
    return (first === "ZZDemo" && last === "ZZStudent") || full === "ZZDemo ZZStudent";
  }

  // =========================
  // GLOBAL STATE
  // =========================
  var coursesList = [];
  var studentsData = []; // Array of student records with risk flags
  var courseReadinessData = [];
  var gradingData = [];
  var currentCourseFilter = "all";
  var currentThreshold = DEFAULT_FAILING_THRESHOLD;
  var analyticsCache = {}; // Cache per course for instant filter switching
  var diagnosticsLog = [];
  var isDeepScanEnabled = false;
  var courseStartDatesMap = new Map(); // Map<courseId (string), startDate (string|null)>
  var courseEndDatesMap = new Map(); // Map<courseId (string), endDate (string|null)>
  var hideNotStartedCourses = true; // Default: hide courses that haven't started
  var hideEndedCourses = true; // Default: hide courses that have ended
  var showOnlyBelow72 = false; // Filter flag for showing only students below 72% passing
  var challengingQuizzesData = []; // Array of {quizName, averageScore, quizId, courseId, courseName, totalAttempts, category}
  var currentChallengingThreshold = 70; // Current threshold filter (70, 50, 30, or 0 for average score); default 70
  var submissionBottlenecksData = []; // Array of {assignmentName, folderId, dueDate, totalStudents, submittedCount, missingCount, courseId, courseName}
  var upcomingDeadlinesData = []; // Array of {type: 'Assignment'|'Quiz', name, dueDate, courseId, courseName, folderId?, quizId?}
  var riskTableRowsToShow = 10; // Show top 10, then "View more" / "View All"
  var hasLoadedAnalyticsOnce = false; // Used to switch button label to "Refresh Data"
  var isUnopenedFeedbackLoading = false; // Used by Engagement section for "details loading" message
  var nonParticipationData = null; // { orgUnitId, weeks: [{ weekStart, weekEnd, label, students: [{ orgDefinedId, lastName, firstName, email, userId }] }] }
  var nonParticipationStructureCache = null; // { orgUnitId, folders, quizList, forums, topicsByForum, cachedAt }; TTL 5 min
  var externalGradesData = null; // { orgUnitId, weeks: [{ weekStart, weekEnd, label, letterCounts: {}, noGradeOrZero: [student] }] } or null if no external grade items

  // Sync filter checkboxes from DOM so display always reflects current checkbox state
  function syncFilterCheckboxes() {
    var hideEl = document.getElementById("hide-not-started-courses");
    var hideEndedEl = document.getElementById("hide-ended-courses");
    var below72El = document.getElementById("show-only-below-72");
    if (hideEl) hideNotStartedCourses = hideEl.checked;
    if (hideEndedEl) hideEndedCourses = hideEndedEl.checked;
    if (below72El) showOnlyBelow72 = below72El.checked;
  }

  // True when course should be hidden by the start/end date checkboxes
  function isCourseExcludedByDateFilters(courseId) {
    var id = String(courseId);
    if (hideNotStartedCourses && hasCourseNotStarted(id)) return true;
    if (hideEndedCourses && hasCourseEnded(id)) return true;
    return false;
  }

  // Single source of truth: students to show, respecting course filter and date checkboxes
  function getFilteredStudents() {
    syncFilterCheckboxes();
    var filtered = studentsData.slice();
    if (currentCourseFilter !== "all") {
      filtered = filtered.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    filtered = filtered.filter(function(s) {
      return !isCourseExcludedByDateFilters(s.courseId);
    });
    return filtered;
  }

  // Get Monday 00:00:00 and Sunday 23:59:59.999 in local time for a given date
  function getMondayOfWeek(d) {
    var date = new Date(d);
    var day = date.getDay();
    var diff = date.getDate() - day + (day === 0 ? -6 : 1);
    var monday = new Date(date);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
  function getSundayEndOfWeek(d) {
    var monday = getMondayOfWeek(d);
    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
  }

  // Last 3 weeks: current week (Mon–today), previous week (Mon–Sun), two weeks ago (Mon–Sun)
  function getThreeWeekRanges() {
    var now = new Date();
    var ranges = [];
    var currentMonday = getMondayOfWeek(now);
    for (var w = 0; w < 3; w++) {
      var weekStart = new Date(currentMonday);
      weekStart.setDate(currentMonday.getDate() - w * 7);
      weekStart.setHours(0, 0, 0, 0);
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      if (w === 0 && weekEnd > now) weekEnd = new Date(now);
      ranges.push({ weekStart: weekStart, weekEnd: weekEnd });
    }
    return ranges;
  }

  function runWithConcurrencyLimit(tasks, limit) {
    limit = limit || 5;
    var index = 0;
    function runNext() {
      if (index >= tasks.length) return Promise.resolve();
      var i = index++;
      return Promise.resolve(tasks[i]()).then(runNext);
    }
    var runners = [];
    for (var r = 0; r < Math.min(limit, tasks.length); r++) {
      runners.push(runNext());
    }
    return Promise.all(runners);
  }

  function setNonParticipationProgress(text) {
    var el = document.getElementById("non-participation-progress");
    if (el) {
      el.style.display = text ? "block" : "none";
      el.textContent = text || "";
    }
  }

  // Parse activity date for week comparison. Date-only "YYYY-MM-DD" is treated as local noon
  // so the calendar day matches local week boundaries (API date-only is often UTC midnight,
  // which in US timezones shifts to the previous evening and wrong week).
  function parseActivityDate(dateStr) {
    if (!dateStr) return null;
    var s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      var d = new Date(s + "T12:00:00");
      return isNaN(d.getTime()) ? new Date(dateStr) : d;
    }
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  function dateInWeekRange(dateStr, weekStart, weekEnd) {
    if (!dateStr) return false;
    try {
      var d = parseActivityDate(dateStr);
      if (!d) return false;
      return d >= weekStart && d <= weekEnd;
    } catch (e) { return false; }
  }

  // Mark a student as having participated in a given week (by activity date). Only marks if uid is in participation.
  function markParticipationForWeek(participation, uid, dateStr, weekRanges) {
    if (!uid || !participation[uid] || !dateStr) return;
    for (var w = 0; w < 3; w++) {
      if (dateInWeekRange(dateStr, weekRanges[w].weekStart, weekRanges[w].weekEnd)) {
        participation[uid][w] = true;
        break;
      }
    }
  }

  async function loadNonParticipationData(orgUnitId) {
    orgUnitId = String(orgUnitId);
    nonParticipationData = null;
    var progress = setNonParticipationProgress;
    progress("Loading classlist…");
    var classlist = await getClasslist(orgUnitId).catch(function() { return []; });
    var roleStudentIds = [3, 5, 101];
    var students = [];
    for (var i = 0; i < classlist.length; i++) {
      var u = classlist[i];
      var roleName = (u.ClasslistRoleDisplayName || "").toLowerCase();
      var isStudent = roleName.indexOf("student") >= 0 || (u.RoleId !== undefined && roleStudentIds.indexOf(Number(u.RoleId)) >= 0);
      if (!isStudent) continue;
      var userId = String(u.Identifier || "");
      if (!userId) continue;
      if (isDemoStudent({ firstName: u.FirstName || "", lastName: u.LastName || "" })) continue;
      students.push({
        userId: userId,
        orgDefinedId: (u.OrgDefinedId || "").toString(),
        firstName: (u.FirstName || "").toString(),
        lastName: (u.LastName || "").toString(),
        email: (u.Email || u.ExternalEmail || "").toString()
      });
    }
    var weekRanges = getThreeWeekRanges();
    var participation = {}; // userId -> [bool, bool, bool] for weeks 0,1,2
    students.forEach(function(s) {
      participation[s.userId] = [false, false, false];
    });

    // --- Course structure (folders, quizzes, forums/topics) — cache 5 min for same course ---
    var STRUCTURE_CACHE_MS = 5 * 60 * 1000;
    var useCache = nonParticipationStructureCache && nonParticipationStructureCache.orgUnitId === orgUnitId &&
      (Date.now() - (nonParticipationStructureCache.cachedAt || 0)) < STRUCTURE_CACHE_MS;
    var dropboxFolders = [];
    var quizList = [];
    var forums = [];
    var topicsByForum = {};
    if (useCache) {
      dropboxFolders = nonParticipationStructureCache.folders || [];
      quizList = nonParticipationStructureCache.quizList || [];
      forums = nonParticipationStructureCache.forums || [];
      topicsByForum = nonParticipationStructureCache.topicsByForum || {};
    }
    if (!useCache) {
      progress("Loading course structure…");
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      try {
        var foldersData = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
        if (Array.isArray(foldersData)) dropboxFolders = foldersData;
        else if (foldersData && foldersData.Objects && Array.isArray(foldersData.Objects)) dropboxFolders = foldersData.Objects;
      } catch (e) { /* skip */ }
      var quizUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
      try {
        var qData = await BrightspaceFetch(quizUrl).catch(function() { return null; });
        if (qData && qData.Objects && qData.Objects.length) quizList = qData.Objects;
        else if (Array.isArray(qData)) quizList = qData;
      } catch (e) { /* skip */ }
      var forumsUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
      try {
        var forumsData = await BrightspaceFetch(forumsUrl).catch(function() { return null; });
        if (forumsData && (forumsData.length !== undefined || (forumsData.Objects && forumsData.Objects.length)))
          forums = (forumsData.Objects || forumsData) || [];
      } catch (e) { /* skip */ }
      for (var fi = 0; fi < forums.length; fi++) {
        var f = forums[fi];
        var fid = f.ForumId != null ? f.ForumId : f.Id;
        if (fid == null) continue;
        try {
          var topicsUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + fid + "/topics/";
          var topicsData = await BrightspaceFetch(topicsUrl).catch(function() { return null; });
          var topics = (topicsData && topicsData.Objects) ? topicsData.Objects : (topicsData && topicsData.length !== undefined) ? topicsData : [];
          topicsByForum[fid] = topics;
        } catch (e) { /* skip */ }
      }
      nonParticipationStructureCache = { orgUnitId: orgUnitId, folders: dropboxFolders, quizList: quizList, forums: forums, topicsByForum: topicsByForum, cachedAt: Date.now() };
    }

    function hasMissingWeek(arr) {
      return !arr || !arr[0] || !arr[1] || !arr[2];
    }

    // --- 1) Quizzes: grouped — one call per quiz (paged), mark participation by UserId + Started/Completed (D2L QuizAttemptData) ---
    progress("Quizzes: loading attempts per quiz…");
    for (var q = 0; q < quizList.length; q++) {
      var quiz = quizList[q];
      var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
      if (qid == null) continue;
      progress("Quizzes: " + (q + 1) + "/" + quizList.length + "…");
      var attemptBookmark = null;
      var attemptPageCount = 0;
      do {
        attemptPageCount++;
        var attemptUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + qid + "/attempts/" +
          (attemptBookmark ? "?bookmark=" + encodeURIComponent(attemptBookmark) : "");
        var attemptsData = await BrightspaceFetch(attemptUrl).catch(function() { return null; });
        var attempts = [];
        if (attemptsData && Array.isArray(attemptsData.Objects)) attempts = attemptsData.Objects;
        else if (attemptsData && Array.isArray(attemptsData.Items)) attempts = attemptsData.Items;
        else if (Array.isArray(attemptsData)) attempts = attemptsData;
        for (var a = 0; a < attempts.length; a++) {
          var att = attempts[a];
          var uid = att.UserId != null ? String(att.UserId) : (att.User && att.User.Id != null) ? String(att.User.Id) : null;
          if (!uid || !participation[uid]) continue;
          // D2L QuizAttemptData: Started and Completed (not EndDate/CompletionDate)
          var attDate = att.Completed || att.Started || att.EndDate || att.CompletionDate || att.SubmissionDate || att.DateSubmitted || att.StartDate || att.CreatedDate;
          if (attDate) markParticipationForWeek(participation, uid, attDate, weekRanges);
        }
        attemptBookmark = (attemptsData && attemptsData.Next) ? attemptsData.Next : null;
      } while (attemptBookmark && attemptPageCount < 50);
    }

    // --- 2) Dropbox: grouped — one call per folder (paged), mark participation by Entity userId + submission dates ---
    progress("Dropbox: loading submissions per folder…");
    for (var f = 0; f < dropboxFolders.length; f++) {
      var folder = dropboxFolders[f];
      var folderId = folder.Id != null ? folder.Id : folder.Identifier;
      if (folderId == null) continue;
      progress("Dropbox: " + (f + 1) + "/" + dropboxFolders.length + "…");
      var subBaseUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folderId + "/submissions/";
      var subBookmark = null;
      var subPageCount = 0;
      do {
        subPageCount++;
        var subUrl = subBaseUrl + "paged/?activeOnly=true" + (subBookmark ? "&bookmark=" + encodeURIComponent(subBookmark) : "");
        var subs = await BrightspaceFetch(subUrl).catch(function() { return null; });
        var subList = [];
        if (subs && Array.isArray(subs.Objects)) subList = subs.Objects;
        else if (subs && Array.isArray(subs.Items)) subList = subs.Items;
        else if (Array.isArray(subs)) subList = subs;
        for (var si = 0; si < subList.length; si++) {
          var entityDropbox = subList[si];
          var entity = entityDropbox.Entity || entityDropbox.entity;
          var uid = null;
          if (entity) {
            var eid = entity.EntityId != null ? entity.EntityId : entity.Identifier != null ? entity.Identifier : entity.Id;
            if (eid != null) uid = String(eid);
          }
          if (!uid || !participation[uid]) continue;
          var submissions = entityDropbox.Submissions || entityDropbox.submissions || [];
          for (var sj = 0; sj < submissions.length; sj++) {
            var sub = submissions[sj];
            var subDate = sub.SubmissionDate || sub.DateSubmitted || sub.CreationDate || (sub.Feedback && sub.Feedback && sub.Feedback.DateCreated);
            if (subDate) markParticipationForWeek(participation, uid, subDate, weekRanges);
          }
          var status = entityDropbox.Status;
          if (status === 1 || status === 2 || status === 3 || status === "1" || status === "2" || status === "3") {
            var compDate = entityDropbox.CompletionDate || entityDropbox.completionDate;
            if (compDate) markParticipationForWeek(participation, uid, compDate, weekRanges);
          }
        }
        subBookmark = (subs && subs.Next) ? subs.Next : null;
      } while (subBookmark && subPageCount < 50);
      if (subPageCount === 1 && subList.length === 0) {
        var subsNonPaged = await BrightspaceFetch(subBaseUrl + "?activeOnly=true").catch(function() { return null; });
        var listNonPaged = Array.isArray(subsNonPaged) ? subsNonPaged : (subsNonPaged && subsNonPaged.Objects) ? subsNonPaged.Objects : (subsNonPaged && subsNonPaged.Items) ? subsNonPaged.Items : [];
        for (var si2 = 0; si2 < listNonPaged.length; si2++) {
          var entityDropbox2 = listNonPaged[si2];
          var entity2 = entityDropbox2.Entity || entityDropbox2.entity;
          var uid2 = null;
          if (entity2) {
            var eid2 = entity2.EntityId != null ? entity2.EntityId : entity2.Identifier != null ? entity2.Identifier : entity2.Id;
            if (eid2 != null) uid2 = String(eid2);
          }
          if (!uid2 || !participation[uid2]) continue;
          var subs2 = entityDropbox2.Submissions || entityDropbox2.submissions || [];
          for (var sj2 = 0; sj2 < subs2.length; sj2++) {
            var subDate2 = (subs2[sj2].SubmissionDate || subs2[sj2].DateSubmitted || subs2[sj2].CreationDate);
            if (subDate2) markParticipationForWeek(participation, uid2, subDate2, weekRanges);
          }
          var compDate2 = entityDropbox2.CompletionDate || entityDropbox2.completionDate;
          if (compDate2) markParticipationForWeek(participation, uid2, compDate2, weekRanges);
        }
      }
    }

    // --- 3) Discussions: slow lane for remaining students (after Quizzes + Dropbox), with post paging ---
    progress("Discussions: scanning posts for remaining students…");
    for (var fo = 0; fo < forums.length; fo++) {
      var forum = forums[fo];
      var forumId = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (forumId == null) continue;
      var topics = topicsByForum[forumId] || [];
      for (var t = 0; t < topics.length; t++) {
        var topic = topics[t];
        var topicId = topic.TopicId != null ? topic.TopicId : topic.Id;
        if (topicId == null) continue;
        try {
          var postsUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/";
          var pageNumber = 1;
          var pageSize = 1000;
          while (true) {
            var postsFetchUrl = postsUrl + "?pageSize=" + pageSize + "&pageNumber=" + pageNumber;
            var postsData = await BrightspaceFetch(postsFetchUrl).catch(function() { return null; });
            var posts = (postsData && postsData.Objects) ? postsData.Objects : (postsData && postsData.length !== undefined) ? postsData : [];
            if (!Array.isArray(posts) || posts.length === 0) break;
            for (var p = 0; p < posts.length; p++) {
              var post = posts[p];
              var uid = post.PostingUserId != null ? String(post.PostingUserId) : (post.UserId != null ? String(post.UserId) : null);
              if (!uid || !participation[uid] || !hasMissingWeek(participation[uid])) continue;
              // D2L posts use DatePosted as the canonical timestamp
              var postDate = post.DatePosted || post.DateCreated || post.CreationDate || post.CreatedDate;
              if (postDate) markParticipationForWeek(participation, uid, postDate, weekRanges);
            }
            pageNumber++;
          }
        } catch (e) { /* skip topic */ }
      }
    }

    var weeks = [];
    // Display: 2 weeks ago, Last week, This week (Week 1 = earliest, Week 3 = latest)
    var weekLabels = ["2 weeks ago", "Last week", "This week"];
    for (var displayIndex = 0; displayIndex < 3; displayIndex++) {
      var rangeIndex = 2 - displayIndex; // 0->2 (earliest), 1->1 (middle), 2->0 (latest)
      var noSubs = students.filter(function(s) { return !participation[s.userId][rangeIndex]; });
      weeks.push({
        weekStart: weekRanges[rangeIndex].weekStart,
        weekEnd: weekRanges[rangeIndex].weekEnd,
        label: weekLabels[displayIndex],
        students: noSubs
      });
    }
    nonParticipationData = { orgUnitId: orgUnitId, weeks: weeks };
    progress("");
  }

  function renderNonParticipationSection() {
    syncFilterCheckboxes();
    var container = document.getElementById("non-participation-container");
    var placeholder = document.getElementById("non-participation-placeholder");
    if (!container) return;
    // If "Don't show courses that haven't started" is checked and this course hasn't started, show placeholder
    var hideThisCourse = nonParticipationData && nonParticipationData.orgUnitId && isCourseExcludedByDateFilters(nonParticipationData.orgUnitId);
    if (placeholder) placeholder.style.display = (nonParticipationData && !hideThisCourse) ? "none" : "block";
    container.style.display = (nonParticipationData && !hideThisCourse) ? "grid" : "none";
    if (!nonParticipationData || !nonParticipationData.weeks || hideThisCourse) return;
    var weeks = nonParticipationData.weeks;
    for (var w = 0; w < 3; w++) {
      var col = document.getElementById("non-participation-week-" + w);
      if (!col) continue;
      var labelEl = col.querySelector(".non-participation-week-label");
      var rangeEl = col.querySelector(".non-participation-week-range");
      var badgeEl = col.querySelector(".non-participation-count-badge");
      var listEl = col.querySelector(".non-participation-list");
      if (!rangeEl || !badgeEl || !listEl) continue;
      var data = weeks[w];
      if (!data) continue;
      if (labelEl && data.label) labelEl.textContent = data.label;
      rangeEl.textContent = formatDate(data.weekStart) + " – " + formatDate(data.weekEnd);
      var n = (data.students && data.students.length) || 0;
      badgeEl.textContent = n + " student" + (n !== 1 ? "s" : "") + " with 0 submissions";
      listEl.innerHTML = "";
      if (data.students && data.students.length > 0) {
        for (var i = 0; i < data.students.length; i++) {
          var s = data.students[i];
          var row = document.createElement("div");
          row.style.cssText = "padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px;";
          row.innerHTML = "<div style='font-weight: 600; color: #334155;'>" + escapeHtml(s.orgDefinedId || "—") + "</div>" +
            "<div>" + escapeHtml(s.lastName) + ", " + escapeHtml(s.firstName) + "</div>" +
            "<div style='font-size: 11px; color: #64748b;'>" + escapeHtml(s.email || "—") + "</div>";
          listEl.appendChild(row);
        }
      } else {
        listEl.innerHTML = "<div style='padding: 8px; color: #64748b; font-size: 12px;'>All students had at least one submission this week.</div>";
      }
    }
  }

  // Load grades-entered-by-week for external/content tool grade items (book publisher). Only set data if course has such items.
  async function loadExternalGradesData(orgUnitId) {
    orgUnitId = String(orgUnitId);
    externalGradesData = null;
    var items = await getGradeItemsForCourse(orgUnitId).catch(function() { return []; });
    var raw = normalizeGradeItemsResponse(items);
    var externalItems = raw.filter(function(item) {
      var tool = item.AssociatedTool || item.associatedTool;
      return tool && (tool.ToolId != null || tool.ToolItemId != null);
    });
    if (externalItems.length === 0) return;
    var weekRanges = getThreeWeekRanges();
    var letterCountsByWeek = [{}, {}, {}];
    var studentHadNonZeroByWeek = [{}, {}, {}];
    var classlist = await getClasslist(orgUnitId).catch(function() { return []; });
    var roleStudentIds = [3, 5, 101];
    var students = [];
    for (var i = 0; i < classlist.length; i++) {
      var u = classlist[i];
      var roleName = (u.ClasslistRoleDisplayName || "").toLowerCase();
      var isStudent = roleName.indexOf("student") >= 0 || (u.RoleId !== undefined && roleStudentIds.indexOf(Number(u.RoleId)) >= 0);
      if (!isStudent) continue;
      var userId = String(u.Identifier || "");
      if (!userId) continue;
      if (isDemoStudent({ firstName: u.FirstName || "", lastName: u.LastName || "" })) continue;
      students.push({
        userId: userId,
        orgDefinedId: (u.OrgDefinedId || "").toString(),
        firstName: (u.FirstName || "").toString(),
        lastName: (u.LastName || "").toString(),
        email: (u.Email || u.ExternalEmail || "").toString()
      });
    }
    var studentsByUid = {};
    for (var si = 0; si < students.length; si++) studentsByUid[students[si].userId] = students[si];

    for (var g = 0; g < externalItems.length; g++) {
      var gid = externalItems[g].Id != null ? externalItems[g].Id : externalItems[g].id;
      if (gid == null) continue;
      var bookmark = null;
      var pageCount = 0;
      do {
        pageCount++;
        var url = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/" + gid + "/values/?pageSize=200" + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
        var data = await BrightspaceFetch(url).catch(function() { return null; });
        var list = (data && data.Objects) ? data.Objects : (data && data.Items) ? data.Items : Array.isArray(data) ? data : [];
        for (var vi = 0; vi < list.length; vi++) {
          var uv = list[vi];
          var uid = (uv.User && (uv.User.Id != null || uv.User.Identifier != null)) ? String(uv.User.Id != null ? uv.User.Id : uv.User.Identifier) : (uv.UserId != null ? String(uv.UserId) : null);
          if (!uid) continue;
          var gv = uv.GradeValue || uv.Grade;
          if (!gv) continue;
          var lastMod = gv.LastModified || gv.DateEvaluated || gv.DateReleased;
          if (!lastMod) continue;
          var points = gv.PointsNumerator != null ? gv.PointsNumerator : null;
          var letter = (gv.DisplayedGrade != null && gv.DisplayedGrade !== "") ? String(gv.DisplayedGrade).trim() : (points === 0 ? "0" : "");
          if (letter === "" && points !== 0) letter = (points != null) ? String(points) : "—";
          if (letter === "") letter = "—";
          for (var w = 0; w < 3; w++) {
            if (!dateInWeekRange(lastMod, weekRanges[w].weekStart, weekRanges[w].weekEnd)) continue;
            letterCountsByWeek[w][letter] = (letterCountsByWeek[w][letter] || 0) + 1;
            if (points != null && points > 0) studentHadNonZeroByWeek[w][uid] = true;
          }
        }
        bookmark = (data && data.Next) ? data.Next : null;
      } while (bookmark && pageCount < 50);
    }

    var weekLabels = ["2 weeks ago", "Last week", "This week"];
    var weeks = [];
    for (var displayIndex = 0; displayIndex < 3; displayIndex++) {
      var rangeIndex = 2 - displayIndex;
      var noGradeOrZero = students.filter(function(s) { return !studentHadNonZeroByWeek[rangeIndex][s.userId]; });
      weeks.push({
        weekStart: weekRanges[rangeIndex].weekStart,
        weekEnd: weekRanges[rangeIndex].weekEnd,
        label: weekLabels[displayIndex],
        letterCounts: letterCountsByWeek[rangeIndex],
        noGradeOrZero: noGradeOrZero
      });
    }
    externalGradesData = { orgUnitId: orgUnitId, weeks: weeks };
  }

  function renderExternalGradesSection() {
    var section = document.getElementById("external-grades-section");
    if (!section) return;
    if (!externalGradesData || !externalGradesData.weeks) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    var weeks = externalGradesData.weeks;
    for (var w = 0; w < 3; w++) {
      var col = document.getElementById("external-grades-week-" + w);
      if (!col) continue;
      var rangeEl = col.querySelector(".external-grades-week-range");
      var letterEl = col.querySelector(".external-grades-letter-counts");
      var listEl = col.querySelector(".external-grades-no-grade-list");
      var btn = col.querySelector(".external-grades-explore-btn");
      var data = weeks[w];
      if (!data) continue;
      if (rangeEl) rangeEl.textContent = formatDate(data.weekStart) + " – " + formatDate(data.weekEnd);
      var lc = data.letterCounts || {};
      var parts = [];
      var keys = Object.keys(lc).sort();
      for (var ki = 0; ki < keys.length; ki++) parts.push(keys[ki] + ": " + lc[keys[ki]]);
      if (letterEl) letterEl.textContent = parts.length ? parts.join(", ") : "No grades entered this week.";
      var noList = data.noGradeOrZero || [];
      if (btn) {
        btn.textContent = "Explore: students with NO grade or 0 (" + noList.length + ")";
        btn.onclick = (function(weekIndex) {
          return function() {
            var colEl = document.getElementById("external-grades-week-" + weekIndex);
            var listElInner = colEl ? colEl.querySelector(".external-grades-no-grade-list") : null;
            if (!listElInner) return;
            var isShown = listElInner.style.display === "block";
            listElInner.style.display = isShown ? "none" : "block";
            if (!isShown && listElInner.innerHTML === "") {
              var weekData = externalGradesData && externalGradesData.weeks && externalGradesData.weeks[weekIndex] ? externalGradesData.weeks[weekIndex].noGradeOrZero : [];
              listElInner.innerHTML = "";
              if (weekData.length === 0) {
                listElInner.innerHTML = "<div style='padding: 8px; color: #64748b; font-size: 12px;'>All students have at least one non-zero grade entered this week.</div>";
              } else {
                for (var i = 0; i < weekData.length; i++) {
                  var s = weekData[i];
                  var row = document.createElement("div");
                  row.style.cssText = "padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px;";
                  row.innerHTML = "<div style='font-weight: 600; color: #334155;'>" + escapeHtml(s.orgDefinedId || "—") + "</div>" +
                    "<div>" + escapeHtml(s.lastName) + ", " + escapeHtml(s.firstName) + "</div>" +
                    "<div style='font-size: 11px; color: #64748b;'>" + escapeHtml(s.email || "—") + "</div>";
                  listElInner.appendChild(row);
                }
              }
            }
          };
        })(w);
      }
      if (listEl) listEl.style.display = "none";
      if (listEl) listEl.innerHTML = "";
    }
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prependScrollHint(container, total) {
    if (!container || total <= 0) return;
    var hint = document.createElement("div");
    hint.className = "scroll-hint";
    hint.textContent = "Scroll to see all (" + total + ")";
    container.insertBefore(hint, container.firstChild);
  }

  function showSectionLoading(containerId, label) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "<div style='padding: 16px; text-align: center;'>" +
      "<div style='height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; margin-bottom: 8px;'>" +
      "<div class='section-loading-bar' style='height: 100%; width: 30%;'></div></div>" +
      "<div style='font-size: 12px; color: #666;'>" + (label || "Loading...") + "</div></div>";
  }

  // =========================
  // AUTH FETCH
  // =========================
  async function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("X-CSRF.Token") || localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    logDiagnostic("API", "GET " + url);

    try {
      var res = await fetch(url, opts);
      if (!res.ok) {
        var error = new Error("HTTP " + res.status + " - " + url);
        error.status = res.status;
        error.url = url;
        error.isExpected = (res.status === 403 || res.status === 404);
        if (error.isExpected) {
          logDiagnostic("API_ERROR", "Expected error (permission): " + res.status + " - " + url);
        } else {
          logDiagnostic("API_ERROR", "Unexpected error: " + res.status + " - " + url);
        }
        throw error;
      }
      var data = await res.json();
      logDiagnostic("API_SUCCESS", "GET " + url + " - OK");
      return data;
    } catch (e) {
      if (!e.isExpected) {
        logDiagnostic("API_EXCEPTION", "Exception: " + e.message + " - " + url);
      }
      throw e;
    }
  }

  // =========================
  // DIAGNOSTICS LOGGING (Console only)
  // =========================
  function logDiagnostic(category, message) {
    var timestamp = new Date().toISOString();
    var entry = "[" + timestamp + "] [" + category + "] " + message;
    diagnosticsLog.push(entry);
    console.log(entry);
    // Removed UI logging - diagnostics section removed per requirements
  }

  // =========================
  // GET USER INFO
  // =========================
  async function getUserInfo() {
    try {
      var data = await BrightspaceFetch("/d2l/api/lp/" + API_VERSION_LP + "/users/whoami");
      return {
        userId: data.UserId || data.UniqueName,
        firstName: data.FirstName || "",
        lastName: data.LastName || "",
        userName: data.UniqueName || "",
        email: data.ExternalEmail || ""
      };
    } catch (e) {
      logDiagnostic("ERROR", "Failed to fetch user info: " + e.message);
      return { userId: null, firstName: "Instructor", lastName: "", userName: "", email: "" };
    }
  }

  // =========================
  // GET ENROLLMENTS (Course Offerings Only — active semester from js/semester-config.js)
  // =========================
  async function getEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;
    var pageCount = 0;
    var maxPages = 50;

    logDiagnostic("ENROLLMENTS", "Fetching enrollments (" + defaultSemesterCode() + " semester only)...");

    while (hasMore && pageCount < maxPages) {
      pageCount++;
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";

      try {
        var data = await BrightspaceFetch(endpoint);

        if (data && data.Items && data.Items.length) {
          for (var i = 0; i < data.Items.length; i++) {
            var item = data.Items[i];
            // Filter: only Course Offerings (Type.Id = 3 / Code "Course Offering")
            if (item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3) {
              var code = item.OrgUnit.Code || "";
              var sem = getSemesterCodeFromCourseCode(code);
              var roleId = getRoleId(item);
              
              // Only include active-semester courses where user is Instructor (roleId === 102)
              // Exclude MERGED and CXLD courses from analytics
              if (sem === defaultSemesterCode() && roleId === 102 && !isMergedOrCancelledCourse(item)) {
                allItems.push(item);
                logDiagnostic("ENROLLMENTS", "Added course: " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - Semester: " + sem + " - RoleId: " + roleId);
              } else {
                if (sem !== defaultSemesterCode()) {
                  logDiagnostic("ENROLLMENTS", "Skipped course (wrong semester): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - Semester: " + (sem || "none"));
                } else if (roleId !== 102) {
                  logDiagnostic("ENROLLMENTS", "Skipped course (not Instructor role): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - RoleId: " + (roleId || "null"));
                } else if (isMergedOrCancelledCourse(item)) {
                  logDiagnostic("ENROLLMENTS", "Skipped course (MERGED or CXLD): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ")");
                }
              }
            }
          }
        }

        if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
          hasMore = true;
          bookmark = data.PagingInfo.Bookmark;
        } else {
          hasMore = false;
        }
      } catch (e) {
        logDiagnostic("ERROR", "Error fetching enrollments page " + pageCount + ": " + e.message);
        hasMore = false;
      }
    }

    logDiagnostic(
      "ENROLLMENTS",
      "Found " + allItems.length + " course offerings (" + defaultSemesterCode() + " semester, Instructor role only)"
    );
    return allItems;
  }

  // =========================
  // GET CLASSLIST FOR COURSE (Paged)
  // ObjectListPage.Next is an API URL, not a bare bookmark token.
  // =========================
  function classlistNextUrl(orgUnitId, page, itemCount) {
    var next = page && page.Next ? String(page.Next) : "";
    if (!next || !itemCount) return null;
    if (next.indexOf("/d2l/api/") >= 0) {
      var parts = next.split("/d2l/api/");
      return parts.length > 1 ? "/d2l/api/" + parts[1] : null;
    }
    if (next.indexOf("/") === 0) return next;
    return "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
  }

  async function getClasslist(orgUnitId) {
    var allStudents = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    var maxPages = 40;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      if (seenUrls[nextUrl]) break;
      seenUrls[nextUrl] = true;

      try {
        var data = await BrightspaceFetch(nextUrl);
        var objects = (data && data.Objects) || [];
        for (var i = 0; i < objects.length; i++) {
          allStudents.push(objects[i]);
        }
        nextUrl = classlistNextUrl(orgUnitId, data, objects.length);
      } catch (e) {
        if (e.status !== 403 && e.status !== 404) {
          logDiagnostic("ERROR", "Error fetching classlist for course " + orgUnitId + ": " + e.message);
        }
        break;
      }
    }

    return allStudents;
  }

  // =========================
  // GET GRADES FOR COURSE (Final Grades API)
  // =========================
  async function getGradesForCourse(orgUnitId) {
    var gradesMap = new Map(); // Map<userId (string), gradePercentage>
    
    try {
      var nextUrl = "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/?pageSize=200";
      var allGrades = [];
      
      while (nextUrl) {
        try {
          var data = await BrightspaceFetch(nextUrl);
          
          var gradeItems = (data && data.Items) ? data.Items : (data && data.Objects) ? data.Objects : [];
          
          if (gradeItems.length > 0) {
            allGrades = allGrades.concat(gradeItems);
          }
          
          if (data && data.Next && data.Next !== null && data.Next !== "") {
            var nextPath = data.Next;
            if (nextPath.indexOf('/d2l/api/') >= 0) {
              var urlParts = nextPath.split('/d2l/api/');
              if (urlParts.length > 1) {
                nextUrl = "/d2l/api/" + urlParts[1];
              } else {
                nextUrl = null;
              }
            } else if (nextPath.indexOf('/') === 0) {
              nextUrl = nextPath;
            } else {
              nextUrl = "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/" + nextPath;
            }
          } else {
            nextUrl = null;
          }
        } catch (pageError) {
          if (pageError.status !== 403 && pageError.status !== 404) {
            logDiagnostic("ERROR", "Error fetching paginated grades: " + pageError.message);
          }
          nextUrl = null;
        }
      }
      
      for (var i = 0; i < allGrades.length; i++) {
        var item = allGrades[i];
        var gradeValue = item.GradeValue || item;
        var user = item.User || {};
        
        if (!gradeValue || gradeValue.GradeObjectType !== 7) {
          continue;
        }
        
        var userId = String(user.Identifier || item.UserId || "");
        
        if (!userId) {
          continue;
        }
        
        var gradePercentage = null;
        var pointsNum = gradeValue.PointsNumerator;
        var pointsDen = gradeValue.PointsDenominator;
        
        if (pointsNum !== null && pointsNum !== undefined && 
            pointsDen !== null && pointsDen !== undefined &&
            pointsDen > 0) {
          gradePercentage = (pointsNum / pointsDen) * 100;
        }
        
        if (gradePercentage !== null && userId) {
          gradesMap.set(userId, gradePercentage);
        }
      }
      
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        logDiagnostic("ERROR", "Error fetching grades for course " + orgUnitId + ": " + e.message);
      }
    }
    
    return gradesMap;
  }

  // =========================
  // GET GRADE ITEMS FOR COURSE (For computed grade calculation)
  // =========================
  async function getGradeItemsForCourse(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/";
      var data = await BrightspaceFetch(endpoint);
      return data || [];
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        logDiagnostic("ERROR", "Error fetching grade items: " + e.message);
      }
      return [];
    }
  }

  // =========================
  // GET GRADE VALUES FOR STUDENT (For computed grade calculation)
  // =========================
  async function getGradeValuesForStudent(orgUnitId, userId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/values/" + userId;
      var data = await BrightspaceFetch(endpoint);
      return data || [];
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        logDiagnostic("ERROR", "Error fetching grade values for student: " + e.message);
      }
      return [];
    }
  }

  // =========================
  // GET UNOPENED FEEDBACK ITEMS FOR STUDENT (with pre-fetched grade items for batching)
  // =========================
  function normalizeGradeItemsResponse(gradeItems) {
    if (!gradeItems) return [];
    if (Array.isArray(gradeItems)) return gradeItems;
    return gradeItems.Objects || gradeItems.Items || gradeItems.Results || gradeItems.objects || gradeItems.items || [];
  }

  function normalizeGradeValuesResponse(gradeValues) {
    if (!gradeValues) return [];
    if (Array.isArray(gradeValues)) return gradeValues;
    return gradeValues.Objects || gradeValues.Items || gradeValues.Results || gradeValues.objects || gradeValues.items || [];
  }

  async function getUnopenedFeedbackItemsWithGradeItems(orgUnitId, gradeItems, userId, lastAccessDate) {
    var unopenedItems = [];
    try {
      var gradeValues = await getGradeValuesForStudent(orgUnitId, userId);
      if (!gradeValues) return unopenedItems;
      var items = normalizeGradeItemsResponse(gradeItems);
      var values = normalizeGradeValuesResponse(gradeValues);
      unopenedItems = computeUnopenedFromGradeData(items, values, lastAccessDate);
      // Add dropbox-based unopened
      var dropboxItems = await getUnopenedFeedbackFromDropbox(orgUnitId, userId, lastAccessDate);
      for (var d = 0; d < dropboxItems.length; d++) {
        unopenedItems.push(dropboxItems[d]);
      }
    } catch (e) {
      logDiagnostic("ERROR", "Error fetching unopened feedback: " + e.message);
    }
    return unopenedItems;
  }

  function computeUnopenedFromGradeData(items, values, lastAccessDate) {
    var unopenedItems = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var gradeValue = null;
      var itemId = item.Id != null ? item.Id : item.id;
      for (var j = 0; j < values.length; j++) {
        var gv = values[j];
        var objId = gv.GradeObjectId != null ? gv.GradeObjectId : gv.ObjectId;
        if (objId != null && itemId != null && String(objId) === String(itemId)) {
          gradeValue = gv;
          break;
        }
      }
      var isReleased = item.IsReleased !== false;
      var hasPoints = gradeValue && gradeValue.PointsNumerator !== null && gradeValue.PointsNumerator !== undefined;
      if (gradeValue && isReleased && hasPoints) {
        var feedbackDate = gradeValue.DateEvaluated || gradeValue.DateCreated || gradeValue.DateReleased;
        if (feedbackDate) {
          var feedbackDateObj = new Date(feedbackDate);
          var lastAccessObj = lastAccessDate ? new Date(lastAccessDate) : null;
          var daysSinceFeedback = Math.floor((new Date() - feedbackDateObj) / (1000 * 60 * 60 * 24));
          var isUnopened = false;
          if (!lastAccessObj) {
            isUnopened = daysSinceFeedback >= 1;
          } else if (feedbackDateObj > lastAccessObj) {
            isUnopened = true;
          } else if (daysSinceFeedback >= 3 && feedbackDateObj <= lastAccessObj) {
            isUnopened = true;
          }
          if (isUnopened) {
            var itemType = "Assignment";
            var itemName = (item.Name != null ? item.Name : item.name) || "Untitled";
            var categoryName = item.CategoryName || item.categoryName || "";
            if (categoryName) {
              var categoryLower = categoryName.toLowerCase();
              if (categoryLower.indexOf("quiz") >= 0) itemType = "Quiz";
              else if (categoryLower.indexOf("dropbox") >= 0 || categoryLower.indexOf("assignment") >= 0) itemType = "Assignment";
            }
            var nameLower = itemName.toLowerCase();
            if (nameLower.indexOf("quiz") >= 0) itemType = "Quiz";
            else if (nameLower.indexOf("dropbox") >= 0) itemType = "Dropbox";
            unopenedItems.push({
              type: itemType,
              name: String(itemName).substring(0, 80),
              gradeObjectId: item.Id != null ? item.Id : item.id,
              feedbackDate: feedbackDate,
              pointsEarned: gradeValue.PointsNumerator,
              pointsPossible: gradeValue.PointsDenominator != null ? gradeValue.PointsDenominator : (item.MaxPoints != null ? item.MaxPoints : item.maxPoints)
            });
          }
        }
      }
    }
    return unopenedItems;
  }

  async function getUnopenedFeedbackFromDropbox(orgUnitId, userId, lastAccessDate) {
    var out = [];
    try {
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var dropboxFolders = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
      if (!dropboxFolders || !dropboxFolders.length) return out;
      var foldersToCheck = dropboxFolders.slice(0, 10);
      for (var k = 0; k < foldersToCheck.length; k++) {
        var folder = foldersToCheck[k];
        try {
          var submissionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folder.Id + "/submissions/?activeOnly=true";
          var submissions = await BrightspaceFetch(submissionsEndpoint).catch(function() { return null; });
          if (submissions && submissions.length) {
            for (var l = 0; l < submissions.length; l++) {
              var submission = submissions[l];
              if (submission.Entity && String(submission.Entity.Identifier) === String(userId)) {
                if (submission.Status === 3 && submission.Feedback && submission.Feedback.IsGraded) {
                  var feedbackDate = submission.Feedback.DateCreated || submission.Feedback.DateReleased;
                  if (feedbackDate) {
                    var feedbackDateObj = new Date(feedbackDate);
                    var lastAccessObj = lastAccessDate ? new Date(lastAccessDate) : null;
                    if (!lastAccessObj || feedbackDateObj > lastAccessObj) {
                      out.push({
                        type: "Dropbox",
                        name: folder.Name || "Untitled Assignment",
                        folderId: folder.Id,
                        feedbackDate: feedbackDate
                      });
                    }
                  }
                }
                break;
              }
            }
          }
        } catch (e) { /* continue */ }
      }
    } catch (e) { /* dropbox not available */ }
    return out;
  }

  // Original full fetch (used if not batching)
  async function getUnopenedFeedbackItems(orgUnitId, userId, lastAccessDate) {
    var gradeItems = await getGradeItemsForCourse(orgUnitId);
    if (!gradeItems) return [];
    return getUnopenedFeedbackItemsWithGradeItems(orgUnitId, gradeItems, userId, lastAccessDate);
  }

  // =========================
  // LOAD QUIZ ATTEMPT TIMES FOR STUDENTS
  // =========================
  async function loadQuizAttemptTimes(orgUnitId, students) {
    try {
      // Get all quizzes for the course
      var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
      var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
      
      if (!quizData || !quizData.Objects || quizData.Objects.length === 0) {
        return;
      }
      
      // Create a map of student IDs for quick lookup
      var studentsMap = new Map();
      for (var i = 0; i < students.length; i++) {
        studentsMap.set(String(students[i].userId), students[i]);
      }
      
      // Collect all attempt times across all quizzes
      var allAttemptTimes = [];
      var studentAttemptTimes = new Map(); // Map<userId, [attemptTimes]>
      
      // Limit to first 10 quizzes per course for performance
      var quizzesToCheck = quizData.Objects.slice(0, 10);
      
      for (var j = 0; j < quizzesToCheck.length; j++) {
        var quiz = quizzesToCheck[j];
        var quizId = quiz.QuizId;
        var quizName = quiz.Name || "Untitled Quiz";
        
        try {
          var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/attempts/";
          var attemptsData = await BrightspaceFetch(attemptsEndpoint).catch(function(err) {
            if (err && err.isExpected) {
              return null;
            }
            return null;
          });
          
          if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
            for (var k = 0; k < attemptsData.Objects.length; k++) {
              var attempt = attemptsData.Objects[k];
              
              // Only process completed attempts (Completed field exists and is not null)
              if (attempt.Completed !== null && attempt.Completed !== undefined && attempt.Started) {
                try {
                  var startTime = new Date(attempt.Started);
                  var completedTime = new Date(attempt.Completed);
                  
                  // Validate dates
                  if (isNaN(startTime.getTime()) || isNaN(completedTime.getTime())) {
                    continue;
                  }
                  
                  var attemptTimeMinutes = (completedTime - startTime) / (1000 * 60); // Convert to minutes
                  
                  // Only count reasonable attempt times (between 1 minute and 24 hours)
                  if (attemptTimeMinutes >= 1 && attemptTimeMinutes <= 1440) {
                    allAttemptTimes.push(attemptTimeMinutes);
                    
                    var userId = String(attempt.UserId);
                    if (studentsMap.has(userId)) {
                      if (!studentAttemptTimes.has(userId)) {
                        studentAttemptTimes.set(userId, []);
                      }
                      studentAttemptTimes.get(userId).push({
                        quizName: quizName,
                        quizId: quizId,
                        attemptTime: attemptTimeMinutes
                      });
                    }
                  }
                } catch (e) {
                  // Skip invalid date formats
                  continue;
                }
              }
            }
          }
        } catch (e) {
          // Continue to next quiz
        }
      }
      
      // Calculate average attempt time
      var avgAttemptTime = 0;
      if (allAttemptTimes.length > 0) {
        var sum = 0;
        for (var l = 0; l < allAttemptTimes.length; l++) {
          sum += allAttemptTimes[l];
        }
        avgAttemptTime = sum / allAttemptTimes.length;
      }
      
      // Identify students taking 2x the average
      var threshold = avgAttemptTime * 2;
      
      for (var [userId, attempts] of studentAttemptTimes) {
        var student = studentsMap.get(userId);
        if (student) {
          // Find attempts that are 2x the average
          for (var m = 0; m < attempts.length; m++) {
            if (attempts[m].attemptTime >= threshold) {
              student.quizAttemptTimes.push(attempts[m]);
            }
          }
        }
      }
      
    } catch (e) {
      logDiagnostic("ERROR", "Error loading quiz attempt times: " + e.message);
    }
  }

  // =========================
  // LOAD DISCUSSION PARTICIPATION FOR STUDENTS
  // =========================
  async function loadDiscussionParticipation(orgUnitId, students) {
    try {
      // Get all forums for the course
      var forumsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
      var forumsData = await BrightspaceFetch(forumsEndpoint).catch(function() { return null; });
      
      if (!forumsData || forumsData.length === 0) {
        return;
      }
      
      // Create a map of student IDs for quick lookup
      var studentsMap = new Map();
      for (var i = 0; i < students.length; i++) {
        studentsMap.set(String(students[i].userId), students[i]);
      }
      
      // Track posts and replies per student
      var studentPosts = new Map(); // Map<userId, {posts: count, replies: count, readCount: count}>
      
      // Limit to first 5 forums per course for performance
      var forumsToCheck = forumsData.slice(0, 5);
      
      for (var j = 0; j < forumsToCheck.length; j++) {
        var forum = forumsToCheck[j];
        var forumId = forum.ForumId;
        
        try {
          // Get topics in this forum
          var topicsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/";
          var topicsData = await BrightspaceFetch(topicsEndpoint).catch(function() { return null; });
          
          if (!topicsData || topicsData.length === 0) continue;
          
          // Limit to first 5 topics per forum
          var topicsToCheck = topicsData.slice(0, 5);
          
          for (var k = 0; k < topicsToCheck.length; k++) {
            var topic = topicsToCheck[k];
            var topicId = topic.TopicId;
            
            try {
              // Get all posts in this topic
              var postsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/";
              var postsData = await BrightspaceFetch(postsEndpoint).catch(function() { return null; });
              
              if (!postsData || postsData.length === 0) continue;
              
              for (var l = 0; l < postsData.length; l++) {
                var post = postsData[l];
                var userId = String(post.PostingUserId);
                
                if (!userId || userId === "null" || userId === "undefined") continue;
                
                // Check if this is a top-level post (no parent) or a reply
                var isTopLevel = !post.ParentPostId || post.ParentPostId === null;
                
                if (isTopLevel) {
                  // This is a top-level post - count it for the poster
                  if (!studentPosts.has(userId)) {
                    studentPosts.set(userId, { posts: 0, replies: 0, readCount: 0 });
                  }
                  studentPosts.get(userId).posts++;
                } else {
                  // This is a reply - count it for the poster AND increment reply count for parent post author
                  if (!studentPosts.has(userId)) {
                    studentPosts.set(userId, { posts: 0, replies: 0, readCount: 0 });
                  }
                  studentPosts.get(userId).replies++;
                  
                  // Also track that the parent post author received a reply (for "posted but not replied to others" logic)
                  // Note: We'd need to look up the parent post to get its author, but for now we'll just track replies made
                }
                
                // Count reads if IsRead is available (LE API 1.45+)
                // Note: IsRead might only be available from student's perspective, so this may not work for instructors
                if (post.IsRead !== undefined && post.IsRead === true) {
                  if (!studentPosts.has(userId)) {
                    studentPosts.set(userId, { posts: 0, replies: 0, readCount: 0 });
                  }
                  studentPosts.get(userId).readCount++;
                }
              }
            } catch (e) {
              // Continue to next topic
            }
          }
        } catch (e) {
          // Continue to next forum
        }
      }
      
      // Update student records
      for (var [userId, stats] of studentPosts) {
        var student = studentsMap.get(userId);
        if (student) {
          student.discussionPosts = stats.posts;
          student.discussionReplies = stats.replies;
          student.discussionReadCount = stats.readCount;
        }
      }
      
    } catch (e) {
      logDiagnostic("ERROR", "Error loading discussion participation: " + e.message);
    }
  }

  // =========================
  // COMPUTE CURRENT GRADE % (From graded items only)
  // =========================
  async function computeCurrentGrade(orgUnitId, userId, gradeItems) {
    try {
      var gradeValues = await getGradeValuesForStudent(orgUnitId, userId);
      if (!gradeValues || gradeValues.length === 0) {
        return null;
      }

      var totalEarned = 0;
      var totalPossible = 0;

      for (var i = 0; i < gradeItems.length; i++) {
        var item = gradeItems[i];
        // Include only released, countable items (exclude bonus, exempt, hidden if possible)
        if (item.IsBonus || item.IsExempt || !item.IsReleased) {
          continue;
        }

        // Find matching grade value
        var gradeValue = null;
        for (var j = 0; j < gradeValues.length; j++) {
          if (gradeValues[j].GradeObjectId === item.Id) {
            gradeValue = gradeValues[j];
            break;
          }
        }

        if (gradeValue && gradeValue.PointsNumerator !== null && gradeValue.PointsNumerator !== undefined &&
            gradeValue.PointsDenominator !== null && gradeValue.PointsDenominator !== undefined &&
            gradeValue.PointsDenominator > 0) {
          totalEarned += gradeValue.PointsNumerator;
          totalPossible += gradeValue.PointsDenominator;
        }
      }

      if (totalPossible > 0) {
        return (totalEarned / totalPossible) * 100;
      }
      return null;
    } catch (e) {
      logDiagnostic("ERROR", "Error computing grade: " + e.message);
      return null;
    }
  }

  // =========================
  // GET NEWS FOR COURSE
  // =========================
  async function getNewsForCourse(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/news/";
      var data = await BrightspaceFetch(endpoint);
      return data || [];
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        logDiagnostic("ERROR", "Error fetching news: " + e.message);
      }
      return [];
    }
  }

  // =========================
  // GET CONTENT TOC FOR COURSE
  // =========================
  async function getContentTOC(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/content/toc";
      var data = await BrightspaceFetch(endpoint);
      return data || null;
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        logDiagnostic("ERROR", "Error fetching content TOC: " + e.message);
      }
      return null;
    }
  }

  // =========================
  // CALCULATE DAYS AGO
  // =========================
  function daysAgo(dateString) {
    if (!dateString) return null;
    try {
      var date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      var now = new Date();
      var diffTime = Math.abs(now - date);
      var diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch (e) {
      return null;
    }
  }

  // =========================
  // FORMAT DATE
  // =========================
  function formatDate(dateString) {
    if (!dateString) return "Never";
    try {
      var date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  }

  // =========================
  // GET COURSE START DATE
  // =========================
  async function getCourseStartDate(orgUnitId) {
    var key = String(orgUnitId);
    if (courseStartDatesMap.has(key)) {
      return courseStartDatesMap.get(key);
    }
    try {
      // Course Offering API returns StartDate/EndDate (OrgUnit endpoint may not)
      var endpoint = "/d2l/api/lp/" + API_VERSION_LP + "/courses/" + key;
      var data = await BrightspaceFetch(endpoint);
      var startDate = (data && (data.StartDate != null)) ? data.StartDate : null;
      var endDate = (data && (data.EndDate != null)) ? data.EndDate : null;
      courseStartDatesMap.set(key, startDate);
      courseEndDatesMap.set(key, endDate);
      return startDate;
    } catch (e) {
      courseStartDatesMap.set(key, null);
      courseEndDatesMap.set(key, null);
      return null;
    }
  }

  // =========================
  // CHECK IF COURSE HASN'T STARTED
  // =========================
  function hasCourseNotStarted(courseId) {
    var startDate = courseStartDatesMap.get(String(courseId));
    if (!startDate) return false;
    try {
      var start = new Date(startDate);
      var now = new Date();
      return start > now;
    } catch (e) {
      return false;
    }
  }

  // =========================
  // CHECK IF COURSE HAS ENDED
  // =========================
  function hasCourseEnded(courseId) {
    var endDate = courseEndDatesMap.get(String(courseId));
    if (!endDate) return false;
    try {
      var end = new Date(endDate);
      var now = new Date();
      return end < now;
    } catch (e) {
      return false;
    }
  }

  // =========================
  // PROCESS COURSE DATA
  // =========================
  async function processCourse(course, progressCallback) {
    var orgUnitId = String(course.OrgUnit.Id);
    var courseName = course.OrgUnit.Name || "Unknown Course";
    var courseCode = course.OrgUnit.Code || "";

    logDiagnostic("PROCESS", "Processing course: " + courseName + " (" + orgUnitId + ")");

    // Check cache first (but still ensure start date is in map for filter)
    if (analyticsCache[orgUnitId]) {
      logDiagnostic("CACHE", "Using cached data for course " + orgUnitId);
      await getCourseStartDate(orgUnitId);
      return analyticsCache[orgUnitId];
    }

    // Fetch course start date
    await getCourseStartDate(orgUnitId);

    var courseData = {
      courseId: orgUnitId,
      courseName: courseName,
      courseCode: courseCode,
      students: [],
      gradeItems: [],
      news: [],
      contentTOC: null,
      gradesMap: new Map()
    };

    try {
      // Fetch data in parallel where possible
      var [classlist, gradesMap, gradeItems, news, contentTOC] = await Promise.allSettled([
        getClasslist(orgUnitId),
        getGradesForCourse(orgUnitId),
        getGradeItemsForCourse(orgUnitId),
        getNewsForCourse(orgUnitId),
        getContentTOC(orgUnitId)
      ]);

      courseData.gradesMap = gradesMap.status === "fulfilled" ? gradesMap.value : new Map();
      courseData.gradeItems = gradeItems.status === "fulfilled" ? gradeItems.value : [];
      courseData.news = news.status === "fulfilled" ? news.value : [];
      courseData.contentTOC = contentTOC.status === "fulfilled" ? contentTOC.value : null;

      var students = classlist.status === "fulfilled" ? classlist.value : [];

      // Process students
      for (var i = 0; i < students.length; i++) {
        var student = students[i];
        
        // Filter: only students (RoleId 101 or role name contains "student")
        var roleName = (student.ClasslistRoleDisplayName || "").toLowerCase();
        var isStudent = roleName.indexOf("student") >= 0 || 
                       student.RoleId === 3 || 
                       student.RoleId === 5 || 
                       student.RoleId === 101;
        
        if (!isStudent) continue;

        var userId = String(student.Identifier || "");
        if (!userId) continue;

        var lastAccess = student.LastAccessed || null;
        var finalGrade = courseData.gradesMap.get(userId) || null;

        // Compute current grade from graded items if final grade not available
        var currentGrade = finalGrade;
        if (!currentGrade && courseData.gradeItems.length > 0) {
          currentGrade = await computeCurrentGrade(orgUnitId, userId, courseData.gradeItems);
        }

        var studentRecord = {
          userId: userId,
          firstName: student.FirstName || "",
          lastName: student.LastName || "",
          email: student.Email || "",
          orgDefinedId: student.OrgDefinedId || "",
          courseId: orgUnitId,
          courseName: courseName,
          courseCode: courseCode,
          lastAccess: lastAccess,
          currentGrade: currentGrade,
          finalGrade: finalGrade,
          riskFlags: [],
          unopenedFeedbackItems: [], // Will be populated later
          quizAttemptTimes: [], // Array of {quizName, attemptTime (minutes), quizId}
          discussionPosts: 0, // Count of posts made
          discussionReplies: 0 // Count of replies to others
        };

        // Exclude demo student from all metrics
        if (isDemoStudent(studentRecord)) continue;

        // Calculate risk flags
        var daysSinceAccess = daysAgo(lastAccess);
        
        // Never Attended
        if (!lastAccess || daysSinceAccess === null) {
          studentRecord.riskFlags.push("never-attended");
        }
        
        // Inactive 7d
        if (daysSinceAccess !== null && daysSinceAccess > INACTIVE_7D_DAYS) {
          studentRecord.riskFlags.push("inactive-7d");
        }
        
        // Inactive 3d
        if (daysSinceAccess !== null && daysSinceAccess > INACTIVE_3D_DAYS) {
          studentRecord.riskFlags.push("inactive-3d");
        }
        
        // Failing
        if (currentGrade !== null && currentGrade < currentThreshold) {
          studentRecord.riskFlags.push("failing");
        }
        
        // Drop-off (heuristic: had access within 7 days previously but now > 7 days)
        // Simplified: if has graded activity but last access is old
        if (currentGrade !== null && daysSinceAccess !== null && daysSinceAccess > INACTIVE_7D_DAYS) {
          studentRecord.riskFlags.push("drop-off");
        }
        
        // Behind Pace (simplified: compare to class median)
        // This would require more complex logic, skipping for now

        courseData.students.push(studentRecord);
      }

      // Note: Unopened feedback items will be loaded after all courses are processed
      // to avoid blocking and to ensure proper deduplication

      // Cache the result
      analyticsCache[orgUnitId] = courseData;
      logDiagnostic("PROCESS", "Processed " + courseData.students.length + " students for course " + courseName);

      if (progressCallback) {
        progressCallback();
      }

      return courseData;
    } catch (e) {
      logDiagnostic("ERROR", "Error processing course " + courseName + ": " + e.message);
      return courseData;
    }
  }

  // =========================
  // LOAD ALL ANALYTICS DATA
  // =========================
  async function loadAnalytics() {
    var loadBtn = document.getElementById("load-analytics-btn");
    var progressDiv = document.getElementById("analytics-progress");
    var progressBar = document.getElementById("progress-bar");
    var progressText = document.getElementById("progress-text");
    var lastLoadedText = document.getElementById("last-loaded-text");

    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = "Loading...";
    }
    if (progressDiv) progressDiv.style.display = "block";
    if (progressBar) progressBar.style.width = "0%";
    if (progressText) progressText.textContent = "Initializing...";

    try {
      logDiagnostic("LOAD", "Starting analytics load...");

      // Read checkbox state at load time so we respect date filters
      syncFilterCheckboxes();

      // Get courses
      coursesList = await getEnrollments();

      // Always fetch start/end dates for every course so date filters can work correctly
      if (coursesList.length > 0) {
        await Promise.all(coursesList.map(function(c) { return getCourseStartDate(String(c.OrgUnit.Id)); }));
      }
      
      // Populate course filter dropdown
      var courseFilter = document.getElementById("analytics-course-filter");
      if (courseFilter) {
        courseFilter.innerHTML = '<option value="all">All Courses</option>';
        for (var i = 0; i < coursesList.length; i++) {
          var course = coursesList[i];
          var option = document.createElement("option");
          option.value = course.OrgUnit.Id;
          option.textContent = (course.OrgUnit.Name || "Unknown") + (course.OrgUnit.Code ? " (" + course.OrgUnit.Code + ")" : "");
          courseFilter.appendChild(option);
        }
        // Restore selected course so it isn't reset to "all" when dropdown is repopulated
        if (currentCourseFilter && Array.prototype.some.call(courseFilter.options, function(o) { return o.value === String(currentCourseFilter); })) {
          courseFilter.value = currentCourseFilter;
        }
      }

      // Filter courses based on current filter
      var coursesToProcess = coursesList;
      if (currentCourseFilter !== "all") {
        coursesToProcess = coursesList.filter(function(c) {
          return String(c.OrgUnit.Id) === String(currentCourseFilter);
        });
      }

      // When date filters are checked, exclude not-started / ended courses from processing
      if ((hideNotStartedCourses || hideEndedCourses) && coursesToProcess.length > 0) {
        await Promise.all(coursesToProcess.map(function(c) { return getCourseStartDate(String(c.OrgUnit.Id)); }));
        coursesToProcess = coursesToProcess.filter(function(c) {
          return !isCourseExcludedByDateFilters(c.OrgUnit.Id);
        });
        logDiagnostic("LOAD", "After filtering by course dates: " + coursesToProcess.length + " courses to process");
      }

      var totalCourses = coursesToProcess.length;
      var processedCourses = 0;
      var concurrencyLimit = 3;
      var activePromises = [];

      // Start Course Friction (Challenging Quizzes + Submission Bottleneck) immediately — in parallel with main load
      // so load bars appear right away instead of after 5+ minutes (Phase 2 + Phase 3)
      if (coursesToProcess.length > 0) {
        showSectionLoading("challenging-question-list", "Loading challenging quizzes…");
        showSectionLoading("submission-bottleneck-list", "Loading submission bottlenecks…");
        var phase4TimeoutMs = 90000;
        var phase4TimeoutId = null;
        var phase4Done = false;
        function finishPhase4() {
          if (phase4Done) return;
          phase4Done = true;
          if (phase4TimeoutId) clearTimeout(phase4TimeoutId);
          renderCourseFrictionSection();
          renderTrendsSection();
        }
        phase4TimeoutId = setTimeout(function() {
          logDiagnostic("LOAD", "Course friction load timed out after " + (phase4TimeoutMs / 1000) + "s; showing data so far.");
          finishPhase4();
        }, phase4TimeoutMs);
        loadCourseFrictionData(coursesToProcess).then(function() {
          finishPhase4();
        }).catch(function(e) {
          logDiagnostic("ERROR", "Course friction load failed: " + (e && e.message));
          finishPhase4();
        });
      }

      // Process courses with concurrency limit
      for (var i = 0; i < coursesToProcess.length; i++) {
        var course = coursesToProcess[i];
        
        // Wait if we've hit the concurrency limit
        if (activePromises.length >= concurrencyLimit) {
          await Promise.race(activePromises);
          activePromises = activePromises.filter(function(p) {
            return p.status !== "fulfilled" && p.status !== "rejected";
          });
        }

        var promise = processCourse(course, function() {
          processedCourses++;
          var progress = Math.round((processedCourses / totalCourses) * 100);
          if (progressBar) progressBar.style.width = progress + "%";
          if (progressText) {
            progressText.textContent = "Processing course " + processedCourses + " of " + totalCourses;
          }
        }).then(function(result) {
          return { status: "fulfilled", result: result };
        }).catch(function(error) {
          return { status: "rejected", error: error };
        });

        activePromises.push(promise);
      }

      // Wait for all remaining promises
      await Promise.all(activePromises);

      // Aggregate all student data
      studentsData = [];
      courseReadinessData = [];
      gradingData = [];
      var studentsMap = new Map(); // Map<userId_courseId, student> for deduplication

      for (var j = 0; j < coursesToProcess.length; j++) {
        var course = coursesToProcess[j];
        var orgUnitId = String(course.OrgUnit.Id);
        var cached = analyticsCache[orgUnitId];
        
        if (cached) {
          // Deduplicate students - use userId + courseId as key; exclude demo student
          for (var s = 0; s < cached.students.length; s++) {
            var student = cached.students[s];
            if (isDemoStudent(student)) continue;
            var key = student.userId + "_" + student.courseId;
            if (!studentsMap.has(key)) {
              studentsMap.set(key, student);
            } else {
              // If duplicate, keep the one with more data (e.g., has grades)
              var existing = studentsMap.get(key);
              if (student.currentGrade !== null && existing.currentGrade === null) {
                studentsMap.set(key, student);
              } else if (student.unopenedFeedbackItems && student.unopenedFeedbackItems.length > 0 && 
                        (!existing.unopenedFeedbackItems || existing.unopenedFeedbackItems.length === 0)) {
                studentsMap.set(key, student);
              }
            }
          }
          
          // Grading data aggregation
          if (cached.gradeItems && cached.gradeItems.length > 0) {
            gradingData.push({
              courseId: orgUnitId,
              courseName: cached.courseName,
              courseCode: cached.courseCode,
              gradeItemsCount: cached.gradeItems.length,
              gradeItems: cached.gradeItems
            });
          }
          
          // Course Readiness is now loaded separately by course-readiness.js (no aggregation here)
        }
      }

      // Convert map to array and exclude demo student from all metrics
      studentsData = Array.from(studentsMap.values()).filter(function(s) {
        return !isDemoStudent(s);
      });

      riskTableRowsToShow = 10; // Reset to show top 10 on fresh load

      // Group students by course for async phases
      var studentsByCourse = new Map();
      for (var u = 0; u < studentsData.length; u++) {
        var student = studentsData[u];
        if (!studentsByCourse.has(student.courseId)) {
          studentsByCourse.set(student.courseId, []);
        }
        studentsByCourse.get(student.courseId).push(student);
      }

      // Phased async loading: fastest sections first, each with its own loading indicator
      setTimeout(async function runPhasedLoading() {
        // Phase 1 (already done): Risk Table, Needs Attention, Engagement (Low Content, Time, Login), Assessment (Grade Volatility) use main data

        // Phase 2: Quiz attempt times + Discussion (fast) – show loading in those two cards only
        showSectionLoading("high-quiz-time-list", "Loading quiz attempt times…");
        showSectionLoading("discussion-lurkers-list", "Loading discussion participation…");
        for (var [courseId, courseStudents] of studentsByCourse) {
          try {
            await loadQuizAttemptTimes(courseId, courseStudents);
            await loadDiscussionParticipation(courseId, courseStudents);
          } catch (e) {
            logDiagnostic("ERROR", "Error loading quiz/discussion for course " + courseId + ": " + e.message);
          }
        }
        renderAssessmentSection();

        // Phase 3: Unopened feedback (slower) – load in background; keep existing list visible (no overlay)
        isUnopenedFeedbackLoading = true;
        for (var [courseId, courseStudents] of studentsByCourse) {
          try {
            var gradeItems = await getGradeItemsForCourse(courseId);
            if (!gradeItems) continue;
            for (var v = 0; v < courseStudents.length; v++) {
              var student2 = courseStudents[v];
              try {
                student2.unopenedFeedbackItems = await getUnopenedFeedbackItemsWithGradeItems(courseId, gradeItems, student2.userId, student2.lastAccess);
              } catch (e) {
                student2.unopenedFeedbackItems = [];
              }
            }
          } catch (e) {
            logDiagnostic("ERROR", "Error loading unopened feedback for course " + courseId + ": " + e.message);
          }
        }
        isUnopenedFeedbackLoading = false;
        renderEngagementSection();
        // Phase 4 (Course Friction) now runs in parallel with main load — started above, not here
      }, 100);

      // Update UI (sections are always visible, just update content)
      renderNeedsAttention();
      renderStudentRiskTable();
      renderBuckets();
      renderCommunicationSection();

      if (currentCourseFilter && currentCourseFilter !== "all") {
        loadNonParticipationData(currentCourseFilter).then(function() {
          renderNonParticipationSection();
          return loadExternalGradesData(currentCourseFilter);
        }).then(function() {
          renderExternalGradesSection();
        }).catch(function(e) {
          logDiagnostic("ERROR", "Non-participation load failed: " + (e && e.message));
          setNonParticipationProgress("");
        });
      }

      // Update timestamp
      var now = new Date();
      if (lastLoadedText) {
        lastLoadedText.textContent = "Last Loaded: " + now.toLocaleString();
      }

      logDiagnostic("LOAD", "Analytics load complete. Students: " + studentsData.length + ", Courses: " + courseReadinessData.length);
      hasLoadedAnalyticsOnce = true;

    } catch (e) {
      logDiagnostic("ERROR", "Failed to load analytics: " + e.message);
      alert("Error loading analytics: " + e.message);
    } finally {
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = hasLoadedAnalyticsOnce ? "Refresh Data" : "Load Analytics";
      }
      if (progressDiv) progressDiv.style.display = "none";
    }
  }

  // =========================
  // RENDER NEEDS ATTENTION STRIP
  // =========================
  function renderNeedsAttention() {
    syncFilterCheckboxes();
    var container = document.getElementById("needs-attention-tiles");
    var section = document.getElementById("needs-attention-strip");
    if (!container || !section) return;

    // Calculate counts
    var counts = {
      inactive3d: 0,
      inactive7d: 0,
      neverAttended: 0,
      failing: 0,
      dropOff: 0,
      behindPace: 0,
      missingSyllabus: 0,
      brokenLinks: 0
    };

    // Filter students by current course filter and hide not started courses
    var filteredStudents = studentsData;
    if (currentCourseFilter !== "all") {
      filteredStudents = studentsData.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filteredStudents = filteredStudents.filter(function(s) {
        return !isCourseExcludedByDateFilters(s.courseId);
      });
    }

    for (var i = 0; i < filteredStudents.length; i++) {
      var student = filteredStudents[i];
      if (student.riskFlags.indexOf("inactive-3d") >= 0) counts.inactive3d++;
      if (student.riskFlags.indexOf("inactive-7d") >= 0) counts.inactive7d++;
      if (student.riskFlags.indexOf("never-attended") >= 0) counts.neverAttended++;
      if (student.riskFlags.indexOf("failing") >= 0) counts.failing++;
      if (student.riskFlags.indexOf("drop-off") >= 0) counts.dropOff++;
      if (student.riskFlags.indexOf("behind-pace") >= 0) counts.behindPace++;
    }

    // Course readiness counts (use course-readiness.js data when available)
    var readinessSource = (window.CourseReadiness && typeof window.CourseReadiness.getData === "function")
      ? window.CourseReadiness.getData() : courseReadinessData;
    var filteredCourses = readinessSource;
    if (currentCourseFilter !== "all") {
      filteredCourses = readinessSource.filter(function(c) {
        return String(c.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filteredCourses = filteredCourses.filter(function(c) {
        return !isCourseExcludedByDateFilters(c.courseId);
      });
    }

    for (var j = 0; j < filteredCourses.length; j++) {
      var course = filteredCourses[j];
      if (course.missingSyllabus) counts.missingSyllabus++;
      if (course.brokenLinks > 0) counts.brokenLinks += course.brokenLinks;
    }

    container.innerHTML = "";

    var tiles = [
      { label: "Inactive 3d", count: counts.inactive3d, id: "inactive-3d" },
      { label: "Inactive 7d", count: counts.inactive7d, id: "inactive-7d" },
      { label: "Never Attnd", count: counts.neverAttended, id: "never-attended" },
      { label: "Failing", count: counts.failing, id: "failing" },
      { label: "Drop-off", count: counts.dropOff, id: "drop-off" },
      { label: "Behind Pace", count: counts.behindPace, id: "behind-pace" },
      { label: "Missing Syl", count: counts.missingSyllabus, id: "missing-syllabus" },
      { label: "Broken Links", count: counts.brokenLinks, id: "broken-links" }
    ];

    for (var k = 0; k < tiles.length; k++) {
      var tile = tiles[k];
      var tileEl = document.createElement("div");
      tileEl.style.cssText = "padding: 12px 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s;";
      tileEl.style.cssText += "display: flex; flex-direction: column; align-items: center; min-width: 100px;";
      tileEl.onmouseover = function() { this.style.background = "#e5e7eb"; };
      tileEl.onmouseout = function() { this.style.background = "#f9fafb"; };
      tileEl.onclick = function() {
        var targetId = this.getAttribute("data-target");
        if (targetId === "missing-syllabus" || targetId === "broken-links") {
          document.getElementById("course-readiness-bucket").scrollIntoView({ behavior: "smooth" });
        } else {
          document.getElementById("student-risk-table-section").scrollIntoView({ behavior: "smooth" });
        }
      };
      tileEl.setAttribute("data-target", tile.id);

      var labelEl = document.createElement("div");
      labelEl.style.cssText = "font-size: 12px; color: #666; margin-bottom: 4px;";
      labelEl.textContent = tile.label;

      var countEl = document.createElement("div");
      countEl.style.cssText = "font-size: 24px; font-weight: 700; color: #0f5b46;";
      countEl.textContent = tile.count;

      tileEl.appendChild(labelEl);
      tileEl.appendChild(countEl);
      container.appendChild(tileEl);
    }

    section.style.display = "block";
  }

  // =========================
  // RENDER STUDENT RISK TABLE
  // =========================
  function renderStudentRiskTable() {
    syncFilterCheckboxes();
    var tbody = document.getElementById("risk-table-body");
    var section = document.getElementById("student-risk-table-section");
    if (!tbody || !section) return;

    // Filter students
    var filtered = studentsData;
    if (currentCourseFilter !== "all") {
      filtered = studentsData.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filtered = filtered.filter(function(s) {
        return !isCourseExcludedByDateFilters(s.courseId);
      });
    }

    // Apply risk filter
    var riskFilter = document.getElementById("risk-filter");
    if (riskFilter && riskFilter.value !== "all") {
      filtered = filtered.filter(function(s) {
        return s.riskFlags.indexOf(riskFilter.value) >= 0;
      });
    }

    // Apply search
    var searchInput = document.getElementById("risk-search");
    if (searchInput && searchInput.value) {
      var searchTerm = searchInput.value.toLowerCase();
      filtered = filtered.filter(function(s) {
        var fullName = (s.firstName + " " + s.lastName).toLowerCase();
        var email = (s.email || "").toLowerCase();
        var orgDefinedId = (s.orgDefinedId || "").toLowerCase();
        var courseName = (s.courseName || "").toLowerCase();
        return fullName.indexOf(searchTerm) >= 0 || 
               email.indexOf(searchTerm) >= 0 || 
               orgDefinedId.indexOf(searchTerm) >= 0 ||
               courseName.indexOf(searchTerm) >= 0;
      });
    }

    // Apply filter for students below 72% passing
    if (showOnlyBelow72) {
      filtered = filtered.filter(function(s) {
        return s.currentGrade !== null && s.currentGrade < 72;
      });
    }

    // Sort - ensure entire rows move together
    var sortFilter = document.getElementById("sort-filter");
    if (sortFilter) {
      var sortValue = sortFilter.value;
      filtered.sort(function(a, b) {
        if (sortValue === "highest-risk") {
          // Sort by risk priority: never-attended > inactive-7d > failing > behind-pace > drop-off
          var riskPriority = { "never-attended": 5, "inactive-7d": 4, "failing": 3, "behind-pace": 2, "drop-off": 1 };
          var aMax = 0, bMax = 0;
          for (var i = 0; i < a.riskFlags.length; i++) {
            aMax = Math.max(aMax, riskPriority[a.riskFlags[i]] || 0);
          }
          for (var j = 0; j < b.riskFlags.length; j++) {
            bMax = Math.max(bMax, riskPriority[b.riskFlags[j]] || 0);
          }
          // If same risk level, sort by name as secondary
          if (bMax === aMax) {
            return (a.firstName + " " + a.lastName).localeCompare(b.firstName + " " + b.lastName);
          }
          return bMax - aMax;
        } else if (sortValue === "name") {
          var nameCompare = (a.firstName + " " + a.lastName).localeCompare(b.firstName + " " + b.lastName);
          // If same name, sort by course as secondary
          if (nameCompare === 0) {
            return a.courseName.localeCompare(b.courseName);
          }
          return nameCompare;
        } else if (sortValue === "course") {
          var courseCompare = a.courseName.localeCompare(b.courseName);
          // If same course, sort by name as secondary
          if (courseCompare === 0) {
            return (a.firstName + " " + a.lastName).localeCompare(b.firstName + " " + b.lastName);
          }
          return courseCompare;
        } else if (sortValue === "grade") {
          var aGrade = a.currentGrade !== null ? a.currentGrade : -1;
          var bGrade = b.currentGrade !== null ? b.currentGrade : -1;
          // Sort descending (highest grade first), then by name if same grade
          if (bGrade === aGrade) {
            return (a.firstName + " " + a.lastName).localeCompare(b.firstName + " " + b.lastName);
          }
          return bGrade - aGrade;
        }
        return 0;
      });
    }

    tbody.innerHTML = "";

    if (filtered.length === 0) {
      var emptyRow = document.createElement("tr");
      emptyRow.innerHTML = "<td colspan='6' style='padding: 40px; text-align: center; color: #999;'>No students found. Click 'Load Analytics' to fetch data.</td>";
      tbody.appendChild(emptyRow);
      return;
    }

    var rowsToRender = riskTableRowsToShow === -1 ? filtered.length : Math.min(riskTableRowsToShow, filtered.length);
    for (var i = 0; i < rowsToRender; i++) {
      var student = filtered[i];
      var row = document.createElement("tr");
      row.style.borderBottom = "1px solid #e5e7eb";

      var fullName = (student.firstName + " " + student.lastName).trim() || "Unknown";
      var studentCell = document.createElement("td");
      studentCell.style.padding = "12px";
      studentCell.innerHTML = fullName + "<br><small style='color: #666;'>" + (student.orgDefinedId || student.userId) + "</small>";

      var courseCell = document.createElement("td");
      courseCell.style.padding = "12px";
      courseCell.textContent = student.courseName + (student.courseCode ? " (" + student.courseCode + ")" : "");

      var lastAccessCell = document.createElement("td");
      lastAccessCell.style.padding = "12px";
      lastAccessCell.textContent = formatDate(student.lastAccess);

      var gradeCell = document.createElement("td");
      gradeCell.style.padding = "12px";
      gradeCell.textContent = student.currentGrade !== null ? student.currentGrade.toFixed(1) + "%" : "N/A";

      var flagsCell = document.createElement("td");
      flagsCell.style.padding = "12px";
      var flagsHtml = "";
      var flagLabels = {
        "never-attended": "Never Attended",
        "inactive-7d": "Inactive 7d",
        "inactive-3d": "Inactive 3d",
        "failing": "Failing",
        "drop-off": "Drop-off",
        "behind-pace": "Behind Pace"
      };
      for (var j = 0; j < student.riskFlags.length; j++) {
        var flag = student.riskFlags[j];
        var label = flagLabels[flag] || flag;
        flagsHtml += "<span style='display: inline-block; padding: 2px 8px; background: #fee; color: #c00; border-radius: 12px; font-size: 11px; margin-right: 4px;'>" + label + "</span>";
      }
      flagsCell.innerHTML = flagsHtml || "<span style='color: #666;'>None</span>";

      var sssReferralUrl = "https://intranet.example.edu/student-support-system/faculty.html";
      var actionsCell = document.createElement("td");
      actionsCell.style.padding = "12px";
      actionsCell.innerHTML = "<a href='/d2l/lms/classlist/classlist.d2l?ou=" + student.courseId + "' target='_blank' style='color: #0f5b46; text-decoration: none; margin-right: 8px;'>Classlist</a>" +
                              "<a href='/d2l/lms/grades/admin/enter/user_list_view.d2l?ou=" + student.courseId + "' target='_blank' style='color: #0f5b46; text-decoration: none; margin-right: 8px;'>Grades</a>" +
                              "<a href='" + sssReferralUrl + "' target='_blank' style='color: #0f5b46; text-decoration: none; margin-right: 8px;'>SSS Referral</a>" +
                              "<span style='color: #999;'>Message student</span>";

      row.appendChild(studentCell);
      row.appendChild(courseCell);
      row.appendChild(lastAccessCell);
      row.appendChild(gradeCell);
      row.appendChild(flagsCell);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    }

    // View more / View All row
    if (filtered.length > 10 && rowsToRender < filtered.length) {
      var moreRow = document.createElement("tr");
      moreRow.style.background = "#f8fafc";
      moreRow.innerHTML = "<td colspan='6' style='padding: 12px; text-align: center; border-top: 1px solid #e2e8f0;'>" +
        "<button type='button' id='risk-table-view-more' style='margin-right: 8px; padding: 6px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; font-size: 13px;'>View more (25)</button>" +
        "<button type='button' id='risk-table-view-all' style='padding: 6px 12px; background: #0f5b46; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;'>View All (" + filtered.length + ")</button>" +
        "<span style='margin-left: 12px; font-size: 12px; color: #64748b;'>Showing " + rowsToRender + " of " + filtered.length + "</span></td>";
      tbody.appendChild(moreRow);
      setTimeout(function() {
        var viewMoreBtn = document.getElementById("risk-table-view-more");
        var viewAllBtn = document.getElementById("risk-table-view-all");
        if (viewMoreBtn) {
          viewMoreBtn.addEventListener("click", function() {
            riskTableRowsToShow = 25;
            renderStudentRiskTable();
          });
        }
        if (viewAllBtn) {
          viewAllBtn.addEventListener("click", function() {
            riskTableRowsToShow = -1;
            renderStudentRiskTable();
          });
        }
      }, 0);
    } else if (filtered.length > 10 && riskTableRowsToShow === -1) {
      var showingRow = document.createElement("tr");
      showingRow.style.background = "#f8fafc";
      showingRow.innerHTML = "<td colspan='6' style='padding: 8px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;'>Showing all " + filtered.length + " students. Scroll to see more.</td>";
      tbody.appendChild(showingRow);
    }

    // Always show section, even if empty
    section.style.display = "block";
  }

  // =========================
  // RENDER BUCKETS
  // =========================
  function renderBuckets() {
    syncFilterCheckboxes();
    renderEngagementSection();
    renderAssessmentSection();
    renderCourseFrictionSection();
    renderTrendsSection();
    renderCourseReadinessBucket();
    
    // Sections are always visible
  }

  // =========================
  // RENDER ENGAGEMENT SECTION
  // =========================
  function renderEngagementSection() {
    // Filter students
    var filtered = studentsData;
    if (currentCourseFilter !== "all") {
      filtered = studentsData.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filtered = filtered.filter(function(s) {
        return !isCourseExcludedByDateFilters(s.courseId);
      });
    }

    // Low Content Interaction - Students who haven't opened current week's module
    // For now, using students with no recent access (7+ days) as proxy
    // Deduplicate by student + course
    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    var lowContentSet = new Set();
    var lowContentInteraction = [];
    
    for (var i = 0; i < filtered.length; i++) {
      var s = filtered[i];
      var key = s.userId + "_" + s.courseId;
      if (!lowContentSet.has(key)) {
        lowContentSet.add(key);
        if (!s.lastAccess) {
          lowContentInteraction.push(s);
        } else {
          var lastAccessDate = new Date(s.lastAccess);
          if (lastAccessDate < weekAgo) {
            lowContentInteraction.push(s);
          }
        }
      }
    }

    var lowContentCount = document.getElementById("low-content-count");
    var lowContentList = document.getElementById("low-content-list");
    if (lowContentCount) lowContentCount.textContent = lowContentInteraction.length;
    if (lowContentList) {
      lowContentList.innerHTML = "";
      if (lowContentInteraction.length === 0) {
        lowContentList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>All students have accessed content recently.</div>";
      } else {
        var sssUrl = "https://intranet.example.edu/student-support-system/faculty.html";
        for (var i = 0; i < lowContentInteraction.length; i++) {
          var s = lowContentInteraction[i];
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          item.innerHTML = "<div style='font-weight: 600;'>" + (s.firstName + " " + s.lastName) +
                           " <a href='" + sssUrl + "' target='_blank' style='font-size: 11px; font-weight: normal; color: #0f5b46; text-decoration: none; margin-left: 6px;'>SSS Referral</a></div>" +
                           "<div style='font-size: 12px; color: #666;'>Last access: " + formatDate(s.lastAccess) + " | " + s.courseName + "</div>";
          lowContentList.appendChild(item);
        }
        prependScrollHint(lowContentList, lowContentInteraction.length);
      }
    }
    if (lowContentList) lowContentList.classList.add("list-box-scrollable");

    // Average Days Since Last Access - Trend comparison
    // Data source: D2L Classlist API (getClasslist) returns LastAccessed per student.
    // Metric: average "days since last access" (lower = more recent activity). This week vs last week.
    var thisWeekAvg = 0;
    var lastWeekAvg = 0;
    var thisWeekCount = 0;
    var lastWeekCount = 0;
    var twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    for (var j = 0; j < filtered.length; j++) {
      var student = filtered[j];
      if (student.lastAccess) {
        var lastAccessDate = new Date(student.lastAccess);
        var daysSince = daysAgo(student.lastAccess);
        if (daysSince !== null) {
          if (lastAccessDate >= weekAgo) {
            thisWeekAvg += daysSince;
            thisWeekCount++;
          } else if (lastAccessDate >= twoWeeksAgo) {
            lastWeekAvg += daysSince;
            lastWeekCount++;
          }
        }
      }
    }

    if (thisWeekCount > 0) thisWeekAvg = thisWeekAvg / thisWeekCount;
    if (lastWeekCount > 0) lastWeekAvg = lastWeekAvg / lastWeekCount;

    var avgTimeCurrent = document.getElementById("avg-time-current");
    var timeTrendIndicator = document.getElementById("time-trend-indicator");
    if (avgTimeCurrent) avgTimeCurrent.textContent = thisWeekAvg.toFixed(1) + " days";
    if (timeTrendIndicator) {
      var diff = thisWeekAvg - lastWeekAvg;
      if (diff > 0) {
        timeTrendIndicator.textContent = "↑ " + diff.toFixed(1) + " days increase (engagement dipping)";
        timeTrendIndicator.style.color = "#dc2626";
      } else if (diff < 0) {
        timeTrendIndicator.textContent = "↓ " + Math.abs(diff).toFixed(1) + " days decrease (engagement improving)";
        timeTrendIndicator.style.color = "#0f5b46";
      } else {
        timeTrendIndicator.textContent = "No change";
        timeTrendIndicator.style.color = "#666";
      }
    }

    // Trend line chart: average days since last access "as of" each of the last 14 days (same data source)
    var timeTrendChartEl = document.getElementById("time-trend-chart");
    if (timeTrendChartEl) {
      var trendPoints = [];
      var numDays = 14;
      var hasAnyData = false;
      for (var d = 0; d < numDays; d++) {
        var asOfDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (numDays - 1 - d), 23, 59, 59, 999);
        var sum = 0;
        var count = 0;
        for (var si = 0; si < filtered.length; si++) {
          var st = filtered[si];
          if (!st.lastAccess) continue;
          var lastAccessDate = new Date(st.lastAccess);
          if (lastAccessDate.getTime() > asOfDate.getTime()) continue;
          var daysSinceAsOf = (asOfDate.getTime() - lastAccessDate.getTime()) / (24 * 60 * 60 * 1000);
          sum += daysSinceAsOf;
          count++;
        }
        if (count > 0) hasAnyData = true;
        var avg = count > 0 ? sum / count : 0;
        trendPoints.push({ dayIndex: d, label: d === 0 ? "14d ago" : (d === numDays - 1 ? "Today" : ""), value: avg });
      }
      if (!hasAnyData || filtered.length === 0) {
        timeTrendChartEl.innerHTML = "<div style='color: #94a3b8; font-size: 13px; text-align: center;'>No access data yet. Load analytics to see trend.</div>";
        timeTrendChartEl.style.display = "flex";
      } else {
        var maxVal = 0;
        for (var ti = 0; ti < trendPoints.length; ti++) {
          if (trendPoints[ti].value > maxVal) maxVal = trendPoints[ti].value;
        }
        if (maxVal === 0) maxVal = 1;
        var chartW = 280;
        var chartH = 120;
        var pad = { left: 32, right: 8, top: 8, bottom: 24 };
        var plotW = chartW - pad.left - pad.right;
        var plotH = chartH - pad.top - pad.bottom;
        var pathD = [];
        for (var pi = 0; pi < trendPoints.length; pi++) {
          var x = pad.left + (trendPoints[pi].dayIndex / (numDays - 1)) * plotW;
          var y = pad.top + plotH - (trendPoints[pi].value / maxVal) * plotH;
          pathD.push((pi === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1));
        }
        var pathStr = pathD.join(" ");
        var svg = "<svg width=\"100%\" height=\"150\" viewBox=\"0 0 " + chartW + " " + chartH + "\" preserveAspectRatio=\"xMidYMid meet\" style=\"overflow: visible;\">" +
          "<line x1=\"" + pad.left + "\" y1=\"" + (pad.top + plotH) + "\" x2=\"" + (pad.left + plotW) + "\" y2=\"" + (pad.top + plotH) + "\" stroke=\"#e5e7eb\" stroke-width=\"1\"/>" +
          "<path d=\"" + pathStr + "\" fill=\"none\" stroke=\"#0f5b46\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" +
          "<text x=\"" + (pad.left - 4) + "\" y=\"" + (pad.top + 4) + "\" font-size=\"9\" fill=\"#64748b\">" + maxVal.toFixed(0) + "d</text>" +
          "<text x=\"" + pad.left + "\" y=\"" + (chartH - 4) + "\" font-size=\"9\" fill=\"#64748b\">14d ago</text>" +
          "<text x=\"" + (pad.left + plotW - 24) + "\" y=\"" + (chartH - 4) + "\" font-size=\"9\" fill=\"#64748b\">Today</text>" +
          "</svg>";
        timeTrendChartEl.innerHTML = svg;
        timeTrendChartEl.style.display = "block";
      }
    }

    // Unopened Feedback - Show students with loaded unopened items, or fallback: have grade and haven't accessed recently
    var unopenedFeedbackSet = new Set();
    var unopenedFeedback = [];
    for (var k = 0; k < filtered.length; k++) {
      var s2 = filtered[k];
      var key = s2.userId + "_" + s2.courseId;
      if (unopenedFeedbackSet.has(key)) continue;
      if (s2.unopenedFeedbackItems && s2.unopenedFeedbackItems.length > 0) {
        unopenedFeedbackSet.add(key);
        unopenedFeedback.push(s2);
      } else if (s2.currentGrade !== null && (!s2.lastAccess || daysAgo(s2.lastAccess) > 3)) {
        // Fallback: student has a grade and hasn't accessed in 3+ days (or never) - likely has unviewed feedback
        unopenedFeedbackSet.add(key);
        unopenedFeedback.push(s2);
      }
    }

    var unopenedFeedbackCount = document.getElementById("unopened-feedback-count");
    var unopenedFeedbackList = document.getElementById("unopened-feedback-list");
    if (unopenedFeedbackCount) unopenedFeedbackCount.textContent = unopenedFeedback.length;
    if (unopenedFeedbackList) {
      unopenedFeedbackList.innerHTML = "";
      if (isUnopenedFeedbackLoading && unopenedFeedback.length === 0) {
        unopenedFeedbackList.innerHTML = "<div style='padding: 12px; color: #666; font-size: 13px; text-align: center;'><span style='display: inline-block; width: 16px; height: 16px; border: 2px solid #0f5b46; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;'></span> Loading which items have unread feedback…</div>";
      } else if (unopenedFeedback.length === 0) {
        unopenedFeedbackList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>All students have viewed feedback.</div>";
      } else {
        for (var l = 0; l < unopenedFeedback.length; l++) {
          var s3 = unopenedFeedback[l];
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          var feedbackText = "";
          if (s3.unopenedFeedbackItems && s3.unopenedFeedbackItems.length > 0) {
            var itemsList = [];
            for (var m = 0; m < Math.min(3, s3.unopenedFeedbackItems.length); m++) {
              var feedbackItem = s3.unopenedFeedbackItems[m];
              itemsList.push(feedbackItem.type + ": " + feedbackItem.name);
            }
            if (s3.unopenedFeedbackItems.length > 3) {
              itemsList.push("+" + (s3.unopenedFeedbackItems.length - 3) + " more");
            }
            feedbackText = itemsList.join(", ");
          } else {
            feedbackText = "Graded items (check gradebook)";
          }
          item.innerHTML = "<div style='font-weight: 600;'>" + (s3.firstName + " " + s3.lastName) + "</div>" +
                           "<div style='font-size: 12px; color: #666;'>" + feedbackText + "</div>" +
                           "<div style='font-size: 11px; color: #999; margin-top: 2px;'>Grade: " + (s3.currentGrade !== null ? s3.currentGrade.toFixed(1) + "%" : "N/A") + " | " + s3.courseName + "</div>";
          unopenedFeedbackList.appendChild(item);
        }
        prependScrollHint(unopenedFeedbackList, unopenedFeedback.length);
      }
    }
    if (unopenedFeedbackList) unopenedFeedbackList.classList.add("list-box-scrollable");

    // Login Inactivity - Students who haven't logged in for various periods
    // Use a Set to track which students we've already categorized to avoid duplicates
    var neverLogged = [];
    var inactive3d = [];
    var inactive7d = [];
    var inactive14d = [];
    var processedStudents = new Set();

    for (var l = 0; l < filtered.length; l++) {
      var student = filtered[l];
      var studentKey = student.userId + "_" + student.courseId;
      
      // Skip if already processed
      if (processedStudents.has(studentKey)) continue;
      processedStudents.add(studentKey);
      
      var daysSince = daysAgo(student.lastAccess);
      
      // Categorize into most severe category only
      if (!student.lastAccess || daysSince === null) {
        neverLogged.push(student);
      } else if (daysSince >= 14) {
        inactive14d.push(student);
      } else if (daysSince >= 7) {
        inactive7d.push(student);
      } else if (daysSince >= 3) {
        inactive3d.push(student);
      }
    }

    // Update counts
    var neverLoggedCount = document.getElementById("never-logged-count");
    var inactive3dCount = document.getElementById("inactive-3d-count");
    var inactive7dCount = document.getElementById("inactive-7d-count");
    var inactive14dCount = document.getElementById("inactive-14d-count");
    
    if (neverLoggedCount) neverLoggedCount.textContent = neverLogged.length;
    if (inactive3dCount) inactive3dCount.textContent = inactive3d.length;
    if (inactive7dCount) inactive7dCount.textContent = inactive7d.length;
    if (inactive14dCount) inactive14dCount.textContent = inactive14d.length;

    // Render list - show all categories
    var loginInactivityList = document.getElementById("login-inactivity-list");
    if (loginInactivityList) {
      loginInactivityList.innerHTML = "";
      
      var allInactive = [];
      
      // Add never logged (highest priority)
      for (var m = 0; m < neverLogged.length; m++) {
        allInactive.push({ student: neverLogged[m], category: "Never logged in", priority: 4 });
      }
      
      // Add 14+ days
      for (var n = 0; n < inactive14d.length; n++) {
        allInactive.push({ student: inactive14d[n], category: "14+ days", priority: 3 });
      }
      
      // Add 7+ days
      for (var o = 0; o < inactive7d.length; o++) {
        allInactive.push({ student: inactive7d[o], category: "7+ days", priority: 2 });
      }
      
      // Add 3+ days
      for (var p = 0; p < inactive3d.length; p++) {
        allInactive.push({ student: inactive3d[p], category: "3+ days", priority: 1 });
      }
      
      // Sort by priority (highest first)
      allInactive.sort(function(a, b) { return b.priority - a.priority; });
      
      if (allInactive.length === 0) {
        loginInactivityList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>All students have logged in recently.</div>";
      } else {
        var sssUrl = "https://intranet.example.edu/student-support-system/faculty.html";
        for (var q = 0; q < allInactive.length; q++) {
          var inactiveItem = allInactive[q];
          var s3 = inactiveItem.student;
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          
          var categoryColor = "#666";
          if (inactiveItem.category === "Never logged in" || inactiveItem.category === "14+ days") {
            categoryColor = "#dc2626";
          } else if (inactiveItem.category === "7+ days" || inactiveItem.category === "3+ days") {
            categoryColor = "#f59e0b";
          }
          
          item.innerHTML = "<div style='font-weight: 600;'>" + (s3.firstName + " " + s3.lastName) +
                           " <a href='" + sssUrl + "' target='_blank' style='font-size: 11px; font-weight: normal; color: #0f5b46; text-decoration: none; margin-left: 6px;'>SSS Referral</a>" +
                           " <span style='font-size: 11px; font-weight: normal; color: " + categoryColor + ";'>(" + inactiveItem.category + ")</span></div>" +
                           "<div style='font-size: 12px; color: #666;'>Last access: " + formatDate(s3.lastAccess) + " | " + s3.courseName + "</div>";
          loginInactivityList.appendChild(item);
        }
        prependScrollHint(loginInactivityList, allInactive.length);
      }
    }
    if (loginInactivityList) loginInactivityList.classList.add("list-box-scrollable");
  }

  // =========================
  // RENDER ASSESSMENT SECTION
  // =========================
  function renderAssessmentSection() {
    // Filter students
    var filtered = studentsData;
    if (currentCourseFilter !== "all") {
      filtered = studentsData.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filtered = filtered.filter(function(s) {
        return !isCourseExcludedByDateFilters(s.courseId);
      });
    }

    // High Quiz Attempt Time - Students taking 2x average time
    var highQuizTimeSet = new Set();
    var highQuizTime = [];
    for (var i = 0; i < filtered.length; i++) {
      var s = filtered[i];
      var key = s.userId + "_" + s.courseId;
      if (!highQuizTimeSet.has(key) && s.quizAttemptTimes && s.quizAttemptTimes.length > 0) {
        highQuizTimeSet.add(key);
        highQuizTime.push(s);
      }
    }
    
    var highQuizTimeCount = document.getElementById("high-quiz-time-count");
    var highQuizTimeList = document.getElementById("high-quiz-time-list");
    if (highQuizTimeCount) highQuizTimeCount.textContent = highQuizTime.length;
    if (highQuizTimeList) {
      highQuizTimeList.innerHTML = "";
      if (highQuizTime.length === 0) {
        highQuizTimeList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>No students found taking 2x average time on quizzes.</div>";
      } else {
        for (var j = 0; j < highQuizTime.length; j++) {
          var s2 = highQuizTime[j];
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          
          var quizParts = [];
          for (var k = 0; k < s2.quizAttemptTimes.length; k++) {
            var attempt = s2.quizAttemptTimes[k];
            var statsUrl = "/d2l/lms/quizzing/admin/stats/stats_user.d2l?qi=" + (attempt.quizId || "") + "&ou=" + (s2.courseId || "");
            var link = "<a href='" + statsUrl + "' target='_blank' style='color: #0f5b46; text-decoration: none;'>" + (attempt.quizName || "Quiz") + "</a> (" + Math.round(attempt.attemptTime) + " min)";
            quizParts.push(link);
          }
          
          item.innerHTML = "<div style='font-weight: 600;'>" + (s2.firstName + " " + s2.lastName) + "</div>" +
                           "<div style='font-size: 12px; color: #666;'>" + quizParts.join(", ") + "</div>" +
                           "<div style='font-size: 11px; color: #999; margin-top: 2px;'>" + s2.courseName + "</div>";
          highQuizTimeList.appendChild(item);
        }
        prependScrollHint(highQuizTimeList, highQuizTime.length);
      }
    }
    if (highQuizTimeList) highQuizTimeList.classList.add("list-box-scrollable");

    var effectiveOu = currentCourseFilter !== "all" ? currentCourseFilter : (coursesList.length > 0 && coursesList[0].OrgUnit ? String(coursesList[0].OrgUnit.Id) : "");
    var viewAllQuizStatsEl = document.getElementById("high-quiz-view-all-stats-btn");
    if (viewAllQuizStatsEl) {
      viewAllQuizStatsEl.href = "/d2l/lms/quizzing/admin/stats/stats_course.d2l?ou=" + (effectiveOu || "");
    }

    // Discussion Lurkers - Students who posted but haven't replied to others
    // Alternative: If IsRead is available, use "read 10+ posts but haven't contributed"
    var discussionLurkersSet = new Set();
    var discussionLurkers = [];
    for (var l = 0; l < filtered.length; l++) {
      var s3 = filtered[l];
      var key2 = s3.userId + "_" + s3.courseId;
      if (!discussionLurkersSet.has(key2)) {
        discussionLurkersSet.add(key2);
        
        // Check if student has posted but not replied to others
        // OR if they've read 10+ posts (if IsRead data is available) but haven't posted
        var isLurker = false;
        if (s3.discussionPosts > 0 && s3.discussionReplies === 0) {
          // Posted but never replied to others
          isLurker = true;
        } else if (s3.discussionReadCount !== undefined && s3.discussionReadCount >= 10 && s3.discussionPosts === 0) {
          // Read 10+ posts but haven't contributed
          isLurker = true;
        }
        
        if (isLurker) {
          discussionLurkers.push(s3);
        }
      }
    }
    
    var discussionLurkersCount = document.getElementById("discussion-lurkers-count");
    var discussionLurkersList = document.getElementById("discussion-lurkers-list");
    if (discussionLurkersCount) discussionLurkersCount.textContent = discussionLurkers.length;
    if (discussionLurkersList) {
      discussionLurkersList.innerHTML = "";
      if (discussionLurkers.length === 0) {
        discussionLurkersList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>No discussion lurkers found.</div>";
      } else {
        for (var m = 0; m < discussionLurkers.length; m++) {
          var s4 = discussionLurkers[m];
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          
          var lurkerReason = "";
          if (s4.discussionPosts > 0 && s4.discussionReplies === 0) {
            lurkerReason = "Posted " + s4.discussionPosts + " time(s) but never replied to others";
          } else if (s4.discussionReadCount !== undefined && s4.discussionReadCount >= 10 && s4.discussionPosts === 0) {
            lurkerReason = "Read " + s4.discussionReadCount + "+ posts but hasn't contributed";
          }
          
          item.innerHTML = "<div style='font-weight: 600;'>" + (s4.firstName + " " + s4.lastName) + "</div>" +
                           "<div style='font-size: 12px; color: #666;'>" + lurkerReason + "</div>" +
                           "<div style='font-size: 11px; color: #999; margin-top: 2px;'>" + s4.courseName + "</div>";
          discussionLurkersList.appendChild(item);
        }
        prependScrollHint(discussionLurkersList, discussionLurkers.length);
      }
    }
    if (discussionLurkersList) discussionLurkersList.classList.add("list-box-scrollable");

    var discussionViewAllEl = document.getElementById("discussion-view-all-btn");
    var discussionViewAllStatsEl = document.getElementById("discussion-view-all-stats-btn");
    if (discussionViewAllEl) {
      discussionViewAllEl.href = "/d2l/le/" + (effectiveOu || "") + "/discussions/List";
    }
    if (discussionViewAllStatsEl) {
      discussionViewAllStatsEl.href = "/d2l/lms/discussions/stats/statistics_users.d2l?ou=" + (effectiveOu || "");
    }

    // Grade Volatility - Latest grade 15%+ lower than previous average
    // Calculate based on grade history if available, otherwise use current vs threshold
    var gradeVolatility = filtered.filter(function(s) {
      if (s.currentGrade === null) return false;
      // If we had grade history, we'd compare latest vs average
      // For now, flag students whose grade dropped significantly below threshold
      return s.currentGrade < (currentThreshold - 15);
    });

    var gradeVolatilityCount = document.getElementById("grade-volatility-count");
    var gradeVolatilityList = document.getElementById("grade-volatility-list");
    if (gradeVolatilityCount) gradeVolatilityCount.textContent = gradeVolatility.length;
    if (gradeVolatilityList) {
      gradeVolatilityList.innerHTML = "";
      if (gradeVolatility.length === 0) {
        gradeVolatilityList.innerHTML = "<div style='padding: 8px; color: #999; font-size: 13px;'>No students with significant grade drops detected.</div>";
      } else {
        var sssUrlVol = "https://intranet.example.edu/student-support-system/faculty.html";
        for (var i = 0; i < gradeVolatility.length; i++) {
          var s = gradeVolatility[i];
          var item = document.createElement("div");
          item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
          item.innerHTML = "<div style='font-weight: 600;'>" + (s.firstName + " " + s.lastName) +
                           " <a href='" + sssUrlVol + "' target='_blank' style='font-size: 11px; font-weight: normal; color: #0f5b46; text-decoration: none; margin-left: 6px;'>SSS Referral</a></div>" +
                           "<div style='font-size: 12px; color: #666;'>Current: " + (s.currentGrade !== null ? s.currentGrade.toFixed(1) + "%" : "N/A") + " | " + s.courseName + "</div>";
          gradeVolatilityList.appendChild(item);
        }
        prependScrollHint(gradeVolatilityList, gradeVolatility.length);
      }
    }
    if (gradeVolatilityList) gradeVolatilityList.classList.add("list-box-scrollable");
  }

  // =========================
  // LOAD COURSE FRICTION DATA (Challenging Quizzes + Submission Bottleneck) — callable from Phase 4 or Refresh button
  // =========================
  async function loadCourseFrictionData(coursesToProcess) {
    if (!coursesToProcess || coursesToProcess.length === 0) {
      renderCourseFrictionSection();
      return;
    }
    showSectionLoading("challenging-question-list", "Loading challenging quizzes…");
    showSectionLoading("submission-bottleneck-list", "Loading submission bottlenecks…");
    challengingQuizzesData = [];
    submissionBottlenecksData = [];
    upcomingDeadlinesData = [];
    var coursesByOrgUnit = new Map();
    for (var c = 0; c < coursesToProcess.length; c++) {
      var course = coursesToProcess[c];
      var orgUnitId = String(course.OrgUnit.Id);
      if (!coursesByOrgUnit.has(orgUnitId)) {
        coursesByOrgUnit.set(orgUnitId, course);
      }
    }
    var frictionConcurrency = 3;
    var frictionPromises = [];
    for (var [orgUnitId, course] of coursesByOrgUnit) {
      if (frictionPromises.length >= frictionConcurrency) {
        await Promise.race(frictionPromises);
        frictionPromises = frictionPromises.filter(function(p) {
          return p.status !== "fulfilled" && p.status !== "rejected";
        });
      }
      var cached = analyticsCache[orgUnitId];
      var studentCount = cached && cached.students ? cached.students.length : null;
      var promise = Promise.all([
        loadChallengingQuizzes(orgUnitId, course),
        loadSubmissionBottlenecks(orgUnitId, course, studentCount),
        loadUpcomingDeadlines(orgUnitId, course)
      ]).then(function() {
        return { status: "fulfilled" };
      }).catch(function(e) {
        logDiagnostic("ERROR", "Error loading course friction for " + orgUnitId + ": " + (e && e.message));
        return { status: "rejected" };
      });
      frictionPromises.push(promise);
    }
    await Promise.all(frictionPromises);
  }

  function runRefreshCourseFriction(coursesToProcess, btn) {
    if (!coursesToProcess || coursesToProcess.length === 0) {
      renderCourseFrictionSection();
      return;
    }
    var originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "<i class=\"fas fa-spinner fa-spin\" aria-hidden=\"true\"></i> Loading…";
    var timeoutMs = 90000;
    var timeoutId = setTimeout(function() {
      renderCourseFrictionSection();
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }, timeoutMs);
    loadCourseFrictionData(coursesToProcess).then(function() {
      clearTimeout(timeoutId);
      renderCourseFrictionSection();
      renderTrendsSection();
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }).catch(function(e) {
      clearTimeout(timeoutId);
      logDiagnostic("ERROR", "Refresh course friction failed: " + (e && e.message));
      renderCourseFrictionSection();
      renderTrendsSection();
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    });
  }

  // =========================
  // LOAD CHALLENGING QUESTIONS (10%, 20%, 30%+, higher 70%+ got wrong) — load once, data stays
  // =========================
  async function loadChallengingQuizzes(orgUnitId, course) {
    try {
      var courseName = course.OrgUnit.Name || "Unknown Course";
      var courseCode = course.OrgUnit.Code || "";
      
      // Get all quizzes for the course
      var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
      var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
      
      var quizList = (quizData && quizData.Objects) ? quizData.Objects : (quizData && quizData.Items) ? quizData.Items : [];
      if (!quizList.length) {
        return;
      }
      
      for (var i = 0; i < quizList.length; i++) {
        var quiz = quizList[i];
        var quizId = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
        var quizName = quiz.Name || "Untitled Quiz";
        
        try {
          // Get all quiz attempts
          var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/attempts/";
          var attemptsData = await BrightspaceFetch(attemptsEndpoint).catch(function() { return null; });
          
          var attemptsList = (attemptsData && attemptsData.Objects) ? attemptsData.Objects : (attemptsData && attemptsData.Items) ? attemptsData.Items : [];
          if (!attemptsList.length) {
            continue;
          }
          
          // Get quiz details to find total possible points
          var quizDetailsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId;
          var quizDetails = await BrightspaceFetch(quizDetailsEndpoint).catch(function() { return null; });
          
          var totalPossiblePoints = 0;
          if (quizDetails && (quizDetails.MaxPoints != null || quizDetails.TotalPoints != null)) {
            totalPossiblePoints = quizDetails.MaxPoints != null ? quizDetails.MaxPoints : quizDetails.TotalPoints || 0;
          }
          
          // If we can't get total points from quiz details, try calculating from questions
          if (totalPossiblePoints === 0) {
            var questionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/questions/";
            var questionsData = await BrightspaceFetch(questionsEndpoint).catch(function() { return null; });
            var questionsList = (questionsData && questionsData.Objects) ? questionsData.Objects : (questionsData && questionsData.Items) ? questionsData.Items : [];
            for (var q = 0; q < questionsList.length; q++) {
              totalPossiblePoints += (questionsList[q].Points || 0);
            }
          }
          
          if (totalPossiblePoints === 0) continue;
          
          // Completed attempts: include any with Completed set
          var completedAttempts = [];
          var scoreSum = 0;
          var scoreCount = 0;
          
          for (var k = 0; k < attemptsList.length; k++) {
            var attempt = attemptsList[k];
            if (attempt.Completed) {
              completedAttempts.push(attempt);
              var attemptScore = (attempt.Score !== null && attempt.Score !== undefined) ? attempt.Score : 0;
              scoreSum += attemptScore;
              scoreCount++;
            }
          }
          
          if (completedAttempts.length < 3) continue; // Need at least 3 attempts
          
          // Calculate average score percentage
          var averageScore = scoreCount > 0 ? (scoreSum / scoreCount / totalPossiblePoints) * 100 : 0;
          
          // Categorize by average score
          var category = "70+";
          if (averageScore < 30) {
            category = "below30";
          } else if (averageScore < 50) {
            category = "30-49";
          } else if (averageScore < 70) {
            category = "50-69";
          }
          
          challengingQuizzesData.push({
            quizName: quizName,
            averageScore: averageScore.toFixed(1),
            quizId: quizId,
            courseId: orgUnitId,
            courseName: courseName,
            courseCode: courseCode,
            totalAttempts: completedAttempts.length,
            category: category
          });
        } catch (e) {
          // Continue to next quiz
          logDiagnostic("ERROR", "Error processing quiz " + quizId + ": " + e.message);
        }
      }
    } catch (e) {
      logDiagnostic("ERROR", "Error loading challenging quizzes: " + e.message);
    }
  }

  // =========================
  // LOAD SUBMISSION BOTTLENECKS (20%+ haven't submitted 24h before deadline)
  // optionalStudentCount: if provided (from analytics cache), skip classlist fetch
  // =========================
  async function loadSubmissionBottlenecks(orgUnitId, course, optionalStudentCount) {
    try {
      var courseName = course.OrgUnit.Name || "Unknown Course";
      var courseCode = course.OrgUnit.Code || "";
      
      // Get all dropbox folders for the course
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var dropboxFolders = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
      
      if (!dropboxFolders || dropboxFolders.length === 0) {
        return;
      }
      
      var totalStudents = 0;
      if (optionalStudentCount !== null && optionalStudentCount !== undefined && optionalStudentCount >= 0) {
        totalStudents = optionalStudentCount;
      } else {
        var classlist = await getClasslist(orgUnitId);
        for (var i = 0; i < classlist.length; i++) {
          var student = classlist[i];
          if (isDemoStudent({ firstName: student.FirstName, lastName: student.LastName })) continue;
          var roleName = (student.ClasslistRoleDisplayName || "").toLowerCase();
          var isStudent = roleName.indexOf("student") >= 0 || 
                         student.RoleId === 3 || 
                         student.RoleId === 5 || 
                         student.RoleId === 101;
          if (isStudent) totalStudents++;
        }
      }
      
      if (totalStudents === 0) return;
      
      var now = new Date();
      var oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      // Check each dropbox folder
      for (var j = 0; j < dropboxFolders.length; j++) {
        var folder = dropboxFolders[j];
        
        // Only check folders with due dates
        if (!folder.DueDate) continue;
        
        var dueDate = new Date(folder.DueDate);
        
        // Only check if due date is within 24 hours
        if (dueDate > now && dueDate <= oneDayFromNow) {
          try {
            // Get submissions for this folder
            var submissionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folder.Id + "/submissions/?activeOnly=true";
            var submissions = await BrightspaceFetch(submissionsEndpoint).catch(function() { return null; });
            
            if (submissions && submissions.length) {
              // Count how many students have submitted (Status = 1, 2, or 3)
              var submittedCount = 0;
              for (var k = 0; k < submissions.length; k++) {
                var submission = submissions[k];
                if (submission.Status === 1 || submission.Status === 2 || submission.Status === 3) {
                  submittedCount++;
                }
              }
              
              var missingCount = totalStudents - submittedCount;
              var missingPercentage = (missingCount / totalStudents) * 100;
              
              // If 20%+ haven't submitted
              if (missingPercentage >= 20) {
                submissionBottlenecksData.push({
                  assignmentName: folder.Name || "Untitled Assignment",
                  folderId: folder.Id,
                  dueDate: folder.DueDate,
                  totalStudents: totalStudents,
                  submittedCount: submittedCount,
                  missingCount: missingCount,
                  missingPercentage: missingPercentage.toFixed(1),
                  courseId: orgUnitId,
                  courseName: courseName,
                  courseCode: courseCode
                });
              }
            } else {
              // No submissions at all - 100% missing
              if (totalStudents > 0) {
                submissionBottlenecksData.push({
                  assignmentName: folder.Name || "Untitled Assignment",
                  folderId: folder.Id,
                  dueDate: folder.DueDate,
                  totalStudents: totalStudents,
                  submittedCount: 0,
                  missingCount: totalStudents,
                  missingPercentage: "100.0",
                  courseId: orgUnitId,
                  courseName: courseName,
                  courseCode: courseCode
                });
              }
            }
          } catch (e) {
            // Continue to next folder
            logDiagnostic("ERROR", "Error processing dropbox folder " + folder.Id + ": " + e.message);
          }
        }
      }
    } catch (e) {
      logDiagnostic("ERROR", "Error loading submission bottlenecks: " + e.message);
    }
  }

  // =========================
  // LOAD UPCOMING DEADLINES (assignments + quizzes with future due/end dates)
  // =========================
  async function loadUpcomingDeadlines(orgUnitId, course) {
    try {
      var courseName = course.OrgUnit.Name || "Unknown Course";
      var now = new Date();

      // Assignments: dropbox folders with DueDate in the future
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var foldersData = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
      var dropboxFolders = Array.isArray(foldersData) ? foldersData : (foldersData && foldersData.Objects) ? foldersData.Objects : [];
      if (dropboxFolders.length) {
        for (var f = 0; f < dropboxFolders.length; f++) {
          var folder = dropboxFolders[f];
          if (!folder.DueDate) continue;
          var dueDate = new Date(folder.DueDate);
          if (dueDate > now) {
            upcomingDeadlinesData.push({
              type: "Assignment",
              name: folder.Name || "Untitled Assignment",
              dueDate: folder.DueDate,
              courseId: orgUnitId,
              courseName: courseName,
              folderId: folder.Id
            });
          }
        }
      }

      // Quizzes: DueDate or EndDate in the future
      var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
      var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
      var quizList = (quizData && quizData.Objects) ? quizData.Objects : (quizData && quizData.Items) ? quizData.Items : [];
      for (var q = 0; q < quizList.length; q++) {
        var quiz = quizList[q];
        var quizId = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
        var dueOrEnd = quiz.DueDate || quiz.EndDate;
        if (!dueOrEnd) continue;
        var qDate = new Date(dueOrEnd);
        if (qDate > now) {
          upcomingDeadlinesData.push({
            type: "Quiz",
            name: quiz.Name || "Untitled Quiz",
            dueDate: dueOrEnd,
            courseId: orgUnitId,
            courseName: courseName,
            quizId: quizId
          });
        }
      }
    } catch (e) {
      logDiagnostic("ERROR", "Error loading upcoming deadlines: " + e.message);
    }
  }

  // =========================
  // RENDER COURSE FRICTION SECTION
  // =========================
  function renderCourseFrictionSection() {
    // Filter data based on current course filter
    var filteredChallengingQuizzes = challengingQuizzesData;
    var filteredBottlenecks = submissionBottlenecksData;
    
    if (currentCourseFilter !== "all") {
      filteredChallengingQuizzes = challengingQuizzesData.filter(function(q) {
        return String(q.courseId) === String(currentCourseFilter);
      });
      filteredBottlenecks = submissionBottlenecksData.filter(function(b) {
        return String(b.courseId) === String(currentCourseFilter);
      });
    }
    
    if (hideNotStartedCourses || hideEndedCourses) {
      filteredChallengingQuizzes = filteredChallengingQuizzes.filter(function(q) {
        return !isCourseExcludedByDateFilters(q.courseId);
      });
      filteredBottlenecks = filteredBottlenecks.filter(function(b) {
        return !isCourseExcludedByDateFilters(b.courseId);
      });
    }
    
    // Filter by current threshold (70, 50, 30, or 0 for average score)
    var thresholdFiltered = filteredChallengingQuizzes.filter(function(q) {
      var avgScore = parseFloat(q.averageScore);
      if (currentChallengingThreshold === 70) {
        return avgScore < 70;
      } else if (currentChallengingThreshold === 50) {
        return avgScore < 50;
      } else if (currentChallengingThreshold === 30) {
        return avgScore < 30;
      } else {
        return true; // Show all
      }
    });
    
    // Sort challenging quizzes by average score (lowest first - most challenging)
    thresholdFiltered.sort(function(a, b) {
      return parseFloat(a.averageScore) - parseFloat(b.averageScore);
    });
    
    // Sort bottlenecks by missing percentage (highest first)
    filteredBottlenecks.sort(function(a, b) {
      return parseFloat(b.missingPercentage) - parseFloat(a.missingPercentage);
    });
    
    // Challenging Quizzes - Display based on selected threshold
    var challengingQuestionList = document.getElementById("challenging-question-list");
    if (challengingQuestionList) {
      challengingQuestionList.innerHTML = "";
      if (thresholdFiltered.length === 0) {
        var thresholdLabel = currentChallengingThreshold === 70 ? "below 70%" : (currentChallengingThreshold === 50 ? "below 50%" : (currentChallengingThreshold === 30 ? "below 30%" : "all"));
        challengingQuestionList.innerHTML = "<div style='padding: 12px; color: #999; font-size: 13px;'>No quizzes found with average score " + thresholdLabel + ".</div>";
      } else {
        for (var i = 0; i < thresholdFiltered.length; i++) {
          var q = thresholdFiltered[i];
          var item = document.createElement("div");
          item.style.cssText = "padding: 12px; border-bottom: 1px solid #e5e7eb; cursor: pointer;";
          item.onclick = function(quizId, courseId) {
            return function() {
              window.location.href = "quiz-detail.html?quizId=" + quizId + "&courseId=" + courseId;
            };
          }(q.quizId, q.courseId);
          
          var avgScoreNum = parseFloat(q.averageScore);
          var color = "#dc2626"; // Red for below 30%
          if (avgScoreNum >= 30 && avgScoreNum < 50) {
            color = "#f59e0b"; // Orange for 30-49%
          } else if (avgScoreNum >= 50 && avgScoreNum < 70) {
            color = "#3b82f6"; // Blue for 50-69%
          } else if (avgScoreNum >= 70) {
            color = "#059669"; // Green for 70%+
          }
          
          item.innerHTML = "<div style='font-weight: 600; color: " + color + "; margin-bottom: 4px;'>" + q.quizName + "</div>" +
                           "<div style='font-size: 13px; color: #333; margin-bottom: 4px;'>Average Score: " + q.averageScore + "%</div>" +
                           "<div style='font-size: 12px; color: #666;'>" + q.totalAttempts + " attempts | " + q.courseName + "</div>";
          challengingQuestionList.appendChild(item);
        }
        prependScrollHint(challengingQuestionList, thresholdFiltered.length);
      }
    }

    // Submission Bottleneck - Assignments where 20%+ haven't submitted 24h before deadline
    var submissionBottleneckList = document.getElementById("submission-bottleneck-list");
    if (submissionBottleneckList) {
      submissionBottleneckList.innerHTML = "";
      if (filteredBottlenecks.length === 0) {
        submissionBottleneckList.innerHTML = "<div style='padding: 12px; color: #999; font-size: 13px;'>No assignments found with 20%+ missing submissions 24h before deadline.</div>";
      } else {
        // Show all bottlenecks (with scrollbar if needed)
        for (var j = 0; j < filteredBottlenecks.length; j++) {
          var b = filteredBottlenecks[j];
          var item = document.createElement("div");
          item.style.cssText = "padding: 12px; border-bottom: 1px solid #e5e7eb;";
          
          var dueDateStr = formatDate(b.dueDate);
          var hoursUntilDue = Math.floor((new Date(b.dueDate) - new Date()) / (1000 * 60 * 60));
          
          // Create clickable link to assignment submissions
          var submissionUrl = "/d2l/lms/dropbox/admin/mark/folder_submissions_users.d2l?db=" + b.folderId + "&ou=" + b.courseId;
          
          item.innerHTML = "<div style='font-weight: 600; color: #dc2626; margin-bottom: 4px;'><a href='" + submissionUrl + "' target='_blank' style='color: #dc2626; text-decoration: none; cursor: pointer;'>" + b.assignmentName + " <i class='fas fa-external-link-alt' style='font-size: 10px; margin-left: 4px;'></i></a></div>" +
                           "<div style='font-size: 13px; color: #333; margin-bottom: 4px;'>" + b.missingCount + " of " + b.totalStudents + " students haven't submitted (" + b.missingPercentage + "%)</div>" +
                           "<div style='font-size: 12px; color: #666;'>Due: " + dueDateStr + " (" + hoursUntilDue + " hours) | " + b.courseName + "</div>";
          submissionBottleneckList.appendChild(item);
        }
        prependScrollHint(submissionBottleneckList, filteredBottlenecks.length);
      }
    }
  }

  // =========================
  // RENDER TRENDS SECTION
  // =========================
  function renderTrendsSection() {
    // Filter students
    var filtered = studentsData;
    if (currentCourseFilter !== "all") {
      filtered = studentsData.filter(function(s) {
        return String(s.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filtered = filtered.filter(function(s) {
        return !isCourseExcludedByDateFilters(s.courseId);
      });
    }

    renderNonParticipationSection();
    renderExternalGradesSection();

    // Grade Distribution Curve
    var gradeRanges = [
      { label: "90-100", min: 90, max: 100, count: 0 },
      { label: "80-89", min: 80, max: 89, count: 0 },
      { label: "70-79", min: 70, max: 79, count: 0 },
      { label: "60-69", min: 60, max: 69, count: 0 },
      { label: "0-59", min: 0, max: 59, count: 0 }
    ];

    for (var k = 0; k < filtered.length; k++) {
      var grade = filtered[k].currentGrade;
      if (grade !== null) {
        for (var l = 0; l < gradeRanges.length; l++) {
          if (grade >= gradeRanges[l].min && grade <= gradeRanges[l].max) {
            gradeRanges[l].count++;
            break;
          }
        }
      }
    }

    var gradeChart = document.getElementById("grade-distribution-chart");
    var gradeSummary = document.getElementById("grade-distribution-summary");
    var totalWithGrades = gradeRanges.reduce(function(sum, r) { return sum + r.count; }, 0);
    var topRange = gradeRanges.length > 0 ? gradeRanges.reduce(function(a, b) { return a.count >= b.count ? a : b; }, gradeRanges[0]) : null;
    if (gradeSummary) {
      gradeSummary.textContent = totalWithGrades > 0 && topRange
        ? (totalWithGrades + " students · Most in " + topRange.label)
        : "Current grades by range";
    }
    var rangeColors = ["#0f5b46", "#2d8f6f", "#ca8a04", "#ea580c", "#dc2626"]; // green → red for 90-100 down to 0-59
    if (gradeChart) {
      gradeChart.innerHTML = "";
      var maxGradeCount = gradeRanges.length ? Math.max.apply(null, gradeRanges.map(function(r) { return r.count; })) : 0;
      if (maxGradeCount === 0) {
        gradeChart.innerHTML = "<div style='padding: 24px; color: #94a3b8; font-size: 13px; text-align: center; width: 100%;'>No grade data yet. Load analytics to see distribution.</div>";
      } else {
        var gradeChartHtml = "<div style='display: flex; flex-direction: column; gap: 10px; width: 100%;'>";
        for (var m = 0; m < gradeRanges.length; m++) {
          var r = gradeRanges[m];
          var width = maxGradeCount > 0 ? (r.count / maxGradeCount * 100) : 0;
          var barWidth = Math.max(width, 2);
          var pct = totalWithGrades > 0 ? Math.round((r.count / totalWithGrades) * 100) : 0;
          var barColor = rangeColors[m] || "#0f5b46";
          gradeChartHtml += "<div style='display: flex; align-items: center; gap: 10px;'>" +
                            "<div style='width: 52px; font-size: 12px; font-weight: 600; color: #475569;'>" + r.label + "</div>" +
                            "<div style='flex: 1; background: #f1f5f9; height: 24px; border-radius: 6px; overflow: hidden; position: relative;'>" +
                            "<div style='background: " + barColor + "; height: 100%; width: " + barWidth + "%; min-width: " + (r.count > 0 ? "4px" : "0") + "; border-radius: 6px; transition: width 0.4s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.06);'></div>" +
                            "</div>" +
                            "<div style='width: 36px; font-size: 13px; font-weight: 700; color: #0f172a; text-align: right;'>" + r.count + "</div>" +
                            "<div style='width: 32px; font-size: 11px; color: #64748b; text-align: right;'>" + pct + "%</div>" +
                            "</div>";
        }
        gradeChartHtml += "</div>";
        gradeChart.innerHTML = gradeChartHtml;
      }
    }

    // Upcoming Deadlines: filter by course, sort by date, show next 10
    var filteredDeadlines = upcomingDeadlinesData.slice();
    if (currentCourseFilter !== "all") {
      filteredDeadlines = filteredDeadlines.filter(function(d) {
        return String(d.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filteredDeadlines = filteredDeadlines.filter(function(d) {
        return !isCourseExcludedByDateFilters(d.courseId);
      });
    }
    filteredDeadlines.sort(function(a, b) {
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
    var toShow = filteredDeadlines.slice(0, 10);

    var upcomingList = document.getElementById("upcoming-deadlines-list");
    var upcomingSummary = document.getElementById("upcoming-deadlines-summary");
    if (upcomingSummary) {
      upcomingSummary.textContent = toShow.length > 0
        ? "Next " + toShow.length + " deadline" + (toShow.length !== 1 ? "s" : "") + " (selected course)"
        : "Next assignment and quiz due dates for the selected course";
    }
    if (upcomingList) {
      upcomingList.innerHTML = "";
      if (toShow.length === 0) {
        upcomingList.innerHTML = "<div style='padding: 24px; color: #94a3b8; font-size: 13px; text-align: center;'>No upcoming deadlines. Load analytics to see assignments and quizzes.</div>";
      } else {
        for (var d = 0; d < toShow.length; d++) {
          var item = toShow[d];
          var dueDateStr = formatDate(item.dueDate);
          var daysUntil = Math.ceil((new Date(item.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
          var linkUrl, linkLabel;
          if (item.type === "Assignment" && item.folderId != null) {
            linkUrl = "/d2l/lms/dropbox/admin/mark/folder_submissions_users.d2l?db=" + item.folderId + "&ou=" + item.courseId;
            linkLabel = item.name;
          } else if (item.type === "Quiz" && item.quizId != null) {
            linkUrl = "/d2l/lms/quizzing/admin/quiz_edit.d2l?qi=" + item.quizId + "&ou=" + item.courseId;
            linkLabel = item.name;
          } else {
            linkUrl = "#";
            linkLabel = item.name;
          }
          var typeLabel = item.type === "Quiz" ? "Quiz" : "Assignment";
          var div = document.createElement("div");
          div.style.cssText = "padding: 10px 0; border-bottom: 1px solid #e5e7eb;";
          div.innerHTML = "<div style='font-weight: 600; margin-bottom: 4px;'><a href='" + linkUrl + "' target='_blank' rel='noopener' style='color: #0f5b46; text-decoration: none;'>" + escapeHtml(linkLabel) + " <i class='fas fa-external-link-alt' style='font-size: 10px;'></i></a></div>" +
            "<div style='font-size: 12px; color: #64748b;'>" + typeLabel + " · Due " + dueDateStr + (daysUntil >= 0 ? " (" + daysUntil + " day" + (daysUntil !== 1 ? "s" : "") + ")" : "") + (currentCourseFilter === "all" ? " · " + item.courseName : "") + "</div>";
          upcomingList.appendChild(div);
        }
      }
    }
  }

  // =========================
  // RENDER COURSE READINESS BUCKET
  // =========================
  function renderCourseReadinessBucket() {
    // Delegate to course-readiness.js when available so list has click handlers for modal
    if (window.CourseReadiness && typeof window.CourseReadiness.render === "function") {
      window.CourseReadiness.render();
      return;
    }
    var tilesContainer = document.getElementById("course-readiness-tiles");
    var listContainer = document.getElementById("course-readiness-items");
    if (!tilesContainer || !listContainer) return;

    // Use Course Readiness module data when available (loaded by course-readiness.js)
    var dataSource = (window.CourseReadiness && typeof window.CourseReadiness.getData === "function")
      ? window.CourseReadiness.getData() : courseReadinessData;
    // Filter courses
    var filtered = dataSource;
    if (currentCourseFilter !== "all") {
      filtered = dataSource.filter(function(c) {
        return String(c.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filtered = filtered.filter(function(c) {
        return !isCourseExcludedByDateFilters(c.courseId);
      });
    }

    // Calculate counts
    var missingSyllabus = filtered.filter(function(c) { return c.missingSyllabus; });
    var emptyModules = filtered.reduce(function(sum, c) { return sum + c.emptyModules; }, 0);
    var brokenLinks = filtered.reduce(function(sum, c) { return sum + c.brokenLinks; }, 0);
    var noNews = filtered.filter(function(c) { return c.noNews; });
    var noGradebook = filtered.filter(function(c) { return c.noGradebook; });

    // Render tiles
    tilesContainer.innerHTML = "";
    var tiles = [
      { label: "Missing Syllabus", count: missingSyllabus.length },
      { label: "Empty Modules", count: emptyModules },
      { label: "Broken Links", count: brokenLinks },
      { label: "No News", count: noNews.length },
      { label: "No Gradebook", count: noGradebook.length }
    ];

    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var tileEl = document.createElement("div");
      tileEl.style.cssText = "padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;";
      tileEl.innerHTML = "<div style='font-size: 11px; color: #666; margin-bottom: 2px;'>" + tile.label + "</div>" +
                         "<div style='font-size: 20px; font-weight: 700; color: #0f5b46;'>" + tile.count + "</div>";
      tilesContainer.appendChild(tileEl);
    }

    // Render course list (top issues first)
    listContainer.innerHTML = "";
    if (filtered.length === 0) {
      listContainer.innerHTML = "<div style='padding: 12px; color: #999; font-size: 13px;'>No course readiness data available.</div>";
      return;
    }
    var sortedCourses = filtered.slice().sort(function(a, b) {
      var aIssues = (a.missingSyllabus ? 1 : 0) + a.emptyModules + a.brokenLinks + (a.noNews ? 1 : 0) + (a.noGradebook ? 1 : 0);
      var bIssues = (b.missingSyllabus ? 1 : 0) + b.emptyModules + b.brokenLinks + (b.noNews ? 1 : 0) + (b.noGradebook ? 1 : 0);
      return bIssues - aIssues;
    });

    for (var j = 0; j < sortedCourses.length && j < 10; j++) {
      var course = sortedCourses[j];
      var item = document.createElement("div");
      item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
      var issues = [];
      if (course.missingSyllabus) issues.push("Missing syllabus");
      if (course.emptyModules > 0) issues.push(course.emptyModules + " empty modules");
      if (course.brokenLinks > 0) issues.push(course.brokenLinks + " broken links");
      if (course.noNews) issues.push("No news");
      if (course.noGradebook) issues.push("No gradebook");
      item.innerHTML = "<div style='font-weight: 600;'>" + course.courseName + "</div>" +
                       "<div style='font-size: 12px; color: #666;'>" + (issues.length > 0 ? issues.join(", ") : "No issues") + "</div>";
      listContainer.appendChild(item);
    }
  }

  // =========================
  // RENDER GRADING BUCKET
  // =========================
  function renderGradingBucket() {
    var tilesContainer = document.getElementById("grading-tiles");
    var listContainer = document.getElementById("grading-list");
    if (!tilesContainer || !listContainer) return;

    // Filter grading data
    var filteredGrading = gradingData;
    if (currentCourseFilter !== "all") {
      filteredGrading = gradingData.filter(function(g) {
        return String(g.courseId) === String(currentCourseFilter);
      });
    }
    if (hideNotStartedCourses || hideEndedCourses) {
      filteredGrading = filteredGrading.filter(function(g) {
        return !isCourseExcludedByDateFilters(g.courseId);
      });
    }

    // Calculate totals
    var totalGradeItems = filteredGrading.reduce(function(sum, g) {
      return sum + (g.gradeItemsCount || 0);
    }, 0);

    // Render tiles
    tilesContainer.innerHTML = "";
    var tiles = [
      { label: "Oldest Ungraded", count: "See Homepage" },
      { label: "Graded Items", count: totalGradeItems },
      { label: "Stalled Grading", count: "See Homepage" }
    ];

    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var tileEl = document.createElement("div");
      tileEl.style.cssText = "padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;";
      tileEl.innerHTML = "<div style='font-size: 11px; color: #666; margin-bottom: 2px;'>" + tile.label + "</div>" +
                         "<div style='font-size: 20px; font-weight: 700; color: #0f5b46;'>" + tile.count + "</div>";
      tilesContainer.appendChild(tileEl);
    }

    // Render course list with grade items
    listContainer.innerHTML = "";
    if (filteredGrading.length === 0) {
      listContainer.innerHTML = "<div style='padding: 8px; color: #666; font-size: 13px;'>No gradebook data available. See homepage for full grading dashboard.</div>";
    } else {
      for (var j = 0; j < Math.min(filteredGrading.length, 5); j++) {
        var grading = filteredGrading[j];
        var item = document.createElement("div");
        item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
        item.innerHTML = "<div style='font-weight: 600;'>" + grading.courseName + "</div>" +
                         "<div style='font-size: 12px; color: #666;'>" + grading.gradeItemsCount + " grade item(s)</div>";
        listContainer.appendChild(item);
      }
      if (filteredGrading.length > 5) {
        var moreItem = document.createElement("div");
        moreItem.style.cssText = "padding: 8px; color: #666; font-size: 12px; font-style: italic;";
        moreItem.textContent = "... and " + (filteredGrading.length - 5) + " more course(s)";
        listContainer.appendChild(moreItem);
      }
    }
  }

  // =========================
  // RENDER COMMUNICATION/OUTREACH SECTION
  // =========================
  function renderCommunicationSection() {
    syncFilterCheckboxes();
    var section = document.getElementById("communication-section");
    if (!section) return;

    // Section is always visible, just update content
    // Load templates from localStorage
    loadTemplates();
    renderTemplatesList();
    renderOutreachQueue();
    renderLastContactedLog();

    // Populate course dropdown in compose
    var composeCourseSelect = document.getElementById("compose-course-select");
    if (composeCourseSelect && coursesList.length > 0) {
      composeCourseSelect.innerHTML = "<option value=''>[▼]</option>";
      for (var i = 0; i < coursesList.length; i++) {
        var course = coursesList[i];
        var option = document.createElement("option");
        option.value = course.OrgUnit.Id;
        option.textContent = (course.OrgUnit.Name || "Unknown") + (course.OrgUnit.Code ? " (" + course.OrgUnit.Code + ")" : "");
        composeCourseSelect.appendChild(option);
      }
    }
    // Section is always visible
  }

  // =========================
  // TEMPLATE MANAGEMENT (localStorage)
  // =========================
  function loadTemplates() {
    try {
      var stored = localStorage.getItem("analytics_message_templates");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  function saveTemplates(templates) {
    try {
      localStorage.setItem("analytics_message_templates", JSON.stringify(templates));
    } catch (e) {
      logDiagnostic("ERROR", "Failed to save templates: " + e.message);
    }
  }

  function renderTemplatesList() {
    var container = document.getElementById("templates-list");
    if (!container) return;

    var templates = loadTemplates();
    container.innerHTML = "";

    for (var i = 0; i < Math.min(templates.length, 6); i++) {
      var template = templates[i];
      var item = document.createElement("div");
      item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb; cursor: pointer;";
      item.textContent = template.name || "Untitled Template";
      item.onclick = function() {
        var templateName = this.textContent;
        var template = templates.find(function(t) { return t.name === templateName; });
        if (template) {
          var composeTemplate = document.getElementById("compose-template-select");
          if (composeTemplate) composeTemplate.value = template.name;
          var composeSubject = document.getElementById("compose-subject");
          if (composeSubject) composeSubject.value = template.subject || "";
          var composeBody = document.getElementById("compose-body");
          if (composeBody) composeBody.value = template.body || "";
        }
      };
      container.appendChild(item);
    }

    if (templates.length === 0) {
      container.innerHTML = "<div style='padding: 8px; color: #666; font-size: 13px;'>No templates saved. Create one using the compose section.</div>";
    }
  }

  // =========================
  // OUTREACH QUEUE
  // =========================
  function renderOutreachQueue() {
    syncFilterCheckboxes();
    var container = document.getElementById("outreach-queue");
    if (!container) return;

    // Use filtered students (course filter + "Don't show courses that haven't started")
    var base = getFilteredStudents();
    var flagged = base.filter(function(s) {
      return s.riskFlags.length > 0;
    }).slice(0, 8);

    container.innerHTML = "";
    for (var i = 0; i < flagged.length; i++) {
      var student = flagged[i];
      var item = document.createElement("div");
      item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px;";
      
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.style.cursor = "pointer";
      
      var info = document.createElement("div");
      info.style.flex = "1";
      info.innerHTML = "<div style='font-weight: 600;'>" + (student.firstName + " " + student.lastName) + "</div>" +
                       "<div style='font-size: 12px; color: #666;'>" + student.riskFlags.join(", ") + "</div>";
      
      var copyBtn = document.createElement("button");
      copyBtn.textContent = "Quick copy";
      copyBtn.style.cssText = "padding: 4px 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; cursor: pointer;";
      copyBtn.onclick = function() {
        var studentEmail = student.email || "";
        navigator.clipboard.writeText(studentEmail).then(function() {
          alert("Copied: " + studentEmail);
        });
      };

      item.appendChild(checkbox);
      item.appendChild(info);
      item.appendChild(copyBtn);
      container.appendChild(item);
    }

    if (flagged.length === 0) {
      container.innerHTML = "<div style='padding: 8px; color: #666; font-size: 13px;'>No students flagged for outreach.</div>";
    }
  }

  // =========================
  // LAST CONTACTED LOG (localStorage)
  // =========================
  function loadLastContactedLog() {
    try {
      var stored = localStorage.getItem("analytics_last_contacted_log");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLastContactedLog(log) {
    try {
      localStorage.setItem("analytics_last_contacted_log", JSON.stringify(log));
    } catch (e) {
      logDiagnostic("ERROR", "Failed to save contact log: " + e.message);
    }
  }

  function renderLastContactedLog() {
    var tbody = document.getElementById("last-contacted-tbody");
    if (!tbody) return;

    var log = loadLastContactedLog();
    tbody.innerHTML = "";

    // Sort by date (newest first)
    log.sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    for (var i = 0; i < log.length; i++) {
      var entry = log[i];
      var row = document.createElement("tr");
      row.style.borderBottom = "1px solid #e5e7eb";

      var dateCell = document.createElement("td");
      dateCell.style.padding = "8px";
      dateCell.textContent = formatDate(entry.date);

      var studentCell = document.createElement("td");
      studentCell.style.padding = "8px";
      studentCell.textContent = entry.student || "";

      var courseCell = document.createElement("td");
      courseCell.style.padding = "8px";
      courseCell.textContent = entry.course || "";

      var noteCell = document.createElement("td");
      noteCell.style.padding = "8px";
      noteCell.textContent = entry.note || "";

      row.appendChild(dateCell);
      row.appendChild(studentCell);
      row.appendChild(courseCell);
      row.appendChild(noteCell);
      tbody.appendChild(row);
    }

    if (log.length === 0) {
      tbody.innerHTML = "<tr><td colspan='4' style='padding: 16px; text-align: center; color: #666;'>No contact log entries yet.</td></tr>";
    }
  }

  // =========================
  // CSV EXPORT FUNCTIONS
  // =========================
  function exportToCSV(data, filename) {
    if (!data || data.length === 0) {
      alert("No data to export");
      return;
    }

    var headers = Object.keys(data[0]);
    var csv = headers.join(",") + "\n";
    
    for (var i = 0; i < data.length; i++) {
      var row = [];
      for (var j = 0; j < headers.length; j++) {
        var value = data[i][headers[j]];
        if (value === null || value === undefined) value = "";
        value = String(value).replace(/"/g, '""');
        row.push('"' + value + '"');
      }
      csv += row.join(",") + "\n";
    }

    var blob = new Blob([csv], { type: "text/csv" });
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // =========================
  // EVENT LISTENERS
  // =========================
  function setupEventListeners() {
    // Load Analytics button
    var loadBtn = document.getElementById("load-analytics-btn");
    if (loadBtn) {
      loadBtn.addEventListener("click", loadAnalytics);
    }

    // Refresh Course Friction (Challenging Quizzes + Submission Bottlenecks) — uses existing coursesList; never gets stuck
    var refreshCourseFrictionBtn = document.getElementById("refresh-course-friction-btn");
    if (refreshCourseFrictionBtn) {
      refreshCourseFrictionBtn.addEventListener("click", function() {
        if (!coursesList || coursesList.length === 0) {
          alert("Load Analytics first, then you can refresh Challenging Quizzes and Submission Bottlenecks.");
          return;
        }
        syncFilterCheckboxes();
        var list = coursesList;
        if (currentCourseFilter !== "all") {
          list = coursesList.filter(function(c) { return String(c.OrgUnit.Id) === String(currentCourseFilter); });
        }
        if ((hideNotStartedCourses || hideEndedCourses) && list.length > 0) {
          Promise.all(list.map(function(c) { return getCourseStartDate(String(c.OrgUnit.Id)); })).then(function() {
            list = list.filter(function(c) { return !isCourseExcludedByDateFilters(c.OrgUnit.Id); });
            runRefreshCourseFriction(list, refreshCourseFrictionBtn);
          });
        } else {
          runRefreshCourseFriction(list, refreshCourseFrictionBtn);
        }
      });
    }

    // Export All Data button
    var exportAllBtn = document.getElementById("export-all-csv-btn");
    if (exportAllBtn) {
      exportAllBtn.addEventListener("click", function() {
        // Filter students based on current filters (same as Risk Table)
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        if (showOnlyBelow72) {
          filtered = filtered.filter(function(s) {
            return s.currentGrade !== null && s.currentGrade < 72;
          });
        }

        // Apply risk filter if set
        var riskFilter = document.getElementById("risk-filter");
        if (riskFilter && riskFilter.value !== "all") {
          filtered = filtered.filter(function(s) {
            return s.riskFlags.indexOf(riskFilter.value) >= 0;
          });
        }

        // Apply search if set
        var searchInput = document.getElementById("risk-search");
        if (searchInput && searchInput.value) {
          var searchTerm = searchInput.value.toLowerCase();
          filtered = filtered.filter(function(s) {
            var fullName = (s.firstName + " " + s.lastName).toLowerCase();
            var email = (s.email || "").toLowerCase();
            var orgDefinedId = (s.orgDefinedId || "").toLowerCase();
            var courseName = (s.courseName || "").toLowerCase();
            return fullName.indexOf(searchTerm) >= 0 || 
                   email.indexOf(searchTerm) >= 0 || 
                   orgDefinedId.indexOf(searchTerm) >= 0 ||
                   courseName.indexOf(searchTerm) >= 0;
          });
        }

        // Prepare CSV data
        var csvData = filtered.map(function(s) {
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Course ID": s.courseId,
            "Last Access": formatDate(s.lastAccess),
            "Days Since Last Access": daysAgo(s.lastAccess) !== null ? daysAgo(s.lastAccess) : "Never",
            "Current Grade %": s.currentGrade !== null ? s.currentGrade.toFixed(1) : "N/A",
            "Final Grade %": s.finalGrade !== null ? s.finalGrade.toFixed(1) : "N/A",
            "Risk Flags": s.riskFlags.join(", "),
            "Never Attended": s.riskFlags.indexOf("never-attended") >= 0 ? "Yes" : "No",
            "Inactive 3d": s.riskFlags.indexOf("inactive-3d") >= 0 ? "Yes" : "No",
            "Inactive 7d": s.riskFlags.indexOf("inactive-7d") >= 0 ? "Yes" : "No",
            "Failing": s.riskFlags.indexOf("failing") >= 0 ? "Yes" : "No",
            "Drop-off": s.riskFlags.indexOf("drop-off") >= 0 ? "Yes" : "No",
            "Behind Pace": s.riskFlags.indexOf("behind-pace") >= 0 ? "Yes" : "No"
          };
        });

        if (csvData.length === 0) {
          alert("No data to export. Please load analytics first or adjust your filters.");
          return;
        }

        // Generate filename with timestamp
        var now = new Date();
        var timestamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
        var filename = "analytics_all_data_" + timestamp + ".csv";
        
        exportToCSV(csvData, filename);
      });
    }

    // Course filter
    var courseFilter = document.getElementById("analytics-course-filter");
    if (courseFilter) {
      courseFilter.addEventListener("change", function() {
        currentCourseFilter = this.value;
        renderNeedsAttention();
        renderStudentRiskTable();
        renderBuckets();
        renderCommunicationSection();
        // When a single course is selected and we have data, load Week-over-Week Non-Participation for that course
        if (currentCourseFilter && currentCourseFilter !== "all") {
          setNonParticipationProgress("Loading…");
          loadNonParticipationData(currentCourseFilter).then(function() {
            setNonParticipationProgress("");
            renderNonParticipationSection();
            return loadExternalGradesData(currentCourseFilter);
          }).then(function() {
            renderExternalGradesSection();
          }).catch(function(e) {
            logDiagnostic("ERROR", "Non-participation load failed: " + (e && e.message));
            setNonParticipationProgress("");
            renderNonParticipationSection();
          });
        } else {
          nonParticipationData = null;
          externalGradesData = null;
          setNonParticipationProgress("");
          renderNonParticipationSection();
          renderExternalGradesSection();
        }
      });
    }

    function onDateFilterCheckboxChange() {
      syncFilterCheckboxes();
      // Date filters change which courses are processed, so re-run a full load
      // when data is already available (same behavior as the threshold dropdown).
      if (hasLoadedAnalyticsOnce) {
        loadAnalytics();
        return;
      }
      renderNeedsAttention();
      renderStudentRiskTable();
      renderBuckets();
      renderCommunicationSection();
      renderNonParticipationSection();
      renderGradingBucket();
    }

    // Hide not started / ended courses checkboxes
    var hideNotStartedCheckbox = document.getElementById("hide-not-started-courses");
    if (hideNotStartedCheckbox) {
      hideNotStartedCheckbox.addEventListener("change", onDateFilterCheckboxChange);
    }
    var hideEndedCheckbox = document.getElementById("hide-ended-courses");
    if (hideEndedCheckbox) {
      hideEndedCheckbox.addEventListener("change", onDateFilterCheckboxChange);
    }

    // Show only students below 72% checkbox
    var showOnlyBelow72Checkbox = document.getElementById("show-only-below-72");
    if (showOnlyBelow72Checkbox) {
      showOnlyBelow72Checkbox.addEventListener("change", function() {
        showOnlyBelow72 = this.checked;
        renderStudentRiskTable();
      });
    }

    // Risk table filters
    var riskFilter = document.getElementById("risk-filter");
    if (riskFilter) {
      riskFilter.addEventListener("change", renderStudentRiskTable);
    }

    var thresholdFilter = document.getElementById("threshold-filter");
    if (thresholdFilter) {
      thresholdFilter.addEventListener("change", function() {
        currentThreshold = parseInt(this.value, 10);
        loadAnalytics(); // Reload to recalculate failing students
      });
    }

    var sortFilter = document.getElementById("sort-filter");
    if (sortFilter) {
      sortFilter.addEventListener("change", renderStudentRiskTable);
    }

    var riskSearch = document.getElementById("risk-search");
    if (riskSearch) {
      riskSearch.addEventListener("input", renderStudentRiskTable);
    }

    // Template management
    var newTemplateBtn = document.getElementById("new-template-btn");
    if (newTemplateBtn) {
      newTemplateBtn.addEventListener("click", function() {
        var composeSubject = document.getElementById("compose-subject");
        var composeBody = document.getElementById("compose-body");
        if (composeSubject) composeSubject.value = "";
        if (composeBody) composeBody.value = "";
      });
    }

    var saveTemplateBtn = document.getElementById("save-template-btn");
    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener("click", function() {
        var composeSubject = document.getElementById("compose-subject");
        var composeBody = document.getElementById("compose-body");
        var composeTemplate = document.getElementById("compose-template-select");
        
        if (!composeSubject || !composeBody) return;
        
        var name = prompt("Enter template name:");
        if (!name) return;

        var templates = loadTemplates();
        templates.push({
          name: name,
          subject: composeSubject.value || "",
          body: composeBody.value || ""
        });
        saveTemplates(templates);
        renderTemplatesList();
        
        if (composeTemplate) {
          composeTemplate.innerHTML = "<option value=''>[▼]</option>";
          for (var i = 0; i < templates.length; i++) {
            var option = document.createElement("option");
            option.value = templates[i].name;
            option.textContent = templates[i].name;
            composeTemplate.appendChild(option);
          }
        }
      });
    }

    var copyMessageBtn = document.getElementById("copy-message-btn");
    if (copyMessageBtn) {
      copyMessageBtn.addEventListener("click", function() {
        var composeSubject = document.getElementById("compose-subject");
        var composeBody = document.getElementById("compose-body");
        
        if (!composeSubject || !composeBody) return;
        
        var message = "Subject: " + composeSubject.value + "\n\n" + composeBody.value;
        navigator.clipboard.writeText(message).then(function() {
          alert("Message copied to clipboard!");
        });
      });
    }

    // Copy emails button
    var copyEmailsBtn = document.getElementById("copy-emails-btn");
    if (copyEmailsBtn) {
      copyEmailsBtn.addEventListener("click", function() {
        var checkboxes = document.querySelectorAll("#outreach-queue input[type='checkbox']:checked");
        var emails = [];
        for (var i = 0; i < checkboxes.length; i++) {
          var item = checkboxes[i].closest("div");
          // Extract email from student data - would need to store it in the DOM
          // For now, just get all flagged students' emails
        }
        var flagged = studentsData.filter(function(s) { return s.riskFlags.length > 0; }).slice(0, 8);
        emails = flagged.map(function(s) { return s.email; }).filter(function(e) { return e; });
        navigator.clipboard.writeText(emails.join(", ")).then(function() {
          alert("Copied " + emails.length + " email addresses!");
        });
      });
    }

    // Mark contacted button
    var markContactedBtn = document.getElementById("mark-contacted-btn");
    if (markContactedBtn) {
      markContactedBtn.addEventListener("click", function() {
        var studentName = prompt("Enter student name:");
        var courseName = prompt("Enter course name:");
        if (!studentName) return;

        var log = loadLastContactedLog();
        log.push({
          date: new Date().toISOString(),
          student: studentName,
          course: courseName || "",
          note: ""
        });
        saveLastContactedLog(log);
        renderLastContactedLog();
      });
    }

    // Engagement section export buttons
    var lowContentExportBtn = document.getElementById("low-content-export-btn");
    if (lowContentExportBtn) {
      lowContentExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        var now = new Date();
        var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        var lowContent = filtered.filter(function(s) {
          if (!s.lastAccess) return true;
          var lastAccessDate = new Date(s.lastAccess);
          return lastAccessDate < weekAgo;
        });
        var csvData = lowContent.map(function(s) {
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Last Access": formatDate(s.lastAccess)
          };
        });
        exportToCSV(csvData, "low_content_interaction.csv");
      });
    }

    var unopenedFeedbackExportBtn = document.getElementById("unopened-feedback-export-btn");
    if (unopenedFeedbackExportBtn) {
      unopenedFeedbackExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        var unopened = [];
        for (var i = 0; i < filtered.length; i++) {
          var s = filtered[i];
          if (s.unopenedFeedbackItems && s.unopenedFeedbackItems.length > 0) {
            unopened.push(s);
          } else if (s.currentGrade !== null && (!s.lastAccess || daysAgo(s.lastAccess) > 3)) {
            unopened.push(s);
          }
        }
        var csvData = [];
        for (var j = 0; j < unopened.length; j++) {
          var s2 = unopened[j];
          if (s2.unopenedFeedbackItems && s2.unopenedFeedbackItems.length > 0) {
            // Create a row for each unopened item
            for (var k = 0; k < s2.unopenedFeedbackItems.length; k++) {
              var item = s2.unopenedFeedbackItems[k];
              csvData.push({
                "Student Name": s2.firstName + " " + s2.lastName,
                "Student ID": s2.orgDefinedId || s2.userId,
                "Email": s2.email || "",
                "Course": s2.courseName + (s2.courseCode ? " (" + s2.courseCode + ")" : ""),
                "Item Type": item.type,
                "Item Name": item.name,
                "Current Grade %": s2.currentGrade !== null ? s2.currentGrade.toFixed(1) : "N/A",
                "Feedback Date": formatDate(item.feedbackDate),
                "Last Access": formatDate(s2.lastAccess)
              });
            }
          } else {
            // Fallback: single row without specific item
            csvData.push({
              "Student Name": s2.firstName + " " + s2.lastName,
              "Student ID": s2.orgDefinedId || s2.userId,
              "Email": s2.email || "",
              "Course": s2.courseName + (s2.courseCode ? " (" + s2.courseCode + ")" : ""),
              "Item Type": "Unknown",
              "Item Name": "Graded items (details not yet loaded)",
              "Current Grade %": s2.currentGrade !== null ? s2.currentGrade.toFixed(1) : "N/A",
              "Feedback Date": "",
              "Last Access": formatDate(s2.lastAccess)
            });
          }
        }
        exportToCSV(csvData, "unopened_feedback.csv");
      });
    }

    var loginInactivityExportBtn = document.getElementById("login-inactivity-export-btn");
    if (loginInactivityExportBtn) {
      loginInactivityExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        
        var neverLogged = [];
        var inactive3d = [];
        var inactive7d = [];
        var inactive14d = [];

        for (var i = 0; i < filtered.length; i++) {
          var student = filtered[i];
          var daysSince = daysAgo(student.lastAccess);
          
          if (!student.lastAccess || daysSince === null) {
            neverLogged.push({ student: student, category: "Never logged in" });
          } else if (daysSince >= 14) {
            inactive14d.push({ student: student, category: "14+ days" });
          } else if (daysSince >= 7) {
            inactive7d.push({ student: student, category: "7+ days" });
          } else if (daysSince >= 3) {
            inactive3d.push({ student: student, category: "3+ days" });
          }
        }

        var allInactive = neverLogged.concat(inactive14d).concat(inactive7d).concat(inactive3d);
        var csvData = allInactive.map(function(item) {
          var s = item.student;
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Inactivity Category": item.category,
            "Days Since Last Access": daysAgo(s.lastAccess) !== null ? daysAgo(s.lastAccess) : "Never",
            "Last Access": formatDate(s.lastAccess)
          };
        });
        exportToCSV(csvData, "login_inactivity.csv");
      });
    }

    // Assessment section export buttons
    var highQuizTimeExportBtn = document.getElementById("high-quiz-time-export-btn");
    if (highQuizTimeExportBtn) {
      highQuizTimeExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        
        var highQuizTime = [];
        var highQuizTimeSet = new Set();
        for (var i = 0; i < filtered.length; i++) {
          var s = filtered[i];
          var key = s.userId + "_" + s.courseId;
          if (!highQuizTimeSet.has(key) && s.quizAttemptTimes && s.quizAttemptTimes.length > 0) {
            highQuizTimeSet.add(key);
            highQuizTime.push(s);
          }
        }
        
        var csvData = [];
        for (var j = 0; j < highQuizTime.length; j++) {
          var s2 = highQuizTime[j];
          if (s2.quizAttemptTimes && s2.quizAttemptTimes.length > 0) {
            for (var k = 0; k < s2.quizAttemptTimes.length; k++) {
              var attempt = s2.quizAttemptTimes[k];
              csvData.push({
                "Student Name": s2.firstName + " " + s2.lastName,
                "Student ID": s2.orgDefinedId || s2.userId,
                "Email": s2.email || "",
                "Course": s2.courseName + (s2.courseCode ? " (" + s2.courseCode + ")" : ""),
                "Quiz Name": attempt.quizName,
                "Attempt Time (minutes)": Math.round(attempt.attemptTime),
                "Attempt Time (formatted)": Math.floor(attempt.attemptTime / 60) + "h " + Math.round(attempt.attemptTime % 60) + "m"
              });
            }
          }
        }
        exportToCSV(csvData, "high_quiz_time.csv");
      });
    }

    var discussionLurkersExportBtn = document.getElementById("discussion-lurkers-export-btn");
    if (discussionLurkersExportBtn) {
      discussionLurkersExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        
        var discussionLurkers = [];
        var discussionLurkersSet = new Set();
        for (var i = 0; i < filtered.length; i++) {
          var s = filtered[i];
          var key = s.userId + "_" + s.courseId;
          if (!discussionLurkersSet.has(key)) {
            discussionLurkersSet.add(key);
            
            var isLurker = false;
            if (s.discussionPosts > 0 && s.discussionReplies === 0) {
              isLurker = true;
            } else if (s.discussionReadCount !== undefined && s.discussionReadCount >= 10 && s.discussionPosts === 0) {
              isLurker = true;
            }
            
            if (isLurker) {
              discussionLurkers.push(s);
            }
          }
        }
        
        var csvData = discussionLurkers.map(function(s) {
          var reason = "";
          if (s.discussionPosts > 0 && s.discussionReplies === 0) {
            reason = "Posted " + s.discussionPosts + " time(s) but never replied to others";
          } else if (s.discussionReadCount !== undefined && s.discussionReadCount >= 10 && s.discussionPosts === 0) {
            reason = "Read " + s.discussionReadCount + "+ posts but hasn't contributed";
          }
          
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Posts Made": s.discussionPosts || 0,
            "Replies to Others": s.discussionReplies || 0,
            "Posts Read": s.discussionReadCount || 0,
            "Reason": reason
          };
        });
        exportToCSV(csvData, "discussion_lurkers.csv");
      });
    }

    var gradeVolatilityExportBtn = document.getElementById("grade-volatility-export-btn");
    if (gradeVolatilityExportBtn) {
      gradeVolatilityExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        var volatility = filtered.filter(function(s) {
          return s.currentGrade !== null && s.currentGrade < (currentThreshold - 15);
        });
        var csvData = volatility.map(function(s) {
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Current Grade %": s.currentGrade !== null ? s.currentGrade.toFixed(1) : "N/A"
          };
        });
        exportToCSV(csvData, "grade_volatility.csv");
      });
    }

    // Course Friction section export buttons
    var challengingQuestionExportBtn = document.getElementById("challenging-question-export-btn");
    if (challengingQuestionExportBtn) {
      challengingQuestionExportBtn.addEventListener("click", function() {
        var filtered = challengingQuizzesData;
        if (currentCourseFilter !== "all") {
          filtered = challengingQuizzesData.filter(function(q) {
            return String(q.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(q) {
            return !isCourseExcludedByDateFilters(q.courseId);
          });
        }
        
        // Filter by current threshold (70, 50, 30, or 0 for average score)
        var thresholdFiltered = filtered.filter(function(q) {
          var avgScore = parseFloat(q.averageScore);
          if (currentChallengingThreshold === 70) {
            return avgScore < 70;
          } else if (currentChallengingThreshold === 50) {
            return avgScore < 50;
          } else if (currentChallengingThreshold === 30) {
            return avgScore < 30;
          } else {
            return true; // Show all
          }
        });
        
        var categoryLabel = function(cat) {
          return cat === "below30" ? "Below 30%" : (cat === "30-49" ? "30-49%" : (cat === "50-69" ? "50-69%" : "70%+"));
        };
        var csvData = thresholdFiltered.map(function(q) {
          return {
            "Quiz Name": q.quizName,
            "Average Score": q.averageScore + "%",
            "Category": categoryLabel(q.category),
            "Total Attempts": q.totalAttempts,
            "Quiz ID": q.quizId,
            "Course": q.courseName + (q.courseCode ? " (" + q.courseCode + ")" : ""),
            "Course ID": q.courseId
          };
        });
        exportToCSV(csvData, "challenging_quizzes.csv");
      });
    }
    
    // Challenging quizzes tab switching
    var challengingTabs = document.querySelectorAll(".challenging-tab");
    for (var t = 0; t < challengingTabs.length; t++) {
      challengingTabs[t].addEventListener("click", function() {
        var threshold = parseInt(this.getAttribute("data-threshold"));
        currentChallengingThreshold = threshold;
        
        // Update active tab styling
        for (var u = 0; u < challengingTabs.length; u++) {
          challengingTabs[u].classList.remove("active");
        }
        this.classList.add("active");
        
        // Re-render the section
        renderCourseFrictionSection();
      });
    }

    var submissionBottleneckExportBtn = document.getElementById("submission-bottleneck-export-btn");
    if (submissionBottleneckExportBtn) {
      submissionBottleneckExportBtn.addEventListener("click", function() {
        var filtered = submissionBottlenecksData;
        if (currentCourseFilter !== "all") {
          filtered = submissionBottlenecksData.filter(function(b) {
            return String(b.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(b) {
            return !isCourseExcludedByDateFilters(b.courseId);
          });
        }
        
        var csvData = filtered.map(function(b) {
          var dueDate = new Date(b.dueDate);
          var hoursUntilDue = Math.floor((dueDate - new Date()) / (1000 * 60 * 60));
          
          return {
            "Assignment Name": b.assignmentName,
            "Due Date": formatDate(b.dueDate),
            "Hours Until Due": hoursUntilDue,
            "Total Students": b.totalStudents,
            "Submitted Count": b.submittedCount,
            "Missing Count": b.missingCount,
            "Missing Percentage": b.missingPercentage + "%",
            "Course": b.courseName + (b.courseCode ? " (" + b.courseCode + ")" : ""),
            "Course ID": b.courseId,
            "Folder ID": b.folderId
          };
        });
        exportToCSV(csvData, "submission_bottlenecks.csv");
      });
    }

    // Week-over-Week Non-Participation export
    var nonParticipationExportBtn = document.getElementById("non-participation-export-btn");
    if (nonParticipationExportBtn) {
      nonParticipationExportBtn.addEventListener("click", function() {
        if (!nonParticipationData || !nonParticipationData.weeks) {
          alert("No non-participation data loaded. Select a course and load analytics first.");
          return;
        }
        var csvData = [];
        var weekRanges = nonParticipationData.weeks;
        for (var w = 0; w < weekRanges.length; w++) {
          var week = weekRanges[w];
          var weekStartStr = week.weekStart ? (week.weekStart.toISOString ? week.weekStart.toISOString().slice(0, 10) : String(week.weekStart)) : "";
          var weekEndStr = week.weekEnd ? (week.weekEnd.toISOString ? week.weekEnd.toISOString().slice(0, 10) : String(week.weekEnd)) : "";
          var students = week.students || [];
          for (var s = 0; s < students.length; s++) {
            var st = students[s];
            csvData.push({
              "WeekStart": weekStartStr,
              "WeekEnd": weekEndStr,
              "OrgDefinedId": st.orgDefinedId || "",
              "FirstName": st.firstName || "",
              "LastName": st.lastName || "",
              "Email": st.email || "",
              "Status": "No submissions"
            });
          }
        }
        if (csvData.length === 0) {
          csvData.push({ "WeekStart": "", "WeekEnd": "", "OrgDefinedId": "", "FirstName": "", "LastName": "", "Email": "", "Status": "No students with zero submissions in the displayed weeks" });
        }
        exportToCSV(csvData, "week_over_week_non_participation.csv");
      });
    }

    var gradeDistributionExportBtn = document.getElementById("grade-distribution-export-btn");
    if (gradeDistributionExportBtn) {
      gradeDistributionExportBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        if (hideNotStartedCourses || hideEndedCourses) {
          filtered = filtered.filter(function(s) {
            return !isCourseExcludedByDateFilters(s.courseId);
          });
        }
        var gradeRanges = [
          { label: "90-100", min: 90, max: 100, count: 0 },
          { label: "80-89", min: 80, max: 89, count: 0 },
          { label: "70-79", min: 70, max: 79, count: 0 },
          { label: "60-69", min: 60, max: 69, count: 0 },
          { label: "0-59", min: 0, max: 59, count: 0 }
        ];
        for (var i = 0; i < filtered.length; i++) {
          var grade = filtered[i].currentGrade;
          if (grade !== null) {
            for (var j = 0; j < gradeRanges.length; j++) {
              if (grade >= gradeRanges[j].min && grade <= gradeRanges[j].max) {
                gradeRanges[j].count++;
                break;
              }
            }
          }
        }
        var csvData = gradeRanges.map(function(r) {
          return {
            "Grade Range": r.label,
            "Count": r.count
          };
        });
        exportToCSV(csvData, "grade_distribution.csv");
      });
    }

    // CSV Export buttons
    var exportRiskCSVBtn = document.getElementById("export-risk-csv-btn");
    if (exportRiskCSVBtn) {
      exportRiskCSVBtn.addEventListener("click", function() {
        var filtered = studentsData;
        if (currentCourseFilter !== "all") {
          filtered = studentsData.filter(function(s) {
            return String(s.courseId) === String(currentCourseFilter);
          });
        }
        var csvData = filtered.map(function(s) {
          return {
            "Student Name": s.firstName + " " + s.lastName,
            "Student ID": s.orgDefinedId || s.userId,
            "Email": s.email || "",
            "Course": s.courseName + (s.courseCode ? " (" + s.courseCode + ")" : ""),
            "Last Access": formatDate(s.lastAccess),
            "Current Grade %": s.currentGrade !== null ? s.currentGrade.toFixed(1) : "N/A",
            "Risk Flags": s.riskFlags.join(", ")
          };
        });
        exportToCSV(csvData, "student_risk_table.csv");
      });
    }
  }

  // =========================
  // INITIALIZE
  // =========================
  function init() {
    logDiagnostic("INIT", "Analytics page initialized");
    setupEventListeners();

    document.addEventListener("fd-semester-viewing-change", function () {
      loadAnalytics();
    });
    
    // Auto-load analytics so instructor doesn't have to click the button
    setTimeout(function() {
      loadAnalytics();
    }, 400);
    
    // Make sure all sections are visible on initial load
    renderCommunicationSection(); // Initialize communication section with empty states
    
    // Load templates into compose dropdown
    var composeTemplate = document.getElementById("compose-template-select");
    if (composeTemplate) {
      var templates = loadTemplates();
      composeTemplate.innerHTML = "<option value=''>[▼]</option>";
      for (var i = 0; i < templates.length; i++) {
        var option = document.createElement("option");
        option.value = templates[i].name;
        option.textContent = templates[i].name;
        composeTemplate.appendChild(option);
      }
      
      composeTemplate.addEventListener("change", function() {
        if (!this.value) return;
        var template = templates.find(function(t) { return t.name === this.value; }.bind(this));
        if (template) {
          var composeSubject = document.getElementById("compose-subject");
          var composeBody = document.getElementById("compose-body");
          if (composeSubject) composeSubject.value = template.subject || "";
          if (composeBody) composeBody.value = template.body || "";
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
