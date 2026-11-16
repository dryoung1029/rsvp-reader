import {
  HttpError, json, randomToken, randomCode, randomDigits, sha256, escHtml,
  normalizeEmail, cleanName, readJson, clientIp, appOrigin, isLocal
} from "./util.js";

const SESSION_DAYS = 120;
const CODE_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
const MAX_CODES_PER_IP_PER_HOUR = 20;
const DAY = 24 * 60 * 60 * 1000;

function cookieName(request) {
  // The __Host- prefix requires https; local dev runs on http://localhost.
  return new URL(request.url).protocol === "https:" ? "__Host-rafas_session" : "rafas_session";
}

function sessionCookie(request, token, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${cookieName(request)}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || "").split(",").map(normalizeEmail).filter(Boolean);
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: Boolean(user.is_admin),
    hasInboxToken: Boolean(user.inbox_token_hash),
    shareStats: Boolean(user.share_stats),
    dailyGoal: user.daily_goal || 0,
    createdAt: user.created_at
  };
}

// ---------- Sessions ----------

export async function getUser(request, env) {
  const token = readCookie(request, cookieName(request));
  if (!token) return null;
  const hash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.*, s.last_used_at AS s_last_used FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(hash, now).first();
  if (!row) return null;
  // Sliding expiry, refreshed at most once a day to keep writes low.
  if (now - row.s_last_used > DAY) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?").bind(now, now + SESSION_DAYS * DAY, hash),
      env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, row.id)
    ]);
  }
  return row;
}

// Cookie-authenticated writes must carry a custom header, which a cross-site
// form or image can't send. That plus SameSite=Lax blocks CSRF.
export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.");
  if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("x-rafas") !== "1") {
    throw new HttpError(403, "Missing request header.");
  }
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user.is_admin) throw new HttpError(403, "Only admins can do that.");
  return user;
}

async function createSession(request, env, userId) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, user_agent, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(await sha256(token), userId, (request.headers.get("user-agent") || "").slice(0, 200), now, now, now + SESSION_DAYS * DAY).run();
  return sessionCookie(request, token, SESSION_DAYS * 24 * 60 * 60);
}

// ---------- Invites ----------

async function findUsableInvite(env, code) {
  if (!code) return null;
  const invite = await env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(String(code).toLowerCase()).first();
  if (!invite || invite.revoked) return null;
  if (invite.expires_at && invite.expires_at < Date.now()) return null;
  if (invite.max_uses != null && invite.uses >= invite.max_uses) return null;
  return invite;
}

// ---------- Email ----------

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[email not sent: RESEND_API_KEY missing] to=${to} subject=${subject}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "RAFAS <signin@rafas.app>",
      to: [to],
      subject: String(subject).replace(/[\r\n]/g, " ").slice(0, 200),
      html,
      text
    })
  });
  if (!response.ok) {
    console.error("Resend error", response.status, await response.text());
    throw new HttpError(502, "We couldn't send the email. Please try again in a minute.");
  }
}

function signInEmail({ code, link, isNew }) {
  const heading = isNew ? "Welcome to RAFAS" : "Sign in to RAFAS";
  const text = `${heading}\n\nYour code is ${code}\n\nOr open this link to sign in: ${link}\n\nThe code and link work once and expire in ${CODE_MINUTES} minutes. If you didn't ask for this, you can ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:900;font-size:22px;letter-spacing:.04em">RAF<span style="color:#ef4444">A</span>S</div>
    <h1 style="font-size:22px;margin:24px 0 8px">${escHtml(heading)}</h1>
    <p style="margin:0 0 16px;color:#475569">Enter this code in the app:</p>
    <div style="font-size:34px;font-weight:900;letter-spacing:.2em;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;text-align:center">${escHtml(code)}</div>
    <p style="margin:24px 0 12px;color:#475569">Or sign in with this button:</p>
    <a href="${escHtml(link)}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:12px">Sign in to RAFAS</a>
    <p style="margin:24px 0 0;color:#64748b;font-size:14px">On iPhone, if you added RAFAS to your Home Screen, open it and type the code there. The button signs you in to Safari instead.</p>
    <p style="margin:16px 0 0;color:#64748b;font-size:14px">The code and button work once and expire in ${CODE_MINUTES} minutes. If you didn't ask for this, you can ignore this email.</p>
  </div></body></html>`;
  return { subject: isNew ? `Your RAFAS code: ${code}` : `Your RAFAS sign-in code: ${code}`, html, text };
}

// ---------- Handlers ----------

