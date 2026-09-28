/**
 * LDAA Report Engine — activity aggregation + PDF for Your Institution Faculty Dashboard.
 */
(function (global) {
  "use strict";

  var API = global.BrightspaceApi;
  var LE = API.LE;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function maxDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return new Date(a) >= new Date(b) ? a : b;
  }

  async function pMap(items, mapper, concurrency) {
    var results = new Array(items.length);
    var i = 0;
    var workers = [];
    var n = Math.min(concurrency || 4, items.length || 1);
    for (var w = 0; w < n; w++) {
      workers.push(
        (async function () {
          while (i < items.length) {
            var idx = i++;
            try {
              results[idx] = await mapper(items[idx], idx);
            } catch (e) {
              results[idx] = null;
            }
          }
        })()
      );
    }
    await Promise.all(workers);
    return results;
  }

  function normalizeClasslist(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  function isStudentRole(member) {
    var role = (member.Role && (member.Role.Name || member.RoleName)) || "";
    if (!role) return true;
    if (/^student|learner/i.test(role)) return true;
    if (/instructor|designer|admin|grader|ta\b|faculty|teacher/i.test(role)) return false;
    return true;
  }

  function detectThirdPartyTools(toc) {
    var tools = [];
    if (!toc) return tools;
    function walk(nodes) {
      if (!nodes) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n && n.TypeIdentifier === "Topic" && n.Url && /lti|external/i.test(String(n.Url))) {
          var title = n.Title || n.ShortTitle || "LTI tool";
          if (tools.indexOf(title) < 0) tools.push(title);
        }
        if (n && n.Modules) walk(n.Modules);
        if (n && n.Topics) walk(n.Topics);
      }
    }
    if (Array.isArray(toc)) walk(toc);
    else if (toc.Modules) walk(toc.Modules);
    return tools;
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Objects)) return data.Objects;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  function entityUserId(entityWrap) {
    var entity = (entityWrap && (entityWrap.Entity || entityWrap.entity)) || entityWrap || {};
    var id =
      entity.EntityId != null
        ? entity.EntityId
        : entity.Identifier != null
          ? entity.Identifier
          : entity.Id != null
            ? entity.Id
            : entity.UserId != null
              ? entity.UserId
              : null;
    if (id == null && entity.SubmittedBy) {
      id = entity.SubmittedBy.Identifier || entity.SubmittedBy.Id;
    }
    return id != null ? String(id) : null;
  }

  function submissionDateFromEntity(entityWrap) {
    if (!entityWrap) return null;
    var best = entityWrap.CompletionDate || entityWrap.completionDate || null;
    var submissions = entityWrap.Submissions || entityWrap.submissions || [];
    for (var i = 0; i < submissions.length; i++) {
      var sub = submissions[i] || {};
      var d =
        sub.SubmissionDate ||
        sub.SubmittedDate ||
        sub.DateSubmitted ||
        sub.CreationDate ||
        sub.CreatedDate ||
        null;
      best = maxDate(best, d);
    }
    // Flat per-user response shapes
    best = maxDate(
      best,
      entityWrap.SubmissionDate ||
        entityWrap.SubmittedDate ||
        entityWrap.DateSubmitted ||
        entityWrap.CreatedDate ||
        null
    );
    return best;
  }

  function attemptDate(att) {
    if (!att) return null;
    // D2L QuizAttemptData uses Started / Completed (not SubmissionDate)
    return (
      att.Completed ||
      att.Started ||
      att.SubmittedDate ||
      att.SubmissionDate ||
      att.CompletionDate ||
      att.EndDate ||
      att.StartDate ||
      null
    );
  }

  async function findLastAccess(ouId, userId, hintIso) {
    if (hintIso) return hintIso;
    // Prefer classlist LastAccessed (same source as Course Health / Students widgets)
    try {
      var cl = await API.classlist(ouId);
      var members = normalizeClasslist(cl);
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        if (String(m.Identifier || m.UserId) === String(userId) && m.LastAccessed) {
          return m.LastAccessed;
        }
      }
    } catch (e) {
      /* fall through */
    }
    try {
      var paged = await API.classlistPaged(ouId);
      var objs = asArray(paged);
      for (var j = 0; j < objs.length; j++) {
        var s = objs[j];
        if (String(s.Identifier || s.UserId) === String(userId) && s.LastAccessed) {
          return s.LastAccessed;
        }
      }
    } catch (e) {
      /* fall through */
    }
    try {
      var access = await API.lastAccess(ouId, userId);
      return (access && (access.LastAccessed || access.LastAccess || access.DateLastAccessed)) || null;
    } catch (e) {
      return null;
    }
  }

  async function collectStudentDetail(options) {
    var ouId = options.orgUnitId;
    var userId = options.userId;
    var onProgress = options.onProgress || function () {};
    var uid = String(userId);

    var detail = {
      lastDiscussion: null,
      lastAssignment: null,
      lastQuiz: null,
      lastLogin: null,
      discussions: [],
      assignments: [],
      quizzes: [],
      grades: [],
      finalGrade: null,
      thirdParty: { tools: [], hasActivity: false, lastActivityDate: null, activity: [] }
    };

    onProgress("Loading course access…", 5);
    detail.lastLogin = await findLastAccess(ouId, userId, options.lastAccessedHint || null);

    onProgress("Scanning assignments…", 15);
    var folders = [];
    try {
      folders = asArray(await API.dropboxFolders(ouId));
    } catch (e) {
      folders = [];
    }

    await pMap(
      folders,
      async function (folder) {
        var folderId = folder.Id != null ? folder.Id : folder.FolderId;
        if (folderId == null) return;
        var folderName = folder.Name || "Assignment";
        var foundDate = null;

        // Primary: list all submissions for the folder and match this student
        try {
          var subs = asArray(await API.dropboxSubs(ouId, folderId));
          for (var i = 0; i < subs.length; i++) {
            var wrap = subs[i];
            if (entityUserId(wrap) !== uid) continue;
            foundDate = submissionDateFromEntity(wrap);
            break;
          }
        } catch (e) {
          /* try per-user fallback */
        }

        // Fallback: per-user submissions endpoint
        if (!foundDate) {
          try {
            var one = await API.dropboxSub(ouId, folderId, userId);
            if (one) foundDate = submissionDateFromEntity(one);
          } catch (e) {
            /* no submission */
          }
        }

        if (foundDate) {
          detail.assignments.push({ name: folderName, date: foundDate });
          detail.lastAssignment = maxDate(detail.lastAssignment, foundDate);
        }
      },
      4
    );

    onProgress("Scanning quizzes…", 35);
    var quizList = [];
    try {
      quizList = asArray(await API.quizzes(ouId));
    } catch (e) {
      quizList = [];
    }

    await pMap(
      quizList,
      async function (quiz) {
        var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
        if (qid == null) return;
        try {
          var attempts = asArray(await API.quizAttempts(ouId, qid));
          for (var i = 0; i < attempts.length; i++) {
            var att = attempts[i];
            var attUid =
              att.UserId != null
                ? String(att.UserId)
                : att.User && att.User.Id != null
                  ? String(att.User.Id)
                  : null;
            if (attUid !== uid) continue;
            var when = attemptDate(att);
            if (!when) continue;
            detail.quizzes.push({
              name: quiz.Name || "Quiz",
              date: when,
              score: att.Score != null ? String(att.Score) : ""
            });
            detail.lastQuiz = maxDate(detail.lastQuiz, when);
          }
        } catch (e) {
          /* skip quiz */
        }
      },
      4
    );

    onProgress("Scanning discussions…", 55);
    var forums = [];
    try {
      forums = asArray(await API.forums(ouId));
    } catch (e) {
      forums = [];
    }

    for (var fi = 0; fi < forums.length; fi++) {
      var forum = forums[fi];
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      try {
        var topics = asArray(await API.forumTopics(ouId, fid));
        for (var ti = 0; ti < topics.length; ti++) {
          var topic = topics[ti];
          var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
          if (tid == null) continue;
          try {
            var posts = asArray(await API.topicPosts(ouId, fid, tid));
            for (var pi = 0; pi < posts.length; pi++) {
              var post = posts[pi];
              var poster = post.PostingUserId || post.UserId || post.UserIdentifier;
              if (String(poster) !== uid) continue;
              var pDate = post.PostDate || post.DatePosted;
              if (pDate) {
                detail.discussions.push({
                  forum: forum.Name || "",
                  topic: topic.Name || "",
                  date: pDate
                });
                detail.lastDiscussion = maxDate(detail.lastDiscussion, pDate);
              }
            }
          } catch (e) {
            /* skip topic */
          }
        }
      } catch (e) {
        /* skip forum */
      }
    }

    onProgress("Loading gradebook…", 75);
    try {
      var grades = asArray(await API.gradeValues(ouId, userId));
      for (var gi = 0; gi < grades.length; gi++) {
        var g = grades[gi];
        if (!g) continue;
        var gDate = g.LastModified || g.GradedDate || null;
        detail.grades.push({
          name: g.GradeObjectName || "Grade item",
          date: gDate,
          score: g.PointsNumerator != null ? String(g.PointsNumerator) : ""
        });
        if (
          gDate &&
          /lti|publisher|external|mindtap|cengage|pearson|mcgraw|wiley|zookal/i.test(
            String(g.GradeObjectName || "")
          )
        ) {
          detail.thirdParty.activity.push({
            tool: g.GradeObjectName,
            column: g.GradeObjectName,
            date: gDate,
            score: g.PointsNumerator != null ? String(g.PointsNumerator) : ""
          });
          detail.thirdParty.lastActivityDate = maxDate(detail.thirdParty.lastActivityDate, gDate);
          detail.thirdParty.hasActivity = true;
        }
      }
    } catch (e) {
      /* optional */
    }

    try {
      var finalG = await API.gradeFinal(ouId, userId);
      if (finalG && finalG.DisplayedGrade) detail.finalGrade = finalG.DisplayedGrade;
      else if (finalG && finalG.PointsNumerator != null) detail.finalGrade = String(finalG.PointsNumerator);
    } catch (e) {
      /* optional */
    }

    onProgress("Checking integrated tools…", 90);
    try {
      var toc = await API.contentToc(ouId);
      detail.thirdParty.tools = detectThirdPartyTools(toc);
    } catch (e) {
      /* optional */
    }

    onProgress("Done", 100);
    return detail;
  }

  function overallLda(detail) {
    var academic = [
      detail.lastDiscussion,
      detail.lastAssignment,
      detail.lastQuiz,
      detail.thirdParty && detail.thirdParty.lastActivityDate
    ].filter(Boolean);
    if (!academic.length) return null;
    academic.sort(function (a, b) {
      return new Date(b) - new Date(a);
    });
    return academic[0];
  }

  /* Official Your Institution Creative Guide (2024) palette */
  var BRAND = {
    green: [0, 87, 73],
    greenLight: [0, 149, 122],
    mint: [154, 216, 206],
    tan: [200, 198, 183],
    black: [25, 51, 48],
    cream: [244, 243, 239],
    white: [255, 255, 255],
    muted: [90, 98, 94],
    line: [214, 220, 216],
    alert: [153, 27, 27],
    alertBg: [254, 242, 242],
    successBg: [232, 245, 240],
    recencyOk: [0, 149, 122],
    recencyWarn: [180, 83, 9],
    recencyLate: [153, 27, 27]
  };

  function daysAgo(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function recencyColor(iso) {
    var n = daysAgo(iso);
    if (n == null) return BRAND.muted;
    if (n <= 7) return BRAND.recencyOk;
    if (n <= 13) return BRAND.recencyWarn;
    return BRAND.recencyLate;
  }

  function recencyLabel(iso) {
    var n = daysAgo(iso);
    if (n == null) return "";
    if (n === 0) return "today";
    if (n === 1) return "1 day ago";
    return n + " days ago";
  }

  function sortByDateDesc(items, key) {
    return (items || []).slice().sort(function (a, b) {
      return new Date(b[key] || 0) - new Date(a[key] || 0);
    });
  }

  function fillTriangle(doc, x1, y1, x2, y2, x3, y3) {
    if (typeof doc.triangle === "function") {
      doc.triangle(x1, y1, x2, y2, x3, y3, "F");
      return;
    }
    doc.lines(
      [
        [x2 - x1, y2 - y1],
        [x3 - x2, y3 - y2],
        [x1 - x3, y1 - y3]
      ],
      x1,
      y1,
      [1, 1],
      "F",
      true
    );
  }

  function applyColor(doc, method, rgb) {
    doc[method].apply(doc, rgb);
  }

  async function renderLDAReport(options) {
    var student = options.student || {};
    var course = options.course || {};
    var detail = options.detail || {};
    var preparedBy = options.preparedBy || "";
    var jsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDF) throw new Error("jsPDF library not loaded");

    var Brand = global.FacultyDashboardPdfBrand;
    var duckLogo = Brand ? await Brand.loadDuckLogo() : null;

    var doc = new jsPDF({ unit: "pt", format: "letter" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var contentW = pageW - margin * 2;
    var y = 0;
    var lda = overallLda(detail);
    var generatedAt = new Date();
    var studentName = student.DisplayName || "Unknown student";
    var studentId = student.OrgDefinedId || student.Identifier || "—";
    var courseCode = course.Code || "";
    var courseName = course.Name || courseCode || "Course";
    var pageNum = 1;
    var tp = detail.thirdParty || {};

    doc.setProperties({
      title: "LDAA Report — " + studentName,
      subject: "Last Date of Academic Activity",
      author: "Your Institution Faculty Dashboard",
      creator: "Your Institution eLearning Office",
      keywords: "LDAA, FERPA, Your Institution"
    });

    function drawPageBase() {
      applyColor(doc, "setFillColor", BRAND.cream);
      doc.rect(0, 0, pageW, pageH, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, 7, pageH, "F");
    }

    function drawDeltaMark(cx, cy, radius) {
      applyColor(doc, "setFillColor", BRAND.white);
      doc.circle(cx, cy, radius, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      fillTriangle(
        doc,
        cx,
        cy - radius * 0.62,
        cx + radius * 0.62,
        cy + radius * 0.48,
        cx - radius * 0.62,
        cy + radius * 0.48
      );
      applyColor(doc, "setFillColor", BRAND.white);
      fillTriangle(
        doc,
        cx,
        cy - radius * 0.28,
        cx + radius * 0.28,
        cy + radius * 0.28,
        cx - radius * 0.28,
        cy + radius * 0.28
      );
    }

    function placeDuck(x, y, height) {
      if (!Brand || !duckLogo) return 0;
      return Brand.drawDuck(doc, duckLogo, x, y, height);
    }

    function drawCoverHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 88, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 88, pageW, 5, "F");
      applyColor(doc, "setFillColor", BRAND.mint);
      doc.rect(0, 93, pageW, 2, "F");

      var duckH = 52;
      var duckW = placeDuck(margin, 18, duckH);
      var textX = duckW ? margin + duckW + 10 : margin + 46;
      if (!duckW) {
        drawDeltaMark(margin + 18, 44, 18);
      }

      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("YOUR INSTITUTION", textX, 38);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("eLearning Office  ·  Faculty Dashboard", textX, 54);

      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("CONFIDENTIAL", pageW - margin, 32, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("FERPA-protected education record", pageW - margin, 46, { align: "right" });
      doc.text("[campus location]", pageW - margin, 58, { align: "right" });
    }

    function drawContinuedHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 32, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 32, pageW, 3, "F");
      var duckW = placeDuck(margin, 5, 22);
      var textX = duckW ? margin + duckW + 8 : margin;
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("YOUR INSTITUTION  ·  LDAA Report", textX, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.mint);
      var contLabel = studentName + (courseCode ? "  ·  " + courseCode : "");
      if (doc.getTextWidth(contLabel) > 280) {
        contLabel = doc.splitTextToSize(contLabel, 280)[0];
      }
      doc.text(contLabel, pageW - margin, 20, { align: "right" });
    }

    function drawFooter() {
      var fy = pageH - 28;
      applyColor(doc, "setDrawColor", BRAND.greenLight);
      doc.setLineWidth(1.1);
      doc.line(margin, fy, pageW - margin, fy);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Your Institution  ·  eLearning Office  ·  Faculty Dashboard", margin, fy + 12);
      doc.text("Page " + pageNum, pageW - margin, fy + 12, { align: "right" });
    }

    function ensureSpace(needed) {
      if (y + needed <= pageH - 46) return;
      drawFooter();
      doc.addPage();
      pageNum += 1;
      drawContinuedHeader();
      y = 50;
    }

    function sectionTitle(text) {
      ensureSpace(28);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, 4, 14, "F");
      applyColor(doc, "setTextColor", BRAND.green);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(text, margin + 12, y + 11);
      y += 22;
    }

    drawCoverHeader();
    y = 114;

    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Last Date of Academic Activity", margin, y);
    y += 16;
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Official report for FW process submission and final grades of F", margin, y);
    var genStamp =
      generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      "  ·  " +
      generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    doc.text(genStamp, pageW - margin, y, { align: "right" });
    y += 18;

    var idH = 72;
    ensureSpace(idH + 8);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, idH, 6, 6, "F");
    applyColor(doc, "setFillColor", BRAND.greenLight);
    doc.rect(margin, y, 6, idH, "F");

    var col1 = margin + 18;
    var col2 = margin + contentW / 2 + 8;
    applyColor(doc, "setTextColor", BRAND.greenLight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("STUDENT", col1, y + 16);
    doc.text("COURSE", col2, y + 16);

    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    var nameFit = doc.splitTextToSize(studentName, contentW / 2 - 28);
    doc.text(nameFit[0], col1, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.text("ID  " + studentId, col1, y + 50);
    if (student.Email) {
      doc.text(String(student.Email), col1, y + 62);
    }

    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    var codeLines = doc.splitTextToSize(courseCode || courseName, contentW / 2 - 28);
    doc.text(codeLines[0], col2, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    applyColor(doc, "setTextColor", BRAND.muted);
    if (courseName && courseName !== courseCode) {
      var nameLines = doc.splitTextToSize(courseName, contentW / 2 - 28);
      doc.text(nameLines.slice(0, 2), col2, y + 48);
    }
    y += idH + 16;

    var hasLda = !!lda;
    var boxH = 78;
    ensureSpace(boxH + 8);
    applyColor(doc, "setFillColor", hasLda ? BRAND.successBg : BRAND.alertBg);
    doc.roundedRect(margin, y, contentW, boxH, 6, 6, "F");
    applyColor(doc, "setFillColor", hasLda ? BRAND.green : BRAND.alert);
    doc.rect(margin, y, 7, boxH, "F");

    applyColor(doc, "setTextColor", hasLda ? BRAND.green : BRAND.alert);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("OVERALL LAST DATE OF ACADEMIC ACTIVITY", margin + 20, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Use this date for FW process submission and final grades of F.", margin + 20, y + 32);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(hasLda ? 16 : 14);
    doc.text(hasLda ? fmtDateLong(lda) : "No academic activity on record", margin + 20, y + 54);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    if (hasLda) {
      doc.text(recencyLabel(lda) + "  ·  Academic events only (login is not counted)", margin + 20, y + 68);
    } else {
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.text("No discussion, assignment, quiz, or integrated-tool gradebook activity was found.", margin + 20, y + 68);
    }
    y += boxH + 16;

    sectionTitle("Academic activity");
    var tableRows = [
      ["Last discussion post", detail.lastDiscussion, true],
      ["Last assignment submitted", detail.lastAssignment, true],
      ["Last quiz submitted", detail.lastQuiz, true],
      ["Last course access (login)", detail.lastLogin, false]
    ];
    var rowH = 22;
    ensureSpace(20 + tableRows.length * rowH);
    applyColor(doc, "setFillColor", BRAND.green);
    doc.rect(margin, y, contentW, 20, "F");
    applyColor(doc, "setTextColor", BRAND.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("EVENT", margin + 10, y + 13);
    doc.text("COUNTS TOWARD LDA", margin + 248, y + 13);
    doc.text("DATE", pageW - margin - 10, y + 13, { align: "right" });
    y += 20;

    for (var r = 0; r < tableRows.length; r++) {
      applyColor(doc, "setFillColor", r % 2 === 0 ? BRAND.white : [236, 242, 239]);
      doc.rect(margin, y, contentW, rowH, "F");
      applyColor(doc, "setDrawColor", BRAND.line);
      doc.setLineWidth(0.4);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);

      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(tableRows[r][0], margin + 10, y + 14);

      doc.setFontSize(8);
      if (tableRows[r][2]) {
        applyColor(doc, "setTextColor", BRAND.green);
        doc.setFont("helvetica", "bold");
        doc.text("Yes", margin + 248, y + 14);
      } else {
        applyColor(doc, "setTextColor", BRAND.muted);
        doc.setFont("helvetica", "italic");
        doc.text("Informational only", margin + 248, y + 14);
      }

      var iso = tableRows[r][1];
      var dateStr = iso ? fmtDate(iso) : "None on record";
      if (iso) {
        var ago = recencyLabel(iso);
        if (ago) dateStr += "  (" + ago + ")";
      }
      applyColor(doc, "setTextColor", iso ? recencyColor(iso) : BRAND.muted);
      doc.setFont("helvetica", iso ? "bold" : "italic");
      doc.setFontSize(9);
      doc.text(dateStr, pageW - margin - 10, y + 14, { align: "right" });
      y += rowH;
    }
    y += 14;

    sectionTitle("Activity counts");
    var kpis = [
      ["Discussion posts", (detail.discussions || []).length],
      ["Assignments", (detail.assignments || []).length],
      ["Quiz attempts", (detail.quizzes || []).length],
      ["Graded items", (detail.grades || []).length]
    ];
    var gap = 8;
    var tileW = (contentW - gap * 3) / 4;
    var tileH = 48;
    ensureSpace(tileH + 8);
    for (var k = 0; k < kpis.length; k++) {
      var tx = margin + k * (tileW + gap);
      applyColor(doc, "setFillColor", BRAND.white);
      doc.roundedRect(tx, y, tileW, tileH, 5, 5, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(tx, y, tileW, 3, "F");
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(kpis[k][0].toUpperCase(), tx + tileW / 2, y + 16, { align: "center" });
      applyColor(doc, "setTextColor", BRAND.green);
      doc.setFontSize(16);
      doc.text(String(kpis[k][1]), tx + tileW / 2, y + 36, { align: "center" });
    }
    y += tileH + 14;

    if (detail.finalGrade) {
      ensureSpace(28);
      applyColor(doc, "setFillColor", BRAND.white);
      doc.roundedRect(margin, y, contentW, 24, 4, 4, "F");
      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Final / displayed grade:", margin + 12, y + 16);
      doc.setFont("helvetica", "bold");
      applyColor(doc, "setTextColor", BRAND.green);
      doc.text(String(detail.finalGrade), margin + 128, y + 16);
      y += 34;
    }

    function drawItemTable(title, items, nameFn) {
      if (!items || !items.length) return;
      sectionTitle(title);
      var sorted = sortByDateDesc(items, "date");
      var shown = sorted.slice(0, 8);
      var headerH = 18;
      ensureSpace(headerH + 20);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, contentW, headerH, "F");
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("ITEM", margin + 10, y + 12);
      doc.text("DATE", pageW - margin - 10, y + 12, { align: "right" });
      y += headerH;
      for (var i = 0; i < shown.length; i++) {
        ensureSpace(18);
        applyColor(doc, "setFillColor", i % 2 === 0 ? BRAND.white : [236, 242, 239]);
        doc.rect(margin, y, contentW, 16, "F");
        applyColor(doc, "setTextColor", BRAND.black);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        var label = nameFn(shown[i]);
        var clipped = doc.splitTextToSize(label, contentW - 120);
        doc.text(clipped[0], margin + 10, y + 11);
        applyColor(doc, "setTextColor", recencyColor(shown[i].date));
        doc.setFont("helvetica", "bold");
        doc.text(fmtDate(shown[i].date), pageW - margin - 10, y + 11, { align: "right" });
        y += 16;
      }
      if (sorted.length > shown.length) {
        ensureSpace(14);
        applyColor(doc, "setTextColor", BRAND.muted);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.text("And " + (sorted.length - shown.length) + " more in Brightspace.", margin + 10, y + 10);
        y += 16;
      }
      y += 8;
    }

    drawItemTable("Discussion posts", detail.discussions, function (item) {
      return [item.forum || item.forum, item.topic || item.topic].filter(Boolean).join(" — ") || "Discussion post";
    });
    drawItemTable("Assignments submitted", detail.assignments, function (item) {
      return item.name || "Assignment";
    });
    drawItemTable("Quiz attempts", detail.quizzes, function (item) {
      var n = item.name || "Quiz";
      var score = item.score || item.score;
      return score ? n + "  ·  score " + score : n;
    });

    if ((tp.tools && tp.tools.length) || tp.hasActivity) {
      sectionTitle("Integrated / third-party tools");
      ensureSpace(48);
      var tpH = 44;
      applyColor(doc, "setFillColor", tp.hasActivity ? BRAND.successBg : [255, 248, 225]);
      doc.roundedRect(margin, y, contentW, tpH, 5, 5, "F");
      applyColor(doc, "setFillColor", tp.hasActivity ? BRAND.green : BRAND.recencyWarn);
      doc.rect(margin, y, 5, tpH, "F");
      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      var toolList = (tp.tools || []).join(", ") || "Integrated tool activity in the gradebook";
      var tpLines = doc.splitTextToSize(
        (tp.hasActivity
          ? "Student activity was found in the gradebook from integrated tools. Most recent: " +
            fmtDate(tp.lastActivityDate) +
            ". "
          : "Tools were detected in this course, but no matching gradebook activity was found for this student. Verify LDAA in the tool itself. ") +
          "Detected: " +
          toolList +
          ".",
        contentW - 24
      );
      doc.text(tpLines.slice(0, 3), margin + 14, y + 16);
      y += tpH + 12;
    }

    if (preparedBy) {
      ensureSpace(20);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text("Prepared by " + preparedBy, margin, y + 8);
      y += 18;
    }

    ensureSpace(58);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, 52, 5, 5, "F");
    applyColor(doc, "setFillColor", BRAND.tan);
    doc.rect(margin, y, 5, 52, "F");
    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("FERPA NOTICE", margin + 14, y + 14);
    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    var ferpa =
      "This report contains education records protected under the Family Educational Rights and Privacy Act. " +
      "Use only for legitimate educational purposes at Your Institution. Do not share outside authorized college " +
      "personnel without consent or as otherwise permitted by law. Course login is informational and is not " +
      "counted toward Last Date of Academic Activity.";
    doc.text(doc.splitTextToSize(ferpa, contentW - 28), margin + 14, y + 26);

    drawFooter();

    var filename =
      "LDAA_" +
      (student.OrgDefinedId || student.Identifier || "student") +
      "_" +
      (course.Code || course.OrgUnitId || "course") +
      ".pdf";
    doc.save(filename.replace(/[^\w.-]+/g, "_"));
  }

  global.LdaaReport = {
    collectStudentDetail: collectStudentDetail,
    renderLDAReport: renderLDAReport,
    overallLda: overallLda,
    fmtDate: fmtDate,
    normalizeClasslist: normalizeClasslist,
    isStudentRole: isStudentRole,
    escapeHtml: escapeHtml
  };

  global.BSP = global.BSP || {};
  global.BSP.report = global.LdaaReport;
})(window);
