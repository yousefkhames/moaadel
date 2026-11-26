'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const scale = C.SCALES.egypt4.rows;
const S = (courses, name) => ({ id: name || 's', name: name || 's', courses });
const crs = (name, credits, letter, extra) => Object.assign({ name, credits, letter, score: '', retake: false }, extra || {});

test('letter from score uses thresholds', () => {
  assert.equal(C.letterFromScore(100, scale), 'A+');
  assert.equal(C.letterFromScore(97, scale), 'A+');
  assert.equal(C.letterFromScore(96.9, scale), 'A');
  assert.equal(C.letterFromScore(60, scale), 'D');
  assert.equal(C.letterFromScore(59.9, scale), 'F');
  assert.equal(C.letterFromScore(0, scale), 'F');
  assert.equal(C.letterFromScore(101, scale), null);
  assert.equal(C.letterFromScore('', scale), null);
  assert.equal(C.letterFromScore('abc', scale), null);
});

test('letter from score works with an unsorted scale', () => {
  const shuffled = [scale[5], scale[0], scale[11], scale[3]];
  assert.equal(C.letterFromScore(90, shuffled), 'B+');
  assert.equal(C.letterFromScore(98, shuffled), 'A+');
  assert.equal(C.letterFromScore(10, shuffled), 'F');
});

test('semester GPA is credit weighted', () => {
  const r = C.compute([S([crs('A', 3, 'A'), crs('B', 2, 'B'), crs('C', 1, 'C')])], scale, {});
  // (4*3 + 3*2 + 2*1) / 6 = 20/6
  assert.equal(r.semesters[0].gpa, 3.33);
  assert.equal(r.total.gpa, 3.33);
  assert.equal(r.total.credits, 6);
  assert.equal(r.total.earned, 6);
});

test('cumulative GPA spans semesters and per-semester cumulative is tracked', () => {
  const r = C.compute([
    S([crs('x', 3, 'A'), crs('y', 3, 'A-')]),
    S([crs('z', 4, 'C'), crs('w', 2, 'F')])
  ], scale, {});
  assert.equal(r.semesters[0].gpa, 3.85);
  assert.equal(r.semesters[1].gpa, 1.33);
  assert.equal(r.total.gpa, Math.round(((4 * 3 + 3.7 * 3 + 2 * 4) / 12) * 100) / 100);
  assert.equal(r.semesters[0].cumGpa, 3.85);
  assert.equal(r.semesters[1].cumGpa, r.total.gpa);
  assert.equal(r.total.earned, 10); // F credits not earned
});

test('incomplete courses are ignored, not counted as zero', () => {
  const r = C.compute([S([crs('a', 3, 'A'), crs('b', 3, ''), crs('c', 0, 'A'), crs('d', '', 'B')])], scale, {});
  assert.equal(r.total.gpa, 4);
  assert.equal(r.total.credits, 3);
});

test('W is excluded and P earns credit without touching GPA', () => {
  const r = C.compute([S([crs('a', 3, 'B'), crs('b', 3, 'W'), crs('c', 2, 'P')])], scale, {});
  assert.equal(r.total.gpa, 3);
  assert.equal(r.total.credits, 3);
  assert.equal(r.total.earned, 5);
});

test('score input mode derives the letter', () => {
  const r = C.compute([S([
    crs('a', 3, '', { score: 91 }), crs('b', 3, '', { score: 55 }), crs('c', 3, '', { score: '' })
  ])], scale, { inputMode: 'score' });
  assert.equal(r.semesters[0].courses[0].letter, 'A-');
  assert.equal(r.semesters[0].courses[1].letter, 'F');
  assert.equal(r.semesters[0].courses[2].status, 'incomplete');
  assert.equal(r.total.gpa, 1.85);
});

test('retake replaces earlier attempt by default', () => {
  const sems = [
    S([crs('Calculus', 3, 'F'), crs('Physics', 3, 'A')], 'one'),
    S([crs('  calculus ', 3, 'B', { retake: true })], 'two')
  ];
  const r = C.compute(sems, scale, {});
  assert.equal(r.semesters[0].courses[0].superseded, true);
  assert.equal(r.total.gpa, 3.5);
  assert.equal(r.total.credits, 6);
  assert.equal(r.total.earned, 6);
});

test('retake policy "all" counts every attempt', () => {
  const sems = [S([crs('Calculus', 3, 'F')]), S([crs('Calculus', 3, 'B', { retake: true })])];
  const r = C.compute(sems, scale, { retakePolicy: 'all' });
  assert.equal(r.total.gpa, 1.5);
  assert.equal(r.total.credits, 6);
});

test('retake without an earlier attempt just counts once', () => {
  const r = C.compute([S([crs('Only', 3, 'B', { retake: true })])], scale, {});
  assert.equal(r.total.gpa, 3);
  assert.equal(r.total.credits, 3);
});

test('retake cap limits grade points', () => {
  const sems = [S([crs('Math', 3, 'F')]), S([crs('Math', 3, 'A', { retake: true })])];
  const r = C.compute(sems, scale, { retakeCap: 2.0 });
  assert.equal(r.total.gpa, 2);
  assert.equal(r.semesters[1].courses[0].capped, true);
});

test('pass threshold is configurable', () => {
  const sems = [S([crs('a', 3, 'D'), crs('b', 3, 'A')])];
  assert.equal(C.compute(sems, scale, { passPoints: 1 }).total.earned, 6);
  assert.equal(C.compute(sems, scale, { passPoints: 2 }).total.earned, 3);
});

