/**
 * Course Package Deployer
 * Gradebook, assignments, quiz shells, discussions, content modules, materials/announcement.
 */
(function () {
  "use strict";

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.93";
  var REQUEST_GAP_MS = 120;
  var COURSE_INFO_MODULE = "Course Information";

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

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var ACTIVE_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  var FUTURE_SEMESTER_CODE = semesterApi() ? semesterApi().getFutureCode() : "26/FA";
  var ALLOWED_SEMESTER_CODES = {};
  ALLOWED_SEMESTER_CODES[ACTIVE_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[FUTURE_SEMESTER_CODE] = true;

  var SAMPLE_POINTS_CSV =
    "Name,MaxPoints\n" +
    "Homework 1,50\n" +
    "Homework 2,50\n" +
    "Midterm Exam,100\n" +
    "Final Exam,150\n" +
    "Discussion Participation,50\n";

  var SAMPLE_WEIGHTED_CSV =
    "Category,CategoryWeight,Name,MaxPoints,Weight\n" +
    "Assignments,40,Homework 1,100,\n" +
    "Assignments,40,Homework 2,100,\n" +
    "Assignments,40,Homework 3,100,\n" +
    "Exams,45,Midterm Exam,100,\n" +
    "Exams,45,Final Exam,100,\n" +
    "Participation,15,Discussion Participation,100,\n";

  var SAMPLE_ASSIGNMENTS_CSV =
    "Name,Points,Category,DueDate,SubmissionType,Instructions,LinkGrade,Calendar,Hidden\n" +
    "Homework 1,100,Assignments,2026-09-05T23:59,File,Submit your completed worksheet as a PDF.,yes,yes,no\n" +
    "Homework 2,100,Assignments,2026-09-12T23:59,File,Upload your second homework file.,yes,yes,no\n" +
    "Case Study Reflection,50,Assignments,2026-09-19T23:59,FileOrText,Write a one-page reflection on the case study.,yes,no,no\n" +
    "Midterm Project,100,Exams,2026-10-15T23:59,File,Submit your midterm project package.,yes,yes,no\n";

  var SAMPLE_DISCUSSIONS_CSV =
    "Forum,Topic,Description,ScoreOutOf,MustPostToParticipate,AllowAnonymous,RequiresApproval,DueDate,Hidden\n" +
    "Week 1 Discussions,Introductions,Introduce yourself to the class.,10,yes,no,no,2026-09-05T23:59,no\n" +
    "Week 1 Discussions,Syllabus Questions,Ask clarifying questions about the syllabus.,5,no,no,no,2026-09-07T23:59,no\n" +
    "Course Community,Water Cooler,Optional informal conversation space.,,no,no,no,,no\n";

  var SAMPLE_QUIZZES_CSV =
    "Name,Points,Category,QuizCategory,DueDate,StartDate,EndDate,Attempts,TimeLimitMinutes,Shuffle,Instructions,LinkGrade,Calendar,Hidden\n" +
    "Quiz 1,100,Exams,Weekly Quizzes,2026-09-12T23:59,,,1,30,yes,Complete after Week 1 readings.,yes,yes,yes\n" +
    "Quiz 2,100,Exams,Weekly Quizzes,2026-09-19T23:59,,,1,30,yes,Complete after Week 2 readings.,yes,yes,yes\n" +
    "Midterm Exam,100,Exams,Exams,2026-10-15T23:59,2026-10-15T08:00,2026-10-15T23:59,1,90,yes,Proctored midterm exam window.,yes,yes,no\n";


  var state = {
    courses: [],
    courseMap: {},
    instructor: { firstName: "", lastName: "", displayName: "" },
    gradeEntryMode: "manual",
    syllabusFile: null,
    officeHoursFile: null,
    courseBannerFile: null,
    running: false,
    announcementTouched: false,
    accordionReviewMode: false,
    categorySeq: 1,
    gradeSchemes: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function getScheme() {
    var checked = document.querySelector('input[name="cpdScheme"]:checked');
    return checked ? checked.value : "Points";
  }

  function isWeighted() {
    return getScheme() === "Weighted";
  }

  function usesCategories() {
    var s = getScheme();
    return s === "Weighted" || s === "Formula" || s === "Points";
  }

  function semesterLabelForCode(semCode) {
    var api = semesterApi();
    if (!api) return semCode || "";
    if (semCode === api.getActiveCode() && api.getActive) return api.getActive().label || semCode;
    if (semCode === api.getFutureCode() && api.getFuture) return api.getFuture().label || semCode;
    if (api.getPrevious && semCode === api.getPreviousCode()) return api.getPrevious().label || semCode;
    return semCode || "";
  }

  function getSelectedCourse() {
    var select = $("cpdCourse");
    if (!select || !select.value) return null;
    return state.courseMap[select.value] || null;
  }

  function setMessage(message, type, isHtml) {
    var el = $("cpdMessage");
    if (!el) return;
    if (!message) {
      el.style.display = "none";
      el.className = "message-container";
      el.textContent = "";
      return;
    }
    el.style.display = "block";
    el.className = "message-container " + (type === "error" ? "message-error" : "message-success");
    if (isHtml) el.innerHTML = message;
    else el.textContent = message;
  }

  function appendLog(line) {
    var log = $("cpdLog");
    if (!log) return;
    log.hidden = false;
    log.textContent += (log.textContent ? "\n" : "") + line;
  }

  function clearLog() {
    var log = $("cpdLog");
    if (!log) return;
    log.textContent = "";
    log.hidden = true;
  }

  function setFileLabel(id, file) {
    var el = $(id);
    if (!el) return;
    if (!file) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = "Selected: " + file.name + " (" + Math.max(1, Math.round(file.size / 1024)) + " KB)";
  }

  function downloadTextFile(filename, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function utcNowForApi() {
    var iso = new Date().toISOString();
    return /\.\d{3}Z$/.test(iso) ? iso : iso.replace(/Z$/, ".000Z");
  }

  function localDateTimeToUtc(value) {
    if (!value) return null;
    var d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function shortNameFrom(name) {
    var s = String(name || "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .substring(0, 8);
    return s || "Item";
  }

  function textToHtml(text) {
    var escaped = escapeHtml(text);
    return "<p>" + escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  }

  // ---- API ----

  function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token") || localStorage.getItem("X-CSRF.Token") || "";
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var err = new Error("HTTP " + res.status + " — " + url + (text ? " — " + text.slice(0, 400) : ""));
          err.status = res.status;
          err.body = text;
          throw err;
        });
      }
      if (res.status === 204) return null;
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") >= 0) return res.json();
      return res.text();
    });
  }

  function BrightspaceJson(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    return BrightspaceFetch(url, opts);
  }

  function buildMultipartMixed(jsonObj, file) {
    var boundary = "xxBOUNDARYxx" + Date.now();
    var crlf = "\r\n";
    var parts = [];
    parts.push("--" + boundary + crlf);
    parts.push("Content-Type: application/json" + crlf + crlf);
    parts.push(JSON.stringify(jsonObj));
    parts.push(crlf);
    if (file) {
      parts.push("--" + boundary + crlf);
      parts.push(
        'Content-Disposition: form-data; name=""; filename="' +
          String(file.name || "upload.bin").replace(/"/g, "") +
          '"' +
          crlf
      );
      parts.push("Content-Type: " + (file.type || "application/octet-stream") + crlf + crlf);
      parts.push(file);
      parts.push(crlf);
    }
    parts.push("--" + boundary + "--" + crlf);
    return {
      body: new Blob(parts),
      contentType: "multipart/mixed;boundary=" + boundary
    };
  }

  function BrightspaceMultipart(url, jsonObj, file) {
    var packed = buildMultipartMixed(jsonObj, file);
    return BrightspaceFetch(url, {
      method: "POST",
      headers: { "Content-Type": packed.contentType },
      body: packed.body
    });
  }

  /** Course offering banner via simple multipart/form-data upload (field name: Image). */
  async function uploadCourseBanner(orgUnitId, file) {
    if (!file) return null;
    var maxBytes = 2000 * 1024;
    if (file.size > maxBytes) {
      throw new Error("Course banner must be under 2000 KB (file is " + Math.ceil(file.size / 1024) + " KB).");
    }
    var name = String(file.name || "").toLowerCase();
    var type = String(file.type || "").toLowerCase();
    var okType =
      type.indexOf("image/") === 0 ||
      /\.(jpe?g|png|gif|webp)$/.test(name);
    if (!okType) {
      throw new Error("Course banner must be a JPEG, PNG, GIF, or WebP image.");
    }
    var form = new FormData();
    form.append("Image", file, file.name || "course-banner.jpg");
    return BrightspaceFetch(
      "/d2l/api/lp/" +
        API_VERSION_LP +
        "/courses/" +
        encodeURIComponent(orgUnitId) +
        "/image",
      { method: "PUT", body: form }
    );
  }

  function promptProfileWidgetReminder(course, options) {
    options = options || {};
    var bannerNote = options.bannerUploaded
      ? "\n\nCourse banner image was uploaded, but Display Homepage Banner is a separate setting.\n" +
        "Course Admin → Course Offering Information → check “Display the image in a banner on the course homepage”, then Save.\n"
      : "";
    var openHome = window.confirm(
      "Next steps for your course homepage\n\n" +
        "1. Update your Single Profile Widget\n" +
        "   Open the course homepage → Configure this widget → add your info and upload a photo.\n" +
        "   If Configure this widget is missing, contact eLearning." +
        bannerNote +
        "\nOK = Open the course homepage now\n" +
        "Cancel = Stay here"
    );
    if (openHome && course && course.OrgUnitId != null) {
      window.open("/d2l/home/" + encodeURIComponent(String(course.OrgUnitId)), "_blank");
    }
  }

  // ---- Courses ----

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && item.Access.ClasslistRoleId != null) {
      var n = parseInt(item.Access.ClasslistRoleId, 10);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function getRoleName(item) {
    return item && item.Access && item.Access.ClasslistRoleName
      ? String(item.Access.ClasslistRoleName)
      : "";
  }

  function roleNameMatches(roleName, keywords) {
    var value = String(roleName || "").toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (value.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function isAcademicRole(roleId, roleName) {
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return true;
    if (roleId === null) return roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS);
    return false;
  }

  function isSandboxCourse(name, code) {
    var s = ((name || "") + " " + (code || "")).toLowerCase();
    return s.indexOf("sandbox") >= 0 || s.indexOf("sbx") >= 0 || s.indexOf("practice") >= 0;
  }

  function isMergedOrCancelledCourse(name, code) {
    var c = String(code || "").toUpperCase();
    var n = String(name || "").toUpperCase();
    return (
      c.indexOf("MERGED") >= 0 ||
      c.indexOf("CXLD") >= 0 ||
      n.indexOf("MERGED") >= 0 ||
      n.indexOf("CXLD") >= 0
    );
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;
    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" +
          API_VERSION_LP +
          "/enrollments/myenrollments/?bookmark=" +
          encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";
      var data = await BrightspaceFetch(endpoint);
      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) allItems.push(data.Items[i]);
      }
      if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
        bookmark = data.PagingInfo.Bookmark;
      } else {
        hasMore = false;
      }
    }
    return allItems;
  }

  function filterCourses(enrollments) {
    var out = [];
    var seen = {};
    for (var i = 0; i < enrollments.length; i++) {
      var item = enrollments[i];
      if (!isCourseOffering(item)) continue;
      var orgUnitId = item.OrgUnit.Id;
      var name = item.OrgUnit.Name || "";
      var code = item.OrgUnit.Code || "";
      if (!orgUnitId || seen[String(orgUnitId)]) continue;
      if (isMergedOrCancelledCourse(name, code)) continue;
      var roleId = getRoleId(item);
      var roleName = getRoleName(item);
      var academic = isAcademicRole(roleId, roleName);
      var sandbox = isSandboxCourse(name, code);
      var sem = getSemesterCodeFromCourseCode(code);
      if (sandbox) {
        if (!academic) continue;
      } else {
        if (!academic || !ALLOWED_SEMESTER_CODES[sem]) continue;
      }
      seen[String(orgUnitId)] = true;
      out.push({
        OrgUnitId: String(orgUnitId),
        Code: code,
        Name: name,
        SemesterCode: sem,
        IsSandbox: sandbox
      });
    }
    out.sort(function (a, b) {
      if (a.IsSandbox !== b.IsSandbox) return a.IsSandbox ? 1 : -1;
      return String(a.Code || "").localeCompare(String(b.Code || ""));
    });
    return out;
  }

  async function loadWhoAmI() {
    try {
      var me = await BrightspaceFetch("/d2l/api/lp/" + API_VERSION_LP + "/users/whoami");
      state.instructor = {
        firstName: (me && me.FirstName) || "",
        lastName: (me && me.LastName) || "",
        displayName:
          (me && (me.DisplayName || ((me.FirstName || "") + " " + (me.LastName || "")).trim())) ||
          "your instructor"
      };
    } catch (e) {
      state.instructor = { firstName: "", lastName: "", displayName: "your instructor" };
    }
  }

  async function loadCourses() {
    var select = $("cpdCourse");
    if (!select) return;
    try {
      var raw = await getAllMyEnrollments();
      state.courses = filterCourses(raw);
      state.courseMap = {};
      for (var i = 0; i < state.courses.length; i++) {
        state.courseMap[state.courses[i].OrgUnitId] = state.courses[i];
      }
      select.innerHTML = "";
      if (!state.courses.length) {
        var empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "No eligible courses found";
        select.appendChild(empty);
        $("cpdDeployBtn").disabled = true;
        setMessage("No current-term, upcoming-term, or sandbox courses found for your teaching roles.", "error");
        return;
      }
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a course…";
      select.appendChild(placeholder);
      var termGroup = document.createElement("optgroup");
      termGroup.label = "Current & upcoming (" + ACTIVE_SEMESTER_CODE + ", " + FUTURE_SEMESTER_CODE + ")";
      var sandboxGroup = document.createElement("optgroup");
      sandboxGroup.label = "Sandbox courses";
      for (var j = 0; j < state.courses.length; j++) {
        var c = state.courses[j];
        var opt = document.createElement("option");
        opt.value = c.OrgUnitId;
        opt.textContent = c.Code ? c.Code + " — " + c.Name : c.Name;
        if (c.IsSandbox) sandboxGroup.appendChild(opt);
        else termGroup.appendChild(opt);
      }
      if (termGroup.children.length) select.appendChild(termGroup);
      if (sandboxGroup.children.length) select.appendChild(sandboxGroup);
      $("cpdDeployBtn").disabled = false;
      setMessage("", null);
    } catch (e) {
      select.innerHTML = "";
      var errOpt = document.createElement("option");
      errOpt.value = "";
      errOpt.textContent = "Unable to load courses";
      select.appendChild(errOpt);
      $("cpdDeployBtn").disabled = true;
      setMessage("Could not load your courses. Open this page from inside Brightspace and try again.", "error");
    }
  }

  async function loadGradeSchemesForCourse(orgUnitId) {
    var select = $("cpdGradeSchemeSelect");
    if (!select) return;
    select.innerHTML = '<option value="">Course default (unchanged)</option>';
    state.gradeSchemes = [];
    if (!orgUnitId) return;
    try {
      var schemes = await BrightspaceFetch(
        "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/schemes/"
      );
      var list = Array.isArray(schemes) ? schemes : [];
      state.gradeSchemes = list;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || s.Id == null) continue;
        var opt = document.createElement("option");
        opt.value = String(s.Id);
        opt.textContent = s.Name || "Scheme " + s.Id;
        select.appendChild(opt);
      }
      try {
        var setup = await BrightspaceFetch(
          "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/setup/"
        );
        if (setup) {
          if (setup.GradingSystem) {
            var radio = document.querySelector('input[name="cpdScheme"][value="' + setup.GradingSystem + '"]');
            if (radio) radio.checked = true;
          }
          if (typeof setup.IsNullGradeZero === "boolean") {
            $("cpdNullAsZero").checked = setup.IsNullGradeZero;
          }
          if (setup.DefaultGradeSchemeId != null) {
            select.value = String(setup.DefaultGradeSchemeId);
          }
          updateSchemeUi();
        }
      } catch (e2) {
        // setup optional
      }
    } catch (e) {
      appendLog("Could not load grade schemes: " + e.message);
    }
  }

  // ---- Categories UI ----

  function nextCategoryKey() {
    return "cat-" + state.categorySeq++;
  }

  function readCategories() {
    var rows = document.querySelectorAll("#cpdCategoryRows .cpd-category-row");
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var name = (row.querySelector("[data-field='name']").value || "").trim();
      var weightRaw = row.querySelector("[data-field='weight']").value;
      var dropHigh = parseInt(row.querySelector("[data-field='dropHigh']").value, 10);
      var dropLow = parseInt(row.querySelector("[data-field='dropLow']").value, 10);
      var dist = row.querySelector("[data-field='dist']").value;
      var exclude = row.querySelector("[data-field='exclude']").checked;
      var canExceed = row.querySelector("[data-field='canExceed']").checked;
      if (!name && !weightRaw) continue;
      out.push({
        key: row.getAttribute("data-key"),
        name: name,
        weight: weightRaw === "" ? null : parseFloat(weightRaw),
        dropHigh: isNaN(dropHigh) ? 0 : dropHigh,
        dropLow: isNaN(dropLow) ? 0 : dropLow,
        dist: dist,
        exclude: exclude,
        canExceed: canExceed
      });
    }
    return out;
  }

  function refreshCategorySelects() {
    var cats = readCategories();
    var selects = document.querySelectorAll("[data-field='categoryKey']");
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var current = sel.value;
      sel.innerHTML = "";
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "No category";
      sel.appendChild(none);
      for (var c = 0; c < cats.length; c++) {
        if (!cats[c].name) continue;
        var opt = document.createElement("option");
        opt.value = cats[c].key;
        opt.textContent = cats[c].name;
        sel.appendChild(opt);
      }
      if (current) sel.value = current;
    }
    updateCategoryWeightTotal();
  }

  function addCategoryRow(data) {
    var container = $("cpdCategoryRows");
    if (!container) return;
    data = data || {};
    var key = data.key || nextCategoryKey();
    var row = document.createElement("div");
    row.className = "cpd-category-row";
    row.setAttribute("data-key", key);

    row.innerHTML =
      '<input type="text" class="form-input" data-field="name" placeholder="Category name" aria-label="Category name">' +
      '<input type="number" class="form-input cpd-weight-col" data-field="weight" placeholder="Weight %" min="0" step="0.01" aria-label="Category weight">' +
      '<select class="form-select" data-field="dist" aria-label="Weight distribution">' +
      '<option value="even">Distribute evenly</option>' +
      '<option value="manual">Manual item weights</option>' +
      "</select>" +
      '<input type="number" class="form-input" data-field="dropHigh" placeholder="Drop high" min="0" step="1" aria-label="Drop highest">' +
      '<input type="number" class="form-input" data-field="dropLow" placeholder="Drop low" min="0" step="1" aria-label="Drop lowest">' +
      '<label class="cpd-mini-check"><input type="checkbox" data-field="canExceed"> Can exceed</label>' +
      '<label class="cpd-mini-check"><input type="checkbox" data-field="exclude"> Exclude from final</label>' +
      '<button type="button" class="cpd-remove-btn" aria-label="Remove category"><i class="fas fa-trash" aria-hidden="true"></i></button>';

    row.querySelector("[data-field='name']").value = data.name || "";
    row.querySelector("[data-field='weight']").value =
      data.weight != null && data.weight !== "" ? data.weight : "";
    row.querySelector("[data-field='dist']").value = data.dist || "even";
    row.querySelector("[data-field='dropHigh']").value =
      data.dropHigh != null ? data.dropHigh : "0";
    row.querySelector("[data-field='dropLow']").value = data.dropLow != null ? data.dropLow : "0";
    row.querySelector("[data-field='canExceed']").checked = !!data.canExceed;
    row.querySelector("[data-field='exclude']").checked = !!data.exclude;

    row.querySelector(".cpd-remove-btn").addEventListener("click", function () {
      row.remove();
      refreshCategorySelects();
    });
    row.querySelector("[data-field='name']").addEventListener("input", refreshCategorySelects);
    row.querySelector("[data-field='weight']").addEventListener("input", updateCategoryWeightTotal);

    container.appendChild(row);
    refreshCategorySelects();
    updateSchemeUi();
  }

  function ensureCategoryByName(name, weight) {
    var cats = readCategories();
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].name.toLowerCase() === String(name).toLowerCase()) return cats[i].key;
    }
    var key = nextCategoryKey();
    addCategoryRow({ key: key, name: name, weight: weight, dist: "even" });
    return key;
  }

  function updateCategoryWeightTotal() {
    var el = $("cpdCategoryWeightTotal");
    if (!el) return;
    var show = isWeighted();
    el.hidden = !show;
    if (!show) return;
    var cats = readCategories();
    var sum = 0;
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].weight != null && !cats[i].exclude) sum += Number(cats[i].weight) || 0;
    }
    $("cpdCategoryWeightSum").textContent = String(Math.round(sum * 100) / 100);
    var status = $("cpdCategoryWeightStatus");
    if (!cats.length) status.textContent = "";
    else if (Math.abs(sum - 100) < 0.05) status.textContent = "(looks good)";
    else status.textContent = "(should total 100% for weighted)";
  }

  // ---- Grade items UI ----

  function categoryOptionsHtml(selected) {
    var cats = readCategories();
    var html = '<option value="">No category</option>';
    for (var i = 0; i < cats.length; i++) {
      if (!cats[i].name) continue;
      html +=
        '<option value="' +
        escapeHtml(cats[i].key) +
        '"' +
        (selected === cats[i].key ? " selected" : "") +
        ">" +
        escapeHtml(cats[i].name) +
        "</option>";
    }
    return html;
  }

  function addGradeRow(item) {
    var container = $("cpdGradeRows");
    if (!container) return;
    item = item || {};
    var row = document.createElement("div");
    row.className = "cpd-grade-row";

    row.innerHTML =
      '<input type="text" class="form-input" data-field="name" placeholder="Grade item name" aria-label="Grade item name">' +
      '<input type="number" class="form-input" data-field="points" placeholder="100" min="0.01" step="0.01" aria-label="Max points">' +
      '<div class="cpd-weight-col"><input type="number" class="form-input" data-field="weight" placeholder="10" min="0" step="0.01" aria-label="Weight percent"></div>' +
      '<select class="form-select" data-field="categoryKey" aria-label="Category"></select>' +
      '<div class="cpd-flags-col">' +
      '<label class="cpd-mini-check"><input type="checkbox" data-field="bonus"> Bonus</label>' +
      '<label class="cpd-mini-check"><input type="checkbox" data-field="exclude"> Exclude</label>' +
      '<label class="cpd-mini-check"><input type="checkbox" data-field="canExceed"> Exceed max</label>' +
      "</div>" +
      '<button type="button" class="cpd-remove-btn" aria-label="Remove grade item"><i class="fas fa-trash" aria-hidden="true"></i></button>';

    row.querySelector("[data-field='name']").value = item.name || "";
    row.querySelector("[data-field='points']").value =
      item.points != null && item.points !== "" ? item.points : "";
    row.querySelector("[data-field='weight']").value =
      item.weight != null && item.weight !== "" ? item.weight : "";
    row.querySelector("[data-field='bonus']").checked = !!item.bonus;
    row.querySelector("[data-field='exclude']").checked = !!item.exclude;
    row.querySelector("[data-field='canExceed']").checked = !!item.canExceed;
    row.querySelector("[data-field='categoryKey']").innerHTML = categoryOptionsHtml(item.categoryKey || "");

    row.querySelector(".cpd-remove-btn").addEventListener("click", function () {
      row.remove();
      updateWeightTotal();
      if (!document.querySelector("#cpdGradeRows .cpd-grade-row")) addGradeRow();
    });
    row.querySelector("[data-field='weight']").addEventListener("input", updateWeightTotal);

    container.appendChild(row);
    updateSchemeUi();
    updateWeightTotal();
  }

  function readManualGradeItems() {
    var rows = document.querySelectorAll("#cpdGradeRows .cpd-grade-row");
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var name = (row.querySelector("[data-field='name']").value || "").trim();
      var pointsRaw = row.querySelector("[data-field='points']").value;
      var weightRaw = row.querySelector("[data-field='weight']").value;
      if (!name && !pointsRaw) continue;
      items.push({
        name: name,
        points: pointsRaw === "" ? null : parseFloat(pointsRaw),
        weight: weightRaw === "" ? null : parseFloat(weightRaw),
        categoryKey: row.querySelector("[data-field='categoryKey']").value || "",
        bonus: row.querySelector("[data-field='bonus']").checked,
        exclude: row.querySelector("[data-field='exclude']").checked,
        canExceed: row.querySelector("[data-field='canExceed']").checked
      });
    }
    return items;
  }

  function updateWeightTotal() {
    var el = $("cpdWeightTotal");
    if (!el) return;
    var show = isWeighted();
    el.hidden = !show;
    if (!show) return;
    var items = readManualGradeItems();
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].weight != null && !items[i].categoryKey) sum += Number(items[i].weight) || 0;
    }
    $("cpdWeightSum").textContent = String(Math.round(sum * 100) / 100);
  }

  function setGradeEntryMode(mode) {
    state.gradeEntryMode = mode === "csv" ? "csv" : "manual";
    $("cpdManualPanel").hidden = state.gradeEntryMode !== "manual";
    $("cpdCsvPanel").hidden = state.gradeEntryMode !== "csv";
    $("cpdTabManual").classList.toggle("is-active", state.gradeEntryMode === "manual");
    $("cpdTabCsv").classList.toggle("is-active", state.gradeEntryMode === "csv");
    $("cpdTabManual").setAttribute("aria-selected", state.gradeEntryMode === "manual" ? "true" : "false");
    $("cpdTabCsv").setAttribute("aria-selected", state.gradeEntryMode === "csv" ? "true" : "false");
  }

  function updateSchemeUi() {
    var weighted = isWeighted();
    var formula = getScheme() === "Formula";
    var hint = $("cpdSchemeHint");
    var manualPanel = $("cpdManualPanel");
    if (manualPanel) manualPanel.classList.toggle("is-weighted", weighted);

    var weightHeaders = document.querySelectorAll("#cpdGradeHeader .cpd-weight-col, #cpdWeightHeader");
    for (var h = 0; h < weightHeaders.length; h++) weightHeaders[h].hidden = !weighted;

    var rows = document.querySelectorAll("#cpdGradeRows .cpd-grade-row .cpd-weight-col");
    for (var i = 0; i < rows.length; i++) rows[i].hidden = !weighted;

    var catWeightCols = document.querySelectorAll("#cpdCategoryRows .cpd-weight-col");
    for (var c = 0; c < catWeightCols.length; c++) catWeightCols[c].hidden = !weighted;

    if (hint) {
      if (weighted) {
        hint.textContent =
          "Weighted: category weights should total 100%. Items inside a category can distribute evenly or use manual weights.";
      } else if (formula) {
        hint.textContent =
          "Formula: this tool sets the grading system to Formula and creates categories/items. Build the final formula in Brightspace Grades → Setup.";
      } else {
        hint.textContent = "Points: final grade is based on points earned across grade items.";
      }
    }
    updateCategoryWeightTotal();
    updateWeightTotal();
  }

  // ---- CSV ----

  function splitCsvLine(line) {
    var out = [];
    var cur = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function indexOfAny(arr, keys) {
    for (var i = 0; i < keys.length; i++) {
      var idx = arr.indexOf(keys[i]);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function parseCsvText(text) {
    var lines = String(text || "")
      .replace(/^\uFEFF/, "")
      .split(/\r\n|\n|\r/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) rows.push(splitCsvLine(line));
    }
    if (!rows.length) throw new Error("CSV file is empty.");

    var header = rows[0].map(function (h) {
      return String(h || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    });

    var nameIdx = indexOfAny(header, ["name", "item", "gradeitem", "title"]);
    var pointsIdx = indexOfAny(header, ["maxpoints", "points", "maxpoint", "score"]);
    var weightIdx = indexOfAny(header, ["weight", "weight%", "itemweight"]);
    var catIdx = indexOfAny(header, ["category", "gradecategory"]);
    var catWeightIdx = indexOfAny(header, ["categoryweight", "catweight"]);

    var start = 0;
    if (nameIdx >= 0 || pointsIdx >= 0 || catIdx >= 0) start = 1;
    else {
      nameIdx = 0;
      pointsIdx = 1;
      weightIdx = rows[0].length > 2 ? 2 : -1;
      start = 0;
    }
    if (nameIdx < 0) nameIdx = 0;
    if (pointsIdx < 0) pointsIdx = 1;

    var items = [];
    for (var r = start; r < rows.length; r++) {
      var cols = rows[r];
      var name = (cols[nameIdx] || "").trim();
      if (!name) continue;
      var points = parseFloat(cols[pointsIdx]);
      var weight =
        weightIdx >= 0 && cols[weightIdx] != null && String(cols[weightIdx]).trim() !== ""
          ? parseFloat(cols[weightIdx])
          : null;
      var category = catIdx >= 0 ? (cols[catIdx] || "").trim() : "";
      var categoryWeight =
        catWeightIdx >= 0 && cols[catWeightIdx] != null && String(cols[catWeightIdx]).trim() !== ""
          ? parseFloat(cols[catWeightIdx])
          : null;
      items.push({
        name: name,
        points: isNaN(points) ? null : points,
        weight: weight != null && !isNaN(weight) ? weight : null,
        category: category,
        categoryWeight: categoryWeight != null && !isNaN(categoryWeight) ? categoryWeight : null
      });
    }
    if (!items.length) throw new Error("No grade items found in the CSV.");
    return items;
  }

  async function handleCsvUpload(file) {
    var status = $("cpdCsvStatus");
    if (!file) {
      if (status) {
        status.hidden = true;
        status.textContent = "";
      }
      return;
    }
    var text = await file.text();
    var items = parseCsvText(text);
    $("cpdCategoryRows").innerHTML = "";
    $("cpdGradeRows").innerHTML = "";
    for (var i = 0; i < items.length; i++) {
      var categoryKey = "";
      if (items[i].category) {
        categoryKey = ensureCategoryByName(items[i].category, items[i].categoryWeight);
      }
      addGradeRow({
        name: items[i].name,
        points: items[i].points,
        weight: items[i].weight,
        categoryKey: categoryKey
      });
    }
    if (status) {
      status.hidden = false;
      status.textContent = "Loaded " + items.length + " grade item(s) from " + file.name;
    }
    setGradeEntryMode("manual");
    refreshCategorySelects();
  }

  // ---- Assignments UI ----

  function updateAssignmentEmpty() {
    var empty = $("cpdAssignmentEmpty");
    var has = document.querySelectorAll("#cpdAssignmentRows .cpd-assignment-card").length > 0;
    if (empty) empty.hidden = has;
  }

  function setAssignmentEntryMode(mode) {
    var isCsv = mode === "csv";
    if ($("cpdAsnManualPanel")) $("cpdAsnManualPanel").hidden = isCsv;
    if ($("cpdAsnCsvPanel")) $("cpdAsnCsvPanel").hidden = !isCsv;
    if ($("cpdAsnTabManual")) {
      $("cpdAsnTabManual").classList.toggle("is-active", !isCsv);
      $("cpdAsnTabManual").setAttribute("aria-selected", !isCsv ? "true" : "false");
    }
    if ($("cpdAsnTabCsv")) {
      $("cpdAsnTabCsv").classList.toggle("is-active", isCsv);
      $("cpdAsnTabCsv").setAttribute("aria-selected", isCsv ? "true" : "false");
    }
  }

  function parseBoolLoose(value, defaultValue) {
    if (value == null || String(value).trim() === "") return defaultValue;
    var v = String(value).trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "y") return true;
    if (v === "0" || v === "false" || v === "no" || v === "n") return false;
    return defaultValue;
  }

  function parseSubmissionType(value) {
    if (value == null || String(value).trim() === "") return 0;
    var v = String(value).trim().toLowerCase().replace(/\s+/g, "");
    if (v === "0" || v === "file") return 0;
    if (v === "1" || v === "text" || v === "textonly") return 1;
    if (v === "2" || v === "onpaper" || v === "paper") return 2;
    if (v === "3" || v === "observed" || v === "observedinperson") return 3;
    if (v === "4" || v === "fileortext" || v === "file/text") return 4;
    var n = parseInt(value, 10);
    return isNaN(n) ? 0 : n;
  }

  function normalizeDueDateLocal(value) {
    if (!value) return "";
    var s = String(value).trim();
    if (!s) return "";
    // Already datetime-local shape
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
    // Date only
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T23:59";
    // Excel-ish: 2026-09-05 23:59
    if (/^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}/.test(s)) return s.replace(" ", "T").slice(0, 16);
    var d = new Date(s);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function parseAssignmentCsvText(text) {
    var lines = String(text || "")
      .replace(/^\uFEFF/, "")
      .split(/\r\n|\n|\r/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) rows.push(splitCsvLine(line));
    }
    if (!rows.length) throw new Error("CSV file is empty.");

    var header = rows[0].map(function (h) {
      return String(h || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    });

    var nameIdx = indexOfAny(header, ["name", "assignment", "title"]);
    var pointsIdx = indexOfAny(header, ["points", "maxpoints", "score"]);
    var catIdx = indexOfAny(header, ["category", "gradecategory"]);
    var dueIdx = indexOfAny(header, ["duedate", "due", "deadline"]);
    var subIdx = indexOfAny(header, ["submissiontype", "submission", "type"]);
    var instrIdx = indexOfAny(header, ["instructions", "instruction", "description"]);
    var linkIdx = indexOfAny(header, ["linkgrade", "createlinkgrade", "gradeitem"]);
    var calIdx = indexOfAny(header, ["calendar", "showincalendar"]);
    var hiddenIdx = indexOfAny(header, ["hidden", "ishidden"]);

    var start = 0;
    if (nameIdx >= 0 || pointsIdx >= 0) start = 1;
    else {
      nameIdx = 0;
      pointsIdx = 1;
      catIdx = 2;
      dueIdx = 3;
      subIdx = 4;
      instrIdx = 5;
      linkIdx = 6;
      calIdx = 7;
      hiddenIdx = 8;
      start = 0;
    }
    if (nameIdx < 0) nameIdx = 0;
    if (pointsIdx < 0) pointsIdx = 1;

    var items = [];
    for (var r = start; r < rows.length; r++) {
      var cols = rows[r];
      var name = (cols[nameIdx] || "").trim();
      if (!name) continue;
      var points = parseFloat(cols[pointsIdx]);
      var category = catIdx >= 0 ? (cols[catIdx] || "").trim() : "";
      var due = dueIdx >= 0 ? normalizeDueDateLocal(cols[dueIdx]) : "";
      var submissionType = subIdx >= 0 ? parseSubmissionType(cols[subIdx]) : 0;
      var instructions = instrIdx >= 0 ? (cols[instrIdx] || "").trim() : "";
      var linkGrade = linkIdx >= 0 ? parseBoolLoose(cols[linkIdx], true) : true;
      var calendar = calIdx >= 0 ? parseBoolLoose(cols[calIdx], false) : false;
      var hidden = hiddenIdx >= 0 ? parseBoolLoose(cols[hiddenIdx], false) : false;
      var completionType = submissionType === 2 || submissionType === 3 ? 1 : 0;

      items.push({
        name: name,
        points: isNaN(points) ? null : points,
        category: category,
        due: due,
        submissionType: submissionType,
        completionType: completionType,
        instructions: instructions,
        linkGrade: linkGrade,
        calendar: calendar,
        hidden: hidden
      });
    }
    if (!items.length) throw new Error("No assignments found in the CSV.");
    return items;
  }

  async function handleAssignmentCsvUpload(file) {
    var status = $("cpdAssignmentCsvStatus");
    if (!file) {
      if (status) {
        status.hidden = true;
        status.textContent = "";
      }
      return;
    }
    var text = await file.text();
    var items = parseAssignmentCsvText(text);
    $("cpdAssignmentRows").innerHTML = "";
    for (var i = 0; i < items.length; i++) {
      var categoryKey = "";
      if (items[i].category) {
        categoryKey = ensureCategoryByName(items[i].category, null);
      }
      addAssignmentRow({
        name: items[i].name,
        points: items[i].points,
        categoryKey: categoryKey,
        due: items[i].due,
        submissionType: items[i].submissionType,
        completionType: items[i].completionType,
        instructions: items[i].instructions,
        linkGrade: items[i].linkGrade,
        calendar: items[i].calendar,
        hidden: items[i].hidden
      });
    }
    if (status) {
      status.hidden = false;
      status.textContent = "Loaded " + items.length + " assignment(s) from " + file.name;
    }
    setAssignmentEntryMode("manual");
    refreshCategorySelects();
  }

  function addAssignmentRow(data) {
    var container = $("cpdAssignmentRows");
    if (!container) return;
    data = data || {};
    var card = document.createElement("div");
    card.className = "cpd-assignment-card";

    card.innerHTML =
      '<div class="cpd-assignment-grid">' +
      '<div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" data-field="name" placeholder="Assignment name"></div>' +
      '<div class="form-group"><label class="form-label">Points</label><input type="number" class="form-input" data-field="points" min="0.01" step="0.01" placeholder="100"></div>' +
      '<div class="form-group"><label class="form-label">Category</label><select class="form-select" data-field="categoryKey"></select></div>' +
      '<div class="form-group"><label class="form-label">Due date</label><input type="datetime-local" class="form-input" data-field="due"></div>' +
      '<div class="form-group"><label class="form-label">Submission type</label>' +
      '<select class="form-select" data-field="submissionType">' +
      '<option value="0">File submission</option>' +
      '<option value="4">File or text</option>' +
      '<option value="1">Text only</option>' +
      '<option value="2">On paper</option>' +
      '<option value="3">Observed in person</option>' +
      "</select></div>" +
      '<div class="form-group"><label class="form-label">Completion</label>' +
      '<select class="form-select" data-field="completionType">' +
      '<option value="0">On submission</option>' +
      '<option value="1">Due date</option>' +
      '<option value="2">Manually by learner</option>' +
      '<option value="3">On evaluation</option>' +
      "</select></div>" +
      "</div>" +
      '<div class="form-group"><label class="form-label">Instructions</label><textarea class="form-textarea" data-field="instructions" rows="3" placeholder="Optional student instructions"></textarea></div>' +
      '<div class="cpd-assignment-options">' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="linkGrade" checked> Create &amp; link grade item</label>' +
      '<span class="form-hint cpd-inline-hint">If a gradebook item with a similar name already exists, you will be asked to link it or create a new one.</span>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="calendar"> Show due date in calendar</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="hidden"> Hidden from students</label>' +
      '<button type="button" class="form-button form-button-secondary cpd-remove-assignment">Remove</button>' +
      "</div>";

    card.querySelector("[data-field='name']").value = data.name || "";
    card.querySelector("[data-field='points']").value =
      data.points != null && data.points !== "" ? data.points : "";
    card.querySelector("[data-field='due']").value = data.due || "";
    card.querySelector("[data-field='submissionType']").value =
      data.submissionType != null ? String(data.submissionType) : "0";
    card.querySelector("[data-field='completionType']").value =
      data.completionType != null ? String(data.completionType) : "0";
    card.querySelector("[data-field='instructions']").value = data.instructions || "";
    card.querySelector("[data-field='linkGrade']").checked =
      data.linkGrade === undefined ? true : !!data.linkGrade;
    card.querySelector("[data-field='calendar']").checked = !!data.calendar;
    card.querySelector("[data-field='hidden']").checked = !!data.hidden;
    card.querySelector("[data-field='categoryKey']").innerHTML = categoryOptionsHtml(
      data.categoryKey || ""
    );

    card.querySelector("[data-field='submissionType']").addEventListener("change", function () {
      var st = parseInt(card.querySelector("[data-field='submissionType']").value, 10);
      var completion = card.querySelector("[data-field='completionType']");
      // File / text submissions only support OnSubmission via API
      if (st === 0 || st === 1 || st === 4) {
        completion.value = "0";
      }
    });

    card.querySelector(".cpd-remove-assignment").addEventListener("click", function () {
      card.remove();
      updateAssignmentEmpty();
    });

    container.appendChild(card);
    updateAssignmentEmpty();
    refreshCategorySelects();
  }

  function readAssignments() {
    var cards = document.querySelectorAll("#cpdAssignmentRows .cpd-assignment-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = (card.querySelector("[data-field='name']").value || "").trim();
      var pointsRaw = card.querySelector("[data-field='points']").value;
      if (!name && !pointsRaw) continue;
      out.push({
        name: name,
        points: pointsRaw === "" ? null : parseFloat(pointsRaw),
        categoryKey: card.querySelector("[data-field='categoryKey']").value || "",
        due: card.querySelector("[data-field='due']").value || "",
        submissionType: parseInt(card.querySelector("[data-field='submissionType']").value, 10),
        completionType: parseInt(card.querySelector("[data-field='completionType']").value, 10),
        instructions: (card.querySelector("[data-field='instructions']").value || "").trim(),
        linkGrade: card.querySelector("[data-field='linkGrade']").checked,
        calendar: card.querySelector("[data-field='calendar']").checked,
        hidden: card.querySelector("[data-field='hidden']").checked
      });
    }
    return out;
  }


  // ---- Quizzes UI ----

  function updateQuizEmpty() {
    var empty = $("cpdQuizEmpty");
    if (!empty) return;
    empty.hidden = document.querySelectorAll("#cpdQuizRows .cpd-quiz-card").length > 0;
  }

  function setQuizEntryMode(mode) {
    var isCsv = mode === "csv";
    if ($("cpdQuizManualPanel")) $("cpdQuizManualPanel").hidden = isCsv;
    if ($("cpdQuizCsvPanel")) $("cpdQuizCsvPanel").hidden = !isCsv;
    if ($("cpdQuizTabManual")) {
      $("cpdQuizTabManual").classList.toggle("is-active", !isCsv);
      $("cpdQuizTabManual").setAttribute("aria-selected", !isCsv ? "true" : "false");
    }
    if ($("cpdQuizTabCsv")) {
      $("cpdQuizTabCsv").classList.toggle("is-active", isCsv);
      $("cpdQuizTabCsv").setAttribute("aria-selected", isCsv ? "true" : "false");
    }
  }

  function quizRtCreate(text, isDisplayed) {
    return {
      Text: { Content: text || "", Type: "Text" },
      IsDisplayed: !!isDisplayed
    };
  }

  function parseAttemptsAllowed(value) {
    if (value == null || String(value).trim() === "") return 1;
    var raw = String(value).trim().toLowerCase();
    if (raw === "unlimited" || raw === "null" || raw === "0") return null;
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return 1;
    if (n > 10) return 10;
    return n;
  }

  function addQuizRow(data) {
    var container = $("cpdQuizRows");
    if (!container) return;
    data = data || {};
    var card = document.createElement("div");
    card.className = "cpd-assignment-card cpd-quiz-card";

    card.innerHTML =
      '<div class="cpd-assignment-grid">' +
      '<div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" data-field="name" placeholder="Quiz name"></div>' +
      '<div class="form-group"><label class="form-label">Points</label><input type="number" class="form-input" data-field="points" min="0.01" step="0.01" placeholder="100"></div>' +
      '<div class="form-group"><label class="form-label">Gradebook category</label><select class="form-select" data-field="categoryKey"></select></div>' +
      '<div class="form-group"><label class="form-label">Quiz tool category</label><input type="text" class="form-input" data-field="quizCategory" placeholder="e.g. Weekly Quizzes (optional)"></div>' +
      '<div class="form-group"><label class="form-label">Due date</label><input type="datetime-local" class="form-input" data-field="due"></div>' +
      '<div class="form-group"><label class="form-label">Start date</label><input type="datetime-local" class="form-input" data-field="start"></div>' +
      '<div class="form-group"><label class="form-label">End date</label><input type="datetime-local" class="form-input" data-field="end"></div>' +
      '<div class="form-group"><label class="form-label">Attempts</label>' +
      '<select class="form-select" data-field="attempts">' +
      '<option value="1">1</option>' +
      '<option value="2">2</option>' +
      '<option value="3">3</option>' +
      '<option value="5">5</option>' +
      '<option value="10">10</option>' +
      '<option value="unlimited">Unlimited</option>' +
      "</select></div>" +
      '<div class="form-group"><label class="form-label">Time limit (minutes)</label><input type="number" class="form-input" data-field="timeLimit" min="0" max="9999" step="1" placeholder="0 = none"><p class="form-hint">0 or blank = no time limit.</p></div>' +
      "</div>" +
      '<div class="form-group"><label class="form-label">Instructions</label><textarea class="form-textarea" data-field="instructions" rows="2" placeholder="Optional quiz instructions shown to students"></textarea></div>' +
      '<div class="cpd-assignment-options">' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="linkGrade" checked> Create &amp; link grade item</label>' +
      '<span class="form-hint cpd-inline-hint">If a gradebook item with a similar name already exists, you will be asked to link it or create a new one.</span>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="shuffle"> Shuffle questions</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="calendar"> Show in calendar</label>' +
      '<span class="form-hint cpd-inline-hint">Calendar needs a start or end date. If only a due date is set, deploy uses the due date as the end date.</span>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="hidden" checked> Hidden (inactive) until you publish</label>' +
      '<button type="button" class="form-button form-button-secondary cpd-remove-quiz">Remove</button>' +
      "</div>";

    card.querySelector("[data-field='name']").value = data.name || "";
    card.querySelector("[data-field='points']").value =
      data.points != null && data.points !== "" ? data.points : "";
    card.querySelector("[data-field='quizCategory']").value = data.quizCategory || "";
    card.querySelector("[data-field='due']").value = data.due || "";
    card.querySelector("[data-field='start']").value = data.start || "";
    card.querySelector("[data-field='end']").value = data.end || "";
    var attemptsVal =
      data.attempts === null || data.attempts === "unlimited" ? "unlimited" : String(data.attempts != null ? data.attempts : 1);
    card.querySelector("[data-field='attempts']").value = attemptsVal;
    card.querySelector("[data-field='timeLimit']").value =
      data.timeLimit != null && data.timeLimit !== "" ? data.timeLimit : "";
    card.querySelector("[data-field='instructions']").value = data.instructions || "";
    card.querySelector("[data-field='linkGrade']").checked =
      data.linkGrade === undefined ? true : !!data.linkGrade;
    card.querySelector("[data-field='shuffle']").checked =
      data.shuffle === undefined ? false : !!data.shuffle;
    card.querySelector("[data-field='calendar']").checked = !!data.calendar;
    card.querySelector("[data-field='hidden']").checked =
      data.hidden === undefined ? true : !!data.hidden;
    card.querySelector("[data-field='categoryKey']").innerHTML = categoryOptionsHtml(
      data.categoryKey || ""
    );

    card.querySelector(".cpd-remove-quiz").addEventListener("click", function () {
      card.remove();
      updateQuizEmpty();
    });

    container.appendChild(card);
    updateQuizEmpty();
    refreshCategorySelects();
  }

  function readQuizzes() {
    var cards = document.querySelectorAll("#cpdQuizRows .cpd-quiz-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = (card.querySelector("[data-field='name']").value || "").trim();
      var pointsRaw = card.querySelector("[data-field='points']").value;
      if (!name && !pointsRaw) continue;
      var attemptsRaw = card.querySelector("[data-field='attempts']").value;
      var timeRaw = card.querySelector("[data-field='timeLimit']").value;
      var timeLimit = timeRaw === "" ? 0 : parseInt(timeRaw, 10);
      out.push({
        name: name,
        points: pointsRaw === "" ? null : parseFloat(pointsRaw),
        categoryKey: card.querySelector("[data-field='categoryKey']").value || "",
        quizCategory: (card.querySelector("[data-field='quizCategory']").value || "").trim(),
        due: card.querySelector("[data-field='due']").value || "",
        start: card.querySelector("[data-field='start']").value || "",
        end: card.querySelector("[data-field='end']").value || "",
        attempts: attemptsRaw === "unlimited" ? null : parseInt(attemptsRaw, 10),
        timeLimit: isNaN(timeLimit) ? 0 : timeLimit,
        instructions: (card.querySelector("[data-field='instructions']").value || "").trim(),
        linkGrade: card.querySelector("[data-field='linkGrade']").checked,
        shuffle: card.querySelector("[data-field='shuffle']").checked,
        calendar: card.querySelector("[data-field='calendar']").checked,
        hidden: card.querySelector("[data-field='hidden']").checked
      });
    }
    return out;
  }

  function parseQuizCsvText(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) rows.push(splitCsvLine(line));
    }
    if (!rows.length) throw new Error("CSV file is empty.");
    var header = rows[0].map(function (h) {
      return String(h || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    });
    var nameIdx = indexOfAny(header, ["name", "quiz", "title"]);
    var pointsIdx = indexOfAny(header, ["points", "maxpoints", "score"]);
    var catIdx = indexOfAny(header, ["category", "gradecategory"]);
    var quizCatIdx = indexOfAny(header, ["quizcategory", "quizcat", "folder"]);
    var dueIdx = indexOfAny(header, ["duedate", "due"]);
    var startIdx = indexOfAny(header, ["startdate", "start"]);
    var endIdx = indexOfAny(header, ["enddate", "end"]);
    var attemptsIdx = indexOfAny(header, ["attempts", "numberofattempts", "attempt"]);
    var timeIdx = indexOfAny(header, ["timelimitminutes", "timelimit", "minutes"]);
    var shuffleIdx = indexOfAny(header, ["shuffle", "randomize"]);
    var instrIdx = indexOfAny(header, ["instructions", "instruction", "description"]);
    var linkIdx = indexOfAny(header, ["linkgrade", "createlinkgrade", "gradeitem"]);
    var calIdx = indexOfAny(header, ["calendar", "displayincalendar"]);
    var hiddenIdx = indexOfAny(header, ["hidden", "inactive", "isactive"]);
    var start = 0;
    if (nameIdx >= 0 || pointsIdx >= 0) start = 1;
    else {
      nameIdx = 0;
      pointsIdx = 1;
      catIdx = 2;
      quizCatIdx = 3;
      dueIdx = 4;
      startIdx = 5;
      endIdx = 6;
      attemptsIdx = 7;
      timeIdx = 8;
      shuffleIdx = 9;
      instrIdx = 10;
      linkIdx = 11;
      calIdx = 12;
      hiddenIdx = 13;
      start = 0;
    }
    if (nameIdx < 0) nameIdx = 0;
    if (pointsIdx < 0) pointsIdx = 1;

    var items = [];
    for (var r = start; r < rows.length; r++) {
      var cols = rows[r];
      var name = (cols[nameIdx] || "").trim();
      if (!name) continue;
      var points = parseFloat(cols[pointsIdx]);
      var timeLimit = timeIdx >= 0 ? parseInt(cols[timeIdx], 10) : 0;
      if (isNaN(timeLimit) || timeLimit < 0) timeLimit = 0;
      items.push({
        name: name,
        points: isNaN(points) ? null : points,
        category: catIdx >= 0 ? (cols[catIdx] || "").trim() : "",
        quizCategory: quizCatIdx >= 0 ? (cols[quizCatIdx] || "").trim() : "",
        due: dueIdx >= 0 ? normalizeDueDateLocal(cols[dueIdx]) : "",
        start: startIdx >= 0 ? normalizeDueDateLocal(cols[startIdx]) : "",
        end: endIdx >= 0 ? normalizeDueDateLocal(cols[endIdx]) : "",
        attempts: attemptsIdx >= 0 ? parseAttemptsAllowed(cols[attemptsIdx]) : 1,
        timeLimit: timeLimit,
        shuffle: shuffleIdx >= 0 ? parseBoolLoose(cols[shuffleIdx], false) : false,
        instructions: instrIdx >= 0 ? (cols[instrIdx] || "").trim() : "",
        linkGrade: linkIdx >= 0 ? parseBoolLoose(cols[linkIdx], true) : true,
        calendar: calIdx >= 0 ? parseBoolLoose(cols[calIdx], false) : false,
        // CSV "Hidden=yes" means inactive; "IsActive" column inverted via parseBoolLoose on hidden aliases
        hidden: hiddenIdx >= 0 ? parseBoolLoose(cols[hiddenIdx], true) : true
      });
    }
    if (!items.length) throw new Error("No quizzes found in the CSV.");
    return items;
  }

  async function handleQuizCsvUpload(file) {
    var status = $("cpdQuizCsvStatus");
    if (!file) {
      if (status) {
        status.hidden = true;
        status.textContent = "";
      }
      return;
    }
    var items = parseQuizCsvText(await file.text());
    $("cpdQuizRows").innerHTML = "";
    for (var i = 0; i < items.length; i++) {
      var categoryKey = "";
      if (items[i].category) {
        categoryKey = ensureCategoryByName(items[i].category, null);
      }
      addQuizRow({
        name: items[i].name,
        points: items[i].points,
        categoryKey: categoryKey,
        quizCategory: items[i].quizCategory,
        due: items[i].due,
        start: items[i].start,
        end: items[i].end,
        attempts: items[i].attempts,
        timeLimit: items[i].timeLimit,
        shuffle: items[i].shuffle,
        instructions: items[i].instructions,
        linkGrade: items[i].linkGrade,
        calendar: items[i].calendar,
        hidden: items[i].hidden
      });
    }
    if (status) {
      status.hidden = false;
      status.textContent = "Loaded " + items.length + " quiz(zes) from " + file.name;
    }
    setQuizEntryMode("manual");
    refreshCategorySelects();
  }

  function addWeeklyQuizPack() {
    var examsKey = ensureCategoryByName("Exams", 60);
    for (var i = 1; i <= 5; i++) {
      addQuizRow({
        name: "Quiz " + i,
        points: 100,
        categoryKey: examsKey,
        quizCategory: "Weekly Quizzes",
        attempts: 1,
        timeLimit: 30,
        shuffle: true,
        linkGrade: true,
        calendar: false,
        hidden: true,
        instructions: "Complete after the Week " + i + " materials."
      });
    }
    setQuizEntryMode("manual");
  }

  function quizzesManageUrl(orgUnitId) {
    return (
      window.location.origin +
      "/d2l/lms/quizzing/admin/quizzes_manage.d2l?ou=" +
      encodeURIComponent(orgUnitId)
    );
  }

  // ---- Discussions UI ----

  var forumSeq = 1;

  function nextForumKey() {
    return "forum-" + forumSeq++;
  }

  function updateDiscussionEmpty() {
    var empty = $("cpdDiscussionEmpty");
    if (!empty) return;
    var has =
      document.querySelectorAll("#cpdForumRows .cpd-forum-card").length > 0 ||
      document.querySelectorAll("#cpdTopicRows .cpd-topic-card").length > 0;
    empty.hidden = has;
  }

  function setDiscussionEntryMode(mode) {
    var isCsv = mode === "csv";
    if ($("cpdDiscManualPanel")) $("cpdDiscManualPanel").hidden = isCsv;
    if ($("cpdDiscCsvPanel")) $("cpdDiscCsvPanel").hidden = !isCsv;
    if ($("cpdDiscTabManual")) {
      $("cpdDiscTabManual").classList.toggle("is-active", !isCsv);
      $("cpdDiscTabManual").setAttribute("aria-selected", !isCsv ? "true" : "false");
    }
    if ($("cpdDiscTabCsv")) {
      $("cpdDiscTabCsv").classList.toggle("is-active", isCsv);
      $("cpdDiscTabCsv").setAttribute("aria-selected", isCsv ? "true" : "false");
    }
  }

  function readForums() {
    var cards = document.querySelectorAll("#cpdForumRows .cpd-forum-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = (card.querySelector("[data-field='name']").value || "").trim();
      if (!name) continue;
      out.push({
        key: card.getAttribute("data-key"),
        name: name,
        description: (card.querySelector("[data-field='description']").value || "").trim(),
        allowAnonymous: card.querySelector("[data-field='allowAnonymous']").checked,
        mustPost: card.querySelector("[data-field='mustPost']").checked,
        hidden: card.querySelector("[data-field='hidden']").checked,
        locked: card.querySelector("[data-field='locked']").checked
      });
    }
    return out;
  }

  function refreshForumSelects() {
    var forums = readForums();
    var selects = document.querySelectorAll("#cpdTopicRows [data-field='forumKey']");
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var current = sel.value;
      sel.innerHTML = "";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select forum…";
      sel.appendChild(placeholder);
      for (var f = 0; f < forums.length; f++) {
        var opt = document.createElement("option");
        opt.value = forums[f].key;
        opt.textContent = forums[f].name;
        sel.appendChild(opt);
      }
      if (current) sel.value = current;
    }
    updateDiscussionEmpty();
  }

  function ensureForumByName(name, description) {
    var forums = readForums();
    for (var i = 0; i < forums.length; i++) {
      if (forums[i].name.toLowerCase() === String(name).toLowerCase()) return forums[i].key;
    }
    var key = nextForumKey();
    addForumRow({ key: key, name: name, description: description || "" });
    return key;
  }

  function addForumRow(data) {
    var container = $("cpdForumRows");
    if (!container) return;
    data = data || {};
    var key = data.key || nextForumKey();
    var card = document.createElement("div");
    card.className = "cpd-forum-card";
    card.setAttribute("data-key", key);
    card.innerHTML =
      '<div class="cpd-assignment-grid">' +
      '<div class="form-group"><label class="form-label">Forum name</label><input type="text" class="form-input" data-field="name" placeholder="e.g. Week 1 Discussions"></div>' +
      '<div class="form-group" style="grid-column: span 2;"><label class="form-label">Description</label><input type="text" class="form-input" data-field="description" placeholder="Optional forum description"></div>' +
      "</div>" +
      '<div class="cpd-assignment-options">' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="allowAnonymous"> Allow anonymous</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="mustPost"> Must post to participate</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="hidden"> Hidden</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="locked"> Locked</label>' +
      '<button type="button" class="form-button form-button-secondary cpd-remove-forum">Remove forum</button>' +
      "</div>";
    card.querySelector("[data-field='name']").value = data.name || "";
    card.querySelector("[data-field='description']").value = data.description || "";
    card.querySelector("[data-field='allowAnonymous']").checked = !!data.allowAnonymous;
    card.querySelector("[data-field='mustPost']").checked = !!data.mustPost;
    card.querySelector("[data-field='hidden']").checked = !!data.hidden;
    card.querySelector("[data-field='locked']").checked = !!data.locked;
    card.querySelector("[data-field='name']").addEventListener("input", refreshForumSelects);
    card.querySelector(".cpd-remove-forum").addEventListener("click", function () {
      card.remove();
      refreshForumSelects();
    });
    container.appendChild(card);
    refreshForumSelects();
  }

  function addTopicRow(data) {
    var container = $("cpdTopicRows");
    if (!container) return;
    data = data || {};
    var card = document.createElement("div");
    card.className = "cpd-topic-card";
    card.innerHTML =
      '<div class="cpd-assignment-grid">' +
      '<div class="form-group"><label class="form-label">Forum</label><select class="form-select" data-field="forumKey"></select></div>' +
      '<div class="form-group"><label class="form-label">Topic name</label><input type="text" class="form-input" data-field="name" placeholder="Topic name"></div>' +
      '<div class="form-group"><label class="form-label">Points (Score out of)</label><input type="number" class="form-input" data-field="score" min="0" step="0.01" placeholder="Optional"><p class="form-hint">If a similar gradebook item already exists, deploy will ask whether to skip ScoreOutOf to avoid a duplicate.</p></div>' +
      '<div class="form-group"><label class="form-label">Due date</label><input type="datetime-local" class="form-input" data-field="due"></div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Description / prompt</label><textarea class="form-textarea" data-field="description" rows="2" placeholder="Optional topic prompt"></textarea></div>' +
      '<div class="cpd-assignment-options">' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="mustPost"> Must post to participate</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="allowAnonymous"> Allow anonymous</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="requiresApproval"> Requires approval</label>' +
      '<label class="cpd-check-label"><input type="checkbox" data-field="hidden"> Hidden</label>' +
      '<button type="button" class="form-button form-button-secondary cpd-remove-topic">Remove topic</button>' +
      "</div>";
    card.querySelector("[data-field='name']").value = data.name || "";
    card.querySelector("[data-field='description']").value = data.description || "";
    card.querySelector("[data-field='score']").value =
      data.score != null && data.score !== "" ? data.score : "";
    card.querySelector("[data-field='due']").value = data.due || "";
    card.querySelector("[data-field='mustPost']").checked = !!data.mustPost;
    card.querySelector("[data-field='allowAnonymous']").checked = !!data.allowAnonymous;
    card.querySelector("[data-field='requiresApproval']").checked = !!data.requiresApproval;
    card.querySelector("[data-field='hidden']").checked = !!data.hidden;
    card.querySelector(".cpd-remove-topic").addEventListener("click", function () {
      card.remove();
      updateDiscussionEmpty();
    });
    container.appendChild(card);
    refreshForumSelects();
    if (data.forumKey) card.querySelector("[data-field='forumKey']").value = data.forumKey;
  }

  function readTopics() {
    var cards = document.querySelectorAll("#cpdTopicRows .cpd-topic-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = (card.querySelector("[data-field='name']").value || "").trim();
      var forumKey = card.querySelector("[data-field='forumKey']").value || "";
      if (!name && !forumKey) continue;
      var scoreRaw = card.querySelector("[data-field='score']").value;
      out.push({
        forumKey: forumKey,
        name: name,
        description: (card.querySelector("[data-field='description']").value || "").trim(),
        score: scoreRaw === "" ? null : parseFloat(scoreRaw),
        due: card.querySelector("[data-field='due']").value || "",
        mustPost: card.querySelector("[data-field='mustPost']").checked,
        allowAnonymous: card.querySelector("[data-field='allowAnonymous']").checked,
        requiresApproval: card.querySelector("[data-field='requiresApproval']").checked,
        hidden: card.querySelector("[data-field='hidden']").checked
      });
    }
    return out;
  }

  function parseDiscussionCsvText(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) rows.push(splitCsvLine(line));
    }
    if (!rows.length) throw new Error("CSV file is empty.");
    var header = rows[0].map(function (h) {
      return String(h || "").trim().toLowerCase().replace(/\s+/g, "");
    });
    var forumIdx = indexOfAny(header, ["forum", "forumname", "category"]);
    var topicIdx = indexOfAny(header, ["topic", "topicname", "name", "title"]);
    var descIdx = indexOfAny(header, ["description", "prompt", "instructions"]);
    var scoreIdx = indexOfAny(header, ["scoreoutof", "points", "score", "maxpoints"]);
    var mustIdx = indexOfAny(header, ["mustposttoparticipate", "mustpost"]);
    var anonIdx = indexOfAny(header, ["allowanonymous", "anonymous"]);
    var approvalIdx = indexOfAny(header, ["requiresapproval", "approval"]);
    var dueIdx = indexOfAny(header, ["duedate", "due"]);
    var hiddenIdx = indexOfAny(header, ["hidden", "ishidden"]);
    var start = 0;
    if (forumIdx >= 0 || topicIdx >= 0) start = 1;
    else {
      forumIdx = 0; topicIdx = 1; descIdx = 2; scoreIdx = 3; mustIdx = 4; anonIdx = 5; approvalIdx = 6; dueIdx = 7; hiddenIdx = 8; start = 0;
    }
    if (forumIdx < 0) forumIdx = 0;
    if (topicIdx < 0) topicIdx = 1;
    var items = [];
    for (var r = start; r < rows.length; r++) {
      var cols = rows[r];
      var forum = (cols[forumIdx] || "").trim();
      var topic = (cols[topicIdx] || "").trim();
      if (!forum || !topic) continue;
      var scoreRaw = scoreIdx >= 0 ? cols[scoreIdx] : "";
      var score = scoreRaw != null && String(scoreRaw).trim() !== "" ? parseFloat(scoreRaw) : null;
      items.push({
        forum: forum,
        topic: topic,
        description: descIdx >= 0 ? (cols[descIdx] || "").trim() : "",
        score: score != null && !isNaN(score) ? score : null,
        mustPost: mustIdx >= 0 ? parseBoolLoose(cols[mustIdx], false) : false,
        allowAnonymous: anonIdx >= 0 ? parseBoolLoose(cols[anonIdx], false) : false,
        requiresApproval: approvalIdx >= 0 ? parseBoolLoose(cols[approvalIdx], false) : false,
        due: dueIdx >= 0 ? normalizeDueDateLocal(cols[dueIdx]) : "",
        hidden: hiddenIdx >= 0 ? parseBoolLoose(cols[hiddenIdx], false) : false
      });
    }
    if (!items.length) throw new Error("No discussion topics found in the CSV.");
    return items;
  }

  async function handleDiscussionCsvUpload(file) {
    var status = $("cpdDiscussionCsvStatus");
    if (!file) {
      if (status) { status.hidden = true; status.textContent = ""; }
      return;
    }
    var items = parseDiscussionCsvText(await file.text());
    $("cpdForumRows").innerHTML = "";
    $("cpdTopicRows").innerHTML = "";
    forumSeq = 1;
    for (var i = 0; i < items.length; i++) {
      var forumKey = ensureForumByName(items[i].forum, "");
      addTopicRow({
        forumKey: forumKey,
        name: items[i].topic,
        description: items[i].description,
        score: items[i].score,
        due: items[i].due,
        mustPost: items[i].mustPost,
        allowAnonymous: items[i].allowAnonymous,
        requiresApproval: items[i].requiresApproval,
        hidden: items[i].hidden
      });
    }
    if (status) {
      status.hidden = false;
      status.textContent = "Loaded " + items.length + " topic(s) from " + file.name;
    }
    setDiscussionEntryMode("manual");
    refreshForumSelects();
  }

  async function createDiscussionForum(orgUnitId, forum) {
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/discussions/forums/",
      {
        Name: forum.name,
        Description: { Text: forum.description || "", Html: null },
        ShowDescriptionInTopics: !!forum.description,
        StartDate: null,
        EndDate: null,
        PostStartDate: null,
        PostEndDate: null,
        AllowAnonymous: !!forum.allowAnonymous,
        IsLocked: !!forum.locked,
        IsHidden: !!forum.hidden,
        RequiresApproval: false,
        MustPostToParticipate: !!forum.mustPost,
        DisplayInCalendar: false,
        DisplayPostDatesInCalendar: false,
        StartDateAvailabilityType: null,
        EndDateAvailabilityType: null
      }
    );
  }

  async function createDiscussionTopic(orgUnitId, forumId, topic) {
    var dueUtc = localDateTimeToUtc(topic.due);
    var score =
      topic.forceUngraded
        ? null
        : topic.score != null && !isNaN(topic.score)
          ? topic.score
          : null;
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" +
        API_VERSION_LE +
        "/" +
        encodeURIComponent(orgUnitId) +
        "/discussions/forums/" +
        encodeURIComponent(forumId) +
        "/topics/",
      {
        Name: topic.name,
        Description: { Content: topic.description || "", Type: "Text" },
        AllowAnonymousPosts: !!topic.allowAnonymous,
        StartDate: null,
        EndDate: null,
        IsHidden: !!topic.hidden,
        UnlockStartDate: null,
        UnlockEndDate: null,
        RequiresApproval: !!topic.requiresApproval,
        ScoreOutOf: score,
        IsAutoScore: score != null,
        IncludeNonScoredValues: false,
        ScoringType: score != null ? "0" : null,
        IsLocked: false,
        MustPostToParticipate: !!topic.mustPost,
        RatingType: null,
        DisplayInCalendar: false,
        DisplayUnlockDatesInCalendar: false,
        GroupTypeId: null,
        StartDateAvailabilityType: null,
        EndDateAvailabilityType: null,
        DueDate: dueUtc
      }
    );
  }



  // ---- Content modules (Phase 4) ----

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toDateInputValue(date) {
    if (!date || isNaN(date.getTime())) return "";
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseDateInput(value) {
    if (!value) return null;
    var parts = String(value).split("-");
    if (parts.length !== 3) return null;
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(date, days) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatDateLabel(date) {
    try {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return toDateInputValue(date);
    }
  }

  function formatDateRangeLabel(start, end) {
    return formatDateLabel(start) + " – " + formatDateLabel(end);
  }

  function dateToUtcStartIso(date) {
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();
  }

  function dateToUtcEndIso(date) {
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0, 0).toISOString();
  }

  function updateModuleEmpty() {
    var empty = $("cpdModuleEmpty");
    if (!empty) return;
    empty.hidden = document.querySelectorAll("#cpdModuleRows .cpd-module-row").length > 0;
  }

  function readContentModules() {
    var rows = document.querySelectorAll("#cpdModuleRows .cpd-module-row");
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var title = (row.querySelector("[data-field='title']").value || "").trim();
      if (!title) continue;
      out.push({
        title: title,
        start: row.querySelector("[data-field='start']").value || "",
        end: row.querySelector("[data-field='end']").value || ""
      });
    }
    return out;
  }

  function addModuleRow(data) {
    var container = $("cpdModuleRows");
    if (!container) return;
    data = data || {};
    var row = document.createElement("div");
    row.className = "cpd-module-row";
    row.innerHTML =
      '<input type="text" class="form-input" data-field="title" placeholder="Module title" aria-label="Module title">' +
      '<input type="date" class="form-input" data-field="start" aria-label="Module start date">' +
      '<input type="date" class="form-input" data-field="end" aria-label="Module end date">' +
      '<button type="button" class="cpd-remove-btn" aria-label="Remove module"><i class="fas fa-trash" aria-hidden="true"></i></button>';
    row.querySelector("[data-field='title']").value = data.title || "";
    row.querySelector("[data-field='start']").value = data.start || "";
    row.querySelector("[data-field='end']").value = data.end || "";
    row.querySelector(".cpd-remove-btn").addEventListener("click", function () {
      row.remove();
      updateModuleEmpty();
    });
    container.appendChild(row);
    updateModuleEmpty();
  }

  function generateContentModules() {
    var count = parseInt(($("cpdModuleCount") && $("cpdModuleCount").value) || "0", 10);
    if (isNaN(count) || count < 0) count = 0;
    if (count > 52) count = 52;
    var naming = ($("cpdModuleNaming") && $("cpdModuleNaming").value) || "week";
    var lengthDays = parseInt(($("cpdModuleLengthDays") && $("cpdModuleLengthDays").value) || "7", 10);
    if (isNaN(lengthDays) || lengthDays < 1) lengthDays = 7;
    var applyDates = $("cpdModuleApplyDates") && $("cpdModuleApplyDates").checked;
    var start = parseDateInput($("cpdModuleStartDate") && $("cpdModuleStartDate").value);

    if (naming === "date" && !start) {
      setMessage("Choose a course / module start date for date-based module names.", "error");
      return;
    }
    if (applyDates && !start) {
      setMessage("Choose a start date before applying module dates.", "error");
      return;
    }

    var existing = readContentModules();
    $("cpdModuleRows").innerHTML = "";

    for (var i = 0; i < count; i++) {
      var moduleStart = start ? addDays(start, i * lengthDays) : null;
      var moduleEnd = moduleStart ? addDays(moduleStart, lengthDays - 1) : null;
      var title = "";
      if (naming === "week") title = "Week " + (i + 1);
      else if (naming === "module") title = "Module " + (i + 1);
      else if (naming === "date" && moduleStart && moduleEnd) title = formatDateRangeLabel(moduleStart, moduleEnd);
      else if (naming === "custom" && existing[i] && existing[i].title) title = existing[i].title;
      else title = "Module " + (i + 1);

      addModuleRow({
        title: title,
        start: applyDates && moduleStart ? toDateInputValue(moduleStart) : "",
        end: applyDates && moduleEnd ? toDateInputValue(moduleEnd) : ""
      });
    }
    updateModuleEmpty();
    if (count === 0) setMessage("", null);
  }

  async function createContentModule(orgUnitId, moduleData, hidden) {
    var start = parseDateInput(moduleData.start);
    var end = parseDateInput(moduleData.end);
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/content/root/",
      {
        Title: moduleData.title,
        ShortTitle: null,
        Type: 0,
        ModuleStartDate: start ? dateToUtcStartIso(start) : null,
        ModuleEndDate: end ? dateToUtcEndIso(end) : null,
        ModuleDueDate: null,
        IsHidden: !!hidden,
        IsLocked: false,
        Description: { Content: "", Type: "Text" }
      }
    );
  }


  // ---- Announcement ----

  function instructorDisplayName() {
    var d = state.instructor.displayName;
    if (d && d !== "your instructor") return d;
    var joined = ((state.instructor.firstName || "") + " " + (state.instructor.lastName || "")).trim();
    return joined || "your instructor";
  }

  function buildAnnouncementText(opts) {
    opts = opts || {};
    var course = getSelectedCourse();
    var courseName = course ? course.Name : "[Course Name]";
    var semCode = course ? course.SemesterCode : "";
    var semester =
      course && course.IsSandbox ? "this term" : semesterLabelForCode(semCode) || "this semester";
    var officeHours = ($("cpdOfficeHours").value || "").trim();
    var instructor = instructorDisplayName();
    var syllabusLine = "";
    if (opts.syllabusUrl) {
      syllabusLine = "Please review the syllabus here: " + opts.syllabusUrl + "\n\n";
    } else if (state.syllabusFile) {
      syllabusLine = "Please review the syllabus in the Course Information module in Content.\n\n";
    } else {
      syllabusLine = "Please read the syllabus carefully once it is posted.\n\n";
    }
    var officeHoursBlock = officeHours
      ? "Office hours: " + officeHours + "\n\n"
      : "";
    return (
      "Welcome to " +
      courseName +
      "!\n\nHello everyone,\n\nI'm " +
      instructor +
      ", and I'm looking forward to working with you " +
      (course && course.IsSandbox ? "in this sandbox course" : "this " + semester) +
      ".\n\n" +
      syllabusLine +
      "This week, please:\n" +
      "- Read the syllabus thoroughly and note key policies, due dates, and expectations\n" +
      "- Review the first-week materials in Content\n" +
      "- Check Brightspace regularly for announcements and updates\n\n" +
      officeHoursBlock +
      "If you have questions, reach out early — I'm here to help you succeed.\n\nLooking forward to a great term,\n" +
      instructor
    );
  }

  function refreshAnnouncement(force) {
    if (state.announcementTouched && !force) return;
    var body = $("cpdAnnouncementBody");
    var title = $("cpdAnnouncementTitle");
    var course = getSelectedCourse();
    if (title && course && !state.announcementTouched) {
      title.value = "Welcome to " + course.Name + "!";
    }
    if (body) body.value = buildAnnouncementText();
    state.announcementTouched = false;
  }

  // ---- Validation ----

  function validateBeforeDeploy() {
    if (!getSelectedCourse()) return "Select a course offering.";
    if (!($("cpdAnnouncementTitle").value || "").trim()) return "Enter a welcome announcement title.";
    if (!($("cpdAnnouncementBody").value || "").trim()) return "Enter a welcome announcement body.";

    var cats = readCategories();
    var items = readManualGradeItems();
    var assignments = readAssignments();
    var quizzes = readQuizzes();
    var forums = readForums();
    var topics = readTopics();
    var contentModules = readContentModules();
    var privateBoards = $("cpdPrivateBoards") && $("cpdPrivateBoards").checked;

    if (
      !items.length &&
      !assignments.length &&
      !quizzes.length &&
      !forums.length &&
      !topics.length &&
      !privateBoards &&
      !contentModules.length &&
      !state.syllabusFile
    ) {
      return "Add at least one grade item, assignment, quiz, discussion, content module, private boards option, or syllabus before deploying.";
    }

    for (var c = 0; c < cats.length; c++) {
      if (!cats[c].name) return "Every category needs a name.";
      if (isWeighted() && !cats[c].exclude && (cats[c].weight == null || isNaN(cats[c].weight))) {
        return 'Category "' + cats[c].name + '" needs a weight percent.';
      }
    }

    if (isWeighted() && cats.length) {
      var catSum = 0;
      for (var cw = 0; cw < cats.length; cw++) {
        if (!cats[cw].exclude) catSum += Number(cats[cw].weight) || 0;
      }
      if (Math.abs(catSum - 100) > 0.5) {
        return "Category weights currently total " + Math.round(catSum * 100) / 100 + "%. Adjust to 100%.";
      }
    }

    for (var i = 0; i < items.length; i++) {
      if (!items[i].name) return "Every grade item needs a name.";
      if (items[i].points == null || items[i].points <= 0) {
        return 'Grade item "' + items[i].name + '" needs points greater than 0.';
      }
    }

    for (var a = 0; a < assignments.length; a++) {
      if (!assignments[a].name) return "Every assignment needs a name.";
      if (assignments[a].points == null || assignments[a].points <= 0) {
        return 'Assignment "' + assignments[a].name + '" needs points greater than 0.';
      }
      if (assignments[a].calendar && !assignments[a].due) {
        return 'Assignment "' + assignments[a].name + '" needs a due date to show in the calendar.';
      }
    }

    for (var q = 0; q < quizzes.length; q++) {
      if (!quizzes[q].name) return "Every quiz needs a name.";
      if (quizzes[q].points == null || quizzes[q].points <= 0) {
        return 'Quiz "' + quizzes[q].name + '" needs points greater than 0.';
      }
      if (quizzes[q].calendar && !quizzes[q].due && !quizzes[q].start && !quizzes[q].end) {
        return (
          'Quiz "' +
          quizzes[q].name +
          '" needs a due, start, or end date to show in the calendar.'
        );
      }
      if (quizzes[q].timeLimit != null && (quizzes[q].timeLimit < 0 || quizzes[q].timeLimit > 9999)) {
        return 'Quiz "' + quizzes[q].name + '" time limit must be between 0 and 9999 minutes.';
      }
      if (
        quizzes[q].attempts != null &&
        (quizzes[q].attempts < 1 || quizzes[q].attempts > 10)
      ) {
        return 'Quiz "' + quizzes[q].name + '" attempts must be 1–10 or unlimited.';
      }
      if (quizzes[q].start && quizzes[q].end) {
        var qs = new Date(quizzes[q].start).getTime();
        var qe = new Date(quizzes[q].end).getTime();
        if (!isNaN(qs) && !isNaN(qe) && qs > qe) {
          return 'Quiz "' + quizzes[q].name + '" start date cannot be after end date.';
        }
      }
      if (quizzes[q].due && quizzes[q].end) {
        var qd = new Date(quizzes[q].due).getTime();
        var qend = new Date(quizzes[q].end).getTime();
        if (!isNaN(qd) && !isNaN(qend) && qd > qend) {
          return 'Quiz "' + quizzes[q].name + '" due date cannot be after end date.';
        }
      }
    }

    for (var f = 0; f < forums.length; f++) {
      if (!forums[f].name) return "Every discussion forum needs a name.";
      if (forums[f].allowAnonymous && forums[f].mustPost) {
        return 'Forum "' + forums[f].name + '" cannot allow anonymous posts and require posting to participate.';
      }
    }
    for (var t = 0; t < topics.length; t++) {
      if (!topics[t].name) return "Every discussion topic needs a name.";
      if (!topics[t].forumKey) return 'Topic "' + topics[t].name + '" needs a forum.';
      if (topics[t].allowAnonymous && topics[t].mustPost) {
        return 'Topic "' + topics[t].name + '" cannot allow anonymous posts and require posting to participate.';
      }
    }

    for (var m = 0; m < contentModules.length; m++) {
      if (!contentModules[m].title) return "Every content module needs a title.";
    }

    return null;
  }

  // ---- Deploy helpers ----

  async function getExistingGradeItems(orgUnitId) {
    try {
      var data = await BrightspaceFetch(
        "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/"
      );
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  async function putGradeSetup(orgUnitId) {
    var setupUrl =
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/setup/";
    var current = null;
    try {
      current = await BrightspaceFetch(setupUrl);
    } catch (e) {
      appendLog("Grade setup read skipped: " + e.message);
      return null;
    }
    var schemeSelect = $("cpdGradeSchemeSelect");
    var schemeId = schemeSelect && schemeSelect.value ? parseInt(schemeSelect.value, 10) : null;
    var payload = {
      GradingSystem: getScheme(),
      IsNullGradeZero: !!$("cpdNullAsZero").checked,
      DefaultGradeSchemeId:
        schemeId != null && !isNaN(schemeId)
          ? schemeId
          : current && current.DefaultGradeSchemeId != null
            ? current.DefaultGradeSchemeId
            : null
    };
    try {
      var updated = await BrightspaceJson("PUT", setupUrl, payload);
      appendLog(
        "Grade setup: " +
          payload.GradingSystem +
          ", null-as-zero=" +
          payload.IsNullGradeZero +
          "."
      );
      return updated;
    } catch (e) {
      appendLog("Could not update grade setup: " + e.message);
      return null;
    }
  }

  async function createCategory(orgUnitId, cat) {
    var payload = {
      Name: cat.name,
      ShortName: shortNameFrom(cat.name),
      CanExceedMax: !!cat.canExceed,
      ExcludeFromFinalGrade: !!cat.exclude,
      StartDate: null,
      EndDate: null,
      Weight: isWeighted() ? cat.weight : null,
      MaxPoints: null,
      AutoPoints: false,
      WeightDistributionType: cat.dist === "even" ? 1 : 0,
      NumberOfHighestToDrop: cat.dropHigh || 0,
      NumberOfLowestToDrop: cat.dropLow || 0
    };
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/categories/",
      payload
    );
  }

  // ---- Grade link conflict resolution ----

  function normalizeGradeName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenSet(normalized) {
    var parts = normalized.split(" ").filter(Boolean);
    var set = {};
    for (var i = 0; i < parts.length; i++) set[parts[i]] = true;
    return set;
  }

  function namesMatchClosely(a, b) {
    var na = normalizeGradeName(a);
    var nb = normalizeGradeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 4 && nb.length >= 4 && (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) {
      return true;
    }

    var ta = tokenSet(na);
    var tb = tokenSet(nb);
    var keysA = Object.keys(ta);
    var keysB = Object.keys(tb);
    if (!keysA.length || !keysB.length) return false;
    var overlap = 0;
    for (var i = 0; i < keysA.length; i++) {
      if (tb[keysA[i]]) overlap++;
    }
    var union = keysA.length + keysB.length - overlap;
    var ratio = union ? overlap / union : 0;
    return ratio >= 0.75 || (overlap >= 2 && ratio >= 0.5);
  }

  function findCloseGradeMatch(name, gradeItems, usedIndexes) {
    usedIndexes = usedIndexes || {};
    var exact = null;
    var close = null;
    for (var i = 0; i < gradeItems.length; i++) {
      if (usedIndexes[i]) continue;
      var itemName = gradeItems[i].name || "";
      if (normalizeGradeName(name) === normalizeGradeName(itemName)) {
        exact = { index: i, name: itemName, points: gradeItems[i].points };
        break;
      }
      if (!close && namesMatchClosely(name, itemName)) {
        close = { index: i, name: itemName, points: gradeItems[i].points };
      }
    }
    return exact || close;
  }

  /**
   * Prompt once per name conflict before deploy.
   * Assignment / Quiz: OK = link existing grade item; Cancel = create a new one.
   * Discussion with ScoreOutOf: OK = create topic without ScoreOutOf (keeps gradebook item);
   *   Cancel = create graded topic (Brightspace may add another grade item).
   */
  function resolveGradeLinkConflicts(gradeItems, assignments, topics, quizzes) {
    var usedForAssignments = {};
    var usedForTopics = {};
    var usedForQuizzes = {};
    var assignmentResolutions = {};
    var topicResolutions = {};
    var quizResolutions = {};
    quizzes = quizzes || [];

    for (var a = 0; a < assignments.length; a++) {
      var asn = assignments[a];
      if (!asn.linkGrade) {
        assignmentResolutions[a] = { action: "none" };
        continue;
      }
      var match = findCloseGradeMatch(asn.name, gradeItems, usedForAssignments);
      if (!match) {
        assignmentResolutions[a] = { action: "create" };
        continue;
      }
      var linkExisting = window.confirm(
        "Possible duplicate grade item\n\n" +
          'Assignment: "' +
          asn.name +
          '"\n' +
          'Matching gradebook item: "' +
          match.name +
          '"' +
          (match.points != null ? " (" + match.points + " pts)" : "") +
          "\n\n" +
          "OK = Link this assignment to the existing grade item (recommended)\n" +
          "Cancel = Create a separate new grade item"
      );
      if (linkExisting) {
        usedForAssignments[match.index] = true;
        assignmentResolutions[a] = {
          action: "link",
          gradeIndex: match.index,
          gradeName: match.name
        };
      } else {
        assignmentResolutions[a] = { action: "create" };
      }
    }

    for (var q = 0; q < quizzes.length; q++) {
      var quiz = quizzes[q];
      if (!quiz.linkGrade) {
        quizResolutions[q] = { action: "none" };
        continue;
      }
      var qMatch = findCloseGradeMatch(quiz.name, gradeItems, usedForQuizzes);
      if (!qMatch) {
        quizResolutions[q] = { action: "create" };
        continue;
      }
      var linkQuizExisting = window.confirm(
        "Possible duplicate grade item\n\n" +
          'Quiz: "' +
          quiz.name +
          '"\n' +
          'Matching gradebook item: "' +
          qMatch.name +
          '"' +
          (qMatch.points != null ? " (" + qMatch.points + " pts)" : "") +
          "\n\n" +
          "OK = Link this quiz to the existing grade item (recommended)\n" +
          "Cancel = Create a separate new grade item"
      );
      if (linkQuizExisting) {
        usedForQuizzes[qMatch.index] = true;
        quizResolutions[q] = {
          action: "link",
          gradeIndex: qMatch.index,
          gradeName: qMatch.name
        };
      } else {
        quizResolutions[q] = { action: "create" };
      }
    }

    for (var t = 0; t < topics.length; t++) {
      var topic = topics[t];
      if (topic.score == null || isNaN(topic.score)) {
        topicResolutions[t] = { action: "none" };
        continue;
      }
      var tMatch = findCloseGradeMatch(topic.name, gradeItems, usedForTopics);
      if (!tMatch) {
        topicResolutions[t] = { action: "score" };
        continue;
      }
      var keepExisting = window.confirm(
        "Possible duplicate grade item\n\n" +
          'Discussion topic: "' +
          topic.name +
          '" (Score out of ' +
          topic.score +
          ")\n" +
          'Matching gradebook item: "' +
          tMatch.name +
          '"' +
          (tMatch.points != null ? " (" + tMatch.points + " pts)" : "") +
          "\n\n" +
          "OK = Keep the existing gradebook item and create this topic without ScoreOutOf (avoids a duplicate)\n" +
          "Cancel = Create a graded topic with ScoreOutOf (Brightspace may add another grade item)"
      );
      if (keepExisting) {
        usedForTopics[tMatch.index] = true;
        topicResolutions[t] = {
          action: "unscored",
          gradeIndex: tMatch.index,
          gradeName: tMatch.name
        };
      } else {
        topicResolutions[t] = { action: "score" };
      }
    }

    return {
      assignments: assignmentResolutions,
      topics: topicResolutions,
      quizzes: quizResolutions
    };
  }

  async function createGradeItem(orgUnitId, item, categoryId) {
    var payload = {
      MaxPoints: item.points,
      CanExceedMaxPoints: !!item.canExceed,
      IsBonus: !!item.bonus,
      ExcludeFromFinalGradeCalculation: !!item.exclude,
      GradeSchemeId: null,
      Name: item.name,
      ShortName: shortNameFrom(item.name),
      GradeType: "Numeric",
      CategoryId: categoryId != null ? categoryId : null,
      Description: { Content: "", Type: "Text" },
      AssociatedTool: null,
      IsHidden: false
    };
    if (isWeighted() && item.weight != null && (categoryId == null || categoryId === 0)) {
      payload.Weight = item.weight;
    } else if (isWeighted() && item.weight != null) {
      // Item weight inside a non-even category
      payload.Weight = item.weight;
    }
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/grades/",
      payload
    );
  }

  async function createAssignment(orgUnitId, assignment, gradeItemId) {
    var dueUtc = localDateTimeToUtc(assignment.due);
    var payload = {
      CategoryId: null,
      Name: assignment.name,
      CustomInstructions: {
        Content: assignment.instructions || "",
        Type: "Text"
      },
      Availability: null,
      GroupTypeId: null,
      DueDate: dueUtc,
      DisplayInCalendar: !!assignment.calendar && !!dueUtc,
      NotificationEmail: null,
      IsHidden: !!assignment.hidden,
      Assessment: { ScoreDenominator: assignment.points },
      IsAnonymous: false,
      DropboxType: 2,
      SubmissionType: assignment.submissionType,
      CompletionType: assignment.completionType,
      GradeItemId: gradeItemId != null ? gradeItemId : null,
      AllowOnlyUsersWithSpecialAccess: false
    };
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/dropbox/folders/",
      payload
    );
  }

  async function listQuizCategories(orgUnitId) {
    try {
      var data = await BrightspaceFetch(
        "/d2l/api/le/" +
          API_VERSION_LE +
          "/" +
          encodeURIComponent(orgUnitId) +
          "/quizzes/categories/"
      );
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.Objects)) return data.Objects;
      return [];
    } catch (e) {
      appendLog("Could not load quiz categories: " + e.message);
      return [];
    }
  }

  async function createQuizCategory(orgUnitId, name, sortOrder) {
    return BrightspaceJson(
      "POST",
      "/d2l/api/le/" +
        API_VERSION_LE +
        "/" +
        encodeURIComponent(orgUnitId) +
        "/quizzes/categories/",
      {
        Name: name,
        SortOrder: sortOrder != null ? sortOrder : 1
      }
    );
  }

  async function ensureQuizCategoryId(orgUnitId, name, cache) {
    if (!name) return { id: null, created: false };
    var key = String(name).toLowerCase();
    if (cache[key] != null) return { id: cache[key], created: false };

    if (!cache.__loaded) {
      var existing = await listQuizCategories(orgUnitId);
      var maxSort = 0;
      for (var i = 0; i < existing.length; i++) {
        var existingName = existing[i].Name || "";
        var existingId = existing[i].CategoryId != null ? existing[i].CategoryId : existing[i].Id;
        if (existingName && existingId != null) {
          cache[String(existingName).toLowerCase()] = existingId;
        }
        if (typeof existing[i].SortOrder === "number" && existing[i].SortOrder > maxSort) {
          maxSort = existing[i].SortOrder;
        }
      }
      cache.__nextSort = maxSort + 1;
      cache.__loaded = true;
      if (cache[key] != null) return { id: cache[key], created: false };
    }

    var sortOrder = cache.__nextSort || 1;
    cache.__nextSort = sortOrder + 1;
    var created = await createQuizCategory(orgUnitId, name, sortOrder);
    var newId = created && (created.CategoryId != null ? created.CategoryId : created.Id);
    if (newId == null) throw new Error('Quiz category "' + name + '" was created but no ID was returned.');
    cache[key] = newId;
    appendLog("Created quiz category: " + name);
    return { id: newId, created: true };
  }

  /**
   * Build Quiz.QuizData for POST create.
   * Field set mirrors due-date-wizard buildQuizUpdateBody — verified to bind on
   * this tenant for PUT. Omitting SortOrder / Password / NotificationEmail /
   * DeductionPercentage causes a generic JSON Binding Error here.
   */
  function buildQuizCreateBody(quiz, gradeItemId, quizCategoryId, options) {
    options = options || {};
    var dueUtc = localDateTimeToUtc(quiz.due);
    var startUtc = localDateTimeToUtc(quiz.start);
    var endUtc = localDateTimeToUtc(quiz.end);
    if (dueUtc && endUtc) {
      var dueMs = new Date(dueUtc).getTime();
      var endMs = new Date(endUtc).getTime();
      if (!isNaN(dueMs) && !isNaN(endMs) && dueMs > endMs) endUtc = dueUtc;
    }
    // Brightspace rejects DisplayInCalendar when neither StartDate nor EndDate
    // is set ("Cannot have schedule association without having either a Start
    // Date or End Date."). If the instructor asked for calendar + due only,
    // use DueDate as EndDate so the item can appear on the schedule.
    if (quiz.calendar && dueUtc && !startUtc && !endUtc) {
      endUtc = dueUtc;
    }
    var timeLimit = quiz.timeLimit > 0 ? Number(quiz.timeLimit) : 0;
    if (isNaN(timeLimit) || timeLimit < 0) timeLimit = 0;
    if (timeLimit > 9999) timeLimit = 9999;
    var enforce = timeLimit > 0;

    var gradeId =
      gradeItemId != null && gradeItemId !== "" ? Number(gradeItemId) : null;
    if (gradeId != null && isNaN(gradeId)) gradeId = null;
    var catId =
      quizCategoryId != null && quizCategoryId !== "" ? Number(quizCategoryId) : null;
    if (catId != null && isNaN(catId)) catId = null;
    if (options.omitCategory) catId = null;
    if (options.omitGradeLink) gradeId = null;

    var attempts =
      quiz.attempts == null || quiz.attempts === "" ? null : Number(quiz.attempts);
    if (attempts != null && (isNaN(attempts) || attempts < 1 || attempts > 10)) {
      attempts = 1;
    }

    var canShowInCalendar = !!quiz.calendar && (!!startUtc || !!endUtc);

    var body = {
      Name: String(quiz.name || "").trim(),
      IsActive: !quiz.hidden,
      SortOrder: 1,
      AutoExportToGrades: gradeId != null,
      GradeItemId: gradeId,
      IsAutoSetGraded: true,
      Instructions: quizRtCreate(quiz.instructions || "", !!quiz.instructions),
      Description: quizRtCreate("", false),
      Header: quizRtCreate("", false),
      Footer: quizRtCreate("", false),
      StartDate: startUtc,
      EndDate: endUtc,
      DueDate: dueUtc,
      DisplayInCalendar: canShowInCalendar,
      NumberOfAttemptsAllowed: attempts,
      LateSubmissionInfo: {
        LateSubmissionOption: 0,
        LateLimitMinutes: null
      },
      SubmissionTimeLimit: {
        IsEnforced: enforce,
        ShowClock: enforce,
        TimeLimitValue: timeLimit
      },
      SubmissionGracePeriod: 0,
      Password: null,
      AllowHints: false,
      DisableRightClick: false,
      DisablePagerAndAlerts: false,
      NotificationEmail: null,
      CalcTypeId: 1,
      RestrictIPAddressRange: null,
      CategoryId: catId,
      PreventMovingBackwards: false,
      Shuffle: !!quiz.shuffle,
      AllowOnlyUsersWithSpecialAccess: false,
      IsRetakeIncorrectOnly: false,
      IsSynchronous: false,
      DeductionPercentage: null
    };

    // Version-gated extras — only attach when the LE version expects them.
    if (options.pagingTypeId !== undefined) {
      body.PagingTypeId = options.pagingTypeId;
    }
    if (options.includeSessionFields) {
      body.HideQuestionPoints = false;
      body.IsSingleSession = false;
    }

    return body;
  }

  async function createQuiz(orgUnitId, quiz, gradeItemId, quizCategoryId) {
    // Ordered by likelihood on this tenant:
    // 1.82 = create route "first appears"; 1.74 = due-date PUT verified;
    // 1.78 = brightspace-api default; 1.93 = deployer default (needs session fields).
    var attempts = [
      { le: "1.82", label: "1.82+paging", opts: { pagingTypeId: 0 } },
      { le: "1.74", label: "1.74-put-shape", opts: {} },
      { le: "1.78", label: "1.78+paging", opts: { pagingTypeId: 0 } },
      {
        le: "1.82",
        label: "1.82-no-grade",
        opts: { pagingTypeId: 0, omitGradeLink: true, omitCategory: true }
      },
      {
        le: API_VERSION_LE,
        label: "1.93+session",
        opts: { pagingTypeId: 0, includeSessionFields: true }
      },
      {
        le: API_VERSION_LE,
        label: "1.93-no-grade",
        opts: {
          pagingTypeId: 0,
          includeSessionFields: true,
          omitGradeLink: true,
          omitCategory: true
        }
      }
    ];

    var lastError = null;
    for (var i = 0; i < attempts.length; i++) {
      var cfg = attempts[i];
      var url =
        "/d2l/api/le/" +
        cfg.le +
        "/" +
        encodeURIComponent(orgUnitId) +
        "/quizzes/";
      var body = buildQuizCreateBody(quiz, gradeItemId, quizCategoryId, cfg.opts);
      try {
        var created = await BrightspaceJson("POST", url, body);
        if (i > 0) {
          appendLog(
            'Quiz "' + quiz.name + '" created with fallback (' + cfg.label + ")."
          );
        }
        if (
          created &&
          (created.QuizId != null || created.Id != null) &&
          (cfg.opts.omitCategory || cfg.opts.omitGradeLink)
        ) {
          try {
            await patchQuizAfterCreate(
              orgUnitId,
              created.QuizId != null ? created.QuizId : created.Id,
              quiz,
              cfg.opts.omitGradeLink ? gradeItemId : null,
              cfg.opts.omitCategory ? quizCategoryId : null,
              cfg.le
            );
          } catch (pe) {
            appendLog(
              'Quiz "' +
                quiz.name +
                '" created, but follow-up settings update failed: ' +
                pe.message
            );
          }
        }
        return created;
      } catch (e) {
        lastError = e;
        if (i === 0) {
          appendLog(
            'Quiz create "' +
              quiz.name +
              '" rejected; trying alternate LE versions/payloads…'
          );
          try {
            appendLog(
              "Quiz create diagnostic keys: " + Object.keys(body).join(", ")
            );
            appendLog(
              "Quiz create diagnostic sample: " +
                JSON.stringify(body).slice(0, 500)
            );
          } catch (diagErr) {
            /* ignore */
          }
        } else if (i === attempts.length - 1) {
          appendLog(
            "Quiz create last attempt (" +
              cfg.label +
              "): " +
              (e.message || "error").slice(0, 200)
          );
        }
      }
    }
    throw lastError || new Error("Could not create quiz.");
  }

  async function patchQuizAfterCreate(
    orgUnitId,
    quizId,
    quiz,
    gradeItemId,
    quizCategoryId,
    leVersion
  ) {
    var getUrl =
      "/d2l/api/le/" +
      (leVersion || "1.74") +
      "/" +
      encodeURIComponent(orgUnitId) +
      "/quizzes/" +
      encodeURIComponent(quizId);
    var orig = await BrightspaceFetch(getUrl);
    if (!orig) return null;

    var gradeId =
      gradeItemId != null && gradeItemId !== "" ? Number(gradeItemId) : orig.GradeItemId;
    if (gradeId != null && isNaN(gradeId)) gradeId = orig.GradeItemId;
    var catId =
      quizCategoryId != null && quizCategoryId !== ""
        ? Number(quizCategoryId)
        : orig.CategoryId;
    if (catId != null && isNaN(catId)) catId = orig.CategoryId;
    var autoExport = gradeId != null;

    // Same field set as due-date-wizard buildQuizUpdateBody
    var flatAttempts =
      orig.AttemptsAllowed && orig.AttemptsAllowed.IsUnlimited
        ? null
        : orig.AttemptsAllowed
          ? orig.AttemptsAllowed.NumberOfAttemptsAllowed
          : 1;

    var body = {
      Name: orig.Name,
      IsActive: !!orig.IsActive,
      SortOrder: orig.SortOrder != null ? orig.SortOrder : 1,
      AutoExportToGrades: autoExport,
      GradeItemId: gradeId != null ? gradeId : null,
      IsAutoSetGraded: !!orig.IsAutoSetGraded,
      Instructions: quizRtCreate(quiz.instructions || "", !!quiz.instructions),
      Description: quizRtCreate("", !!(orig.Description && orig.Description.IsDisplayed)),
      Header: quizRtCreate("", false),
      Footer: quizRtCreate("", false),
      StartDate: orig.StartDate,
      EndDate: orig.EndDate,
      DueDate: orig.DueDate,
      DisplayInCalendar: !!orig.DisplayInCalendar,
      NumberOfAttemptsAllowed: flatAttempts,
      LateSubmissionInfo: orig.LateSubmissionInfo || {
        LateSubmissionOption: 0,
        LateLimitMinutes: null
      },
      SubmissionTimeLimit: orig.SubmissionTimeLimit || {
        IsEnforced: false,
        ShowClock: false,
        TimeLimitValue: 0
      },
      SubmissionGracePeriod:
        typeof orig.SubmissionGracePeriod === "number" ? orig.SubmissionGracePeriod : 0,
      Password: orig.Password != null ? orig.Password : null,
      AllowHints: !!orig.AllowHints,
      DisableRightClick: !!orig.DisableRightClick,
      DisablePagerAndAlerts: !!orig.DisablePagerAndAlerts,
      NotificationEmail: orig.NotificationEmail != null ? orig.NotificationEmail : null,
      CalcTypeId: orig.CalcTypeId != null ? orig.CalcTypeId : 1,
      RestrictIPAddressRange:
        orig.RestrictIPAddressRange && orig.RestrictIPAddressRange.length
          ? orig.RestrictIPAddressRange
          : null,
      CategoryId: catId != null ? catId : null,
      PreventMovingBackwards: !!orig.PreventMovingBackwards,
      Shuffle: !!orig.Shuffle,
      AllowOnlyUsersWithSpecialAccess: !!orig.AllowOnlyUsersWithSpecialAccess,
      IsRetakeIncorrectOnly: !!orig.IsRetakeIncorrectOnly,
      IsSynchronous: !!orig.IsSynchronous,
      DeductionPercentage:
        orig.DeductionPercentage != null ? orig.DeductionPercentage : null
    };

    return BrightspaceJson("PUT", getUrl, body);
  }

  async function ensureCourseInfoModule(orgUnitId) {
    var roots = await BrightspaceFetch(
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/content/root/"
    );
    var list = Array.isArray(roots) ? roots : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].Title || "").toLowerCase() === COURSE_INFO_MODULE.toLowerCase()) {
        return list[i];
      }
    }
    var created = await BrightspaceJson(
      "POST",
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/content/root/",
      {
        Title: COURSE_INFO_MODULE,
        ShortTitle: "Info",
        Type: 0,
        ModuleStartDate: null,
        ModuleEndDate: null,
        ModuleDueDate: null,
        IsHidden: false,
        IsLocked: false,
        Description: { Content: "", Type: "Text" }
      }
    );
    appendLog('Created content module "' + COURSE_INFO_MODULE + '".');
    return created;
  }

  async function resolveContentPath(orgUnitId, moduleObj, fileName) {
    var safeName = String(fileName || "file.bin").replace(/[\\\/:*?"<>|]/g, "_");
    if (moduleObj && moduleObj.DefaultPath) {
      return String(moduleObj.DefaultPath).replace(/\/?$/, "/") + safeName;
    }
    try {
      var course = await BrightspaceFetch(
        "/d2l/api/lp/" + API_VERSION_LP + "/courses/" + encodeURIComponent(orgUnitId)
      );
      if (course && course.Path) return String(course.Path).replace(/\/?$/, "/") + safeName;
    } catch (e) {}
    return "/content/enforced/" + orgUnitId + "/" + safeName;
  }

  async function uploadContentFile(orgUnitId, moduleId, file, title) {
    var moduleObj = await BrightspaceFetch(
      "/d2l/api/le/" +
        API_VERSION_LE +
        "/" +
        encodeURIComponent(orgUnitId) +
        "/content/modules/" +
        encodeURIComponent(moduleId)
    );
    var topicData = {
      Title: title || file.name,
      ShortTitle: null,
      Type: 1,
      TopicType: 1,
      Url: await resolveContentPath(orgUnitId, moduleObj, file.name),
      StartDate: null,
      EndDate: null,
      DueDate: null,
      IsHidden: false,
      IsLocked: false,
      OpenAsExternalResource: null,
      Description: { Content: "", Type: "Text" }
    };
    return BrightspaceMultipart(
      "/d2l/api/le/" +
        API_VERSION_LE +
        "/" +
        encodeURIComponent(orgUnitId) +
        "/content/modules/" +
        encodeURIComponent(moduleId) +
        "/structure/?renameFileIfExists=true",
      topicData,
      file
    );
  }

  function syllabusViewUrl(orgUnitId, topicId) {
    if (!topicId) return null;
    return (
      window.location.origin +
      "/d2l/le/content/" +
      encodeURIComponent(orgUnitId) +
      "/viewContent/" +
      encodeURIComponent(topicId) +
      "/View"
    );
  }

  async function createAnnouncement(orgUnitId, title, bodyText) {
    var url =
      "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(orgUnitId) + "/news/";
    var startDate = utcNowForApi();
    var htmlBody = textToHtml(bodyText);
    var attempts = [
      {
        Title: title,
        Body: { Text: bodyText, Html: htmlBody },
        StartDate: startDate,
        EndDate: null,
        IsGlobal: false,
        IsPublished: true,
        ShowOnlyInCourseOfferings: false,
        IsAuthorInfoShown: false,
        IsPinned: false,
        IsStartDateShown: true,
        SortOrder: null
      },
      {
        Title: title,
        Body: { Text: bodyText, Html: null },
        StartDate: startDate,
        EndDate: null,
        IsGlobal: false,
        IsPublished: true,
        ShowOnlyInCourseOfferings: false,
        IsAuthorInfoShown: false,
        IsPinned: false,
        IsStartDateShown: true,
        SortOrder: 0
      }
    ];
    var lastError = null;
    for (var i = 0; i < attempts.length; i++) {
      try {
        return await BrightspaceMultipart(url, attempts[i], null);
      } catch (e) {
        lastError = e;
        appendLog("Announcement attempt " + (i + 1) + " failed: " + e.message);
      }
    }
    throw lastError || new Error("Could not create announcement.");
  }

  async function deploy() {
    if (state.running) return;
    var err = validateBeforeDeploy();
    if (err) {
      setMessage(err, "error");
      return;
    }

    var course = getSelectedCourse();
    var cats = readCategories();
    var items = readManualGradeItems();
    var assignments = readAssignments();
    var quizzes = readQuizzes();
    var forums = readForums();
    var topics = readTopics();
    var contentModules = readContentModules();
    var modulesHidden = $("cpdModuleHidden") && $("cpdModuleHidden").checked;
    var privateBoards = $("cpdPrivateBoards") && $("cpdPrivateBoards").checked;

    var gradeLinkPlan = resolveGradeLinkConflicts(items, assignments, topics, quizzes);

    var existing = await getExistingGradeItems(course.OrgUnitId);
    var existingNumeric = existing.filter(function (g) {
      var t = (g.GradeType || g.GradeObjectTypeName || "").toString();
      return t === "Numeric" || t === "1" || g.GradeObjectType === 1;
    });

    if (
      existingNumeric.length > 0 ||
      cats.length ||
      items.length ||
      assignments.length ||
      quizzes.length ||
      forums.length ||
      topics.length ||
      contentModules.length ||
      privateBoards ||
      state.courseBannerFile ||
      state.syllabusFile ||
      state.officeHoursFile
    ) {
      var ok = window.confirm(
        "Deploy to " +
          course.Name +
          "?\n\nThis will add grade setup" +
          (cats.length ? ", " + cats.length + " categor" + (cats.length === 1 ? "y" : "ies") : "") +
          (items.length ? ", " + items.length + " grade item(s)" : "") +
          (assignments.length ? ", " + assignments.length + " assignment(s)" : "") +
          (quizzes.length ? ", " + quizzes.length + " quiz shell(s)" : "") +
          (forums.length ? ", " + forums.length + " forum(s)" : "") +
          (topics.length ? ", " + topics.length + " topic(s)" : "") +
          (contentModules.length ? ", " + contentModules.length + " content module(s)" : "") +
          (privateBoards ? ", private student boards" : "") +
          (state.courseBannerFile ? ", course banner" : "") +
          (state.syllabusFile ? ", syllabus" : "") +
          ", and a welcome announcement.\nExisting items are not deleted."
      );
      if (!ok) return;
    }

    state.running = true;
    $("cpdDeployBtn").disabled = true;
    clearLog();
    setMessage("Deploying…", null);
    appendLog("Deploying to " + course.Code + " — " + course.Name);

    var results = {
      categories: 0,
      grades: 0,
      assignments: 0,
      quizzes: 0,
      quizCategories: 0,
      forums: 0,
      topics: 0,
      modules: 0,
      privateBoards: null,
      bannerUploaded: false,
      syllabusTopicId: null,
      announcementId: null,
      errors: []
    };
    var categoryIdByKey = {};
    var forumIdByKey = {};
    var quizCategoryIdCache = {};

    try {
      await putGradeSetup(course.OrgUnitId);
      await sleep(REQUEST_GAP_MS);

      if (state.courseBannerFile) {
        try {
          await uploadCourseBanner(course.OrgUnitId, state.courseBannerFile);
          results.bannerUploaded = true;
          appendLog("Uploaded course banner: " + (state.courseBannerFile.name || "image"));
          await sleep(REQUEST_GAP_MS);
        } catch (be) {
          results.errors.push("Course banner: " + be.message);
          appendLog("FAILED course banner: " + be.message);
        }
      }

      for (var c = 0; c < cats.length; c++) {
        try {
          var createdCat = await createCategory(course.OrgUnitId, cats[c]);
          if (createdCat && createdCat.Id != null) {
            categoryIdByKey[cats[c].key] = createdCat.Id;
            results.categories++;
            appendLog("Created category: " + cats[c].name);
          }
          await sleep(REQUEST_GAP_MS);
        } catch (ce) {
          results.errors.push('Category "' + cats[c].name + '": ' + ce.message);
          appendLog("FAILED category " + cats[c].name + ": " + ce.message);
        }
      }

      var gradeItemIdByIndex = {};
      for (var i = 0; i < items.length; i++) {
        try {
          var catId = items[i].categoryKey ? categoryIdByKey[items[i].categoryKey] : null;
          var createdGrade = await createGradeItem(course.OrgUnitId, items[i], catId || null);
          if (createdGrade && createdGrade.Id != null) {
            gradeItemIdByIndex[i] = createdGrade.Id;
          }
          results.grades++;
          appendLog("Created grade item: " + items[i].name);
          await sleep(REQUEST_GAP_MS);
        } catch (ge) {
          results.errors.push('Grade item "' + items[i].name + '": ' + ge.message);
          appendLog("FAILED grade item " + items[i].name + ": " + ge.message);
        }
      }

      for (var a = 0; a < assignments.length; a++) {
        var asn = assignments[a];
        try {
          var gradeItemId = null;
          var asnPlan = (gradeLinkPlan.assignments && gradeLinkPlan.assignments[a]) || null;
          if (asn.linkGrade) {
            if (asnPlan && asnPlan.action === "link" && asnPlan.gradeIndex != null) {
              gradeItemId = gradeItemIdByIndex[asnPlan.gradeIndex];
              if (gradeItemId == null) {
                throw new Error(
                  'Could not link to grade item "' +
                    (asnPlan.gradeName || items[asnPlan.gradeIndex].name) +
                    '" because that item failed to create.'
                );
              }
              appendLog(
                'Linking assignment "' +
                  asn.name +
                  '" to existing grade item "' +
                  (asnPlan.gradeName || items[asnPlan.gradeIndex].name) +
                  '".'
              );
            } else {
              var asnCatId = asn.categoryKey ? categoryIdByKey[asn.categoryKey] : null;
              var g = await createGradeItem(
                course.OrgUnitId,
                {
                  name: asn.name,
                  points: asn.points,
                  weight: null,
                  bonus: false,
                  exclude: false,
                  canExceed: false
                },
                asnCatId || null
              );
              gradeItemId = g && g.Id != null ? g.Id : null;
              results.grades++;
              appendLog("Created linked grade item: " + asn.name);
              await sleep(REQUEST_GAP_MS);
            }
          }
          await createAssignment(course.OrgUnitId, asn, gradeItemId);
          results.assignments++;
          appendLog("Created assignment: " + asn.name);
          await sleep(REQUEST_GAP_MS);
        } catch (ae) {
          results.errors.push('Assignment "' + asn.name + '": ' + ae.message);
          appendLog("FAILED assignment " + asn.name + ": " + ae.message);
        }
      }

      for (var qi = 0; qi < quizzes.length; qi++) {
        var quiz = quizzes[qi];
        try {
          var quizGradeItemId = null;
          var quizPlan = (gradeLinkPlan.quizzes && gradeLinkPlan.quizzes[qi]) || null;
          if (quiz.linkGrade) {
            if (quizPlan && quizPlan.action === "link" && quizPlan.gradeIndex != null) {
              quizGradeItemId = gradeItemIdByIndex[quizPlan.gradeIndex];
              if (quizGradeItemId == null) {
                throw new Error(
                  'Could not link to grade item "' +
                    (quizPlan.gradeName || items[quizPlan.gradeIndex].name) +
                    '" because that item failed to create.'
                );
              }
              appendLog(
                'Linking quiz "' +
                  quiz.name +
                  '" to existing grade item "' +
                  (quizPlan.gradeName || items[quizPlan.gradeIndex].name) +
                  '".'
              );
            } else {
              var quizGbCatId = quiz.categoryKey ? categoryIdByKey[quiz.categoryKey] : null;
              var qg = await createGradeItem(
                course.OrgUnitId,
                {
                  name: quiz.name,
                  points: quiz.points,
                  weight: null,
                  bonus: false,
                  exclude: false,
                  canExceed: false
                },
                quizGbCatId || null
              );
              quizGradeItemId = qg && qg.Id != null ? qg.Id : null;
              results.grades++;
              appendLog("Created linked grade item: " + quiz.name);
              await sleep(REQUEST_GAP_MS);
            }
          }

          var quizToolCatId = null;
          if (quiz.quizCategory) {
            var quizCatResult = await ensureQuizCategoryId(
              course.OrgUnitId,
              quiz.quizCategory,
              quizCategoryIdCache
            );
            quizToolCatId = quizCatResult.id;
            if (quizCatResult.created) results.quizCategories++;
            await sleep(REQUEST_GAP_MS);
          }

          await createQuiz(course.OrgUnitId, quiz, quizGradeItemId, quizToolCatId);
          results.quizzes++;
          appendLog(
            "Created quiz shell: " +
              quiz.name +
              (quiz.hidden ? " (inactive — publish in Quizzes when ready)" : "")
          );
          await sleep(REQUEST_GAP_MS);
        } catch (qe) {
          results.errors.push('Quiz "' + quiz.name + '": ' + qe.message);
          appendLog("FAILED quiz " + quiz.name + ": " + qe.message);
        }
      }

      for (var fi = 0; fi < forums.length; fi++) {
        try {
          var createdForum = await createDiscussionForum(course.OrgUnitId, forums[fi]);
          var forumId = createdForum && (createdForum.ForumId || createdForum.Id);
          if (forumId != null) {
            forumIdByKey[forums[fi].key] = forumId;
            results.forums++;
            appendLog("Created forum: " + forums[fi].name);
          }
          await sleep(REQUEST_GAP_MS);
        } catch (fe) {
          results.errors.push('Forum "' + forums[fi].name + '": ' + fe.message);
          appendLog("FAILED forum " + forums[fi].name + ": " + fe.message);
        }
      }

      for (var ti = 0; ti < topics.length; ti++) {
        var topic = Object.assign({}, topics[ti]);
        try {
          var parentForumId = topic.forumKey ? forumIdByKey[topic.forumKey] : null;
          if (!parentForumId) throw new Error("Parent forum was not created.");
          var topicPlan = (gradeLinkPlan.topics && gradeLinkPlan.topics[ti]) || null;
          if (topicPlan && topicPlan.action === "unscored") {
            topic.forceUngraded = true;
            appendLog(
              'Creating topic "' +
                topic.name +
                '" without ScoreOutOf to avoid duplicating grade item "' +
                (topicPlan.gradeName || "") +
                '".'
            );
          }
          await createDiscussionTopic(course.OrgUnitId, parentForumId, topic);
          results.topics++;
          appendLog("Created topic: " + topic.name);
          await sleep(REQUEST_GAP_MS);
        } catch (te) {
          results.errors.push('Topic "' + topic.name + '": ' + te.message);
          appendLog("FAILED topic " + topic.name + ": " + te.message);
        }
      }

      if (privateBoards) {
        try {
          if (
            !window.PrivateStudentConversationsAPI ||
            typeof window.PrivateStudentConversationsAPI.deployToCourse !== "function"
          ) {
            throw new Error("Private Student Conversations API is not available.");
          }
          appendLog("Creating private student discussion boards…");
          var psc = await window.PrivateStudentConversationsAPI.deployToCourse(course.OrgUnitId, {
            log: function (msg) {
              appendLog(msg);
            }
          });
          results.privateBoards = psc;
          appendLog(
            "Private boards: " +
              psc.created +
              " created/updated, " +
              psc.skipped +
              " already set up" +
              (psc.errors && psc.errors.length ? ", " + psc.errors.length + " error(s)" : "") +
              "."
          );
          if (psc.errors && psc.errors.length) {
            for (var pe = 0; pe < Math.min(psc.errors.length, 5); pe++) {
              results.errors.push("Private board: " + psc.errors[pe]);
            }
          }
        } catch (pse) {
          results.errors.push("Private boards: " + pse.message);
          appendLog("FAILED private boards: " + pse.message);
        }
      }

      // Course Information (syllabus / office hours) before weekly modules
      // so Syllabus appears first in the content TOC.
      var module = null;
      if (state.syllabusFile || state.officeHoursFile) {
        try {
          module = await ensureCourseInfoModule(course.OrgUnitId);
          await sleep(REQUEST_GAP_MS);
        } catch (me) {
          results.errors.push("Content module: " + me.message);
          appendLog("FAILED content module: " + me.message);
        }
      }

      if (module && state.syllabusFile) {
        try {
          var syllabusTopic = await uploadContentFile(
            course.OrgUnitId,
            module.Id,
            state.syllabusFile,
            "Syllabus"
          );
          results.syllabusTopicId = syllabusTopic && syllabusTopic.Id ? syllabusTopic.Id : null;
          appendLog("Uploaded syllabus.");
          await sleep(REQUEST_GAP_MS);
        } catch (se) {
          results.errors.push("Syllabus upload: " + se.message);
          appendLog("FAILED syllabus upload: " + se.message);
        }
      }

      if (module && state.officeHoursFile) {
        try {
          await uploadContentFile(course.OrgUnitId, module.Id, state.officeHoursFile, "Office Hours");
          appendLog("Uploaded office hours document.");
          await sleep(REQUEST_GAP_MS);
        } catch (oe) {
          results.errors.push("Office hours file: " + oe.message);
          appendLog("FAILED office hours file: " + oe.message);
        }
      }

      for (var mi = 0; mi < contentModules.length; mi++) {
        try {
          await createContentModule(course.OrgUnitId, contentModules[mi], modulesHidden);
          results.modules++;
          appendLog("Created content module: " + contentModules[mi].title);
          await sleep(REQUEST_GAP_MS);
        } catch (me) {
          results.errors.push('Content module "' + contentModules[mi].title + '": ' + me.message);
          appendLog("FAILED content module " + contentModules[mi].title + ": " + me.message);
        }
      }

      var syllabusUrl = syllabusViewUrl(course.OrgUnitId, results.syllabusTopicId);
      var announcementBody = ($("cpdAnnouncementBody").value || "").trim();
      if (syllabusUrl) {
        announcementBody = buildAnnouncementText({ syllabusUrl: syllabusUrl });
        $("cpdAnnouncementBody").value = announcementBody;
        state.announcementTouched = true;
      }

      try {
        var news = await createAnnouncement(
          course.OrgUnitId,
          ($("cpdAnnouncementTitle").value || "").trim(),
          announcementBody
        );
        results.announcementId = news && news.Id ? news.Id : null;
        appendLog("Posted welcome announcement.");
      } catch (ne) {
        results.errors.push("Announcement: " + ne.message);
        appendLog("FAILED announcement: " + ne.message);
      }

      var summary =
        "Deploy finished. Categories: " +
        results.categories +
        ", grade items: " +
        results.grades +
        ", assignments: " +
        results.assignments +
        ", quizzes: " +
        results.quizzes +
        ", forums: " +
        results.forums +
        ", topics: " +
        results.topics +
        ", content modules: " +
        results.modules +
        ".";
      if (results.quizCategories) {
        summary += " Quiz categories: " + results.quizCategories + ".";
      }
      if (results.privateBoards) {
        summary +=
          " Private boards: " +
          results.privateBoards.created +
          " created/updated, " +
          results.privateBoards.skipped +
          " skipped.";
      }
      if (results.bannerUploaded) summary += " Course banner uploaded.";
      if (results.syllabusTopicId) summary += " Syllabus uploaded.";
      if (results.announcementId) summary += " Announcement posted.";
      if (results.quizzes > 0) {
        var quizUrl = quizzesManageUrl(course.OrgUnitId);
        appendLog("Next: add quiz questions in Brightspace → " + quizUrl);
        summary +=
          ' Add questions in <a href="' +
          escapeHtml(quizUrl) +
          '" target="_blank" rel="noopener">Quizzes</a> (shells only — questions are not creatable via API).';
      }
      if (results.errors.length) {
        summary += " " + results.errors.length + " issue(s) — see the log.";
        setMessage(summary, "error", true);
      } else {
        setMessage(summary, "success", results.quizzes > 0);
      }

      promptProfileWidgetReminder(course, { bannerUploaded: results.bannerUploaded });
    } catch (e) {
      setMessage("Deploy failed: " + e.message, "error");
      appendLog("Deploy failed: " + e.message);
    } finally {
      state.running = false;
      $("cpdDeployBtn").disabled = false;
    }
  }

  // ---- Init ----

  function initSampleCsvUi() {
    if ($("cpdPointsPreview")) $("cpdPointsPreview").textContent = SAMPLE_POINTS_CSV.trim();
    if ($("cpdWeightedPreview")) $("cpdWeightedPreview").textContent = SAMPLE_WEIGHTED_CSV.trim();
    if ($("cpdAssignmentsPreview")) $("cpdAssignmentsPreview").textContent = SAMPLE_ASSIGNMENTS_CSV.trim();
    if ($("cpdDownloadPointsCsv")) {
      $("cpdDownloadPointsCsv").addEventListener("click", function () {
        downloadTextFile("sample-gradebook-points.csv", SAMPLE_POINTS_CSV);
      });
    }
    if ($("cpdDownloadWeightedCsv")) {
      $("cpdDownloadWeightedCsv").addEventListener("click", function () {
        downloadTextFile("sample-gradebook-weighted-categories.csv", SAMPLE_WEIGHTED_CSV);
      });
    }
    if ($("cpdDownloadAssignmentsCsv")) {
      $("cpdDownloadAssignmentsCsv").addEventListener("click", function () {
        downloadTextFile("sample-assignments.csv", SAMPLE_ASSIGNMENTS_CSV);
      });
    }
    if ($("cpdDiscussionsPreview")) $("cpdDiscussionsPreview").textContent = SAMPLE_DISCUSSIONS_CSV.trim();
    if ($("cpdDownloadDiscussionsCsv")) {
      $("cpdDownloadDiscussionsCsv").addEventListener("click", function () {
        downloadTextFile("sample-discussions.csv", SAMPLE_DISCUSSIONS_CSV);
      });
    }
    if ($("cpdQuizzesPreview")) $("cpdQuizzesPreview").textContent = SAMPLE_QUIZZES_CSV.trim();
    if ($("cpdDownloadQuizzesCsv")) {
      $("cpdDownloadQuizzesCsv").addEventListener("click", function () {
        downloadTextFile("sample-quizzes.csv", SAMPLE_QUIZZES_CSV);
      });
    }
  }

  // ---- Exclusive section accordion ----

  function getAccordionSections() {
    return Array.prototype.slice.call(document.querySelectorAll("#cpdForm details.cpd-accordion"));
  }

  function setAccordionReviewMode(on) {
    var form = $("cpdForm");
    var reviewBtn = $("cpdReviewAll");
    var stepBtn = $("cpdStepMode");
    var hint = $("cpdReviewHint");
    state.accordionReviewMode = !!on;
    if (form) form.classList.toggle("is-reviewing", !!on);
    if (reviewBtn) reviewBtn.hidden = !!on;
    if (stepBtn) stepBtn.hidden = !on;
    if (hint) {
      hint.textContent = on
        ? "All sections open for review. Switch back to step-by-step to focus on one section at a time."
        : "One section at a time. Use Review all before deploy to check everything.";
    }
  }

  function openOnlyAccordion(target) {
    var sections = getAccordionSections();
    for (var i = 0; i < sections.length; i++) {
      sections[i].open = sections[i] === target;
    }
  }

  function initSectionAccordion() {
    var sections = getAccordionSections();
    if (!sections.length) return;

    // Default: only the first section open
    for (var i = 0; i < sections.length; i++) {
      sections[i].open = i === 0;
    }
    setAccordionReviewMode(false);

    for (var s = 0; s < sections.length; s++) {
      (function (details) {
        details.addEventListener("toggle", function () {
          if (state.accordionReviewMode) return;
          if (!details.open) return;
          var others = getAccordionSections();
          for (var j = 0; j < others.length; j++) {
            if (others[j] !== details && others[j].open) {
              others[j].open = false;
            }
          }
        });
      })(sections[s]);
    }

    if ($("cpdReviewAll")) {
      $("cpdReviewAll").addEventListener("click", function () {
        var all = getAccordionSections();
        for (var i = 0; i < all.length; i++) all[i].open = true;
        setAccordionReviewMode(true);
        if (all[0]) {
          try {
            all[0].scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (e) {
            /* ignore */
          }
        }
      });
    }

    if ($("cpdStepMode")) {
      $("cpdStepMode").addEventListener("click", function () {
        setAccordionReviewMode(false);
        openOnlyAccordion(getAccordionSections()[0] || null);
      });
    }
  }

  function bindEvents() {
    $("cpdForm").addEventListener("submit", function (e) {
      e.preventDefault();
      deploy();
    });

    initSectionAccordion();

    var schemeRadios = document.querySelectorAll('input[name="cpdScheme"]');
    for (var i = 0; i < schemeRadios.length; i++) {
      schemeRadios[i].addEventListener("change", updateSchemeUi);
    }

    $("cpdAddCategory").addEventListener("click", function () {
      addCategoryRow();
    });
    $("cpdAddGradeItem").addEventListener("click", function () {
      addGradeRow();
    });
    $("cpdAddAssignment").addEventListener("click", function () {
      addAssignmentRow();
    });
    if ($("cpdAddQuiz")) {
      $("cpdAddQuiz").addEventListener("click", function () {
        addQuizRow();
      });
    }
    if ($("cpdAddWeeklyQuizPack")) {
      $("cpdAddWeeklyQuizPack").addEventListener("click", function () {
        addWeeklyQuizPack();
      });
    }
    if ($("cpdQuizTabManual")) {
      $("cpdQuizTabManual").addEventListener("click", function () {
        setQuizEntryMode("manual");
      });
    }
    if ($("cpdQuizTabCsv")) {
      $("cpdQuizTabCsv").addEventListener("click", function () {
        setQuizEntryMode("csv");
      });
    }
    if ($("cpdQuizCsvFile")) {
      $("cpdQuizCsvFile").addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        handleQuizCsvUpload(file).catch(function (err) {
          setMessage("Quiz CSV error: " + err.message, "error");
          var status = $("cpdQuizCsvStatus");
          if (status) {
            status.hidden = false;
            status.textContent = "Could not read CSV: " + err.message;
          }
        });
      });
    }
    if ($("cpdGenerateModules")) {
      $("cpdGenerateModules").addEventListener("click", function () {
        generateContentModules();
      });
    }
    if ($("cpdModuleCount")) {
      $("cpdModuleCount").addEventListener("change", function () {
        // Keep list in sync when count changes if a list already exists or count > 0
        if (parseInt($("cpdModuleCount").value, 10) > 0 || document.querySelectorAll("#cpdModuleRows .cpd-module-row").length) {
          generateContentModules();
        }
      });
    }
    if ($("cpdModuleNaming")) {
      $("cpdModuleNaming").addEventListener("change", function () {
        if (parseInt(($("cpdModuleCount") && $("cpdModuleCount").value) || "0", 10) > 0) {
          generateContentModules();
        }
      });
    }
    if ($("cpdAddForum")) {
      $("cpdAddForum").addEventListener("click", function () {
        addForumRow();
      });
    }
    if ($("cpdAddTopic")) {
      $("cpdAddTopic").addEventListener("click", function () {
        addTopicRow();
      });
    }
    if ($("cpdDiscTabManual")) {
      $("cpdDiscTabManual").addEventListener("click", function () {
        setDiscussionEntryMode("manual");
      });
    }
    if ($("cpdDiscTabCsv")) {
      $("cpdDiscTabCsv").addEventListener("click", function () {
        setDiscussionEntryMode("csv");
      });
    }
    if ($("cpdDiscussionCsvFile")) {
      $("cpdDiscussionCsvFile").addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        handleDiscussionCsvUpload(file).catch(function (err) {
          setMessage("Discussion CSV error: " + err.message, "error");
          var status = $("cpdDiscussionCsvStatus");
          if (status) {
            status.hidden = false;
            status.textContent = "Could not read CSV: " + err.message;
          }
        });
      });
    }
    if ($("cpdAsnTabManual")) {
      $("cpdAsnTabManual").addEventListener("click", function () {
        setAssignmentEntryMode("manual");
      });
    }
    if ($("cpdAsnTabCsv")) {
      $("cpdAsnTabCsv").addEventListener("click", function () {
        setAssignmentEntryMode("csv");
      });
    }
    if ($("cpdAssignmentCsvFile")) {
      $("cpdAssignmentCsvFile").addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        handleAssignmentCsvUpload(file).catch(function (err) {
          setMessage("Assignment CSV error: " + err.message, "error");
          var status = $("cpdAssignmentCsvStatus");
          if (status) {
            status.hidden = false;
            status.textContent = "Could not read CSV: " + err.message;
          }
        });
      });
    }
    $("cpdTabManual").addEventListener("click", function () {
      setGradeEntryMode("manual");
    });
    $("cpdTabCsv").addEventListener("click", function () {
      setGradeEntryMode("csv");
    });

    $("cpdSyllabus").addEventListener("change", function (e) {
      state.syllabusFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      setFileLabel("cpdSyllabusName", state.syllabusFile);
      if (!state.announcementTouched) refreshAnnouncement();
    });
    if ($("cpdCourseBanner")) {
      $("cpdCourseBanner").addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (file && file.size > 2000 * 1024) {
          setMessage(
            "Course banner must be under 2000 KB (selected file is " +
              Math.ceil(file.size / 1024) +
              " KB). Choose a smaller image.",
            "error"
          );
          e.target.value = "";
          state.courseBannerFile = null;
          setFileLabel("cpdCourseBannerName", null);
          return;
        }
        state.courseBannerFile = file;
        setFileLabel("cpdCourseBannerName", state.courseBannerFile);
      });
    }
    $("cpdOfficeHoursFile").addEventListener("change", function (e) {
      state.officeHoursFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      setFileLabel("cpdOfficeHoursFileName", state.officeHoursFile);
    });
    $("cpdCsvFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      handleCsvUpload(file).catch(function (err) {
        setMessage("CSV error: " + err.message, "error");
      });
    });

    $("cpdCourse").addEventListener("change", function () {
      state.announcementTouched = false;
      refreshAnnouncement(true);
      var course = getSelectedCourse();
      loadGradeSchemesForCourse(course ? course.OrgUnitId : null);
    });
    $("cpdOfficeHours").addEventListener("input", function () {
      if (!state.announcementTouched) refreshAnnouncement();
    });
    $("cpdAnnouncementBody").addEventListener("input", function () {
      state.announcementTouched = true;
    });
    $("cpdAnnouncementTitle").addEventListener("input", function () {
      state.announcementTouched = true;
    });
    $("cpdRefreshAnnouncement").addEventListener("click", function () {
      state.announcementTouched = false;
      refreshAnnouncement(true);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    initSampleCsvUi();
    addCategoryRow({ name: "Assignments", weight: 40, dist: "even" });
    addCategoryRow({ name: "Exams", weight: 60, dist: "even" });
    addGradeRow();
    updateAssignmentEmpty();
    updateQuizEmpty();
    updateDiscussionEmpty();
    updateModuleEmpty();
    updateSchemeUi();
    refreshAnnouncement(true);

    Promise.all([loadWhoAmI(), loadCourses()]).then(function () {
      refreshAnnouncement(true);
    });
  });
})();
