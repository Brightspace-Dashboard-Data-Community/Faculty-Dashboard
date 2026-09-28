/**
 * D2L Faculty Dashboard - Course Readiness (standalone)
 * Loads only Course Readiness section via D2L Content TOC, News, and Grades APIs.
 * Kept separate from heavy analytics data processing.
 *
 * Checks: Empty Modules (TOC), Broken Links (topics), News, Grades (excluding Final Calculated/Adjusted).
 * Ref: https://docs.valence.desire2learn.com/res/content.html
 *      https://docs.valence.desire2learn.com/res/news.html
 *      https://docs.valence.desire2learn.com/res/grade.html
 */
(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var DEFAULT_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  // Grade object types: FinalCalculated = 7, FinalAdjusted = 8 (exclude from "has gradebook" check)
  var GRADE_TYPE_FINAL_CALCULATED = 7;
  var GRADE_TYPE_FINAL_ADJUSTED = 8;

  var courseReadinessData = [];

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function getRoleId(item) {
    if (item && item.Access) {
      if (typeof item.Access.ClasslistRoleId !== "undefined" && item.Access.ClasslistRoleId !== null) {
        var n = parseInt(item.Access.ClasslistRoleId, 10);
        if (!isNaN(n)) return n;
      }
      if (item.Access.ClasslistRoleName) {
        var roleName = (item.Access.ClasslistRoleName || "").toLowerCase();
        if (roleName.indexOf("instructor") >= 0 && roleName.indexOf("evaluator") === -1) return 102;
      }
    }
    return null;
  }

  function isMergedOrCancelledCourse(course) {
    if (!course || !course.OrgUnit) return false;
    var code = (course.OrgUnit.Code || "").toUpperCase();
    var name = (course.OrgUnit.Name || "").toUpperCase();
    return code.indexOf("MERGED") >= 0 || code.indexOf("CXLD") >= 0 ||
           name.indexOf("MERGED") >= 0 || name.indexOf("CXLD") >= 0;
  }

  async function BrightspaceFetch(url) {
    var token = localStorage.getItem("X-CSRF.Token") || localStorage.getItem("XSRF.Token");
    var opts = { credentials: "include", headers: {} };
    if (token) opts.headers["X-CSRF-Token"] = token;
    var res = await fetch(url, opts);
    if (!res.ok) {
      var err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Fetch HTML from a Brightspace page (same auth as BrightspaceFetch). Used for nav bar / course page parsing. */
  async function BrightspaceFetchHTML(url) {
    var token = localStorage.getItem("X-CSRF.Token") || localStorage.getItem("XSRF.Token");
    var opts = { credentials: "include", headers: {} };
    if (token) opts.headers["X-CSRF-Token"] = token;
    var res = await fetch(url, opts);
    if (!res.ok) {
      var err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  async function getEnrollments() {
    var allItems = [];
    var bookmark = null;
    var pageCount = 0;
    var maxPages = 50;
    while (pageCount < maxPages) {
      pageCount++;
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";
      try {
        var data = await BrightspaceFetch(endpoint);
        if (data && data.Items && data.Items.length) {
          for (var i = 0; i < data.Items.length; i++) {
            var item = data.Items[i];
            if (item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3) {
              var code = item.OrgUnit.Code || "";
              var sem = getSemesterCodeFromCourseCode(code);
              var roleId = getRoleId(item);
              if (sem === DEFAULT_SEMESTER_CODE && roleId === 102 && !isMergedOrCancelledCourse(item)) {
                allItems.push(item);
              }
            }
          }
        }
        if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
          bookmark = data.PagingInfo.Bookmark;
        } else {
          break;
        }
      } catch (e) {
        break;
      }
    }
    return allItems;
  }

  // ---------------------------------------------------------------------------
  // 1. Empty Modules – Table of Contents API
  // A module is empty if it has no topics and no child modules.
  // Returns { count, list: [{ title, moduleId, path }] }
  // ---------------------------------------------------------------------------
  function collectEmptyModules(modules, parentPath) {
    var list = [];
    parentPath = parentPath || "";
    if (!modules || !Array.isArray(modules)) return { count: 0, list: list };
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var title = mod.Title || "Untitled module";
      var moduleId = mod.ModuleId != null ? mod.ModuleId : mod.Id;
      var path = parentPath ? parentPath + " \u2192 " + title : title;
      var topics = mod.Topics;
      var childModules = mod.Modules;
      var hasTopics = topics && Array.isArray(topics) && topics.length > 0;
      var hasChildModules = childModules && Array.isArray(childModules) && childModules.length > 0;
      if (!hasTopics && !hasChildModules) {
        list.push({ title: title, moduleId: moduleId, path: path });
      }
      if (hasChildModules) {
        var childResult = collectEmptyModules(childModules, path);
        list = list.concat(childResult.list);
      }
    }
    return { count: list.length, list: list };
  }

  // ---------------------------------------------------------------------------
  // 2. Broken Links – Topics in TOC with IsBroken === true
  // Returns { count, list: [{ title, topicId, moduleTitle, path }] }
  // ---------------------------------------------------------------------------
  function collectBrokenLinks(modules, parentPath) {
    var list = [];
    parentPath = parentPath || "";
    if (!modules || !Array.isArray(modules)) return { count: 0, list: list };
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var moduleTitle = mod.Title || "Untitled module";
      var path = parentPath ? parentPath + " \u2192 " + moduleTitle : moduleTitle;
      var topics = mod.Topics;
      if (topics && Array.isArray(topics)) {
        for (var t = 0; t < topics.length; t++) {
          var topic = topics[t];
          if (topic.IsBroken === true) {
            list.push({
              title: topic.Title || "Untitled topic",
              topicId: topic.TopicId != null ? topic.TopicId : topic.Id,
              moduleTitle: moduleTitle,
              path: path
            });
          }
        }
      }
      var childModules = mod.Modules;
      if (childModules && Array.isArray(childModules)) {
        var childResult = collectBrokenLinks(childModules, path);
        list = list.concat(childResult.list);
      }
    }
    return { count: list.length, list: list };
  }

  // ---------------------------------------------------------------------------
  // Missing Syllabus – 1) TOC: module or topic title containing "syllabus"
  //                   2) If not in TOC, course nav bar: fetch course page HTML and look for Syllabus link
  // (Pattern from Admin-Dashboard-v2 navbar-audit.js: fetch HTML, parse with DOMParser)
  // ---------------------------------------------------------------------------
  function hasSyllabusInTOC(modules) {
    if (!modules || !Array.isArray(modules)) return false;
    for (var k = 0; k < modules.length; k++) {
      var module = modules[k];
      var title = (module.Title || "").toLowerCase();
      if (title.indexOf("syllabus") >= 0) return true;
      if (module.Topics && Array.isArray(module.Topics)) {
        for (var t = 0; t < module.Topics.length; t++) {
          var topicTitle = (module.Topics[t].Title || "").toLowerCase();
          if (topicTitle.indexOf("syllabus") >= 0) return true;
        }
      }
      if (module.Modules && Array.isArray(module.Modules)) {
        if (hasSyllabusInTOC(module.Modules)) return true;
      }
    }
    return false;
  }

  /** Fetch course home page HTML (contains course nav bar with Syllabus, Content, Grades, etc.). */
  async function fetchCoursePageHTML(orgUnitId) {
    try {
      var path = "/d2l/home/" + encodeURIComponent(String(orgUnitId));
      return await BrightspaceFetchHTML(path);
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) console.warn("Course Readiness: course page HTML", orgUnitId, e.status);
      return "";
    }
  }

  /** Parse course page HTML for a Syllabus link in the nav bar (e.g. "Syllabus" text in a link or nav item). */
  function hasSyllabusInNavBar(htmlText) {
    if (!htmlText || typeof htmlText !== "string") return false;
    try {
      var parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
      if (!parser) return false;
      var doc = parser.parseFromString(htmlText, "text/html");
      if (!doc || !doc.body) return false;
      var links = doc.querySelectorAll("a[href], a");
      for (var i = 0; i < links.length; i++) {
        var text = (links[i].textContent || links[i].innerText || "").trim();
        if (text.toLowerCase() === "syllabus") return true;
      }
      var all = doc.body.querySelectorAll("[class*='nav'], [class*='menu'], [role='navigation'], header a, .d2l-navigation a");
      for (var j = 0; j < all.length; j++) {
        var t = (all[j].textContent || all[j].innerText || "").trim();
        if (t.toLowerCase().indexOf("syllabus") >= 0) return true;
      }
      if (doc.body.innerText && doc.body.innerText.toLowerCase().indexOf("syllabus") >= 0) {
        return true;
      }
      return false;
    } catch (e) {
      console.warn("Course Readiness: parse nav for syllabus", e);
      return false;
    }
  }

  async function getContentTOC(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/content/toc";
      var data = await BrightspaceFetch(endpoint);
      return data || null;
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) console.warn("Course Readiness: content/toc", orgUnitId, e.status);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. News – GET news for org unit; no news = empty array
  // ---------------------------------------------------------------------------
  async function getNewsForCourse(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/news/";
      var data = await BrightspaceFetch(endpoint);
      return data || [];
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) console.warn("Course Readiness: news", orgUnitId, e.status);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Grades – GET grade objects; exclude Final Calculated (7) and Final Adjusted (8).
  // No gradebook = no grade objects, or only 7/8.
  // ---------------------------------------------------------------------------
  async function getGradeObjectsForCourse(orgUnitId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/";
      var data = await BrightspaceFetch(endpoint);
      var list = Array.isArray(data) ? data : (data && data.Items) ? data.Items : [];
      // Exclude Final Calculated (7) and Final Adjusted (8)
      return list.filter(function (g) {
        var type = g.GradeType;
        if (typeof type === "number") {
          return type !== GRADE_TYPE_FINAL_CALCULATED && type !== GRADE_TYPE_FINAL_ADJUSTED;
        }
        if (typeof type === "string") {
          return type !== "FinalCalculated" && type !== "FinalAdjusted";
        }
        return true;
      });
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) console.warn("Course Readiness: grades", orgUnitId, e.status);
      return [];
    }
  }

  async function loadCourseReadiness() {
    var btn = document.getElementById("course-readiness-load-btn");
    var tilesContainer = document.getElementById("course-readiness-tiles");
    var listContainer = document.getElementById("course-readiness-items");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Loading...";
    }
    if (listContainer) {
      listContainer.innerHTML = "<div style='padding: 12px; color: #666; font-size: 13px;'>Loading course readiness…</div>";
    }

    try {
      var courses = await getEnrollments();
      courseReadinessData = [];
      var concurrency = 3;
      var idx = 0;

      while (idx < courses.length) {
        var batch = courses.slice(idx, idx + concurrency);
        idx += batch.length;
        var results = await Promise.all(batch.map(function (course) {
          var orgUnitId = String(course.OrgUnit.Id);
          var courseName = course.OrgUnit.Name || "Unknown Course";
          var courseCode = course.OrgUnit.Code || "";
          return Promise.allSettled([
            getContentTOC(orgUnitId),
            getNewsForCourse(orgUnitId),
            getGradeObjectsForCourse(orgUnitId)
          ]).then(async function (settled) {
            var toc = settled[0].status === "fulfilled" ? settled[0].value : null;
            var news = settled[1].status === "fulfilled" ? settled[1].value : [];
            var gradeObjects = settled[2].status === "fulfilled" ? settled[2].value : [];
            var modules = (toc && toc.Modules) ? toc.Modules : [];
            var emptyResult = collectEmptyModules(modules);
            var brokenResult = collectBrokenLinks(modules);
            var hasSyllabus = toc ? hasSyllabusInTOC(modules) : false;
            if (!hasSyllabus && orgUnitId) {
              var coursePageHtml = await fetchCoursePageHTML(orgUnitId);
              if (coursePageHtml && hasSyllabusInNavBar(coursePageHtml)) hasSyllabus = true;
            }
            return {
              courseId: orgUnitId,
              courseName: courseName,
              courseCode: courseCode,
              missingSyllabus: !hasSyllabus,
              emptyModules: emptyResult.count,
              emptyModuleList: emptyResult.list || [],
              brokenLinks: brokenResult.count,
              brokenLinkList: brokenResult.list || [],
              noNews: !news || news.length === 0,
              noGradebook: !gradeObjects || gradeObjects.length === 0
            };
          }).catch(function (err) {
            console.warn("Course Readiness: course failed", orgUnitId, err);
            return null;
          });
        }));
        for (var r = 0; r < results.length; r++) {
          if (results[r] && typeof results[r].courseId !== "undefined") {
            courseReadinessData.push(results[r]);
          }
        }
      }

      renderCourseReadinessBucket();
    } catch (e) {
      console.error("Course Readiness load failed:", e);
      if (listContainer) {
        listContainer.innerHTML = "<div style='padding: 12px; color: #b91c1c; font-size: 13px;'>Error: " + (e.message || "Load failed") + "</div>";
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Load Course Readiness";
      }
    }
  }

  /** Content page URL: /d2l/le/content/{orgUnitId}/Home */
  function getContentUrl(courseId) {
    var base = (typeof window !== "undefined" && window.location && window.location.origin)
      ? window.location.origin : "https://your-brightspace.example.edu";
    return base + "/d2l/le/content/" + encodeURIComponent(String(courseId)) + "/Home";
  }

  function ensureModal() {
    var modal = document.getElementById("course-readiness-modal");
    if (!modal) return null;
    var closeBtn = document.getElementById("course-readiness-modal-close");
    if (closeBtn && !closeBtn._bound) {
      closeBtn._bound = true;
      closeBtn.addEventListener("click", closeCourseDetailsModal);
    }
    if (!modal._overlayBound) {
      modal._overlayBound = true;
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeCourseDetailsModal();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          var m = document.getElementById("course-readiness-modal");
          if (m && m.style.display === "flex") closeCourseDetailsModal();
        }
      });
    }
    return modal;
  }

  function closeCourseDetailsModal() {
    var modal = document.getElementById("course-readiness-modal");
    if (modal) {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }
  }

  function openCourseDetailsModal(course) {
    var modal = document.getElementById("course-readiness-modal");
    var body = document.getElementById("course-readiness-modal-body");
    var titleEl = document.getElementById("course-readiness-modal-title");
    if (!modal || !body) return;
    ensureModal();

    var courseName = course.courseName || "Unknown Course";
    var courseCode = course.courseCode ? " (" + course.courseCode + ")" : "";
    var contentUrl = getContentUrl(course.courseId);

    var html = "";
    html += "<p style='margin: 0 0 16px; font-size: 14px; color: #374151;'>";
    html += "<a id=\"course-readiness-modal-content-link\" href=\"" + escapeHtml(contentUrl) + "\" target=\"_blank\" rel=\"noopener\" style='color: #0f5b46; font-weight: 600; text-decoration: underline; cursor: pointer;'>Open Content &rarr;</a>";
    html += "</p>";

    var emptyList = course.emptyModuleList || [];
    var brokenList = course.brokenLinkList || [];

    if (emptyList.length > 0) {
      html += "<h3 style='font-size: 14px; font-weight: 700; color: #111; margin: 16px 0 8px;'>Empty modules (no topics)</h3>";
      html += "<ul style='margin: 0 0 16px; padding-left: 20px; font-size: 13px; color: #374151; line-height: 1.6;'>";
      for (var i = 0; i < emptyList.length; i++) {
        var em = emptyList[i];
        html += "<li><strong>" + escapeHtml(em.title) + "</strong>";
        if (em.path && em.path !== em.title) html += " <span style='color: #6b7280;'>(" + escapeHtml(em.path) + ")</span>";
        html += "</li>";
      }
      html += "</ul>";
    }

    if (brokenList.length > 0) {
      html += "<h3 style='font-size: 14px; font-weight: 700; color: #111; margin: 16px 0 8px;'>Broken links (topics)</h3>";
      html += "<ul style='margin: 0 0 16px; padding-left: 20px; font-size: 13px; color: #374151; line-height: 1.6;'>";
      for (var j = 0; j < brokenList.length; j++) {
        var bl = brokenList[j];
        html += "<li><strong>" + escapeHtml(bl.title) + "</strong>";
        html += " <span style='color: #6b7280;'>in " + escapeHtml(bl.moduleTitle) + "</span>";
        if (bl.path && bl.path !== bl.moduleTitle) html += " <span style='color: #9ca3af;'>(" + escapeHtml(bl.path) + ")</span>";
        html += "</li>";
      }
      html += "</ul>";
    }

    if (emptyList.length === 0 && brokenList.length === 0) {
      html += "<p style='font-size: 13px; color: #6b7280; margin: 0;'>No empty modules or broken links. Other issues (if any): ";
      var other = [];
      if (course.missingSyllabus) other.push("Missing syllabus");
      if (course.noNews) other.push("No news");
      if (course.noGradebook) other.push("No gradebook");
      html += other.length > 0 ? other.join(", ") + "." : "None.";
      html += "</p>";
    }

    if (titleEl) titleEl.textContent = courseName + courseCode;
    body.innerHTML = html;

    // Ensure modal is in document.body so no parent hides it
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.style.cssText = "display: flex; position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.45); align-items: center; justify-content: center; padding: 24px; box-sizing: border-box;";
    modal.setAttribute("aria-hidden", "false");

    // Click handler for "Open Content" link: open link then close modal
    var contentLink = document.getElementById("course-readiness-modal-content-link");
    if (contentLink) {
      contentLink.addEventListener("click", function contentLinkClick(e) {
        e.preventDefault();
        var href = this.getAttribute("href");
        if (href) window.open(href, "_blank", "noopener,noreferrer");
        closeCourseDetailsModal();
      });
    }
  }

  function escapeHtml(s) {
    if (s == null) return "";
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderCourseReadinessBucket() {
    var tilesContainer = document.getElementById("course-readiness-tiles");
    var listContainer = document.getElementById("course-readiness-items");
    if (!tilesContainer || !listContainer) return;

    var filtered = courseReadinessData.slice();
    var filterEl = document.getElementById("analytics-course-filter");
    var currentCourseFilter = (filterEl && filterEl.value) ? filterEl.value : "all";
    if (currentCourseFilter && currentCourseFilter !== "all") {
      filtered = filtered.filter(function (c) { return String(c.courseId) === String(currentCourseFilter); });
    }

    var missingSyllabus = filtered.filter(function (c) { return c.missingSyllabus; });
    var emptyModules = filtered.reduce(function (sum, c) { return sum + (c.emptyModules || 0); }, 0);
    var brokenLinks = filtered.reduce(function (sum, c) { return sum + (c.brokenLinks || 0); }, 0);
    var noNews = filtered.filter(function (c) { return c.noNews; });
    var noGradebook = filtered.filter(function (c) { return c.noGradebook; });

    tilesContainer.innerHTML = "";
    var tiles = [
      { label: "Missing Syllabus", count: missingSyllabus.length },
      { label: "Empty Modules", count: emptyModules },
      { label: "Broken Links", count: brokenLinks },
      { label: "No News", count: noNews.length },
      { label: "No Gradebook", count: noGradebook.length }
    ];
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var el = document.createElement("div");
      el.style.cssText = "padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;";
      el.innerHTML = "<div style='font-size: 11px; color: #666; margin-bottom: 2px;'>" + tile.label + "</div>" +
                     "<div style='font-size: 20px; font-weight: 700; color: #0f5b46;'>" + tile.count + "</div>";
      tilesContainer.appendChild(el);
    }

    listContainer.innerHTML = "";
    if (filtered.length === 0) {
      listContainer.innerHTML = "<div style='padding: 12px; color: #999; font-size: 13px;'>No course readiness data. Click \"Load Course Readiness\".</div>";
      return;
    }
    var sorted = filtered.slice().sort(function (a, b) {
      var aIssues = (a.missingSyllabus ? 1 : 0) + (a.emptyModules || 0) + (a.brokenLinks || 0) + (a.noNews ? 1 : 0) + (a.noGradebook ? 1 : 0);
      var bIssues = (b.missingSyllabus ? 1 : 0) + (b.emptyModules || 0) + (b.brokenLinks || 0) + (b.noNews ? 1 : 0) + (b.noGradebook ? 1 : 0);
      return bIssues - aIssues;
    });
    for (var j = 0; j < sorted.length && j < 10; j++) {
      var course = sorted[j];
      var issues = [];
      if (course.missingSyllabus) issues.push("Missing syllabus");
      if (course.emptyModules > 0) issues.push(course.emptyModules + " empty modules");
      if (course.brokenLinks > 0) issues.push(course.brokenLinks + " broken links");
      if (course.noNews) issues.push("No news");
      if (course.noGradebook) issues.push("No gradebook");
      var hasIssues = issues.length > 0;
      var item = document.createElement("div");
      item.style.cssText = "padding: 8px; border-bottom: 1px solid #e5e7eb;";
      if (hasIssues) {
        item.setAttribute("data-course-id", String(course.courseId));
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.title = "Click for detailed review";
        item.style.cursor = "pointer";
        item.style.color = "#0f5b46";
        item.style.textDecoration = "underline";
        var viewDetailsLink = document.createElement("a");
        viewDetailsLink.href = "#";
        viewDetailsLink.setAttribute("data-course-id", String(course.courseId));
        viewDetailsLink.style.cssText = "color: #0f5b46; font-weight: 600; text-decoration: underline; cursor: pointer; font-size: 13px;";
        viewDetailsLink.textContent = "View details";
        viewDetailsLink.addEventListener("click", function (c, ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openCourseDetailsModal(c);
        }.bind(null, course));
        item.innerHTML = "<div style='font-weight: 600; color: inherit;'>" + escapeHtml(course.courseName) + "</div>" +
                         "<div style='font-size: 12px; color: #666;'>" + (issues.length > 0 ? issues.join(", ") : "No issues") + "</div>";
        var linkWrap = document.createElement("div");
        linkWrap.style.marginTop = "4px";
        linkWrap.appendChild(viewDetailsLink);
        item.appendChild(linkWrap);
      } else {
        item.innerHTML = "<div style='font-weight: 600;'>" + escapeHtml(course.courseName) + "</div>" +
                         "<div style='font-size: 12px; color: #666;'>No issues</div>";
      }
      listContainer.appendChild(item);
    }
  }

  function bindListClick() {
    var listContainer = document.getElementById("course-readiness-items");
    if (!listContainer || listContainer._courseReadinessBound) return;
    listContainer._courseReadinessBound = true;
    listContainer.addEventListener("click", function (e) {
      var row = e.target && e.target.closest && e.target.closest("[data-course-id]");
      if (!row) return;
      var courseId = row.getAttribute("data-course-id");
      if (!courseId) return;
      var course = courseReadinessData.filter(function (c) { return String(c.courseId) === String(courseId); })[0];
      if (course) openCourseDetailsModal(course);
    });
    listContainer.addEventListener("keydown", function (e) {
      var row = e.target && e.target.closest && e.target.closest("[data-course-id]");
      if (!row) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var courseId = row.getAttribute("data-course-id");
        if (!courseId) return;
        var course = courseReadinessData.filter(function (c) { return String(c.courseId) === String(courseId); })[0];
        if (course) openCourseDetailsModal(course);
      }
    });
  }

  function bindLoadButton() {
    var btn = document.getElementById("course-readiness-load-btn");
    if (btn) btn.addEventListener("click", loadCourseReadiness);
  }

  function init() {
    bindLoadButton();
    bindListClick();
    var listContainer = document.getElementById("course-readiness-items");
    if (listContainer && courseReadinessData.length === 0) {
      listContainer.innerHTML = "<div style='padding: 12px; color: #999; font-size: 13px;'>Click \"Load Course Readiness\" to run checks (Empty Modules, Broken Links, News, Gradebook).</div>";
    }
    ensureModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CourseReadiness = {
    load: loadCourseReadiness,
    render: renderCourseReadinessBucket,
    getData: function () { return courseReadinessData; }
  };
})();
