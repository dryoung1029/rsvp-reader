// RAFAS service worker: receives items from the OS share sheet
// (Web Share Target) and keeps the app shell available offline.
const CACHE = "rafas-shell-v4";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("rsvp-share", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePending(items) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("pending", "readwrite");
    for (const item of items) tx.objectStore("pending").add(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function handleShare(request) {
  try {
    const form = await request.formData();
    const title = String(form.get("title") || "");
    const text = String(form.get("text") || "");
    const url = String(form.get("url") || "");
    const items = [];
    for (const file of form.getAll("file")) {
      if (file && typeof file === "object" && file.size) {
        items.push({ kind: "file", title, name: file.name, type: file.type, blob: file, receivedAt: Date.now() });
      }
    }
    if (!items.length && (text || url)) items.push({ kind: "text", title, text, url, receivedAt: Date.now() });
    if (items.length) await savePending(items);
  } catch (error) {
    console.error("Share failed", error);
  }
  return Response.redirect("/?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === "/share") {
    event.respondWith(handleShare(request));
    return;
  }

  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Video is streamed in pieces (range requests); leave it to the browser.
  if (request.headers.has("range") || url.pathname.endsWith(".mp4")) return;

  // Network first, falling back to the cached copy when offline.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request.mode === "navigate" ? "/" : request, copy));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request.mode === "navigate" ? "/" : request);
      if (cached) return cached;
      throw error;
    }
  })());
});
