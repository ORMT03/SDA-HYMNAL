'use strict';
(() => {
 const config = self.HYMNAL_OFFLINE, base = new URL('./', location.href);
 const absolute = path => new URL(path, base).href;
 const button = document.getElementById('save-offline');
 const status = document.getElementById('offline-status');
 const progress = document.getElementById('offline-progress');
 const metadataURL = absolute('offline-complete');
 let busy = false, registration;
 function message(text) { status.textContent = text; }
 async function fresh(path) {
  const url = new URL(path, base); url.searchParams.set('offline-update', Date.now());
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`Could not download ${path}`);
  return response;
 }
 async function summary() {
  const cache = await caches.open(config.cache), saved = await cache.match(metadataURL);
  if (!saved) { message('Not fully downloaded yet. Save all available MusicXML and both languages’ lyrics. Sheet images are excluded.'); return; }
  const record = await saved.json();
  const results = await Promise.all(record.urls.map(url => cache.match(url)));
  if (results.some(response => !response)) { message('Some offline files are missing. Tap Download for offline use to repair.'); return; }
  message(`Ready offline · ${record.scores} MusicXML scores and English & Spanish lyrics saved. Images are online-only.`);
  button.textContent = 'Update offline download';
 }
 async function setup() {
  if (!('serviceWorker' in navigator) || !('caches' in self) || !self.isSecureContext) {
   button.disabled = true; message('Offline downloads need Safari over HTTPS, or a local preview on this computer.'); return;
  }
  try {
   registration = await navigator.serviceWorker.register('service-worker.js', {scope:'./', updateViaCache:'none'});
   if (!registration.active) await new Promise((resolve, reject) => {
    const worker = registration.installing || registration.waiting;
    if (!worker) { reject(new Error('Offline setup is not ready')); return; }
    const timeout = setTimeout(() => reject(new Error('Offline setup timed out')), 20000);
    function check() {
     if (worker.state === 'activated') { clearTimeout(timeout); resolve(); }
     else if (worker.state === 'redundant') { clearTimeout(timeout); reject(new Error('Offline setup failed')); }
    }
    worker.addEventListener('statechange', check); check();
   });
   button.disabled = false; await summary();
  } catch (error) { button.disabled = false; message('Offline setup could not finish. Connect to the internet and tap to retry.'); }
 }
 button.addEventListener('click', async () => {
  if (busy) return;
  if (!registration?.active) { await setup(); if (!registration?.active) return; }
  busy = true; button.disabled = true; progress.hidden = false; progress.value = 0;
  let wakeLock;
  try {
   if (navigator.wakeLock) try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
   if (navigator.storage?.persist) try { await navigator.storage.persist(); } catch {}
   const cache = await caches.open(config.cache);
   const completed = await cache.match(metadataURL);
   // After an interrupted download reuse completed score files; an explicit update refreshes all scores.
   const refresh = Boolean(completed);
   const staged = [];
   for (const path of config.catalogs) staged.push([absolute(path), await fresh(path)]);
   const scoresResponse = staged.find(([url]) => url === absolute('scores.json'))[1];
   const scores = await scoresResponse.clone().json();
   const scoreURLs = [...new Set(Object.values(scores).map(path => {
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}musicxml/`) || !url.pathname.endsWith('.musicxml')) throw new Error('Invalid score path');
    return url.href;
   }))];
   const urls = [...config.shell.map(absolute), ...config.catalogs.map(absolute), ...scoreURLs];
   progress.max = urls.length; let count = 0;
   const tick = () => { progress.value = ++count; message(`Saving offline… ${count} of ${urls.length} files. Keep this app open until finished.`); };
   // Refresh the app first. Catalogs are committed only after all their scores are available.
   for (const path of config.shell) { await cache.put(absolute(path), await fresh(path)); tick(); }
   for (const url of scoreURLs) {
    if (refresh || !(await cache.match(url))) await cache.put(url, await fresh(url));
    tick();
   }
   for (const [url, response] of staged) { await cache.put(url, response); tick(); }
   for (const url of urls) if (!(await cache.match(url))) throw new Error('Offline verification failed');
   await cache.put(metadataURL, new Response(JSON.stringify({urls, scores:scoreURLs.length, savedAt:new Date().toISOString()}), {headers:{'Content-Type':'application/json'}}));
   await summary();
  } catch (error) {
   console.error(error); message('Download interrupted or storage is full. Your saved files are kept. Reconnect, check free space, and tap Retry download.'); button.textContent = 'Retry download';
  } finally { busy = false; button.disabled = false; if (wakeLock) try { await wakeLock.release(); } catch {} }
 });
 window.addEventListener('online', () => { if (!busy) summary().catch(() => {}); });
 setup();
})();
