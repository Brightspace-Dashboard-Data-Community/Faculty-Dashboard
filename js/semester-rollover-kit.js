/**
 * Semester Rollover Kit — faculty checklist for one selected Brightspace term.
 * The dashboard semester picker (and the pills on this page) control header,
 * course list, copy, and saved progress.
 */
(function () {
  "use strict";

  var STORAGE_PREFIX = "fdRolloverKit:";
  var HELP_TICKET = "https://helpdesk.example.edu/portal/en/newticket";
  var taskButtonsBound = false;
  var courseLoadSeq = 0;

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function futureSlot() {
    return semesterApi() ? semesterApi().getFuture() : { code: "27/WI", label: "Winter 2027", displayLabel: "Winter 2027 (27/WI)" };
  }

  function calendarSlot() {
    return semesterApi() ? semesterApi().getCalendarActive() : { code: "26/FA", label: "Fall 2026", displayLabel: "Fall 2026 (26/FA)" };
  }

  function previousSlot() {
    return semesterApi() ? semesterApi().getPrevious() : { code: "26/SP", label: "Spring 2026", displayLabel: "Spring 2026 (26/SP)" };
  }

  function selectedSlot() {
    return semesterApi() ? semesterApi().getViewing() : calendarSlot();
  }

  function pickerRoles() {
    return [
      { role: "Previous", slot: previousSlot() },
      { role: "Current", slot: calendarSlot() },
      { role: "Upcoming", slot: futureSlot() }
    ];
  }

  function copySourceSlot() {
    var selected = selectedSlot();
    if (selected.code === futureSlot().code) return calendarSlot();
    if (selected.code === calendarSlot().code) return previousSlot();
    return previousSlot();
  }

  function href(path) {
    if (window.D2LNavigation && typeof window.D2LNavigation.resolveHref === "function") {
      return window.D2LNavigation.resolveHref(path);
    }
    return path;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isSandboxCourse(name, code) {
    var s = ((name || "") + " " + (code || "")).toLowerCase();
    return s.indexOf("sandbox") >= 0 || s.indexOf("sbx") >= 0 || s.indexOf("practice") >= 0;
  }

  function storageKey() {
    return STORAGE_PREFIX + selectedSlot().code;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return { items: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { items: {} };
      return { items: parsed.items && typeof parsed.items === "object" ? parsed.items : {} };
    } catch (e) {
      return { items: {} };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify({ v: 1, term: selectedSlot().code, items: state.items || {} })
      );
    } catch (e) {
      /* private mode / quota */
    }
  }

  function getPhases() {
    var selected = selectedSlot();
    var source = copySourceSlot();

    return [
      {
        id: "shells",
        title: "Confirm your shells",
        icon: "fa-layer-group",
        intro:
          "Confirm the " +
          selected.displayLabel +
          " offerings you will teach in Brightspace, and merge sections before you copy content.",
        tasks: [
          {
            id: "confirm-upcoming",
            title: "Find your " + selected.code + " course offerings",
            optional: false,
            why:
              "This list shows only the semester selected at the top. Late-start sections for that term are included when they share the " +
              selected.code +
              " course code.",
            steps: [
              "Use the course list on this page, or open My Courses with the same semester selected.",
              "Open each shell from Brightspace to confirm it is the section you expect.",
              "If a section is missing, wait for faculty access or submit a Help Desk ticket."
            ],
            links: [
              { href: "mycourses.html", label: "Open My Courses", icon: "fa-book" }
            ]
          },
          {
            id: "merge",
            title: "Request a course merge (if you need one gradebook)",
            optional: true,
            why: "Merging after you copy content creates extra cleanup. Combine sections first when you will teach them from a single Brightspace shell.",
            steps: [
              "Use the Course Merge Form for the term you are preparing.",
              "Choose one Primary course and the section shells to merge into it.",
              "Wait until the merge is complete before running the Term Rollover Assistant into that primary shell."
            ],
            links: [
              { href: "course-merge-form.html", label: "Course Merge Form", icon: "fa-code-branch" }
            ]
          },
          {
            id: "sandbox",
            title: "Practice in a sandbox (optional)",
            optional: true,
            why: "A sandbox lets you test copy, dates, and agents without touching a live " + selected.label + " offering.",
            steps: [
              "Create a sandbox and enroll yourself as Instructor.",
              "Run a copy into the sandbox first if you want a dry run."
            ],
            links: [
              { href: "sandbox-course.html", label: "Sandbox Course Creator", icon: "fa-cube" }
            ]
          }
        ]
      },
      {
        id: "content",
        title: "Bring content forward",
        icon: "fa-copy",
        intro:
          "Copy from a " +
          source.label +
          " offering (" +
          source.code +
          "), or start a new shell. Brightspace copies course components — not student submissions, quiz attempts, grades, or discussion posts.",
        tasks: [
          {
            id: "copy-or-build",
            title: "Copy a past course or build a new shell",
            optional: false,
            why:
              "Most faculty copy a " +
              source.code +
              " course into this " +
              selected.code +
              " offering, then drop what they no longer need. If the shell should be built from scratch, use the Course Package Deployer instead.",
            steps: [
              "Term Rollover Assistant: choose this " +
                selected.code +
                " course (copy to), then a " +
                source.code +
                " course (copy from). Uncheck items you do not want. Offset dates by the course start-date difference.",
              "After copy, use the assistant’s editor pass to rename, delete, or add items.",
              "Building new? Course Package Deployer creates syllabus placeholders, gradebook, assignments, discussions, and weekly modules in one pass.",
              "Do not copy Homepages, Navbars, or Widgets unless you intend to replace the college defaults."
            ],
            links: [
              { href: "term-rollover-assistant.html", label: "Term Rollover Assistant", icon: "fa-rotate" },
              { href: "course-package-deployer.html", label: "Course Package Deployer", icon: "fa-layer-group" }
            ]
          }
        ]
      },
      {
        id: "calendar",
        title: "Dates, visibility, and gradebook",
        icon: "fa-calendar-alt",
        intro:
          "Copied due dates are a first pass. Align them to " +
          selected.label +
          " meeting patterns, then check availability windows so students do not see last term’s calendar.",
        tasks: [
          {
            id: "due-dates",
            title: "Shift assignment and quiz due dates",
            optional: false,
            why: "Institution due dates save as 11:59 PM local time. Cascade by session or week, then spot-check outliers (GTKY, finals, extra credit).",
            steps: [
              "Open Due Date Wizard and select the " + selected.code + " offering.",
              "Set an anchor date for Session 1 or Week 1 and cascade.",
              "Review any item the cascade missed and save once."
            ],
            links: [
              { href: "due-date-wizard.html", label: "Due Date Wizard", icon: "fa-calendar-alt" }
            ]
          },
          {
            id: "availability",
            title: "Update availability windows and quiz publish state",
            optional: true,
            why: "Start and end dates on assignments and quizzes often copy with last term’s windows. Hidden or unpublished quizzes will not appear for students.",
            steps: [
              "Edit Available from / until in bulk.",
              "Publish quizzes you intend students to see (or keep drafts until you are ready)."
            ],
            links: [
              { href: "bulk-availability-editor.html", label: "Bulk Availability Editor", icon: "fa-clock" }
            ]
          },
          {
            id: "discussions",
            title: "Lock, hide, or date discussion topics",
            optional: true,
            why: "Copied topics may still be open, hidden, or tied to last term’s calendar reminders.",
            steps: [
              "Set topic availability and lock/hide flags.",
              "Add calendar reminders for discussions you want on the Brightspace calendar."
            ],
            links: [
              { href: "bulk-discussion-editor.html", label: "Bulk Discussion Board Editor", icon: "fa-comments" }
            ]
          },
          {
            id: "gradebook",
            title: "Review grade items, points, and weights",
            optional: true,
            why: "Copied gradebooks keep last term’s structure. This editor changes names, points, weights, and visibility — it does not enter scores.",
            steps: [
              "Confirm category weights still match this syllabus.",
              "Hide or exclude items you are not using this term."
            ],
            links: [
              { href: "bulk-gradebook-editor.html", label: "Bulk Gradebook Editor", icon: "fa-table" }
            ]
          },
          {
            id: "announcements",
            title: "Retarget copied announcements",
            optional: true,
            why: "News items often copy with last term’s start and end dates, so they never publish — or they publish immediately.",
            steps: [
              "Set publish windows, draft vs published, and pin flags.",
              "Rewrite welcome language for " + selected.label + " (dates, office hours, first-week links)."
            ],
            links: [
              { href: "bulk-announcement-scheduler.html", label: "Bulk Announcement Scheduler", icon: "fa-bullhorn" }
            ]
          }
        ]
      },
      {
        id: "student-facing",
        title: "Student-facing setup",
        icon: "fa-chalkboard-user",
        intro: "Syllabus, homepage, agents, and first-week communications are what students notice on day one.",
        tasks: [
          {
            id: "syllabus",
            title: "Simple Syllabus — navbar, fields, and release",
            optional: true,
            why: "Simple Syllabus is available if you want to use it. Faculty are not required to put a syllabus in Simple Syllabus.",
            steps: [
              "If you use Simple Syllabus, add the Syllabus link to the course navbar if it is missing.",
              "Complete the required fields and paste current policy language.",
              "Preview, then release to students when the syllabus is ready."
            ],
            links: [
              { href: "simple-syllabus-tutorial.html", label: "Simple Syllabus walkthrough", icon: "fa-file-alt" },
              { href: "syllabus-updates/index.html", label: "Policy language to copy", icon: "fa-file-lines" }
            ]
          },
          {
            id: "homepage",
            title: "Homepage: profile, widgets, Student Success Module",
            optional: false,
            why: "Students use the course homepage to identify you and find support. A Student Success Module is loaded into courses as a hidden Content module.",
            steps: [
              "Update the Faculty Profile Widget (photo, contact, office hours). If Configure this widget is missing, contact eLearning.",
              "Unhide the Student Success Module in Content if you want students to use it.",
              "Add or review homepage widgets (Office Hours Chat, Activity Feed, Visual TOC) from the Course Widgets guide."
            ],
            links: [
              { href: "course-widgets.html", label: "Course Widgets guide", icon: "fa-puzzle-piece" },
              { href: "semester-updates/index.html", label: "Semester reminders (profile & SSM)", icon: "fa-calendar-days" }
            ]
          },
          {
            id: "agents",
            title: "Review or create Intelligent Agents",
            optional: true,
            why: "Copied agents often keep last term’s dates and login criteria. They can email students too early — or never.",
            steps: [
              "Open Intelligent Agents in the course and check start/end dates and criteria.",
              "Use the Agent Builder to add templates (missing work, welcome, incomplete checklist) in this offering."
            ],
            links: [
              { href: "intelligent-agent-builder.html", label: "Intelligent Agent Builder", icon: "fa-robot" }
            ]
          },
          {
            id: "private-convos",
            title: "Private per-student discussion topics",
            optional: true,
            why: "One private topic per student is useful for 1-on-1 questions. Safe to re-run after late adds.",
            steps: [
              "Run Private Student Conversations after the classlist looks stable.",
              "Re-run when new students are added."
            ],
            links: [
              { href: "private-student-conversations.html", label: "Private Student Conversations", icon: "fa-user-friends" }
            ]
          },
          {
            id: "ai-policy",
            title: "Confirm your AI syllabus language",
            optional: true,
            why: "Board Policy 8.020 expects students to see how AI may be used in your course (models A–C).",
            steps: [
              "Choose the syllabus model that matches how you teach this offering.",
              "Paste the language into Simple Syllabus and any first-week announcement."
            ],
            links: [
              { href: "ai-policy.html", label: "AI Policy guide", icon: "fa-robot" }
            ]
          }
        ]
      },
      {
        id: "launch",
        title: "Accessibility and launch",
        icon: "fa-flag-checkered",
        intro:
          "Finish with access checks students will hit in week 1. YuJa Panorama is replacing Ally for file accessibility scoring; ReadSpeaker is available in Brightspace for text-to-speech.",
        tasks: [
          {
            id: "accessibility",
            title: "Scan files and course pages for accessibility",
            optional: false,
            why: "Title II digital accessibility requirements apply to course materials. Fix issues in PDFs, Office files, and Brightspace pages before students rely on them.",
            steps: [
              "Use the Accessibility hub for format guides (Word, PDF, PowerPoint, D2L webpages, multimedia).",
              "Watch for YuJa Panorama scores on newly uploaded files.",
              "Remind students that ReadSpeaker can read HTML content and many uploaded documents."
            ],
            links: [
              { href: "accessibility.html", label: "Accessibility hub", icon: "fa-universal-access" },
              { href: "readspeaker.html", label: "ReadSpeaker overview", icon: "fa-headphones" }
            ]
          },
          {
            id: "student-view",
            title: "Walk the course in Student View",
            optional: false,
            why: "Instructor view hides broken links, unpublished items, and navbar problems. Check Content, News, and the syllabus as a student would.",
            steps: [
              "Use Student View or a ZZStudent account.",
              "Click through first-week modules, News, and the Syllabus navbar link.",
              "On Course Health, run Course Readiness for empty modules, broken links, News, and gradebook."
            ],
            links: [
              { href: "analytics.html", label: "Course Health / Readiness", icon: "fa-clipboard-check" }
            ]
          },
          {
            id: "accommodations",
            title: "Set quiz accommodations when the classlist is ready",
            optional: true,
            why: "Time multipliers and extra minutes are per offering. Do this after students appear on the classlist, not during copy.",
            steps: [
              "Open Learner Accommodations for this " + selected.code + " course.",
              "Apply documented extra time before the first quiz opens."
            ],
            links: [
              { href: "learner-accommodations.html", label: "Learner Accommodations", icon: "fa-user-clock" }
            ]
          },
          {
            id: "reminders",
            title: "Copy semester-start reminder language",
            optional: true,
            why: "eLearning maintains copy-ready faculty email and course-prep reminders for the current campaign.",
            steps: [
              "Review highlighted sections for this term.",
              "Copy language into email or a Brightspace announcement if useful."
            ],
            links: [
              { href: "semester-updates/index.html", label: "Semester reminders", icon: "fa-envelope" },
              { href: HELP_TICKET, label: "Help Desk ticket", icon: "fa-ticket-alt", external: true }
            ]
          }
        ]
      }
    ];
  }

  var STATE = { items: {} };

  function allTasks() {
    var phases = getPhases();
    var out = [];
    for (var i = 0; i < phases.length; i++) {
      for (var t = 0; t < phases[i].tasks.length; t++) {
        out.push(phases[i].tasks[t]);
      }
    }
    return out;
  }

  function taskStatus(id) {
    return STATE.items[id] || "open";
  }

  function isComplete(id) {
    var s = taskStatus(id);
    return s === "done" || s === "na";
  }

  function updateProgress() {
    var tasks = allTasks();
    var total = tasks.length;
    var done = 0;
    for (var i = 0; i < total; i++) {
      if (isComplete(tasks[i].id)) done++;
    }
    var pct = total ? Math.round((done / total) * 100) : 0;
    var countEl = document.getElementById("srkProgressCount");
    var fill = document.getElementById("srkProgressFill");
    var bar = document.getElementById("srkProgressBar");
    if (countEl) countEl.textContent = done + " of " + total + " complete";
    if (fill) fill.style.width = pct + "%";
    if (bar) {
      bar.setAttribute("aria-valuenow", String(pct));
      bar.setAttribute("aria-valuetext", done + " of " + total + " items complete");
    }
    updatePhaseBadges();
  }

  function updatePhaseBadges() {
    var phases = getPhases();
    for (var i = 0; i < phases.length; i++) {
      var phase = phases[i];
      var complete = 0;
      for (var t = 0; t < phase.tasks.length; t++) {
        if (isComplete(phase.tasks[t].id)) complete++;
      }
      var badge = document.getElementById("srk-phase-badge-" + phase.id);
      if (badge) {
        badge.textContent = complete + "/" + phase.tasks.length;
      }
      var tocMeta = document.getElementById("srk-toc-meta-" + phase.id);
      if (tocMeta) {
        tocMeta.textContent = complete + " of " + phase.tasks.length;
      }
    }
  }

  function setStatus(id, status) {
    if (status === "open") {
      delete STATE.items[id];
    } else {
      STATE.items[id] = status;
    }
    saveState(STATE);
    var article = document.getElementById("srk-task-" + id);
    if (article) {
      article.classList.toggle("is-done", status === "done");
      article.classList.toggle("is-na", status === "na");
      var doneBtn = article.querySelector('[data-srk-action="done"]');
      var naBtn = article.querySelector('[data-srk-action="na"]');
      var reopenBtn = article.querySelector('[data-srk-action="open"]');
      if (doneBtn) doneBtn.setAttribute("aria-pressed", status === "done" ? "true" : "false");
      if (naBtn) naBtn.setAttribute("aria-pressed", status === "na" ? "true" : "false");
      if (reopenBtn) reopenBtn.hidden = status === "open";
    }
    updateProgress();
  }

  function renderLinks(links) {
    if (!links || !links.length) return "";
    var html = '<div class="srk-task-links">';
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var extra = l.external ? ' target="_blank" rel="noopener noreferrer"' : "";
      var icon = l.external ? "fa-external-link-alt" : l.icon || "fa-arrow-right";
      html +=
        '<a class="training-page-highlight-link" href="' +
        escapeHTML(l.external ? l.href : href(l.href)) +
        '"' +
        extra +
        ">" +
        '<i class="fas ' +
        icon +
        '" aria-hidden="true"></i> ' +
        escapeHTML(l.label) +
        "</a>";
    }
    html += "</div>";
    return html;
  }

  function renderTask(task, index) {
    var status = taskStatus(task.id);
    var steps = "";
    for (var i = 0; i < task.steps.length; i++) {
      steps += "<li>" + escapeHTML(task.steps[i]) + "</li>";
    }
    var optional = task.optional
      ? '<span class="srk-optional">Optional</span>'
      : '<span class="srk-required">Recommended</span>';
    var cls = "srk-task";
    if (status === "done") cls += " is-done";
    if (status === "na") cls += " is-na";

    return (
      '<article class="' +
      cls +
      '" id="srk-task-' +
      escapeHTML(task.id) +
      '" data-srk-task="' +
      escapeHTML(task.id) +
      '">' +
      '<div class="srk-task-head">' +
      '<span class="srk-task-num" aria-hidden="true">' +
      (index + 1) +
      "</span>" +
      "<div>" +
      "<h3 class=\"srk-task-title\">" +
      escapeHTML(task.title) +
      "</h3>" +
      optional +
      "</div>" +
      "</div>" +
      '<p class="srk-task-why">' +
      escapeHTML(task.why) +
      "</p>" +
      '<ol class="srk-task-steps">' +
      steps +
      "</ol>" +
      renderLinks(task.links) +
      '<div class="srk-task-actions">' +
      '<button type="button" class="form-button" data-srk-action="done" aria-pressed="' +
      (status === "done" ? "true" : "false") +
      '"><i class="fas fa-check" aria-hidden="true"></i> Done</button>' +
      (task.optional
        ? '<button type="button" class="form-button form-button-secondary" data-srk-action="na" aria-pressed="' +
          (status === "na" ? "true" : "false") +
          '">Does not apply</button>'
        : "") +
      '<button type="button" class="srk-reopen" data-srk-action="open"' +
      (status === "open" ? " hidden" : "") +
      ">Clear mark</button>" +
      "</div>" +
      "</article>"
    );
  }

  function renderPhases() {
    var phases = getPhases();
    var toc = document.getElementById("srkToc");
    var root = document.getElementById("srkPhases");
    if (!toc || !root) return;

    var tocHtml = "";
    var html = "";
    for (var i = 0; i < phases.length; i++) {
      var phase = phases[i];
      var tasksHtml = "";
      for (var t = 0; t < phase.tasks.length; t++) {
        tasksHtml += renderTask(phase.tasks[t], t);
      }
      var phaseNum = String(i + 1);
      tocHtml +=
        '<li><a href="#srk-phase-' +
        phase.id +
        '">' +
        escapeHTML(phase.title) +
        '</a> <span class="srk-toc-meta" id="srk-toc-meta-' +
        phase.id +
        '"></span></li>';

      html +=
        '<section class="accessibility-section widget-container srk-phase" id="srk-phase-' +
        phase.id +
        '" aria-labelledby="srk-phase-heading-' +
        phase.id +
        '">' +
        '<div class="srk-phase-header">' +
        '<h2 class="accessibility-section-title" id="srk-phase-heading-' +
        phase.id +
        '"><span class="srk-phase-num" aria-hidden="true">' +
        phaseNum +
        '</span><i class="fas ' +
        phase.icon +
        '" aria-hidden="true"></i> ' +
        escapeHTML(phase.title) +
        "</h2>" +
        '<span class="srk-phase-badge" id="srk-phase-badge-' +
        phase.id +
        '"></span>' +
        "</div>" +
        '<p class="accessibility-section-desc">' +
        escapeHTML(phase.intro) +
        "</p>" +
        '<div class="srk-task-list">' +
        tasksHtml +
        "</div>" +
        "</section>";
    }
    toc.innerHTML = tocHtml;
    root.innerHTML = html;
    bindTaskButtonsOnce();
    updateProgress();
  }

  function bindTaskButtonsOnce() {
    var root = document.getElementById("srkPhases");
    if (!root || taskButtonsBound) return;
    taskButtonsBound = true;
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-srk-action]");
      if (!btn) return;
      var article = btn.closest("[data-srk-task]");
      if (!article) return;
      var id = article.getAttribute("data-srk-task");
      var action = btn.getAttribute("data-srk-action");
      if (action === "done") {
        setStatus(id, taskStatus(id) === "done" ? "open" : "done");
      } else if (action === "na") {
        setStatus(id, taskStatus(id) === "na" ? "open" : "na");
      } else if (action === "open") {
        setStatus(id, "open");
      }
    });
  }

  function courseHomeUrl(orgUnitId) {
    return "/d2l/home/" + encodeURIComponent(String(orgUnitId));
  }

  function renderCourseItems(list) {
    var html = '<ul class="srk-course-ul">';
    for (var c = 0; c < list.length; c++) {
      var course = list[c];
      html +=
        "<li>" +
        '<a href="' +
        courseHomeUrl(course.id) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHTML(course.name) +
        (course.code ? ' <span class="srk-course-code">' + escapeHTML(course.code) + "</span>" : "") +
        ' <i class="fas fa-external-link-alt" aria-hidden="true"></i>' +
        "</a></li>";
    }
    html += "</ul>";
    return html;
  }

  async function loadSelectedCourses() {
    var host = document.getElementById("srkCourseList");
    if (!host) return;
    var selected = selectedSlot();
    var selectedCode = selected.code;
    var seq = ++courseLoadSeq;
    var api = window.FacultyDashboardCourses;

    host.innerHTML = '<p class="srk-course-loading">Loading ' + escapeHTML(selected.displayLabel) + " offerings…</p>";

    if (!api || typeof api.getFacultyCourseOfferings !== "function") {
      host.innerHTML =
        '<p class="srk-course-empty">Course list requires the dashboard course loader. Open this page from Brightspace, or use <a href="' +
        escapeHTML(href("mycourses.html")) +
        '">My Courses</a>.</p>';
      return;
    }

    try {
      var courses = await api.getFacultyCourseOfferings();
      if (seq !== courseLoadSeq) return;
      var matched = [];
      for (var i = 0; i < courses.length; i++) {
        var item = courses[i];
        var name = (item.OrgUnit && item.OrgUnit.Name) || "";
        var code = (item.OrgUnit && item.OrgUnit.Code) || "";
        var id = item.OrgUnit && item.OrgUnit.Id;
        if (!id) continue;
        if (isSandboxCourse(name, code)) continue;
        var sem = semesterApi() ? semesterApi().getSemesterCodeFromCourseCode(code) : "";
        if (sem === selectedCode) matched.push({ id: id, name: name, code: code });
      }

      if (!matched.length) {
        host.innerHTML =
          '<p class="srk-course-empty">No <strong>' +
          escapeHTML(selected.displayLabel) +
          "</strong> offerings were found (or this page is not running inside Brightspace). " +
          'If shells are not published yet, wait for faculty access or check <a href="' +
          escapeHTML(href("mycourses.html")) +
          '">My Courses</a>.</p>';
        return;
      }

      host.innerHTML =
        renderCourseItems(matched) +
        '<p class="form-hint">' +
        matched.length +
        " " +
        escapeHTML(selected.code) +
        " offering" +
        (matched.length === 1 ? "" : "s") +
        " · opens in Brightspace</p>";
    } catch (e) {
      if (seq !== courseLoadSeq) return;
      host.innerHTML =
        '<p class="srk-course-empty">Could not load courses from Brightspace. Stay signed in through D2L and refresh, or open <a href="' +
        escapeHTML(href("mycourses.html")) +
        '">My Courses</a>.</p>';
    }
  }

  function applyTermChrome() {
    var selected = selectedSlot();
    var heading = document.getElementById("srk-term-heading");
    var lead = document.getElementById("srkHeroLead");
    var how = document.getElementById("srkHowConfirm");
    var coursesHeading = document.getElementById("srk-courses-heading");
    var hint = document.getElementById("srkCourseHint");
    var lateNote =
      selected.code === calendarSlot().code
        ? " Late-start sections for this term are included."
        : "";

    if (heading) heading.textContent = selected.displayLabel;
    if (lead) {
      lead.innerHTML =
        "Work through the phases for <strong>" +
        escapeHTML(selected.displayLabel) +
        "</strong>. Progress stays in this browser for this term." +
        lateNote +
        " Brightspace Copy Components does <strong>not</strong> copy student work, grades, or discussion posts.";
    }
    if (how) {
      how.innerHTML =
        "Confirm your <strong>" +
        escapeHTML(selected.code) +
        "</strong> shells below (or on My Courses with this same semester selected).";
    }
    if (coursesHeading) coursesHeading.textContent = "Your " + selected.displayLabel + " courses";
    if (hint) {
      hint.textContent =
        "Offerings whose course code includes " +
        selected.code +
        ". Open a course in Brightspace, or use the tools in each phase below.";
    }
  }

  function renderTermPills() {
    var host = document.getElementById("srkTermPills");
    if (!host) return;
    var selected = selectedSlot();
    var roles = pickerRoles();
    var html = "";
    for (var i = 0; i < roles.length; i++) {
      var item = roles[i];
      var isOn = item.slot.code === selected.code;
      html +=
        '<button type="button" class="srk-pill' +
        (isOn ? " is-selected" : "") +
        '" role="radio" aria-checked="' +
        (isOn ? "true" : "false") +
        '" data-srk-term="' +
        escapeHTML(item.slot.code) +
        '">' +
        escapeHTML(item.role) +
        ": <strong>" +
        escapeHTML(item.slot.displayLabel) +
        "</strong></button>";
    }
    host.innerHTML = html;
  }

  function applyTerm() {
    STATE = loadState();
    applyTermChrome();
    renderTermPills();
    renderPhases();
    loadSelectedCourses();
  }

  function bindChrome() {
    var pills = document.getElementById("srkTermPills");
    if (pills) {
      pills.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-srk-term]");
        if (!btn) return;
        var code = btn.getAttribute("data-srk-term");
        if (!code || code === selectedSlot().code) return;
        if (semesterApi() && typeof semesterApi().setViewingCode === "function") {
          semesterApi().setViewingCode(code);
        } else {
          applyTerm();
        }
      });
    }

    if (semesterApi() && semesterApi().VIEWING_CHANGE_EVENT) {
      document.addEventListener(semesterApi().VIEWING_CHANGE_EVENT, applyTerm);
    }

    var resetBtn = document.getElementById("srkResetBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!window.confirm("Clear all checklist marks for " + selectedSlot().displayLabel + "?")) return;
        STATE.items = {};
        saveState(STATE);
        renderPhases();
      });
    }
    var printBtn = document.getElementById("srkPrintBtn");
    if (printBtn) {
      printBtn.addEventListener("click", function () {
        window.print();
      });
    }
  }

  function init() {
    bindChrome();
    applyTerm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
