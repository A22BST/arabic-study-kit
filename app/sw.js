const CACHE = 'ask-v1-20261120-2';
const SHELL = ['./','index.html','style.css','js/app.js','js/logic.js','manifest.webmanifest','fonts/NotoNaskhArabic.ttf','fonts/OFL.txt','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
const base = new URL('./',self.location);
async function cacheContent(root) {
  const cache = await caches.open(CACHE), errors = [];
  async function get(path, json = true) {
    const url = new URL(path,root);
    try {
      const response = await fetch(url,{cache:'no-cache'});
      if (!response.ok) throw new Error(response.status);
      const data = json ? await response.clone().json() : true; await cache.put(url,response); return data;
    } catch(e) { const saved = await cache.match(url); if (saved) { try { return json ? await saved.json() : true; } catch {} } errors.push(url.pathname); return null; }
  }
  const index = await get('index.json');
  await Promise.all((index?.courses || []).map(async id => {
    if (!/^[a-z0-9-]+$/.test(id)) return;
    const course = await get(`${id}/course.json`);
    await Promise.all((course?.chapters || []).flatMap(ch => {
      const name = `ch${String(ch.n).padStart(2,'0')}`;
      return [get(`${id}/${name}.json`), ...[1,2].map(n => get(`../out/${id}/web/${name}-p${n}.webp`, false))];
    }));
  }));
  return errors;
}
self.addEventListener('install',event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL.map(p => new Request(new URL(p,base).href,{cache:'reload'})));
  // Missing chapters are reported by the app, but do not prevent shell installation.
  await cacheContent(new URL('../courses/',base)); await self.skipWaiting();
})()));
self.addEventListener('activate',event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(k => k.startsWith('ask-') && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',event => {
  if (event.data?.type !== 'CACHE_CONTENT') return;
  const root = new URL(event.data.root);
  if (root.origin !== self.location.origin) return;
  event.waitUntil(cacheContent(root).then(errors => event.ports[0]?.postMessage({errors})));
});
self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.endsWith('.json') || url.pathname.endsWith('.pdf')) {
      // Safari's PDF viewer can request byte ranges. Cache a complete response:
      // CacheStorage rejects partial (206) responses, and offline needs all pages.
      const headers = new Headers(event.request.headers);
      if (url.pathname.endsWith('.pdf')) headers.delete('Range');
      const request = new Request(event.request, { headers });
      try { const response = await fetch(request); if (!response.ok) throw new Error(response.status); await cache.put(event.request,response.clone()); return response; }
      catch { return await cache.match(event.request) || new Response('Content unavailable offline',{status:503}); }
    }
    const cached = await cache.match(event.request); if (cached) return cached;
    if (url.pathname.endsWith('.webp')) {
      try { const response = await fetch(event.request); if (response.ok) await cache.put(event.request,response.clone()); return response; }
      catch { return new Response('Cheat sheet unavailable offline',{status:503}); }
    }
    // Navigation query parameters select the content root, not a different app shell.
    if (event.request.mode === 'navigate' && url.pathname.startsWith(base.pathname)) return await cache.match(new URL('index.html',base));
    return fetch(event.request);
  })());
});
