// PWA install + Web Push subscription (call enableNotifications() from the 开启通知 button).
(function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function refreshBtn() {
    const btn = document.getElementById('notifyBtn'); if (!btn) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub && Notification.permission === 'granted') { btn.textContent = '🔔 通知已开启'; btn.classList.add('on'); }
    } catch {}
  }

  window.enableNotifications = async function () {
    const btn = document.getElementById('notifyBtn');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('此设备不支持推送。iOS 需要先把这个网页「添加到主屏幕」，再从主屏幕图标打开，才能开启通知。');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('通知权限被拒绝了。到 设置→通知 里允许，或重新添加到主屏幕。'); return; }
      const { key } = await (await fetch('/api/push/vapid')).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
      if (btn) { btn.textContent = '🔔 通知已开启'; btn.classList.add('on'); }
      // fire a test so you see it works
      fetch('/api/notify/test').catch(() => {});
    } catch (e) { alert('开启失败：' + (e.message || e)); }
  };

  if (document.readyState !== 'loading') refreshBtn();
  else document.addEventListener('DOMContentLoaded', refreshBtn);
})();
