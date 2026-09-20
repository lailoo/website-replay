import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {configuration,allowed,canonical,key,digest,read,write,require,serve,close,checklist} from './site-lib.mjs';
const [command,file,port]=process.argv.slice(2);
if(!['discover','capture','checklist','verify','serve'].includes(command)||!file)throw new Error('Usage: node site.mjs discover|capture|checklist|verify|serve config.json [port]');
const config=await configuration(file),inventoryFile=path.join(config.out,'inventory.json');
await fs.mkdir(config.out,{recursive:true});
const inventory=await read(inventoryFile,{version:1,origin:config.origin,items:[]});
if(inventory.origin!==config.origin)throw new Error('Output belongs to another origin');
const checkpoint=async()=>{await write(inventoryFile,inventory);await checklist(inventory,config);};
const add=(raw,entry)=>{
  if(!allowed(raw,config))return;
  const u=new URL(raw,config.url);u.hash='';
  if(inventory.items.some(r=>r.url===u.href))return;
  inventory.items.push({id:digest(u.href).slice(0,24),pageId:canonical(u.href,config),url:u.href,entry,discoveredAt:new Date().toISOString(),capture:'pending'});
};
if(command==='discover'){
  const {chromium}=require('playwright'),{load}=require('cheerio');
  for(const seed of [config.url,...(config.startUrls||[])])add(seed,{type:'seed'});
  for(const sitemap of config.sitemaps||[]){
    const url=new URL(sitemap,config.url);if(url.origin!==config.origin)throw new Error('Sitemap must share the source origin');
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Sitemap HTTP '+response.status);
    const $=load(await response.text(),{xmlMode:true});
    for(const el of $('url > loc').toArray())add($(el).text(),{type:'sitemap',from:url.href,label:'sitemap'});
  }
  await checkpoint();
  const browser=await chromium.launch();let visited=0;
  try{
    for(let i=0;i<inventory.items.length&&visited<config.maxPages;i++){
      const row=inventory.items[i];if(row.discovery==='observed')continue;
      visited++;
      const context=await browser.newContext({viewport:config.viewport,serviceWorkers:'block'}),page=await context.newPage();
      // Only same-origin, in-scope document navigation; resources may be cross-origin and are recorded.
      await context.route('**/*',r=>r.request().isNavigationRequest()&&!allowed(r.request().url(),config)?r.abort():r.continue());
      const requests=[];page.on('response',r=>requests.push({url:r.url(),method:r.request().method(),status:r.status(),type:r.headers()['content-type']}));
      try{
        const response=await page.goto(row.url,{waitUntil:'domcontentloaded',timeout:30000});
        row.sourceStatus=response?.status();if(!response?.ok())throw new Error('HTTP '+response?.status());
        await page.waitForTimeout(config.settleMs??1000);
        if(config.scroll!==false){for(let step=0;step<(config.maxScrollSteps??20);step++){
          const end=await page.evaluate(()=>{window.scrollBy(0,800);return scrollY+innerHeight>=document.documentElement.scrollHeight;});
          await page.waitForTimeout(100);if(end)break;
        }await page.evaluate(()=>window.scrollTo(0,0));}
        row.title=await page.title();row.finalUrl=page.url();
        row.controls=await page.locator('button,input,select,[role=tab],[role=combobox]').evaluateAll(es=>es.map(e=>({role:e.getAttribute('role')||e.tagName.toLowerCase(),name:e.getAttribute('aria-label')||e.textContent?.trim(),type:e.getAttribute('type')})));
        row.links=await page.locator('a[href]').evaluateAll(es=>es.map(e=>({url:e.href,label:e.textContent.trim()})));
        for(const link of row.links){if(!config.followQueryLinks&&new URL(link.url).search)continue;add(link.url,{type:'link',from:row.url,label:link.label});}
        row.discovery='observed';delete row.discoveryError;
      }catch(e){row.discovery='failed';row.discoveryError=e.message;}
      row.requests=requests;await context.close();await checkpoint();
      console.log(JSON.stringify({phase:'discover',url:row.url,status:row.discovery,queued:inventory.items.length}));
      await new Promise(r=>setTimeout(r,config.delayMs??150));
    }
  }finally{await browser.close();}
  inventory.discoveryStatus=inventory.items.some(r=>r.discovery!=='observed')?'incomplete':'queue-exhausted-within-policy';
  await checkpoint();
}else if(command==='capture'){
  let done=0;
  for(const row of inventory.items){
    if(done>=config.maxPages)break;
    const scenario=config.scenarios?.[key(row.url)];
    const settings={url:row.url,resourcePrefixes:config.resourcePrefixes,rawBytePrefixes:config.rawBytePrefixes,blockedPrefixes:config.blockedPrefixes,scenario,viewport:config.viewport,settleMs:config.settleMs??1000};
    const fingerprint=digest(JSON.stringify(settings)+(scenario?await fs.readFile(scenario,'utf8'):''));
    if(row.capture==='captured'){if(row.captureFingerprint!==fingerprint)throw new Error('Capture settings changed; use a fresh output directory: '+row.url);continue;}
    done++;row.captureFingerprint=fingerprint;
    const attempt=(row.attempt||0)+1;row.attempt=attempt;row.directory='snapshots/'+row.id+'-'+attempt;
    const captureConfig=path.join(config.out,'configs',row.id+'.json');
    await write(captureConfig,{...settings,out:path.join(config.out,row.directory)});
    try{
      await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./capture.mjs',import.meta.url)),captureConfig],{maxBuffer:8*1024*1024});
      row.capture='captured';delete row.captureError;
      const report=await read(path.join(config.out,row.directory,'capture-report.json'));
      row.externalUncaptured=report.externalRequests||[];
      if(report.finalStateUrl&&key(report.finalStateUrl)!==key(row.url))add(report.finalStateUrl,{type:'scenario',from:row.url,label:'scenario final state'});
    }catch(e){row.capture='failed';row.captureError=String(e.stderr||e.stdout||e.message).slice(0,3000);}
    row.capturedAt=new Date().toISOString();delete row.verification;
    await checkpoint();console.log(JSON.stringify({phase:'capture',url:row.url,status:row.capture}));
  }
  if(inventory.items.some(r=>r.capture!=='captured'))process.exitCode=1;
}else if(command==='serve'){
  const requested=Number(port||5180);if(!Number.isInteger(requested)||requested<1||requested>65535)throw new Error('Invalid port');
  const {server,base}=await serve(inventory,config.out,requested);console.log('Offline site: '+base);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close(server).then(()=>process.exit(0)));
}else if(command==='verify'){
  const {chromium}=require('playwright'),{PNG}=require('pngjs'),pixelmatch=(await import('pixelmatch')).default;
  const {server,base}=await serve(inventory,config.out);let browser;
  try{
    browser=await chromium.launch();
    for(const row of inventory.items.filter(r=>r.capture==='captured')){
      const state={checkedAt:new Date().toISOString(),status:'checking',errors:[],failures:[],remote:[],scenario:false};
      const root=path.join(config.out,row.directory),manifest=await read(path.join(root,'manifest.json'));
      const context=await browser.newContext({viewport:config.viewport,serviceWorkers:'block'}),page=await context.newPage();
      await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();state.remote.push(r.request().url());return r.abort();});
      page.on('pageerror',e=>state.errors.push(e.message));
      page.on('requestfailed',r=>state.failures.push({url:r.url(),error:r.failure()?.errorText}));
      page.on('response',r=>{const type=r.request().resourceType(),mime=r.headers()['content-type']||'';if(r.status()>=400||(['script','stylesheet','image','font','fetch','xhr'].includes(type)&&mime.includes('text/html')))state.failures.push({url:r.url(),status:r.status(),mime});});
      try{
        for(const entry of Object.values(manifest.resources)){
          const filename=await fs.realpath(path.resolve(root,entry.file)),realRoot=await fs.realpath(root);
          if(!filename.startsWith(realRoot+path.sep))throw new Error('Resource outside snapshot');
          const bytes=await fs.readFile(filename);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw new Error('Resource integrity failed: '+entry.file);
        }
        const source=await fs.readFile(path.join(root,'source.html'));
        if(manifest.document.sha256&&digest(source)!==manifest.document.sha256)throw new Error('Source document integrity failed');
        state.integrity='passed';
        const response=await page.goto(base+manifest.document.pathname+manifest.document.search,{waitUntil:'load',timeout:30000});
        if(!response?.ok())throw new Error('Local HTTP '+response?.status());
        state.directOpen='passed';
        const scenario=config.scenarios?.[key(row.url)];
        if(scenario){await(await import(pathToFileURL(scenario))).default(page);state.scenario=true;}
        await page.waitForTimeout(config.settleMs??1000);
        const local=path.join(root,'evidence/local.png');await page.screenshot({path:local,fullPage:true});
        const a=PNG.sync.read(await fs.readFile(path.join(root,'evidence/captured.png'))),b=PNG.sync.read(await fs.readFile(local));
        if(a.width!==b.width||a.height!==b.height)state.visual={status:'failed',reason:'Screenshot dimensions differ'};
        else{const diff=new PNG({width:a.width,height:a.height}),changedPixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:0.1});
          await fs.writeFile(path.join(root,'evidence/diff.png'),PNG.sync.write(diff));state.visual={status:changedPixels===0?'passed':'needs-review',changedPixels,totalPixels:a.width*a.height};}
        state.brokenImages=await page.locator('img').evaluateAll(es=>es.filter(e=>!e.complete||!e.naturalWidth).map(e=>e.src));
        state.status=state.errors.length||state.failures.length||state.remote.length||state.brokenImages.length||state.visual.status!=='passed'?'failed':'passed';
      }catch(e){state.status='failed';state.error=e.message;}
      await context.close();row.verification=state;await checkpoint();console.log(JSON.stringify({phase:'verify',url:row.url,status:state.status}));
    }
  }finally{if(browser)await browser.close();await close(server);}
  if(inventory.items.some(r=>r.capture!=='captured'||r.verification?.status!=='passed'))process.exitCode=1;
}else await checkpoint();
