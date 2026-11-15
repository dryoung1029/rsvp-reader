const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const PORT = process.env.PORT || 3000;
const INBOX_TOKEN = process.env.INBOX_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

fs.mkdirSync(INBOX_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

// ---------- Article extraction ----------

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error('Only http and https URLs are supported.'), { status: 400 });
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw Object.assign(new Error('That address is not reachable from the reader.'), { status: 400 });
  }
  return parsed;
}

// Fetches a public page, following redirects manually so each hop is checked.
async function fetchPublicPage(rawUrl) {
  let current = rawUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; RSVP Reader)',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), current).toString();
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('The site did not allow the article to be fetched.'), { status: 502 });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_PAGE_BYTES) throw Object.assign(new Error('That page is too large to import.'), { status: 413 });
    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) throw Object.assign(new Error('That page is too large to import.'), { status: 413 });
    return { html, finalUrl: current };
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 502 });
}

function htmlToArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const fallback = dom.window.document.body?.textContent || '';
  return {
    title: article?.title || dom.window.document.title || url,
    byline: article?.byline || '',
    text: article?.textContent || fallback
  };
}

app.post('/api/extract', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Please provide a valid http or https URL.' });
    }
    const { html, finalUrl } = await fetchPublicPage(url);
    res.json(htmlToArticle(html, finalUrl));
  } catch (err) {
    console.error('extract failed:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Extraction failed' });
  }
});

// ---------- Inbox: documents sent from a phone share sheet, iOS Shortcut, or email ----------

function readToken(req) {
  const header = req.get('authorization') || '';
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  if (/^basic\s+/i.test(header)) {
    // Email webhooks often only support https://user:TOKEN@host/... style auth.
    const decoded = Buffer.from(header.replace(/^basic\s+/i, ''), 'base64').toString();
    return decoded.slice(decoded.indexOf(':') + 1);
  }
  return req.get('x-inbox-token') || String(req.query.token || '');
}

function requireInbox(req, res, next) {
  if (!INBOX_TOKEN) return res.status(503).json({ error: 'Inbox is not configured. Set INBOX_TOKEN on the server.' });
  const given = Buffer.from(readToken(req));
  const expected = Buffer.from(INBOX_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Invalid inbox token.' });
  }
  next();
}

const READABLE_FILE = /\.(pdf|epub|txt|md|markdown|csv|html?)$/i;
const READABLE_TYPE = /^(application\/pdf|application\/epub\+zip|text\/)/i;

function cleanSubject(subject) {
  return String(subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
}

function htmlToText(html) {
  if (!html) return '';
  const dom = new JSDOM(html);
  dom.window.document.querySelectorAll('script, style').forEach((el) => el.remove());
  dom.window.document.querySelectorAll('p, div, br, li, tr, h1, h2, h3, h4').forEach((el) => el.append(' '));
  return dom.window.document.body?.textContent || '';
}

function firstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : '';
}

// Normalises the different shapes we accept into a list of inbox items:
// plain JSON/form ({ title, text, url }), Postmark inbound JSON, and
// SendGrid / Mailgun inbound multipart posts.
function itemsFromRequest(req) {
  const body = req.body || {};
  const files = Array.isArray(req.files) ? req.files : [];
  const subject = cleanSubject(body.title || body.subject || body.Subject || '');
  const items = [];

  for (const file of files) {
    if (!READABLE_FILE.test(file.originalname || '') && !READABLE_TYPE.test(file.mimetype || '')) continue;
    items.push({ kind: 'file', title: subject, name: file.originalname || 'document', type: file.mimetype, data: file.buffer });
  }
  for (const att of Array.isArray(body.Attachments) ? body.Attachments : []) {
    if (!att?.Content || (!READABLE_FILE.test(att.Name || '') && !READABLE_TYPE.test(att.ContentType || ''))) continue;
    items.push({ kind: 'file', title: subject, name: att.Name || 'document', type: att.ContentType, data: Buffer.from(att.Content, 'base64') });
  }
  if (items.length) return items;

  const url = String(body.url || '').trim();
  let text = String(body.text || body.TextBody || body['stripped-text'] || body['body-plain'] || '').trim();
  if (!text) text = htmlToText(body.html || body.HtmlBody || body['body-html'] || '').trim();

  if (url) return [{ kind: 'url', title: subject, url, text }];
  if (!text) return [];

  // A short email that is basically just a link is treated as "read this article".
  const link = firstUrl(text);
  if (link && text.split(/\s+/).length <= 40) return [{ kind: 'url', title: subject, url: link, text }];
  return [{ kind: 'text', title: subject || text.split(/\s+/).slice(0, 8).join(' '), text }];
}

function metaPath(id) { return path.join(INBOX_DIR, `${id}.json`); }
function dataPath(id) { return path.join(INBOX_DIR, `${id}.bin`); }
function validId(id) { return /^[a-f0-9-]{36}$/.test(id); }

function saveItem(item) {
  const id = crypto.randomUUID();
  const { data, ...meta } = item;
  const record = { id, receivedAt: Date.now(), ...meta, size: data ? data.length : (meta.text || '').length };
  if (data) fs.writeFileSync(dataPath(id), data);
  fs.writeFileSync(metaPath(id), JSON.stringify(record));
  return record;
}

function listItems() {
  return fs.readdirSync(INBOX_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => { try { return JSON.parse(fs.readFileSync(path.join(INBOX_DIR, name), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.receivedAt - b.receivedAt);
}

app.get('/api/status', (_req, res) => res.json({ inbox: Boolean(INBOX_TOKEN) }));

app.post(
  ['/api/inbox', '/api/inbox/email'],
  requireInbox,
  express.json({ limit: '60mb' }),
  express.urlencoded({ extended: false, limit: '20mb' }),
  upload.any(),
  (req, res) => {
    try {
      const items = itemsFromRequest(req);
      if (!items.length) return res.status(400).json({ error: 'Nothing readable was sent. Include text, a url, or a PDF/EPUB/TXT file.' });
      const saved = items.map(saveItem);
      res.status(201).json({ ok: true, items: saved.map(({ id, kind, title, name }) => ({ id, kind, title, name })) });
    } catch (err) {
      console.error('inbox save failed:', err);
      res.status(500).json({ error: 'Could not save to inbox.' });
    }
  }
);

app.get('/api/inbox', requireInbox, (_req, res) => {
  res.json({ items: listItems() });
});

app.get('/api/inbox/:id/file', requireInbox, (req, res) => {
  const { id } = req.params;
  if (!validId(id) || !fs.existsSync(dataPath(id))) return res.status(404).json({ error: 'Not found' });
  const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
  res.type(meta.type || 'application/octet-stream');
  res.sendFile(dataPath(id));
});

app.delete('/api/inbox/:id', requireInbox, (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(metaPath(id), { force: true });
  fs.rmSync(dataPath(id), { force: true });
  res.json({ ok: true });
});

app.use('/api', (err, _req, res, _next) => {
  const tooBig = err?.code === 'LIMIT_FILE_SIZE' || err?.type === 'entity.too.large';
  res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is too large.' : (err.message || 'Bad request') });
});

// If the share sheet posts here before the service worker is installed,
// send the user to the app instead of showing an error page.
app.post('/share', (_req, res) => res.redirect(303, '/?shared=1'));

// ---------- Static app ----------

const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST, {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => console.log(`Running on ${PORT}${INBOX_TOKEN ? ' (inbox enabled)' : ''}`));
