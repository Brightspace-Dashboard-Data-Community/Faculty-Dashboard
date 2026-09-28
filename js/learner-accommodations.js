/* ============================================================
   Instructor Dashboards · Learner Accommodations (per-course matrix)
   Your Institution · CAGS / Instructional Technology

   Flow:
     1. Mount BSP.pinnedCourses → onCoursePicked
     2. On course pick: fetch classlist, render one row per student
     3. In parallel: fetch each student's current accommodation,
        populate the "Current" cell + pre-fill any existing values
     4. Instructor edits Time Multiplier and/or Extra Minutes per row
     5. "Update All" diffs every row, PUTs only the changed ones,
        shows per-row status

   Brightspace API:
     GET  /d2l/api/le/1.74/{ouId}/classlist/                       (Valence)
     GET  /d2l/api/le/1.75/accommodations/{ouId}/users/{userId}    (Valence — reads OK)
     POST /d2l/le/accommodations/{ouId}/assign/{userId}            (LMS form — writes)

   Writes do NOT use the Valence endpoint. The documented
   PUT /d2l/api/le/{ver}/accommodations/ returns 200 OK to session-cookie
   callers but silently drops the change. Brightspace's own classlist UI
   POSTs an application/x-www-form-urlencoded body to the LMS form route
   above with timeLimitAccommodation$* fields and a d2l_referrer CSRF
   token. verifyPersisted() re-GETs the Valence read endpoint after every
   write and throws 'silent_fail' if the value didn't land — caught now
   by probeWritePermission() at load time before the user attempts a save.

   CSRF: localStorage.XSRF.Token doubles as the d2l_referrer form value
   (Brightspace reuses one session-scoped token). Falls back to scraping
   the assign page if the localStorage token is empty. Same XSRF helper
   as due-dates.js.
   ============================================================ */
