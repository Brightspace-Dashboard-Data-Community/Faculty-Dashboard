/**
 * D2L Faculty Dashboard - Quick Tools
 * Displays the Quick Tools section on My Courses.
 */

(function () {
  'use strict';

  // =========================
  // UI HELPERS
  // =========================
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "style") {
          for (var s in attrs.style) node.style[s] = attrs.style[s];
        } else if (k === "className") {
          node.className = attrs[k];
        } else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          node.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) {
        if (children[i] == null || children[i] === undefined) continue;
        if (typeof children[i] === "string" || typeof children[i] === "number") {
          node.appendChild(document.createTextNode(String(children[i])));
        } else if (children[i] instanceof Node) {
          node.appendChild(children[i]);
        } else {
          console.warn("Invalid child element:", children[i]);
        }
      }
    }
    return node;
  }

  // =========================
  // RENDER SECTION HEADER
  // =========================
  function renderSectionHeader(iconClass, title) {
    var header = el("div", { className: "section-header" }, [
      el("div", { className: "section-header-content" }, [
        el("i", {
          className: iconClass + " section-header-icon",
          "aria-hidden": "true"
        }),
        el("h2", { className: "section-header-title" }, [title])
      ]),
      el("div", { className: "section-header-separator" })
    ]);
    return header;
  }

  // =========================
  // RENDER QUICK TOOLS
  // =========================
  function renderQuickTools(container) {
    var tools = [
      {
        icon: "fas fa-rotate",
        title: "Semester Rollover Kit",
        description: "Checklist to prepare upcoming Brightspace courses",
        url: "semester-rollover-kit.html"
      },
      {
        icon: "fas fa-code-branch",
        title: "Course Merge Tool",
        description: "Merge multiple course sections efficiently",
        url: "course-merge-form.html"
      },
      {
        icon: "fas fa-cube",
        title: "Sandbox Course",
        description: "Create practice courses for testing",
        url: "sandbox-course.html"
      },
      {
        icon: "fas fa-layer-group",
        title: "Course Package Deployer",
        description: "Set up a course shell in one screen",
        url: "course-package-deployer.html"
      },
      {
        icon: "fas fa-rotate",
        title: "Term Rollover Assistant",
        description: "Copy materials into an upcoming offering",
        url: "term-rollover-assistant.html"
      },
      {
        icon: "fas fa-user-graduate",
        title: "Faculty Course Adds",
        description: "Add faculty to courses quickly",
        url: "faculty-course-adds.html"
      },
      {
        icon: "fas fa-robot",
        title: "Intelligent Agent Builder",
        description: "Choose a template and create it in your course",
        url: "intelligent-agent-builder.html"
      },
      {
        icon: "fas fa-calendar-alt",
        title: "Due Date Wizard",
        description: "Bulk-update assignment and quiz due dates",
        url: "due-date-wizard.html"
      },
      {
        icon: "fas fa-comments",
        title: "Private Student Conversations",
        description: "Create a private discussion board for each student",
        url: "private-student-conversations.html"
      }
    ];

    var section = el("div", { className: "quick-tools-section mb-32" }, [
      renderSectionHeader("fas fa-tools", "Quick Tools"),
      el("div", { className: "quick-tools-grid" }, []),
      el("nav", {
        className: "quick-tools-help",
        "aria-label": "Faculty help"
      }, [
        "Need help? ",
        el("a", { href: "faculty-training.html" }, [
          "Faculty Tutorials",
          el("i", {
            className: "fas fa-arrow-right",
            "aria-hidden": "true"
          })
        ])
      ])
    ]);

    var grid = section.querySelector(".quick-tools-grid");

    for (var i = 0; i < tools.length; i++) {
      var tool = tools[i];
      var card = el("a", {
        className: "quick-tool-card",
        href: tool.url,
        target: "_blank",
        rel: "noopener noreferrer"
      }, [
        el("div", { className: "quick-tool-icon" }, [
          el("i", {
            className: tool.icon,
            "aria-hidden": "true"
          })
        ]),
        el("h3", { className: "quick-tool-title" }, [tool.title]),
        el("p", { className: "quick-tool-description" }, [tool.description])
      ]);
      grid.appendChild(card);
    }

    container.appendChild(section);
  }

  // =========================
  // INIT
  // =========================
  function init() {
    var quickToolsContainer = document.getElementById("quick-tools-section");

    if (quickToolsContainer) {
      renderQuickTools(quickToolsContainer);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
