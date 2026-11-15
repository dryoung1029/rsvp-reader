import React, { useEffect, useRef, useState } from "react";
import { ACHIEVEMENTS_BY_ID, tierFor } from "../../shared/achievements.js";
import { navigate } from "../router.jsx";

// Pop-ups for unlocked achievements and other good news, one at a time.
export default function Toasts() {
  const [queue, setQueue] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    const onAchievements = (e) => {
      const items = e.detail.map((id) => ACHIEVEMENTS_BY_ID[id]).filter(Boolean).map((a) => ({
        key: `a-${a.id}-${Date.now()}`, icon: a.icon, kicker: "Achievement unlocked", title: a.title, body: a.desc,
        points: a.points, tier: tierFor(a.points), to: "/progress/achievements"
      }));
      setQueue((q) => [...q, ...items]);
    };
    const onToast = (e) => setQueue((q) => [...q, { key: `t-${Date.now()}`, kicker: "", ...e.detail }]);
    window.addEventListener("rafas:achievements", onAchievements);
    window.addEventListener("rafas:toast", onToast);
    return () => {
      window.removeEventListener("rafas:achievements", onAchievements);
      window.removeEventListener("rafas:toast", onToast);
    };
  }, []);

  const current = queue[0];
  useEffect(() => {
    if (!current) return undefined;
    timer.current = setTimeout(() => setQueue((q) => q.slice(1)), 5000);
    return () => clearTimeout(timer.current);
  }, [current]);

  if (!current) return null;
  return (
    <div className="toast-wrap" aria-live="polite">
      <button
        key={current.key}
        className={`toast ${current.tier ? `tier-${current.tier}` : ""}`}
        onClick={() => { setQueue((q) => q.slice(1)); if (current.to) navigate(current.to); }}
      >
        <span className={`badge ${current.tier ? `tier-${current.tier}` : ""}`} aria-hidden="true">{current.icon}</span>
        <span className="toast-text">
          {current.kicker && <span className="toast-kicker">{current.kicker}</span>}
          <span className="toast-title">{current.title}</span>
          {current.body && <span className="toast-body">{current.body}</span>}
        </span>
        {current.points ? <span className="toast-points">+{current.points}</span> : null}
        {queue.length > 1 && <span className="toast-more">+{queue.length - 1} more</span>}
      </button>
    </div>
  );
}
