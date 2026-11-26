(function () {
  'use strict';
  var Calc = window.Calc, I18N = window.I18N;
  var KEY = 'moaadel.v1';
  var NS = 'http://www.w3.org/2000/svg';
  var counter = 0;

  function uid(p) { counter += 1; return p + Date.now().toString(36) + counter + Math.floor(Math.random() * 1e4).toString(36); }

  // ---------- state ----------
  var defaults = function () {
    return {
      lang: (navigator.language || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en',
      theme: window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      tab: 'semesters',
      presetId: 'egypt4',
      scale: Calc.clone(Calc.SCALES.egypt4.rows),
      settings: Calc.clone(Calc.DEFAULT_SETTINGS),
      semesters: [],
      planner: { target: '3.5', credits: '15', whatIf: null }
    };
  };
  var state = defaults();
  var storageOk = true;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      var clean = Calc.sanitizeState({ semesters: d.semesters, scale: d.scale, settings: d.settings });
      if (!clean) return;
      state.semesters = clean.semesters;
      state.scale = clean.scale;
      state.settings = clean.settings;
      if (d.lang === 'ar' || d.lang === 'en') state.lang = d.lang;
      if (d.theme === 'dark' || d.theme === 'light') state.theme = d.theme;
      if (['semesters', 'planner', 'scale'].indexOf(d.tab) >= 0) state.tab = d.tab;
      if (d.presetId && (Calc.SCALES[d.presetId] || d.presetId === 'custom')) state.presetId = d.presetId;
      if (d.planner && typeof d.planner === 'object') {
        state.planner.target = String(d.planner.target != null ? d.planner.target : '3.5').slice(0, 6);
        state.planner.credits = String(d.planner.credits != null ? d.planner.credits : '15').slice(0, 6);
        state.planner.whatIf = d.planner.whatIf == null ? null : Calc.num(d.planner.whatIf);
        if (isNaN(state.planner.whatIf)) state.planner.whatIf = null;
      }
    } catch (e) { /* ignore corrupt storage */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { if (storageOk) { storageOk = false; toast(t('copyFailed')); } }
  }

  function t(k) { var v = I18N[state.lang][k]; return v === undefined ? I18N.en[k] : v; }

  // ---------- dom helpers ----------
  function $(id) { return document.getElementById(id); }
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function fmt(n) { return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString(); }
  function g2(n) { return n.toFixed(2); }

  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function ask(msg, yes) {
    return new Promise(function (resolve) {
      var m = $('modal');
      $('modal-msg').textContent = msg;
      $('modal-yes').textContent = yes;
      $('modal-no').textContent = state.lang === 'ar' ? 'إلغاء' : 'Cancel';
      m.hidden = false;
      $('modal-no').focus();
      function done(v) {
        m.hidden = true;
        $('modal-yes').onclick = null; $('modal-no').onclick = null;
        resolve(v);
      }
      $('modal-yes').onclick = function () { done(true); };
      $('modal-no').onclick = function () { done(false); };
    });
  }

  // ---------- compute ----------
  var result = null;
  function recompute() { result = Calc.compute(state.semesters, state.scale, state.settings); return result; }

  // ---------- static chrome ----------
  function renderChrome() {
    var r = document.documentElement;
    r.lang = state.lang; r.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    r.setAttribute('data-theme', state.theme);
    document.title = state.lang === 'ar' ? 'معدّل | حاسبة المعدل التراكمي والساعات المعتمدة' : 'Moaadel | GPA & credit-hours calculator';
    $('app-name').textContent = t('appName');
    $('app-tagline').textContent = t('tagline');
    $('btn-lang').textContent = t('language');
    $('btn-theme').textContent = state.theme === 'dark' ? t('themeLight') : t('themeDark');
    $('btn-theme').setAttribute('aria-label', t('theme'));
    $('hero-label').textContent = t('cumGpa');
    $('st-counted-l').textContent = t('creditsCounted');
    $('st-earned-l').textContent = t('creditsEarned');
    $('st-sems-l').textContent = t('semestersCount');
    $('footer-text').textContent = t('footer');
    var tabs = $('tabs');
    tabs.textContent = '';
    tabs.setAttribute('aria-label', t('appName'));
    [['semesters', 'tabSemesters'], ['planner', 'tabPlanner'], ['scale', 'tabScale']].forEach(function (x) {
      tabs.appendChild(h('button', {
        type: 'button', role: 'tab', id: 'tab-' + x[0], 'aria-selected': String(state.tab === x[0]),
        'aria-controls': 'panel-' + x[0], class: 'tab' + (state.tab === x[0] ? ' on' : ''), text: t(x[1]),
        onclick: function () { setTab(x[0]); }
      }));
    });
    ['semesters', 'planner', 'scale'].forEach(function (n) { var pn = $('panel-' + n); pn.hidden = state.tab !== n; pn.setAttribute('aria-labelledby', 'tab-' + n); });
  }
  function setTab(n) {
    state.tab = n; save(); renderChrome();
    window.scrollTo({ top: Math.min(window.scrollY, $('tabs').offsetTop - 8), behavior: 'auto' });
  }

  // ---------- hero + stats ----------
  var CIRC = 2 * Math.PI * 52;
  function updateHero() {
    var tt = result.total;
    var bar = $('g-bar');
    bar.style.strokeDasharray = CIRC.toFixed(2);
    var frac = tt.hasGpa && tt.max > 0 ? Math.min(1, tt.gpa / tt.max) : 0;
    bar.style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(2);
    $('g-value').textContent = tt.hasGpa ? g2(tt.gpa) : '--';
    $('g-max').textContent = t('outOf') + ' ' + fmt(tt.max);
    $('gauge-wrap').setAttribute('aria-label', t('cumGpa') + ': ' + (tt.hasGpa ? g2(tt.gpa) : '--'));
    var hon = $('honors');
    hon.textContent = '';
    if (tt.hasGpa) hon.appendChild(h('span', { class: 'badge-honor h-' + tt.honors, text: t('honors_' + tt.honors) }));
    else hon.appendChild(h('span', { class: 'muted', text: t('noGpaYet') }));
    $('st-counted').textContent = fmt(tt.credits);
    $('st-earned').textContent = fmt(tt.earned);
    $('st-sems').textContent = String(state.semesters.length);
  }

  // ---------- semesters panel ----------
  var refs = { sems: {}, courses: {} };

  function gradeOptions(selected) {
    var rows = Calc.cleanScale(state.scale);
    var opts = [h('option', { value: '', text: t('gradeNone') })];
    var found = !selected;
    rows.forEach(function (r) {
      if (r.letter === selected) found = true;
      opts.push(h('option', { value: r.letter, text: r.letter + '  ' + fmt(r.points) }));
    });
    opts.push(h('option', { value: 'P', text: t('gradePass') }));
    opts.push(h('option', { value: 'W', text: t('gradeWithdrawn') }));
    if (selected === 'P' || selected === 'W') found = true;
    if (!found) opts.push(h('option', { value: selected, text: selected + ' ?' }));
    return opts;
  }

  function courseRow(sem, c) {
    var isScore = state.settings.inputMode === 'score';
    var badge = h('span', { class: 'cbadge' });
    var note = h('div', { class: 'cnote' });
    var gradeCtl;
    if (isScore) {
      gradeCtl = h('input', {
        class: 'c-score', type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '0.1',
        'aria-label': t('score'), placeholder: '0-100', value: c.score === '' ? '' : String(c.score),
        oninput: function (e) { c.score = e.target.value === '' ? '' : e.target.value; changed(); }
      });
    } else {
      gradeCtl = h('select', {
        class: 'c-grade', 'aria-label': t('grade'),
        onchange: function (e) { c.letter = e.target.value; changed(); }
      }, gradeOptions(c.letter));
      gradeCtl.value = c.letter || '';
    }
    var row = h('div', { class: 'course' }, [
      h('div', { class: 'c-top' }, [
        h('input', {
          class: 'c-name', type: 'text', maxlength: '80', placeholder: t('courseName'), 'aria-label': t('courseName'), value: c.name,
          oninput: function (e) { c.name = e.target.value; changed(); }
        }),
        h('button', {
          class: 'icon c-del', type: 'button', 'aria-label': t('deleteCourse'), title: t('deleteCourse'), text: '\u00d7',
          onclick: function () {
            sem.courses = sem.courses.filter(function (x) { return x !== c; });
            changed(true);
          }
        })
      ]),
      h('div', { class: 'c-mid' }, [
        h('label', { class: 'f' }, [h('span', { text: t('creditHours') }), h('input', {
          class: 'c-credits', type: 'number', inputmode: 'decimal', min: '0.5', max: '30', step: '0.5', value: String(c.credits),
          oninput: function (e) { c.credits = e.target.value; changed(); }
        })]),
        h('label', { class: 'f' }, [h('span', { text: isScore ? t('score') : t('grade') }), gradeCtl]),
        h('label', { class: 'chk', title: t('retakeHint') }, [h('input', {
          class: 'c-retake', type: 'checkbox', checked: c.retake ? true : null,
          onchange: function (e) { c.retake = e.target.checked; changed(); }
        }), h('span', { text: t('retake') })]),
        badge
      ]),
      note
    ]);
    refs.courses[c.id] = { row: row, badge: badge, note: note };
    return row;
  }

  function semesterCard(sem, idx) {
    var gpaChip = h('span', { class: 'chip gpa' });
    var cumChip = h('span', { class: 'chip' });
    var meta = h('span', { class: 'chip soft' });
    var list = h('div', { class: 'courses' });
    sem.courses.forEach(function (c) { list.appendChild(courseRow(sem, c)); });
    var card = h('article', { class: 'sem' }, [
      h('div', { class: 'sem-head' }, [
        h('input', {
          class: 's-name', type: 'text', maxlength: '60', value: sem.name, 'aria-label': t('semesterName'),
          placeholder: t('semester') + ' ' + (idx + 1),
          oninput: function (e) { sem.name = e.target.value; save(); updateChart(); }
        }),
        h('button', {
          class: 'icon s-del', type: 'button', 'aria-label': t('deleteSemester'), title: t('deleteSemester'), text: '\u00d7',
          onclick: function () {
            ask(t('confirmDeleteSem'), t('deleteSemester')).then(function (ok) {
              if (!ok) return;
              state.semesters = state.semesters.filter(function (s) { return s !== sem; });
              changed(true);
            });
          }
        })
      ]),
      h('div', { class: 'sem-chips' }, [gpaChip, cumChip, meta]),
      list,
      h('button', {
        class: 'btn ghost add-course', type: 'button', text: '+ ' + t('addCourse'),
        onclick: function () {
          var c = newCourse();
          sem.courses.push(c);
          var row = courseRow(sem, c);
          list.appendChild(row);
          changed();
          row.querySelector('.c-name').focus();
        }
      })
    ]);
    refs.sems[sem.id] = { gpa: gpaChip, cum: cumChip, meta: meta, card: card };
    return card;
  }

  function newCourse() { return { id: uid('c'), name: '', credits: 3, letter: '', score: '', retake: false }; }
  function newSemester(courses) {
    return { id: uid('s'), name: '', courses: courses || [newCourse(), newCourse(), newCourse()] };
  }

  function renderSemesters() {
    var p = $('panel-semesters');
    p.textContent = '';
    refs = { sems: {}, courses: {} };
    if (!state.semesters.length) {
      p.appendChild(h('div', { class: 'empty' }, [
        h('img', { src: 'assets/logo.svg', width: '64', height: '64', alt: '' }),
        h('h2', { text: t('emptyTitle') }),
        h('p', { text: t('emptyBody') }),
        h('div', { class: 'row' }, [
          h('button', { id: 'btn-start', class: 'btn primary', type: 'button', text: t('startBlank'), onclick: function () { state.semesters.push(newSemester()); changed(true); } }),
          h('button', { id: 'btn-sample', class: 'btn ghost', type: 'button', text: t('loadSample'), onclick: loadSample })
        ])
      ]));
      return;
    }
    p.appendChild(h('div', { class: 'chart-card' }, [h('h2', { class: 'h2', text: t('trend') }), h('div', { id: 'chart', class: 'chart' })]));
    state.semesters.forEach(function (s, i) { p.appendChild(semesterCard(s, i)); });
    p.appendChild(h('button', {
      id: 'btn-add-sem', class: 'btn primary wide', type: 'button', text: '+ ' + t('addSemester'),
      onclick: function () {
        var s = newSemester(); state.semesters.push(s); changed(true);
        var n = document.querySelectorAll('.s-name'); if (n.length) n[n.length - 1].focus();
      }
    }));
  }

  function updateSemesters() {
    state.semesters.forEach(function (sem, si) {
      var r = result.semesters[si], rf = refs.sems[sem.id];
      if (!rf) return;
      rf.gpa.textContent = t('semesterGpa') + ' ' + (r.hasGpa ? g2(r.gpa) : '--');
      rf.cum.textContent = t('cumulative') + ' ' + (r.cumCredits > 0 ? g2(r.cumGpa) : '--');
      rf.meta.textContent = t('courseCount')(sem.courses.length) + ' \u00b7 ' + fmt(r.credits) + ' ' + t('creditsShort');
      sem.courses.forEach(function (c, ci) {
        var info = r.courses[ci], cr = refs.courses[c.id];
        if (!cr) return;
        var txt = '', cls = 'cbadge';
        if (info.status === 'graded') { txt = info.letter + ' \u00b7 ' + fmt(info.points); cls += info.passed || info.superseded ? ' ok' : ' bad'; }
        else if (info.status === 'pass') { txt = 'P'; cls += ' ok'; }
        else if (info.status === 'withdrawn') { txt = 'W'; cls += ' mute'; }
        else { txt = '--'; cls += ' mute'; }
        cr.badge.className = cls; cr.badge.textContent = txt;
        cr.row.classList.toggle('superseded', info.superseded);
        var msg = '';
        if (info.superseded) msg = t('superseded');
        else if (info.capped) msg = t('capped');
        else if (info.status === 'graded' && !info.passed) msg = t('failed');
        else if (info.status === 'incomplete') msg = t('incomplete');
        cr.note.textContent = msg;
        cr.note.hidden = !msg || (info.status === 'incomplete' && !c.name && !c.letter && c.score === '');
      });
    });
  }

  // ---------- chart ----------
  function updateChart() {
    var host = $('chart');
    if (!host) return;
    host.textContent = '';
    var data = result.semesters.map(function (s, i) {
      return { name: state.semesters[i].name || (t('semester') + ' ' + (i + 1)), gpa: s.hasGpa ? s.gpa : null, cum: s.cumCredits > 0 ? s.cumGpa : null };
    });
    if (!data.some(function (d) { return d.gpa !== null; })) {
      host.appendChild(h('p', { class: 'muted', text: t('noGpaYet') }));
      return;
    }
    var max = result.total.max || 4, W = 320, H = 150, padL = 26, padB = 22, padT = 10, padR = 8;
    var iw = W - padL - padR, ih = H - padB - padT;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': t('trend') });
    for (var g = 0; g <= 4; g++) {
      var y = padT + ih - (ih * g) / 4;
      s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'grid' }));
      var lab = svg('text', { x: padL - 4, y: y + 3, class: 'axis', 'text-anchor': 'end' });
      lab.textContent = fmt((max * g) / 4);
      s.appendChild(lab);
    }
    var n = data.length, slot = iw / n, bw = Math.min(34, slot * 0.58), pts = [];
    data.forEach(function (d, i) {
      var cx = padL + slot * i + slot / 2;
      if (d.gpa !== null) {
        var bh = Math.max(2, (ih * d.gpa) / max);
        s.appendChild(svg('rect', { x: cx - bw / 2, y: padT + ih - bh, width: bw, height: bh, rx: 4, class: 'bar' }));
        var v = svg('text', { x: cx, y: padT + ih - bh + 12, class: 'val', 'text-anchor': 'middle' });
        v.textContent = g2(d.gpa);
        s.appendChild(v);
      }
      if (d.cum !== null) pts.push([cx, padT + ih - (ih * d.cum) / max]);
      var xl = svg('text', { x: cx, y: H - 6, class: 'axis', 'text-anchor': 'middle' });
      xl.textContent = String(i + 1);
      s.appendChild(xl);
    });
    if (pts.length) {
      s.appendChild(svg('polyline', { points: pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), class: 'line' }));
      pts.forEach(function (p) { s.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 3, class: 'dot' })); });
    }
    host.appendChild(s);
    host.appendChild(h('div', { class: 'legend' }, [
      h('span', { class: 'lg bar-lg', text: t('trendSem') }), h('span', { class: 'lg line-lg', text: t('trendCum') })
    ]));
  }

  // ---------- planner ----------
  function renderPlanner() {
    var p = $('panel-planner');
    p.textContent = '';
    p.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'h2', text: t('plannerTitle') }),
      h('p', { class: 'muted', text: t('plannerIntro') }),
      h('div', { class: 'grid2' }, [
        h('label', { class: 'f' }, [h('span', { text: t('targetGpa') }), h('input', {
          id: 'pl-target', type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: state.planner.target,
          oninput: function (e) { state.planner.target = e.target.value; save(); updatePlanner(); }
        })]),
        h('label', { class: 'f' }, [h('span', { text: t('nextCredits') }), h('input', {
          id: 'pl-credits', type: 'number', inputmode: 'decimal', step: '0.5', min: '0.5', value: state.planner.credits,
          oninput: function (e) { state.planner.credits = e.target.value; save(); updatePlanner(); }
        })])
      ]),
      h('div', { id: 'pl-out', class: 'result' })
    ]));
    p.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'h2', text: t('whatIf') }),
      h('p', { class: 'muted', text: t('whatIfIntro') }),
      h('label', { class: 'f' }, [h('span', { id: 'wi-label' }), h('input', {
        id: 'wi-range', type: 'range', min: '0', max: String(result.total.max || 4), step: '0.05',
        oninput: function (e) { state.planner.whatIf = parseFloat(e.target.value); save(); updatePlanner(); }
      })]),
      h('div', { id: 'wi-out', class: 'result' })
    ]));
  }

  function updatePlanner() {
    var out = $('pl-out');
    if (!out) return;
    var tt = result.total, max = tt.max || 4;
    out.textContent = '';
    var wo = $('wi-out'); wo.textContent = '';
    var range = $('wi-range');
    if (!tt.hasGpa) {
      out.appendChild(h('p', { class: 'muted', text: t('plannerNoHistory') }));
      wo.appendChild(h('p', { class: 'muted', text: t('plannerNoHistory') }));
      range.disabled = true;
      $('wi-label').textContent = t('whatIfSem');
      return;
    }
    range.disabled = false;
    var plan = Calc.planNeeded(state.planner.target, tt.qualityPoints, tt.credits, state.planner.credits, max);
    if (!plan) out.appendChild(h('p', { class: 'muted', text: t('plannerNeedData') }));
    else if (plan.alreadyMet) out.appendChild(h('p', { class: 'ok-text', text: t('needAlready') }));
    else if (!plan.feasible) out.appendChild(h('p', { class: 'bad-text', text: t('needImpossible')(g2(plan.bestPossible)) }));
    else out.appendChild(h('p', {}, [t('needTitle') + ' ', h('strong', { class: 'big', text: g2(plan.required) }), ' ' + t('needFeasible')]));
    var wi = state.planner.whatIf;
    if (wi === null || isNaN(wi)) wi = tt.gpa;
    wi = Math.min(max, Math.max(0, wi));
    range.max = String(max);
    range.value = String(wi);
    $('wi-label').textContent = t('whatIfSem') + ': ' + g2(wi);
    var proj = Calc.planProjected(wi, tt.qualityPoints, tt.credits, state.planner.credits);
    if (proj === null) wo.appendChild(h('p', { class: 'muted', text: t('plannerNeedData') }));
    else {
      var shown = Calc.roundGpa(proj, state.settings.rounding);
      var d = shown - tt.gpa;
      wo.appendChild(h('p', {}, [t('whatIfResult') + ' ', h('strong', { class: 'big', text: g2(shown) }),
        h('span', { class: 'delta ' + (d >= 0 ? 'up' : 'down'), text: ' ' + t('change') + ' ' + (d >= 0 ? '+' : '') + d.toFixed(2) })]));
    }
  }

  // ---------- scale + settings ----------
  var draft = null; // editable copy of the scale (strings)
  function draftFromScale() { draft = Calc.cleanScale(state.scale).map(function (r) { return { letter: r.letter, min: String(r.min), points: String(r.points) }; }); }

  function renderScale() {
    var p = $('panel-scale');
    p.textContent = '';
    if (!draft) draftFromScale();

    // scale card
    var presetSel = h('select', {
      id: 'preset', 'aria-label': t('preset'),
      onchange: function (e) {
        var id = e.target.value;
        if (id === 'custom') return;
        state.presetId = id;
        state.scale = Calc.clone(Calc.SCALES[id].rows);
        draftFromScale();
        save(); recompute(); renderScale(); renderSemesters(); updateAll();
      }
    }, ['egypt4', 'simple4', 'egypt5', 'custom'].map(function (id) { return h('option', { value: id, text: t('preset_' + id) }); }));
    presetSel.value = state.presetId;

    var errBox = h('div', { id: 'scale-errors', class: 'errors', hidden: true });
    var tbody = h('div', { class: 'srows' });
    function drawRows() {
      tbody.textContent = '';
      draft.forEach(function (r, i) {
        tbody.appendChild(h('div', { class: 'srow' }, [
          h('input', { class: 'sr-letter', type: 'text', maxlength: '4', value: r.letter, 'aria-label': t('letter'), oninput: function (e) { r.letter = e.target.value; edited(); } }),
          h('input', { class: 'sr-min', type: 'number', inputmode: 'decimal', step: '0.5', value: r.min, 'aria-label': t('minScore'), oninput: function (e) { r.min = e.target.value; edited(); } }),
          h('input', { class: 'sr-pts', type: 'number', inputmode: 'decimal', step: '0.1', value: r.points, 'aria-label': t('points'), oninput: function (e) { r.points = e.target.value; edited(); } }),
          h('button', { class: 'icon sr-del', type: 'button', 'aria-label': t('deleteRow'), title: t('deleteRow'), text: '\u00d7', onclick: function () { draft.splice(i, 1); drawRows(); edited(); } })
        ]));
      });
    }
    function edited() {
      var problems = Calc.validateScale(draft);
      errBox.textContent = '';
      if (problems.length) {
        errBox.hidden = false;
        errBox.appendChild(h('strong', { text: t('scaleErrors') }));
        var ul = h('ul');
        problems.forEach(function (c) { ul.appendChild(h('li', { text: t('err_' + c) })); });
        errBox.appendChild(ul);
        return;
      }
      errBox.hidden = true;
      state.scale = Calc.cleanScale(draft);
      state.presetId = 'custom';
      presetSel.value = 'custom';
      save(); recompute();
      renderSemesters(); updateAll(); quickUpdate();
    }
    drawRows();

    var quickOut = h('div', { id: 'quick-out', class: 'quick-out' });
    var quickIn = h('input', { id: 'quick-in', type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '0.1', placeholder: '0-100', 'aria-label': t('quickLabel'), oninput: quickUpdate });
    function quickUpdate() {
      var v = Calc.num(quickIn.value);
      var L = isNaN(v) ? null : Calc.letterFromScore(v, state.scale);
      quickOut.textContent = L ? L + ' \u00b7 ' + fmt(Calc.pointsForLetter(L, state.scale)) + ' ' + t('points') : (quickIn.value === '' ? '' : t('quickNone'));
    }
    quickUpdate();

    p.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'h2', text: t('scaleTitle') }),
      h('p', { class: 'note', text: t('scaleHonest') }),
      h('label', { class: 'f' }, [h('span', { text: t('preset') }), presetSel]),
      h('div', { class: 'shead' }, [h('span', { text: t('letter') }), h('span', { text: t('minScore') }), h('span', { text: t('points') }), h('span')]),
      tbody, errBox,
      h('div', { class: 'row' }, [
        h('button', { id: 'btn-add-row', class: 'btn ghost', type: 'button', text: '+ ' + t('addRow'), onclick: function () { draft.push({ letter: '', min: '', points: '' }); drawRows(); var all = tbody.querySelectorAll('.sr-letter'); all[all.length - 1].focus(); } }),
        h('button', {
          id: 'btn-reset-scale', class: 'btn ghost', type: 'button', text: t('resetScale'),
          onclick: function () {
            var id = Calc.SCALES[state.presetId] ? state.presetId : 'egypt4';
            state.presetId = id; state.scale = Calc.clone(Calc.SCALES[id].rows);
            draftFromScale(); save(); recompute(); renderScale(); renderSemesters(); updateAll();
          }
        })
      ])
    ]));

    p.appendChild(h('div', { class: 'card quick' }, [
      h('h2', { class: 'h2', text: t('quickTitle') }),
      h('div', { class: 'quick-row' }, [h('label', { class: 'f' }, [h('span', { text: t('quickLabel') }), quickIn]), quickOut])
    ]));

    // settings card
    function sel(id, label, value, opts, onchange) {
      var s = h('select', { id: id, onchange: function (e) { onchange(e.target.value); } }, opts.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      s.value = value;
      return h('label', { class: 'f' }, [h('span', { text: label }), s]);
    }
    function numField(id, label, value, step, onchange) {
      return h('label', { class: 'f' }, [h('span', { text: label }), h('input', { id: id, type: 'number', inputmode: 'decimal', step: step, min: '0', value: String(value), oninput: function (e) { onchange(e.target.value); } })]);
    }
    var st = state.settings;
    var honorFields = st.honors.map(function (hh, i) {
      return numField('hon-' + hh.key, t('honors_' + hh.key), hh.min, '0.05', function (v) {
        var n = Calc.num(v); if (isNaN(n)) return; hh.min = n; save(); recompute(); updateAll();
      });
    });
    p.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'h2', text: t('settingsTitle') }),
      h('div', { class: 'grid2' }, [
        sel('set-mode', t('inputMode'), st.inputMode, [['letter', t('modeLetter')], ['score', t('modeScore')]], function (v) { st.inputMode = v; save(); recompute(); renderSemesters(); updateAll(); }),
        sel('set-round', t('rounding'), st.rounding, [['round', t('roundRound')], ['truncate', t('roundTruncate')]], function (v) { st.rounding = v; save(); recompute(); updateAll(); }),
        sel('set-retake', t('retakePolicy'), st.retakePolicy, [['replace', t('retakeReplace')], ['all', t('retakeAll')]], function (v) { st.retakePolicy = v; save(); recompute(); updateAll(); }),
        numField('set-pass', t('passPoints'), st.passPoints, '0.1', function (v) { var n = Calc.num(v); if (isNaN(n)) return; st.passPoints = n; save(); recompute(); updateAll(); }),
        numField('set-cap', t('retakeCap'), st.retakeCap, '0.1', function (v) { var n = Calc.num(v); if (isNaN(n)) n = 0; st.retakeCap = Math.max(0, n); save(); recompute(); updateAll(); })
      ]),
      h('h3', { class: 'h3', text: t('honorsTitle') }),
      h('div', { class: 'grid2' }, honorFields)
    ]));

    // data card
    p.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'h2', text: t('dataTitle') }),
      h('p', { class: 'note', text: t('dataNote') }),
      h('div', { class: 'row wrap' }, [
        h('button', { id: 'btn-export', class: 'btn ghost', type: 'button', text: t('exportJson'), onclick: exportJson }),
        h('button', { id: 'btn-import', class: 'btn ghost', type: 'button', text: t('importJson'), onclick: function () { $('file-input').click(); } }),
        h('button', { id: 'btn-copy', class: 'btn ghost', type: 'button', text: t('copySummary'), onclick: copySummary }),
        h('button', { id: 'btn-print', class: 'btn ghost', type: 'button', text: t('print'), onclick: function () { window.print(); } }),
        h('button', { id: 'btn-sample2', class: 'btn ghost', type: 'button', text: t('loadSample'), onclick: loadSample }),
        h('button', { id: 'btn-clear', class: 'btn danger', type: 'button', text: t('clearAll'), onclick: clearAll })
      ])
    ]));
  }

  // ---------- data actions ----------
  function summaryText() {
    var tt = result.total, L = [];
    L.push(t('summaryHead'));
    L.push(t('summaryGpa') + ': ' + (tt.hasGpa ? g2(tt.gpa) + ' / ' + fmt(tt.max) + ' (' + t('honors_' + tt.honors) + ')' : '--'));
    L.push(t('summaryCredits') + ': ' + fmt(tt.credits) + ' | ' + t('summaryEarned') + ': ' + fmt(tt.earned));
    state.semesters.forEach(function (s, i) {
      var r = result.semesters[i];
      L.push((s.name || (t('semester') + ' ' + (i + 1))) + ': ' + (r.hasGpa ? g2(r.gpa) : '--') + ' (' + fmt(r.credits) + ' ' + t('creditsShort') + ')');
    });
    return L.join('\n');
  }
  function copySummary() {
    var txt = summaryText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast(t('copied')); }, function () { toast(t('copyFailed')); });
    } else {
      var ta = h('textarea', { 'aria-hidden': 'true' }); ta.value = txt; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); toast(ok ? t('copied') : t('copyFailed'));
    }
  }
  function exportJson() {
    var data = { app: 'moaadel', version: 1, exportedAt: new Date().toISOString(), semesters: state.semesters, scale: state.scale, settings: state.settings };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'moaadel-backup.json' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importText(text) {
    var d; try { d = JSON.parse(text); } catch (e) { d = null; }
    var clean = d && d.app === 'moaadel' ? Calc.sanitizeState(d) : null;
    if (!clean) { toast(t('importFailed')); return false; }
    state.semesters = clean.semesters; state.scale = clean.scale; state.settings = clean.settings;
    state.presetId = 'custom';
    ['egypt4', 'simple4', 'egypt5'].forEach(function (id) { if (JSON.stringify(Calc.SCALES[id].rows) === JSON.stringify(state.scale)) state.presetId = id; });
    draft = null; save(); renderAll(); toast(t('imported')); return true;
  }
  function loadSample() {
    var hasData = state.semesters.some(function (s) { return s.courses.length; });
    var go = function () {
      state.settings.inputMode = 'letter';
      state.semesters = I18N[state.lang].sampleSemesters.map(function (s) {
        return { id: uid('s'), name: s.name, courses: s.courses.map(function (c) { return { id: uid('c'), name: c[0], credits: c[1], letter: c[2], score: '', retake: false }; }) };
      });
      state.presetId = 'egypt4'; state.scale = Calc.clone(Calc.SCALES.egypt4.rows); draft = null;
      save(); renderAll(); toast(t('sampleLoaded'));
    };
    if (!hasData) return go();
    ask(t('confirmClear'), t('loadSample')).then(function (ok) { if (ok) go(); });
  }
  function clearAll() {
    ask(t('confirmClear'), t('clearAll')).then(function (ok) {
      if (!ok) return;
      var keep = { lang: state.lang, theme: state.theme };
      state = defaults(); state.lang = keep.lang; state.theme = keep.theme; state.tab = 'semesters';
      draft = null; save(); renderAll(); toast(t('cleared'));
    });
  }

  // ---------- orchestration ----------
  function updateAll() { updateHero(); updateSemesters(); updateChart(); updatePlanner(); }
  function changed(structural) {
    save(); recompute();
    if (structural) { renderSemesters(); }
    updateAll();
  }
  function renderAll() {
    recompute(); renderChrome(); renderSemesters(); renderPlanner(); renderScale(); updateAll();
  }

  $('btn-lang').addEventListener('click', function () { state.lang = state.lang === 'ar' ? 'en' : 'ar'; save(); renderAll(); });
  $('btn-theme').addEventListener('click', function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); renderChrome(); });
  $('file-input').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 2e6) { toast(t('importFailed')); e.target.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () { importText(String(rd.result)); e.target.value = ''; };
    rd.readAsText(f);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('modal').hidden) $('modal-no').click();
  });

  load();
  renderAll();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__moaadel = { importText: importText, state: function () { return state; } };
})();
