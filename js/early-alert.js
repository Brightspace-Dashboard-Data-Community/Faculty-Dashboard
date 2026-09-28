/**
 * D2L Faculty Dashboard - Early Alert Builder Widget
 * Finds students who never attended or stopped attending (Week 1-4)
 * Semester-filtered, displayed as compact analytic boxes
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.60";
  
  // Helper to check if API call should be attempted
  function shouldSkipAPI(orgUnitId) {
    // Skip if orgUnitId is invalid
    if (!orgUnitId || orgUnitId <= 0) return true;
    return false;
  }

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
  // GET COURSE START DATE
  // =========================
  async function getCourseStartDate(orgUnitId) {
    if (shouldSkipAPI(orgUnitId)) return null;
    try {
      // Use the course offering API instead of the non-existent LE endpoint
      var endpoint = "/d2l/api/lp/" + API_VERSION_LP + "/" + orgUnitId + "/";
      var data = await BrightspaceFetch(endpoint);
      return data.StartDate || null;
    } catch (e) {
      // Silently fail - course start date is optional
      return null;
    }
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
              email: item.Email || ""
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
  // GET LAST ACCESS
  // =========================
  async function getLastAccess(orgUnitId, userId) {
    if (shouldSkipAPI(orgUnitId) || !userId) return null;
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/access/" + userId;
      var data = await BrightspaceFetch(endpoint);
      return data.LastAccessed || null;
    } catch (e) {
      // Silently fail - access data is optional
      return null;
    }
  }

  // =========================
  // CHECK FOR ACTIVITY
  // =========================
  async function checkStudentActivity(orgUnitId, userId) {
    var activity = {
      hasSubmissions: false,
      hasQuizAttempts: false,
      hasDiscussionPosts: false,
      firstSubmissionDate: null,
      firstQuizDate: null,
      firstPostDate: null
    };

    try {
      // Check dropbox submissions
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var dropboxData = await BrightspaceFetch(dropboxEndpoint);
      
      if (dropboxData && dropboxData.length) {
        for (var i = 0; i < Math.min(10, dropboxData.length); i++) {
          try {
            var subEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + dropboxData[i].Id + "/submissions/" + userId;
            var subData = await BrightspaceFetch(subEndpoint);
            if (subData && subData.SubmittedDate) {
              activity.hasSubmissions = true;
              if (!activity.firstSubmissionDate || new Date(subData.SubmittedDate) < new Date(activity.firstSubmissionDate)) {
                activity.firstSubmissionDate = subData.SubmittedDate;
              }
            }
          } catch (e) {
            // Continue
          }
        }
      }

      // Check quiz attempts
      try {
        var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
        var quizData = await BrightspaceFetch(quizEndpoint);
        
        if (quizData && quizData.Objects && quizData.Objects.length) {
          for (var i = 0; i < Math.min(5, quizData.Objects.length); i++) {
            try {
              var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizData.Objects[i].QuizId + "/attempts/" + userId;
              var attemptsData = await BrightspaceFetch(attemptsEndpoint);
              if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
                activity.hasQuizAttempts = true;
                var firstAttempt = attemptsData.Objects[0];
                if (firstAttempt.StartDate && (!activity.firstQuizDate || new Date(firstAttempt.StartDate) < new Date(activity.firstQuizDate))) {
                  activity.firstQuizDate = firstAttempt.StartDate;
                }
              }
            } catch (e) {
              // Continue
            }
          }
        }
      } catch (e) {
        // Continue
      }
    } catch (e) {
      // Continue
    }

    return activity;
  }

  // =========================
  // IDENTIFY AT-RISK STUDENTS
  // =========================
  function identifyAtRiskStudents(students, courseStartDate, weeksToCheck) {
    var now = new Date();
    var courseStart = courseStartDate ? new Date(courseStartDate) : null;
    var daysSinceStart = courseStart ? Math.floor((now - courseStart) / (1000 * 60 * 60 * 24)) : null;
    var isInFirstWeeks = daysSinceStart !== null && daysSinceStart <= (weeksToCheck * 7);

    var atRisk = [];

    for (var i = 0; i < students.length; i++) {
      var student = students[i];
      var riskType = null;
      var riskReason = "";

      // Never attended
      if (!student.lastAccess && !student.activity.hasSubmissions && !student.activity.hasQuizAttempts && !student.activity.hasDiscussionPosts) {
        riskType = "never_attended";
        riskReason = "Never accessed course";
      }
      // Stopped attending
      else if (student.lastAccess) {
        var daysSinceAccess = Math.floor((now - new Date(student.lastAccess)) / (1000 * 60 * 60 * 24));
        var lastActivityDate = student.activity.firstSubmissionDate || student.activity.firstQuizDate || student.activity.firstPostDate;
        var daysSinceActivity = lastActivityDate ? Math.floor((now - new Date(lastActivityDate)) / (1000 * 60 * 60 * 24)) : daysSinceAccess;
        
        if (daysSinceAccess > 7 && daysSinceActivity > 7 && isInFirstWeeks) {
          riskType = "stopped_attending";
          riskReason = "No access for " + daysSinceAccess + " days";
        }
      }

      if (riskType) {
        student.riskType = riskType;
        student.riskReason = riskReason;
        atRisk.push(student);
      }
    }

    return atRisk;
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

  function generateMessageTemplate(selectedStudents, courseName) {
    var names = selectedStudents.map(function(s) { return s.displayName || s.firstName + " " + s.lastName; }).join(", ");
    var emails = selectedStudents.map(function(s) { return s.email; }).filter(function(e) { return e; }).join("; ");
    
    var template = "Subject: Early Alert - " + courseName + "\n\n";
    template += "Dear " + names + ",\n\n";
    template += "I wanted to reach out regarding your participation in " + courseName + ". ";
    template += "I noticed that you haven't accessed the course recently or haven't submitted any work yet.\n\n";
    template += "I'm here to help you succeed. Please reach out if you have any questions or concerns.\n\n";
    template += "Best regards,\n";
    template += "[Your Name]";
    
    if (emails) {
      template += "\n\n---\nEmail addresses: " + emails;
    }
    
    return template;
  }

  // =========================
  // RENDER COURSE BOX
  // =========================
  function renderCourseBox(courseId, courseName, students, selectedStudents, onToggle, onGenerate) {
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
      style: { maxHeight: "200px", overflowY: "auto", marginBottom: "12px" }
    }, []);

    if (students.length === 0) {
      studentsList.appendChild(el("div", {
        style: { padding: "20px", textAlign: "center", color: "#888", fontSize: "12px" }
      }, ["No at-risk students"]));
    } else {
      for (var i = 0; i < students.length; i++) {
        var student = students[i];
        var isSelected = selectedStudents.some(function(s) {
          return s.userId === student.userId && s.courseId === courseId;
        });
        
        var studentRow = el("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px",
            borderRadius: "6px",
            marginBottom: "6px",
            background: isSelected ? "#e8f5f0" : "#f9fafb",
            cursor: "pointer"
          },
          onclick: function() { onToggle(student, courseId, courseName); }
        }, [
          el("input", {
            type: "checkbox",
            checked: isSelected,
            style: { width: "16px", height: "16px", cursor: "pointer" },
            onclick: function(e) { e.stopPropagation(); onToggle(student, courseId, courseName); }
          }, []),
          el("div", {
            style: { flex: 1, fontSize: "12px" }
          }, [
            el("div", { style: { fontWeight: "600" } }, [student.displayName || student.firstName + " " + student.lastName]),
            el("div", {
              style: { fontSize: "11px", color: "#666", marginTop: "2px" }
            }, [student.riskReason])
          ])
        ]);

        studentsList.appendChild(studentRow);
      }
    }

    var actions = el("div", {
      style: { display: "flex", gap: "8px" }
    }, [
      el("button", {
        type: "button",
        style: {
          flex: 1,
          padding: "8px 12px",
          borderRadius: "6px",
          border: "1px solid #d1d5db",
          background: "#fff",
          cursor: "pointer",
          fontWeight: "600",
          fontSize: "12px"
        },
        onclick: function() {
          for (var i = 0; i < students.length; i++) {
            var s = students[i];
            s.courseId = courseId;
            s.courseName = courseName;
            onToggle(s, courseId, courseName);
          }
        }
      }, ["Select All"]),
      el("button", {
        type: "button",
        style: {
          flex: 1,
          padding: "8px 12px",
          borderRadius: "6px",
          border: "none",
          background: "#0f5b46",
          color: "#fff",
          cursor: "pointer",
          fontWeight: "600",
          fontSize: "12px"
        },
        onclick: function() {
          var courseSelected = students.filter(function(s) {
            return selectedStudents.some(function(sel) {
              return sel.userId === s.userId && sel.courseId === courseId;
            });
          });
          if (courseSelected.length > 0) {
            onGenerate(courseSelected, courseName);
          }
        }
      }, ["Generate Message"])
    ]);

    box.appendChild(header);
    box.appendChild(studentsList);
    box.appendChild(actions);

    return box;
  }

  // =========================
  // RENDER WIDGET
  // =========================
  function renderWidget(container, courseData) {
    container.innerHTML = "";

    var selectedStudents = [];

    var header = el("div", {
      style: {
        marginBottom: "16px"
      }
    }, [
      el("h2", {
        style: { fontSize: "18px", fontWeight: "900", color: "#0f5b46", margin: 0 }
      }, ["Week 1-4 Early Alert Builder"])
    ]);

    var content = el("div", {
      id: "ea-content",
      style: { maxHeight: "500px", overflowY: "auto" }
    }, []);

    var messageContainer = el("div", {
      id: "ea-message",
      style: { display: "none", marginTop: "20px" }
    }, []);

    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(messageContainer);

    var globalSemSelect = document.getElementById("global-semester-select");

    function toggleStudent(student, courseId, courseName) {
      student.courseId = courseId;
      student.courseName = courseName;
      
      var index = selectedStudents.findIndex(function(s) {
        return s.userId === student.userId && s.courseId === courseId;
      });
      
      if (index >= 0) {
        selectedStudents.splice(index, 1);
      } else {
        selectedStudents.push(student);
      }
      
      renderFiltered(globalSemSelect ? globalSemSelect.value : "all");
    }

    function generateMessage(students, courseName) {
      if (students.length === 0) return;

      var message = generateMessageTemplate(students, courseName);

      messageContainer.style.display = "block";
      messageContainer.innerHTML = "";

      messageContainer.appendChild(el("h3", {
        style: { fontSize: "16px", fontWeight: "700", marginBottom: "10px", color: "#0f5b46" }
      }, ["Generated Message Template"]));

      var textarea = el("textarea", {
        value: message,
        readonly: true,
        style: {
          width: "100%",
          minHeight: "200px",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #d1d5db",
          fontSize: "14px",
          fontFamily: "monospace",
          resize: "vertical"
        }
      }, []);

      var copyBtn = el("button", {
        type: "button",
        style: {
          marginTop: "10px",
          padding: "10px 20px",
          borderRadius: "8px",
          border: "none",
          background: "#2d9d7a",
          color: "#fff",
          cursor: "pointer",
          fontWeight: "600",
          fontSize: "14px"
        },
        onclick: function() {
          textarea.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied!";
          setTimeout(function() { copyBtn.textContent = "Copy to Clipboard"; }, 2000);
        }
      }, ["Copy to Clipboard"]);

      messageContainer.appendChild(textarea);
      messageContainer.appendChild(copyBtn);
    }

    function renderFiltered(selectedSem) {
      content.innerHTML = "";

      if (selectedSem === "all") {
        // Show all semesters
        for (var semCode in courseData) {
          var courses = courseData[semCode];
          for (var courseId in courses) {
            var course = courses[courseId];
            if (course.students.length > 0) {
              content.appendChild(renderCourseBox(
                courseId,
                course.name,
                course.students,
                selectedStudents,
                toggleStudent,
                generateMessage
              ));
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
              content.appendChild(renderCourseBox(
                courseId,
                course.name,
                course.students,
                selectedStudents,
                toggleStudent,
                generateMessage
              ));
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
    if (globalSemSelect) {
      globalSemSelect.addEventListener("change", function() {
        selectedStudents = [];
        renderFiltered(globalSemSelect.value);
        messageContainer.style.display = "none";
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
    var container = document.getElementById("early-alert-widget");
    if (!container) return;

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading early alert data..."]).outerHTML;

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

          var [courseStartDate, students] = await Promise.all([
            getCourseStartDate(orgUnitId),
            getClasslist(orgUnitId)
          ]);

          var studentData = [];

          // Process students (limit to avoid too many API calls)
          for (var k = 0; k < Math.min(students.length, 50); k++) {
            var student = students[k];
            
            var [lastAccess, activity] = await Promise.all([
              getLastAccess(orgUnitId, student.userId),
              checkStudentActivity(orgUnitId, student.userId)
            ]);

            student.lastAccess = lastAccess;
            student.activity = activity;
            studentData.push(student);
          }

          var atRisk = identifyAtRiskStudents(studentData, courseStartDate, 4);

          courseData[semCode][orgUnitId] = {
            name: courseName,
            students: atRisk
          };
        }
      }

      renderWidget(container, courseData);
    } catch (e) {
      console.error("Failed to load early alert data:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading early alert data: " + e.message]).outerHTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
