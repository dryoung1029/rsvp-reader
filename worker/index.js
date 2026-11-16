// RAFAS Cloudflare Worker.
// Static files are served by Workers Assets; this Worker handles /api/*,
// the /share fallback, and mail arriving through Cloudflare Email Routing.
import PostalMime from "postal-mime";
import { HttpError, json, normalizeEmail } from "./util.js";
import { handleAuth } from "./auth.js";
import { handleDocs } from "./docs.js";
import { handleInbox, buildItems, saveItems } from "./inbox.js";
import { handleImporter } from "./importer.js";
import { handleStats } from "./stats.js";
import { handleGame } from "./game.js";
import { handleQuiz } from "./quiz.js";

// Public, non-secret settings the browser needs (picker keys are meant to be public).
function config(env) {
  return {
    inboxEmail: env.INBOX_EMAIL || "",
    inbox: Boolean(env.INBOX),
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_API_KEY
      ? { clientId: env.GOOGLE_CLIENT_ID, apiKey: env.GOOGLE_API_KEY, appId: env.GOOGLE_APP_ID || "" }
      : null,
    dropbox: env.DROPBOX_APP_KEY ? { appKey: env.DROPBOX_APP_KEY } : null,
    shortcutUrl: /^https:\/\/(www\.)?icloud\.com\/shortcuts\//.test(env.SHORTCUT_URL || "") ? env.SHORTCUT_URL : "",
    shortcutFilesUrl: /^https:\/\/(www\.)?icloud\.com\/shortcuts\//.test(env.SHORTCUT_FILES_URL || "") ? env.SHORTCUT_FILES_URL : ""
  };
}

// vCard lines over 75 characters are folded with CRLF + space.
function foldVcard(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 74) out.push((i ? " " : "") + line.slice(i, i + 74));
  return out.join("\r\n");
}

// A contact card for the inbox address, so "Share → Mail → RAFAS" just works.
async function contactCard(request, env, url) {
  const email = env.INBOX_EMAIL || "";
  if (!email) throw new HttpError(404, "Email inbox isn't set up.");
  let photo = "";
  try {
    const icon = await env.ASSETS.fetch(new Request(new URL("/icon-192.png", url)));
    if (icon.ok) {
      const bytes = new Uint8Array(await icon.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      photo = `PHOTO;ENCODING=b;TYPE=PNG:${btoa(bin)}`;
    }
  } catch { /* card works without a photo */ }
  const lines = [
    "BEGIN:VCARD", "VERSION:3.0", "N:;RAFAS;;;", "FN:RAFAS", "ORG:RAFAS",
    `EMAIL;TYPE=INTERNET:${email}`, `URL:${env.APP_URL || url.origin}`,
    "NOTE:Send articles\\, PDFs and books here from your own email address to add them to your RAFAS library.",
    photo, "END:VCARD"
  ].filter(Boolean).map(foldVcard);
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: { "content-type": "text/vcard; charset=utf-8", "content-disposition": 'inline; filename="RAFAS.vcf"', "cache-control": "public, max-age=3600" }
  });
}

// Static hosting answers every request with the whole file, but Safari only
// plays video from servers that can send part of it (HTTP range requests).
// So the explainer video goes through here and gets proper 206 responses.
async function serveVideo(request, env, url) {
  const asset = await env.ASSETS.fetch(new Request(new URL(url.pathname, url), { method: "GET" }));
  if (!asset.ok) return asset;
  const bytes = new Uint8Array(await asset.arrayBuffer());
  const size = bytes.byteLength;
  const base = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    etag: asset.headers.get("etag") || `"${size}"`
  };
  const m = (request.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response(request.method === "HEAD" ? null : bytes, { headers: { ...base, "content-length": String(size) } });
  }
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }  // last N bytes
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  }
  const body = request.method === "HEAD" ? null : bytes.subarray(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) }
  });
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  if (pathname === "/api/config" && request.method === "GET") return json(config(env));
  if (pathname === "/api/contact.vcf" && request.method === "GET") return contactCard(request, env, url);
  if (!env.DB) throw new HttpError(503, "The database isn't set up. See the README.");

  for (const handler of [handleAuth, handleDocs, handleGame, handleQuiz, handleStats, handleInbox, handleImporter]) {
    const response = await handler(request, env, pathname);
    if (response) return response;
  }
  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (!(error instanceof HttpError)) console.error(error);
        const status = error instanceof HttpError ? error.status : (error.name === "TimeoutError" ? 504 : 500);
        const message = error instanceof HttpError ? error.message : status === 504 ? "The site took too long to respond." : "Something went wrong.";
        return json({ error: message }, status);
      }
    }
    // The installed app's service worker normally catches share-sheet posts.
    // If it hasn't installed yet, land on the app instead of an error page.
    if (url.pathname === "/rafas-explainer.mp4" && (request.method === "GET" || request.method === "HEAD")) {
      return serveVideo(request, env, url);
    }
    if (url.pathname === "/share" && request.method === "POST") {
      return Response.redirect(new URL("/?shared=1", url).toString(), 303);
    }
    return env.ASSETS.fetch(request);
  },

  // Cloudflare Email Routing delivers mail for INBOX_EMAIL here. The sender must
  // be the email address of a RAFAS account; the item goes to that person's inbox.
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);
    const candidates = [...new Set([message.from, parsed.from?.address].map(normalizeEmail).filter(Boolean))];
    let user = null;
    for (const email of candidates) {
      user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (user) break;
    }
    if (!user) {
      message.setReject("This address only accepts mail from RAFAS members, sent from the email they sign in with.");
      return;
    }
    const items = buildItems({
      title: parsed.subject,
      text: parsed.text,
      html: parsed.html,
      files: (parsed.attachments || []).map((a) => ({
        name: a.filename || "",
        type: a.mimeType || "",
        data: typeof a.content === "string" ? new TextEncoder().encode(a.content).buffer : a.content
      }))
    });
    if (!items.length) {
      message.setReject("No readable text, link, or PDF/EPUB/DOCX/TXT attachment found.");
      return;
    }
    await saveItems(env, user.id, items);
  }
};
