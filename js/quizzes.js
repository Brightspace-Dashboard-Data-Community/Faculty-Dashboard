/**
 * D2L Faculty Dashboard - Quizzes Analytics
 * Displays detailed breakdown of quizzes with attempts
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
  // GET QUIZZES WITH DETAILS
  // =========================
  async function getQuizzesWithDetails(courses) {
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
              
              var totalAttempts = attemptsData && attemptsData.Objects ? attemptsData.Objects.length : 0;
              var ungradedCount = 0;
              var oldestDate = null;
              
              if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
                for (var k = 0; k < attemptsData.Objects.length; k++) {
                  var attempt = attemptsData.Objects[k];
                  if (attempt.IsGraded === false || attempt.IsRetake === true) {
                    ungradedCount++;
                    var attemptDate = attempt.AttemptDate || attempt.DateCompleted;
                    if (attemptDate && (!oldestDate || new Date(attemptDate) < new Date(oldestDate))) {
                      oldestDate = attemptDate;
                    }
                  }
                }
              }
              
              items.push({
                type: "quiz",
                courseId: orgUnitId,
                courseName: courseName,
                courseCode: courseCode,
                itemId: quizId,
                itemName: quiz.Name || "Untitled Quiz",
                totalCount: totalAttempts,
                ungradedCount: ungradedCount,
                oldestDate: oldestDate,
                link: "/d2l/lms/quizzing/admin/quizzes_manage.d2l?ou=" + orgUnitId
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

    var badgeClass = "badge-quiz";
    var badgeText = "QUIZ";
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
        el("div", {
          style: {
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            alignSelf: "flex-start"
          }
        }, [
          el("a", {
            href: "quiz-detail.html?courseId=" + encodeURIComponent(item.courseId) + "&quizId=" + encodeURIComponent(item.itemId) + "&quizName=" + encodeURIComponent(item.itemName),
            className: "quiz-detail-link",
            style: {
              padding: "8px 14px",
              background: "#f9fafb",
              color: "#0f5b46",
              textDecoration: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "600",
              whiteSpace: "nowrap",
              border: "1px solid #0f5b46"
            }
          }, ["More in-depth data"]),
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
              whiteSpace: "nowrap"
            }
          }, ["Open in D2L"])
        ])
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
        el("span", {}, ["Total attempts: " + item.totalCount]),
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
      }, ["Quizzes - " + (courseName || "All Courses")]),
      el("div", {
        style: { fontSize: "14px", color: "#666", marginBottom: "12px" }
      }, [
        "Total quizzes: " + totalCount + " | " +
        "Total attempts: " + totalItems + " | " +
        "Needs attention: " + totalUngraded
      ]),
      el("div", {
        style: { fontSize: "12px", color: "#888", fontStyle: "italic" }
      }, ["Quizzes are sorted by oldest attempt date. Click 'Open in D2L' to grade."])
    ]);
    container.appendChild(header);

    if (items.length === 0) {
      container.appendChild(el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, ["No quizzes found."]));
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
        }, ["Quizzes Needing Attention (" + itemsNeedingAttention.length + ")"])
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
      }, ["All Quizzes (" + items.length + ")"]),
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
        toggleButton.textContent = isExpanded ? "Show All Quizzes" : "Hide All Quizzes";
      }
    }, [itemsNeedingAttention.length > 0 ? "Show All Quizzes" : "Hide All Quizzes"]);

    if (itemsNeedingAttention.length > 0) {
      allSection.insertBefore(toggleButton, allSection.firstChild.nextSibling);
    }
    container.appendChild(allSection);
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var container = document.getElementById("quizzes-widget");
    if (!container) {
      console.warn("Quizzes widget container not found");
      return;
    }

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading quizzes data..."]).outerHTML;

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

      // Fetch quizzes
      container.innerHTML = el("div", {
        style: { padding: "20px", textAlign: "center", color: "#555" }
      }, ["Scanning courses for quizzes..."]).outerHTML;

      var items = await getQuizzesWithDetails(courses);

      renderWidget(container, items, courseName);

    } catch (e) {
      console.error("Failed to load quizzes data:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading quizzes data: " + (e.message || String(e))]).outerHTML;
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
