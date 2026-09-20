import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import parseRange from 'range-parser';

export async function createSnapshotMiddleware(directory) {
  const root = await fs.realpath(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.document) throw new Error('Incomplete snapshot manifest');
  const origin = new URL(manifest.origin).origin;
  const resourcePaths = new Set(Object.keys(manifest.resources).map(url => new URL(url).pathname));
  const entries = new Map();
  // Resolve once and reject traversal/symlinks outside the snapshot.
  for (const entry of [manifest.document, ...Object.values(manifest.resources)]) {
    const filename = await fs.realpath(path.resolve(root, entry.file));
    if (!filename.startsWith(root + path.sep) || !(await fs.stat(filename)).isFile()) {
      throw new Error('Invalid resource file: ' + entry.file);
    }
    entries.set(entry, {filename,size:(await fs.stat(filename)).size});
  }
  return (req, res, next = () => {res.writeHead(404); res.end('Not captured');}) => {
    let url;
    try {url = new URL(req.url, origin);} catch {res.writeHead(400); res.end(); return;}
    if (url.origin !== origin) {res.writeHead(400); res.end(); return;}
    const documentPath = url.pathname === manifest.document.pathname;
    const isDocument = documentPath && url.search === manifest.document.search;
    const entry = isDocument ? manifest.document : manifest.resources[url.href];
    if (!entry) {
      if (documentPath || resourcePaths.has(url.pathname)) {
        res.writeHead(404); res.end('This query variant was not captured'); return;
      }
      next(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {res.writeHead(405, {Allow: 'GET, HEAD'}); res.end(); return;}
    res.setHeader('Content-Type', entry.type);
    res.setHeader('Cache-Control', 'no-store');
    const {filename,size}=entries.get(entry);let range;
    res.setHeader('Content-Length',size);res.setHeader('Accept-Ranges','bytes');
    if(req.headers.range){
      const ranges=parseRange(size,req.headers.range,{combine:true});
      if(ranges===-1){res.writeHead(416,{'Content-Range':`bytes */${size}`,'Content-Length':0});res.end();return;}
      if(Array.isArray(ranges)&&ranges.type==='bytes'&&ranges.length===1){range=ranges[0];res.statusCode=206;res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${size}`);res.setHeader('Content-Length',range.end-range.start+1);}
    }
    if (req.method === 'HEAD') {res.end(); return;}
    const stream = createReadStream(filename,range);
    stream.on('error', () => {if (!res.headersSent) res.writeHead(500); res.end();});
    stream.pipe(res);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node replay.mjs snapshot-directory [port]');
  const port = Number(process.argv[3] || 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const middleware = await createSnapshotMiddleware(path.resolve(process.argv[2]));
  const server = http.createServer(middleware);
  server.on('error', error => {console.error(error.message); process.exitCode = 1;});
  server.listen(port, '127.0.0.1', () => console.log(`Snapshot server: http://127.0.0.1:${port}`));
}
