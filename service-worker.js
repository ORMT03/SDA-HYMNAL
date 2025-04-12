const MAJOR_VERSION = '11';  // Change this for major version updates
const MINOR_VERSION = '0';  // Change this for minor version updates

const MAJOR_CACHE = `pwa-cache-major-v${MAJOR_VERSION}`;
const MINOR_CACHE = `pwa-cache-minor-v${MAJOR_VERSION}.${MINOR_VERSION}`;

// URLs to cache for minor updates (essential static assets)
const urlsToCacheMinor = [
  '/SDA-HYMNAL/',
  '/SDA-HYMNAL/index.html',
  '/SDA-HYMNAL/image.html',
  '/SDA-HYMNAL/lyrics.html',
  '/SDA-HYMNAL/styles.css',
  '/SDA-HYMNAL/scripts.js',
  '/SDA-HYMNAL/manifest.json',
  '/SDA-HYMNAL/service-worker.js',
  '/SDA-HYMNAL/song_mapping.json',
  '/SDA-HYMNAL/songs.json',
  '/SDA-HYMNAL/songs_es.json',
  '/SDA-HYMNAL/start-cycle-lyrics.html',
  '/SDA-HYMNAL/start-cycle.html',
  '/SDA-HYMNAL/auto-cycle.html',
  '/SDA-HYMNAL/download.html'
];

// Request persistent storage to avoid cache being cleared by the browser
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log('Persistent storage granted. Cache will not be cleared except by the user.');
    } else {
      console.log('Storage may still be cleared under storage pressure.');
    }
  });
}

// Install event to handle both major and minor caching
self.addEventListener('install', (event) => {
  console.log(`Installing Service Worker with Version: ${MAJOR_VERSION}.${MINOR_VERSION}`);
  event.waitUntil(
    caches.open(MINOR_CACHE).then((cache) => {
      console.log(`Caching minor files for version ${MAJOR_VERSION}.${MINOR_VERSION}...`);
      return cache.addAll(urlsToCacheMinor);
    })
  );
});

// Fetch event to handle caching of any file and updating essential files
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Force re-caching of all minor cache files when the download page is accessed
  if (requestUrl.pathname === '/SDA-HYMNAL/download.html') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        console.log('Re-caching all minor cache files for download page...');
        caches.open(MINOR_CACHE).then((cache) => {
          cache.addAll(urlsToCacheMinor).then(() => {
            console.log(`Minor cache version ${MAJOR_VERSION}.${MINOR_VERSION} updated successfully.`);
          }).catch((error) => {
            console.error('Error while updating minor cache:', error);
          });
        });
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Default behavior for other fetch requests
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log(`Serving ${event.request.url} from cache (Cache Version: ${MAJOR_VERSION}.${MINOR_VERSION}).`);
        return cachedResponse;
      }

      // Only cache the request in the major cache if it's not in the minor cache
      if (!urlsToCacheMinor.includes(requestUrl.pathname)) {
        return fetch(event.request).then((networkResponse) => {
          return caches.open(MAJOR_CACHE).then((cache) => {
            console.log(`Caching ${event.request.url} in the major cache (Version: ${MAJOR_VERSION}).`);
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      } else {
        // If it's in the minor cache, just fetch it from the network or fallback to the minor cache
        return fetch(event.request).catch(() => caches.match(event.request));
      }
    })
  );
});

// Activate event to manage cache versions and clean up old caches
self.addEventListener('activate', (event) => {
  const majorCacheWhitelist = [MAJOR_CACHE];
  const minorCacheWhitelist = [MINOR_CACHE];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old major caches on a major version update
          if (!majorCacheWhitelist.includes(cacheName) && cacheName.startsWith('pwa-cache-major')) {
            console.log(`Deleting old major cache: ${cacheName}`);
            return caches.delete(cacheName);
          }

          // Delete old minor caches on a minor version update
          if (!minorCacheWhitelist.includes(cacheName) && cacheName.startsWith('pwa-cache-minor')) {
            console.log(`Deleting old minor cache: ${cacheName}`);
            return caches.delete(cacheName);
          }

          // Detect and delete older cache strategies
          if (!cacheName.startsWith('pwa-cache-major') && !cacheName.startsWith('pwa-cache-minor')) {
            console.log(`Deleting older cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
