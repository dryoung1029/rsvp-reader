// Per-user document library. Metadata lives in `documents`; the text is
// gzip-compressed in the browser (so the Worker spends no CPU on it) and
// stored in `document_text` in chunks below D1's 2 MB row limit.
import { HttpError, json, readJson, escHtml, appOrigin } from "./util.js";
import { requireUser, sendEmail } from "./auth.js";

const CHUNK_BYTES = 900 * 1024;
const MAX_TEXT_BYTES = 40 * 1024 * 1024;
const ID_RE = /^[0-9a-f-]{36}$/;

function docView(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceUrl: row.source_url,
    wordCount: row.word_count,
    chars: row.chars,
    wordIndex: row.word_index,
    readWords: row.read_words,
    positionAt: row.position_at,
    textVersion: row.text_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    chapters: parseChapters(row.chapters),
    sharedBy: row.shared_by || ""
  };
}

function parseChapters(raw) {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

// Chapter markers: [{ t: title, w: word offset }], sorted, capped.
function cleanChapters(value) {
  if (!Array.isArray(value)) return "[]";
  const list = value
    .filter((c) => c && Number.isFinite(Number(c.w)) && Number(c.w) >= 0)
    .slice(0, 3000)
    .map((c) => ({ t: String(c.t || "").slice(0, 200), w: Math.floor(Number(c.w)) }))
    .sort((a, b) => a.w - b.w);
  return JSON.stringify(list);
}

function int(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function getOwnedDoc(env, userId, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, "Not found");
  const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!row) throw new HttpError(404, "Not found");
  return row;
}

async function writeText(env, docId, bytes) {
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new HttpError(413, "That document is too large to sync.");
  const statements = [env.DB.prepare("DELETE FROM document_text WHERE doc_id = ?").bind(docId)];
  for (let offset = 0, seq = 0; offset < bytes.byteLength; offset += CHUNK_BYTES, seq += 1) {
    statements.push(
      env.DB.prepare("INSERT INTO document_text (doc_id, seq, data) VALUES (?, ?, ?)").bind(docId, seq, bytes.slice(offset, offset + CHUNK_BYTES))
    );
  }
  // D1 batches run as a single transaction.
  await env.DB.batch(statements);
}

