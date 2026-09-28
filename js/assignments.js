/**
 * D2L Faculty Dashboard - Assignments Analytics
 * Displays detailed breakdown of assignments with submissions
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
  // GET URL PARAMETER
  // =========================
  function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
  }

  // =========================
  // FORMAT DATE
  // =========================
  function formatDate(dateString) {
    if (!dateString) return "No date";
    try {
      var date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  }

  // =========================
  // CALCULATE DAYS AGO
  // =========================
  function daysAgo(dateString) {
    if (!dateString) return null;
    try {
      var date = new Date(dateString);
      if (isNaN(date.getTime())) return null;
      var now = new Date();
      var diffTime = Math.abs(now - date);
      var diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch (e) {
      return null;
    }
  }

  // =========================
  // CHECK IF COURSE IS MERGED OR CANCELLED (should be excluded from analytics)
  // =========================
  function isMergedOrCancelledCourse(course) {
    if (!course || !course.OrgUnit) return false;
    var code = (course.OrgUnit.Code || "").toUpperCase();
    var name = (course.OrgUnit.Name || "").toUpperCase();
    // Check if course code or name contains MERGED or CXLD
    return code.indexOf("MERGED") >= 0 || code.indexOf("CXLD") >= 0 ||
           name.indexOf("MERGED") >= 0 || name.indexOf("CXLD") >= 0;
  }

  // =========================
  // GET ASSIGNMENTS WITH DETAILS
  // =========================
  async function getAssignmentsWithDetails(courses) {
    var items = [];
    // Filter out MERGED and CXLD courses before processing
    var filteredCourses = courses.filter(function(c) {
      return !isMergedOrCancelledCourse(c);
    });
    var coursesToProcess = filteredCourses.slice(0, 20);
    
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
              
              var totalSubmissions = entityDropboxList ? entityDropboxList.length : 0;
              var ungradedCount = 0;
              var oldestDate = null;
              
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
                    ungradedCount++;
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
                    if (subDate && (!oldestDate || new Date(subDate) < new Date(oldestDate))) {
                      oldestDate = subDate;
                    }
                  }
                }
              }
              
              items.push({
                type: "assignment",
                courseId: orgUnitId,
                courseName: courseName,
                courseCode: courseCode,
                itemId: folderId,
                itemName: folder.Name || "Untitled Assignment",
                totalCount: totalSubmissions,
                ungradedCount: ungradedCount,
                oldestDate: oldestDate,
                link: "/d2l/lms/dropbox/dropbox.d2l?ou=" + orgUnitId + "&db=" + folderId
              });
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
  // RENDER ITEM
  // =========================
  function renderItem(item) {
    var itemDiv = el("div", {
      className: "analytics-item",
      style: {
        padding: "16px",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        background: "#fff"
      }
    }, []);

    var badgeClass = "badge-assignment";
    var badgeText = "ASSIGNMENT";
    var days = daysAgo(item.oldestDate);
    var dateDisplay = item.oldestDate ? formatDate(item.oldestDate) : "No date";
    var urgencyClass = days !== null && days > 7 ? "urgent" : days !== null && days > 3 ? "warning" : "";

    var header = el("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }
    }, [
      el("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px"
        }
      }, [
        el("div", {
          style: { flex: 1 }
        }, [
          el("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px"
            }
          }, [
            el("span", {
              className: "item-type-badge " + badgeClass,
              style: {
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: "600",
                textTransform: "uppercase"
              }
            }, [badgeText]),
            el("span", {
              style: {
                fontSize: "16px",
                fontWeight: "600",
                color: "#111"
              }
            }, [item.itemName])
          ]),
          el("div", {
            style: {
              fontSize: "14px",
              color: "#666",
              marginBottom: "8px"
            }
          }, [item.courseName + (item.courseCode ? " (" + item.courseCode + ")" : "")])
        ]),
        el("a", {
          href: item.link,
          target: "_blank",
          className: "d2l-link",
          style: {
            padding: "8px 16px",
            background: "#0f5b46",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "600",
            whiteSpace: "nowrap",
            alignSelf: "flex-start"
          }
        }, ["Open in D2L"])
      ]),
      el("div", {
        style: {
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          fontSize: "13px",
          color: "#666",
          paddingTop: "8px",
          borderTop: "1px solid #e5e7eb"
        }
      }, [
        el("span", {}, ["Total: " + item.totalCount]),
        el("span", {
          style: {
            color: item.ungradedCount > 0 ? "#c00" : "#0f5b46",
            fontWeight: item.ungradedCount > 0 ? "600" : "400"
          }
        }, ["Needs attention: " + item.ungradedCount]),
        item.oldestDate ? el("span", {
          className: urgencyClass,
          style: {
            color: days !== null && days > 7 ? "#c00" : days !== null && days > 3 ? "#f80" : "#666",
            fontWeight: days !== null && days > 3 ? "600" : "400"
          }
        }, ["Oldest: " + dateDisplay + (days !== null ? " (" + days + " days ago)" : "")]) : null
      ])
    ]);

    itemDiv.appendChild(header);
    return itemDiv;
  }

  // =========================
  // RENDER WIDGET
  // =========================
  function renderWidget(container, items, courseName) {
    container.innerHTML = "";

    var totalCount = items.length;
    var totalUngraded = 0;
    var totalItems = 0;
    
    for (var i = 0; i < items.length; i++) {
      totalUngraded += items[i].ungradedCount || 0;
      totalItems += items[i].totalCount || 0;
    }

    // Sort by oldest date (most urgent first)
    items.sort(function(a, b) {
      if (!a.oldestDate && !b.oldestDate) return 0;
      if (!a.oldestDate) return 1;
      if (!b.oldestDate) return -1;
      return new Date(a.oldestDate) - new Date(b.oldestDate);
    });

    var header = el("div", {
      style: {
        marginBottom: "24px",
        paddingBottom: "16px",
        borderBottom: "2px solid #e5e7eb"
      }
    }, [
      el("div", {
        style: { fontSize: "20px", fontWeight: "700", color: "#111", marginBottom: "8px" }
      }, ["Assignments - " + (courseName || "All Courses")]),
      el("div", {
        style: { fontSize: "14px", color: "#666", marginBottom: "12px" }
      }, [
        "Total assignments: " + totalCount + " | " +
        "Total submissions: " + totalItems + " | " +
        "Needs attention: " + totalUngraded
      ]),
      el("div", {
        style: { fontSize: "12px", color: "#888", fontStyle: "italic" }
      }, ["Assignments are sorted by oldest submission date. Click 'Open in D2L' to grade or provide feedback."])
    ]);
    container.appendChild(header);

    if (items.length === 0) {
      container.appendChild(el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, ["No assignments found."]));
      return;
    }

    // Filter to only show items that need attention
    var itemsNeedingAttention = items.filter(function(item) {
      return item.ungradedCount > 0;
    });

    if (itemsNeedingAttention.length > 0) {
      var section = el("div", {
        style: { marginBottom: "32px" }
      }, [
        el("h3", {
          style: { fontSize: "18px", fontWeight: "700", color: "#111", marginBottom: "20px" }
        }, ["Assignments Needing Attention (" + itemsNeedingAttention.length + ")"])
      ]);
      
      var attentionGrid = el("div", {
        className: "items-grid"
      }, []);
      
      for (var i = 0; i < itemsNeedingAttention.length; i++) {
        attentionGrid.appendChild(renderItem(itemsNeedingAttention[i]));
      }
      
      section.appendChild(attentionGrid);
      container.appendChild(section);
    }

    // Show all items in expandable section
    var allSection = el("div", {
      style: { marginTop: "24px" }
    }, [
      el("h3", {
        style: { fontSize: "18px", fontWeight: "700", color: "#111", marginBottom: "20px" }
      }, ["All Assignments (" + items.length + ")"]),
      el("div", {
        id: "all-items-container",
        className: "items-grid",
        style: { display: itemsNeedingAttention.length > 0 ? "none" : "grid" }
      }, [])
    ]);

    var allContainer = allSection.querySelector("#all-items-container");
    for (var i = 0; i < items.length; i++) {
      allContainer.appendChild(renderItem(items[i]));
    }

    var toggleButton = el("button", {
      style: {
        padding: "10px 20px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "600",
        color: "#0f5b46",
        marginBottom: "20px"
      },
      onclick: function() {
        var isExpanded = allContainer.style.display !== "none";
        allContainer.style.display = isExpanded ? "none" : "grid";
        toggleButton.textContent = isExpanded ? "Show All Assignments" : "Hide All Assignments";
      }
    }, [itemsNeedingAttention.length > 0 ? "Show All Assignments" : "Hide All Assignments"]);

    if (itemsNeedingAttention.length > 0) {
      allSection.insertBefore(toggleButton, allSection.firstChild.nextSibling);
    }
    container.appendChild(allSection);
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var container = document.getElementById("assignments-widget");
    if (!container) {
      console.warn("Assignments widget container not found");
      return;
    }

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading assignments data..."]).outerHTML;

    try {
      var courseId = getUrlParameter('courseId') || "all";
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

      // Filter out MERGED and CXLD courses
      courses = courses.filter(function(c) {
        return !isMergedOrCancelledCourse(c);
      });
      
      // Filter by course if specified
      if (courseId !== "all") {
        courses = courses.filter(function(c) {
          return c.OrgUnit.Id.toString() === courseId.toString();
        });
      }

      var courseName = courses.length > 0 && courseId !== "all" 
        ? (courses[0].OrgUnit.Name || "Selected Course")
        : "All Courses";

      if (courses.length === 0) {
        container.innerHTML = el("div", {
          style: { padding: "20px", textAlign: "center", color: "#666" }
        }, ["No courses found"]).outerHTML;
        return;
      }

      // Fetch assignments
      container.innerHTML = el("div", {
        style: { padding: "20px", textAlign: "center", color: "#555" }
      }, ["Scanning courses for assignments..."]).outerHTML;

      var items = await getAssignmentsWithDetails(courses);

      renderWidget(container, items, courseName);

    } catch (e) {
      console.error("Failed to load assignments data:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading assignments data: " + (e.message || String(e))]).outerHTML;
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
