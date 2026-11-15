// Keeps the local library (IndexedDB) and the server library in step.
// Text is gzip-compressed in the browser before upload.
import { api } from "./api.js";
import { allDocs, getDoc, getText, putDoc, updateDoc, removeDoc } from "./library.js";

export async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(blob) {
  return await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

function metaForServer(doc) {
  const { id, title, source, sourceUrl, wordCount, chars, wordIndex, readWords, positionAt, createdAt, lastOpenedAt } = doc;
  return { id, title, source, sourceUrl, wordCount, chars, wordIndex, readWords, positionAt, createdAt, lastOpenedAt };
}

export async function uploadDoc(doc) {
  const text = await getText(doc.id);
  if (typeof text !== "string") return null;
  await api("/api/docs", { method: "POST", body: metaForServer(doc) });
  const result = await api(`/api/docs/${doc.id}/text?words=${doc.wordCount}&chars=${doc.chars}`, {
    method: "PUT", body: await gzipText(text), headers: { "content-type": "application/gzip" }
  });
  return await updateDoc(doc.id, { synced: true, textVersion: result.doc.textVersion, serverPositionAt: result.doc.positionAt });
}

export async function uploadEditedText(id, text, wordCount) {
  const result = await api(`/api/docs/${id}/text?edit=1&words=${wordCount}&chars=${text.length}`, {
    method: "PUT", body: await gzipText(text), headers: { "content-type": "application/gzip" }
  });
  await updateDoc(id, { textVersion: result.doc.textVersion });
}

export async function downloadText(id) {
  const response = await api(`/api/docs/${id}/text`, { raw: true });
  const text = await gunzipText(await response.blob());
  const version = Number(response.headers.get("x-text-version")) || 1;
  const doc = await getDoc(id);
  if (doc) await putDoc({ ...doc, textMissing: false, textVersion: version }, text);
  return text;
}

export async function pushPosition(doc, { keepalive = false } = {}) {
  if (!doc?.synced || (doc.positionAt || 0) <= (doc.serverPositionAt || 0)) return;
  const result = await api(`/api/docs/${doc.id}`, {
    method: "PATCH",
    keepalive,
    body: { wordIndex: doc.wordIndex, readWords: doc.readWords, positionAt: doc.positionAt, lastOpenedAt: doc.lastOpenedAt }
  });
  await updateDoc(doc.id, { serverPositionAt: Math.max(result.doc.positionAt, doc.positionAt) });
}

export async function deleteEverywhere(id) {
  const doc = await getDoc(id);
  if (!doc) return;
  if (!doc.synced) { await removeDoc(id); return; }
  await updateDoc(id, { deleted: true });
  try {
    await api(`/api/docs/${id}`, { method: "DELETE" });
    await removeDoc(id);
  } catch (error) {
    if (error.status === 404) await removeDoc(id);
    // Otherwise stay marked deleted; the next sync retries.
  }
}

// Two-way merge. Returns { changedIds } so the open document can pick up a
// newer position from another device.
export async function syncLibrary() {
  const { docs: remote } = await api("/api/docs");
  const local = await allDocs();
  const localById = new Map(local.map((d) => [d.id, d]));
  const remoteById = new Map(remote.map((d) => [d.id, d]));
  const changedIds = [];

  for (const r of remote) {
    const l = localById.get(r.id);
    if (!l) {
      await putDoc({
        ...r, synced: true, serverPositionAt: r.positionAt, textMissing: true, textVersion: r.textVersion
      });
      changedIds.push(r.id);
      continue;
    }
    if (l.deleted) continue;
    const changes = { synced: true, title: r.title, wordCount: r.wordCount, chars: r.chars };
    if (r.positionAt > (l.positionAt || 0)) {
      Object.assign(changes, { wordIndex: r.wordIndex, readWords: r.readWords, positionAt: r.positionAt, serverPositionAt: r.positionAt });
      changedIds.push(r.id);
    } else {
      changes.serverPositionAt = Math.max(l.serverPositionAt || 0, r.positionAt);
    }
    if ((r.lastOpenedAt || 0) > (l.lastOpenedAt || 0)) changes.lastOpenedAt = r.lastOpenedAt;
    if (r.textVersion > (l.textVersion || 1)) { changes.textMissing = true; changedIds.push(r.id); }
    await updateDoc(r.id, changes);
  }

  for (const l of local) {
    if (remoteById.has(l.id)) {
      if (l.deleted) await deleteEverywhere(l.id);
      continue;
    }
    if (l.deleted || l.synced) {
      // Deleted here, or deleted on another device.
      await removeDoc(l.id);
      changedIds.push(l.id);
    } else {
      await uploadDoc(l).catch((error) => console.warn("Upload failed", l.title, error));
    }
  }

  for (const doc of await allDocs()) {
    if (!doc.deleted && doc.synced && (doc.positionAt || 0) > (doc.serverPositionAt || 0)) {
      await pushPosition(doc).catch(() => {});
    }
  }
  return { changedIds };
}