export async function handleDocs(request, env, pathname) {
  if (!pathname.startsWith("/api/docs")) return null;
  const user = await requireUser(request, env);
  const method = request.method;

  if (pathname === "/api/docs") {
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY last_opened_at DESC").bind(user.id).all();
      return json({ docs: results.map(docView) });
    }
    if (method === "POST") {
      // Create (or re-send) a document's metadata. The text follows with PUT /text.
      const body = await readJson(request);
      if (!ID_RE.test(body.id || "")) throw new HttpError(400, "Invalid document id.");
      const now = Date.now();
      const existing = await env.DB.prepare("SELECT user_id FROM documents WHERE id = ?").bind(body.id).first();
      if (existing && existing.user_id !== user.id) throw new HttpError(409, "Document id conflict.");
      if (!existing) {
        await env.DB.prepare(
          `INSERT INTO documents (id, user_id, title, source, source_url, word_count, chars, word_index, read_words, position_at, created_at, updated_at, last_opened_at, chapters, shared_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          body.id, user.id, String(body.title || "Untitled").slice(0, 300), String(body.source || "").slice(0, 20),
          String(body.sourceUrl || "").slice(0, 2000), int(body.wordCount), int(body.chars), int(body.wordIndex), int(body.readWords),
          int(body.positionAt, now), int(body.createdAt, now), now, int(body.lastOpenedAt, now),
          cleanChapters(body.chapters), String(body.sharedBy || "").slice(0, 60)
        ).run();
      }
      const row = await getOwnedDoc(env, user.id, body.id);
      return json({ doc: docView(row) }, existing ? 200 : 201);
    }
  }

  const sendMatch = pathname.match(/^\/api\/docs\/([^/]+)\/send$/);
  if (sendMatch && method === "POST") return sendDoc(request, env, user, sendMatch[1]);

  const match = pathname.match(/^\/api\/docs\/([^/]+)(\/text)?$/);
  if (!match) throw new HttpError(404, "Not found");
  const [, id, textPart] = match;
  const doc = await getOwnedDoc(env, user.id, id);

  if (textPart) {
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT data FROM document_text WHERE doc_id = ? ORDER BY seq").bind(id).all();
      if (!results.length) throw new HttpError(404, "This document's text hasn't finished uploading.");
      const parts = results.map((r) => new Uint8Array(r.data));
      return new Response(new Blob(parts), {
        headers: { "content-type": "application/gzip", "cache-control": "no-store", "x-text-version": String(doc.text_version) }
      });
    }
    if (method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new HttpError(400, "Expected gzip-compressed text.");
      await writeText(env, id, bytes);
      const url = new URL(request.url);
      const isEdit = url.searchParams.get("edit") === "1";
      await env.DB.prepare(
        `UPDATE documents SET text_bytes = ?, updated_at = ?, text_version = text_version + ?,
           chapters = CASE WHEN ? = 1 THEN '[]' ELSE chapters END,
           word_count = COALESCE(?, word_count), chars = COALESCE(?, chars) WHERE id = ?`
      ).bind(
        bytes.length, Date.now(), isEdit ? 1 : 0, isEdit ? 1 : 0,
        url.searchParams.has("words") ? int(url.searchParams.get("words")) : null,
        url.searchParams.has("chars") ? int(url.searchParams.get("chars")) : null,
        id
      ).run();
      return json({ doc: docView(await getOwnedDoc(env, user.id, id)) });
    }
  }

  if (method === "PATCH") {
    // Position updates only win if they are newer than what the server has,
    // so an old tab or offline phone can't drag you backwards.
    const body = await readJson(request);
    const sets = [];
    const binds = [];
    if (body.title != null) { sets.push("title = ?"); binds.push(String(body.title).slice(0, 300)); }
    if (body.lastOpenedAt != null) { sets.push("last_opened_at = MAX(last_opened_at, ?)"); binds.push(int(body.lastOpenedAt)); }
    if (body.positionAt != null && int(body.positionAt) > doc.position_at) {
      sets.push("word_index = ?", "read_words = ?", "position_at = ?");
      binds.push(int(body.wordIndex), int(body.readWords), int(body.positionAt));
    }
    if (sets.length) {
      sets.push("updated_at = ?");
      binds.push(Date.now());
      await env.DB.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    }
    return json({ doc: docView(await getOwnedDoc(env, user.id, id)) });
  }

  if (method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM document_text WHERE doc_id = ?").bind(id),
      env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id)
    ]);
    return json({ ok: true });
  }

  throw new HttpError(405, "Method not allowed");
}

// Copies a document (text and chapters, not your reading position) into
// another member's library and lets them know by email.
async function sendDoc(request, env, user, id) {
  const doc = await getOwnedDoc(env, user.id, id);
  const body = await readJson(request);
  const to = String(body.to || "");
  if (!ID_RE.test(to) || to === user.id) throw new HttpError(400, "Choose someone to send it to.");
  const recipient = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(to).first();
  if (!recipient) throw new HttpError(404, "That person isn't a member any more.");
  const hasText = await env.DB.prepare("SELECT COUNT(*) AS n FROM document_text WHERE doc_id = ?").bind(id).first();
  if (!hasText.n) throw new HttpError(409, "This document hasn't finished uploading yet. Try again in a moment.");

  const newId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (id, user_id, title, source, source_url, word_count, chars, word_index, read_words, position_at,
         text_version, text_bytes, created_at, updated_at, last_opened_at, chapters, shared_by)
       SELECT ?, ?, title, 'shared', source_url, word_count, chars, 0, 0, 0, 1, text_bytes, ?, ?, ?, chapters, ?
       FROM documents WHERE id = ?`
    ).bind(newId, recipient.id, now, now, now, user.name || user.email, id),
    env.DB.prepare("INSERT INTO document_text (doc_id, seq, data) SELECT ?, seq, data FROM document_text WHERE doc_id = ?").bind(newId, id)
  ]);

  const from = user.name || user.email;
  const link = appOrigin(request, env);
  const note = String(body.note || "").replace(/[\r\n]+/g, " ").slice(0, 300);
  await sendEmail(env, {
    to: recipient.email,
    subject: `${from} sent you "${doc.title.slice(0, 80)}" on RAFAS`,
    text: `${from} sent you "${doc.title}" to read on RAFAS.${note ? `\n\n"${note}"` : ""}\n\nIt's at the top of your library: ${link}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;color:#0f172a">
      <div style="font-weight:900;font-size:20px">RAF<span style="color:#ef4444">A</span>S</div>
      <p style="font-size:17px">${escHtml(from)} sent you <b>${escHtml(doc.title)}</b> to read.</p>
      ${note ? `<p style="color:#475569;font-style:italic">"${escHtml(note)}"</p>` : ""}
      <a href="${escHtml(link)}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:12px">Open RAFAS</a>
    </div>`
  }).catch((error) => console.warn("send notification failed", error.message));

  return json({ ok: true, to: { id: recipient.id, name: recipient.name } }, 201);
}
