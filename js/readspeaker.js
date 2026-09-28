/**
 * Faculty Dashboard — ReadSpeaker webReader (customer 00000)
 * Idempotent: safe if CDN/button already present (e.g. readspeaker.html test page).
 */
(function () {
  "use strict";

  var CUSTOMER_ID = "00000";
  var SCRIPT_ID = "rs_req_Init";
  var BUTTON_ID = "readspeaker_button1";
  var READ_ID = "main-content";
  var CDN_SRC =
    "https://cdn-na.readspeaker.com/script/" +
    CUSTOMER_ID +
    "/webReader/webReader.js?pids=wr";
  var PLAY_HREF =
    "https://app-na.readspeaker.com/cgi-bin/rsent?customerid=" +
    CUSTOMER_ID +
    "&lang=en_us&voice=Kayla&readid=" +
    READ_ID +
    "&url=";

  function ensureConfig() {
    window.rsConf = window.rsConf || {};
    window.rsConf.general = window.rsConf.general || {};
    if (typeof window.rsConf.general.usePost === "undefined") {
      window.rsConf.general.usePost = true;
    }
  }

  function ensureScript() {
    if (document.getElementById(SCRIPT_ID)) {
      return;
    }
    if (document.querySelector('script[src*="webReader/webReader.js"]')) {
      return;
    }
    var script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = CDN_SRC;
    script.type = "text/javascript";
    document.head.appendChild(script);
  }

  function buildButton() {
    var wrap = document.createElement("div");
    wrap.id = BUTTON_ID;
    wrap.className = "rs_skip rsbtn rs_preserve fd-readspeaker";
    wrap.setAttribute("data-fd-readspeaker", "true");

    var link = document.createElement("a");
    link.rel = "nofollow";
    link.className = "rsbtn_play";
    link.title = "Listen to this page using ReadSpeaker webReader";
    link.href = PLAY_HREF;

    link.innerHTML =
      '<span class="rsbtn_left rsimg rspart"><span class="rsbtn_text"><span>Listen</span></span></span>' +
      '<span class="rsbtn_right rsimg rsplay rspart"></span>';

    wrap.appendChild(link);
    return wrap;
  }

  function placeButton(button) {
    var main = document.getElementById("main-content");
    if (!main) {
      return false;
    }

    var slot = main.querySelector("[data-fd-readspeaker-slot]");
    if (slot) {
      slot.appendChild(button);
      return true;
    }

    var header = main.querySelector(".page-header");
    if (header) {
      var content = header.querySelector(".page-header-content");
      if (content) {
        if (content.nextSibling) {
          header.insertBefore(button, content.nextSibling);
        } else {
          header.appendChild(button);
        }
        return true;
      }
      header.appendChild(button);
      return true;
    }

    main.insertBefore(button, main.firstChild);
    return true;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }
    placeButton(buildButton());
  }

  function init() {
    ensureConfig();
    ensureScript();
    ensureButton();
  }

  window.FacultyDashboardReadSpeaker = {
    init: init,
    customerId: CUSTOMER_ID,
    readId: READ_ID
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
