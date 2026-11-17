'use strict';
importScripts('./offline-config.js');
const config = self.HYMNAL_OFFLINE;
const base = new URL('./', self.location.href);
const absolute = path => new URL(path, base).href;
const stateURL = absolute('__offline__/installed');
const blobURL = hash => absolute(`__offline__/files/${hash}`);
function allowed(url) {
 return [...config.shell, ...config.catalogs].some(path => absolute(path) === url.href) ||
  (url.origin === base.origin && url.pathname.startsWith(`${base.pathname}musicxml/`) && url.pathname.endsWith('.musicxml'));
}
self.addEventListener('install', event => event.waitUntil((async () => {
 const cache = await caches.open(config.cache);
 // A worker update may check for new code but must not download a new app shell.
 // The user's explicit download verifies and commits the replacement release.
 const installed=await (await caches.open(config.stateCache)).match(stateURL);
 if(!installed && !await cache.match(absolute('index.html')))await cache.addAll(config.shell.map(absolute));
 await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 if (event.request.method !== 'GET') return;
 const url = new URL(event.request.url);
 // Checks and update payloads must never be answered from a stale application cache.
 if (url.searchParams.has('offline-update') || url.pathname === `${base.pathname}release.json` || url.pathname.startsWith(`${base.pathname}releases/`)) {
  event.respondWith(fetch(event.request, {cache:'no-store'})); return;
 }
 if (event.request.destination === 'image' && !url.pathname.startsWith(`${base.pathname}icons/`)) {
  event.respondWith(fetch(event.request, {cache:'no-store'})); return;
 }
 const navigation = event.request.mode === 'navigate' && url.origin === base.origin &&
  [base.pathname, `${base.pathname}index.html`].includes(url.pathname);
 if (!navigation && !allowed(url)) return;
 event.respondWith((async () => {
  const requestURL = navigation ? absolute('index.html') : url.href;
  // This one record is replaced only after every file of a release is verified.
  const state = await (await caches.open(config.stateCache)).match(stateURL);
  if (state) {
   const installed = await state.json();
   const file = installed.files.find(file => absolute(file.path) === requestURL);
   if (file) {
    const saved = await (await caches.open(config.contentCache)).match(blobURL(file.sha256));
    if (saved) return saved;
   }
  }
  const bootstrap = await (await caches.open(config.cache)).match(requestURL);
  if (bootstrap) return bootstrap;
  try { return await fetch(event.request); }
  catch (error) {
   // Preserve access to pre-manifest downloads during migration, without ever serving images.
   for (const name of await caches.keys()) if (name.startsWith('sda-hymnal-beta-offline-')) {
    const saved = await (await caches.open(name)).match(requestURL);
    if (saved) return saved;
   }
   throw error;
  }
 })());
});
