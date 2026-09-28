/**
 * D2L Faculty Dashboard - Discussions Analytics
 * Displays detailed breakdown of discussions with posts without replies
 */

(function () {
  'use strict';

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.82";  // Updated to match D2L API documentation

  function activeSemesterCode() {
    return window.FacultyDashboardSemester ? window.FacultyDashboardSemester.getActiveCode() : "26/SP";
  }

  // =========================
  // AUTH FETCH
  // =========================
  async function BrightspaceFetch(url, options) {
    console.log("[Discussions] [API] Fetching:", url);
    var token = localStorage.getItem("XSRF.Token");
    console.log("[Discussions] [API] CSRF Token present?", !!token);
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    console.log("[Discussions] [API] Response status:", res.status, res.statusText);
    console.log("[Discussions] [API] Response ok?", res.ok);
    console.log("[Discussions] [API] Response headers:", Object.fromEntries(res.headers.entries()));
    
    if (!res.ok) {
      var errorText = "";
      try {
        errorText = await res.text();
        console.error("[Discussions] [API] Error response body:", errorText);
      } catch (e) {
        console.error("[Discussions] [API] Could not read error response body");
      }
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      error.isExpected = (res.status === 403 || res.status === 404);
      console.error("[Discussions] [API] Throwing error:", error.message, "Expected?", error.isExpected);
      throw error;
    }
    
    var jsonData = await res.json();
    console.log("[Discussions] [API] Response JSON received, type:", typeof jsonData);
    console.log("[Discussions] [API] Response data:", jsonData);
    return jsonData;
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
  // GET CLASSLIST FOR COURSE (cache per course)
  // =========================
  var classlistCache = {};
  async function getClasslistForCourse(orgUnitId) {
    if (classlistCache[orgUnitId]) {
      console.log("[Discussions] Using cached classlist for course", orgUnitId);
      return classlistCache[orgUnitId];
    }
    
    try {
      console.log("[Discussions] Fetching classlist for course", orgUnitId);
      var allStudents = [];
      var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
      var seenUrls = {};
      var pageCount = 0;
      var maxPages = 40;

      while (nextUrl && pageCount < maxPages) {
        pageCount++;
        if (seenUrls[nextUrl]) break;
        seenUrls[nextUrl] = true;

        var data = await BrightspaceFetch(nextUrl).catch(function(err) {
          console.error("[Discussions] Error fetching classlist:", err.message || err, err.status || "unknown status");
          return null;
        });

        var objects = (data && data.Objects) || [];
        for (var i = 0; i < objects.length; i++) {
          var student = objects[i];
          if (student.Identifier) {
            allStudents.push(student.Identifier.toString());
          }
        }

        var next = data && data.Next ? String(data.Next) : "";
        if (!next || !objects.length) {
          nextUrl = null;
        } else if (next.indexOf("/d2l/api/") >= 0) {
          var parts = next.split("/d2l/api/");
          nextUrl = parts.length > 1 ? "/d2l/api/" + parts[1] : null;
        } else if (next.indexOf("/") === 0) {
          nextUrl = next;
        } else {
          nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
        }
      }
      
      // Convert to Set for faster lookup
      var studentSet = new Set(allStudents);
      classlistCache[orgUnitId] = studentSet;
      console.log("[Discussions] Cached classlist for course", orgUnitId, "-", studentSet.size, "active students");
      return studentSet;
    } catch (e) {
      console.error("[Discussions] Exception getting classlist:", e.message || e);
      return new Set(); // Return empty set on error
    }
  }

  // =========================
  // GET GRADE ITEMS FOR COURSE (cache per course)
  // =========================
  var gradeItemsCache = {};
  async function getGradeItemsForCourse(orgUnitId) {
    if (gradeItemsCache[orgUnitId]) {
      console.log("[Discussions] Using cached grade items for course", orgUnitId);
      return gradeItemsCache[orgUnitId];
    }
    
    try {
      console.log("[Discussions] Fetching grade items for course", orgUnitId);
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/";
      var gradeItems = await BrightspaceFetch(endpoint).catch(function(err) {
        console.error("[Discussions] Error fetching grade items:", err.message || err, err.status || "unknown status");
        return [];
      });
      
      // Filter for discussion-related grade items (ToolId: 3000 = Discussions tool)
      var discussionGradeItems = [];
      if (Array.isArray(gradeItems)) {
        for (var i = 0; i < gradeItems.length; i++) {
          var item = gradeItems[i];
          if (item.AssociatedTool && item.AssociatedTool.ToolId === 3000) {
            discussionGradeItems.push({
              gradeItemId: item.Id,
              topicId: item.AssociatedTool.ToolItemId,
              name: item.Name,
              maxPoints: item.MaxPoints
            });
            console.log("[Discussions] Found discussion grade item:", item.Name, "GradeItemId:", item.Id, "TopicId:", item.AssociatedTool.ToolItemId);
          }
        }
      }
      
      gradeItemsCache[orgUnitId] = discussionGradeItems;
      console.log("[Discussions] Cached", discussionGradeItems.length, "discussion grade items for course", orgUnitId);
      return discussionGradeItems;
    } catch (e) {
      console.error("[Discussions] Exception getting grade items:", e.message || e);
      return [];
    }
  }

  // =========================
  // CHECK IF STUDENT HAS GRADE FOR TOPIC
  // =========================
  async function checkStudentGrade(orgUnitId, gradeItemId, postingUserId) {
    try {
      var endpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/grades/" + gradeItemId + "/values/" + postingUserId;
      var gradeValue = await BrightspaceFetch(endpoint).catch(function(err) {
        // 404 means no grade yet, which is expected
        if (err.status === 404) {
          return null;
        }
        console.error("[Discussions] Error checking grade:", err.message || err, err.status || "unknown status");
        return null;
      });
      
      if (gradeValue && gradeValue.PointsNumerator !== null && gradeValue.PointsNumerator !== undefined) {
        console.log("[Discussions] Student", postingUserId, "has grade:", gradeValue.PointsNumerator, "/", gradeValue.PointsDenominator);
        return true;
      }
      return false;
    } catch (e) {
      console.error("[Discussions] Exception checking student grade:", e.message || e);
      return false;
    }
  }

  // =========================
  // GET DISCUSSIONS WITH DETAILS (hierarchical structure)
  // =========================
  async function getDiscussionsWithDetails(courses) {
    console.log("[Discussions] ===== getDiscussionsWithDetails START =====");
    console.log("[Discussions] Total courses received:", courses.length);
    var forumsData = []; // Array of forum objects with topics and posts
    // Filter out MERGED and CXLD courses before processing
    var filteredCourses = courses.filter(function(c) {
      return !isMergedOrCancelledCourse(c);
    });
    var coursesToProcess = filteredCourses.slice(0, 20);
    console.log("[Discussions] Processing first", coursesToProcess.length, "courses (after filtering MERGED/CXLD)");
    
    for (var i = 0; i < coursesToProcess.length; i++) {
      try {
        var orgUnitId = coursesToProcess[i].OrgUnit.Id;
        var courseName = coursesToProcess[i].OrgUnit.Name || "Unknown Course";
        var courseCode = coursesToProcess[i].OrgUnit.Code || "";
        console.log("[Discussions] [" + (i + 1) + "/" + coursesToProcess.length + "] Processing course:", courseName, "(" + courseCode + "), OrgUnitId:", orgUnitId);
        
        // Get grade items for this course (to match topics to grade items)
        var gradeItems = await getGradeItemsForCourse(orgUnitId);
        console.log("[Discussions]   → Found", gradeItems.length, "discussion-related grade items");
        
        // Get classlist for this course (to filter out withdrawn students)
        var activeStudents = await getClasslistForCourse(orgUnitId);
        console.log("[Discussions]   → Found", activeStudents.size, "active students in classlist");
        
        var forumEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/";
        console.log("[Discussions]   → Fetching forums from:", forumEndpoint);
        var forumData = await BrightspaceFetch(forumEndpoint).catch(function(err) {
          console.error("[Discussions]   ✗ Error fetching forums:", err.message || err, err.status || "unknown status");
          return null;
        });
        
        if (!forumData) {
          console.log("[Discussions]   → No forum data returned (null or error)");
        } else {
          console.log("[Discussions]   → Forum response received:", forumData);
          console.log("[Discussions]   → Forum response type:", typeof forumData);
          console.log("[Discussions]   → Is array?", Array.isArray(forumData));
          console.log("[Discussions]   → Has Objects property?", "Objects" in forumData);
          if (Array.isArray(forumData)) {
            console.log("[Discussions]   → Direct array length:", forumData.length);
          } else if (forumData.Objects) {
            console.log("[Discussions]   → Objects is array?", Array.isArray(forumData.Objects));
            console.log("[Discussions]   → Objects length:", forumData.Objects.length);
          }
        }
        
        // Handle both response formats: direct array or Objects array
        var forums = null;
        if (forumData) {
          if (Array.isArray(forumData)) {
            forums = forumData;
            console.log("[Discussions]   → Using forumData as direct array, length:", forums.length);
          } else if (forumData.Objects && Array.isArray(forumData.Objects)) {
            forums = forumData.Objects;
            console.log("[Discussions]   → Using forumData.Objects array, length:", forums.length);
          }
        }
        
        if (forums && forums.length) {
          console.log("[Discussions]   → Found", forums.length, "forums");
          for (var j = 0; j < forums.length; j++) {
            var forum = forums[j];
            var forumId = forum.ForumId;
            var forumName = forum.Name || forum.ForumTitle || "Untitled Forum";
            console.log("[Discussions]     [" + (j + 1) + "/" + forums.length + "] Processing forum ID:", forumId, "Name:", forumName);
            
            // Create forum object with topics array
            var currentForum = {
              forumId: forumId,
              forumName: forumName,
              courseId: orgUnitId,
              courseName: courseName,
              courseCode: courseCode,
              topics: []
            };
            try {
              var topicEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/";
              console.log("[Discussions]       → Fetching topics from:", topicEndpoint);
              var topicData = await BrightspaceFetch(topicEndpoint).catch(function(err) {
                console.error("[Discussions]       ✗ Error fetching topics:", err.message || err, err.status || "unknown status");
                return null;
              });
              
              if (!topicData) {
                console.log("[Discussions]       → No topic data returned (null or error)");
              } else {
                console.log("[Discussions]       → Topic response received:", topicData);
                console.log("[Discussions]       → Is array?", Array.isArray(topicData));
                console.log("[Discussions]       → Has Objects property?", "Objects" in topicData);
                if (Array.isArray(topicData)) {
                  console.log("[Discussions]       → Direct array length:", topicData.length);
                } else if (topicData.Objects) {
                  console.log("[Discussions]       → Objects is array?", Array.isArray(topicData.Objects));
                  console.log("[Discussions]       → Objects length:", topicData.Objects.length);
                }
              }
              
              // Handle both response formats: direct array or Objects array
              var topics = null;
              if (topicData) {
                if (Array.isArray(topicData)) {
                  topics = topicData;
                  console.log("[Discussions]       → Using topicData as direct array, length:", topics.length);
                } else if (topicData.Objects && Array.isArray(topicData.Objects)) {
                  topics = topicData.Objects;
                  console.log("[Discussions]       → Using topicData.Objects array, length:", topics.length);
                }
              }
              
              if (topics && topics.length) {
                console.log("[Discussions]       → Found", topics.length, "topics");
                for (var k = 0; k < topics.length; k++) {
                  var topic = topics[k];
                  var topicId = topic.TopicId;
                  var topicName = topic.TopicTitle || topic.Name || "Untitled";
                  console.log("[Discussions]         [" + (k + 1) + "/" + topics.length + "] Processing topic ID:", topicId, "Name:", topicName);
                  console.log("[Discussions]         → Topic object keys:", Object.keys(topic));
                  try {
                    // Get posts (threads) for this topic using the correct endpoint
                    // Use threadsOnly=true to get only initial posts (submissions) not replies
                    var postsEndpoint = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/" + topicId + "/posts/?threadsOnly=true";
                    console.log("[Discussions]           → Fetching posts from:", postsEndpoint);
                    var postsData = await BrightspaceFetch(postsEndpoint).catch(function(err) {
                      console.error("[Discussions]           ✗ Error fetching posts:", err.message || err, err.status || "unknown status");
                      return null;
                    });
                    
                    if (!postsData) {
                      console.log("[Discussions]           → No posts data returned (null or error)");
                    } else {
                      console.log("[Discussions]           → Posts response received:", postsData);
                      console.log("[Discussions]           → Posts response type:", typeof postsData);
                      console.log("[Discussions]           → Is array?", Array.isArray(postsData));
                      console.log("[Discussions]           → Has Objects property?", "Objects" in postsData);
                      if (postsData.Objects) {
                        console.log("[Discussions]           → Objects is array?", Array.isArray(postsData.Objects));
                        console.log("[Discussions]           → Objects length:", postsData.Objects.length);
                      }
                    }
                    
                    // Find matching grade item for this topic
                    var matchingGradeItem = null;
                    for (var g = 0; g < gradeItems.length; g++) {
                      if (gradeItems[g].topicId === topicId) {
                        matchingGradeItem = gradeItems[g];
                        console.log("[Discussions]           → Found matching grade item for topic:", matchingGradeItem.name, "GradeItemId:", matchingGradeItem.gradeItemId);
                        break;
                      }
                    }
                    
                    // Handle both response formats: Objects array or direct array
                    var posts = null;
                    if (postsData) {
                      if (postsData.Objects && Array.isArray(postsData.Objects)) {
                        posts = postsData.Objects;
                        console.log("[Discussions]           → Using postsData.Objects array, length:", posts.length);
                      } else if (Array.isArray(postsData)) {
                        posts = postsData;
                        console.log("[Discussions]           → Using postsData as direct array, length:", posts.length);
                      } else {
                        console.log("[Discussions]           → Posts data is not in expected format");
                      }
                    }
                    
                    // Collect posts with student info and grading status
                    var topicPosts = [];
                    if (posts && posts.length) {
                      console.log("[Discussions]           → Processing", posts.length, "posts");
                      for (var l = 0; l < posts.length; l++) {
                        var post = posts[l];
                        var postingUserId = post.PostingUserId;
                        var postingUserName = post.PostingUserDisplayName || "Unknown";
                        
                        // Check if student is still enrolled (not withdrawn)
                        var userIdString = postingUserId ? postingUserId.toString() : null;
                        var isActiveStudent = userIdString && activeStudents.has(userIdString);
                        
                        if (!isActiveStudent) {
                          console.log("[Discussions]             Post", (l + 1) + ":", "SKIPPED - Student", postingUserName, "(" + postingUserId + ") is not in classlist (withdrawn)");
                          continue; // Skip posts from withdrawn students
                        }
                        
                        console.log("[Discussions]             Post", (l + 1) + ":", "ID:", post.PostId || "N/A", "User:", postingUserName, "(" + postingUserId + ") - Active student");
                        
                        // Check if this topic is gradable and if student has been graded
                        var needsAttention = false;
                        if (matchingGradeItem && postingUserId) {
                          var hasGrade = await checkStudentGrade(orgUnitId, matchingGradeItem.gradeItemId, postingUserId);
                          if (!hasGrade) {
                            needsAttention = true;
                            console.log("[Discussions]             → Student", postingUserName, "(" + postingUserId + ") needs a grade for this topic");
                          }
                        }
                        
                        topicPosts.push({
                          postId: post.PostId,
                          postingUserId: postingUserId,
                          postingUserName: postingUserName,
                          subject: post.Subject || "No subject",
                          datePosted: post.PostDate || post.DatePosted || post.CreatedDate,
                          needsAttention: needsAttention,
                          isGradable: !!matchingGradeItem
                        });
                      }
                      console.log("[Discussions]           → After filtering,", topicPosts.length, "posts from active students");
                    } else {
                      console.log("[Discussions]           → No posts found or posts array is empty");
                    }
                    
                    // Add topic to current forum
                    currentForum.topics.push({
                      topicId: topicId,
                      topicName: topic.TopicTitle || topic.Name || "Untitled Discussion",
                      isGradable: !!matchingGradeItem,
                      gradeItemId: matchingGradeItem ? matchingGradeItem.gradeItemId : null,
                      posts: topicPosts,
                      link: "/d2l/le/" + orgUnitId + "/discussions/List"
                    });
                  } catch (e) {
                    console.error("[Discussions]           ✗ Exception processing topic:", e.message || e, e.stack);
                  }
                }
              } else {
                console.log("[Discussions]       → No topics found or topics array is empty");
              }
              
              // Only add forum if it has topics
              if (currentForum.topics.length > 0) {
                forumsData.push(currentForum);
                console.log("[Discussions]     → Added forum with", currentForum.topics.length, "topics");
              }
            } catch (e) {
              console.error("[Discussions]       ✗ Exception processing forum:", e.message || e, e.stack);
            }
          }
        } else {
          console.log("[Discussions]   → No forums found or forums array is empty");
        }
      } catch (e) {
        console.error("[Discussions] ✗ Exception processing course:", e.message || e, e.stack);
      }
    }
    
    console.log("[Discussions] ===== getDiscussionsWithDetails END =====");
    console.log("[Discussions] Total forums found:", forumsData.length);
    console.log("[Discussions] Forums data:", forumsData);
    return forumsData;
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

    var badgeClass = "badge-discussion";
    var badgeText = "DISCUSSION";
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
        el("span", {}, ["Total threads: " + item.totalCount]),
        item.isGradable ? el("span", {
          style: {
            color: item.postsNeedingGrade > 0 ? "#f80" : "#0f5b46",
            fontWeight: item.postsNeedingGrade > 0 ? "600" : "400"
          }
        }, ["Posts needing grade: " + item.postsNeedingGrade]) : el("span", {
          style: {
            color: item.postsWithoutReplies > 0 ? "#f80" : "#0f5b46",
            fontWeight: item.postsWithoutReplies > 0 ? "600" : "400"
          }
        }, ["Posts without replies: " + item.postsWithoutReplies]),
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
  // RENDER WIDGET (Hierarchical Display)
  // =========================
  function renderWidget(container, forumsData, courseName) {
    container.innerHTML = "";

    // Calculate summary metrics
    var totalForums = forumsData.length;
    var totalTopics = 0;
    var totalPosts = 0;
    var needsAttention = 0;
    
    for (var i = 0; i < forumsData.length; i++) {
      var forum = forumsData[i];
      totalTopics += forum.topics.length;
      for (var j = 0; j < forum.topics.length; j++) {
        var topic = forum.topics[j];
        totalPosts += topic.posts.length;
        for (var k = 0; k < topic.posts.length; k++) {
          if (topic.posts[k].needsAttention) {
            needsAttention++;
          }
        }
      }
    }

    // Header with summary metrics
    var header = el("div", {
      style: {
        marginBottom: "24px",
        paddingBottom: "16px",
        borderBottom: "2px solid #e5e7eb"
      }
    }, [
      el("div", {
        style: { fontSize: "20px", fontWeight: "700", color: "#111", marginBottom: "8px" }
      }, ["Discussions - " + (courseName || "All Courses")]),
      el("div", {
        style: { fontSize: "14px", color: "#666", marginBottom: "12px" }
      }, [
        "Total Forums: " + totalForums + " | " +
        "Total Topics: " + totalTopics + " | " +
        "Total Posts: " + totalPosts + " | " +
        "Needs Attention: " + needsAttention
      ])
    ]);
    container.appendChild(header);

    if (forumsData.length === 0) {
      container.appendChild(el("div", {
        style: { padding: "40px", textAlign: "center", color: "#666" }
      }, ["No discussions found."]));
      return;
    }

    // Render hierarchical tree
    var hierarchyContainer = el("div", {
      style: {
        marginTop: "24px"
      }
    }, []);

    for (var i = 0; i < forumsData.length; i++) {
      var forum = forumsData[i];
      hierarchyContainer.appendChild(renderForumHierarchy(forum));
    }

    container.appendChild(hierarchyContainer);
  }

  // =========================
  // RENDER FORUM HIERARCHY (Forum > Topic > Post)
  // =========================
  function renderForumHierarchy(forum) {
    var forumDiv = el("div", {
      style: {
        marginBottom: "24px",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
        background: "#fff"
      }
    }, []);

    // Forum header
    var forumHeader = el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "16px",
        paddingBottom: "12px",
        borderBottom: "1px solid #e5e7eb"
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
            marginBottom: "4px"
          }
        }, [
          el("i", {
            className: "fas fa-comments",
            style: { color: "#0f5b46", fontSize: "18px" }
          }),
          el("h3", {
            style: {
              fontSize: "18px",
              fontWeight: "700",
              color: "#111",
              margin: 0
            }
          }, [forum.forumName])
        ]),
        el("div", {
          style: {
            fontSize: "13px",
            color: "#666",
            marginLeft: "26px"
          }
        }, [forum.courseName + (forum.courseCode ? " (" + forum.courseCode + ")" : "")])
      ])
    ]);
    forumDiv.appendChild(forumHeader);

    // Topics
    if (forum.topics.length === 0) {
      forumDiv.appendChild(el("div", {
        style: {
          padding: "16px",
          color: "#999",
          fontStyle: "italic",
          marginLeft: "20px"
        }
      }, ["No topics in this forum"]));
    } else {
      for (var j = 0; j < forum.topics.length; j++) {
        var topic = forum.topics[j];
        forumDiv.appendChild(renderTopicHierarchy(topic, j === forum.topics.length - 1));
      }
    }

    return forumDiv;
  }

  // =========================
  // RENDER TOPIC HIERARCHY (Topic > Posts)
  // =========================
  function renderTopicHierarchy(topic, isLast) {
    var topicDiv = el("div", {
      style: {
        marginLeft: "20px",
        marginBottom: "16px",
        paddingLeft: "16px",
        borderLeft: "2px solid #e5e7eb"
      }
    }, []);

    // Topic header
    var topicHeader = el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px"
      }
    }, [
      el("div", {
        style: { flex: 1 }
      }, [
        el("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }
        }, [
          el("i", {
            className: "fas fa-folder",
            style: { color: "#f80", fontSize: "16px" }
          }),
          el("h4", {
            style: {
              fontSize: "16px",
              fontWeight: "600",
              color: "#111",
              margin: 0
            }
          }, [topic.topicName]),
          topic.isGradable ? el("span", {
            style: {
              padding: "2px 6px",
              background: "#fff4e6",
              color: "#f80",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: "600"
            }
          }, ["GRADABLE"]) : null
        ])
      ]),
      el("a", {
        href: topic.link,
        target: "_blank",
        style: {
          padding: "6px 12px",
          background: "#0f5b46",
          color: "#fff",
          textDecoration: "none",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: "600"
        },
        onclick: function(e) {
          // Ensure link opens correctly
          e.stopPropagation();
        }
      }, ["Open"])
    ]);
    topicDiv.appendChild(topicHeader);

    // Posts
    if (topic.posts.length === 0) {
      topicDiv.appendChild(el("div", {
        style: {
          padding: "12px",
          color: "#999",
          fontStyle: "italic",
          marginLeft: "20px"
        }
      }, ["No posts in this topic"]));
    } else {
      for (var k = 0; k < topic.posts.length; k++) {
        var post = topic.posts[k];
        topicDiv.appendChild(renderPost(post, k === topic.posts.length - 1));
      }
    }

    return topicDiv;
  }

  // =========================
  // RENDER POST (Student name and needs attention)
  // =========================
  function renderPost(post, isLast) {
    var postDiv = el("div", {
      style: {
        marginLeft: "20px",
        marginBottom: "8px",
        padding: "12px",
        background: post.needsAttention ? "#fff4e6" : "#f9fafb",
        borderRadius: "6px",
        border: post.needsAttention ? "1px solid #f80" : "1px solid #e5e7eb"
      }
    }, [
      el("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
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
              marginBottom: "4px"
            }
          }, [
            el("i", {
              className: "fas fa-user",
              style: { color: "#666", fontSize: "14px" }
            }),
            el("span", {
              style: {
                fontSize: "14px",
                fontWeight: "600",
                color: "#111"
              }
            }, [post.postingUserName]),
            post.needsAttention ? el("span", {
              style: {
                padding: "2px 6px",
                background: "#f80",
                color: "#fff",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: "600"
              }
            }, ["NEEDS ATTENTION"]) : null
          ]),
          el("div", {
            style: {
              fontSize: "13px",
              color: "#666",
              marginLeft: "22px"
            }
          }, [
            post.subject,
            post.datePosted ? " • " + formatDate(post.datePosted) : ""
          ])
        ])
      ])
    ]);

    return postDiv;
  }

  // =========================
  // INIT
  // =========================
  async function init() {
    console.log("[Discussions] ===== INIT START =====");
    var container = document.getElementById("discussions-widget");
    if (!container) {
      console.warn("[Discussions] ✗ Discussions widget container not found");
      return;
    }
    console.log("[Discussions] Container found:", container);

    container.innerHTML = el("div", {
      style: { padding: "20px", textAlign: "center", color: "#555" }
    }, ["Loading discussions data..."]).outerHTML;

    try {
      var courseId = getUrlParameter('courseId') || "all";
      console.log("[Discussions] Course filter:", courseId);

      var courseSelect = document.getElementById("discussions-course-filter-select");
      var courses = [];

      // Live fetch for the semester selected in the header picker.
      if (window.FacultyDashboardCourses) {
        if (courseSelect) {
          courses = await window.FacultyDashboardCourses.populateCourseSelect(courseSelect, {
            activeOnly: true,
            includeAllOption: true,
            allValue: "all",
            allLabel: "All Courses",
            selectedValue: courseId,
            persistCache: true
          });
          courseSelect.onchange = function () {
            var selectedCourseId = courseSelect.value;
            var urlParams = new URLSearchParams(window.location.search);
            urlParams.set("courseId", selectedCourseId);
            window.location.search = urlParams.toString();
          };
        } else {
          courses = await window.FacultyDashboardCourses.getFacultyCourseOfferings({
            activeOnly: true
          });
          try {
            localStorage.setItem("dashboardCourses", JSON.stringify(courses));
          } catch (cacheErr) { /* ignore */ }
        }
      } else {
        var AC = activeSemesterCode();
        var coursesData = localStorage.getItem("dashboardCourses");
        if (coursesData) {
          courses = JSON.parse(coursesData).filter(function (c) {
            var code = (c.OrgUnit && c.OrgUnit.Code) ? c.OrgUnit.Code : "";
            return code.indexOf(AC) >= 0;
          });
        }
      }
      console.log("[Discussions] Loaded", courses.length, "courses");

      // Filter out MERGED and CXLD courses
      courses = courses.filter(function(c) {
        return !isMergedOrCancelledCourse(c);
      });
      console.log("[Discussions] After filtering MERGED/CXLD: ", courses.length, "courses");
      
      // Filter by course if specified
      console.log("[Discussions] Before filtering by courseId: ", courses.length, "courses");
      if (courseId !== "all") {
        console.log("[Discussions] Filtering to courseId:", courseId);
        courses = courses.filter(function(c) {
          var matches = c.OrgUnit.Id.toString() === courseId.toString();
          if (matches) {
            console.log("[Discussions] Matched course:", c.OrgUnit.Name, "ID:", c.OrgUnit.Id);
          }
          return matches;
        });
        console.log("[Discussions] After filtering: ", courses.length, "courses");
      }

      var courseName = courses.length > 0 && courseId !== "all" 
        ? (courses[0].OrgUnit.Name || "Selected Course")
        : "All Courses";

      console.log("[Discussions] Final course count:", courses.length, "Course name:", courseName);

      if (courses.length === 0) {
        console.warn("[Discussions] No courses found after filtering!");
        container.innerHTML = el("div", {
          style: { padding: "20px", textAlign: "center", color: "#666" }
        }, ["No courses found"]).outerHTML;
        return;
      }

      // Fetch discussions
      console.log("[Discussions] Starting to fetch discussions for", courses.length, "courses");
      console.log("[Discussions] Course IDs:", courses.map(function(c) { return c.OrgUnit.Id + " - " + c.OrgUnit.Name; }));
      container.innerHTML = el("div", {
        style: { padding: "20px", textAlign: "center", color: "#555" }
      }, ["Scanning courses for discussions..."]).outerHTML;

      var forumsData = await getDiscussionsWithDetails(courses);
      console.log("[Discussions] getDiscussionsWithDetails returned", forumsData.length, "forums");
      if (forumsData.length > 0) {
        console.log("[Discussions] First forum:", forumsData[0]);
      } else {
        console.warn("[Discussions] ⚠️ No forums returned! This could mean:");
        console.warn("[Discussions]   1. No forums found in courses");
        console.warn("[Discussions]   2. No topics found in forums");
        console.warn("[Discussions]   3. An error occurred during fetching");
      }

      console.log("[Discussions] Rendering widget with", forumsData.length, "forums");
      renderWidget(container, forumsData, courseName);
      console.log("[Discussions] Widget rendered");

    } catch (e) {
      console.error("[Discussions] ✗✗✗ FAILED TO LOAD DISCUSSIONS DATA ✗✗✗");
      console.error("[Discussions] Error:", e);
      console.error("[Discussions] Error message:", e.message);
      console.error("[Discussions] Error stack:", e.stack);
      container.innerHTML = el("div", {
        style: { padding: "20px", color: "#c00", background: "#fee", borderRadius: "8px" }
      }, ["Error loading discussions data: " + (e.message || String(e))]).outerHTML;
    }
    console.log("[Discussions] ===== INIT END =====");
  }

  document.addEventListener("fd-semester-viewing-change", function () {
    init();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
