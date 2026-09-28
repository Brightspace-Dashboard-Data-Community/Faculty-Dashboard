/**
 * D2L Faculty Dashboard - My Courses Widget
 * Fetches and displays instructor courses using D2L API
 */

(function () {
  'use strict';

  // =========================
  // CONFIG
  // =========================
  var API_VERSION_LP = "1.51";

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  function viewingSemesterCode() {
    var api = semesterApi();
    return api ? api.getActiveCode() : "26/FA";
  }

  function viewingSemesterLabel() {
    var api = semesterApi();
    if (api && api.getActive) return api.getActive().displayLabel;
    return viewingSemesterCode();
  }

  // If true, sandbox courses appear no matter which semester is selected
  // If false, sandbox courses must match the selected semester code
  var SHOW_SANDBOX_ALL_TERMS = true;

  // Academic role ids (from your provided role list)
  // Adjust anytime without touching logic.
  var ACADEMIC_ROLE_IDS = {
    102: true, // Instructor
    183: true, // Seconday Instructor
    108: true, // Teaching Assistant
    127: true, // Mentor
    160: true, // Ghost Instructor
    167: true, // Instructor - Admin
    174: true  // Instructor - PERMISSION TEST
    // 122: true // Trainer (optional - add if you want Trainer to be Academic)
  };

  // Fallback keywords if RoleId is missing
  var ACADEMIC_ROLE_KEYWORDS = ["instructor", "teacher", "faculty", "assistant", "ta", "mentor"];

  // Sandbox detection (edit to match your naming conventions)
  function isSandboxCourse(name, code) {
    var s = ((name || "") + " " + (code || "")).toLowerCase();
    if (s.indexOf("sandbox") >= 0) return true;
    if (s.indexOf("sbx") >= 0) return true;
    if (s.indexOf("practice") >= 0) return true;
    return false;
  }

  // =========================
  // AUTH FETCH
  // =========================
  async function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    if (!res.ok) throw new Error("HTTP " + res.status + " - " + url);
    return await res.json();
  }

  // =========================
  // DATA FETCH
  // =========================
  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;

    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";

      var data = await BrightspaceFetch(endpoint);

      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) allItems.push(data.Items[i]);
      }

      if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
        hasMore = true;
        bookmark = data.PagingInfo.Bookmark;
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code && item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id && item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && typeof item.Access.ClasslistRoleId !== "undefined" && item.Access.ClasslistRoleId !== null) {
      var n = parseInt(item.Access.ClasslistRoleId, 10);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  function getRoleName(item) {
    if (item && item.Access && item.Access.ClasslistRoleName) return item.Access.ClasslistRoleName.toString();
    return "Unknown";
  }

  function roleNameMatches(roleName, keywords) {
    var r = (roleName || "").toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (r.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function isAcademicRole(roleId, roleName) {
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return true;
    if (roleId === null) return roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS);
    return false;
  }

  function courseHomeLink(orgUnitId) {
    return "/d2l/home/" + orgUnitId;
  }

  function colorFromCode(code) {
    var h = 0;
    var s = String(code || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    var hue = ((h % 360) + 360) % 360;
    return "linear-gradient(135deg, hsl(" + hue + ",45%,32%), hsl(" + hue + ",50%,48%))";
  }

  /** Brightspace homepage pins — one call with banner image when available. */
  async function fetchPinnedFromWidget() {
    try {
      var res = await fetch("/d2l/le/manageCourses/api/mycourses?pinned=true", {
        credentials: "include",
        headers: { Accept: "application/json", "X-CSRF-Token": localStorage.getItem("XSRF.Token") || "" }
      });
      if (!res.ok) return {};
      var data = await res.json();
      var list = (data && data.Courses) || [];
      var map = {};
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || c.OrgUnitId == null) continue;
        map[String(c.OrgUnitId)] = {
          pinDate: c.PinDate || true,
          imageUrl: c.FormattedImageLink || null,
          code: c.Code || "",
          name: c.Name || ""
        };
      }
      return map;
    } catch (e) {
      console.warn("[My Courses] Pinned widget endpoint unavailable:", e);
      return {};
    }
  }

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
        if (children[i] == null) continue;
        if (typeof children[i] === "string") node.appendChild(document.createTextNode(children[i]));
        else node.appendChild(children[i]);
      }
    }
    return node;
  }

  function badge(text) {
    return el("span", {
      style: {
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: "800",
        background: "#e8f5f0",
        color: "#0f5b46",
        border: "1px solid #bfe5d7",
        whiteSpace: "nowrap"
      }
    }, [text]);
  }

  function muted(text) {
    return el("div", {
      style: { marginTop: "8px", fontSize: "12px", color: "#555", lineHeight: "1.35" }
    }, [text]);
  }

  function courseCard(course, options) {
    options = options || {};
    var showPinBadge = !!options.showPinBadge;
    var showBanner = !!options.showBanner;

    var link = el("a", {
      href: courseHomeLink(course.ou),
      target: "_blank",
      rel: "noopener",
      style: {
        display: "block",
        textDecoration: "none",
        color: "#111",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        padding: showBanner ? "0" : "14px",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        transition: "transform 0.2s, box-shadow 0.2s",
        overflow: "hidden"
      },
      onmouseenter: function(e) {
        var t = e.currentTarget;
        t.style.transform = "translateY(-2px)";
        t.style.boxShadow = "0 4px 8px rgba(0,0,0,0.1)";
      },
      onmouseleave: function(e) {
        var t = e.currentTarget;
        t.style.transform = "translateY(0)";
        t.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
      }
    }, []);

    if (showBanner) {
      var banner = el("div", {
        style: {
          height: "72px",
          background: course.imageUrl
            ? "center / cover no-repeat url(" + course.imageUrl + ")"
            : colorFromCode(course.code),
          position: "relative"
        }
      }, []);
      if (showPinBadge) {
        banner.appendChild(el("span", {
          title: "Pinned on your Brightspace homepage",
          "aria-label": "Pinned course",
          style: {
            position: "absolute",
            top: "8px",
            right: "8px",
            width: "28px",
            height: "28px",
            borderRadius: "999px",
            background: "rgba(15,91,70,0.92)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px"
          }
        }, [
          el("i", { className: "fas fa-thumbtack", "aria-hidden": "true" })
        ]));
      }
      link.appendChild(banner);
    }

    var body = el("div", {
      style: { padding: showBanner ? "12px 14px 14px" : "0" }
    }, []);

    var topRow = el("div", {
      style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }
    }, [
      el("div", { style: { fontSize: "14px", fontWeight: "900", lineHeight: "1.25" } }, [course.name || "Untitled"]),
      badge(course.role || "Unknown")
    ]);

    var sub = "";
    if (course.code) sub = "Code: " + course.code;
    if (course.semester) sub = (sub ? (sub + " • ") : "") + "Term: " + course.semester;
    if (course.isSandbox) sub = (sub ? (sub + " • ") : "") + "Sandbox";

    body.appendChild(topRow);
    if (sub) body.appendChild(muted(sub));
    link.appendChild(body);

    return link;
  }

  function pinnedSection(items) {
    var body = el("div", {
      className: "mc-pinned-body",
      style: { marginTop: "12px" }
    }, []);

    var hint = el("p", {
      style: {
        margin: "0 0 12px",
        fontSize: "13px",
        color: "#555",
        lineHeight: "1.45"
      }
    }, [
      "Courses you’ve pinned on your Brightspace homepage appear here. To pin a course, open ",
      el("a", {
        href: "/d2l/home",
        target: "_blank",
        rel: "noopener",
        style: { color: "#0f5b46", fontWeight: "700" }
      }, ["your Brightspace homepage"]),
      ", hover a course tile in My Courses, and click the pin icon."
    ]);
    body.appendChild(hint);

    if (!items.length) {
      body.appendChild(el("div", {
        style: {
          padding: "14px",
          borderRadius: "12px",
          background: "#f9fafb",
          border: "1px dashed #d1d5db",
          color: "#666",
          fontSize: "13px"
        }
      }, ["No pinned courses yet."]));
    } else {
      var grid = el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "12px"
        }
      }, []);
      for (var i = 0; i < items.length; i++) {
        grid.appendChild(courseCard(items[i], { showBanner: true, showPinBadge: true }));
      }
      body.appendChild(grid);
    }

    var header = el("div", {
      style: {
        width: "100%",
        textAlign: "left",
        background: "#0f5b46",
        color: "#fff",
        border: "none",
        borderRadius: "14px",
        padding: "12px 14px",
        fontSize: "14px",
        fontWeight: "900",
        display: "flex",
        alignItems: "center",
        gap: "10px"
      }
    }, [
      el("i", { className: "fas fa-thumbtack", "aria-hidden": "true" }),
      el("span", null, ["Pinned Courses (" + items.length + ")"])
    ]);

    return el("div", {
      className: "mc-pinned-section",
      style: { marginTop: "0", marginBottom: "18px" }
    }, [header, body]);
  }

  function groupSection(title, items, initiallyOpen) {
    var body = el("div", {
      className: "mc-group-body",
      style: { marginTop: "12px", display: initiallyOpen ? "block" : "none" }
    }, []);

    var grid = el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "12px"
      }
    }, []);

    for (var i = 0; i < items.length; i++) grid.appendChild(courseCard(items[i]));
    body.appendChild(grid);

    var chevron = el("div", { 
      className: "mc-chevron",
      style: { fontWeight: "900", transition: "transform 0.2s" } 
    }, [initiallyOpen ? "▼" : "▶"]);

    var btn = el("button", {
      type: "button",
      style: {
        width: "100%",
        textAlign: "left",
        background: "#0f5b46",
        color: "#fff",
        border: "none",
        borderRadius: "14px",
        padding: "12px 14px",
        fontSize: "14px",
        fontWeight: "900",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        transition: "background-color 0.2s"
      },
      onmouseenter: function(e) {
        e.target.style.background = "#1a7a5e";
      },
      onmouseleave: function(e) {
        e.target.style.background = "#0f5b46";
      },
      onclick: function () {
        var isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "block";
        chevron.textContent = isOpen ? "▶" : "▼";
      }
    }, [
      el("div", null, [title + " (" + items.length + ")"]),
      chevron
    ]);

    return el("div", { style: { marginTop: "14px" } }, [btn, body]);
  }

  function renderShell(container) {
    container.innerHTML = "";

    var wrap = el("div", {
      style: {
        width: "100%",
        boxSizing: "border-box",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
      }
    }, []);

    var header = el("div", {
      style: {
        padding: "14px",
        borderRadius: "16px",
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        marginBottom: "14px"
      }
    }, []);

    header.appendChild(el("div", {
      style: { fontSize: "18px", fontWeight: "900", marginBottom: "10px" }
    }, ["My Courses"]));

    var controls = el("div", { 
      style: { display: "flex", gap: "10px", flexWrap: "wrap" } 
    }, []);

    // Search
    controls.appendChild(el("input", {
      id: "mc-search",
      type: "text",
      placeholder: "Search courses...",
      "aria-label": "Search courses",
      style: {
        flex: "1 1 260px",
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid #d1d5db",
        fontSize: "14px"
      }
    }));

    // Sort
    controls.appendChild(el("select", {
      id: "mc-sort",
      "aria-label": "Sort courses",
      style: {
        flex: "0 0 220px",
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid #d1d5db",
        fontSize: "14px",
        background: "#fff"
      }
    }, [
      el("option", { value: "name" }, ["Sort: Course Name (A–Z)"]),
      el("option", { value: "code" }, ["Sort: Course Code (A–Z)"]),
      el("option", { value: "role" }, ["Sort: Role (A–Z)"])
    ]));

    // Expand/Collapse
    controls.appendChild(el("button", {
      type: "button",
      id: "mc-expand",
      "aria-label": "Expand all course groups",
      style: {
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid #d1d5db",
        background: "#fff",
        cursor: "pointer",
        fontWeight: "900"
      }
    }, ["Expand all"]));

    controls.appendChild(el("button", {
      type: "button",
      id: "mc-collapse",
      "aria-label": "Collapse all course groups",
      style: {
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid #d1d5db",
        background: "#fff",
        cursor: "pointer",
        fontWeight: "900"
      }
    }, ["Collapse all"]));

    header.appendChild(controls);

    var status = el("div", {
      id: "mc-status",
      role: "status",
      "aria-live": "polite",
      style: {
        padding: "12px 14px",
        borderRadius: "14px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        color: "#333",
        marginBottom: "14px",
        fontSize: "13px"
      }
    }, ["Loading courses..."]);

    var groupsHost = el("div", { id: "mc-groups" }, []);

    wrap.appendChild(header);
    wrap.appendChild(status);
    wrap.appendChild(groupsHost);

    container.appendChild(wrap);
  }

  // =========================
  // FILTER / SORT / GROUP
  // =========================
  function sortCourses(list, mode) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      var av = (a[mode] || "").toString().toLowerCase();
      var bv = (b[mode] || "").toString().toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    return copy;
  }

  function filterCourses(list, q) {
    var query = (q || "").toLowerCase().trim();
    if (!query) return list;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = (list[i].name + " " + list[i].code + " " + list[i].role).toLowerCase();
      if (s.indexOf(query) >= 0) out.push(list[i]);
    }
    return out;
  }

  function filterBySemester(list, semesterCode) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];

      if (c.isSandbox && SHOW_SANDBOX_ALL_TERMS) {
        out.push(c);
        continue;
      }

      if (c.semester === semesterCode) out.push(c);
    }
    return out;
  }

  function renderGroups(allCourses, searchVal, sortMode, academicSemesterCode) {
    var host = document.getElementById("mc-groups");
    host.innerHTML = "";

    var list = filterCourses(allCourses, searchVal);
    list = sortCourses(list, sortMode);

    var pinned = [];
    var academic = [];
    var otherRoles = [];
    var sandbox = [];

    // Academic semester filter - only show the selected term for academic courses
    var academicSemester = academicSemesterCode || viewingSemesterCode();

    for (var i = 0; i < list.length; i++) {
      var c = list[i];

      if (c.isPinned) {
        pinned.push(c);
      }

      if (c.isSandbox) {
        sandbox.push(c);
      } else if (c.isAcademic) {
        // Only include academic courses from the selected semester
        if (c.semester === academicSemester) {
          academic.push(c);
        }
      } else {
        // Include all other roles regardless of semester
        otherRoles.push(c);
      }
    }

    // Prefer pin date order (newest pins first); fall back to current sort
    pinned.sort(function (a, b) {
      var aTs = a.pinDate ? Date.parse(a.pinDate) : 0;
      var bTs = b.pinDate ? Date.parse(b.pinDate) : 0;
      if (bTs !== aTs) return bTs - aTs;
      return 0;
    });

    host.appendChild(pinnedSection(pinned));

    if (academic.length > 0) {
      host.appendChild(groupSection("Academic Courses", academic, true));
    }
    if (otherRoles.length > 0) {
      host.appendChild(groupSection("Other Roles", otherRoles, false));
    }
    if (sandbox.length > 0) {
      host.appendChild(groupSection("Sandbox Courses", sandbox, false));
    }

    // Expand all
    var expandBtn = document.getElementById("mc-expand");
    if (expandBtn) {
      expandBtn.onclick = function () {
        var bodies = host.querySelectorAll(".mc-group-body");
        var chevrons = host.querySelectorAll(".mc-chevron");
        for (var j = 0; j < bodies.length; j++) bodies[j].style.display = "block";
        for (var k = 0; k < chevrons.length; k++) chevrons[k].textContent = "▼";
      };
    }

    // Collapse all
    var collapseBtn = document.getElementById("mc-collapse");
    if (collapseBtn) {
      collapseBtn.onclick = function () {
        var bodies2 = host.querySelectorAll(".mc-group-body");
        var chevrons2 = host.querySelectorAll(".mc-chevron");
        for (var j2 = 0; j2 < bodies2.length; j2++) bodies2[j2].style.display = "none";
        for (var k2 = 0; k2 < chevrons2.length; k2++) chevrons2[k2].textContent = "▶";
      };
    }
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var container = document.getElementById("mycourses-widget");
    if (!container) {
      console.warn("My Courses widget container not found");
      return;
    }

    renderShell(container);

    var statusEl = document.getElementById("mc-status");
    var searchEl = document.getElementById("mc-search");
    var sortEl = document.getElementById("mc-sort");

    try {
      var raw = await getAllMyEnrollments();
      var pinnedMap = await fetchPinnedFromWidget();

      var courses = [];
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i];
        if (!isCourseOffering(item)) continue;

        var ou = item.OrgUnit.Id;
        var name = item.OrgUnit.Name || "";
        var code = item.OrgUnit.Code || "";
        var roleName = getRoleName(item);
        var roleId = getRoleId(item);

        var sem = getSemesterCodeFromCourseCode(code);
        var sbx = isSandboxCourse(name, code);
        var acad = isAcademicRole(roleId, roleName);
        var pinFromEnrollment = item.PinDate || null;
        var pinMeta = pinnedMap[String(ou)] || null;
        var isPinned = !!(pinFromEnrollment || pinMeta);

        courses.push({
          ou: ou,
          name: name,
          code: code,
          role: roleName,
          roleId: roleId,
          semester: sem,
          isSandbox: sbx,
          isAcademic: acad,
          isPinned: isPinned,
          pinDate: (pinMeta && pinMeta.pinDate && pinMeta.pinDate !== true)
            ? pinMeta.pinDate
            : pinFromEnrollment,
          imageUrl: pinMeta ? pinMeta.imageUrl : null
        });
      }

      // Courses present only on the pinned widget (rare) still surface in Pinned
      for (var ouKey in pinnedMap) {
        if (!Object.prototype.hasOwnProperty.call(pinnedMap, ouKey)) continue;
        var already = false;
        for (var j = 0; j < courses.length; j++) {
          if (String(courses[j].ou) === String(ouKey)) {
            already = true;
            break;
          }
        }
        if (already) continue;
        var meta = pinnedMap[ouKey];
        courses.push({
          ou: ouKey,
          name: meta.name || "Pinned course",
          code: meta.code || "",
          role: "Pinned",
          roleId: null,
          semester: getSemesterCodeFromCourseCode(meta.code || ""),
          isSandbox: isSandboxCourse(meta.name, meta.code),
          isAcademic: true,
          isPinned: true,
          pinDate: meta.pinDate === true ? null : meta.pinDate,
          imageUrl: meta.imageUrl
        });
      }

      // Academic courses are filtered to the selected term (js/semester-config.js).
      // Other roles are shown regardless of semester.
      statusEl.textContent =
        "Loaded " + courses.length + " course offering(s). Academic courses filtered to " + viewingSemesterLabel() + " only.";

      function rerender() {
        var selectedCode = viewingSemesterCode();
        var selectedLabel = viewingSemesterLabel();

        // Count courses that will be shown
        var academicCount = 0;
        var otherRolesCount = 0;
        var sandboxCount = 0;
        var pinnedCount = 0;
        
        for (var i = 0; i < courses.length; i++) {
          var c = courses[i];
          if (c.isPinned) pinnedCount++;
          if (c.isSandbox) {
            sandboxCount++;
          } else if (c.isAcademic && c.semester === selectedCode) {
            academicCount++;
          } else if (!c.isAcademic) {
            otherRolesCount++;
          }
        }
        
        var totalShown = academicCount + otherRolesCount + sandboxCount;
        var statusParts = [];
        if (pinnedCount > 0) statusParts.push(pinnedCount + " pinned");
        if (academicCount > 0) statusParts.push(academicCount + " academic (" + selectedLabel + ")");
        if (otherRolesCount > 0) statusParts.push(otherRolesCount + " other role(s)");
        if (sandboxCount > 0) statusParts.push(sandboxCount + " sandbox");
        statusEl.textContent = "Showing " + totalShown + " course(s): " + statusParts.join(", ") + ".";

        renderGroups(courses, searchEl.value, sortEl.value, selectedCode);
      }

      searchEl.addEventListener("input", rerender);
      sortEl.addEventListener("change", rerender);
      document.addEventListener("fd-semester-viewing-change", rerender);

      rerender();

    } catch (e) {
      console.error(e);
      statusEl.textContent = "Failed to load courses. See console for details. Error: " + e.message;
      statusEl.style.background = "#fee";
      statusEl.style.borderColor = "#fcc";
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
