/**
 * Shared faculty course-offering loader for dashboard dropdowns.
 * Matches Tools & Reports eligibility so tools and analytics see the same
 * courses (previous + active + future terms, academic roles, sandboxes).
 */
(function (global) {
  "use strict";

  var API_VERSION_LP = "1.62";

  var ACADEMIC_ROLE_IDS = {
    102: true,
    183: true,
    108: true,
    127: true,
    160: true,
    167: true,
    174: true
  };

  var ACADEMIC_ROLE_KEYWORDS = ["instructor", "teacher", "faculty", "assistant", "ta", "mentor"];
  var SHOW_SANDBOX_ALL_TERMS = true;

  function semesterApi() {
    return global.FacultyDashboardSemester;
  }

  function previousCode() {
    return semesterApi() ? semesterApi().getPreviousCode() : "26/WI";
  }

  function activeCode() {
    return semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  }

  function futureCode() {
    return semesterApi() ? semesterApi().getFutureCode() : "26/FA";
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    return semesterApi()
      ? semesterApi().getSemesterCodeFromCourseCode(courseCode)
      : "";
  }

  function calendarActiveCode() {
    if (semesterApi() && typeof semesterApi().getCalendarActive === "function") {
      var slot = semesterApi().getCalendarActive();
      if (slot && slot.code) return slot.code;
    }
    return activeCode();
  }

  function isAllowedSemester(sem, options) {
    options = options || {};
    if (options.activeOnly) {
      return sem === activeCode();
    }
    if (options.cycleTerms) {
      return sem === previousCode() || sem === calendarActiveCode() || sem === futureCode();
    }
    return sem === previousCode() || sem === activeCode() || sem === futureCode();
  }

  async function BrightspaceFetchJson(url) {
    var token = localStorage.getItem("XSRF.Token");
    var res = await fetch(url, {
      credentials: "include",
      headers: { "X-CSRF-Token": token || "", Accept: "application/json" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " - " + url);
    return res.json();
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

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && item.Access.ClasslistRoleId != null) {
      var n = parseInt(item.Access.ClasslistRoleId, 10);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function getRoleName(item) {
    return item && item.Access && item.Access.ClasslistRoleName
      ? String(item.Access.ClasslistRoleName)
      : "";
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
    return (
      c.indexOf("MERGED") >= 0 ||
      c.indexOf("CXLD") >= 0 ||
      n.indexOf("MERGED") >= 0 ||
      n.indexOf("CXLD") >= 0
    );
  }

  /**
   * @param {{ activeOnly?: boolean, cycleTerms?: boolean }} [options]
   *   activeOnly — current viewing term only + sandboxes
   *   cycleTerms — previous + calendar-current + future (ignores header picker)
   *   default — previous + viewing + future terms + sandboxes
   * @returns {Promise<Array>} enrollment-shaped course items with OrgUnit
   */
  async function getFacultyCourseOfferings(options) {
    options = options || {};
    var raw = await getAllMyEnrollments();
    var out = [];
    var seen = {};

    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (!isCourseOffering(item)) continue;

      var orgUnitId = item.OrgUnit && item.OrgUnit.Id;
      var name = (item.OrgUnit && item.OrgUnit.Name) || "";
      var code = (item.OrgUnit && item.OrgUnit.Code) || "";
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
        if (!academic || !isAllowedSemester(sem, options)) continue;
      }

      seen[String(orgUnitId)] = true;
      out.push(item);
    }

    out.sort(function (a, b) {
      var ac = (a.OrgUnit && a.OrgUnit.Code) || "";
      var bc = (b.OrgUnit && b.OrgUnit.Code) || "";
      return String(ac).localeCompare(String(bc));
    });

    return out;
  }

  /**
   * Populate a <select> with faculty courses. Returns the course list used.
   * @param {HTMLSelectElement} selectEl
   * @param {{
   *   activeOnly?: boolean,
   *   includeAllOption?: boolean,
   *   allValue?: string,
   *   allLabel?: string,
   *   emptyLabel?: string,
   *   loadingLabel?: string,
   *   placeholderLabel?: string,
   *   selectedValue?: string,
   *   persistCache?: boolean
   * }} [options]
   */
  async function populateCourseSelect(selectEl, options) {
    options = options || {};
    if (!selectEl) return [];

    var includeAll = !!options.includeAllOption;
    var allValue = options.allValue != null ? options.allValue : "all";
    var allLabel = options.allLabel || "All Courses";
    var emptyLabel = options.emptyLabel || "No eligible courses found";
    var loadingLabel = options.loadingLabel || "Loading courses…";
    var placeholderLabel = options.placeholderLabel || "Select a course…";
    var selectedValue = options.selectedValue != null ? String(options.selectedValue) : "";

    selectEl.innerHTML = "";
    var loadingOpt = document.createElement("option");
    loadingOpt.value = "";
    loadingOpt.textContent = loadingLabel;
    selectEl.appendChild(loadingOpt);
    selectEl.disabled = true;

    try {
      var courses = await getFacultyCourseOfferings({
        activeOnly: !!options.activeOnly
      });

      if (options.persistCache !== false) {
        try {
          localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        } catch (e) {
          /* ignore quota / private mode */
        }
      }

      selectEl.innerHTML = "";
      if (includeAll) {
        var allOpt = document.createElement("option");
        allOpt.value = allValue;
        allOpt.textContent = allLabel;
        selectEl.appendChild(allOpt);
      } else {
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = placeholderLabel;
        selectEl.appendChild(placeholder);
      }

      if (!courses.length) {
        if (!includeAll) {
          selectEl.innerHTML = "";
          var emptyOpt = document.createElement("option");
          emptyOpt.value = "";
          emptyOpt.textContent = emptyLabel;
          selectEl.appendChild(emptyOpt);
        }
        selectEl.disabled = false;
        return courses;
      }

      var termCourses = [];
      var sandboxCourses = [];
      for (var c = 0; c < courses.length; c++) {
        var courseItem = courses[c];
        var cName = (courseItem.OrgUnit && courseItem.OrgUnit.Name) || "";
        var cCode = (courseItem.OrgUnit && courseItem.OrgUnit.Code) || "";
        if (isSandboxCourse(cName, cCode)) sandboxCourses.push(courseItem);
        else termCourses.push(courseItem);
      }

      function appendCourseOption(parent, course) {
        var orgUnitId = course.OrgUnit.Id;
        var courseName = course.OrgUnit.Name || "Unknown Course";
        var courseCode = course.OrgUnit.Code || "";
        var option = document.createElement("option");
        option.value = String(orgUnitId);
        option.textContent = courseName + (courseCode ? " (" + courseCode + ")" : "");
        if (selectedValue && String(orgUnitId) === selectedValue) {
          option.selected = true;
        }
        parent.appendChild(option);
      }

      var useGroups = sandboxCourses.length > 0 && termCourses.length > 0;
      if (useGroups) {
        var termGroup = document.createElement("optgroup");
        termGroup.label = "Semester courses";
        for (var t = 0; t < termCourses.length; t++) appendCourseOption(termGroup, termCourses[t]);
        selectEl.appendChild(termGroup);

        var sandboxGroup = document.createElement("optgroup");
        sandboxGroup.label = "Sandbox courses";
        for (var s = 0; s < sandboxCourses.length; s++) {
          appendCourseOption(sandboxGroup, sandboxCourses[s]);
        }
        selectEl.appendChild(sandboxGroup);
      } else {
        for (var i = 0; i < courses.length; i++) {
          appendCourseOption(selectEl, courses[i]);
        }
      }

      if (includeAll && (!selectedValue || selectedValue === allValue)) {
        selectEl.value = allValue;
      }

      selectEl.disabled = false;
      return courses;
    } catch (e) {
      console.error("[CourseOfferings] Failed to load courses:", e);
      selectEl.innerHTML = "";
      var errOpt = document.createElement("option");
      errOpt.value = "";
      errOpt.textContent = "Failed to load courses";
      selectEl.appendChild(errOpt);
      selectEl.disabled = false;
      throw e;
    }
  }

  global.FacultyDashboardCourses = {
    getFacultyCourseOfferings: getFacultyCourseOfferings,
    populateCourseSelect: populateCourseSelect,
    getPreviousCode: previousCode,
    getActiveCode: activeCode,
    getFutureCode: futureCode,
    isAllowedSemester: isAllowedSemester
  };
})(window);
