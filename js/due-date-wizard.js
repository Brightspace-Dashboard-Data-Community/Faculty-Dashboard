/* ============================================================
   Instructor Dashboards · Due Date Wizard
   Your Institution · Instructional Technology

   Workflow:
     1. Pick a pinned course (shared module renders the tiles).
     2. The dashboard fetches every assignment (dropbox folder) and
        every quiz in that course, with their current due dates.
     3. Each row gets an editable <input type="datetime-local"/>.
     4. "Save All Changes" PUTs each modified item back to
        Brightspace. Per-row status (saved / fail) is reflected in
        the input's border color.

   API endpoints used:
     GET  /d2l/api/le/{LE}/{ouId}/dropbox/folders/
     PUT  /d2l/api/le/{LE}/{ouId}/dropbox/folders/{folderId}
     GET  /d2l/api/le/{LE}/{ouId}/quizzes/
     PUT  /d2l/api/le/{LE}/{ouId}/quizzes/{quizId}

   Brightspace's PUT requires sending the full GET-shaped object
   back with the modified field. We GET → mutate DueDate → PUT.
   ============================================================ */
(function () {
  'use strict';
  const BSP = window.BSP = window.BSP || {};
  BSP.modules = BSP.modules || {};

  const STATE = {
    courseId:    null,
    courseLabel: '',
    items:       [],   // { type, id, name, dueDate, original }
    busy:        false,
    myRoleName:  null, // Set by fetchMyRoleForCourse() during loadCourse
  };

  /** Roles known to lack Brightspace's "Manage Assignment Submission Folders"
   *  permission at Your Institution. Empty by default — add role names here only
   *  after confirming they cannot save dropbox dates via the Valence API. */
  const RESTRICTED_DROPBOX_ROLES = [];

  /** Is the current user's role on the restricted list? Case-insensitive
   *  comparison so minor naming drift (capitalization, hyphens) doesn't
   *  silently break the check. Returns false while the role is still
   *  loading so we don't lock users out before we know. */
  function isUserRestrictedForDropbox() {
    const r = (STATE.myRoleName || '').trim().toLowerCase();
    if (!r) return false;
    return RESTRICTED_DROPBOX_ROLES.some(x => x.toLowerCase() === r);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  /** Short M/D/YYYY format for the "set these manually" panel — designed
   *  to be pasted directly into Brightspace's date input (which accepts
   *  M/D/YYYY without leading zeros). The wizard always normalizes to
   *  11:59 PM, but the table only shows the date — time is fixed and
   *  doesn't need to be transcribed. */
  function fmtDateForTranscribe(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
    });
  }
  /* Date-only input helpers. The dashboard intentionally hides the
     time component — every due date is normalized to 11:59 PM local
     time on save, matching your institution's policy that assignments are due at
     end-of-day. The HTML uses <input type="date"> so the picker only
     surfaces calendar days (no time spinner). */
  function dateOnlyFromIso(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /** YYYY-MM-DD → ISO at 23:59:00 LOCAL (then converted to UTC).
      Brightspace stores UTC, but the user's intent is "this calendar
      day at 11:59 PM in their local time zone", so we anchor to local
      first and let toISOString() do the UTC conversion. */
  function isoFromDateOnly(dateStr) {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const dt = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 0, 0);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  /* Detect "Session 1", "Week 12", etc. embedded anywhere in an item
     name. Matches "session 1", "Session-1", "Wk 1", "Week 02", etc.
     Returns { rawType: 'session'|'week', num: <int> } or null.

     Sessions and weeks are treated as interchangeable for grouping and
     cascade — a "Session 1 Quiz" and a "Week 1 Assignment" both belong
     to the same week-1 group. The rawType is preserved only so the
     bulk-update label can echo whichever naming the instructor used most
     in their course.

     Special case: "GTKY" or "Getting to Know You" is the standard Institution
     intro discussion and is functionally a Week 1 / Session 1 activity
     even though it rarely says so explicitly. We treat it as such so
     the cascade picks it up automatically. */
  function detectSessionWeek(name) {
    const s = String(name || '');
    if (/\bGTKY\b/i.test(s) || /\bgetting\s+to\s+know\s+you\b/i.test(s)) {
      return { rawType: 'session', num: 1 };
    }
    const m = s.match(/\b(session|wk|week)\s*0*(\d{1,2})\b/i);
    if (!m) return null;
    const t = m[1].toLowerCase();
    return { rawType: (t === 'session' ? 'session' : 'week'), num: parseInt(m[2], 10) };
  }

  /* Single canonical key for both Sessions and Weeks. Same number → same
     group, regardless of which word the instructor used. */
  function bulkKeyOf(num) { return 'wk-' + num; }

  async function init(courseId) {
    console.info('[DueDates] Institution Faculty Dashboard init');

    var courseSelect = document.getElementById('ddwCourse');
    if (courseSelect && window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(courseSelect, {
        selectedValue: courseId ? String(courseId) : ''
      });
      courseSelect.addEventListener('change', function () {
        var ouId = courseSelect.value;
        if (!ouId) return;
        var label = courseSelect.options[courseSelect.selectedIndex].textContent || '';
        if (ouId === String(STATE.courseId)) return;
        loadCourse(ouId, label, label);
      });
      if (courseId) {
        loadCourse(courseId, '', '');
      }
    }

    const saveBtn = document.getElementById('ddSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', onSaveAll);

    try {
      const me = await BSP.api.whoami();
      const meta = document.getElementById('ddHeaderMeta');
      if (meta && me) {
        meta.textContent = 'Signed in as ' + ((me.FirstName || '') + ' ' + (me.LastName || '')).trim();
      }
    } catch (e) { /* fine */ }

    if (STATE.courseId && STATE.courseLabel) {
      setTimeout(function () {
        loadCourse(STATE.courseId, STATE.courseLabel, STATE.courseLabel);
      }, 0);
    }
  }

  async function loadCourse(ouId, code, name) {
    STATE.courseId    = ouId;
    STATE.courseLabel = code || name || ('Course ' + ouId);

    const card    = document.getElementById('ddEditorCard');
    const heading = document.getElementById('ddEditorHeading');
    const editor  = document.getElementById('ddEditor');
    const saveBar = document.getElementById('ddSaveBar');
    const status  = document.getElementById('ddSaveStatus');
    if (!card) return;

    card.style.display = '';
    heading.textContent = 'Due Dates · ' + STATE.courseLabel;
    editor.innerHTML = '<div class="ldg" role="status"><div class="sp"></div>' +
      '<p>Loading assignments, quizzes, and discussions…</p></div>';
    saveBar.style.display = 'none';
    status.textContent = '';
    // Clear any prior course's permission-failure panel so it doesn't leak
    // across courses if the user navigates between them.
    const oldPanel = document.getElementById('ddPermissionPanel');
    if (oldPanel) oldPanel.remove();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Fetch the user's role in this course. Once known, if the role is on
    // the restricted-dropbox list, render the manual-action panel
    // proactively so the user knows up-front which items will need manual
    // editing in Brightspace.
    fetchMyRoleForCourse(ouId).then(r => {
      STATE.myRoleName = r;
      maybeRenderRestrictedPanel();
    });

    try {
      const [folders, quizList, forums] = await Promise.all([
        BSP.api.dropboxFolders(ouId).catch(e => { console.warn('dropbox load', e); return []; }),
        BSP.api.quizzes(ouId).catch(e => { console.warn('quizzes load', e); return []; }),
        BSP.api.forums(ouId).catch(e => { console.warn('forums load', e); return []; }),
      ]);

      // Visibility filter — only edit dates for items students can see.
      //
      // DropboxFolder hidden flags Brightspace returns vary by API
      // version: `IsHidden` (top-level), `Availability.IsHidden`, and
      // some tenants use `Hidden` instead. We treat "hidden" as a hard
      // exclude. Items hidden by release conditions or group/role
      // restrictions can't be detected from this endpoint alone, so
      // the policy here is: if the FOLDER itself is hidden from
      // students, skip it; if it's published, include it.
      function isFolderHidden(f) {
        if (!f) return true;
        if (f.IsHidden === true || f.Hidden === true) return true;
        if (f.Availability && f.Availability.IsHidden === true) return true;
        if (f.Visibility && f.Visibility.IsHidden === true) return true;
        return false;
      }
      // Quiz hidden flags: `IsActive` (false = unpublished/draft) and
      // `Status` (some endpoints expose 1=Inactive, 2=Active). Treat
      // either as "not visible to students".
      function isQuizHidden(q) {
        if (!q) return true;
        if (q.IsActive === false) return true;
        if (typeof q.Status === 'number' && q.Status !== 2) return true;
        if (q.IsHidden === true || q.Hidden === true) return true;
        return false;
      }
      // Discussion topic hidden flags: `IsHidden` (most common shape),
      // and the topic's Type code where 0/null = unpublished. Treat
      // anything that wouldn't show to a student as hidden.
      function isTopicHidden(t) {
        if (!t) return true;
        if (t.IsHidden === true || t.Hidden === true) return true;
        if (t.Availability && t.Availability.IsHidden === true) return true;
        return false;
      }

      const visibleFolders = (folders || []).filter(f => !isFolderHidden(f));
      const allQuizzes     = (quizList && quizList.Objects) || quizList || [];
      const visibleQuizzes = allQuizzes.filter(q => !isQuizHidden(q));

      // Discussion topics — fetch one /topics/ call per forum, then
      // flatten + filter. We include topics that have a DueDate set
      // OR whose name suggests they're scheduled (GTKY etc.) since
      // some forums omit DueDate but the topic is still due-dated
      // by convention. Errors per forum are isolated so one bad
      // forum doesn't take down the rest.
      const allTopics = [];
      const forumList = Array.isArray(forums) ? forums : ((forums && forums.Items) || []);
      for (const f of forumList) {
        const fid = f && (f.ForumId || f.Id || f.Identifier);
        if (!fid) continue;
        try {
          const topics = await BSP.api.forumTopics(ouId, fid);
          const tlist = Array.isArray(topics) ? topics : ((topics && topics.Items) || []);
          for (const t of tlist) {
            if (isTopicHidden(t)) continue;
            allTopics.push({ topic: t, forumId: fid, forumName: (f.Name || '') });
          }
        } catch (e) {
          console.warn('[DueDates] forum topics load failed', fid, e);
        }
      }

      const skippedFolders  = (folders || []).length - visibleFolders.length;
      const skippedQuizzes  = allQuizzes.length        - visibleQuizzes.length;
      console.info('[DueDates] hidden items excluded — ' +
        skippedFolders + ' folder(s), ' + skippedQuizzes + ' quiz(zes); ' +
        allTopics.length + ' visible topic(s) found across ' + forumList.length + ' forum(s)');

      const assignments = visibleFolders.map(f => ({
        type:     'assignment',
        id:       f.Id,
        name:     f.Name || ('Assignment ' + f.Id),
        dueDate:  f.DueDate || null,
        endDate:  f.EndDate || null,
        original: f,
      }));
      const quizzes = visibleQuizzes.map(q => ({
        type:     'quiz',
        id:       q.QuizId,
        name:     q.Name || ('Quiz ' + q.QuizId),
        dueDate:  q.DueDate || null,
        endDate:  q.EndDate || null,
        original: q,
      }));
      const discussions = allTopics.map(({ topic, forumId, forumName }) => ({
        type:     'discussion',
        id:       topic.TopicId || topic.Id,
        forumId:  forumId,
        name:     topic.Name || ('Discussion ' + (topic.TopicId || topic.Id)),
        forumName: forumName,
        dueDate:  topic.DueDate || null,
        endDate:  topic.EndDate || null,
        original: topic,
      }));
      STATE.items = assignments.concat(quizzes).concat(discussions);
      console.info('[DueDates] loaded', assignments.length, 'assignments +',
        quizzes.length, 'quizzes +', discussions.length, 'discussions for course', ouId);
      renderEditor();
    } catch (e) {
      console.error('[DueDates] loadCourse error', e);
      editor.innerHTML = '<div class="empty"><h3>Couldn\'t load due dates</h3>' +
        '<p>' + escapeHTML(e.message || 'Unknown error.') + '</p></div>';
    }
  }

  /* Natural-numeric collator — sorts "Week 9" before "Week 10" rather
     than treating "1" as lexicographically less than "9". Used for
     name comparisons across the editor and bulk sections so embedded
     digits behave the way humans expect. */
  const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

  function typeOrder(type) {
    // Assignments first (most "due date" weight), then quizzes, then
    // discussions — order is purely cosmetic but consistent.
    if (type === 'assignment') return 0;
    if (type === 'quiz')       return 1;
    if (type === 'discussion') return 2;
    return 3;
  }

  function typeLabel(type) {
    if (type === 'assignment') return 'Assignment';
    if (type === 'quiz')       return 'Quiz';
    if (type === 'discussion') return 'Discussion';
    return 'Item';
  }

  function typeCss(type) {
    if (type === 'assignment') return 'dd-type-assignment';
    if (type === 'quiz')       return 'dd-type-quiz';
    if (type === 'discussion') return 'dd-type-discussion';
    return '';
  }

  function renderEditor() {
    const editor  = document.getElementById('ddEditor');
    const saveBar = document.getElementById('ddSaveBar');
    if (STATE.items.length === 0) {
      editor.innerHTML = '<div class="empty"><h3>No assignments, quizzes, or discussions</h3>' +
        '<p>This course has no dropbox folders, quizzes, or discussion topics to manage.</p></div>';
      saveBar.style.display = 'none';
      renderBulkSection(); // hides bulk card too
      return;
    }

    // Split items into "categorized" (matched a Session/Week or GTKY)
    // and "uncategorized" (didn't). Categorized rows appear first,
    // grouped by week number; uncategorized rows appear at the bottom
    // under a section header so the instructor can see what the
    // cascade missed.
    const categorized   = [];
    const uncategorized = [];
    for (const it of STATE.items) {
      const sw = detectSessionWeek(it.name);
      if (sw) categorized.push({ it, sw });
      else    uncategorized.push({ it });
    }

    // Categorized: sort by week num ASC, then type, then name (natural).
    categorized.sort((a, b) => {
      if (a.sw.num !== b.sw.num) return a.sw.num - b.sw.num;
      const tDiff = typeOrder(a.it.type) - typeOrder(b.it.type);
      if (tDiff) return tDiff;
      return NATURAL_SORT(a.it.name || '', b.it.name || '');
    });
    // Uncategorized: type first, then natural-name.
    uncategorized.sort((a, b) => {
      const tDiff = typeOrder(a.it.type) - typeOrder(b.it.type);
      if (tDiff) return tDiff;
      return NATURAL_SORT(a.it.name || '', b.it.name || '');
    });

    function rowFor(it) {
      const realIdx = STATE.items.indexOf(it);
      const typeCls = typeCss(it.type);
      const lbl     = typeLabel(it.type);
      const sw      = detectSessionWeek(it.name);
      const swKey   = sw ? bulkKeyOf(sw.num) : '';
      // Discussions show their forum in a small subtitle so the
      // instructor can find them in Brightspace if they're surprised.
      const nameCell = escapeHTML(it.name) +
        (it.type === 'discussion' && it.forumName
          ? '<div style="font-size:.76rem;color:var(--ccu-mute);margin-top:2px">in ' +
            escapeHTML(it.forumName) + '</div>'
          : '');

      // Discussions are visible but read-only — the Institution course shells
      // currently don't carry due dates on discussion topics, and even
      // when they do the wizard doesn't push dates back yet. Render
      // a plain-text "display only" cell instead of an editable input
      // so the instructor sees the discussion exists for the week
      // without being able to (mistakenly) set a date that won't save.
      if (it.type === 'discussion') {
        return '<tr data-idx="' + realIdx + '" data-sw-key="' + escapeHTML(swKey) + '" class="dd-row-readonly">' +
          '<td><span class="' + typeCls + '">' + lbl + '</span></td>' +
          '<td>' + nameCell + '</td>' +
          '<td><div class="dd-readonly-note">' +
            'Display only — discussion due dates aren\'t editable yet.' +
          '</div></td>' +
          '<td class="dd-current">' + escapeHTML(fmtDate(it.dueDate)) + '</td>' +
        '</tr>';
      }

      return '<tr data-idx="' + realIdx + '" data-sw-key="' + escapeHTML(swKey) + '">' +
        '<td><span class="' + typeCls + '">' + lbl + '</span></td>' +
        '<td>' + nameCell + '</td>' +
        '<td><input type="date" class="dd-input dd-due" ' +
          'value="' + escapeHTML(dateOnlyFromIso(it.dueDate)) + '" ' +
          'aria-label="Due date for ' + escapeHTML(it.name) + '"/></td>' +
        '<td class="dd-current">' + escapeHTML(fmtDate(it.dueDate)) + '</td>' +
      '</tr>';
    }

    const catRows = categorized.map(({ it }) => rowFor(it)).join('');
    const uncatRows = uncategorized.map(({ it }) => rowFor(it)).join('');

    // Section divider for the uncategorized group — only rendered when
    // there are uncategorized items. The header sits inside its own
    // <tr> so it scrolls with the table.
    const uncatHeader = uncategorized.length > 0
      ? '<tr class="dd-section-header"><td colspan="4">' +
          '<strong>Uncategorized items</strong> · ' +
          uncategorized.length + ' item' + (uncategorized.length === 1 ? '' : 's') +
          ' that didn\'t match a Session/Week (or GTKY). Edit these dates by hand below.' +
        '</td></tr>'
      : '';

    editor.innerHTML =
      '<table class="dd-table" role="grid">' +
        '<thead><tr>' +
          '<th style="width:11%">Type</th>' +
          '<th style="width:42%">Name</th>' +
          '<th style="width:22%">New Due Date</th>' +
          '<th style="width:25%">Current</th>' +
        '</tr></thead>' +
        '<tbody>' +
          catRows +
          uncatHeader +
          uncatRows +
        '</tbody>' +
      '</table>';
    saveBar.style.display = 'flex';

    // Highlight rows when the per-item date changes.
    editor.querySelectorAll('.dd-due').forEach(input => {
      input.addEventListener('input', onPerItemDateChange);
    });

    renderBulkSection();
  }

  function onPerItemDateChange() {
    const tr = this.closest('tr');
    const idx = parseInt(tr.dataset.idx, 10);
    const it = STATE.items[idx];
    const newIso = isoFromDateOnly(this.value);
    const dirty = (newIso || null) !== (it.dueDate || null);
    tr.classList.toggle('dd-changed', dirty);
    tr.classList.remove('dd-row-saved', 'dd-row-fail');
    // Update the bulk-section "Current" hint if this row's group might
    // have changed common-date status.
    refreshBulkRowCommonHint(tr.dataset.swKey);
  }

  /* ─── Bulk update by Session / Week ────────────────────────── */
  function renderBulkSection() {
    const bulkCard = document.getElementById('ddBulkCard');
    const bulk     = document.getElementById('ddBulk');
    if (!bulkCard || !bulk) return;

    // Group items by week number — Sessions and Weeks are interchangeable,
    // so a "Session 1 Quiz" and a "Week 1 Assignment" land in the same
    // group. The label echoes whichever naming the instructor used most
    // in this group's items (ties go to "Session" because it's typical
    // Your Institution phrasing).
    const groups = new Map();
    for (const it of STATE.items) {
      const sw = detectSessionWeek(it.name);
      if (!sw) continue;
      const key = bulkKeyOf(sw.num);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          num: sw.num,
          rawTypeCounts: { session: 0, week: 0 },
          items: [],
        });
      }
      const g = groups.get(key);
      g.rawTypeCounts[sw.rawType]++;
      g.items.push(it);
    }

    // Decide the display label per group based on dominant raw type.
    for (const g of groups.values()) {
      const dominant = g.rawTypeCounts.session >= g.rawTypeCounts.week ? 'session' : 'week';
      g.label = (dominant === 'session' ? 'Session ' : 'Week ') + g.num;
    }

    if (groups.size === 0) {
      bulkCard.style.display = 'none';
      bulk.innerHTML = '';
      return;
    }
    bulkCard.style.display = '';

    // Sort by week number ascending — single unified list, no
    // sessions-first/weeks-second split anymore.
    const sorted = Array.from(groups.values()).sort((a, b) => a.num - b.num);

    const rows = sorted.map((g, idx) => {
      // Bulk date math considers only the editable items (assignments +
      // quizzes). Discussions appear in the per-item editor as read-only
      // rows for context but the wizard isn't pushing dates back to
      // them, so they shouldn't influence the "Current" common-date or
      // skew the cascade toward null.
      const editable = g.items.filter(it => it.type !== 'discussion');
      const discussionsOnly = editable.length === 0 && g.items.length > 0;
      // Only Week 1 / Session 1 gets the cascade anchor capability
      // when it's discussion-only. That's where a GTKY-only Week 1
      // makes sense as the anchor for the rest of the course.
      // Discussion-only groups in any later week (Week 5, etc.) just
      // receive the propagated date without a manually-editable input
      // — the user shouldn't be able to type a date there since the
      // cascade has already flowed through from Week 1.
      const isWeekOne = g.num === 1;
      const allowDiscussionAnchor = discussionsOnly && isWeekOne;
      const disableInput = discussionsOnly && !allowDiscussionAnchor;
      const dates = editable.map(it => dateOnlyFromIso(it.dueDate));
      const allSame = dates.length > 0 && dates.every(d => d === dates[0]);
      const commonDate = allSame ? dates[0] : '';
      const currentCell = discussionsOnly
        ? '<span style="color:var(--ccu-mute);font-style:italic">Discussions only — read-only</span>'
        : (allSame
            ? (commonDate ? fmtDate(isoFromDateOnly(commonDate)) : '— none on record —')
            : '<span style="color:var(--ccu-mute);font-style:italic">Mixed</span>');
      const itemsList = g.items.map(it => {
        const icon = it.type === 'assignment' ? '📄 '
                   : it.type === 'quiz'       ? '✓ '
                   : it.type === 'discussion' ? '💬 '
                   : '• ';
        const tail = it.type === 'discussion'
          ? ' <span style="color:var(--ccu-mute);font-style:italic">(read-only)</span>'
          : '';
        return '<li>' + icon + escapeHTML(it.name) + tail + '</li>';
      }).join('');
      // For Week 1 / Session 1 with discussions only, the input is
      // editable so it can anchor the cascade. Other discussion-only
      // groups have a disabled input — they receive the cascade but
      // can't be manually anchored.
      const ariaLabel = allowDiscussionAnchor
        ? 'Anchor a cascade date for ' + g.label + ' (no editable items in this group)'
        : disableInput
          ? 'No editable items — discussions are read-only'
          : 'Set due date for all ' + g.label + ' items';
      // Note hint, only for the Week 1 anchor case so the user understands
      // why typing a date here doesn't change anything in the per-item
      // editor below — the date just propagates forward.
      const subnote = allowDiscussionAnchor
        ? '<div style="font-size:.74rem;color:var(--ccu-mute);font-style:italic;margin-top:4px">Anchors cascade only — no row saved in this group.</div>'
        : '';
      const disabledAttr = disableInput ? ' disabled' : '';
      return '<tr data-bulk-key="' + escapeHTML(g.key) + '"' +
              (discussionsOnly ? ' data-discussions-only="1"' : '') + '>' +
        '<td><strong style="color:var(--ccu-db)">' + escapeHTML(g.label) + '</strong>' +
          subnote +
          '<details style="margin-top:4px"><summary style="cursor:pointer;font-size:.8rem;color:var(--ccu-mute)">' +
          g.items.length + ' item' + (g.items.length === 1 ? '' : 's') + '</summary>' +
          '<ul style="margin:6px 0 0 18px;padding:0;font-size:.82rem;color:var(--ccu-mute)">' + itemsList + '</ul>' +
          '</details></td>' +
        '<td><input type="date" class="dd-input dd-bulk" ' +
          'value="' + escapeHTML(commonDate) + '"' + disabledAttr + ' ' +
          'aria-label="' + escapeHTML(ariaLabel) + '"/></td>' +
        '<td class="dd-bulk-current">' + currentCell + '</td>' +
      '</tr>';
    }).join('');

    bulk.innerHTML =
      '<table class="dd-table" role="grid">' +
        '<thead><tr>' +
          '<th style="width:42%">Group</th>' +
          '<th style="width:33%">Set Due Date for All</th>' +
          '<th style="width:25%">Current</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    // When a bulk date changes, propagate to every per-item input in
    // that group below. This just fills the inputs; the user still
    // clicks "Save All Changes" to commit.
    bulk.querySelectorAll('.dd-bulk').forEach(input => {
      input.addEventListener('input', onBulkDateChange);
    });

    // After initial render, run the break-week sweep so any gaps > 7
    // days between consecutive same-type rows get a red warning.
    updateBreakIndicators();
  }

  /** Walks the bulk grid and inserts a red warning row between any two
   *  consecutive same-type rows whose dates are more than 7 days apart.
   *  Re-runs on every cascade step and on every manual edit, so the
   *  warnings stay in sync with the current dates. */
  function updateBreakIndicators() {
    const tbody = document.querySelector('#ddBulk tbody');
    if (!tbody) return;

    // Remove any prior warning rows so we're starting clean.
    tbody.querySelectorAll('.dd-break-row').forEach(r => r.remove());

    const rows = Array.from(tbody.querySelectorAll('tr[data-bulk-key]'));
    const dayMs = 86400000;

    for (let i = 0; i < rows.length - 1; i++) {
      const cur  = rows[i];
      const next = rows[i + 1];
      const curM  = (cur.dataset.bulkKey  || '').match(/^wk-(\d+)$/);
      const nextM = (next.dataset.bulkKey || '').match(/^wk-(\d+)$/);
      // Sessions and Weeks share a unified key now, so every consecutive
      // pair in the bulk table is a candidate for a break-week gap.
      if (!curM || !nextM) continue;

      const curInput  = cur.querySelector('.dd-bulk');
      const nextInput = next.querySelector('.dd-bulk');
      const d1 = curInput  && parseLocalDate(curInput.value);
      const d2 = nextInput && parseLocalDate(nextInput.value);
      if (!d1 || !d2) continue;

      const diff = Math.round((d2.getTime() - d1.getTime()) / dayMs);
      if (diff <= 7) continue;

      const warn = document.createElement('tr');
      warn.className = 'dd-break-row';
      warn.innerHTML =
        '<td colspan="3" style="background:#FFEBEE;border-left:4px solid #B71C1C;' +
                              'padding:9px 14px;color:#B71C1C;' +
                              'font-size:.86rem;letter-spacing:.2px;line-height:1.5">' +
          '<div style="font-weight:600">' +
            '<span aria-hidden="true" style="margin-right:6px">⚠️</span>' +
            diff + '-day gap detected — <strong>ensure no assignments are due, or this is a break week</strong>.' +
          '</div>' +
          '<div style="font-weight:400;margin-top:4px;color:#7A2222">' +
            'Note: discussion boards in Institution courses currently don\'t have due dates set, so they don\'t show up here. If a week\'s only graded item is a discussion board, you\'ll see a visible gap.' +
          '</div>' +
        '</td>';
      next.parentNode.insertBefore(warn, next);
    }
  }

  /** Top-level handler: user just typed a date in a Session/Week bulk
      input. Apply that date to every per-item row in the same group AND
      cascade the date forward at 7-day intervals to every later
      Session/Week of the same type. The cascade is the headline UX —
      a 15-week course can be filled with a single Session 1 date, and
      a break-week course needs only one extra anchor after the break. */
  function onBulkDateChange() {
    const tr  = this.closest('tr');
    if (!tr) return;
    applyBulkDate(tr, this.value, /* shouldCascade */ true);
  }

  /** Push `dateStr` (YYYY-MM-DD) into every per-item row whose data-sw-key
      matches this bulk row's key. Optionally cascade to later Session/Week
      anchors at 7-day intervals (each bulk-input change re-cascades from
      whichever anchor was just edited; earlier anchors are never touched
      so manual edits stick). */
  function applyBulkDate(bulkTr, dateStr, shouldCascade) {
    const key = bulkTr.dataset.bulkKey;
    if (!key) return;

    // Reflect the value in the bulk input itself (in case caller didn't).
    const bulkInput = bulkTr.querySelector('.dd-bulk');
    if (bulkInput && bulkInput.value !== dateStr) bulkInput.value = dateStr;

    const editor = document.getElementById('ddEditor');
    if (editor) {
      editor.querySelectorAll('tr[data-sw-key="' + cssEscape(key) + '"] .dd-due').forEach(input => {
        input.value = dateStr;
        const tr2 = input.closest('tr');
        const idx = parseInt(tr2.dataset.idx, 10);
        const it  = STATE.items[idx];
        const newIso = isoFromDateOnly(dateStr);
        const dirty = (newIso || null) !== (it.dueDate || null);
        tr2.classList.toggle('dd-changed', dirty);
        tr2.classList.remove('dd-row-saved', 'dd-row-fail');
      });
    }
    refreshBulkRowCommonHint(key);

    if (shouldCascade && dateStr) cascadeForward(key, dateStr);

    // Re-evaluate break-week warnings after every change. Cheap walk —
    // there are typically only a handful of bulk rows.
    updateBreakIndicators();

    // If the user is in a role that can't save dropbox dates via the API,
    // refresh the manual-action panel so they can see what they'll need to
    // edit in Brightspace — keeps the panel in sync with the cascade.
    maybeRenderRestrictedPanel();
  }

  /** Cascade dates forward from a Session/Week anchor.
      For every later anchor of the same type (Session-N where N > anchor's
      number), set its date to anchor + (N - anchorNum) * 7 days. Each
      cascaded anchor is applied via applyBulkDate(_, _, false) so
      per-item rows update too — but with shouldCascade=false to avoid
      re-cascading from each step. */
  function cascadeForward(anchorKey, baseDateStr) {
    const m = anchorKey.match(/^wk-(\d+)$/);
    if (!m) return;
    const anchorNum = parseInt(m[1], 10);
    const baseDate  = parseLocalDate(baseDateStr);
    if (!baseDate) return;

    // Collect later bulk rows in num order. Sessions and Weeks share
    // one canonical key now, so the cascade walks one unified list.
    const laterRows = [];
    document.querySelectorAll('#ddBulk tr[data-bulk-key]').forEach(tr => {
      const k  = tr.dataset.bulkKey;
      const mm = k.match(/^wk-(\d+)$/);
      if (!mm) return;
      const n = parseInt(mm[1], 10);
      if (n > anchorNum) laterRows.push({ tr, num: n });
    });
    laterRows.sort((a, b) => a.num - b.num);

    for (const g of laterRows) {
      // Number-gap × 7 days — NOT array index × 7. So a course with
      // sparse sessions (e.g., 1, 3, 5, 7) cascades correctly: Session 3
      // is 14 days after Session 1, Session 5 is 28 days after, etc.
      const stepsAhead = g.num - anchorNum;
      const target = new Date(baseDate);
      target.setDate(target.getDate() + stepsAhead * 7);
      console.info('[DueDates] cascade week ' + anchorNum + ' → ' + g.num +
        ': ' + stepsAhead + ' × 7 days = ' + (stepsAhead * 7) + ' days → ' +
        formatLocalDate(target));
      applyBulkDate(g.tr, formatLocalDate(target), /* shouldCascade */ false);
    }
  }

  function parseLocalDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function formatLocalDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* Re-evaluate one bulk row's "Current" cell after a per-item edit. */
  function refreshBulkRowCommonHint(key) {
    if (!key) return;
    const bulkRow = document.querySelector('#ddBulk tr[data-bulk-key="' + cssEscape(key) + '"]');
    if (!bulkRow) return;
    const dueInputs = document.querySelectorAll('#ddEditor tr[data-sw-key="' + cssEscape(key) + '"] .dd-due');
    // Discussion-only groups have no editable per-item inputs. Don't
    // overwrite the "Discussions only — read-only" cell with "Mixed";
    // just re-run break-week detection (the bulk input value may have
    // changed and that affects gap math).
    if (dueInputs.length === 0) {
      updateBreakIndicators();
      return;
    }
    const vals = Array.from(dueInputs).map(i => i.value || '');
    const allSame = vals.every(v => v === vals[0]);
    const cell = bulkRow.querySelector('.dd-bulk-current');
    if (!cell) return;
    if (allSame) {
      cell.innerHTML = vals[0]
        ? escapeHTML(fmtDate(isoFromDateOnly(vals[0])))
        : '— none on record —';
      // Reflect the common value in the bulk input so further edits
      // start from the right place.
      const bulkInput = bulkRow.querySelector('.dd-bulk');
      if (bulkInput && bulkInput.value !== vals[0]) bulkInput.value = vals[0];
    } else {
      cell.innerHTML = '<span style="color:var(--ccu-mute);font-style:italic">Mixed</span>';
    }
    // Manual per-item edits can shift the bulk-row date which can
    // create or close a break-week gap. Re-run the indicator sweep.
    updateBreakIndicators();
  }

  /* CSS.escape polyfill — keeps querySelector strings safe for keys. */
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  /** Brightspace requires a CSRF token on PUT. The token is stored in
   *  localStorage as `XSRF.Token` by the Brightspace shell when the user
   *  signs in. Two failure modes have been observed:
   *
   *  1. Token absent. /content/analytics/ is a static-file path that does
   *     not run the Brightspace shell JS, so if the user lands here without
   *     visiting any /d2l/ shell page recently, localStorage is empty.
   *  2. Token cleared mid-session. Brightspace sets `Session.Expired` (and
   *     wipes XSRF.Token) when its idle timer fires — even though the
   *     session cookie remains valid for read calls. PUTs then 403 with
   *     `{ Errors: [ {Message: "Forbidden"} ] }`.
   *
   *  ensureXsrfToken() handles both: it fetches /d2l/home (which does run
   *  the shell init JS), parses the token out of the inline setItem call,
   *  writes it back to localStorage, and clears Session.Expired. The
   *  fetched HTML is the same the shell sends to a real browser — the
   *  token in it is freshly minted server-side per request. */
  let _xsrfRefreshing = null;
  async function ensureXsrfToken() {
    let cached = '';
    try { cached = localStorage.getItem('XSRF.Token') || ''; } catch (e) {}
    if (cached) return cached;
    if (_xsrfRefreshing) return _xsrfRefreshing;
    _xsrfRefreshing = (async () => {
      try {
        const r = await fetch('/d2l/home', { credentials: 'include' });
        if (!r.ok) return '';
        const html = await r.text();
        const m = html.match(/setItem\s*\(\s*["']XSRF\.Token["']\s*,\s*["']([^"']+)["']/);
        if (!m) return '';
        const token = m[1];
        try { localStorage.setItem('XSRF.Token', token); } catch (e) {}
        try { localStorage.removeItem('Session.Expired'); } catch (e) {}
        return token;
      } finally {
        _xsrfRefreshing = null;
      }
    })();
    return _xsrfRefreshing;
  }

  function xsrfHeaders() {
    let token = '';
    try { token = localStorage.getItem('XSRF.Token') || ''; } catch (e) {}
    return {
      'X-CSRF-TOKEN': token,
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
    };
  }

  /** Get the calling user's Role.Name in this course. Used by the
   *  permission-failure panel so the explanatory copy can name the
   *  specific role (e.g. "CAGS Faculty") that the admin has restricted.
   *  Best-effort: returns null on any failure — the panel falls back to
   *  generic "your role" wording in that case. */
  async function fetchMyRoleForCourse(ouId) {
    try {
      const u = (BSP.state && BSP.state.user) || {};
      const userId = u.Identifier || u.UserId;
      if (!userId || !ouId) return null;
      const v = (BSP.api && BSP.api.LP) || '1.45';
      const r = await fetch('/d2l/api/lp/' + v + '/enrollments/orgUnits/' +
                             encodeURIComponent(ouId) + '/users/' +
                             encodeURIComponent(userId), { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j.Role && j.Role.Name) ? j.Role.Name : null;
    } catch (e) { return null; }
  }

  /** Convert a Brightspace readback inner RichText (`{Text: 'plain',
   *  Html: '<p>...</p>'}`) into the RichTextInput shape (`{Content, Type}`)
   *  that PUT endpoints expect. Prefers HTML when present so rich
   *  formatting (lists, bold, embeds) round-trips intact.
   *
   *  CRITICAL: the parameter here is the INNER RichText object — i.e.
   *  what you'd get from `composite.Text` on a quiz readback. An earlier
   *  iteration passed the OUTER composite here and then re-dereferenced
   *  `.Text`, which on a `{Text, Html}` shape yields the plain string,
   *  then tried to read `.Html`/`.Text` on a STRING, falling through to
   *  `{Content: '', Type: 'Text'}` for every field — quietly erasing
   *  quiz prompts, descriptions, headers, and footers on every save. */
  function richTextOut(inner) {
    if (!inner) return { Content: '', Type: 'Text' };
    // Defensive: a string can show up if a future API version drops the
    // wrapper. Detect HTML by the presence of an angle-bracket tag.
    if (typeof inner === 'string') {
      return { Content: inner, Type: /<\w+/.test(inner) ? 'Html' : 'Text' };
    }
    if (typeof inner.Html === 'string' && inner.Html.trim() !== '') {
      return { Content: inner.Html, Type: 'Html' };
    }
    if (typeof inner.Text === 'string' && inner.Text !== '') {
      return { Content: inner.Text, Type: 'Text' };
    }
    // Defensive: already in the input shape — pass it through.
    if (typeof inner.Content === 'string' && inner.Type) {
      return { Content: inner.Content, Type: inner.Type };
    }
    return { Content: '', Type: 'Text' };
  }

  /** Build the Quiz `{Text: <RichTextInput>, IsDisplayed: <bool>}` composite
   *  from the readback `{Text: <innerRichText>, IsDisplayed: <bool>}` shape.
   *  Passes `composite.Text` (the inner RichText) into richTextOut() —
   *  exactly the level it expects. */
  function quizRtField(composite) {
    return {
      Text: richTextOut(composite && composite.Text),
      IsDisplayed: !!(composite && composite.IsDisplayed),
    };
  }

  /** Build the `Quiz.QuizData` body Brightspace's LE 1.74 PUT endpoint
   *  accepts. The shape is finicky — verified against your institution's tenant
   *  May 2026. Notable deltas from the GET-readback shape:
   *
   *  - `QuizId`, `ActivityId` must NOT appear (URL-only / read-only)
   *  - `Description` / `Instructions` / `Header` / `Footer` are composites
   *    `{Text: RichTextInput, IsDisplayed: bool}` — not bare RichTextInput
   *    and not the `{Text:{Text,Html},IsDisplayed}` readback
   *  - `AttemptsAllowed: {IsUnlimited, NumberOfAttemptsAllowed}` is a READ
   *    wrapper. PUT wants a FLAT top-level `NumberOfAttemptsAllowed:
   *    number|null` (null = unlimited)
   *  - `SubmissionGracePeriod` is required-non-null even when zero. your institution's
   *    1.74 rejects null with `"Grace period must be provided"` even
   *    though the docs mark it nullable
   *  - These fields don't exist in 1.74 and must NOT be sent: `Notes`,
   *    `BlockAutoTranscript`, `IsSingleSession` (added 1.92),
   *    `HideQuestionPoints` (added 1.88), `PagingTypeId` (added 1.78)
   *
   *  Sending an unrecognized field returns the unhelpful generic
   *  `JSON Binding Error` — that's how this list was found. */
  function buildQuizUpdateBody(orig, newIso) {
    // AttemptsAllowed (read wrapper) → flat NumberOfAttemptsAllowed
    const flatAttempts = (orig.AttemptsAllowed && orig.AttemptsAllowed.IsUnlimited)
      ? null
      : (orig.AttemptsAllowed ? orig.AttemptsAllowed.NumberOfAttemptsAllowed : null);
    // Brightspace rejects `AutoExportToGrades: true` when GradeItemId is null
    // with "AutoExportToGrades cannot be true if GradeItemId is null." Some
    // existing quizzes are in exactly this inconsistent state (Brightspace
    // tolerates it on read but enforces on write). Force the flag to false
    // when there's nothing to export to — same effective behavior, satisfies
    // the validator.
    const autoExport = !!orig.AutoExportToGrades && orig.GradeItemId != null;
    // Quizzes that have an EndDate (hard submission close — separate from
    // DueDate) hit a different validator: "Due Date cannot be later than
    // End Date." Common on exam quizzes. When the user's cascaded DueDate
    // is past the existing EndDate, push EndDate forward to match so the
    // exam stays open at least until the new due moment. If EndDate is
    // null or already after the new DueDate, leave it alone.
    let endDate = orig.EndDate;
    if (endDate && newIso) {
      const endMs = new Date(endDate).getTime();
      const newMs = new Date(newIso).getTime();
      if (!isNaN(endMs) && !isNaN(newMs) && newMs > endMs) endDate = newIso;
    }
    return {
      Name: orig.Name,
      IsActive: !!orig.IsActive,
      SortOrder: orig.SortOrder,
      AutoExportToGrades: autoExport,
      GradeItemId: orig.GradeItemId,
      IsAutoSetGraded: !!orig.IsAutoSetGraded,
      // These four are required by the quiz PUT (omitting them produced
      // a 400 "JSON Binding Error" in your institution's LE 1.74). richTextOut() was
      // double-dereferencing the readback shape, producing empty Content
      // for every field and silently erasing quiz prompts on save. The
      // helper is now fixed (it expects the inner RichText directly,
      // not the outer composite), so these echoes correctly preserve
      // whatever the readback returned.
      Instructions: quizRtField(orig.Instructions),
      Description: quizRtField(orig.Description),
      Header: quizRtField(orig.Header),
      Footer: quizRtField(orig.Footer),
      StartDate: orig.StartDate,
      EndDate: endDate,
      DueDate: newIso,
      DisplayInCalendar: !!orig.DisplayInCalendar,
      NumberOfAttemptsAllowed: flatAttempts,
      LateSubmissionInfo: orig.LateSubmissionInfo,
      SubmissionTimeLimit: orig.SubmissionTimeLimit,
      // Required-non-null even at zero — see docstring above.
      SubmissionGracePeriod: (typeof orig.SubmissionGracePeriod === 'number') ? orig.SubmissionGracePeriod : 0,
      Password: orig.Password,
      AllowHints: !!orig.AllowHints,
      DisableRightClick: !!orig.DisableRightClick,
      DisablePagerAndAlerts: !!orig.DisablePagerAndAlerts,
      NotificationEmail: orig.NotificationEmail,
      CalcTypeId: orig.CalcTypeId,
      RestrictIPAddressRange: (orig.RestrictIPAddressRange && orig.RestrictIPAddressRange.length)
        ? orig.RestrictIPAddressRange
        : null,
      CategoryId: orig.CategoryId,
      PreventMovingBackwards: !!orig.PreventMovingBackwards,
      Shuffle: !!orig.Shuffle,
      AllowOnlyUsersWithSpecialAccess: !!orig.AllowOnlyUsersWithSpecialAccess,
      IsRetakeIncorrectOnly: !!orig.IsRetakeIncorrectOnly,
      IsSynchronous: !!orig.IsSynchronous,
      DeductionPercentage: orig.DeductionPercentage,
    };
  }

  /** Run a PUT and surface the response body on failure. Brightspace 400s
   *  carry useful error detail in the body that the bare-status error we
   *  used to throw was hiding. On 403 (Forbidden — typically a stale or
   *  missing XSRF token), refresh the token and retry once. */
  async function putJson(url, body) {
    const send = () => fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: xsrfHeaders(),
      body: JSON.stringify(body),
    });
    let r = await send();
    if (r.status === 403) {
      // Wipe and re-fetch the token, then retry exactly once.
      try { localStorage.removeItem('XSRF.Token'); } catch (e) {}
      await ensureXsrfToken();
      r = await send();
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 300); } catch (e) {}
      const err = new Error('HTTP ' + r.status + (detail ? ' — ' + detail : ''));
      err.status = r.status;
      throw err;
    }
    return r;
  }

  /** Build the Dropbox.DropboxFolderUpdateData body for PUT.
   *
   *  Echoing the GET readback directly causes two distinct 400/403s on
   *  some folders:
   *
   *  - **400 "Allowable File Type is supported only with File or
   *    FileOrText SubmissionType"** — the readback carries an
   *    `AllowableFileTypes` value on every folder (even Text/OnPaper
   *    ones), but the documented UpdateData has NO `AllowableFileTypes`
   *    field. PUT rejects it for non-file submission types.
   *  - **403 "Not Authorized"** — the readback also carries
   *    `AllowOnlyUsersWithSpecialAccess`, `IsAnonymous`, `DropboxType`,
   *    `SubmissionType`, `CompletionType`, and `GradeItemId`. Each of
   *    those, if present in the body, triggers a permission check.
   *    Echoing them back asks Brightspace to set them — even to their
   *    current value — and the elevated-permission check fails for
   *    instructors who don't have "Set Special Access", "Edit Grade
   *    Items", etc. Per the docs: *"if null or not present, the
   *    property will not be changed."* — so we drop them entirely for a
   *    date-only update.
   *
   *  Only fields documented in `Dropbox.DropboxFolderUpdateData` get
   *  through here, and only the ones we want to round-trip unchanged. */
  function buildDropboxUpdateBody(orig, newIso) {
    return {
      Name:                 orig.Name,
      CategoryId:           orig.CategoryId != null ? orig.CategoryId : null,
      // CustomInstructions intentionally omitted. The previous code
      // sent `orig.CustomInstructions || { Text: '', Html: '' }` so any
      // folder whose GET response returned null for that field (or
      // whose rich-text payload didn't match the expected shape) got
      // an empty {Text:'',Html:''} written back — which Brightspace
      // interprets as "blank the prompt." Per the documented PUT
      // semantics, omitting the property leaves it unchanged. That's
      // the only safe move for a date-only update: we have no business
      // touching the assignment prompt.
      Availability:         orig.Availability || null,
      GroupTypeId:          orig.GroupTypeId != null ? orig.GroupTypeId : null,
      DueDate:              newIso,
      DisplayInCalendar:    !!orig.DisplayInCalendar,
      NotificationEmail:    orig.NotificationEmail || null,
      // GradeItemId MUST be echoed. Earlier observation said omitting
      // it would leave the link untouched ("if not present, not changed"),
      // but in practice Brightspace's dropbox PUT actually nulls the
      // gradebook association when GradeItemId is missing from the body —
      // disassociating the assignment from its grade column. Echoing
      // the readback value preserves the existing link. For roles that
      // lack EditEvaluationProperties this can theoretically 403, but
      // those roles are already pre-filtered by the userRestricted check
      // earlier in the save loop and never reach this PUT.
      GradeItemId:          orig.GradeItemId != null ? orig.GradeItemId : null,
      // Assessment, IsAnonymous, DropboxType, SubmissionType, CompletionType,
      // AllowOnlyUsersWithSpecialAccess, AllowableFileTypes, IsHidden —
      // all intentionally omitted. Each one triggers a separate permission
      // check when present in the PUT body, even if the value matches the
      // readback:
      //
      //   Assessment / IsAnonymous / DropboxType / SubmissionType /
      //   CompletionType                   → Dropbox.EditEvaluationProperties
      //   AllowOnlyUsersWithSpecialAccess  → Dropbox.SetSpecialAccess
      //   AllowableFileTypes               → not in UpdateData schema at all
      //
      // Omitting Assessment specifically prevents a 403 even for users
      // with EditEvaluationProperties — including it triggers the full
      // assessment-rebind path, which is a separate permission family.
    };
  }

  async function saveItem(item, newIso) {
    const ouId = STATE.courseId;
    const v    = (BSP.api && BSP.api.LE) || '1.74';
    if (item.type === 'assignment') {
      // Dropbox PUT requires the UpdateData shape — see helper above.
      // Echoing the readback verbatim 400s on AllowableFileTypes for
      // text/onPaper submissions and 403s on permission-gated fields.
      //
      // Use LE 1.82 specifically for dropbox PUT (instead of the shared
      // BSP.api.LE 1.74 default). Brightspace docs explicitly mark 1.74
      // as obsolete for the dropbox/folders route as of LMS v20.26.1;
      // bumping to 1.82 picks up the documented current schema and the
      // matching field-level permission gates. Other endpoints (quiz,
      // discussion) stay on the shared default until tested.
      const body = buildDropboxUpdateBody(item.original, newIso);
      await putJson('/d2l/api/le/1.82/' + encodeURIComponent(ouId) +
                    '/dropbox/folders/' + encodeURIComponent(item.id), body);
    } else if (item.type === 'quiz') {
      // Quiz PUT requires the QuizUpdateData shape — see helpers above.
      const body = buildQuizUpdateBody(item.original, newIso);
      await putJson('/d2l/api/le/' + v + '/' + encodeURIComponent(ouId) +
                    '/quizzes/' + encodeURIComponent(item.id), body);
    } else if (item.type === 'discussion') {
      // Discussion topic PUT — endpoint requires both the forum ID (parent)
      // and the topic ID. The GET-shape body works here in your institution's 1.74.
      const body = Object.assign({}, item.original, { DueDate: newIso });
      await putJson('/d2l/api/le/' + v + '/' + encodeURIComponent(ouId) +
                    '/discussions/forums/' + encodeURIComponent(item.forumId) +
                    '/topics/' + encodeURIComponent(item.id), body);
    }
    item.dueDate = newIso;
  }

  async function onSaveAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    const editor = document.getElementById('ddEditor');
    const status = document.getElementById('ddSaveStatus');
    const btn    = document.getElementById('ddSaveBtn');
    btn.disabled = true;
    status.textContent = 'Saving…';

    // Pre-warm the XSRF token. /content/analytics/ is a static-file path
    // that doesn't run the Brightspace shell init — if the user landed
    // here without recently visiting a /d2l/ page (or if their session's
    // idle timer fired), localStorage's XSRF.Token will be empty and
    // every PUT will 403. ensureXsrfToken() fetches /d2l/home and pulls
    // a fresh token out of the page's inline setItem call.
    try { await ensureXsrfToken(); } catch (e) {
      console.warn('[DueDates] xsrf pre-warm failed', e && e.message);
    }

    // If the user is in a known-restricted role, the preemptive panel is
    // already rendered. We keep it as-is during this save run; only remove
    // the panel after we know the dropbox saves were skipped (or in
    // unrestricted mode, that no 403s were collected).
    const userRestricted = isUserRestrictedForDropbox();
    if (!userRestricted) {
      // Only blow away the panel for unrestricted users — restricted users
      // need their pre-emptive panel to remain visible through the save run.
      const oldPanel = document.getElementById('ddPermissionPanel');
      if (oldPanel) oldPanel.remove();
    }

    let ok = 0, fail = 0, skipped = 0;
    // Items the API rejected with HTTP 403 / "Not authorized" — these are
    // permission-gated, not validation errors. We surface them in a
    // dedicated panel at the bottom with the role name, an Edit link, and
    // the date the user intended so they can transcribe it into Brightspace.
    const permissionFailures = [];
    const rows = Array.from(editor.querySelectorAll('tbody tr'));
    for (const tr of rows) {
      // Skip the "Uncategorized items" section divider — no item there.
      if (tr.classList.contains('dd-section-header')) continue;
      // Skip break-week warning rows in the bulk section if any leaked in.
      if (tr.classList.contains('dd-break-row')) continue;
      const idx = parseInt(tr.dataset.idx, 10);
      const it  = STATE.items[idx];
      if (!it) continue;
      const input = tr.querySelector('.dd-due');
      if (!input) continue;
      // Date-only input → 11:59 PM local-time ISO string.
      const newIso = isoFromDateOnly(input.value);
      // Skip rows that haven't changed.
      if ((newIso || null) === (it.dueDate || null)) { skipped++; continue; }
      // Restricted users skip the dropbox PUT entirely — the preemptive
      // panel already lists this item with its target date. Avoids
      // burning API calls + audit-log entries on attempts we know will 403.
      if (userRestricted && it.type === 'assignment') {
        skipped++;
        continue;
      }

      tr.classList.remove('dd-row-saved', 'dd-row-fail');
      try {
        await saveItem(it, newIso);
        tr.classList.add('dd-row-saved');
        tr.classList.remove('dd-changed');
        // Update the "Current" column to reflect the new date
        const curCell = tr.querySelector('.dd-current');
        if (curCell) curCell.textContent = fmtDate(newIso);
        ok++;
      } catch (e) {
        // Stringify the error message explicitly — JSON.stringify(Error)
        // returns {} (message isn't an enumerable own prop), which
        // hides the response body the debug log otherwise can't see.
        const errMsg = (e && e.message) ? e.message : String(e);
        console.warn('[DueDates] save failed', it.type, it.id, it.name, '→', errMsg);
        tr.classList.add('dd-row-fail');
        // Permission-class failures (403 / Not authorized) get routed to the
        // bottom panel instead of a generic per-row error so the user has
        // one consolidated set of action items + Brightspace links.
        const isPermissionDenied = e && (e.status === 403) &&
          /not\s*authorized|forbidden/i.test(errMsg);
        if (isPermissionDenied) {
          permissionFailures.push({
            type: it.type,
            id: it.id,
            name: it.name,
            forumId: it.forumId || null,
            dueIso: newIso,
          });
        } else {
          // Non-permission failure — show the actual error inline.
          const failNote = tr.querySelector('.dd-fail-note') || (() => {
            const sp = document.createElement('div');
            sp.className = 'dd-fail-note';
            sp.style.cssText = 'font-size:.74rem;color:#B71C1C;margin-top:4px;font-style:italic;max-width:520px;word-break:break-word';
            (tr.querySelector('.dd-name') || tr.firstElementChild).appendChild(sp);
            return sp;
          })();
          failNote.textContent = errMsg;
        }
        fail++;
      }
    }

    // Surface the permission-blocked items in a consolidated panel.
    if (permissionFailures.length > 0) {
      renderPermissionPanel(permissionFailures);
    }

    btn.disabled = false;
    STATE.busy = false;
    const parts = [];
    if (ok) parts.push(ok + ' saved');
    if (fail) parts.push(fail + ' failed');
    if (skipped) parts.push(skipped + ' unchanged');
    status.textContent = parts.length ? 'Done — ' + parts.join(', ') + '.' : 'No changes to save.';
  }

  /** Build the "manual action required" panel from the current cascade
   *  state for users whose role can't save dropbox dates via the API.
   *  Runs whenever (a) the role finishes loading, or (b) a cascade fires
   *  in the bulk Session/Week section. Reads each dropbox row's currently-
   *  displayed date so the panel stays in sync with what the user sees. */
  function maybeRenderRestrictedPanel() {
    if (!isUserRestrictedForDropbox()) return;
    const editor = document.getElementById('ddEditor');
    if (!editor) return;

    // Gather every dropbox row that currently has a date set (either saved
    // or computed by the cascade). Discussions are read-only here already;
    // quizzes save via Valence fine — so we only list assignments.
    const items = [];
    const rows = Array.from(editor.querySelectorAll('tbody tr[data-idx]'));
    for (const tr of rows) {
      if (tr.classList.contains('dd-section-header')) continue;
      const idx = parseInt(tr.dataset.idx, 10);
      const it = STATE.items[idx];
      if (!it || it.type !== 'assignment') continue;
      const input = tr.querySelector('.dd-due');
      const dateStr = input && input.value;
      if (!dateStr) continue;
      const dueIso = isoFromDateOnly(dateStr);
      if (!dueIso) continue;
      items.push({
        type: it.type, id: it.id, name: it.name,
        forumId: it.forumId || null,
        dueIso,
      });
    }

    if (items.length === 0) {
      // No dropbox items have dates yet — drop any stale panel.
      const stale = document.getElementById('ddPermissionPanel');
      if (stale) stale.remove();
      return;
    }
    renderPermissionPanel(items, /* scrollIntoView */ false);
  }

  /** Render the "manual action required" panel beneath the save bar.
   *  Listed items are dropboxes the wizard can't save because the user's
   *  role lacks Brightspace's Manage Assignment Submission Folders
   *  permission. We name the role, give a single link to the course's
   *  Assignments page (where the user can open each folder and set the
   *  date themselves), and show the cascaded dates in a compact table.
   *
   *  Called from two places:
   *    1. maybeRenderRestrictedPanel() — proactive, on cascade or role-load
   *    2. onSaveAll catch block — reactive, when actual saves 403
   *  `scrollIntoView` defaults to true; the proactive call passes false so
   *  the page doesn't jerk every time the user adjusts a cascade anchor. */
  function renderPermissionPanel(failures, scrollIntoView) {
    const card = document.getElementById('ddEditorCard');
    if (!card) return;
    const old = document.getElementById('ddPermissionPanel');
    if (old) old.remove();

    const ouId = STATE.courseId;
    const roleName = STATE.myRoleName || 'current';
    // Course Assignments admin page — same place the native UI lives, so
    // the user can open each folder from there and set the date through
    // Brightspace's own date picker. One trustworthy link beats per-row
    // deep links into pages that vary by Brightspace version.
    const assignmentsUrl = '/d2l/lms/dropbox/admin/folders_manage.d2l?ou=' + encodeURIComponent(ouId);

    const rowsHtml = failures.map(f => (
      '<tr>' +
        '<td style="padding:6px 10px;border-bottom:1px solid #E5E9EE;color:var(--ccu-db,#002554);font-weight:600">' +
          escapeHTML(f.name) +
        '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid #E5E9EE;color:var(--ccu-db,#002554);font-variant-numeric:tabular-nums;white-space:nowrap">' +
          escapeHTML(fmtDateForTranscribe(f.dueIso)) +
        '</td>' +
      '</tr>'
    )).join('');

    const panel = document.createElement('div');
    panel.id = 'ddPermissionPanel';
    panel.className = 'card';
    panel.style.cssText = 'margin-top:14px;border-top:4px solid var(--ccu-gold,#FED925);' +
                          'padding:16px 18px;background:#FFFBEB';
    panel.innerHTML =
      '<h2 style="font-family:\'Oswald\',sans-serif;color:var(--ccu-db,#002554);margin:0 0 10px;font-size:1.05rem;letter-spacing:.4px">' +
        'Manually set ' + failures.length + ' assignment due date' + (failures.length === 1 ? '' : 's') +
      '</h2>' +
      '<p style="font-size:.92rem;line-height:1.55;margin:0 0 14px;color:#3A3D40">' +
        'Your <strong>' + escapeHTML(roleName) + '</strong> role does not allow you to update assignment ' +
        'dates this way. Please ' +
        '<a href="' + assignmentsUrl + '" target="_blank" rel="noopener" ' +
          'style="color:var(--ccu-db,#002554);font-weight:700;text-decoration:underline">' +
          'click this link' +
        '</a> ' +
        'to manually set the remaining dates for your course. The table below shows the dates ' +
        'the wizard has already calculated to help you. ' +
        'If you haven\'t yet used the <strong>Add Discussion Reminders to Calendar</strong> ' +
        'button above, do so now. ' +
        'Your quizzes have been updated, and you can put reminders on the calendar with one click. ' +
        'We hope this tool still saved you time.' +
      '</p>' +
      '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:.88rem;background:#fff;border-radius:4px;overflow:hidden">' +
          '<thead>' +
            '<tr style="background:#FCFFFD">' +
              '<th style="padding:8px 10px;text-align:left;font-weight:600;border-bottom:2px solid var(--ccu-db,#002554);color:var(--ccu-db,#002554);text-transform:uppercase;font-size:.74rem;letter-spacing:.4px">Assignment</th>' +
              '<th style="padding:8px 10px;text-align:left;font-weight:600;border-bottom:2px solid var(--ccu-db,#002554);color:var(--ccu-db,#002554);text-transform:uppercase;font-size:.74rem;letter-spacing:.4px;white-space:nowrap">Due date</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';

    card.appendChild(panel);
    if (scrollIntoView !== false) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Discussion calendar reminders                              */
  /* ─────────────────────────────────────────────────────────── */
  /*
   *  Brightspace doesn't expose a Due Date field on the discussion topic
   *  resource that students actually see on their course calendar. To
   *  give students explicit visibility into when discussion posts and
   *  responses are due, we bulk-create plain calendar events for every
   *  discussion row in the wizard:
   *
   *    "<discussion name> Initial Posts Due"     ← 4 days before
   *    "<discussion name> Responses Due"         ← at the wizard date
   *
   *  Source of the date for each discussion:
   *    - Whatever's currently in the row's date input (cascade preview
   *      or manual edit). This is what the user sees in the wizard and
   *      what they expect the calendar to mirror.
   *
   *  Dedup: we fetch the course's existing calendar events first and
   *  skip any reminder whose Title is already present. Safe to re-run.
   *
   *  Endpoint version: calendar routes need LP/LE 1.82+ — the LE 1.74
   *  used elsewhere in this module is obsolete for calendar. See
   *  https://docs.valence.desire2learn.com/res/calendar.html.
   */
  const DD_CAL_LE_VERSION  = '1.82';
  const DD_INITIAL_OFFSET_DAYS = 4;

  /** Subtract N days while preserving the time-of-day (handles DST since
   *  Brightspace stores UTC and we're subtracting whole-day worth of ms). */
  function shiftDaysIso(iso, days) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return new Date(t - days * 86400000).toISOString();
  }

  function pretty(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Pull this course's existing calendar events so we can dedupe by Title.
   *  Brightspace's LE calendar/events route returns a JSON array of
   *  EventDataInfo objects (no title filter — we filter client-side). */
  async function fetchCalendarEventTitles(ouId) {
    const url = '/d2l/api/le/' + DD_CAL_LE_VERSION + '/' +
                encodeURIComponent(ouId) + '/calendar/events/';
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) {
      throw new Error('GET calendar/events HTTP ' + r.status);
    }
    let arr = [];
    try { arr = await r.json(); } catch (e) { /* leave empty */ }
    if (!Array.isArray(arr)) arr = (arr && arr.Objects) || [];
    return new Set(arr.map(e => (e && e.Title ? String(e.Title).trim() : '')).filter(Boolean));
  }

  /** POST a single calendar event. Body is Calendar.EventData — top-level
   *  Title / StartDateTime / EndDateTime, plus null placeholders for the
   *  fields Brightspace expects to be present but unused. Sharing the
   *  putJson 403-retry pattern would be nice but POST/JSON-error shapes
   *  differ, so we inline the retry here. */
  async function postCalendarEvent(ouId, title, isoMoment) {
    const body = {
      Title: title,
      Description: '',
      StartDateTime: isoMoment,
      EndDateTime: isoMoment,
      StartDay: null,
      EndDay: null,
      GroupId: null,
      RecurrenceInfo: null,
      LocationId: null,
      LocationName: '',
      AssociatedEntity: null,
      VisibilityRestrictions: {
        Type: 1, /* 1 = Visible (default — show to all enrolled users) */
        Range: null, HiddenRangeUnitType: null,
        StartDate: null, EndDate: null,
      },
    };
    const url = '/d2l/api/le/' + DD_CAL_LE_VERSION + '/' +
                encodeURIComponent(ouId) + '/calendar/event/';
    const send = () => fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: xsrfHeaders(),
      body: JSON.stringify(body),
    });
    let r = await send();
    if (r.status === 403) {
      try { localStorage.removeItem('XSRF.Token'); } catch (e) {}
      await ensureXsrfToken();
      r = await send();
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 300); } catch (e) {}
      throw new Error('HTTP ' + r.status + (detail ? ' — ' + detail : ''));
    }
    return r;
  }

  /** Collect (responsesIso, name) pairs from the wizard's discussion rows.
   *
   *  Discussion rows are intentionally rendered read-only (no `dd-due`
   *  input) because the wizard doesn't push dates back to Brightspace's
   *  discussion-topic API yet. But the bulk Session/Week section DOES
   *  cascade calculated dates into a `.dd-bulk` input per week, and each
   *  discussion row carries a `data-sw-key` pointing to its bulk row.
   *  So the date we want is: look up the discussion's swKey, read the
   *  bulk row's input value.
   *
   *  Resolution order per discussion:
   *    1. The bulk-row `.dd-bulk` input for this week  (cascade preview)
   *    2. The item's existing `dueDate`                (saved value, rare)
   *  If neither is set we skip the discussion. */
  function collectDiscussionDates() {
    const editor = document.getElementById('ddEditor');
    if (!editor) return [];
    const out = [];
    const rows = Array.from(editor.querySelectorAll('tbody tr'));
    for (const tr of rows) {
      if (tr.classList.contains('dd-section-header')) continue;
      if (tr.classList.contains('dd-break-row')) continue;
      const idx = parseInt(tr.dataset.idx, 10);
      const it = STATE.items[idx];
      if (!it || it.type !== 'discussion') continue;

      // Source 1: editable per-row dd-due input (assignments/quizzes use
      // this; discussions don't but the lookup is kept for the day they
      // become editable here).
      let dateStr = '';
      const directInput = tr.querySelector('.dd-due');
      if (directInput && directInput.value) dateStr = directInput.value;

      // Source 2: cascade value from the matching bulk row.
      if (!dateStr) {
        const swKey = tr.dataset.swKey;
        if (swKey) {
          const bulkInput = document.querySelector(
            '#ddBulk tr[data-bulk-key="' + cssEscape(swKey) + '"] .dd-bulk'
          );
          if (bulkInput && bulkInput.value) dateStr = bulkInput.value;
        }
      }

      // Source 3: existing saved dueDate as last resort.
      if (!dateStr && it.dueDate) dateStr = dateOnlyFromIso(it.dueDate);

      if (!dateStr) continue;
      const responsesIso = isoFromDateOnly(dateStr);
      if (!responsesIso) continue;
      out.push({ name: it.name || '(untitled discussion)', responsesIso });
    }
    return out;
  }

  async function onCreateCalendarReminders() {
    if (STATE.busy) return;
    if (!STATE.courseId) return;
    const btn = document.getElementById('ddCalendarBtn');
    const status = document.getElementById('ddSaveStatus');
    STATE.busy = true;
    btn.disabled = true;
    status.textContent = 'Building reminders…';

    try {
      // Pre-warm the XSRF token (same flow as Save All — see ensureXsrfToken
      // docstring for why /content/analytics/ starts with empty token).
      try { await ensureXsrfToken(); } catch (e) { /* let POST fail visibly */ }

      const discussions = collectDiscussionDates();
      if (discussions.length === 0) {
        status.textContent = 'No discussions with due dates found — set discussion dates first.';
        return;
      }

      // Build the (title, when) reminder list. Two per discussion.
      const reminders = [];
      for (const d of discussions) {
        const initialIso = shiftDaysIso(d.responsesIso, DD_INITIAL_OFFSET_DAYS);
        if (initialIso) {
          reminders.push({ title: d.name + ' Initial Posts Due', whenIso: initialIso });
        }
        reminders.push({ title: d.name + ' Responses Due', whenIso: d.responsesIso });
      }

      // Skip any whose title already exists in the course calendar.
      let existingTitles = new Set();
      try {
        existingTitles = await fetchCalendarEventTitles(STATE.courseId);
      } catch (e) {
        console.warn('[DueDates] could not load existing calendar events; proceeding without dedup', e.message);
      }
      const toCreate = reminders.filter(r => !existingTitles.has(r.title.trim()));
      const skipped  = reminders.length - toCreate.length;

      if (toCreate.length === 0) {
        status.textContent = 'All reminders already exist (' + reminders.length + ' checked).';
        return;
      }

      const sampleTitles = toCreate.slice(0, 3).map(r => '• ' + r.title + '  —  ' + pretty(r.whenIso)).join('\n');
      const extra = toCreate.length > 3 ? '\n…and ' + (toCreate.length - 3) + ' more' : '';
      const skipNote = skipped ? '\n\n(' + skipped + ' will be skipped — already on the calendar.)' : '';
      const ok = window.confirm(
        'Create ' + toCreate.length + ' calendar reminder(s) for this course?\n\n' +
        sampleTitles + extra + skipNote
      );
      if (!ok) {
        status.textContent = 'Cancelled.';
        return;
      }

      // POST sequentially — Brightspace tolerates parallel posts but
      // serialized is safer and the volumes are small (≤2 × discussions).
      let created = 0, failed = 0;
      for (const r of toCreate) {
        try {
          await postCalendarEvent(STATE.courseId, r.title, r.whenIso);
          created++;
        } catch (e) {
          failed++;
          console.warn('[DueDates] calendar event failed', r.title, '→', e && e.message);
        }
      }

      const parts = [];
      if (created) parts.push(created + ' created');
      if (failed)  parts.push(failed + ' failed');
      if (skipped) parts.push(skipped + ' already existed');
      status.textContent = 'Calendar reminders — ' + parts.join(', ') + '.';
    } finally {
      btn.disabled = false;
      STATE.busy = false;
    }
  }

  // Wire the button — runs once at module init via the existing init() hook.
  // Re-finding the button on every call lets re-rendering the editor card
  // not break the listener (button itself is in the static HTML).
  function wireCalendarButton() {
    const b = document.getElementById('ddCalendarBtn');
    if (b && !b._bspWired) {
      b._bspWired = true;
      b.addEventListener('click', onCreateCalendarReminders);
    }
  }
  // Attach on module load — init() runs after DOMContentLoaded so the
  // button element exists by the time this fires.
  setTimeout(wireCalendarButton, 0);

  BSP.modules['due-dates'] = { init };
})();

(function () {
  'use strict';
  function boot() {
    if (window.BSP && BSP.modules && BSP.modules['due-dates']) {
      BSP.modules['due-dates'].init();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
