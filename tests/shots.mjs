// Generates the README screenshots from clean sample data.
// Usage: node tests/shots.mjs <url> --shots <dir>
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
  if (!box.hit) console.log('  WARN click blocked on '+sel+' by '+box.hitTag);
  void 0;
  if (!box) throw new Error('no element ' + sel);
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

await send('Page.enable');
const scrollTo = (y) => ev(`window.scrollTo(0, ${y})`);
async function shotClean(n) { await ev(`document.activeElement && document.activeElement.blur()`); await shot(n); }
async function fresh(lang, theme, w, h, mobile) {
  await viewport(w, h, mobile);
  await send('Page.navigate', { url }); await sleep(800);
  await ev(`localStorage.clear(); localStorage.setItem('moaadel.v1', JSON.stringify({lang:'${lang}', theme:'${theme}', semesters:[]}))`);
  await send('Page.navigate', { url }); await sleep(800);
  await click('#btn-sample');
  await sleep(300);
}
await fresh('en', 'light', 390, 844, true);
await shot('mobile-en-home');
await scrollTo(await ev(`document.querySelector('.sem').getBoundingClientRect().top + scrollY - 70`)); await shot('mobile-en-courses');
await click('#tab-planner');
await type('#pl-target', '3.6'); await type('#pl-credits', '15');
await ev(`document.getElementById('wi-range').value = 3.8; document.getElementById('wi-range').dispatchEvent(new Event('input', {bubbles:true}))`);
await scrollTo(await ev(`document.getElementById('tabs').offsetTop - 10`)); await shotClean('mobile-en-planner');
await click('#tab-scale');
await scrollTo(await ev(`document.getElementById('tabs').offsetTop - 10`)); await shot('mobile-en-scale');
await fresh('ar', 'light', 390, 844, true);
await shot('mobile-ar-home');
await fresh('en', 'dark', 1100, 760, false);
await shot('desktop-dark');
ws.close(); chrome.kill(); process.exit(0);
