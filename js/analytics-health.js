/**
 * D2L Faculty Dashboard - Course Health Analytics
 * Displays course health metrics like logins, interactions, bad links, etc.
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/SP";
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
  // GET COURSE HEALTH DATA
  // =========================
  async function getCourseHealthData(courses) {
    // Placeholder for course health data
    // This would need to be implemented with actual D2L API calls
    // For now, return mock data structure
    
    var healthData = [];
    
    for (var i = 0; i < courses.length; i++) {
      var course = courses[i];
      var orgUnitId = course.OrgUnit.Id;
      var courseName = course.OrgUnit.Name || "Unknown Course";
      var courseCode = course.OrgUnit.Code || "";
      
      // TODO: Implement actual API calls for:
      // - Student logins (last 7 days, last 30 days)
      // - Course interactions (views, submissions, etc.)
      // - Broken/bad links detection
      // - Content access patterns
      
      // Placeholder data structure
      healthData.push({
        courseId: orgUnitId,
        courseName: courseName,
        courseCode: courseCode,
        loginsLast7Days: 0, // TODO: Get from API
        loginsLast30Days: 0, // TODO: Get from API
        totalInteractions: 0, // TODO: Get from API
        badLinks: 0, // TODO: Get from API
        averageLoginFrequency: 0, // TODO: Calculate
        lastStudentActivity: null, // TODO: Get from API
        contentViews: 0, // TODO: Get from API
        submissionActivity: 0 // TODO: Get from API
      });
    }
    
    return healthData;
  }

  // =========================
  // RENDER HEALTH METRICS OVERVIEW
  // =========================
  function renderHealthMetricsOverview(container, healthData) {
    container.innerHTML = "";
    
    var totalLogins7Days = 0;
    var totalLogins30Days = 0;
    var totalInteractions = 0;
    var totalBadLinks = 0;
    var coursesWithActivity = 0;
    
    for (var i = 0; i < healthData.length; i++) {
      var data = healthData[i];
      totalLogins7Days += data.loginsLast7Days || 0;
      totalLogins30Days += data.loginsLast30Days || 0;
      totalInteractions += data.totalInteractions || 0;
      totalBadLinks += data.badLinks || 0;
      if (data.loginsLast7Days > 0) coursesWithActivity++;
    }
    
    var grid = el("div", {
      className: "health-metrics-grid"
    }, [
      el("div", {
        className: "health-metric-card"
      }, [
        el("div", {
          className: "health-metric-title"
        }, ["Total Logins (7 Days)"]),
        el("div", {
          className: "health-metric-value"
        }, [totalLogins7Days.toLocaleString()]),
        el("div", {
          className: "health-metric-description"
        }, [coursesWithActivity + " courses with activity"])
      ]),
      el("div", {
        className: "health-metric-card"
      }, [
        el("div", {
          className: "health-metric-title"
        }, ["Total Logins (30 Days)"]),
        el("div", {
          className: "health-metric-value"
        }, [totalLogins30Days.toLocaleString()]),
        el("div", {
          className: "health-metric-description"
        }, ["Across all courses"])
      ]),
      el("div", {
        className: "health-metric-card"
      }, [
        el("div", {
          className: "health-metric-title"
        }, ["Total Interactions"]),
        el("div", {
          className: "health-metric-value"
        }, [totalInteractions.toLocaleString()]),
        el("div", {
          className: "health-metric-description"
        }, ["Views, submissions, etc."])
      ]),
      el("div", {
        className: "health-metric-card"
      }, [
        el("div", {
          className: "health-metric-title"
        }, ["Issues Found"]),
        el("div", {
          className: "health-metric-value " + (totalBadLinks > 0 ? "health-metric-error" : "")
        }, [totalBadLinks]),
        el("div", {
          className: "health-metric-description"
        }, [totalBadLinks > 0 ? "Bad links need attention" : "No issues detected"])
      ])
    ]);
    
    container.appendChild(grid);
  }

  // =========================
  // RENDER COURSE HEALTH DETAILS
  // =========================
  function renderCourseHealthDetails(container, healthData) {
    container.innerHTML = "";
    
    if (healthData.length === 0) {
      container.appendChild(el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, ["No course health data available."]));
      return;
    }
    
    for (var i = 0; i < healthData.length; i++) {
      var data = healthData[i];
      
      var card = el("div", {
        className: "course-health-card"
      }, [
        el("div", {
          className: "course-health-header"
        }, [
          el("div", {}, [
            el("div", {
              className: "course-name"
            }, [data.courseName]),
            el("div", {
              className: "course-code"
            }, [data.courseCode || "No course code"])
          ])
        ]),
        el("div", {
          className: "health-details"
        }, [
          el("div", {
            className: "health-detail-item"
          }, [
            el("div", {
              className: "health-detail-label"
            }, ["Logins (7 days)"]),
            el("div", {
              className: "health-detail-value"
            }, [data.loginsLast7Days || 0])
          ]),
          el("div", {
            className: "health-detail-item"
          }, [
            el("div", {
              className: "health-detail-label"
            }, ["Logins (30 days)"]),
            el("div", {
              className: "health-detail-value"
            }, [data.loginsLast30Days || 0])
          ]),
          el("div", {
            className: "health-detail-item"
          }, [
            el("div", {
              className: "health-detail-label"
            }, ["Total Interactions"]),
            el("div", {
              className: "health-detail-value"
            }, [data.totalInteractions || 0])
          ]),
          el("div", {
            className: "health-detail-item"
          }, [
            el("div", {
              className: "health-detail-label"
            }, ["Bad Links"]),
            el("div", {
              className: "health-detail-value " + (data.badLinks > 0 ? "health-metric-error" : "")
            }, [data.badLinks || 0])
          ])
        ])
      ]);
      
      container.appendChild(card);
    }
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    var overviewContainer = document.getElementById("health-metrics-overview");
    var detailsContainer = document.getElementById("course-health-details");
    
    if (!overviewContainer || !detailsContainer) {
      console.warn("Analytics health containers not found");
      return;
    }

    overviewContainer.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading course health data..."]).outerHTML;
    
    detailsContainer.innerHTML = "";

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
      } else {
        // Fallback: fetch courses if not in localStorage
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

      if (courses.length === 0) {
        overviewContainer.innerHTML = el("div", {
          style: { padding: "20px", textAlign: "center", color: "#666" }
        }, ["No courses found"]).outerHTML;
        return;
      }

      // Get course health data
      var healthData = await getCourseHealthData(courses);

      // Render the data
      renderHealthMetricsOverview(overviewContainer, healthData);
      renderCourseHealthDetails(detailsContainer, healthData);

    } catch (e) {
      console.error("Failed to load course health data:", e);
      overviewContainer.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading course health data: " + (e.message || String(e))]).outerHTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
