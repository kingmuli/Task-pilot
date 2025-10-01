// service-worker.js
const CACHE_NAME = "taskpilot-v2.0";
const STATIC_CACHE = "taskpilot-static-v2.0";
const DYNAMIC_CACHE = "taskpilot-dynamic-v2.0";

// Assets to cache during installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  
  '/icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Service Worker installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Cache installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker activated successfully');
      return self.clients.claim();
    })
  );
});

// Fetch event - network first strategy with fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension requests
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    // Try network first
    fetch(event.request)
      .then((networkResponse) => {
        // If successful, cache the response
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE)
            .then((cache) => {
              cache.put(event.request, responseClone);
            });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // For navigation requests, return offline page
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            // For other requests, you might want to return a placeholder
            return new Response('Network error occurred', {
              status: 408,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

// Background Sync for offline task synchronization
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-tasks') {
    event.waitUntil(syncPendingTasks());
  }
  
  if (event.tag === 'sync-notes') {
    event.waitUntil(syncPendingNotes());
  }
});

// Sync pending tasks when back online
async function syncPendingTasks() {
  try {
    // Get pending tasks from IndexedDB
    const pendingTasks = await getPendingTasks();
    
    for (const task of pendingTasks) {
      try {
        // Simulate API call - replace with your actual API endpoint
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(task),
        });
        
        if (response.ok) {
          console.log('Task synced successfully:', task);
          await removePendingTask(task.id);
        }
      } catch (error) {
        console.error('Failed to sync task:', task, error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Sync pending notes when back online
async function syncPendingNotes() {
  try {
    const pendingNotes = await getPendingNotes();
    
    for (const note of pendingNotes) {
      try {
        const response = await fetch('/api/notes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(note),
        });
        
        if (response.ok) {
          console.log('Note synced successfully:', note);
          await removePendingNote(note.id);
        }
      } catch (error) {
        console.error('Failed to sync note:', note, error);
      }
    }
  } catch (error) {
    console.error('Background note sync failed:', error);
  }
}

// Push notifications for task reminders
self.addEventListener('push', (event) => {
  console.log('Push notification received');
  
  let data = {
    title: 'TaskPilot',
    body: 'Stay on track with your tasks!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png'
  };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (error) {
      console.error('Error parsing push data:', error);
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [100, 50, 100],
    data: data.url || '/',
    actions: [
      {
        action: 'open',
        title: 'Open App'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if app is already open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Open new window if app isn't open
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Periodic background sync (for weekly data refresh)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'weekly-refresh') {
    event.waitUntil(refreshWeeklyData());
  }
});

async function refreshWeeklyData() {
  try {
    // Refresh weekly tasks and stats
    const responses = await Promise.all([
      fetch('/api/weekly-tasks'),
      fetch('/api/stats')
    ]);
    
    const [weeklyTasks, stats] = await Promise.all(
      responses.map(res => res.json())
    );
    
    // Store updated data in cache
    const cache = await caches.open(DYNAMIC_CACHE);
    await cache.put('/api/weekly-tasks', new Response(JSON.stringify(weeklyTasks)));
    await cache.put('/api/stats', new Response(JSON.stringify(stats)));
    
    console.log('Weekly data refreshed successfully');
  } catch (error) {
    console.error('Weekly refresh failed:', error);
  }
}

// Helper functions for IndexedDB operations
async function getPendingTasks() {
  return new Promise((resolve) => {
    // This would interact with your IndexedDB
    // For now, return empty array as placeholder
    resolve([]);
  });
}

async function removePendingTask(taskId) {
  return new Promise((resolve) => {
    // Remove task from IndexedDB
    resolve();
  });
}

async function getPendingNotes() {
  return new Promise((resolve) => {
    resolve([]);
  });
}

async function removePendingNote(noteId) {
  return new Promise((resolve) => {
    resolve();
  });
}

// Message event handler for communication with the app
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_TASKS') {
    cacheTasks(event.data.tasks);
  }
  
  if (event.data && event.data.type === 'REGISTER_SYNC') {
    registerBackgroundSync();
  }
});

// Cache tasks for offline access
async function cacheTasks(tasks) {
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    const response = new Response(JSON.stringify(tasks));
    await cache.put('/api/tasks', response);
    console.log('Tasks cached for offline access');
  } catch (error) {
    console.error('Failed to cache tasks:', error);
  }
}

// Register for background sync
async function registerBackgroundSync() {
  if ('sync' in self.registration) {
    try {
      await self.registration.sync.register('sync-tasks');
      console.log('Background sync registered');
    } catch (error) {
      console.error('Background sync registration failed:', error);
    }
  }
}

// Health check endpoint for service worker
self.addEventListener('fetch', (event) => {
  if (event.request.url.endsWith('/sw-health')) {
    event.respondWith(new Response('OK', { status: 200 }));
  }
});