async function startSignIn(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, "Please enter a valid email address.");
  const name = cleanName(body.name);
  const now = Date.now();
  const ip = clientIp(request);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  let inviteCode = null;
  if (!existing && !adminEmails(env).includes(email)) {
    const invite = await findUsableInvite(env, body.invite);
    if (!invite) {
      throw new HttpError(body.invite ? 410 : 404, body.invite
        ? "This invite link has expired or been used up. Ask for a new one."
        : "There's no RAFAS account for that email. You need an invite link to join.");
    }
    inviteCode = invite.code;
  }

  const hourAgo = now - 60 * 60 * 1000;
  const counts = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?").bind(email, hourAgo),
    env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE ip = ? AND created_at > ?").bind(ip, hourAgo)
  ]);
  if (counts[0].results[0].n >= MAX_CODES_PER_EMAIL_PER_HOUR || counts[1].results[0].n >= MAX_CODES_PER_IP_PER_HOUR) {
    throw new HttpError(429, "Too many sign-in emails. Please wait a while and try again.");
  }

  const id = crypto.randomUUID();
  const code = randomDigits(6);
  const linkToken = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO login_codes (id, email, code_hash, link_hash, invite_code, name, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, email, await sha256(`${id}:${code}`), await sha256(linkToken), inviteCode, name, ip, now, now + CODE_MINUTES * 60 * 1000).run();

  // Housekeeping: drop old codes now and then.
  if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM login_codes WHERE created_at < ?").bind(now - 7 * DAY).run();

  const link = `${appOrigin(request, env)}/verify?t=${encodeURIComponent(linkToken)}`;
  await sendEmail(env, { to: email, ...signInEmail({ code, link, isNew: !existing }) });

  const result = { ok: true, isNew: !existing };
  // Local development without email: hand the code back so you can sign in.
  if (env.DEV_RETURN_LOGIN_CODE === "1" && isLocal(request)) Object.assign(result, { devCode: code, devLink: link });
  return json(result);
}

async function completeSignIn(request, env, row, nameFromForm) {
  const now = Date.now();
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0").bind(row.email).run();

  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(row.email).first();
  if (!user) {
    const isAdmin = adminEmails(env).includes(row.email);
    if (!isAdmin) {
      // Claim a use of the invite atomically, so a link can't be used more times than allowed.
      const claim = await env.DB.prepare(
        `UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked = 0
         AND (max_uses IS NULL OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)`
      ).bind(row.invite_code, now).run();
      if (!claim.meta.changes) throw new HttpError(410, "This invite link has expired or been used up. Ask for a new one.");
    }
    const id = crypto.randomUUID();
    const name = cleanName(nameFromForm) || row.name || row.email.split("@")[0];
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, is_admin, invite_code, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, row.email, name, isAdmin ? 1 : 0, row.invite_code, now, now).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  } else if (!user.is_admin && adminEmails(env).includes(user.email)) {
    await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(user.id).run();
    user.is_admin = 1;
  }

  const cookie = await createSession(request, env, user.id);
  return json({ ok: true, user: publicUser(user) }, 200, { "set-cookie": cookie });
}

async function verifySignIn(request, env) {
  const body = await readJson(request);
  const now = Date.now();

  if (body.token) {
    const row = await env.DB.prepare("SELECT * FROM login_codes WHERE link_hash = ?").bind(await sha256(String(body.token))).first();
    if (!row || row.used || row.expires_at < now) throw new HttpError(400, "That sign-in link has expired or was already used. Request a new one.");
    return completeSignIn(request, env, row, body.name);
  }

  const email = normalizeEmail(body.email);
  const code = String(body.code || "").replace(/\D/g, "");
  if (!email || code.length !== 6) throw new HttpError(400, "Enter the 6-digit code from the email.");

  const { results } = await env.DB.prepare(
    "SELECT * FROM login_codes WHERE email = ? AND used = 0 AND expires_at > ? AND attempts < ? ORDER BY created_at DESC LIMIT 3"
  ).bind(email, now, MAX_CODE_ATTEMPTS).all();
  if (!results.length) throw new HttpError(400, "That code has expired. Request a new one.");

  for (const row of results) {
    if ((await sha256(`${row.id}:${code}`)) === row.code_hash) return completeSignIn(request, env, row, body.name);
  }
  await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND used = 0").bind(email).run();
  throw new HttpError(400, "That code isn't right. Check the latest email and try again.");
}

