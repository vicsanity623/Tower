// Define the cache name and the files to cache
const CACHE_NAME = 'vics-td-cache-v1.0.6';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'game.js',
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Orbitron:wght@400;700&family=Bangers&display=swap'
];

// 1. Installation: Open a cache and add the assets to it.
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        self.skipWaiting();
      })
  );
});

// 2. Activation: Clean up old caches.
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// 3. Fetch: Serve assets from cache first (Cache-First Strategy).
self.addEventListener('fetch', (event) => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          // If we find a match in the cache, return it
          // console.log('Service Worker: Found in cache', event.request.url);
          return response;
        }
        
        // If the request is not in the cache, fetch it from the network
        // console.log('Service Worker: Fetching from network', event.request.url);
        return fetch(event.request)
          .then((networkResponse) => {
            // OPTIONAL: You could add the new request to the cache here if needed
            // Be careful with this, especially with dynamic data or large files.
            return networkResponse;
          });
      })
      .catch((error) => {
        console.error('Service Worker: Error fetching resource.', error);
        // You could return a fallback offline page here if a page isn't cached.
      })
  );
});
