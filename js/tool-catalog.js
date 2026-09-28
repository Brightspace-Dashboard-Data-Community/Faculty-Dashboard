/**
 * Faculty Dashboard Tool Catalog
 * Central metadata for tool hub pages.
 * kind: "tool" | "report" — used to split sections on hub pages.
 */
(function () {
  "use strict";

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/SP";
  }

  function previousSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getPreviousCode() : "26/WI";
  }

  function futureSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getFutureCode() : "26/FA";
  }

  var _ACTIVE_SEM = activeSemesterCode();
  var _TERM_RANGE =
    previousSemesterCode() + ", " + _ACTIVE_SEM + ", " + futureSemesterCode();

  var TOOL_CATALOG = [
    {
      id: "semester-rollover-kit",
      category: "course-management",
      kind: "tool",
      title: "Semester Rollover Kit",
      description:
        "Guided faculty checklist for one Brightspace term: choose Current, Previous, or Upcoming, then confirm shells, copy or build, shift dates, syllabus, homepage, and launch.",
      features: [
        "Semester picker drives header, courses, and checklist",
        "Phased checklist with saved progress per term",
        "Links into merge, copy, dates, syllabus, and launch tools"
      ],
      href: "semester-rollover-kit.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "course-merge",
      category: "course-management",
      kind: "tool",
      title: "Course Merge Form",
      description: "Submit merge requests for supported terms and consolidate sections into one course shell.",
      features: ["Winter 2027 and Fall 2026 forms", "Preserves content", "Single gradebook workflow"],
      href: "course-merge-form.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "sandbox-creator",
      category: "course-management",
      kind: "tool",
      title: "Sandbox Course Creator",
      description: "Create a sandbox course and auto-enroll yourself as Instructor for testing and experimentation.",
      features: ["One-click course creation", "Instructor enrollment", "Brightspace API powered"],
      href: "sandbox-course.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "course-package-deployer",
      category: "course-management",
      kind: "tool",
      title: "Course Package Deployer",
      description:
        "One-screen course shell setup: syllabus, gradebook, assignments, discussions, content modules, optional private boards, and welcome announcement.",
      features: [
        "Gradebook, assignments, and discussions",
        "Weekly/module content shells with dates",
        "Optional private per-student boards"
      ],
      href: "course-package-deployer.html",
      status: "beta",
      owner: "eLearning Office"
    },
    // Temporarily hidden from faculty view (page gated via coming-soon-modal).
    // Set hidden: false to restore in Course Management Tools.
    {
      id: "ai-learning-companion",
      category: "course-management",
      kind: "tool",
      title: "AI Learning Companion Generator",
      description: "Generate aligned note-taking guides and quiz questions from lecture transcripts with Transformers.js.",
      features: ["In-browser AI generation", "Notes-first quiz alignment", "Faculty-ready copy output"],
      href: "ai-learning-companion.html",
      status: "beta",
      owner: "eLearning Office",
      hidden: true
    },
    {
      id: "course-report",
      category: "course-management",
      kind: "report",
      title: "Course Report",
      description:
        "Export a grade spreadsheet, or generate a visual grade analytics PDF or full course report for previous, current, and upcoming term (" +
        _TERM_RANGE +
        ") courses.",
      features: [
        "CSV or Excel final-grade export",
        "Visual grade analytics PDF",
        "Quizzes, discussions, and assignment folders"
      ],
      href: "grade-export-utility.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "ia-builder",
      category: "course-management",
      kind: "tool",
      title: "Intelligent Agent Builder",
      description: "Choose a template, pick your course, and create the Intelligent Agent in Brightspace.",
      features: ["Template library", "Create in course via API", "Brightspace help and replace strings"],
      href: "intelligent-agent-builder.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "checklist-creator",
      category: "course-management",
      kind: "tool",
      title: "Checklist Creator",
      description:
        "Build a Brightspace checklist with categories and tasks in one pass, then optionally place a link in a content module.",
      features: [
        "Categories and multi-line task lists",
        "Optional due dates per item",
        "Link existing or new checklists into modules"
      ],
      href: "checklist-creator.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "due-date-wizard",
      category: "course-management",
      kind: "tool",
      title: "Due Date Wizard",
      description: "Bulk-update assignment and quiz due dates. Cascade by session or week, then save all changes at once.",
      features: ["Session/week cascade", "Assignment + quiz editor", "Discussion calendar reminders"],
      href: "due-date-wizard.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "bulk-availability-editor",
      category: "course-management",
      kind: "tool",
      title: "Bulk Availability Editor",
      description: "Edit assignment and quiz availability windows, quiz publish state, and calendar display in bulk.",
      features: ["Start/end availability", "Publish quizzes", "Calendar display toggles"],
      href: "bulk-availability-editor.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "bulk-discussion-editor",
      category: "course-management",
      kind: "tool",
      title: "Bulk Discussion Board Editor",
      description: "Lock, hide, and schedule discussion topics across a course, with optional calendar reminders.",
      features: ["Lock / hide / must-post", "Topic availability dates", "Calendar reminders"],
      href: "bulk-discussion-editor.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "bulk-gradebook-editor",
      category: "course-management",
      kind: "tool",
      title: "Bulk Gradebook Editor",
      description: "Edit grade item names, points, weights, and visibility flags without entering student scores.",
      features: ["Points and weights", "Bonus / exclude / hidden", "Structure only — no score entry"],
      href: "bulk-gradebook-editor.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "bulk-announcement-scheduler",
      category: "course-management",
      kind: "tool",
      title: "Bulk Announcement Scheduler",
      description: "Set publish windows, draft/publish state, and pin flags for existing course announcements.",
      features: ["Start/end windows", "Publish or draft", "Pin / unpin"],
      href: "bulk-announcement-scheduler.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "private-student-conversations",
      category: "course-management",
      kind: "tool",
      title: "Private Student Conversations",
      description: "Auto-create a private discussion topic for every student, locked to that student with a one-person group.",
      features: ["Classlist-driven setup", "Forum + one-person groups", "Safe to re-run for new students"],
      href: "private-student-conversations.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "term-rollover",
      category: "course-management",
      kind: "tool",
      title: "Term Rollover Assistant",
      description:
        "Copy selected materials from a past course into an upcoming offering, add new items, then bulk-update dates, rename, or remove what you no longer need.",
      features: [
        "Past → upcoming course mapping",
        "Item-level copy selection (assignments, quizzes, discussions)",
        "Add new items during rollover",
        "Post-copy date, rename, and delete pass"
      ],
      href: "term-rollover-assistant.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "faculty-privileged-enrollment",
      category: "student-management",
      kind: "tool",
      title: "Available Faculty Role Enrollment",
      description:
        "Enroll colleagues into courses you teach using only approved faculty roles such as Secondary Instructor, Teaching Assistant, Copy Course, and CSC.",
      features: ["Faculty-role-only guardrails", "Allowed-role validation", "User search by name, username, or email"],
      href: "faculty-course-adds.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "learner-accommodations",
      category: "student-management",
      kind: "tool",
      title: "Learner Accommodations",
      description: "Set quiz time accommodations (multiplier or extra minutes) for students in a course offering.",
      features: ["Per-student matrix", "Bulk update all", "Permission probe before save"],
      href: "learner-accommodations.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "student-ldaa-lookup",
      category: "student-management",
      kind: "report",
      title: "Student LDAA Lookup",
      description: "Look up Last Date of Academic Activity for enrolled students, or temporarily re-enroll a removed student to generate the LDAA PDF.",
      features: ["Enrolled student lookup", "Removed-student OrgDefinedId search", "Student - LDAA Report (role 172) enroll / unenroll", "PDF report download"],
      href: "student-ldaa-lookup.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "ldaa-period-report",
      category: "student-management",
      kind: "report",
      title: "LDAA Period Report",
      description:
        "Run Last Date of Academic Activity for a calendar range — entire class or one student — for weekly attendance. Snapshot of assignment, quiz, and discussion dates plus last login in the window.",
      features: [
        "Calendar date range (class or one student)",
        "Snapshot dates plus full submission detail",
        "CSV, Excel, and branded PDF export"
      ],
      href: "ldaa-period-report.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "inactive-students",
      category: "student-management",
      kind: "report",
      title: "Inactive Student Audit",
      description: "Flag students with no recent course access and export an outreach list for follow-up.",
      features: ["Last access window", "Course-level filtering", "Outreach list export"],
      href: "inactive-student-audit.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "course-health-analytics",
      category: "analytics-reports",
      kind: "tool",
      title: "Course Health Analytics",
      description: "View health trends and risk indicators for course engagement and performance.",
      features: ["Engagement trends", "Assessment insight", "Course friction signals"],
      href: "analytics.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "engagement-interaction",
      category: "analytics-reports",
      kind: "tool",
      title: "Engagement & Interaction",
      description:
        "Forum matrix, discussion activity, interaction tiers, grade feedback counts, and grade trends for a selected course.",
      features: ["Forum matrix", "Interaction tiers", "Feedback & grade trends"],
      href: "engagement-interaction.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "discussion-tone",
      category: "analytics-reports",
      kind: "tool",
      title: "Discussion Tone Dashboard",
      description:
        "Analyze sentiment and teacher-tone attributes in discussion posts. Runs locally in your browser.",
      features: ["Local AI sentiment model", "Positive/negative tone attributes", "PDF export"],
      href: "discussion-tone.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "feedback-tone",
      category: "analytics-reports",
      kind: "tool",
      title: "Feedback Tone Dashboard",
      description:
        "Analyze sentiment and tone attributes in grade feedback you leave for students. Local browser processing only.",
      features: ["Rubric & overall feedback", "Local AI analysis", "PDF export"],
      href: "feedback-tone.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "tone-checker",
      category: "analytics-reports",
      kind: "tool",
      title: "Tone Checker",
      description:
        "Paste any message — discussion reply, feedback, email, or announcement — and check its tone with the same local engine.",
      features: ["Paste-in analysis", "Highlighted tone phrases", "No Brightspace API required"],
      href: "tone-checker.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "assignment-analytics",
      category: "analytics-reports",
      kind: "tool",
      title: "Assignments Analytics",
      description: "Analyze assignment completion and grading patterns across courses.",
      features: ["Completion patterns", "Submission bottlenecks", "Performance insights"],
      href: "assignments.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "quiz-analytics",
      category: "analytics-reports",
      kind: "tool",
      title: "Quizzes Analytics",
      description: "Track quiz activity and outcomes to identify knowledge gaps early.",
      features: ["Attempt trends", "Score distribution", "Intervention signals"],
      href: "quizzes.html",
      status: "live",
      owner: "eLearning Office"
    },
    {
      id: "end-of-semester-report",
      category: "analytics-reports",
      kind: "report",
      title: "End of Semester Course Report",
      description:
        "Class-level retrospective of grades, access, content structure, due dates, quizzes, discussions, and assignments, with next-term suggestions. No student names.",
      features: [
        "Analytics up front, suggestions at the end",
        "Content, access, and help-seeking signals",
        "On-screen report and branded PDF"
      ],
      href: "end-of-semester-report.html",
      status: "beta",
      owner: "eLearning Office"
    },
    {
      id: "ia-reply-to-report",
      category: "analytics-reports",
      kind: "report",
      title: "Intelligent Agent Reply-To Settings Report",
      description: "Audit Reply-To values for Intelligent Agents across your own course offerings.",
      features: ["Cross-course scan", "Mismatch status", "Action-ready table"],
      href: "intelligent-agent-email-settings-report.html",
      status: "live",
      owner: "eLearning Office"
    }
  ];

  function getByCategory(category) {
    return TOOL_CATALOG.filter(function (tool) {
      return tool.category === category && !tool.hidden;
    });
  }

  function getByCategoryAndKind(category, kind) {
    return getByCategory(category).filter(function (tool) {
      return (tool.kind || "tool") === kind;
    });
  }

  window.ToolCatalog = {
    all: TOOL_CATALOG,
    getByCategory: getByCategory,
    getByCategoryAndKind: getByCategoryAndKind
  };
})();
