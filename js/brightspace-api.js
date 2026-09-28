/**
 * Shared Brightspace API helpers for Faculty Dashboard tools.
 * Minimal BSP.api shim used by ported Archive tool modules.
 */
(function (global) {
  "use strict";

  var LP = "1.62";
  var LE = "1.96";

  function xsrfHeaders() {
    var token = "";
    try {
      token = localStorage.getItem("XSRF.Token") || "";
    } catch (e) {
      /* ignore */
    }
    return {
      "X-CSRF-TOKEN": token,
      Accept: "application/json"
    };
  }

  async function raw(url, options) {
    options = options || {};
    var headers = Object.assign({}, xsrfHeaders(), options.headers || {});
    var res = await fetch(url, {
      credentials: "include",
      method: options.method || "GET",
      headers: headers,
      body: options.body
    });
    if (!res.ok) {
      var err = new Error("HTTP " + res.status + " — " + url);
      err.status = res.status;
      try {
        err.body = await res.text();
      } catch (e) {
        /* ignore */
      }
      throw err;
    }
    if (res.status === 204) return null;
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") >= 0) return res.json();
    return res.text();
  }

  async function paged(path, onPage) {
    var bookmark = "";
    var out = [];
    var safety = 1000;
    while (safety-- > 0) {
      var sep = path.indexOf("?") >= 0 ? "&" : "?";
      var url = bookmark ? path + sep + "bookmark=" + encodeURIComponent(bookmark) : path;
      var page = await raw(url);
      if (!page) break;
      var items = Array.isArray(page) ? page : page.Items || page.PagedResultSet || [];
      if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i++) out.push(items[i]);
      }
      var pi = (page && page.PagingInfo) || page || {};
      var more = pi.HasMoreItems || page.Next;
      bookmark = pi.Bookmark || "";
      if (typeof onPage === "function") {
        try {
          onPage(out.length, bookmark);
        } catch (e) {
          /* ignore */
        }
      }
      if (!more || !bookmark) break;
    }
    return out;
  }

  var api = {
    LP: LP,
    LE: LE,
    raw: raw,
    paged: paged,
    whoami: function () {
      return raw("/d2l/api/lp/" + LP + "/users/whoami");
    },
    courseInfo: function (oid) {
      return raw("/d2l/api/lp/" + LP + "/courses/" + oid);
    },
    classlist: function (oid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/classlist/");
    },
    myEnrollments: function () {
      return paged("/d2l/api/lp/" + LP + "/enrollments/myenrollments/?orgUnitTypeId=3");
    },
    forums: function (oid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/discussions/forums/");
    },
    forumTopics: function (oid, fid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/discussions/forums/" + fid + "/topics/");
    },
    topicPosts: function (oid, fid, tid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/discussions/forums/" + fid + "/topics/" + tid + "/posts/");
    },
    dropboxFolders: function (oid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/dropbox/folders/");
    },
    dropboxSubs: function (oid, fid) {
      return raw(
        "/d2l/api/le/" + LE + "/" + oid + "/dropbox/folders/" + fid + "/submissions/?activeOnly=true"
      ).catch(function () {
        return [];
      });
    },
    dropboxSub: function (oid, fid, uid) {
      return raw(
        "/d2l/api/le/" + LE + "/" + oid + "/dropbox/folders/" + fid + "/submissions/" + uid
      ).catch(function () {
        return null;
      });
    },
    quizzes: function (oid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/quizzes/").catch(function () {
        return [];
      });
    },
    quizAttempts: function (oid, qid, uid) {
      // Brightspace quiz attempts are listed per quiz; filter by UserId client-side.
      // The /attempts/{userId} path is not reliable across LE versions.
      var base = "/d2l/api/le/" + LE + "/" + oid + "/quizzes/" + qid + "/attempts/";
      return raw(base).catch(function () {
        return [];
      });
    },
    gradeValues: function (oid, uid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/grades/values/" + uid + "/").catch(function () {
        return [];
      });
    },
    gradeFinal: function (oid, uid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/grades/final/values/" + uid).catch(function () {
        return null;
      });
    },
    lastAccess: function (oid, uid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/access/" + uid).catch(function () {
        return null;
      });
    },
    classlistPaged: async function (oid) {
      var nextUrl = "/d2l/api/le/" + LE + "/" + oid + "/classlist/paged/";
      var out = [];
      var seen = {};
      var safety = 40;
      while (nextUrl && safety-- > 0) {
        if (seen[nextUrl]) break;
        seen[nextUrl] = true;
        var page = await raw(nextUrl).catch(function () {
          return null;
        });
        if (!page) break;
        var items = page.Objects || page.Items || [];
        if (Array.isArray(items)) {
          for (var i = 0; i < items.length; i++) out.push(items[i]);
        }
        var next = page.Next ? String(page.Next) : "";
        if (!next || !items.length) break;
        if (next.indexOf("/d2l/api/") >= 0) {
          var parts = next.split("/d2l/api/");
          nextUrl = parts.length > 1 ? "/d2l/api/" + parts[1] : null;
        } else if (next.indexOf("/") === 0) {
          nextUrl = next;
        } else {
          nextUrl =
            "/d2l/api/le/" + LE + "/" + oid + "/classlist/paged/?bookmark=" + encodeURIComponent(next);
        }
      }
      return out;
    },
    contentToc: function (oid) {
      return raw("/d2l/api/le/" + LE + "/" + oid + "/content/toc").catch(function () {
        return null;
      });
    },
    findUserByOrgDefinedId: async function (orgDefinedId) {
      var data = await raw(
        "/d2l/api/lp/" + LP + "/users/?orgDefinedId=" + encodeURIComponent(orgDefinedId)
      );
      if (!data) return null;
      if (Array.isArray(data)) return data[0] || null;
      if (data.Items && data.Items.length) return data.Items[0];
      if (data.UserId != null || data.Identifier != null) return data;
      return null;
    },
    getEnrollment: function (orgUnitId, userId) {
      return raw(
        "/d2l/api/lp/" +
          LP +
          "/enrollments/orgUnits/" +
          encodeURIComponent(orgUnitId) +
          "/users/" +
          encodeURIComponent(userId)
      );
    },
    enroll: async function (orgUnitId, userId, roleId) {
      var payload = {
        OrgUnitId: Number(orgUnitId),
        UserId: Number(userId),
        RoleId: Number(roleId),
        SendEnrollmentEmail: false
      };
      var url = "/d2l/api/lp/" + LP + "/enrollments/";
      var headers = { "Content-Type": "application/json" };
      try {
        return await raw(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload)
        });
      } catch (e) {
        if (e.status !== 400 && e.status !== 415) throw e;
        return raw(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ CreateEnrollmentData: payload })
        });
      }
    },
    unenroll: function (orgUnitId, userId) {
      return raw(
        "/d2l/api/lp/" +
          LP +
          "/enrollments/orgUnits/" +
          encodeURIComponent(orgUnitId) +
          "/users/" +
          encodeURIComponent(userId),
        { method: "DELETE" }
      );
    }
  };

  global.BrightspaceApi = api;
  global.BSP = global.BSP || {};
  global.BSP.api = api;
  global.BSP.state = global.BSP.state || {};
})(window);
