'use strict';
importScripts('./offline-config.js');
const config = self.HYMNAL_OFFLINE;
const base = new URL('./', self.location.href);
const absolute = path => new URL(path, base).href;
const stateURL = absolute('__offline__/installed');
const blobURL = hash => absolute(`__offline__/files/${hash}`);
// Hymnal manifest bridge — begin
async function hymnalClientManifest(request){
 const response=await fetch(request,{cache:'no-store'});if(!response.ok)return response;
 const release=await response.clone().json();if(release.schema!==1||!Array.isArray(release.files))return response;
 let text='';
 const saved=await(await caches.open(config.stateCache)).match(stateURL);
 if(saved){const installed=await saved.json(),entry=installed.files?.find(e=>e.path==='offline-config.js');if(entry){const body=await(await caches.open(config.contentCache)).match(blobURL(entry.sha256));if(body)text=await body.text();}}
 if(!text){const body=await(await caches.open(config.cache)).match(absolute('offline-config.js'));if(body)text=await body.text();}
 const allowed=new Set();
 for(const name of ['shell','catalogs']){const match=text.match(new RegExp('\\b'+name+'\\s*:\\s*\\[([^\\]]*)\\]'));if(match)for(const value of match[1].matchAll(/'([^']*)'|"([^"]*)"/g))allowed.add(value[1]??value[2]);}
 if(!allowed.size)for(const path of [...config.shell,...config.catalogs])allowed.add(path);
 const all=[...release.files,...(release.additionalFiles||[]),...(release.extensionFiles||[])],files=[],extensionFiles=[];
 for(const file of all){const url=new URL(file.path,base);const score=url.origin===base.origin&&url.pathname.startsWith(new URL('musicxml/',base).pathname)&&url.pathname.endsWith('.musicxml');(allowed.has(file.path)||score?files:extensionFiles).push(file);}
 return new Response(JSON.stringify({...release,files,additionalFiles:[],extensionFiles}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Hymnal-Manifest-Bridge':'1'}});
}
// Hymnal manifest bridge — end
function allowed(url) {
 return [...config.shell, ...config.catalogs].some(path => absolute(path) === url.href) ||
  (url.origin===base.origin&&(url.pathname.startsWith(new URL('musicxml/',base).pathname)||url.pathname.startsWith(new URL('../beta/musicxml/',base).pathname))&&url.pathname.endsWith('.musicxml'));
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
 // The metadata bridge uses the saved client's file list; it never installs content.
 if(url.origin===base.origin&&url.pathname===`${base.pathname}release.json`){event.respondWith(hymnalClientManifest(event.request));return;}
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
