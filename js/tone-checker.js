/* ════════════════════════════════════════════════════════════════════
   TONE CHECKER  ·  assets/js/tone-checker.js
   --------------------------------------------------------------------
   A paste-in tone analyzer that runs the SAME engine the two tone
   dashboards (Discussion Tone, Feedback Tone) use:
     • identical POSITIVE_CATEGORIES / NEGATIVE_CATEGORIES attribute
       framework (copied verbatim from dashboards/tone-engine.html),
     • the same regex attribute detection (detectAttributes),
     • the same Xenova/distilbert-base-uncased-finetuned-sst-2-english
       sentiment model via @huggingface/transformers, with graceful
       keyword-only fallback,
     • the same overall tone-label logic (analyzeText).

   Difference from the dashboards: the text comes from a textarea the
   user pastes into, instead of from Brightspace discussion posts or
   feedback comments. There is no Brightspace API call here and no FERPA
   data — it analyzes whatever the user types.

   Registered as a route module: BSP.modules['tone-checker'].init().
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.BSP = window.BSP || {};
  BSP.modules = BSP.modules || {};

  // ── Engine state ──────────────────────────────────────────────────
  var classifier = null;   // distilbert pipeline once loaded
  var modelReady = false;  // true when AI sentiment is available
  var modelTried = false;  // guard so we only kick the loader once
  var wired = false;       // guard so init() only wires handlers once

  // ════════════════════════════════════════════════════════════════
  //  TEACHER TONE ATTRIBUTE FRAMEWORK
  //  (verbatim from dashboards/tone-engine.html — keep in sync)
  // ════════════════════════════════════════════════════════════════
  var POSITIVE_CATEGORIES = {
    'Encouraging & Supportive': {
      encouraging: ['great job', 'well done', 'excellent', 'wonderful', 'fantastic', 'amazing', 'outstanding', 'superb', 'bravo', 'kudos', 'nice work', 'good work', 'good job', 'awesome', 'terrific', 'magnificent'],
      supportive: ['i support', 'here to help', 'i am here', 'you are not alone', 'lean on', 'count on me', 'we are in this', 'here for you', 'support you'],
      affirming: ['you are right', 'exactly', 'absolutely', 'precisely', 'spot on', 'well said', 'you nailed', 'correct', 'thats right', 'i agree'],
      reassuring: ['dont worry', 'it is okay', 'perfectly normal', 'no pressure', 'take your time', 'totally fine', 'not a problem', 'all good', 'its okay'],
      motivational: ['you can do', 'believe in you', 'i know you can', 'capable of', 'you have what it takes', 'rise to', 'push through', 'reach your potential'],
      uplifting: ['proud of you', 'impressed', 'inspiring', 'remarkable', 'brightened', 'lifted', 'exceptional', 'extraordinary']
    },
    'Respectful & Professional': {
      respectful: ['i respect', 'i appreciate your', 'valued', 'honor your', 'thank you for sharing', 'i value'],
      professional: ['well articulated', 'thorough analysis', 'scholarly', 'academically', 'rigorous', 'well researched', 'comprehensive'],
      considerate: ['i understand that', 'considering your', 'mindful of', 'keeping in mind', 'acknowledging'],
      patient: ['take your time', 'no rush', 'whenever you are ready', 'at your own pace', 'when you feel comfortable']
    },
    'Helpful & Instructional': {
      constructive: ['consider trying', 'one suggestion', 'you might try', 'to strengthen this', 'to improve', 'to build on this', 'for next time', 'going forward'],
      clarifying: ['to clarify', 'what i mean is', 'in other words', 'let me explain', 'to elaborate', 'put another way'],
      guiding: ['think about', 'consider how', 'explore the idea', 'reflect on', 'look into', 'dig deeper', 'investigate'],
      insightful: ['insightful', 'thoughtful', 'perceptive', 'astute', 'keen observation', 'sharp analysis', 'deep thinking', 'nuanced']
    },
    'Relational & Human': {
      empathetic: ['i understand', 'i hear you', 'that must be', 'i can see how', 'makes sense that you feel', 'understandably'],
      compassionate: ['i care about', 'your wellbeing', 'take care of yourself', 'be kind to yourself'],
      approachable: ['feel free to', 'dont hesitate', 'my door is open', 'reach out', 'happy to help', 'come see me', 'stop by'],
      warm: ['glad you', 'happy to see', 'love how you', 'enjoy reading', 'pleasure to read', 'delighted', 'so glad', 'love that you'],
      friendly: ['hey', 'hope you are well', 'hope your week', 'looking forward', 'great to hear', 'good to see']
    },
    'Growth-Oriented': {
      inspiring: ['imagine what', 'picture this', 'envision', 'the possibilities', 'transformative'],
      challenging: ['push yourself', 'stretch beyond', 'challenge yourself', 'next level', 'go further', 'raise the bar'],
      'growth-oriented': ['you are growing', 'real progress', 'improvement', 'you have come so far', 'development', 'evolution in your thinking', 'getting stronger', 'making strides'],
      'confidence-building': ['trust yourself', 'you have the skills', 'already shown', 'proven that you', 'demonstrated', 'capability'],
      'solution-focused': ['lets figure', 'we can work', 'heres a strategy', 'one approach', 'try this method', 'a path forward']
    }
  };

  var NEGATIVE_CATEGORIES = {
    'Condescending or Dismissive': {
      condescending: ['as i already explained', 'as i said before', 'clearly you did not', 'obviously you', 'i already told you', 'as i have said'],
      patronizing: ['let me spell it out', 'i will try to simplify', 'to put it simply for you', 'even a beginner'],
      dismissive: ['not relevant', 'beside the point', 'that is not important', 'not worth discussing', 'irrelevant', 'does not matter', 'who cares'],
      sarcastic: ['oh really', 'how surprising', 'brilliant idea', 'what a concept', 'genius', 'clearly the best'],
      mocking: ['you actually think', 'laughable', 'ridiculous', 'absurd']
    },
    'Harsh or Discouraging': {
      harsh: ['terrible', 'awful', 'dreadful', 'abysmal', 'pathetic', 'appalling', 'horrendous'],
      'non-constructive criticism': ['this is wrong', 'this is bad', 'this makes no sense', 'completely off', 'totally wrong', 'entirely incorrect', 'makes no sense', 'nonsensical'],
      judgmental: ['you should have known', 'you should know', 'should be obvious', 'anyone would know', 'common knowledge'],
      scolding: ['unacceptable', 'inexcusable', 'i am disappointed in you', 'this is not okay', 'you need to do better'],
      discouraging: ['you will never', 'not cut out for', 'not capable', 'give up', 'waste of time', 'hopeless', 'pointless']
    },
    'Disrespectful': {
      impatient: ['hurry up', 'i dont have time', 'how many times', 'how hard is it', 'just do it', 'seriously'],
      irritable: ['frustrated with', 'tired of', 'sick of', 'annoyed', 'exasperated'],
      defensive: ['thats not my fault', 'i did my part', 'not my problem', 'blame yourself', 'dont blame me']
    },
    'Indifferent or Detached': {
      cold: ['if you say so', 'i suppose so', 'whatever', 'fine', 'sure whatever', 'if you want', 'okay then'],
      uninterested: ['not really relevant', 'i dont really care', 'doesnt concern me', 'not my problem', 'doesnt matter', 'dont worry about it', 'not important'],
      detached: ['figure it out yourself', 'not my job', 'up to you i guess', 'do what you want', 'its your call', 'thats on you', 'not my responsibility'],
      apathetic: ['who cares', 'whatever you say', 'it is what it is', 'doesnt make a difference', 'no opinion', 'i have no preference']
    },
    'Controlling or Authoritarian': {
      authoritarian: ['because i said so', 'no discussion', 'end of story', 'no excuses', 'case closed'],
      demanding: ['you need to immediately', 'i demand', 'no exceptions', 'non-negotiable'],
      dogmatic: ['the only answer', 'the only way', 'there is no other', 'without question'],
      'dismissive of questions': ['stop asking', 'no more questions', 'you should already know', 'look it up yourself']
    }
  };

  // ── small helpers ────────────────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function capitalize(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function stripHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  // ════════════════════════════════════════════════════════════════
  //  ATTRIBUTE DETECTION  (mirrors tone-engine.html detectAttributes)
  // ════════════════════════════════════════════════════════════════
  function detectAttributes(text) {
    var lower = text.toLowerCase().replace(/[’‘']/g, '').replace(/[“”]/g, '"');
    var positiveHits = {};
    var negativeHits = {};

    function scan(cats, bucket) {
      for (var catName in cats) {
        if (!cats.hasOwnProperty(catName)) continue;
        var attrs = cats[catName];
        for (var attrName in attrs) {
          if (!attrs.hasOwnProperty(attrName)) continue;
          var phrases = attrs[attrName];
          for (var i = 0; i < phrases.length; i++) {
            var regex = new RegExp(escRegex(phrases[i]), 'gi');
            var matches = lower.match(regex);
            if (matches && matches.length > 0) {
              if (!bucket[attrName]) bucket[attrName] = { category: catName, count: 0 };
              bucket[attrName].count += matches.length;
            }
          }
        }
      }
    }
    scan(POSITIVE_CATEGORIES, positiveHits);
    scan(NEGATIVE_CATEGORIES, negativeHits);
    return { positive: positiveHits, negative: negativeHits };
  }

  // ════════════════════════════════════════════════════════════════
  //  ANALYZE  (mirrors tone-engine.html analyzeText)
  // ════════════════════════════════════════════════════════════════
  function analyzeText(text) {
    var clean = stripHtml(text).trim();
    if (!clean || clean.length < 5) {
      return { sentiment: 0.5, sentLabel: 'NEUTRAL', attrs: { positive: {}, negative: {} }, posCount: 0, negCount: 0, toneLabel: 'neutral', empty: true };
    }

    var attrs = detectAttributes(clean);
    var posCount = 0, negCount = 0, k;
    for (k in attrs.positive) if (attrs.positive.hasOwnProperty(k)) posCount += attrs.positive[k].count;
    for (k in attrs.negative) if (attrs.negative.hasOwnProperty(k)) negCount += attrs.negative[k].count;

    var sentiment = 0.5;
    var sentLabel = 'NEUTRAL';

    if (modelReady && classifier) {
      try {
        var truncated = clean.split(/\s+/).slice(0, 400).join(' ');
        // classifier is async; the caller awaits a Promise wrapper below.
        return classifier(truncated).then(function (result) {
          if (result && result[0]) {
            sentLabel = result[0].label;
            sentiment = result[0].label === 'POSITIVE' ? result[0].score : (1 - result[0].score);
          }
          return finalize(attrs, posCount, negCount, sentiment, sentLabel);
        }).catch(function () {
          return finalize(attrs, posCount, negCount, sentiment, sentLabel);
        });
      } catch (e) { /* fall through to keyword fallback */ }
    }

    // Keyword-only fallback (no AI model)
    var total = posCount + negCount;
    sentiment = total > 0 ? posCount / total : 0.5;
    sentLabel = sentiment > 0.6 ? 'POSITIVE' : sentiment < 0.4 ? 'NEGATIVE' : 'NEUTRAL';
    return finalize(attrs, posCount, negCount, sentiment, sentLabel);
  }

  function finalize(attrs, posCount, negCount, sentiment, sentLabel) {
    var toneLabel = 'neutral';
    if (negCount > 0 && posCount === 0) toneLabel = 'negative';
    else if (negCount > 0 && posCount > 0) toneLabel = 'mixed';
    else if (posCount > 2 || sentiment > 0.7) toneLabel = 'positive';
    else if (posCount > 0) toneLabel = 'positive';
    return { sentiment: sentiment, sentLabel: sentLabel, attrs: attrs, posCount: posCount, negCount: negCount, toneLabel: toneLabel, empty: false };
  }

  // ════════════════════════════════════════════════════════════════
  //  HIGHLIGHTER
  //  Wrap every matched phrase in the ORIGINAL text. We build a
  //  normalized copy of the text using the SAME rules detectAttributes
  //  uses (lowercase, strip apostrophes, fold curly quotes) while
  //  keeping an index map back to the original characters, so the
  //  highlighted spans line up exactly with what the engine matched.
  // ════════════════════════════════════════════════════════════════
  function buildNormalized(text) {
    var norm = '';
    var map = []; // map[i] = original index of normalized char i
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '’' || ch === '‘' || ch === "'") continue; // apostrophes removed
      var out = ch;
      if (ch === '“' || ch === '”') out = '"';
      norm += out.toLowerCase();
      map.push(i);
    }
    return { norm: norm, map: map };
  }

  function collectRanges(text) {
    var nm = buildNormalized(text);
    var norm = nm.norm, map = nm.map;
    var ranges = [];

    function scan(cats, polarity) {
      for (var catName in cats) {
        if (!cats.hasOwnProperty(catName)) continue;
        var attrs = cats[catName];
        for (var attrName in attrs) {
          if (!attrs.hasOwnProperty(attrName)) continue;
          var phrases = attrs[attrName];
          for (var i = 0; i < phrases.length; i++) {
            var re = new RegExp(escRegex(phrases[i]), 'gi');
            var m;
            while ((m = re.exec(norm)) !== null) {
              var s = m.index, e = m.index + m[0].length;
              if (e <= s) { re.lastIndex++; continue; }
              ranges.push({
                start: map[s],
                end: map[e - 1] + 1,
                attr: attrName,
                category: catName,
                polarity: polarity
              });
            }
          }
        }
      }
    }
    scan(POSITIVE_CATEGORIES, 'pos');
    scan(NEGATIVE_CATEGORIES, 'neg');

    // Sort by start, then longest first; greedily drop overlaps.
    ranges.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
    var kept = [];
    var lastEnd = -1;
    for (var j = 0; j < ranges.length; j++) {
      if (ranges[j].start >= lastEnd) {
        kept.push(ranges[j]);
        lastEnd = ranges[j].end;
      }
    }
    return kept;
  }

  function renderHighlightedText(text) {
    var ranges = collectRanges(text);
    if (!ranges.length) return escHtml(text);
    var html = '';
    var cursor = 0;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (r.start > cursor) html += escHtml(text.slice(cursor, r.start));
      var cls = r.polarity === 'pos' ? 'tc-hl tc-hl-pos' : 'tc-hl tc-hl-neg';
      var tip = capitalize(r.attr) + ' · ' + r.category;
      html += '<mark class="' + cls + '" title="' + escHtml(tip) + '">' + escHtml(text.slice(r.start, r.end)) + '</mark>';
      cursor = r.end;
    }
    if (cursor < text.length) html += escHtml(text.slice(cursor));
    return html;
  }

  // ════════════════════════════════════════════════════════════════
  //  ATTRIBUTE COLUMNS  (mirrors tone-engine.html renderAttributes)
  // ════════════════════════════════════════════════════════════════
  function renderAttrColumns(attrs) {
    function column(cats, hits, polarity, headerText) {
      var clsHead = polarity === 'pos' ? 'positive' : 'negative';
      var clsTag = polarity === 'pos' ? 'pos' : 'neg';
      var html = '<div class="attr-col"><div class="attr-col-header ' + clsHead + '">' + headerText + '</div><div class="attr-col-body">';
      var any = false;
      for (var catName in cats) {
        if (!cats.hasOwnProperty(catName)) continue;
        var attrDefs = cats[catName];
        var rowTags = '';
        for (var attrName in attrDefs) {
          if (!attrDefs.hasOwnProperty(attrName)) continue;
          var hit = hits[attrName];
          if (hit && hit.count > 0) {
            any = true;
            rowTags += '<span class="attr-tag ' + clsTag + '">' + capitalize(attrName) +
              ' <span class="attr-count">' + hit.count + '</span></span>';
          }
        }
        if (rowTags) {
          html += '<div class="attr-category"><div class="attr-category-label">' + escHtml(catName) + '</div><div class="attr-tags">' + rowTags + '</div></div>';
        }
      }
      if (!any) {
        html += '<p class="tc-none">No ' + (polarity === 'pos' ? 'positive' : 'negative') + ' tone attributes detected.</p>';
      }
      html += '</div></div>';
      return html;
    }
    return '<div class="attr-summary">' +
      column(POSITIVE_CATEGORIES, attrs.positive, 'pos', 'Positive Attributes Detected') +
      column(NEGATIVE_CATEGORIES, attrs.negative, 'neg', 'Negative Attributes Detected') +
      '</div>';
  }

  // ── overall result rendering ─────────────────────────────────────
  function toneSummary(res) {
    switch (res.toneLabel) {
      case 'positive': return 'Overall tone reads as positive — warm, encouraging, and supportive language dominates.';
      case 'negative': return 'Overall tone reads as negative — one or more discouraging or dismissive attributes were detected with no positive ones to balance them.';
      case 'mixed': return 'Overall tone is mixed — both positive and negative attributes are present. Review the negative flags below.';
      default: return 'Overall tone reads as neutral — no strong positive or negative tone attributes were detected.';
    }
  }

  function render(res) {
    var sentPct = Math.round(res.sentiment * 100);
    var kpis = [
      { value: String(res.posCount), label: 'Positive Attributes', sub: res.posCount === 1 ? '1 attribute' : res.posCount + ' attributes' },
      { value: String(res.negCount), label: 'Negative Flags', sub: res.negCount > 0 ? (res.negCount + ' flag' + (res.negCount !== 1 ? 's' : '')) : 'none found' },
      { value: sentPct + '%', label: 'AI Sentiment', sub: modelReady ? (capitalize(res.sentLabel.toLowerCase()) + ' (AI model)') : 'keyword estimate' },
      { value: capitalize(res.toneLabel), label: 'Overall Tone', sub: 'classification' }
    ];

    var kpiHtml = '<div class="kpi-row">';
    kpis.forEach(function (k) {
      kpiHtml += '<div class="kpi-card"><div class="kpi-value">' + escHtml(k.value) + '</div>' +
        '<div class="kpi-label">' + escHtml(k.label) + '</div>' +
        '<div class="kpi-sub">' + escHtml(k.sub) + '</div></div>';
    });
    kpiHtml += '</div>';

    var badgeCls = 'tone-' + res.toneLabel;
    var overall = '<div class="tc-overall">' +
      '<span class="tone-badge ' + badgeCls + '">' + capitalize(res.toneLabel) + ' tone</span>' +
      '<p class="tc-overall-text">' + escHtml(toneSummary(res)) + '</p></div>';

    return overall + kpiHtml + renderAttrColumns(res.attrs);
  }

  // ════════════════════════════════════════════════════════════════
  //  AI MODEL LOADER (distilbert sentiment, same as the dashboards)
  // ════════════════════════════════════════════════════════════════
  function setModelStatus(state, label, detail, pct) {
    var bar = document.getElementById('tcModelBar');
    var fill = document.getElementById('tcModelFill');
    var lab = document.getElementById('tcModelLabel');
    var det = document.getElementById('tcModelDetail');
    var pctEl = document.getElementById('tcModelPercent');
    if (!bar) return;
    bar.classList.add('active');
    bar.setAttribute('data-state', state);
    if (lab && label != null) lab.textContent = label;
    if (det && detail != null) det.textContent = detail;
    if (typeof pct === 'number') {
      if (fill) { fill.style.width = pct + '%'; fill.setAttribute('aria-valuenow', String(pct)); }
      if (pctEl) pctEl.textContent = pct + '%';
    } else if (pct === '—') {
      if (pctEl) pctEl.textContent = '—';
    }
  }

  function isMobileDevice() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  }

  async function loadModel() {
    if (modelTried) return modelReady;
    modelTried = true;

    if (isMobileDevice()) {
      setModelStatus('keyword', 'Using keyword analysis (mobile mode)', 'AI model skipped on mobile devices to prevent crashes.', '—');
      return false;
    }

    setModelStatus('loading', 'Loading AI sentiment model…', 'distilbert-base-uncased-finetuned-sst-2-english', 15);
    try {
      var mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1');
      var pipeline = mod.pipeline, env = mod.env;
      env.allowLocalModels = false;

      var cached = false;
      try {
        var cache = await caches.open('transformers-cache');
        var keys = await cache.keys();
        cached = keys.some(function (k) { return k.url && k.url.indexOf('distilbert') !== -1; });
      } catch (e) { /* Cache API unavailable — fine */ }

      setModelStatus('loading',
        cached ? 'Loading model from cache…' : 'Downloading sentiment model…',
        cached ? 'distilbert (cached)' : 'distilbert (~67 MB, first visit only)', 30);

      classifier = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english', {
        progress_callback: function (p) {
          if (p && p.status === 'download' && p.total) {
            var pct = Math.min(95, 30 + Math.round((p.loaded / p.total) * 60));
            setModelStatus('loading', 'Downloading sentiment model…',
              'Downloading: ' + (p.loaded / 1048576).toFixed(1) + ' / ' + (p.total / 1048576).toFixed(1) + ' MB', pct);
          }
        }
      });

      modelReady = true;
      setModelStatus('ready', 'AI sentiment model ready', 'Analysis uses the same engine as the tone dashboards.', 100);
      setTimeout(function () { var b = document.getElementById('tcModelBar'); if (b) b.classList.remove('active'); }, 1800);

      // If the user already analyzed something in keyword mode, refresh it.
      var ta = document.getElementById('tcInput');
      if (ta && ta.value.trim().length >= 5 && document.getElementById('tcResults') &&
          !document.getElementById('tcResults').hidden) {
        runAnalysis();
      }
      return true;
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      setModelStatus('error', 'Model unavailable — using keyword analysis',
        msg.substring(0, 90) || 'Falling back to keyword detection.', '—');
      setTimeout(function () { var b = document.getElementById('tcModelBar'); if (b) b.classList.remove('active'); }, 2600);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  ACTIONS
  // ════════════════════════════════════════════════════════════════
  async function runAnalysis() {
    var ta = document.getElementById('tcInput');
    var results = document.getElementById('tcResults');
    var resultBody = document.getElementById('tcResultBody');
    var hlCard = document.getElementById('tcHighlightCard');
    var hlBody = document.getElementById('tcHighlightBody');
    var empty = document.getElementById('tcEmpty');
    if (!ta || !results) return;

    var text = ta.value || '';
    if (stripHtml(text).trim().length < 5) {
      results.hidden = true;
      if (hlCard) hlCard.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = 'Paste at least a sentence or two above, then choose Analyze tone.'; }
      return;
    }
    if (empty) empty.hidden = true;

    var res = analyzeText(text);
    // analyzeText may return a Promise (AI path) or a plain object (keyword path)
    if (res && typeof res.then === 'function') res = await res;

    resultBody.innerHTML = render(res);
    results.hidden = false;

    if (hlBody && hlCard) {
      hlBody.innerHTML = renderHighlightedText(text);
      hlCard.hidden = false;
    }

    var live = document.getElementById('tcLive');
    if (live) {
      live.textContent = 'Analysis complete. Overall tone ' + res.toneLabel + '. ' +
        res.posCount + ' positive attributes, ' + res.negCount + ' negative flags.';
    }
  }

  function resetAll() {
    var ta = document.getElementById('tcInput');
    var results = document.getElementById('tcResults');
    var hlCard = document.getElementById('tcHighlightCard');
    var empty = document.getElementById('tcEmpty');
    if (ta) { ta.value = ''; }
    if (results) { results.hidden = true; }
    var rb = document.getElementById('tcResultBody'); if (rb) rb.innerHTML = '';
    var hb = document.getElementById('tcHighlightBody'); if (hb) hb.innerHTML = '';
    if (hlCard) hlCard.hidden = true;
    if (empty) { empty.hidden = false; empty.textContent = 'Paste your text above, then choose Analyze tone to see the same tone attributes the dashboards detect.'; }
    updateCount();
    if (ta) ta.focus();
    var live = document.getElementById('tcLive');
    if (live) live.textContent = 'Cleared. Ready for new text.';
  }

  function updateCount() {
    var ta = document.getElementById('tcInput');
    var counter = document.getElementById('tcCount');
    if (!ta || !counter) return;
    var t = ta.value.trim();
    var words = t ? t.split(/\s+/).length : 0;
    counter.textContent = words + (words === 1 ? ' word' : ' words') + ' · ' + ta.value.length + ' chars';
  }

  // ════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════
  function initToneChecker() {
    var analyzeBtn = document.getElementById('tcAnalyzeBtn');
    var resetBtn = document.getElementById('tcResetBtn');
    var ta = document.getElementById('tcInput');

    if (!wired) {
      if (analyzeBtn) analyzeBtn.addEventListener('click', function () { runAnalysis(); });
      if (resetBtn) resetBtn.addEventListener('click', function () { resetAll(); });
      if (ta) {
        ta.addEventListener('input', updateCount);
        // Ctrl/Cmd+Enter to analyze
        ta.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAnalysis(); }
        });
      }
      wired = true;
    }

    updateCount();
    // Kick the AI model load lazily (keyword mode works immediately).
    loadModel();
  }

  BSP.modules['tone-checker'] = { init: initToneChecker };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToneChecker);
  } else {
    initToneChecker();
  }
})();
