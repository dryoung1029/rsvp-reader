import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Link } from "../router.jsx";

// Handles three entry points:
//   mode "signin": existing members enter their email
//   mode "join":   someone opened an invite link (/join/<code>)
//   mode "verify": someone tapped the button in the sign-in email (/verify?t=...)
export default function SignIn({ mode, inviteCode, onSignedIn }) {
  const [step, setStep] = useState(mode === "verify" ? "confirm" : "email");
  const [email, setEmail] = useState(() => sessionStorage.getItem("rafas:pendingEmail") || "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState(mode === "join" ? { loading: true } : null);
  const [isNew, setIsNew] = useState(false);
  const codeRef = useRef(null);

  useEffect(() => {
    if (mode !== "join") return;
    fetch(`/api/invites/${encodeURIComponent(inviteCode)}`)
      .then((r) => r.json())
      .then((data) => setInvite(data.valid ? data : { invalid: true }))
      .catch(() => setInvite({ invalid: true }));
  }, [mode, inviteCode]);

  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  async function sendCode(event) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = { email };
      if (mode === "join") Object.assign(body, { invite: inviteCode, name });
      const result = await api("/api/auth/start", { method: "POST", body });
      sessionStorage.setItem("rafas:pendingEmail", email.trim());
      setStep("code");
      setIsNew(Boolean(result.isNew));
      setCode(result.devCode || "");
      setNotice(result.devCode ? `Local development: your code is ${result.devCode}.` : "");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(body) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/auth/verify", { method: "POST", body });
      sessionStorage.removeItem("rafas:pendingEmail");
      onSignedIn(result.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function submitCode(event) {
    event.preventDefault();
    verify({ email, code, name });
  }

  function onCodeChange(value) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    // Auto-submit once all six digits are in, unless we still need a name.
    if (digits.length === 6 && !busy && !(isNew && mode !== "join" && !name.trim())) verify({ email, code: digits, name });
  }

  if (mode === "verify") {
    const token = new URLSearchParams(window.location.search).get("t") || "";
    return (
      <div className="auth-card panel">
        <h1>Sign in to RAFAS</h1>
        {token ? (
          <>
            <p className="muted">Tap the button to finish signing in on this device.</p>
            <button className="btn primary" disabled={busy} onClick={() => verify({ token })}>{busy ? "Signing in..." : "Sign in"}</button>
          </>
        ) : <p className="muted">This sign-in link is incomplete. Request a new one.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {error && <Link to="/signin">Request a new sign-in email</Link>}
      </div>
    );
  }

  if (mode === "join" && invite?.loading) return <div className="auth-card panel"><p className="muted">Checking your invite...</p></div>;
  if (mode === "join" && invite?.invalid) {
    return (
      <div className="auth-card panel">
        <h1>This invite has expired</h1>
        <p className="muted">The link is no longer active. Ask the person who sent it for a new one.</p>
        <p className="muted small">Already have an account? <Link to="/signin">Sign in</Link></p>
      </div>
    );
  }

  return (
    <div className="auth-card panel">
      {mode === "join" ? (
        <>
          <h1>You're invited</h1>
          <p className="muted">
            {invite?.invitedBy ? `${invite.invitedBy} invited you to RAFAS` : "You've been invited to RAFAS"}, a speed reader that shows one word at a time.
            Create your account to get your own library.
          </p>
        </>
      ) : (
        <>
          <h1>Sign in</h1>
          <p className="muted">We'll email you a 6-digit code. No password needed.</p>
        </>
      )}

      {step === "email" ? (
        <form onSubmit={sendCode} className="auth-form">
          {mode === "join" && (
            <label>Your name
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />
            </label>
          )}
          <label>Email
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" autoCapitalize="off" required />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Sending..." : mode === "join" ? "Create account" : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="auth-form">
          <p>We sent a code to <b>{email}</b>. It expires in 15 minutes.</p>
          {isNew && mode !== "join" && (
            <label>Your name
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />
            </label>
          )}
          <label>6-digit code
            <input
              ref={codeRef}
              className="field code-input"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking..." : "Sign in"}</button>
          <div className="row small">
            <button type="button" className="linkish" onClick={() => sendCode()}>Send a new code</button>
            <span className="muted">·</span>
            <button type="button" className="linkish" onClick={() => { setStep("email"); setCode(""); setError(""); setNotice(""); }}>Use a different email</button>
          </div>
          <p className="muted small">You can also tap the button in the email. On iPhone, if RAFAS is on your Home Screen, type the code here instead: the button opens Safari.</p>
        </form>
      )}

      {notice && <p className="muted small">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {mode === "signin" && <p className="muted small">New to RAFAS? You'll need an invite link from someone who uses it.</p>}
      {mode === "join" && <p className="muted small">Already have an account? <Link to="/signin">Sign in</Link></p>}
    </div>
  );
}
