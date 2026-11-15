import React, { useCallback, useEffect, useState } from "react";
import { Link, navigate, usePath } from "./router.jsx";
import { APP_NAME, APP_LONG_NAME, DEFAULT_INBOX_EMAIL } from "./config.js";
import { setLibraryOwner } from "./lib/library.js";
import Reader from "./Reader.jsx";
import About, { DemoReader } from "./pages/About.jsx";
import Help from "./pages/Help.jsx";
import Privacy from "./pages/Privacy.jsx";
import SignIn from "./pages/SignIn.jsx";
import Account from "./pages/Account.jsx";

const PAGE_TITLES = {
  "/": APP_NAME, "/about": `About · ${APP_NAME}`, "/help": `Help · ${APP_NAME}`, "/privacy": `Privacy · ${APP_NAME}`,
  "/account": `Account · ${APP_NAME}`, "/signin": `Sign in · ${APP_NAME}`, "/verify": `Sign in · ${APP_NAME}`
};

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
};

function initialTheme() {
  const saved = store.get("rsvp:theme");
  if (saved) return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function Landing({ onSignedIn }) {
  return (
    <div className="landing">
      <div className="landing-copy">
        <h1>Read as fast as Swizz.</h1>
        <p className="lede">
          RAFAS shows words one at a time, right where your eyes already are. Add articles, PDFs, books and documents,
          and your library and reading position follow you between your phone and computer.
        </p>
        <DemoReader />
        <p className="muted small"><Link to="/about">What is RAFAS?</Link> · <Link to="/help">Help</Link></p>
      </div>
      <SignIn mode="signin" onSignedIn={onSignedIn} />
    </div>
  );
}

export default function App() {
  const path = usePath();
  // undefined while checking, null when signed out.
  const [user, setUserState] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [theme, setTheme] = useState(initialTheme);

  const setUser = useCallback((next) => {
    setUserState(next);
    if (next) store.set("rafas:user", JSON.stringify(next));
    else store.remove("rafas:user");
  }, []);

  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) return setUser(null);
        const data = await response.json();
        setUser(data.user || null);
      })
      .catch(() => {
        // Offline: keep reading with the local copy of the library.
        try { setUserState(JSON.parse(store.get("rafas:user")) || null); } catch { setUserState(null); }
      });
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfig({}));
  }, [setUser]);

  useEffect(() => {
    store.set("rsvp:theme", theme);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#020617" : "#f8fafc");
  }, [theme]);

  useEffect(() => {
    document.title = PAGE_TITLES[path] || (path.startsWith("/join/") ? `Join · ${APP_NAME}` : APP_NAME);
  }, [path]);

  // Pick the right local library before the reader mounts.
  setLibraryOwner(user?.id || null);

  function onSignedIn(next) {
    setUser(next);
    navigate("/");
  }

  function onSignOut() {
    setUser(null);
    navigate("/");
  }

  function showLibrary() {
    if (window.location.pathname !== "/") navigate("/");
    window.dispatchEvent(new Event("rafas:show-library"));
  }

  const joinMatch = path.match(/^\/join\/([a-z0-9]{6,32})$/i);
  let page = null;

  if (path === "/about") page = <About />;
  else if (path === "/help") page = <Help inboxEmail={config?.inboxEmail || DEFAULT_INBOX_EMAIL} signedIn={Boolean(user)} />;
  else if (path === "/privacy") page = <Privacy />;
  else if (user === undefined) page = <div className="page"><p className="muted">Loading...</p></div>;
  else if (user) {
    if (path === "/account") page = <Account user={user} setUser={setUser} config={config} onSignOut={onSignOut} />;
    else if (joinMatch || path === "/signin" || path === "/verify") {
      page = (
        <div className="auth-card panel">
          <h1>You're signed in</h1>
          <p className="muted">You're signed in as <b>{user.email}</b>. To use a different account, sign out first on the Account page.</p>
          <div className="row"><Link className="btn primary" to="/">Go to my library</Link><Link className="btn" to="/account">Account</Link></div>
        </div>
      );
    } else if (path !== "/") page = <article className="page"><h1>Page not found</h1><p><Link to="/">Back to reading</Link></p></article>;
  } else if (joinMatch) page = <SignIn key={joinMatch[1]} mode="join" inviteCode={joinMatch[1].toLowerCase()} onSignedIn={onSignedIn} />;
  else if (path === "/verify") page = <SignIn mode="verify" onSignedIn={onSignedIn} />;
  else if (path === "/signin" || path === "/" || path === "/account") page = <Landing onSignedIn={onSignedIn} />;
  else page = <article className="page"><h1>Page not found</h1><p><Link to="/">Home</Link></p></article>;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark">RAF<span>A</span>S</span>
          <span className="brand-tag">{APP_LONG_NAME}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {user && <button onClick={showLibrary}>Library</button>}
          <Link to="/help" aria-current={path === "/help" ? "page" : undefined}>Help</Link>
          {!user && <Link to="/about" aria-current={path === "/about" ? "page" : undefined}>About</Link>}
          {user && (
            <Link to="/account" aria-current={path === "/account" ? "page" : undefined} className="avatar-link" title={`Account (${user.email})`}>
              <span className="avatar" aria-hidden="true">{(user.name || user.email || "?").trim()[0].toUpperCase()}</span>
              <span className="sr-only">Account</span>
            </Link>
          )}
          <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Switch theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </nav>
      </header>

      <main className="shell">
        {/* The reader stays mounted while you visit other pages so playback state and position survive. */}
        {user && config && <Reader key={user.id} user={user} config={config} visible={path === "/"} />}
        {page}
      </main>

      <footer className="footer">
        <span>{APP_NAME} · {APP_LONG_NAME}</span>
        <Link to="/help">Help</Link>
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </>
  );
}
