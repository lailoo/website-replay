import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createSnapshotMiddleware} from './replay.mjs';

const exec = promisify(execFile);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-skill-'));
const bytes = Buffer.from([0, 255, 128, 195, 40, 13, 10, 1]);
const script = `document.querySelector('button').onclick=()=>document.querySelector('output').textContent=Number(document.querySelector('output').textContent)+1;fetch('/data/raw.txt?v=1').then(r=>r.arrayBuffer()).then(b=>document.body.dataset.bytes=b.byteLength);`;
const source = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://fixture').pathname;
  if (pathname === '/page') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><title>Snapshot fixture</title><link rel="stylesheet" href="/assets/style.css?v=1"></head><body><button>Increment</button><output>0</output><script src="/assets/app.js?v=1"></script></body></html>');
  } else if (req.url === '/assets/style.css?v=1') {
    res.setHeader('Content-Type', 'text/css'); res.end('button{color:rgb(255,0,0)}');
  } else if (req.url === '/assets/app.js?v=1') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(script);
  } else if (req.url === '/data/raw.txt?v=1') {
    res.setHeader('Content-Type', 'text/plain'); res.end(bytes);
  } else {res.writeHead(404); res.end();}
});
let replay, browser;
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const close = server => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
  server.closeAllConnections();
});
try {
  const origin = await listen(source);
  const config = {url: origin + '/page?tab=one', out: './snapshot', resourcePrefixes: ['/assets/', '/data/'], rawBytePrefixes: ['/data/'], settleMs: 500};
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  const capturePath = fileURLToPath(new URL('./capture.mjs', import.meta.url));
  await exec(process.execPath, [capturePath, path.join(dir, 'config.json')], {cwd: process.cwd()});
  const root = path.join(dir, 'snapshot');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json')));
  assert.equal(Object.keys(manifest.resources).length, 3);
  const raw = manifest.resources[origin + '/data/raw.txt?v=1'];
  assert.deepEqual(await fs.readFile(path.join(root, raw.file)), bytes);
  await assert.rejects(exec(process.execPath, [capturePath, path.join(dir, 'config.json')]), /Output must be empty/);
  replay = http.createServer(await createSnapshotMiddleware(root));
  const local = await listen(replay);
  await close(source);
  assert.equal((await fetch(local + '/assets/app.js?v=2')).status, 404);
  assert.equal((await fetch(local + '/page?tab=unknown')).status, 404);
  assert.equal((await fetch(local + '/assets/style.css?v=1')).headers.get('content-type'), 'text/css');
  assert.equal((await fetch(local + '/page?tab=one', {method: 'POST'})).status, 405);
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const {chromium} = require('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext({serviceWorkers: 'block'});
  const remote = [], errors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === local) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(local + '/page?tab=one');
  await page.waitForFunction(() => document.body.dataset.bytes === '8');
  await page.getByRole('button', {name: 'Increment'}).click();
  assert.equal(await page.locator('output').innerText(), '1');
  assert.equal(await page.locator('button').evaluate(el => getComputedStyle(el).color), 'rgb(255, 0, 0)');
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  manifest.resources[origin + '/assets/app.js?v=1'].file = '../config.json';
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(createSnapshotMiddleware(root), /Invalid resource file/);
  console.log('PASS: capture, byte integrity, overwrite refusal, query isolation, MIME, method checks, offline CSS/JS/data interaction, path containment.');
} finally {
  if (browser) await browser.close();
  if (replay?.listening) await close(replay);
  if (source.listening) await close(source);
  await fs.rm(dir, {recursive: true, force: true});
}
