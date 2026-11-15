import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { getStatsTracker } from "../lib/stats.js";
import { localDay } from "../lib/text.js";

function minutes(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

// Words read per day for the last 14 days. One series, so no legend: the heading names it.
function DayChart({ days }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...days.map((d) => d.words));
  const niceMax = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / pow) * pow;
  })();
  const label = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const active = hover != null ? days[hover] : null;
  return (
    <figure className="chart" aria-label="Words read per day, last 14 days">
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          <span>{niceMax.toLocaleString()}</span>
          <span>{Math.round(niceMax / 2).toLocaleString()}</span>
          <span>0</span>
        </div>
        <div className="chart-bars" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className={`chart-col${hover === i ? " active" : ""}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              aria-label={`${label(d.day)}: ${d.words.toLocaleString()} words, ${minutes(d.ms)}`}
            >
              <span className="chart-bar" style={{ height: `${(d.words / niceMax) * 100}%` }} />
            </button>
          ))}
        </div>
        {active && (
          <div className="chart-tip" style={{ left: `calc(44px + (100% - 44px) * ${Math.min(0.88, Math.max(0.12, (hover + 0.5) / days.length))})` }} role="status">
            <b>{label(active.day)}</b>
            <span>{active.words.toLocaleString()} words</span>
            <span>{minutes(active.ms)} reading</span>
          </div>
        )}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {days.map((d, i) => <span key={d.day}>{i % 2 === (days.length - 1) % 2 ? label(d.day).split(" ")[0].slice(0, 2) : ""}</span>)}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="list">
          <thead><tr><th>Day</th><th>Words</th><th>Time</th></tr></thead>
          <tbody>{[...days].reverse().map((d) => <tr key={d.day}><td>{label(d.day)}</td><td>{d.words.toLocaleString()}</td><td>{minutes(d.ms)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export default function Progress({ user, setUser }) {
  const [stats, setStats] = useState(null);
  const [family, setFamily] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    const today = localDay();
    await getStatsTracker(user.id).flush();
    const [s, f] = await Promise.all([
      api(`/api/stats?today=${today}`),
      api(`/api/stats/family?today=${today}`)
    ]);
    setStats(s);
    setFamily(f);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function setSharing(on) {
    const result = await api("/api/me", { method: "PATCH", body: { shareStats: on } });
    setUser(result.user);
    await load();
  }

  if (error) return <div className="page"><h1>Progress</h1><p className="error">{error}</p></div>;
  if (!stats) return <div className="page"><h1>Progress</h1><p className="muted">Loading...</p></div>;

  const nothingYet = !stats.total.words;
  return (
    <div className="page progress">
      <h1>Progress</h1>
      {nothingYet && <p className="muted">Press Play on something and your reading will show up here. Words count while words are flashing.</p>}

      <div className="tiles">
        <Tile label="Today" value={stats.today.words.toLocaleString()} sub={`words · ${minutes(stats.today.ms)}`} />
        <Tile label="Streak" value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`} sub={stats.bestStreak > stats.streak ? `Best: ${stats.bestStreak} days` : stats.streak ? "Your best yet" : "Read today to start one"} />
        <Tile label="This week" value={stats.week.words.toLocaleString()} sub={`words · ${minutes(stats.week.ms)}`} />
        <Tile label="Average speed" value={stats.avgWpm ? `${stats.avgWpm}` : "–"} sub="words per minute, last 30 days" />
      </div>

      <section className="panel">
        <h2>Words per day</h2>
        <DayChart days={stats.days} />
        <div className="muted small">All time: {stats.total.words.toLocaleString()} words in {minutes(stats.total.ms)}.</div>
      </section>

      <section className="panel">
        <h2>Family board</h2>
        {family?.optedIn ? (
          <>
            <div className="table-wrap">
              <table className="list">
                <thead><tr><th>Name</th><th>This week</th><th>Streak</th><th>Avg speed</th></tr></thead>
                <tbody>
                  {family.members.map((m) => (
                    <tr key={m.id} className={m.isYou ? "you" : ""}>
                      <td><b>{m.name}</b>{m.isYou && <span className="pill">you</span>}</td>
                      <td>{m.weekWords.toLocaleString()} words</td>
                      <td>{m.streak} {m.streak === 1 ? "day" : "days"}</td>
                      <td>{m.avgWpm ? `${m.avgWpm} wpm` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {family.members.length < 2 && <div className="muted small">Nobody else has joined the board yet.</div>}
            <div className="muted small">Only totals are shared, never what you're reading. <button className="linkish" onClick={() => setSharing(false)}>Leave the board</button></div>
          </>
        ) : (
          <>
            <p className="muted">
              See how everyone's doing: words read this week, streaks and average speed. Only people who join can see
              the board, and only totals are shown, never what you're reading.
            </p>
            <div><button className="btn primary" onClick={() => setSharing(true)}>Join the family board</button></div>
          </>
        )}
      </section>
    </div>
  );
}
