/**
 * Tool hub renderer
 * Renders Tools and Reports sections from ToolCatalog into #tool-hub-root.
 */
(function () {
  "use strict";

  function statusLabel(status) {
    if (status === "live") return "Live";
    if (status === "beta") return "Beta";
    return "Coming Soon";
  }

  function statusClass(status) {
    if (status === "live") return "tool-status-live";
    if (status === "beta") return "tool-status-beta";
    return "tool-status-coming-soon";
  }

  function iconForCategory(category) {
    if (category === "course-management") return "fas fa-cog";
    if (category === "student-management") return "fas fa-users";
    return "fas fa-chart-bar";
  }

  function launchLabel(tool) {
    return (tool.kind || "tool") === "report" ? "Launch Report" : "Launch Tool";
  }

  function renderCard(tool) {
    var featureItems = (tool.features || []).map(function (feature) {
      return '<li><i class="fas fa-check"></i> ' + feature + "</li>";
    }).join("");

    var href = tool.href;
    if (href && window.D2LNavigation && typeof window.D2LNavigation.resolveHref === "function") {
      href = window.D2LNavigation.resolveHref(href);
    }

    var actionHtml = href
      ? '<a href="' + href + '" class="launch-tool-btn"><span>' + launchLabel(tool) + '</span><i class="fas fa-play"></i></a>'
      : '<button type="button" class="launch-tool-btn" disabled><span>Coming Soon</span><i class="fas fa-clock"></i></button>';

    return [
      '<div class="primary-tool-card">',
      '<div class="primary-tool-header">',
      '<div class="primary-tool-icon"><i class="' + iconForCategory(tool.category) + '"></i></div>',
      '<div class="primary-tool-title-wrapper">',
      '<h3 class="primary-tool-title">' + tool.title + "</h3>",
      '<span class="tool-status-badge ' + statusClass(tool.status) + '">' + statusLabel(tool.status) + "</span>",
      "</div>",
      "</div>",
      '<p class="primary-tool-description">' + tool.description + "</p>",
      '<ul class="primary-tool-features">' + featureItems + "</ul>",
      '<div class="tool-card-meta">Owner: ' + (tool.owner || "Unassigned") + "</div>",
      '<div class="primary-tool-actions">' + actionHtml + "</div>",
      "</div>"
    ].join("");
  }

  function renderSection(title, items, emptyMessage) {
    var gridHtml = items.length
      ? items.map(renderCard).join("")
      : '<p class="hub-empty-message">' + emptyMessage + "</p>";

    return [
      '<section class="tools-section">',
      '<div class="tools-section-header">',
      '<h2 class="tools-section-title">' + title + " (" + items.length + ")</h2>",
      '<div class="tools-section-separator"></div>',
      "</div>",
      '<div class="primary-tools-grid">' + gridHtml + "</div>",
      "</section>"
    ].join("");
  }

  function renderHubPage(category, options) {
    if (!window.ToolCatalog || !window.ToolCatalog.getByCategoryAndKind) {
      return;
    }

    options = options || {};
    var root = document.getElementById("tool-hub-root");
    if (!root) return;

    var tools = window.ToolCatalog.getByCategoryAndKind(category, "tool");
    var reports = window.ToolCatalog.getByCategoryAndKind(category, "report");
    var requestLabel = options.requestLabel || "Request a Tool or Report";

    root.innerHTML =
      renderSection("Tools", tools, "No tools in this section yet.") +
      renderSection("Reports", reports, "No reports in this section yet.") +
      '<div class="hub-actions">' +
      '<a href="https://helpdesk.example.edu/portal/en/newticket" class="launch-tool-btn" target="_blank" rel="noopener noreferrer">' +
      "<span>" + requestLabel + "</span>" +
      '<i class="fas fa-external-link-alt"></i>' +
      "</a>" +
      "</div>";
  }

  window.renderToolHubPage = renderHubPage;
})();
