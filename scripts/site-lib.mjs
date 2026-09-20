import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createSnapshotMiddleware} from './replay.mjs';
export const require=createRequire(import.meta.url);
export const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fs.rename(file+'.tmp',file);}
export function key(url){const u=new URL(url);return u.pathname+u.search;}
export async function configuration(file){
  const filename=path.resolve(file),config=JSON.parse(await fs.readFile(filename,'utf8'));
  const url=new URL(config.url);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Expected a public HTTP(S) URL without credentials');
  if(!config.out||!Array.isArray(config.resourcePrefixes)||!config.resourcePrefixes.length)throw new Error('out and resourcePrefixes are required');
  const limit=config.maxPages??25;if(!Number.isInteger(limit)||limit<1)throw new Error('maxPages must be a positive integer');
  const dir=path.dirname(filename),out=path.resolve(dir,config.out);
  if(config.scenarios)for(const [route,module] of Object.entries(config.scenarios))config.scenarios[route]=path.resolve(dir,module);
  return {...config,origin:url.origin,url:url.href,out,maxPages:limit,viewport:config.viewport||{width:1440,height:1000}};
}
export function allowed(raw,config){
  try{const u=new URL(raw,config.url);
    if(u.origin!==config.origin||u.username||u.password)return false;
    const excluded=config.excludePrefixes||['/api/','/logout','/signout','/checkout','/account','/settings'];
    if(excluded.some(p=>u.pathname.startsWith(p)))return false;
    if(config.includePaths&&!config.includePaths.includes(u.pathname))return false;
    if(config.includePrefixes&&!config.includePrefixes.some(p=>u.pathname.startsWith(p)))return false;
    return !/\.(?:pdf|xlsx?|csv|zip|png|jpe?g|svg|webp|mp[34]|wav|css|js|xml)$/i.test(u.pathname);
  }catch{return false;}
}
export function canonical(url,config){let route=new URL(url).pathname;for(const pattern of config.statePathPatterns||[])route=route.replace(new RegExp(pattern),'');return route;}
export async function serve(inventory,out,port=0){
  const docs=new Map(),assets=new Map();let origin;
  for(const row of inventory.items.filter(r=>r.capture==='captured')){
    const root=path.join(out,row.directory),manifest=await read(path.join(root,'manifest.json'));
    if(origin&&origin!==manifest.origin)throw new Error('Mixed origins require an explicit adapter');origin=manifest.origin;
    const handler=await createSnapshotMiddleware(root);
    const docKey=manifest.document.pathname+manifest.document.search;
    if(docs.has(docKey))throw new Error('Duplicate final document: '+docKey);
    docs.set(docKey,handler);
    for(const [url,entry] of Object.entries(manifest.resources)){
      if(assets.has(url)&&assets.get(url).sha256!==entry.sha256)throw new Error('Conflicting resource versions: '+url);
      assets.set(url,{handler,sha256:entry.sha256});
    }
  }
  if(!docs.size)throw new Error('No captured pages to serve');
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,origin);
    const handler=docs.get(key(url))||assets.get(url.href)?.handler;
    if(handler)return handler(req,res);
    res.writeHead(url.pathname.startsWith('/api/')?501:404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Not captured'}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}
export async function close(server){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
export async function checklist(inventory,config){
  const escape=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
  const link=(label,url)=>`[${label}](<${url}>)`;
  const rows=inventory.items.map(row=>{
    const checks=row.verification||{},state=key(row.url)!==row.pageId;
    const next=row.capture!=='captured'?'Capture / inspect source failure':checks.status==='passed'?'Review untested interactions':checks.status==='failed'?'Fix recorded verification failures':'Verify offline';
    return `| ${escape(row.pageId)} | ${state?'state':'page'} | ${link('source',row.url)} / ${link('local',(config.localBase||'http://127.0.0.1:5180')+key(row.url))} | ${row.entry?.from?link('entry',row.entry.from)+' '+escape(row.entry.label):'seed / sitemap'} | ${row.capture||'pending'} | ${checks.status||'pending'} | ${checks.visual?.changedPixels??'pending'} | ${checks.scenario?'scenario checked':'pending'} | ${next} |`;
  });
  await fs.writeFile(path.join(config.out,'CHECKLIST.md'),`# Capture and Verification Checklist\n\nUpdated: ${new Date().toISOString()}\n\nIndependent pages: ${new Set(inventory.items.map(r=>r.pageId)).size}; states/documents: ${inventory.items.length}. Discovery status: ${inventory.discoveryStatus||'pending'}.\n\nEach row has separate evidence in inventory.json. Passed means the recorded checks passed, not every function or state was exhausted. Links are observed entry points; click navigation remains unverified unless an explicit scenario checks it.\n\n| Page | Kind | Open | Discovered from | Capture | Offline checks | Changed pixels | Interaction | Next action |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`);
}
