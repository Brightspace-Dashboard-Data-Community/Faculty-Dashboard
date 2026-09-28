/**
 * D2L Faculty Dashboard - Attention Needed Widget
 * Shows ungraded submissions, unread discussions, and new activity
 * Uses global semester selector
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

  function isEnrollmentScanSemester(sem) {
    var api = semesterApi();
    var codes = api ? api.getEnrollmentScanCodes() : ["26/SP", "25/FA"];
    for (var i = 0; i < codes.length; i++) {
      if (codes[i] === sem) return true;
    }
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
              allItems.push(item);
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
  // GET ALL COURSES
  // =========================
  async function getAllCourses() {
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
            if (isEnrollmentScanSemester(sem)) {
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
  // GET UNGRADED SUBMISSIONS
  // =========================
  async function getUngradedSubmissions(orgUnitId) {
    var items = [];
    try {
      var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
      var dropboxData = await BrightspaceFetch(dropboxEndpoint);
      
      if (dropboxData && dropboxData.length) {
        for (var i = 0; i < dropboxData.length; i++) {
          var folderId = dropboxData[i].Id;
          try {
            // Use /submissions/ endpoint which returns array of EntityDropbox objects (one per student)
            // Add activeOnly=true to filter out students no longer in the course
            var submissionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folderId + "/submissions/?activeOnly=true";
            var entityDropboxList = await BrightspaceFetch(submissionsEndpoint);
            
            if (entityDropboxList && entityDropboxList.length) {
              // Each item in the array is an EntityDropbox object with Status, Feedback, and Submissions
              for (var j = 0; j < entityDropboxList.length; j++) {
                var entity = entityDropboxList[j];
                var needsAttention = false;
                
                // Check Status field (ENTITYDROPBOXSTATUS_T):
                // 0 = Unsubmitted (needs attention)
                // 1 = Submitted but no evaluated feedback yet (needs attention)
                // 2 = Draft feedback exists but not released (needs attention - not published)
                // 3 = Published feedback (check if Feedback exists and is published)
                var status = entity.Status !== undefined ? entity.Status : null;
                
                if (status === 0 || status === 1) {
                  // Unsubmitted or Submitted but no feedback yet
                  needsAttention = true;
                } else if (status === 2) {
                  // Draft feedback - exists but not published to learner (needs attention)
                  needsAttention = true;
                } else if (status === 3) {
                  // Published - check if Feedback actually exists and is properly graded
                  if (!entity.Feedback) {
                    // Published status but no Feedback object - needs attention
                    needsAttention = true;
                  } else {
                    // Feedback exists - check if it's actually published (IsGraded = true) and has content
                    var feedback = entity.Feedback;
                    var isGraded = feedback.IsGraded === true;
                    
                    // If not graded, feedback is still in draft (needs attention)
                    if (!isGraded) {
                      needsAttention = true;
                    } else {
                      // Feedback is graded/published - check if it has meaningful content
                      var hasScore = feedback.Score !== null && feedback.Score !== undefined;
                      var hasGradedSymbol = feedback.GradedSymbol && feedback.GradedSymbol.trim().length > 0;
                      // Feedback.Feedback is a RichText object, check if it has content
                      var hasFeedbackText = false;
                      if (feedback.Feedback) {
                        // RichText can have Html, Text, or other properties
                        var feedbackHtml = feedback.Feedback.Html || "";
                        var feedbackText = feedback.Feedback.Text || "";
                        hasFeedbackText = (feedbackHtml && feedbackHtml.trim().length > 0) || (feedbackText && feedbackText.trim().length > 0);
                      }
                      var hasRubricAssessments = feedback.RubricAssessments && feedback.RubricAssessments.length > 0;
                      
                      // If no score, no graded symbol, no feedback text, and no rubric assessments, it needs attention
                      if (!hasScore && !hasGradedSymbol && !hasFeedbackText && !hasRubricAssessments) {
                        needsAttention = true;
                      }
                    }
                  }
                } else {
                  // Unknown status or null - assume needs attention to be safe
                  needsAttention = true;
                }
                
                if (needsAttention) {
                  // Get student name from Entity object
                  var studentName = "Unknown";
                  if (entity.Entity) {
                    studentName = entity.Entity.DisplayName || entity.Entity.Name || "Unknown";
                  }
                  
                  // Get submission date from Submissions array (per D2L API docs)
                  var subDate = null;
                  if (entity.Submissions && entity.Submissions.length > 0) {
                    // Get the first submission's date (or find the oldest)
                    for (var s = 0; s < entity.Submissions.length; s++) {
                      var submission = entity.Submissions[s];
                      var submissionDate = submission.SubmissionDate;
                      if (submissionDate && (!subDate || new Date(submissionDate) < new Date(subDate))) {
                        subDate = submissionDate;
                      }
                    }
                  }
                  // Fallback to CompletionDate if no submission date found
                  if (!subDate) {
                    subDate = entity.CompletionDate;
                  }
                  
                  items.push({
                    type: "assignment",
                    itemId: folderId,
                    itemName: dropboxData[i].Name || "Assignment",
                    studentName: studentName,
                    submittedDate: subDate,
                    isGraded: status === 3 && entity.Feedback && entity.Feedback.IsGraded === true
                  });
                }
              }
            }
          } catch (e) {
            // Skip if no access
          }
        }
      }
    } catch (e) {
      // Dropbox API may not be available
    }
    return items;
  }

  // =========================
  // GET QUIZ ATTEMPTS NEEDING GRADING
  // =========================
  async function getQuizAttemptsNeedingGrading(orgUnitId) {
    var items = [];
    try {
      var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
      var quizData = await BrightspaceFetch(quizEndpoint);
      
      if (quizData && quizData.Objects && quizData.Objects.length) {
        for (var i = 0; i < quizData.Objects.length; i++) {
          var quizId = quizData.Objects[i].QuizId;
          try {
            var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/attempts/";
            var attemptsData = await BrightspaceFetch(attemptsEndpoint);
            
            if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
              for (var j = 0; j < attemptsData.Objects.length; j++) {
                var attempt = attemptsData.Objects[j];
                if (attempt.IsGraded === false || attempt.IsRetake === true) {
                  items.push({
                    type: "quiz",
                    itemId: quizId,
                    itemName: quizData.Objects[i].Name || "Quiz",
                    studentName: attempt.UserName || "Unknown",
                    submittedDate: attempt.CompletionDate || attempt.StartDate || null,
                    isGraded: attempt.IsGraded || false
                  });
                }
              }
            }
          } catch (e) {
            // Skip if no access
          }
        }
      }
    } catch (e) {
      // Quiz API may not be available
    }
    return items;
  }

  // =========================
  // GET UNREAD DISCUSSIONS
  // =========================
  async function getUnreadDiscussions(orgUnitId) {
    var items = [];
    try {
      var forumEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
      var forumData = await BrightspaceFetch(forumEndpoint);
      
      // Handle both response formats: direct array or Objects array
      var forums = null;
      if (forumData) {
        if (Array.isArray(forumData)) {
          forums = forumData;
        } else if (forumData.Objects && Array.isArray(forumData.Objects)) {
          forums = forumData.Objects;
        }
      }
      
      if (forums && forums.length) {
        for (var i = 0; i < forums.length; i++) {
          var forumId = forums[i].ForumId;
          try {
            var topicEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/";
            var topicData = await BrightspaceFetch(topicEndpoint);
            
            // Handle both response formats: direct array or Objects array
            var topics = null;
            if (topicData) {
              if (Array.isArray(topicData)) {
                topics = topicData;
              } else if (topicData.Objects && Array.isArray(topicData.Objects)) {
                topics = topicData.Objects;
              }
            }
            
            if (topics && topics.length) {
              for (var j = 0; j < topics.length; j++) {
                var topicId = topics[j].TopicId;
                try {
                  // Use threadsOnly=true to get only initial posts (submissions) not replies
                  var postEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/?threadsOnly=true";
                  var postData = await BrightspaceFetch(postEndpoint);
                  
                  // Handle both response formats: Objects array or direct array
                  var posts = null;
                  if (postData) {
                    if (postData.Objects && Array.isArray(postData.Objects)) {
                      posts = postData.Objects;
                    } else if (Array.isArray(postData)) {
                      posts = postData;
                    }
                  }
                  
                  if (posts && posts.length) {
                    for (var k = 0; k < posts.length; k++) {
                      var post = posts[k];
                      if (!post.IsRead) {
                        items.push({
                          type: "discussion",
                          itemId: topicId,
                          itemName: topics[j].TopicTitle || topics[j].Name || "Discussion",
                          studentName: post.Author || "Unknown",
                          postedDate: post.PostedDate || post.DatePosted || null
                        });
                      }
                    }
                  }
                } catch (e) {
                  // Skip if no access
                }
              }
            }
          } catch (e) {
            // Skip if no access
          }
        }
      }
    } catch (e) {
      // Discussion API may not be available
    }
    return items;
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
    if (!dateStr) return "Unknown date";
    var date = new Date(dateStr);
    var now = new Date();
    var diff = now - date;
    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return days + " days ago";
    return date.toLocaleDateString();
  }

  function getTypeIcon(type) {
    if (type === "assignment") return "fa-file-alt";
    if (type === "quiz") return "fa-question-circle";
    if (type === "discussion") return "fa-comments";
    return "fa-circle";
  }

  function getTypeColor(type) {
    if (type === "assignment") return "#0f5b46";
    if (type === "quiz") return "#2d9d7a";
    if (type === "discussion") return "#1a7a5e";
    return "#555";
  }

  // =========================
  // RENDER COURSE BOX
  // =========================
  function renderCourseBox(courseId, courseName, items) {
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
          background: items.length > 0 ? "#fee" : "#e8f5f0",
          color: items.length > 0 ? "#c00" : "#0f5b46",
          fontWeight: "700",
          fontSize: "12px"
        }
      }, [items.length])
    ]);

    var itemsList = el("div", {
      style: { maxHeight: "200px", overflowY: "auto" }
    }, []);

    if (items.length === 0) {
      itemsList.appendChild(el("div", {
        style: { padding: "20px", textAlign: "center", color: "#888", fontSize: "12px" }
      }, ["No items needing attention"]));
    } else {
      for (var i = 0; i < Math.min(items.length, 5); i++) {
        var item = items[i];
        var icon = getTypeIcon(item.type);
        var color = getTypeColor(item.type);
        
        var itemRow = el("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px",
            borderRadius: "6px",
            marginBottom: "6px",
            background: "#f9fafb"
          }
        }, [
          el("i", {
            className: "fas " + icon,
            style: { color: color, fontSize: "14px", width: "18px" },
            "aria-hidden": "true"
          }),
          el("div", {
            style: { flex: 1, fontSize: "12px" }
          }, [
            el("div", { style: { fontWeight: "600" } }, [item.itemName]),
            el("div", { style: { fontSize: "11px", color: "#666", marginTop: "2px" } }, [
              item.studentName + " • " + formatDate(item.submittedDate || item.postedDate)
            ])
          ]),
          el("span", {
            style: {
              padding: "2px 6px",
              borderRadius: "8px",
              fontSize: "10px",
              background: "#e8f5f0",
              color: "#0f5b46",
              fontWeight: "600"
            }
          }, [item.type.toUpperCase()])
        ]);

        itemsList.appendChild(itemRow);
      }
      
      if (items.length > 5) {
        itemsList.appendChild(el("div", {
          style: { textAlign: "center", padding: "8px", fontSize: "11px", color: "#666" }
        }, ["+" + (items.length - 5) + " more items"]));
      }
    }

    box.appendChild(header);
    box.appendChild(itemsList);

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
      }, ["What Needs My Attention"])
    ]);

    var content = el("div", {
      id: "an-content",
      style: { maxHeight: "500px", overflowY: "auto" }
    }, []);

    container.appendChild(header);
    container.appendChild(content);

    function renderFiltered(selectedSem) {
      content.innerHTML = "";
      var totalItems = 0;

      if (selectedSem === "all") {
        // Show all semesters
        for (var semCode in courseData) {
          var courses = courseData[semCode];
          for (var courseId in courses) {
            var course = courses[courseId];
            if (course.items.length > 0) {
              content.appendChild(renderCourseBox(courseId, course.name, course.items));
              totalItems += course.items.length;
            }
          }
        }
      } else {
        // Show specific semester
        if (courseData[selectedSem]) {
          var courses = courseData[selectedSem];
          for (var courseId in courses) {
            var course = courses[courseId];
            if (course.items.length > 0) {
              content.appendChild(renderCourseBox(courseId, course.name, course.items));
              totalItems += course.items.length;
            }
          }
        }
      }

      if (totalItems === 0) {
        content.appendChild(el("div", {
          style: { padding: "40px", textAlign: "center", color: "#888" }
        }, ["No items needing attention" + (selectedSem !== "all" ? " for " + selectedSem : "")]));
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
    var container = document.getElementById("attention-needed-widget");
    if (!container) return;

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading attention items..."]).outerHTML;

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

          var [assignments, quizzes, discussions] = await Promise.all([
            getUngradedSubmissions(orgUnitId),
            getQuizAttemptsNeedingGrading(orgUnitId),
            getUnreadDiscussions(orgUnitId)
          ]);

          var allItems = assignments.concat(quizzes, discussions);

          courseData[semCode][orgUnitId] = {
            name: courseName,
            items: allItems
          };
        }
      }

      renderWidget(container, courseData);
    } catch (e) {
      console.error("Failed to load attention items:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading attention items: " + e.message]).outerHTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
