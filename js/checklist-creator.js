/**
 * Checklist Creator
 * Create Brightspace checklists (categories + items) and optionally place
 * a link topic in a content module. Also supports linking existing checklists.
 *
 * API:
 *   GET/POST /d2l/api/le/{LE}/{ou}/checklists/
 *   POST     /d2l/api/le/{LE}/{ou}/checklists/{id}/categories/
 *   POST     /d2l/api/le/{LE}/{ou}/checklists/{id}/items/
 *   GET      /d2l/api/le/{LE}/{ou}/content/toc
 *   POST     /d2l/api/le/{LE}/{ou}/content/modules/{moduleId}/structure/
 */
(function () {
  "use strict";

  var LE =
    (window.BrightspaceApi && window.BrightspaceApi.LE) ||
    (window.BSP && window.BSP.api && window.BSP.api.LE) ||
    "1.96";
  var REQUEST_GAP_MS = 100;
  var MAX_RETRIES = 4;

  var state = {
    courseId: null,
    courseLabel: "",
    checklists: [],
    modules: [],
    busy: false,
    categorySeq: 0
  };

  function $(id) {
    return document.getElementById(id);
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

  function richTextInput(content) {
    return { Content: content || "", Type: "Text" };
  }

  function isoFromDateOnly(dateStr) {
    if (!dateStr) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
    if (!m) return null;
    var dt = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 0, 0);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  function checklistViewUrl(orgUnitId, checklistId) {
    return (
      "/d2l/lms/checklist/checklist.d2l?ou=" +
      encodeURIComponent(orgUnitId) +
      "&checklistId=" +
      encodeURIComponent(checklistId)
    );
  }

  function checklistManageUrl(orgUnitId) {
    return "/d2l/lms/checklist/checklists.d2l?ou=" + encodeURIComponent(orgUnitId);
  }

  async function BrightspaceFetchJson(url, options) {
    var token =
      localStorage.getItem("XSRF.Token") || localStorage.getItem("X-CSRF.Token") || "";
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.headers.Accept = "application/json";
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
        var err = new Error(
          "HTTP " + res.status + " — " + url + (text ? " — " + text.slice(0, 400) : "")
        );
        err.status = res.status;
        err.body = text;
        throw err;
      }
      if (res.status === 204) return null;
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("json") >= 0) return res.json();
      var raw = await res.text();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return raw;
      }
    }
  }

  async function fetchPaged(path) {
    var out = [];
    var bookmark = "";
    var safety = 200;
    while (safety-- > 0) {
      var sep = path.indexOf("?") >= 0 ? "&" : "?";
      var url = bookmark
        ? path + sep + "bookmark=" + encodeURIComponent(bookmark)
        : path;
      var page = await BrightspaceFetchJson(url);
      if (!page) break;
      var items = Array.isArray(page)
        ? page
        : page.Items || page.Objects || page.PagedResultSet || [];
      if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i++) out.push(items[i]);
      }
      var pi = (page && page.PagingInfo) || {};
      var more = pi.HasMoreItems || page.Next;
      bookmark = pi.Bookmark || "";
      if (!more || !bookmark) break;
    }
    return out;
  }

  function setMessage(type, html) {
    var el = $("clcMessage");
    if (!el) return;
    el.style.display = "block";
    el.className = "message-container message-" + (type || "success");
    el.innerHTML = html;
  }

  function clearMessage() {
    var el = $("clcMessage");
    if (!el) return;
    el.style.display = "none";
    el.className = "message-container";
    el.innerHTML = "";
  }

  function setBusy(busy) {
    state.busy = busy;
    var createBtn = $("clcCreateBtn");
    var placeBtn = $("clcPlaceExistingBtn");
    var course = $("clcCourse");
    if (createBtn) createBtn.disabled = busy;
    if (placeBtn) placeBtn.disabled = busy || !canPlaceExisting();
    if (course) course.disabled = busy;
  }

  function showProgress(show) {
    var card = $("clcProgressCard");
    if (card) card.hidden = !show;
  }

  function resetProgress() {
    showProgress(true);
    $("clcProgressLabel").textContent = "Working…";
    $("clcProgressCount").textContent = "";
    $("clcProgressFill").style.width = "0%";
    $("clcProgressBar").setAttribute("aria-valuenow", "0");
    $("clcProgressLog").innerHTML = "";
  }

  function setProgress(done, total, label) {
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    $("clcProgressLabel").textContent = label || "Working…";
    $("clcProgressCount").textContent = done + " / " + total;
    $("clcProgressFill").style.width = pct + "%";
    $("clcProgressBar").setAttribute("aria-valuenow", String(pct));
  }

  function logProgress(msg, kind) {
    var ul = $("clcProgressLog");
    if (!ul) return;
    var li = document.createElement("li");
    li.className =
      kind === "ok" ? "psc-log-ok" : kind === "err" ? "psc-log-err" : "psc-log-skip";
    li.textContent = msg;
    ul.appendChild(li);
  }

  function parseItemLines(text) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var name = line;
      var dueDate = null;
      var pipe = line.lastIndexOf("|");
      if (pipe > 0) {
        var maybeDate = line.slice(pipe + 1).trim();
        var iso = isoFromDateOnly(maybeDate);
        if (iso) {
          name = line.slice(0, pipe).trim();
          dueDate = iso;
        }
      }
      if (name) out.push({ name: name, dueDate: dueDate });
    }
    return out;
  }

  function addCategoryRow(preset) {
    preset = preset || {};
    state.categorySeq += 1;
    var id = "clc-cat-" + state.categorySeq;
    var wrap = document.createElement("div");
    wrap.className = "clc-category-card";
    wrap.dataset.categoryId = id;
    wrap.innerHTML =
      '<div class="clc-category-top">' +
      '<div class="form-group" style="flex:1;margin-bottom:0;">' +
      '<label class="form-label" for="' +
      id +
      '-name">Category name</label>' +
      '<input type="text" class="form-input clc-cat-name" id="' +
      id +
      '-name" maxlength="256" value="' +
      escapeHtml(preset.name || "Tasks") +
      '">' +
      "</div>" +
      '<button type="button" class="form-button form-button-secondary clc-remove-cat" aria-label="Remove category">' +
      '<i class="fas fa-trash" aria-hidden="true"></i>' +
      "</button>" +
      "</div>" +
      '<div class="form-group" style="margin-bottom:0;margin-top:0.75rem;">' +
      '<label class="form-label" for="' +
      id +
      '-items">Items (one per line)</label>' +
      '<textarea class="form-textarea clc-cat-items" id="' +
      id +
      '-items" rows="5" placeholder="Review module materials&#10;Complete discussion post | 2026-09-15&#10;Submit assignment">' +
      escapeHtml(preset.itemsText || "") +
      "</textarea>" +
      "</div>";

    wrap.querySelector(".clc-remove-cat").addEventListener("click", function () {
      var cards = $("clcCategories").querySelectorAll(".clc-category-card");
      if (cards.length <= 1) {
        setMessage("error", "Keep at least one category. Clear the items if you do not need them yet.");
        return;
      }
      wrap.remove();
      clearMessage();
    });

    $("clcCategories").appendChild(wrap);
  }

  function readCategoriesFromForm() {
    var cards = $("clcCategories").querySelectorAll(".clc-category-card");
    var cats = [];
    for (var i = 0; i < cards.length; i++) {
      var nameInput = cards[i].querySelector(".clc-cat-name");
      var itemsInput = cards[i].querySelector(".clc-cat-items");
      var name = (nameInput && nameInput.value.trim()) || "Tasks";
      var items = parseItemLines(itemsInput ? itemsInput.value : "");
      cats.push({ name: name, items: items });
    }
    return cats;
  }

  function resetBuilderForm() {
    $("clcName").value = "";
    $("clcDescription").value = "";
    $("clcAddToModule").checked = false;
    $("clcModuleGroup").hidden = true;
    $("clcCategories").innerHTML = "";
    addCategoryRow({ name: "Tasks", itemsText: "" });
    clearMessage();
  }

  function isContentTopic(node) {
    if (!node) return false;
    if (node.ModuleId != null) return false;
    if (node.TopicId != null) return true;
    if (node.Type === 1) return true;
    if (node.TypeIdentifier === "Topic") return true;
    if (node.TopicType != null && !node.Modules) return true;
    return false;
  }

  function moduleIdOf(node) {
    if (!node || isContentTopic(node)) return null;
    if (node.ModuleId != null) return node.ModuleId;
    if (node.Id != null && node.Type !== 1) return node.Id;
    return null;
  }

  function flattenModules(nodes, pathParts, out) {
    if (!nodes || !nodes.length) return;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var title = node.Title || node.Name || node.ShortTitle || "Module";
      var currentPath = pathParts.concat([title]);
      var moduleId = moduleIdOf(node);

      if (moduleId != null) {
        out.push({
          id: String(moduleId),
          label: currentPath.join(" › ")
        });
      }
      if (node.Modules && node.Modules.length) {
        flattenModules(node.Modules, currentPath, out);
      }
      if (node.Structure && node.Structure.length) {
        flattenModules(node.Structure, currentPath, out);
      }
    }
  }

  function tocRootModules(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Modules)) return data.Modules;
    if (Array.isArray(data.Structure)) return data.Structure;
    if (data.Modules) return [data];
    return [];
  }

  async function loadModules(courseId) {
    var out = [];
    var tocError = null;
    try {
      var data = await BrightspaceFetchJson(
        "/d2l/api/le/" + LE + "/" + encodeURIComponent(courseId) + "/content/toc"
      );
      flattenModules(tocRootModules(data), [], out);
      if (out.length) return out;
    } catch (e) {
      tocError = e;
    }

    try {
      var root = await BrightspaceFetchJson(
        "/d2l/api/le/" + LE + "/" + encodeURIComponent(courseId) + "/content/root/"
      );
      flattenModules(tocRootModules(root), [], out);
    } catch (e) {
      if (out.length) return out;
      if (tocError) throw tocError;
    }
    return out;
  }

  async function loadChecklists(courseId) {
    return fetchPaged(
      "/d2l/api/le/" + LE + "/" + encodeURIComponent(courseId) + "/checklists/"
    );
  }

  function fillModuleSelects(modules, loadFailed) {
    state.modules = modules || [];
    var selects = [$("clcModule"), $("clcExistingModule")];
    for (var s = 0; s < selects.length; s++) {
      var sel = selects[s];
      if (!sel) continue;
      var keep = sel.value;
      sel.innerHTML = "";
      var ph = document.createElement("option");
      ph.value = "";
      ph.textContent = modules.length
        ? "Select a module…"
        : loadFailed
          ? "Could not load content modules"
          : "No content modules found";
      sel.appendChild(ph);
      for (var i = 0; i < modules.length; i++) {
        var opt = document.createElement("option");
        opt.value = modules[i].id;
        opt.textContent = modules[i].label;
        sel.appendChild(opt);
      }
      if (keep) sel.value = keep;
    }
  }

  function renderExistingChecklists(list) {
    state.checklists = list || [];
    var host = $("clcExistingList");
    var sel = $("clcExistingSelect");
    if (!host || !sel) return;

    sel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = list.length ? "Select a checklist…" : "No checklists yet";
    sel.appendChild(ph);

    if (!list.length) {
      host.innerHTML =
        '<p class="tool-empty" style="padding:0.5rem 0;">No checklists in this course yet. Create one below.</p>';
      updatePlaceExistingEnabled();
      return;
    }

    var html = '<ul class="clc-existing-ul">';
    for (var i = 0; i < list.length; i++) {
      var id = list[i].Id || list[i].ChecklistId;
      var name = list[i].Name || list[i].Title || "Checklist " + id;
      var view = checklistViewUrl(state.courseId, id);
      html +=
        "<li><span class=\"clc-existing-name\">" +
        escapeHtml(name) +
        '</span> <a class="clc-existing-link" href="' +
        escapeHtml(view) +
        '" target="_blank" rel="noopener noreferrer">Open</a></li>';

      var opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = name;
      opt.dataset.name = name;
      sel.appendChild(opt);
    }
    html += "</ul>";
    host.innerHTML = html;
    updatePlaceExistingEnabled();
  }

  function canPlaceExisting() {
    return !!(
      $("clcExistingSelect") &&
      $("clcExistingSelect").value &&
      $("clcExistingModule") &&
      $("clcExistingModule").value
    );
  }

  function updatePlaceExistingEnabled() {
    var btn = $("clcPlaceExistingBtn");
    if (btn) btn.disabled = state.busy || !canPlaceExisting();
  }

  async function loadCourse(courseId, label) {
    clearMessage();
    state.courseId = courseId;
    state.courseLabel = label || "";
    $("clcHeaderMeta").textContent = "Loading checklists and content modules…";
    $("clcExistingCard").hidden = true;
    $("clcBuilderCard").hidden = true;
    showProgress(false);

    try {
      var moduleLoadFailed = false;
      var results = await Promise.all([
        loadChecklists(courseId),
        loadModules(courseId).catch(function (e) {
          console.warn("[ChecklistCreator] module load failed", e);
          moduleLoadFailed = true;
          return [];
        })
      ]);
      renderExistingChecklists(results[0]);
      fillModuleSelects(results[1], moduleLoadFailed);
      $("clcExistingCard").hidden = false;
      $("clcBuilderCard").hidden = false;
      $("clcHeaderMeta").textContent =
        (label || "Course") +
        " — " +
        results[0].length +
        " checklist" +
        (results[0].length === 1 ? "" : "s") +
        ", " +
        results[1].length +
        " module" +
        (results[1].length === 1 ? "" : "s");
    } catch (e) {
      console.error(e);
      $("clcHeaderMeta").textContent = "Unable to load course checklists.";
      setMessage(
        "error",
        "Could not load checklists for this course. Confirm you have Checklist permissions and try again.<br><small>" +
          escapeHtml(e.message || e) +
          "</small>"
      );
    }
  }

  async function createCategory(courseId, checklistId, name, sortOrder) {
    return BrightspaceFetchJson(
      "/d2l/api/le/" +
        LE +
        "/" +
        encodeURIComponent(courseId) +
        "/checklists/" +
        encodeURIComponent(checklistId) +
        "/categories/",
      {
        method: "POST",
        body: JSON.stringify({
          Name: name,
          Description: richTextInput(""),
          SortOrder: sortOrder
        })
      }
    );
  }

  async function createItem(courseId, checklistId, categoryId, item, sortOrder) {
    return BrightspaceFetchJson(
      "/d2l/api/le/" +
        LE +
        "/" +
        encodeURIComponent(courseId) +
        "/checklists/" +
        encodeURIComponent(checklistId) +
        "/items/",
      {
        method: "POST",
        body: JSON.stringify({
          CategoryId: Number(categoryId),
          Name: item.name,
          Description: richTextInput(""),
          SortOrder: sortOrder,
          DueDate: item.dueDate || null
        })
      }
    );
  }

  async function createChecklistShell(courseId, name, description) {
    return BrightspaceFetchJson(
      "/d2l/api/le/" + LE + "/" + encodeURIComponent(courseId) + "/checklists/",
      {
        method: "POST",
        body: JSON.stringify({
          Name: name,
          Description: richTextInput(description || "")
        })
      }
    );
  }

  async function addChecklistLinkToModule(courseId, moduleId, checklistId, title) {
    var url = checklistViewUrl(courseId, checklistId);
    var body = {
      Title: title || "Checklist",
      ShortTitle: null,
      Type: 1,
      TopicType: 3,
      Url: url,
      StartDate: null,
      EndDate: null,
      DueDate: null,
      IsHidden: false,
      IsLocked: false,
      OpenAsExternalResource: false,
      Description: richTextInput("")
    };
    return BrightspaceFetchJson(
      "/d2l/api/le/" +
        LE +
        "/" +
        encodeURIComponent(courseId) +
        "/content/modules/" +
        encodeURIComponent(moduleId) +
        "/structure/",
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );
  }

  async function createFullChecklist() {
    if (state.busy) return;
    clearMessage();

    var courseId = state.courseId;
    if (!courseId) {
      setMessage("error", "Select a course first.");
      return;
    }

    var name = ($("clcName").value || "").trim();
    if (!name) {
      setMessage("error", "Enter a checklist name.");
      $("clcName").focus();
      return;
    }

    var categories = readCategoriesFromForm();
    var totalItems = 0;
    for (var c = 0; c < categories.length; c++) totalItems += categories[c].items.length;
    if (!totalItems) {
      setMessage("error", "Add at least one checklist item (one task per line).");
      return;
    }

    var addToModule = $("clcAddToModule").checked;
    var moduleId = $("clcModule").value;
    if (addToModule && !moduleId) {
      setMessage("error", "Select a content module, or uncheck module placement.");
      return;
    }

    var totalSteps = 1 + categories.length + totalItems + (addToModule ? 1 : 0);
    var done = 0;

    setBusy(true);
    resetProgress();
    setProgress(0, totalSteps, "Creating checklist…");

    try {
      var checklist = await createChecklistShell(
        courseId,
        name,
        ($("clcDescription").value || "").trim()
      );
      var checklistId = checklist && (checklist.Id || checklist.ChecklistId);
      if (!checklistId) throw new Error("Checklist created but no ID was returned.");
      done++;
      setProgress(done, totalSteps, "Checklist created");
      logProgress('Created checklist "' + name + '" (ID ' + checklistId + ")", "ok");
      await sleep(REQUEST_GAP_MS);

      for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        var catData = await createCategory(courseId, checklistId, cat.name, i + 1);
        var categoryId = catData && (catData.CategoryId || catData.Id);
        if (!categoryId) throw new Error('Category "' + cat.name + '" created without an ID.');
        done++;
        setProgress(done, totalSteps, "Category: " + cat.name);
        logProgress('Category "' + cat.name + '"', "ok");
        await sleep(REQUEST_GAP_MS);

        for (var j = 0; j < cat.items.length; j++) {
          await createItem(courseId, checklistId, categoryId, cat.items[j], j + 1);
          done++;
          setProgress(done, totalSteps, "Item: " + cat.items[j].name);
          logProgress("Item: " + cat.items[j].name, "ok");
          await sleep(REQUEST_GAP_MS);
        }
      }

      var moduleNote = "";
      if (addToModule) {
        try {
          await addChecklistLinkToModule(courseId, moduleId, checklistId, name);
          done++;
          setProgress(done, totalSteps, "Linked in content");
          logProgress("Added checklist link to selected module", "ok");
          moduleNote = " A link was also added to the selected content module.";
        } catch (modErr) {
          done++;
          setProgress(done, totalSteps, "Module link failed");
          logProgress("Module link failed: " + (modErr.message || modErr), "err");
          moduleNote =
            " Checklist was created, but the content module link failed — you can place it below from Existing checklists.";
        }
      }

      $("clcProgressLabel").textContent = "Done";
      var viewUrl = checklistViewUrl(courseId, checklistId);
      var manageUrl = checklistManageUrl(courseId);
      setMessage(
        "success",
        "<strong>Checklist created.</strong> " +
          escapeHtml(totalItems) +
          " item" +
          (totalItems === 1 ? "" : "s") +
          " across " +
          categories.length +
          " categor" +
          (categories.length === 1 ? "y" : "ies") +
          "." +
          escapeHtml(moduleNote) +
          '<br><a href="' +
          escapeHtml(viewUrl) +
          '" target="_blank" rel="noopener noreferrer">Open checklist</a> · <a href="' +
          escapeHtml(manageUrl) +
          '" target="_blank" rel="noopener noreferrer">Manage checklists</a>'
      );

      var refreshed = await loadChecklists(courseId);
      renderExistingChecklists(refreshed);
      resetBuilderForm();
    } catch (e) {
      console.error(e);
      logProgress(e.message || String(e), "err");
      $("clcProgressLabel").textContent = "Failed";
      setMessage(
        "error",
        "Could not finish creating the checklist.<br><small>" +
          escapeHtml(e.message || e) +
          "</small>"
      );
    } finally {
      setBusy(false);
    }
  }

  async function placeExisting() {
    if (state.busy) return;
    clearMessage();
    var checklistId = $("clcExistingSelect").value;
    var moduleId = $("clcExistingModule").value;
    if (!checklistId || !moduleId) {
      setMessage("error", "Select both a checklist and a content module.");
      return;
    }
    var opt = $("clcExistingSelect").selectedOptions[0];
    var title = (opt && (opt.dataset.name || opt.textContent)) || "Checklist";

    setBusy(true);
    resetProgress();
    setProgress(0, 1, "Adding link to module…");
    try {
      await addChecklistLinkToModule(state.courseId, moduleId, checklistId, title);
      setProgress(1, 1, "Done");
      logProgress('Linked "' + title + '" into the selected module', "ok");
      setMessage(
        "success",
        '<strong>Link added.</strong> Students can open the checklist from that module. <a href="' +
          escapeHtml(checklistViewUrl(state.courseId, checklistId)) +
          '" target="_blank" rel="noopener noreferrer">Open checklist</a>'
      );
    } catch (e) {
      console.error(e);
      logProgress(e.message || String(e), "err");
      $("clcProgressLabel").textContent = "Failed";
      setMessage(
        "error",
        "Could not add the checklist link to the module.<br><small>" +
          escapeHtml(e.message || e) +
          "</small>"
      );
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    addCategoryRow({ name: "Tasks", itemsText: "" });

    $("clcAddCategoryBtn").addEventListener("click", function () {
      addCategoryRow({ name: "Category " + (state.categorySeq + 1), itemsText: "" });
    });
    $("clcResetBtn").addEventListener("click", resetBuilderForm);
    $("clcForm").addEventListener("submit", function (e) {
      e.preventDefault();
      createFullChecklist();
    });
    $("clcAddToModule").addEventListener("change", function () {
      $("clcModuleGroup").hidden = !$("clcAddToModule").checked;
    });
    $("clcExistingSelect").addEventListener("change", updatePlaceExistingEnabled);
    $("clcExistingModule").addEventListener("change", updatePlaceExistingEnabled);
    $("clcPlaceExistingBtn").addEventListener("click", placeExisting);

    var courseSelect = $("clcCourse");
    if (courseSelect && window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(courseSelect, {});
      courseSelect.addEventListener("change", function () {
        var ouId = courseSelect.value;
        if (!ouId) {
          $("clcExistingCard").hidden = true;
          $("clcBuilderCard").hidden = true;
          $("clcHeaderMeta").textContent = "";
          return;
        }
        var label =
          (courseSelect.options[courseSelect.selectedIndex] &&
            courseSelect.options[courseSelect.selectedIndex].textContent) ||
          "";
        loadCourse(ouId, label);
      });
    } else if (courseSelect) {
      courseSelect.innerHTML = "";
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Unable to load courses";
      courseSelect.appendChild(opt);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
