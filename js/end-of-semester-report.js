/**
 * End of Semester Course Report
 * Class-level retrospective (no student names): grades, access, content,
 * due dates, quizzes, discussions, assignments, inferred help-seeking,
 * and next-term suggestions.
 */
(function () {
  "use strict";

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";
  var API_VERSION_GRADES_BULK = "1.86";
  var PASSING_CUTOFF = 70;
  var GREEN = [15, 91, 70];
  var LOW_AVG = 70;
  var LOW_COMPLETION = 70;
  var HELP_RE =
    /\b(help me|need help|can you help|please help|i('m| am) stuck|i('m| am) confused|don'?t understand|dont understand|i don'?t get|how do i|how can i|can someone|i('m| am) lost|struggling with|not sure how|what does this mean|i have a question|could you explain)\b/i;
  var PRIVATE_FORUM_RE = /private student|1-on-1|one-on-one|one on one|1:1|private conversation/;

  var lastReport = null;
  var coursesById = {};

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function activeSemesterCode() {
    return semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    return semesterApi() ? semesterApi().getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function $(id) {
    return document.getElementById(id);
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
    if (Array.isArray(data.Quizzes)) return data.Quizzes;
    if (Array.isArray(data.Forums)) return data.Forums;
    if (Array.isArray(data.Topics)) return data.Topics;
    if (Array.isArray(data.Posts)) return data.Posts;
    if (Array.isArray(data.Attempts)) return data.Attempts;
    if (Array.isArray(data.Modules)) return data.Modules;
    if (Array.isArray(data.Structure)) return data.Structure;
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

  function setStatus(type, text) {
    var el = $("eosMessage");
    if (!el) return;
    el.style.display = "block";
    el.className = "message-container" + (type ? " message-" + type : "");
    el.textContent = text;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function round1(n) {
    if (n == null || isNaN(n)) return null;
    return Math.round(n * 10) / 10;
  }

  function fmtPct(n) {
    return n == null || isNaN(n) ? "—" : round1(n) + "%";
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
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function mean(nums) {
    if (!nums || !nums.length) return null;
    var t = 0;
    for (var i = 0; i < nums.length; i++) t += nums[i];
    return t / nums.length;
  }

  function median(nums) {
    if (!nums || !nums.length) return null;
    var a = nums.slice().sort(function (x, y) {
      return x - y;
    });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function stdev(nums) {
    if (!nums || nums.length < 2) return null;
    var m = mean(nums);
    var s = 0;
    for (var i = 0; i < nums.length; i++) s += (nums[i] - m) * (nums[i] - m);
    return Math.sqrt(s / (nums.length - 1));
  }

  function uniqueCount(ids) {
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

  function letterFromPercent(p) {
    if (p == null || isNaN(p)) return "";
    if (p >= 90) return "A";
    if (p >= 80) return "B";
    if (p >= 70) return "C";
    if (p >= 60) return "D";
    return "F";
  }

  function histLabels() {
    return ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-100"];
  }

  function isoWeekKey(date) {
    var d = new Date(date);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1);
    var monday = new Date(d);
    monday.setDate(diff);
    var y = monday.getFullYear();
    var m = String(monday.getMonth() + 1).padStart(2, "0");
    var dd = String(monday.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function weekLabel(key) {
    if (!key) return "Undated";
    var start = new Date(key + "T00:00:00");
    var end = new Date(start);
    end.setDate(end.getDate() + 6);
    return (
      start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " – " +
      end.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    );
  }

  function stripHtml(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  function postText(post) {
    if (!post) return "";
    var msg = post.Message;
    if (msg && typeof msg === "object") return stripHtml(msg.Html || msg.Text || "");
    return stripHtml(post.Message || post.Body || post.Html || post.Text || "");
  }

  function isHelpSeekingText(text) {
    if (!text) return false;
    return HELP_RE.test(text);
  }

  function isPrivateForumName(name) {
    return PRIVATE_FORUM_RE.test(String(name || "").toLowerCase());
  }

  function isDemoStudent(member) {
    if (!member) return false;
    return (member.FirstName || "").trim() === "ZZDemo" && (member.LastName || "").trim() === "ZZStudent";
  }

  function isClasslistStudent(member) {
    var roleName = (
      member.ClasslistRoleDisplayName ||
      (member.Role && member.Role.Name) ||
      member.RoleName ||
      ""
    ).toLowerCase();
    if (/instructor|designer|admin|grader|faculty|teacher/.test(roleName) && roleName.indexOf("student") < 0) {
      return false;
    }
    if (roleName.indexOf("student") >= 0 || roleName.indexOf("learner") >= 0) return true;
    var rid = member.RoleId != null ? member.RoleId : member.Role && member.Role.Id;
    return rid === 3 || rid === 5 || rid === 101;
  }

  function studentUserId(member) {
    var id = member.Identifier != null ? member.Identifier : member.UserId != null ? member.UserId : member.Id;
    return id != null ? String(id) : "";
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

  function percentFromGradeValue(gv) {
    if (!gv) return null;
    var pointsNum = gv.PointsNumerator;
    var pointsDen = gv.PointsDenominator;
    if (pointsNum != null && pointsDen != null && pointsDen > 0) return (pointsNum / pointsDen) * 100;
    if (gv.WeightedDenominator != null && gv.WeightedDenominator > 0 && gv.WeightedNumerator != null) {
      return (gv.WeightedNumerator / gv.WeightedDenominator) * 100;
    }
    var displayed = gv.DisplayedGrade != null ? String(gv.DisplayedGrade).replace("%", "").trim() : "";
    var n = parseFloat(displayed);
    return isNaN(n) ? null : n;
  }

  function isReportableGradeItem(item) {
    if (!item) return false;
    var type = item.GradeObjectType != null ? item.GradeObjectType : item.GradeType;
    var name = String(item.GradeObjectTypeName || item.GradeType || "").toLowerCase();
    if (type === 4 || type === 7 || type === 8 || type === 9) return false;
    if (/text|category|final/.test(name)) return false;
    return !!(item.Name || item.ShortName);
  }

  function classifyToolKind(item) {
    var tool = (item && item.AssociatedTool) || {};
    var blob = [tool.ToolName, tool.Name, tool.ToolId, item && item.Name, item && item.CategoryName]
      .join(" ")
      .toLowerCase();
    if (/quiz/.test(blob)) return "Quiz";
    if (/dropbox|assign/.test(blob)) return "Assignment";
    if (/discuss/.test(blob)) return "Discussion";
    return "Grade item";
  }

  function parseTime(iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }

  function daysBeforeAsOf(iso, asOfMs) {
    var t = parseTime(iso);
    if (t == null || asOfMs == null) return null;
    return (asOfMs - t) / 86400000;
  }

  function latestDueMs(assignments, quizzes, discussions) {
    var best = null;
    function consider(iso) {
      var t = parseTime(iso);
      if (t == null) return;
      if (best == null || t > best) best = t;
    }
    var a;
    for (a = 0; a < (assignments || []).length; a++) consider(assignments[a].due);
    for (a = 0; a < (quizzes || []).length; a++) consider(quizzes[a].due || quizzes[a].end);
    for (a = 0; a < (discussions || []).length; a++) consider(discussions[a].due || discussions[a].end);
    return best;
  }

  function resolveAccessAsOf(courseEndIso, assignments, quizzes, discussions) {
    var now = Date.now();
    var endMs = parseTime(courseEndIso);
    if (endMs != null) {
      if (endMs < now) {
        return { ms: endMs, ended: true, source: "course-end", iso: new Date(endMs).toISOString() };
      }
      return { ms: now, ended: false, source: "today", iso: new Date(now).toISOString() };
    }
    var lastDue = latestDueMs(assignments, quizzes, discussions);
    if (lastDue != null && lastDue < now - 7 * 86400000) {
      return { ms: lastDue, ended: true, source: "last-due", iso: new Date(lastDue).toISOString() };
    }
    return { ms: now, ended: false, source: "today", iso: new Date(now).toISOString() };
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
      wrap.SubmissionDate || wrap.SubmittedDate || wrap.DateSubmitted || wrap.CompletionDate || wrap.CreatedDate || null;
    if (flat && !dates.length) dates.push(flat);
    return dates;
  }

  function earliestDate(dates) {
    var best = null;
    for (var i = 0; i < dates.length; i++) {
      var t = new Date(dates[i]).getTime();
      if (isNaN(t)) continue;
      if (best == null || t < best) best = t;
    }
    return best;
  }

  function kpiHtml(label, value, hint) {
    return (
      '<div class="cr-kpi">' +
      '<div class="cr-kpi-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="cr-kpi-value">' +
      escapeHtml(value) +
      "</div>" +
      (hint ? '<div class="eos-kpi-hint">' + escapeHtml(hint) + "</div>" : "") +
      "</div>"
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
      total +
      " (" +
      pct +
      "%)"
    );
  }

  function itemTableHtml(title, rows, cols, emptyText) {
    if (!rows || !rows.length) {
      return (
        '<div class="cr-panel"><h3>' +
        escapeHtml(title) +
        '</h3><p class="cr-muted">' +
        escapeHtml(emptyText || "No items found, or this tool is not used in the course.") +
        "</p></div>"
      );
    }
    var html =
      '<div class="cr-panel"><h3>' +
      escapeHtml(title) +
      '</h3><div class="cr-table-wrap"><table class="cr-table"><thead><tr>';
    for (var c = 0; c < cols.length; c++) html += "<th>" + escapeHtml(cols[c].label) + "</th>";
    html += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r++) {
      var rowClass = rows[r]._flag ? ' class="eos-flag"' : "";
      html += "<tr" + rowClass + ">";
      for (var k = 0; k < cols.length; k++) html += "<td>" + cols[k].cell(rows[r]) + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div></div>";
    return html;
  }

  async function getClasslist(orgUnitId) {
    var allStudents = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    while (nextUrl && pageCount < 40) {
      pageCount++;
      if (seenUrls[nextUrl]) break;
      seenUrls[nextUrl] = true;
      try {
        var data = await BrightspaceFetch(nextUrl);
        var objects = (data && data.Objects) || [];
        for (var i = 0; i < objects.length; i++) allStudents.push(objects[i]);
        var next = data && data.Next ? String(data.Next) : "";
        if (!next || !objects.length) {
          nextUrl = null;
        } else if (next.indexOf("/d2l/api/") >= 0) {
          var parts = next.split("/d2l/api/");
          nextUrl = parts.length > 1 ? "/d2l/api/" + parts[1] : null;
        } else if (next.indexOf("/") === 0) {
          nextUrl = next;
        } else {
          nextUrl =
            "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
        }
      } catch (e) {
        break;
      }
    }
    return allStudents;
  }

  async function getFinalPercents(orgUnitId, studentSet) {
    var percents = [];
    var letters = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    var histogram = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var graded = 0;
    var passing = 0;
    var below = 0;
    var nextUrl = "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/?pageSize=200";
    var seen = {};
    var pages = 0;
    while (nextUrl && pages < 40) {
      if (seen[nextUrl]) break;
      seen[nextUrl] = true;
      pages++;
      var data = await BrightspaceFetchOptional(nextUrl);
      if (!data) break;
      var items = data.Items || data.Objects || [];
      for (var i = 0; i < items.length; i++) {
        var row = items[i];
        var gradeValue = row.GradeValue || row;
        var user = row.User || {};
        var userId = String(user.Identifier || row.UserId || "");
        if (!userId || !studentSet[userId]) continue;
        if (gradeValue && gradeValue.GradeObjectType != null && gradeValue.GradeObjectType !== 7) continue;
        var pct = percentFromGradeValue(gradeValue);
        if (pct == null) continue;
        graded++;
        percents.push(pct);
        if (pct >= PASSING_CUTOFF) passing++;
        else below++;
        var letter = letterFromPercent(pct);
        if (letters[letter] != null) letters[letter]++;
        var bucket = pct >= 100 ? 9 : Math.max(0, Math.min(9, Math.floor(pct / 10)));
        histogram[bucket]++;
      }
      if (data.Next) {
        var rel = toRelativeApiUrl(data.Next);
        nextUrl = rel || nextUrl;
        if (!rel) break;
      } else {
        nextUrl = null;
      }
    }
    return {
      percents: percents,
      letters: letters,
      histogram: histogram,
      graded: graded,
      passing: passing,
      below: below,
      mean: mean(percents),
      median: median(percents),
      min: percents.length ? Math.min.apply(null, percents) : null,
      max: percents.length ? Math.max.apply(null, percents) : null,
      stdev: stdev(percents),
      passingPct: graded ? (passing / graded) * 100 : null
    };
  }

  async function collectGradeItems(orgUnitId, studentIds, onProgress) {
    var raw = await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/");
    var items = asArray(raw).filter(isReportableGradeItem);
    if (items.length > 100) items = items.slice(0, 100);
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
      var avgPct = mean(pcts);
      return {
        name: item.Name || item.ShortName || "Grade item",
        kind: classifyToolKind(item),
        gradedCount: gradedCount,
        avgPct: avgPct,
        _flag: avgPct != null && avgPct < LOW_AVG
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
      var late = [];
      var due = folder.DueDate || folder.DueDateTime || "";
      var dueMs = due ? new Date(due).getTime() : NaN;
      for (var i = 0; i < subs.length; i++) {
        var row = subs[i];
        var uid = entityUserId(row.Entity || row.entity || row);
        if (!uid || !studentSet[uid]) continue;
        var files = row.Submissions || row.submissions || [];
        var status = row.Status;
        var dates = submissionDatesFromEntity(row);
        var hasWork = files.length > 0 || dates.length > 0 || status === 1 || status === 2 || status === 3 || status === "1";
        if (!hasWork) continue;
        submitted.push(uid);
        var first = earliestDate(dates);
        if (!isNaN(dueMs) && first != null && first > dueMs) late.push(uid);
      }
      var submittedN = uniqueCount(submitted);
      var rate = enrolled ? (submittedN / enrolled) * 100 : 0;
      return {
        name: folder.Name || folder.FolderName || "Assignment",
        due: due,
        availabilityStart: folder.StartDate || (folder.Availability && folder.Availability.StartDate) || "",
        availabilityEnd: folder.EndDate || (folder.Availability && folder.Availability.EndDate) || "",
        submitted: submittedN,
        late: uniqueCount(late),
        enrolled: enrolled,
        rate: rate,
        _flag: rate < LOW_COMPLETION
      };
    });
    return rows.filter(Boolean);
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
      var attemptsRaw = await fetchAllPaged(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + qid + "/attempts/",
        30
      );
      var attempts = flattenAttempts(attemptsRaw);
      var attempted = [];
      var pcts = [];
      var attemptCounts = {};
      for (var i = 0; i < attempts.length; i++) {
        var att = attempts[i];
        var uid = att.UserId != null ? String(att.UserId) : att.User && att.User.Id != null ? String(att.User.Id) : "";
        if (!uid || !studentSet[uid]) continue;
        var completed = att.Completed || att.IsCompleted || att.Score != null || att.Percent != null;
        if (!completed) continue;
        attempted.push(uid);
        attemptCounts[uid] = (attemptCounts[uid] || 0) + 1;
        var pct = null;
        if (att.Percent != null && !isNaN(Number(att.Percent))) pct = Number(att.Percent);
        else if (att.Score != null && att.PossibleScore > 0) pct = (Number(att.Score) / Number(att.PossibleScore)) * 100;
        else if (att.Score != null && quiz.PossibleScore > 0) pct = (Number(att.Score) / Number(quiz.PossibleScore)) * 100;
        if (pct != null && !isNaN(pct)) pcts.push(pct);
      }
      var attemptVals = [];
      for (var u in attemptCounts) {
        if (Object.prototype.hasOwnProperty.call(attemptCounts, u)) attemptVals.push(attemptCounts[u]);
      }
      var attemptedN = uniqueCount(attempted);
      var avgPct = mean(pcts);
      var avgAttempts = mean(attemptVals);
      return {
        name: quiz.Name || "Quiz",
        due: quiz.DueDate || "",
        start: quiz.StartDate || "",
        end: quiz.EndDate || "",
        isActive: quiz.IsActive !== false,
        attempted: attemptedN,
        enrolled: enrolled,
        avgPct: avgPct,
        avgAttempts: avgAttempts,
        rate: enrolled ? (attemptedN / enrolled) * 100 : 0,
        _flag: (avgPct != null && avgPct < LOW_AVG) || (enrolled && attemptedN / enrolled < LOW_COMPLETION / 100)
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
    var publicTopics = [];
    var privateSummary = {
      forums: 0,
      topics: 0,
      studentPosts: 0,
      studentPosters: 0,
      helpPosts: 0
    };
    var privatePosterIds = [];

    for (var f = 0; f < forums.length; f++) {
      var forum = forums[f];
      var forumName = forum.Name || "Forum";
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      var isPrivate = isPrivateForumName(forumName);
      if (isPrivate) privateSummary.forums++;
      var topics = asArray(
        await BrightspaceFetchOptional(
          "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + fid + "/topics/"
        )
      );
      for (var t = 0; t < topics.length; t++) {
        var topic = topics[t];
        var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
        if (tid == null) continue;
        if (isPrivate) privateSummary.topics++;
        if (onProgress) {
          onProgress("Reading discussion: " + forumName + " / " + (topic.Name || "topic") + "…");
        }
        var posts = [];
        for (var page = 1; page <= 20; page++) {
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
        var helpCount = 0;
        var helpPosterIds = [];
        for (var i = 0; i < posts.length; i++) {
          var post = posts[i];
          if (post.IsDeleted) continue;
          var uid =
            post.PostingUserId != null ? String(post.PostingUserId) : post.UserId != null ? String(post.UserId) : "";
          if (!uid || !studentSet[uid]) continue;
          posterIds.push(uid);
          postCount++;
          var text = postText(post);
          if (isHelpSeekingText(text)) {
            helpCount++;
            helpPosterIds.push(uid);
          }
          if (isPrivate) {
            privateSummary.studentPosts++;
            privatePosterIds.push(uid);
            if (isHelpSeekingText(text)) privateSummary.helpPosts++;
          }
        }
        if (isPrivate) continue;
        var posters = uniqueCount(posterIds);
        publicTopics.push({
          forum: forumName,
          topic: topic.Name || "Topic",
          start: topic.StartDate || "",
          end: topic.EndDate || "",
          due: topic.DueDate || topic.EndDate || "",
          posters: posters,
          posts: postCount,
          helpPosts: helpCount,
          helpStudents: uniqueCount(helpPosterIds),
          enrolled: enrolled,
          rate: enrolled ? (posters / enrolled) * 100 : 0,
          _flag: enrolled ? posters / enrolled < 0.5 || helpCount >= 3 : false
        });
      }
    }
    privateSummary.studentPosters = uniqueCount(privatePosterIds);
    return { publicTopics: publicTopics, privateSummary: privateSummary };
  }

  function isContentTopic(node) {
    if (!node) return false;
    if (node.ModuleId != null && node.TopicId == null && (node.Modules || node.Topics || node.Structure)) return false;
    if (node.TopicId != null) return true;
    if (node.Type === 1) return true;
    if (node.TypeIdentifier === "Topic") return true;
    if (node.TopicType != null && !node.Modules) return true;
    return false;
  }

  function walkContent(nodes, pathParts, modules, topics) {
    if (!nodes || !nodes.length) return;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var title = node.Title || node.Name || node.ShortTitle || "Untitled";
      var currentPath = pathParts.concat([title]);
      if (isContentTopic(node)) {
        var topicId = node.TopicId != null ? node.TopicId : node.Id;
        topics.push({
          id: topicId != null ? String(topicId) : "",
          title: title,
          path: currentPath.join(" › "),
          hidden: !!(node.IsHidden || node.Hidden),
          start: node.StartDateTime || node.StartDate || "",
          end: node.EndDateTime || node.EndDate || "",
          type: node.TopicType || node.TypeIdentifier || "",
          visited: 0
        });
      } else {
        var children = [];
        if (Array.isArray(node.Modules)) {
          for (var m = 0; m < node.Modules.length; m++) children.push(node.Modules[m]);
        }
        if (Array.isArray(node.Topics)) {
          for (var tp = 0; tp < node.Topics.length; tp++) children.push(node.Topics[tp]);
        }
        if (!children.length && Array.isArray(node.Structure)) {
          for (var st = 0; st < node.Structure.length; st++) children.push(node.Structure[st]);
        }
        var childTopics = 0;
        var childModules = 0;
        for (var c = 0; c < children.length; c++) {
          if (isContentTopic(children[c])) childTopics++;
          else childModules++;
        }
        modules.push({
          title: title,
          path: currentPath.join(" › "),
          hidden: !!(node.IsHidden || node.Hidden),
          start: node.StartDateTime || node.StartDate || "",
          end: node.EndDateTime || node.EndDate || "",
          topicCount: childTopics,
          moduleCount: childModules,
          empty: childTopics === 0 && childModules === 0
        });
        walkContent(children, currentPath, modules, topics);
      }
    }
  }

  function tocRoots(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Modules)) return data.Modules;
    if (Array.isArray(data.Structure)) return data.Structure;
    return [];
  }

  function topicIdFromProgress(row) {
    if (!row) return "";
    var id =
      row.ObjectId != null
        ? row.ObjectId
        : row.TopicId != null
          ? row.TopicId
          : row.OrgUnitObjectId != null
            ? row.OrgUnitObjectId
            : row.Id;
    return id != null ? String(id) : "";
  }

  function progressWasVisited(row) {
    if (!row) return false;
    if (row.Visited === true || row.IsVisited === true || row.Completed === true || row.IsComplete === true) return true;
    if (row.NumVisits != null && Number(row.NumVisits) > 0) return true;
    if (row.LastVisited || row.LastAccessed || row.CompletedDate || row.DateCompleted) return true;
    return false;
  }

  function applyVisitMap(topics, visitMap, extraTopics) {
    var seen = {};
    for (var t = 0; t < topics.length; t++) {
      topics[t].visited = visitMap[topics[t].id] || 0;
      if (topics[t].id) seen[topics[t].id] = true;
    }
    if (!extraTopics) return;
    for (var id in extraTopics) {
      if (!Object.prototype.hasOwnProperty.call(extraTopics, id) || seen[id]) continue;
      var meta = extraTopics[id];
      topics.push({
        id: id,
        title: meta.title || "Topic",
        path: meta.module ? meta.module + " › " + meta.title : meta.title || "Topic",
        hidden: false,
        start: "",
        end: "",
        type: "hub",
        visited: visitMap[id] || 0
      });
    }
  }

  async function collectContent(orgUnitId, studentIds, onProgress) {
    if (onProgress) onProgress("Reading content structure…");
    var toc = await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/content/toc");
    var roots = tocRoots(toc);
    if (!roots.length) {
      var root = await BrightspaceFetchOptional("/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/content/root/");
      roots = tocRoots(root);
    }
    var modules = [];
    var topics = [];
    walkContent(roots, [], modules, topics);
    var visitAvailable = false;
    var visitSource = "";
    var visitFailures = 0;

    if (topics.length && studentIds.length) {
      var visitMap = {};
      var sample = await mapPool(studentIds, 4, async function (uid, idx) {
        if (onProgress && idx % 5 === 0) {
          onProgress("Reading content visits " + (idx + 1) + " of " + studentIds.length + "…");
        }
        var data = await BrightspaceFetchOptional(
          "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/content/userprogress/" + uid + "/"
        );
        if (!data) {
          visitFailures++;
          return null;
        }
        var rows = asArray(data);
        var seen = {};
        for (var i = 0; i < rows.length; i++) {
          if (!progressWasVisited(rows[i])) continue;
          var tid = topicIdFromProgress(rows[i]);
          if (!tid || seen[tid]) continue;
          seen[tid] = true;
          visitMap[tid] = (visitMap[tid] || 0) + 1;
        }
        return true;
      });
      var success = 0;
      for (var p = 0; p < sample.length; p++) if (sample[p]) success++;
      visitAvailable = success > 0 && success >= Math.min(3, studentIds.length) * 0.3;
      if (visitAvailable) {
        applyVisitMap(topics, visitMap, null);
        visitSource = "userprogress";
      }
    }
    return {
      modules: modules,
      topics: topics,
      visitAvailable: visitAvailable,
      visitSource: visitSource,
      visitFailures: visitFailures
    };
  }

  function accessBuckets(lastAccessedList, asOf) {
    var buckets = {
      never: 0,
      d22: 0,
      d8to21: 0,
      d1to7: 0,
      d1: 0,
      asOf: asOf && asOf.iso ? asOf.iso : "",
      ended: !!(asOf && asOf.ended),
      source: (asOf && asOf.source) || "today"
    };
    var asOfMs = asOf && asOf.ms != null ? asOf.ms : Date.now();
    for (var i = 0; i < lastAccessedList.length; i++) {
      var days = daysBeforeAsOf(lastAccessedList[i], asOfMs);
      if (days == null) buckets.never++;
      else if (days <= 1) buckets.d1++;
      else if (days <= 7) buckets.d1to7++;
      else if (days <= 21) buckets.d8to21++;
      else buckets.d22++;
    }
    return buckets;
  }

  function buildDueCalendar(assignments, quizzes, discussions) {
    var weeks = {};
    function add(kind, item) {
      var due = item.due || item.end || "";
      var key = due ? isoWeekKey(due) : "none";
      if (!weeks[key]) weeks[key] = { key: key, label: key === "none" ? "No due date" : weekLabel(key), items: [] };
      weeks[key].items.push({ kind: kind, name: item.name || item.topic || "Item", due: due });
    }
    for (var a = 0; a < assignments.length; a++) add("Assignment", assignments[a]);
    for (var q = 0; q < quizzes.length; q++) add("Quiz", quizzes[q]);
    for (var d = 0; d < discussions.length; d++) {
      add("Discussion", { name: discussions[d].forum + " — " + discussions[d].topic, due: discussions[d].due });
    }
    var list = [];
    for (var k in weeks) {
      if (Object.prototype.hasOwnProperty.call(weeks, k)) list.push(weeks[k]);
    }
    list.sort(function (x, y) {
      if (x.key === "none") return 1;
      if (y.key === "none") return -1;
      return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
    });
    return list;
  }

  function sortByFlagThenName(rows, numericKey) {
    return rows.slice().sort(function (a, b) {
      var av = a[numericKey];
      var bv = b[numericKey];
      if (av == null && bv == null) return String(a.name || a.topic).localeCompare(String(b.name || b.topic));
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
  }

  function buildSuggestions(report) {
    var out = [];
    var a = report.analytics;
    var enrolled = a.enrolled || 0;
    var content = report.content;
    var access = report.access;

    function add(sev, title, body) {
      out.push({ severity: sev, title: title, body: body });
    }

    if (a.passingPct != null && a.passingPct < 75 && a.graded >= 5) {
      add(
        "high",
        "Passing rate is below 75%",
        "About " +
          Math.round(a.passingPct) +
          "% of graded students finished at or above " +
          PASSING_CUTOFF +
          "%. For the next offering, review weighting, add earlier low-stakes checks, and use Intelligent Agents for students who drop below the cutoff after the first major item."
      );
    } else if (a.passingPct != null && a.passingPct >= 90 && a.graded >= 5) {
      add(
        "positive",
        "Strong overall pass rate",
        Math.round(a.passingPct) +
          "% of graded students met the " +
          PASSING_CUTOFF +
          "% cutoff. Keep the structures that are working, and look at the few low items below for remaining friction."
      );
    }

    if (a.stdev != null && a.stdev >= 20 && a.graded >= 8) {
      add(
        "medium",
        "Grades are widely spread",
        "Standard deviation is " +
          round1(a.stdev) +
          " percentage points. A wide spread often means some students never found a foothold. Consider a required first-week activity, clearer module checklists, and earlier outreach on missing work."
      );
    }

    if (access.never > 0 && enrolled) {
      var neverPct = Math.round((access.never / enrolled) * 100);
      add(
        access.never / enrolled >= 0.15 ? "high" : "medium",
        neverPct + "% of the class never logged in (or has no last-access date)",
        "Next term, pair a first-week login Intelligent Agent with a graded orientation task in Content. Course login alone is not academic activity, but students who never enter the shell cannot complete work."
      );
    }

    if (access.ended && enrolled && access.d22 / enrolled >= 0.25) {
      add(
        "medium",
        "A quarter or more of the class dropped off before the last three weeks",
        Math.round((access.d22 / enrolled) * 100) +
          "% last accessed the course more than 21 days before it ended (" +
          fmtDate(access.asOf) +
          "). That is drop-off during the term, not the shell being closed. After an offering ends, students typically cannot log in, so this report does not treat “no login since today” as inactivity."
      );
    } else if (!access.ended && enrolled && (access.d22 + access.never) / enrolled >= 0.25) {
      add(
        "high",
        "A quarter or more of the class is currently inactive",
        Math.round(((access.d22 + access.never) / enrolled) * 100) +
          "% have no course access in the last 21 days (including never). Plan inactivity outreach while the course is still open and keep remaining work on the calendar."
      );
    }

    var lowQuizzes = (report.quizzes || []).filter(function (q) {
      return q.avgPct != null && q.avgPct < LOW_AVG;
    });
    if (lowQuizzes.length) {
      var names = lowQuizzes
        .slice(0, 4)
        .map(function (q) {
          return q.name + " (" + round1(q.avgPct) + "%)";
        })
        .join("; ");
      add(
        "high",
        "Quizzes where the class struggled",
        names +
          (lowQuizzes.length > 4 ? ", and " + (lowQuizzes.length - 4) + " more" : "") +
          ". Review those items, add a practice quiz or worked example, and check whether the content topic that teaches the skill is placed before the due date."
      );
    }

    var highAttempts = (report.quizzes || []).filter(function (q) {
      return q.avgAttempts != null && q.avgAttempts >= 2.5 && q.avgPct != null && q.avgPct < 80;
    });
    if (highAttempts.length) {
      add(
        "medium",
        "Repeated quiz attempts with middling scores",
        highAttempts
          .slice(0, 3)
          .map(function (q) {
            return q.name;
          })
          .join(", ") +
          " show multiple attempts without a strong class average. Students may need a short review resource, clearer feedback on incorrect items, or a tighter alignment between the quiz and the module content."
      );
    }

    var lowAssign = (report.assignments || []).filter(function (x) {
      return x.enrolled && x.rate < LOW_COMPLETION;
    });
    if (lowAssign.length) {
      add(
        "high",
        "Assignment folders with missing work",
        lowAssign
          .slice(0, 4)
          .map(function (x) {
            return x.name + " (" + Math.round(x.rate) + "% submitted)";
          })
          .join("; ") +
          ". For next term, add a calendar due date if missing, split large tasks, and schedule a reminder announcement 48 hours before the deadline."
      );
    }

    var lateHeavy = (report.assignments || []).filter(function (x) {
      return x.submitted >= 5 && x.late / x.submitted >= 0.3;
    });
    if (lateHeavy.length) {
      add(
        "medium",
        "Late submissions clustered on some folders",
        lateHeavy
          .slice(0, 3)
          .map(function (x) {
            return x.name;
          })
          .join(", ") +
          " had 30% or more of submissions after the due date. Consider an earlier due time (not Sunday night), a draft checkpoint, or a short availability window after the due date with a clear late policy."
      );
    }

    var lowDisc = (report.discussions || []).filter(function (x) {
      return x.enrolled && x.rate < 50;
    });
    if (lowDisc.length) {
      add(
        "medium",
        "Discussion topics with low student posting",
        lowDisc
          .slice(0, 4)
          .map(function (x) {
            return x.topic;
          })
          .join("; ") +
          ". Participation often rises when the prompt is specific, a due date is on the calendar, and a reply-to-peer requirement is visible in the instructions."
      );
    }

    var helpTopics = (report.discussions || [])
      .filter(function (x) {
        return x.helpPosts >= 3;
      })
      .sort(function (x, y) {
        return y.helpPosts - x.helpPosts;
      });
    if (helpTopics.length) {
      add(
        "high",
        "Public discussions where students asked for help",
        helpTopics
          .slice(0, 4)
          .map(function (x) {
            return x.topic + " (" + x.helpPosts + " help-seeking posts)";
          })
          .join("; ") +
          ". Add a FAQ, example, or short screencast in the matching Content module before copying the course forward."
      );
    }

    var priv = report.privateDiscussions;
    if (priv && priv.studentPosts >= 10) {
      add(
        priv.studentPosts >= 40 ? "high" : "medium",
        "Private / 1-on-1 boards were used for help",
        priv.studentPosters +
          " students posted " +
          priv.studentPosts +
          " times on private boards" +
          (priv.helpPosts ? " (about " + priv.helpPosts + " posts used help language)" : "") +
          ". That is a signal students needed individual scaffolding. Next term, turn the most common questions into a class FAQ or announcement, and keep office hours easy to find."
      );
    } else if (priv && priv.forums === 0) {
      add(
        "low",
        "No private student conversation board detected",
        "A 1-on-1 board can surface questions that never appear in public discussions. If you want that signal next term, add private student conversations from Course Management."
      );
    }

    var clustered = (report.dueWeeks || []).filter(function (w) {
      return w.key !== "none" && w.items.length >= 4;
    });
    if (clustered.length) {
      add(
        "medium",
        "Heavy due-date weeks",
        clustered
          .slice(0, 3)
          .map(function (w) {
            return w.label + " (" + w.items.length + " items)";
          })
          .join("; ") +
          ". Spreading quizzes, assignments, and discussions across the week usually reduces late work and last-minute posting."
      );
    }

    var undated = (report.dueWeeks || []).filter(function (w) {
      return w.key === "none" && w.items.length;
    })[0];
    if (undated && undated.items.length >= 3) {
      add(
        "medium",
        "Several assessments have no due date",
        undated.items.length +
          " items have no due date in Brightspace. Dates on the calendar are one of the strongest completion cues. Use Due Date Wizard after you copy the course."
      );
    }

    var emptyMods = (content.modules || []).filter(function (m) {
      return m.empty && !m.hidden;
    });
    var hiddenMods = (content.modules || []).filter(function (m) {
      return m.hidden;
    });
    if (emptyMods.length) {
      add(
        "low",
        "Empty content modules",
        emptyMods.length +
          " visible module(s) have no topics. Hide or delete placeholders before students see the next offering, so the table of contents matches the real weekly path."
      );
    }
    if (hiddenMods.length >= 3) {
      add(
        "low",
        "Several hidden modules remain in Content",
        hiddenMods.length +
          " modules are hidden. That is fine for drafting, but hidden leftovers make copy-forward messy. Unhide what you will use and remove the rest."
      );
    }

    if (content.visitAvailable && content.topics.length) {
      var lowVisit = content.topics
        .filter(function (t) {
          return !t.hidden && t.id;
        })
        .map(function (t) {
          t.visitRate = enrolled ? (t.visited / enrolled) * 100 : 0;
          return t;
        })
        .filter(function (t) {
          return t.visitRate < 40;
        })
        .sort(function (x, y) {
          return x.visitRate - y.visitRate;
        });
      if (lowVisit.length) {
        add(
          "medium",
          "Content topics few students opened",
          lowVisit
            .slice(0, 5)
            .map(function (t) {
              return t.title + " (" + Math.round(t.visitRate) + "% visited)";
            })
            .join("; ") +
            ". Either require the topic, place it next to the related assessment, or remove it so the content path stays short."
        );
      }
      var highVisit = content.topics
        .filter(function (t) {
          return !t.hidden && enrolled && t.visited / enrolled >= 0.8;
        })
        .sort(function (x, y) {
          return y.visited - x.visited;
        });
      if (highVisit.length) {
        add(
          "positive",
          "Content students actually used",
          highVisit
            .slice(0, 4)
            .map(function (t) {
              return t.title;
            })
            .join("; ") +
            ". Keep these prominent in the next copy and consider expanding them if related quizzes were still difficult."
        );
      }
    } else if (content.topics.length) {
      add(
        "low",
        "Content visit data was limited",
        "The content table of contents loaded, but Brightspace did not return reliable per-student topic visits for this course. Structure recommendations still apply; visit rates could not be calculated."
      );
    }

    var lowGradeItems = (report.gradeItems || []).filter(function (g) {
      return g.avgPct != null && g.avgPct < LOW_AVG;
    });
    if (lowGradeItems.length) {
      add(
        "medium",
        "Gradebook items below " + LOW_AVG + "% class average",
        lowGradeItems
          .slice(0, 5)
          .map(function (g) {
            return g.name + " (" + round1(g.avgPct) + "%)";
          })
          .join("; ") +
          ". These are the strongest “needed more assistance” signals in the gradebook."
      );
    }

    if (!out.length) {
      add(
        "positive",
        "No major friction flags from this pass",
        "Completion, scores, and access look relatively even. Still skim the tables above for one or two items to tighten before the next offering."
      );
    }

    var order = { high: 0, medium: 1, low: 2, positive: 3 };
    out.sort(function (x, y) {
      return (order[x.severity] || 9) - (order[y.severity] || 9);
    });
    return out;
  }

  async function buildReport(course, onProgress) {
    var orgUnitId = String(course.OrgUnit.Id);
    onProgress("Loading classlist and course dates…");
    var classlist = await getClasslist(orgUnitId);
    var courseInfo = await BrightspaceFetchOptional("/d2l/api/lp/" + API_VERSION_LP + "/courses/" + orgUnitId);
    var studentIds = [];
    var lastAccessed = [];
    for (var i = 0; i < classlist.length; i++) {
      var m = classlist[i];
      if (!isClasslistStudent(m) || isDemoStudent(m)) continue;
      var uid = studentUserId(m);
      if (!uid) continue;
      studentIds.push(uid);
      lastAccessed.push(m.LastAccessed || m.LastAccessedDate || null);
    }
    var studentSet = {};
    for (var s = 0; s < studentIds.length; s++) studentSet[studentIds[s]] = true;

    onProgress("Reading final grades…");
    var grades = await getFinalPercents(orgUnitId, studentSet);

    var gradeItems = await collectGradeItems(orgUnitId, studentIds, onProgress);
    var assignments = await collectAssignments(orgUnitId, studentIds, onProgress);
    var quizzes = await collectQuizzes(orgUnitId, studentIds, onProgress);
    var discussionsPack = await collectDiscussions(orgUnitId, studentIds, onProgress);
    var content = await collectContent(orgUnitId, studentIds, onProgress);
    var courseEndIso = (courseInfo && (courseInfo.EndDate || courseInfo.EndDateTime)) || "";
    var accessAsOf = resolveAccessAsOf(
      courseEndIso,
      assignments,
      quizzes,
      discussionsPack.publicTopics
    );
    var access = accessBuckets(lastAccessed, accessAsOf);

    var assignRates = assignments.map(function (x) {
      return x.rate;
    });
    var quizRates = quizzes.map(function (x) {
      return x.rate;
    });
    var quizAvgs = quizzes
      .map(function (x) {
        return x.avgPct;
      })
      .filter(function (n) {
        return n != null;
      });
    var discRates = discussionsPack.publicTopics.map(function (x) {
      return x.rate;
    });
    var helpPostsTotal = 0;
    for (var h = 0; h < discussionsPack.publicTopics.length; h++) {
      helpPostsTotal += discussionsPack.publicTopics[h].helpPosts || 0;
    }

    var topicVisitRates = [];
    if (content.visitAvailable) {
      for (var t = 0; t < content.topics.length; t++) {
        if (content.topics[t].hidden) continue;
        topicVisitRates.push(studentIds.length ? (content.topics[t].visited / studentIds.length) * 100 : 0);
      }
    }

    var dueWeeks = buildDueCalendar(assignments, quizzes, discussionsPack.publicTopics);
    var analytics = {
      enrolled: studentIds.length,
      graded: grades.graded,
      mean: grades.mean,
      median: grades.median,
      min: grades.min,
      max: grades.max,
      stdev: grades.stdev,
      passingPct: grades.passingPct,
      below: grades.below,
      letters: grades.letters,
      histogram: grades.histogram,
      assignCompletion: mean(assignRates),
      quizCompletion: mean(quizRates),
      quizAvg: mean(quizAvgs),
      discussionParticipation: mean(discRates),
      contentVisitAvg: mean(topicVisitRates),
      helpPostsTotal: helpPostsTotal
    };

    var report = {
      generatedAt: new Date(),
      course: {
        id: orgUnitId,
        name: (courseInfo && courseInfo.Name) || course.OrgUnit.Name || "Course",
        code: (courseInfo && courseInfo.Code) || course.OrgUnit.Code || "",
        semester: getSemesterCodeFromCourseCode((courseInfo && courseInfo.Code) || course.OrgUnit.Code || "") ||
          activeSemesterCode(),
        start: (courseInfo && (courseInfo.StartDate || courseInfo.StartDateTime)) || "",
        end: (courseInfo && (courseInfo.EndDate || courseInfo.EndDateTime)) || ""
      },
      analytics: analytics,
      access: access,
      gradeItems: sortByFlagThenName(gradeItems, "avgPct"),
      assignments: sortByFlagThenName(assignments, "rate"),
      quizzes: sortByFlagThenName(quizzes, "avgPct"),
      discussions: sortByFlagThenName(discussionsPack.publicTopics, "rate"),
      privateDiscussions: discussionsPack.privateSummary,
      content: content,
      dueWeeks: dueWeeks,
      suggestions: []
    };
    report.suggestions = buildSuggestions(report);
    return report;
  }

  function renderJump() {
    var items = [
      ["eos-overview", "Overview"],
      ["eos-grades", "Grades"],
      ["eos-access", "Access"],
      ["eos-content", "Content"],
      ["eos-dates", "Dates"],
      ["eos-assignments", "Assignments"],
      ["eos-quizzes", "Quizzes"],
      ["eos-discussions", "Discussions"],
      ["eos-help", "Assistance"],
      ["eos-suggestions", "Suggestions"]
    ];
    var html = "";
    for (var i = 0; i < items.length; i++) {
      html += '<a href="#' + items[i][0] + '">' + items[i][1] + "</a>";
    }
    return html;
  }

  function histogramHtml(hist) {
    var maxH = 1;
    for (var i = 0; i < hist.length; i++) if (hist[i] > maxH) maxH = hist[i];
    var labels = histLabels();
    var html = '<div class="cr-hist" role="img" aria-label="Final grade distribution">';
    for (var h = 0; h < hist.length; h++) {
      var height = Math.max(4, Math.round((hist[h] / maxH) * 120));
      html +=
        '<div class="cr-hist-col"><div class="cr-hist-bar" style="height:' +
        height +
        'px"></div><span class="cr-hist-n">' +
        hist[h] +
        '</span><span class="cr-hist-lbl">' +
        labels[h] +
        "</span></div>";
    }
    html += "</div>";
    return html;
  }

  function lettersHtml(letters) {
    var html = '<div class="cr-letters">';
    var order = ["A", "B", "C", "D", "F"];
    for (var L = 0; L < order.length; L++) {
      html +=
        '<div class="cr-letter cr-letter-' +
        order[L].toLowerCase() +
        '"><div class="cr-letter-grade">' +
        order[L] +
        '</div><div class="cr-letter-n">' +
        letters[order[L]] +
        "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function accessBarHtml(access, enrolled) {
    var ended = !!(access && access.ended);
    var parts = ended
      ? [
          { key: "d1", label: "Last day of the course", n: access.d1, color: "#059669" },
          { key: "d1to7", label: "Final 7 days", n: access.d1to7, color: "#0d9488" },
          { key: "d8to21", label: "8–21 days before end", n: access.d8to21, color: "#d97706" },
          { key: "d22", label: "Stopped 22+ days before end", n: access.d22, color: "#ea580c" },
          { key: "never", label: "No login on record", n: access.never, color: "#dc2626" }
        ]
      : [
          { key: "d1", label: "Last 24 hours", n: access.d1, color: "#059669" },
          { key: "d1to7", label: "1–7 days", n: access.d1to7, color: "#0d9488" },
          { key: "d8to21", label: "8–21 days", n: access.d8to21, color: "#d97706" },
          { key: "d22", label: "22+ days", n: access.d22, color: "#ea580c" },
          { key: "never", label: "No login on record", n: access.never, color: "#dc2626" }
        ];
    var html = '<div class="eos-access-stack" role="img" aria-label="Last course access distribution">';
    for (var i = 0; i < parts.length; i++) {
      var pct = enrolled ? Math.round((parts[i].n / enrolled) * 100) : 0;
      html +=
        '<div class="eos-access-row"><span class="eos-access-label">' +
        escapeHtml(parts[i].label) +
        '</span><div class="eos-access-track"><span style="width:' +
        pct +
        "%;background:" +
        parts[i].color +
        '"></span></div><span class="eos-access-n">' +
        parts[i].n +
        " (" +
        pct +
        "%)</span></div>";
    }
    html += "</div>";
    return html;
  }

  function renderPreview(report) {
    var a = report.analytics;
    var enrolled = a.enrolled;
    var content = report.content;
    var visitTopics = (content.topics || [])
      .filter(function (t) {
        return !t.hidden && t.id;
      })
      .slice()
      .sort(function (x, y) {
        return x.visited - y.visited;
      });

    var helpTopics = (report.discussions || [])
      .filter(function (d) {
        return d.helpPosts > 0;
      })
      .sort(function (x, y) {
        return y.helpPosts - x.helpPosts;
      });

    var struggle = [];
    (report.quizzes || []).forEach(function (q) {
      if (q.avgPct != null && q.avgPct < LOW_AVG) {
        struggle.push({
          area: "Quiz",
          name: q.name,
          why: "Class average " + round1(q.avgPct) + "%"
        });
      }
    });
    (report.assignments || []).forEach(function (x) {
      if (x.rate < LOW_COMPLETION) {
        struggle.push({
          area: "Assignment",
          name: x.name,
          why: Math.round(x.rate) + "% submitted"
        });
      }
    });
    (report.gradeItems || []).forEach(function (g) {
      if (g.avgPct != null && g.avgPct < LOW_AVG) {
        struggle.push({
          area: g.kind,
          name: g.name,
          why: "Class average " + round1(g.avgPct) + "%"
        });
      }
    });
    helpTopics.slice(0, 5).forEach(function (d) {
      struggle.push({
        area: "Discussion",
        name: d.topic,
        why: d.helpPosts + " help-seeking posts"
      });
    });

    var html = "";
    html +=
      '<div class="eos-section" id="eos-overview"><div class="cr-panel"><h3>Course snapshot</h3>' +
      "<p class=\"eos-meta\">" +
      escapeHtml(report.course.name) +
      " <span class=\"cr-muted\">(" +
      escapeHtml(report.course.code || "no code") +
      " · " +
      escapeHtml(report.course.semester) +
      (report.course.start || report.course.end
        ? " · " + fmtDate(report.course.start) + " – " + fmtDate(report.course.end)
        : "") +
      ")</span></p>" +
      "<p class=\"cr-muted\">Generated " +
      escapeHtml(fmtDateTime(report.generatedAt.toISOString())) +
      ". Counts only — student names are not included.</p></div>";

    html +=
      '<div class="cr-kpis">' +
      kpiHtml("Students", String(enrolled)) +
      kpiHtml("Class average", fmtPct(a.mean)) +
      kpiHtml("Median", fmtPct(a.median)) +
      kpiHtml("Passing (≥" + PASSING_CUTOFF + "%)", a.passingPct == null ? "—" : Math.round(a.passingPct) + "%") +
      kpiHtml("Below " + PASSING_CUTOFF + "%", String(a.below)) +
      kpiHtml("Assignment completion", fmtPct(a.assignCompletion), "Average across folders") +
      kpiHtml("Quiz completion", fmtPct(a.quizCompletion), "Students who attempted") +
      kpiHtml("Discussion participation", fmtPct(a.discussionParticipation), "Students who posted") +
      kpiHtml(
        "Content visits",
        content.visitAvailable ? fmtPct(a.contentVisitAvg) : "n/a",
        content.visitAvailable ? "Average topic visit rate" : "Visit data unavailable"
      ) +
      kpiHtml("Help-seeking posts", String(a.helpPostsTotal), "Public discussions") +
      "</div></div>";

    html +=
      '<div class="eos-section" id="eos-grades">' +
      '<div class="cr-panel"><h3>Final grade distribution</h3>' +
      histogramHtml(a.histogram) +
      "</div>" +
      '<div class="cr-panel"><h3>Letter grades</h3>' +
      lettersHtml(a.letters) +
      (a.stdev != null
        ? '<p class="cr-muted" style="margin-top:12px;">Standard deviation: ' + round1(a.stdev) + " points.</p>"
        : "") +
      "</div>" +
      itemTableHtml("Gradebook items", report.gradeItems, [
        { label: "Item", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Type", cell: function (row) { return escapeHtml(row.kind); } },
        { label: "Graded", cell: function (row) { return meterHtml(row.gradedCount, enrolled); } },
        { label: "Class avg", cell: function (row) { return escapeHtml(fmtPct(row.avgPct)); } }
      ]) +
      "</div>";

    html +=
      '<div class="eos-section" id="eos-access"><div class="cr-panel"><h3>Course login / last access</h3>' +
      "<p class=\"cr-muted\">" +
      (report.access.ended
        ? "Measured against the course end" +
          (report.access.source === "last-due" ? " (last due date used; no official end date was returned)" : "") +
          " on " +
          fmtDate(report.access.asOf) +
          ". After an offering ends, students typically cannot log in, so “days since today” would make every closed course look inactive."
        : "This course is still open, so last access is measured from today. Not a click count — Brightspace Insights clickstream is not available to this report.") +
      "</p>" +
      accessBarHtml(report.access, enrolled) +
      "</div></div>";

    var emptyMods = (content.modules || []).filter(function (m) {
      return m.empty;
    });
    var hiddenMods = (content.modules || []).filter(function (m) {
      return m.hidden;
    });
    html +=
      '<div class="eos-section" id="eos-content"><div class="cr-kpis">' +
      kpiHtml("Modules", String(content.modules.length)) +
      kpiHtml("Topics", String(content.topics.length)) +
      kpiHtml("Empty modules", String(emptyMods.length)) +
      kpiHtml("Hidden modules", String(hiddenMods.length)) +
      "</div>";
    html += itemTableHtml(
      "How content is structured",
      content.modules,
      [
        { label: "Module", cell: function (row) { return escapeHtml(row.path); } },
        { label: "Child topics", cell: function (row) { return String(row.topicCount); } },
        {
          label: "Status",
          cell: function (row) {
            var bits = [];
            if (row.hidden) bits.push("Hidden");
            if (row.empty) bits.push("Empty");
            if (row.start) bits.push("Starts " + fmtDate(row.start));
            return bits.length ? escapeHtml(bits.join(" · ")) : "Visible";
          }
        }
      ],
      "No content modules were returned for this course."
    );

    if (content.visitAvailable && visitTopics.length) {
      var lowest = visitTopics.slice(0, 8);
      var highest = visitTopics.slice().reverse().slice(0, 8);
      html += itemTableHtml("Least-opened topics", lowest, [
        { label: "Topic", cell: function (row) { return escapeHtml(row.path || row.title); } },
        { label: "Students who opened it", cell: function (row) { return meterHtml(row.visited, enrolled); } }
      ]);
      html += itemTableHtml("Most-opened topics", highest, [
        { label: "Topic", cell: function (row) { return escapeHtml(row.path || row.title); } },
        { label: "Students who opened it", cell: function (row) { return meterHtml(row.visited, enrolled); } }
      ]);
    } else {
      html +=
        '<div class="cr-panel"><h3>What students looked at</h3><p class="cr-muted">Topic visit data was not available for this course. Structure is still shown above.</p></div>';
    }
    html += "</div>";

    html +=
      '<div class="eos-section" id="eos-dates">' +
      itemTableHtml(
        "Due dates by week",
        report.dueWeeks,
        [
          {
            label: "Week",
            cell: function (row) {
              return escapeHtml(row.label) + (row.items.length >= 4 && row.key !== "none" ? ' <span class="eos-chip">Busy</span>' : "");
            }
          },
          { label: "Items due", cell: function (row) { return String(row.items.length); } },
          {
            label: "What",
            cell: function (row) {
              return escapeHtml(
                row.items
                  .slice(0, 6)
                  .map(function (it) {
                    return it.kind + ": " + it.name;
                  })
                  .join("; ") + (row.items.length > 6 ? "…" : "")
              );
            }
          }
        ],
        "No assignment, quiz, or discussion dates were found."
      ) +
      "</div>";

    html +=
      '<div class="eos-section" id="eos-assignments">' +
      itemTableHtml("Assignment folders", report.assignments, [
        { label: "Folder", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Due", cell: function (row) { return escapeHtml(fmtDate(row.due)); } },
        { label: "Submitted", cell: function (row) { return meterHtml(row.submitted, row.enrolled); } },
        { label: "Late", cell: function (row) { return String(row.late); } }
      ]) +
      "</div>";

    html +=
      '<div class="eos-section" id="eos-quizzes">' +
      itemTableHtml("Quizzes", report.quizzes, [
        { label: "Quiz", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Due", cell: function (row) { return escapeHtml(fmtDate(row.due)); } },
        { label: "Attempted", cell: function (row) { return meterHtml(row.attempted, row.enrolled); } },
        { label: "Class avg", cell: function (row) { return escapeHtml(fmtPct(row.avgPct)); } },
        {
          label: "Avg attempts",
          cell: function (row) {
            return row.avgAttempts == null ? "—" : String(round1(row.avgAttempts));
          }
        }
      ]) +
      "</div>";

    html +=
      '<div class="eos-section" id="eos-discussions">' +
      itemTableHtml("Public discussion topics", report.discussions, [
        {
          label: "Forum / topic",
          cell: function (row) {
            return escapeHtml(row.forum + " — " + row.topic);
          }
        },
        { label: "Students posting", cell: function (row) { return meterHtml(row.posters, row.enrolled); } },
        { label: "Student posts", cell: function (row) { return String(row.posts); } },
        { label: "Help-seeking posts", cell: function (row) { return String(row.helpPosts); } }
      ]);
    var priv = report.privateDiscussions;
    html +=
      '<div class="cr-panel"><h3>Private / 1-on-1 boards</h3>' +
      (priv.forums
        ? "<p>" +
          priv.forums +
          " private forum(s), " +
          priv.topics +
          " topic(s). " +
          priv.studentPosters +
          " students posted " +
          priv.studentPosts +
          " times" +
          (priv.helpPosts ? " · " + priv.helpPosts + " posts used help language" : "") +
          ".</p>"
        : '<p class="cr-muted">No private student conversation forums were detected by name.</p>') +
      "</div></div>";

    html += '<div class="eos-section" id="eos-help">';
    html += itemTableHtml(
      "Where students asked for help or may have needed more assistance",
      struggle,
      [
        { label: "Area", cell: function (row) { return escapeHtml(row.area); } },
        { label: "Item", cell: function (row) { return escapeHtml(row.name); } },
        { label: "Signal", cell: function (row) { return escapeHtml(row.why); } }
      ],
      "No strong struggle or help-seeking signals were found from grades, missing work, or discussion language."
    );
    html +=
      '<p class="cr-muted">Help-seeking is inferred from public and private discussion text (phrases such as “I don’t understand”, “how do I”, “I’m stuck”). It is not a complete record of emails or office hours.</p></div>';

    html += '<div class="eos-section" id="eos-suggestions"><div class="cr-panel"><h3>Feedback and suggestions for next term <span class="beta-badge">Beta</span></h3>';
    html += '<p class="cr-muted">Rule-based checklist, not an AI narrative. Last-access suggestions use the course end date, not today, because students usually cannot enter a closed offering.</p>';
    html += '<ul class="eos-suggest-list">';
    for (var i = 0; i < report.suggestions.length; i++) {
      var sug = report.suggestions[i];
      html +=
        '<li class="eos-suggest eos-suggest-' +
        escapeHtml(sug.severity) +
        '"><div class="eos-suggest-kicker">' +
        escapeHtml(sug.severity === "positive" ? "Working well" : sug.severity === "high" ? "Priority" : sug.severity === "medium" ? "Consider" : "Cleanup") +
        "</div><h4>" +
        escapeHtml(sug.title) +
        "</h4><p>" +
        escapeHtml(sug.body) +
        "</p></li>";
    }
    html += "</ul></div></div>";
    return html;
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

  function sanitizeFilenamePart(s) {
    return String(s || "course")
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60);
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
    var title = "End of Semester Course Report (Beta)";
    var PDF_TEXT = [15, 23, 42];
    var PDF_MUTED = [51, 65, 85];
    var PDF_ON_DARK = [255, 255, 255];
    var PDF_SURFACE = [226, 232, 240];
    var PDF_LINE = [100, 116, 139];
    var ROW_H = 18;
    var HEADER_H = 20;
    var LETTER_FILLS = {
      A: [4, 120, 87],
      B: [15, 118, 110],
      C: [146, 64, 14],
      D: [154, 52, 18],
      F: [153, 27, 27]
    };

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
      doc.setFontSize(isCover ? 16 : 12);
      doc.text("Your Institution Faculty Dashboard", textX, isCover ? 32 : 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(isCover ? 13 : 10);
      doc.text(title, textX, isCover ? 54 : 42);
      if (isCover) {
        doc.setFontSize(10);
        doc.text(pdfSafe(report.course.name), textX, 74);
      }
    }

    function setInk(rgb, font, size) {
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.setFont("helvetica", font || "normal");
      if (size) doc.setFontSize(size);
    }

    function newPage() {
      doc.addPage();
      drawChrome(false);
      y = 88;
      setInk(PDF_TEXT, "normal", 9);
    }

    function need(h) {
      if (y + h > pageH - 48) newPage();
    }

    function section(label) {
      need(36);
      y += 8;
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(margin, y, pageW - margin * 2, 22, "F");
      setInk(PDF_ON_DARK, "bold", 11);
      doc.text(label, margin + 8, y + 15);
      y += 30;
      setInk(PDF_TEXT, "normal", 9);
    }

    function para(text) {
      var lines = doc.splitTextToSize(pdfSafe(text), pageW - margin * 2);
      for (var i = 0; i < lines.length; i++) {
        need(14);
        setInk(PDF_TEXT, "normal", 9);
        doc.text(lines[i], margin, y);
        y += 13;
      }
      y += 4;
    }

    function drawTableHeader(headers, colW) {
      need(HEADER_H + 8);
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(margin, y, pageW - margin * 2, HEADER_H, "F");
      setInk(PDF_ON_DARK, "bold", 9);
      var tx = margin + 6;
      for (var h = 0; h < headers.length; h++) {
        doc.text(headers[h], tx, y + 14);
        tx += colW[h];
      }
      y += HEADER_H;
      setInk(PDF_TEXT, "normal", 9);
    }

    function drawSimpleTable(headers, rows, colW) {
      if (!rows.length) {
        setInk(PDF_MUTED, "italic", 9);
        doc.text("No items found.", margin, y);
        y += 16;
        setInk(PDF_TEXT, "normal", 9);
        return;
      }
      drawTableHeader(headers, colW);
      for (var r = 0; r < rows.length; r++) {
        if (y + ROW_H > pageH - 48) {
          newPage();
          drawTableHeader(headers, colW);
        }
        var tableW = pageW - margin * 2;
        if (r % 2 === 1) {
          doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
          doc.rect(margin, y, tableW, ROW_H, "F");
        }
        doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
        doc.setLineWidth(0.4);
        doc.line(margin, y + ROW_H, margin + tableW, y + ROW_H);
        setInk(PDF_TEXT, "normal", 9);
        var tx = margin + 6;
        for (var k = 0; k < rows[r].length; k++) {
          doc.text(pdfSafe(String(rows[r][k])).substring(0, 46), tx, y + 12);
          tx += colW[k];
        }
        y += ROW_H;
      }
      y += 10;
      setInk(PDF_TEXT, "normal", 9);
    }

    drawChrome(true);
    y = 112;
    doc.setTextColor(PDF_TEXT[0], PDF_TEXT[1], PDF_TEXT[2]);
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
    y += 14;
    doc.setFontSize(9);
    doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
    doc.text("Class-level counts only. No student names are included in this file.", margin, y);
    y += 12;
    var accessNote =
      report.access && report.access.ended
        ? "Beta: last-access timing is measured from the course end date (" +
          fmtDate(report.access.asOf) +
          "), not from today. Students typically cannot log in after the offering closes."
        : "Beta: this course is still open, so last-access timing is measured from today.";
    var accessNoteLines = doc.splitTextToSize(pdfSafe(accessNote), pageW - margin * 2);
    doc.text(accessNoteLines, margin, y);
    y += accessNoteLines.length * 11 + 14;

    var cardW = 80;
    var gap = 8;
    var cards = [
      ["Students", String(a.enrolled)],
      ["Average", a.mean == null ? "-" : round1(a.mean) + "%"],
      ["Median", a.median == null ? "-" : round1(a.median) + "%"],
      ["Passing", a.passingPct == null ? "-" : Math.round(a.passingPct) + "%"],
      ["Below " + PASSING_CUTOFF + "%", String(a.below)],
      ["Help posts", String(a.helpPostsTotal)]
    ];
    for (var c = 0; c < cards.length; c++) {
      var x = margin + c * (cardW + gap);
      doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
      doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
      doc.roundedRect(x, y, cardW, 48, 4, 4, "FD");
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(x, y, cardW, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.text(cards[c][0], x + 6, y + 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.text(String(cards[c][1]), x + 6, y + 34);
    }
    y += 64;

    section("Final grade distribution");
    var hist = a.histogram;
    var maxBar = 1;
    for (var i = 0; i < hist.length; i++) if (hist[i] > maxBar) maxBar = hist[i];
    var plotH = 80;
    var plotW = pageW - margin * 2;
    var barGap = 6;
    var barW = (plotW - barGap * 9) / 10;
    var labels = histLabels();
    doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
    doc.line(margin, y + plotH, margin + plotW, y + plotH);
    for (var b = 0; b < 10; b++) {
      var bh = maxBar ? (hist[b] / maxBar) * (plotH - 8) : 0;
      var bx = margin + b * (barW + barGap);
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.rect(bx, y + plotH - bh, barW, Math.max(bh, 1), "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(PDF_TEXT[0], PDF_TEXT[1], PDF_TEXT[2]);
      doc.text(String(hist[b]), bx + barW / 2, y + plotH - bh - 3, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(PDF_MUTED[0], PDF_MUTED[1], PDF_MUTED[2]);
      doc.text(labels[b], bx + barW / 2, y + plotH + 12, { align: "center" });
    }
    y += plotH + 28;

    section("Letter grades");
    var letterOrder = ["A", "B", "C", "D", "F"];
    var lw = 90;
    for (var L = 0; L < letterOrder.length; L++) {
      var lx = margin + L * (lw + 10);
      var col = LETTER_FILLS[letterOrder[L]];
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(lx, y, lw, 36, 4, 4, "F");
      doc.setTextColor(PDF_ON_DARK[0], PDF_ON_DARK[1], PDF_ON_DARK[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(letterOrder[L] + "  " + a.letters[letterOrder[L]], lx + 12, y + 23);
    }
    y += 52;
    setInk(PDF_TEXT, "normal", 9);

    section("Course access (last login)");
    para(
      (report.access.ended
        ? "As of course end " +
          fmtDate(report.access.asOf) +
          (report.access.source === "last-due" ? " (last due date; no official end date returned)" : "") +
          ". Last day: " +
          report.access.d1 +
          "   Final 7 days: " +
          report.access.d1to7 +
          "   8-21 days before end: " +
          report.access.d8to21 +
          "   Stopped 22+ days before end: " +
          report.access.d22 +
          "   Never: " +
          report.access.never +
          ". Closed-course login gaps are not treated as inactivity."
        : "As of today (course still open). Never: " +
          report.access.never +
          "   22+ days: " +
          report.access.d22 +
          "   8-21 days: " +
          report.access.d8to21 +
          "   1-7 days: " +
          report.access.d1to7 +
          "   Last 24 hours: " +
          report.access.d1 +
          ".") +
        " Last course access from the classlist, not clickstream."
    );

    section("Gradebook items");
    drawSimpleTable(
      ["Item", "Type", "Graded", "Avg"],
      report.gradeItems.map(function (it) {
        return [
          it.name,
          it.kind,
          it.gradedCount + "/" + a.enrolled,
          it.avgPct == null ? "-" : round1(it.avgPct) + "%"
        ];
      }),
      [230, 80, 90, 80]
    );

    section("Assignment folders");
    drawSimpleTable(
      ["Folder", "Due", "Submitted", "Late"],
      report.assignments.map(function (it) {
        return [it.name, fmtDate(it.due), it.submitted + "/" + it.enrolled, String(it.late)];
      }),
      [220, 90, 110, 60]
    );

    section("Quizzes");
    drawSimpleTable(
      ["Quiz", "Due", "Attempted", "Avg"],
      report.quizzes.map(function (it) {
        return [
          it.name,
          fmtDate(it.due),
          it.attempted + "/" + it.enrolled,
          it.avgPct == null ? "-" : round1(it.avgPct) + "%"
        ];
      }),
      [220, 90, 110, 60]
    );

    section("Public discussions");
    drawSimpleTable(
      ["Topic", "Posting", "Posts", "Help"],
      report.discussions.map(function (it) {
        return [it.topic, it.posters + "/" + it.enrolled, String(it.posts), String(it.helpPosts)];
      }),
      [240, 90, 70, 80]
    );

    var priv = report.privateDiscussions;
    section("Private / 1-on-1 boards");
    para(
      priv.forums
        ? priv.forums +
            " private forum(s), " +
            priv.studentPosters +
            " students posted " +
            priv.studentPosts +
            " times."
        : "No private student conversation forums were detected by name."
    );

    section("Content structure");
    para(
      report.content.modules.length +
        " modules, " +
        report.content.topics.length +
        " topics. Empty modules: " +
        report.content.modules.filter(function (m) {
          return m.empty;
        }).length +
        ". Hidden modules: " +
        report.content.modules.filter(function (m) {
          return m.hidden;
        }).length +
        (report.content.visitAvailable ? "" : " Topic visit rates were not available.")
    );
    if (report.content.visitAvailable) {
      var lowT = report.content.topics
        .filter(function (t) {
          return !t.hidden && t.id;
        })
        .slice()
        .sort(function (x, y) {
          return x.visited - y.visited;
        })
        .slice(0, 8);
      drawSimpleTable(
        ["Least-opened topic", "Opened"],
        lowT.map(function (t) {
          return [t.title, t.visited + "/" + a.enrolled];
        }),
        [400, 80]
      );
    }

    section("Due dates by week");
    drawSimpleTable(
      ["Week", "Items"],
      report.dueWeeks.map(function (w) {
        return [w.label, String(w.items.length)];
      }),
      [400, 80]
    );

    section("Feedback and suggestions (Beta)");
    para(
      "Rule-based checklist, not an AI narrative. Last-access findings use the course end date, not today, because students usually cannot enter a closed offering."
    );
    for (var s = 0; s < report.suggestions.length; s++) {
      var sug = report.suggestions[s];
      var titleLines = doc.splitTextToSize(pdfSafe(sug.title), pageW - margin * 2 - 16);
      var bodyLines = doc.splitTextToSize(pdfSafe(sug.body), pageW - margin * 2 - 16);
      var blockH = 14 + titleLines.length * 13 + 6 + bodyLines.length * 13 + 16;
      need(blockH);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, y, pageW - margin * 2, blockH - 8, 4, 4, "FD");
      var textY = y + 16;
      setInk(PDF_TEXT, "bold", 10);
      doc.text(titleLines, margin + 10, textY);
      textY += titleLines.length * 13 + 4;
      setInk(PDF_TEXT, "normal", 9);
      doc.text(bodyLines, margin + 10, textY);
      y += blockH + 6;
    }

    var pageCount = doc.getNumberOfPages();
    for (var p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
      doc.rect(0, pageH - 36, pageW, 36, "F");
      setInk(PDF_TEXT, "normal", 8);
      doc.text(
        "FERPA: Class education record. No student names. Use only for legitimate educational purposes at Your Institution.",
        margin,
        pageH - 20
      );
      doc.text("Page " + p + " of " + pageCount, pageW - margin, pageH - 20, { align: "right" });
    }

    doc.save(
      "EndOfSemester_" +
        sanitizeFilenamePart(report.course.code || report.course.name) +
        "_" +
        String(report.course.semester).replace(/\//g, "-") +
        ".pdf"
    );
  }

  function selectedCourse() {
    var sel = $("eosCourse");
    if (!sel || !sel.value) return null;
    return coursesById[sel.value] || null;
  }

  async function runReport() {
    var course = selectedCourse();
    var btn = $("eosRunBtn");
    var pdfBtn = $("eosPdfBtn");
    var previewSection = $("eosPreviewSection");
    var preview = $("eosPreview");
    var jump = $("eosJump");
    if (!course) {
      setStatus("error", "Select a course first.");
      return;
    }
    if (btn) btn.disabled = true;
    if (pdfBtn) pdfBtn.hidden = true;
    lastReport = null;
    try {
      var report = await buildReport(course, function (msg) {
        setStatus("", msg);
      });
      lastReport = report;
      if (preview) preview.innerHTML = renderPreview(report);
      if (previewSection) previewSection.hidden = false;
      if (jump) {
        jump.innerHTML = renderJump();
        jump.hidden = false;
      }
      var title = $("eosPreviewTitle");
      if (title) title.textContent = report.course.name;
      if (pdfBtn) pdfBtn.hidden = false;
      setStatus(
        "success",
        "Report ready for " +
          report.course.name +
          ". Analytics are at the top; suggestions are at the bottom. Download PDF if you need a copy."
      );
      if (previewSection) previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error(e);
      setStatus("error", "Could not build the report: " + (e.message || String(e)));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    var form = $("eosForm");
    var selectEl = $("eosCourse");
    var pdfBtn = $("eosPdfBtn");
    if (!form || !selectEl) return;

    if (!window.FacultyDashboardCourses) {
      selectEl.innerHTML = '<option value="">Course loader unavailable</option>';
      setStatus("error", "Course list helper failed to load. Refresh the page.");
      return;
    }

    window.FacultyDashboardCourses.populateCourseSelect(selectEl, {
      placeholderLabel: "Select a course…"
    })
      .then(function (courses) {
        coursesById = {};
        for (var i = 0; i < courses.length; i++) {
          var c = courses[i];
          if (c && c.OrgUnit && c.OrgUnit.Id != null) coursesById[String(c.OrgUnit.Id)] = c;
        }
        if (courses.length) {
          setStatus("success", "Loaded " + courses.length + " course(s). Choose one and generate the report.");
        } else {
          setStatus("error", "No eligible courses found for the current, previous, or upcoming term.");
        }
      })
      .catch(function (e) {
        setStatus("error", "Could not load courses: " + (e.message || String(e)));
      });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      runReport();
    });

    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        if (!lastReport) return;
        pdfBtn.disabled = true;
        downloadPdf(lastReport)
          .catch(function (e) {
            setStatus("error", e.message || String(e));
          })
          .then(function () {
            pdfBtn.disabled = false;
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
