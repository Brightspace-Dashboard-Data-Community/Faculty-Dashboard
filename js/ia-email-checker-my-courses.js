(function () {
  'use strict';

  // =========================
  // CONFIG
  // =========================
  var API_VERSION_LP = '1.51';
  var API_VERSION_LE = '1.82';

  function semesterApi() {
    return window.FacultyDashboardSemester;
  }

  var PREVIOUS_SEMESTER_CODE = semesterApi() ? semesterApi().getPreviousCode() : '26/WI';
  var DEFAULT_SEMESTER_CODE = semesterApi() ? semesterApi().getActiveCode() : '26/SP';
  var FUTURE_SEMESTER_CODE = semesterApi() ? semesterApi().getFutureCode() : '26/FA';
  var ALLOWED_SEMESTER_CODES = {};
  ALLOWED_SEMESTER_CODES[PREVIOUS_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[DEFAULT_SEMESTER_CODE] = true;
  ALLOWED_SEMESTER_CODES[FUTURE_SEMESTER_CODE] = true;
  var TERM_RANGE_LABEL =
    PREVIOUS_SEMESTER_CODE + ', ' + DEFAULT_SEMESTER_CODE + ', and ' + FUTURE_SEMESTER_CODE;
  var SHOW_SANDBOX_ALL_TERMS = true;

  // Intelligent Agents settings page (one per course offering / OrgUnitId)
  var SETTINGS_BASE_URL = '/d2l/lms/intelligentAgents/settings.d2l?ou=';

  // Instructor-ish academic roles
  // (Matches the faculty dashboard "academic" role handling.)
  var ACADEMIC_ROLE_IDS = {
    102: true,  // Instructor
    183: true,  // Secondary Instructor
    108: true,  // Teaching Assistant
    127: true,  // Mentor
    160: true,  // Ghost Instructor
    167: true,  // Instructor - Admin
    174: true   // Instructor - PERMISSION TEST
  };

  var ACADEMIC_ROLE_KEYWORDS = ['instructor', 'teacher', 'faculty', 'assistant', 'ta', 'mentor'];

  // Classlist pagination for instructor email suggestions
  var CLASSLIST_PAGE_SIZE = 100;

  // Concurrency for auditing reply-to settings
  var CONCURRENCY = 2;

  // =========================
  // STATE
  // =========================
  var courses = [];
  var lastAuditRows = [];

  // =========================
  // INIT
  // =========================
  function init() {
    var container = document.getElementById('ia-email-report-widget');
    if (!container) return;

    renderSkeleton(container);
    bindUI();
    loadCourses();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // =========================
  // UI
  // =========================
  function renderSkeleton(container) {
    container.innerHTML = '' +
      '<div class="ia-report-card">' +
      '  <div class="ia-report-head">' +
      '    <div>' +
      '      <div class="ia-report-title">' +
      '        <i class="fas fa-envelope-open-text" aria-hidden="true"></i>' +
      '        Intelligent Agent Reply-To Settings' +
      '      </div>' +
      '      <div class="ia-report-subtitle">' +
      '        Loads your own course offerings, then checks Reply-To values for Intelligent Agents.' +
      '      </div>' +
      '    </div>' +
      '    <div>' +
      '      <span class="ia-pill" id="ia-course-count"><i class="fas fa-spinner" aria-hidden="true"></i> Loading your courses...</span>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <div class="ia-controls-row">' +
      '    <div class="ia-control">' +
      '      <label class="ia-label" for="ia-defaultEmail">Default Reply-To Email (optional)</label>' +
      '      <input id="ia-defaultEmail" class="ia-input" type="text" placeholder="If provided, we flag courses that match this default." />' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <div class="ia-controls-row" style="margin-top: 0;">' +
      '    <label class="ia-checkbox">' +
      '      <input id="ia-blankIsDefault" type="checkbox" checked />' +
      '      Treat blank Reply-To as default' +
      '    </label>' +
      '    <div class="ia-actions">' +
      '      <button id="ia-runAuditBtn" class="ia-btn" disabled>' +
      '        <i class="fas fa-search" aria-hidden="true"></i> Run Report' +
      '      </button>' +
      '      <button id="ia-downloadAllBtn" class="ia-btn ia-btn-outline ia-hidden">' +
      '        <i class="fas fa-file-csv" aria-hidden="true"></i> Download CSV (All)' +
      '      </button>' +
      '      <button id="ia-downloadEmailsBtn" class="ia-btn ia-btn-outline ia-hidden">' +
      '        <i class="fas fa-envelope" aria-hidden="true"></i> Download CSV (Flagged)' +
      '      </button>' +
      '    </div>' +
      '  </div>' +
      '' +
      '  <div class="ia-progress" aria-label="Audit progress">' +
      '    <div class="ia-progress-fill" id="ia-progressFill"></div>' +
      '  </div>' +
      '' +
      '  <div class="ia-status" id="ia-status" aria-live="polite"></div>' +
      '' +
      '  <div class="ia-table-wrap">' +
      '    <table class="ia-table" id="iaTable">' +
      '      <thead>' +
      '        <tr>' +
      '          <th>OrgUnitId</th>' +
      '          <th>Course Code</th>' +
      '          <th>Reply-To</th>' +
      '          <th>Status</th>' +
      '          <th>Suggested Instructor Emails</th>' +
      '          <th>Actions</th>' +
      '        </tr>' +
      '      </thead>' +
      '      <tbody></tbody>' +
      '    </table>' +
      '  </div>' +
      '</div>';
  }

  function bindUI() {
    var runBtn = document.getElementById('ia-runAuditBtn');
    if (runBtn) {
      runBtn.addEventListener('click', runAudit);
    }

    var downloadAllBtn = document.getElementById('ia-downloadAllBtn');
    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', function () { downloadCSV('all'); });
    }

    var downloadEmailsBtn = document.getElementById('ia-downloadEmailsBtn');
    if (downloadEmailsBtn) {
      downloadEmailsBtn.addEventListener('click', function () { downloadCSV('flagged'); });
    }
  }

  function setStatus(msg) {
    var el = document.getElementById('ia-status');
    if (el) el.textContent = msg || '';
  }

  function setProgress(pct) {
    var fill = document.getElementById('ia-progressFill');
    if (!fill) return;
    var w = Math.max(0, Math.min(100, Number(pct) || 0));
    fill.style.width = w + '%';
  }

  function show(id, yes) {
    var el = document.getElementById(id);
    if (!el) return;
    if (yes) el.classList.remove('ia-hidden');
    else el.classList.add('ia-hidden');
  }

  function setCourseCount(courseCount, extra) {
    var el = document.getElementById('ia-course-count');
    if (!el) return;
    el.innerHTML = '<i class="fas fa-layer-group" aria-hidden="true"></i> ' +
      String(courseCount) + ' course offering(s)' + (extra ? (' - ' + extra) : '');
  }

  // =========================
  // DATA FETCH - COURSES
  // =========================
  function BrightspaceFetch(url, options) {
    var token = localStorage.getItem('XSRF.Token');
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers['X-CSRF-Token'] = token;
    opts.credentials = 'include';

    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status + ' - ' + url);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function isCourseOffering(item) {
    if (!item || !item.OrgUnit || !item.OrgUnit.Type) return false;
    if (item.OrgUnit.Type.Code && item.OrgUnit.Type.Code === 'Course Offering') return true;
    if (item.OrgUnit.Type.Id && item.OrgUnit.Type.Id === 3) return true;
    return false;
  }

  function getRoleId(item) {
    if (item && item.Access && typeof item.Access.ClasslistRoleId !== 'undefined' && item.Access.ClasslistRoleId !== null) {
      var n = parseInt(item.Access.ClasslistRoleId, 10);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  function getRoleName(item) {
    if (item && item.Access && item.Access.ClasslistRoleName) return String(item.Access.ClasslistRoleName || '');
    return '';
  }

  function isSandboxCourse(name, code) {
    var s = ((name || '') + ' ' + (code || '')).toLowerCase();
    if (s.indexOf('sandbox') >= 0) return true;
    if (s.indexOf('sbx') >= 0) return true;
    if (s.indexOf('practice') >= 0) return true;
    return false;
  }

  function getSemesterCodeFromCourseCode(courseCode) {
    var api = semesterApi();
    return api ? api.getSemesterCodeFromCourseCode(courseCode) : '';
  }

  function roleNameMatches(roleName, keywords) {
    var r = (roleName || '').toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (r.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function isAcademicRole(roleId, roleName) {
    if (roleId !== null && ACADEMIC_ROLE_IDS[roleId]) return true;
    if (roleId === null) return roleNameMatches(roleName, ACADEMIC_ROLE_KEYWORDS);
    return false;
  }

  function isMergedOrCancelledCourse(name, code) {
    var c = (code || '').toUpperCase();
    var n = (name || '').toUpperCase();
    return c.indexOf('MERGED') >= 0 || c.indexOf('CXLD') >= 0 ||
      n.indexOf('MERGED') >= 0 || n.indexOf('CXLD') >= 0 ||
      c.indexOf('SANDBOX-') === 0 || n.indexOf('SANDBOX-') === 0;
  }

  async function getAllMyEnrollments() {
    var allItems = [];
    var bookmark = null;
    var hasMore = true;

    while (hasMore) {
      var endpoint = bookmark
        ? '/d2l/api/lp/' + API_VERSION_LP + '/enrollments/myenrollments/?bookmark=' + encodeURIComponent(bookmark)
        : '/d2l/api/lp/' + API_VERSION_LP + '/enrollments/myenrollments/';

      var data = await BrightspaceFetch(endpoint);
      if (data && data.Items && data.Items.length) {
        for (var i = 0; i < data.Items.length; i++) allItems.push(data.Items[i]);
      }

      if (data && data.PagingInfo && data.PagingInfo.HasMoreItems) {
        hasMore = true;
        bookmark = data.PagingInfo.Bookmark;
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }

  async function getMyCourseOfferings() {
    var raw = await getAllMyEnrollments();
    var out = [];
    var seen = {};

    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (!isCourseOffering(item)) continue;

      var orgUnitId = item.OrgUnit.Id;
      var name = item.OrgUnit.Name || '';
      var code = item.OrgUnit.Code || '';

      if (!orgUnitId) continue;
      if (seen[String(orgUnitId)]) continue;

      if (isMergedOrCancelledCourse(name, code)) continue;

      var roleId = getRoleId(item);
      var roleName = getRoleName(item);
      var academic = isAcademicRole(roleId, roleName);

      var sandbox = isSandboxCourse(name, code);
      var sem = getSemesterCodeFromCourseCode(code);

      // For non-sandbox courses, include previous/active/future semester academic roles.
      if (sandbox) {
        if (!SHOW_SANDBOX_ALL_TERMS) continue;
        if (!academic) continue;
      } else {
        if (!academic) continue;
        if (!ALLOWED_SEMESTER_CODES[sem]) continue;
      }

      seen[String(orgUnitId)] = true;
      out.push({
        OrgUnitId: String(orgUnitId),
        Code: code,
        Name: name
      });
    }

    // Sort by course code for stable UI
    out.sort(function (a, b) {
      return String(a.Code || '').localeCompare(String(b.Code || ''));
    });

    return out;
  }

  async function loadCourses() {
    var runBtn = document.getElementById('ia-runAuditBtn');
    setProgress(0);
    setStatus('Loading your course offerings...');
    setCourseCount('...', 'Loading...');
    if (runBtn) runBtn.disabled = true;

    try {
      courses = await getMyCourseOfferings();
      setCourseCount(courses.length, 'excluding MERGED/CXLD/Sandbox-*');
      if (runBtn) runBtn.disabled = courses.length === 0;
      if (courses.length === 0) {
        setStatus('No course offerings found for your faculty role(s) in ' + TERM_RANGE_LABEL + '.');
      } else {
        setStatus('Courses loaded. You can run the report.');
      }
    } catch (e) {
      console.error('IA report: failed to load courses', e);
      courses = [];
      setCourseCount(0, 'Error loading');
      if (runBtn) runBtn.disabled = true;
      setStatus('Failed to load courses. See console for details.');
    }
  }

  // =========================
  // DATA FETCH - IA REPLY-TO
  // =========================
  function deepCollect(root, selector) {
    var out = [];
    function walk(node) {
      if (!node) return;
      try {
        node.querySelectorAll(selector).forEach(function (el) {
          out.push(el);
        });
      } catch (e) {}

      var all = [];
      try {
        all = node.querySelectorAll('*');
      } catch (e2) {
        all = [];
      }

      for (var i = 0; i < all.length; i++) {
        try {
          if (all[i] && all[i].shadowRoot) walk(all[i].shadowRoot);
        } catch (e3) {}
      }
    }
    walk(root);
    return out;
  }

  function extractReplyTo(doc) {
    var el = doc.querySelector('#replyToAddress');
    if (el && typeof el.value !== 'undefined') return String(el.value || '').trim();

    var wc = deepCollect(doc, 'd2l-input-text');
    for (var i = 0; i < wc.length; i++) {
      var lbl = ((wc[i].getAttribute('label') || '') + '').toLowerCase();
      if (lbl.indexOf('reply') >= 0) return String(wc[i].value || '').trim();
    }

    var inputs = doc.querySelectorAll('input[type="email"], input[type="text"]');
    for (var j = 0; j < inputs.length; j++) {
      var id = ((inputs[j].id || '') + '').toLowerCase();
      var nm = ((inputs[j].name || '') + '').toLowerCase();
      if (id.indexOf('reply') >= 0 || nm.indexOf('reply') >= 0) return String(inputs[j].value || '').trim();
    }

    return '';
  }

  function getReplyTo(ou, timeoutMs) {
    return new Promise(function (resolve) {
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = SETTINGS_BASE_URL + encodeURIComponent(ou);

      var done = false;
      var poll = null;
      var timer = null;

      function cleanup(res) {
        if (done) return;
        done = true;
        try { if (poll) clearInterval(poll); } catch (e) {}
        try { if (timer) clearTimeout(timer); } catch (e2) {}
        try { iframe.remove(); } catch (e3) {}
        resolve(res);
      }

      iframe.onload = function () {
        try {
          var doc = iframe.contentDocument || iframe.contentWindow.document;
          poll = setInterval(function () {
            try {
              var v = extractReplyTo(doc);
              if (typeof v === 'string') {
                cleanup({ ok: true, value: v });
              }
            } catch (e) {}
          }, 250);

          timer = setTimeout(function () {
            cleanup({ ok: false, value: '', note: 'settings timeout' });
          }, timeoutMs || 12000);
        } catch (e4) {
          cleanup({ ok: false, value: '', note: 'settings access denied' });
        }
      };

      document.body.appendChild(iframe);
    });
  }

  // =========================
  // DATA FETCH - INSTRUCTOR EMAILS (for empty reply-to)
  // =========================
  async function fetchInstructorEmails(ou) {
    try {
      var LE_VER = API_VERSION_LE;
      var pageSize = CLASSLIST_PAGE_SIZE;

      var bookmark = '';
      var emails = {};
      var guard = 0;

      while (guard < 50) {
        var url = '/d2l/api/le/' + LE_VER + '/' + encodeURIComponent(ou) + '/classlist/paged/?pageSize=' + pageSize;
        if (bookmark) url += '&bookmark=' + encodeURIComponent(bookmark);

        var page = await BrightspaceFetch(url);
        var items = page.Items || page.Objects || page.items || [];

        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var roleName =
            item.RoleName ||
            item.ClasslistRoleName ||
            item.ClasslistRoleDisplayName ||
            (item.Roles && item.Roles[0] && (item.Roles[0].DisplayName || item.Roles[0].Name)) ||
            '';

          var rn = String(roleName || '').toLowerCase();
          var isInstructor =
            rn.indexOf('instructor') >= 0 ||
            rn.indexOf('faculty') >= 0 ||
            rn.indexOf('teacher') >= 0 ||
            rn.indexOf('professor') >= 0;

          if (!isInstructor) continue;

          var email =
            item.Email ||
            (item.User && item.User.EmailAddress) ||
            item.EmailAddress ||
            '';

          if (email && email.indexOf('@') !== -1) {
            emails[String(email).trim()] = true;
          }
        }

        var next =
          (page.PagingInfo && (page.PagingInfo.Bookmark || page.PagingInfo.bookmark)) ||
          page.Bookmark ||
          page.bookmark ||
          '';

        var hasMore =
          page.PagingInfo && (page.PagingInfo.HasMoreItems || page.PagingInfo.hasMoreItems);

        if (!hasMore || !next) break;
        if (bookmark === next) break;

        bookmark = next;
        guard++;
      }

      return { ok: true, emails: Object.keys(emails) };
    } catch (e) {
      console.error('IA report: classlist API failed', e);
      return { ok: false, emails: [], note: e.message || 'classlist error' };
    }
  }

  // =========================
  // AUDIT
  // =========================
  async function runAudit() {
    var runBtn = document.getElementById('ia-runAuditBtn');
    var downloadAllBtn = document.getElementById('ia-downloadAllBtn');
    var downloadEmailsBtn = document.getElementById('ia-downloadEmailsBtn');
    var tbody = document.querySelector('#iaTable tbody');

    if (!courses.length) return;

    if (runBtn) runBtn.disabled = true;
    if (downloadAllBtn) downloadAllBtn.classList.add('ia-hidden');
    if (downloadEmailsBtn) downloadEmailsBtn.classList.add('ia-hidden');

    if (tbody) tbody.innerHTML = '';

    var defaultEmail = ((document.getElementById('ia-defaultEmail') || {}).value || '').trim().toLowerCase();
    var blankIsDefault = !!(document.getElementById('ia-blankIsDefault') && document.getElementById('ia-blankIsDefault').checked);

    setProgress(0);
    setStatus('Starting audit...');

    var queue = courses.slice();
    var total = queue.length || 1;
    var done = 0;
    var rows = [];

    var workers = Math.min(CONCURRENCY, total);

    async function worker() {
      while (queue.length) {
        var course = queue.shift();
        var ou = course.OrgUnitId;

        var reply = '';
        var status = '';
        var statusClass = '';
        var note = '';
        var emails = '';

        try {
          var r = await getReplyTo(ou, 12000);
          reply = r.value || '';
          if (!r.ok && r.note) note = r.note;
        } catch (e) {
          note = (e && e.message) ? e.message : 'settings error';
        }

        var norm = (reply || '').trim().toLowerCase();
        if (norm) {
          if (defaultEmail && norm === defaultEmail) {
            status = 'Default (unchanged)';
            statusClass = 'ia-ok';
            if (!note) note = 'Matches provided default';
          } else {
            status = 'Custom (overridden)';
            statusClass = 'ia-warn';
          }
        } else {
          if (blankIsDefault) {
            status = 'Empty (likely default)';
            statusClass = 'ia-warn';
          } else {
            status = 'Empty (needs update)';
            statusClass = 'ia-err';
          }

          // Only pay the classlist cost when Reply-To is empty (likely default).
          try {
            var eRes = await fetchInstructorEmails(ou);
            emails = (eRes.emails || []).join('; ');
          } catch (e2) {}
        }

        rows.push({
          OrgUnitId: ou,
          Code: course.Code || '',
          ReplyTo: reply,
          Status: status,
          StatusClass: statusClass,
          InstructorEmails: emails,
          Note: note
        });

        done++;
        var pct = Math.round((done / total) * 100);
        setProgress(pct);
        setStatus('Checked ' + done + ' / ' + total);
      }
    }

    var workerPromises = [];
    for (var i = 0; i < workers; i++) workerPromises.push(worker());
    await Promise.all(workerPromises);

    lastAuditRows = rows;
    renderResults(rows);

    if (runBtn) runBtn.disabled = false;

    show('ia-downloadAllBtn', rows.length > 0);
    var flaggedCount = rows.filter(function (r) {
      return String(r.InstructorEmails || '').trim().length > 0;
    }).length;
    show('ia-downloadEmailsBtn', flaggedCount > 0);
    setStatus('Audit complete.');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderResults(rows) {
    var tbody = document.querySelector('#iaTable tbody');
    if (!tbody) return;

    // Stable ordering
    rows.sort(function (a, b) {
      return String(a.OrgUnitId || '').localeCompare(String(b.OrgUnitId || ''));
    });

    tbody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var replyDisplay = (r.ReplyTo || '').trim() ? r.ReplyTo : '-';
      var emailsDisplay = (r.InstructorEmails || '').trim() ? r.InstructorEmails : '-';
      var settingsUrl = SETTINGS_BASE_URL + encodeURIComponent(r.OrgUnitId);

      var noteHtml = r.Note ? '<span class="ia-note">' + escapeHtml(r.Note) + '</span>' : '';

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="ia-mono"><span class="ia-mono">' + escapeHtml(r.OrgUnitId) + '</span></td>' +
        '<td class="ia-mono"><span class="ia-mono">' + escapeHtml(r.Code) + '</span></td>' +
        '<td class="ia-mono">' + escapeHtml(replyDisplay) + '</td>' +
        '<td><span class="' + escapeHtml(r.StatusClass || '') + '">' + escapeHtml(r.Status) + '</span>' + noteHtml + '</td>' +
        '<td class="ia-mono">' + escapeHtml(emailsDisplay) + '</td>' +
        '<td>' +
        '<a class="ia-open-settings" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(settingsUrl) + '">' +
        'Open Settings' +
        '</a>' +
        '</td>';

      tbody.appendChild(tr);
    }
  }

  // =========================
  // DOWNLOAD CSV
  // =========================
  function downloadCSV(type) {
    if (!lastAuditRows.length) return;

    var rows = lastAuditRows;
    if (type === 'flagged') {
      rows = rows.filter(function (r) {
        return String(r.InstructorEmails || '').trim().length > 0;
      });
    }

    var csvText = generateCSV(rows);
    var filename = type === 'flagged' ? 'ia-email-checker_flagged.csv' : 'ia-email-checker_all.csv';
    downloadBlob(filename, csvText);
  }

  function q(s) {
    return '"' + String(s || '').replace(/"/g, '""') + '"';
  }

  function generateCSV(rows) {
    var header = 'OrgUnitId,CourseCode,ReplyToValue,Status,InstructorEmails,SettingsURL\n';
    var lines = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var settingsUrl = SETTINGS_BASE_URL + encodeURIComponent(r.OrgUnitId);
      lines.push([
        q(r.OrgUnitId),
        q(r.Code),
        q(r.ReplyTo),
        q(r.Status),
        q(r.InstructorEmails || ''),
        q(settingsUrl)
      ].join(','));
    }

    return header + lines.join('\n');
  }

  function downloadBlob(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

})();

