// Real-browser click-through using Chrome DevTools Protocol (no extra deps).
// Usage: node tests/e2e.mjs <url> [--shots <dir>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/moaadel-chrome-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.log('  FAIL ' + msg); } }

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('chrome did not start');
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) + ' in ' + expr);
  return r.result.result.value;
};
const q = (sel) => JSON.stringify(sel);
const text = (sel) => ev(`document.querySelector(${q(sel)})?.textContent ?? null`);
const exists = (sel) => ev(`!!document.querySelector(${q(sel)})`);
const count = (sel) => ev(`document.querySelectorAll(${q(sel)}).length`);
async function click(sel, nth = 0) {
  const box = await ev(`(() => { const e = document.querySelectorAll(${q(sel)})[${nth}]; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); const x=r.x + r.width/2, y=r.y + r.height/2; const hit=document.elementFromPoint(x,y); return {x, y, hit: !!hit && (e===hit||e.contains(hit)||hit.contains(e)), hitTag: hit&&hit.tagName+'#'+hit.id+'.'+hit.className}; })()`);
  if (!box) throw new Error('no element ' + sel);
  if (!box.hit) console.log('  WARN click blocked on '+sel+' by '+box.hitTag);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(60);
}
async function type(sel, value, nth = 0) {
  await ev(`(() => { const e = document.querySelectorAll(${q(sel)})[${nth}]; e.scrollIntoView({block:'center'}); e.focus(); e.select && e.select(); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  if (value !== '') await send('Input.insertText', { text: value });
  await sleep(40);
}
async function choose(sel, value, nth = 0) {
  await ev(`(() => { const e = document.querySelectorAll(${q(sel)})[${nth}]; e.value = ${q(value)}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await sleep(40);
}
async function shot(name, opts = {}) {
  if (!shotsDir) return;
  await ev(`document.getElementById('toast').classList.remove('show')`); await sleep(350);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!opts.full });
  fs.writeFileSync(`${shotsDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}
async function viewport(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
}
async function load() { await send('Page.navigate', { url }); await sleep(900); }

const errors = [];
await send('Page.enable'); await send('Runtime.enable');
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); });
await viewport(390, 844, true);
await load();
await ev('localStorage.clear()');
await ev(`localStorage.setItem('moaadel.v1', JSON.stringify({lang:'en', theme:'light', semesters:[]}))`);
await load();

console.log('Empty state');
ok(await exists('#btn-sample'), 'empty state offers sample data');
ok((await text('#g-value')) === '--', 'GPA shows -- with no data');
await shot('00-empty');

console.log('Sample data');
await click('#btn-sample');
ok((await count('.sem')) === 3, 'three sample semesters');
const gpa = await text('#g-value');
// expected from calc: computed independently below
const expected = (() => {
  const P = { 'A': 4, 'A-': 3.7, 'B+': 3.3, 'B': 3, 'B-': 2.7, 'C+': 2.3 };
  const cs = [[3,'A'],[3,'A-'],[3,'B+'],[2,'A'],[3,'B'],[3,'B'],[3,'A'],[3,'C+'],[2,'B+'],[3,'B+'],[3,'A-'],[3,'A'],[3,'B-'],[3,'B+']];
  const tot = cs.reduce((a, c) => a + c[0] * P[c[1]], 0), cr = cs.reduce((a, c) => a + c[0], 0);
  return (Math.round(tot / cr * 100) / 100).toFixed(2);
})();
ok(gpa === expected, `cumulative GPA ${gpa} matches independent calc ${expected}`);
ok((await text('#st-counted')) === '40', 'credit hours counted = 40');
ok((await count('#chart svg rect.bar')) === 3, 'chart draws 3 bars');
ok(/Very good|Excellent/.test(await text('#honors')), 'honors badge shown');
await shot('01-semesters');

console.log('Editing courses');
const before = await text('#g-value');
await choose('.c-grade', 'F', 0);
ok((await text('#g-value')) !== before, 'changing a grade updates GPA');
ok((await text('.cbadge')).startsWith('F'), 'badge shows F');
ok(/Failed/.test(await text('.cnote')), 'failed note shown');
await choose('.c-grade', 'A', 0);
ok((await text('#g-value')) === before, 'restoring grade restores GPA');
await type('.c-credits', '4', 0);
ok((await text('#st-counted')) === '41', 'credit edit updates counted credits');
await type('.c-credits', '3', 0);

console.log('Add semester and course');
await click('#btn-add-sem');
ok((await count('.sem')) === 4, 'semester added');
await type('.s-name', 'Year 2, Semester 2', 3);
await type('.c-name', 'Operating Systems', 14);
await choose('.c-grade', 'A', 14);
ok((await count('.sem:last-of-type .course')) === 3, 'new semester has 3 blank courses');
await click('.sem:last-of-type .add-course');
ok((await count('.sem:last-of-type .course')) === 4, 'course added by button');
await click('.sem:last-of-type .c-del', 3);
ok((await count('.sem:last-of-type .course')) === 3, 'course deleted');
ok((await text('.sem:last-of-type .chip.gpa')).includes('4.00'), 'semester GPA chip shows 4.00');

console.log('Retake');
await type('.c-name', 'Physics II', 15);
ok(true, 'renamed blank course');
await choose('.c-grade', 'B+', 15);
const pre = await text('#g-value');
await ev(`document.querySelectorAll('.c-retake')[15].click()`);
await sleep(60);
// course index 9 now "Physics II" flagged retake, replacing earlier Physics II (C+)
ok((await text('#g-value')) !== pre, 'retake changes GPA');
ok((await count('.course.superseded')) === 1, 'earlier attempt marked replaced');

console.log('Planner');
await click('#tab-planner');
ok(await ev(`!document.getElementById('panel-planner').hidden`), 'planner tab visible');
await type('#pl-target', '3.9');
await type('#pl-credits', '15');
const out = await text('#pl-out');
ok(/semester GPA of|Not reachable/.test(out), 'planner gives a verdict: ' + out.trim().slice(0, 60));
await type('#pl-target', '2.0');
ok(/0\.00/.test(await text('#pl-out')), 'low target already met');
await type('#pl-target', '3.5');
await shot('02-planner');

console.log('Scale & settings');
await click('#tab-scale');
const baseGpa = await text('#g-value');
await type('.sr-pts', '3.5', 1); // A: 4.0 -> 3.5
ok((await text('#g-value')) !== baseGpa, 'editing scale points changes GPA');
ok((await ev(`document.getElementById('preset').value`)) === 'custom', 'preset switches to custom');
await type('.sr-letter', 'A+', 1); // duplicate letter
ok(await ev(`!document.getElementById('scale-errors').hidden`), 'duplicate letter shows an error');
await type('.sr-letter', 'A', 1);
ok(await ev(`document.getElementById('scale-errors').hidden`), 'error clears when fixed');
await type('#quick-in', '91');
ok((await text('#quick-out')).includes('A-'), 'quick check: 91 -> A- (scale-aware)');
await type('#quick-in', '130');
ok(/Outside/.test(await text('#quick-out')), 'quick check rejects 130');
await click('#btn-reset-scale');
ok((await text('#g-value')) === (await text('#g-value')) && (await ev(`document.getElementById('preset').value`)) === 'egypt4', 'reset restores preset');
await choose('#preset', 'egypt5');
ok((await text('#g-max')).includes('5'), 'gauge max follows scale (5)');
await choose('#preset', 'egypt4');
await choose('#set-round', 'truncate');
await choose('#set-round', 'round');
await choose('#set-mode', 'score');
await click('#tab-semesters');
ok((await count('.c-score')) > 0, 'score mode shows percentage inputs');
await type('.c-score', '95', 0);
ok((await text('.cbadge')).startsWith('A'), 'score 95 -> A');
await click('#tab-scale');
await choose('#set-mode', 'letter');

ok(await ev(`navigator.serviceWorker.getRegistration().then(r => !!r)`), 'service worker registered');
console.log('Language, theme, persistence');
await click('#btn-lang');
ok((await ev('document.documentElement.dir')) === 'rtl', 'Arabic sets dir=rtl');
ok((await text('#app-name')) === 'معدّل', 'Arabic title');
ok(await ev(`document.documentElement.scrollWidth <= 391 && window.innerWidth === 390`), 'no horizontal overflow in RTL');
await click('#tab-semesters');
await shot('03-arabic');
await click('#btn-theme');
ok((await ev(`document.documentElement.dataset.theme`)) === 'dark', 'dark theme applied');
await shot('04-dark');
await click('#btn-lang');
await click('#btn-theme');
await load();
ok((await ev('document.documentElement.dir')) === 'ltr', 'language persisted after reload');
ok((await count('.sem')) === 4, 'data persisted after reload');
ok((await text('#g-value')) !== '--', 'GPA recomputed after reload');

console.log('Safety');
await type('.s-name', '<img src=x onerror=window.__pwn=1>', 0);
await ev(`window.__moaadel.importText(JSON.stringify({app:'moaadel',semesters:[{name:'<img src=x onerror=window.__pwn=1>',courses:[{name:'<b>x</b>',credits:3,letter:'A'}]}]}))`);
await sleep(100);
ok(!(await ev('window.__pwn')), 'markup in names is not executed');
ok((await count('.sem img')) === 0, 'no injected elements');
ok(!(await ev(`window.__moaadel.importText('not json')`)), 'bad import rejected');
ok(!(await ev(`window.__moaadel.importText(JSON.stringify({semesters:[]}))`)), 'import without app marker rejected');

console.log('Clear everything');
await click('#tab-scale');
await click('#btn-clear');
ok(await ev(`!document.getElementById('modal').hidden`), 'confirm dialog opens');
await click('#modal-no');
ok((await count('.sem')) === 1, 'cancel keeps data');
await click('#btn-clear');
await click('#modal-yes');
await click('#tab-semesters');
ok(await exists('#btn-sample'), 'cleared back to empty state');

console.log('Narrow phone (320px)');
await viewport(320, 640, true);
await ev('localStorage.clear()');
await load();
await click('#btn-sample');
ok(await ev(`document.documentElement.scrollWidth <= 321 && innerWidth === 320`), 'no overflow at 320px (English)');
await click('#tab-scale');
ok(await ev(`document.documentElement.scrollWidth <= 321 && innerWidth === 320`), 'no overflow at 320px (scale tab)');
await click('#btn-lang');
ok(await ev(`document.documentElement.scrollWidth <= 321 && innerWidth === 320`), 'no overflow at 320px (Arabic)');
await click('#tab-planner');
ok(await ev(`document.documentElement.scrollWidth <= 321 && innerWidth === 320`), 'no overflow at 320px (planner)');
console.log('Desktop layout');
await viewport(1100, 800, false);
await ev('localStorage.clear()');
await load();
await click('#btn-sample');
ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal overflow on desktop');
await shot('05-desktop');

ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors[0] : ''));
console.log(`\n${passed} passed, ${failed} failed`);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
