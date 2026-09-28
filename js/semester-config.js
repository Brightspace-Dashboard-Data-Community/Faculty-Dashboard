/**
 * Faculty Dashboard — single source of truth for academic terms.
 * Load this script before any dashboard module that filters by semester.
 *
 * Brightspace term org unit IDs (when known) are optional; course-code parsing uses `code` (e.g. 26/FA).
 *
 * Calendar slots (previous / active / future) follow the Student Dashboard academic calendar:
 * after a term’s end date, the next term becomes Current even if classes have not started yet.
 * The header picker defaults to Current and lets faculty switch to Previous or Future.
 */
(function (global) {
  "use strict";

  var VIEWING_STORAGE_KEY = "fdSemesterViewingCode";
  var VIEWING_CHANGE_EVENT = "fd-semester-viewing-change";
  var viewingCodeOverride = null;

  /** @typedef {{ code: string, label: string, displayLabel: string, termOrgUnitId: number|null }} SemesterSlot */

  /** @type {{ active: SemesterSlot, previous: SemesterSlot, future: SemesterSlot, legacy: SemesterSlot[] }} */
  var CONFIG = {
    previous: {
      code: "26/SP",
      label: "Spring 2026",
      displayLabel: "Spring 2026 (26/SP)",
      termOrgUnitId: null
    },
    active: {
      code: "26/FA",
      label: "Fall 2026",
      displayLabel: "Fall 2026 (26/FA)",
      termOrgUnitId: null
    },
    future: {
      code: "27/WI",
      label: "Winter 2027",
      displayLabel: "Winter 2027 (27/WI)",
      termOrgUnitId: null
    },
    legacy: [
      {
        code: "26/WI",
        label: "Winter 2026",
        displayLabel: "Winter 2026 (26/WI)",
        termOrgUnitId: null
      },
      {
        code: "25/FA",
        label: "Fall 2025",
        displayLabel: "Fall 2025 (25/FA)",
        termOrgUnitId: null
      }
    ]
  };

  function allSlotsOrdered() {
    return [CONFIG.previous, CONFIG.active, CONFIG.future].concat(CONFIG.legacy || []);
  }

  function pickerSlots() {
    return [
      { role: "Current", slot: CONFIG.active },
      { role: "Previous", slot: CONFIG.previous },
      { role: "Future", slot: CONFIG.future }
    ];
  }

  function pickerCodes() {
    return [CONFIG.active.code, CONFIG.previous.code, CONFIG.future.code];
  }

  function slotByCode(code) {
    var slots = allSlotsOrdered();
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].code === code) return slots[i];
    }
    return null;
  }

  function readStoredViewingCode() {
    try {
      return sessionStorage.getItem(VIEWING_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeStoredViewingCode(code) {
    try {
      sessionStorage.setItem(VIEWING_STORAGE_KEY, code);
    } catch (e) {
      /* private mode / blocked storage */
    }
  }

  function getViewingCode() {
    var stored = viewingCodeOverride || readStoredViewingCode();
    var allowed = pickerCodes();
    if (stored && allowed.indexOf(stored) >= 0) return stored;
    return CONFIG.active.code;
  }

  function getViewing() {
    return slotByCode(getViewingCode()) || CONFIG.active;
  }

  function setViewingCode(code) {
    var allowed = pickerCodes();
    var next = allowed.indexOf(code) >= 0 ? code : CONFIG.active.code;
    viewingCodeOverride = next;
    writeStoredViewingCode(next);
    applyDomPlaceholders();
    if (typeof document !== "undefined" && document.dispatchEvent) {
      var evt;
      try {
        evt = new CustomEvent(VIEWING_CHANGE_EVENT, { detail: { code: next } });
      } catch (e) {
        evt = document.createEvent("CustomEvent");
        evt.initCustomEvent(VIEWING_CHANGE_EVENT, false, false, { code: next });
      }
      document.dispatchEvent(evt);
    }
  }

  function codesSortedForMatch() {
    var codes = allSlotsOrdered().map(function (s) {
      return s.code;
    });
    codes.sort(function (a, b) {
      return b.length - a.length;
    });
    return codes;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var text = String(courseCode || "");
    var codes = codesSortedForMatch();
    for (var i = 0; i < codes.length; i++) {
      if (text.indexOf(codes[i]) >= 0) return codes[i];
    }
    return "";
  }

  function getActive() {
    return getViewing();
  }
  function getPrevious() {
    return CONFIG.previous;
  }
  function getFuture() {
    return CONFIG.future;
  }

  function getActiveCode() {
    return getViewingCode();
  }
  function getPreviousCode() {
    return CONFIG.previous.code;
  }
  function getFutureCode() {
    return CONFIG.future.code;
  }

  /**
   * Options shown in widgets that offer a term picker (e.g. early alert, at-risk, summary metrics).
   * Order: current, then prior, upcoming, then legacy archive terms.
   */
  function getSemestersForSelect() {
    return [CONFIG.active, CONFIG.previous, CONFIG.future].concat(CONFIG.legacy || []).map(function (s) {
      return { code: s.code, label: s.displayLabel };
    });
  }

  /**
   * Terms included when scanning enrollments across multiple terms (e.g. attention-needed "all courses").
   */
  function getEnrollmentScanCodes() {
    return allSlotsOrdered().map(function (s) {
      return s.code;
    });
  }

  function fillSemesterSelect(select) {
    var options = pickerSlots();
    var selected = getViewingCode();
    select.innerHTML = "";
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement("option");
      opt.value = options[i].slot.code;
      opt.textContent = options[i].role + " — " + options[i].slot.displayLabel;
      select.appendChild(opt);
    }
    select.value = selected;
    if (select.getAttribute("data-fd-picker-bound") === "1") return;
    select.setAttribute("data-fd-picker-bound", "1");
    select.addEventListener("change", function () {
      setViewingCode(select.value);
    });
  }

  function ensureBannerSelect(host) {
    if (host.tagName === "SELECT") return host;
    var existing = host.querySelector("select");
    if (existing) return existing;

    host.textContent = "";
    host.classList.add("semester-picker");

    var label = document.createElement("label");
    label.className = "semester-picker-label";
    var select = document.createElement("select");
    select.className = "semester-picker-select";
    var selectId = host.getAttribute("data-fd-semester-select-id") || "";
    if (!selectId) {
      selectId = "fd-semester-select-" + String(Math.random()).slice(2, 10);
    }
    select.id = selectId;
    select.setAttribute("aria-label", "Select semester");
    label.setAttribute("for", selectId);
    label.textContent = "Semester";

    host.appendChild(label);
    host.appendChild(select);
    return select;
  }

  function slotForPlaceholderKey(key) {
    var k = (key || "active").toLowerCase();
    if (k === "previous") return CONFIG.previous;
    if (k === "future") return CONFIG.future;
    if (k === "calendar" || k === "calendar-active") return CONFIG.active;
    if (k === "legacy-25fa") return slotByCode("25/FA");
    return getViewing();
  }

  function applyDomPlaceholders() {
    var bannerEls = document.querySelectorAll("[data-fd-semester-banner]");
    for (var i = 0; i < bannerEls.length; i++) {
      fillSemesterSelect(ensureBannerSelect(bannerEls[i]));
    }

    var nodes = document.querySelectorAll("[data-fd-semester-text]");
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var s = slotForPlaceholderKey(node.getAttribute("data-fd-semester-text"));
      if (s) node.textContent = s.displayLabel;
    }

    nodes = document.querySelectorAll("[data-fd-semester-code]");
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      var slot2 = slotForPlaceholderKey(n.getAttribute("data-fd-semester-code"));
      if (slot2) n.textContent = slot2.code;
    }
  }

  function scheduleDomPlaceholders() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyDomPlaceholders);
    } else {
      applyDomPlaceholders();
    }
  }

  function termOrgUnitId(slotKey) {
    var key = (slotKey || "active").toLowerCase();
    var slot =
      key === "previous" ? CONFIG.previous : key === "future" ? CONFIG.future : getViewing();
    return slot.termOrgUnitId != null ? slot.termOrgUnitId : null;
  }

  var api = {
    VIEWING_CHANGE_EVENT: VIEWING_CHANGE_EVENT,
    getConfig: function () {
      return CONFIG;
    },
    /** Brightspace term org unit id when known; otherwise null. */
    getActiveTermOrgUnitId: function () {
      return termOrgUnitId("active");
    },
    getPreviousTermOrgUnitId: function () {
      return termOrgUnitId("previous");
    },
    getFutureTermOrgUnitId: function () {
      return termOrgUnitId("future");
    },
    getActive: getActive,
    getPrevious: getPrevious,
    getFuture: getFuture,
    getActiveCode: getActiveCode,
    getPreviousCode: getPreviousCode,
    getFutureCode: getFutureCode,
    getViewing: getViewing,
    getViewingCode: getViewingCode,
    setViewingCode: setViewingCode,
    getCalendarActive: function () {
      return CONFIG.active;
    },
    getSemesterCodeFromCourseCode: getSemesterCodeFromCourseCode,
    getSemestersForSelect: getSemestersForSelect,
    getEnrollmentScanCodes: getEnrollmentScanCodes,
    codesSortedForMatch: codesSortedForMatch,
    applyDomPlaceholders: applyDomPlaceholders
  };

  global.FACULTY_DASHBOARD_SEMESTER_CONFIG = CONFIG;
  global.FacultyDashboardSemester = api;

  scheduleDomPlaceholders();
})(typeof window !== "undefined" ? window : this);
