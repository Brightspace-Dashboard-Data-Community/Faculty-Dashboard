/**
 * D2L Faculty Dashboard - Quiz Detail Analytics
 * In-depth metrics for a single quiz: score average, time spent, attempt count,
 * question data, below 65% score, special access.
 */

(function () {
  'use strict';

  var API_VERSION_LE = "1.78";
  var API_VERSION_GRADES = "1.80"; // Grades API (grade object, grade values)

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/SP";
  }

  function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        var err = new Error("HTTP " + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function getUrlParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  /**
   * Scrape "Average Grade" per question from D2L Question Details stats page via hidden iframe.
   * Same-origin only (dashboard must be on your-brightspace.example.edu). Returns array of
   * { numerator, denominator, percent } in question order, or [] on failure.
   */
  function buildStatsPageUrl(courseId, quizId) {
    var base = window.location.origin || "https://your-brightspace.example.edu";
    return base + "/d2l/lms/quizzing/admin/stats/stats_question_details.d2l?d2l_isfromtab=1&qi=" + encodeURIComponent(quizId) + "&ie=True&ou=" + encodeURIComponent(courseId);
  }

  function waitForElement(doc, check, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!doc || !doc.body) {
        reject(new Error("No document body"));
        return;
      }
      if (check(doc)) {
        resolve();
        return;
      }
      var deadline = Date.now() + (timeoutMs || 15000);
      var interval = setInterval(function () {
        if (Date.now() > deadline) {
          clearInterval(interval);
          reject(new Error("Timeout waiting for content"));
          return;
        }
        try {
          if (check(doc)) {
            clearInterval(interval);
            resolve();
          }
        } catch (e) {
          clearInterval(interval);
          reject(e);
        }
      }, 400);
    });
  }

  function scrapeAverageGradesFromDocument(doc) {
    var results = [];
    try {
      var text = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.documentElement ? doc.documentElement.innerText : "");
      var regex = /Average Grade:\s*([\d.]+)\s*\/\s*(\d+)\s*\((\d+)\s*%\)/gi;
      var m;
      while ((m = regex.exec(text)) !== null) {
        results.push({
          numerator: parseFloat(m[1], 10),
          denominator: parseInt(m[2], 10),
          percent: parseInt(m[3], 10)
        });
      }
    } catch (e) {
      results = [];
    }
    return results;
  }

  function fetchAverageGradesViaIframe(courseId, quizId, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    return new Promise(function (resolve) {
      var url = buildStatsPageUrl(courseId, quizId);
      var iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
      iframe.src = url;

      function cleanup() {
        try {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        } catch (e) {}
      }

      iframe.onload = function () {
        var doc;
        try {
          doc = iframe.contentDocument || iframe.contentWindow.document;
        } catch (e) {
          cleanup();
          resolve([]);
          return;
        }
        if (!doc || doc.location.origin !== window.location.origin) {
          cleanup();
          resolve([]);
          return;
        }
        waitForElement(doc, function (d) {
          var body = d.body;
          return body && body.innerText && body.innerText.indexOf("Average Grade") !== -1;
        }, timeoutMs).then(
          function () {
            var grades = scrapeAverageGradesFromDocument(doc);
            cleanup();
            resolve(grades);
          },
          function () {
            cleanup();
            resolve([]);
          }
        );
      };

      iframe.onerror = function () {
        cleanup();
        resolve([]);
      };

      document.body.appendChild(iframe);
    });
  }

  function timeoutMs(ms) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("timeout")); }, ms);
    });
  }

  async function getClasslist(orgUnitId) {
    var list = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    var classlistTimeout = 12000;
    while (nextUrl && pageCount < 50) {
      pageCount++;
      if (seenUrls[nextUrl]) break;
      seenUrls[nextUrl] = true;
      try {
        var data = await Promise.race([
          BrightspaceFetch(nextUrl).catch(function () { return null; }),
          timeoutMs(classlistTimeout)
        ]);
        var objects = (data && data.Objects) || [];
        if (!objects.length) break;
        for (var i = 0; i < objects.length; i++) list.push(objects[i]);
        var next = data && data.Next ? String(data.Next) : "";
        if (!next) {
          nextUrl = null;
        } else if (next.indexOf("/d2l/api/") >= 0) {
          var parts = next.split("/d2l/api/");
          nextUrl = parts.length > 1 ? "/d2l/api/" + parts[1] : null;
        } else if (next.indexOf("/") === 0) {
          nextUrl = next;
        } else {
          nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
        }
      } catch (e) {
        break;
      }
    }
    return list;
  }

  function formatMinutes(minutes) {
    if (minutes == null || isNaN(minutes)) return "N/A";
    if (minutes < 60) return Math.round(minutes) + " min";
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    return h + " hr" + (h !== 1 ? "s" : "") + (m > 0 ? " " + m + " min" : "");
  }

  function showLoading(show) {
    var loading = document.getElementById("quiz-detail-loading");
    var content = document.getElementById("quiz-detail-content");
    var errEl = document.getElementById("quiz-detail-error");
    if (loading) loading.style.display = show ? "block" : "none";
    if (content) content.style.display = show ? "none" : "block";
    if (errEl) errEl.style.display = "none";
  }
  function setLoadingStatus(text) {
    var el = document.getElementById("quiz-detail-loading-status");
    if (el) el.textContent = text || "Loading…";
  }

  function showError(msg) {
    var loading = document.getElementById("quiz-detail-loading");
    var content = document.getElementById("quiz-detail-content");
    var errEl = document.getElementById("quiz-detail-error");
    var errMsg = document.getElementById("quiz-detail-error-msg");
    if (loading) loading.style.display = "none";
    if (content) content.style.display = "none";
    if (errEl) errEl.style.display = "block";
    if (errMsg) errMsg.textContent = msg;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setBar(id, percent) {
    var el = document.getElementById(id);
    if (!el) return;
    var pct = Math.min(100, Math.max(0, Number(percent) || 0));
    el.style.width = pct + "%";
  }

  async function loadQuizDetail() {
    var courseId = getUrlParam("courseId");
    var quizId = getUrlParam("quizId");
    var quizName = getUrlParam("quizName") || "Quiz";

    if (!courseId || !quizId) {
      showError("Missing course or quiz. Go back to Quizzes and open \"More in-depth data\" for a quiz.");
      return;
    }

    var titleEl = document.getElementById("quiz-detail-title");
    var breadcrumbEl = document.getElementById("quiz-detail-breadcrumb");
    if (titleEl) titleEl.textContent = quizName;
    if (breadcrumbEl) breadcrumbEl.textContent = quizName;

    var d2lLink = document.getElementById("quiz-detail-open-d2l");
    if (d2lLink) {
      d2lLink.href = "/d2l/lms/quizzing/admin/mark/quiz_mark_users.d2l?qi=" + quizId + "&ou=" + courseId;
    }
    var backLink = document.getElementById("quiz-detail-back-quizzes");
    if (backLink) {
      backLink.href = "quizzes.html?courseId=" + encodeURIComponent(courseId);
    }

    showLoading(true);
    setLoadingStatus("Starting…");

    try {
      var base = "/d2l/api/le/" + API_VERSION_LE + "/" + courseId;
      var quizUrl = base + "/quizzes/" + quizId;
      var attemptsUrl = base + "/quizzes/" + quizId + "/attempts/";
      var questionsUrl = base + "/quizzes/" + quizId + "/questions/";

      setLoadingStatus("Loading quiz…");
      var quizData = await BrightspaceFetch(quizUrl).catch(function () { return null; });

      // Fetch all pages of attempts (ObjectListPage: Objects + Next URL per Valence docs)
      var attempts = [];
      var nextUrl = attemptsUrl;
      var pageCount = 0;
      var maxPages = 50; // Safety limit to prevent infinite loops
      while (nextUrl && pageCount < maxPages) {
        pageCount++;
        setLoadingStatus("Loading attempts… (page " + pageCount + ")");
        try {
          // Extract path from Next URL if it's a full URL
          var fetchUrl = nextUrl;
          if (nextUrl.indexOf("http") === 0) {
            var urlMatch = nextUrl.match(/\/d2l\/api\/.*$/);
            if (urlMatch) fetchUrl = urlMatch[0];
            else {
              console.warn("Could not extract path from Next URL:", nextUrl);
              break;
            }
          }
          var attemptsPage = await BrightspaceFetch(fetchUrl);
          var pageList = (attemptsPage && attemptsPage.Objects) ? attemptsPage.Objects : (attemptsPage && attemptsPage.Items) ? attemptsPage.Items : [];
          for (var a = 0; a < pageList.length; a++) attempts.push(pageList[a]);
          // Stop if no more pages or if Next URL is the same as current (prevents infinite loop)
          var newNext = (attemptsPage && attemptsPage.Next) ? attemptsPage.Next : null;
          if (!newNext || newNext === nextUrl) break;
          nextUrl = newNext;
        } catch (e) {
          console.warn("Error fetching attempts page:", e);
          break;
        }
      }

      // Fetch all pages of questions (ObjectListPage per Valence docs). URL uses trailing slash per API.
      var questions = [];
      var qNextUrl = questionsUrl;
      var qPageCount = 0;
      while (qNextUrl && qPageCount < 50) {
        qPageCount++;
        setLoadingStatus("Loading questions… (page " + qPageCount + ")");
        try {
          var qFetchUrl = qNextUrl;
          if (qNextUrl.indexOf("http") === 0) {
            var qMatch = qNextUrl.match(/\/d2l\/api\/.*$/);
            if (qMatch) qFetchUrl = qMatch[0];
            else break;
          }
          var questionsPage = await BrightspaceFetch(qFetchUrl).catch(function () { return { Objects: [], Next: null }; });
          var qItems = (questionsPage && questionsPage.Objects) ? questionsPage.Objects : (questionsPage && questionsPage.Items) ? questionsPage.Items : (Array.isArray(questionsPage) ? questionsPage : []);
          for (var qi = 0; qi < qItems.length; qi++) questions.push(qItems[qi]);
          var qNewNext = (questionsPage && questionsPage.Next) ? questionsPage.Next : null;
          if (!qNewNext || qNewNext === qNextUrl) break;
          qNextUrl = qNewNext;
        } catch (e) {
          break;
        }
      }

      var totalPossible = 0;
      for (var q = 0; q < questions.length; q++) {
        totalPossible += (questions[q].Points || 0);
      }
      if (totalPossible === 0 && quizData && (quizData.MaxPoints != null || quizData.TotalPoints != null)) {
        totalPossible = quizData.MaxPoints != null ? quizData.MaxPoints : quizData.TotalPoints || 0;
      }
      // Grade item: use Grades API 1.80 for /grades/{id} and /grades/{id}/values/
      var gradeItemId = quizData && quizData.GradeItemId ? quizData.GradeItemId : null;
      var gradeBase = "/d2l/api/le/" + API_VERSION_GRADES + "/" + courseId;
      var gradeItem = null;
      var gradeValuesList = [];

      if (gradeItemId) {
        setLoadingStatus("Loading grade item…");
        // Try grade object with multiple LE versions (1.80, 1.78, 1.49) so one works
        var gradeVersionsToTry = [API_VERSION_GRADES, API_VERSION_LE, "1.49"];
        for (var gv = 0; gv < gradeVersionsToTry.length && !gradeItem; gv++) {
          var gBase = "/d2l/api/le/" + gradeVersionsToTry[gv] + "/" + courseId;
          gradeItem = await BrightspaceFetch(gBase + "/grades/" + gradeItemId).catch(function () { return null; });
        }
        if (gradeItem && (gradeItem.MaxPoints != null || gradeItem.PointsDenominator != null)) {
          totalPossible = gradeItem.MaxPoints != null ? gradeItem.MaxPoints : gradeItem.PointsDenominator;
        }

        // Fetch all grade values (paginated) for this grade item
        var gvNextUrl = gradeBase + "/grades/" + gradeItemId + "/values/?pageSize=100";
        var gvPageCount = 0;
        while (gvNextUrl && gvPageCount < 50) {
          gvPageCount++;
          setLoadingStatus("Loading grade values… (page " + gvPageCount + ")");
          try {
            var gvFetchUrl = gvNextUrl;
            if (gvNextUrl.indexOf("http") === 0) {
              var gvMatch = gvNextUrl.match(/\/d2l\/api\/.*$/);
              if (gvMatch) gvFetchUrl = gvMatch[0];
              else break;
            }
            var gvPage = await BrightspaceFetch(gvFetchUrl).catch(function () { return { Objects: [], Next: null }; });
            var gvItems = (gvPage && gvPage.Objects) ? gvPage.Objects : (gvPage && gvPage.Items) ? gvPage.Items : (Array.isArray(gvPage) ? gvPage : []);
            for (var gvi = 0; gvi < gvItems.length; gvi++) gradeValuesList.push(gvItems[gvi]);
            var gvNewNext = (gvPage && gvPage.Next) ? gvPage.Next : null;
            if (!gvNewNext || gvNewNext === gvNextUrl) break;
            gvNextUrl = gvNewNext;
          } catch (err) {
            break;
          }
        }
      }

      // If still no totalPossible, try from first grade value
      if (totalPossible === 0 && gradeValuesList.length > 0) {
        for (var v = 0; v < gradeValuesList.length; v++) {
          var gv = gradeValuesList[v].GradeValue || gradeValuesList[v].Grade || gradeValuesList[v];
          var denom = gv && (gv.PointsDenominator != null || gv.MaxPoints != null)
            ? (gv.PointsDenominator != null ? gv.PointsDenominator : gv.MaxPoints) : 0;
          if (denom > 0) {
            totalPossible = denom;
            break;
          }
        }
      }

      var completedAttempts = [];
      var attemptTimeEntries = []; // { minutes, userId } for distribution chart and student list
      var maxAttemptScore = 0;
      var totalTimeMinutes = 0;
      var timeCount = 0;
      var below65Count = 0;
      var lateCount = 0;
      var scoreSum = 0;
      var scoreCount = 0;
      var quizDueDate = (quizData && (quizData.DueDate || quizData.EndDate)) ? (quizData.DueDate || quizData.EndDate) : null;
      var lateList = []; // { userId, completed } for list panel
      var inProgressList = []; // { userId, started } for Attempt Count panel

      for (var i = 0; i < attempts.length; i++) {
        var att = attempts[i];
        var isCompleted = att.Completed != null && att.Completed !== "";
        if (isCompleted) {
          var attemptUserId = att.UserId != null ? String(att.UserId) : (att.User && att.User.Id != null) ? String(att.User.Id) : null;
          completedAttempts.push(att);
          var score = (att.Score != null && att.Score !== undefined) ? Number(att.Score) : 0;
          if (score > maxAttemptScore) maxAttemptScore = score;
          scoreSum += score;
          scoreCount++;
          // Submitted late
          var dueDate = (att.AttemptDueDate != null && att.AttemptDueDate !== "") ? att.AttemptDueDate : quizDueDate;
          if (dueDate) {
            var completedMs = new Date(att.Completed).getTime();
            var dueMs = new Date(dueDate).getTime();
            if (!isNaN(completedMs) && !isNaN(dueMs) && completedMs > dueMs) {
              lateCount++;
              lateList.push({ userId: attemptUserId, completed: att.Completed });
            }
          }
          var start = att.Started != null ? att.Started : (att.AttemptDate || att.TimeStarted);
          var end = att.Completed != null ? att.Completed : (att.CompletionDate || att.TimeCompleted);
          if (start && end) {
            var startMs = new Date(start).getTime();
            var endMs = new Date(end).getTime();
            if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
              var mins = (endMs - startMs) / (1000 * 60);
              totalTimeMinutes += mins;
              timeCount++;
              var attemptUserId = att.UserId != null ? String(att.UserId) : (att.User && att.User.Id != null) ? String(att.User.Id) : null;
              attemptTimeEntries.push({ minutes: mins, userId: attemptUserId });
            }
          }
        } else {
          var inProgressUserId = att.UserId != null ? String(att.UserId) : (att.User && att.User.Id != null) ? String(att.User.Id) : null;
          var started = att.Started != null ? att.Started : (att.AttemptDate || att.TimeStarted);
          inProgressList.push({ userId: inProgressUserId, started: started });
        }
      }

      var inProgressCount = inProgressList.length;

      // Last resort: quiz is linked to gradebook but we couldn't fetch MaxPoints — use max attempt score as denominator so we show % not pts
      if (totalPossible === 0 && maxAttemptScore > 0 && (gradeItemId || (quizData && quizData.AutoExportToGrades))) {
        totalPossible = maxAttemptScore;
      }

      // Helper: get PointsNumerator and PointsDenominator from a grade value row (multiple API shapes)
      function getPointsFromGradeValue(row) {
        var gv = row && (row.GradeValue || row.Grade);
        if (!gv) gv = row;
        if (!gv) return { num: null, denom: null };
        var num = gv.PointsNumerator != null ? Number(gv.PointsNumerator) : (row.PointsNumerator != null ? Number(row.PointsNumerator) : null);
        var denom = gv.PointsDenominator != null ? Number(gv.PointsDenominator) : (row.PointsDenominator != null ? Number(row.PointsDenominator) : null);
        return { num: num, denom: denom };
      }

      // Score and Below 65%: prefer grade values (matches gradebook), then grade object MaxPoints + attempts, never show "pts" if we have totalPossible
      var avgScorePct = null;
      var avgScoreDisplay = "N/A";
      if (gradeValuesList.length > 0) {
        var pctSum = 0;
        var pctCount = 0;
        var below65FromGrades = 0;
        for (var vi = 0; vi < gradeValuesList.length; vi++) {
          var pts = getPointsFromGradeValue(gradeValuesList[vi]);
          var denom = pts.denom > 0 ? pts.denom : (totalPossible || 0);
          if (pts.num != null && denom > 0) {
            var pct = (pts.num / denom) * 100;
            pctSum += pct;
            pctCount++;
            if (pct < 65) below65FromGrades++;
          }
        }
        if (pctCount > 0) {
          avgScorePct = Math.round(pctSum / pctCount);
          avgScoreDisplay = avgScorePct + "%";
          below65Count = below65FromGrades;
        }
      }
      // If no grade values but we have totalPossible (from grade object MaxPoints), use attempt scores for percentage
      if (avgScoreDisplay === "N/A" && scoreCount > 0 && totalPossible > 0) {
        avgScorePct = Math.round((scoreSum / scoreCount / totalPossible) * 100);
        avgScoreDisplay = avgScorePct + "%";
        for (var ai = 0; ai < completedAttempts.length; ai++) {
          var s = (completedAttempts[ai].Score != null && completedAttempts[ai].Score !== undefined)
            ? Number(completedAttempts[ai].Score) : 0;
          if ((s / totalPossible) * 100 < 65) below65Count++;
        }
      }
      // Only show raw points when we truly have no total possible (quiz not linked or grade object unavailable)
      if (avgScoreDisplay === "N/A" && scoreCount > 0) {
        var avgRawScore = (scoreSum / scoreCount).toFixed(1);
        avgScoreDisplay = avgRawScore + " pts";
      }
      var avgTimeMin = timeCount > 0 ? totalTimeMinutes / timeCount : null;
      var questionDataStr = "N/A";
      var questionsAvailable = questions.length > 0;
      if (questionsAvailable && scoreCount > 0 && totalPossible > 0) {
        var avgCorrect = (scoreSum / scoreCount / (totalPossible / questions.length));
        questionDataStr = (avgCorrect.toFixed(1) + " / " + questions.length);
      } else if (!questionsAvailable && (quizData && quizData.ActivityId)) {
        questionDataStr = "Unavailable";
      }

      var specialAccessCount = "N/A";
      var specialAccessRawList = [];
      try {
        setLoadingStatus("Loading special access…");
        var specialAccessUrl = base + "/quizzes/" + quizId + "/specialaccess/";
        var specialData = await BrightspaceFetch(specialAccessUrl).catch(function () { return null; });
        if (specialData && Array.isArray(specialData)) {
          specialAccessCount = String(specialData.length);
          specialAccessRawList = specialData;
        } else if (specialData && specialData.Objects) {
          specialAccessCount = String((specialData.Objects || []).length);
          specialAccessRawList = specialData.Objects || [];
        }
      } catch (e) {
        specialAccessCount = "N/A";
      }

      var courseName = "Course";
      try {
        var AC = activeSemesterCode();
        var coursesData = localStorage.getItem("dashboardCourses");
        if (coursesData) {
          var courses = JSON.parse(coursesData).filter(function(c) {
            var code = (c.OrgUnit && c.OrgUnit.Code) ? c.OrgUnit.Code : "";
            return code.indexOf(AC) >= 0;
          });
          for (var c = 0; c < courses.length; c++) {
            if (String(courses[c].OrgUnit.Id) === String(courseId)) {
              courseName = courses[c].OrgUnit.Name || courseName;
              break;
            }
          }
        }
      } catch (e) {}
      setText("quiz-detail-course", courseName);

      var questionCountUnavailableMsg = "Question count unavailable if in a Question Pool";
      var infoBar = document.getElementById("quiz-detail-info-bar");
      if (infoBar) {
        var questionCountStr = questions.length > 0 ? String(questions.length) : (quizData && quizData.ActivityId ? "— (" + questionCountUnavailableMsg + ")" : "0");
        infoBar.textContent = "Quiz information: Number of questions: " + questionCountStr + " • Total attempts: " + attempts.length + (completedAttempts.length !== attempts.length ? " • Completed: " + completedAttempts.length : "");
      }

      // Display score: percentage with bar if we have totalPossible, otherwise raw points without bar
      setText("metric-score", avgScoreDisplay);
      setBar("metric-score-bar", avgScorePct != null ? avgScorePct : 0);
      setText("metric-time", formatMinutes(avgTimeMin));
      setText("metric-attempts", String(attempts.length));
      var inProgressEl = document.getElementById("metric-attempts-in-progress");
      if (inProgressEl) inProgressEl.textContent = inProgressCount > 0 ? inProgressCount + " in progress" : "0 in progress";
      setText("metric-questions", questionDataStr);
      setText("metric-below65", String(below65Count));
      setText("metric-special-access", specialAccessCount);
      setText("metric-late", String(lateCount));

      // Resolve user IDs to display names via classlist
      var userIdToName = {};
      try {
        setLoadingStatus("Loading class list…");
        var classlist = await getClasslist(courseId);
        for (var cl = 0; cl < classlist.length; cl++) {
          var u = classlist[cl];
          var id = u.Identifier != null ? String(u.Identifier) : (u.UserId != null ? String(u.UserId) : null);
          if (id) userIdToName[id] = (u.FirstName || "").trim() + " " + (u.LastName || "").trim();
        }
      } catch (e) {}

      // Build time-spent buckets with counts and list of students per bucket
      var timeSpentBucketDefs = [
        { label: "0–5 min", min: 0, max: 5 },
        { label: "5–10 min", min: 5, max: 10 },
        { label: "10–15 min", min: 10, max: 15 },
        { label: "15–20 min", min: 15, max: 20 },
        { label: "20–30 min", min: 20, max: 30 },
        { label: "30+ min", min: 30, max: Infinity }
      ];
      var timeSpentBucketCounts = timeSpentBucketDefs.map(function () { return 0; });
      var timeSpentBucketStudents = timeSpentBucketDefs.map(function () { return []; });
      for (var b = 0; b < attemptTimeEntries.length; b++) {
        var entry = attemptTimeEntries[b];
        var m = entry.minutes;
        var displayName = (entry.userId && userIdToName[entry.userId]) ? userIdToName[entry.userId].trim() : (entry.userId ? "User " + entry.userId : "Unknown");
        for (var d = 0; d < timeSpentBucketDefs.length; d++) {
          if (m >= timeSpentBucketDefs[d].min && m < timeSpentBucketDefs[d].max) {
            timeSpentBucketCounts[d]++;
            timeSpentBucketStudents[d].push({ userId: entry.userId, displayName: displayName, minutes: m });
            break;
          }
          if (timeSpentBucketDefs[d].max === Infinity && m >= timeSpentBucketDefs[d].min) {
            timeSpentBucketCounts[d]++;
            timeSpentBucketStudents[d].push({ userId: entry.userId, displayName: displayName, minutes: m });
            break;
          }
        }
      }
      var timeSpentChartData = timeSpentBucketDefs.map(function (def, idx) {
        return { label: def.label, count: timeSpentBucketCounts[idx], students: timeSpentBucketStudents[idx] || [] };
      });

      // Build score distribution buckets (for Score chart): 0-65%, 65-75%, 75-85%, 85-95%, 95-100%
      var scoreBucketDefs = [
        { label: "0–65%", min: 0, max: 65 },
        { label: "65–75%", min: 65, max: 75 },
        { label: "75–85%", min: 75, max: 85 },
        { label: "85–95%", min: 85, max: 95 },
        { label: "95–100%", min: 95, max: 100.01 }
      ];
      var scoreBucketCounts = scoreBucketDefs.map(function () { return 0; });
      var scoreBucketStudents = scoreBucketDefs.map(function () { return []; });
      var scoreEntries = []; // { userId, pct } for distribution
      if (gradeValuesList.length > 0 && totalPossible > 0) {
        for (var gvi = 0; gvi < gradeValuesList.length; gvi++) {
          var gvRow = gradeValuesList[gvi];
          var pts = getPointsFromGradeValue(gvRow);
          var denom = pts.denom > 0 ? pts.denom : totalPossible;
          if (pts.num == null || denom <= 0) continue;
          var pct = (pts.num / denom) * 100;
          var uid = (gvRow.User && (gvRow.User.Id != null || gvRow.User.Identifier != null)) ? String(gvRow.User.Id != null ? gvRow.User.Id : gvRow.User.Identifier) : (gvRow.UserId != null ? String(gvRow.UserId) : null);
          scoreEntries.push({ userId: uid, pct: pct });
        }
      } else if (completedAttempts.length > 0 && totalPossible > 0) {
        // Fallback: best attempt score per user
        var bestByUser = {};
        for (var ai = 0; ai < completedAttempts.length; ai++) {
          var a = completedAttempts[ai];
          var uid = a.UserId != null ? String(a.UserId) : (a.User && a.User.Id != null) ? String(a.User.Id) : null;
          if (!uid) continue;
          var s = (a.Score != null && a.Score !== undefined) ? Number(a.Score) : 0;
          var p = (s / totalPossible) * 100;
          if (bestByUser[uid] == null || p > bestByUser[uid]) bestByUser[uid] = p;
        }
        for (var uidKey in bestByUser) if (Object.prototype.hasOwnProperty.call(bestByUser, uidKey)) scoreEntries.push({ userId: uidKey, pct: bestByUser[uidKey] });
      }
      for (var se = 0; se < scoreEntries.length; se++) {
        var ent = scoreEntries[se];
        var pct = ent.pct;
        var displayName = (ent.userId && userIdToName[ent.userId]) ? userIdToName[ent.userId].trim() : (ent.userId ? "User " + ent.userId : "Unknown");
        for (var sb = 0; sb < scoreBucketDefs.length; sb++) {
          if (pct >= scoreBucketDefs[sb].min && pct < scoreBucketDefs[sb].max) {
            scoreBucketCounts[sb]++;
            scoreBucketStudents[sb].push({ userId: ent.userId, displayName: displayName, pct: pct });
            break;
          }
        }
      }
      var scoreChartData = scoreBucketDefs.map(function (def, idx) {
        return { label: def.label, count: scoreBucketCounts[idx], students: scoreBucketStudents[idx] || [] };
      });

      // Lists for Below 65%, Special Access, Submitted late (for list panels)
      var below65List = (scoreChartData[0] && scoreChartData[0].students) ? scoreChartData[0].students : [];
      var specialAccessList = [];
      for (var sa = 0; sa < specialAccessRawList.length; sa++) {
        var saItem = specialAccessRawList[sa];
        var saUserId = (saItem.UserId != null) ? String(saItem.UserId) : (saItem.User && (saItem.User.Id != null || saItem.User.Identifier != null)) ? String(saItem.User.Id != null ? saItem.User.Id : saItem.User.Identifier) : (saItem.Id != null ? String(saItem.Id) : null);
        var saName = (saUserId && userIdToName[saUserId]) ? userIdToName[saUserId].trim() : (saUserId ? "User " + saUserId : "Unknown");
        specialAccessList.push({ userId: saUserId, displayName: saName });
      }
      var lateListWithNames = [];
      for (var ll = 0; ll < lateList.length; ll++) {
        var le = lateList[ll];
        var lateName = (le.userId && userIdToName[le.userId]) ? userIdToName[le.userId].trim() : (le.userId ? "User " + le.userId : "Unknown");
        lateListWithNames.push({ userId: le.userId, displayName: lateName, completed: le.completed });
      }

      // Completed attempts list and In-Progress list (for Attempt Count panel)
      var completedAttemptsListWithNames = [];
      for (var ca = 0; ca < completedAttempts.length; ca++) {
        var catt = completedAttempts[ca];
        var cuid = catt.UserId != null ? String(catt.UserId) : (catt.User && catt.User.Id != null) ? String(catt.User.Id) : null;
        var cname = (cuid && userIdToName[cuid]) ? userIdToName[cuid].trim() : (cuid ? "User " + cuid : "Unknown");
        completedAttemptsListWithNames.push({ userId: cuid, displayName: cname, completed: catt.Completed });
      }
      var inProgressListWithNames = [];
      for (var ip = 0; ip < inProgressList.length; ip++) {
        var ie = inProgressList[ip];
        var iname = (ie.userId && userIdToName[ie.userId]) ? userIdToName[ie.userId].trim() : (ie.userId ? "User " + ie.userId : "Unknown");
        inProgressListWithNames.push({ userId: ie.userId, displayName: iname, started: ie.started });
      }

      // Wire Time spent card click to toggle chart
      var timeCard = document.getElementById("quiz-metric-time-card");
      var timeChartPanel = document.getElementById("quiz-time-spent-chart-panel");
      var timeChartBody = document.getElementById("quiz-time-spent-chart-body");
      var timeSpentStudentsPanel = document.getElementById("quiz-time-spent-students-panel");
      function renderTimeSpentChart() {
        if (!timeChartBody) return;
        if (attemptTimeEntries.length === 0) {
          timeChartBody.innerHTML = '<p class="quiz-time-chart-no-data">No time data for completed attempts.</p>';
          if (timeSpentStudentsPanel) timeSpentStudentsPanel.style.display = "none";
          var chartCue = document.getElementById("quiz-time-chart-click-cue");
          if (chartCue) chartCue.style.display = "none";
          return;
        }
        var chartCue = document.getElementById("quiz-time-chart-click-cue");
        if (chartCue) chartCue.style.display = "block";
        var maxCount = Math.max(1, Math.max.apply(null, timeSpentBucketCounts));
        var barMaxHeightPx = 140;
        var html = '<div class="quiz-time-chart-y-label">Attempts</div><div class="quiz-time-chart-area">';
        html += '<div class="quiz-time-chart-bars" id="quiz-time-chart-bars">';
        for (var i = 0; i < timeSpentChartData.length; i++) {
          var heightPx = maxCount > 0 ? Math.round((timeSpentChartData[i].count / maxCount) * barMaxHeightPx) : 0;
          if (timeSpentChartData[i].count > 0 && heightPx < 4) heightPx = 4;
          var clickable = timeSpentChartData[i].count > 0 ? " quiz-time-chart-bar-wrap-clickable" : "";
          html += '<div class="quiz-time-chart-bar-wrap' + clickable + '" data-bucket-index="' + i + '" role="' + (timeSpentChartData[i].count > 0 ? "button" : "none") + '" tabindex="' + (timeSpentChartData[i].count > 0 ? "0" : "-1") + '" title="' + (timeSpentChartData[i].count > 0 ? "Click to see students in " + timeSpentChartData[i].label : timeSpentChartData[i].label + ": 0 attempts") + '">';
          html += '<span class="quiz-time-chart-bar-value">' + timeSpentChartData[i].count + '</span>';
          html += '<div class="quiz-time-chart-bar" style="height: ' + heightPx + 'px;"></div>';
          html += '</div>';
        }
        html += '</div><div class="quiz-time-chart-x-labels">';
        for (var j = 0; j < timeSpentChartData.length; j++) {
          html += '<span class="quiz-time-chart-x-label">' + timeSpentChartData[j].label + '</span>';
        }
        html += '</div></div>';
        timeChartBody.innerHTML = html;
        if (timeSpentStudentsPanel) timeSpentStudentsPanel.style.display = "none";

        // Click on bar to show students in that bucket
        var barsContainer = document.getElementById("quiz-time-chart-bars");
        if (barsContainer) {
          barsContainer.addEventListener("click", function (e) {
            var wrap = e.target.closest(".quiz-time-chart-bar-wrap-clickable");
            if (!wrap || !timeSpentStudentsPanel) return;
            var idx = parseInt(wrap.getAttribute("data-bucket-index"), 10);
            if (isNaN(idx) || !timeSpentChartData[idx] || timeSpentChartData[idx].students.length === 0) return;
            var bucket = timeSpentChartData[idx];
            var listHtml = '<h4 class="quiz-time-spent-students-title">Students in ' + bucket.label + '</h4><ul class="quiz-time-spent-students-list">';
            for (var s = 0; s < bucket.students.length; s++) {
              var stu = bucket.students[s];
              var timeStr = stu.minutes < 60 ? Math.round(stu.minutes) + " min" : Math.floor(stu.minutes / 60) + " hr " + Math.round(stu.minutes % 60) + " min";
              listHtml += '<li>' + escapeHtml(stu.displayName) + ' <span class="quiz-time-spent-student-time">(' + timeStr + ')</span></li>';
            }
            listHtml += '</ul>';
            timeSpentStudentsPanel.innerHTML = listHtml;
            timeSpentStudentsPanel.style.display = "block";
          });
          barsContainer.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " ") return;
            var wrap = e.target.closest(".quiz-time-chart-bar-wrap-clickable");
            if (!wrap) return;
            e.preventDefault();
            wrap.click();
          });
        }
      }
      function escapeHtml(text) {
        if (!text) return "";
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }
      function toggleTimeSpentChart() {
        if (!timeChartPanel || !timeCard) return;
        var isExpanded = timeChartPanel.style.display !== "none";
        if (isExpanded) {
          timeChartPanel.style.display = "none";
          timeCard.setAttribute("aria-expanded", "false");
        } else {
          closeAllDetailPanels();
          timeChartPanel.style.display = "block";
          timeCard.setAttribute("aria-expanded", "true");
          renderTimeSpentChart();
        }
      }
      if (timeCard) {
        timeCard.addEventListener("click", toggleTimeSpentChart);
        timeCard.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleTimeSpentChart();
          }
        });
      }

      // Score card: click to toggle score distribution chart (no Info button)
      var scoreCard = document.getElementById("quiz-metric-score-card");
      var scoreChartPanel = document.getElementById("quiz-score-chart-panel");
      var scoreChartBody = document.getElementById("quiz-score-chart-body");
      var scoreStudentsPanel = document.getElementById("quiz-score-students-panel");

      function closeAllDetailPanels() {
        if (timeChartPanel) timeChartPanel.style.display = "none";
        if (timeCard) timeCard.setAttribute("aria-expanded", "false");
        if (timeSpentStudentsPanel) timeSpentStudentsPanel.style.display = "none";
        if (scoreChartPanel) scoreChartPanel.style.display = "none";
        if (scoreCard) scoreCard.setAttribute("aria-expanded", "false");
        if (scoreStudentsPanel) scoreStudentsPanel.style.display = "none";
        var listPanelIds = ["quiz-attempts-list-panel", "quiz-questions-list-panel", "quiz-below65-list-panel", "quiz-special-access-list-panel", "quiz-late-list-panel"];
        var listCardIds = ["quiz-metric-attempts-card", "quiz-metric-questions-card", "quiz-metric-below65-card", "quiz-metric-special-access-card", "quiz-metric-late-card"];
        for (var i = 0; i < listPanelIds.length; i++) {
          var p = document.getElementById(listPanelIds[i]);
          if (p) p.style.display = "none";
        }
        for (var j = 0; j < listCardIds.length; j++) {
          var c = document.getElementById(listCardIds[j]);
          if (c) c.setAttribute("aria-expanded", "false");
        }
      }

      function renderScoreChart() {
        if (!scoreChartBody) return;
        if (scoreEntries.length === 0) {
          scoreChartBody.innerHTML = '<p class="quiz-time-chart-no-data">No score data available.</p>';
          if (scoreStudentsPanel) scoreStudentsPanel.style.display = "none";
          var scoreCue = document.getElementById("quiz-score-chart-click-cue");
          if (scoreCue) scoreCue.style.display = "none";
          return;
        }
        var scoreCue = document.getElementById("quiz-score-chart-click-cue");
        if (scoreCue) scoreCue.style.display = "block";
        var maxCount = Math.max(1, Math.max.apply(null, scoreBucketCounts));
        var barMaxHeightPx = 140;
        var html = '<div class="quiz-time-chart-y-label">Students</div><div class="quiz-time-chart-area">';
        html += '<div class="quiz-time-chart-bars" id="quiz-score-chart-bars">';
        for (var i = 0; i < scoreChartData.length; i++) {
          var heightPx = maxCount > 0 ? Math.round((scoreChartData[i].count / maxCount) * barMaxHeightPx) : 0;
          if (scoreChartData[i].count > 0 && heightPx < 4) heightPx = 4;
          var clickable = scoreChartData[i].count > 0 ? " quiz-time-chart-bar-wrap-clickable" : "";
          html += '<div class="quiz-time-chart-bar-wrap' + clickable + '" data-bucket-index="' + i + '" role="' + (scoreChartData[i].count > 0 ? "button" : "none") + '" tabindex="' + (scoreChartData[i].count > 0 ? "0" : "-1") + '" title="' + (scoreChartData[i].count > 0 ? "Click to see students in " + scoreChartData[i].label : scoreChartData[i].label + ": 0 students") + '">';
          html += '<span class="quiz-time-chart-bar-value">' + scoreChartData[i].count + '</span>';
          html += '<div class="quiz-time-chart-bar" style="height: ' + heightPx + 'px;"></div>';
          html += '</div>';
        }
        html += '</div><div class="quiz-time-chart-x-labels">';
        for (var j = 0; j < scoreChartData.length; j++) {
          html += '<span class="quiz-time-chart-x-label">' + scoreChartData[j].label + '</span>';
        }
        html += '</div></div>';
        scoreChartBody.innerHTML = html;
        if (scoreStudentsPanel) scoreStudentsPanel.style.display = "none";

        var scoreBarsContainer = document.getElementById("quiz-score-chart-bars");
        if (scoreBarsContainer) {
          scoreBarsContainer.addEventListener("click", function (e) {
            var wrap = e.target.closest(".quiz-time-chart-bar-wrap-clickable");
            if (!wrap || !scoreStudentsPanel) return;
            var idx = parseInt(wrap.getAttribute("data-bucket-index"), 10);
            if (isNaN(idx) || !scoreChartData[idx] || scoreChartData[idx].students.length === 0) return;
            var bucket = scoreChartData[idx];
            var listHtml = '<h4 class="quiz-time-spent-students-title">Students in ' + bucket.label + '</h4><ul class="quiz-time-spent-students-list">';
            for (var s = 0; s < bucket.students.length; s++) {
              var stu = bucket.students[s];
              listHtml += '<li>' + escapeHtml(stu.displayName) + ' <span class="quiz-time-spent-student-time">(' + Math.round(stu.pct) + '%)</span></li>';
            }
            listHtml += '</ul>';
            scoreStudentsPanel.innerHTML = listHtml;
            scoreStudentsPanel.style.display = "block";
          });
          scoreBarsContainer.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " ") return;
            var wrap = e.target.closest(".quiz-time-chart-bar-wrap-clickable");
            if (!wrap) return;
            e.preventDefault();
            wrap.click();
          });
        }
      }
      function toggleScoreChart() {
        if (!scoreChartPanel || !scoreCard) return;
        var isExpanded = scoreChartPanel.style.display !== "none";
        if (isExpanded) {
          scoreChartPanel.style.display = "none";
          scoreCard.setAttribute("aria-expanded", "false");
        } else {
          closeAllDetailPanels();
          scoreChartPanel.style.display = "block";
          scoreCard.setAttribute("aria-expanded", "true");
          renderScoreChart();
        }
      }
      if (scoreCard) {
        scoreCard.addEventListener("click", toggleScoreChart);
        scoreCard.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleScoreChart();
          }
        });
      }

      // Below 65%, Special Access, Submitted late: click card to toggle list panel
      function makeListPanelToggle(cardId, panelId, bodyId, list, renderItem) {
        var card = document.getElementById(cardId);
        var panel = document.getElementById(panelId);
        var body = document.getElementById(bodyId);
        if (!card || !panel || !body) return;
        function toggle() {
          var show = panel.style.display === "none";
          if (show) {
            closeAllDetailPanels();
            panel.style.display = "block";
            card.setAttribute("aria-expanded", "true");
            if (list && list.length > 0) {
              var html = "<ul class=\"quiz-time-spent-students-list\">";
              for (var k = 0; k < list.length; k++) html += "<li>" + renderItem(list[k]) + "</li>";
              html += "</ul>";
              body.innerHTML = html;
            } else {
              body.innerHTML = "<p class=\"quiz-time-chart-no-data\">No entries.</p>";
            }
          } else {
            panel.style.display = "none";
            card.setAttribute("aria-expanded", "false");
          }
        }
        card.addEventListener("click", toggle);
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
      }
      makeListPanelToggle("quiz-metric-below65-card", "quiz-below65-list-panel", "quiz-below65-list-body", below65List, function (item) {
        return escapeHtml(item.displayName) + " <span class=\"quiz-time-spent-student-time\">(" + Math.round(item.pct) + "%)</span>";
      });
      makeListPanelToggle("quiz-metric-special-access-card", "quiz-special-access-list-panel", "quiz-special-access-list-body", specialAccessList, function (item) {
        return escapeHtml(item.displayName);
      });
      makeListPanelToggle("quiz-metric-late-card", "quiz-late-list-panel", "quiz-late-list-body", lateListWithNames, function (item) {
        var dateStr = item.completed ? new Date(item.completed).toLocaleString() : "";
        return escapeHtml(item.displayName) + (dateStr ? " <span class=\"quiz-time-spent-student-time\">(" + dateStr + ")</span>" : "");
      });

      // Question Data card: item analysis panel.
      // Average grades are scraped from the D2L Question Details stats page (same-origin iframe)
      // when the panel is opened; results are merged by question index.
      var questionsCard = document.getElementById("quiz-metric-questions-card");
      var questionsPanel = document.getElementById("quiz-questions-list-panel");
      var questionsBody = document.getElementById("quiz-questions-list-body");
      var questionAverageGrades = null; // null = not fetched yet; [] = fetch failed or none; [{ num, denom, pct }, ...] = scraped
      function stripHtml(html) {
        if (html == null || typeof html !== "string") return "";
        var div = document.createElement("div");
        div.innerHTML = html;
        return (div.textContent || div.innerText || "").trim();
      }
      function extractStringFromRichText(val) {
        if (val == null) return "";
        if (typeof val === "string") return val;
        if (typeof val !== "object") return String(val);
        var keys = ["Content", "Html", "Value", "Text", "PlainText", "QuestionText", "Name", "Description"];
        for (var k = 0; k < keys.length; k++) {
          var v = val[keys[k]];
          if (v == null) continue;
          if (typeof v === "string") return v;
          if (typeof v === "object" && v !== null) {
            var inner = extractStringFromRichText(v);
            if (inner) return inner;
          }
        }
        for (var key in val) {
          if (!Object.prototype.hasOwnProperty.call(val, key)) continue;
          var v = val[key];
          if (typeof v === "string" && v.length > 0) return v;
        }
        return "";
      }
      function getQuestionText(qu) {
        // Prefer full text from API shape: QuestionText: { Text: "...", Html: "..." }
        var qt = qu.QuestionText;
        if (qt && typeof qt === "object") {
          var fromQt = (typeof qt.Text === "string" && qt.Text) ? qt.Text : (typeof qt.Html === "string" && qt.Html) ? qt.Html : "";
          if (fromQt) return stripHtml(fromQt).trim();
        }
        var raw = qu.QuestionText || qu.Text || qu.Name || qu.Description || qu.Prompt || qu.Question;
        var s = typeof raw === "string" ? raw : extractStringFromRichText(raw);
        if (s) return stripHtml(s).trim();
        if (qu.Question && typeof qu.Question === "object") {
          s = extractStringFromRichText(qu.Question);
          if (s) return stripHtml(s).trim();
        }
        return "";
      }
      var questionTypeNames = {
        1: "Multiple Choice",
        2: "True/False",
        3: "Long Answer",
        4: "Short Answer",
        5: "Multi-Select",
        6: "Fill in the Blanks",
        7: "Matching",
        8: "Ordering",
        9: "Written Response",
        10: "Arithmetic"
      };
      function getQuestionTypeName(typeId) {
        if (typeId == null) return "";
        var id = typeof typeId === "number" ? typeId : parseInt(typeId, 10);
        return questionTypeNames[id] || ("Type " + id);
      }
      function renderQuestionsPanel() {
        if (!questionsBody) return;
        if (!questionsAvailable || questions.length === 0) {
          questionsBody.innerHTML = "<p class=\"quiz-time-chart-no-data\">" + escapeHtml(questionCountUnavailableMsg) + ".</p>";
          return;
        }
        var attemptLabel = completedAttempts.length > 0 ? "First Attempts (" + completedAttempts.length + ")" : "Item analysis";
        var note = questionAverageGrades && questionAverageGrades.length > 0
          ? "<p class=\"quiz-item-analysis-note\">Average grades loaded from D2L Question Details (same-origin).</p>"
          : "<p class=\"quiz-item-analysis-note\">Per-question average grades are scraped from the D2L stats page when you open this panel (same origin only). If you see —, the page may still be loading or the dashboard may be on a different domain.</p>";
        var html = "<h4 class=\"quiz-item-analysis-attempts-label\">" + escapeHtml(attemptLabel) + "</h4>" + note;
        for (var q = 0; q < questions.length; q++) {
          var qu = questions[q];
          var qText = getQuestionText(qu);
          if (typeof qText !== "string" || qText === "[object Object]") qText = "";
          if (!qText) qText = "Question " + (q + 1);
          var difficulty = (qu.Difficulty != null || qu.Difficultylevel != null) ? (qu.Difficulty != null ? qu.Difficulty : qu.Difficultylevel) : null;
          var ptsNum = qu.Points != null ? Number(qu.Points) : 1;
          var scraped = questionAverageGrades && questionAverageGrades[q];
          var avgGradeValue = scraped
            ? scraped.numerator + " / " + scraped.denominator + " (" + scraped.percent + "%)"
            : "— / " + ptsNum + " (—%)";
          var percentNum = scraped && typeof scraped.percent === "number" ? scraped.percent : null;
          var successClass = percentNum != null
            ? (percentNum < 62 ? " quiz-item-analysis-block--low" : (percentNum <= 78 ? " quiz-item-analysis-block--medium" : ""))
            : "";
          var typeLabel = getQuestionTypeName(qu.QuestionTypeId);
          var typeTag = typeLabel ? " <span class=\"quiz-item-analysis-type-tag\">" + escapeHtml(typeLabel) + "</span>" : "";
          html += "<div class=\"quiz-item-analysis-block" + successClass + "\">";
          html += "<div class=\"quiz-item-analysis-block-header\">Question " + (q + 1) + typeTag + (difficulty != null ? " <span class=\"quiz-item-analysis-difficulty\">Difficulty: " + escapeHtml(String(difficulty)) + "</span>" : "") + "</div>";
          html += "<div class=\"quiz-item-analysis-block-content\">";
          html += "<div class=\"quiz-item-analysis-block-prompt\">" + escapeHtml(qText) + "</div>";
          html += "<div class=\"quiz-item-analysis-stats-box\"><div class=\"quiz-item-analysis-average-grade\"><span class=\"quiz-item-analysis-stat-label\">Average Grade:</span> <span class=\"quiz-item-analysis-stat-value\">" + escapeHtml(avgGradeValue) + "</span></div></div>";
          html += "</div></div>";
        }
        questionsBody.innerHTML = html;
      }
      function toggleQuestionsPanel() {
        if (!questionsPanel || !questionsCard) return;
        var isExpanded = questionsPanel.style.display !== "none";
        if (isExpanded) {
          questionsPanel.style.display = "none";
          questionsCard.setAttribute("aria-expanded", "false");
        } else {
          closeAllDetailPanels();
          questionsPanel.style.display = "block";
          questionsCard.setAttribute("aria-expanded", "true");
          renderQuestionsPanel();
          if (questionsAvailable && questions.length > 0 && questionAverageGrades === null) {
            questionAverageGrades = [];
            fetchAverageGradesViaIframe(courseId, quizId).then(function (grades) {
              questionAverageGrades = grades;
              if (questionsBody && questionsPanel.style.display !== "none") renderQuestionsPanel();
            });
          }
        }
      }
      if (questionsCard) {
        questionsCard.addEventListener("click", toggleQuestionsPanel);
        questionsCard.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleQuestionsPanel();
          }
        });
      }

      // Attempt Count card: show panel with Quiz Attempts list + In-Progress list
      var attemptsCard = document.getElementById("quiz-metric-attempts-card");
      var attemptsPanel = document.getElementById("quiz-attempts-list-panel");
      var attemptsBody = document.getElementById("quiz-attempts-list-body");
      function renderAttemptsPanel() {
        if (!attemptsBody) return;
        var col1 = "<div class=\"quiz-attempts-col\"><h4 class=\"quiz-time-spent-students-title\">Quiz Attempts</h4>";
        if (completedAttemptsListWithNames.length > 0) {
          col1 += "<ul class=\"quiz-time-spent-students-list\">";
          for (var c = 0; c < completedAttemptsListWithNames.length; c++) {
            var item = completedAttemptsListWithNames[c];
            var dateStr = item.completed ? new Date(item.completed).toLocaleString() : "";
            col1 += "<li>" + escapeHtml(item.displayName) + (dateStr ? " <span class=\"quiz-time-spent-student-time\">(" + dateStr + ")</span>" : "") + "</li>";
          }
          col1 += "</ul>";
        } else {
          col1 += "<p class=\"quiz-time-chart-no-data\">No completed attempts.</p>";
        }
        col1 += "</div>";
        var col2 = "<div class=\"quiz-attempts-col\"><h4 class=\"quiz-time-spent-students-title\">In-Progress</h4>";
        if (inProgressListWithNames.length > 0) {
          col2 += "<ul class=\"quiz-time-spent-students-list\">";
          for (var p = 0; p < inProgressListWithNames.length; p++) {
            var pit = inProgressListWithNames[p];
            var startStr = pit.started ? new Date(pit.started).toLocaleString() : "";
            col2 += "<li>" + escapeHtml(pit.displayName) + (startStr ? " <span class=\"quiz-time-spent-student-time\">(started " + startStr + ")</span>" : "") + "</li>";
          }
          col2 += "</ul>";
        } else {
          col2 += "<p class=\"quiz-time-chart-no-data\">No attempts in progress.</p>";
        }
        col2 += "</div>";
        attemptsBody.innerHTML = "<div class=\"quiz-attempts-columns\">" + col1 + col2 + "</div>";
      }
      function toggleAttemptsPanel() {
        if (!attemptsPanel || !attemptsCard) return;
        var isExpanded = attemptsPanel.style.display !== "none";
        if (isExpanded) {
          attemptsPanel.style.display = "none";
          attemptsCard.setAttribute("aria-expanded", "false");
        } else {
          closeAllDetailPanels();
          attemptsPanel.style.display = "block";
          attemptsCard.setAttribute("aria-expanded", "true");
          renderAttemptsPanel();
        }
      }
      if (attemptsCard) {
        attemptsCard.addEventListener("click", toggleAttemptsPanel);
        attemptsCard.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleAttemptsPanel();
          }
        });
      }

      showLoading(false);
    } catch (e) {
      showLoading(false);
      showError("Could not load quiz data: " + (e.message || String(e)));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadQuizDetail);
  } else {
    loadQuizDetail();
  }
})();