(function () {
  'use strict';

  const BSP = window.BSP = window.BSP || {};
  BSP.modules = BSP.modules || {};

  const LE_LIST = '1.74'; // classlist
  const LE_ACC  = '1.75'; // accommodations
  const FETCH_CONCURRENCY = 6;

  // ── State ────────────────────────────────────────────────
  // rows: array of {
  //   userId, displayName, current: { op, value } | null,
  //   trEl, multInput, extraInput, statusCell
  // }
  // writePermission: 'unknown' | 'has_permission' | 'no_permission'
  //   Set by the preflight probe after accommodations load.
  let activeCourse    = null;
  let rows            = [];
  let saving          = false;
  let writePermission = 'unknown';

  // ── DOM helpers ──────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function studentDisplayName(s) {
    if (!s) return '—';
    const last  = s.LastName  || s.SortLast  || '';
    const first = s.FirstName || s.SortFirst || '';
    if (last && first) return last + ', ' + first;
    return s.DisplayName || last || first || ('User ' + (s.UserId || s.Identifier || ''));
  }

  // ── XSRF ────────────────────────────────────────────────
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
      } finally { _xsrfRefreshing = null; }
    })();
    return _xsrfRefreshing;
  }

  // ── API ─────────────────────────────────────────────────
  async function fetchClasslist(ouId) {
    const url = '/d2l/api/le/' + LE_LIST + '/' + encodeURIComponent(ouId) + '/classlist/';
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('Could not load classlist (' + r.status + ')');
    const data = await r.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Items)) return data.Items;
    return [];
  }

  async function fetchAccommodation(ouId, userId) {
    const url = '/d2l/api/le/' + LE_ACC + '/accommodations/' +
                encodeURIComponent(ouId) + '/users/' + encodeURIComponent(userId);
    const r = await fetch(url, { credentials: 'include' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('accom GET ' + r.status);
    try { return await r.json(); }
    catch (e) { return null; }
  }

  /** Build the URL for Brightspace's internal accommodations form
   *  (NOT the Valence API). Network capture against Brightspace's own
   *  classlist UI showed this is the real endpoint that persists
   *  saves; the public /d2l/api/le/{ver}/accommodations/ surface
   *  returns 200 on writes but silently drops them. */
  function assignUrl(ouId, userId) {
    return '/d2l/le/accommodations/' + encodeURIComponent(ouId) +
           '/assign/' + encodeURIComponent(userId);
  }

  /** Token Brightspace requires in the d2l_referrer field of every
   *  POST to the accommodations assign endpoint. Network capture
   *  showed it's a 32-char alphanumeric string scoped per session.
   *
   *  Brightspace typically reuses the same CSRF token across header
   *  (X-Csrf-Token) and form (d2l_referrer) contexts, so we try
   *  localStorage.XSRF.Token first — that's already populated and
   *  saves the page fetch. Fall back to scraping the assign page
   *  if the localStorage token isn't available or doesn't work
   *  (probeWritePermission will catch a 403 and we can revisit). */
  const _referrerCache = {};
  async function fetchReferrerToken(ouId, userId) {
    const key = ouId + ':' + userId;
    if (_referrerCache[key]) return _referrerCache[key];

    // Strategy 1 — reuse the session XSRF token. Already present in
    // localStorage after any /d2l/home load; ensureXsrfToken()
    // refreshes it when stale.
    let token = '';
    try { token = await ensureXsrfToken(); } catch (e) { /* fall through */ }
    if (token && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      _referrerCache[key] = token;
      return token;
    }

    // Strategy 2 — scrape the assign page. Brightspace embeds the
    // token somewhere in the response HTML; the original regex
    // patterns didn't catch where, so we now also look for any
    // 32-char alphanumeric run (the observed token length).
    const r = await fetch(assignUrl(ouId, userId), {
      credentials: 'include', headers: { 'Accept': 'text/html' },
    });
    if (!r.ok) throw new Error('Could not load accommodation page (HTTP ' + r.status + ')');
    const html = await r.text();
    const patterns = [
      /<input[^>]*\bname=["']d2l_referrer["'][^>]*\bvalue=["']([^"']+)["']/i,
      /<input[^>]*\bvalue=["']([^"']+)["'][^>]*\bname=["']d2l_referrer["']/i,
      /["']d2l_referrer["']\s*:\s*["']([^"']+)["']/,
      /\bd2l_referrer\s*=\s*["']([^"']+)["']/,
      /\bdata-d2l-referrer\s*=\s*["']([^"']+)["']/i,
      // Last-resort heuristic: find any 32-char alphanumeric run that
      // isn't part of a hyphenated identifier (feature flag names
      // contain hyphens; CSRF tokens don't).
      /(?<![A-Za-z0-9-])([A-Za-z0-9]{32})(?![A-Za-z0-9-])/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) { token = m[1]; break; }
    }
    if (!token) {
      console.warn('[Accommodations] no d2l_referrer found via any pattern. URL:', assignUrl(ouId, userId));
      console.warn('[Accommodations] response length:', html.length, 'first 500 chars:', html.slice(0, 500));
      const candidates = html.match(/\b[A-Za-z0-9_-]{30,40}\b/g);
      if (candidates) console.warn('[Accommodations] 30-40 char token-like strings:', candidates.slice(0, 10));
      throw new Error('Could not find d2l_referrer token in accommodation page HTML — see warnings above');
    }
    _referrerCache[key] = token;
    return token;
  }

  // Increment per request so Brightspace doesn't dedupe rapid retries.
  let _reqIdCounter = 1;
  function nextReqId() { return String(_reqIdCounter++); }

  /** Save an accommodation. Mimics what Brightspace's classlist UI
   *  POSTs when an instructor sets a time-limit accommodation:
   *  application/x-www-form-urlencoded body with the documented
   *  `timeLimitAccommodation$...` field shape, plus a d2l_referrer
   *  CSRF token scraped from the assign page's HTML.
   *
   *  After the write, verifyPersisted() re-GETs the Valence read
   *  endpoint (which still works) to confirm the value landed.
   *  Earlier code tried the Valence write endpoint and saw silent
   *  200-no-ops; the LMS endpoint actually persists. */
  async function saveAccommodation(ouId, userId, op, value) {
    const referrer = await fetchReferrerToken(ouId, userId);
    const params = new URLSearchParams();
    params.set('timeLimitAccommodation$AccommodationEnabled', '1');
    params.set('timeLimitAccommodation$TimeLimitOperation', op === 'mult' ? '1' : '2');
    params.set('timeLimitAccommodation$TimeLimitMultiplyBy$Val', op === 'mult' ? String(Number(value)) : '1');
    params.set('timeLimitAccommodation$TimeLimitAdd$Val',        op === 'extra' ? String(Number(value)) : '0');
    params.set('isXhr', 'true');
    params.set('requestId', nextReqId());
    params.set('d2l_referrer', referrer);

    await writeAccommodation(ouId, userId, params, 'save');
    await verifyPersisted(ouId, userId, { op, value: Number(value) }, 'save');
    return true;
  }

  /** Clear an accommodation. Mirrors the save shape but with
   *  AccommodationEnabled=0 — Brightspace's UI disables the time-limit
   *  block rather than deleting the underlying record. The Valence
   *  GET endpoint will report QuizzingAccommodations: null afterward,
   *  which is what verifyPersisted() expects in the 'clear' label. */
  async function clearAccommodation(ouId, userId) {
    const referrer = await fetchReferrerToken(ouId, userId);
    const params = new URLSearchParams();
    params.set('timeLimitAccommodation$AccommodationEnabled', '0');
    params.set('timeLimitAccommodation$TimeLimitOperation', '1');
    params.set('timeLimitAccommodation$TimeLimitMultiplyBy$Val', '1');
    params.set('timeLimitAccommodation$TimeLimitAdd$Val', '0');
    params.set('isXhr', 'true');
    params.set('requestId', nextReqId());
    params.set('d2l_referrer', referrer);

    await writeAccommodation(ouId, userId, params, 'clear');
    await verifyPersisted(ouId, userId, null, 'clear');
    return true;
  }

  /** Re-fetch after a write and confirm the server-side state matches
   *  what we intended. Throws a synthetic 'silent_fail' error when
   *  Brightspace accepted the request but didn't persist anything —
   *  almost always a missing 'Manage Accommodations' permission on
   *  the caller's role. */
  async function verifyPersisted(ouId, userId, expected, label) {
    let fresh = null;
    try { fresh = await fetchAccommodation(ouId, userId); } catch (e) {
      // If verification fetch itself fails, don't block — trust the
      // write succeeded. (Rare case; usually a transient network blip.)
      return;
    }
    const got = parseCurrent(fresh);
    const ok =
      expected == null
        ? got == null
        : (got && got.op === expected.op && Number(got.value) === Number(expected.value));
    if (ok) return;
    const err = new Error(
      label === 'clear'
        ? 'Brightspace accepted the request but the accommodation is still present. Your role likely lacks the Manage Accommodations permission in this course.'
        : 'Brightspace accepted the request but the value was not saved. Your role likely lacks the Manage Accommodations permission in this course.'
    );
    err.status = 'silent_fail';
    throw err;
  }

  /** Preflight probe: send one no-op POST mirroring a student's
   *  current state to the LMS accommodations endpoint, read the
   *  response code. 403 → role lacks "Manage Accommodations" (the
   *  permission gate fires before the form is processed). Anything
   *  else (2xx / 4xx other than 403) means writes are allowed.
   *
   *  The body echoes whatever the student currently has, so even if
   *  this PROBE persists the request it's a true no-op.
   *
   *  Returns 'no_permission' | 'has_permission' | 'unknown'. */
  async function probeWritePermission(ouId, sampleUserId, sampleCurrent) {
    let referrer = '';
    try { referrer = await fetchReferrerToken(ouId, sampleUserId); }
    catch (e) { return 'unknown'; }
    if (!referrer) return 'unknown';

    const params = new URLSearchParams();
    if (sampleCurrent) {
      params.set('timeLimitAccommodation$AccommodationEnabled', '1');
      params.set('timeLimitAccommodation$TimeLimitOperation', sampleCurrent.op === 'mult' ? '1' : '2');
      params.set('timeLimitAccommodation$TimeLimitMultiplyBy$Val',
                 sampleCurrent.op === 'mult' ? String(Number(sampleCurrent.value)) : '1');
      params.set('timeLimitAccommodation$TimeLimitAdd$Val',
                 sampleCurrent.op === 'extra' ? String(Number(sampleCurrent.value)) : '0');
    } else {
      params.set('timeLimitAccommodation$AccommodationEnabled', '0');
      params.set('timeLimitAccommodation$TimeLimitOperation', '1');
      params.set('timeLimitAccommodation$TimeLimitMultiplyBy$Val', '1');
      params.set('timeLimitAccommodation$TimeLimitAdd$Val', '0');
    }
    params.set('isXhr', 'true');
    params.set('requestId', nextReqId());
    params.set('d2l_referrer', referrer);

    try {
      const r = await fetch(assignUrl(ouId, sampleUserId), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*' },
        body: params.toString(),
      });
      if (r.status === 403) return 'no_permission';
      return 'has_permission';
    } catch (e) {
      return 'unknown';
    }
  }

  /** Show / hide the permission banner and disable write controls
   *  when the probe reports no permission. Idempotent. */
  function applyPermissionUI() {
    const banner = $('accomPermBanner');
    if (banner) banner.style.display = (writePermission === 'no_permission') ? '' : 'none';
    // Update All
    const btn = $('accomUpdateAll');
    if (btn && writePermission === 'no_permission') {
      btn.disabled = true;
      btn.title = 'Your role lacks the Manage Accommodations permission in this course.';
    }
    // Per-row Clear buttons
    rows.forEach(syncClearButtonState);
  }

  /** Shared transport for the LMS accommodations endpoint. Single
   *  POST with the prepared URLSearchParams body — no method cascade.
   *  Brightspace returns 200 + a small JSON status blob on success;
   *  errors surface as 4xx/5xx with HTML or JSON detail. */
  async function writeAccommodation(ouId, userId, params, label) {
    const r = await fetch(assignUrl(ouId, userId), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*' },
      body: params.toString(),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch (e) {}
      const err = new Error(label + ' failed (' + r.status + ' ' + r.statusText + ')' +
        (detail ? ' — ' + detail.slice(0, 200) : ''));
      err.status = r.status;
      throw err;
    }
    return true;
  }


  // ── Helpers — parse the GET response into our internal shape ──
  // Brightspace responses we've observed (or suspect) for the
  // accommodations endpoint vary by API version. Cover several shapes
  // defensively so the Current column populates regardless of which
  // wrapper key Brightspace uses.
  function parseCurrent(accom) {
    if (!accom) return null;
    // Wrapper: QuizzingAccommodations is the documented shape, but
    // we've also seen older builds use Quizzing or no wrapper at all.
    const qa = accom.QuizzingAccommodations || accom.Quizzing || accom;
    if (!qa) return null;
    // Inner record: documented as TimeLimit; legacy engine used
    // QuizzingTimeLimitAccommodation; some responses nest one more
    // level under Quizzing.
    const t =
      qa.TimeLimit ||
      qa.QuizzingTimeLimitAccommodation ||
      qa.TimeLimitAccommodation ||
      (qa.Quizzing && qa.Quizzing.TimeLimit) ||
      null;
    if (!t) return null;

    // Field names — TimeLimitOperation is documented. Multiplier /
    // AdditionalTime are documented names; some legacy shapes use
    // "Multiplier" (no "Time" prefix) or "ExtraTime".
    const op    = t.TimeLimitOperation;
    const mult  = t.TimeMultiplier  != null ? t.TimeMultiplier  : t.Multiplier;
    const extra = t.AdditionalTime  != null ? t.AdditionalTime  : t.ExtraTime;

    // If the API gives us values without an explicit operation flag,
    // infer from which field is populated.
    if (op == null) {
      if (mult  != null) return { op: 'mult',  value: Number(mult)  };
      if (extra != null) return { op: 'extra', value: Number(extra) };
      return null;
    }
    if (op === 1 || op === '1') return { op: 'mult',  value: mult  != null ? Number(mult)  : null };
    if (op === 2 || op === '2') return { op: 'extra', value: extra != null ? Number(extra) : null };
    return null;
  }

  function fmtCurrent(cur) {
    if (!cur || cur.value == null) return 'None';
    return cur.op === 'mult'
      ? cur.value + '× multiplier'
      : cur.value + ' min extra';
  }

  // ── Concurrency helper ─────────────────────────────────
  async function pMap(items, mapper, concurrency) {
    const results = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(concurrency || 6, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { results[idx] = await mapper(items[idx], idx); }
        catch (e) { results[idx] = { __err: e, item: items[idx] }; }
      }
    });
    await Promise.all(workers);
    return results;
  }

  // ── Row rendering ───────────────────────────────────────
  function buildRow(student) {
    const userId = String(student.UserId || student.Identifier || '');
    const tr = document.createElement('tr');
    tr.style.borderTop = '1px solid var(--ccu-bd)';
    tr.dataset.userId = userId;

    const nameCell = document.createElement('td');
    nameCell.style.cssText = 'padding:10px;color:var(--ccu-dg);vertical-align:middle';
    nameCell.textContent = studentDisplayName(student);

    const currentCell = document.createElement('td');
    currentCell.style.cssText = 'padding:10px;color:var(--ccu-mute);vertical-align:middle;font-size:.86rem';
    currentCell.textContent = 'Loading…';

    const multCell = document.createElement('td');
    multCell.style.cssText = 'padding:10px;vertical-align:middle';
    const multInput = document.createElement('input');
    multInput.type = 'number'; multInput.step = '0.25'; multInput.min = '1'; multInput.max = '5';
    multInput.placeholder = '—';
    multInput.className = 'accom-num-input';
    multCell.appendChild(multInput);
    const multSuffix = document.createElement('span');
    multSuffix.textContent = ' ×';
    multSuffix.style.cssText = 'margin-left:6px;color:var(--ccu-mute);font-size:.82rem';
    multCell.appendChild(multSuffix);

    const extraCell = document.createElement('td');
    extraCell.style.cssText = 'padding:10px;vertical-align:middle';
    const extraInput = document.createElement('input');
    extraInput.type = 'number'; extraInput.step = '1'; extraInput.min = '0'; extraInput.max = '240';
    extraInput.placeholder = '—';
    extraInput.className = 'accom-num-input';
    extraCell.appendChild(extraInput);
    const extraSuffix = document.createElement('span');
    extraSuffix.textContent = ' min';
    extraSuffix.style.cssText = 'margin-left:6px;color:var(--ccu-mute);font-size:.82rem';
    extraCell.appendChild(extraSuffix);

    const statusCell = document.createElement('td');
    statusCell.style.cssText = 'padding:10px;text-align:right;vertical-align:middle;font-size:.82rem;color:var(--ccu-mute)';
    statusCell.textContent = '';

    const clearCell = document.createElement('td');
    clearCell.style.cssText = 'padding:10px;text-align:right;vertical-align:middle';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = true;
    clearBtn.className = 'accom-clear-btn';
    clearCell.appendChild(clearBtn);

    tr.appendChild(nameCell);
    tr.appendChild(currentCell);
    tr.appendChild(multCell);
    tr.appendChild(extraCell);
    tr.appendChild(statusCell);
    tr.appendChild(clearCell);

    // Mutual exclusion: filling one input clears the other
    multInput.addEventListener('input', () => {
      if (multInput.value !== '') extraInput.value = '';
      refreshUpdateButton();
    });
    extraInput.addEventListener('input', () => {
      if (extraInput.value !== '') multInput.value = '';
      refreshUpdateButton();
    });

    const rowRef = {
      userId, displayName: studentDisplayName(student),
      current: null,
      trEl: tr, currentCell, multInput, extraInput, statusCell, clearBtn,
    };
    clearBtn.addEventListener('click', () => onClearRow(rowRef));
    return rowRef;
  }

  function fillRowFromCurrent(row, cur) {
    row.current = cur;
    row.currentCell.textContent = fmtCurrent(cur);
    row.currentCell.style.color = cur ? 'var(--ccu-db)' : 'var(--ccu-mute)';
    row.currentCell.style.fontWeight = cur ? '600' : '400';
    // Pre-fill inputs with current values so "no change" rows skip on save
    if (cur && cur.op === 'mult'  && cur.value != null) {
      row.multInput.value  = cur.value;
      row.extraInput.value = '';
    } else if (cur && cur.op === 'extra' && cur.value != null) {
      row.extraInput.value = cur.value;
      row.multInput.value  = '';
    } else {
      row.multInput.value  = '';
      row.extraInput.value = '';
    }
    // Clear button is only meaningful when there's something to clear
    syncClearButtonState(row);
  }

  function syncClearButtonState(row) {
    if (!row.clearBtn) return;
    const hasCurrent = !!(row.current && row.current.value != null);
    const blocked    = writePermission === 'no_permission';
    row.clearBtn.disabled = !hasCurrent || saving || blocked;
    row.clearBtn.style.opacity = '';
    row.clearBtn.style.cursor  = '';
    row.clearBtn.title = blocked
      ? 'Your role lacks the Manage Accommodations permission in this course.'
      : hasCurrent
        ? 'Remove this student’s quiz time accommodation'
        : 'No accommodation to clear';
  }

  async function onClearRow(row) {
    if (saving || !activeCourse) return;
    if (!row.current) return;
    const confirmMsg =
      'Clear the quiz time accommodation for ' + row.displayName + '?\n\n' +
      'This removes their current setting (' + fmtCurrent(row.current) + ') ' +
      'from this course. They will fall back to the default time limit on every quiz.';
    if (!window.confirm(confirmMsg)) return;

    saving = true;
    const originalText = row.clearBtn.textContent;
    row.clearBtn.disabled = true;
    row.clearBtn.textContent = 'Clearing…';
    setRowStatus(row, 'wait', 'Clearing…');
    refreshUpdateButton(); // disables Update All while a clear is in flight

    try {
      await clearAccommodation(activeCourse.ouId, row.userId);
      row.current = null;
      row.currentCell.textContent = 'None';
      row.currentCell.style.color = 'var(--ccu-mute)';
      row.currentCell.style.fontWeight = '400';
      row.multInput.value  = '';
      row.extraInput.value = '';
      setRowStatus(row, 'ok', '✓ Cleared');
    } catch (e) {
      console.warn('[Accommodations] clear failed', row.userId, e);
      let msg = '✗ ' + (e.status ? e.status + ' error' : 'Failed');
      if (e.status === 403)           msg = '✗ Role lacks permission';
      if (e.status === 401)           msg = '✗ Session expired';
      if (e.status === 'silent_fail') msg = '✗ Not persisted (role permission)';
      setRowStatus(row, 'bad', msg);
    } finally {
      saving = false;
      row.clearBtn.textContent = originalText;
      syncClearButtonState(row);
      refreshUpdateButton();
    }
  }

  // ── Diff: what does the row WANT now vs what's CURRENT? ─
  function rowIntent(row) {
    const mult  = row.multInput.value.trim();
    const extra = row.extraInput.value.trim();
    if (mult !== '' && extra !== '') {
      return { error: 'Set only one of Multiplier or Extra Minutes — not both.' };
    }
    if (mult !== '') {
      const v = Number(mult);
      if (isNaN(v) || v < 1 || v > 5) return { error: 'Multiplier must be between 1 and 5.' };
      return { op: 'mult', value: v };
    }
    if (extra !== '') {
      const v = Number(extra);
      if (isNaN(v) || v < 0 || v > 240) return { error: 'Extra minutes must be between 0 and 240.' };
      return { op: 'extra', value: v };
    }
    return { op: null, value: null }; // empty — no accommodation in form
  }

  function rowHasChange(row) {
    const intent = rowIntent(row);
    if (intent.error) return true; // surface validation errors on Update All
    const cur = row.current;
    // No current, no intent → no change
    if (!cur && !intent.op) return false;
    // Current set, intent empty → would clear (we don't support clearing
    // in v1; treat as no change rather than an erroneous save)
    if (cur && !intent.op) return false;
    // Both present → compare
    if (cur && intent.op) {
      return !(cur.op === intent.op && Number(cur.value) === Number(intent.value));
    }
    // No current, intent set → change
    return !!intent.op;
  }

  // ── Update All button state ─────────────────────────────
  function refreshUpdateButton() {
    const btn = $('accomUpdateAll');
    if (!btn) return;
    if (saving || !rows.length) { btn.disabled = true; updateSummary(); return; }
    if (writePermission === 'no_permission') {
      btn.disabled = true;
      btn.textContent = 'Update All (read-only)';
      updateSummary();
      return;
    }
    const changed = rows.filter(rowHasChange);
    btn.disabled = changed.length === 0;
    btn.textContent = changed.length
      ? 'Update All (' + changed.length + ')'
      : 'Update All';
    updateSummary(changed.length);
  }

  function updateSummary(changedCount) {
    const el = $('accomSummary');
    if (!el) return;
    if (!rows.length) { el.textContent = 'Pick a course above to load students.'; return; }
    const n = rows.length;
    const cnt = changedCount == null ? rows.filter(rowHasChange).length : changedCount;
    el.textContent = n + ' student' + (n === 1 ? '' : 's') +
      ' loaded · ' + cnt + ' pending change' + (cnt === 1 ? '' : 's');
  }

  function setRowStatus(row, kind, msg) {
    const cell = row.statusCell;
    cell.textContent = msg || '';
    cell.style.color =
      kind === 'ok'    ? 'var(--ok-text)'  :
      kind === 'bad'   ? 'var(--bad-text)' :
      kind === 'wait'  ? 'var(--ccu-mute)' :
                         'var(--ccu-mute)';
    cell.style.fontStyle = (kind === 'wait') ? 'italic' : 'normal';
  }

  // ── Update All flow ─────────────────────────────────────
  async function onUpdateAll() {
    if (saving || !activeCourse) return;
    const toSave = rows.filter(rowHasChange);
    if (!toSave.length) return;

    // First pass — surface validation errors without contacting the server
    let firstErrorRow = null;
    toSave.forEach(row => {
      const intent = rowIntent(row);
      if (intent.error) {
        setRowStatus(row, 'bad', intent.error);
        firstErrorRow = firstErrorRow || row;
      } else {
        setRowStatus(row, '', '');
      }
    });
    if (firstErrorRow) {
      $('accomSummary').textContent = 'Fix the highlighted rows before updating.';
      return;
    }

    saving = true;
    const btn = $('accomUpdateAll');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    $('accomSummary').textContent = 'Saving ' + toSave.length + ' change' + (toSave.length === 1 ? '' : 's') + '…';

    let okCount = 0, errCount = 0;
    // Sequential saves keep XSRF/session sane and let us update each
    // row's status as it completes. For a typical Institution class size
    // (< 30 students with changes), this finishes in a few seconds.
    for (const row of toSave) {
      const intent = rowIntent(row);
      setRowStatus(row, 'wait', 'Saving…');
      try {
        await saveAccommodation(activeCourse.ouId, row.userId, intent.op, intent.value);
        row.current = { op: intent.op, value: intent.value };
        row.currentCell.textContent = fmtCurrent(row.current);
        row.currentCell.style.color = 'var(--ccu-db)';
        row.currentCell.style.fontWeight = '600';
        setRowStatus(row, 'ok', '✓ Saved');
        syncClearButtonState(row);
        okCount++;
      } catch (e) {
        console.warn('[Accommodations] save failed', row.userId, e);
        let msg = '✗ ' + (e.status ? e.status + ' error' : 'Failed');
        if (e.status === 403)          msg = '✗ Role lacks permission';
        if (e.status === 401)          msg = '✗ Session expired';
        if (e.status === 'silent_fail') msg = '✗ Not persisted (role permission)';
        setRowStatus(row, 'bad', msg);
        // Roll back the optimistic row.current update so the Current
        // cell shows what's actually on the server, not what we tried
        // to save.
        try {
          const fresh = await fetchAccommodation(activeCourse.ouId, row.userId);
          row.current = parseCurrent(fresh);
          row.currentCell.textContent = fmtCurrent(row.current);
          row.currentCell.style.color = row.current ? 'var(--ccu-db)' : 'var(--ccu-mute)';
          row.currentCell.style.fontWeight = row.current ? '600' : '400';
        } catch (_) { /* leave row alone */ }
        errCount++;
      }
    }

    saving = false;
    rows.forEach(syncClearButtonState);
    $('accomSummary').textContent =
      okCount + ' saved' + (errCount ? ', ' + errCount + ' failed' : '') + '.';
    refreshUpdateButton();
  }

  // ── Course pick → load classlist + accommodations ───────
  async function onCoursePicked(course) {
    activeCourse    = course;
    rows            = [];
    saving          = false;
    writePermission = 'unknown';
    const banner = $('accomPermBanner');
    if (banner) banner.style.display = 'none';

    const card = $('accomMatrixCard');
    const body = $('accomTableBody');
    const empty = $('accomMatrixEmpty');
    const loading = $('accomLoadingPill');
    const label = $('accomCourseLabel');

    body.innerHTML = '';
    hide(empty);
    show(card);
    label.textContent = (course && (course.code || course.name)) ||
                        ('Course ' + (course && course.ouId));
    show(loading);
    $('accomSummary').textContent = 'Loading classlist…';
    $('accomUpdateAll').disabled = true;
    $('accomUpdateAll').textContent = 'Update All';

    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}

    let classlist;
    try {
      classlist = await fetchClasslist(course.ouId);
    } catch (e) {
      console.error('[Accommodations] classlist failed', e);
      hide(loading);
      show(empty);
      empty.textContent = 'Could not load classlist (' + (e.message || e) + ').';
      return;
    }

    // Filter to actual students (exclude instructors, designers, admins).
    // Brightspace classlist entries have a Role field; without it, we
    // include everyone so we don't accidentally hide enrolled students.
    const candidates = (classlist || []).filter(s => {
      if (!s) return false;
      const role = (s.Role && (s.Role.Name || s.RoleName)) || '';
      // Empty role → include; otherwise only include if role contains "Student"
      // or "Learner" (Institution sometimes uses Learner). Filter out Instructor/
      // Designer/Administrator/TA so the matrix isn't cluttered with staff.
      if (!role) return true;
      if (/^student|learner/i.test(role)) return true;
      if (/instructor|designer|admin|grader|ta\b|teaching/i.test(role)) return false;
      return true;
    });

    // Sort by display name (last, first)
    candidates.sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b)));

    if (!candidates.length) {
      hide(loading);
      show(empty);
      $('accomSummary').textContent = '';
      return;
    }

    // Render placeholder rows immediately so the user sees something
    rows = candidates.map(buildRow);
    rows.forEach(r => body.appendChild(r.trEl));
    $('accomSummary').textContent = rows.length + ' student' + (rows.length === 1 ? '' : 's') +
      ' loaded · loading accommodations…';

    // Fetch each student's accommodation in parallel (bounded concurrency)
    await pMap(rows, async (row) => {
      try {
        const accom = await fetchAccommodation(course.ouId, row.userId);
        fillRowFromCurrent(row, parseCurrent(accom));
      } catch (e) {
        // Permission failure or transient — show "—" but don't block save.
        row.currentCell.textContent = '—';
        row.currentCell.style.color = 'var(--ccu-mute)';
      }
    }, FETCH_CONCURRENCY);

    hide(loading);

    // Preflight write-permission probe. Pick the first row as a sample
    // and send one idempotent POST. If Brightspace returns 403, the
    // user's role can't save here and we flip the dashboard to
    // read-only. Anything else (2xx, 400, 409) means writes will work.
    try {
      if (rows.length) {
        const sample = rows[0];
        writePermission = await probeWritePermission(
          course.ouId, sample.userId, sample.current
        );
        applyPermissionUI();
      }
    } catch (e) { /* leave writePermission at 'unknown' */ }

    refreshUpdateButton();
  }

  // ── Init / pinned-courses wiring ────────────────────────
  async function init(courseId) {
    console.info('[Accommodations] Institution Faculty Dashboard init');

    var meta = $('accomHeaderMeta');
    try {
      BSP.api.whoami().then(function (u) {
        if (u && meta) {
          meta.textContent = 'Signed in as ' + ((u.FirstName || '') + ' ' + (u.LastName || '')).trim();
        }
      }).catch(function () {});
    } catch (e) {}

    $('accomUpdateAll').addEventListener('click', onUpdateAll);

    var courseSelect = document.getElementById('laCourse');
    if (courseSelect && window.FacultyDashboardCourses) {
      await window.FacultyDashboardCourses.populateCourseSelect(courseSelect, {
        selectedValue: courseId ? String(courseId) : ''
      });
      courseSelect.addEventListener('change', function () {
        var ouId = courseSelect.value;
        if (!ouId) return;
        var opt = courseSelect.options[courseSelect.selectedIndex];
        onCoursePicked({
          ouId: ouId,
          code: opt.textContent || '',
          name: opt.textContent || ''
        });
      });
      if (courseId) {
        onCoursePicked({ ouId: courseId, code: '', name: '' });
      }
    }
  }

  BSP.modules['accommodations'] = { init };
})();

(function () {
  'use strict';
  function boot() {
    if (window.BSP && BSP.modules && BSP.modules.accommodations) {
      BSP.modules.accommodations.init();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
