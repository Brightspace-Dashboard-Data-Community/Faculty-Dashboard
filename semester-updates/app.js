(function () {
  "use strict";

  var searchInput = document.getElementById("page-search");
  var moduleSelect = document.getElementById("module-select");
  var updatedOnlyCheckbox = document.getElementById("updated-only");
  var modulesGrid = document.getElementById("modules-grid");
  var moduleContent = document.getElementById("module-content");
  var modulesCountEl = document.getElementById("modules-count");
  var copySectionBtn = document.getElementById("copy-section");
  var copyFullEmailBtn = document.getElementById("copy-full-email");
  var copyStatusEl = document.getElementById("copy-status");
  var introGreeting = document.getElementById("intro-heading");
  var introParagraphs = document.getElementById("intro-paragraphs");
  var pageHeading = document.getElementById("page-heading");
  var pageSubtitle = document.getElementById("page-subtitle");
  var data = null;
  var sections = [];
  var activeSectionId = "";
  var moduleButtons = [];
  var updatedLabel = "This semester";
  var ELEARNING_OFFICE_URL = "https://intranet.example.edu/online-learning/index.html";
  var HELPDESK_URL = "https://helpdesk.example.edu/portal/en/newticket";

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\u202f/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function semesterContext() {
    var semester = (data && data.semester) || {};
    if (window.FacultyDashboardSemester && window.FacultyDashboardSemester.getFuture) {
      var future = window.FacultyDashboardSemester.getFuture();
      if (future && future.label && !semester.label) {
        semester.label = future.label;
        semester.code = future.code;
      }
    }
    return semester;
  }

  function applyTemplates(text) {
    var semester = semesterContext();
    return String(text || "")
      .replace(/\{\{semester\.label\}\}/g, semester.label || "")
      .replace(/\{\{semester\.shortLabel\}\}/g, semester.shortLabel || "")
      .replace(/\{\{semester\.code\}\}/g, semester.code || "")
      .replace(/\{\{semester\.coursesAvailableDate\}\}/g, semester.coursesAvailableDate || "");
  }

  function resolveParagraphs(section) {
    return (section.paragraphs || []).map(applyTemplates);
  }

  function appendTextWithLinks(container, text, preserveEdges, linkLabel) {
    var normalized = applyTemplates(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\u202f/g, " ")
      .replace(/\s+/g, " ");
    if (!preserveEdges) {
      normalized = normalized.trim();
    }
    if (!normalized) return;

    linkLabel = linkLabel || (data && data.elearningLinkLabel) || "eLearning Office";
    var escapedLabel = linkLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var linkPattern = new RegExp(
      "(https?:\\/\\/[^\\s]+)|((?:[a-z0-9._%+-]+@delta\\.edu))|(" +
        escapedLabel +
        ")|(help desk|helpdesk)",
      "gi"
    );
    var lastIndex = 0;
    var match;

    while ((match = linkPattern.exec(normalized)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(normalized.slice(lastIndex, match.index)));
      }
      var value = match[0];
      var link = document.createElement("a");
      if (match[1]) {
        link.href = value;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else if (match[2]) {
        link.href = "mailto:" + value;
      } else if (match[3]) {
        link.href = ELEARNING_OFFICE_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.href = HELPDESK_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = value;
      container.appendChild(link);
      lastIndex = linkPattern.lastIndex;
    }

    if (lastIndex < normalized.length) {
      container.appendChild(document.createTextNode(normalized.slice(lastIndex)));
    }
  }

  function sectionDisplayTitle(section) {
    return section.title + (section.updated ? " *" : "");
  }

  function sectionPlainText(section) {
    var lines = [section.title];
    resolveParagraphs(section).forEach(function (paragraph) {
      lines.push(normalizeText(paragraph));
    });
    (section.images || []).forEach(function (image) {
      if (image.caption) lines.push(normalizeText(applyTemplates(image.caption)));
    });
    return lines.join("\n\n");
  }

  function signaturePlainText() {
    var sig = (data && data.signature) || {};
    var lines = ["Thank you,", sig.name || ""];
    if (sig.title) lines.push(sig.title);
    if (sig.org) lines.push(sig.org);
    if (sig.phone) lines.push(sig.phone);
    if (sig.address) lines.push(sig.address);
    return lines.filter(Boolean).join("\n");
  }

  function fullEmailPlainText() {
    var lines = [];
    lines.push((data.intro && data.intro.greeting) || "Hello Faculty,");
    lines.push("");
    ((data.intro && data.intro.paragraphs) || []).forEach(function (paragraph) {
      lines.push(applyTemplates(paragraph));
      lines.push("");
    });
    sections.forEach(function (section) {
      lines.push(section.title);
      resolveParagraphs(section).forEach(function (paragraph) {
        lines.push(paragraph);
      });
      lines.push("");
    });
    lines.push(signaturePlainText());
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function setCopyStatus(message, isError) {
    copyStatusEl.textContent = message || "";
    copyStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        var ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error("Copy command was blocked."));
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
      }
    });
  }

  function renderIntro(intro, elearningEmail, linkLabel) {
    introGreeting.textContent = intro.greeting || "Hello Faculty,";
    introParagraphs.innerHTML = "";
    linkLabel = linkLabel || "eLearning Office";

    (intro.paragraphs || []).forEach(function (paragraph) {
      var p = document.createElement("p");
      var resolved = applyTemplates(paragraph);
      var parts = resolved.split(linkLabel);

      if (elearningEmail && parts.length > 1) {
        parts.forEach(function (part, index) {
          if (index > 0) {
            var officeLink = document.createElement("a");
            officeLink.href = ELEARNING_OFFICE_URL;
            officeLink.target = "_blank";
            officeLink.rel = "noopener noreferrer";
            officeLink.textContent = linkLabel;
            p.appendChild(officeLink);
          }
          appendTextWithLinks(p, part, true, linkLabel);
        });
      } else {
        appendTextWithLinks(p, resolved, false, linkLabel);
      }
      introParagraphs.appendChild(p);
    });
  }

  function renderSectionImages(cardBody, section) {
    (section.images || []).forEach(function (image) {
      var figure = document.createElement("figure");
      figure.className = "section-figure";

      var img = document.createElement("img");
      img.src = image.src;
      img.alt = applyTemplates(image.alt || "");
      img.loading = "lazy";
      img.addEventListener("error", function () {
        figure.classList.add("is-missing");
      });

      figure.appendChild(img);

      if (image.caption) {
        var caption = document.createElement("figcaption");
        appendTextWithLinks(caption, applyTemplates(image.caption));
        figure.appendChild(caption);
      }

      cardBody.appendChild(figure);
    });
  }

  function renderModuleButtons(allSections) {
    modulesGrid.innerHTML = "";
    moduleButtons = [];
    moduleSelect.innerHTML = '<option value="">Choose a section...</option>';

    allSections.forEach(function (section) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "module-btn" + (section.updated ? " is-updated" : "");
      button.setAttribute("role", "listitem");
      button.setAttribute("data-section-id", section.id);
      button.setAttribute("aria-pressed", "false");

      var icon = document.createElement("i");
      icon.className = "fa-solid " + (section.icon || "fa-file-lines") + " module-btn-icon";
      icon.setAttribute("aria-hidden", "true");

      var labelWrap = document.createElement("span");
      labelWrap.className = "module-btn-label";
      labelWrap.textContent = sectionDisplayTitle(section);

      var meta = document.createElement("span");
      meta.className = "module-btn-meta";
      meta.textContent = section.updated ? updatedLabel : "Semester reminder";

      labelWrap.appendChild(meta);
      button.appendChild(icon);
      button.appendChild(labelWrap);

      button.addEventListener("click", function () {
        selectSection(section.id, true);
      });

      modulesGrid.appendChild(button);
      moduleButtons.push(button);

      var option = document.createElement("option");
      option.value = section.id;
      option.textContent = sectionDisplayTitle(section);
      moduleSelect.appendChild(option);
    });
  }

  function renderSectionContent(section) {
    var cardBody = document.createElement("div");
    cardBody.className = "card-body";

    var title = document.createElement("h3");
    title.className = "module-title";
    title.textContent = section.title;

    if (section.updated) {
      var badge = document.createElement("span");
      badge.className = "updated-badge";
      badge.innerHTML = '<i class="fa-solid fa-star" aria-hidden="true"></i> Highlighted';
      title.appendChild(badge);
    }

    cardBody.appendChild(title);

    resolveParagraphs(section).forEach(function (paragraph) {
      var p = document.createElement("p");
      p.className = "module-paragraph";
      appendTextWithLinks(p, paragraph);
      cardBody.appendChild(p);
    });

    renderSectionImages(cardBody, section);

    moduleContent.innerHTML = "";
    moduleContent.className = "card content-card";
    moduleContent.appendChild(cardBody);

    copySectionBtn.disabled = false;
  }

  function clearSectionContent() {
    moduleContent.innerHTML = "";
    moduleContent.className = "card content-card";
    var cardBody = document.createElement("div");
    cardBody.className = "card-body";
    var placeholder = document.createElement("p");
    placeholder.className = "placeholder-text";
    placeholder.textContent =
      "Select a section from the list to view reminder text you can copy into email or announcements.";
    cardBody.appendChild(placeholder);
    moduleContent.appendChild(cardBody);
    copySectionBtn.disabled = true;
  }

  function selectSection(sectionId, updateHash) {
    var section = sections.find(function (item) {
      return item.id === sectionId;
    });
    if (!section) return;

    activeSectionId = sectionId;
    moduleSelect.value = sectionId;

    moduleButtons.forEach(function (button) {
      var isActive = button.getAttribute("data-section-id") === sectionId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    renderSectionContent(section);
    setCopyStatus("");

    if (updateHash) {
      history.replaceState(null, "", "#" + sectionId);
    }

    var activeButton = moduleButtons.find(function (button) {
      return button.getAttribute("data-section-id") === sectionId && !button.hidden;
    });
    if (activeButton && typeof activeButton.scrollIntoView === "function") {
      activeButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function sectionMatchesFilters(section) {
    var query = (searchInput.value || "").trim().toLowerCase();
    var updatedOnly = updatedOnlyCheckbox.checked;
    var haystack = (
      section.title +
      " " +
      resolveParagraphs(section).join(" ")
    ).toLowerCase();

    if (updatedOnly && !section.updated) return false;
    if (query && haystack.indexOf(query) === -1) return false;
    return true;
  }

  function applyFilters() {
    var visibleCount = 0;

    moduleButtons.forEach(function (button) {
      var sectionId = button.getAttribute("data-section-id");
      var section = sections.find(function (item) {
        return item.id === sectionId;
      });
      var visible = section && sectionMatchesFilters(section);
      button.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    Array.prototype.forEach.call(moduleSelect.options, function (option, index) {
      if (index === 0) return;
      var section = sections.find(function (item) {
        return item.id === option.value;
      });
      option.hidden = !(section && sectionMatchesFilters(section));
      option.disabled = option.hidden;
    });

    var total = sections.length;
    var updatedCount = sections.filter(function (s) {
      return s.updated;
    }).length;
    modulesCountEl.textContent =
      visibleCount +
      " of " +
      total +
      " sections shown" +
      (updatedOnlyCheckbox.checked ? " (highlighted only)." : " · " + updatedCount + " highlighted.");

    if (activeSectionId) {
      var activeVisible = moduleButtons.some(function (button) {
        return button.getAttribute("data-section-id") === activeSectionId && !button.hidden;
      });
      if (!activeVisible) {
        activeSectionId = "";
        clearSectionContent();
        moduleSelect.value = "";
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }

    if (!activeSectionId && visibleCount > 0) {
      var firstVisible = sections.find(function (section) {
        return sectionMatchesFilters(section);
      });
      if (firstVisible && (searchInput.value || updatedOnlyCheckbox.checked)) {
        selectSection(firstVisible.id, false);
      }
    }
  }

  function bindEvents() {
    searchInput.addEventListener("input", applyFilters);
    updatedOnlyCheckbox.addEventListener("change", applyFilters);

    moduleSelect.addEventListener("change", function () {
      if (!moduleSelect.value) {
        activeSectionId = "";
        clearSectionContent();
        history.replaceState(null, "", window.location.pathname + window.location.search);
        moduleButtons.forEach(function (button) {
          button.classList.remove("is-active");
          button.setAttribute("aria-pressed", "false");
        });
        return;
      }
      selectSection(moduleSelect.value, true);
    });

    copySectionBtn.addEventListener("click", function () {
      var section = sections.find(function (item) {
        return item.id === activeSectionId;
      });
      if (!section) return;

      copyTextToClipboard(sectionPlainText(section))
        .then(function () {
          setCopyStatus('Copied "' + section.title + '" to your clipboard.');
        })
        .catch(function () {
          setCopyStatus("Unable to copy automatically. Select the text and copy manually.", true);
        });
    });

    copyFullEmailBtn.addEventListener("click", function () {
      copyTextToClipboard(fullEmailPlainText())
        .then(function () {
          setCopyStatus("Copied full email text to your clipboard.");
        })
        .catch(function () {
          setCopyStatus("Unable to copy automatically. Select the text and copy manually.", true);
        });
    });
  }

  function applyPageMeta() {
    var semester = semesterContext();
    if (data.pageTitle) {
      document.title = data.pageTitle + " - Your Institution Faculty";
    }
    if (pageHeading && semester.label) {
      pageHeading.textContent = semester.label + " Semester Reminders";
    }
    if (pageSubtitle && semester.coursesAvailableDate) {
      pageSubtitle.textContent =
        "Courses available " +
        semester.coursesAvailableDate +
        " · Review and copy reminders for faculty email and course preparation.";
    }
  }

  function loadData() {
    fetch("./semester-reminders.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load semester reminder data");
        return res.json();
      })
      .then(function (json) {
        data = json;
        sections = json.sections || [];
        updatedLabel = json.updatedLabel || "This semester";

        applyPageMeta();
        renderIntro(json.intro || {}, json.elearningEmail || "", json.elearningLinkLabel || "eLearning Office");
        renderModuleButtons(sections);
        bindEvents();
        applyFilters();

        var hashId = (window.location.hash || "").replace(/^#/, "");
        if (hashId && sections.some(function (section) { return section.id === hashId; })) {
          selectSection(hashId, false);
        }
      })
      .catch(function () {
        modulesCountEl.textContent = "Unable to load semester reminder data.";
        introParagraphs.innerHTML =
          "<p>Please confirm semester-reminders.json is available in this folder.</p>";
      });
  }

  loadData();
})();
