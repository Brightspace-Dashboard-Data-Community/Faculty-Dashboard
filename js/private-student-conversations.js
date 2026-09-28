/**
 * Private Student Conversations
 * Creates a per-student private discussion topic locked via one-person groups.
 */
(function () {
  "use strict";

  var API_VERSION_LP = "1.51";
  var API_VERSION_LE = "1.93";

  var FORUM_NAME = "Student Private Conversations";
  var GROUP_CATEGORY_NAME = "Student Private Conversations";
  var GROUP_CODE_PREFIX = "SPC-";
  var REQUEST_GAP_MS = 120;
  var MAX_RETRIES = 4;

  var STUDENT_ROLE_IDS = {
    3: true,
    5: true,
    101: true
  };

  var ACADEMIC_ROLE_IDS = {
    102: true,
    183: true,
    108: true,
    127: true,
    160: true,
    167: true,
    174: true
  };

  var ACADEMIC_ROLE_KEYWORDS = ["instructor", "teacher", "faculty", "assistant", "ta", "mentor"];
  var STUDENT_ROLE_KEYWORDS = ["student", "learner"];
  var SHOW_SANDBOX_ALL_TERMS = true;

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var ACTIVE_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : "26/SP";
  var PREVIOUS_SEMESTER_CODE = semesterApi() ? semesterApi().getPreviousCode() : "26/WI";
  var FUTURE_SEMESTER_CODE = semesterApi() ? semesterApi().getFutureCode() : "26/FA";
  var ALLOWED_SEMESTER_CODES = {};
  ALLOWED_SEMESTER_CODES[PREVIOUS_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[ACTIVE_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[FUTURE_SEMESTER_CODE] = true;

  var state = {
    courses: [],
    courseMap: {},
    students: [],
    existingByUserId: {},
    running: false
  };

  function isAllowedSemester(sem) {
    return !!(sem && ALLOWED_SEMESTER_CODES[sem]);
  }

  function richTextInput(content) {
    return { Content: content || "", Type: "Text" };
  }

  function richText(content) {
    return { Text: content || "", Html: null };
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
  }

  function normalizeName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function studentDisplayName(student) {
    var display = (student.DisplayName || "").trim();
    if (display) return display;
    var first = (student.FirstName || "").trim();
    var last = (student.LastName || "").trim();
    if (last && first) return last + ", " + first;
    return last || first || "User " + (student.Identifier || "");
  }

  function groupCodeForStudent(student) {
    var id = String(student.Identifier || student.OrgDefinedId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) id = "unknown";
    var code = GROUP_CODE_PREFIX + id;
    return code.length > 50 ? code.slice(0, 50) : code;
  }

  function topicNameForStudent(student) {
    return studentDisplayName(student);
  }

  async function BrightspaceFetchJson(url, options) {
    var token = localStorage.getItem("X-CSRF.Token") || localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    if (opts.body && !opts.headers["Content-Type"]) {
      opts.headers["Content-Type"] = "application/json";
    }
    opts.credentials = "include";

    var attempt = 0;
    while (true) {
      attempt++;
      var res = await fetch(url, opts);
      if (res.status === 429 && attempt <= MAX_RETRIES) {
        await sleep(Math.min(2000 * attempt, 8000));
        continue;
      }
      if (!res.ok) {
        var text = await res.text().catch(function () {
          return "";
        });
        var err = new Error("HTTP " + res.status + " - " + url + (text ? " - " + text.slice(0, 400) : ""));
        err.status = res.status;
        throw err;
      }
      if (res.status === 204) return null;
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("json") >= 0 || res.status === 202) {
        return await res.json();
      }
      var raw = await res.text();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return raw;
      }
    }
  }

  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;
    while (hasMore) {
      var endpoint = bookmark
        ? "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/?bookmark=" + encodeURIComponent(bookmark)
        : "/d2l/api/lp/" + API_VERSION_LP + "/enrollments/myenrollments/";
      var data = await BrightspaceFetchJson(endpoint);
      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) allItems.push(data.Items[i]);
      }
      if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
        bookmark = data.PagingInfo.Bookmark;
      } else {
        hasMore = false;
      }
    }
    return allItems;
  }

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code === "Course Offering") return true;
    if (item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && item.Access.ClasslistRoleId != null) {
      return toInt(item.Access.ClasslistRoleId, null);
    }
    return null;
  }

  function getRoleName(item) {
    return item && item.Access && item.Access.ClasslistRoleName ? String(item.Access.ClasslistRoleName) : "";
  }

  function roleNameMatches(roleName, keywords) {
    var value = String(roleName || "").toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (value.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function isAcademicRole(roleId, roleName) {
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return true;
    if (roleId === null) return roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS);
    return false;
  }

  function isSandboxCourse(name, code) {
    var s = ((name || "") + " " + (code || "")).toLowerCase();
    return s.indexOf("sandbox") >= 0 || s.indexOf("sbx") >= 0 || s.indexOf("practice") >= 0;
  }

  function isMergedOrCancelledCourse(name, code) {
    var c = String(code || "").toUpperCase();
    var n = String(name || "").toUpperCase();
    return (
      c.indexOf("MERGED") >= 0 ||
      c.indexOf("CXLD") >= 0 ||
      n.indexOf("MERGED") >= 0 ||
      n.indexOf("CXLD") >= 0 ||
      c.indexOf("SANDBOX-") === 0
    );
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : "";
  }

  async function getMyCourseOfferings() {
    var raw = await getAllMyEnrollments();
    var out = [];
    var seen = {};

    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (!isCourseOffering(item)) continue;
      var orgUnitId = item.OrgUnit.Id;
      var name = item.OrgUnit.Name || "";
      var code = item.OrgUnit.Code || "";
      if (!orgUnitId || seen[String(orgUnitId)]) continue;
      if (isMergedOrCancelledCourse(name, code)) continue;

      var roleId = getRoleId(item);
      var roleName = getRoleName(item);
      var academic = isAcademicRole(roleId, roleName);
      var sandbox = isSandboxCourse(name, code);
      var sem = getSemesterCodeFromCourseCode(code);

      if (sandbox) {
        if (!SHOW_SANDBOX_ALL_TERMS || !academic) continue;
      } else {
        if (!academic || !isAllowedSemester(sem)) continue;
      }

      seen[String(orgUnitId)] = true;
      out.push({
        OrgUnitId: String(orgUnitId),
        Code: code,
        Name: name
      });
    }

    out.sort(function (a, b) {
      return String(a.Code || "").localeCompare(String(b.Code || ""));
    });
    return out;
  }

  function isClasslistStudent(member) {
    if (!member) return false;
    var roleId = toInt(member.RoleId, null);
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return false;
    if (roleId !== null && STUDENT_ROLE_IDS[roleId]) return true;

    var roleName = member.ClasslistRoleDisplayName || member.RoleName || "";
    if (roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS)) return false;
    if (roleNameMatches(roleName, STUDENT_ROLE_KEYWORDS)) return true;

    return roleId === null && !roleName;
  }

  async function getClasslist(orgUnitId) {
    // Prefer the non-paged classlist (same as office-hours). It returns a full array
    // and avoids ObjectListPage Next/bookmark mishandling that can duplicate users.
    try {
      var data = await BrightspaceFetchJson(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/"
      );
      if (Array.isArray(data) && data.length) {
        return dedupeClasslistUsers(data);
      }
    } catch (e) {
      console.warn("PSC: non-paged classlist failed, trying paged", e);
    }

    var all = [];
    var nextUrl = "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/classlist/paged/";
    var seenUrls = {};
    var pageCount = 0;
    var maxPages = 40;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      if (seenUrls[nextUrl]) break;
      seenUrls[nextUrl] = true;

      var page = await BrightspaceFetchJson(nextUrl);
      var objects = (page && page.Objects) || (page && page.Items) || [];
      for (var i = 0; i < objects.length; i++) all.push(objects[i]);

      var next = page && page.Next ? String(page.Next) : "";
      if (!next || !objects.length) {
        nextUrl = null;
        break;
      }

      // ObjectListPage.Next is an API URL (path or absolute), not a bare bookmark token.
      if (next.indexOf("/d2l/api/") >= 0) {
        var parts = next.split("/d2l/api/");
        nextUrl = parts.length > 1 ? "/d2l/api/" + parts[1] : null;
      } else if (next.indexOf("/") === 0) {
        nextUrl = next;
      } else {
        nextUrl =
          "/d2l/api/le/" +
          API_VERSION_LE +
          "/" +
          orgUnitId +
          "/classlist/paged/?bookmark=" +
          encodeURIComponent(next);
      }
    }

    return dedupeClasslistUsers(all);
  }

  function dedupeClasslistUsers(users) {
    var seen = {};
    var out = [];
    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      if (!user) continue;
      var key = String(user.Identifier || user.UserId || user.OrgDefinedId || "");
      if (!key) {
        key =
          "name:" +
          normalizeName(user.DisplayName || "") +
          "|" +
          normalizeName((user.FirstName || "") + " " + (user.LastName || ""));
      }
      if (seen[key]) continue;
      seen[key] = true;
      out.push(user);
    }
    return out;
  }

  async function listForums(orgUnitId) {
    var data = await BrightspaceFetchJson(
      "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/"
    );
    return Array.isArray(data) ? data : [];
  }

  async function listTopics(orgUnitId, forumId) {
    var data = await BrightspaceFetchJson(
      "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/"
    );
    return Array.isArray(data) ? data : [];
  }

  async function listGroupCategories(orgUnitId) {
    var data = await BrightspaceFetchJson(
      "/d2l/api/lp/" + API_VERSION_LP + "/" + orgUnitId + "/groupcategories/"
    );
    return Array.isArray(data) ? data : [];
  }

  async function listGroups(orgUnitId, groupCategoryId) {
    var data = await BrightspaceFetchJson(
      "/d2l/api/lp/" +
        API_VERSION_LP +
        "/" +
        orgUnitId +
        "/groupcategories/" +
        groupCategoryId +
        "/groups/"
    );
    return Array.isArray(data) ? data : [];
  }

  async function getTopicRestrictions(orgUnitId, forumId, topicId) {
    try {
      var data = await BrightspaceFetchJson(
        "/d2l/api/le/" +
          API_VERSION_LE +
          "/" +
          orgUnitId +
          "/discussions/forums/" +
          forumId +
          "/topics/" +
          topicId +
          "/groupRestrictions/"
      );
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async function waitForGroupCategoryReady(orgUnitId, groupCategoryId) {
    var maxAttempts = 40;
    for (var i = 0; i < maxAttempts; i++) {
      var status = await BrightspaceFetchJson(
        "/d2l/api/lp/" +
          API_VERSION_LP +
          "/" +
          orgUnitId +
          "/groupcategories/" +
          groupCategoryId +
          "/status"
      );
      if (status && Number(status.Status) === 1) return;
      await sleep(500);
    }
    throw new Error("Timed out waiting for group category " + groupCategoryId + " to finish creating.");
  }

  async function ensureForum(orgUnitId, log) {
    var forums = await listForums(orgUnitId);
    var existing = forums.find(function (f) {
      return normalizeName(f.Name) === normalizeName(FORUM_NAME);
    });
    if (existing) {
      log("Reusing existing forum \"" + FORUM_NAME + "\" (ID " + existing.ForumId + ").");
      return existing;
    }

    log("Creating forum \"" + FORUM_NAME + "\"…");
    var created = await BrightspaceFetchJson(
      "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/",
      {
        method: "POST",
        body: JSON.stringify({
          Name: FORUM_NAME,
          Description: richText(
            "Private one-to-one conversation spaces between each student and the instructor."
          ),
          ShowDescriptionInTopics: false,
          StartDate: null,
          EndDate: null,
          PostStartDate: null,
          PostEndDate: null,
          AllowAnonymous: false,
          IsLocked: false,
          IsHidden: false,
          RequiresApproval: false,
          MustPostToParticipate: false,
          DisplayInCalendar: false,
          DisplayPostDatesInCalendar: false,
          StartDateAvailabilityType: null,
          EndDateAvailabilityType: null
        })
      }
    );
    await sleep(REQUEST_GAP_MS);
    log("Created forum (ID " + created.ForumId + ").");
    return created;
  }

  async function ensureGroupCategory(orgUnitId, initialGroupCount, log) {
    var categories = await listGroupCategories(orgUnitId);
    var existing = categories.find(function (c) {
      return normalizeName(c.Name) === normalizeName(GROUP_CATEGORY_NAME);
    });
    if (existing) {
      log("Reusing existing group category \"" + GROUP_CATEGORY_NAME + "\" (ID " + existing.GroupCategoryId + ").");
      await waitForGroupCategoryReady(orgUnitId, existing.GroupCategoryId);
      return existing;
    }

    // NumberOfGroupsNoEnrollment requires NumberOfGroups >= 1.
    var groupCount = Math.max(1, toInt(initialGroupCount, 1) || 1);

    log("Creating group category \"" + GROUP_CATEGORY_NAME + "\" (" + groupCount + " starter group" + (groupCount === 1 ? "" : "s") + ")…");
    var job = await BrightspaceFetchJson(
      "/d2l/api/lp/" + API_VERSION_LP + "/" + orgUnitId + "/groupcategories/",
      {
        method: "POST",
        body: JSON.stringify({
          Name: GROUP_CATEGORY_NAME,
          Description: richTextInput(
            "One-person groups used to lock Student Private Conversations topics to a single student."
          ),
          EnrollmentStyle: 0,
          AutoEnroll: false,
          RandomizeEnrollments: false,
          NumberOfGroups: groupCount,
          MaxUsersPerGroup: null,
          AllocateAfterExpiry: false,
          SelfEnrollmentStartDate: null,
          SelfEnrollmentExpiryDate: null,
          GroupPrefix: null,
          RestrictedByOrgUnitId: null,
          DescriptionsVisibleToEnrolees: false
        })
      }
    );

    var categoryId = job && (job.CategoryId || job.GroupCategoryId);
    if (!categoryId) {
      throw new Error("Group category create did not return a category ID.");
    }
    await waitForGroupCategoryReady(orgUnitId, categoryId);
    await sleep(REQUEST_GAP_MS);
    log("Created group category (ID " + categoryId + ").");
    return { GroupCategoryId: categoryId, Name: GROUP_CATEGORY_NAME };
  }

  function groupEnrollmentIds(group) {
    return Array.isArray(group && group.Enrollments) ? group.Enrollments : [];
  }

  function isDefaultUnusedGroup(group) {
    if (!group) return false;
    if (groupEnrollmentIds(group).length) return false;
    var code = String(group.Code || "");
    if (code.indexOf(GROUP_CODE_PREFIX) === 0) return false;
    var name = String(group.Name || "").trim();
    return /^group\s*\d+$/i.test(name);
  }

  function takeReusableDefaultGroup(groupsByCode, groupsByName) {
    var seen = {};
    var pools = [groupsByName, groupsByCode];
    for (var p = 0; p < pools.length; p++) {
      var map = pools[p];
      for (var key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        var group = map[key];
        if (!group || seen[group.GroupId]) continue;
        seen[group.GroupId] = true;
        if (isDefaultUnusedGroup(group)) return group;
      }
    }
    return null;
  }

  async function ensureStudentGroup(orgUnitId, categoryId, student, groupsByCode, groupsByName, log) {
    var code = groupCodeForStudent(student);
    var name = studentDisplayName(student);
    var existing =
      groupsByCode[code.toLowerCase()] ||
      groupsByName[normalizeName(name)] ||
      null;

    if (existing) {
      var enrolled = groupEnrollmentIds(existing);
      var userId = toInt(student.Identifier, null);
      var alreadyIn = enrolled.some(function (id) {
        return Number(id) === userId;
      });
      if (!alreadyIn && userId !== null) {
        await BrightspaceFetchJson(
          "/d2l/api/lp/" +
            API_VERSION_LP +
            "/" +
            orgUnitId +
            "/groupcategories/" +
            categoryId +
            "/groups/" +
            existing.GroupId +
            "/enrollments/",
          {
            method: "POST",
            body: JSON.stringify({ UserId: userId })
          }
        );
        await sleep(REQUEST_GAP_MS);
      }
      return { group: existing, created: false };
    }

    var reusable = takeReusableDefaultGroup(groupsByCode, groupsByName);
    if (reusable) {
      var updated = await BrightspaceFetchJson(
        "/d2l/api/lp/" +
          API_VERSION_LP +
          "/" +
          orgUnitId +
          "/groupcategories/" +
          categoryId +
          "/groups/" +
          reusable.GroupId,
        {
          method: "PUT",
          body: JSON.stringify({
            Name: name,
            Code: code,
            Description: richTextInput("Private conversation group for " + name)
          })
        }
      );
      await sleep(REQUEST_GAP_MS);

      var userIdReuse = toInt(student.Identifier, null);
      if (userIdReuse !== null) {
        await BrightspaceFetchJson(
          "/d2l/api/lp/" +
            API_VERSION_LP +
            "/" +
            orgUnitId +
            "/groupcategories/" +
            categoryId +
            "/groups/" +
            reusable.GroupId +
            "/enrollments/",
          {
            method: "POST",
            body: JSON.stringify({ UserId: userIdReuse })
          }
        );
        await sleep(REQUEST_GAP_MS);
      }

      // Drop old default-name map entries and register under student identity.
      delete groupsByName[normalizeName(reusable.Name)];
      if (reusable.Code) delete groupsByCode[String(reusable.Code).toLowerCase()];
      var claimed = updated || Object.assign({}, reusable, { Name: name, Code: code });
      groupsByCode[code.toLowerCase()] = claimed;
      groupsByName[normalizeName(name)] = claimed;
      return { group: claimed, created: true };
    }

    var created = await BrightspaceFetchJson(
      "/d2l/api/lp/" +
        API_VERSION_LP +
        "/" +
        orgUnitId +
        "/groupcategories/" +
        categoryId +
        "/groups/",
      {
        method: "POST",
        body: JSON.stringify({
          Name: name,
          Code: code,
          Description: richTextInput("Private conversation group for " + name)
        })
      }
    );
    await sleep(REQUEST_GAP_MS);

    var userIdCreate = toInt(student.Identifier, null);
    if (userIdCreate !== null) {
      await BrightspaceFetchJson(
        "/d2l/api/lp/" +
          API_VERSION_LP +
          "/" +
          orgUnitId +
          "/groupcategories/" +
          categoryId +
          "/groups/" +
          created.GroupId +
          "/enrollments/",
        {
          method: "POST",
          body: JSON.stringify({ UserId: userIdCreate })
        }
      );
      await sleep(REQUEST_GAP_MS);
    }

    groupsByCode[code.toLowerCase()] = created;
    groupsByName[normalizeName(name)] = created;
    return { group: created, created: true };
  }

  async function ensureStudentTopic(orgUnitId, forumId, student, topicsByName, groupId) {
    var topicName = topicNameForStudent(student);
    var existing = topicsByName[normalizeName(topicName)] || null;
    var topic = existing;

    if (!topic) {
      topic = await BrightspaceFetchJson(
        "/d2l/api/le/" + API_VERSION_LE + "/" + orgUnitId + "/discussions/forums/" + forumId + "/topics/",
        {
          method: "POST",
          body: JSON.stringify({
            Name: topicName,
            Description: richTextInput(
              "Private conversation between " + topicName + " and the instructor. Only this student can see this topic."
            ),
            AllowAnonymousPosts: false,
            StartDate: null,
            EndDate: null,
            IsHidden: false,
            UnlockStartDate: null,
            UnlockEndDate: null,
            RequiresApproval: false,
            ScoreOutOf: null,
            IsAutoScore: false,
            IncludeNonScoredValues: false,
            ScoringType: null,
            IsLocked: false,
            MustPostToParticipate: false,
            RatingType: null,
            DisplayInCalendar: false,
            DisplayUnlockDatesInCalendar: false,
            GroupTypeId: null,
            StartDateAvailabilityType: null,
            EndDateAvailabilityType: null,
            DueDate: null
          })
        }
      );
      await sleep(REQUEST_GAP_MS);
      topicsByName[normalizeName(topicName)] = topic;
    }

    var restrictions = await getTopicRestrictions(orgUnitId, forumId, topic.TopicId);
    var hasGroup = restrictions.some(function (r) {
      return Number(r.GroupId) === Number(groupId);
    });
    if (!hasGroup) {
      await BrightspaceFetchJson(
        "/d2l/api/le/" +
          API_VERSION_LE +
          "/" +
          orgUnitId +
          "/discussions/forums/" +
          forumId +
          "/topics/" +
          topic.TopicId +
          "/groupRestrictions/",
        {
          method: "PUT",
          body: JSON.stringify({ GroupId: Number(groupId) })
        }
      );
      await sleep(REQUEST_GAP_MS);
    }

    return { topic: topic, created: !existing, restricted: !hasGroup || !!existing };
  }

  function setMessage(message, type) {
    var el = document.getElementById("pscMessage");
    if (!el) return;
    if (!message) {
      el.style.display = "none";
      el.className = "message-container";
      el.textContent = "";
      return;
    }
    el.style.display = "block";
    el.className = "message-container message-" + (type || "success");
    el.innerHTML = message;
  }

  function setCourseSelectEnabled(enabled) {
    var courseSelect = document.getElementById("pscCourse");
    if (courseSelect) courseSelect.disabled = !enabled;
  }

  function setButtonsDisabled(disabled) {
    var previewBtn = document.getElementById("pscPreviewBtn");
    var createBtn = document.getElementById("pscCreateBtn");
    var courseSelect = document.getElementById("pscCourse");
    var hasCourse = !!(courseSelect && courseSelect.value);
    if (previewBtn) previewBtn.disabled = disabled || !hasCourse || state.running;
    if (createBtn) createBtn.disabled = disabled || !state.students.length || state.running;
  }

  function showProgress(show) {
    var panel = document.getElementById("pscProgressPanel");
    if (panel) panel.hidden = !show;
  }

  function resetProgress() {
    var fill = document.getElementById("pscProgressFill");
    var bar = document.getElementById("pscProgressBar");
    var label = document.getElementById("pscProgressLabel");
    var count = document.getElementById("pscProgressCount");
    var log = document.getElementById("pscProgressLog");
    if (fill) fill.style.width = "0%";
    if (bar) bar.setAttribute("aria-valuenow", "0");
    if (label) label.textContent = "Working…";
    if (count) count.textContent = "";
    if (log) log.innerHTML = "";
  }

  function updateProgress(done, total, labelText) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var fill = document.getElementById("pscProgressFill");
    var bar = document.getElementById("pscProgressBar");
    var label = document.getElementById("pscProgressLabel");
    var count = document.getElementById("pscProgressCount");
    if (fill) fill.style.width = pct + "%";
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    if (label) label.textContent = labelText || "Working…";
    if (count) count.textContent = done + " / " + total;
  }

  function appendLog(message, kind) {
    var log = document.getElementById("pscProgressLog");
    if (!log) return;
    var li = document.createElement("li");
    li.className = kind ? "psc-log-" + kind : "";
    li.textContent = message;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  function appendOption(select, value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  async function loadCourses() {
    var select = document.getElementById("pscCourse");
    select.innerHTML = '<option value="">Loading your courses…</option>';
    setCourseSelectEnabled(false);
    setButtonsDisabled(true);
    try {
      var courses = await getMyCourseOfferings();
      state.courses = courses;
      state.courseMap = {};
      for (var i = 0; i < courses.length; i++) {
        state.courseMap[courses[i].OrgUnitId] = courses[i];
      }
      select.innerHTML = '<option value="">Choose a course…</option>';
      for (var j = 0; j < courses.length; j++) {
        appendOption(select, courses[j].OrgUnitId, courses[j].Code + " — " + courses[j].Name);
      }
      if (!courses.length) {
        select.innerHTML = '<option value="">No eligible courses found</option>';
        setMessage(
          "No faculty course offerings were found for " +
            PREVIOUS_SEMESTER_CODE +
            ", " +
            ACTIVE_SEMESTER_CODE +
            ", or " +
            FUTURE_SEMESTER_CODE +
            ".",
          "error"
        );
      }
      setCourseSelectEnabled(true);
    } catch (e) {
      console.error("PSC: failed to load courses", e);
      select.innerHTML = '<option value="">Failed to load courses</option>';
      setMessage("Unable to load your courses from Brightspace right now.", "error");
      setCourseSelectEnabled(true);
    }
    setButtonsDisabled(false);
  }

  async function buildExistingMap(orgUnitId) {
    var map = {};
    var forums = await listForums(orgUnitId);
    var forum = forums.find(function (f) {
      return normalizeName(f.Name) === normalizeName(FORUM_NAME);
    });
    if (!forum) return map;

    var topics = await listTopics(orgUnitId, forum.ForumId);
    var topicsByName = {};
    for (var t = 0; t < topics.length; t++) {
      topicsByName[normalizeName(topics[t].Name)] = topics[t];
    }

    var categories = await listGroupCategories(orgUnitId);
    var category = categories.find(function (c) {
      return normalizeName(c.Name) === normalizeName(GROUP_CATEGORY_NAME);
    });
    var groupsByCode = {};
    var groupsByName = {};
    if (category) {
      var groups = await listGroups(orgUnitId, category.GroupCategoryId);
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (group.Code) groupsByCode[String(group.Code).toLowerCase()] = group;
        groupsByName[normalizeName(group.Name)] = group;
      }
    }

    return {
      forum: forum,
      topicsByName: topicsByName,
      groupsByCode: groupsByCode,
      groupsByName: groupsByName,
      category: category || null
    };
  }

  function statusForStudent(student, existing) {
    if (!existing || !existing.topicsByName) return "Will create";
    var topic = existing.topicsByName[normalizeName(topicNameForStudent(student))];
    var code = groupCodeForStudent(student).toLowerCase();
    var group =
      (existing.groupsByCode && existing.groupsByCode[code]) ||
      (existing.groupsByName && existing.groupsByName[normalizeName(studentDisplayName(student))]);
    if (topic && group) return "Already set up";
    if (topic || group) return "Partial — will finish";
    return "Will create";
  }

  function renderPreview() {
    var panel = document.getElementById("pscPreviewPanel");
    var body = document.getElementById("pscPreviewBody");
    var summary = document.getElementById("pscPreviewSummary");
    if (!panel || !body || !summary) return;

    panel.hidden = false;
    body.innerHTML = "";

    var willCreate = 0;
    var already = 0;
    var partial = 0;

    for (var i = 0; i < state.students.length; i++) {
      var student = state.students[i];
      var status = statusForStudent(student, state.existingByUserId);
      if (status === "Already set up") already++;
      else if (status.indexOf("Partial") === 0) partial++;
      else willCreate++;

      var tr = document.createElement("tr");
      var statusClass =
        status === "Already set up" ? "psc-status-done" : status.indexOf("Partial") === 0 ? "psc-status-partial" : "psc-status-new";
      tr.innerHTML =
        "<td>" +
        escapeHtml(studentDisplayName(student)) +
        "</td><td>" +
        escapeHtml(student.Username || student.OrgDefinedId || student.Identifier || "") +
        '</td><td><span class="psc-status ' +
        statusClass +
        '">' +
        escapeHtml(status) +
        "</span></td>";
      body.appendChild(tr);
    }

    summary.textContent =
      state.students.length +
      " student" +
      (state.students.length === 1 ? "" : "s") +
      " — " +
      willCreate +
      " new, " +
      partial +
      " partial, " +
      already +
      " already set up.";
  }

  async function onPreview() {
    var courseId = document.getElementById("pscCourse").value;
    if (!courseId) {
      setMessage("Choose a course first.", "error");
      return;
    }

    setMessage("Loading classlist and checking existing private conversations…", "success");
    setButtonsDisabled(true);
    try {
      var classlist = await getClasslist(courseId);
      state.students = classlist
        .filter(isClasslistStudent)
        .sort(function (a, b) {
          return studentDisplayName(a).localeCompare(studentDisplayName(b));
        });
      state.existingByUserId = await buildExistingMap(courseId);
      renderPreview();
      setButtonsDisabled(false);
      if (!state.students.length) {
        setMessage("No students were found in this course classlist.", "warning");
      } else {
        setMessage(
          "Preview ready. Review the list, then create private conversations for students who still need them.",
          "success"
        );
      }
    } catch (e) {
      console.error("PSC: preview failed", e);
      setButtonsDisabled(false);
      setMessage("Unable to load the classlist or existing discussions: " + escapeHtml(e.message), "error");
    }
  }

  async function deployPrivateConversationsToCourse(orgUnitId, options) {
    options = options || {};
    var log = typeof options.log === "function" ? options.log : function () {};
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : function () {};

    var students = options.students;
    if (!students || !students.length) {
      var classlist = await getClasslist(orgUnitId);
      students = classlist.filter(isClasslistStudent);
      students.sort(function (a, b) {
        return studentDisplayName(a).localeCompare(studentDisplayName(b));
      });
    }
    if (!students.length) {
      throw new Error("No students found in the classlist for private discussion boards.");
    }

    var createdTopics = 0;
    var skipped = 0;
    var errors = [];
    var total = students.length + 2;

    onProgress(0, total, "Creating forum and group category…");
    var forum = await ensureForum(orgUnitId, log);
    onProgress(1, total, "Creating forum and group category…");
    var category = await ensureGroupCategory(orgUnitId, students.length, log);
    onProgress(2, total, "Processing students…");

    var topics = await listTopics(orgUnitId, forum.ForumId);
    var topicsByName = {};
    for (var t = 0; t < topics.length; t++) {
      topicsByName[normalizeName(topics[t].Name)] = topics[t];
    }

    var groups = await listGroups(orgUnitId, category.GroupCategoryId);
    var groupsByCode = {};
    var groupsByName = {};
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].Code) groupsByCode[String(groups[g].Code).toLowerCase()] = groups[g];
      groupsByName[normalizeName(groups[g].Name)] = groups[g];
    }

    for (var i = 0; i < students.length; i++) {
      var student = students[i];
      var name = studentDisplayName(student);
      onProgress(2 + i, total, "Setting up " + name + "…");

      try {
        var beforeTopic = topicsByName[normalizeName(topicNameForStudent(student))];
        var groupResult = await ensureStudentGroup(
          orgUnitId,
          category.GroupCategoryId,
          student,
          groupsByCode,
          groupsByName,
          log
        );
        var topicResult = await ensureStudentTopic(
          orgUnitId,
          forum.ForumId,
          student,
          topicsByName,
          groupResult.group.GroupId
        );

        if (beforeTopic && !groupResult.created && !topicResult.created) {
          skipped++;
          log("Skipped " + name + " (already set up).", "skip");
        } else {
          createdTopics++;
          log((topicResult.created ? "Created" : "Updated") + " private topic for " + name + ".", "ok");
        }
      } catch (studentErr) {
        console.error("PSC: student setup failed", student, studentErr);
        errors.push(name + ": " + studentErr.message);
        log("Failed for " + name + ": " + studentErr.message, "err");
      }
    }

    return { created: createdTopics, skipped: skipped, errors: errors, studentCount: students.length };
  }

  async function onCreate(event) {
    event.preventDefault();
    if (state.running) return;

    var courseId = document.getElementById("pscCourse").value;
    if (!courseId) {
      setMessage("Choose a course first.", "error");
      return;
    }

    if (!state.students.length) {
      await onPreview();
      if (!state.students.length) return;
    }

    state.running = true;
    setCourseSelectEnabled(false);
    setButtonsDisabled(true);
    setMessage("", "");
    showProgress(true);
    resetProgress();

    try {
      var result = await deployPrivateConversationsToCourse(courseId, {
        students: state.students,
        onProgress: function (done, total, label) {
          updateProgress(done, total, label);
        },
        log: function (msg, kind) {
          appendLog(msg, kind);
        }
      });

      updateProgress(1, 1, "Done");
      await onPreview();

      var summaryParts = [
        "<strong>Finished.</strong> ",
        result.created + " created or updated, ",
        result.skipped + " already set up"
      ];
      if (result.errors.length) {
        summaryParts.push(", " + result.errors.length + " error" + (result.errors.length === 1 ? "" : "s") + ".");
        summaryParts.push("<ul style=\"margin:8px 0 0 1.1rem;\">");
        for (var e = 0; e < Math.min(result.errors.length, 8); e++) {
          summaryParts.push("<li>" + escapeHtml(result.errors[e]) + "</li>");
        }
        if (result.errors.length > 8) summaryParts.push("<li>…and " + (result.errors.length - 8) + " more</li>");
        summaryParts.push("</ul>");
        setMessage(summaryParts.join(""), "warning");
      } else {
        summaryParts.push(".");
        setMessage(summaryParts.join(""), "success");
      }
    } catch (e) {
      console.error("PSC: create failed", e);
      appendLog("Stopped: " + e.message, "err");
      setMessage("Unable to finish setup: " + escapeHtml(e.message), "error");
    }

    state.running = false;
    setCourseSelectEnabled(true);
    setButtonsDisabled(false);
  }

  window.PrivateStudentConversationsAPI = {
    deployToCourse: deployPrivateConversationsToCourse
  };

  function onCourseChange() {
    state.students = [];
    state.existingByUserId = {};
    var panel = document.getElementById("pscPreviewPanel");
    if (panel) panel.hidden = true;
    showProgress(false);
    setMessage("", "");
    setCourseSelectEnabled(true);
    setButtonsDisabled(false);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("pscForm");
    if (!form) return;
    var previewBtn = document.getElementById("pscPreviewBtn");
    var courseSelect = document.getElementById("pscCourse");
    form.addEventListener("submit", onCreate);
    if (previewBtn) previewBtn.addEventListener("click", onPreview);
    if (courseSelect) courseSelect.addEventListener("change", onCourseChange);
    loadCourses();
  });
})();
