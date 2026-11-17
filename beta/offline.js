'use strict';
(() => {
 const config = self.HYMNAL_OFFLINE, base = new URL('./', location.href);
 const absolute = path => new URL(path, base).href;
 const stateURL = absolute('__offline__/installed');
 const blobURL = hash => absolute(`__offline__/files/${hash}`);
 const button = document.getElementById('save-offline');
 const status = document.getElementById('offline-status');
 const progress = document.getElementById('offline-progress');
 const notice = document.getElementById('update-notice');
 const updateButton = document.getElementById('install-update');
 const updateText = document.getElementById('update-text');
 let registration, installed, remote, busy = false, checking = false;
 let lastCheck = 0;
 const message = text => { status.textContent = text; };
 const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
 const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
 async function readInstalled() {
  const response = await (await caches.open(config.stateCache)).match(stateURL);
  return response ? response.json() : null;
 }
 function validateRelease(release) {
  if (release.schema !== 1 || !release.id || !release.version || !Array.isArray(release.files) || !release.files.length) throw new Error('Invalid release manifest');
  const paths = new Set();
  for (const file of release.files) {
   const url = new URL(file.path, base);
   const permitted = [...config.shell, ...config.catalogs].includes(file.path) ||
    (url.pathname.startsWith(`${base.pathname}musicxml/`) && url.pathname.endsWith('.musicxml'));
   if (url.origin !== base.origin || url.search || url.hash || !permitted || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || paths.has(url.href)) throw new Error('Invalid release file');
   paths.add(url.href);
  }
  for (const path of [...config.shell,...config.catalogs]) if (!paths.has(absolute(path))) throw new Error('Incomplete release manifest');
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
 async function fetchRelease() { return validateRelease(JSON.parse(new TextDecoder().decode(await fresh('release.json')))); }
 async function missingFiles(release) {
  const cache = await caches.open(config.contentCache), missing = [];
  for (const file of release.files) {
   const response = await cache.match(blobURL(file.sha256));
   if (!response || response.headers.get('X-Hymnal-SHA256') !== file.sha256) missing.push(file);
  }
  return missing;
 }
 function differences(release) {
  const old = new Map((installed?.files || []).map(file => [file.path,file.sha256]));
  const current = new Set(release.files.map(file => file.path));
  return {changed:release.files.filter(file => old.get(file.path) !== file.sha256).length,
   removed:(installed?.files || []).filter(file => !current.has(file.path)).length};
 }
 async function summary() {
  installed = await readInstalled();
  if (!installed) { message('Save all available MusicXML and English & Spanish lyrics for offline use. Sheet images are excluded.'); return; }
  const missing = await missingFiles(installed);
  if (missing.length) { message('Some offline files are missing. Tap to repair the download.'); button.textContent = 'Repair offline download'; return; }
  const scores = installed.files.filter(file => file.path.startsWith('musicxml/')).length;
  message(`Ready offline · ${installed.version} · ${scores} scores and English & Spanish lyrics saved. Images are online-only.`);
  button.textContent = 'Check for updates';
 }
 function showUpdate(release) {
  if (installed?.id === release.id || (!installed && release.version === config.version)) return;
  const diff = differences(release);
  notice.hidden = false;
  updateText.textContent = installed ? `Update available: ${release.version}. ${diff.changed} new or changed ${diff.changed === 1 ? 'file' : 'files'}${diff.removed ? `; ${diff.removed} removed` : ''}. Your saved hymnal is ready to use.` : `Update available: ${release.version}. Tap to save it for offline use.`;
 }
 async function checkForUpdates(force = false, background = false) {
  if (busy || checking || navigator.onLine === false || (!force && Date.now()-lastCheck < 60000)) return;
  checking = true; lastCheck = Date.now();
  try {
   const next = await fetchRelease(); remote = next;
   if (installed?.id !== next.id) showUpdate(next);
   else if (installed && force) message(`You’re up to date · ${installed.version}. Your hymnal is ready offline.`);
  } catch (error) {
   // Background checks never replace the installed release or disturb the reader/offline-ready message.
   if (!background && force && !installed) message('Unable to reach the update server. Reconnect and try again; existing saved files are kept.');
   else if (!background && force && installed) message(`Your saved hymnal is ready offline. Unable to check for updates right now.`);
  } finally { checking = false; }
 }
 async function saveFile(cache, file, bytes) {
  if (bytes.byteLength !== file.bytes || await digest(bytes) !== file.sha256) throw new Error(`Verification failed: ${file.path}`);
  await cache.put(blobURL(file.sha256),new Response(bytes, {headers:{'Content-Type':file.type || 'application/octet-stream','X-Hymnal-SHA256':file.sha256}}));
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
 async function downloadRelease() {
  if (busy) return;
  if (!registration?.active) { await setup(); if (!registration?.active) return; }
  busy = true; button.disabled = true; updateButton.disabled = true;
  progress.hidden = false; progress.max = 100; progress.value = 0;
  let wakeLock;
  try {
   if (navigator.wakeLock) try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
   if (navigator.storage?.persist) try { await navigator.storage.persist(); } catch {}
   const release = await fetchRelease(); remote = release;
   const cache = await caches.open(config.contentCache);
   message('Checking saved files…'); await migrateFiles(release,cache);
   let missing = await missingFiles(release);
   const delta = (release.deltas || []).find(pack => pack.from === installed?.id);
   const pack = validArchive(delta) ? delta : (!installed || missing.length > release.files.length/2) && validArchive(release.full) ? release.full : null;
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
    await saveFile(cache,missing[i],await fresh(missing[i].path,45000));
    progress.value = 90+Math.round(9*(i+1)/missing.length);
   }
   if ((await missingFiles(release)).length) throw new Error('Incomplete download');
   // One atomic pointer switch: old files stay available while the replacement is prepared.
   await (await caches.open(config.stateCache)).put(stateURL,new Response(JSON.stringify({...release,savedAt:new Date().toISOString()}),{headers:{'Content-Type':'application/json'}}));
   progress.value = 100; installed = release; notice.hidden = true; await summary();
   // Reload only after a user-requested download succeeds so app code, catalog and scores agree.
   message(`Ready offline · ${release.version}. All files verified. Opening the updated hymnal…`);
   location.reload();
  } catch (error) {
   console.error(error);
   message(installed ? 'Update interrupted. Your previous offline hymnal is still available. Tap Retry download when connected.' : 'Download interrupted. Saved files are kept; tap Retry download when connected.');
   button.textContent = 'Retry download';
  } finally {
   busy = false; button.disabled = false; updateButton.disabled = false;
   if (wakeLock) try { await wakeLock.release(); } catch {}
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
   // Every launch checks in the background; checks do not participate in catalog loading.
   void checkForUpdates(true,true);
  } catch (error) {
   button.disabled = false;
   try { await summary(); } catch {}
   if (!installed) message('Offline setup is unavailable right now. Connect and tap to retry.');
  }
 }
 button.addEventListener('click',async () => {
  // Checking remains a check even after a newer release has been found.
  // Only the separate Download update button installs an available update.
  if (installed && button.textContent === 'Check for updates') { await checkForUpdates(true); return; }
  await downloadRelease();
 });
 updateButton.addEventListener('click',downloadRelease);
 window.addEventListener('online',() => { lastCheck=0; void checkForUpdates(true,true); });
 document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') void checkForUpdates(true,true); });
 void setup();
})();
