/**
 * D2L Faculty Dashboard - Ungraded Items Widget
 * Displays ungraded assignments, discussions, and quizzes with links to D2L course pages
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/FA";
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
    if (!res.ok) {
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      error.isExpected = (res.status === 403 || res.status === 404);
      throw error;
    }
    return await res.json();
  }

  // =========================
  // GET UNGRADED ASSIGNMENTS
  // =========================
  async function getUngradedAssignments(courses) {
    var items = [];
    var coursesToProcess = courses.slice(0, 20); // Limit for performance
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var courseName = coursesToProcess[i].OrgUnit.Name || "Unknown Course";
        var courseCode = coursesToProcess[i].OrgUnit.Code || "";
        
        var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
        var dropboxData = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
        
        if (dropboxData && dropboxData.length) {
          for (var j = 0; j < dropboxData.length; j++) {
            try {
              var folder = dropboxData[j];
              var folderId = folder.Id;
              // Use /submissions/ endpoint which returns array of EntityDropbox objects (one per student)
              // Add activeOnly=true to filter out students no longer in the course
              var submissionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folderId + "/submissions/?activeOnly=true";
              var entityDropboxList = await BrightspaceFetch(submissionsEndpoint).catch(function() { return null; });
              
              if (entityDropboxList && entityDropboxList.length) {
                // Each item in the array is an EntityDropbox object with Status, Feedback, and Submissions
                for (var k = 0; k < entityDropboxList.length; k++) {
                  var entity = entityDropboxList[k];
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
                    // Get entity ID from Entity object
                    var entityId = entity.Entity ? entity.Entity.EntityId : null;
                    items.push({
                      type: "assignment",
                      courseId: orgUnitId,
                      courseName: courseName,
                      courseCode: courseCode,
                      itemId: folderId,
                      itemName: folder.Name || "Untitled Assignment",
                      submissionId: entityId,
                      link: "/d2l/lms/dropbox/dropbox.d2l?ou=" + orgUnitId + "&db=" + folderId
                    });
                  }
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
    }
    
    return items;
  }

  // =========================
  // GET UNREAD DISCUSSIONS
  // =========================
  async function getUnreadDiscussions(courses) {
    var items = [];
    var coursesToProcess = courses.slice(0, 20); // Limit for performance
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var courseName = coursesToProcess[i].OrgUnit.Name || "Unknown Course";
        var courseCode = coursesToProcess[i].OrgUnit.Code || "";
        
        var forumEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
        var forumData = await BrightspaceFetch(forumEndpoint).catch(function() { return null; });
        
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
          for (var j = 0; j < forums.length; j++) {
            var forum = forums[j];
            var forumId = forum.ForumId;
            try {
              var topicEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/";
              var topicData = await BrightspaceFetch(topicEndpoint).catch(function() { return null; });
              
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
                for (var k = 0; k < topics.length; k++) {
                  var topic = topics[k];
                  var topicId = topic.TopicId;
                  try {
                    // Use threadsOnly=true to get only initial posts (submissions) not replies
                    var postEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/?threadsOnly=true";
                    var postData = await BrightspaceFetch(postEndpoint).catch(function() { return null; });
                    
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
                      var hasUnread = false;
                      for (var l = 0; l < posts.length; l++) {
                        if (!posts[l].IsRead) {
                          hasUnread = true;
                          break;
                        }
                      }
                      
                      if (hasUnread) {
                        items.push({
                          type: "discussion",
                          courseId: orgUnitId,
                          courseName: courseName,
                          courseCode: courseCode,
                          itemId: topicId,
                          itemName: topic.TopicTitle || topic.Name || "Untitled Discussion",
                          link: "/d2l/le/discussions/forums/" + forumId + "/topics/" + topicId + "/view?ou=" + orgUnitId
                        });
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
          }
        }
      } catch (e) {
        // Continue
      }
    }
    
    return items;
  }

  // =========================
  // GET UNGRADED QUIZZES
  // =========================
  async function getUngradedQuizzes(courses) {
    var items = [];
    var coursesToProcess = courses.slice(0, 20); // Limit for performance
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var courseName = coursesToProcess[i].OrgUnit.Name || "Unknown Course";
        var courseCode = coursesToProcess[i].OrgUnit.Code || "";
        
        var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
        var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
        
        if (quizData && quizData.Objects && quizData.Objects.length) {
          for (var j = 0; j < quizData.Objects.length; j++) {
            var quiz = quizData.Objects[j];
            var quizId = quiz.QuizId;
            try {
              var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/attempts/";
              var attemptsData = await BrightspaceFetch(attemptsEndpoint).catch(function(err) {
                if (err && err.isExpected) {
                  return null;
                }
                return null;
              });
              
              if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
                var hasUngraded = false;
                for (var k = 0; k < attemptsData.Objects.length; k++) {
                  if (attemptsData.Objects[k].IsGraded === false || attemptsData.Objects[k].IsRetake === true) {
                    hasUngraded = true;
                    break;
                  }
                }
                
                if (hasUngraded) {
                  items.push({
                    type: "quiz",
                    courseId: orgUnitId,
                    courseName: courseName,
                    courseCode: courseCode,
                    itemId: quizId,
                    itemName: quiz.Name || "Untitled Quiz",
                    link: "/d2l/lms/quizzing/user/quiz_summary.d2l?ou=" + orgUnitId + "&qi=" + quizId
                  });
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
        if (typeof children[i] === "string" || typeof children[i] === "number") {
          node.appendChild(document.createTextNode(String(children[i])));
        } else if (children[i] instanceof Node) {
          node.appendChild(children[i]);
        }
      }
    }
    return node;
  }

  // =========================
  // RENDER UNGRADED ITEM
  // =========================
  function renderUngradedItem(item) {
    var itemDiv = el("div", {
      className: "ungraded-item"
    }, []);

    var badgeClass = "badge-" + item.type;
    var badgeText = item.type.charAt(0).toUpperCase() + item.type.slice(1);

    var header = el("div", {
      className: "ungraded-item-header"
    }, [
      el("div", {}, [
        el("div", {
          className: "ungraded-item-title"
        }, [
          el("span", {
            className: "item-type-badge " + badgeClass
          }, [badgeText]),
          item.itemName
        ]),
        el("div", {
          className: "ungraded-item-meta"
        }, [item.courseName + (item.courseCode ? " (" + item.courseCode + ")" : "")])
      ]),
      el("a", {
        href: item.link,
        target: "_blank",
        className: "d2l-link"
      }, ["Grade in D2L"])
    ]);

    itemDiv.appendChild(header);
    return itemDiv;
  }

  // =========================
  // GET URL PARAMETER
  // =========================
  function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
  }

  // =========================
  // RENDER WIDGET
  // =========================
  function renderWidget(container, items) {
    container.innerHTML = "";

    // Check for type filter in URL
    var typeFilter = getUrlParameter('type');
    var filteredItems = items;
    var filterLabel = "";

    if (typeFilter) {
      filteredItems = items.filter(function(item) { return item.type === typeFilter; });
      filterLabel = typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1) + "s";
    }

    var header = el("div", {
      style: {
        marginBottom: "20px",
        paddingBottom: "16px",
        borderBottom: "2px solid #e5e7eb"
      }
    }, [
      el("div", {
        style: { fontSize: "18px", fontWeight: "700", color: "#111", marginBottom: "8px" }
      }, [
        typeFilter ? filterLabel + " (" + filteredItems.length + ")" : "Ungraded Items (" + filteredItems.length + ")"
      ]),
      el("div", {
        style: { fontSize: "14px", color: "#666" }
      }, ["Click 'Grade in D2L' to open the item in Brightspace"])
    ]);
    container.appendChild(header);

    if (filteredItems.length === 0) {
      var message = typeFilter 
        ? "No " + typeFilter + " items found. Great job!" 
        : "No ungraded items found. Great job!";
      container.appendChild(el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, [message]));
      return;
    }

    // If type filter is specified, only show that type
    if (typeFilter) {
      for (var i = 0; i < filteredItems.length; i++) {
        container.appendChild(renderUngradedItem(filteredItems[i]));
      }
      return;
    }

    // Group by type (only if no filter)
    var assignments = items.filter(function(item) { return item.type === "assignment"; });
    var discussions = items.filter(function(item) { return item.type === "discussion"; });
    var quizzes = items.filter(function(item) { return item.type === "quiz"; });

    if (assignments.length > 0) {
      var section = el("div", {
        style: { marginBottom: "24px" }
      }, [
        el("h3", {
          style: { fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "12px" }
        }, ["Assignments (" + assignments.length + ")"])
      ]);
      
      for (var i = 0; i < assignments.length; i++) {
        section.appendChild(renderUngradedItem(assignments[i]));
      }
      container.appendChild(section);
    }

    if (discussions.length > 0) {
      var section = el("div", {
        style: { marginBottom: "24px" }
      }, [
        el("h3", {
          style: { fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "12px" }
        }, ["Discussions (" + discussions.length + ")"])
      ]);
      
      for (var i = 0; i < discussions.length; i++) {
        section.appendChild(renderUngradedItem(discussions[i]));
      }
      container.appendChild(section);
    }

    if (quizzes.length > 0) {
      var section = el("div", {
        style: { marginBottom: "24px" }
      }, [
        el("h3", {
          style: { fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "12px" }
        }, ["Quizzes (" + quizzes.length + ")"])
      ]);
      
      for (var i = 0; i < quizzes.length; i++) {
        section.appendChild(renderUngradedItem(quizzes[i]));
      }
      container.appendChild(section);
    }
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var container = document.getElementById("ungraded-widget");
    if (!container) {
      console.warn("Ungraded widget container not found");
      return;
    }

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading ungraded items..."]).outerHTML;

    try {
      var AC = activeSemesterCode();
      // Get courses from localStorage or fetch them
      var coursesData = localStorage.getItem("dashboardCourses");
      var courses = [];
      
      if (coursesData) {
        courses = JSON.parse(coursesData).filter(function(c) {
          var code = (c.OrgUnit && c.OrgUnit.Code) ? c.OrgUnit.Code : "";
          return code.indexOf(AC) >= 0;
        });
      }
      
      if (courses.length === 0) {
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
                if (code.indexOf(AC) >= 0) {
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
        courses = allItems;
      }

      if (courses.length === 0) {
        container.innerHTML = el("div", {
          style: { padding: "20px", textAlign: "center", color: "#666" }
        }, ["No courses found"]).outerHTML;
        return;
      }

      // Fetch ungraded items in parallel
      container.innerHTML = el("div", {
        style: { padding: "20px", textAlign: "center", color: "#555" }
      }, ["Scanning courses for ungraded items..."]).outerHTML;

      var results = await Promise.allSettled([
        getUngradedAssignments(courses),
        getUnreadDiscussions(courses),
        getUngradedQuizzes(courses)
      ]);

      var allItems = [];
      
      if (results[0].status === "fulfilled") {
        allItems = allItems.concat(results[0].value);
      }
      if (results[1].status === "fulfilled") {
        allItems = allItems.concat(results[1].value);
      }
      if (results[2].status === "fulfilled") {
        allItems = allItems.concat(results[2].value);
      }

      renderWidget(container, allItems);

    } catch (e) {
      console.error("Failed to load ungraded items:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading ungraded items: " + (e.message || String(e))]).outerHTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener("fd-semester-viewing-change", function () {
    init();
  });

})();
