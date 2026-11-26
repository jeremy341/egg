const {chromium}=require('C:/Users/jerem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'); const path=require('node:path');
const output='C:/Users/jerem/.codex/visualizations/2026/11/15/01a1e00a-0cd2-7ef1-b22a-46ea6628c034/egg-ui';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/jerem/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.addInitScript(()=>{new MutationObserver(()=>{document.querySelectorAll('nextjs-portal').forEach(e=>e.remove());}).observe(document,{childList:true,subtree:true});});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let failCapabilities=false,failClone=false,settingsBody=null,alertBody=null,detectedRepo=null;
 const alertSettings={diskPct:90,memoryPct:90,cpuPct:90,failuresBeforeDown:2,slowMs:9999,channels:{down:true,recovery:true,resource:true,deploy:true},mute:{active:false,forever:false,until:null}};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),method=route.request().method(); let body={},status=200;
  if(url.pathname.endsWith('/capabilities')) {if(failCapabilities){status=404;body={error:{message:'Capabilities route unavailable in this fixture.'}};}else body={deploymentModes:{native:true,dockerfile:false,compose:false},docker:{available:false,composeAvailable:false,reason:'Docker target is unavailable.'},runtimes:['node','bun','python','go','rust','ruby','php','java','static','command']};}
  else if(url.pathname==='/api/providers/connections') body={connections:[]};
  else if(url.pathname==='/api/repos/detect'){detectedRepo=url.searchParams.get('repo');body={status:'ok',detection:{runtime:'static',language:'node',framework:'vite',packageManager:'npm',packageManagerSupported:true,commands:{install:null,build:'npm run build',start:null},outputDir:'dist',monorepo:false,candidateRoots:[],env:[],committedEnvFiles:[],warnings:[],notes:[]}};}
  else if(url.pathname.endsWith('/clone')) {if(failClone){status=404;body={error:{message:'Build settings not found.'}};}else body={current:{runtime:'node',installCommand:null,buildCommand:null,startCommand:null,outputDir:null,rootDir:'.',healthPath:'/'},sources:[]};}
  else if(url.pathname.endsWith('/notify/alerts')) {if(method==='PUT')alertBody=route.request().postDataJSON();body={settings:alertSettings,history:[]};}
  else if(url.pathname.endsWith('/jobs')) body={jobs:[]};
  else if(url.pathname.endsWith('/cleanup')) body={cleanup:null};
  else if(url.pathname.endsWith('/status')) body={status:{state:'running',detail:'running',pid:42,uptimeSeconds:42,memoryMb:10,cpuNs:1,restarts:0,http:null,checkedAt:'2026-11-15T18:00:00Z'}};
  else if(url.pathname==='/api/projects/review-worker'&&method==='PATCH'){settingsBody=route.request().postDataJSON();body={project:{}};}
  else if(url.pathname==='/api/projects/conflicts') body={conflicts:[]};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3000/hosting-review-check');
 await page.locator('#source-provider option[value="generic"][disabled]').waitFor({state:'attached'});
 await page.locator('#source-provider').selectOption('gitlab');
 await page.locator('#repo-url').fill('https://gitlab.com/sam/static-site');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Use these settings'}).waitFor();
 await page.locator('#np-workload').selectOption('worker');
 await page.getByRole('button',{name:'Use these settings'}).click();
 if(await page.locator('#np-workload').inputValue()!=='web')throw Error('Detected static site did not normalize workload to web');
 if(detectedRepo!=='https://gitlab.com/sam/static-site')throw Error('Public provider detection lost instance URL');
 failCapabilities=true;
 await page.getByRole('button',{name:'Settings fixture',exact:true}).click();
 await page.getByText(/Could not load target capabilities: Capabilities route unavailable/).waitFor();
 failCapabilities=false; await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.getByText('Docker target is unavailable.').waitFor();
 await page.locator('#ps-runtime').waitFor();
 if(!await page.locator('#ps-workload').isDisabled())throw Error('Existing workload is mutable');
 if(await page.locator('#ps-port').count()||await page.locator('#ps-health').count())throw Error('Worker exposes HTTP settings');
 if(!await page.locator('#ps-runtime option[value="static"]').isDisabled())throw Error('Existing worker allows static runtime');
 await page.getByLabel('The worker stops running').waitFor();
 if(await page.locator('#alert-slow').count())throw Error('Worker exposes slow response controls');
 await page.getByRole('heading',{name:'Worker process',exact:true}).waitFor();
 if((await page.locator('section[aria-labelledby="service-heading"]').innerText()).includes('Health check'))throw Error('Worker status exposes HTTP health');
 await page.locator('button[form="run-form"]').click();
 await page.getByText('Saved. Changes apply to the next deployment.').waitFor();
 if(!settingsBody||settingsBody.listenPort!==null||'port' in settingsBody||'workloadKind' in settingsBody||'healthPath' in settingsBody)throw Error('Worker settings payload violates canonical contract');
 await page.locator('button[form="alerts-form"]').click();
 await page.waitForTimeout(100);
 if(alertBody?.slowMs!==null)throw Error('Worker saved a hidden HTTP slow response threshold');
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>window.scrollTo(0,0));
  const size=viewport.width===390?'mobile':'desktop';
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Worker settings horizontal overflow');
  await page.locator('section[aria-labelledby="run-heading"]').screenshot({path:path.join(output,`review-worker-settings-${size}.png`)});
  await page.locator('section[aria-labelledby="alerts-heading"]').screenshot({path:path.join(output,`review-worker-alerts-${size}.png`)});
 }
 failClone=true;
 await page.getByRole('button',{name:'New fixture',exact:true}).click();await page.getByRole('button',{name:'Settings fixture',exact:true}).click();
 await page.getByText('Could not load the build settings. Reload the page to try again.').waitFor();
 if(!await page.locator('button[form="run-form"]').isDisabled())throw Error('Saving is enabled before build settings load');
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({checks:['immutable existing workload','worker HTTP controls absent','worker process status and alert labels','static detection normalizes web workload','capability error visible and retry succeeds','build settings failure visible','nullable worker settings payload','worker slowMs null','public provider URL preserved','generic source disabled','desktop/mobile no overflow'],pageErrors:errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

