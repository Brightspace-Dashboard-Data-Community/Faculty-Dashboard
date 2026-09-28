/**
 * Feedback Tone Dashboard page
 * Loads feedback-engine.html in embed mode for a selected course.
 */

(function () {
  "use strict";

  var ENGINE_PATH = "feedback-engine.html";
  var lastAppliedHeight = 0;

  function getDashboardRootFromScript() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      var marker = "/js/feedback-tone.js";
      var idx = src.indexOf(marker);
      if (idx !== -1) {
        return src.slice(0, idx + 1);
      }
    }
    return "";
  }

  function engineUrl(orgUnitId) {
    var root = getDashboardRootFromScript();
    return (
      root +
      ENGINE_PATH +
      "?ou=" +
      encodeURIComponent(orgUnitId) +
      "&embed=1"
    );
  }

  function pointIframe(orgUnitId) {
    var card = document.getElementById("fb-engine-card");
    var iframe = document.getElementById("fb-engine");
    if (!iframe || !orgUnitId) return;

    if (card) card.hidden = false;
    var nextSrc = engineUrl(orgUnitId);
    if (iframe.getAttribute("src") !== nextSrc) {
      iframe.setAttribute("src", nextSrc);
      lastAppliedHeight = 0;
    }
  }

  function setupHeightBridge() {
    window.addEventListener("message", function (ev) {
      var d = ev && ev.data;
      if (!d || d.source !== "bsp-feedback-engine") return;

      var iframe = document.getElementById("fb-engine");
      if (!iframe) return;

      if (d.type === "BSP_FEEDBACK_HEIGHT" && typeof d.height === "number") {
        var target = Math.max(480, d.height + 4);
        if (Math.abs(target - lastAppliedHeight) < 4) return;
        lastAppliedHeight = target;
        iframe.style.height = target + "px";
      } else if (d.type === "height" && typeof d.height === "number") {
        var h = Math.max(480, d.height);
        if (Math.abs(h - lastAppliedHeight) < 4) return;
        lastAppliedHeight = h;
        iframe.style.height = h + "px";
      }
    });
  }

  async function init() {
    var selectEl = document.getElementById("fb-course-select");
    if (!selectEl) return;

    setupHeightBridge();

    var params = new URLSearchParams(window.location.search);
    var preselect = params.get("courseId") || params.get("ou") || "";

    if (!window.FacultyDashboardCourses) {
      selectEl.innerHTML = '<option value="">Course loader unavailable</option>';
      return;
    }

    try {
      await window.FacultyDashboardCourses.populateCourseSelect(selectEl, {
        activeOnly: false,
        includeAllOption: false,
        placeholderLabel: "Select a course…",
        emptyLabel: "No eligible courses found",
        selectedValue: preselect,
        persistCache: true
      });
    } catch (e) {
      return;
    }

    if (selectEl.value) {
      pointIframe(selectEl.value);
    }

    selectEl.addEventListener("change", function () {
      var selected = selectEl.value;
      var urlParams = new URLSearchParams(window.location.search);
      if (selected) {
        urlParams.set("courseId", selected);
        pointIframe(selected);
      } else {
        urlParams.delete("courseId");
        var card = document.getElementById("fb-engine-card");
        var iframe = document.getElementById("fb-engine");
        if (card) card.hidden = true;
        if (iframe) iframe.setAttribute("src", "about:blank");
      }
      var qs = urlParams.toString();
      var next = window.location.pathname + (qs ? "?" + qs : "");
      window.history.replaceState({}, "", next);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
