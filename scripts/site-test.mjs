import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {read,write,serve,close} from './site-lib.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'clone-site-test-'));
const source=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(['/','/details'].includes(url.pathname)){
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><title>Independent fixture ${url.pathname}</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"></head><body><h1>${url.pathname==='/'?'Overview':'Details'}</h1><a href="${url.pathname==='/'?'/details':'/'}">Other page</a><a href="/logout">Logout</a><a href="/details?mode=compact">Compact</a><button>Increment</button><output>0</output><img alt="Sample" width="8" height="8" src="/sample.svg"><script src="/app.js"></script></body></html>`);
  }else if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end('body{font:16px sans-serif;color:#123}');}
  else if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end('document.querySelector("button").onclick=()=>document.querySelector("output").textContent=+document.querySelector("output").textContent+1;');}
  else if(url.pathname==='/sample.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');}
  else{res.writeHead(404);res.end();}
});
await new Promise(r=>source.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${source.address().port}`,config=path.join(temp,'config.json'),out=path.join(temp,'out');
const scenario=fileURLToPath(new URL('../examples/scenario.mjs',import.meta.url));
await write(config,{url:origin,out,resourcePrefixes:['/'],maxPages:10,startUrls:[origin+'/details?mode=compact'],scenarios:{'/':scenario,'/details':scenario,'/details?mode=compact':scenario},settleMs:150,delayMs:0});
const cli=fileURLToPath(new URL('./site.mjs',import.meta.url));
const run=command=>promisify(execFile)(process.execPath,[cli,command,config],{maxBuffer:1024*1024});
let local;
try{
  await run('discover');let inventory=await read(path.join(out,'inventory.json'));
  assert.equal(inventory.items.length,3);assert.equal(new Set(inventory.items.map(r=>r.pageId)).size,2);
  assert.ok(inventory.items.every(r=>!r.url.includes('/logout')));
  assert.ok(inventory.items.find(r=>r.url===origin+'/details').entry.from);
  await run('capture');inventory=await read(path.join(out,'inventory.json'));
  assert.ok(inventory.items.every(r=>r.capture==='captured'));
  const directories=inventory.items.map(r=>r.directory);await run('capture');assert.deepEqual((await read(path.join(out,'inventory.json'))).items.map(r=>r.directory),directories);
  await close(source);
  await run('verify');inventory=await read(path.join(out,'inventory.json'));
  assert.ok(inventory.items.every(r=>r.verification.status==='passed'&&r.verification.scenario&&r.verification.visual.changedPixels===0));
  local=await serve(inventory,out);
  const range=await fetch(local.base+'/app.js',{headers:{Range:'bytes=0-9'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,10);
  assert.equal((await fetch(local.base+'/details?mode=missing')).status,404);
  assert.equal((await fetch(local.base+'/api/missing')).status,501);
  await close(local.server);local=null;
  const row=inventory.items[0],manifest=await read(path.join(out,row.directory,'manifest.json'));
  const resource=Object.values(manifest.resources)[0];await fs.appendFile(path.join(out,row.directory,resource.file),'corruption');
  await assert.rejects(run('verify'));
  const invalid=(await read(path.join(out,'inventory.json'))).items[0];assert.equal(invalid.verification.status,'failed');assert.match(invalid.verification.error,/integrity/);
  console.log('PASS: separate fixture site discovery, state grouping, entry links, exclusions, capture resume, offline scenarios, pixel equality, Range, missing API/query, corruption detection.');
}finally{if(source.listening)await close(source);if(local)await close(local.server);await fs.rm(temp,{recursive:true,force:true});}
