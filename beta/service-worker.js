'use strict';
importScripts('./offline-config.js');
const config = self.HYMNAL_OFFLINE;
const base = new URL('./', self.location.href);
const absolute = path => new URL(path, base).href;
// Cache only explicit app resources, catalogs and MusicXML. Sheet images never enter this cache.
function allowed(url) {
 return [...config.shell, ...config.catalogs].some(path => absolute(path) === url.href) ||
  (url.origin === base.origin && url.pathname.startsWith(`${base.pathname}musicxml/`) && url.pathname.endsWith('.musicxml'));
}
self.addEventListener('install', event => {
 event.waitUntil((async () => {
  const cache = await caches.open(config.cache);
  await cache.addAll(config.shell.map(absolute));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 if (event.request.method !== 'GET') return;
 const url = new URL(event.request.url);
 // Explicit download requests bypass all stored responses, including the original hymnal's cache.
 if (url.searchParams.has('offline-update')) { event.respondWith(fetch(event.request)); return; }
 if (event.request.destination === 'image' && !url.pathname.startsWith(`${base.pathname}icons/`)) {
  event.respondWith(fetch(event.request, {cache:'no-store'})); return;
 }
 const navigation = event.request.mode === 'navigate' && url.origin === base.origin &&
  [base.pathname, `${base.pathname}index.html`].includes(url.pathname);
 if (!navigation && !allowed(url)) return;
 event.respondWith((async () => {
  const cache = await caches.open(config.cache);
  const request = navigation ? absolute('index.html') : event.request;
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(event.request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
 })());
});
