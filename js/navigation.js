/**
 * D2L Faculty Dashboard - Navigation Controller
 * Handles hamburger menu toggle and responsive behavior
 */

(function() {
  'use strict';

  // ============================================
  // Constants
  // ============================================
  var API_VERSION_LP = "1.51";
  var NAV_SCRIPT_MARKER = "/js/navigation.js";
  /** Filenames that resolve to the Reports nav item (legacy bookmark + canonical). */
  var REPORTS_PAGE_FILES = {
    "reports.html": true,
    "ia-email-checker-my-courses.html": true,
    "intelligent-agent-email-settings-report.html": true
  };
  /** Filenames that should expand/activate the Tools & Reports nav section. */
  var TOOLS_PAGE_FILES = {
    "tools.html": true,
    "reports.html": true,
    "ia-email-checker-my-courses.html": true,
    "intelligent-agent-email-settings-report.html": true,
    "course-management-tools.html": true,
    "student-management-tools.html": true,
    "analytics-reports-tools.html": true,
    "course-merge-form.html": true,
    "26SP-Course-Merge.html": true,
    "26FA-Course-Merge.html": true,
    "27WI-Course-Merge.html": true,
    "sandbox-course.html": true,
    "grade-export-utility.html": true,
    "ai-learning-companion.html": true,
    "intelligent-agent-deployer.html": true,
    "intelligent-agent-builder.html": true,
    "private-student-conversations.html": true,
    "due-date-wizard.html": true,
    "checklist-creator.html": true,
    "bulk-availability-editor.html": true,
    "bulk-discussion-editor.html": true,
    "bulk-gradebook-editor.html": true,
    "bulk-announcement-scheduler.html": true,
    "course-package-deployer.html": true,
    "term-rollover-assistant.html": true,
    "semester-rollover-kit.html": true,
    "learner-accommodations.html": true,
    "student-ldaa-lookup.html": true,
    "ldaa-period-report.html": true,
    "inactive-student-audit.html": true,
    "faculty-course-adds.html": true,
    "engagement-interaction.html": true,
    "discussion-tone.html": true,
    "feedback-tone.html": true,
    "tone-checker.html": true,
    "end-of-semester-report.html": true
  };
  /** Map child pages to a “Back to …” section link (tutorial-style breadcrumb). */
  var SECTION_BACK_LINKS = {
    // Tools & Reports hubs
    "course-management-tools.html": { href: "tools.html", label: "Back to Tools & Reports" },
    "student-management-tools.html": { href: "tools.html", label: "Back to Tools & Reports" },
    "analytics-reports-tools.html": { href: "tools.html", label: "Back to Tools & Reports" },

    // Course Management children
    "course-merge-form.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "sandbox-course.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "grade-export-utility.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "ai-learning-companion.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "intelligent-agent-deployer.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "intelligent-agent-builder.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "private-student-conversations.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "due-date-wizard.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "checklist-creator.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "bulk-availability-editor.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "bulk-discussion-editor.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "bulk-gradebook-editor.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "bulk-announcement-scheduler.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "course-package-deployer.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "term-rollover-assistant.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "semester-rollover-kit.html": { href: "course-management-tools.html", label: "Back to Course Management" },
    "26SP-Course-Merge.html": { href: "course-merge-form.html", label: "Back to Course Merge Form" },
    "26FA-Course-Merge.html": { href: "course-merge-form.html", label: "Back to Course Merge Form" },
    "27WI-Course-Merge.html": { href: "course-merge-form.html", label: "Back to Course Merge Form" },

    // User Management children
    "learner-accommodations.html": { href: "student-management-tools.html", label: "Back to User Management" },
    "student-ldaa-lookup.html": { href: "student-management-tools.html", label: "Back to User Management" },
    "ldaa-period-report.html": { href: "student-management-tools.html", label: "Back to User Management" },
    "inactive-student-audit.html": { href: "student-management-tools.html", label: "Back to User Management" },
    "faculty-course-adds.html": { href: "student-management-tools.html", label: "Back to User Management" },

    // Analytics & Reports children (tools hub + nested analytics pages)
    "intelligent-agent-email-settings-report.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "ia-email-checker-my-courses.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "analytics.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "analytics-old.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "assignments.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "quizzes.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "discussions.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "one-on-one-discussions.html": { href: "discussions.html", label: "Back to Discussions" },
    "engagement-interaction.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "discussion-tone.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "feedback-tone.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "tone-checker.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "end-of-semester-report.html": { href: "analytics-reports-tools.html", label: "Back to Analytics & Reports" },
    "quiz-detail.html": { href: "quizzes.html", label: "Back to Quizzes" },

    // Faculty Training / orientation children
    "dashboard-orientation.html": { href: "index.html", label: "Back to Home" },
    "simple-syllabus-tutorial.html": { href: "faculty-training.html", label: "Back to Faculty Tutorials" },
    "course-widgets.html": { href: "faculty-training.html", label: "Back to Faculty Tutorials" },
    "ai-policy.html": { href: "faculty-training.html", label: "Back to Faculty Tutorials" },

    // Accessibility children
    "accessibility-tutorials.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-d2l-webpages.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-word.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-powerpoint.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-pdf.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-excel.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-multimedia.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-email.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-google-docs.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-google-slides.html": { href: "accessibility.html", label: "Back to Accessibility" },
    "accessibility-guide-google-sheets.html": { href: "accessibility.html", label: "Back to Accessibility" }
  };
  /** Map tool pages to their Tools submenu hub for active highlighting. */
  var TOOLS_SUBMENU_HUB = {
    "course-management-tools.html": "course-management-tools.html",
    "course-merge-form.html": "course-management-tools.html",
    "26SP-Course-Merge.html": "course-management-tools.html",
    "26FA-Course-Merge.html": "course-management-tools.html",
    "27WI-Course-Merge.html": "course-management-tools.html",
    "sandbox-course.html": "course-management-tools.html",
    "grade-export-utility.html": "course-management-tools.html",
    "ai-learning-companion.html": "course-management-tools.html",
    "intelligent-agent-deployer.html": "course-management-tools.html",
    "intelligent-agent-builder.html": "course-management-tools.html",
    "private-student-conversations.html": "course-management-tools.html",
    "due-date-wizard.html": "course-management-tools.html",
    "checklist-creator.html": "course-management-tools.html",
    "bulk-availability-editor.html": "course-management-tools.html",
    "bulk-discussion-editor.html": "course-management-tools.html",
    "bulk-gradebook-editor.html": "course-management-tools.html",
    "bulk-announcement-scheduler.html": "course-management-tools.html",
    "course-package-deployer.html": "course-management-tools.html",
    "term-rollover-assistant.html": "course-management-tools.html",
    "semester-rollover-kit.html": "course-management-tools.html",
    "student-management-tools.html": "student-management-tools.html",
    "learner-accommodations.html": "student-management-tools.html",
    "student-ldaa-lookup.html": "student-management-tools.html",
    "ldaa-period-report.html": "student-management-tools.html",
    "inactive-student-audit.html": "student-management-tools.html",
    "faculty-course-adds.html": "student-management-tools.html",
    "analytics-reports-tools.html": "analytics-reports-tools.html",
    "reports.html": "analytics-reports-tools.html",
    "ia-email-checker-my-courses.html": "analytics-reports-tools.html",
    "intelligent-agent-email-settings-report.html": "analytics-reports-tools.html",
    "engagement-interaction.html": "analytics-reports-tools.html",
    "discussion-tone.html": "analytics-reports-tools.html",
    "feedback-tone.html": "analytics-reports-tools.html",
    "tone-checker.html": "analytics-reports-tools.html",
    "end-of-semester-report.html": "analytics-reports-tools.html"
  };
  /** Filenames under Analytics → Discussions subsection. */
  var DISCUSSIONS_PAGE_FILES = {
    "discussions.html": true,
    "one-on-one-discussions.html": true
  };

  // ============================================
  // DOM Elements
  // ============================================
  let navContainer = null;
  let navToggle = null;
  let mainContent = null;
  let navOverlay = null;
  let isCollapsed = false;
  let isMobile = false;

  // ============================================
  // Resolve dashboard root from this script URL (works when the page URL path
  // is not the HTML file path, e.g. some LMS content viewer URLs).
  // ============================================
  function getDashboardRootFromScript() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      var idx = src.indexOf(NAV_SCRIPT_MARKER);
      if (idx !== -1) {
        return src.slice(0, idx + 1);
      }
    }
    return "";
  }

  function hrefPageName(href) {
    if (!href || href.charAt(0) === "#") {
      return "";
    }
    var path = href.split("?")[0].split("#")[0];
    var parts = path.split("/");
    return parts[parts.length - 1] || "";
  }

  function isDashboardRelativeHref(href) {
    if (!href) {
      return false;
    }
    if (href.charAt(0) === "#" || href.charAt(0) === "/") {
      return false;
    }
    if (href.indexOf("://") !== -1 || href.indexOf("mailto:") === 0 || href.indexOf("javascript:") === 0) {
      return false;
    }
    if (href.indexOf("../") !== -1) {
      return false;
    }
    return true;
  }

  function resolveDashboardHref(href) {
    if (!isDashboardRelativeHref(href)) {
      return href;
    }
    var root = getDashboardRootFromScript();
    if (!root) {
      return href;
    }
    return root + href.replace(/^\.\//, "");
  }

  function rewriteDashboardRelativeHrefs(root, selector) {
    if (!root) {
      return;
    }
    var links = document.querySelectorAll(selector);
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (!isDashboardRelativeHref(href)) {
        continue;
      }
      links[i].setAttribute("href", root + href.replace(/^\.\//, ""));
    }
  }

  function normalizeCurrentPageName() {
    var currentPath = window.location.pathname || "";
    var currentPage = currentPath.split("/").pop() || "index.html";
    var q = currentPage.indexOf("?");
    if (q !== -1) {
      currentPage = currentPage.slice(0, q);
    }
    return currentPage;
  }

  function hrefMatchesCurrentPage(href, currentPage) {
    if (!href || href.charAt(0) === "#") {
      return false;
    }
    var hrefPage = hrefPageName(href);
    if (hrefPage === currentPage || href === currentPage || href.endsWith("/" + currentPage)) {
      return true;
    }
    if (hrefPage === "analytics.html" && currentPage === "analytics-old.html") {
      return true;
    }
    if (hrefPage === "reports.html" && REPORTS_PAGE_FILES[currentPage]) {
      return true;
    }
    // Parent Tools hub stays active for any tools page
    if (hrefPage === "tools.html" && TOOLS_PAGE_FILES[currentPage]) {
      return true;
    }
    // Faculty Training stays active for tutorial/guide children
    if (
      hrefPage === "faculty-training.html" &&
      (currentPage === "simple-syllabus-tutorial.html" ||
        currentPage === "course-widgets.html" ||
        currentPage === "dashboard-orientation.html" ||
        currentPage === "ai-policy.html")
    ) {
      return true;
    }
    // Tools submenu hub links stay active for their category pages
    if (TOOLS_SUBMENU_HUB[currentPage] && hrefPage === TOOLS_SUBMENU_HUB[currentPage]) {
      return true;
    }
    return false;
  }

  // ============================================
  // Initialize Navigation
  // ============================================
  function initNavigation() {
    navContainer = document.querySelector('.nav-container');
    navToggle = document.querySelector('.nav-toggle');
    mainContent = document.querySelector('.main-content');
    
    if (!navContainer || !navToggle || !mainContent) {
      console.warn('Navigation elements not found');
      return;
    }

    // Check if mobile
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Load saved state from localStorage
    const savedState = localStorage.getItem('navCollapsed');
    if (savedState === 'true' && !isMobile) {
      isCollapsed = true;
      updateNavState();
    }

    // Toggle button event
    navToggle.addEventListener('click', handleToggle);
    navToggle.setAttribute('aria-label', 'Toggle navigation menu');
    navToggle.setAttribute('aria-expanded', !isCollapsed);

    // Create mobile overlay if on mobile
    if (isMobile) {
      createMobileOverlay();
    }

    // Keyboard navigation support
    setupKeyboardNavigation();

    // Close menu when clicking outside on mobile
    if (isMobile) {
      document.addEventListener('click', handleOutsideClick);
    }

    // Load user info from whoami API
    loadUserInfo();
  }

  // ============================================
  // Mobile Detection
  // ============================================
  function checkMobile() {
    const wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;

    if (wasMobile !== isMobile) {
      // Reset state when switching between mobile/desktop
      if (isMobile) {
        navContainer.classList.remove('collapsed');
        mainContent.classList.remove('nav-collapsed');
        createMobileOverlay();
      } else {
        if (navOverlay) {
          navOverlay.remove();
          navOverlay = null;
        }
        // Restore saved desktop state
        const savedState = localStorage.getItem('navCollapsed');
        if (savedState === 'true') {
          isCollapsed = true;
          updateNavState();
        }
      }
    }
  }

  // ============================================
  // Toggle Handler
  // ============================================
  function handleToggle(e) {
    e.preventDefault();
    e.stopPropagation();

    if (isMobile) {
      // Mobile: toggle open/close
      const isOpen = navContainer.classList.contains('mobile-open');
      if (isOpen) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    } else {
      // Desktop: toggle collapsed/expanded
      isCollapsed = !isCollapsed;
      updateNavState();
      localStorage.setItem('navCollapsed', isCollapsed.toString());
    }
  }

  // ============================================
  // Update Navigation State (Desktop)
  // ============================================
  function updateNavState() {
    if (isCollapsed) {
      navContainer.classList.add('collapsed');
      mainContent.classList.add('nav-collapsed');
    } else {
      navContainer.classList.remove('collapsed');
      mainContent.classList.remove('nav-collapsed');
    }
    
    navToggle.setAttribute('aria-expanded', !isCollapsed);
  }

  // ============================================
  // Mobile Menu Functions
  // ============================================
  function createMobileOverlay() {
    if (navOverlay) return;

    navOverlay = document.createElement('div');
    navOverlay.className = 'nav-overlay';
    navOverlay.setAttribute('aria-hidden', 'true');
    navOverlay.addEventListener('click', closeMobileMenu);
    document.body.appendChild(navOverlay);
  }

  function openMobileMenu() {
    navContainer.classList.add('mobile-open');
    if (navOverlay) {
      navOverlay.classList.add('active');
      navOverlay.setAttribute('aria-hidden', 'false');
    }
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; // Prevent body scroll
  }

  function closeMobileMenu() {
    navContainer.classList.remove('mobile-open');
    if (navOverlay) {
      navOverlay.classList.remove('active');
      navOverlay.setAttribute('aria-hidden', 'true');
    }
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = ''; // Restore body scroll
  }

  // ============================================
  // Outside Click Handler (Mobile)
  // ============================================
  function handleOutsideClick(e) {
    if (isMobile && navContainer.classList.contains('mobile-open')) {
      if (!navContainer.contains(e.target) && e.target !== navToggle) {
        closeMobileMenu();
      }
    }
  }

  // ============================================
  // Keyboard Navigation
  // ============================================
  function setupKeyboardNavigation() {
    // ESC key closes mobile menu
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && isMobile && navContainer.classList.contains('mobile-open')) {
        closeMobileMenu();
        navToggle.focus();
      }
    });

    // Arrow key navigation in menu
    const menuLinks = document.querySelectorAll('.nav-menu-link');
    menuLinks.forEach((link, index) => {
      link.addEventListener('keydown', function(e) {
        let targetIndex = -1;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          targetIndex = (index + 1) % menuLinks.length;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          targetIndex = (index - 1 + menuLinks.length) % menuLinks.length;
        } else if (e.key === 'Home') {
          e.preventDefault();
          targetIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          targetIndex = menuLinks.length - 1;
        }

        if (targetIndex >= 0) {
          menuLinks[targetIndex].focus();
        }
      });
    });
  }

  // ============================================
  // User Info Functions
  // ============================================
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
      error.isExpected = (res.status === 403 || res.status === 404);
      throw error;
    }
    return await res.json();
  }

  async function getUserInfo() {
    try {
      var data = await BrightspaceFetch("/d2l/api/lp/" + API_VERSION_LP + "/users/whoami");
      return {
        // whoami returns Identifier (D2L user id), not UserId
        userId: data.Identifier || data.UserId || null,
        firstName: data.FirstName || "",
        lastName: data.LastName || "",
        userName: data.UniqueName || "",
        profileImageUrl: data.ProfileImageUrl || null
      };
    } catch (e) {
      console.warn("Failed to fetch user info:", e);
      return { userId: null, firstName: "Instructor", lastName: "", userName: "", profileImageUrl: null };
    }
  }

  function getProfileImageUrl(userId) {
    // Current user's profile image (preferred for nav avatar)
    // Docs: GET /d2l/api/lp/(version)/profile/myProfile/image
    // Alternate by id: GET /d2l/api/lp/(version)/profile/user/(userId)/image
    if (userId) {
      return "/d2l/api/lp/" + API_VERSION_LP + "/profile/user/" + userId + "/image";
    }
    return "/d2l/api/lp/" + API_VERSION_LP + "/profile/myProfile/image";
  }

  async function loadUserInfo() {
    try {
      var userInfo = await getUserInfo();
      var userAvatar = document.querySelector('.nav-user-avatar');
      var userName = document.querySelector('.nav-user-name');
      var userRole = document.querySelector('.nav-user-role');

      if (!userAvatar || !userName || !userRole) {
        console.warn("User info elements not found in navigation");
        return;
      }

      // Update user name
      var fullName = (userInfo.firstName + " " + userInfo.lastName).trim();
      if (fullName) {
        userName.textContent = fullName;
      } else {
        userName.textContent = "Instructor";
      }

      // Remove "Faculty" role text (as requested) and hide the element
      userRole.textContent = "";
      userRole.style.display = "none";

      // Update avatar with profile image or initials
      if (userInfo.profileImageUrl) {
        // Use profile image URL from whoami if available
        userAvatar.innerHTML = '<img src="' + userInfo.profileImageUrl + '" alt="User profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">';
      } else {
        // Try to get profile image from D2L API
        var profileImageUrl = getProfileImageUrl(userInfo.userId);
        if (profileImageUrl) {
          // Try to load the image, fallback to initials if it fails
          var img = new Image();
          img.onload = function() {
            userAvatar.innerHTML = '<img src="' + profileImageUrl + '" alt="User profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">';
          };
          img.onerror = function() {
            // Fallback to initials
            setInitialsAvatar(userAvatar, userInfo.firstName, userInfo.lastName);
          };
          img.src = profileImageUrl;
        } else {
          // Fallback to initials
          setInitialsAvatar(userAvatar, userInfo.firstName, userInfo.lastName);
        }
      }
    } catch (e) {
      console.error("Error loading user info:", e);
    }
  }

  function setInitialsAvatar(avatarElement, firstName, lastName) {
    var initials = "";
    if (firstName) initials += firstName.charAt(0).toUpperCase();
    if (lastName) initials += lastName.charAt(0).toUpperCase();
    if (!initials) initials = "I"; // Fallback to "I" for Instructor
    
    avatarElement.innerHTML = initials;
    avatarElement.style.display = "flex";
    avatarElement.style.alignItems = "center";
    avatarElement.style.justifyContent = "center";
    avatarElement.style.fontSize = "16px";
    avatarElement.style.fontWeight = "600";
  }

  // ============================================
  // Submenu Functions
  // ============================================
  function toggleSubmenu(menuItemId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    var menuItem = document.getElementById(menuItemId);
    if (!menuItem) return;
    
    var isExpanded = menuItem.classList.contains('expanded');
    
    // Close all other submenus
    var allSubmenus = document.querySelectorAll('.nav-menu-item.has-submenu');
    allSubmenus.forEach(function(item) {
      if (item.id !== menuItemId) {
        item.classList.remove('expanded');
      }
    });
    
    // Toggle current submenu
    if (isExpanded) {
      menuItem.classList.remove('expanded');
    } else {
      menuItem.classList.add('expanded');
    }
  }

  // Handle clicks on submenu parent links
  function setupSubmenuHandlers() {
    var submenuLinks = document.querySelectorAll('.nav-menu-link.has-submenu');
    submenuLinks.forEach(function(link) {
      link.addEventListener('click', function(e) {
        var menuItem = link.closest('.nav-menu-item.has-submenu');
        if (!menuItem) return;

        var href = link.getAttribute('href') || '';
        var isToggleOnly = href === '#' || href === '';

        // Expand/collapse-only parents (no duplicate page URL vs first child)
        if (isToggleOnly || menuItem.id === 'analytics-menu-item') {
          e.preventDefault();
          toggleSubmenu(menuItem.id, e);
          link.setAttribute('aria-expanded', menuItem.classList.contains('expanded') ? 'true' : 'false');
          return;
        }

        if (menuItem.id === 'tools-menu-item') {
          var linkRect = link.getBoundingClientRect();
          // Chevron area toggles; the rest of the link navigates to tools.html
          if (e.clientX > linkRect.right - 30) {
            e.preventDefault();
            toggleSubmenu(menuItem.id, e);
          }
        }
      });
    });

    // Nested Discussions subsection: parent is expand-only; Overview holds the page link
    var nestedParents = document.querySelectorAll('.nav-submenu-link.has-nested-submenu');
    nestedParents.forEach(function(link) {
      link.addEventListener('click', function(e) {
        var nestedItem = link.closest('.nav-submenu-item.has-nested-submenu');
        if (!nestedItem) return;
        var href = link.getAttribute('href') || '';
        if (href === '#' || href === '' || e.clientX > link.getBoundingClientRect().right - 30) {
          e.preventDefault();
          nestedItem.classList.toggle('expanded');
          link.setAttribute('aria-expanded', nestedItem.classList.contains('expanded') ? 'true' : 'false');
        }
      });
    });
  }

  // ============================================
  // Set Active Navigation Item
  // ============================================
  function setActiveNavItem() {
    var currentPage = normalizeCurrentPageName();
    
    // Remove active class from all links
    var allLinks = document.querySelectorAll('.nav-menu-link, .nav-submenu-link, .nav-nested-submenu-link');
    allLinks.forEach(function(link) {
      link.classList.remove('active');
      if (link.getAttribute('aria-current')) {
        link.removeAttribute('aria-current');
      }
    });
    
    // Set active class on matching link
    allLinks.forEach(function(link) {
      var href = link.getAttribute('href');
      // Fix: Ensure we match exact page name or path ending with /page.html
      // This prevents "news-updates.html" from matching "updates.html"
      if (hrefMatchesCurrentPage(href, currentPage)) {
        // Prefer the nested Discussions links over the parent Discussions link
        // when both share discussions.html as href.
        if (
          hrefPageName(href) === "discussions.html" &&
          link.classList.contains("nav-submenu-link") &&
          DISCUSSIONS_PAGE_FILES[currentPage] &&
          currentPage === "discussions.html"
        ) {
          // Parent Discussions link can stay visually inactive; nested Overview is active.
          return;
        }

        // Prefer Tools submenu hub links over the parent Tools & Reports link
        // when a category tool page is active (both would otherwise match).
        if (
          hrefPageName(href) === "tools.html" &&
          link.classList.contains("nav-menu-link") &&
          TOOLS_SUBMENU_HUB[currentPage]
        ) {
          // Keep parent expanded via tools-menu-item below; highlight the hub instead.
          var toolsMenuSkip = document.getElementById("tools-menu-item");
          if (toolsMenuSkip) {
            toolsMenuSkip.classList.add("expanded");
          }
          return;
        }

        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
        
        // If it's a submenu item, expand the parent menu
        var submenuItem = link.closest('.nav-submenu-item');
        if (submenuItem) {
          var parentMenu = submenuItem.closest('.nav-menu-item.has-submenu');
          if (parentMenu) {
            parentMenu.classList.add('expanded');
          }
        }

        // Expand Discussions nested subsection when a nested page is active
        if (DISCUSSIONS_PAGE_FILES[currentPage]) {
          var discussionsNested = document.getElementById('discussions-submenu-item');
          if (discussionsNested) {
            discussionsNested.classList.add('expanded');
          }
          var analyticsMenuForDiscussions = document.getElementById('analytics-menu-item');
          if (analyticsMenuForDiscussions) {
            analyticsMenuForDiscussions.classList.add('expanded');
          }
        }

        // Expand Tools & Reports when any tools page is active
        if (TOOLS_PAGE_FILES[currentPage]) {
          var toolsMenu = document.getElementById("tools-menu-item");
          if (toolsMenu) {
            toolsMenu.classList.add("expanded");
          }
        }

        // Expand Analytics when Engagement & Interaction (or other analytics
        // submenu pages) is active — even if the page is also catalogued under Tools.
        if (currentPage === "engagement-interaction.html") {
          var analyticsForEngagement = document.getElementById("analytics-menu-item");
          if (analyticsForEngagement) {
            analyticsForEngagement.classList.add("expanded");
          }
        }
        
        // If it's the main Analytics page, also expand and mark parent
        if (currentPage === "analytics.html" || currentPage === "analytics-old.html") {
          var analyticsMenu = document.getElementById('analytics-menu-item');
          if (analyticsMenu) {
            analyticsMenu.classList.add('expanded');
            var mainLink = analyticsMenu.querySelector('.nav-menu-link.has-submenu');
            if (mainLink) {
              mainLink.classList.add('active');
            }
          }
        }

        // If it's the main Tools hub page, expand and mark parent
        if (currentPage === "tools.html") {
          var toolsMenuMain = document.getElementById("tools-menu-item");
          if (toolsMenuMain) {
            toolsMenuMain.classList.add("expanded");
            var toolsMainLink = toolsMenuMain.querySelector(".nav-menu-link.has-submenu");
            if (toolsMainLink) {
              toolsMainLink.classList.add("active");
            }
          }
        }
      }
    });
  }

  function injectSectionBackLink() {
    var currentPage = normalizeCurrentPageName();
    var back = SECTION_BACK_LINKS[currentPage];
    if (!back) return;

    var main = document.getElementById("main-content") || document.querySelector("main.main-content");
    if (!main) return;

    // Skip if the page already has a tutorial-style back link
    if (main.querySelector(".a11y-guide-back, .section-back-link, [data-fd-section-back]")) {
      return;
    }

    // Replace legacy Home / Section crumb trails with the section back link
    var legacyCrumbs = main.querySelectorAll(".breadcrumb");
    for (var i = 0; i < legacyCrumbs.length; i++) {
      legacyCrumbs[i].parentNode.removeChild(legacyCrumbs[i]);
    }

    var nav = document.createElement("nav");
    nav.className = "section-back-nav";
    nav.setAttribute("aria-label", "Breadcrumb");
    nav.setAttribute("data-fd-section-back", "true");

    var link = document.createElement("a");
    link.className = "section-back-link a11y-guide-back";
    link.href = resolveDashboardHref(back.href);
    link.innerHTML = '<i class="fas fa-arrow-left" aria-hidden="true"></i> ' + back.label;
    nav.appendChild(link);

    main.insertBefore(nav, main.firstChild);
  }

  // ============================================
  // Load Navigation HTML
  // ============================================
  async function loadNavigation() {
    const navPlaceholder = document.getElementById('nav-placeholder');
    if (!navPlaceholder) {
      console.warn('Navigation placeholder not found');
      return;
    }

    try {
      var navUrl = getDashboardRootFromScript() + "navigation.html";
      const response = await fetch(navUrl);
      if (!response.ok) {
        throw new Error('Failed to load navigation');
      }
      const navHTML = await response.text();
      navPlaceholder.innerHTML = navHTML;

      // Nested pages (e.g. ZohoCourseMergewithAPIs/zohoform/) would otherwise
      // resolve nav.html filenames like index.html against the current folder.
      rewriteDashboardRelativeHrefs(getDashboardRootFromScript(), ".nav-container a[href]");
      
      // After navigation is loaded, initialize it
      initNavigation();
      setActiveNavItem();
      setupSubmenuHandlers();
      injectSectionBackLink();
      if (window.FacultyDashboardPiiMask && typeof window.FacultyDashboardPiiMask.wireNavLauncher === "function") {
        window.FacultyDashboardPiiMask.wireNavLauncher(navPlaceholder);
      }
    } catch (error) {
      console.error('Error loading navigation:', error);
      // Still try to inject section back links even if nav HTML failed
      injectSectionBackLink();
    }
  }

  // ============================================
  // ReadSpeaker webReader (shared js/readspeaker.js)
  // ============================================
  function loadReadSpeaker() {
    if (window.FacultyDashboardReadSpeaker && typeof window.FacultyDashboardReadSpeaker.init === "function") {
      window.FacultyDashboardReadSpeaker.init();
      return;
    }
    if (document.querySelector("script[data-fd-readspeaker-loader]")) {
      return;
    }
    var script = document.createElement("script");
    script.src = getDashboardRootFromScript() + "js/readspeaker.js";
    script.type = "text/javascript";
    script.setAttribute("data-fd-readspeaker-loader", "true");
    document.head.appendChild(script);
  }

  // ============================================
  // Training PII mask (shared js/pii-mask.js)
  // Option/Alt+Shift+P, or type mask~  — opens privacy controls
  // ============================================
  function loadPiiMask() {
    if (window.FacultyDashboardPiiMask) {
      return;
    }
    if (document.querySelector("script[data-fd-pii-mask-loader]")) {
      return;
    }
    var root = getDashboardRootFromScript();
    var script = document.createElement("script");
    // Fall back to same-folder-relative path if root could not be resolved
    script.src = (root || "") + "js/pii-mask.js";
    script.type = "text/javascript";
    script.async = false;
    script.setAttribute("data-fd-pii-mask-loader", "true");
    script.onerror = function () {
      console.error("[Faculty Dashboard] Failed to load js/pii-mask.js from", script.src);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Start downloading early so fetch harvesting is ready before page APIs return
  loadPiiMask();

  // ============================================
  // Initialize on DOM Ready
  // ============================================
  function bootDashboardShell() {
    loadNavigation();
    loadReadSpeaker();
    loadPiiMask();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDashboardShell);
  } else {
    bootDashboardShell();
  }

  // ============================================
  // Expose toggleSubmenu globally
  // ============================================
  window.toggleSubmenu = toggleSubmenu;

  // ============================================
  // Public API (if needed)
  // ============================================
  window.D2LNavigation = {
    getRoot: getDashboardRootFromScript,
    resolveHref: resolveDashboardHref,
    toggle: handleToggle,
    close: function() {
      if (isMobile) {
        closeMobileMenu();
      } else {
        isCollapsed = true;
        updateNavState();
      }
    },
    open: function() {
      if (isMobile) {
        openMobileMenu();
      } else {
        isCollapsed = false;
        updateNavState();
      }
    }
  };

})();
