/* Moaadel core logic. Pure functions, no DOM. Works in browsers and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Typical 4.0 credit-hour scale used by many Egyptian universities.
  // Faculties differ, so every row is editable in the app.
  var SCALES = {
    egypt4: {
      id: 'egypt4',
      rows: [
        { letter: 'A+', min: 97, points: 4.0 },
        { letter: 'A', min: 93, points: 4.0 },
        { letter: 'A-', min: 89, points: 3.7 },
        { letter: 'B+', min: 84, points: 3.3 },
        { letter: 'B', min: 80, points: 3.0 },
        { letter: 'B-', min: 76, points: 2.7 },
        { letter: 'C+', min: 73, points: 2.3 },
        { letter: 'C', min: 70, points: 2.0 },
        { letter: 'C-', min: 67, points: 1.7 },
        { letter: 'D+', min: 64, points: 1.3 },
        { letter: 'D', min: 60, points: 1.0 },
        { letter: 'F', min: 0, points: 0.0 }
      ]
    },
    simple4: {
      id: 'simple4',
      rows: [
        { letter: 'A', min: 90, points: 4.0 },
        { letter: 'B', min: 80, points: 3.0 },
        { letter: 'C', min: 70, points: 2.0 },
        { letter: 'D', min: 60, points: 1.0 },
        { letter: 'F', min: 0, points: 0.0 }
      ]
    },
    egypt5: {
      id: 'egypt5',
      rows: [
        { letter: 'A', min: 85, points: 5.0 },
        { letter: 'B', min: 75, points: 4.0 },
        { letter: 'C', min: 65, points: 3.0 },
        { letter: 'D', min: 50, points: 2.0 },
        { letter: 'F', min: 0, points: 0.0 }
      ]
    }
  };

  var DEFAULT_HONORS = [
    { key: 'excellent', min: 3.5 },
    { key: 'veryGood', min: 3.0 },
    { key: 'good', min: 2.5 },
    { key: 'pass', min: 2.0 }
  ];

  var DEFAULT_SETTINGS = {
    inputMode: 'letter', // 'letter' | 'score'
    passPoints: 1.0, // lowest grade points that still counts as passed
    rounding: 'round', // 'round' | 'truncate'
    retakePolicy: 'replace', // 'replace' | 'all'
    retakeCap: 0, // 0 = no cap, otherwise max grade points for a retake
    honors: DEFAULT_HONORS
  };

  var SPECIAL = ['P', 'W'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function num(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 1632; }).replace(/[\u066B,]/g, '.'));
    return isFinite(n) ? n : NaN;
  }

  function cleanScale(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var letter = String(r.letter == null ? '' : r.letter).trim();
      var min = num(r.min), points = num(r.points);
      if (!letter || isNaN(min) || isNaN(points)) return;
      out.push({ letter: letter, min: min, points: points });
    });
    out.sort(function (a, b) { return b.min - a.min; });
    return out;
  }

  // Returns a list of human-readable problem codes. Empty list means valid.
  function validateScale(rows) {
    var problems = [];
    var list = rows || [];
    if (list.length < 2) problems.push('tooFew');
    var seen = {}, mins = {};
    list.forEach(function (r) {
      var l = String(r.letter == null ? '' : r.letter).trim().toLowerCase();
      var min = num(r.min), pts = num(r.points);
      if (!l || isNaN(min) || isNaN(pts)) problems.push('incomplete');
      if (l && seen[l]) problems.push('dupLetter');
      if (l) seen[l] = true;
      if (!isNaN(min)) {
        if (min < 0 || min > 100) problems.push('range');
        if (mins[min]) problems.push('dupMin');
        mins[min] = true;
      }
      if (!isNaN(pts) && pts < 0) problems.push('negative');
      if (SPECIAL.indexOf(String(r.letter).trim().toUpperCase()) >= 0) problems.push('reserved');
    });
    var cs = cleanScale(list);
    if (cs.length && cs[cs.length - 1].min > 0) problems.push('noZero');
    return problems.filter(function (p, i) { return problems.indexOf(p) === i; });
  }

  function maxPoints(scale) {
    var m = 0;
    cleanScale(scale).forEach(function (r) { if (r.points > m) m = r.points; });
    return m;
  }

  function letterFromScore(score, scale) {
    var s = num(score);
    if (isNaN(s) || s < 0 || s > 100) return null;
    var rows = cleanScale(scale);
    for (var i = 0; i < rows.length; i++) if (s >= rows[i].min) return rows[i].letter;
    return null;
  }

  function pointsForLetter(letter, scale) {
    var rows = cleanScale(scale);
    for (var i = 0; i < rows.length; i++) if (rows[i].letter === letter) return rows[i].points;
    return null;
  }

  function norm(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Resolve a single course into { status, letter, points, credits }
  // status: 'graded' | 'pass' | 'withdrawn' | 'incomplete'
  function resolveCourse(course, scale, settings) {
    var credits = num(course.credits);
    if (isNaN(credits) || credits <= 0) return { status: 'incomplete', credits: 0, letter: null, points: 0 };
    var letter = null;
    if (settings.inputMode === 'score') {
      var raw = course.score;
      if (raw === '' || raw === null || raw === undefined) letter = null;
      else letter = letterFromScore(raw, scale);
    } else {
      letter = course.letter || null;
    }
    if (!letter) return { status: 'incomplete', credits: credits, letter: null, points: 0 };
    if (letter === 'W') return { status: 'withdrawn', credits: credits, letter: 'W', points: 0 };
    if (letter === 'P') return { status: 'pass', credits: credits, letter: 'P', points: 0 };
    var pts = pointsForLetter(letter, scale);
    if (pts === null) return { status: 'incomplete', credits: credits, letter: letter, points: 0 };
    return { status: 'graded', credits: credits, letter: letter, points: pts };
  }

  function roundGpa(v, mode) {
    if (!isFinite(v)) return 0;
    if (mode === 'truncate') return Math.floor(v * 100 + 1e-9) / 100;
    return Math.round((v + 1e-12) * 100) / 100;
  }

  function classify(gpa, honors) {
    var list = (honors || DEFAULT_HONORS).slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < list.length; i++) if (gpa >= list[i].min) return list[i].key;
    return 'below';
  }

  // Main entry. semesters: [{id,name,courses:[{id,name,credits,letter,score,retake}]}]
  function compute(semesters, scale, settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    var sc = cleanScale(scale);
    var passPts = num(settings.passPoints);
    if (isNaN(passPts)) passPts = 1;
    var cap = num(settings.retakeCap);
    var seen = {}; // normalized name -> list of {si, ci}
    var resolved = semesters.map(function (sem) {
      return (sem.courses || []).map(function (c) { return resolveCourse(c, sc, settings); });
    });
    // retake handling: later course flagged as retake supersedes earlier attempts
    var superseded = semesters.map(function (sem) { return (sem.courses || []).map(function () { return false; }); });
    if (settings.retakePolicy === 'replace') {
      semesters.forEach(function (sem, si) {
        (sem.courses || []).forEach(function (c, ci) {
          var key = norm(c.name);
          if (!key) return;
          if (c.retake && seen[key]) {
            seen[key].forEach(function (p) { superseded[p.si][p.ci] = true; });
            seen[key] = [];
          }
          (seen[key] = seen[key] || []).push({ si: si, ci: ci });
        });
      });
    }
    if (cap > 0) {
      semesters.forEach(function (sem, si) {
        (sem.courses || []).forEach(function (c, ci) {
          var r = resolved[si][ci];
          if (c.retake && r.status === 'graded' && r.points > cap) {
            r.points = cap;
            r.capped = true;
          }
        });
      });
    }
    var cumPts = 0, cumCred = 0, cumEarned = 0;
    var perSem = semesters.map(function (sem, si) {
      var pts = 0, cred = 0, earned = 0, courses = [];
      (sem.courses || []).forEach(function (c, ci) {
        var r = resolved[si][ci];
        var info = { status: r.status, letter: r.letter, points: r.points, credits: r.credits, superseded: superseded[si][ci], capped: !!r.capped, passed: false };
        if (!superseded[si][ci]) {
          if (r.status === 'graded') {
            pts += r.points * r.credits;
            cred += r.credits;
            if (r.points >= passPts) { earned += r.credits; info.passed = true; }
          } else if (r.status === 'pass') {
            earned += r.credits;
            info.passed = true;
          }
        }
        courses.push(info);
      });
      cumPts += pts; cumCred += cred; cumEarned += earned;
      var gpaRaw = cred > 0 ? pts / cred : 0;
      var cgpaRaw = cumCred > 0 ? cumPts / cumCred : 0;
      return {
        courses: courses,
        qualityPoints: pts, credits: cred, earned: earned,
        gpa: roundGpa(gpaRaw, settings.rounding), hasGpa: cred > 0,
        cumGpa: roundGpa(cgpaRaw, settings.rounding), cumCredits: cumCred
      };
    });
    var cg = cumCred > 0 ? cumPts / cumCred : 0;
    var gpa = roundGpa(cg, settings.rounding);
    return {
      semesters: perSem,
      total: {
        qualityPoints: cumPts, credits: cumCred, earned: cumEarned,
        gpa: gpa, hasGpa: cumCred > 0,
        honors: cumCred > 0 ? classify(gpa, settings.honors) : null,
        max: maxPoints(sc)
      }
    };
  }

  // GPA needed next term to reach a target cumulative GPA.
  function planNeeded(target, qualityPoints, credits, nextCredits, max) {
    target = num(target); nextCredits = num(nextCredits);
    if (isNaN(target) || isNaN(nextCredits) || nextCredits <= 0) return null;
    var needed = (target * (credits + nextCredits) - qualityPoints) / nextCredits;
    var needClamped = Math.max(0, needed);
    return {
      needed: needed,
      required: needClamped,
      feasible: needed <= max + 1e-9,
      alreadyMet: needed <= 0,
      bestPossible: (qualityPoints + max * nextCredits) / (credits + nextCredits)
    };
  }

  // Cumulative GPA if next term finishes at a given GPA.
  function planProjected(semGpa, qualityPoints, credits, nextCredits) {
    semGpa = num(semGpa); nextCredits = num(nextCredits);
    if (isNaN(semGpa) || isNaN(nextCredits) || nextCredits <= 0) return null;
    return (qualityPoints + semGpa * nextCredits) / (credits + nextCredits);
  }

  // Validate and normalize imported data. Returns null when unusable.
  function sanitizeState(data) {
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.semesters)) return null;
    var uid = 0;
    function id() { uid += 1; return 'i' + Date.now().toString(36) + uid; }
    var sems = data.semesters.slice(0, 40).map(function (s) {
      return {
        id: id(),
        name: String(s && s.name != null ? s.name : '').slice(0, 60),
        courses: (Array.isArray(s && s.courses) ? s.courses : []).slice(0, 40).map(function (c) {
          var credits = num(c && c.credits);
          var score = num(c && c.score);
          return {
            id: id(),
            name: String(c && c.name != null ? c.name : '').slice(0, 80),
            credits: isNaN(credits) || credits < 0 ? 3 : Math.min(credits, 30),
            letter: c && typeof c.letter === 'string' ? c.letter.slice(0, 6) : '',
            score: isNaN(score) ? '' : Math.min(Math.max(score, 0), 100),
            retake: !!(c && c.retake)
          };
        })
      };
    });
    var scale = Array.isArray(data.scale) ? cleanScale(data.scale) : clone(SCALES.egypt4.rows);
    if (validateScale(scale).length) scale = clone(SCALES.egypt4.rows);
    var st = Object.assign({}, DEFAULT_SETTINGS, data.settings && typeof data.settings === 'object' ? data.settings : {});
    st.inputMode = st.inputMode === 'score' ? 'score' : 'letter';
    st.rounding = st.rounding === 'truncate' ? 'truncate' : 'round';
    st.retakePolicy = st.retakePolicy === 'all' ? 'all' : 'replace';
    var pp = num(st.passPoints); st.passPoints = isNaN(pp) ? 1 : pp;
    var rc = num(st.retakeCap); st.retakeCap = isNaN(rc) || rc < 0 ? 0 : rc;
    if (!Array.isArray(st.honors) || st.honors.length !== 4) st.honors = clone(DEFAULT_HONORS);
    st.honors = st.honors.map(function (h, i) {
      var m = num(h && h.min);
      return { key: DEFAULT_HONORS[i].key, min: isNaN(m) ? DEFAULT_HONORS[i].min : m };
    });
    return { semesters: sems, scale: scale, settings: st };
  }

  return {
    SCALES: SCALES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, DEFAULT_HONORS: DEFAULT_HONORS, SPECIAL: SPECIAL,
    num: num, cleanScale: cleanScale, validateScale: validateScale, maxPoints: maxPoints,
    letterFromScore: letterFromScore, pointsForLetter: pointsForLetter, resolveCourse: resolveCourse,
    roundGpa: roundGpa, classify: classify, compute: compute, planNeeded: planNeeded,
    planProjected: planProjected, sanitizeState: sanitizeState, clone: clone
  };
});
