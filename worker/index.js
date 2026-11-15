// RAFAS Cloudflare Worker.
// Static files are served by Workers Assets; this Worker handles /api/*,
// the /share fallback, and mail arriving through Cloudflare Email Routing.
import PostalMime from "postal-mime";
import { HttpError, json, normalizeEmail } from "./util.js";
import { handleAuth } from "./auth.js";
import { handleDocs } from "./docs.js";
import { handleInbox, buildItems, saveItems } from "./inbox.js";
import { handleImporter } from "./importer.js";

// Public, non-secret settings the browser needs (picker keys are meant to be public).
function config(env) {
  return {
    inboxEmail: env.INBOX_EMAIL || "",
    inbox: Boolean(env.INBOX),
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_API_KEY
      ? { clientId: env.GOOGLE_CLIENT_ID, apiKey: env.GOOGLE_API_KEY, appId: env.GOOGLE_APP_ID || "" }
      : null,
    dropbox: env.DROPBOX_APP_KEY ? { appKey: env.DROPBOX_APP_KEY } : null
  };
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  if (pathname === "/api/config" && request.method === "GET") return json(config(env));
  if (!env.DB) throw new HttpError(503, "The database isn't set up. See the README.");

  for (const handler of [handleAuth, handleDocs, handleInbox, handleImporter]) {
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
