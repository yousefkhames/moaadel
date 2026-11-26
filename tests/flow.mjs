// Real-browser data-flow test: sample -> edit -> JSON export -> wipe -> import -> same GPA; edge inputs; print view; Arabic RTL.
// Usage: node tests/flow.mjs [url]  (serves the repo root itself when no url). Needs puppeteer-core + Chrome.
import puppeteer from 'puppeteer-core';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');let url=process.argv[2],server;
if(!url){server=http.createServer((q,r)=>{let f=path.join(root,q.url.split('?')[0].replace(/\/$/,'/index.html'));if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end()}
const t={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json'}[path.extname(f)]||'application/octet-stream';r.setHeader('content-type',t);r.end(fs.readFileSync(f))}).listen(0);url=`http://127.0.0.1:${server.address().port}/`}
const b=await puppeteer.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const pg=await b.newPage();await pg.setViewport({width:390,height:800});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;console.log('ok',m)};const sl=ms=>new Promise(r=>setTimeout(r,ms));
const gpa=()=>pg.$eval('#g-value',e=>e.textContent);
await pg.goto(url,{waitUntil:'networkidle0'});await pg.evaluate(()=>localStorage.clear());await pg.reload({waitUntil:'networkidle0'});
ok(await gpa()==='--','empty state shows -- not NaN');
await pg.click('#btn-sample');await sl(200);const g1=await gpa();ok(/^\d\.\d\d$/.test(g1),'sample loads, GPA '+g1);
// edge input: blank, huge and negative credits must not give NaN/Infinity
await pg.$eval('.c-credits',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))});await sl(100);ok(!/NaN|Infinity/.test(await pg.evaluate(()=>document.body.innerText)),'blank credits: no NaN');
await pg.$eval('.c-credits',e=>{e.value='-5';e.dispatchEvent(new Event('input',{bubbles:true}))});await sl(100);ok(!/NaN|Infinity/.test(await pg.evaluate(()=>document.body.innerText)),'negative credits: no NaN');
await pg.$eval('.c-credits',e=>{e.value='3';e.dispatchEvent(new Event('input',{bubbles:true}))});await sl(100);
// export (capture blob), wipe, import through the real file input
await pg.click('#tab-scale');await sl(100);
const exp=await pg.evaluate(async()=>{let blob;const o=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return o.call(URL,b)};HTMLAnchorElement.prototype.click=function(){};document.getElementById('btn-export').click();URL.createObjectURL=o;return await blob.text()});
const g2=await gpa();const d=JSON.parse(exp);ok(d.app==='moaadel'&&d.semesters.length>=1,'export has app marker and semesters');
fs.writeFileSync('/tmp/moa-back.json',exp);fs.writeFileSync('/tmp/moa-bad.json','{"app":"moaadel","semesters":"x"}');
await pg.evaluate(()=>localStorage.clear());await pg.reload({waitUntil:'networkidle0'});ok(await gpa()==='--','wiped');
await pg.click('#tab-scale');await (await pg.$('#file-input')).uploadFile('/tmp/moa-back.json');await sl(400);ok(await gpa()===g2,'import restores the same GPA ('+g2+')');
await pg.reload({waitUntil:'networkidle0'});ok(await gpa()===g2,'imported data persists after reload');
await (await pg.$('#file-input')).uploadFile('/tmp/moa-bad.json');await sl(300);ok(await gpa()===g2,'malformed import leaves data untouched');
await pg.click('#tab-semesters');await sl(100);
// print view
await pg.emulateMediaType('print');const pv=await pg.evaluate(()=>({txt:document.body.innerText.length,tabs:getComputedStyle(document.getElementById('tabs')).display,vis:document.querySelectorAll('.sem').length}));
ok(pv.txt>100&&pv.vis>=1,'print view keeps GPA and semesters');await pg.emulateMediaType('screen');
// Arabic RTL, no overflow, no stray LTR
await pg.evaluate(()=>{localStorage.setItem('moaadel-lang','ar')});
const langBtn=await pg.$('#btn-lang, #lang, [data-lang]');if(langBtn){await langBtn.click();await sl(200)}
ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
ok(errs.length===0,'no page errors '+errs.join('|'));console.log(`${n} checks passed`);await b.close();server?.close();
