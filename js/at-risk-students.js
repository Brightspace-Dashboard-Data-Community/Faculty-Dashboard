/**
 * D2L Faculty Dashboard - At-Risk Students Widget
 * Shows top 5-10 students most likely to fail/withdraw per course
 * Semester-filtered, displayed as compact analytic boxes
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.60";

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  var SEMESTERS = semesterApi()
    ? semesterApi().getSemestersForSelect()
    : [
        { code: "26/SP", label: "Spring 2026 (26/SP)" },
        { code: "25/FA", label: "Fall 2025 (25/FA)" }
      ];
  var DEFAULT_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";

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
  // GET ROLE ID FROM ENROLLMENT ITEM
  // =========================
  function getRoleId(item) {
    if (item && item.Access) {
      // First try ClasslistRoleId (if it exists)
      if (typeof item.Access.ClasslistRoleId !== "undefined" && item.Access.ClasslistRoleId !== null) {
        var n = parseInt(item.Access.ClasslistRoleId, 10);
        if (!isNaN(n)) return n;
      }
      
      // Fallback: Check ClasslistRoleName for "Instructor" (case-insensitive)
      if (item.Access.ClasslistRoleName) {
        var roleName = (item.Access.ClasslistRoleName || "").toLowerCase();
        if (roleName.indexOf("instructor") >= 0 && roleName.indexOf("evaluator") === -1) {
          // If role name contains "instructor" but not "evaluator", treat as roleId 102
          return 102;
        }
      }
    }
    return null;
  }

  // =========================
  // GET COURSES BY SEMESTER
  // =========================
  async function getCoursesBySemester(semesterCode) {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;

    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";

      var data = await BrightspaceFetch(endpoint);

      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) {
          var item = data.Items[i];
          if (item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3) {
            var code = item.OrgUnit.Code || "";
            var sem = getSemesterCodeFromCourseCode(code);
            if (sem === semesterCode) {
              // Only include courses where instructor has roleId == 102 (Instructor)
              var roleId = getRoleId(item);
              if (roleId === 102) {
                allItems.push(item);
              }
            }
          }
        }
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

  // =========================
  // GET CLASSLIST
  // =========================
  async function getClasslist(orgUnitId) {
    var students = [];
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/";
      var data = await BrightspaceFetch(endpoint);
      
      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) {
          var item = data.Items[i];
          if (item.RoleId === 3 || item.RoleId === 5) {
            students.push({
              userId: item.Identifier,
              userName: item.ProfileBadgeUrl ? item.ProfileBadgeUrl.split('/').pop() : item.Identifier,
              displayName: item.ProfileBadgeUrl ? item.ProfileBadgeUrl.split('/').pop() : item.Identifier,
              firstName: item.FirstName || "",
              lastName: item.LastName || "",
              email: item.Email || "",
              roleId: item.RoleId
            });
          }
        }
      }
    } catch (e) {
      console.error("Failed to get classlist for " + orgUnitId, e);
    }
    return students;
  }

  // =========================
  // GET GRADES
  // =========================
  async function getFinalGrade(orgUnitId, userId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/final/values/" + userId;
      var data = await BrightspaceFetch(endpoint);
      return data.GradeValue || null;
    } catch (e) {
      return null;
    }
  }

  // =========================
  // GET LAST ACCESS
  // =========================
  async function getLastAccess(orgUnitId, userId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/access/" + userId;
      var data = await BrightspaceFetch(endpoint);
      return data.LastAccessed || null;
    } catch (e) {
      return null;
    }
  }

  // =========================
  // CHECK FOR SUBMISSIONS
  // =========================
  async function hasAnySubmissions(orgUnitId, userId) {
    try {
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var dropboxData = await BrightspaceFetch(dropboxEndpoint);
      
      if (dropboxData && dropboxData.length) {
        for (var i = 0; i < Math.min(5, dropboxData.length); i++) {
          try {
            var subEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + dropboxData[i].Id + "/submissions/" + userId;
            var subData = await BrightspaceFetch(subEndpoint);
            if (subData && subData.SubmittedDate) return true;
          } catch (e) {
            // Continue
          }
        }
      }
    } catch (e) {
      // Continue
    }
    return false;
  }

  // =========================
  // CALCULATE RISK SCORE
  // =========================
  function calculateRiskScore(student) {
    var score = 0;
    var reasons = [];

    if (student.finalGrade !== null && student.finalGrade < 70) {
      score += 30;
      reasons.push({ text: "Low Grade (" + student.finalGrade + "%)", color: "#c00" });
    }

    if (student.lastAccess) {
      var daysSinceAccess = Math.floor((new Date() - new Date(student.lastAccess)) / (1000 * 60 * 60 * 24));
      if (daysSinceAccess > 7) {
        score += 20;
        reasons.push({ text: "No Access (" + daysSinceAccess + " days)", color: "#f80" });
      }
      if (daysSinceAccess > 14) {
        score += 10;
      }
    } else {
      score += 25;
      reasons.push({ text: "Never Accessed", color: "#c00" });
    }

    if (!student.hasSubmissions) {
      score += 25;
      reasons.push({ text: "No Submissions", color: "#c00" });
    }

    if (!student.hasSubmissions && student.lastAccess === null) {
      score += 15;
      if (reasons.length === 0 || reasons[reasons.length - 1].text !== "Never Accessed") {
        reasons.push({ text: "Missing First Activity", color: "#f80" });
      }
    }

    return { score: score, reasons: reasons };
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
        if (children[i] == null || children[i] === undefined) continue;
        if (typeof children[i] === "string") {
          node.appendChild(document.createTextNode(children[i]));
        } else if (children[i] instanceof Node) {
          node.appendChild(children[i]);
        } else {
          console.warn("Invalid child element:", children[i]);
        }
      }
    }
    return node;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "Never";
    var date = new Date(dateStr);
    var now = new Date();
    var diff = now - date;
    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return days + " days ago";
    return date.toLocaleDateString();
  }

  // =========================
  // RENDER COURSE BOX
  // =========================
  function renderCourseBox(courseId, courseName, students) {
    var box = el("div", {
      style: {
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "16px",
        marginBottom: "16px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
      }
    }, []);

    var header = el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px",
        paddingBottom: "12px",
        borderBottom: "1px solid #e5e7eb"
      }
    }, [
      el("div", {
        style: { fontWeight: "700", fontSize: "14px", color: "#0f5b46" }
      }, [courseName]),
      el("div", {
        style: {
          padding: "4px 10px",
          borderRadius: "12px",
          background: students.length > 0 ? "#fee" : "#e8f5f0",
          color: students.length > 0 ? "#c00" : "#0f5b46",
          fontWeight: "700",
          fontSize: "12px"
        }
      }, [students.length + " at-risk"])
    ]);

    var studentsList = el("div", {
      style: { maxHeight: "300px", overflowY: "auto" }
    }, []);

    if (students.length === 0) {
      studentsList.appendChild(el("div", {
        style: { padding: "20px", textAlign: "center", color: "#888", fontSize: "12px" }
      }, ["No at-risk students"]));
    } else {
      for (var i = 0; i < Math.min(students.length, 5); i++) {
        var student = students[i];
        var risk = calculateRiskScore(student);
        
        var studentCard = el("div", {
          style: {
            padding: "10px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            marginBottom: "8px",
            background: "#f9fafb",
            borderLeft: "3px solid " + (risk.score >= 50 ? "#c00" : risk.score >= 30 ? "#f80" : "#0f5b46")
          }
        }, []);

        var studentHeader = el("div", {
          style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }
        }, [
          el("div", {
            style: { fontWeight: "600", fontSize: "13px" }
          }, [student.displayName || student.firstName + " " + student.lastName]),
          el("div", {
            style: {
              padding: "2px 8px",
              borderRadius: "8px",
              fontSize: "10px",
              background: risk.score >= 50 ? "#fee" : risk.score >= 30 ? "#ffe8cc" : "#e8f5f0",
              color: risk.score >= 50 ? "#c00" : risk.score >= 30 ? "#f80" : "#0f5b46",
              fontWeight: "700"
            }
          }, ["Risk: " + risk.score])
        ]);

        var badges = el("div", {
          style: { display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }
        }, []);

        for (var j = 0; j < Math.min(risk.reasons.length, 2); j++) {
          badges.appendChild(el("span", {
            style: {
              padding: "2px 6px",
              borderRadius: "6px",
              fontSize: "10px",
              background: risk.reasons[j].color + "20",
              color: risk.reasons[j].color,
              fontWeight: "600"
            }
          }, [risk.reasons[j].text]));
        }

        var meta = el("div", {
          style: { fontSize: "11px", color: "#666" }
        }, [
          "Grade: " + (student.finalGrade !== null ? student.finalGrade + "%" : "N/A") + " • " +
          "Last: " + formatDate(student.lastAccess)
        ]);

        studentCard.appendChild(studentHeader);
        studentCard.appendChild(badges);
        studentCard.appendChild(meta);

        studentsList.appendChild(studentCard);
      }
      
      if (students.length > 5) {
        studentsList.appendChild(el("div", {
          style: { textAlign: "center", padding: "8px", fontSize: "11px", color: "#666" }
        }, ["+" + (students.length - 5) + " more students"]));
      }
    }

    box.appendChild(header);
    box.appendChild(studentsList);

    return box;
  }

  // =========================
  // RENDER WIDGET
  // =========================
  function renderWidget(container, courseData) {
    container.innerHTML = "";

    var header = el("div", {
      style: {
        marginBottom: "16px"
      }
    }, [
      el("h2", {
        style: { fontSize: "18px", fontWeight: "900", color: "#0f5b46", margin: 0 }
      }, ["At-Risk Students Snapshot"])
    ]);

    var content = el("div", {
      id: "ars-content",
      style: { maxHeight: "500px", overflowY: "auto" }
    }, []);

    container.appendChild(header);
    container.appendChild(content);

    function renderFiltered(selectedSem) {
      content.innerHTML = "";

      if (selectedSem === "all") {
        // Show all semesters
        for (var semCode in courseData) {
          var courses = courseData[semCode];
          for (var courseId in courses) {
            var course = courses[courseId];
            if (course.students.length > 0) {
              content.appendChild(renderCourseBox(courseId, course.name, course.students));
            }
          }
        }
      } else {
        // Show specific semester
        if (courseData[selectedSem]) {
          var courses = courseData[selectedSem];
          for (var courseId in courses) {
            var course = courses[courseId];
            if (course.students.length > 0) {
              content.appendChild(renderCourseBox(courseId, course.name, course.students));
            }
          }
        }
      }

      if (content.children.length === 0) {
        content.appendChild(el("div", {
          style: { padding: "40px", textAlign: "center", color: "#888" }
        }, ["No at-risk students found" + (selectedSem !== "all" ? " for " + selectedSem : "")]));
      }
    }

    // Listen to global semester selector
    var globalSemSelect = document.getElementById("global-semester-select");
    if (globalSemSelect) {
      globalSemSelect.addEventListener("change", function() {
        renderFiltered(globalSemSelect.value);
      });
      
      // Initial render
      renderFiltered(globalSemSelect.value || "all");
    } else {
      // Fallback if global selector not found
      renderFiltered("all");
    }
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var container = document.getElementById("at-risk-students-widget");
    if (!container) return;

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading at-risk students..."]).outerHTML;

    try {
      var courseData = {};

      // Load data for each semester
      for (var i = 0; i < SEMESTERS.length; i++) {
        var semCode = SEMESTERS[i].code;
        var courses = await getCoursesBySemester(semCode);
        courseData[semCode] = {};

        for (var j = 0; j < courses.length; j++) {
          var orgUnitId = courses[j].OrgUnit.Id;
          var courseName = courses[j].OrgUnit.Name || "Unknown Course";

          container.innerHTML = el("div", {
            style: { padding: "20px", textAlign: "center", color: "#555" }
          }, ["Analyzing " + courseName + "..."]).outerHTML;

          var students = await getClasslist(orgUnitId);
          var studentData = [];

          // Process students (limit to avoid too many API calls)
          for (var k = 0; k < Math.min(students.length, 50); k++) {
            var student = students[k];
            
            var [finalGrade, lastAccess, hasSubmissions] = await Promise.all([
              getFinalGrade(orgUnitId, student.userId),
              getLastAccess(orgUnitId, student.userId),
              hasAnySubmissions(orgUnitId, student.userId)
            ]);

            student.finalGrade = finalGrade;
            student.lastAccess = lastAccess;
            student.hasSubmissions = hasSubmissions;

            var risk = calculateRiskScore(student);
            if (risk.score > 0) {
              studentData.push(student);
            }
          }

          // Sort by risk score and take top 10
          studentData.sort(function(a, b) {
            return calculateRiskScore(b).score - calculateRiskScore(a).score;
          });
          studentData = studentData.slice(0, 10);

          courseData[semCode][orgUnitId] = {
            name: courseName,
            students: studentData
          };
        }
      }

      renderWidget(container, courseData);
    } catch (e) {
      console.error("Failed to load at-risk students:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading at-risk students: " + e.message]).outerHTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
