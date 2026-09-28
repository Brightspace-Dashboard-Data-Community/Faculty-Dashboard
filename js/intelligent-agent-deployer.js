(function () {
  "use strict";

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.93";
  var DEPLOYER_BUILD = "20260821e";

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var ACTIVE_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  var PREVIOUS_SEMESTER_CODE = semesterApi() ? semesterApi().getPreviousCode() : "26/WI";
  var FUTURE_SEMESTER_CODE = semesterApi() ? semesterApi().getFutureCode() : "26/FA";
  var ALLOWED_SEMESTER_CODES = {};
  ALLOWED_SEMESTER_CODES[PREVIOUS_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[ACTIVE_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[FUTURE_SEMESTER_CODE] = true;
  var SHOW_SANDBOX_ALL_TERMS = true;

  var ACADEMIC_ROLE_IDS = {
    102: true,
    183: true,
    108: true,
    127: true,
    160: true,
    167: true,
    174: true
  };

  var STUDENT_ROLE_IDS = {
    3: true,
    5: true,
    101: true
  };

  var ACADEMIC_ROLE_KEYWORDS = ["instructor", "teacher", "faculty", "assistant", "ta", "mentor"];
  var STUDENT_ROLE_KEYWORDS = ["student", "learner"];

  var state = {
    courses: [],
    courseMap: {},
    refsByCourse: {},
    currentRefs: emptyRefs(),
    currentTemplateId: "",
    templates: buildTemplates(),
    refsLoading: false,
    showAllHighlights: false,
    submitting: false
  };

  function emptyRefs() {
    return {
      assignments: [],
      quizzes: [],
      topics: [],
      contentTopics: [],
      checklists: [],
      gradeItems: [],
      studentRoleIds: [],
      studentRoleLabels: [],
      loadErrors: []
    };
  }

  function buildTemplates() {
    return [
      {
        id: "welcome",
        name: "Welcome Message",
        group: "Getting Started",
        icon: "fas fa-hand-sparkles",
        matchType: "Approximation",
        description: "Deploys a welcome-style agent using a recent course-access condition.",
        defaults: {
          agentName: "Welcome Message",
          agentDescription: "Send a personalized welcome email to students when they first access the course.",
          subject: "Welcome to {OrgUnitName}!",
          message: "Dear {InitiatingUserFirstName},\n\nWelcome to {OrgUnitName}! I'm excited to have you in this course this semester.\n\nThis course will cover [brief course description]. I encourage you to explore the course content and familiarize yourself with the course structure.\n\nIf you have any questions, please don't hesitate to reach out to me.\n\nBest regards,\n[Your Name]",
          scheduleType: "daily",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 1
        },
        fields: []
      },
      {
        id: "inactivity",
        name: "Inactivity Reminder",
        group: "Engagement",
        icon: "fas fa-user-clock",
        matchType: "Exact",
        description: "Targets students who have not accessed the course recently.",
        defaults: {
          agentName: "Inactivity Reminder",
          agentDescription: "Remind students who have not accessed the course recently.",
          subject: "We Miss You in {OrgUnitName}",
          message: "Dear {InitiatingUserFirstName},\n\nI noticed you haven't logged into {OrgUnitName} recently. Your last access was on {LastCourseAccessDate}.\n\nRegular participation is essential for success in this course. Please log in as soon as possible to catch up on any missed content and assignments.\n\nIf you're experiencing any issues accessing the course, please let me know.\n\nBest regards,\n[Your Name]",
          scheduleType: "weekly",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "not",
          courseConditionDays: 7
        },
        fields: []
      },
      {
        id: "no-access",
        name: "Hasn't Accessed Course in X Days",
        group: "Engagement",
        icon: "fas fa-door-open",
        matchType: "Exact",
        description: "Targets students who have not accessed the course in a configurable number of days.",
        defaults: {
          agentName: "Hasn't Accessed Course in X Days",
          agentDescription: "Remind students who have not accessed the course during a specified number of days.",
          subject: "We've missed you - you haven't logged in for a while",
          message: "Hello {InitiatingUserFirstName},\n\nIt seems you haven't logged into your course, {OrgUnitName}, on D2L Brightspace since {LastCourseAccessDate}.\n\nIt is important to check in to the course frequently so you do not fall behind or miss important information. With one quick click, you can access your course right from here: {LoginPath}. Why not go take a look now and see what is new?",
          scheduleType: "manual",
          actionTiming: "every",
          useCourseCondition: true,
          courseConditionType: "not",
          courseConditionDays: 7
        },
        fields: []
      },
      {
        id: "high-engagement",
        name: "High Engagement Recognition",
        group: "Encouragement",
        icon: "fas fa-trophy",
        matchType: "Exact",
        description: "Recognizes students who accessed the course recently.",
        defaults: {
          agentName: "High Engagement Recognition",
          agentDescription: "Recognize students who accessed the course recently.",
          subject: "Fantastic engagement - keep it up!",
          message: "Hello {InitiatingUserFirstName},\n\nWe just wanted to recognize your consistent engagement in {OrgUnitName}. Regular participation makes a big difference - nice work staying on top of your learning!",
          scheduleType: "weekly",
          actionTiming: "every",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 3
        },
        fields: []
      },
      {
        id: "low-grade",
        name: "Low Grade Alert",
        group: "Quizzes & Grades",
        icon: "fas fa-exclamation-triangle",
        matchType: "Exact",
        description: "Creates a grade-based release condition for a selected grade item.",
        defaults: {
          agentName: "Low Grade Alert",
          agentDescription: "Alert students when their grade falls below a threshold on a selected grade item.",
          subject: "Grade Alert for {OrgUnitName}",
          message: "Dear {InitiatingUserFirstName},\n\nI wanted to reach out regarding your recent grade in {OrgUnitName}. Your current performance is below the expected level.\n\nI encourage you to review the assignment feedback and reach out if you need additional support.\n\nBest regards,\n[Your Name]",
          scheduleType: "daily",
          actionTiming: "every"
        },
        fields: [
          { type: "gradeItem", name: "gradeItemId", label: "Grade item", required: true },
          { type: "operator", name: "gradeOperator", label: "Comparison", required: true, options: defaultScoreOperators("LessThan") },
          { type: "number", name: "gradeThreshold", label: "Threshold percent", required: true, min: 0, max: 100, step: 1, value: 70 }
        ]
      },
      {
        id: "high-quiz-score",
        name: "Earned 80% or Higher on Quiz",
        group: "Quizzes & Grades",
        icon: "fas fa-star",
        matchType: "Exact",
        description: "Recognizes learners who meet a selected quiz threshold.",
        defaults: {
          agentName: "Earned 80% or Higher on Quiz",
          agentDescription: "Recognize students who scored at or above a threshold on a selected quiz.",
          subject: "Outstanding Quiz Result",
          message: "Hello {InitiatingUserFirstName},\n\nEveryone should be recognized for their outstanding efforts, and you just knocked that quiz out of the park. Keep up the great work.",
          scheduleType: "manual",
          actionTiming: "every"
        },
        fields: [
          { type: "quiz", name: "quizId", label: "Quiz", required: true },
          { type: "operator", name: "quizOperator", label: "Comparison", required: true, options: defaultScoreOperators("GreaterThanOrEqual") },
          { type: "number", name: "quizThreshold", label: "Threshold percent", required: true, min: 0, max: 100, step: 1, value: 80 }
        ]
      },
      {
        id: "failed-quiz",
        name: "Failed a Quiz",
        group: "Quizzes & Grades",
        icon: "fas fa-circle-xmark",
        matchType: "Exact",
        description: "Targets learners who score below a selected quiz threshold.",
        defaults: {
          agentName: "Failed a Quiz",
          agentDescription: "Support students who did not meet the passing grade on a selected quiz.",
          subject: "Unsuccessful Quiz Attempt",
          message: "Hello {InitiatingUserFirstName},\n\nYou gave that quiz your best effort, but unfortunately you did not meet the passing grade. The upside is you can attempt the quiz again, but we recommend reviewing the course content first to help you be more successful when you try again.\n\nIf you have questions about the material, reach out to your instructor.",
          scheduleType: "manual",
          actionTiming: "first"
        },
        fields: [
          { type: "quiz", name: "quizId", label: "Quiz", required: true },
          { type: "operator", name: "quizOperator", label: "Comparison", required: true, options: defaultScoreOperators("LessThan") },
          { type: "number", name: "quizThreshold", label: "Threshold percent", required: true, min: 0, max: 100, step: 1, value: 70 }
        ]
      },
      {
        id: "multiple-low-quiz",
        name: "Multiple Low Quiz Scores",
        group: "Quizzes & Grades",
        icon: "fas fa-chart-bar",
        matchType: "Approximation",
        description: "Applies the same low-score rule to multiple selected quizzes using an all-conditions expression.",
        defaults: {
          agentName: "Multiple Low Quiz Scores",
          agentDescription: "Pattern-based encouragement for students who scored below threshold on multiple quizzes.",
          subject: "Let's strengthen your quiz results",
          message: "Hello {InitiatingUserFirstName},\n\nWe have noticed a pattern of lower quiz scores in {OrgUnitName}. This is a good time to pause, review materials, and reach out for help.\n\nTry revisiting the related content here: {LoginPath}\n\nYour instructor is available to support you.",
          scheduleType: "weekly",
          actionTiming: "first"
        },
        fields: [
          { type: "quizMultiple", name: "quizIds", label: "Quizzes", required: true },
          { type: "operator", name: "quizOperator", label: "Comparison", required: true, options: defaultScoreOperators("LessThan") },
          { type: "number", name: "quizThreshold", label: "Threshold percent", required: true, min: 0, max: 100, step: 1, value: 70 }
        ]
      },
      {
        id: "late-assignment",
        name: "Late Assignment",
        group: "Assignments",
        icon: "fas fa-clock",
        matchType: "Exact",
        description: "Targets learners who have not submitted to a selected assignment folder.",
        defaults: {
          agentName: "Late Assignment",
          agentDescription: "Notify students who have not submitted to a selected assignment folder.",
          subject: "Oops, you missed a deadline",
          message: "Hello {InitiatingUserFirstName},\n\nIt seems you have missed the deadline on an assignment. It is recommended that you finish and submit that assignment as soon as possible to avoid falling further behind in your course work.\n\nIf you have questions about the assignment, reach out to your instructor.",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "due-soon",
        name: "Assignment Due Soon",
        group: "Assignments",
        icon: "fas fa-bell",
        matchType: "Approximation",
        description: "Deploys a due-soon reminder using a no-submission condition for a selected folder; schedule timing remains instructor-controlled.",
        defaults: {
          agentName: "Assignment Due Soon",
          agentDescription: "Pre-deadline reminder for a selected assignment folder.",
          subject: "Reminder: assignment due soon",
          message: "Hello {InitiatingUserFirstName},\n\nThis is a friendly reminder that an assignment in {OrgUnitName} is coming due soon.\n\nSubmitting on time helps keep you on track. You can access your assignment here: {LoginPath}",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "multiple-missing",
        name: "Multiple Missing Assignments",
        group: "Assignments",
        icon: "fas fa-folder-open",
        matchType: "Exact",
        description: "Requires no submission on all selected assignment folders.",
        defaults: {
          agentName: "Multiple Missing Assignments",
          agentDescription: "Notify students who have not submitted to multiple assignment folders.",
          subject: "Several assignments still need submission",
          message: "Hello {InitiatingUserFirstName},\n\nIt looks like there are several assignments still awaiting submission in {OrgUnitName}. Completing these will help strengthen your overall progress.\n\nPlease log in here to review outstanding work: {LoginPath}\n\nReach out to your instructor if you need clarification or assistance.",
          scheduleType: "weekly",
          actionTiming: "every"
        },
        fields: [
          { type: "assignmentMultiple", name: "folderIds", label: "Assignment folders", required: true }
        ]
      },
      {
        id: "on-time-submission",
        name: "On-Time Assignment Submission",
        group: "Encouragement",
        icon: "fas fa-check-double",
        matchType: "Exact",
        description: "Recognizes learners who submit to a selected assignment folder.",
        defaults: {
          agentName: "On-Time Assignment Submission",
          agentDescription: "Thank students for submitting to the selected assignment folder.",
          subject: "Thanks for submitting on time!",
          message: "Hello {InitiatingUserFirstName},\n\nThank you for submitting your assignment on time in {OrgUnitName}. Staying on schedule helps keep your learning on track.\n\nNice work - keep it going.",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "received-feedback",
        name: "Received Feedback on an Assignment",
        group: "Discussions & Feedback",
        icon: "fas fa-comment-dots",
        matchType: "Exact",
        description: "Targets learners who received feedback on a selected assignment folder.",
        defaults: {
          agentName: "Received Feedback on an Assignment",
          agentDescription: "Alert students when they receive feedback on a selected assignment.",
          subject: "You've received feedback",
          message: "Hello {InitiatingUserFirstName},\n\nYour instructor has graded your assignment and provided you with feedback. Log in to your Brightspace course now {LoginPath} and check your notifications in the navigation bar at the top of the page to see how you did.",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "no-discussion-posts",
        name: "No Posts Authored in Discussion Topic",
        group: "Discussions & Feedback",
        icon: "fas fa-comments",
        matchType: "Exact",
        description: "Targets learners who have not posted in a selected discussion topic.",
        defaults: {
          agentName: "No Posts Authored in Discussion Topic",
          agentDescription: "Encourage students who have not posted in a selected discussion topic to participate.",
          subject: "It's time to share your insights.",
          message: "Hello {InitiatingUserFirstName},\n\nAs part of your course, there is a discussion currently underway that you have not yet posted in. Your classmates want to know what you have to say on the topic, so be sure to take some time to pop into the course {LoginPath}, see what has already been said, and contribute to the discussion.",
          scheduleType: "weekly",
          actionTiming: "first"
        },
        fields: [
          { type: "discussionTopic", name: "discussionTopicId", label: "Discussion topic", required: true }
        ]
      },
      {
        id: "content",
        name: "Content View Reminder",
        group: "Checklists & Content",
        icon: "fas fa-book-open",
        matchType: "Exact",
        description: "Targets learners who have not viewed a selected content topic.",
        defaults: {
          agentName: "Content View Reminder",
          agentDescription: "Remind students to review a selected content topic.",
          subject: "Important Content in {OrgUnitName}",
          message: "Dear {InitiatingUserFirstName},\n\nThis is a reminder to review an important content item in {OrgUnitName}. This material is essential for upcoming assignments and assessments.\n\nIf you have questions about the content, please reach out.\n\nBest regards,\n[Your Name]",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "contentTopic", name: "topicId", label: "Content topic", required: true }
        ]
      },
      {
        id: "course-progress",
        name: "Course Progress Milestone",
        group: "Course Progress & Milestones",
        icon: "fas fa-flag-checkered",
        matchType: "Exact",
        description: "Recognizes students when they visit a selected milestone topic.",
        defaults: {
          agentName: "Course Progress Milestone",
          agentDescription: "Celebrate when students reach a selected milestone topic.",
          subject: "You're almost to the finish line!",
          message: "Hello {InitiatingUserFirstName},\n\nWell done, you have reached a major milestone in your course. Keep working hard through this stretch. The satisfaction of completion is within your reach.",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "contentTopic", name: "topicId", label: "Milestone content topic", required: true }
        ]
      },
      {
        id: "completion-congrats",
        name: "Course Completion Congratulations",
        group: "Course Progress & Milestones",
        icon: "fas fa-graduation-cap",
        matchType: "Exact",
        description: "Celebrates learners when they visit a selected final content topic.",
        defaults: {
          agentName: "Course Completion Congratulations",
          agentDescription: "Celebrate when students visit a selected final content topic.",
          subject: "Congratulations on completing your course!",
          message: "Hello {InitiatingUserFirstName},\n\nCongratulations on completing {OrgUnitName}! Finishing a course takes dedication, persistence, and effort - well done.\n\nBe proud of what you accomplished!",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "contentTopic", name: "topicId", label: "Final content topic", required: true }
        ]
      },
      {
        id: "incomplete-checklist",
        name: "Incomplete Tasks on a Checklist",
        group: "Checklists & Content",
        icon: "fas fa-tasks",
        matchType: "Exact",
        description: "Targets learners who have not completed a selected checklist.",
        defaults: {
          agentName: "Incomplete Tasks on a Checklist",
          agentDescription: "Notify students about incomplete tasks on a selected checklist.",
          subject: "Incomplete tasks requiring your attention",
          message: "Hello {InitiatingUserFirstName},\n\nIn an effort to help keep you on track, we noticed there are some items on your course checklist that you have not yet completed. For your success, take a few minutes to look through the list and see what tasks you still need to complete before the end of your course.\n\nIf you have questions about any of the tasks, be sure to reach out to your instructor.",
          scheduleType: "weekly",
          actionTiming: "every"
        },
        fields: [
          { type: "checklist", name: "checklistId", label: "Checklist", required: true }
        ]
      },
      {
        id: "completed-checklist",
        name: "Completed All Tasks on a Checklist",
        group: "Checklists & Content",
        icon: "fas fa-check-circle",
        matchType: "Exact",
        description: "Celebrates learners who complete a selected checklist.",
        defaults: {
          agentName: "Completed All Tasks on a Checklist",
          agentDescription: "Celebrate students who have completed all tasks on a selected checklist.",
          subject: "You crushed that checklist!",
          message: "Hello {InitiatingUserFirstName},\n\nTime management and getting all your tasks done are no challenge for you. You have successfully finished all the items on your checklist. Keep up the hard work.",
          scheduleType: "weekly",
          actionTiming: "first"
        },
        fields: [
          { type: "checklist", name: "checklistId", label: "Checklist", required: true }
        ]
      },
      {
        id: "never-accessed",
        name: "Never Accessed Course",
        group: "Getting Started",
        icon: "fas fa-exclamation-triangle",
        matchType: "Approximation",
        description: "Early alert for students who have not accessed the course in a long window (Brightspace has no true never-accessed API condition).",
        defaults: {
          agentName: "Never Accessed Course",
          agentDescription: "Alert students who have not accessed the course yet.",
          subject: "Important — you haven't accessed your course yet",
          message: "Hello {InitiatingUserFirstName},\n\nOur records show you haven't accessed {OrgUnitName} yet. Getting started early is key to success.\n\nPlease log in immediately using this link: {LoginPath}\n\nIf you have technical issues, contact support or your instructor right away.",
          scheduleType: "daily",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "not",
          courseConditionDays: 120,
          scheduleEndDays: 7
        },
        fields: []
      },
      {
        id: "strong-start",
        name: "Strong Course Start",
        group: "Getting Started",
        icon: "fas fa-rocket",
        matchType: "Exact",
        description: "Encourages students who accessed the course and completed a first-week assignment and discussion.",
        defaults: {
          agentName: "Strong Course Start",
          agentDescription: "First-week encouragement for students who accessed the course, submitted an assignment, and posted in a discussion.",
          subject: "Fantastic start!",
          message: "Hello {InitiatingUserFirstName},\n\nYou're off to a great start in {OrgUnitName}. Getting involved early sets you up for success throughout the course.\n\nKeep up the strong work!",
          scheduleType: "daily",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 7,
          scheduleEndDays: 7
        },
        fields: [
          { type: "assignment", name: "folderId", label: "First-week assignment folder", required: true },
          { type: "discussionTopic", name: "discussionTopicId", label: "First-week discussion topic", required: true }
        ]
      },
      {
        id: "assignment",
        name: "Assignment Due Reminder",
        group: "Assignments",
        icon: "fas fa-calendar-check",
        matchType: "Approximation",
        description: "Reminds students who have not submitted to a selected assignment folder. Set the schedule to start before the due date.",
        defaults: {
          agentName: "Assignment Due Reminder",
          agentDescription: "Send reminders about an upcoming assignment due date.",
          subject: "Upcoming Assignment in {OrgUnitName}",
          message: "Dear {InitiatingUserFirstName},\n\nThis is a friendly reminder that you have an upcoming assignment due in {OrgUnitName}.\n\nPlease make sure to submit your work on time. If you have any questions about the assignment, don't hesitate to ask.\n\nBest regards,\n[Your Name]",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "encouragement",
        name: "Encouragement Message",
        group: "Encouragement",
        icon: "fas fa-heart",
        matchType: "Exact",
        description: "Recognizes students who score at or above a threshold on a selected grade item.",
        defaults: {
          agentName: "Encouragement Message",
          agentDescription: "Send positive reinforcement to students performing well on a selected grade item.",
          subject: "Great Work in {OrgUnitName}!",
          message: "Dear {InitiatingUserFirstName},\n\nI wanted to take a moment to recognize your excellent work in {OrgUnitName}! Your dedication and effort are truly appreciated.\n\nKeep up the great work, and continue to engage actively in the course.\n\nBest regards,\n[Your Name]",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "gradeItem", name: "gradeItemId", label: "Grade item", required: true },
          { type: "operator", name: "gradeOperator", label: "Comparison", required: true, options: defaultScoreOperators("GreaterThanOrEqual") },
          { type: "number", name: "gradeThreshold", label: "Threshold percent", required: true, min: 0, max: 100, step: 1, value: 80 }
        ]
      },
      {
        id: "sudden-drop",
        name: "Sudden Decrease in Course Activity",
        group: "Engagement",
        icon: "fas fa-chart-line",
        matchType: "Exact",
        description: "Checks in with students who accessed recently but have not submitted or posted.",
        defaults: {
          agentName: "Sudden Decrease in Course Activity",
          agentDescription: "Check in with students who accessed the course recently but have no assignment or discussion activity.",
          subject: "Checking in — we noticed reduced activity",
          message: "Hello {InitiatingUserFirstName},\n\nWe noticed you've been less active recently in {OrgUnitName}. If something is getting in the way of your coursework, now is a great time to reconnect.\n\nLog back into your course here: {LoginPath}\n\nIf you're experiencing challenges, please contact your instructor. They're here to help.",
          scheduleType: "weekly",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 14
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder to check", required: true },
          { type: "discussionTopic", name: "discussionTopicId", label: "Discussion topic to check", required: true }
        ]
      },
      {
        id: "no-submissions",
        name: "Accessed Course but No Submissions",
        group: "Engagement",
        icon: "fas fa-user-check",
        matchType: "Exact",
        description: "Targets students who accessed the course but have not submitted or posted.",
        defaults: {
          agentName: "Accessed Course but No Submissions",
          agentDescription: "Encourage students who have been visiting but have not participated in an assignment or discussion.",
          subject: "You've been visiting — now let's get started",
          message: "Hello {InitiatingUserFirstName},\n\nWe see you've been logging into {OrgUnitName}, which is a great first step. The next step is participating in course activities.\n\nTake a moment to review your assignments and discussions here: {LoginPath}\n\nIf you're unsure where to begin, your instructor is happy to help.",
          scheduleType: "weekly",
          actionTiming: "first",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 7
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder to check", required: true },
          { type: "discussionTopic", name: "discussionTopicId", label: "Discussion topic to check", required: true }
        ]
      },
      {
        id: "midpoint-progress",
        name: "Midpoint Course Progress",
        group: "Course Progress & Milestones",
        icon: "fas fa-compass",
        matchType: "Exact",
        description: "Recognizes students when they visit a selected midpoint content topic.",
        defaults: {
          agentName: "Midpoint Course Progress",
          agentDescription: "Celebrate when students reach the midpoint content topic.",
          subject: "You're halfway there!",
          message: "Hello {InitiatingUserFirstName},\n\nGreat job—you've reached the midpoint of {OrgUnitName}. This is a perfect time to review your progress and plan for the remainder of the course.\n\nKeep up the momentum! Access your course here: {LoginPath}",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "contentTopic", name: "topicId", label: "Midpoint content topic", required: true }
        ]
      },
      {
        id: "consistent-engagement",
        name: "Consistent Weekly Engagement",
        group: "Encouragement",
        icon: "fas fa-calendar-week",
        matchType: "Exact",
        description: "Recognizes students who accessed recently and completed an assignment and discussion post.",
        defaults: {
          agentName: "Consistent Weekly Engagement",
          agentDescription: "Reward habit building for students who accessed, submitted, and posted in the past week.",
          subject: "Nice work staying engaged!",
          message: "Hello {InitiatingUserFirstName},\n\nGreat job staying actively engaged in {OrgUnitName} this week. Logging in, participating, and submitting work consistently makes a big difference in learning success.\n\nKeep up the great momentum!",
          scheduleType: "weekly",
          actionTiming: "every",
          useCourseCondition: true,
          courseConditionType: "yes",
          courseConditionDays: 7
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true },
          { type: "discussionTopic", name: "discussionTopicId", label: "Discussion topic", required: true }
        ]
      },
      {
        id: "feedback-no-followup",
        name: "Feedback Viewed, No Follow-Up Submission",
        group: "Discussions & Feedback",
        icon: "fas fa-comment-medical",
        matchType: "Approximation",
        description: "Encourages acting on assignment feedback. Brightspace cannot detect a missing resubmission, so this uses the received-feedback condition.",
        defaults: {
          agentName: "Feedback Viewed, No Follow-Up Submission",
          agentDescription: "Encourage students who received assignment feedback to apply it.",
          subject: "Ready to apply your feedback?",
          message: "Hello {InitiatingUserFirstName},\n\nYou've received feedback on your recent assignment. Applying that feedback can significantly improve your results.\n\nWe encourage you to review the comments and resubmit if allowed: {LoginPath}\n\nLet your instructor know if you'd like clarification.",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "improvement-after-feedback",
        name: "Improvement After Feedback",
        group: "Encouragement",
        icon: "fas fa-arrow-trend-up",
        matchType: "Approximation",
        description: "Celebrates students who received feedback and have a submission on the same folder.",
        defaults: {
          agentName: "Improvement After Feedback",
          agentDescription: "Celebrate students who received feedback and submitted to the same assignment folder.",
          subject: "Great job applying feedback!",
          message: "Hello {InitiatingUserFirstName},\n\nWe noticed you reviewed your feedback and submitted an updated assignment — that's exactly how learning improves.\n\nExcellent work applying what you learned!",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "assignment", name: "folderId", label: "Assignment folder", required: true }
        ]
      },
      {
        id: "final-week",
        name: "Final Week Completion Reminder",
        group: "Course Progress & Milestones",
        icon: "fas fa-medal",
        matchType: "Exact",
        description: "Reminds students who visited a final-module topic but have not submitted the final assignment.",
        defaults: {
          agentName: "Final Week Completion Reminder",
          agentDescription: "Final stretch reminder for students who viewed the final module but have not submitted the final assignment.",
          subject: "Final stretch — you're almost there",
          message: "Hello {InitiatingUserFirstName},\n\nYou're in the final stretch of {OrgUnitName}. Completing your remaining work now will help ensure a successful finish.\n\nReview what's left here: {LoginPath}\n\nFinish strong!",
          scheduleType: "daily",
          actionTiming: "first"
        },
        fields: [
          { type: "contentTopic", name: "topicId", label: "Final module content topic", required: true },
          { type: "assignment", name: "folderId", label: "Final assignment folder", required: true }
        ]
      }
    ];
  }

  function defaultScoreOperators(defaultValue) {
    var selectedValue = String(defaultValue || "");
    return [
      { value: "GreaterThanOrEqual", label: "Greater than or equal to" },
      { value: "GreaterThan", label: "Greater than" },
      { value: "LessThanOrEqual", label: "Less than or equal to" },
      { value: "LessThan", label: "Less than" },
      { value: "EqualTo", label: "Equal to" },
      { value: "NotEqualTo", label: "Not equal to" }
    ].map(function (item) {
      item.selected = item.value === selectedValue;
      return item;
    });
  }

  // Brightspace quiz/grade release conditions reject PascalCase operator names
  // (GreaterThanOrEqual) and expect the same symbols as the Brightspace UI.
  function toScoreOperator(value) {
    var raw = String(value || "").trim();
    var aliases = {
      GreaterThanOrEqual: ">=",
      GreaterThanEqual: ">=",
      GreaterThanOrEqualTo: ">=",
      GreaterThan: ">",
      LessThanOrEqual: "<=",
      LessThanEqual: "<=",
      LessThanOrEqualTo: "<=",
      LessThan: "<",
      EqualTo: "=",
      Equals: "=",
      NotEqualTo: "!=",
      NotEqual: "!=",
      "Not Between": "NotBetween"
    };
    return aliases[raw] || raw;
  }

  function init() {
    console.info("IA deployer build " + DEPLOYER_BUILD);
    bindEvents();
    renderTemplateOptions();
    renderDynamicTemplateFields(null, state.currentRefs);
    toggleDateConditionUI();
    toggleScheduleDetails();
    loadCourses();
    updatePlan();
  }

  function bindEvents() {
    document.getElementById("deployCourse").addEventListener("change", onCourseChange);
    document.getElementById("deployTemplate").addEventListener("change", onTemplateChange);
    document.getElementById("agentDeployForm").addEventListener("submit", onSubmit);
    document.getElementById("resetDeployForm").addEventListener("click", resetForm);
    document.getElementById("deploymentPlan").addEventListener("click", onReadinessJump);

    var ids = [
      "deployAgentName", "deployAgentDescription", "deployAgentEnabled", "deployEmailTo", "deployEmailCc",
      "deployEmailBcc", "deployEmailSubject", "deployEmailMessage", "deployEmailIsHtml", "limitToStudents",
      "scheduleType", "scheduleStart", "scheduleEnd", "scheduleRepeatsEvery", "scheduleMonthDay", "scheduleYearMonth",
      "runPracticeAfterCreate", "useLoginCondition", "useCourseCondition", "loginConditionDays", "courseConditionDays"
    ];

    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) {
        el.addEventListener("input", updatePlan);
        el.addEventListener("change", updatePlan);
      }
    }

    var radios = document.querySelectorAll("input[name='deployActionTiming'], input[name='loginConditionType'], input[name='courseConditionType']");
    for (var j = 0; j < radios.length; j++) {
      radios[j].addEventListener("change", updatePlan);
    }

    document.getElementById("useLoginCondition").addEventListener("change", toggleDateConditionUI);
    document.getElementById("useCourseCondition").addEventListener("change", toggleDateConditionUI);
    document.getElementById("scheduleType").addEventListener("change", toggleScheduleDetails);

    var weekdayBoxes = document.querySelectorAll("[data-weekday]");
    for (var k = 0; k < weekdayBoxes.length; k++) {
      weekdayBoxes[k].addEventListener("change", updatePlan);
    }
  }

  async function loadCourses() {
    var select = document.getElementById("deployCourse");
    select.innerHTML = '<option value="">Loading your courses...</option>';
    setMessage("deployMessage", "", "");
    updatePlan();
    try {
      var courses = await getMyCourseOfferings();
      state.courses = courses;
      state.courseMap = {};
      for (var i = 0; i < courses.length; i++) {
        state.courseMap[courses[i].OrgUnitId] = courses[i];
      }

      select.innerHTML = '<option value="">Choose a course...</option>';
      for (var j = 0; j < courses.length; j++) {
        appendOption(select, courses[j].OrgUnitId, courses[j].Code + " - " + courses[j].Name);
      }
      if (!courses.length) {
        select.innerHTML = '<option value="">No eligible courses found</option>';
        setMessage("deployMessage", "No current faculty course offerings were found for this deployer.", "error");
      }
    } catch (e) {
      console.error("IA deployer: failed to load courses", e);
      select.innerHTML = '<option value="">Failed to load courses</option>';
      setMessage("deployMessage", "Unable to load your courses from Brightspace right now.", "error");
    }
    updatePlan();
  }

  function onTemplateChange() {
    var template = getCurrentTemplate();
    if (!template) {
      document.getElementById("dynamicTemplateFields").innerHTML = "";
      hideTemplateSummary();
      updatePlan();
      return;
    }
    applyTemplateDefaults(template);
    renderTemplateSummary(template);
    renderDynamicTemplateFields(template, state.currentRefs);
    updatePlan();
  }

  async function onCourseChange() {
    var courseId = document.getElementById("deployCourse").value;
    state.currentRefs = emptyRefs();
    state.refsLoading = !!courseId;
    renderDynamicTemplateFields(getCurrentTemplate(), state.currentRefs);
    renderReferenceSummary(state.currentRefs);
    updateStudentRoleSummary(state.currentRefs);
    updatePlan();

    if (!courseId) {
      state.refsLoading = false;
      updatePlan();
      return;
    }

    setMessage("deployMessage", "Loading Brightspace items for the selected course...", "success");
    try {
      if (!state.refsByCourse[courseId]) {
        state.refsByCourse[courseId] = await loadCourseReferences(courseId);
      }
      state.currentRefs = state.refsByCourse[courseId];
      renderReferenceSummary(state.currentRefs);
      updateStudentRoleSummary(state.currentRefs);
      renderDynamicTemplateFields(getCurrentTemplate(), state.currentRefs);
      if (state.currentRefs.loadErrors.length) {
        setMessage("deployMessage", "Course items loaded with some gaps: " + state.currentRefs.loadErrors.join(" | "), "error");
      } else {
        setMessage("deployMessage", "Course items loaded from Brightspace.", "success");
      }
    } catch (e) {
      console.error("IA deployer: failed to load course references", e);
      state.currentRefs = emptyRefs();
      renderReferenceSummary(state.currentRefs);
      updateStudentRoleSummary(state.currentRefs);
      renderDynamicTemplateFields(getCurrentTemplate(), state.currentRefs);
      setMessage("deployMessage", "Unable to load the selected course's assignments, quizzes, discussions, content, checklists, and grade items.", "error");
    }
    state.refsLoading = false;
    updatePlan();
  }

  async function onSubmit(event) {
    event.preventDefault();
    setMessage("deployMessage", "", "");

    var template = getCurrentTemplate();
    var courseId = document.getElementById("deployCourse").value;
    var validation = validateForm(template, state.currentRefs);
    if (!courseId || !template || !validation.ok) {
      state.showAllHighlights = true;
      updatePlan();
      var firstIssue = validation.issues && validation.issues[0];
      var summary = firstIssue
        ? firstIssue.message + (validation.issues.length > 1 ? " (" + validation.issues.length + " items still need attention.)" : "")
        : "Choose a course and a template, then complete the highlighted fields.";
      setMessage("deployMessage", summary, "error");
      focusField(firstIssue && firstIssue.fieldId, true);
      return;
    }

    var deployBtn = document.getElementById("deployAgentBtn");
    var originalText = deployBtn.innerHTML;
    state.submitting = true;
    setCreateButtonState(false, true);
    deployBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Creating agent...';

    try {
      var payload = buildAgentPayload(template, state.currentRefs);
      var createUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/agents";
      var created = await BrightspaceFetchJson(createUrl, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      var agentId = created && created.AgentId;
      if (!agentId) {
        throw new Error("Brightspace did not return an AgentId.");
      }

      var releaseConditions = buildReleaseConditions(template, state.currentRefs);
      var conditionsApplied = !releaseConditions;
      if (releaseConditions) {
        var releaseUrl = "/d2l/api/lp/" + API_VERSION_LP + "/" + encodeURIComponent(courseId) + "/conditionalRelease/conditions/intelligentAgents/" + encodeURIComponent(agentId);
        try {
          await BrightspaceFetchJson(releaseUrl, {
            method: "PUT",
            body: JSON.stringify(releaseConditions)
          });
          conditionsApplied = true;
        } catch (releaseErr) {
          var releaseStatus = releaseErr && releaseErr.status;
          var releaseMsg = releaseErr && releaseErr.message ? String(releaseErr.message) : "";
          var emptySuccessBody = !releaseStatus || releaseStatus === 200 || /JSON\.parse|unexpected end of data/i.test(releaseMsg);
          if (emptySuccessBody && releaseStatus !== 400 && releaseStatus !== 403 && releaseStatus !== 404) {
            conditionsApplied = true;
          } else {
            var leftoverNote = "";
            try {
              await BrightspaceFetchJson(
                "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/agents/" + encodeURIComponent(agentId),
                { method: "DELETE" }
              );
            } catch (deleteErr) {
              console.error("IA deployer: could not remove incomplete agent", deleteErr);
              leftoverNote = " The agent was created (ID " + agentId + ") without its release conditions. Delete that incomplete agent in Brightspace before trying again.";
            }
            throw new Error((releaseMsg || "Unknown Brightspace error.") + leftoverNote);
          }
        }
      }

      var practiceRunRequested = document.getElementById("runPracticeAfterCreate").checked;
      if (practiceRunRequested) {
        var runUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/agents/" + encodeURIComponent(agentId) + "/runs";
        await BrightspaceFetchJson(runUrl, {
          method: "POST",
          body: JSON.stringify({ RunNowType: 0 })
        });
      }

      var course = state.courseMap[courseId];
      var resultParts = [
        "Created Intelligent Agent <strong>" + escapeHtml(created.Name || document.getElementById("deployAgentName").value || template.name) + "</strong>",
        "in <strong>" + escapeHtml(course ? course.Code : courseId) + "</strong>."
      ];
      resultParts.push("Agent ID: <strong>" + escapeHtml(String(agentId)) + "</strong>.");
      if (releaseConditions) resultParts.push(conditionsApplied ? "Release conditions were applied." : "The agent was created, but release conditions may still need to be checked in Brightspace.");
      if (practiceRunRequested) resultParts.push("A practice run was queued.");
      setMessage("deployMessage", resultParts.join(" "), "success", true);
    } catch (e) {
      console.error("IA deployer: create failed", e);
      var msg = e && e.message ? e.message : "Unknown Brightspace error.";
      setMessage("deployMessage", "Brightspace could not create this Intelligent Agent. " + escapeHtml(msg), "error", true);
    } finally {
      state.submitting = false;
      deployBtn.innerHTML = originalText;
      updatePlan();
    }
  }

  function renderTemplateOptions() {
    var select = document.getElementById("deployTemplate");
    select.innerHTML = '<option value="">Choose a template...</option>';
    var grouped = {};
    for (var i = 0; i < state.templates.length; i++) {
      var template = state.templates[i];
      if (!grouped[template.group]) grouped[template.group] = [];
      grouped[template.group].push(template);
    }
    var groupNames = Object.keys(grouped);
    for (var j = 0; j < groupNames.length; j++) {
      var optgroup = document.createElement("optgroup");
      optgroup.label = groupNames[j];
      for (var k = 0; k < grouped[groupNames[j]].length; k++) {
        appendOption(optgroup, grouped[groupNames[j]][k].id, grouped[groupNames[j]][k].name);
      }
      select.appendChild(optgroup);
    }
  }

  function renderTemplateSummary(template) {
    var summary = document.getElementById("templateSummary");
    summary.classList.remove("agent-deployer-hidden");
    summary.innerHTML =
      '<div class="agent-deployer-summary-title"><i class="' + escapeHtml(template.icon) + '" aria-hidden="true"></i> ' + escapeHtml(template.name) + '</div>' +
      '<div class="agent-deployer-summary-meta"><span class="agent-deployer-pill">' + escapeHtml(template.group) + '</span>' +
      '<span class="agent-deployer-pill">' + escapeHtml(template.matchType) + " deployment" + "</span></div>" +
      '<p>' + escapeHtml(template.description) + '</p>';
  }

  function hideTemplateSummary() {
    var summary = document.getElementById("templateSummary");
    summary.classList.add("agent-deployer-hidden");
    summary.innerHTML = "";
  }

  function applyTemplateDefaults(template) {
    var defaults = template.defaults || {};
    document.getElementById("deployAgentName").value = defaults.agentName || "";
    document.getElementById("deployAgentDescription").value = defaults.agentDescription || "";
    document.getElementById("deployEmailSubject").value = defaults.subject || "";
    document.getElementById("deployEmailMessage").value = defaults.message || "";
    document.getElementById("scheduleType").value = defaults.scheduleType || "manual";
    document.getElementById("deployActionFirst").checked = (defaults.actionTiming || "first") === "first";
    document.getElementById("deployActionEvery").checked = (defaults.actionTiming || "first") === "every";

    document.getElementById("useLoginCondition").checked = !!defaults.useLoginCondition;
    document.getElementById("useCourseCondition").checked = !!defaults.useCourseCondition;
    document.getElementById("loginConditionNot").checked = (defaults.loginConditionType || "not") === "not";
    document.getElementById("loginConditionYes").checked = (defaults.loginConditionType || "not") === "yes";
    document.getElementById("courseConditionNot").checked = (defaults.courseConditionType || "not") === "not";
    document.getElementById("courseConditionYes").checked = (defaults.courseConditionType || "not") === "yes";
    document.getElementById("loginConditionDays").value = defaults.loginConditionDays || 7;
    document.getElementById("courseConditionDays").value = defaults.courseConditionDays || 7;

    var startInput = document.getElementById("scheduleStart");
    startInput.value = defaultDateTimeLocal(24);
    var endInput = document.getElementById("scheduleEnd");
    if (defaults.scheduleEndDays) {
      endInput.value = defaultDateTimeLocal(24 + defaults.scheduleEndDays * 24);
    } else {
      endInput.value = "";
    }

    document.getElementById("scheduleRepeatsEvery").value = 1;
    document.getElementById("scheduleMonthDay").value = 1;
    document.getElementById("scheduleYearMonth").value = 1;

    var weekdays = document.querySelectorAll("[data-weekday]");
    for (var i = 0; i < weekdays.length; i++) {
      weekdays[i].checked = weekdays[i].value === "Monday";
    }
    toggleDateConditionUI();
    toggleScheduleDetails();
  }

  function renderDynamicTemplateFields(template, refs) {
    var container = document.getElementById("dynamicTemplateFields");
    var section = document.getElementById("templateDetailsSection");
    var desc = section ? section.querySelector(".builder-section-desc") : null;
    var requiredMark = section ? section.querySelector(".agent-required-mark") : null;
    container.innerHTML = "";
    if (section) section.classList.remove("agent-section-needs-attention");

    if (!template) {
      if (desc) desc.textContent = "Choose a template to see which course items Brightspace needs for this agent.";
      if (requiredMark) requiredMark.style.display = "none";
      container.innerHTML = '<p class="form-hint">Choose a template to see which course items Brightspace needs for this agent.</p>';
      return;
    }

    if (!template.fields.length) {
      if (desc) desc.textContent = "This template does not need extra course item selection. Its criteria come from the login/course activity controls below.";
      if (requiredMark) requiredMark.style.display = "none";
      container.innerHTML = '<p class="form-hint">This template does not need extra course item selection. Its criteria come from the login/course activity controls below.</p>';
      return;
    }

    if (desc) desc.textContent = "Brightspace needs a specific assignment, quiz, discussion, or other course item for this template. Choose each required item here before creating the agent.";
    if (requiredMark) requiredMark.style.display = "";

    var intro = document.createElement("p");
    intro.className = "form-hint";
    intro.innerHTML = "Select every item marked <span class=\"agent-required-mark\" aria-hidden=\"true\">*</span>. The agent cannot be created until these are filled.";
    container.appendChild(intro);

    for (var i = 0; i < template.fields.length; i++) {
      container.appendChild(renderField(template.fields[i], refs));
    }
  }

  function renderField(field, refs) {
    var wrap = document.createElement("div");
    wrap.className = "form-group";
    wrap.setAttribute("data-agent-field-group", field.name);
    var label = document.createElement("label");
    label.className = "form-label";
    label.setAttribute("for", "dyn-" + field.name);
    label.innerHTML = escapeHtml(field.label) + (field.required ? ' <span class="agent-required-mark" title="Required">*</span>' : "");
    wrap.appendChild(label);

    var input;
    if (field.type === "number") {
      input = document.createElement("input");
      input.type = "number";
      input.className = "form-input";
      input.id = "dyn-" + field.name;
      input.value = field.value != null ? field.value : "";
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      if (field.step != null) input.step = field.step;
    } else if (field.type === "operator") {
      input = document.createElement("select");
      input.className = "form-select";
      input.id = "dyn-" + field.name;
      var opts = field.options || [];
      for (var i = 0; i < opts.length; i++) {
        appendOption(input, opts[i].value, opts[i].label, opts[i].selected);
      }
    } else if (field.type === "quiz") {
      input = buildSelect("dyn-" + field.name, refs.quizzes, false, "Select a quiz...");
    } else if (field.type === "gradeItem") {
      input = buildSelect("dyn-" + field.name, refs.gradeItems, false, "Select a grade item...");
    } else if (field.type === "assignment") {
      input = buildSelect("dyn-" + field.name, refs.assignments, false, "Select an assignment folder...");
    } else if (field.type === "assignmentMultiple") {
      input = buildSelect("dyn-" + field.name, refs.assignments, true, "Select assignment folders...");
    } else if (field.type === "quizMultiple") {
      input = buildSelect("dyn-" + field.name, refs.quizzes, true, "Select quizzes...");
    } else if (field.type === "discussionTopic") {
      input = buildDiscussionSelect("dyn-" + field.name, refs.topics);
    } else if (field.type === "contentTopic") {
      input = buildSelect("dyn-" + field.name, refs.contentTopics, false, "Select a content topic...");
    } else if (field.type === "checklist") {
      input = buildSelect("dyn-" + field.name, refs.checklists, false, "Select a checklist...");
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.className = "form-input";
      input.id = "dyn-" + field.name;
    }

    input.addEventListener("input", updatePlan);
    input.addEventListener("change", updatePlan);
    if (field.required) input.setAttribute("aria-required", "true");
    wrap.appendChild(input);

    var itemList = itemsForFieldType(field, refs);
    var courseSelected = !!document.getElementById("deployCourse").value;
    if (courseSelected && itemList && !itemList.length && !state.refsLoading) {
      var emptyHint = document.createElement("p");
      emptyHint.className = "form-hint agent-empty-items-hint";
      emptyHint.textContent = emptyItemsMessage(field.type);
      wrap.appendChild(emptyHint);
    }

    if (field.type === "assignmentMultiple" || field.type === "quizMultiple") {
      var hint = document.createElement("p");
      hint.className = "form-hint";
      hint.textContent = "Hold Command/Ctrl to select more than one item.";
      wrap.appendChild(hint);
    }
    return wrap;
  }

  function buildSelect(id, items, multiple, placeholder) {
    var select = document.createElement("select");
    select.className = "form-select";
    select.id = id;
    if (multiple) {
      select.multiple = true;
      select.size = Math.min(8, Math.max(4, items.length || 4));
    } else {
      appendOption(select, "", placeholder || "Choose...");
    }
    for (var i = 0; i < items.length; i++) {
      appendOption(select, items[i].value, items[i].label);
    }
    return select;
  }

  function buildDiscussionSelect(id, items) {
    var select = document.createElement("select");
    select.className = "form-select";
    select.id = id;
    appendOption(select, "", "Select a discussion topic...");
    for (var i = 0; i < items.length; i++) {
      var option = document.createElement("option");
      option.value = items[i].value;
      option.textContent = items[i].label;
      option.setAttribute("data-forum-id", items[i].forumId);
      option.setAttribute("data-topic-id", items[i].topicId);
      select.appendChild(option);
    }
    return select;
  }

  function renderReferenceSummary(refs) {
    document.getElementById("summaryAssignments").textContent = String(refs.assignments.length);
    document.getElementById("summaryQuizzes").textContent = String(refs.quizzes.length);
    document.getElementById("summaryTopics").textContent = String(refs.topics.length);
    document.getElementById("summaryContent").textContent = String(refs.contentTopics.length);
    document.getElementById("summaryChecklists").textContent = String(refs.checklists.length);
    document.getElementById("summaryGradeItems").textContent = String(refs.gradeItems.length);
  }

  function updateStudentRoleSummary(refs) {
    var summary = document.getElementById("studentRoleSummary");
    if (!refs.studentRoleIds.length) {
      summary.textContent = "No student roles detected yet. The agent can still be created for all roles in the classlist.";
      return;
    }
    summary.textContent = "Student roles detected: " + refs.studentRoleLabels.join(", ");
  }

  function toggleDateConditionUI() {
    document.getElementById("loginConditionOptions").style.display = document.getElementById("useLoginCondition").checked ? "block" : "none";
    document.getElementById("courseConditionOptions").style.display = document.getElementById("useCourseCondition").checked ? "block" : "none";
  }

  function toggleScheduleDetails() {
    var type = document.getElementById("scheduleType").value;
    toggleElements(".agent-deployer-weekly", type === "weekly");
    toggleElements(".agent-deployer-monthly", type === "monthly" || type === "annually");
    toggleElements(".agent-deployer-annually", type === "annually");
  }

  function toggleElements(selector, show) {
    var elements = document.querySelectorAll(selector);
    for (var i = 0; i < elements.length; i++) {
      elements[i].style.display = show ? "block" : "none";
    }
  }

  function validateForm(template, refs) {
    var issues = collectReadinessIssues(template, refs);
    return {
      ok: issues.length === 0,
      message: issues.length ? issues[0].message : "",
      issues: issues
    };
  }

  function collectReadinessIssues(template, refs) {
    template = template || getCurrentTemplate();
    refs = refs || state.currentRefs;
    var issues = [];
    var courseId = document.getElementById("deployCourse").value;

    if (state.refsLoading) {
      issues.push({
        fieldId: "deployCourse",
        group: "loading",
        message: "Brightspace course items are still loading. Wait a moment, then try again."
      });
    }

    if (!courseId) {
      issues.push({
        fieldId: "deployCourse",
        group: "course",
        message: "Choose a course offering."
      });
    }

    if (!template) {
      issues.push({
        fieldId: "deployTemplate",
        group: "template",
        message: "Choose a deployment template."
      });
    }

    if (template && !document.getElementById("deployAgentName").value.trim()) {
      issues.push({
        fieldId: "deployAgentName",
        group: "properties",
        message: "Enter an agent name."
      });
    }

    if (template && !document.getElementById("deployEmailSubject").value.trim()) {
      issues.push({
        fieldId: "deployEmailSubject",
        group: "email",
        message: "Enter an email subject."
      });
    }

    if (template && !document.getElementById("deployEmailMessage").value.trim()) {
      issues.push({
        fieldId: "deployEmailMessage",
        group: "email",
        message: "Enter the email message."
      });
    }

    if (template && courseId && !state.refsLoading) {
      for (var i = 0; i < template.fields.length; i++) {
        var field = template.fields[i];
        if (!field.required) continue;
        var id = "dyn-" + field.name;
        var el = document.getElementById(id);
        var itemList = itemsForFieldType(field, refs);
        if (itemList && !itemList.length) {
          issues.push({
            fieldId: id,
            group: "template-field",
            message: emptyItemsMessage(field.type)
          });
          continue;
        }
        if (!el) {
          issues.push({
            fieldId: "templateDetailsSection",
            group: "template-field",
            message: field.label + " is required."
          });
          continue;
        }
        if (el.multiple) {
          if (!getMultiSelectValues(el).length) {
            issues.push({
              fieldId: id,
              group: "template-field",
              message: field.label + " is required. Select at least one item."
            });
          }
        } else if (!String(el.value || "").trim()) {
          issues.push({
            fieldId: id,
            group: "template-field",
            message: field.label + " is required."
          });
        }
      }
    }

    if (template) {
      var scheduleType = document.getElementById("scheduleType").value;
      if (scheduleType && scheduleType !== "manual") {
        if (!document.getElementById("scheduleStart").value) {
          issues.push({
            fieldId: "scheduleStart",
            group: "schedule",
            message: "Set a start date and time for the schedule."
          });
        }
      }
      if (scheduleType === "weekly" && !getCheckedWeekdays().length) {
        issues.push({
          fieldId: "weeklyDaysGroup",
          group: "schedule",
          message: "Choose at least one weekday for the weekly schedule."
        });
      }
    }

    if (courseId && !state.refsLoading && document.getElementById("limitToStudents").checked && !refs.studentRoleIds.length) {
      issues.push({
        fieldId: "limitToStudents",
        group: "student-roles",
        message: "Student-only targeting is checked, but no student roles were detected in this course. Uncheck that option or choose a different course."
      });
    }

    return issues;
  }

  function itemsForFieldType(field, refs) {
    if (!field || !refs) return null;
    switch (field.type) {
      case "assignment":
      case "assignmentMultiple":
        return refs.assignments;
      case "quiz":
      case "quizMultiple":
        return refs.quizzes;
      case "gradeItem":
        return refs.gradeItems;
      case "discussionTopic":
        return refs.topics;
      case "contentTopic":
        return refs.contentTopics;
      case "checklist":
        return refs.checklists;
      default:
        return null;
    }
  }

  function emptyItemsMessage(fieldType) {
    var labels = {
      assignment: "assignment folders",
      assignmentMultiple: "assignment folders",
      quiz: "quizzes",
      quizMultiple: "quizzes",
      gradeItem: "grade items",
      discussionTopic: "discussion topics",
      contentTopic: "content topics",
      checklist: "checklists"
    };
    var label = labels[fieldType] || "matching course items";
    return "This course has no " + label + " for this template. Choose a different course or a different template.";
  }

  function buildAgentPayload(template, refs) {
    var courseId = document.getElementById("deployCourse").value;
    var schedule = buildScheduleData();
    var loginCondition = document.getElementById("useLoginCondition").checked ? {
      Type: document.querySelector("input[name='loginConditionType']:checked").value === "yes" ? 1 : 0,
      Days: toInt(document.getElementById("loginConditionDays").value, 7)
    } : null;
    var courseCondition = document.getElementById("useCourseCondition").checked ? {
      Type: document.querySelector("input[name='courseConditionType']:checked").value === "yes" ? 1 : 0,
      Days: toInt(document.getElementById("courseConditionDays").value, 7)
    } : null;
    var roleIds = document.getElementById("limitToStudents").checked ? refs.studentRoleIds.slice() : null;

    return {
      AgentId: null,
      Name: document.getElementById("deployAgentName").value.trim(),
      Description: document.getElementById("deployAgentDescription").value.trim(),
      IsEnabled: document.getElementById("deployAgentEnabled").checked,
      Schedule: schedule,
      Action: {
        RepeatType: document.querySelector("input[name='deployActionTiming']:checked").value === "every" ? 0 : 1,
        EmailAction: {
          IsEnabled: true,
          To: emptyToNull(document.getElementById("deployEmailTo").value),
          Cc: emptyToNull(document.getElementById("deployEmailCc").value),
          Bcc: emptyToNull(document.getElementById("deployEmailBcc").value),
          Subject: emptyToNull(document.getElementById("deployEmailSubject").value),
          Message: emptyToNull(document.getElementById("deployEmailMessage").value),
          IsHtml: document.getElementById("deployEmailIsHtml").checked
        },
        EnrollmentAction: null
      },
      Condition: {
        LoginActivity: loginCondition,
        CourseActivity: courseCondition,
        ReleaseCondition: null,
        RoleIds: roleIds && roleIds.length ? roleIds : null
      },
      CategoryId: null
    };
  }

  function buildScheduleData() {
    var type = document.getElementById("scheduleType").value;
    if (type === "manual") return null;

    var scheduleTypeMap = {
      daily: 0,
      weekly: 1,
      monthly: 2,
      annually: 3,
      hourly: 4,
      once: 5
    };

    var startDate = toUtcString(document.getElementById("scheduleStart").value);
    var endDate = toUtcString(document.getElementById("scheduleEnd").value);
    var repeatsEvery = toInt(document.getElementById("scheduleRepeatsEvery").value, 1);
    var repeatsOnDays = null;
    var repeatsOnDay = null;
    var repeatsOnMonth = null;

    if (type === "weekly") {
      repeatsOnDays = getCheckedWeekdays();
    }
    if (type === "monthly" || type === "annually") {
      repeatsOnDay = toInt(document.getElementById("scheduleMonthDay").value, 1);
    }
    if (type === "annually") {
      repeatsOnMonth = toInt(document.getElementById("scheduleYearMonth").value, 1);
    }

    var schedule = {
      IsEnabled: true,
      Type: scheduleTypeMap[type],
      StartDate: startDate,
      EndDate: endDate,
      RepeatsEvery: type === "once" ? null : repeatsEvery,
      RepeatsOnDay: repeatsOnDay,
      RepeatsOnDays: repeatsOnDays,
      RepeatsOnMonth: repeatsOnMonth
    };

    if (type === "daily" || type === "weekly" || type === "monthly" || type === "annually") {
      var scheduledTime = scheduledTimeFromStart(document.getElementById("scheduleStart").value);
      schedule.ScheduledTimeHour = scheduledTime.hour;
      schedule.ScheduledTimeMinute = scheduledTime.minute;
    }

    return schedule;
  }

  function buildReleaseConditions(template, refs) {
    var operands = [];
    var values = collectDynamicFieldValues();

    switch (template.id) {
      case "low-grade":
      case "encouragement":
        operands.push({
          Type: "ReceivesScoreOnGradeItem",
          State: null,
          Text: null,
          ReceivesScoreOnGradeItemParams: {
            GradeObjectId: toInt(values.gradeItemId, 0),
            Operator: toScoreOperator(values.gradeOperator),
            Operands: [toNumber(values.gradeThreshold, template.id === "encouragement" ? 80 : 70)]
          }
        });
        break;
      case "high-quiz-score":
      case "failed-quiz":
        operands.push({
          Type: "ReceivesScoreOnQuiz",
          State: null,
          Text: null,
          ReceivesScoreOnQuizParams: {
            QuizId: toInt(values.quizId, 0),
            Operator: toScoreOperator(values.quizOperator),
            Operands: [toNumber(values.quizThreshold, 80)]
          }
        });
        break;
      case "multiple-low-quiz":
        operands = buildMultipleQuizConditions(values.quizIds, values.quizOperator, values.quizThreshold);
        break;
      case "late-assignment":
      case "due-soon":
      case "assignment":
      case "multiple-missing":
        operands = buildAssignmentConditions(template.id, values.folderId, values.folderIds);
        break;
      case "on-time-submission":
        operands.push(dropboxCondition("SubmitsToDropbox", values.folderId));
        break;
      case "received-feedback":
      case "feedback-no-followup":
        operands.push(dropboxCondition("ReceivesFeedback", values.folderId));
        break;
      case "improvement-after-feedback":
        operands.push(dropboxCondition("ReceivesFeedback", values.folderId));
        operands.push(dropboxCondition("SubmitsToDropbox", values.folderId));
        break;
      case "no-discussion-posts":
        operands.push(discussionCondition("NotAuthoredPostsInTopic"));
        break;
      case "strong-start":
      case "consistent-engagement":
        operands.push(dropboxCondition("SubmitsToDropbox", values.folderId));
        operands.push(discussionCondition("AuthorsPostsInTopic"));
        break;
      case "sudden-drop":
      case "no-submissions":
        operands.push(dropboxCondition("NotSubmittedToDropbox", values.folderId));
        operands.push(discussionCondition("NotAuthoredPostsInTopic"));
        break;
      case "final-week":
        operands.push(contentCondition("VisitsContentTopic", values.topicId));
        operands.push(dropboxCondition("NotSubmittedToDropbox", values.folderId));
        break;
      case "content":
        operands.push(contentCondition("NotVisitedContentTopic", values.topicId));
        break;
      case "course-progress":
      case "midpoint-progress":
      case "completion-congrats":
        operands.push(contentCondition("VisitsContentTopic", values.topicId));
        break;
      case "incomplete-checklist":
        operands.push(checklistCondition("NotCompletedChecklist", values.checklistId));
        break;
      case "completed-checklist":
        operands.push(checklistCondition("CompletesChecklist", values.checklistId));
        break;
    }

    if (!operands.length) return null;

    return {
      Expression: {
        Type: "Expression",
        State: null,
        Text: null,
        ExpressionParams: {
          Operator: "All",
          Operands: operands
        }
      }
    };
  }

  function buildAssignmentConditions(templateId, folderId, folderIds) {
    var ids = [];
    if (folderId) ids.push(folderId);
    if (folderIds && folderIds.length) ids = folderIds.slice();
    var operands = [];
    for (var i = 0; i < ids.length; i++) {
      operands.push(dropboxCondition("NotSubmittedToDropbox", ids[i]));
    }
    return operands;
  }

  function buildMultipleQuizConditions(quizIds, operator, threshold) {
    var operands = [];
    for (var i = 0; i < quizIds.length; i++) {
      operands.push({
        Type: "ReceivesScoreOnQuiz",
        State: null,
        Text: null,
        ReceivesScoreOnQuizParams: {
          QuizId: toInt(quizIds[i], 0),
          Operator: toScoreOperator(operator),
          Operands: [toNumber(threshold, 70)]
        }
      });
    }
    return operands;
  }

  function dropboxCondition(type, folderId) {
    var paramsName = type + "Params";
    var condition = {
      Type: type,
      State: null,
      Text: null
    };
    condition[paramsName] = {
      FolderId: toInt(folderId, 0)
    };
    return condition;
  }

  function discussionCondition(type) {
    var option = getSelectedOption("dyn-discussionTopicId");
    var conditionType = type || "NotAuthoredPostsInTopic";
    var paramsName = conditionType + "Params";
    var condition = {
      Type: conditionType,
      State: null,
      Text: null
    };
    var params = {
      ForumId: toInt(option ? option.getAttribute("data-forum-id") : 0, 0),
      TopicId: toInt(option ? option.getAttribute("data-topic-id") : 0, 0),
      PostsType: "ThreadsAndReplies"
    };
    // Brightspace type is AuthorsPostsInTopic (not Authored...). NumberOfPosts is required.
    if (conditionType === "AuthorsPostsInTopic") {
      params.NumberOfPosts = 1;
    }
    condition[paramsName] = params;
    return condition;
  }

  function contentCondition(type, topicId) {
    var paramsName = type + "Params";
    var condition = {
      Type: type,
      State: null,
      Text: null
    };
    condition[paramsName] = { TopicId: toInt(topicId, 0) };
    return condition;
  }

  function checklistCondition(type, checklistId) {
    var paramsName = type + "Params";
    var condition = {
      Type: type,
      State: null,
      Text: null
    };
    condition[paramsName] = { ChecklistId: toInt(checklistId, 0) };
    return condition;
  }

  function collectDynamicFieldValues() {
    var template = getCurrentTemplate();
    var values = {};
    if (!template) return values;
    for (var i = 0; i < template.fields.length; i++) {
      var field = template.fields[i];
      var el = document.getElementById("dyn-" + field.name);
      if (!el) continue;
      values[field.name] = el.multiple ? getMultiSelectValues(el) : el.value;
    }
    return values;
  }

  function updatePlan() {
    var template = getCurrentTemplate();
    var courseId = document.getElementById("deployCourse").value;
    var issues = collectReadinessIssues(template, state.currentRefs);
    var plan = document.getElementById("deploymentPlan");
    var hint = document.getElementById("deployButtonHint");
    var ready = issues.length === 0 && !state.refsLoading;

    applyAttentionHighlights(issues, template, courseId);
    renderReadinessPanel(plan, issues, template, courseId, ready);
    setCreateButtonState(ready, state.submitting);

    if (hint) {
      hint.textContent = ready
        ? "This agent is ready to create in the selected course."
        : "If Create is not ready, click it to jump to the next field that still needs attention.";
    }
  }

  function renderReadinessPanel(plan, issues, template, courseId, ready) {
    if (!plan) return;
    plan.classList.remove("agent-readiness-blocked", "agent-readiness-ready", "agent-readiness-loading");

    if (state.refsLoading) {
      plan.classList.add("agent-readiness-loading");
      plan.innerHTML = '<div class="agent-readiness-title"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading course items</div><p class="agent-readiness-preview">Brightspace items for the selected course are still loading. Required dropdowns will appear when that finishes.</p>';
      return;
    }

    if (ready) {
      plan.classList.add("agent-readiness-ready");
      plan.innerHTML =
        '<div class="agent-readiness-title"><i class="fas fa-check-circle" aria-hidden="true"></i> Ready to create</div>' +
        '<p class="agent-readiness-preview">' + escapeHtml(buildPlanPreview(template, courseId)) + "</p>";
      return;
    }

    plan.classList.add("agent-readiness-blocked");
    var countLabel = issues.length === 1 ? "1 item needs attention" : issues.length + " items need attention";
    var html = '<div class="agent-readiness-title"><i class="fas fa-circle-exclamation" aria-hidden="true"></i> ' + escapeHtml(countLabel) + " before this agent can be created</div>";
    html += '<ul class="agent-readiness-list">';
    for (var i = 0; i < issues.length; i++) {
      html += '<li><button type="button" data-goto-field="' + escapeHtml(issues[i].fieldId) + '">' + escapeHtml(issues[i].message) + "</button></li>";
    }
    html += "</ul>";
    if (courseId && template) {
      html += '<p class="agent-readiness-preview">' + escapeHtml(buildPlanPreview(template, courseId)) + "</p>";
    }
    plan.innerHTML = html;
  }

  function buildPlanPreview(template, courseId) {
    var parts = [];
    parts.push("This will create \"" + (document.getElementById("deployAgentName").value.trim() || (template && template.name) || "this agent") + "\"");
    parts.push("in " + (state.courseMap[courseId] ? state.courseMap[courseId].Code : (courseId || "the selected course")) + ".");
    parts.push("Schedule: " + scheduleDescription() + ".");
    var actionTiming = document.querySelector("input[name='deployActionTiming']:checked");
    parts.push("Action repetition: " + (actionTiming && actionTiming.value === "every" ? "every time criteria are met" : "first time only") + ".");
    parts.push("Role filter: " + (document.getElementById("limitToStudents").checked ? (state.currentRefs.studentRoleIds.length ? "student roles only" : "student roles requested but not yet available") : "all classlist roles") + ".");

    var directCriteria = [];
    if (document.getElementById("useLoginCondition").checked) {
      directCriteria.push("login activity");
    }
    if (document.getElementById("useCourseCondition").checked) {
      directCriteria.push("course activity");
    }
    parts.push("Direct criteria: " + (directCriteria.length ? directCriteria.join(" + ") : "none") + ".");

    if (template) {
      var releaseSummary = template.fields.length ? template.fields.map(function (field) { return field.label; }).join(", ") : "no extra course item selection required";
      parts.push("Template-specific fields: " + releaseSummary + ".");
    }

    if (document.getElementById("runPracticeAfterCreate").checked) {
      parts.push("A practice run will also be queued after creation.");
    }

    return parts.join(" ");
  }

  function applyAttentionHighlights(issues, template, courseId) {
    clearAttentionHighlights();
    var highlightIds = {};
    for (var i = 0; i < issues.length; i++) {
      if (shouldHighlightIssue(issues[i], template, courseId)) {
        highlightIds[issues[i].fieldId] = true;
      }
    }
    var fieldIds = Object.keys(highlightIds);
    for (var j = 0; j < fieldIds.length; j++) {
      markFieldNeedsAttention(fieldIds[j]);
    }
  }

  function shouldHighlightIssue(issue, template, courseId) {
    if (state.showAllHighlights) return issue.group !== "loading";
    if (issue.group === "loading") return false;
    if (courseId && template && (issue.group === "template-field" || issue.group === "student-roles" || issue.group === "schedule")) {
      return true;
    }
    return false;
  }

  function clearAttentionHighlights() {
    var marked = document.querySelectorAll(".agent-needs-attention, .agent-section-needs-attention, .agent-attention-pulse");
    for (var i = 0; i < marked.length; i++) {
      marked[i].classList.remove("agent-needs-attention", "agent-section-needs-attention", "agent-attention-pulse");
    }
    var invalid = document.querySelectorAll("[aria-invalid='true']");
    for (var j = 0; j < invalid.length; j++) {
      invalid[j].removeAttribute("aria-invalid");
    }
  }

  function markFieldNeedsAttention(fieldId) {
    var el = getFieldElement(fieldId);
    if (!el) return;
    var group = el.closest(".form-group") || el;
    group.classList.add("agent-needs-attention");
    var section = group.closest("fieldset");
    if (section) section.classList.add("agent-section-needs-attention");
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      el.setAttribute("aria-invalid", "true");
    }
  }

  function getFieldElement(fieldId) {
    if (!fieldId) return null;
    return document.getElementById(fieldId) || document.querySelector("[data-agent-field-group='" + fieldId.replace(/^dyn-/, "") + "']");
  }

  function focusField(fieldId, pulse) {
    var el = getFieldElement(fieldId);
    if (!el) return;
    var group = el.closest(".form-group") || el.closest("fieldset") || el;
    if (group && group.scrollIntoView) {
      try {
        group.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {
        group.scrollIntoView();
      }
    }
    var focusEl = el;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA" && el.tagName !== "BUTTON") {
      focusEl = el.querySelector("input, select, textarea, button") || el;
    }
    try { focusEl.focus(); } catch (e2) {}
    if (pulse) {
      group.classList.remove("agent-attention-pulse");
      void group.offsetWidth;
      group.classList.add("agent-attention-pulse");
    }
  }

  function onReadinessJump(event) {
    var btn = event.target.closest("[data-goto-field]");
    if (!btn) return;
    event.preventDefault();
    focusField(btn.getAttribute("data-goto-field"), true);
  }

  function setCreateButtonState(ready, submitting) {
    var btn = document.getElementById("deployAgentBtn");
    if (!btn) return;
    if (submitting) {
      btn.disabled = true;
      btn.classList.remove("form-button-not-ready");
      btn.setAttribute("aria-disabled", "true");
      btn.removeAttribute("title");
      return;
    }
    btn.disabled = false;
    if (ready) {
      btn.classList.remove("form-button-not-ready");
      btn.setAttribute("aria-disabled", "false");
      btn.title = "Create this Intelligent Agent in the selected course";
    } else {
      btn.classList.add("form-button-not-ready");
      btn.setAttribute("aria-disabled", "true");
      btn.title = "Complete the highlighted fields, or click to jump to the next one";
    }
  }

  function scheduleDescription() {
    var type = document.getElementById("scheduleType").value;
    if (type === "manual") return "manual only";
    if (type === "weekly") {
      var days = getCheckedWeekdays();
      return "weekly on " + (days.length ? days.join(", ") : "no day selected");
    }
    if (type === "monthly") {
      return "monthly on day " + document.getElementById("scheduleMonthDay").value;
    }
    if (type === "annually") {
      return "annually on month " + document.getElementById("scheduleYearMonth").value + ", day " + document.getElementById("scheduleMonthDay").value;
    }
    if (type === "once") return "one-time run";
    return type;
  }

  function resetForm() {
    document.getElementById("agentDeployForm").reset();
    document.getElementById("scheduleStart").value = defaultDateTimeLocal(24);
    document.getElementById("scheduleRepeatsEvery").value = 1;
    state.showAllHighlights = false;
    state.submitting = false;
    toggleDateConditionUI();
    toggleScheduleDetails();
    hideTemplateSummary();
    renderDynamicTemplateFields(null, state.currentRefs);
    updatePlan();
    setMessage("deployMessage", "", "");
  }

  function getCurrentTemplate() {
    var templateId = document.getElementById("deployTemplate").value;
    for (var i = 0; i < state.templates.length; i++) {
      if (state.templates[i].id === templateId) return state.templates[i];
    }
    return null;
  }

  async function loadCourseReferences(courseId) {
    var refs = emptyRefs();

    var results = await Promise.allSettled([
      loadAssignments(courseId),
      loadQuizzes(courseId),
      loadDiscussionTopics(courseId),
      loadContentTopics(courseId),
      loadChecklists(courseId),
      loadGradeItems(courseId),
      loadStudentRoles(courseId)
    ]);

    refs.assignments = fulfilledValue(results[0], refs.loadErrors, "assignments");
    refs.quizzes = fulfilledValue(results[1], refs.loadErrors, "quizzes");
    refs.topics = fulfilledValue(results[2], refs.loadErrors, "discussion topics");
    refs.contentTopics = fulfilledValue(results[3], refs.loadErrors, "content topics");
    refs.checklists = fulfilledValue(results[4], refs.loadErrors, "checklists");
    refs.gradeItems = fulfilledValue(results[5], refs.loadErrors, "grade items");
    var studentRoleData = fulfilledValue(results[6], refs.loadErrors, "student roles");
    refs.studentRoleIds = studentRoleData.ids || [];
    refs.studentRoleLabels = studentRoleData.labels || [];

    return refs;
  }

  function fulfilledValue(result, errors, label) {
    if (result.status === "fulfilled") return result.value;
    console.warn("IA deployer: failed to load " + label, result.reason);
    errors.push("Could not load " + label);
    if (label === "student roles") return { ids: [], labels: [] };
    return [];
  }

  async function loadAssignments(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/dropbox/folders/");
    var items = normalizeItemsArray(data);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var folder = items[i];
      var value = folder.Id || folder.FolderId;
      var label = folder.Name || folder.Title || ("Assignment " + value);
      if (value) out.push({ value: String(value), label: String(label) });
    }
    return sortByLabel(out);
  }

  async function loadQuizzes(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/quizzes/");
    var items = normalizeItemsArray(data);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var quiz = items[i];
      var value = quiz.QuizId || quiz.Id;
      var label = quiz.Name || quiz.Title || ("Quiz " + value);
      if (value) out.push({ value: String(value), label: String(label) });
    }
    return sortByLabel(out);
  }

  async function loadDiscussionTopics(courseId) {
    var forumsData = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/discussions/forums/");
    var forums = normalizeItemsArray(forumsData);
    var out = [];
    for (var i = 0; i < forums.length; i++) {
      var forumId = forums[i].ForumId || forums[i].Id;
      if (!forumId) continue;
      try {
        var topicsData = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/discussions/forums/" + encodeURIComponent(forumId) + "/topics/");
        var topics = normalizeItemsArray(topicsData);
        for (var j = 0; j < topics.length; j++) {
          var topicId = topics[j].TopicId || topics[j].Id;
          var label = (forums[i].Name || "Forum") + " > " + (topics[j].Name || ("Topic " + topicId));
          if (topicId) {
            out.push({
              value: String(topicId),
              label: label,
              forumId: String(forumId),
              topicId: String(topicId)
            });
          }
        }
      } catch (e) {
        console.warn("IA deployer: failed to load topics for forum", forumId, e);
      }
    }
    return sortByLabel(out);
  }

  async function loadContentTopics(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/content/toc");
    var out = [];
    flattenContentNodes(data || [], [], out);
    return sortByLabel(out);
  }

  function flattenContentNodes(nodes, pathParts, out) {
    if (!nodes || !nodes.length) return;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var label = node.Title || node.Name || node.ShortTitle || "";
      var currentPath = pathParts.slice();
      if (label) currentPath.push(label);
      if (node.Id && (node.Type === 1 || node.Url || node.TopicType || node.TypeIdentifier === "Topic")) {
        out.push({
          value: String(node.Id),
          label: currentPath.join(" > ")
        });
      }
      if (node.Topics && node.Topics.length) {
        flattenContentNodes(node.Topics, currentPath, out);
      }
      if (node.Modules && node.Modules.length) {
        flattenContentNodes(node.Modules, currentPath, out);
      }
    }
  }

  async function loadChecklists(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/checklists/");
    var items = normalizeItemsArray(data);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var checklistId = items[i].Id || items[i].ChecklistId;
      var label = items[i].Name || items[i].Title || ("Checklist " + checklistId);
      if (checklistId) out.push({ value: String(checklistId), label: String(label) });
    }
    return sortByLabel(out);
  }

  async function loadGradeItems(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/grades/");
    var items = normalizeItemsArray(data);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var id = items[i].Id;
      var name = items[i].Name || items[i].ShortName || ("Grade Item " + id);
      if (id) out.push({ value: String(id), label: String(name) });
    }
    return sortByLabel(out);
  }

  async function loadStudentRoles(courseId) {
    var data = await BrightspaceFetchJson("/d2l/api/le/" + API_VERSION_LE + "/" + encodeURIComponent(courseId) + "/classlist/paged/");
    var users = normalizeItemsArray(data);
    var labelsById = {};
    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      var roleId = toInt(user.RoleId, null);
      var roleName = String(user.ClasslistRoleDisplayName || user.RoleName || "");
      if (roleId == null) continue;
      if (STUDENT_ROLE_IDS[roleId] || roleNameMatches(roleName, STUDENT_ROLE_KEYWORDS)) {
        labelsById[String(roleId)] = roleName || ("Role " + roleId);
      }
    }
    var ids = Object.keys(labelsById).map(function (id) { return toInt(id, 0); }).filter(Boolean);
    return {
      ids: ids,
      labels: ids.map(function (id) { return labelsById[String(id)] + " (" + id + ")"; })
    };
  }

  function normalizeItemsArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Items)) return data.Items;
    if (Array.isArray(data.Objects)) return data.Objects;
    if (Array.isArray(data.Modules)) return data.Modules;
    return [];
  }

  async function getMyCourseOfferings() {
    var raw = await getAllMyEnrollments();
    var out = [];
    var seen = {};

    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
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
        if (!SHOW_SANDBOX_ALL_TERMS || !academic) continue;
      } else {
        if (!academic || !ALLOWED_SEMESTER_CODES[sem]) continue;
      }

      seen[String(orgUnitId)] = true;
      out.push({
        OrgUnitId: String(orgUnitId),
        Code: code,
        Name: name
      });
    }

    out.sort(function (a, b) {
      return String(a.Code || "").localeCompare(String(b.Code || ""));
    });
    return out;
  }

  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;

    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";
      var data = await BrightspaceFetchJson(endpoint);
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

  function BrightspaceFetchJson(url, options) {
    var token = localStorage.getItem("X-CSRF.Token") || localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    if (opts.body && !opts.headers["Content-Type"]) {
      opts.headers["Content-Type"] = "application/json";
    }
    opts.credentials = "include";

    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          var err = new Error("HTTP " + res.status + " - " + url + (text ? " - " + text : ""));
          err.status = res.status;
          throw err;
        }
        if (res.status === 204 || !text || !String(text).trim()) return null;
        try {
          return JSON.parse(text);
        } catch (e) {
          if (res.status >= 200 && res.status < 300) return null;
          var parseErr = new Error("HTTP " + res.status + " - " + url + " - " + text);
          parseErr.status = res.status;
          throw parseErr;
        }
      });
    });
  }

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && item.Access.ClasslistRoleId != null) {
      return toInt(item.Access.ClasslistRoleId, null);
    }
    return null;
  }

  function getRoleName(item) {
    return item && item.Access && item.Access.ClasslistRoleName ? String(item.Access.ClasslistRoleName) : "";
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
    return c.indexOf("MERGED") >= 0 || c.indexOf("CXLD") >= 0 || n.indexOf("MERGED") >= 0 || n.indexOf("CXLD") >= 0 || c.indexOf("SANDBOX-") === 0;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function getCheckedWeekdays() {
    var boxes = document.querySelectorAll("[data-weekday]");
    var days = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) days.push(boxes[i].value);
    }
    return days;
  }

  function getMultiSelectValues(select) {
    var values = [];
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].selected) values.push(select.options[i].value);
    }
    return values;
  }

  function getSelectedOption(id) {
    var select = document.getElementById(id);
    if (!select) return null;
    return select.options[select.selectedIndex] || null;
  }

  function sortByLabel(items) {
    return items.sort(function (a, b) {
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
  }

  function appendOption(select, value, label, selected) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (selected) option.selected = true;
    select.appendChild(option);
  }

  function setMessage(id, message, type, isHtml) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!message) {
      el.style.display = "none";
      el.className = "message-container";
      el.textContent = "";
      return;
    }
    el.style.display = "block";
    el.className = "message-container " + (type === "error" ? "message-error" : "message-success");
    if (isHtml) {
      el.innerHTML = message;
    } else {
      el.textContent = message;
    }
  }

  function scheduledTimeFromStart(value) {
    var date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) {
      return { hour: 8, minute: 0 };
    }
    return { hour: date.getHours(), minute: date.getMinutes() };
  }

  function defaultDateTimeLocal(hoursFromNow) {
    var date = new Date(Date.now() + (hoursFromNow || 0) * 60 * 60 * 1000);
    var year = date.getFullYear();
    var month = pad(date.getMonth() + 1);
    var day = pad(date.getDate());
    var hour = pad(date.getHours());
    var minute = pad(date.getMinutes());
    return year + "-" + month + "-" + day + "T" + hour + ":" + minute;
  }

  function toUtcString(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
  }

  function toNumber(value, fallback) {
    var n = Number(value);
    return isNaN(n) ? fallback : n;
  }

  function emptyToNull(value) {
    var s = String(value || "").trim();
    return s ? s : null;
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function applyFieldOverrides(overrides) {
    if (!overrides) return;
    if (overrides.agentName != null) {
      document.getElementById("deployAgentName").value = overrides.agentName;
    }
    if (overrides.agentDescription != null) {
      document.getElementById("deployAgentDescription").value = overrides.agentDescription;
    }
    if (overrides.subject != null) {
      document.getElementById("deployEmailSubject").value = overrides.subject;
    }
    if (overrides.message != null) {
      document.getElementById("deployEmailMessage").value = overrides.message;
    }
    if (overrides.scheduleType != null) {
      document.getElementById("scheduleType").value = overrides.scheduleType;
    }
    if (overrides.actionTiming === "every") {
      document.getElementById("deployActionEvery").checked = true;
    } else if (overrides.actionTiming === "first") {
      document.getElementById("deployActionFirst").checked = true;
    }
    if (typeof overrides.agentEnabled === "boolean") {
      document.getElementById("deployAgentEnabled").checked = overrides.agentEnabled;
    }
    if (typeof overrides.useLoginCondition === "boolean") {
      document.getElementById("useLoginCondition").checked = overrides.useLoginCondition;
    }
    if (typeof overrides.useCourseCondition === "boolean") {
      document.getElementById("useCourseCondition").checked = overrides.useCourseCondition;
    }
    if (overrides.loginConditionType === "yes") {
      document.getElementById("loginConditionYes").checked = true;
    } else if (overrides.loginConditionType === "not") {
      document.getElementById("loginConditionNot").checked = true;
    }
    if (overrides.courseConditionType === "yes") {
      document.getElementById("courseConditionYes").checked = true;
    } else if (overrides.courseConditionType === "not") {
      document.getElementById("courseConditionNot").checked = true;
    }
    if (overrides.loginConditionDays != null && overrides.loginConditionDays !== "") {
      document.getElementById("loginConditionDays").value = overrides.loginConditionDays;
    }
    if (overrides.courseConditionDays != null && overrides.courseConditionDays !== "") {
      document.getElementById("courseConditionDays").value = overrides.courseConditionDays;
    }
    if (typeof overrides.limitToStudents === "boolean") {
      document.getElementById("limitToStudents").checked = overrides.limitToStudents;
    }
    toggleDateConditionUI();
    toggleScheduleDetails();
    updatePlan();
  }

  function selectTemplateById(templateId, options) {
    options = options || {};
    var sel = document.getElementById("deployTemplate");
    if (!sel || !templateId) return false;
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === templateId) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    sel.value = templateId;
    onTemplateChange();
    if (options.overrides) applyFieldOverrides(options.overrides);
    return true;
  }

  function getDeployableTemplateIds() {
    return state.templates.map(function (t) {
      return t.id;
    });
  }

  window.FacultyDashboardIADeploy = {
    selectTemplateById: selectTemplateById,
    applyFieldOverrides: applyFieldOverrides,
    getDeployableTemplateIds: getDeployableTemplateIds
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
