/**
 * D2L Faculty Dashboard - Summary Metrics Widget
 * Displays key metrics in summary boxes
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.82";  // Updated to match D2L API documentation
  var API_VERSION_GRADES_BULK = "1.86";

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

  var SEMESTERS = semesterApi()
    ? semesterApi().getSemestersForSelect()
    : [
        { code: "26/FA", label: "Fall 2026 (26/FA)" },
        { code: "26/SP", label: "Spring 2026 (26/SP)" }
      ];

  // =========================
  // AUTH FETCH
  // =========================
  async function BrightspaceFetch(url, options) {
    // Only log discussion-related API calls to reduce noise
    var isDiscussionCall = url.indexOf("/discussions/") >= 0;
    if (isDiscussionCall) {
      console.log("[Summary Metrics] [API] Fetching:", url);
    }
    var token = localStorage.getItem("XSRF.Token");
    if (isDiscussionCall) {
      console.log("[Summary Metrics] [API] CSRF Token present?", !!token);
    }
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    if (isDiscussionCall) {
      console.log("[Summary Metrics] [API] Response status:", res.status, res.statusText);
      console.log("[Summary Metrics] [API] Response ok?", res.ok);
    }
    
    if (!res.ok) {
      var errorText = "";
      try {
        errorText = await res.text();
        if (isDiscussionCall) {
          console.error("[Summary Metrics] [API] Error response body:", errorText);
        }
      } catch (e) {
        if (isDiscussionCall) {
          console.error("[Summary Metrics] [API] Could not read error response body");
        }
      }
      // Create error object with status for better handling
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      // Mark 403/404 as expected (common for restricted resources)
      error.isExpected = (res.status === 403 || res.status === 404);
      if (isDiscussionCall) {
        console.error("[Summary Metrics] [API] Throwing error:", error.message, "Expected?", error.isExpected);
      }
      throw error;
    }
    
    var jsonData = await res.json();
    if (isDiscussionCall) {
      console.log("[Summary Metrics] [API] Response JSON received, type:", typeof jsonData);
      console.log("[Summary Metrics] [API] Response data:", jsonData);
    }
    return jsonData;
  }

  // =========================
  // GET USER INFO
  // =========================
  async function getUserInfo() {
    try {
      var data = await BrightspaceFetch("/d2l/api/lp/" + API_VERSION_LP + "/users/whoami");
      return {
        userId: data.UserId || data.UniqueName,
        firstName: data.FirstName || "",
        lastName: data.LastName || "",
        userName: data.UniqueName || ""
      };
    } catch (e) {
      return { userId: null, firstName: "Instructor", lastName: "", userName: "" };
    }
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
  // CHECK IF USER IS INSTRUCTOR (accepts multiple role IDs)
  // =========================
  function isInstructorRole(roleId) {
    // Accept multiple instructor role IDs
    var instructorRoleIds = {
      102: true,  // Instructor
      183: true,  // Secondary Instructor
      108: true,  // Teaching Assistant
      127: true,  // Mentor
      160: true,  // Ghost Instructor
      167: true,  // Instructor - Admin
      174: true   // Instructor - PERMISSION TEST
    };
    return instructorRoleIds[roleId] === true;
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
  // GET CURRENT SEMESTER COURSES (active term only — see js/semester-config.js)
  // =========================
  async function getCurrentSemesterCourses() {
    console.log(
      "[Summary Metrics] Starting getCurrentSemesterCourses() - Loading " + viewingSemesterCode() + " courses only"
    );
    var allItems = [];
    var allCourseItems = []; // Track all course items before filtering
    var bookmark = null;
    var hasMore = true;
    var pageCount = 0;

    while (hasMore) {
      pageCount++;
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";

      console.log("[Summary Metrics] Fetching enrollments page " + pageCount);
      var data = await BrightspaceFetch(endpoint);
      console.log("[Summary Metrics] Received " + (data && data.Items ? data.Items.length : 0) + " items on page " + pageCount);

      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) {
          var item = data.Items[i];
          // Only include Course Offerings (Type Id === 3)
          if (item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3) {
            var code = item.OrgUnit.Code || "";
            var sem = getSemesterCodeFromCourseCode(code);
            var roleId = getRoleId(item);
            
            // Log all courses found for debugging
            allCourseItems.push({
              name: item.OrgUnit.Name || "Unknown",
              code: code,
              semester: sem,
              roleId: roleId,
              access: item.Access || null
            });
            
            // Only include active-semester courses where user is Instructor (roleId === 102)
            // Exclude MERGED and CXLD courses from analytics
            if (sem === viewingSemesterCode() && roleId === 102 && !isMergedOrCancelledCourse(item)) {
              allItems.push(item);
              console.log("[Summary Metrics] Added course: " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - Semester: " + sem + " - RoleId: " + (roleId || "null"));
            } else {
              if (sem !== viewingSemesterCode()) {
                console.log("[Summary Metrics] Skipped course (wrong semester): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - Semester: " + (sem || "none"));
              } else if (roleId !== 102) {
                console.log("[Summary Metrics] Skipped course (not Instructor role): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ") - RoleId: " + (roleId || "null"));
              } else if (isMergedOrCancelledCourse(item)) {
                console.log("[Summary Metrics] Skipped course (MERGED or CXLD): " + (item.OrgUnit.Name || "Unknown") + " (" + code + ")");
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

    console.log("[Summary Metrics] Total " + viewingSemesterCode() + " Instructor courses found: " + allItems.length);
    if (allCourseItems.length > allItems.length) {
      console.log(
        "[Summary Metrics] Note: " +
          (allCourseItems.length - allItems.length) +
          " courses were filtered out (not " +
          viewingSemesterCode() +
          " semester or not Instructor role)"
      );
    }
    console.log("[Summary Metrics] All course items (before filtering):", allCourseItems);
    return allItems;
  }

  // =========================
  // COUNT COURSES BY SEMESTER
  // =========================
  function countCoursesBySemester(courses, semesterCode) {
    console.log("[Summary Metrics] countCoursesBySemester: " + courses.length + " courses, semester: " + semesterCode);
    
    // Filter to only courses where user has instructor role
    var filteredCourses = courses.filter(function(c) {
      var roleId = getRoleId(c);
      return isInstructorRole(roleId);
    });
    
    if (semesterCode === "all") {
      console.log("[Summary Metrics] Returning all courses count (instructor roles): " + filteredCourses.length);
      return filteredCourses.length;
    }
    
    var count = 0;
    for (var i = 0; i < filteredCourses.length; i++) {
      var code = filteredCourses[i].OrgUnit.Code || "";
      var sem = getSemesterCodeFromCourseCode(code);
      if (sem === semesterCode) {
        count++;
        console.log("[Summary Metrics] Matched course: " + (filteredCourses[i].OrgUnit.Name || "Unknown") + " (" + code + ")");
      }
    }
    console.log("[Summary Metrics] Count for " + semesterCode + " (instructor roles): " + count);
    return count;
  }

  // =========================
  // GET TOTAL STUDENTS (Using classlist/paged API)
  // ObjectListPage.Next is an API URL, not a bare bookmark token.
  // =========================
  function classlistNextUrl(orgUnitId, page, itemCount) {
    var next = page && page.Next ? String(page.Next) : "";
    if (!next || !itemCount) return null;
    if (next.indexOf("/d2l/api/") >= 0) {
      var parts = next.split("/d2l/api/");
      return parts.length > 1 ? "/d2l/api/" + parts[1] : null;
    }
    if (next.indexOf("/") === 0) return next;
    return "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
  }

  async function getClasslistPaged(orgUnitId) {
    console.log("[Summary Metrics] getClasslistPaged: Fetching classlist for course " + orgUnitId);
    var allStudents = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    var maxPages = 40;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      if (seenUrls[nextUrl]) {
        console.warn("[Summary Metrics] Classlist pagination loop detected for course " + orgUnitId);
        break;
      }
      seenUrls[nextUrl] = true;

      try {
        console.log("[Summary Metrics] Fetching classlist page " + pageCount + " for course " + orgUnitId + ":", nextUrl);
        var data = await BrightspaceFetch(nextUrl);
        var objects = (data && data.Objects) || [];
        console.log("[Summary Metrics] Received " + objects.length + " users on page " + pageCount + " for course " + orgUnitId);

        for (var i = 0; i < objects.length; i++) {
          allStudents.push(objects[i]);
        }

        nextUrl = classlistNextUrl(orgUnitId, data, objects.length);
        if (nextUrl) {
          console.log("[Summary Metrics] More pages available, continuing with:", nextUrl);
        }
      } catch (e) {
        console.error("[Summary Metrics] Error fetching classlist for course " + orgUnitId + ":", e);
        break;
      }
    }

    if (pageCount >= maxPages) {
      console.warn("[Summary Metrics] Reached max pages limit (" + maxPages + ") for course " + orgUnitId);
    }

    console.log("[Summary Metrics] Total users found for course " + orgUnitId + ": " + allStudents.length + " (from " + pageCount + " pages)");
    return allStudents;
  }

  async function getTotalStudents(courses) {
    console.log("[Summary Metrics] getTotalStudents: Starting with " + courses.length + " courses");
    var studentIds = new Set();
    
    // Filter courses to only include those where user has instructor role
    var coursesToProcess = [];
    for (var c = 0; c < courses.length; c++) {
      var roleId = getRoleId(courses[c]);
      
      // Debug: Log first few courses
      if (c < 3) {
        console.log("[Summary Metrics] getTotalStudents - Course " + c + ":", {
          name: courses[c].OrgUnit.Name,
          hasAccess: !!courses[c].Access,
          roleId: roleId,
          classlistRoleId: courses[c].Access ? courses[c].Access.ClasslistRoleId : "N/A"
        });
      }
      
      if (isInstructorRole(roleId)) {
        coursesToProcess.push(courses[c]);
      } else {
        if (c < 5) {
          console.log("[Summary Metrics] getTotalStudents - Skipping course (not instructor role):", courses[c].OrgUnit.Name, "- RoleId:", roleId);
        }
      }
    }
    
    // Limit to first 20 courses to speed up loading
    coursesToProcess = coursesToProcess.slice(0, 20);
    console.log("[Summary Metrics] Processing " + coursesToProcess.length + " courses for student count (filtered to instructor roles)");
    
    // Batch API calls in parallel (5 at a time)
    var batchSize = 5;
    var batchNum = 0;
    for (var i = 0; i < coursesToProcess.length; i += batchSize) {
      batchNum++;
      var batch = coursesToProcess.slice(i, i + batchSize);
      console.log("[Summary Metrics] Processing batch " + batchNum + " with " + batch.length + " courses");
      
      var promises = batch.map(function(course) {
        try {
          var orgUnitId = course.OrgUnit.Id;
          var courseName = course.OrgUnit.Name || "Unknown";
          console.log("[Summary Metrics] Adding promise for course " + orgUnitId + " (" + courseName + ")");
          return getClasslistPaged(orgUnitId).catch(function(err) {
            console.error("[Summary Metrics] Error in getClasslistPaged promise for " + orgUnitId + ":", err);
            return [];
          });
        } catch (e) {
          console.error("[Summary Metrics] Exception creating promise:", e);
          return Promise.resolve([]);
        }
      });
      
      console.log("[Summary Metrics] Waiting for batch " + batchNum + " to complete...");
      var results = await Promise.allSettled(promises);
      console.log("[Summary Metrics] Batch " + batchNum + " completed. Results:", results.length);
      
      for (var j = 0; j < results.length; j++) {
        if (results[j].status === "fulfilled" && results[j].value && results[j].value.length) {
          var students = results[j].value;
          console.log("[Summary Metrics] Processing " + students.length + " students from batch " + batchNum + ", result " + j);
          for (var k = 0; k < students.length; k++) {
            var student = students[k];
            // Count students - check ClasslistRoleDisplayName for "Student" or common student RoleIds
            var roleName = (student.ClasslistRoleDisplayName || "").toLowerCase();
            var isStudent = roleName.indexOf("student") >= 0 || 
                           student.RoleId === 3 || 
                           student.RoleId === 5 || 
                           student.RoleId === 101; // Common student role ID
            
            if (isStudent) {
              studentIds.add(student.Identifier);
            }
          }
        } else if (results[j].status === "rejected") {
          console.error("[Summary Metrics] Promise rejected in batch " + batchNum + ", result " + j + ":", results[j].reason);
        } else {
          console.log("[Summary Metrics] Result " + j + " in batch " + batchNum + " had no students or was empty");
        }
      }
      
      console.log("[Summary Metrics] After batch " + batchNum + ", unique student count: " + studentIds.size);
    }

    console.log("[Summary Metrics] getTotalStudents: Final count = " + studentIds.size);
    return studentIds.size;
  }

  // =========================
  // GET TOTAL ASSIGNMENTS COUNT
  // =========================
  async function getTotalAssignmentsCount(courses) {
    console.log("[Summary Metrics] getTotalAssignmentsCount: Starting with " + courses.length + " courses");
    var count = 0;
    var coursesToProcess = courses.slice(0, 20);
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
        var dropboxData = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
        
        if (dropboxData && dropboxData.length) {
          count += dropboxData.length;
        }
      } catch (e) {
        // Continue
      }
    }
    
    console.log("[Summary Metrics] getTotalAssignmentsCount: Final count = " + count);
    return count;
  }

  // =========================
  // GET TOTAL DISCUSSION TOPICS COUNT
  // =========================
  async function getTotalDiscussionTopicsCount(courses) {
    console.log("[Summary Metrics] getTotalDiscussionTopicsCount: Starting with " + courses.length + " courses");
    var count = 0;
    var coursesToProcess = courses.slice(0, 20);
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        
        // Note: Topic count doesn't need classlist filtering since we're just counting topics, not posts
        // But we could add it if needed for consistency
        
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
            var forumId = forums[j].ForumId;
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
                count += topics.length;
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
    
    console.log("[Summary Metrics] getTotalDiscussionTopicsCount: Final count = " + count);
    return count;
  }

  // =========================
  // GET TOTAL QUIZZES COUNT
  // =========================
  async function getTotalQuizzesCount(courses) {
    console.log("[Summary Metrics] getTotalQuizzesCount: Starting with " + courses.length + " courses");
    var count = 0;
    var coursesToProcess = courses.slice(0, 20);
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
        var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
        
        if (quizData && quizData.Objects && quizData.Objects.length) {
          count += quizData.Objects.length;
        }
      } catch (e) {
        // Continue
      }
    }
    
    console.log("[Summary Metrics] getTotalQuizzesCount: Final count = " + count);
    return count;
  }

  // =========================
  // GET UNGRADED ASSIGNMENTS COUNT (Optimized - limit courses and folders)
  // =========================
  async function getUngradedAssignmentsCount(courses) {
    console.log("[Summary Metrics] getUngradedAssignmentsCount: Starting with " + courses.length + " courses");
    var count = 0;
    // Limit to first 10 courses for speed
    var coursesToProcess = courses.slice(0, 10);
    console.log("[Summary Metrics] Processing " + coursesToProcess.length + " courses for ungraded assignments");
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var dropboxEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/";
        var dropboxData = await BrightspaceFetch(dropboxEndpoint).catch(function() { return null; });
        
        if (dropboxData && dropboxData.length) {
          // Limit to first 5 folders per course
          var foldersToCheck = dropboxData.slice(0, 5);
          for (var j = 0; j < foldersToCheck.length; j++) {
            try {
              var folderId = foldersToCheck[j].Id;
              // Use /submissions/ endpoint which returns array of EntityDropbox objects (one per student)
              // Add activeOnly=true to filter out students no longer in the course
              var submissionsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/dropbox/folders/" + folderId + "/submissions/?activeOnly=true";
              var entityDropboxList = await BrightspaceFetch(submissionsEndpoint).catch(function() { return null; });
              
              if (entityDropboxList && entityDropboxList.length) {
                // Each item in the array is an EntityDropbox object with Status, Feedback, and Submissions
                // Limit to first 20 for performance (per folder)
                var maxToCheck = Math.min(20, entityDropboxList.length);
                for (var k = 0; k < maxToCheck; k++) {
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
                    count++;
                  }
                }
                
                // For any remaining submissions beyond the limit, count them as needing attention
                // (conservative approach - assume they need attention if we can't check)
                if (entityDropboxList.length > maxToCheck) {
                  count += (entityDropboxList.length - maxToCheck);
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
    
    console.log("[Summary Metrics] getUngradedAssignmentsCount: Final count = " + count);
    return count;
  }

  // =========================
  // GET ACTIVE STUDENT SET FOR COURSE (cache per course)
  // =========================
  var activeStudentsCache = {};
  async function getActiveStudentsSet(orgUnitId) {
    if (activeStudentsCache[orgUnitId]) {
      console.log("[Summary Metrics] Using cached active students for course", orgUnitId);
      return activeStudentsCache[orgUnitId];
    }
    
    try {
      console.log("[Summary Metrics] Fetching active students for course", orgUnitId);
      var classlist = await getClasslistPaged(orgUnitId);
      var studentSet = new Set();
      
      if (classlist && classlist.length) {
        for (var i = 0; i < classlist.length; i++) {
          var student = classlist[i];
          if (student.Identifier) {
            studentSet.add(student.Identifier.toString());
          }
        }
      }
      
      activeStudentsCache[orgUnitId] = studentSet;
      console.log("[Summary Metrics] Cached", studentSet.size, "active students for course", orgUnitId);
      return studentSet;
    } catch (e) {
      console.error("[Summary Metrics] Exception getting active students:", e.message || e);
      return new Set(); // Return empty set on error
    }
  }

  // =========================
  // GET UNREAD DISCUSSIONS COUNT (Optimized - limit courses, forums, topics)
  // =========================
  async function getUnreadDiscussionsCount(courses) {
    console.log("[Summary Metrics] ===== getUnreadDiscussionsCount START =====");
    console.log("[Summary Metrics] Starting with " + courses.length + " courses");
    var count = 0;
    // Limit to first 10 courses for speed
    var coursesToProcess = courses.slice(0, 10);
    console.log("[Summary Metrics] Processing " + coursesToProcess.length + " courses for unread discussions");
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var courseName = coursesToProcess[i].OrgUnit.Name || "Unknown";
        var courseCode = coursesToProcess[i].OrgUnit.Code || "";
        console.log("[Summary Metrics] [" + (i + 1) + "/" + coursesToProcess.length + "] Course:", courseName, "(" + courseCode + "), OrgUnitId:", orgUnitId);
        
        // Get active students for this course (to filter out withdrawn students)
        var activeStudents = await getActiveStudentsSet(orgUnitId);
        console.log("[Summary Metrics]   → Found", activeStudents.size, "active students in classlist");
        
        var forumEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
        console.log("[Summary Metrics]   → Fetching forums from:", forumEndpoint);
        var forumData = await BrightspaceFetch(forumEndpoint).catch(function(err) {
          console.error("[Summary Metrics]   ✗ Error fetching forums:", err.message || err, err.status || "unknown status");
          return null;
        });
        
        if (!forumData) {
          console.log("[Summary Metrics]   → No forum data returned (null or error)");
        } else {
          console.log("[Summary Metrics]   → Forum response received");
          console.log("[Summary Metrics]   → Is array?", Array.isArray(forumData));
          console.log("[Summary Metrics]   → Has Objects property?", "Objects" in forumData);
          if (Array.isArray(forumData)) {
            console.log("[Summary Metrics]   → Direct array length:", forumData.length);
          } else if (forumData.Objects) {
            console.log("[Summary Metrics]   → Objects is array?", Array.isArray(forumData.Objects));
            console.log("[Summary Metrics]   → Objects length:", forumData.Objects.length);
          }
        }
        
        // Handle both response formats: direct array or Objects array
        var forums = null;
        if (forumData) {
          if (Array.isArray(forumData)) {
            forums = forumData;
            console.log("[Summary Metrics]   → Using forumData as direct array, length:", forums.length);
          } else if (forumData.Objects && Array.isArray(forumData.Objects)) {
            forums = forumData.Objects;
            console.log("[Summary Metrics]   → Using forumData.Objects array, length:", forums.length);
          }
        }
        
        if (forums && forums.length) {
          // Limit to first 3 forums per course
          var forumsToCheck = forums.slice(0, 3);
          console.log("[Summary Metrics]   → Checking first", forumsToCheck.length, "forums (out of", forums.length, ")");
          for (var j = 0; j < forumsToCheck.length; j++) {
            var forumId = forumsToCheck[j].ForumId;
            console.log("[Summary Metrics]     [" + (j + 1) + "/" + forumsToCheck.length + "] Forum ID:", forumId);
            try {
              var topicEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/";
              console.log("[Summary Metrics]       → Fetching topics from:", topicEndpoint);
              var topicData = await BrightspaceFetch(topicEndpoint).catch(function(err) {
                console.error("[Summary Metrics]       ✗ Error fetching topics:", err.message || err, err.status || "unknown status");
                return null;
              });
              
              if (!topicData) {
                console.log("[Summary Metrics]       → No topic data returned (null or error)");
              } else {
                console.log("[Summary Metrics]       → Topic response received");
                console.log("[Summary Metrics]       → Is array?", Array.isArray(topicData));
                console.log("[Summary Metrics]       → Has Objects property?", "Objects" in topicData);
                if (Array.isArray(topicData)) {
                  console.log("[Summary Metrics]       → Direct array length:", topicData.length);
                } else if (topicData.Objects) {
                  console.log("[Summary Metrics]       → Objects is array?", Array.isArray(topicData.Objects));
                  console.log("[Summary Metrics]       → Objects length:", topicData.Objects.length);
                }
              }
              
              // Handle both response formats: direct array or Objects array
              var topics = null;
              if (topicData) {
                if (Array.isArray(topicData)) {
                  topics = topicData;
                  console.log("[Summary Metrics]       → Using topicData as direct array, length:", topics.length);
                } else if (topicData.Objects && Array.isArray(topicData.Objects)) {
                  topics = topicData.Objects;
                  console.log("[Summary Metrics]       → Using topicData.Objects array, length:", topics.length);
                }
              }
              
              if (topics && topics.length) {
                // Limit to first 3 topics per forum
                var topicsToCheck = topics.slice(0, 3);
                console.log("[Summary Metrics]       → Checking first", topicsToCheck.length, "topics (out of", topics.length, ")");
                for (var k = 0; k < topicsToCheck.length; k++) {
                  var topicId = topicsToCheck[k].TopicId;
                  var topicName = topicsToCheck[k].TopicTitle || topicsToCheck[k].Name || "Untitled";
                  console.log("[Summary Metrics]         [" + (k + 1) + "/" + topicsToCheck.length + "] Topic ID:", topicId, "Name:", topicName);
                  try {
                    // Use threadsOnly=true to get only initial posts (submissions) not replies
                    var postEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/?threadsOnly=true";
                    console.log("[Summary Metrics]           → Fetching posts from:", postEndpoint);
                    var postData = await BrightspaceFetch(postEndpoint).catch(function(err) {
                      console.error("[Summary Metrics]           ✗ Error fetching posts:", err.message || err, err.status || "unknown status");
                      return null;
                    });
                    
                    if (!postData) {
                      console.log("[Summary Metrics]           → No posts data returned (null or error)");
                    } else {
                      console.log("[Summary Metrics]           → Posts response received");
                      console.log("[Summary Metrics]           → Is array?", Array.isArray(postData));
                      console.log("[Summary Metrics]           → Has Objects property?", "Objects" in postData);
                      if (postData.Objects) {
                        console.log("[Summary Metrics]           → Objects is array?", Array.isArray(postData.Objects));
                        console.log("[Summary Metrics]           → Objects length:", postData.Objects.length);
                      }
                    }
                    
                    // Handle both response formats: Objects array or direct array
                    var posts = null;
                    if (postData) {
                      if (postData.Objects && Array.isArray(postData.Objects)) {
                        posts = postData.Objects;
                        console.log("[Summary Metrics]           → Using postsData.Objects array, length:", posts.length);
                      } else if (Array.isArray(postData)) {
                        posts = postData;
                        console.log("[Summary Metrics]           → Using postsData as direct array, length:", posts.length);
                      } else {
                        console.log("[Summary Metrics]           → Posts data is not in expected format");
                      }
                    }
                    
                    if (posts && posts.length) {
                      console.log("[Summary Metrics]           → Checking", posts.length, "posts for unread status");
                      for (var l = 0; l < posts.length; l++) {
                        var post = posts[l];
                        var postingUserId = post.PostingUserId;
                        
                        // Check if student is still enrolled (not withdrawn)
                        var userIdString = postingUserId ? postingUserId.toString() : null;
                        var isActiveStudent = userIdString && activeStudents.has(userIdString);
                        
                        if (!isActiveStudent) {
                          console.log("[Summary Metrics]             Post", (l + 1) + ":", "SKIPPED - Student", post.PostingUserDisplayName || postingUserId, "is not in classlist (withdrawn)");
                          continue; // Skip posts from withdrawn students
                        }
                        
                        var isRead = post.IsRead;
                        console.log("[Summary Metrics]             Post", (l + 1) + ":", "IsRead:", isRead, "- Active student");
                        if (!isRead) {
                          count++;
                          console.log("[Summary Metrics]             → Found unread post! Count now:", count);
                        }
                      }
                    } else {
                      console.log("[Summary Metrics]           → No posts found or posts array is empty");
                    }
                  } catch (e) {
                    console.error("[Summary Metrics]           ✗ Exception processing topic:", e.message || e, e.stack);
                  }
                }
              } else {
                console.log("[Summary Metrics]       → No topics found or topics array is empty");
              }
            } catch (e) {
              console.error("[Summary Metrics]       ✗ Exception processing forum:", e.message || e, e.stack);
            }
          }
        } else {
          console.log("[Summary Metrics]   → No forums found or forums array is empty");
        }
      } catch (e) {
        console.error("[Summary Metrics] ✗ Exception processing course:", e.message || e, e.stack);
      }
    }
    
    console.log("[Summary Metrics] ===== getUnreadDiscussionsCount END =====");
    console.log("[Summary Metrics] Final unread discussions count = " + count);
    return count;
  }

  // =========================
  // GET UNGRADED QUIZZES COUNT (Optimized - limit courses and quizzes)
  // =========================
  async function getUngradedQuizzesCount(courses) {
    console.log("[Summary Metrics] getUngradedQuizzesCount: Starting with " + courses.length + " courses");
    var count = 0;
    // Limit to first 10 courses for speed
    var coursesToProcess = courses.slice(0, 10);
    console.log("[Summary Metrics] Processing " + coursesToProcess.length + " courses for ungraded quizzes");
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var quizEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/";
        var quizData = await BrightspaceFetch(quizEndpoint).catch(function() { return null; });
        
        if (quizData && quizData.Objects && quizData.Objects.length) {
          // Limit to first 5 quizzes per course
          var quizzesToCheck = quizData.Objects.slice(0, 5);
          for (var j = 0; j < quizzesToCheck.length; j++) {
            var quizId = quizzesToCheck[j].QuizId;
            try {
              var attemptsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/quizzes/" + quizId + "/attempts/";
              var attemptsData = await BrightspaceFetch(attemptsEndpoint).catch(function(err) {
                // Silently handle 403/404 errors (expected for restricted quizzes)
                // These are common when faculty don't have permission to view quiz attempts
                if (err && err.isExpected) {
                  return null; // Return null silently for expected permission errors
                }
                // Log unexpected errors (5xx, etc.)
                if (err && err.status && err.status >= 500) {
                  console.warn("[Summary Metrics] Server error fetching quiz attempts for quiz " + quizId + ":", err.status);
                }
                return null;
              });
              
              if (attemptsData && attemptsData.Objects && attemptsData.Objects.length) {
                for (var k = 0; k < attemptsData.Objects.length; k++) {
                  if (attemptsData.Objects[k].IsGraded === false || attemptsData.Objects[k].IsRetake === true) {
                    count++;
                  }
                }
              }
            } catch (e) {
              // Continue - 403 errors are expected for some quizzes
              // Errors are already handled in the catch above, this is just a safety net
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }
    
    console.log("[Summary Metrics] getUngradedQuizzesCount: Final count = " + count);
    return count;
  }

  // =========================
  // GET ALL GRADES FOR COURSE (Final Grades API with Pagination)
  // Same function as used in students.js
  // =========================
  async function getAllGradesForCourse(orgUnitId) {
    var gradesMap = new Map(); // Map<userId (string), gradePercentage>
    
    try {
      // Start with initial call using pageSize=200
      var nextUrl = "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/?pageSize=200";
      var allGrades = [];
      
      // Pagination loop: continue fetching until Next is null
      while (nextUrl) {
        try {
          var data = await BrightspaceFetch(nextUrl);
          
          // Handle both Items and Objects response formats
          var gradeItems = (data && data.Items) ? data.Items : (data && data.Objects) ? data.Objects : [];
          
          if (gradeItems.length > 0) {
            // Add this page's objects to our master list
            allGrades = allGrades.concat(gradeItems);
          }
          
          // Update nextUrl with the value from the API
          // If there are no more pages, 'Next' will be null, breaking the loop
          if (data && data.Next && data.Next !== null && data.Next !== "") {
            // Extract the path from the Next URL (it may be a full URL or just a path)
            var nextPath = data.Next;
            if (nextPath.indexOf('/d2l/api/') >= 0) {
              // Full URL provided, extract just the path
              var urlParts = nextPath.split('/d2l/api/');
              if (urlParts.length > 1) {
                nextUrl = "/d2l/api/" + urlParts[1];
              } else {
                nextUrl = null;
              }
            } else if (nextPath.indexOf('/') === 0) {
              // Already a path, use as-is
              nextUrl = nextPath;
            } else {
              // Relative path, construct full path
              nextUrl = "/d2l/api/le/" + API_VERSION_GRADES_BULK + "/" + orgUnitId + "/grades/final/values/" + nextPath;
            }
          } else {
            nextUrl = null;
          }
        } catch (pageError) {
          // If we get an error on a subsequent page, log it but don't fail completely
          if (pageError.status !== 403 && pageError.status !== 404) {
            console.warn("[Summary Metrics] Error fetching paginated grades for course " + orgUnitId + " (page):", pageError.message);
          }
          nextUrl = null; // Stop pagination on error
        }
      }
      
      // Process all collected grade items
      // Filter for Final Calculated Grade (GradeObjectType: 7)
      for (var i = 0; i < allGrades.length; i++) {
        var item = allGrades[i];
        
        // The API response has nested structure: { User: {...}, GradeValue: {...} }
        var gradeValue = item.GradeValue || item;
        var user = item.User || {};
        
        // Only process Final Calculated Grade items (GradeObjectType: 7)
        if (!gradeValue || gradeValue.GradeObjectType !== 7) {
          continue;
        }
        
        // Get userId from User.Identifier (nested structure) or fallback to item.UserId
        var userId = String(user.Identifier || item.UserId || ""); // CRITICAL: Convert to string
        
        if (!userId) {
          continue; // Skip if no userId
        }
        
        var gradePercentage = null;
        
        // Calculate percentage from PointsNumerator/PointsDenominator in GradeValue
        var pointsNum = gradeValue.PointsNumerator;
        var pointsDen = gradeValue.PointsDenominator;
        
        if (pointsNum !== null && pointsNum !== undefined && 
            pointsDen !== null && pointsDen !== undefined &&
            pointsDen > 0) {
          gradePercentage = (pointsNum / pointsDen) * 100;
        }
        
        if (gradePercentage !== null && userId) {
          gradesMap.set(userId, gradePercentage);
        }
      }
      
      console.log("[Summary Metrics] Course " + orgUnitId + ": Fetched " + allGrades.length + " grade items, " + gradesMap.size + " final grades");
      
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        console.warn("[Summary Metrics] Error fetching final grades for course " + orgUnitId + ":", e.message);
      }
    }
    
    return gradesMap;
  }

  // =========================
  // GET AVERAGE COURSE GRADE (Using same grade fetching as students.js)
  // =========================
  async function getAverageCourseGrade(courses) {
    console.log("[Summary Metrics] getAverageCourseGrade: Starting with " + courses.length + " courses");
    
    if (courses.length === 0) {
      console.log("[Summary Metrics] No courses to process");
      return 0;
    }
    
    // Process all courses (not limited)
    var allGrades = [];
    var totalStudents = 0;
    
    for (var i = 0; i < courses.length; i++) {
      try {
        var orgUnitId = courses[i].OrgUnit.Id;
        var courseName = courses[i].OrgUnit.Name || "Unknown Course";
        console.log("[Summary Metrics] Processing course: " + courseName + " (" + orgUnitId + ")");
        
        // Use the same grade fetching function as students.js
        var gradesMap = await getAllGradesForCourse(orgUnitId);
        
        // Calculate average for this course
        if (gradesMap.size > 0) {
          var courseTotal = 0;
          var courseStudentCount = 0;
          
          gradesMap.forEach(function(gradePercentage) {
            if (gradePercentage !== null && gradePercentage !== undefined) {
              courseTotal += gradePercentage;
              courseStudentCount++;
            }
          });
          
          if (courseStudentCount > 0) {
            var courseAverage = courseTotal / courseStudentCount;
            allGrades.push(courseAverage);
            totalStudents += courseStudentCount;
            console.log("[Summary Metrics] Course " + courseName + ": Average = " + courseAverage.toFixed(2) + "% (" + courseStudentCount + " students)");
          }
        } else {
          console.log("[Summary Metrics] Course " + courseName + ": No grades found");
        }
      } catch (e) {
        console.warn("[Summary Metrics] Error processing course for average grade:", e);
        // Continue with next course
      }
    }
    
    // Calculate overall average across all courses
    if (allGrades.length > 0) {
      var totalAverage = 0;
      for (var j = 0; j < allGrades.length; j++) {
        totalAverage += allGrades[j];
      }
      var avg = Math.round(totalAverage / allGrades.length);
      console.log("[Summary Metrics] getAverageCourseGrade: Final average = " + avg + "% (from " + allGrades.length + " courses, " + totalStudents + " total students)");
      return avg;
    }
    
    console.log("[Summary Metrics] getAverageCourseGrade: No grades found, returning 0");
    return 0;
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
        } else {
          console.warn("Invalid child element:", children[i]);
        }
      }
    }
    return node;
  }

  // =========================
  // RENDER METRIC BOX
  // =========================
  function renderMetricBox(title, value, icon, color, subtitle, onClick) {
    var box = el("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "16px",
        height: "100%",
        cursor: onClick ? "pointer" : "default"
      },
      onclick: onClick || null
    }, []);

    var iconDiv = el("div", {
      style: {
        width: "56px",
        height: "56px",
        borderRadius: "12px",
        background: color + "15",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0
      }
    }, [
      el("i", {
        className: "fas " + icon,
        style: { fontSize: "24px", color: color },
        "aria-hidden": "true"
      })
    ]);

    var contentChildren = [
      el("div", {
        style: {
          fontSize: "32px",
          fontWeight: "900",
          color: "#0f5b46",
          lineHeight: "1.2",
          marginBottom: "4px"
        }
      }, [String(value)]),
      el("div", {
        style: {
          fontSize: "14px",
          color: "#666",
          fontWeight: "600"
        }
      }, [title])
    ];
    
    if (subtitle) {
      contentChildren.push(el("div", {
        style: {
          fontSize: "12px",
          color: "#888",
          marginTop: "4px"
        }
      }, [subtitle]));
    }
    
    var contentDiv = el("div", {
      style: { flex: 1, minWidth: 0 }
    }, contentChildren);

    box.appendChild(iconDiv);
    box.appendChild(contentDiv);

    return box;
  }

  // =========================
  // RENDER WIDGETS
  // =========================
  function renderWelcomeBox(container, userInfo) {
    var firstName = userInfo.firstName || "Instructor";
    
    // Clear container first
    container.innerHTML = "";
    
    var box = el("div", {
      style: {
        background: "linear-gradient(135deg, #0f5b46 0%, #1a7a5e 100%)",
        border: "none",
        borderRadius: "12px",
        padding: "24px",
        boxShadow: "0 2px 8px rgba(15, 91, 70, 0.2)",
        color: "#fff"
      }
    }, [
      el("div", {
        style: {
          fontSize: "20px",
          fontWeight: "700",
          marginBottom: "8px"
        }
      }, ["Welcome back, " + firstName + "!"]),
      el("div", {
        style: {
          fontSize: "14px",
          opacity: 0.9,
          lineHeight: "1.5"
        }
      }, ["Here's an overview of your courses and what needs your attention."])
    ]);

    container.appendChild(box);
  }

  function renderMetrics(row1Container, metricsContainer2, metricsContainer3, row2Container, metrics) {
    console.log("[Summary Metrics] renderMetrics called with:", metrics);
    console.log("[Summary Metrics] Rendering Total Students box with value:", metrics.totalStudents);
    
    // First Row - Total Courses already displayed and managed separately, update others only
    metricsContainer2.innerHTML = "";
    metricsContainer2.classList.add("clickable");
    var studentsBox = renderMetricBox(
      "Total Students",
      metrics.totalStudents,
      "fa-users",
      "#2d9d7a",
      "Across all courses",
      function() {
        // Store courses data for the students page
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        window.location.href = "students.html";
      }
    );
    console.log("[Summary Metrics] Total Students box created:", studentsBox);
    metricsContainer2.appendChild(studentsBox);
    console.log("[Summary Metrics] Total Students box appended to container");

    console.log("[Summary Metrics] Rendering Total Ungraded box with value:", metrics.totalUngraded);
    metricsContainer3.innerHTML = "";
    metricsContainer3.classList.add("clickable");
    var ungradedBox = renderMetricBox(
      "Total Ungraded",
      metrics.totalUngraded,
      "fa-tasks",
      "#f80",
      "Needs attention",
      function() {
        // Store courses data for the ungraded page
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        window.location.href = "ungraded.html";
      }
    );
    console.log("[Summary Metrics] Total Ungraded box created:", ungradedBox);
    metricsContainer3.appendChild(ungradedBox);
    console.log("[Summary Metrics] Total Ungraded box appended to container");

    // Second Row - Render as individual boxes like top row
    row2Container.innerHTML = "";
    var row2 = el("div", {
      id: "summary-row-2",
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "20px"
      }
    }, []);

    row2.appendChild(renderMetricBox(
      "Avg Course Grade",
      metrics.avgGrade + "%",
      "fa-chart-line",
      "#0f5b46",
      metrics.courseName || "Overall average"
    ));

    row2.appendChild(renderMetricBox(
      "Assignments",
      metrics.ungradedAssignments,
      "fa-file-alt",
      "#c00",
      metrics.ungradedAssignments > 0 ? metrics.ungradedAssignments + " need feedback" : "All graded",
      function() {
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        var courseSelect = document.getElementById("course-filter-select");
        var courseId = courseSelect ? courseSelect.value : "all";
        window.location.href = "assignments.html?courseId=" + encodeURIComponent(courseId);
      }
    ));

    row2.appendChild(renderMetricBox(
      "Discussions",
      metrics.totalDiscussions || metrics.unreadDiscussions,
      "fa-comments",
      "#f80",
      metrics.unreadDiscussions > 0 ? metrics.unreadDiscussions + " need feedback" : "All caught up",
      function() {
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        var courseSelect = document.getElementById("course-filter-select");
        var courseId = courseSelect ? courseSelect.value : "all";
        window.location.href = "discussions.html?courseId=" + encodeURIComponent(courseId);
      }
    ));

    row2.appendChild(renderMetricBox(
      "Quizzes",
      metrics.totalQuizzes || metrics.ungradedQuizzes,
      "fa-question-circle",
      "#c00",
      metrics.ungradedQuizzes > 0 ? metrics.ungradedQuizzes + " need grading" : "All graded",
      function() {
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        var courseSelect = document.getElementById("course-filter-select");
        var courseId = courseSelect ? courseSelect.value : "all";
        window.location.href = "quizzes.html?courseId=" + encodeURIComponent(courseId);
      }
    ));

    row2Container.appendChild(row2);
  }

  // =========================
  // RENDER PLACEHOLDER BOXES (Synchronous - runs immediately)
  // =========================
  function renderPlaceholderBoxes() {
    var welcomeContainer = document.getElementById("welcome-box");
    var metricsContainer1 = document.getElementById("summary-metrics-1");
    var metricsContainer2 = document.getElementById("summary-metrics-2");
    var metricsContainer3 = document.getElementById("summary-metrics-3");
    var row2Container = document.getElementById("summary-row-2-container");

    if (!welcomeContainer || !metricsContainer1 || !metricsContainer2 || !metricsContainer3 || !row2Container) {
      return; // Containers not ready yet, will retry
    }

    // Show loading for welcome box only
    welcomeContainer.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading..."]).outerHTML;

    // Render top row metric boxes immediately with placeholder values
    metricsContainer1.innerHTML = "";
    metricsContainer1.classList.add("clickable");
    metricsContainer1.appendChild(renderMetricBox(
      "Total Courses",
      0,
      "fa-book",
      "#0f5b46",
      viewingSemesterCode(),
      function() {
        window.location.href = "mycourses.html";
      }
    ));
    
    metricsContainer2.innerHTML = "";
    metricsContainer2.classList.add("clickable");
    metricsContainer2.appendChild(renderMetricBox(
      "Total Students",
      0,
      "fa-users",
      "#2d9d7a",
      "Across all courses",
      function() {
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        window.location.href = "students.html";
      }
    ));
    
    metricsContainer3.innerHTML = "";
    metricsContainer3.classList.add("clickable");
    metricsContainer3.appendChild(renderMetricBox(
      "Total Ungraded",
      0,
      "fa-tasks",
      "#f80",
      "Needs attention",
      function() {
        var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
        localStorage.setItem("dashboardCourses", JSON.stringify(courses));
        window.location.href = "ungraded.html";
      }
    ));

    // Render bottom row boxes immediately with placeholder values
    row2Container.innerHTML = "";
    var row2 = el("div", {
      id: "summary-row-2",
      className: "summary-row-2"
    }, []);

    var gradeBox = el("div", { className: "summary-box" }, []);
    gradeBox.appendChild(renderMetricBox(
      "Avg Course Grade",
      "0%",
      "fa-chart-line",
      "#0f5b46",
      "Overall average"
    ));
    row2.appendChild(gradeBox);

        var assignmentsBox = el("div", { className: "summary-box" }, []);
        assignmentsBox.appendChild(renderMetricBox(
          "Assignments",
          0,
          "fa-file-alt",
          "#c00",
          "Loading...",
          function() {
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "assignments.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
    row2.appendChild(assignmentsBox);

        var discussionsBox = el("div", { className: "summary-box" }, []);
        discussionsBox.appendChild(renderMetricBox(
          "Discussions",
          0,
          "fa-comments",
          "#f80",
          "Loading...",
          function() {
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "discussions.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
    row2.appendChild(discussionsBox);

        var quizzesBox = el("div", { className: "summary-box" }, []);
        quizzesBox.appendChild(renderMetricBox(
          "Quizzes",
          0,
          "fa-question-circle",
          "#c00",
          "Loading...",
          function() {
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "quizzes.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
    row2.appendChild(quizzesBox);

    row2Container.appendChild(row2);
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    console.log("[Summary Metrics] ===== INIT STARTING =====");
    var welcomeContainer = document.getElementById("welcome-box");
    var row1Container = document.getElementById("summary-row-1");
    var metricsContainer1 = document.getElementById("summary-metrics-1");
    var metricsContainer2 = document.getElementById("summary-metrics-2");
    var metricsContainer3 = document.getElementById("summary-metrics-3");
    var row2Container = document.getElementById("summary-row-2-container");

    console.log("[Summary Metrics] Container check:");
    console.log("  - welcomeContainer:", welcomeContainer ? "found" : "MISSING");
    console.log("  - row1Container:", row1Container ? "found" : "MISSING");
    console.log("  - metricsContainer1:", metricsContainer1 ? "found" : "MISSING");
    console.log("  - metricsContainer2:", metricsContainer2 ? "found" : "MISSING");
    console.log("  - metricsContainer3:", metricsContainer3 ? "found" : "MISSING");
    console.log("  - row2Container:", row2Container ? "found" : "MISSING");

    if (!welcomeContainer || !row1Container || !metricsContainer1 || !metricsContainer2 || !metricsContainer3 || !row2Container) {
      console.error("[Summary Metrics] Missing required containers, aborting init");
      return;
    }

    try {
      console.log("[Summary Metrics] Getting user info...");
      // Get user info and courses first (fast)
      var userInfo = await getUserInfo();
      console.log("[Summary Metrics] User info received:", userInfo);
      renderWelcomeBox(welcomeContainer, userInfo);
      console.log("[Summary Metrics] Welcome box rendered");

      async function refreshSemesterData() {
      console.log("[Summary Metrics] Fetching current semester courses (" + viewingSemesterCode() + ")...");
      var currentCourses = await getCurrentSemesterCourses();
      console.log("[Summary Metrics] Current semester courses fetched: " + currentCourses.length);
      
      // Store courses in localStorage for drill-down pages
      localStorage.setItem("dashboardCourses", JSON.stringify(currentCourses));
      
      // Populate course dropdown - only include courses where user has instructor role
      var courseSelect = document.getElementById("course-filter-select");
      if (courseSelect) {
        // Clear existing options except "All Courses"
        courseSelect.innerHTML = '<option value="all">All Courses</option>';
        
        // Add each course as an option, but only if user has instructor role
        var coursesAdded = 0;
        var coursesSkipped = [];
        for (var i = 0; i < currentCourses.length; i++) {
          var course = currentCourses[i];
          var roleId = getRoleId(course);
          
          // Debug: Log ALL courses to see their structure
          console.log("[Summary Metrics] Course " + i + ":", {
            name: course.OrgUnit.Name,
            code: course.OrgUnit.Code,
            hasAccess: !!course.Access,
            accessField: course.Access,
            roleId: roleId,
            classlistRoleId: course.Access ? course.Access.ClasslistRoleId : "N/A",
            classlistRoleName: course.Access ? course.Access.ClasslistRoleName : "N/A"
          });
          
          if (isInstructorRole(roleId)) {
            var courseName = course.OrgUnit.Name || "Unknown Course";
            var courseCode = course.OrgUnit.Code || "";
            var orgUnitId = course.OrgUnit.Id;
            var option = el("option", {
              value: orgUnitId
            }, [courseName + (courseCode ? " (" + courseCode + ")" : "")]);
            courseSelect.appendChild(option);
            coursesAdded++;
            console.log("[Summary Metrics] ✓ Added course to dropdown:", courseName, "- RoleId:", roleId);
          } else {
            // Log why courses are being skipped
            coursesSkipped.push({
              name: course.OrgUnit.Name,
              roleId: roleId,
              access: course.Access
            });
            console.log("[Summary Metrics] ✗ Skipping course (not instructor role):", course.OrgUnit.Name, "- RoleId:", roleId, "- Access:", course.Access);
          }
        }
        console.log("[Summary Metrics] Course dropdown populated with " + coursesAdded + " courses (filtered to instructor roles)");
        console.log("[Summary Metrics] Skipped " + coursesSkipped.length + " courses:", coursesSkipped);
      }
      
      // Function to calculate metrics for a single course or all courses
      async function calculateCourseMetrics(courseId) {
        // Filter to only courses where user has instructor role and exclude MERGED/CXLD courses
        var filteredCourses = currentCourses.filter(function(c) {
          var roleId = getRoleId(c);
          return isInstructorRole(roleId) && !isMergedOrCancelledCourse(c);
        });
        
        var coursesToProcess = courseId === "all" 
          ? filteredCourses 
          : filteredCourses.filter(function(c) { return c.OrgUnit.Id.toString() === courseId.toString(); });
        
        var courseName = courseId === "all" 
          ? "Overall average" 
          : (coursesToProcess.length > 0 ? coursesToProcess[0].OrgUnit.Name : "Selected course");
        
        console.log("[Summary Metrics] Calculating metrics for:", courseId === "all" ? "All courses" : courseName);
        
        if (coursesToProcess.length === 0) {
          console.warn("[Summary Metrics] No courses found for selection:", courseId);
          return null;
        }
        
        // Keep boxes visible, they will be updated with data when ready
        
        // Calculate metrics for selected course(s)
        var results = await Promise.allSettled([
          getTotalAssignmentsCount(coursesToProcess),
          getTotalDiscussionTopicsCount(coursesToProcess),
          getTotalQuizzesCount(coursesToProcess),
          getUngradedAssignmentsCount(coursesToProcess),
          getUnreadDiscussionsCount(coursesToProcess),
          getUngradedQuizzesCount(coursesToProcess),
          getAverageCourseGrade(coursesToProcess)
        ]);
        
        var totalAssignments = results[0].status === "fulfilled" ? results[0].value : 0;
        var totalDiscussions = results[1].status === "fulfilled" ? results[1].value : 0;
        var totalQuizzes = results[2].status === "fulfilled" ? results[2].value : 0;
        var ungradedAssignments = results[3].status === "fulfilled" ? results[3].value : 0;
        var unreadDiscussions = results[4].status === "fulfilled" ? results[4].value : 0;
        var ungradedQuizzes = results[5].status === "fulfilled" ? results[5].value : 0;
        var avgGrade = results[6].status === "fulfilled" ? results[6].value : 0;
        
        return {
          avgGrade: avgGrade,
          totalAssignments: totalAssignments,
          totalDiscussions: totalDiscussions,
          totalQuizzes: totalQuizzes,
          ungradedAssignments: ungradedAssignments,
          unreadDiscussions: unreadDiscussions,
          ungradedQuizzes: ungradedQuizzes,
          courseName: courseName
        };
      }
      
      // Function to render bottom row metrics
      function renderBottomMetrics(metrics) {
        if (!metrics) return;
        
        row2Container.innerHTML = "";
        var row2 = el("div", {
          id: "summary-row-2",
          className: "summary-row-2"
        }, []);

        // Wrap each metric box in a summary-box container to match top row styling
        var gradeBox = el("div", { className: "summary-box" }, []);
        gradeBox.appendChild(renderMetricBox(
          "Avg Course Grade",
          metrics.avgGrade + "%",
          "fa-chart-line",
          "#0f5b46",
          metrics.courseName
        ));
        row2.appendChild(gradeBox);

        var assignmentsBox = el("div", { className: "summary-box" }, []);
        assignmentsBox.appendChild(renderMetricBox(
          "Assignments",
          metrics.ungradedAssignments,
          "fa-file-alt",
          "#c00",
          metrics.ungradedAssignments > 0 ? metrics.ungradedAssignments + " need feedback" : "All graded",
          function() {
            // Store courses data and navigate to assignments page
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "assignments.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
        row2.appendChild(assignmentsBox);

        var discussionsBox = el("div", { className: "summary-box" }, []);
        discussionsBox.appendChild(renderMetricBox(
          "Discussions",
          metrics.totalDiscussions || metrics.unreadDiscussions,
          "fa-comments",
          "#f80",
          metrics.unreadDiscussions > 0 ? metrics.unreadDiscussions + " need feedback" : "All caught up",
          function() {
            // Store courses data and navigate to discussions page
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "discussions.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
        row2.appendChild(discussionsBox);

        var quizzesBox = el("div", { className: "summary-box" }, []);
        quizzesBox.appendChild(renderMetricBox(
          "Quizzes",
          metrics.totalQuizzes || metrics.ungradedQuizzes,
          "fa-question-circle",
          "#c00",
          metrics.ungradedQuizzes > 0 ? metrics.ungradedQuizzes + " need grading" : "All graded",
          function() {
            // Store courses data and navigate to quizzes page
            var courses = JSON.parse(localStorage.getItem("dashboardCourses") || "[]");
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
            var courseSelect = document.getElementById("course-filter-select");
            var courseId = courseSelect ? courseSelect.value : "all";
            window.location.href = "quizzes.html?courseId=" + encodeURIComponent(courseId);
          }
        ));
        row2.appendChild(quizzesBox);

        row2Container.appendChild(row2);
      }
      
      // Boxes are already rendered synchronously above, just update values
      // Update Total Courses immediately (box already rendered above)
      var totalCourses = currentCourses.length;
      metricsContainer1.innerHTML = "";
      metricsContainer1.classList.add("clickable");
      metricsContainer1.appendChild(renderMetricBox(
        "Total Courses",
        totalCourses,
        "fa-book",
        "#0f5b46",
        viewingSemesterCode(),
        function() {
          window.location.href = "mycourses.html";
        }
      ));
      
      console.log("[Summary Metrics] Courses to process:", currentCourses.map(function(c) { return c.OrgUnit.Name + " (" + c.OrgUnit.Code + ")"; }));
      
      // Calculate top row metrics (all courses) in parallel
      console.log("[Summary Metrics] Starting parallel metric calculations for " + currentCourses.length + " courses");
      
      var results = await Promise.allSettled([
        getTotalStudents(currentCourses)
      ]);

      var totalStudents = results[0].status === "fulfilled" ? results[0].value : 0;
      
      // Calculate bottom row metrics first to get ungraded counts
      var bottomMetrics = await calculateCourseMetrics("all");
      
      // Calculate totalUngraded by summing assignments, discussions, and quizzes needing attention
      var totalUngraded = 0;
      if (bottomMetrics) {
        totalUngraded = (bottomMetrics.ungradedAssignments || 0) + 
                        (bottomMetrics.unreadDiscussions || 0) + 
                        (bottomMetrics.ungradedQuizzes || 0);
      }

      var topMetrics = {
        totalCourses: totalCourses,
        totalStudents: totalStudents,
        totalUngraded: totalUngraded
      };

      // Update top row metrics (boxes already rendered above, just update values)
      metricsContainer2.innerHTML = "";
      metricsContainer2.classList.add("clickable");
      metricsContainer2.appendChild(renderMetricBox(
        "Total Students",
        topMetrics.totalStudents,
        "fa-users",
        "#2d9d7a",
        "Across all courses",
        function() {
          // Store courses data for the students page
          localStorage.setItem("dashboardCourses", JSON.stringify(currentCourses));
          window.location.href = "students.html";
        }
      ));

      metricsContainer3.innerHTML = "";
      metricsContainer3.classList.add("clickable");
      metricsContainer3.appendChild(renderMetricBox(
        "Total Ungraded",
        topMetrics.totalUngraded,
        "fa-tasks",
        "#f80",
        "Needs attention",
        function() {
          // Store courses data for the ungraded page
          localStorage.setItem("dashboardCourses", JSON.stringify(currentCourses));
          window.location.href = "ungraded.html";
        }
      ));
      
      // Render bottom row metrics
      if (bottomMetrics) {
        renderBottomMetrics(bottomMetrics);
      }
      
      // Bind course selection (assignment avoids duplicate listeners on semester refresh)
      if (courseSelect) {
        courseSelect.onchange = async function() {
          var selectedCourseId = courseSelect.value;
          console.log("[Summary Metrics] Course selection changed to:", selectedCourseId);
          var metrics = await calculateCourseMetrics(selectedCourseId);
          if (metrics) {
            // Update Total Ungraded box with sum of assignments, discussions, and quizzes
            var totalUngraded = (metrics.ungradedAssignments || 0) + 
                                (metrics.unreadDiscussions || 0) + 
                                (metrics.ungradedQuizzes || 0);
            
            metricsContainer3.innerHTML = "";
            metricsContainer3.classList.add("clickable");
            metricsContainer3.appendChild(renderMetricBox(
              "Total Ungraded",
              totalUngraded,
              "fa-tasks",
              "#f80",
              "Needs attention",
              function() {
                // Store courses data for the ungraded page
                localStorage.setItem("dashboardCourses", JSON.stringify(currentCourses));
                window.location.href = "ungraded.html";
              }
            ));
            
            renderBottomMetrics(metrics);
          }
        };
      }
      
      console.log("[Summary Metrics] Semester metrics refresh completed");
      }

      document.addEventListener("fd-semester-viewing-change", function () {
        refreshSemesterData();
      });

      await refreshSemesterData();
      console.log("[Summary Metrics] Initialization completed");
    } catch (e) {
      console.error("Failed to load summary metrics:", e);
      var errorMsg = e && e.message ? e.message : String(e);
      
      // Clear containers and set error messages
      welcomeContainer.innerHTML = "";
      var errorDiv1 = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading welcome: " + errorMsg]);
      welcomeContainer.appendChild(errorDiv1);
      
      metricsContainer1.innerHTML = "";
      var errorDiv2 = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading metrics: " + errorMsg]);
      metricsContainer1.appendChild(errorDiv2);
      
      row2Container.innerHTML = "";
      var errorDiv3 = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading metrics: " + errorMsg]);
      row2Container.appendChild(errorDiv3);
    }
  }

  // Render placeholder boxes immediately (synchronously) when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      renderPlaceholderBoxes();
      init();
    });
  } else {
    // DOM already ready, render boxes immediately (synchronously) then start async init
    renderPlaceholderBoxes();
    init();
  }

})();
