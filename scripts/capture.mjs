import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node capture.mjs capture-config.json');
const configPath = path.resolve(process.argv[2]);
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const source = new URL(config.url);
if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
  throw new Error('Use a public HTTP(S) URL without credentials');
}
if (!config.out || !Array.isArray(config.resourcePrefixes) || !config.resourcePrefixes.length) {
  throw new Error('out and nonempty resourcePrefixes are required');
}
for (const key of ['resourcePrefixes', 'rawBytePrefixes', 'blockedPrefixes']) {
  if (config[key] !== undefined && (!Array.isArray(config[key]) ||
      config[key].some(value => typeof value !== 'string' || !value.startsWith('/')))) {
    throw new Error(`${key} must contain pathname prefixes`);
  }
}
const out = path.resolve(path.dirname(configPath), config.out);
await fs.mkdir(out, {recursive: true});
if ((await fs.readdir(out)).length) throw new Error('Output must be empty: ' + out);
await fs.mkdir(path.join(out, 'assets'));
await fs.mkdir(path.join(out, 'evidence'));
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({
  viewport: config.viewport || {width: 1440, height: 1000}, serviceWorkers: 'block',
});
const page = await context.newPage();
const pending = new Set(), inFlight = new Set();
const resources = {}, failures = [], pageErrors = [];
const matches = (pathname, prefixes = []) => prefixes.some(prefix => pathname.startsWith(prefix));
const report = {capturedAt: new Date().toISOString(), source: source.href, failures, pageErrors, externalRequests: []};
const manifest = {version: 1, origin: source.origin, document: null, resources};
page.on('pageerror', e => pageErrors.push(e.message));
page.on('requestfailed', request => {
  const url = new URL(request.url());
  if (url.origin === source.origin && matches(url.pathname, config.resourcePrefixes) &&
      !matches(url.pathname, config.blockedPrefixes)) {
    failures.push({url: url.href, error: request.failure()?.errorText || 'Request failed'});
  }
});
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === source.origin && matches(url.pathname, config.blockedPrefixes)) return route.abort();
  return route.continue();
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.origin !== source.origin) report.externalRequests.push({url: url.href, method: response.request().method(), status: response.status(), captured: false});
  if (url.origin !== source.origin || !matches(url.pathname, config.resourcePrefixes) ||
      matches(url.pathname, config.blockedPrefixes) || response.request().method() !== 'GET' ||
      response.request().resourceType() === 'document') return;
  if (response.status() >= 400) {
    failures.push({url: url.href, status: response.status()}); return;
  }
  if (response.status() !== 200 || resources[url.href] || inFlight.has(url.href)) return;
  inFlight.add(url.href);
  const task = (async () => {
    let bytes;
    if (matches(url.pathname, config.rawBytePrefixes)) {
      // Use an anonymous byte-preserving channel only for observed public GET resources.
      const raw = await fetch(url.href, {redirect: 'error', signal: AbortSignal.timeout(30000)});
      if (!raw.ok) throw new Error('Raw byte fetch HTTP ' + raw.status);
      const originalTag = response.headers().etag, rawTag = raw.headers.get('etag');
      if (originalTag && rawTag && originalTag !== rawTag) throw new Error('Resource version changed during capture');
      bytes = Buffer.from(await raw.arrayBuffer());
    } else bytes = await response.body();
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const file = `assets/${digest}.bin`;
    await fs.writeFile(path.join(out, file), bytes);
    resources[url.href] = {file, type: response.headers()['content-type'] || 'application/octet-stream', sha256: digest, bytes: bytes.length};
  })().catch(error => failures.push({url: url.href, error: error.message}));
  pending.add(task);
  task.finally(() => {pending.delete(task); inFlight.delete(url.href);});
});
try {
  const response = await page.goto(source.href, {waitUntil: 'domcontentloaded', timeout: 60000});
  if (!response?.ok()) throw new Error('Document HTTP ' + response?.status());
  const final = new URL(page.url());
  if (final.origin !== source.origin) throw new Error('Cross-origin redirect requires a revised capture scope');
  report.finalUrl = final.href;
  manifest.document = {pathname: final.pathname, search: final.search, file: 'index.html', type: 'text/html; charset=utf-8'};
  const html = await response.body();
  manifest.document.sha256 = crypto.createHash('sha256').update(html).digest('hex');
  manifest.document.bytes = html.length;
  await fs.writeFile(path.join(out, 'source.html'), html);
  await fs.writeFile(path.join(out, 'index.html'), html);
  if (config.scenario) {
    const scenario = await import(pathToFileURL(path.resolve(path.dirname(configPath), config.scenario)));
    await scenario.default(page);
  }
  await page.waitForTimeout(config.settleMs ?? 1500);
  report.finalStateUrl = page.url();
  await page.screenshot({path: path.join(out, 'evidence/captured.png'), fullPage: true});
  await fs.writeFile(path.join(out, 'evidence/dom.txt'), await page.locator('body').ariaSnapshot());
} catch (error) {
  failures.push({stage: 'document-or-scenario', error: error.message});
} finally {
  page.removeAllListeners('response');
  await Promise.allSettled([...pending]);
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(out, 'capture-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({out, resources: Object.keys(resources).length, failures, pageErrors}, null, 2));
if (failures.length || pageErrors.length) process.exitCode = 1;
