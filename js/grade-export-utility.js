/**
 * Course Report — spreadsheet export, visual grade analytics, and full course PDF.
 * Term codes: js/semester-config.js
 */
(function () {
  "use strict";

  var coursesByOrgUnitId = {};
  var lastReport = null;

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";
  var API_VERSION_GRADES_BULK = "1.86";
  var PASSING_CUTOFF = 70;
  var GREEN = [15, 91, 70];

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var PREVIOUS_SEMESTER_CODE = semesterApi() ? semesterApi().getPreviousCode() : "26/WI";
  var DEFAULT_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  var FUTURE_SEMESTER_CODE = semesterApi() ? semesterApi().getFutureCode() : "26/FA";
  var ALLOWED_SEMESTER_CODES = {};
  ALLOWED_SEMESTER_CODES[PREVIOUS_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[DEFAULT_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[FUTURE_SEMESTER_CODE] = true;
  var TERM_RANGE_LABEL =
    PREVIOUS_SEMESTER_CODE + ", " + DEFAULT_SEMESTER_CODE + ", and " + FUTURE_SEMESTER_CODE;

  var ACADEMIC_ROLE_IDS = {
    102: true,
    183: true,
    108: true,
    127: true,
    160: true,
    167: true,
    174: true
  };
  var ACADEMIC_ROLE_KEYWORDS = ["instructor", "teacher", "faculty", "assistant", "ta", "mentor"];

  var COLUMNS = [
    "Semester",
    "CourseName",
    "CourseCode",
    "CourseId",
    "LastName",
    "FirstName",
    "OrgDefinedId",
    "Email",
    "UserId",
    "FinalPercent",
    "PointsEarned",
    "PointsPossible",
    "DisplayedGrade"
  ];

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function isMergedOrCancelledCourse(course) {
    if (!course || !course.OrgUnit) return false;
    var code = (course.OrgUnit.Code || "").toUpperCase();
    var name = (course.OrgUnit.Name || "").toUpperCase();
    return (
      code.indexOf("MERGED") >= 0 ||
      code.indexOf("CXLD") >= 0 ||
      name.indexOf("MERGED") >= 0 ||
      name.indexOf("CXLD") >= 0
    );
  }

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code && item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id && item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (
      item &&
      item.Access &&
      typeof item.Access.ClasslistRoleId !== "undefined" &&
      item.Access.ClasslistRoleId !== null
    ) {
      var n = parseInt(item.Access.ClasslistRoleId, 10);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  function getRoleName(item) {
    if (item && item.Access && item.Access.ClasslistRoleName) {
      return item.Access.ClasslistRoleName.toString();
    }
    return "Unknown";
  }

  function roleNameMatches(roleName, keywords) {
    var r = (roleName || "").toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (r.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function isAcademicRole(roleId, roleName) {
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return true;
    if (roleId === null) return roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS);
    return false;
  }

  async function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    if (!res.ok) {
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      throw error;
    }
    if (res.status === 204) return null;
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") >= 0) return await res.json();
    return null;
  }

  async function BrightspaceFetchOptional(url) {
    try {
      return await BrightspaceFetch(url);
    } catch (e) {
      return null;
    }
  }

  function asArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Objects)) return data.Objects;
    if (Array.isArray(data.Items)) return data.Items;
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
      var data = await BrightspaceFetchOptional(url);
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

  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;
    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";
      var data = await BrightspaceFetch(endpoint);
      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) allItems.push(data.Items[i]);
      }
      if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
        hasMore = true;
        bookmark = data.PagingInfo.Bookmark;
      } else {
        hasMore = false;
      }
    }
    return allItems;
  }

  function filterInstructorCourses(enrollments) {
    var out = [];
    for (var i = 0; i < enrollments.length; i++) {
      var item = enrollments[i];
      if (!isCourseOffering(item)) continue;
      var code = item.OrgUnit.Code || "";
      var sem = getSemesterCodeFromCourseCode(code);
      var roleId = getRoleId(item);
      var roleName = getRoleName(item);
      if (!ALLOWED_SEMESTER_CODES[sem]) continue;
      if (!isAcademicRole(roleId, roleName)) continue;
      if (isMergedOrCancelledCourse(item)) continue;
      out.push(item);
    }
    out.sort(function (a, b) {
      var an = (a.OrgUnit.Name || "").toLowerCase();
      var bn = (b.OrgUnit.Name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return out;
  }

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
        for (var i = 0; i < objects.length; i++) allStudents.push(objects[i]);
        nextUrl = classlistNextUrl(orgUnitId, data, objects.length);
      } catch (e) {
        console.error("Error fetching classlist for course " + orgUnitId + ":", e);
        break;
      }
    }
    return allStudents;
  }

  function isClasslistStudent(member) {
    var roleName = (member.ClasslistRoleDisplayName || "").toLowerCase();
    if (roleName.indexOf("student") >= 0) return true;
    var rid = member.RoleId;
    return rid === 3 || rid === 5 || rid === 101;
  }

  function isDemoStudent(member) {
    if (!member) return false;
    return (member.FirstName || "").trim() === "ZZDemo" && (member.LastName || "").trim() === "ZZStudent";
  }

  async function getFinalGradeDetailsForCourse(orgUnitId) {
    var gradesMap = new Map();
    var nextUrl =
      "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/?pageSize=200";
    var allGrades = [];
    while (nextUrl) {
      try {
        var data = await BrightspaceFetch(nextUrl);
        var gradeItems = data && data.Items ? data.Items : data && data.Objects ? data.Objects : [];
        if (gradeItems.length > 0) allGrades = allGrades.concat(gradeItems);
        if (data && data.Next && data.Next !== null && data.Next !== "") {
          var nextPath = data.Next;
          if (nextPath.indexOf("/d2l/api/") >= 0) {
            var urlParts = nextPath.split("/d2l/api/");
            nextUrl = urlParts.length > 1 ? "/d2l/api/" + urlParts[1] : null;
          } else if (nextPath.indexOf("/") === 0) {
            nextUrl = nextPath;
          } else {
            nextUrl =
              "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/" + nextPath;
          }
        } else {
          nextUrl = null;
        }
      } catch (pageError) {
        if (pageError.status !== 403 && pageError.status !== 404) {
          console.warn("Paginated grades error for " + orgUnitId + ":", pageError.message);
        }
        nextUrl = null;
      }
    }
    for (var i = 0; i < allGrades.length; i++) {
      var row = allGrades[i];
      var gradeValue = row.GradeValue || row;
      var user = row.User || {};
      if (!gradeValue || gradeValue.GradeObjectType !== 7) continue;
      var userId = String(user.Identifier || row.UserId || "");
      if (!userId) continue;
      var pointsNum = gradeValue.PointsNumerator;
      var pointsDen = gradeValue.PointsDenominator;
      var pct = null;
      if (
        pointsNum !== null &&
        pointsNum !== undefined &&
        pointsDen !== null &&
        pointsDen !== undefined &&
        pointsDen > 0
      ) {
        pct = (pointsNum / pointsDen) * 100;
      }
      var displayed =
        gradeValue.DisplayedGrade != null && gradeValue.DisplayedGrade !== ""
          ? String(gradeValue.DisplayedGrade).trim()
          : gradeValue.ShortTextGrade != null && gradeValue.ShortTextGrade !== ""
            ? String(gradeValue.ShortTextGrade).trim()
            : "";
      gradesMap.set(userId, {
        percent: pct,
        pointsEarned: pointsNum != null ? pointsNum : "",
        pointsPossible: pointsDen != null ? pointsDen : "",
        displayedGrade: displayed
      });
    }
    return gradesMap;
  }

  function escapeCsvField(val) {
    var s = val == null ? "" : String(val);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

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

  function sanitizeFilenamePart(s) {
    return (s || "course").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").substring(0, 80);
  }

  function buildGradeRows(course, classlist, gradeMap) {
    var courseName = course.OrgUnit.Name || "";
    var courseCode = course.OrgUnit.Code || "";
    var orgUnitId = String(course.OrgUnit.Id);
    var rows = [];
    for (var i = 0; i < classlist.length; i++) {
      var m = classlist[i];
      if (!isClasslistStudent(m) || isDemoStudent(m)) continue;
      var userId = String(m.Identifier || "");
      var g = gradeMap.get(userId);
      var pctStr = "";
      if (g && g.percent != null && !isNaN(g.percent)) {
        pctStr = (Math.round(g.percent * 100) / 100).toFixed(2);
      }
      rows.push({
        Semester: getSemesterCodeFromCourseCode(courseCode) || DEFAULT_SEMESTER_CODE,
        CourseName: courseName,
        CourseCode: courseCode,
        CourseId: orgUnitId,
        LastName: m.LastName || "",
        FirstName: m.FirstName || "",
        OrgDefinedId: m.OrgDefinedId || "",
        Email: m.Email || "",
        UserId: userId,
        FinalPercent: pctStr,
        PointsEarned: g && g.pointsEarned !== "" ? g.pointsEarned : "",
        PointsPossible: g && g.pointsPossible !== "" ? g.pointsPossible : "",
        DisplayedGrade: g ? g.displayedGrade : ""
      });
    }
    return rows;
  }

  function setStatus(el, type, text) {
    if (!el) return;
    el.style.display = "block";
    el.className = "message-container" + (type ? " message-" + type : "");
    el.textContent = text;
  }

  function selectedReportType() {
    var el = document.querySelector('input[name="reportType"]:checked');
    return el ? el.value : "spreadsheet";
  }

  function getSelectedCourse(selectEl) {
    var id = selectEl.value;
    if (!id) return null;
    return coursesByOrgUnitId[id] || null;
  }

  function letterFromPercent(p) {
    if (p == null || isNaN(p)) return "";
    if (p >= 90) return "A";
    if (p >= 80) return "B";
    if (p >= 70) return "C";
    if (p >= 60) return "D";
    return "F";
  }

  function letterBucket(displayed, percent) {
    var d = (displayed || "").trim().toUpperCase();
    var m = d.match(/^([ABCDF])[+\-]?$/);
    if (m) return m[1];
    return letterFromPercent(percent);
  }

  function mean(nums) {
    if (!nums.length) return null;
    var s = 0;
    for (var i = 0; i < nums.length; i++) s += nums[i];
    return s / nums.length;
  }

  function median(nums) {
    if (!nums.length) return null;
    var a = nums.slice().sort(function (x, y) {
      return x - y;
    });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function stdev(nums) {
    if (nums.length < 2) return null;
    var m = mean(nums);
    var s = 0;
    for (var i = 0; i < nums.length; i++) s += (nums[i] - m) * (nums[i] - m);
    return Math.sqrt(s / (nums.length - 1));
  }

  function round1(n) {
    if (n == null || isNaN(n)) return "—";
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function percentFromGradeValue(gv) {
    if (!gv) return null;
    var num = gv.PointsNumerator;
    var den = gv.PointsDenominator;
    if (num != null && den != null && den > 0) return (num / den) * 100;
    var wg = gv.WeightedNumerator;
    var wd = gv.WeightedDenominator;
    if (wg != null && wd != null && wd > 0) return (wg / wd) * 100;
    return null;
  }

  function isReportableGradeItem(item) {
    if (!item) return false;
    var type = item.GradeObjectType != null ? item.GradeObjectType : item.GradeType;
    var name = String(item.GradeObjectTypeName || item.GradeType || "").toLowerCase();
    if (type === 4 || type === 7 || type === 8 || type === 9) return false;
    if (/text|category|final/.test(name)) return false;
    return !!(item.Name || item.ShortName);
  }

  function classifyToolKind(item, extraName) {
    var tool = (item && (item.AssociatedTool || item.AssociatedTool)) || {};
    var blob = [tool.ToolName, tool.Name, tool.ToolId, item && item.Name, item && item.CategoryName, extraName]
      .join(" ")
      .toLowerCase();
    if (/quiz/.test(blob)) return "Quiz";
    if (/dropbox|assign/.test(blob)) return "Assignment";
    if (/discuss/.test(blob)) return "Discussion";
    return "Grade item";
  }

  function uniqueUserCount(ids) {
    var seen = {};
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!id || seen[id]) continue;
      seen[id] = true;
      n++;
    }
    return n;
  }

  function entityUserId(entity) {
    if (!entity) return "";
    var id = entity.EntityId != null ? entity.EntityId : entity.Identifier != null ? entity.Identifier : entity.Id;
    return id != null ? String(id) : "";
  }

  async function collectGradeItemStats(orgUnitId, studentIds, onProgress) {
    var raw = await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/");
    var items = asArray(raw).filter(isReportableGradeItem);
    if (items.length > 80) items = items.slice(0, 80);
    var studentSet = {};
    for (var s = 0; s < studentIds.length; s++) studentSet[studentIds[s]] = true;

    var stats = await mapPool(items, 4, async function (item, idx) {
      if (onProgress) onProgress("Reading grade item " + (idx + 1) + " of " + items.length + "…");
      var gid = item.Id != null ? item.Id : item.GradeObjectId;
      if (gid == null) return null;
      var values = await fetchAllPaged(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/" + gid + "/values/?pageSize=200",
        30
      );
      var pcts = [];
      var gradedIds = {};
      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var uid =
          row.User && (row.User.Identifier != null || row.User.Id != null)
            ? String(row.User.Identifier != null ? row.User.Identifier : row.User.Id)
            : row.UserId != null
              ? String(row.UserId)
              : "";
        if (!uid || !studentSet[uid]) continue;
        var pct = percentFromGradeValue(row.GradeValue || row.Grade || row);
        if (pct == null) continue;
        pcts.push(pct);
        gradedIds[uid] = true;
      }
      var gradedCount = 0;
      for (var k in gradedIds) {
        if (Object.prototype.hasOwnProperty.call(gradedIds, k)) gradedCount++;
      }
      return {
        name: item.Name || item.ShortName || "Grade item",
        kind: classifyToolKind(item),
        gradedCount: gradedCount,
        avgPct: mean(pcts)
      };
    });
    return stats.filter(Boolean);
  }

  async function collectAssignments(orgUnitId, studentIds, onProgress) {
    var folders = asArray(
      await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/")
    );
    var studentSet = {};
    for (var s = 0; s < studentIds.length; s++) studentSet[studentIds[s]] = true;
    var enrolled = studentIds.length;
    var rows = await mapPool(folders, 3, async function (folder, idx) {
      if (onProgress) onProgress("Reading assignment folder " + (idx + 1) + " of " + folders.length + "…");
      var fid = folder.Id != null ? folder.Id : folder.FolderId;
      if (fid == null) return null;
      var subs = await fetchAllPaged(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + fid + "/submissions/?activeOnly=true",
        20
      );
      if (!subs.length) {
        subs = await fetchAllPaged(
          "/d2l/api/le/" +
            API_VERSION_LE +
            "/" +
            orgUnitId +
            "/dropbox/folders/" +
            fid +
            "/submissions/paged/?activeOnly=true",
          20
        );
      }
      var submitted = [];
      for (var i = 0; i < subs.length; i++) {
        var row = subs[i];
        var uid = entityUserId(row.Entity || row.entity);
        if (!uid || !studentSet[uid]) continue;
        var files = row.Submissions || row.submissions || [];
        var status = row.Status;
        if (files.length > 0 || status === 1 || status === 2 || status === 3 || status === "1") submitted.push(uid);
      }
      return {
        name: folder.Name || folder.FolderName || "Assignment",
        due: folder.DueDate || folder.DueDateTime || "",
        submitted: uniqueUserCount(submitted),
        enrolled: enrolled
      };
    });
    return rows.filter(Boolean);
  }

  async function collectQuizzes(orgUnitId, studentIds, onProgress) {
    var quizzes = asArray(
      await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/")
    );
    var studentSet = {};
    for (var s = 0; s < studentIds.length; s++) studentSet[studentIds[s]] = true;
    var enrolled = studentIds.length;
    var rows = await mapPool(quizzes, 3, async function (quiz, idx) {
      if (onProgress) onProgress("Reading quiz " + (idx + 1) + " of " + quizzes.length + "…");
      var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
      if (qid == null) return null;
      var attempts = await fetchAllPaged(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + qid + "/attempts/",
        30
      );
      var attempted = [];
      var scores = [];
      for (var i = 0; i < attempts.length; i++) {
        var att = attempts[i];
        var uid = att.UserId != null ? String(att.UserId) : att.User && att.User.Id != null ? String(att.User.Id) : "";
        if (!uid || !studentSet[uid]) continue;
        if (att.Completed || att.IsCompleted || att.Score != null) attempted.push(uid);
        if (att.Score != null && !isNaN(Number(att.Score))) scores.push(Number(att.Score));
      }
      return {
        name: quiz.Name || "Quiz",
        attempted: uniqueUserCount(attempted),
        enrolled: enrolled,
        avgScore: mean(scores)
      };
    });
    return rows.filter(Boolean);
  }

  async function collectDiscussions(orgUnitId, studentIds, onProgress) {
    var forums = asArray(
      await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/")
    );
    var studentSet = {};
    for (var s = 0; s < studentIds.length; s++) studentSet[studentIds[s]] = true;
    var enrolled = studentIds.length;
    var out = [];
    for (var f = 0; f < forums.length; f++) {
      var forum = forums[f];
      var forumName = forum.Name || "Forum";
      if (/private student|1-on-1|one-on-one|1:1/.test(forumName.toLowerCase())) continue;
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      var topics = asArray(
        await BrightspaceFetchOptional(
          "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + fid + "/topics/"
        )
      );
      for (var t = 0; t < topics.length; t++) {
        var topic = topics[t];
        var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
        if (tid == null) continue;
        if (onProgress) onProgress("Reading discussion: " + forumName + " / " + (topic.Name || "topic") + "…");
        var posts = [];
        for (var page = 1; page <= 15; page++) {
          var pageData = await BrightspaceFetchOptional(
            "/d2l/api/le/" +
              API_VERSION_LE +
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
        var posterIds = [];
        var postCount = 0;
        for (var i = 0; i < posts.length; i++) {
          var post = posts[i];
          if (post.IsDeleted) continue;
          var uid =
            post.PostingUserId != null ? String(post.PostingUserId) : post.UserId != null ? String(post.UserId) : "";
          if (!uid || !studentSet[uid]) continue;
          posterIds.push(uid);
          postCount++;
        }
        out.push({
          forum: forumName,
          topic: topic.Name || "Topic",
          posters: uniqueUserCount(posterIds),
          posts: postCount,
          enrolled: enrolled
        });
      }
    }
    return out;
  }

  function buildStudentRecords(classlist, gradeMap) {
    var students = [];
    for (var i = 0; i < classlist.length; i++) {
      var m = classlist[i];
      if (!isClasslistStudent(m) || isDemoStudent(m)) continue;
      var userId = String(m.Identifier || "");
      var g = gradeMap.get(userId) || {};
      var pct = g.percent != null && !isNaN(g.percent) ? g.percent : null;
      students.push({
        userId: userId,
        lastName: m.LastName || "",
        firstName: m.FirstName || "",
        orgDefinedId: m.OrgDefinedId || "",
        percent: pct,
        displayed: g.displayedGrade || "",
        letter: letterBucket(g.displayedGrade, pct)
      });
    }
    students.sort(function (a, b) {
      var ln = a.lastName.localeCompare(b.lastName);
      return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
    });
    return students;
  }

  function computeGradeAnalytics(students) {
    var percents = [];
    var letters = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    var histogram = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var atRisk = [];
    var graded = 0;
    var passing = 0;
    for (var i = 0; i < students.length; i++) {
      var st = students[i];
      if (st.percent == null) continue;
      graded++;
      percents.push(st.percent);
      if (st.percent >= PASSING_CUTOFF) passing++;
      else atRisk.push(st);
      var bucket = st.percent >= 100 ? 9 : Math.max(0, Math.min(9, Math.floor(st.percent / 10)));
      histogram[bucket]++;
      if (letters[st.letter] != null) letters[st.letter]++;
    }
    return {
      enrolled: students.length,
      graded: graded,
      mean: mean(percents),
      median: median(percents),
      min: percents.length ? Math.min.apply(null, percents) : null,
      max: percents.length ? Math.max.apply(null, percents) : null,
      stdev: stdev(percents),
      passingPct: graded ? (passing / graded) * 100 : null,
      letters: letters,
      histogram: histogram,
      atRisk: atRisk
    };
  }

  async function buildReport(course, mode, onProgress) {
    var orgUnitId = String(course.OrgUnit.Id);
    onProgress("Loading classlist and final grades…");
    var classlist = await getClasslist(orgUnitId);
    var gradeMap = await getFinalGradeDetailsForCourse(orgUnitId);
    var students = buildStudentRecords(classlist, gradeMap);
    var analytics = computeGradeAnalytics(students);
    var studentIds = students.map(function (s) {
      return s.userId;
    });
    var report = {
      mode: mode,
      generatedAt: new Date(),
      course: {
        id: orgUnitId,
        name: course.OrgUnit.Name || "Course",
        code: course.OrgUnit.Code || "",
        semester: getSemesterCodeFromCourseCode(course.OrgUnit.Code || "") || DEFAULT_SEMESTER_CODE
      },
      students: students,
      analytics: analytics,
      gradeItems: [],
      assignments: [],
      quizzes: [],
      discussions: []
    };
    if (mode === "analytics" || mode === "full") {
      report.gradeItems = await collectGradeItemStats(orgUnitId, studentIds, onProgress);
    }
    if (mode === "full") {
      report.assignments = await collectAssignments(orgUnitId, studentIds, onProgress);
      report.quizzes = await collectQuizzes(orgUnitId, studentIds, onProgress);
      report.discussions = await collectDiscussions(orgUnitId, studentIds, onProgress);
    }
    return report;
  }

  function histLabels() {
    return ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-100"];
  }

  function kpiHtml(label, value) {
    return (
      '<div class="cr-kpi"><div class="cr-kpi-label">' +
      escapeHtml(label) +
      '</div><div class="cr-kpi-value">' +
      escapeHtml(value) +
      "</div></div>"
    );
  }

  function meterHtml(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return (
      '<div class="cr-meter" title="' +
      pct +
      '%"><span style="width:' +
      pct +
      '%"></span></div> ' +
      done +
      " / " +
      total
    );
  }

  function itemTableHtml(title, rows, cols) {
    if (!rows || !rows.length) {
      return (
        '<div class="cr-panel"><h3>' +
        escapeHtml(title) +
        '</h3><p class="cr-muted">No items found, or this tool is not used in the course.</p></div>'
      );
    }
    var html =
      '<div class="cr-panel"><h3>' +
      escapeHtml(title) +
      '</h3><div class="cr-table-wrap"><table class="cr-table"><thead><tr>';
    for (var c = 0; c < cols.length; c++) html += "<th>" + escapeHtml(cols[c].label) + "</th>";
    html += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r++) {
      html += "<tr>";
      for (var k = 0; k < cols.length; k++) html += "<td>" + cols[k].cell(rows[r]) + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div></div>";
    return html;
  }

  function renderPreview(report) {
    var a = report.analytics;
    var hist = a.histogram;
    var maxH = 1;
    for (var i = 0; i < hist.length; i++) if (hist[i] > maxH) maxH = hist[i];
    var labels = histLabels();
    var histHtml = '<div class="cr-hist" role="img" aria-label="Final grade distribution">';
    for (var h = 0; h < hist.length; h++) {
      var height = Math.max(4, Math.round((hist[h] / maxH) * 120));
      histHtml +=
        '<div class="cr-hist-col"><div class="cr-hist-bar" style="height:' +
        height +
        'px"></div><span class="cr-hist-n">' +
        hist[h] +
        '</span><span class="cr-hist-lbl">' +
        labels[h] +
        "</span></div>";
    }
    histHtml += "</div>";

    var letterHtml = '<div class="cr-letters">';
    var order = ["A", "B", "C", "D", "F"];
    for (var L = 0; L < order.length; L++) {
      letterHtml +=
        '<div class="cr-letter cr-letter-' +
        order[L].toLowerCase() +
        '"><div class="cr-letter-grade">' +
        order[L] +
        '</div><div class="cr-letter-n">' +
        a.letters[order[L]] +
        "</div></div>";
    }
    letterHtml += "</div>";

    var riskHtml;
    if (a.atRisk.length) {
      riskHtml =
        '<div class="cr-panel"><h3>Students below ' +
        PASSING_CUTOFF +
        '%</h3><div class="cr-table-wrap"><table class="cr-table"><thead><tr><th>Student</th><th>ID</th><th>Final</th><th>Letter</th></tr></thead><tbody>';
      for (var x = 0; x < a.atRisk.length; x++) {
        var st = a.atRisk[x];
        riskHtml +=
          '<tr class="cr-risk"><td>' +
          escapeHtml(st.lastName + ", " + st.firstName) +
          "</td><td>" +
          escapeHtml(st.orgDefinedId) +
          "</td><td>" +
          escapeHtml(round1(st.percent) + "%") +
          "</td><td>" +
          escapeHtml(st.letter || "—") +
          "</td></tr>";
      }
      riskHtml += "</tbody></table></div></div>";
    } else {
      riskHtml =
        '<div class="cr-panel"><h3>Students below ' +
        PASSING_CUTOFF +
        '%</h3><p class="cr-muted">No graded students are currently below ' +
        PASSING_CUTOFF +
        "%.</p></div>";
    }

    var extra = itemTableHtml("Gradebook items", report.gradeItems, [
      { label: "Item", cell: function (row) { return escapeHtml(row.name); } },
      { label: "Type", cell: function (row) { return escapeHtml(row.kind); } },
      { label: "Graded", cell: function (row) { return meterHtml(row.gradedCount, a.enrolled); } },
      { label: "Class avg", cell: function (row) { return escapeHtml(row.avgPct == null ? "—" : round1(row.avgPct) + "%"); } }
    ]);
    if (report.mode === "full") {
      extra += itemTableHtml("Assignment folders", report.assignments, [
        { label: "Folder", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Due", cell: function (row) { return escapeHtml(fmtDate(row.due)); } },
        { label: "Submitted", cell: function (row) { return meterHtml(row.submitted, row.enrolled); } }
      ]);
      extra += itemTableHtml("Quizzes", report.quizzes, [
        { label: "Quiz", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Attempted", cell: function (row) { return meterHtml(row.attempted, row.enrolled); } },
        { label: "Avg score", cell: function (row) { return escapeHtml(row.avgScore == null ? "—" : round1(row.avgScore)); } }
      ]);
      extra += itemTableHtml("Discussions", report.discussions, [
        { label: "Forum / topic", cell: function (row) { return escapeHtml(row.forum + " — " + row.topic); } },
        { label: "Students posting", cell: function (row) { return meterHtml(row.posters, row.enrolled); } },
        { label: "Student posts", cell: function (row) { return String(row.posts); } }
      ]);
    }

    return (
      '<div class="cr-kpis">' +
      kpiHtml("Students", String(a.enrolled)) +
      kpiHtml("Class average", a.mean == null ? "—" : round1(a.mean) + "%") +
      kpiHtml("Median", a.median == null ? "—" : round1(a.median) + "%") +
      kpiHtml("Passing (≥" + PASSING_CUTOFF + "%)", a.passingPct == null ? "—" : Math.round(a.passingPct) + "%") +
      kpiHtml("Range", a.min == null ? "—" : round1(a.min) + "–" + round1(a.max) + "%") +
      kpiHtml("Below " + PASSING_CUTOFF + "%", String(a.atRisk.length)) +
      "</div>" +
      '<div class="cr-panel"><h3>Final grade distribution</h3>' +
      histHtml +
      "</div>" +
      '<div class="cr-panel"><h3>Letter grades</h3>' +
      letterHtml +
      "</div>" +
      riskHtml +
      extra
    );
  }

  function getJsPdfCtor() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  function pdfSafe(s) {
    return String(s == null ? "" : s).replace(/[^\x20-\x7E]/g, function (ch) {
      if (ch === "–" || ch === "—" || ch === "−") return "-";
      if (ch === "’" || ch === "‘") return "'";
      if (ch === "“" || ch === "”") return '"';
      return " ";
    });
  }

  async function downloadPdf(report) {
    var JsPDF = getJsPdfCtor();
    if (!JsPDF) throw new Error("PDF library failed to load. Refresh the page and try again.");
    var Brand = window.FacultyDashboardPdfBrand;
    var duckLogo = Brand ? await Brand.loadDuckLogo() : null;
    var doc = new JsPDF({ unit: "pt", format: "letter" });
    var pageW = 612;
    var pageH = 792;
    var margin = 44;
    var y = 0;
    var a = report.analytics;
    var title = report.mode === "full" ? "Full Course Report" : "Grade Analytics Report";

    function drawChrome(isCover) {
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(0, 0, pageW, isCover ? 92 : 58, "F");
      var duckH = isCover ? 52 : 32;
      var duckY = isCover ? 20 : 13;
      var textX = margin;
      if (Brand && duckLogo) {
        var duckW = Brand.drawDuck(doc, duckLogo, margin, duckY, duckH);
        if (duckW) textX = margin + duckW + 12;
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(isCover ? 18 : 12);
      doc.text("Your Institution Faculty Dashboard", textX, isCover ? 32 : 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(isCover ? 14 : 10);
      doc.text(title, textX, isCover ? 54 : 42);
      if (isCover) {
        doc.setFontSize(10);
        doc.text(pdfSafe(report.course.name), textX, 74);
      }
    }

    function newPage() {
      doc.addPage();
      drawChrome(false);
      y = 88;
    }

    function need(h) {
      if (y + h > pageH - 48) newPage();
    }

    function section(label) {
      need(28);
      y += 8;
      doc.setFillColor(232, 245, 240);
      doc.rect(margin, y, pageW - margin * 2, 22, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.text(label, margin + 8, y + 15);
      y += 30;
    }

    function drawSimpleTable(headers, rows, colW) {
      if (!rows.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text("No items found.", margin, y);
        y += 16;
        return;
      }
      need(28);
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
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      for (var r = 0; r < rows.length; r++) {
        need(16);
        if (r % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 3, pageW - margin * 2, 16, "F");
        }
        tx = margin + 6;
        for (var k = 0; k < rows[r].length; k++) {
          doc.text(pdfSafe(String(rows[r][k])).substring(0, 42), tx, y + 9);
          tx += colW[k];
        }
        y += 16;
      }
      y += 8;
    }

    drawChrome(true);
    y = 112;
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Course: " + pdfSafe(report.course.name), margin, y);
    y += 14;
    doc.text(
      "Code: " +
        pdfSafe(report.course.code || "-") +
        "    Term: " +
        pdfSafe(report.course.semester) +
        "    Generated: " +
        report.generatedAt.toLocaleString("en-US"),
      margin,
      y
    );
    y += 28;

    var cardW = 80;
    var gap = 10;
    var cards = [
      ["Students", String(a.enrolled)],
      ["Average", a.mean == null ? "-" : round1(a.mean) + "%"],
      ["Median", a.median == null ? "-" : round1(a.median) + "%"],
      ["Passing", a.passingPct == null ? "-" : Math.round(a.passingPct) + "%"],
      ["Low / high", a.min == null ? "-" : round1(a.min) + "-" + round1(a.max)],
      ["Below " + PASSING_CUTOFF + "%", String(a.atRisk.length)]
    ];
    for (var c = 0; c < cards.length; c++) {
      var x = margin + c * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, cardW, 48, 4, 4, "FD");
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(x, y, cardW, 4, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(cards[c][0], x + 8, y + 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 91, 70);
      doc.text(String(cards[c][1]), x + 8, y + 34);
    }
    y += 68;

    section("Final grade distribution");
    var hist = a.histogram;
    var maxBar = 1;
    for (var i = 0; i < hist.length; i++) if (hist[i] > maxBar) maxBar = hist[i];
    var plotH = 90;
    var plotW = pageW - margin * 2;
    var barGap = 6;
    var barW = (plotW - barGap * 9) / 10;
    var labels = histLabels();
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + plotH, margin + plotW, y + plotH);
    for (var b = 0; b < 10; b++) {
      var bh = maxBar ? (hist[b] / maxBar) * (plotH - 8) : 0;
      var bx = margin + b * (barW + barGap);
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(bx, y + plotH - bh, barW, Math.max(bh, 1), "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(30, 41, 59);
      doc.text(String(hist[b]), bx + barW / 2, y + plotH - bh - 3, { align: "center" });
      doc.setTextColor(100, 116, 139);
      doc.text(labels[b], bx + barW / 2, y + plotH + 12, { align: "center" });
    }
    y += plotH + 28;

    section("Letter grades");
    var letterOrder = ["A", "B", "C", "D", "F"];
    var colors = {
      A: [5, 150, 105],
      B: [13, 148, 136],
      C: [217, 119, 6],
      D: [234, 88, 12],
      F: [220, 38, 38]
    };
    var lw = 90;
    for (var L = 0; L < letterOrder.length; L++) {
      var lx = margin + L * (lw + 10);
      var col = colors[letterOrder[L]];
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(lx, y, lw, 36, 4, 4, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(letterOrder[L] + "  " + a.letters[letterOrder[L]], lx + 12, y + 23);
    }
    y += 52;

    section("Students below " + PASSING_CUTOFF + "%");
    if (!a.atRisk.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text("No graded students are currently below " + PASSING_CUTOFF + "%.", margin, y);
      y += 18;
    } else {
      drawSimpleTable(
        ["Student", "ID", "Final %", "Letter"],
        a.atRisk.map(function (st) {
          return [st.lastName + ", " + st.firstName, st.orgDefinedId || "-", round1(st.percent), st.letter || "-"];
        }),
        [220, 110, 80, 70]
      );
    }

    if (report.gradeItems && report.gradeItems.length) {
      section("Gradebook items");
      drawSimpleTable(
        ["Item", "Type", "Graded", "Class avg"],
        report.gradeItems.map(function (it) {
          return [it.name, it.kind, it.gradedCount + "/" + a.enrolled, it.avgPct == null ? "-" : round1(it.avgPct) + "%"];
        }),
        [240, 80, 80, 80]
      );
    }

    if (report.mode === "full") {
      section("Assignment folders");
      drawSimpleTable(
        ["Folder", "Due", "Submitted"],
        (report.assignments || []).map(function (it) {
          return [it.name, fmtDate(it.due), it.submitted + "/" + it.enrolled];
        }),
        [260, 120, 100]
      );
      section("Quizzes");
      drawSimpleTable(
        ["Quiz", "Attempted", "Avg score"],
        (report.quizzes || []).map(function (it) {
          return [it.name, it.attempted + "/" + it.enrolled, it.avgScore == null ? "-" : round1(it.avgScore)];
        }),
        [280, 110, 90]
      );
      section("Discussions");
      drawSimpleTable(
        ["Forum / topic", "Students posting", "Posts"],
        (report.discussions || []).map(function (it) {
          return [it.forum + " - " + it.topic, it.posters + "/" + it.enrolled, String(it.posts)];
        }),
        [300, 120, 60]
      );
    }

    section("Class roster (final grades)");
    drawSimpleTable(
      ["Student", "ID", "Final %", "Letter", "Displayed"],
      report.students.map(function (st) {
        return [
          st.lastName + ", " + st.firstName,
          st.orgDefinedId || "-",
          st.percent == null ? "-" : round1(st.percent),
          st.letter || "-",
          st.displayed || "-"
        ];
      }),
      [190, 90, 70, 50, 90]
    );

    var pageCount = doc.getNumberOfPages();
    for (var p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFillColor(248, 250, 252);
      doc.rect(0, pageH - 36, pageW, 36, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(
        "FERPA: Education records. Use only for legitimate educational purposes at Your Institution.",
        margin,
        pageH - 20
      );
      doc.text("Page " + p + " of " + pageCount, pageW - margin, pageH - 20, { align: "right" });
    }

    var prefix = report.mode === "full" ? "CourseReport" : "GradeAnalytics";
    doc.save(
      prefix +
        "_" +
        sanitizeFilenamePart(report.course.code || report.course.name) +
        "_" +
        String(report.course.semester).replace(/\//g, "-") +
        ".pdf"
    );
  }

  async function exportSpreadsheet(format, course, statusEl) {
    var orgUnitId = String(course.OrgUnit.Id);
    setStatus(statusEl, "", "Fetching classlist and final grades…");
    var classlist = await getClasslist(orgUnitId);
    var gradeMap = await getFinalGradeDetailsForCourse(orgUnitId);
    var rows = buildGradeRows(course, classlist, gradeMap);
    if (rows.length === 0) {
      setStatus(
        statusEl,
        "error",
        "No student enrollments found in the classlist, or the classlist could not be loaded."
      );
      return;
    }
    var courseSem = getSemesterCodeFromCourseCode(course.OrgUnit.Code || "") || DEFAULT_SEMESTER_CODE;
    var base =
      "grades_" +
      sanitizeFilenamePart(course.OrgUnit.Code || course.OrgUnit.Name || orgUnitId) +
      "_" +
      courseSem.replace(/\//g, "-");
    if (format === "csv") {
      triggerDownload(new Blob([rowsToCsv(rows, COLUMNS)], { type: "text/csv;charset=utf-8" }), base + ".csv");
    } else {
      if (typeof XLSX === "undefined" || !XLSX.utils) {
        setStatus(statusEl, "error", "Excel export library failed to load. Refresh the page or use CSV.");
        return;
      }
      var aoa = [COLUMNS];
      for (var r = 0; r < rows.length; r++) {
        var line = [];
        for (var c = 0; c < COLUMNS.length; c++) line.push(rows[r][COLUMNS[c]]);
        aoa.push(line);
      }
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "FinalGrades");
      var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      triggerDownload(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        base + ".xlsx"
      );
    }
    setStatus(statusEl, "success", "Exported " + rows.length + " student row(s) with final calculated grades.");
  }

  async function loadCoursesIntoSelect(selectEl, statusEl) {
    coursesByOrgUnitId = {};
    setStatus(statusEl, "", "Loading your " + TERM_RANGE_LABEL + " courses…");
    selectEl.innerHTML = "";
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Select a course —";
    selectEl.appendChild(opt0);
    var enrollments = await getAllMyEnrollments();
    var courses = filterInstructorCourses(enrollments);
    if (courses.length === 0) {
      setStatus(
        statusEl,
        "error",
        "No courses found for " +
          TERM_RANGE_LABEL +
          " where you have an instructor or teaching role. If you expect to see courses, confirm you are enrolled with the correct role."
      );
      return;
    }
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      var idStr = String(c.OrgUnit.Id);
      coursesByOrgUnitId[idStr] = {
        OrgUnit: { Id: c.OrgUnit.Id, Name: c.OrgUnit.Name, Code: c.OrgUnit.Code }
      };
      var opt = document.createElement("option");
      opt.value = idStr;
      opt.textContent = (c.OrgUnit.Name || "Course") + " (" + (c.OrgUnit.Code || "") + ")";
      selectEl.appendChild(opt);
    }
    setStatus(
      statusEl,
      "success",
      "Loaded " + courses.length + " course(s) for " + TERM_RANGE_LABEL + ". Choose a report type and generate."
    );
  }

  function syncReportTypeUi() {
    var type = selectedReportType();
    var formatGroup = document.getElementById("exportFormatGroup");
    var btnLabel = document.getElementById("exportBtnLabel");
    var pdfBtn = document.getElementById("pdfBtn");
    var cards = document.querySelectorAll(".cr-type-card");
    for (var i = 0; i < cards.length; i++) {
      var input = cards[i].querySelector("input");
      if (input && input.checked) cards[i].classList.add("is-selected");
      else cards[i].classList.remove("is-selected");
    }
    if (formatGroup) formatGroup.hidden = type !== "spreadsheet";
    if (btnLabel) {
      if (type === "spreadsheet") btnLabel.textContent = "Download grade spreadsheet";
      else if (type === "analytics") btnLabel.textContent = "Generate grade analytics";
      else btnLabel.textContent = "Generate full course report";
    }
    if (pdfBtn && type === "spreadsheet") pdfBtn.hidden = true;
  }

  function init() {
    var form = document.getElementById("gradeExportForm");
    var selectEl = document.getElementById("courseSelector");
    var statusEl = document.getElementById("exportMessage");
    var btn = document.getElementById("exportBtn");
    var pdfBtn = document.getElementById("pdfBtn");
    var previewSection = document.getElementById("reportPreviewSection");
    var previewTitle = document.getElementById("reportPreviewTitle");
    var preview = document.getElementById("reportPreview");
    if (!form || !selectEl || !statusEl || !btn) return;

    loadCoursesIntoSelect(selectEl, statusEl).catch(function (e) {
      console.error(e);
      setStatus(statusEl, "error", "Could not load courses: " + (e.message || String(e)));
    });

    var typeInputs = form.querySelectorAll('input[name="reportType"]');
    for (var t = 0; t < typeInputs.length; t++) {
      typeInputs[t].addEventListener("change", syncReportTypeUi);
    }
    syncReportTypeUi();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var course = getSelectedCourse(selectEl);
      if (!course) {
        setStatus(statusEl, "error", "Please select a course.");
        return;
      }
      var type = selectedReportType();
      btn.disabled = true;
      if (pdfBtn) pdfBtn.hidden = true;

      var run =
        type === "spreadsheet"
          ? exportSpreadsheet(document.getElementById("exportFormat").value, course, statusEl)
          : buildReport(course, type, function (msg) {
              setStatus(statusEl, "", msg);
            }).then(function (report) {
              lastReport = report;
              if (previewSection) previewSection.hidden = false;
              if (previewTitle) previewTitle.textContent = type === "full" ? "Full course report" : "Grade analytics";
              if (preview) preview.innerHTML = renderPreview(report);
              if (pdfBtn) pdfBtn.hidden = false;
              setStatus(
                statusEl,
                "success",
                type === "full"
                  ? "Full course report is ready. Review it below, then download the PDF."
                  : "Grade analytics are ready. Review them below, then download the PDF."
              );
            });

      Promise.resolve(run)
        .catch(function (err) {
          console.error(err);
          setStatus(
            statusEl,
            "error",
            "Report failed: " + (err.message || String(err)) + ". Ensure you are on Brightspace and try again."
          );
        })
        .then(function () {
          btn.disabled = false;
        });
    });

    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        if (!lastReport) {
          setStatus(statusEl, "error", "Generate a visual report first.");
          return;
        }
        downloadPdf(lastReport)
          .then(function () {
            setStatus(statusEl, "success", "PDF downloaded.");
          })
          .catch(function (err) {
            setStatus(statusEl, "error", err.message || String(err));
          });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
