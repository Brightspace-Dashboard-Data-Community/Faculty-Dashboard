// ============================================
// System Updates Page
// ============================================

(function() {
  'use strict';

  const CURRENT_VERSION = '20.26.08';
  const UPCOMING_VERSION = '20.26.09';
  /** Faculty summaries for September appear on or after this date (campus target September 15, 2026). */
  const UPCOMING_SUMMARIES_AVAILABLE = new Date('2026-09-15T00:00:00');

  const RELEASE_NOTE_URLS = {
    '20.26.01': 'https://community.d2l.com/brightspace/kb/articles/33544-january-2026-20-26-01',
    '20.26.02': 'https://community.d2l.com/brightspace/kb/articles/33623-february-2026-20-26-02',
    '20.26.03': 'https://community.d2l.com/brightspace/kb/articles/34059-march-2026-20-26-03',
    '20.26.04': 'https://community.d2l.com/brightspace/kb/articles/34337-april-2026-20-26-04',
    '20.26.05': 'https://community.d2l.com/brightspace/kb/articles/34588-may-2026-20-26-05',
    '20.26.06': 'https://community.d2l.com/brightspace/kb/articles/34976-june-2026-20-26-06',
    '20.26.07': 'https://community.d2l.com/brightspace/kb/articles/35074-july-2026-20-26-07',
    '20.26.08': 'https://community.d2l.com/brightspace/kb/articles/35155-august-2026-20-26-08'
  };

  /** August 2026 — current (campus target August 15, 2026). Faculty-focused only. */
  const currentUpdatesData = [
    {
      id: 801,
      version: '20.26.08',
      date: 'August 2026',
      category: 'feature',
      title: 'Quizzes — flag questions and strikethrough answers',
      description: 'Learners can bookmark quiz questions to revisit later and strikethrough answer options they want to eliminate. Flagged questions appear in the quiz left navigation. You can turn this off per quiz with Hide question annotation tools under Timing & Display.',
      tags: ['Quizzes', 'Learner Experience']
    },
    {
      id: 802,
      version: '20.26.08',
      date: 'August 2026',
      category: 'feature',
      title: 'Learning Outcomes — align outcomes to modules and submodules',
      description: 'You can now attach learning outcomes to content modules and submodules—not only topics and assessments. Alignments appear in the Outcomes Coverage Experience in the New Content Experience so you can see coverage across the whole course hierarchy.',
      tags: ['Content', 'NCE', 'Learning Outcomes']
    },
    {
      id: 803,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'Quizzes — searchable source and filter lists in Question Library',
      description: 'The Source and filter dropdowns in Browse Existing Questions now include a search field, making it faster to find question sources and apply filters when building quizzes.',
      tags: ['Quizzes', 'Course Design']
    },
    {
      id: 804,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'Work To Do — evaluation tasks hidden by default for multi-role users',
      description: 'If you also have a learner enrollment (for example as a teaching assistant), the Work To Do widget now hides evaluation activities by default so you can focus on upcoming and overdue learner work. Your institution can restore the previous mixed view if needed.',
      tags: ['Work To Do', 'Learner Experience']
    },
    {
      id: 805,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'Work To Do — completed modules drop off the widget',
      description: 'When a learner finishes every activity in a module, that module is marked complete and removed from Work To Do—so completed work no longer shows as overdue. This applies to modules completed after this release; already-overdue modules stay until addressed.',
      tags: ['Work To Do', 'Learner Experience']
    },
    {
      id: 806,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'Assignments — faster annotation loading and saving',
      description: 'Inline assignment annotations load and save more reliably, with a preview of the annotation interface while the document opens—especially helpful on slower connections.',
      tags: ['Assignments', 'Grading']
    },
    {
      id: 807,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'Brightspace Editor — TinyMCE 8 update',
      description: 'The HTML editor is updated from TinyMCE 7.7.0 to 8.0.4 on production. There are no intended functional changes; D2L recommends spot-checking HTML course content in the editor to confirm it still displays as expected.',
      tags: ['Content', 'Editor']
    },
    {
      id: 808,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'D2L Lumi Feedback — faster automated grading',
      description: 'Lumi Feedback can grade submissions immediately after they arrive via Brightspace notifications, instead of waiting on CSV mapping or polling—so learners can get feedback sooner. Lumi Feedback add-on where licensed.',
      tags: ['Lumi Pro', 'Assignments', 'AI Tools']
    },
    {
      id: 809,
      version: '20.26.08',
      date: 'August 2026',
      category: 'improvement',
      title: 'D2L Lumi Tutor — unified Study Mode with H5P',
      description: 'Lumi Tutor Study Mode now includes H5P exercises (Drag the Words, Multiple Choice, True/False, and Flashcards) alongside text questions. Cross-course chat can include inactive courses and past enrollments, with a longer conversation history. Lumi Tutor add-on where licensed.',
      tags: ['Lumi Pro', 'AI Tools', 'Learner Experience']
    }
  ];

  /** September 2026 — upcoming. Shown after UPCOMING_SUMMARIES_AVAILABLE. */
  const upcomingUpdatesData = [];

  /** Earlier months — faculty-focused highlights only. */
  const archivedUpdatesData = [
    // July 2026 / 20.26.07 — see D2L KB 35074
    {
      id: 701,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'Groups — new Manage Groups interface',
      description: 'A redesigned Manage Groups experience lists all categories in one table (enrollment type, group count, and linked activities), with clearer category and group detail pages. Your institution may offer this as an opt-in until it becomes the default later.',
      tags: ['Groups', 'Course Design']
    },
    {
      id: 702,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'Groups — up to 1,000 groups per category',
      description: 'Categories that let you set the number of groups now support up to 1,000 groups (previously 200), including single-user enrollment types—helpful for high-enrollment courses.',
      tags: ['Groups']
    },
    {
      id: 703,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'Assignments — originality tools on group assignments',
      description: 'LTI 1.3 Asset Processor tools (such as Turnitin or Copyleaks, where enabled) can now run on group assignments. Reports appear in the same places as individual assignments for you and for group members.',
      tags: ['Assignments', 'Groups', 'Academic Integrity']
    },
    {
      id: 704,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'Discussions — assess anonymous posts and include them in stats',
      description: 'With See Anonymous Post Author permission, you can view anonymous posts while assessing learners and in discussion statistics. Posts stay labeled Anonymous post for learners among classmates.',
      tags: ['Discussions', 'Grading']
    },
    {
      id: 705,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'Content — manage outcome coverage and alignments in one place',
      description: 'In the New Content Experience, review course-wide outcome coverage, drill into modules, and edit activity alignments (including bulk edits) from a single Outcomes Coverage workflow.',
      tags: ['Content', 'NCE', 'Learning Outcomes']
    },
    {
      id: 706,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'New Content Experience — Immersive View',
      description: 'When enabled by your institution, Content opens with a full-width Table of Contents landing page, and topics open in an immersive view with breadcrumbs and fewer chrome distractions for focused review.',
      tags: ['Content', 'NCE']
    },
    {
      id: 707,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'D2L Lumi Quiz — generate variants of existing questions',
      description: 'From Question Library, generate 1–10 variants of a question (Multiple Choice, True/False, Written Response, Multi-Select, or Short Answer), optionally with custom instructions or outcome focus. Lumi Pro add-on where licensed.',
      tags: ['Lumi Pro', 'Quizzes', 'AI Tools']
    },
    {
      id: 708,
      version: '20.26.07',
      date: 'July 2026',
      category: 'feature',
      title: 'D2L Lumi Remix — apply Creator+ Elements to pages',
      description: 'Lumi Remix can analyze a page and apply Creator+ Elements (accordions, callouts, stylized quotes, tabs) for you to refine in the editor. Requires Lumi Pro and Creator+ where licensed; New Content Experience.',
      tags: ['Lumi Pro', 'Creator+', 'Course Design']
    },
    {
      id: 709,
      version: '20.26.07',
      date: 'July 2026',
      category: 'improvement',
      title: 'Quizzes — autosave for Written Response with HTML Editor',
      description: 'Written Response questions that use the HTML Editor now autosave about every minute, matching the behavior already available for non-HTML Written Response questions.',
      tags: ['Quizzes', 'Learner Experience']
    },
    {
      id: 710,
      version: '20.26.07',
      date: 'July 2026',
      category: 'improvement',
      title: 'Assignments — publisher selection locks after submissions begin',
      description: 'After learners start submitting, the Publishers dropdown on the assignment can no longer be changed (you can still add or update publishers). Confirm publisher rules before the assignment opens to avoid recreating the activity.',
      tags: ['Assignments', 'Grading']
    },
    {
      id: 711,
      version: '20.26.07',
      date: 'July 2026',
      category: 'improvement',
      title: 'Help dialogs resize to fit the screen',
      description: 'Help text dialogs (question-mark icons in forms) now auto-resize to the viewport, scroll when needed, and keep content and action buttons visible.',
      tags: ['Accessibility', 'Workflow']
    },
    {
      id: 712,
      version: '20.26.07',
      date: 'July 2026',
      category: 'improvement',
      title: 'Content — cleaner look for embedded LTI activities',
      description: 'The default gray border around embedded LTI activities (including H5P) is removed on Content pages for a cleaner visual fit. Launch and accessibility behavior are unchanged.',
      tags: ['Content', 'LTI']
    },
    {
      id: 713,
      version: '20.26.07',
      date: 'July 2026',
      category: 'improvement',
      title: 'Group assignment legacy workflow — earlier retirement',
      description: 'The legacy group assignment creation page is now scheduled to retire in December 2026/20.26.12 (moved up from June 2027). Prefer the streamlined Group Assignments workflow when creating new group work.',
      tags: ['Assignments', 'Groups']
    },

    // June 2026 / 20.26.06 — see D2L KB 34976
    {
      id: 601,
      version: '20.26.06',
      date: 'June 2026',
      category: 'feature',
      title: 'Rubric icon on Assignments, Discussions & Quizzes lists',
      description: 'List pages for Assignments, Discussions, and Quizzes now show a rubric icon beside activities that have a rubric attached, so you can audit assessments at a glance. Written-response questions in quiz creation show the icon as well.',
      tags: ['Rubrics', 'Assignments', 'Quizzes', 'Discussions']
    },
    {
      id: 602,
      version: '20.26.06',
      date: 'June 2026',
      category: 'feature',
      title: 'New Content Experience — assessable activities open in-line by default',
      description: 'Assignments, Quizzes, Discussions, and instructor LTI links open in-line in the New Content Experience by default instead of a separate browser tab—creating a more unified content flow for you and students.',
      tags: ['Content', 'NCE']
    },
    {
      id: 603,
      version: '20.26.06',
      date: 'June 2026',
      category: 'feature',
      title: 'New Content Experience — enhanced Table of Contents by default',
      description: 'The enhanced Table of Contents is enabled by default, with unlimited module depth, completion indicators, expand/collapse without leaving the page, improved keyboard controls, and a layout that works better on smaller screens.',
      tags: ['Content', 'NCE', 'Accessibility']
    },
    {
      id: 605,
      version: '20.26.06',
      date: 'June 2026',
      category: 'feature',
      title: 'D2L Lumi Remix — full-screen and split-view review',
      description: 'When reviewing AI-generated page changes in Lumi Remix, use View Fullscreen or Compare in Split View to review iterations side-by-side. Requires the Lumi Pro add-on where your institution has licensed it.',
      tags: ['Lumi Pro', 'Course Design', 'AI Tools']
    },
    {
      id: 606,
      version: '20.26.06',
      date: 'June 2026',
      category: 'improvement',
      title: 'D2L Lumi Study Support — settings copy with the course',
      description: 'Quizzes with Lumi Study Support enabled keep that configuration when the course is copied, reducing manual re-setup in destination shells. Lumi Pro add-on where licensed.',
      tags: ['Lumi Pro', 'Quizzes', 'Course Copy']
    },
    {
      id: 607,
      version: '20.26.06',
      date: 'June 2026',
      category: 'improvement',
      title: 'D2L Lumi Tutor & Feedback — accessibility and feedback clarity',
      description: 'Lumi Tutor renders math with MathML for screen readers, adds multilingual Voice Mode, and improves Lumi Feedback with clearer automated-feedback labels in dashboards and exports. Lumi Tutor/Feedback add-ons where licensed.',
      tags: ['Lumi Pro', 'Accessibility', 'AI Tools']
    },

    // May 2026 / 20.26.05 — see D2L KB 34588
    {
      id: 501,
      version: '20.26.05',
      date: 'May 2026',
      category: 'improvement',
      title: 'Assignments — clearer Submissions page layout',
      description: 'The Assignments Submissions page layout is refined in standard and wide views, with less horizontal scrolling and better visibility of submission dates and learner names—especially when extra columns such as Turnitin similarity are enabled.',
      tags: ['Assignments', 'Grading', 'Accessibility']
    },
    {
      id: 502,
      version: '20.26.05',
      date: 'May 2026',
      category: 'improvement',
      title: 'Group assignments — new creation workflow on by default',
      description: 'Creating group assignments from the Groups tool now defaults to the streamlined Group Assignments workflow introduced in February. Prefer this flow—the legacy creation page is now scheduled to retire in December 2026.',
      tags: ['Assignments', 'Groups']
    },
    {
      id: 503,
      version: '20.26.05',
      date: 'May 2026',
      category: 'improvement',
      title: 'Grades — overdue feedback in Comments & Assessments',
      description: 'The Completion Status column is retired. When Automatic Zero is enabled in a course, overdue text now appears in the learner’s Comments & Assessments column (customizable by your institution) for Assignments, Quizzes, and Discussions.',
      tags: ['Grades', 'Learner Experience']
    },
    {
      id: 504,
      version: '20.26.05',
      date: 'May 2026',
      category: 'improvement',
      title: 'Quizzes — clearer Import buttons in Browse Question Library',
      description: 'Import options in Browse Question Library use dedicated buttons instead of a split dropdown—one Import action for quizzes without sections, and a separate Import to Section button when the quiz uses sections.',
      tags: ['Quizzes', 'Course Design']
    },

    // January 2026 / 20.26.01
    {
      id: 1,
      version: '20.26.01',
      date: 'January 2026',
      category: 'feature',
      title: 'AI Idea Generation in Assignments & Discussions',
      description: 'Generate Assignment and Discussion ideas in-tool with D2L Lumi Ideas, including free-text input and learning outcomes alignment.',
      tags: ['AI Tools', 'Course Design']
    },
    {
      id: 2,
      version: '20.26.01',
      date: 'January 2026',
      category: 'feature',
      title: 'Single Session Quiz Security',
      description: 'Optional setting to tie a quiz attempt to one login session to reduce mid-quiz device or browser switching.',
      tags: ['Quizzes', 'Academic Integrity']
    },
    {
      id: 3,
      version: '20.26.01',
      date: 'January 2026',
      category: 'improvement',
      title: 'Images in Announcement Emails',
      description: 'Inline images in announcements appear in the email body so students see full context without opening Brightspace.',
      tags: ['Communication', 'Announcements']
    },
    {
      id: 4,
      version: '20.26.01',
      date: 'January 2026',
      category: 'feature',
      title: 'Flexible Content Visibility (New Content Experience)',
      description: 'Topics can appear in the table of contents outside availability windows so students can plan ahead while access stays controlled.',
      tags: ['Content', 'NCE']
    },
    {
      id: 5,
      version: '20.26.01',
      date: 'January 2026',
      category: 'improvement',
      title: 'Accessibility Enhancements',
      description: 'Stronger screen reader support and labels in Assignments and Quick Eval.',
      tags: ['Accessibility']
    },
    {
      id: 6,
      version: '20.26.01',
      date: 'January 2026',
      category: 'improvement',
      title: 'Award Certificate Date Formats',
      description: 'Additional short-date formats for certificates on Awards.',
      tags: ['Awards']
    },

    // February 2026 / 20.26.02 — see D2L KB 33623
    {
      id: 201,
      version: '20.26.02',
      date: 'February 2026',
      category: 'feature',
      title: 'Group Assignments in Advanced Assessment',
      description: 'Group submissions work with Advanced Assessment: allocate evaluators to groups, use co-marking, delegation, and multi-evaluator workflows, and manage sections in allocations. Create groups first, then choose Group Assignment under Submission & Completion. Not available in Quick Eval.',
      tags: ['Assignments', 'Groups', 'Grading']
    },
    {
      id: 202,
      version: '20.26.02',
      date: 'February 2026',
      category: 'improvement',
      title: 'Streamlined Group Assignment Creation',
      description: 'Group assignments are centered on the new assignment creation experience, with a clearer path from the legacy page. Legacy assignment creation is planned for retirement in July 2027.',
      tags: ['Assignments']
    },
    {
      id: 203,
      version: '20.26.02',
      date: 'February 2026',
      category: 'improvement',
      title: 'Clearer Assignment File-Type Errors',
      description: 'Learners get more specific messages when a file type is not allowed; instructors must specify at least one extension when using Custom allowable file types (saves broken submissions).',
      tags: ['Assignments', 'Learner Experience']
    },
    {
      id: 204,
      version: '20.26.02',
      date: 'February 2026',
      category: 'improvement',
      title: 'Class Progress — Smoother Content Charts',
      description: 'Content Completed and Content Visited charts load as you scroll, reducing timeouts in large courses.',
      tags: ['Class Progress', 'Performance']
    },
    {
      id: 205,
      version: '20.26.02',
      date: 'February 2026',
      category: 'improvement',
      title: 'Enter Grades — Easier Horizontal Scrolling',
      description: 'Side arrows and an in-grid scroll bar make wide gradebooks easier to navigate; dropdowns are less likely to hide behind other cells.',
      tags: ['Grades', 'Gradebook']
    },
    {
      id: 206,
      version: '20.26.02',
      date: 'February 2026',
      category: 'improvement',
      title: 'Separate Groups & Sections Filters',
      description: 'Groups and Sections are split into their own searchable filters (with counts) across tools you use often—Classlist, Grades, Assignments, Discussions, Quizzes special access, Class Progress, and more.',
      tags: ['Classlist', 'Sections', 'Workflow']
    },

    // March 2026 / 20.26.03 — see D2L KB 34059
    {
      id: 301,
      version: '20.26.03',
      date: 'March 2026',
      category: 'feature',
      title: 'Classlist — Export to CSV & Richer Printouts',
      description: 'Export classlist details to CSV from the Classlist Export control; printed lists can include pronouns (when visible) and course identifiers for records or office hours.',
      tags: ['Classlist', 'Rosters']
    },
    {
      id: 302,
      version: '20.26.03',
      date: 'March 2026',
      category: 'improvement',
      title: 'Awards — More Room for Badge & Certificate Text',
      description: 'Higher character limits and preserved line breaks for name, description, criteria, and evidence fields on badges and certificates.',
      tags: ['Awards', 'Certificates']
    },

    // April 2026 / 20.26.04 — see D2L KB 34337
    {
      id: 401,
      version: '20.26.04',
      date: 'April 2026',
      category: 'feature',
      title: 'D2L Lumi Content — HTML templates on multiple pages (bulk)',
      description: 'When using Lumi Content, you can apply an HTML template to many generated pages at once via the Select Template bulk action—useful for large units. Requires the Lumi Pro add-on where your institution has licensed it.',
      tags: ['Lumi Pro', 'Course Design', 'Content']
    },
    {
      id: 402,
      version: '20.26.04',
      date: 'April 2026',
      category: 'improvement',
      title: 'D2L Lumi Ideas — custom instructions for AI assignments & discussions',
      description: 'Assignment and Discussion idea generation now includes a Custom Instructions field so you can steer tone, focus, audience, and constraints. Lumi Pro add-on where licensed.',
      tags: ['AI Tools', 'Assignments', 'Discussions']
    },
    {
      id: 403,
      version: '20.26.04',
      date: 'April 2026',
      category: 'improvement',
      title: 'D2L Lumi Quiz — custom instructions for AI-generated questions',
      description: 'The Generate Questions workflow includes Custom Instructions so quiz items better match your outcomes, difficulty, and style. Lumi Pro add-on where licensed.',
      tags: ['AI Tools', 'Quizzes']
    },
    {
      id: 404,
      version: '20.26.04',
      date: 'April 2026',
      category: 'improvement',
      title: 'Quizzes — faster review of incorrect answers',
      description: 'Quiz evaluation adds an Incorrect filter so you can focus on what the learner got wrong, and feedback fields expand automatically for easier reading and commenting.',
      tags: ['Quizzes', 'Grading', 'Time Saver']
    }
  ];

  function isUpcomingSummariesAvailable() {
    return new Date() >= UPCOMING_SUMMARIES_AVAILABLE;
  }

  let currentFilter = 'all';

  function filterByCategory(list, filter) {
    if (filter === 'all') return [...list];
    return list.filter(u => u.category === filter);
  }

  // ============================================
  // Initialize Page
  // ============================================
  function init() {
    setupEventListeners();
    updateSummaryCounts();
    renderUpdates();
  }

  // ============================================
  // Event Listeners
  // ============================================
  function setupEventListeners() {
    const filterTabs = document.querySelectorAll('.filter-tab');
    filterTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        const filter = this.getAttribute('data-filter');
        setActiveFilter(filter);
      });
    });
  }

  // ============================================
  // Filter Management
  // ============================================
  function setActiveFilter(filter) {
    currentFilter = filter;

    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-filter') === filter);
    });

    renderUpdates();
  }

  // ============================================
  // Update Summary Counts (current release only)
  // ============================================
  function updateSummaryCounts() {
    const counts = {
      feature: currentUpdatesData.filter(u => u.category === 'feature').length,
      improvement: currentUpdatesData.filter(u => u.category === 'improvement').length,
      bug: currentUpdatesData.filter(u => u.category === 'bug').length,
      security: currentUpdatesData.filter(u => u.category === 'security').length
    };

    const featuresCountEl = document.getElementById('features-count');
    const improvementsCountEl = document.getElementById('improvements-count');
    const bugFixesCountEl = document.getElementById('bug-fixes-count');
    const securityCountEl = document.getElementById('security-count');

    if (featuresCountEl) featuresCountEl.textContent = counts.feature;
    if (improvementsCountEl) improvementsCountEl.textContent = counts.improvement;
    if (bugFixesCountEl) bugFixesCountEl.textContent = counts.bug;
    if (securityCountEl) securityCountEl.textContent = counts.security;
  }

  // ============================================
  // Group Updates by Version
  // ============================================
  function groupUpdatesByVersion(updates) {
    const grouped = {};
    updates.forEach(update => {
      if (!grouped[update.version]) grouped[update.version] = [];
      grouped[update.version].push(update);
    });

    const sortedVersions = Object.keys(grouped).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );

    const sortedGrouped = {};
    sortedVersions.forEach(version => {
      sortedGrouped[version] = grouped[version];
    });
    return sortedGrouped;
  }

  // ============================================
  // Render Version Groups
  // ============================================
  function renderVersionGroupsHtml(updates, sectionIsCurrent) {
    if (updates.length === 0) {
      return `
        <div style="text-align: center; padding: 36px 24px; color: var(--text-medium);">
          <i class="fas fa-inbox" style="font-size: 40px; margin-bottom: 12px; opacity: 0.45;"></i>
          <p style="font-size: 15px;">No items in this category${sectionIsCurrent ? ' for the current release' : ' in archived releases'}.</p>
        </div>
      `;
    }

    const grouped = groupUpdatesByVersion(updates);
    let html = '';

    Object.keys(grouped).forEach(version => {
      const versionUpdates = grouped[version];
      const isCurrent = sectionIsCurrent && version === CURRENT_VERSION;
      const isUpcoming = !sectionIsCurrent && version === UPCOMING_VERSION && !isCurrent;
      const noteUrl = RELEASE_NOTE_URLS[version];
      const linkHtml = noteUrl
        ? `<a class="version-group-notes-link" href="${noteUrl}" target="_blank" rel="noopener noreferrer">Full release notes <i class="fas fa-external-link-alt" aria-hidden="true"></i></a>`
        : '';

      let badgeHtml = '<span class="version-group-badge archived">Archived</span>';
      if (isCurrent) {
        badgeHtml = '<span class="version-group-badge">Current release</span>';
      } else if (isUpcoming) {
        badgeHtml = '<span class="version-group-badge upcoming">Upcoming release</span>';
      }

      html += `
        <div class="version-group">
          <div class="version-group-header">
            <div>
              <span class="version-group-title">Brightspace v${version}</span>
              ${badgeHtml}
            </div>
            <div class="version-group-header-right">
              <div class="version-group-date">${versionUpdates[0].date}</div>
              ${linkHtml ? `<div class="version-group-notes-wrap">${linkHtml}</div>` : ''}
            </div>
          </div>
          ${versionUpdates.map(update => renderUpdateItem(update)).join('')}
        </div>
      `;
    });

    return html;
  }

  // ============================================
  // Render Updates
  // ============================================
  function renderUpcomingNotice() {
    return `
      <div class="updates-upcoming-notice" role="status">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        Faculty-focused summaries for <strong>September 2026 / ${UPCOMING_VERSION}</strong> will be published on this page on or after <strong>September 15, 2026</strong>, when the release is scheduled for your environment. Use the D2L release notes link above for the complete list until then.
      </div>
    `;
  }

  function renderUpdates() {
    const currentEl = document.getElementById('updates-list');
    const upcomingEl = document.getElementById('updates-list-upcoming');
    const archivedEl = document.getElementById('updates-list-archived');
    if (!currentEl || !archivedEl) return;

    const filteredCurrent = filterByCategory(currentUpdatesData, currentFilter);
    const filteredArchived = filterByCategory(archivedUpdatesData, currentFilter);

    currentEl.innerHTML = renderVersionGroupsHtml(filteredCurrent, true);
    archivedEl.innerHTML = renderVersionGroupsHtml(filteredArchived, false);

    if (upcomingEl) {
      const leadEl = document.getElementById('upcoming-section-lead');
      if (isUpcomingSummariesAvailable() && upcomingUpdatesData.length) {
        if (leadEl) {
          leadEl.innerHTML = 'Brightspace <strong>September 2026 / 20.26.09</strong> — scheduled for your environment on <strong>September 15, 2026</strong>. Summaries below are curated for teaching faculty; see <a href="https://community.d2l.com/brightspace/categories/release-notes-en" target="_blank" rel="noopener noreferrer">D2L release notes</a> for the full list.';
        }
        const filteredUpcoming = filterByCategory(upcomingUpdatesData, currentFilter);
        upcomingEl.innerHTML = renderVersionGroupsHtml(filteredUpcoming, false);
      } else {
        upcomingEl.innerHTML = renderUpcomingNotice();
      }
    }
  }

  // ============================================
  // Render Update Item
  // ============================================
  function renderUpdateItem(update) {
    const categoryLabels = {
      feature: 'NEW FEATURE',
      improvement: 'IMPROVEMENT',
      bug: 'BUG FIX',
      security: 'SECURITY'
    };

    const categoryIcons = {
      feature: 'fa-star',
      improvement: 'fa-arrow-up',
      bug: 'fa-bug',
      security: 'fa-shield-alt'
    };

    const tagsHtml = update.tags.map(tag =>
      `<span class="update-tag">${tag}</span>`
    ).join('');

    return `
      <div class="update-item" data-category="${update.category}">
        <div class="update-item-header">
          <span class="update-category-badge ${update.category}">
            <i class="fas ${categoryIcons[update.category]}" aria-hidden="true"></i>
            ${categoryLabels[update.category]}
          </span>
        </div>
        <h3 class="update-title">${update.title}</h3>
        <p class="update-description">${update.description}</p>
        ${update.tags && update.tags.length > 0 ? `<div class="update-tags">${tagsHtml}</div>` : ''}
      </div>
    `;
  }

  // ============================================
  // Initialize on DOM Ready
  // ============================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