test('rounding mode: round vs truncate', () => {
  const sems = [S([crs('a', 3, 'A'), crs('b', 2, 'B'), crs('c', 1, 'C')])];
  assert.equal(C.compute(sems, scale, { rounding: 'round' }).total.gpa, 3.33);
  const sems2 = [S([crs('a', 3, 'A'), crs('b', 3, 'A-'), crs('c', 1, 'B+'), crs('d', 2, 'C')])];
  // raw = (12+11.1+3.3+4)/9 = 3.3777..
  assert.equal(C.compute(sems2, scale, { rounding: 'round' }).total.gpa, 3.38);
  assert.equal(C.compute(sems2, scale, { rounding: 'truncate' }).total.gpa, 3.37);
});

test('honors classification and boundaries', () => {
  const h = C.DEFAULT_HONORS;
  assert.equal(C.classify(3.5, h), 'excellent');
  assert.equal(C.classify(3.49, h), 'veryGood');
  assert.equal(C.classify(3.0, h), 'veryGood');
  assert.equal(C.classify(2.5, h), 'good');
  assert.equal(C.classify(2.0, h), 'pass');
  assert.equal(C.classify(1.99, h), 'below');
});

test('empty data gives no GPA and no honors', () => {
  const r = C.compute([], scale, {});
  assert.equal(r.total.hasGpa, false);
  assert.equal(r.total.honors, null);
  assert.equal(r.total.gpa, 0);
});

test('custom scale changes results', () => {
  const r = C.compute([S([crs('a', 3, 'A')])], C.SCALES.egypt5.rows, {});
  assert.equal(r.total.gpa, 5);
  assert.equal(r.total.max, 5);
});

test('scale validation catches the common mistakes', () => {
  assert.deepEqual(C.validateScale(C.SCALES.egypt4.rows), []);
  assert.ok(C.validateScale([{ letter: 'A', min: 90, points: 4 }, { letter: 'B', min: 80, points: 3 }]).includes('noZero'));
  assert.ok(C.validateScale([{ letter: 'A', min: 90, points: 4 }, { letter: 'a', min: 0, points: 0 }]).includes('dupLetter'));
  assert.ok(C.validateScale([{ letter: 'A', min: 0, points: 4 }, { letter: 'B', min: 0, points: 3 }]).includes('dupMin'));
  assert.ok(C.validateScale([{ letter: 'A', min: 120, points: 4 }, { letter: 'B', min: 0, points: 3 }]).includes('range'));
  assert.ok(C.validateScale([{ letter: 'P', min: 50, points: 4 }, { letter: 'B', min: 0, points: 3 }]).includes('reserved'));
  assert.ok(C.validateScale([{ letter: '', min: 50, points: 4 }, { letter: 'B', min: 0, points: 3 }]).includes('incomplete'));
  assert.ok(C.validateScale([{ letter: 'A', min: 0, points: 4 }]).includes('tooFew'));
});

test('planner: required GPA for a target', () => {
  // 60 credits at 3.0 = 180 points. Target 3.2 with 15 more credits: (3.2*75-180)/15 = 4.0
  const p = C.planNeeded(3.2, 180, 60, 15, 4);
  assert.ok(Math.abs(p.needed - 4.0) < 1e-9);
  assert.equal(p.feasible, true);
  const q = C.planNeeded(3.3, 180, 60, 15, 4);
  assert.equal(q.feasible, false);
  assert.ok(q.bestPossible < 3.3);
  const r = C.planNeeded(2.0, 180, 60, 15, 4);
  assert.equal(r.alreadyMet, true);
  assert.equal(r.required, 0);
  assert.equal(C.planNeeded('', 180, 60, 15, 4), null);
  assert.equal(C.planNeeded(3, 180, 60, 0, 4), null);
});

test('planner: projected cumulative GPA', () => {
  const v = C.planProjected(4, 180, 60, 15);
  assert.ok(Math.abs(v - (180 + 60) / 75) < 1e-9);
  assert.equal(C.planProjected('x', 180, 60, 15), null);
});

test('sanitizeState repairs and bounds imported data', () => {
  assert.equal(C.sanitizeState(null), null);
  assert.equal(C.sanitizeState({ semesters: 'x' }), null);
  const s = C.sanitizeState({
    semesters: [{ name: 'S1', courses: [{ name: 'X', credits: -4, letter: 'A', score: 500 }, null] }],
    scale: [{ letter: 'A', min: 90, points: 4 }],
    settings: { inputMode: 'weird', rounding: 'truncate', honors: [1] }
  });
  assert.equal(s.semesters[0].courses[0].credits, 3);
  assert.equal(s.semesters[0].courses[0].score, 100);
  assert.equal(s.semesters[0].courses.length, 2);
  assert.deepEqual(s.scale, C.SCALES.egypt4.rows); // invalid scale falls back
  assert.equal(s.settings.inputMode, 'letter');
  assert.equal(s.settings.rounding, 'truncate');
  assert.equal(s.settings.honors.length, 4);
});

test('names with markup stay plain data', () => {
  const s = C.sanitizeState({ semesters: [{ name: '<img src=x onerror=1>', courses: [] }] });
  assert.equal(s.semesters[0].name, '<img src=x onerror=1>');
});

test('decimal comma input is accepted', () => {
  assert.equal(C.num('2,5'), 2.5);
  assert.ok(isNaN(C.num('')));
});
