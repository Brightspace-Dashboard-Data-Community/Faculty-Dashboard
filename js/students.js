/**
 * D2L Faculty Dashboard - Students Widget
 * REDESIGNED: Unified data structure with immediate matching
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.78";
  var API_VERSION_GRADES_BULK = "1.86";

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/FA";
  }

  var SSS_FACULTY_URL = "https://intranet.example.edu/student-support-system/faculty.html";

  // =========================
  // UNIFIED DATA STRUCTURE
  // =========================
  // studentsMap: Map<studentId (string), {
  //   identifier: string,
  //   firstName: string,
  //   lastName: string,
  //   email: string,
  //   orgDefinedId: string,
  //   courses: [{
  //     courseId: string,
  //     courseName: string,
  //     courseCode: string,
  //     grade: number|null,
  //     lastAccess: string|null,
  //     status: {status, label, color, borderColor, bgColor}  // PRE-CALCULATED
  //   }],
  //   worstStatus: {status, label, color, borderColor, bgColor}  // PRE-CALCULATED
  // }>
  var studentsMap = new Map();
  var coursesList = [];
  var courseStartDatesMap = new Map(); // Map<courseId (string), startDate (string|null)>
  var courseEndDatesMap = new Map(); // Map<courseId (string), endDate (string|null)>
  var loadGeneration = 0;
  var modalBound = false;

  // =========================
  // AUTH FETCH
  // =========================
  async function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF.Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    if (!res.ok) {
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      error.isExpected = (res.status === 403 || res.status === 404);
      if (!error.isExpected) {
        console.error("API Error:", error.message);
      }
      throw error;
    }
    return await res.json();
  }

  // =========================
  // GET ROLE ID FROM ENROLLMENT
  // =========================
  function getRoleId(item) {
    if (item && item.Access) {
      if (typeof item.Access.ClasslistRoleId !== "undefined" && item.Access.ClasslistRoleId !== null) {
        var n = parseInt(item.Access.ClasslistRoleId, 10);
        if (!isNaN(n)) return n;
      }
      if (item.Access.ClasslistRoleName) {
        var roleName = (item.Access.ClasslistRoleName || "").toLowerCase();
        if (roleName.indexOf("instructor") >= 0 && roleName.indexOf("evaluator") === -1) {
          return 102;
        }
      }
    }
    return null;
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
  // GET CLASSLIST FOR COURSE
  // ObjectListPage.Next is an API URL (path or absolute), not a bare bookmark token.
  // Encoding Next as ?bookmark=... yields a 400 and silently stops after the first page.
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

  async function getClasslist(orgUnitId) {
    var allStudents = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    var maxPages = 40;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      if (seenUrls[nextUrl]) break;
      seenUrls[nextUrl] = true;

      try {
        var data = await BrightspaceFetch(nextUrl);
        var objects = (data && data.Objects) || [];
        for (var i = 0; i < objects.length; i++) {
          allStudents.push(objects[i]);
        }
        nextUrl = classlistNextUrl(orgUnitId, data, objects.length);
      } catch (e) {
        console.error("Error fetching classlist for course " + orgUnitId + ":", e);
        break;
      }
    }

    console.log("[Classlist] Course " + orgUnitId + ": " + allStudents.length + " users from " + pageCount + " page(s)");
    return allStudents;
  }

  // =========================
  // GET ALL GRADES FOR COURSE (Final Grades API with Pagination)
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
            console.warn("Error fetching paginated grades for course " + orgUnitId + " (page):", pageError.message);
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
      
      console.log("[Grades] Course " + orgUnitId + ": Fetched " + allGrades.length + " grade items, " + gradesMap.size + " final grades");
      
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) {
        console.warn("Error fetching final grades for course " + orgUnitId + ":", e.message);
      }
    }
    
    return gradesMap;
  }

  // =========================
  // GET COURSE START DATE
  // =========================
  async function getCourseStartDate(orgUnitId) {
    // Check cache first (end date is always fetched alongside start date)
    if (courseStartDatesMap.has(orgUnitId)) {
      return courseStartDatesMap.get(orgUnitId);
    }
    
    try {
      var endpoint = "/d2l/api/lp/" + API_VERSION_LP + "/courses/" + orgUnitId;
      var data = await BrightspaceFetch(endpoint);
      var startDate = data.StartDate || null;
      var endDate = data.EndDate || null;
      courseStartDatesMap.set(orgUnitId, startDate);
      courseEndDatesMap.set(orgUnitId, endDate);
      return startDate;
    } catch (e) {
      // Silently fail - course start/end dates are optional
      console.warn("[Course Start Date] Error fetching for course " + orgUnitId + ":", e.message);
      courseStartDatesMap.set(orgUnitId, null);
      courseEndDatesMap.set(orgUnitId, null);
      return null;
    }
  }

  // =========================
  // GET STATUS REASON
  // =========================
  function getStatusReason(grade, lastAccess, status) {
    var reasons = [];
    
    if (status.status === "at-risk" || status.status === "needs-attention") {
      // Check grade-related reasons
      if (grade === null || grade === undefined) {
        reasons.push("No grade");
      } else if (grade < 60) {
        reasons.push("Low grade");
      } else if (grade < 70) {
        reasons.push("Below 70%");
      }
      
      // Check attendance-related reasons
      if (lastAccess) {
        try {
          var lastAccessDate = new Date(lastAccess);
          var now = new Date();
          var daysSinceAccess = Math.floor((now - lastAccessDate) / (1000 * 60 * 60 * 24));
          if (daysSinceAccess < 0) daysSinceAccess = 0;
          
          if (daysSinceAccess > 21) {
            reasons.push("No access >21 days");
          } else if (daysSinceAccess > 14) {
            reasons.push("No access >14 days");
          } else if (daysSinceAccess > 7) {
            reasons.push("No access >7 days");
          }
        } catch (e) {
          // Date parsing error, skip
        }
      } else {
        reasons.push("No attendance");
      }
    }
    
    return reasons.length > 0 ? reasons.join(", ") : null;
  }

  // =========================
  // CALCULATE HEALTH STATUS
  // =========================
  function getHealthStatus(grade, lastAccess) {
    var gradeValue = (grade !== null && grade !== undefined) ? grade : null;
    var daysSinceAccess = null;
    var hasAccessData = false;
    
    if (lastAccess) {
      try {
        var lastAccessDate = new Date(lastAccess);
        var now = new Date();
        daysSinceAccess = Math.floor((now - lastAccessDate) / (1000 * 60 * 60 * 24));
        if (daysSinceAccess < 0) daysSinceAccess = 0;
        hasAccessData = true;
      } catch (e) {
        daysSinceAccess = null;
        hasAccessData = false;
      }
    }
    
    // Status calculation with access data
    if (hasAccessData && daysSinceAccess !== null) {
      if (daysSinceAccess > 21) {
        return { status: "at-risk", label: "At Risk", color: "#800", borderColor: "#dc2626", bgColor: "#fef2f2" };
      }
      if (daysSinceAccess > 14) {
        return { status: "needs-attention", label: "Needs Attention", color: "#c00", borderColor: "#f97316", bgColor: "#fff7ed" };
      }
      if (daysSinceAccess > 7) {
        // Moderate access (8-14 days)
        if (gradeValue !== null && gradeValue >= 80) {
          return { status: "good", label: "Good", color: "#0f5b46", borderColor: "#22c55e", bgColor: "#f0fdf4" };
        }
        if (gradeValue !== null && gradeValue >= 70) {
          return { status: "fair", label: "Fair", color: "#f80", borderColor: "#eab308", bgColor: "#fefce8" };
        }
        if (gradeValue !== null && gradeValue >= 60) {
          return { status: "needs-attention", label: "Needs Attention", color: "#c00", borderColor: "#f97316", bgColor: "#fff7ed" };
        }
        return { status: "at-risk", label: "At Risk", color: "#800", borderColor: "#dc2626", bgColor: "#fef2f2" };
      }
      
      // Good access (<=7 days)
      if (gradeValue !== null && gradeValue >= 80) {
        return { status: "good", label: "Good", color: "#0f5b46", borderColor: "#22c55e", bgColor: "#f0fdf4" };
      }
      if (gradeValue !== null && gradeValue >= 70) {
        return { status: "fair", label: "Fair", color: "#f80", borderColor: "#eab308", bgColor: "#fefce8" };
      }
      if (gradeValue !== null && gradeValue >= 60) {
        return { status: "needs-attention", label: "Needs Attention", color: "#c00", borderColor: "#f97316", bgColor: "#fff7ed" };
      }
      if (gradeValue !== null) {
        return { status: "needs-attention", label: "Needs Attention", color: "#c00", borderColor: "#f97316", bgColor: "#fff7ed" };
      }
      return { status: "fair", label: "Fair", color: "#f80", borderColor: "#eab308", bgColor: "#fefce8" };
    }
    
    // No access data - rely only on grade
    if (gradeValue !== null && gradeValue >= 80) {
      return { status: "good", label: "Good", color: "#0f5b46", borderColor: "#22c55e", bgColor: "#f0fdf4" };
    }
    if (gradeValue !== null && gradeValue >= 70) {
      return { status: "fair", label: "Fair", color: "#f80", borderColor: "#eab308", bgColor: "#fefce8" };
    }
    if (gradeValue !== null && gradeValue >= 60) {
      return { status: "needs-attention", label: "Needs Attention", color: "#c00", borderColor: "#f97316", bgColor: "#fff7ed" };
    }
    if (gradeValue !== null) {
      return { status: "at-risk", label: "At Risk", color: "#800", borderColor: "#dc2626", bgColor: "#fef2f2" };
    }
    
    // No data at all
    return { status: "at-risk", label: "At Risk", color: "#800", borderColor: "#dc2626", bgColor: "#fef2f2" };
  }

  // =========================
  // GET WORST STATUS FROM ARRAY
  // =========================
  function getWorstStatus(statuses) {
    if (!statuses || statuses.length === 0) {
      return { status: "at-risk", label: "At Risk", color: "#800", borderColor: "#dc2626", bgColor: "#fef2f2" };
    }
    
    var priority = { "at-risk": 4, "needs-attention": 3, "fair": 2, "good": 1 };
    var worst = statuses[0];
    
    for (var i = 1; i < statuses.length; i++) {
      var currentPriority = priority[worst.status] || 0;
      var newPriority = priority[statuses[i].status] || 0;
      if (newPriority > currentPriority) {
        worst = statuses[i];
      }
    }
    
    return worst;
  }

  // =========================
  // PROCESS COURSE: Match students to grades immediately
  // =========================
  async function processCourse(course) {
    // Skip MERGED and CXLD courses
    if (isMergedOrCancelledCourse(course)) {
      console.log("[Process] Skipping MERGED/CXLD course: " + (course.OrgUnit.Name || "Unknown") + " (" + (course.OrgUnit.Code || "") + ")");
      return;
    }
    
    var orgUnitId = String(course.OrgUnit.Id);
    var courseName = course.OrgUnit.Name || "Unknown Course";
    var courseCode = course.OrgUnit.Code || "";
    
    console.log("[Process] Processing course: " + courseName + " (" + orgUnitId + ")");
    
    // 1. Get classlist
    var classlist = await getClasslist(orgUnitId);
    console.log("[Process]   - Classlist: " + classlist.length + " entries");
    
    // 2. Get grades (bulk API)
    var gradesMap = await getAllGradesForCourse(orgUnitId);
    console.log("[Process]   - Grades: " + gradesMap.size + " entries");
    
    // 3. IMMEDIATELY match and create unified student records
    for (var i = 0; i < classlist.length; i++) {
      var student = classlist[i];
      
      // Only process students (not instructors)
      var roleName = (student.ClasslistRoleDisplayName || "").toLowerCase();
      var isStudent = roleName.indexOf("student") >= 0 || 
                     student.RoleId === 3 || 
                     student.RoleId === 5 || 
                     student.RoleId === 101;
      
      if (!isStudent) continue;
      
      // CRITICAL: Use string identifier for all matching
      var studentId = String(student.Identifier || "");
      
      // Get or create student record
      var studentRecord = studentsMap.get(studentId);
      if (!studentRecord) {
        studentRecord = {
          identifier: studentId,
          firstName: student.FirstName || "",
          lastName: student.LastName || "",
          email: student.Email || "",
          orgDefinedId: student.OrgDefinedId || "",
          courses: []
        };
        studentsMap.set(studentId, studentRecord);
      }
      
      // Get grade for this student in this course (match by studentId)
      var grade = gradesMap.get(studentId) || null;
      
      // Get last access from classlist
      var lastAccess = student.LastAccessed || null;
      
      // CALCULATE STATUS IMMEDIATELY when we have the data
      var status = getHealthStatus(grade, lastAccess);
      var statusReason = getStatusReason(grade, lastAccess, status);
      
      // Check if this course already exists for this student (prevent duplicates)
      var courseExists = false;
      for (var c = 0; c < studentRecord.courses.length; c++) {
        if (studentRecord.courses[c].courseId === orgUnitId) {
          courseExists = true;
          break;
        }
      }
      
      // Only add course if it doesn't already exist
      if (!courseExists) {
        studentRecord.courses.push({
          courseId: orgUnitId,
          courseName: courseName,
          courseCode: courseCode,
          grade: grade,
          lastAccess: lastAccess,
          status: status,  // PRE-CALCULATED
          statusReason: statusReason  // REASON FOR STATUS
        });
      }
    }
    
    console.log("[Process]   - Matched students: " + classlist.length);
  }

  // =========================
  // CALCULATE WORST STATUS FOR ALL STUDENTS
  // =========================
  function calculateWorstStatuses() {
    studentsMap.forEach(function(studentRecord) {
      if (studentRecord.courses.length === 0) {
        studentRecord.worstStatus = { status: "good", label: "Good", color: "#0f5b46", borderColor: "#22c55e", bgColor: "#f0fdf4" };
        return;
      }
      
      var statuses = studentRecord.courses.map(function(c) { return c.status; });
      studentRecord.worstStatus = getWorstStatus(statuses);
    });
  }

  // =========================
  // RENDER STUDENT CARD
  // =========================
  function renderStudentCard(studentRecord, selectedCourseId) {
    // Use filtered courses if available (from renderWidget), otherwise filter here
    var relevantCourses = studentRecord._filteredRelevantCourses || studentRecord.courses;
    if (selectedCourseId && selectedCourseId !== "all") {
      relevantCourses = relevantCourses.filter(function(c) { return c.courseId === selectedCourseId; });
    }
    
    if (relevantCourses.length === 0) return null;
    
    // Get worst status from relevant courses
    var statuses = relevantCourses.map(function(c) { return c.status; });
    var worstStatus = getWorstStatus(statuses);
    
    // Get worst course for grade display and status reason
    var worstCourse = relevantCourses[0];
    for (var i = 1; i < relevantCourses.length; i++) {
      var currentPriority = (worstStatus.status === "at-risk" ? 4 : worstStatus.status === "needs-attention" ? 3 : worstStatus.status === "fair" ? 2 : 1);
      var newPriority = (relevantCourses[i].status.status === "at-risk" ? 4 : relevantCourses[i].status.status === "needs-attention" ? 3 : relevantCourses[i].status.status === "fair" ? 2 : 1);
      if (newPriority > currentPriority) {
        worstCourse = relevantCourses[i];
      }
    }
    
    // Use the hasNotStartedCourse flag from renderWidget
    var hasNotStartedCourse = studentRecord._hasNotStartedCourse || false;
    
    var fullName = (studentRecord.firstName || "") + " " + (studentRecord.lastName || "");
    if (!fullName.trim()) fullName = "Unknown Student";
    
    var card = el("div", {
      className: "student-card",
      style: {
        borderLeft: "4px solid " + worstStatus.borderColor,
        backgroundColor: worstStatus.bgColor,
        position: "relative"
      },
      onclick: function() { showStudentModal(studentRecord); }
    }, []);

    // Course hasn't started banner (green)
    var notStartedBanner = null;
    if (hasNotStartedCourse) {
      notStartedBanner = el("div", {
        style: {
          position: "absolute",
          top: "8px",
          right: "8px",
          padding: "4px 10px",
          borderRadius: "12px",
          fontSize: "10px",
          fontWeight: "700",
          color: "#fff",
          backgroundColor: "#22c55e",
          border: "1px solid #16a34a",
          zIndex: 10
        }
      }, ["Course hasn't started"]);
    }

    var topRow = el("div", {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", paddingRight: hasNotStartedCourse ? "150px" : "0", position: "relative" }
    }, [
      el("div", {
        style: { fontSize: "16px", fontWeight: "700", color: "#111" }
      }, [fullName]),
      el("div", {
        style: { 
          fontSize: "12px", 
          color: "#666",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }
      }, [
        studentRecord.email || "",
        el("span", {
          style: {
            padding: "2px 8px",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: "600",
            color: worstStatus.color,
            backgroundColor: "rgba(255, 255, 255, 0.8)",
            border: "1px solid " + worstStatus.color
          }
        }, [worstStatus.label])
      ])
    ]);

    // Grade display
    var gradeDisplay = "N/A";
    if (worstCourse.grade !== null && worstCourse.grade !== undefined) {
      gradeDisplay = worstCourse.grade.toFixed(1) + "%";
    }

    var infoRow = el("div", {
      style: { display: "flex", gap: "16px", fontSize: "14px", color: "#555", marginBottom: "4px" }
    }, [
      el("span", {}, ["Student ID: " + (studentRecord.orgDefinedId || "N/A")]),
      el("span", { style: { fontWeight: "600" } }, ["Grade: " + gradeDisplay])
    ]);

    // Status reason display
    var statusReasonRow = null;
    if (worstCourse.statusReason && (worstStatus.status === "at-risk" || worstStatus.status === "needs-attention")) {
      statusReasonRow = el("div", {
        style: { fontSize: "12px", color: worstStatus.color, fontStyle: "italic", marginTop: "4px" }
      }, [worstCourse.statusReason]);
    }

    if (notStartedBanner) {
      card.appendChild(notStartedBanner);
    }
    card.appendChild(topRow);
    card.appendChild(infoRow);
    if (statusReasonRow) {
      card.appendChild(statusReasonRow);
    }

    return card;
  }

  // =========================
  // EMAIL STUDENT (mailto — opens default mail client, e.g. Outlook)
  // =========================
  function isTrainingPrivacyMaskOn() {
    return !!(
      window.FacultyDashboardPiiMask &&
      typeof window.FacultyDashboardPiiMask.isEnabled === "function" &&
      window.FacultyDashboardPiiMask.isEnabled()
    );
  }

  function buildStudentEmailMailto(studentRecord) {
    var trainingMask = isTrainingPrivacyMaskOn();
    var email = trainingMask
      ? "masked.student@example.edu"
      : (studentRecord.email || "").trim();
    if (!email) return null;

    var first = trainingMask
      ? "Masked"
      : ((studentRecord.firstName || "").trim() || "there");
    var fullName = trainingMask
      ? "Masked Student"
      : (((studentRecord.firstName || "") + " " + (studentRecord.lastName || "")).trim() || "Student");

    var courseLines = [];
    for (var ci = 0; ci < studentRecord.courses.length; ci++) {
      var c = studentRecord.courses[ci];
      var line = c.courseName || "Course";
      if (c.courseCode) line += " (" + c.courseCode + ")";
      courseLines.push("• " + line);
    }
    var coursesBlock = courseLines.length ? courseLines.join("\n") : "(course not listed)";

    var subject = "Checking in — " + fullName + " — course progress";
    if (trainingMask) {
      subject = "[TRAINING — do not send] " + subject;
    }

    var body =
      "Hi " + first + ",\n\n" +
      "I'm reaching out because I care about how you're doing in our class, and I have some concerns about your progress that I'd like to discuss with you.\n\n" +
      "This message is regarding:\n" + coursesBlock + "\n\n" +
      "I'd really value hearing from you. Please reply to this email or come see me during office hours so we can talk about support options and a path forward that works for you.\n\n" +
      "Take care,\n";

    if (trainingMask) {
      body =
        "[TRAINING MODE — student name and email are masked. Do not send this message.]\n\n" +
        body;
    }

    return (
      "mailto:" +
      email +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body)
    );
  }

  function openStudentEmail(studentRecord) {
    var href = buildStudentEmailMailto(studentRecord);
    if (!href) return;
    window.location.href = href;
  }

  // =========================
  // SHOW STUDENT MODAL
  // =========================
  function showStudentModal(studentRecord) {
    var modal = document.getElementById("student-detail-modal");
    var content = document.getElementById("student-detail-content");
    
    if (!modal || !content) return;
    
    var fullName = (studentRecord.firstName || "") + " " + (studentRecord.lastName || "");
    if (!fullName.trim()) fullName = "Unknown Student";
    
    content.innerHTML = "";
    
    // Check if any course hasn't started for full-width banner
    var hasAnyCourseNotStarted = false;
    for (var checkIdx = 0; checkIdx < studentRecord.courses.length; checkIdx++) {
      if (hasCourseNotStarted(studentRecord.courses[checkIdx].courseId)) {
        hasAnyCourseNotStarted = true;
        break;
      }
    }
    
    // Close button - always in same position
    var closeButton = el("button", {
      className: "modal-close",
      "aria-label": "Close modal",
      style: {
        position: "absolute",
        top: "25px",
        right: "20px",
        background: "none",
        border: "none",
        fontSize: "32px",
        fontWeight: "900",
        cursor: "pointer",
        color: hasAnyCourseNotStarted ? "#fff" : "#000",
        padding: "0",
        lineHeight: "1",
        width: "40px",
        height: "40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1001
      },
      onclick: function() {
        var modal = document.getElementById("student-detail-modal");
        if (modal) modal.classList.remove("active");
      }
    }, ["×"]);
    content.appendChild(closeButton);
    
    // Full-width banner at top if any course hasn't started
    if (hasAnyCourseNotStarted) {
      var topBanner = el("div", {
        style: {
          width: "100%",
          padding: "12px 16px",
          paddingRight: "60px",
          backgroundColor: "#22c55e",
          color: "#fff",
          borderRadius: "8px",
          marginBottom: "20px",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: "700",
          position: "relative"
        }
      }, ["Course Hasn't Started"]);
      content.appendChild(topBanner);
    }
    
    // Header
    var header = el("div", {
      style: { marginBottom: "24px", paddingBottom: "16px", borderBottom: "2px solid #e5e7eb" }
    }, [
      el("h2", {
        style: { fontSize: "24px", fontWeight: "900", color: "#0f5b46", marginBottom: "8px" }
      }, [fullName]),
      el("div", {
        style: { fontSize: "14px", color: "#666" }
      }, ["Email: " + (studentRecord.email || "N/A") + " | Student ID: " + (studentRecord.orgDefinedId || studentRecord.identifier || "N/A")])
    ]);
    content.appendChild(header);

    var hasEmail = !!(studentRecord.email && String(studentRecord.email).trim());
    var emailStudentBtn = el("button", {
      type: "button",
      title: hasEmail ? "Open your email app with this message" : "No email address on file",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "10px 16px",
        background: hasEmail ? "#0f5b46" : "#9ca3af",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        fontSize: "14px",
        fontWeight: "700",
        cursor: hasEmail ? "pointer" : "not-allowed"
      },
      onclick: function () {
        if (hasEmail) openStudentEmail(studentRecord);
      }
    }, [
      el("i", { className: "fa-solid fa-envelope", style: { fontSize: "14px" } }),
      " Email Student"
    ]);
    emailStudentBtn.disabled = !hasEmail;

    var modalActions = el("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        alignItems: "center",
        marginBottom: "20px"
      }
    }, [
      el("a", {
        href: SSS_FACULTY_URL,
        target: "_blank",
        rel: "noopener noreferrer",
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "10px 16px",
          background: "#fff",
          color: "#0f5b46",
          border: "2px solid #0f5b46",
          borderRadius: "8px",
          textDecoration: "none",
          fontSize: "14px",
          fontWeight: "700"
        }
      }, [
        el("i", { className: "fa-solid fa-arrow-up-right-from-square", style: { fontSize: "13px" } }),
        " Submit SSS Referral"
      ]),
      emailStudentBtn
    ]);
    content.appendChild(modalActions);
    
    // Courses section
    var coursesTitle = el("h3", {
      style: { fontSize: "18px", fontWeight: "700", color: "#111", marginTop: "24px", marginBottom: "16px" }
    }, ["Course Progress"]);
    content.appendChild(coursesTitle);
    
    if (studentRecord.courses.length === 0) {
      content.appendChild(el("div", {
        style: { padding: "20px", textAlign: "center", color: "#666" }
      }, ["No course data available"]));
    } else {
      for (var i = 0; i < studentRecord.courses.length; i++) {
        var course = studentRecord.courses[i];
        var status = course.status; // Use PRE-CALCULATED status
        
        // Get course start date
        var courseStartDate = courseStartDatesMap.get(course.courseId);
        var startDateDisplay = courseStartDate ? formatDate(courseStartDate) : "Not set";
        var courseNotStarted = hasCourseNotStarted(course.courseId);
        
        // Calculate days since last access
        var daysSinceAccess = null;
        if (course.lastAccess) {
          try {
            var lastAccessDate = new Date(course.lastAccess);
            var now = new Date();
            daysSinceAccess = Math.floor((now - lastAccessDate) / (1000 * 60 * 60 * 24));
            if (daysSinceAccess < 0) daysSinceAccess = 0;
          } catch (e) {
            daysSinceAccess = null;
          }
        }
        
        var courseCard = el("div", {
          style: {
            border: "1px solid #e5e7eb",
            borderLeft: "4px solid " + status.borderColor,
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "12px",
            backgroundColor: status.bgColor
          }
        }, [
          el("div", {
            style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }
          }, [
            el("div", { style: { flex: 1 } }, [
              el("div", {
                style: { fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "4px" }
              }, [course.courseName]),
              el("div", {
                style: { fontSize: "12px", color: "#666", marginBottom: "8px" }
              }, [course.courseCode]),
              // Status reason if available
              course.statusReason ? el("div", {
                style: {
                  fontSize: "12px",
                  color: status.color,
                  fontStyle: "italic",
                  marginTop: "4px"
                }
              }, ["Reason: " + course.statusReason]) : null
            ]),
            el("div", {
              style: { display: "flex", gap: "8px", flexDirection: "column", alignItems: "flex-end" }
            }, [
              el("a", {
                href: "/d2l/home/" + course.courseId,
                target: "_blank",
                style: {
                  padding: "6px 12px",
                  background: "#0f5b46",
                  color: "#fff",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: "600",
                  whiteSpace: "nowrap"
                }
              }, ["View Course"]),
              el("a", {
                href: "/d2l/le/classprogress/userprogress/" + studentRecord.identifier + "/" + course.courseId + "/Summary?searchString=&sortDirection=0&sortField=SortLastName&classListFilterKey=all",
                target: "_blank",
                style: {
                  padding: "6px 12px",
                  background: "#22c55e",
                  color: "#fff",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: "600",
                  whiteSpace: "nowrap"
                }
              }, ["Course Progress"])
            ])
          ]),
          el("div", {
            className: "course-card-grid"
          }, [
            el("div", {
              className: "course-card-grid-item"
            }, [
              el("div", {
                className: "course-card-grid-item-label"
              }, ["Grade"]),
              el("div", {
                className: "course-card-grid-item-value course-card-grid-item-value-large"
              }, [
                (course.grade !== null && course.grade !== undefined) 
                  ? course.grade.toFixed(1) + "%" 
                  : "N/A"
              ])
            ]),
            el("div", {
              className: "course-card-grid-item"
            }, [
              el("div", {
                className: "course-card-grid-item-label"
              }, ["Last Access"]),
              el("div", {
                className: "course-card-grid-item-value"
              }, [
                formatDate(course.lastAccess),
                daysSinceAccess !== null ? el("span", {
                  className: "course-card-grid-item-value-subtext",
                  style: { display: "block" }
                }, ["(" + daysSinceAccess + " days ago)"]) : null
              ])
            ]),
            el("div", {
              className: "course-card-grid-item"
            }, [
              el("div", {
                className: "course-card-grid-item-label"
              }, ["Course Start"]),
              el("div", {
                className: "course-card-grid-item-value"
              }, [startDateDisplay])
            ]),
            el("div", {
              className: "course-card-grid-item"
            }, [
              el("div", {
                className: "course-card-grid-item-label"
              }, ["Status"]),
              el("div", {
                className: "course-card-grid-item-value course-card-grid-item-value-status",
                style: { color: status.color }
              }, [status.label])
            ])
          ])
        ]);

        content.appendChild(courseCard);
      }
    }
    
    modal.classList.add("active");
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

  function formatDate(dateString) {
    if (!dateString) return "Never";
    try {
      var date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return "Never";
      }
      return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return "Never";
    }
  }

  // =========================
  // CHECK IF COURSE HASN'T STARTED
  // =========================
  function hasCourseNotStarted(courseId) {
    var startDate = courseStartDatesMap.get(courseId);
    if (!startDate) return false;
    try {
      var start = new Date(startDate);
      var now = new Date();
      return start > now;
    } catch (e) {
      return false;
    }
  }

  // =========================
  // CHECK IF COURSE HAS ENDED
  // =========================
  function hasCourseEnded(courseId) {
    var endDate = courseEndDatesMap.get(courseId);
    if (!endDate) return false;
    try {
      var end = new Date(endDate);
      var now = new Date();
      return end < now;
    } catch (e) {
      return false;
    }
  }

  // =========================
  // RENDER WIDGET
  // =========================
  var hideNotStartedCourses = true; // Default: hide courses that haven't started
  var hideEndedCourses = true; // Default: hide courses that have ended
  
  function renderWidget(container, selectedCourseId) {
    container.innerHTML = "";

    // Course filter and sort controls
    var filterSection = el("div", {
      style: {
        marginBottom: "20px",
        paddingBottom: "16px",
        borderBottom: "2px solid #e5e7eb"
      }
    }, []);

    var filterContainer = el("div", {
      style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }
    }, []);

    var filterLabel = el("label", {
      style: {
        fontWeight: "600",
        color: "#0f5b46",
        fontSize: "14px"
      },
      htmlFor: "student-course-filter"
    }, ["Filter by Course:"]);

    var courseSelect = el("select", {
      id: "student-course-filter",
      "aria-label": "Select course to filter students",
      style: {
        padding: "10px 16px",
        borderRadius: "8px",
        border: "1px solid #d1d5db",
        fontSize: "14px",
        background: "#fff",
        minWidth: "300px",
        color: "#111",
        cursor: "pointer"
      },
      onchange: function() {
        renderWidget(container, courseSelect.value);
      }
    }, []);

    courseSelect.appendChild(el("option", { value: "all" }, ["All Courses"]));

    // Filter out MERGED and CXLD courses from dropdown
    var filteredCourses = coursesList.filter(function(c) {
      return !isMergedOrCancelledCourse(c);
    });

    for (var i = 0; i < filteredCourses.length; i++) {
      var course = filteredCourses[i];
      var courseName = course.OrgUnit.Name || "Unknown Course";
      var courseCode = course.OrgUnit.Code || "";
      var displayText = courseCode ? courseName + " (" + courseCode + ")" : courseName;
      var courseId = String(course.OrgUnit.Id);
      
      var option = el("option", { value: courseId }, [displayText]);
      if (selectedCourseId === courseId) {
        option.selected = true;
      }
      courseSelect.appendChild(option);
    }

    // Checkboxes for hiding not-started / ended courses
    var checkboxesWrapper = el("div", {
      style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }
    }, []);

    function createFilterCheckbox(id, checked, labelText, onChange) {
      var row = el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px" }
      }, []);

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.checked = checked;
      checkbox.style.width = "18px";
      checkbox.style.height = "18px";
      checkbox.style.cursor = "pointer";

      checkbox.addEventListener("click", function(e) {
        e.stopPropagation();
      });

      checkbox.addEventListener("change", function(e) {
        var currentCourseFilter = courseSelect ? courseSelect.value : (selectedCourseId || "all");
        onChange(e.target.checked);
        renderWidget(container, currentCourseFilter);
      });

      var checkboxLabel = el("label", {
        htmlFor: id,
        style: {
          fontSize: "14px",
          color: "#111",
          cursor: "pointer",
          fontWeight: "500"
        }
      }, [labelText]);

      row.appendChild(checkbox);
      row.appendChild(checkboxLabel);
      return row;
    }

    checkboxesWrapper.appendChild(createFilterCheckbox(
      "hide-not-started-courses",
      hideNotStartedCourses,
      "Don't Show Courses that haven't started",
      function(checked) { hideNotStartedCourses = checked; }
    ));
    checkboxesWrapper.appendChild(createFilterCheckbox(
      "hide-ended-courses",
      hideEndedCourses,
      "Don't Show Courses that have ended",
      function(checked) { hideEndedCourses = checked; }
    ));

    filterContainer.appendChild(filterLabel);
    filterContainer.appendChild(courseSelect);
    filterSection.appendChild(filterContainer);
    filterSection.appendChild(checkboxesWrapper);
    container.appendChild(filterSection);

    // Separate students into At Risk and All Others
    var atRiskStudents = [];
    var otherStudents = [];
    
    studentsMap.forEach(function(studentRecord) {
      // Filter courses if needed
      var relevantCourses = studentRecord.courses;
      if (selectedCourseId && selectedCourseId !== "all") {
        relevantCourses = studentRecord.courses.filter(function(c) { return c.courseId === selectedCourseId; });
      }
      
      if (relevantCourses.length === 0) return;
      
      // Check if any course hasn't started (before filtering) - for banner display
      var hasNotStartedCourse = false;
      for (var i = 0; i < relevantCourses.length; i++) {
        if (hasCourseNotStarted(relevantCourses[i].courseId)) {
          hasNotStartedCourse = true;
          break;
        }
      }
      
      // Filter out courses that haven't started / have ended if checkboxes are checked
      var filteredRelevantCourses = relevantCourses;
      if (hideNotStartedCourses || hideEndedCourses) {
        filteredRelevantCourses = relevantCourses.filter(function(c) {
          if (hideNotStartedCourses && hasCourseNotStarted(c.courseId)) return false;
          if (hideEndedCourses && hasCourseEnded(c.courseId)) return false;
          return true;
        });
        if (filteredRelevantCourses.length === 0) return; // Skip student if no courses match filter
      }
      
      // Get worst status from filtered relevant courses
      var statuses = filteredRelevantCourses.map(function(c) { return c.status; });
      var worstStatus = getWorstStatus(statuses);
      
      studentRecord._hasNotStartedCourse = hasNotStartedCourse;
      studentRecord._worstStatus = worstStatus;
      studentRecord._filteredRelevantCourses = filteredRelevantCourses; // Store for card rendering
      
      if (worstStatus.status === "at-risk") {
        atRiskStudents.push(studentRecord);
      } else {
        otherStudents.push(studentRecord);
      }
    });

    // Sort students: At Risk, Needs Attention, Good
    var statusPriority = { "at-risk": 4, "needs-attention": 3, "fair": 2, "good": 1 };
    
    function sortStudents(a, b) {
      var priorityA = statusPriority[a._worstStatus.status] || 0;
      var priorityB = statusPriority[b._worstStatus.status] || 0;
      return priorityB - priorityA; // Higher priority first (At Risk > Needs Attention > Fair > Good)
    }
    
    atRiskStudents.sort(sortStudents);
    otherStudents.sort(sortStudents);
    
    // Render At Risk section
    if (atRiskStudents.length > 0) {
      var atRiskSection = el("div", {
        style: { marginBottom: "32px" }
      }, []);
      
      var atRiskHeader = el("h2", {
        style: { fontSize: "20px", fontWeight: "700", color: "#dc2626", marginBottom: "16px" }
      }, ["At Risk Students (" + atRiskStudents.length + ")"]);
      atRiskSection.appendChild(atRiskHeader);
      
      for (var j = 0; j < atRiskStudents.length; j++) {
        var card = renderStudentCard(atRiskStudents[j], selectedCourseId);
        if (card) atRiskSection.appendChild(card);
      }
      
      container.appendChild(atRiskSection);
    }
    
    // Render All Others section
    if (otherStudents.length > 0) {
      var othersSection = el("div", {}, []);
      
      var othersHeader = el("h2", {
        style: { fontSize: "20px", fontWeight: "700", color: "#0f5b46", marginBottom: "16px" }
      }, ["Students (" + otherStudents.length + ")"]);
      othersSection.appendChild(othersHeader);
      
      for (var k = 0; k < otherStudents.length; k++) {
        var card2 = renderStudentCard(otherStudents[k], selectedCourseId);
        if (card2) othersSection.appendChild(card2);
      }
      
      container.appendChild(othersSection);
    }
    
    // Show message if no students
    if (atRiskStudents.length === 0 && otherStudents.length === 0) {
      var noStudentsMsg = el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, ["No students found for the selected filter."]);
      container.appendChild(noStudentsMsg);
    }
  }

  function resetStudentData() {
    studentsMap = new Map();
    coursesList = [];
    courseStartDatesMap = new Map();
    courseEndDatesMap = new Map();
  }

  // =========================
  // INITIALIZE
  // =========================
  async function loadStudents() {
    var container = document.getElementById("students-widget");
    if (!container) {
      console.warn("Students widget container not found");
      return;
    }

    var gen = ++loadGeneration;
    resetStudentData();

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading students..."]).outerHTML;

    try {
      // 1. Get all courses (instructor role only)
      console.log("[Init] Step 1: Loading courses...");
      var AC = activeSemesterCode();
      var allItems = [];
      var bookmark = null;
      var hasMore = true;

      while (hasMore) {
        var endpoint = bookmark
          ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
          : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";

        var data = await BrightspaceFetch(endpoint);
        if (gen !== loadGeneration) return;

        if (data && data.Items && data.Items.length) {
          for (var i = 0; i < data.Items.length; i++) {
            var item = data.Items[i];
            if (item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3) {
              var code = item.OrgUnit.Code || "";
              if (code.indexOf(AC) >= 0) {
                var roleId = getRoleId(item);
                if (roleId === 102 && !isMergedOrCancelledCourse(item)) { // Only instructor courses, exclude MERGED/CXLD
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
      
      coursesList = allItems;
      console.log("[Init] Found " + coursesList.length + " instructor courses");

      // 2. Fetch course start dates
      console.log("[Init] Step 2: Fetching course start dates...");
      for (var j = 0; j < coursesList.length; j++) {
        if (gen !== loadGeneration) return;
        var orgUnitId = String(coursesList[j].OrgUnit.Id);
        await getCourseStartDate(orgUnitId);
      }

      // 3. Process each course: get classlist + grades, match immediately
      console.log("[Init] Step 3: Processing courses and matching data...");
      for (var k = 0; k < coursesList.length; k++) {
        if (gen !== loadGeneration) return;
        await processCourse(coursesList[k]);
      }

      // 4. Calculate worst status for each student
      console.log("[Init] Step 4: Calculating worst statuses...");
      calculateWorstStatuses();

      console.log("[Init] Complete! Total students: " + studentsMap.size);

      if (gen !== loadGeneration) return;

      // 5. Render
      renderWidget(container, "all");

    } catch (e) {
      if (gen !== loadGeneration) return;
      console.error("[Init] Error:", e);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading students: " + (e.message || String(e))]).outerHTML;
    }
  }

  async function init() {
    var container = document.getElementById("students-widget");
    if (!container) {
      console.warn("Students widget container not found");
      return;
    }

    var modal = document.getElementById("student-detail-modal");
    if (modal && !modalBound) {
      modalBound = true;
      modal.addEventListener("click", function(e) {
        if (e.target === modal) {
          modal.classList.remove("active");
        }
      });
    }

    document.addEventListener("fd-semester-viewing-change", function () {
      loadStudents();
    });

    await loadStudents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
