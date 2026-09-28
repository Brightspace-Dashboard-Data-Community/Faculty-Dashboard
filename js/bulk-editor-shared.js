/**
 * Shared helpers for Faculty Dashboard bulk editors.
 * XSRF warm/retry, PUT helpers, rich-text round-trip, date inputs.
 */
(function (global) {
  "use strict";

  var BSP = (global.BSP = global.BSP || {});
  BSP.modules = BSP.modules || {};

  var LE_DEFAULT = (BSP.api && BSP.api.LE) || "1.96";
  var LE_DROPBOX = "1.82";
  var LE_GRADES = "1.96";
  var _xsrfRefreshing = null;

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function dateOnlyFromIso(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** YYYY-MM-DD → ISO at 23:59 local (due-date style). */
  function isoFromDateOnly(dateStr, endOfDay) {
    if (!dateStr) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    var h = endOfDay === false ? 0 : 23;
    var min = endOfDay === false ? 0 : 59;
    var dt = new Date(+m[1], +m[2] - 1, +m[3], h, min, 0, 0);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  async function ensureXsrfToken() {
    var cached = "";
    try {
      cached = localStorage.getItem("XSRF.Token") || "";
    } catch (e) {
      /* ignore */
    }
    if (cached) return cached;
    if (_xsrfRefreshing) return _xsrfRefreshing;
    _xsrfRefreshing = (async function () {
      try {
        var r = await fetch("/d2l/home", { credentials: "include" });
        if (!r.ok) return "";
        var html = await r.text();
        var m = html.match(/setItem\s*\(\s*["']XSRF\.Token["']\s*,\s*["']([^"']+)["']/);
        if (!m) return "";
        var token = m[1];
        try {
          localStorage.setItem("XSRF.Token", token);
        } catch (e) {
          /* ignore */
        }
        try {
          localStorage.removeItem("Session.Expired");
        } catch (e) {
          /* ignore */
        }
        return token;
      } finally {
        _xsrfRefreshing = null;
      }
    })();
    return _xsrfRefreshing;
  }

  function xsrfHeaders(json) {
    var token = "";
    try {
      token = localStorage.getItem("XSRF.Token") || "";
    } catch (e) {
      /* ignore */
    }
    var h = {
      "X-CSRF-TOKEN": token,
      Accept: "application/json"
    };
    if (json !== false) h["Content-Type"] = "application/json; charset=utf-8";
    return h;
  }

  async function putJson(url, body) {
    var send = function () {
      return fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: xsrfHeaders(true),
        body: JSON.stringify(body)
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrfToken();
      r = await send();
    }
    if (!r.ok) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    var ct = r.headers.get("content-type") || "";
    if (r.status === 204 || !ct) return null;
    if (ct.indexOf("application/json") >= 0) {
      try {
        return await r.json();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async function postJson(url, body) {
    var send = function () {
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: xsrfHeaders(true),
        body: JSON.stringify(body)
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrfToken();
      r = await send();
    }
    if (!r.ok) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    if (r.status === 204) return null;
    try {
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  function buildMultipartMixed(jsonObj) {
    var boundary = "xxBOUNDARYxx" + Date.now();
    var crlf = "\r\n";
    var parts = [];
    parts.push("--" + boundary + crlf);
    parts.push("Content-Type: application/json" + crlf + crlf);
    parts.push(JSON.stringify(jsonObj));
    parts.push(crlf);
    parts.push("--" + boundary + "--" + crlf);
    return {
      body: new Blob(parts),
      contentType: "multipart/mixed;boundary=" + boundary
    };
  }

  async function putMultipart(url, jsonObj) {
    var packed = buildMultipartMixed(jsonObj);
    var send = function () {
      var headers = xsrfHeaders(false);
      headers["Content-Type"] = packed.contentType;
      return fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: headers,
        body: packed.body
      });
    };
    var r = await send();
    if (r.status === 403) {
      try {
        localStorage.removeItem("XSRF.Token");
      } catch (e) {
        /* ignore */
      }
      await ensureXsrfToken();
      r = await send();
    }
    if (!r.ok) {
      var detail = "";
      try {
        detail = (await r.text()).slice(0, 400);
      } catch (e) {
        /* ignore */
      }
      var err = new Error("HTTP " + r.status + (detail ? " — " + detail : ""));
      err.status = r.status;
      throw err;
    }
    if (r.status === 204) return null;
    try {
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  function richTextOut(inner) {
    if (!inner) return { Content: "", Type: "Text" };
    if (typeof inner === "string") {
      return { Content: inner, Type: /<\w+/.test(inner) ? "Html" : "Text" };
    }
    if (typeof inner.Html === "string" && inner.Html.trim() !== "") {
      return { Content: inner.Html, Type: "Html" };
    }
    if (typeof inner.Text === "string" && inner.Text !== "") {
      return { Content: inner.Text, Type: "Text" };
    }
    if (typeof inner.Content === "string" && inner.Type) {
      return { Content: inner.Content, Type: inner.Type };
    }
    return { Content: "", Type: "Text" };
  }

  function quizRtField(composite) {
    return {
      Text: richTextOut(composite && composite.Text),
      IsDisplayed: !!(composite && composite.IsDisplayed)
    };
  }

  function buildQuizUpdateBody(orig, overrides) {
    overrides = overrides || {};
    var flatAttempts =
      orig.AttemptsAllowed && orig.AttemptsAllowed.IsUnlimited
        ? null
        : orig.AttemptsAllowed
          ? orig.AttemptsAllowed.NumberOfAttemptsAllowed
          : orig.NumberOfAttemptsAllowed != null
            ? orig.NumberOfAttemptsAllowed
            : null;
    if (flatAttempts != null) {
      flatAttempts = Number(flatAttempts);
      if (isNaN(flatAttempts) || flatAttempts < 1 || flatAttempts > 10) flatAttempts = null;
    }
    var autoExport = !!orig.AutoExportToGrades && orig.GradeItemId != null;
    var startDate = overrides.StartDate !== undefined ? overrides.StartDate : orig.StartDate;
    var endDate = overrides.EndDate !== undefined ? overrides.EndDate : orig.EndDate;
    var dueDate = overrides.DueDate !== undefined ? overrides.DueDate : orig.DueDate;
    if (endDate && dueDate) {
      var endMs = new Date(endDate).getTime();
      var dueMs = new Date(dueDate).getTime();
      if (!isNaN(endMs) && !isNaN(dueMs) && dueMs > endMs) endDate = dueDate;
    }

    var late = orig.LateSubmissionInfo || {};
    var lateOpt = Number(late.LateSubmissionOption);
    if (isNaN(lateOpt) || lateOpt === 1) lateOpt = lateOpt === 1 ? 2 : 0;

    var tl = orig.SubmissionTimeLimit || {};
    var tlValue = tl.TimeLimitValue;
    if (tlValue == null) tlValue = tl.TimeLimit;
    tlValue = Number(tlValue);
    if (isNaN(tlValue) || tlValue < 0) tlValue = 0;
    if (tlValue > 9999) tlValue = 9999;
    var tlEnforced = !!(tl.IsEnforced || tl.Enforced);

    var password = overrides.Password !== undefined ? overrides.Password : orig.Password;
    if (password != null && String(password).trim() === "") password = null;
    var email =
      overrides.NotificationEmail !== undefined ? overrides.NotificationEmail : orig.NotificationEmail;
    if (email != null && String(email).trim() === "") email = null;

    var deduction = orig.DeductionPercentage;
    if (deduction != null) {
      deduction = Number(deduction);
      if (isNaN(deduction) || deduction < 0 || deduction > 100) deduction = null;
    }

    var displayInCalendar =
      overrides.DisplayInCalendar !== undefined
        ? !!overrides.DisplayInCalendar
        : !!orig.DisplayInCalendar;
    if (displayInCalendar && !startDate && !endDate && dueDate) endDate = dueDate;
    if (displayInCalendar && !startDate && !endDate) displayInCalendar = false;

    // Quiz.QuizData for LE 1.82+ (July 2026 docs). HideQuestionPoints required
    // as of 1.88; IsSingleSession required as of 1.92. PagingTypeId added 1.78.
    return {
      Name: overrides.Name !== undefined ? overrides.Name : orig.Name,
      IsActive: overrides.IsActive !== undefined ? !!overrides.IsActive : !!orig.IsActive,
      SortOrder: orig.SortOrder != null ? Number(orig.SortOrder) || 1 : 1,
      AutoExportToGrades: autoExport,
      GradeItemId: orig.GradeItemId != null ? orig.GradeItemId : null,
      IsAutoSetGraded: !!orig.IsAutoSetGraded,
      Instructions: quizRtField(orig.Instructions),
      Description: quizRtField(orig.Description),
      Header: quizRtField(orig.Header),
      Footer: quizRtField(orig.Footer),
      StartDate: startDate || null,
      EndDate: endDate || null,
      DueDate: dueDate || null,
      DisplayInCalendar: displayInCalendar,
      NumberOfAttemptsAllowed: flatAttempts,
      LateSubmissionInfo: {
        LateSubmissionOption: lateOpt,
        LateLimitMinutes: null
      },
      SubmissionTimeLimit: {
        IsEnforced: tlEnforced,
        ShowClock: tl.ShowClock != null ? !!tl.ShowClock : tlEnforced,
        TimeLimitValue: tlValue
      },
      SubmissionGracePeriod:
        typeof orig.SubmissionGracePeriod === "number" ? orig.SubmissionGracePeriod : 0,
      Password: password,
      AllowHints: !!orig.AllowHints,
      DisableRightClick: !!orig.DisableRightClick,
      DisablePagerAndAlerts: !!orig.DisablePagerAndAlerts,
      NotificationEmail: email,
      CalcTypeId: orig.CalcTypeId != null ? Number(orig.CalcTypeId) || 1 : 1,
      RestrictIPAddressRange:
        orig.RestrictIPAddressRange && orig.RestrictIPAddressRange.length
          ? orig.RestrictIPAddressRange
          : null,
      CategoryId: orig.CategoryId != null ? orig.CategoryId : null,
      PreventMovingBackwards: !!orig.PreventMovingBackwards,
      Shuffle: !!orig.Shuffle,
      AllowOnlyUsersWithSpecialAccess: !!orig.AllowOnlyUsersWithSpecialAccess,
      IsRetakeIncorrectOnly: !!orig.IsRetakeIncorrectOnly,
      PagingTypeId: orig.PagingTypeId != null ? Number(orig.PagingTypeId) : 0,
      IsSynchronous: !!orig.IsSynchronous,
      DeductionPercentage: deduction,
      HideQuestionPoints: !!orig.HideQuestionPoints,
      IsSingleSession: !!orig.IsSingleSession
    };
  }

  function buildDropboxUpdateBody(orig, overrides) {
    overrides = overrides || {};
    var availability = orig.Availability ? Object.assign({}, orig.Availability) : {};
    if (overrides.StartDate !== undefined) availability.StartDate = overrides.StartDate;
    if (overrides.EndDate !== undefined) availability.EndDate = overrides.EndDate;
    if (overrides.AvailabilityIsHidden !== undefined) {
      availability.IsHidden = !!overrides.AvailabilityIsHidden;
    }
    var hasAvailKeys = Object.keys(availability).length > 0;
    return {
      Name: orig.Name,
      CategoryId: orig.CategoryId != null ? orig.CategoryId : null,
      Availability: hasAvailKeys ? availability : orig.Availability || null,
      GroupTypeId: orig.GroupTypeId != null ? orig.GroupTypeId : null,
      DueDate: overrides.DueDate !== undefined ? overrides.DueDate : orig.DueDate,
      DisplayInCalendar:
        overrides.DisplayInCalendar !== undefined
          ? !!overrides.DisplayInCalendar
          : !!orig.DisplayInCalendar,
      NotificationEmail: orig.NotificationEmail || null,
      GradeItemId: orig.GradeItemId != null ? orig.GradeItemId : null
    };
  }

  function buildDiscussionTopicUpdateBody(orig, overrides) {
    overrides = overrides || {};
    var desc = orig.Description;
    var descriptionOut;
    if (desc && (desc.Content != null || desc.Type)) {
      descriptionOut = { Content: desc.Content || "", Type: desc.Type || "Text" };
    } else {
      descriptionOut = richTextOut(desc);
    }
    return {
      Name: overrides.Name !== undefined ? overrides.Name : orig.Name,
      Description: descriptionOut,
      AllowAnonymousPosts:
        overrides.AllowAnonymousPosts !== undefined
          ? !!overrides.AllowAnonymousPosts
          : !!orig.AllowAnonymousPosts,
      StartDate: overrides.StartDate !== undefined ? overrides.StartDate : orig.StartDate || null,
      EndDate: overrides.EndDate !== undefined ? overrides.EndDate : orig.EndDate || null,
      IsHidden: overrides.IsHidden !== undefined ? !!overrides.IsHidden : !!orig.IsHidden,
      UnlockStartDate: orig.UnlockStartDate || null,
      UnlockEndDate: orig.UnlockEndDate || null,
      RequiresApproval:
        overrides.RequiresApproval !== undefined
          ? !!overrides.RequiresApproval
          : !!orig.RequiresApproval,
      ScoreOutOf: orig.ScoreOutOf != null ? orig.ScoreOutOf : null,
      IsAutoScore: !!orig.IsAutoScore,
      IncludeNonScoredValues: !!orig.IncludeNonScoredValues,
      ScoringType: orig.ScoringType != null ? orig.ScoringType : null,
      IsLocked: overrides.IsLocked !== undefined ? !!overrides.IsLocked : !!orig.IsLocked,
      MustPostToParticipate:
        overrides.MustPostToParticipate !== undefined
          ? !!overrides.MustPostToParticipate
          : !!orig.MustPostToParticipate,
      RatingType: orig.RatingType != null ? orig.RatingType : null,
      DisplayInCalendar:
        overrides.DisplayInCalendar !== undefined
          ? !!overrides.DisplayInCalendar
          : !!orig.DisplayInCalendar,
      DisplayUnlockDatesInCalendar: !!orig.DisplayUnlockDatesInCalendar,
      GroupTypeId: orig.GroupTypeId != null ? orig.GroupTypeId : null,
      StartDateAvailabilityType: orig.StartDateAvailabilityType != null ? orig.StartDateAvailabilityType : null,
      EndDateAvailabilityType: orig.EndDateAvailabilityType != null ? orig.EndDateAvailabilityType : null,
      DueDate: overrides.DueDate !== undefined ? overrides.DueDate : orig.DueDate || null
    };
  }

  function buildGradeItemUpdateBody(orig, overrides) {
    overrides = overrides || {};
    var gradeType = orig.GradeType || orig.GradeObjectTypeName || "Numeric";
    if (typeof gradeType === "number") {
      gradeType = gradeType === 1 ? "Numeric" : String(gradeType);
    }
    var body = {
      MaxPoints:
        overrides.MaxPoints !== undefined
          ? Number(overrides.MaxPoints)
          : Number(orig.MaxPoints != null ? orig.MaxPoints : 0),
      CanExceedMaxPoints:
        overrides.CanExceedMaxPoints !== undefined
          ? !!overrides.CanExceedMaxPoints
          : !!orig.CanExceedMaxPoints,
      IsBonus: overrides.IsBonus !== undefined ? !!overrides.IsBonus : !!orig.IsBonus,
      ExcludeFromFinalGradeCalculation:
        overrides.ExcludeFromFinalGradeCalculation !== undefined
          ? !!overrides.ExcludeFromFinalGradeCalculation
          : !!orig.ExcludeFromFinalGradeCalculation,
      GradeSchemeId: orig.GradeSchemeId != null ? orig.GradeSchemeId : null,
      Name: overrides.Name !== undefined ? overrides.Name : orig.Name,
      ShortName:
        overrides.ShortName !== undefined
          ? overrides.ShortName
          : orig.ShortName != null
            ? orig.ShortName
            : "",
      GradeType: gradeType,
      CategoryId: overrides.CategoryId !== undefined ? overrides.CategoryId : orig.CategoryId,
      Description: richTextOut(orig.Description),
      AssociatedTool: orig.AssociatedTool || null,
      IsHidden: overrides.IsHidden !== undefined ? !!overrides.IsHidden : !!orig.IsHidden
    };
    if (overrides.Weight !== undefined) {
      body.Weight = Number(overrides.Weight);
    } else if (orig.Weight != null) {
      body.Weight = Number(orig.Weight);
    }
    return body;
  }

  async function wireCourseSelect(selectId, onSelect) {
    var courseSelect = document.getElementById(selectId);
    if (!courseSelect || !global.FacultyDashboardCourses) return null;
    await global.FacultyDashboardCourses.populateCourseSelect(courseSelect, {});
    courseSelect.addEventListener("change", function () {
      var ouId = courseSelect.value;
      if (!ouId) return;
      var label = courseSelect.options[courseSelect.selectedIndex].textContent || "";
      onSelect(ouId, label);
    });
    return courseSelect;
  }

  function markRowState(tr, state) {
    if (!tr) return;
    tr.classList.remove("dd-changed", "dd-row-saved", "dd-row-fail");
    if (state) tr.classList.add(state);
  }

  function setBusy(btnIds, busy) {
    (btnIds || []).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!busy;
    });
  }

  BSP.BulkEditor = {
    LE: LE_DEFAULT,
    LE_DROPBOX: LE_DROPBOX,
    LE_GRADES: LE_GRADES,
    escapeHTML: escapeHTML,
    fmtDate: fmtDate,
    dateOnlyFromIso: dateOnlyFromIso,
    isoFromDateOnly: isoFromDateOnly,
    ensureXsrfToken: ensureXsrfToken,
    putJson: putJson,
    postJson: postJson,
    putMultipart: putMultipart,
    richTextOut: richTextOut,
    buildQuizUpdateBody: buildQuizUpdateBody,
    buildDropboxUpdateBody: buildDropboxUpdateBody,
    buildDiscussionTopicUpdateBody: buildDiscussionTopicUpdateBody,
    buildGradeItemUpdateBody: buildGradeItemUpdateBody,
    wireCourseSelect: wireCourseSelect,
    markRowState: markRowState,
    setBusy: setBusy
  };
})(window);
