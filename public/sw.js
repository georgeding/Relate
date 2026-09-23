// Relate service worker — receives Web Push and shows native notifications.
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = { title: 'Relate', body: '' };
  try { d = e.data.json(); } catch { try { d = { title: 'Relate', body: e.data.text() }; } catch {} }
  e.waitUntil(self.registration.showNotification(d.title || 'Relate', {
    body: d.body || '',
    tag: d.tag || 'relate',
    data: { url: d.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [80, 40, 80],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
