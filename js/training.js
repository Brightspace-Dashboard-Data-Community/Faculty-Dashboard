/**
 * D2L Faculty Dashboard - Training Page (static)
 * Tutorials and learning-path placeholders are defined in this file.
 * Edit STATIC_TRAINING_MODULES / WRITTEN_TUTORIAL_FILES to change content, then redeploy.
 */

(function() {
  'use strict';

  let allTrainingModules = [];
  let searchQuery = '';
  let difficultyFilter = 'all';

  /** Explicitly hidden from Faculty Training list per content request. */
  var HIDDEN_MODULE_TITLES = [
    'Navigate Brightspace and find your course',
    'Log in to Brightspace',
    'Customize your course navbar'
  ];

  /**
   * Curated D2L Community / local tutorial links.
   * @see https://community.d2l.com/brightspace/kb/articles/25590-welcome-to-the-higher-education-instructor-knowledge-base
   * @see https://www.youtube.com/playlist?list=PLxHabmZzFY6mbZnghbtOiYppofKPWe581
   */
  var STATIC_TRAINING_MODULES = [
    {
      id: 'static-ai-policy',
      title: 'Your Institution AI Policy (8.020)',
      description: 'Board Policy 8.020 in faculty language, with examples of acceptable use, shadow AI, prohibited student-data use, syllabus models A–C, and grading rules.',
      section: 'Getting Started',
      duration_minutes: 15,
      difficulty: 'BEGINNER',
      rating: 5.0,
      media_type: 'document',
      content_url: 'ai-policy.html',
      link_type: 'd2l',
      icon_name: 'document',
      display_order: 0
    },
    {
      id: 'static-gs-kb',
      title: 'Higher Education Instructor Knowledge Base',
      description: 'Official Brightspace help for instructors: get started, navigate the system, set up your course, create activities, engage learners, and evaluate work. Use the left navigation on the KB home for tool-specific articles.',
      section: 'Getting Started',
      duration_minutes: 15,
      difficulty: 'BEGINNER',
      rating: 5.0,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/25590-welcome-to-the-higher-education-instructor-knowledge-base',
      link_type: 'external',
      icon_name: 'link',
      display_order: 1
    },
    {
      id: 'static-gs-basics',
      title: 'D2L Brightspace Basics',
      description: 'Learn the fundamentals of navigating and using D2L Brightspace effectively.',
      section: 'Getting Started',
      duration_minutes: 15,
      difficulty: 'BEGINNER',
      rating: 4.8,
      media_type: 'video',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5451-navigate-brightspace-and-find-your-course',
      link_type: 'external',
      icon_name: 'play',
      display_order: 2
    },
    {
      id: 'static-gs-nav',
      title: 'Navigate Brightspace and find your course',
      description: 'Learn how to move around Brightspace and open the course you teach.',
      section: 'Getting Started',
      duration_minutes: 10,
      difficulty: 'BEGINNER',
      rating: 4.9,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5451-navigate-brightspace-and-find-your-course',
      link_type: 'external',
      icon_name: 'link',
      display_order: 3
    },
    {
      id: 'static-gs-first-course',
      title: 'Setting Up Your First Course',
      description: 'Step-by-step guide to creating and configuring your course structure.',
      section: 'Getting Started',
      duration_minutes: 20,
      difficulty: 'BEGINNER',
      rating: 4.9,
      media_type: 'settings',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3315-start-the-term',
      link_type: 'external',
      icon_name: 'gear',
      display_order: 4
    },
    {
      id: 'static-gs-settings',
      title: 'Change your personal settings in Brightspace',
      description: 'Update profile, notifications, and other personal preferences.',
      section: 'Getting Started',
      duration_minutes: 10,
      difficulty: 'BEGINNER',
      rating: 4.8,
      media_type: 'settings',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5464-change-your-personal-settings-in-brightspace',
      link_type: 'external',
      icon_name: 'gear',
      display_order: 5
    },
    {
      id: 'static-gs-login',
      title: 'Log in to Brightspace',
      description: 'Sign-in basics for the Brightspace learning environment.',
      section: 'Getting Started',
      duration_minutes: 5,
      difficulty: 'BEGINNER',
      rating: 4.8,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5791-log-in-to-brightspace',
      link_type: 'external',
      icon_name: 'link',
      display_order: 6
    },
    {
      id: 'static-gs-engaging',
      title: 'Creating Engaging Content',
      description: 'Learn to create multimedia content that engages and educates your students.',
      section: 'Getting Started',
      duration_minutes: 25,
      difficulty: 'BEGINNER',
      rating: 4.7,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3681-add-and-organize-learning-materials-in-the-new-content-experience-lessons',
      link_type: 'external',
      icon_name: 'document',
      display_order: 7
    },
    {
      id: 'static-gs-youtube',
      title: 'Instructor video tutorials (YouTube)',
      description: 'D2L’s Instructor playlist on YouTube—short videos on Brightspace tools and workflows.',
      section: 'Getting Started',
      duration_minutes: 20,
      difficulty: 'BEGINNER',
      rating: 4.9,
      media_type: 'video',
      content_url: 'https://www.youtube.com/playlist?list=PLxHabmZzFY6mbZnghbtOiYppofKPWe581',
      link_type: 'external',
      icon_name: 'youtube',
      display_order: 8
    },
    {
      id: 'static-cm-rollover-kit',
      title: 'Semester Rollover Kit',
      description: 'Prepare your upcoming Brightspace offering: confirm shells, copy or build, shift dates, Simple Syllabus, homepage, accessibility, and a student-view launch check.',
      section: 'Course Management',
      duration_minutes: 30,
      difficulty: 'BEGINNER',
      rating: 5.0,
      media_type: 'document',
      content_url: 'semester-rollover-kit.html',
      link_type: 'd2l',
      icon_name: 'document',
      display_order: 8
    },
    {
      id: 'static-cm-simple-syllabus',
      title: 'Simple Syllabus walkthrough',
      description: 'Add the Syllabus navbar link (ELC Nav - Grand - with Simple Syllabus), complete required fields, preview, and release to students.',
      section: 'Course Management',
      duration_minutes: 20,
      difficulty: 'BEGINNER',
      rating: 5.0,
      media_type: 'document',
      content_url: 'simple-syllabus-tutorial.html',
      link_type: 'd2l',
      icon_name: 'document',
      display_order: 9
    },
    {
      id: 'static-cm-navbar',
      title: 'Customize your course navbar',
      description: 'Add or reorder links so students can reach Content, Grades, Class Progress, and other tools.',
      section: 'Course Management',
      duration_minutes: 15,
      difficulty: 'INTERMEDIATE',
      rating: 4.8,
      media_type: 'settings',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3330-customize-your-course-navbar',
      link_type: 'external',
      icon_name: 'gear',
      display_order: 10
    },
    {
      id: 'static-cm-gradebook-mastery',
      title: 'Gradebook Mastery',
      description: 'Master the D2L gradebook with advanced grading techniques and automation.',
      section: 'Course Management',
      duration_minutes: 30,
      difficulty: 'INTERMEDIATE',
      rating: 4.9,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5327-about-grades',
      link_type: 'external',
      icon_name: 'calculator',
      display_order: 11
    },
    {
      id: 'static-cm-grades',
      title: 'Set up your Grade Book',
      description: 'Create a grading system, schemes, and grade items so the Grade Book matches your syllabus.',
      section: 'Course Management',
      duration_minutes: 25,
      difficulty: 'INTERMEDIATE',
      rating: 4.9,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3539-set-up-your-grade-book',
      link_type: 'external',
      icon_name: 'calculator',
      display_order: 12
    },
    {
      id: 'static-cm-discussions',
      title: 'Discussions & Forums',
      description: 'Create and manage engaging discussion forums to foster student collaboration.',
      section: 'Course Management',
      duration_minutes: 35,
      difficulty: 'INTERMEDIATE',
      rating: 4.6,
      media_type: 'video',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5316-about-discussions',
      link_type: 'external',
      icon_name: 'speech-bubbles',
      display_order: 13
    },
    {
      id: 'static-cm-assignments',
      title: 'Assignment Management',
      description: 'Streamline assignment creation, submission tracking, and feedback delivery.',
      section: 'Course Management',
      duration_minutes: 40,
      difficulty: 'INTERMEDIATE',
      rating: 4.8,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3304-about-assignments',
      link_type: 'external',
      icon_name: 'assignment',
      display_order: 14
    },
    {
      id: 'static-cm-content',
      title: 'Add and organize learning materials (Lessons)',
      description: 'Structure modules and topics in the New Content Experience (Lessons).',
      section: 'Course Management',
      duration_minutes: 20,
      difficulty: 'INTERMEDIATE',
      rating: 4.8,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3681-add-and-organize-learning-materials-in-the-new-content-experience-lessons',
      link_type: 'external',
      icon_name: 'document',
      display_order: 15
    },
    {
      id: 'static-cm-groups',
      title: 'Create categories and groups',
      description: 'Use groups for discussions, assignments, and differentiated activities.',
      section: 'Course Management',
      duration_minutes: 20,
      difficulty: 'INTERMEDIATE',
      rating: 4.7,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3483-create-and-manage-categories-and-groups',
      link_type: 'external',
      icon_name: 'speech-bubbles',
      display_order: 16
    },
    {
      id: 'static-cm-classlist',
      title: 'Review your Classlist',
      description: 'View enrollments, profiles, and quick actions for learners in your course.',
      section: 'Course Management',
      duration_minutes: 10,
      difficulty: 'INTERMEDIATE',
      rating: 4.8,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3680-review-your-classlist',
      link_type: 'external',
      icon_name: 'link',
      display_order: 17
    },
    {
      id: 'static-adv-analytics',
      title: 'Analytics & student insights',
      description: 'Use this dashboard’s Analytics area for course health, assignments, discussions, and quizzes. Pair with Brightspace Class Progress for per-learner engagement and activity.',
      section: 'Advanced Features',
      duration_minutes: 20,
      difficulty: 'ADVANCED',
      rating: 4.8,
      media_type: 'settings',
      content_url: 'analytics.html',
      link_type: 'd2l',
      icon_name: 'graph',
      display_order: 20
    },
    {
      id: 'static-adv-classprogress',
      title: 'Class Progress & learner activity',
      description: 'Open Class Progress from your course navigation to see class-wide indicators (for example content completion, logins, grades). Click a learner to open User Progress for detailed activity, including login and system access history where your institution enables it.',
      section: 'Advanced Features',
      duration_minutes: 20,
      difficulty: 'ADVANCED',
      rating: 4.8,
      media_type: 'document',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/5233-track-course-progress-with-the-class-progress-tool',
      link_type: 'external',
      icon_name: 'graph',
      display_order: 21
    },
    {
      id: 'static-adv-ia',
      title: 'Intelligent Agents',
      description: 'Automate emails when learners meet release conditions (for example missed work or quiz scores).',
      section: 'Advanced Features',
      duration_minutes: 25,
      difficulty: 'ADVANCED',
      rating: 4.7,
      media_type: 'settings',
      content_url: 'https://community.d2l.com/brightspace/kb/articles/3499-about-intelligent-agents',
      link_type: 'external',
      icon_name: 'gear',
      display_order: 22
    }
  ];

  var WRITTEN_TUTORIAL_FILES = [
    'Announcements_Scheduled_Targeted_Video_Messages.docx',
    'Automatic Zero in Grades.docx',
    'Bonus vs Extra Credit.docx',
    'Bulk Edit in Multiple Places.docx',
    'Class_Progress_Tracking_Student_Engagement.docx',
    'Copying Course Content in D2L Brightspace.docx',
    'Course Progress in D2L Brightspace.docx',
    'Creating_HTML_Pages_in_D2L_Brightspace.docx',
    'Creating_Learning_Paths_with_Release_Conditions.docx',
    'Creating_Randomized_Quizzes_Question_Pools.docx',
    'Creating_Weighted_vs_Points-Based_Gradebooks.docx',
    'Deleting Gradebook Items in D2L.docx',
    'Discussion Board must post first.docx',
    'Emailing from Classlist.docx',
    'Exempting_Students_from_Grade_Items.docx',
    'Grade Schemes in D2L Brightspace.docx',
    'Grading_Quiz_Attempts_Manually.docx',
    'Grading_with_Rubrics_in_Gradebook.docx',
    'Hiding_and_Releasing_Content_Modules.docx',
    'Intelligent Agents in D2L Brightspace.docx',
    'Linking_to_External_Tools_in_D2L.docx',
    'Managing_Start_and_End_Dates_for_a_Course.docx',
    'Quiz Submission Log & Force Submission.docx',
    'Release Conditions in D2L.docx',
    'Release Final Grade.docx',
    'Setting_Up_Grade_Calculation_Options.docx',
    'Setting_Up_Quiz_View_Options_and_Additional_Views.docx',
    'Setting_Up_Quizzes_to_Auto_Grade_and_Publish.docx',
    'Submit Final Grades from D2L.docx',
    'Using Rubrics in D2L Brightspace.docx',
    'Using Special Access in D2L Quiz.docx',
    'Using_Calendar_Effectively_for_Communication.docx',
    'Using_CreatorPlus_Tools_in_HTML_Pages.docx',
    'Using_Grade_Categories_for_Organization.docx',
    'Using_Manage_Files_to_Organize_Course_Content.docx',
    'Using_Respondus_LockDown_Browser_and_Monitor.docx',
    'Work To Do Widget in D2L Brightspace.docx'
  ];

  var STATIC_LEARNING_PATHS = [
    {
      id: 'lp-new-faculty',
      title: 'New Faculty Onboarding',
      description: 'Complete learning path for faculty new to D2L Brightspace.',
      icon_name: 'arrow',
      module_ids: [],
      isPlaceholder: true
    },
    {
      id: 'lp-advanced',
      title: 'Advanced Teaching Techniques',
      description: 'Master advanced features for experienced educators.',
      icon_name: 'trophy',
      module_ids: [],
      isPlaceholder: true
    }
  ];

  function toTitleFromFilename(filename) {
    return filename
      .replace(/\.docx$/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inferTutorialSection(filenameLower) {
    if (
      filenameLower.indexOf('copying course content') !== -1 ||
      filenameLower.indexOf('managing start and end dates') !== -1 ||
      filenameLower.indexOf('work to do widget') !== -1 ||
      filenameLower.indexOf('emailing from classlist') !== -1 ||
      filenameLower.indexOf('bulk edit') !== -1
    ) {
      return 'Getting Started';
    }
    if (
      filenameLower.indexOf('intelligent agents') !== -1 ||
      filenameLower.indexOf('course progress') !== -1 ||
      filenameLower.indexOf('class_progress') !== -1 ||
      filenameLower.indexOf('quiz') !== -1 ||
      filenameLower.indexOf('respondus') !== -1 ||
      filenameLower.indexOf('special access') !== -1 ||
      filenameLower.indexOf('automatic zero') !== -1 ||
      filenameLower.indexOf('bonus vs extra credit') !== -1 ||
      filenameLower.indexOf('release final grade') !== -1 ||
      filenameLower.indexOf('submit final grades') !== -1
    ) {
      return 'Advanced Features';
    }
    return 'Course Management';
  }

  function inferDifficultyBySection(sectionName) {
    if (sectionName === 'Getting Started') {
      return 'BEGINNER';
    }
    if (sectionName === 'Advanced Features') {
      return 'ADVANCED';
    }
    return 'INTERMEDIATE';
  }

  var WRITTEN_TUTORIAL_MODULES = WRITTEN_TUTORIAL_FILES.map(function(filename, idx) {
    var section = inferTutorialSection(filename.toLowerCase());
    return {
      id: 'print-' + (idx + 1),
      title: toTitleFromFilename(filename),
      description: 'Printable written tutorial (DOCX).',
      section: section,
      duration_minutes: 15,
      difficulty: inferDifficultyBySection(section),
      rating: 4.8,
      media_type: 'document',
      content_url: 'tutorials/' + filename,
      link_type: 'document',
      icon_name: 'docx',
      display_order: 100 + idx,
      isStatic: true
    };
  });

  function getAllTrainingModules() {
    var curated = STATIC_TRAINING_MODULES.filter(function(m) {
      return HIDDEN_MODULE_TITLES.indexOf(m.title) === -1;
    }).map(function(m) {
      return Object.assign({}, m, { isStatic: true });
    });

    var merged = curated.concat(WRITTEN_TUTORIAL_MODULES);
    var sectionOrder = { 'Getting Started': 0, 'Course Management': 1, 'Advanced Features': 2 };
    merged.sort(function(a, b) {
      var sa = sectionOrder[a.section] !== undefined ? sectionOrder[a.section] : 99;
      var sb = sectionOrder[b.section] !== undefined ? sectionOrder[b.section] : 99;
      if (sa !== sb) {
        return sa - sb;
      }
      return (a.display_order || 0) - (b.display_order || 0);
    });
    return merged;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getDifficultyColor(difficulty) {
    switch (difficulty) {
      case 'BEGINNER':
        return '#10b981';
      case 'INTERMEDIATE':
        return '#f59e0b';
      case 'ADVANCED':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  }

  function getMediaIcon(mediaType) {
    switch (mediaType) {
      case 'video':
        return 'fa-play';
      case 'document':
        return 'fa-file-alt';
      case 'settings':
        return 'fa-cog';
      default:
        return 'fa-circle';
    }
  }

  function getIconName(iconName) {
    const iconMap = {
      'pdf': 'fa-file-pdf',
      'docx': 'fa-file-word',
      'link': 'fa-link',
      'yuja': 'fa-play-circle',
      'youtube': 'fa-youtube',
      'play': 'fa-play',
      'gear': 'fa-cog',
      'document': 'fa-file-alt',
      'calculator': 'fa-calculator',
      'speech-bubbles': 'fa-comments',
      'assignment': 'fa-clipboard-check',
      'graph': 'fa-chart-line',
      'code': 'fa-code',
      'accessibility': 'fa-universal-access',
      'arrow': 'fa-arrow-right',
      'trophy': 'fa-trophy'
    };
    return iconMap[iconName] || 'fa-circle';
  }

  function filterTrainingModules(modules, query, difficulty) {
    let filtered = modules;

    if (query && query.trim() !== '') {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(function(item) {
        return item.title.toLowerCase().includes(lowerQuery) ||
          item.description.toLowerCase().includes(lowerQuery) ||
          (item.section && item.section.toLowerCase().includes(lowerQuery));
      });
    }

    if (difficulty && difficulty !== 'all') {
      filtered = filtered.filter(function(item) {
        return item.difficulty === difficulty;
      });
    }

    return filtered;
  }

  function encodeModuleHref(url) {
    if (!url) {
      return '';
    }
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
      return encodeURI(url);
    }
    return url.split('/').map(function(segment) {
      return encodeURIComponent(segment);
    }).join('/');
  }

  function renderTrainingCard(module) {
    const difficultyColor = getDifficultyColor(module.difficulty);
    const mediaIcon = getMediaIcon(module.media_type);
    const secondaryIconClass = getIconName(module.icon_name);
    const moduleHref = encodeModuleHref(module.content_url);
    const isPrintableDocx = module.link_type === 'document' &&
      module.content_url &&
      module.content_url.indexOf('tutorials/') === 0;
    const actionLabel = isPrintableDocx ? 'Download DOCX' : 'View Tutorial';

    return `
      <div class="training-card" data-id="${escapeHtml(String(module.id))}">
        <div class="training-card-icon" style="background-color: ${difficultyColor};">
          <i class="fas ${mediaIcon}"></i>
        </div>
        ${module.icon_name ? `
          <div class="training-card-secondary-icon">
            <i class="fas ${secondaryIconClass}"></i>
          </div>
        ` : ''}
        <h3 class="training-card-title">${escapeHtml(module.title)}</h3>
        ${isPrintableDocx ? `
          <div class="training-card-badges">
            <span class="training-card-badge training-card-badge--printable">
              <i class="fas fa-print" aria-hidden="true"></i> Printable
            </span>
          </div>
        ` : ''}
        <p class="training-card-description">${escapeHtml(module.description)}</p>
        <div class="training-card-details">
          <span class="training-duration">
            <i class="fas fa-clock"></i>
            ${module.duration_minutes} min
          </span>
          <span class="training-difficulty" style="background-color: ${difficultyColor};">
            ${escapeHtml(module.difficulty)}
          </span>
          <span class="training-rating">
            <i class="fas fa-star"></i>
            ${module.rating || '0.0'}
          </span>
        </div>
        ${module.content_url ? `<a href="${escapeHtml(moduleHref)}" class="training-card-link"${module.content_url.indexOf('http') === 0 ? ' target="_blank" rel="noopener noreferrer"' : ''}>${actionLabel} →</a>` : ''}
      </div>
    `;
  }

  function renderTrainingModules(modules) {
    const container = document.getElementById('training-modules-container');
    if (!container) return;

    allTrainingModules = modules;
    const filteredModules = filterTrainingModules(modules, searchQuery, difficultyFilter);

    const sections = {
      'Getting Started': [],
      'Course Management': [],
      'Advanced Features': []
    };

    filteredModules.forEach(function(module) {
      if (sections[module.section]) {
        sections[module.section].push(module);
      }
    });

    let html = '';
    Object.keys(sections).forEach(function(sectionName) {
      const sectionModules = sections[sectionName];
      if (sectionModules.length === 0) return;

      html += `
        <div class="training-section">
          <h2 class="section-title">${escapeHtml(sectionName)}</h2>
          <div class="training-grid">
            ${sectionModules.map(renderTrainingCard).join('')}
          </div>
        </div>
      `;
    });

    if (html === '') {
      html = '<div class="no-training">No training modules found' +
        (searchQuery || difficultyFilter !== 'all' ? ' matching your filters.' : ' at this time.') +
        '</div>';
    }

    container.innerHTML = html;
  }

  function renderLearningPathCard(path) {
    const iconClass = getIconName(path.icon_name || 'arrow');
    const moduleCount = path.module_ids ? path.module_ids.length : 0;

    return `
      <div class="learning-path-card learning-path-card--coming-soon" data-id="${escapeHtml(String(path.id))}">
        <div class="learning-path-icon">
          <i class="fas ${iconClass}"></i>
        </div>
        <span class="learning-path-coming-soon-badge">Coming soon</span>
        <h3 class="learning-path-title">${escapeHtml(path.title)}</h3>
        <p class="learning-path-description">${escapeHtml(path.description)}</p>
        <div class="learning-path-info">
          <span>${moduleCount} tutorial${moduleCount !== 1 ? 's' : ''}</span>
        </div>
        <button type="button" class="learning-path-button learning-path-button--coming-soon" disabled aria-disabled="true">Coming soon</button>
      </div>
    `;
  }

  function renderLearningPaths(paths) {
    const container = document.getElementById('learning-paths-container');
    if (!container) return;

    container.innerHTML = `
      <div class="learning-paths-section">
        <h2 class="section-title">Recommended Learning Paths</h2>
        <p class="learning-paths-coming-soon-note">All learning paths are coming soon.</p>
        <div class="learning-paths-grid">
          ${paths.map(renderLearningPathCard).join('')}
        </div>
      </div>
    `;
  }

  function createSearchAndFilters() {
    const container = document.getElementById('training-modules-container');
    if (!container) return;

    const searchContainer = document.createElement('div');
    searchContainer.className = 'training-search-container';
    searchContainer.innerHTML = `
      <div class="training-search-wrapper">
        <i class="fas fa-search training-search-icon" aria-hidden="true"></i>
        <input
          type="text"
          id="training-search-input"
          class="training-search-input"
          placeholder="Search tutorials..."
          aria-label="Search tutorials"
        >
        <button class="training-search-clear" id="training-search-clear" aria-label="Clear search" style="display: none;">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="training-filters">
        <button class="filter-btn ${difficultyFilter === 'all' ? 'active' : ''}" data-filter="all">All Tutorials</button>
        <button class="filter-btn ${difficultyFilter === 'BEGINNER' ? 'active' : ''}" data-filter="BEGINNER">Beginner</button>
        <button class="filter-btn ${difficultyFilter === 'INTERMEDIATE' ? 'active' : ''}" data-filter="INTERMEDIATE">Intermediate</button>
        <button class="filter-btn ${difficultyFilter === 'ADVANCED' ? 'active' : ''}" data-filter="ADVANCED">Advanced</button>
      </div>
    `;

    container.parentNode.insertBefore(searchContainer, container);

    const searchInput = document.getElementById('training-search-input');
    const clearBtn = document.getElementById('training-search-clear');

    searchInput.addEventListener('input', function() {
      searchQuery = this.value.trim();
      clearBtn.style.display = searchQuery ? 'block' : 'none';
      renderTrainingModules(allTrainingModules);
    });

    clearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchQuery = '';
      clearBtn.style.display = 'none';
      renderTrainingModules(allTrainingModules);
    });

    searchContainer.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        difficultyFilter = this.dataset.filter;
        searchContainer.querySelectorAll('.filter-btn').forEach(function(b) {
          b.classList.remove('active');
        });
        this.classList.add('active');
        renderTrainingModules(allTrainingModules);
      });
    });
  }

  function init() {
    try {
      createSearchAndFilters();
      renderTrainingModules(getAllTrainingModules());
      renderLearningPaths(STATIC_LEARNING_PATHS);
      console.log('✅ Training page initialized (static)');
    } catch (e) {
      console.error('Error initializing training page:', e);
      var modulesContainer = document.getElementById('training-modules-container');
      if (modulesContainer) {
        modulesContainer.innerHTML =
          '<div class="no-training">Error loading training content. Please try refreshing the page.</div>';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
