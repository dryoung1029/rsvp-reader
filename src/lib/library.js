// Local copy of the signed-in person's library, in IndexedDB. Each account gets
// its own database so family members sharing a tablet don't see each other's
// books. The server copy (see sync.js) is the source of truth across devices.
const DB_VERSION = 1;

let dbName = null;
let dbPromise = null;

function openNamed(name, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function upgradeLibrary(db) {
  if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
  if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts");
}

export function setLibraryOwner(userId) {
  const name = userId ? `rafas-${userId}` : null;
  if (name === dbName) return;
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbName = name;
  dbPromise = null;
}

function openDb() {
  if (!dbName) return Promise.reject(new Error("Not signed in"));
  if (!dbPromise) dbPromise = openNamed(dbName, upgradeLibrary);
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

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Includes documents marked deleted (waiting to be removed from the server).
export async function allDocs() {
  const db = await openDb();
  return await req(db.transaction("docs").objectStore("docs").getAll());
}

export async function listDocs() {
  const docs = (await allDocs()).filter((d) => !d.deleted);
  return docs.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

export async function getDoc(id) {
  const db = await openDb();
  return await req(db.transaction("docs").objectStore("docs").get(id));
}

export async function getText(id) {
  const db = await openDb();
  return await req(db.transaction("texts").objectStore("texts").get(id));
}

export async function putDoc(doc, text) {
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  tx.objectStore("docs").put(doc);
  if (typeof text === "string") tx.objectStore("texts").put(text, doc.id);
  await done(tx);
  return doc;
}

// Adds a document, or returns the existing one if the same text was saved before
// (so sharing the same article twice resumes it instead of duplicating it).
export async function addDoc({ title, text, source = "paste", sourceUrl = "", wordCount, chapters = [] }) {
  const existing = (await listDocs()).find((d) => d.title === title && d.wordCount === wordCount && d.chars === text.length);
  if (existing) return await updateDoc(existing.id, { lastOpenedAt: Date.now() });
  const now = Date.now();
  return await putDoc({
    id: newId(), title, source, sourceUrl, wordCount, chars: text.length,
    wordIndex: 0, readWords: 0, positionAt: now, serverPositionAt: 0,
    createdAt: now, updatedAt: now, lastOpenedAt: now,
    textVersion: 1, synced: false, textMissing: false, chapters, sharedBy: ""
  }, text);
}

export async function updateDoc(id, changes, text) {
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  const store = tx.objectStore("docs");
  const doc = await req(store.get(id));
  if (!doc) { tx.abort(); return null; }
  const next = { ...doc, ...changes, updatedAt: Date.now() };
  store.put(next);
  if (typeof text === "string") tx.objectStore("texts").put(text, id);
  await done(tx);
  return next;
}

export async function removeDoc(id) {
  const db = await openDb();
  const tx = db.transaction(["docs", "texts"], "readwrite");
  tx.objectStore("docs").delete(id);
  tx.objectStore("texts").delete(id);
  await done(tx);
}

// Documents saved before accounts existed lived in a shared "rsvp-reader"
// database. Hand them over once, to the first person who signs in here.
export async function takeLegacyDocs() {
  if (!indexedDB.databases) return [];
  const names = (await indexedDB.databases()).map((d) => d.name);
  if (!names.includes("rsvp-reader")) return [];
  const db = await openNamed("rsvp-reader", upgradeLibrary);
  const docs = await req(db.transaction("docs").objectStore("docs").getAll());
  const out = [];
  for (const doc of docs) {
    const text = await req(db.transaction("texts").objectStore("texts").get(doc.id));
    if (text) out.push({ doc, text });
  }
  db.close();
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase("rsvp-reader"); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  return out;
}

// Items the service worker received from the OS share sheet, waiting to be imported.
const SHARE_DB = "rsvp-share";
function openShareDb() {
  return openNamed(SHARE_DB, (db) => db.createObjectStore("pending", { keyPath: "id", autoIncrement: true }));
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
