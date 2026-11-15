// Document library stored in IndexedDB. Metadata and full text live in
// separate stores so the library list stays fast even with large books.
const DB_NAME = "rsvp-reader";
const DB_VERSION = 1;

let dbPromise;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export async function listDocs() {
  const db = await openDb();
  const docs = await req(db.transaction("docs").objectStore("docs").getAll());
  return docs.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

export async function getDoc(id) {
  const db = await openDb();
  return await req(db.transaction("docs").objectStore("docs").get(id));
}

export async function getText(id) {
  const db = await openDb();
  return (await req(db.transaction("texts").objectStore("texts").get(id))) || "";
}

// Adds a document, or returns the existing one if the same text was saved before
// (so sharing the same article twice resumes it instead of duplicating it).
export async function addDoc({ title, text, source = "paste", sourceUrl = "", wordCount }) {
  const existing = (await listDocs()).find((d) => d.title === title && d.wordCount === wordCount && d.chars === text.length);
  if (existing) return await touchDoc(existing.id);

  const now = Date.now();
  const doc = { id: newId(), title, source, sourceUrl, wordCount, chars: text.length, wordIndex: 0, createdAt: now, updatedAt: now, lastOpenedAt: now };
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  tx.objectStore("docs").put(doc);
  tx.objectStore("texts").put(text, doc.id);
  await done(tx);
  return doc;
}

export async function updateDoc(id, changes, text) {
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  const store = tx.objectStore("docs");
  const doc = await req(store.get(id));
  if (!doc) return null;
  const next = { ...doc, ...changes, updatedAt: Date.now() };
  store.put(next);
  if (typeof text === "string") tx.objectStore("texts").put(text, id);
  await done(tx);
  return next;
}

export async function touchDoc(id) {
  return await updateDoc(id, { lastOpenedAt: Date.now() });
}

export async function deleteDoc(id) {
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  tx.objectStore("docs").delete(id);
  tx.objectStore("texts").delete(id);
  await done(tx);
}

// Items the service worker received from the OS share sheet, waiting to be imported.
const SHARE_DB = "rsvp-share";
function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listPendingShares() {
  const db = await openShareDb();
  const items = await req(db.transaction("pending").objectStore("pending").getAll());
  db.close();
  return items;
}

export async function deletePendingShare(id) {
  const db = await openShareDb();
  const tx = db.transaction("pending", "readwrite");
  tx.objectStore("pending").delete(id);
  await done(tx);
  db.close();
}
