# RAFAS: Read As Fast As Swizz

A speed reader that shows one word at a time (RSVP), built for phones and computers. Read web articles, PDFs (with OCR for scans), EPUBs, text files and pasted text. Everything goes into a library that remembers your place.

Live at **https://rafas.app** (Cloudflare Workers).

## Features

- Library stored on the device (IndexedDB) with per-document progress and resume.
- Phone layout with tap zones (left/right edge = previous/next sentence, middle = play/pause) and a full-screen focus mode.
- Computer layout with the library in a sidebar, drag-and-drop files, and keyboard shortcuts (Space, ←/→, Shift+←/→, ↑/↓, F, Esc, R).
- Installable PWA. On Android it appears in the Share menu (Web Share Target).
- Private inbox for iPhone Shortcuts and email, which the app pulls from when opened.
- About, Help and Privacy pages at `/about`, `/help`, `/privacy`.

## Layout

| Path | What |
| --- | --- |
| `src/` | React frontend (Vite). `App.jsx` holds the reader; `pages/` has About, Help, Privacy. |
| `src/lib/` | Text helpers, file parsers (PDF, EPUB, OCR), IndexedDB library. |
| `public/` | Manifest, icons, service worker (`sw.js`). |
| `worker/index.js` | Cloudflare Worker: `/api/extract`, `/api/inbox`, `/share` fallback, and the email handler. |
| `wrangler.jsonc` | Worker config: static assets, KV binding, custom domain. |

## Local development

```bash
npm install
```

Create `.dev.vars` (not committed) with local secrets:

```
INBOX_TOKEN=dev-token
ALLOWED_SENDERS=you@example.com
```

Run the built app and the Worker together on http://localhost:8787:

```bash
npm run preview
```

For frontend hot reload, run `npx wrangler dev` in one terminal and `npm run dev` in another. Vite forwards `/api` to the Worker.

## Deploying to Cloudflare

One-time setup:

1. Add `rafas.app` to your Cloudflare account (it's already there if you bought it through Cloudflare Registrar).
2. Sign in:

   ```bash
   npx wrangler login
   ```

3. Create the inbox storage and paste the printed `id` into `wrangler.jsonc` in place of `REPLACE_WITH_KV_NAMESPACE_ID`:

   ```bash
   npx wrangler kv namespace create INBOX
   ```

4. Set the secrets. Use a long random string for the token; you'll enter it once in the app on each device.

   ```bash
   npx wrangler secret put INBOX_TOKEN
   ```

   ```bash
   npx wrangler secret put ALLOWED_SENDERS
   ```

5. Deploy. This also attaches `rafas.app` as the Worker's custom domain.

   ```bash
   npm run deploy
   ```

To deploy automatically on every push instead, connect this GitHub repo under Workers & Pages → rafas → Settings → Builds, with build command `npm run build` and deploy command `npx wrangler deploy`.

### Email

1. Cloudflare dashboard → rafas.app → Email → Email Routing → enable it (Cloudflare adds the MX and TXT records).
2. Routing rules → create a custom address `read@rafas.app` with the action **Send to a Worker** → `rafas`.
3. Make sure your own address is in `ALLOWED_SENDERS`. Mail from anyone else is rejected.

If you pick a different address, change `INBOX_EMAIL` in `wrangler.jsonc` so the Help page shows it.

### Inbox API

Auth with `Authorization: Bearer <INBOX_TOKEN>` (or Basic auth with the token as the password, or `?token=`).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/inbox` | JSON or form with `title`, `text`, `url`, and/or `file` uploads (24 MB max per item) |
| GET | `/api/inbox` | List waiting items |
| GET | `/api/inbox/:id` | Item body: file bytes, or JSON `{ text, url }` |
| DELETE | `/api/inbox/:id` | Remove an item |

Items not picked up expire after 30 days.

```bash
curl -X POST https://rafas.app/api/inbox -H "Authorization: Bearer $INBOX_TOKEN" -F file=@book.epub
```

## Limits worth knowing

- The Workers Free plan allows 10 ms of CPU per request. Importing very long web articles can exceed that and fail; the Workers Paid plan raises the limit.
- KV on the Free plan allows 1,000 writes a day, which is far more than the inbox needs.
- The library is per device and browser. It is not synced.
