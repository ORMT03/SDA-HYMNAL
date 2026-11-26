'use strict';
(() => {
 const config = self.HYMNAL_OFFLINE, base = new URL('./', location.href);
 const absolute = path => new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
 const stateURL = absolute('__offline__/installed');
 const blobURL = hash => absolute(`__offline__/files/${hash}`);
 const button = document.getElementById('save-offline');
 const checkButton = document.getElementById('check-updates');
 const status = document.getElementById('offline-status');
 const progress = document.getElementById('offline-progress');
 const notice = document.getElementById('update-notice');
 const updateButton = document.getElementById('install-update');
 const updateText = document.getElementById('update-text');
 let registration, installed, remote, busy = false, checking = false;
 let lastCheck = 0,downloadPending=false;
 const ui=id=>document.getElementById(id);
 const message = text => { status.textContent = text;if(ui('storage-status'))ui('storage-status').textContent=text; };
 const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
 const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
 async function readInstalled() {
  const response = await (await caches.open(config.stateCache)).match(stateURL);
  return response ? response.json() : null;
 }
 function validateRelease(release) {
  // Hymnal Release Builder: extensible metadata, bounded to this site's safe paths.
  if(release.schema!==1||!release.id||!release.version||!Array.isArray(release.files)||!release.files.length)throw Error('Invalid release manifest');
  release={...release,files:[...release.files,...(release.additionalFiles||[]),...(release.extensionFiles||[]),...(release.encodedFiles||[])]};
  const paths=new Set();
  for(const file of release.files){
   const url=new URL(absolute(file.path)),inside=url.origin===base.origin&&url.pathname.startsWith(base.pathname);
   const declared=[...config.shell,...config.catalogs].includes(file.path);
   const score=inside&&url.pathname.startsWith(new URL('musicxml/',base).pathname)&&url.pathname.endsWith('.musicxml');
   const catalog=inside&&file.kind==='catalog'&&/^collections\/[A-Za-z0-9._/-]+\.json$/.test(file.path)&&!file.path.split('/').includes('..');
   const shell=inside&&file.kind==='shell'&&(/\.(?:js|css|json|woff2?|ttf|otf)$/.test(file.path)||/^icons\/[A-Za-z0-9._/-]+\.(?:png|svg|ico)$/.test(file.path));
   if(url.origin!==base.origin||url.search||url.hash||(!declared&&!score&&!catalog&&!shell)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||paths.has(url.href))throw Error('Invalid release file: '+file.path);
   paths.add(url.href);
  }
  // Collection catalogs can be added or removed between releases.
  for(const path of [...config.shell,...config.catalogs.filter(path=>!path.startsWith('collections/'))])if(!paths.has(absolute(path)))throw Error('Incomplete release manifest: '+path);
  return release;
 }

 async function fresh(path, timeout = 15000, onProgress) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Invalid update URL');
  url.searchParams.set('offline-update',Date.now());
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),timeout);
  try {
   const response = await fetch(url, {cache:'no-store',signal:controller.signal});
   if (!response.ok) throw new Error(`Download failed: ${response.status}`);
   // Read the body inside the timeout too, so a stalled connection cannot hang the app.
   if (!onProgress || !response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
   const reader = response.body.getReader(), chunks = []; let received = 0;
   while (true) {
    const {done,value} = await reader.read(); if (done) break;
    chunks.push(value); received += value.byteLength; onProgress(received);
   }
   const bytes = new Uint8Array(received); let offset = 0;
   for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
   return bytes;
  } finally { clearTimeout(timer); }
 }
 function selection() {
  try{return {language:['english','spanish','both'].includes(localStorage.getItem('beta-offline-language'))?localStorage.getItem('beta-offline-language'):'both',scores:localStorage.getItem('beta-offline-content')!=='lyrics'};}catch{return {language:'both',scores:true};}
 }
 function selectedRelease(release,choice) {
  return {...release,selection:choice,files:release.files.filter(file=>{
   if(file.kind==='score')return choice.scores&&(choice.language==='both'||file.language===choice.language);
   if(file.kind==='catalog')return choice.language==='both'||file.language===choice.language;
   if(file.path==='../songs.json')return choice.language!=='spanish';
   if(file.path==='../songs_es.json')return choice.language!=='english';
   if(file.path==='collections/gyc-theme-songs.english.json')return choice.language!=='spanish';
   if(file.path.endsWith('.musicxml'))return choice.scores&&(choice.language==='both'||(file.path.startsWith('../beta/musicxml/')?file.path.startsWith(`../beta/musicxml/${choice.language==='english'?'English':'Spanish'}/`):choice.language==='english'));
   return true;
  })};
 }
 const defaultSelection={language:'both',scores:true};
 const sameSelection=(a,b)=>a.language===b.language&&a.scores===b.scores;
 const selectionLabel=choice=>(choice.language==='both'?'English & Spanish':choice.language==='english'?'English':'Spanish')+' · '+(choice.scores?'scores & lyrics':'lyrics only');
 const writeLock=fn=>navigator.locks?.request?navigator.locks.request('sda-hymnal-beta-storage',fn):fn();
 const ownExtraCache=name=>name===config.cache||name.startsWith('sda-hymnal-beta-offline-');
 async function storageSnapshot() {
  const current=await readInstalled(),sizes=new Map((current?.files||[]).map(file=>[file.sha256,file.bytes]));
  const needed=new Set((current?.files||[]).map(file=>file.sha256));let active=0,unused=0,files=0;
  for(const name of await caches.keys()) {
   if(name!==config.contentCache&&!ownExtraCache(name))continue;
   const cache=await caches.open(name);
   for(const request of await cache.keys()) {
    const response=await cache.match(request);if(!response)continue;
    const hash=String(request.url||request).split('/').pop();
    const bytes=Number(response.headers.get('X-Hymnal-Bytes'))||sizes.get(hash)||(await response.arrayBuffer()).byteLength;
    if(name===config.contentCache&&needed.has(hash)){active+=bytes;files++;}else unused+=bytes;
   }
  }
  return {active,unused,files,current};
 }
 const size=bytes=>`${(bytes/1048576).toFixed(1)} MB`;
 async function refreshStorage() {
  if(!ui('storage-usage'))return;
  try{const state=await storageSnapshot();ui('storage-usage').textContent=state.current?`Saved: ${selectionLabel(state.current.selection||defaultSelection)}\nHymnal storage: ${size(state.active)}\nUnused files: ${size(state.unused)}`:`No offline hymnal saved.\nStored app files: ${size(state.unused)}`;ui('clean-storage').disabled=busy||!state.current;}
  catch{ui('storage-usage').textContent='Storage details are unavailable right now.';}
 }
 async function cleanupUnused(allowBusy=false) {
  if(!allowBusy&&(busy||downloadPending))return 0;
  const current=await readInstalled();
  // Never delete anything until a complete installed snapshot has been verified.
  if(!current||(await missingFiles(current)).length)return 0;
  const keep=new Set(current.files.map(file=>blobURL(file.sha256))),cache=await caches.open(config.contentCache);
  const cutoff=Date.parse(current.savedAt||'')||0;let removed=0;
  const unchanged=async()=>{if(!allowBusy&&(busy||downloadPending))return false;const next=await readInstalled();return next?.id===current.id&&next?.savedAt===current.savedAt;};
  for(const request of await cache.keys()) {
   const url=request.url||String(request);if(keep.has(url))continue;
   const response=await cache.match(request),staged=Number(response?.headers.get('X-Hymnal-Saved-At'))||0;
   // Preserve files staged by another pending/resumable download after this commit.
   if(staged&&(!cutoff||staged>=cutoff))continue;
   if(!await unchanged())return removed;
   if(await cache.delete(request))removed++;
  }
  for(const name of await caches.keys())if(ownExtraCache(name)){
   if(!await unchanged())return removed;
   await caches.delete(name);
  }
  return removed;
 }
 async function cleanStorage(){
  if(busy||downloadPending)return;
  try{await writeLock(()=>cleanupUnused());message('Storage cleaned. Files needed by your saved hymnal were kept.');await refreshStorage();}
  catch{message('Cleanup could not finish. Your saved hymnal was kept.');}
 }
 self.HymnalOffline={refreshStorage,cleanStorage};
 for(const [id,key,fallback]of [['offline-language','beta-offline-language','both'],['offline-content','beta-offline-content','scores']]){
  const field=ui(id);if(!field)continue;try{field.value=localStorage.getItem(key)||fallback;}catch{field.value=fallback;}
  if(![...field.options].some(option=>option.value===field.value))field.value=fallback;
  field.addEventListener('change',()=>{try{localStorage.setItem(key,field.value);}catch{}if(ui('storage-status'))ui('storage-status').textContent='Selection saved. Tap Save offline selection to apply it.';});
 }
 ui('clean-storage')?.addEventListener('click',cleanStorage);
 ui('save-offline-selection')?.addEventListener('click',()=>void downloadRelease());
 async function fetchRelease() { return validateRelease(JSON.parse(new TextDecoder().decode(await fresh('release.json')))); }
 async function missingFiles(release) {
  const cache = await caches.open(config.contentCache), missing = [];
  for (const file of release.files) {
   const response = await cache.match(blobURL(file.sha256));
   if (!response || response.headers.get('X-Hymnal-SHA256') !== file.sha256) missing.push(file);
  }
  return missing;
 }
 async function summary() {
  installed = await readInstalled();
  button.hidden=!!installed;checkButton.hidden=!installed;
  button.textContent='Save Hymnal for Offline Use';
  if (!installed) { message('Choose languages and content in Settings, then save the hymnal for offline use. Images stay online-only.'); return; }
  const missing = await missingFiles(installed);
  if (missing.length) { message('Some offline files are missing. Use Download update to repair them.'); notice.hidden=false;updateText.textContent='Your offline download needs repair. Tap Download update to save the missing files.'; return; }
  const scores = installed.files.filter(file => file.path.endsWith('.musicxml')).length;
  message(`Ready offline · ${installed.version} · ${selectionLabel(installed.selection||defaultSelection)}${scores?' · '+scores+' scores':''}. Images are online-only.`);
  checkButton.textContent = 'Check for updates';
 }
 function showUpdate(release, repair = false) {
  if ((installed?.id === release.id && !repair) || (!installed && release.version === config.version)) return;
  notice.hidden = false;
  updateText.textContent = `Update available: ${release.version}.`;
 }
 async function checkForUpdates(force = false, background = false) {
  if(busy||checking)return;
  if(navigator.onLine===false){if(!background)message('You’re offline. Connect to check for updates.');return;}
  if(!force&&Date.now()-lastCheck<60000)return;
  checking = true; lastCheck = Date.now();
  try {
   const next = await fetchRelease(); remote = next;
   const expected=installed?selectedRelease(next,installed.selection||selection()):null,repair=!!expected&&expected.files.some(file=>!installed.files.some(saved=>saved.path===file.path&&saved.sha256===file.sha256));
   if (installed?.id !== next.id || repair) {if(!installed&&next.version===config.version)notice.hidden=true;else showUpdate(next,repair);}
   else if (installed && force) { notice.hidden=true; if((await missingFiles(installed)).length)await summary();else message(`You’re up to date · ${installed.version}. Your hymnal is ready offline.`); }
  } catch (error) {
   // Background checks never replace the installed release or disturb the reader/offline-ready message.
   if (!background && force && !installed) message('Unable to reach the update server. Reconnect and try again; existing saved files are kept.');
   else if (!background && force && installed) message(`Your saved hymnal is ready offline. Unable to check for updates right now.`);
  } finally { checking = false; }
 }
 async function saveFile(cache, file, bytes) {
  if (bytes.byteLength !== file.bytes || await digest(bytes) !== file.sha256) throw new Error(`Verification failed: ${file.path}`);
  await cache.put(blobURL(file.sha256),new Response(bytes, {headers:{'Content-Type':file.type || 'application/octet-stream','X-Hymnal-SHA256':file.sha256,'X-Hymnal-Bytes':String(file.bytes),'X-Hymnal-Saved-At':String(Date.now())}}));
 }
 async function migrateFiles(release, cache) {
  const names = (await caches.keys()).filter(name => name === config.cache || name.startsWith('sda-hymnal-beta-offline-'));
  for (const file of await missingFiles(release)) {
   for (const name of names) {
    const response = await (await caches.open(name)).match(absolute(file.path));
    if (!response) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === file.bytes && await digest(bytes) === file.sha256) { await saveFile(cache,file,bytes); break; }
   }
  }
 }
 function validArchive(pack) {
  if (!pack || !/^[a-f0-9]{64}$/.test(pack.sha256)) return false;
  const url = new URL(pack.url,base);
  return url.origin === base.origin && url.pathname.startsWith(`${base.pathname}releases/`) && url.pathname.endsWith('.zip');
 }
 function unpack(bytes, needed) {
  return new Promise((resolve,reject) => {
   if (!self.fflate) { reject(new Error('ZIP support unavailable')); return; }
   self.fflate.unzip(bytes,{filter:entry => needed.has(entry.name)},(error,files) => error ? reject(error) : resolve(files));
  });
 }
 async function downloadRelease(){
  if(busy||downloadPending)return;downloadPending=true;
  try{await writeLock(performDownload);}finally{downloadPending=false;}
 }
 async function performDownload() {
  if (busy) return;
  if (!registration?.active) { await setup(); if (!registration?.active) return; }
  busy = true; button.disabled = true; updateButton.disabled = true;
  progress.hidden = false; progress.max = 100; progress.value = 0;
  for(const id of ['offline-language','offline-content','clean-storage','save-offline-selection'])if(ui(id))ui(id).disabled=true;
  let wakeLock;
  try {
   if (navigator.wakeLock) try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
   if (navigator.storage?.persist) try { await navigator.storage.persist(); } catch {}
   const published = await fetchRelease(); remote = published;
   const choice=selection(),release=selectedRelease(published,choice);
   const cache = await caches.open(config.contentCache);
   message('Checking saved files…'); await migrateFiles(release,cache);
   let missing = await missingFiles(release);
   const collection=(published.collections||[]).find(item=>sameSelection(item.selection,choice));
   const packs=collection||(sameSelection(choice,defaultSelection)?published:{});
   const selectionChanged=installed&&!sameSelection(installed.selection||defaultSelection,choice);
   const delta = !selectionChanged&&(packs.deltas||[]).find(pack=>pack.from===installed?.id);
   const pack=validArchive(delta)?delta:(!installed||selectionChanged||missing.length>release.files.length/2)&&validArchive(packs.full)?packs.full:null;
   // For small repairs/resumes, individual verified files avoid downloading an already-installed ZIP again.
   if (missing.length && pack && (pack.bytes < missing.reduce((total,file) => total+file.bytes,0))) {
    const mb = (pack.bytes/1048576).toFixed(1);
    message(`Downloading ${pack === delta ? 'update' : 'offline collection'} (${mb} MB)… Keep this app open.`);
    try {
     const bytes = await fresh(pack.url,120000,received => {
      progress.value = Math.min(35,Math.round(35*received/pack.bytes));
      message(`Downloading ${pack === delta ? 'update' : 'offline collection'}… ${Math.min(100,Math.round(100*received/pack.bytes))}%. Keep this app open.`);
     });
     if (bytes.byteLength !== pack.bytes || await digest(bytes) !== pack.sha256) throw new Error('Archive verification failed');
     progress.value = 35; message('Unpacking and verifying scores…');
     const needed = new Set(missing.map(file => `files/${file.sha256}`));
     const files = await unpack(bytes,needed);
     for (let i=0;i<missing.length;i++) {
      const file = missing[i], data = files[`files/${file.sha256}`];
      if (!data) continue; // A delta may not include files that need a local storage repair.
      await saveFile(cache,file,data); delete files[`files/${file.sha256}`];
      progress.value = 35+Math.round(55*(i+1)/missing.length);
     }
    } catch (error) { console.warn('ZIP unavailable; retrying only the required individual files.',error); }
   }
   missing = await missingFiles(release);
   for (let i=0;i<missing.length;i++) {
    message(`Saving changed files… ${i+1} of ${missing.length}. Keep this app open.`);
    await saveFile(cache,missing[i],await fresh(absolute(missing[i].path),45000));
    progress.value = 90+Math.round(9*(i+1)/missing.length);
   }
   if ((await missingFiles(release)).length) throw new Error('Incomplete download');
   // One atomic pointer switch: old files stay available while the replacement is prepared.
   await (await caches.open(config.stateCache)).put(stateURL,new Response(JSON.stringify({...release,savedAt:new Date().toISOString()}),{headers:{'Content-Type':'application/json'}}));
   progress.value = 100; installed = release; notice.hidden = true; await summary();
   // Cleanup is post-commit only. A cleanup failure cannot undo a verified update.
   try{await cleanupUnused(true);}catch(error){console.warn('Unused files were retained.',error);}
   // Reload only after a user-requested download succeeds so app code, catalog and scores agree.
   message(`Ready offline · ${release.version}. All files verified. Opening the updated hymnal…`);
   location.reload();
  } catch (error) {
   console.error(error);
   message(installed ? 'Update interrupted. Your previous offline hymnal is still available. Tap Download update when connected.' : 'Download interrupted. Saved files are kept; tap Retry download when connected.');
   if(installed){notice.hidden=false;updateText.textContent='Update interrupted. Tap Download update to retry; your saved hymnal is still available.';}else button.textContent = 'Retry offline download';
  } finally {
   busy = false; button.disabled = false; updateButton.disabled = false;
   for(const id of ['offline-language','offline-content','clean-storage','save-offline-selection'])if(ui(id))ui(id).disabled=false;
   if (wakeLock) try { await wakeLock.release(); } catch {}
   void refreshStorage();
  }
 }
 async function setup() {
  if (!('serviceWorker' in navigator) || !('caches' in self) || !self.isSecureContext) {
   button.disabled = true; message('Offline downloads require HTTPS and a supported browser.'); return;
  }
  try {
   // Reuse the active worker offline: a failed registration update must not hide saved content.
   await summary();
   registration = await navigator.serviceWorker.getRegistration(base.href);
   try { if (navigator.onLine !== false || !registration?.active) registration = await navigator.serviceWorker.register('service-worker.js',{scope:'./',updateViaCache:'none'}); }
   catch (error) { if (!registration?.active) throw error; }
   if (!registration.active) await new Promise((resolve,reject) => {
    const worker = registration.installing || registration.waiting;
    const timer = setTimeout(() => reject(new Error('Offline setup timed out')),20000);
    if (!worker) { clearTimeout(timer); reject(new Error('No service worker')); return; }
    const check = () => {
     if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
     else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Offline setup failed')); }
    };
    worker.addEventListener('statechange',check); check();
   });
   button.disabled = false; await summary();
   // Also clean an update committed by an older client, after the new app has opened.
   if(installed)void writeLock(()=>cleanupUnused()).then(refreshStorage).catch(()=>{});
   // Every launch checks in the background; checks do not participate in catalog loading.
   void checkForUpdates(true,true);
  } catch (error) {
   button.disabled = false;
   try { await summary(); } catch {}
   if (!installed) message('Offline setup is unavailable right now. Connect and tap to retry.');
  }
 }
 // The check action has no path to the downloader, regardless of button labels,
 // cached state, a known update, a previous failure, or a missing offline file.
 checkButton.addEventListener('click',() => checkForUpdates(true));
 button.addEventListener('click',async () => {
  installed=await readInstalled();
  if(installed){await checkForUpdates(true);return;}
  await downloadRelease(); // Explicit first-time Save Hymnal for Offline Use only.
 });
 updateButton.addEventListener('click',downloadRelease);
 window.addEventListener('online',() => { lastCheck=0; void checkForUpdates(true,true); });
 document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') void checkForUpdates(true,true); });
 void setup();
})();