async function signOut(request, env, everywhere) {
  const token = readCookie(request, cookieName(request));
  if (token) {
    if (everywhere) {
      const user = await getUser(request, env);
      if (user) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
    } else {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    }
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
}

// ---------- Router ----------

export async function handleAuth(request, env, pathname) {
  const method = request.method;

  if (pathname === "/api/auth/start" && method === "POST") return startSignIn(request, env);
  if (pathname === "/api/auth/verify" && method === "POST") return verifySignIn(request, env);
  if (pathname === "/api/auth/signout" && method === "POST") return signOut(request, env, false);
  if (pathname === "/api/auth/signout-all" && method === "POST") { await requireUser(request, env); return signOut(request, env, true); }

  if (pathname === "/api/me") {
    if (method === "GET") {
      const user = await getUser(request, env);
      return user ? json({ user: publicUser(user) }) : json({ user: null }, 401);
    }
    if (method === "PATCH") {
      const user = await requireUser(request, env);
      const body = await readJson(request);
      const next = { ...user };
      if (body.name !== undefined) {
        next.name = cleanName(body.name);
        if (!next.name) throw new HttpError(400, "Please enter a name.");
      }
      if (body.shareStats !== undefined) next.share_stats = body.shareStats ? 1 : 0;
      if (body.dailyGoal !== undefined) next.daily_goal = Math.max(0, Math.min(100000, Math.floor(Number(body.dailyGoal) || 0)));
      await env.DB.prepare("UPDATE users SET name = ?, share_stats = ?, daily_goal = ? WHERE id = ?").bind(next.name, next.share_stats, next.daily_goal || 0, user.id).run();
      return json({ user: publicUser(next) });
    }
    if (method === "DELETE") {
      const user = await requireUser(request, env);
      await deleteUserData(env, user.id);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
    }
  }

  // A personal token for the iPhone Shortcut / scripts. Shown once; only the hash is kept.
  if (pathname === "/api/me/inbox-token" && method === "POST") {
    const user = await requireUser(request, env);
    const token = `rafas_${randomToken(24)}`;
    await env.DB.prepare("UPDATE users SET inbox_token_hash = ? WHERE id = ?").bind(await sha256(token), user.id).run();
    return json({ token });
  }

  // Other members, for "Send to…". Names only.
  if (pathname === "/api/members" && method === "GET") {
    const user = await requireUser(request, env);
    const { results } = await env.DB.prepare("SELECT id, name FROM users WHERE id != ? ORDER BY name COLLATE NOCASE").bind(user.id).all();
    return json({ members: results });
  }

  const inviteMatch = pathname.match(/^\/api\/invites\/([a-z0-9]{6,32})$/);
  if (inviteMatch && method === "GET") {
    const invite = await findUsableInvite(env, inviteMatch[1]);
    if (!invite) return json({ valid: false }, 404);
    const inviter = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(invite.created_by).first();
    return json({ valid: true, label: invite.label, invitedBy: inviter?.name || "" });
  }

  if (pathname === "/api/admin/invites") {
    const admin = await requireAdmin(request, env);
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM invites ORDER BY created_at DESC LIMIT 100").all();
      return json({ invites: results.map(inviteView) });
    }
    if (method === "POST") {
      const body = await readJson(request);
      const maxUses = body.maxUses == null || body.maxUses === "" ? null : Math.max(1, Math.min(1000, Number(body.maxUses) || 1));
      const days = body.days == null || body.days === "" ? null : Math.max(1, Math.min(365, Number(body.days) || 30));
      const code = randomCode(10);
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO invites (code, label, created_by, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(code, cleanName(body.label), admin.id, maxUses, days ? now + days * DAY : null, now).run();
      const invite = await env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first();
      return json({ invite: inviteView(invite) }, 201);
    }
  }

  const revokeMatch = pathname.match(/^\/api\/admin\/invites\/([a-z0-9]{6,32})$/);
  if (revokeMatch && method === "DELETE") {
    await requireAdmin(request, env);
    await env.DB.prepare("UPDATE invites SET revoked = 1 WHERE code = ?").bind(revokeMatch[1]).run();
    return json({ ok: true });
  }

  if (pathname === "/api/admin/users" && method === "GET") {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.last_seen_at,
              (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id) AS doc_count
       FROM users u ORDER BY u.created_at`
    ).all();
    return json({ users: results.map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: Boolean(u.is_admin), createdAt: u.created_at, lastSeenAt: u.last_seen_at, docCount: u.doc_count })) });
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
  if (userMatch && method === "DELETE") {
    const admin = await requireAdmin(request, env);
    if (userMatch[1] === admin.id) throw new HttpError(400, "You can't remove your own account here.");
    await deleteUserData(env, userMatch[1]);
    return json({ ok: true });
  }

  return null;
}

function inviteView(invite) {
  const now = Date.now();
  const status = invite.revoked ? "turned off"
    : invite.expires_at && invite.expires_at < now ? "expired"
    : invite.max_uses != null && invite.uses >= invite.max_uses ? "used up" : "active";
  return { code: invite.code, label: invite.label, maxUses: invite.max_uses, uses: invite.uses, expiresAt: invite.expires_at, createdAt: invite.created_at, status };
}

export async function deleteUserData(env, userId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM document_text WHERE doc_id IN (SELECT id FROM documents WHERE user_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM documents WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM reading_days WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM reading_sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM user_events WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM achievements WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM quizzes WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId)
  ]);
  if (env.INBOX) {
    let cursor;
    do {
      const page = await env.INBOX.list({ prefix: `item:${userId}:`, cursor });
      await Promise.all(page.keys.map((k) => env.INBOX.delete(k.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}
