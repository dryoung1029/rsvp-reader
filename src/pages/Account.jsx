import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Link } from "../router.jsx";
import { formatAgo } from "../lib/text.js";

function copy(text, setNote) {
  navigator.clipboard?.writeText(text).then(() => setNote("Copied."), () => setNote("Couldn't copy. Select the text and copy it."));
}

// Notes about unusual activity, for a person to look at. They don't change anyone's score.
function FairPlay() {
  const [notes, setNotes] = useState(null);
  useEffect(() => { api("/api/admin/fairplay").then((r) => setNotes(r.notes)).catch(() => setNotes([])); }, []);
  return (
    <section className="panel">
      <h2>Fair play</h2>
      <p className="muted small">
        Things the app noticed in the last 30 days that a person might want to look at. The rules are already applied
        automatically; nothing here changes anyone's score. Only admins see this.
      </p>
      {notes == null ? <div className="muted small">Loading...</div> : notes.length ? (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Who</th><th>What</th><th>When</th></tr></thead>
            <tbody>
              {notes.slice(0, 60).map((n, i) => (
                <tr key={i}><td><b>{n.name}</b></td><td><span className="pill">{n.kind}</span><div className="muted small">{n.detail}</div></td><td className="small">{formatAgo(n.at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="muted small">Nothing unusual.</div>}
    </section>
  );
}

function InviteAdmin() {
  const [invites, setInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [label, setLabel] = useState("Family");
  const [maxUses, setMaxUses] = useState("10");
  const [days, setDays] = useState("30");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState(null);
  const origin = window.location.origin;

  async function load() {
    const [i, u] = await Promise.all([api("/api/admin/invites"), api("/api/admin/users")]);
    setInvites(i.invites);
    setUsers(u.users);
  }
  useEffect(() => { load().catch((e) => setNote(e.message)); }, []);

  async function createInvite(event) {
    event.preventDefault();
    try {
      const { invite } = await api("/api/admin/invites", { method: "POST", body: { label, maxUses: maxUses || null, days: days || null } });
      setCreated(invite);
      setNote("");
      await load();
    } catch (e) { setNote(e.message); }
  }

  async function revoke(code) {
    if (!window.confirm("Turn off this invite link? People who already joined keep their accounts.")) return;
    await api(`/api/admin/invites/${code}`, { method: "DELETE" });
    if (created?.code === code) setCreated(null);
    await load();
  }

  async function removeUser(user) {
    if (!window.confirm(`Remove ${user.name || user.email}? Their library and settings are deleted and can't be recovered.`)) return;
    await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
    await load();
  }

  function share(invite) {
    const url = `${origin}/join/${invite.code}`;
    const text = "Join me on RAFAS, a speed reader that shows one word at a time. Set up your own library here:";
    if (navigator.share) navigator.share({ title: "Join RAFAS", text, url }).catch(() => {});
    else copy(url, setNote);
  }

  return (
    <>
      <section className="panel">
        <h2>Invite people</h2>
        <p className="muted small">Anyone with an invite link can create their own RAFAS account. Choose how many people can use a link and how long it lasts.</p>
        <form className="invite-form" onSubmit={createInvite}>
          <label>Label<input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Family" maxLength={60} /></label>
          <label>People<input className="field" type="number" min="1" max="1000" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="No limit" /></label>
          <label>Days<input className="field" type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Never expires" /></label>
          <button className="btn primary" type="submit">Create link</button>
        </form>
        {created && (
          <div className="callout">
            <div className="small muted">New invite link</div>
            <div className="code-line">{origin}/join/{created.code}</div>
            <div className="row">
              <button className="btn sm primary" onClick={() => share(created)}>{navigator.share ? "Share" : "Copy link"}</button>
              {navigator.share && <button className="btn sm" onClick={() => copy(`${origin}/join/${created.code}`, setNote)}>Copy link</button>}
            </div>
          </div>
        )}
        {note && <div className="muted small">{note}</div>}
        {invites.length > 0 && (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Link</th><th>Used</th><th>Expires</th><th>Status</th><th /></tr></thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.code}>
                    <td><b>{inv.label || "Invite"}</b><div className="muted small mono">/join/{inv.code}</div></td>
                    <td>{inv.uses}{inv.maxUses != null ? ` of ${inv.maxUses}` : ""}</td>
                    <td className="small">{inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never"}</td>
                    <td className="small">{inv.status}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {inv.status === "active" && <button className="btn sm" onClick={() => share(inv)}>{navigator.share ? "Share" : "Copy"}</button>}
                        {inv.status === "active" && <button className="btn sm ghost" onClick={() => revoke(inv.code)}>Turn off</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Members <span className="muted small">({users.length})</span></h2>
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Name</th><th>Documents</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b>{u.isAdmin && <span className="pill">admin</span>}<div className="muted small">{u.email}</div></td>
                  <td>{u.docCount}</td>
                  <td className="small">{formatAgo(u.lastSeenAt)}</td>
                  <td style={{ textAlign: "right" }}>{!u.isAdmin && <button className="btn sm ghost" onClick={() => removeUser(u)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// "Send to RAFAS" bookmarklet. It opens RAFAS in a small window and hands it the
// page you're on, so articles behind a login or paywall can be saved too.
function bookmarkletCode(origin) {
  const js = `(()=>{const o=${JSON.stringify(origin)};const w=window.open(o+"/add?via=bookmarklet&url="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title),"rafas_add","width=520,height=720");if(!w){location.href=o+"/add?url="+encodeURIComponent(location.href);return}const h=e=>{if(e.origin!==o||e.source!==w||!e.data||e.data.type!=="rafas-ready")return;removeEventListener("message",h);w.postMessage({type:"rafas-page",url:location.href,title:document.title,html:document.documentElement.outerHTML,selection:String(getSelection())},o)};addEventListener("message",h)})()`;
  return `javascript:${encodeURIComponent(js)}`;
}

function Bookmarklet() {
  const ref = useRef(null);
  const code = bookmarkletCode(window.location.origin);
  // Set the href directly: React warns about javascript: links in JSX.
  useEffect(() => { ref.current?.setAttribute("href", code); }, [code]);
  return (
    <section className="panel">
      <h2>Save pages from your computer</h2>
      <p>
        Drag this button to your browser's bookmarks bar. On any article, click it to save the page to your library.
        It works on pages you're signed in to, and if you select some text first, just that text is saved.
      </p>
      <div>
        <a ref={ref} className="btn primary bookmarklet" onClick={(e) => { e.preventDefault(); }} title="Drag me to your bookmarks bar">Send to RAFAS</a>
      </div>
      <p className="muted small">Bookmarks bar hidden? Press Ctrl+Shift+B (Windows) or Cmd+Shift+B (Mac). You may need to allow pop-ups for the site you're saving from.</p>
    </section>
  );
}

// Copies text in a way Safari accepts after an await: the clipboard write is
// started inside the tap, with the text arriving later as a promise.
async function copyLater(textPromise) {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": textPromise.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return true;
    }
    await navigator.clipboard.writeText(await textPromise);
    return true;
  } catch {
    return false;
  }
}

function IphoneSetup({ user, setUser, config }) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const shortcutUrl = config?.shortcutUrl;
  const filesUrl = config?.shortcutFilesUrl;
  const both = shortcutUrl && filesUrl;

  // Reuses the current token, so Shortcuts already installed keep working.
  // Only "Make a new token" replaces it.
  async function makeToken(rotate = false) {
    if (rotate && !window.confirm("Make a new token? Shortcuts using the old token stop working until you paste the new one into them.")) return;
    setBusy(true);
    setNote("");
    const tokenPromise = api("/api/me/inbox-token", { method: "POST", body: rotate ? { rotate: true } : {} }).then((r) => r.token);
    const didCopy = await copyLater(tokenPromise);
    try {
      const value = await tokenPromise;
      setToken(value);
      setCopied(didCopy);
      setUser({ ...user, hasInboxToken: true });
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>iPhone and iPad</h2>

      {config?.inboxEmail && (
        <div className="setup-step">
          <div className="setup-num" aria-hidden="true">A</div>
          <div>
            <p><b>Easiest: share by email.</b> Add RAFAS to your contacts, then on any web page, PDF or file tap Share → Mail → To: RAFAS → Send.</p>
            <div className="row"><a className="btn" href="/api/contact.vcf">Add RAFAS to Contacts</a></div>
          </div>
        </div>
      )}

      <div className="setup-step">
        <div className="setup-num" aria-hidden="true">B</div>
        <div>
          <p>
            <b>Or add a RAFAS button to your Share menu</b> with a Shortcut.
          </p>
          {!token ? (
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => makeToken()}>
                {shortcutUrl ? "Set up the Share button" : user.hasInboxToken ? "Make a new Shortcut token" : "Create Shortcut token"}
              </button>
            </div>
          ) : (
            <div className="callout">
              {shortcutUrl ? (
                <>
                  <div>
                    <b>{copied ? "Your token is copied." : "Copy your token first:"}</b>{" "}
                    {both
                      ? <>Add both Shortcuts, one for links and one for files. Tap each button, then <b>Add Shortcut</b>, and paste the same token when it asks.</>
                      : <>Now tap <b>Get the Shortcut</b>, then <b>Add Shortcut</b>, and paste the token when it asks.</>}
                  </div>
                  {!copied && <div className="code-line">{token}</div>}
                  <div className="row">
                    <a className="btn primary" href={shortcutUrl} target="_blank" rel="noreferrer">{both ? "1. Shortcut for links" : "Get the Shortcut"}</a>
                    {both && <a className="btn primary" href={filesUrl} target="_blank" rel="noreferrer">2. Shortcut for files</a>}
                    <button className="btn sm" onClick={() => copy(token, setNote)}>{copied ? "Copy token again" : "Copy token"}</button>
                  </div>
                  <div className="muted small">Already have the Shortcuts? This is the same token they should hold. If one stopped working, open it in the Shortcuts app and paste this token after <code>Bearer </code> in the Authorization header. <button className="linklike" disabled={busy} onClick={() => makeToken(true)}>Make a new token</button></div>
                  <div className="muted small">If iPhone says it can't open shared shortcuts, turn on Settings → Apps → Shortcuts → Private Sharing (Allow Untrusted Shortcuts on older iOS), then tap the link again.</div>
                </>
              ) : (
                <>
                  <div className="small muted">Your token. It stays the same each time you open this, so your Shortcuts keep working.</div>
                  <div className="code-line">{token}</div>
                  <div className="row"><button className="btn sm primary" onClick={() => copy(token, setNote)}>Copy token</button></div>
                  <div className="muted small">Then follow the <Link to="/help#phone">step-by-step guide</Link> to build the Shortcut.</div>
                </>
              )}
            </div>
          )}
          {note && <div className="muted small">{note}</div>}
        </div>
      </div>
    </section>
  );
}

export default function Account({ user, setUser, config, onSignOut }) {
  const [name, setName] = useState(user.name);
  const [note, setNote] = useState("");
  const inboxEmail = config?.inboxEmail;

  async function saveName(event) {
    event.preventDefault();
    try {
      const result = await api("/api/me", { method: "PATCH", body: { name } });
      setUser(result.user);
      setNote("Name saved.");
    } catch (e) { setNote(e.message); }
  }


  async function signOutEverywhere() {
    if (!window.confirm("Sign out on every device, including this one?")) return;
    await api("/api/auth/signout-all", { method: "POST" });
    onSignOut();
  }

  async function deleteAccount() {
    const answer = window.prompt(`This deletes your account and your whole library. Type DELETE to confirm.`);
    if (answer !== "DELETE") return;
    await api("/api/me", { method: "DELETE" });
    onSignOut();
  }

  return (
    <div className="page account">
      <h1>Account</h1>

      <section className="panel">
        <h2>You</h2>
        <form className="row" onSubmit={saveName}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Your name" />
          <button className="btn" type="submit">Save</button>
        </form>
        <div className="muted small">Signed in as <b>{user.email}</b></div>
        {note && <div className="muted small">{note}</div>}
        <div className="row">
          <button className="btn" onClick={async () => { await api("/api/auth/signout", { method: "POST" }); onSignOut(); }}>Sign out</button>
          <button className="btn ghost" onClick={signOutEverywhere}>Sign out everywhere</button>
        </div>
      </section>

      <section className="panel">
        <h2>Send things to your library</h2>
        {inboxEmail && (
          <p>
            <b>Email:</b> send or forward to <span className="code">{inboxEmail}</span> from <b>{user.email}</b>. Attachments
            (PDF, EPUB, Word, text) and links are added to your library.
          </p>
        )}
        <p><b>Android:</b> install RAFAS and it appears in your Share menu. <Link to="/help#phone">How</Link></p>
      </section>

      <IphoneSetup user={user} setUser={setUser} config={config} />

      <p className="muted small">Questions? See <Link to="/help">Help</Link>.</p>

      <Bookmarklet />

      {user.isAdmin && <InviteAdmin />}
      {user.isAdmin && <FairPlay />}

      <section className="panel">
        <h2>Delete account</h2>
        <p className="muted small">Removes your account and every document in your library from RAFAS.</p>
        <div><button className="btn ghost danger" onClick={deleteAccount}>Delete my account</button></div>
      </section>
    </div>
  );
}
