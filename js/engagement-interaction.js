/**
 * Engagement & Interaction page
 * Loads engagement-engine.html in embed mode for a selected course
 * (full Engagement tabs — not the one-on-one-only view).
 */

(function () {
  "use strict";

  var ENGINE_PATH = "engagement-engine.html";
  var lastAppliedHeight = 0;

  function getDashboardRootFromScript() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      var marker = "/js/engagement-interaction.js";
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
    var card = document.getElementById("eng-engine-card");
    var iframe = document.getElementById("eng-engine");
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
      if (!d || d.source !== "bsp-engagement-engine") return;
      if (d.type !== "height" || typeof d.height !== "number") return;

      var iframe = document.getElementById("eng-engine");
      if (!iframe) return;

      var target = Math.max(540, d.height);
      if (Math.abs(target - lastAppliedHeight) < 4) return;
      lastAppliedHeight = target;
      iframe.style.height = target + "px";
    });
  }

  async function init() {
    var selectEl = document.getElementById("eng-course-select");
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
        var card = document.getElementById("eng-engine-card");
        var iframe = document.getElementById("eng-engine");
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
