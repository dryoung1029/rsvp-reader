import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { getStatsTracker, announceAchievements, checkAchievements } from "../lib/stats.js";
import { localDay, formatAgo } from "../lib/text.js";
import { Link } from "../router.jsx";
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, TOTAL_POINTS, tierFor } from "../../shared/achievements.js";

const TABS = [
  ["overview", "Overview", "/progress"],
  ["achievements", "Achievements", "/progress/achievements"],
  ["compete", "Compete", "/progress/compete"],
  ["leaderboards", "Leaderboards", "/progress/leaderboards"]
];
const GOAL_PRESETS = [1000, 2500, 5000, 10000];

function minutes(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function monthName(month) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
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

function Badge({ achievement, locked, size }) {
  const tier = tierFor(achievement.points);
  return (
    <span className={`badge tier-${tier}${locked ? " locked" : ""}${size ? ` ${size}` : ""}`} aria-hidden="true">
      {locked && achievement.secret ? "?" : achievement.icon}
    </span>
  );
}

function Meter({ value, max, label }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

// Words read per day for the last 14 days. One series, so no legend: the heading names it.
function DayChart({ days, goal }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, goal || 0, ...days.map((d) => d.words));
  const pow = 10 ** Math.floor(Math.log10(max));
  const niceMax = Math.ceil(max / pow) * pow;
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
        {goal > 0 && (
          <div className="chart-goal" style={{ bottom: `${(goal / niceMax) * 100}%` }} aria-hidden="true">
            <span>Goal</span>
          </div>
        )}
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

function LevelCard({ game }) {
  const { level } = game;
  const span = level.next - level.floor;
  return (
    <section className="panel level-card">
      <div className="level-num" aria-hidden="true">{level.level}</div>
      <div className="level-info">
        <div className="tile-label">Level {level.level}</div>
        <div className="level-title">{level.title}</div>
        <Meter value={level.xp - level.floor} max={span} label="Progress to next level" />
        <div className="muted small">{(level.next - level.xp).toLocaleString()} XP to level {level.level + 1} · {game.points} of {TOTAL_POINTS} achievement points</div>
      </div>
    </section>
  );
}

function GoalCard({ goal, today, onSet }) {
  const [editing, setEditing] = useState(!goal);
  const [custom, setCustom] = useState("");
  const done = goal > 0 && today >= goal;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Daily goal</h2>
        {goal > 0 && !editing && <button className="btn sm ghost" onClick={() => setEditing(true)}>Change</button>}
      </div>
      {goal > 0 && !editing ? (
        <>
          <div className="goal-line"><b>{today.toLocaleString()}</b> <span className="muted">of {goal.toLocaleString()} words today</span>{done && <span className="pill">done</span>}</div>
          <Meter value={today} max={goal} label="Daily goal progress" />
          <div className="muted small">{done ? "Goal reached. Anything more is a bonus." : `${(goal - today).toLocaleString()} words to go, about ${Math.max(1, Math.round((goal - today) / 300))} min at 300 wpm.`}</div>
        </>
      ) : (
        <>
          <p className="muted small">How many words do you want to read each day? Hitting it 7 times earns an achievement.</p>
          <div className="row">
            {GOAL_PRESETS.map((g) => <button key={g} className={`btn sm${g === goal ? " primary" : ""}`} onClick={() => { onSet(g); setEditing(false); }}>{g.toLocaleString()}</button>)}
            <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Number(custom); if (n > 0) { onSet(n); setEditing(false); } }}>
              <input className="field goal-input" type="number" min="100" max="100000" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other" aria-label="Custom daily goal" />
              <button className="btn sm" type="submit">Set</button>
            </form>
            {goal > 0 && <button className="btn sm ghost" onClick={() => { onSet(0); setEditing(false); }}>No goal</button>}
          </div>
        </>
      )}
    </section>
  );
}

function Overview({ stats, game, goal, onSetGoal }) {
  const recent = [...(game?.unlocked || [])].sort((a, b) => b.at - a.at).slice(0, 4);
  return (
    <>
      {game && <LevelCard game={game} />}
      <GoalCard goal={goal} today={stats.today.words} onSet={onSetGoal} />
      <div className="tiles">
        <Tile label="Today" value={stats.today.words.toLocaleString()} sub={`words · ${minutes(stats.today.ms)} · ${(stats.today.verified || 0).toLocaleString()} counted`} />
        <Tile label="Streak" value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`} sub={stats.bestStreak > stats.streak ? `Best: ${stats.bestStreak} days` : stats.streak ? "Your best yet" : "Read today to start one"} />
        <Tile label="This week" value={stats.week.words.toLocaleString()} sub={`words · ${minutes(stats.week.ms)}`} />
        <Tile label="Average speed" value={stats.avgWpm ? `${stats.avgWpm}` : "–"} sub="words per minute, last 30 days" />
      </div>
      <section className="panel">
        <h2>Words per day</h2>
        <DayChart days={stats.days} goal={goal} />
        <div className="muted small">
          All time: {stats.total.words.toLocaleString()} words in {minutes(stats.total.ms)}. {(stats.total.verified || 0).toLocaleString()} of them passed a quiz and count toward achievements and the competition.
        </div>
      </section>
      {recent.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Latest achievements</h2><Link to="/progress/achievements" className="small">See all</Link></div>
          <div className="ach-mini">
            {recent.map((r) => {
              const a = ACHIEVEMENTS_BY_ID[r.id];
              return <div key={r.id} className="ach-mini-item"><Badge achievement={a} /><span><b>{a.title}</b><span className="muted small"> · {formatAgo(r.at)}</span></span></div>;
            })}
          </div>
        </section>
      )}
    </>
  );
}

function Achievements({ game }) {
  const [filter, setFilter] = useState("all");
  if (!game) return <p className="muted">Loading...</p>;
  const unlocked = new Map(game.unlocked.map((u) => [u.id, u.at]));
  const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
  const visible = (a) => filter === "all" || (filter === "unlocked" ? unlocked.has(a.id) : !unlocked.has(a.id));
  return (
    <>
      <section className="panel">
        <div className="ach-summary">
          <div><span className="big-num">{unlocked.size}</span> <span className="muted">of {ACHIEVEMENTS.length} unlocked</span></div>
          <div><span className="big-num">{game.points}</span> <span className="muted">of {TOTAL_POINTS} points</span></div>
        </div>
        <Meter value={game.points} max={TOTAL_POINTS} label="Achievement points" />
        <div className="muted small">Reading counts toward achievements once you pass the 3-question quick check on it. RAFAS offers one after a few minutes of reading.</div>
        <div className="seg" role="group" aria-label="Show">
          {[["all", "All"], ["unlocked", "Unlocked"], ["locked", "Still to get"]].map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </section>
      {groups.map((group) => {
        const items = ACHIEVEMENTS.filter((a) => a.group === group && visible(a));
        if (!items.length) return null;
        return (
          <section key={group} className="panel">
            <h2>{group}</h2>
            <div className="ach-grid">
              {items.map((a) => {
                const at = unlocked.get(a.id);
                const locked = !at;
                const hidden = locked && a.secret;
                const prog = game.progress[a.id];
                return (
                  <div key={a.id} className={`ach${locked ? " locked" : ""}`}>
                    <Badge achievement={a} locked={locked} />
                    <div className="ach-body">
                      <div className="ach-title">{hidden ? "Secret achievement" : a.title}</div>
                      <div className="ach-desc">{hidden ? "Keep reading to find out." : a.desc}</div>
                      {locked && prog && !hidden && (
                        <>
                          <Meter value={prog[0]} max={prog[1]} label={`${a.title} progress`} />
                          <div className="ach-prog">{prog[0].toLocaleString()} / {prog[1].toLocaleString()}</div>
                        </>
                      )}
                      {at && <div className="ach-prog">Unlocked {new Date(at).toLocaleDateString()}</div>}
                    </div>
                    <div className="ach-points">{a.points}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function JoinBoard({ onJoin }) {
  return (
    <section className="panel">
      <h2>Join the family board</h2>
      <p className="muted">
        Monthly competitions and leaderboards are for people on the family board. Joining shares your totals
        (words, streaks, speed, level and achievements) with others on the board. Never what you're reading.
      </p>
      <div><button className="btn primary" onClick={onJoin}>Join the family board</button></div>
    </section>
  );
}

const CATEGORIES = [
  ["words", "Most words", (v) => `${v.toLocaleString()} words`],
  ["speed", "Top speed", (v) => `${v} wpm`, "Fastest sitting of 1,000+ words, in a document of 2,000+ words"],
  ["finished", "Most finished", (v) => `${v} ${v === 1 ? "document" : "documents"}`],
  ["days", "Most days read", (v) => `${v} ${v === 1 ? "day" : "days"}`]
];
const MEDALS = ["🥇", "🥈", "🥉"];

function Ranking({ rows, format, youId }) {
  if (!rows.length) return <div className="muted small">Nobody yet. It's anyone's game.</div>;
  return (
    <ol className="ranking">
      {rows.slice(0, 5).map((r, i) => (
        <li key={r.id} className={r.id === youId ? "you" : ""}>
          <span className="rank">{MEDALS[i] || i + 1}</span>
          <span className="who">{r.name}</span>
          <span className="val">{format(r.value)}</span>
        </li>
      ))}
    </ol>
  );
}

function Compete({ data, user }) {
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <>
      <section className="panel compete-head">
        <div>
          <div className="tile-label">Monthly competition</div>
          <h2>{monthName(data.month)}</h2>
        </div>
        <div className="countdown"><span className="big-num">{data.daysLeft}</span> <span className="muted">{data.daysLeft === 1 ? "day" : "days"} left</span></div>
        <p className="muted small">Only reading that passed a quick check counts. Whoever reads the most words this month is champion. The top 3 earn a podium achievement. Every member of the family board takes part.</p>
      </section>
      <div className="compete-grid">
        {CATEGORIES.map(([key, label, format, hint]) => (
          <section key={key} className="panel">
            <h2>{label}</h2>
            {hint && <div className="muted small">{hint}</div>}
            <Ranking rows={data.standings[key]} format={format} youId={user.id} />
          </section>
        ))}
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>Past champions</h2>
          {data.history.length ? (
            <ul className="history">
              {data.history.map((h) => (
                <li key={h.month}>
                  <span className="muted">{monthName(h.month)}</span>
                  <span>{h.champion ? <>🏆 <b>{h.champion.name}</b> · {h.champion.value.toLocaleString()} words</> : "Not enough readers"}</span>
                </li>
              ))}
            </ul>
          ) : <div className="muted small">The first champion is crowned at the end of this month.</div>}
        </section>
        <section className="panel">
          <h2>Family activity</h2>
          {data.feed.length ? (
            <ul className="feed">
              {data.feed.slice(0, 12).map((f) => {
                const a = ACHIEVEMENTS_BY_ID[f.id];
                return (
                  <li key={`${f.user_id}-${f.id}`}>
                    <Badge achievement={a} size="sm" />
                    <span><b>{f.isYou ? "You" : f.name}</b> unlocked <b>{a.title}</b><span className="muted small"> · {formatAgo(f.at)}</span></span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="muted small">Achievements earned by people on the board show up here.</div>}
        </section>
      </div>
    </>
  );
}

const BOARDS = [
  ["xp", "Level", (m) => `Lv ${m.level} · ${m.xp.toLocaleString()} XP`],
  ["words", "Words", (m) => `${m.words.toLocaleString()}`],
  ["points", "Achievements", (m) => `${m.achievements} · ${m.points} pts`],
  ["bestStreak", "Best streak", (m) => `${m.bestStreak} days`],
  ["topSpeed", "Top speed", (m) => (m.topSpeed ? `${m.topSpeed} wpm` : "–")],
  ["wins", "Titles", (m) => `${m.wins} 🏆`]
];

function Leaderboards({ data }) {
  const [board, setBoard] = useState("xp");
  if (!data) return <p className="muted">Loading...</p>;
  const [, label, format] = BOARDS.find((b) => b[0] === board);
  const rows = [...data.members].sort((a, b) => b[board] - a[board] || b.xp - a.xp);
  return (
    <section className="panel">
      <h2>All-time leaderboards</h2>
      <div className="seg wrap" role="group" aria-label="Leaderboard">
        {BOARDS.map(([k, l]) => <button key={k} className={board === k ? "on" : ""} onClick={() => setBoard(k)}>{l}</button>)}
      </div>
      <div className="table-wrap">
        <table className="list leader">
          <thead><tr><th>#</th><th>Name</th><th>{label}</th><th>Streak now</th></tr></thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.id} className={m.isYou ? "you" : ""}>
                <td className="rank">{MEDALS[i] || i + 1}</td>
                <td><b>{m.name}</b>{m.isYou && <span className="pill">you</span>}<div className="muted small">Lv {m.level} {m.title}</div></td>
                <td>{format(m)}</td>
                <td>{m.streak ? `🔥 ${m.streak}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length < 2 && <div className="muted small">Nobody else is on the board yet. Invite family from your Account page.</div>}
    </section>
  );
}

export default function Progress({ user, setUser, tab }) {
  const [stats, setStats] = useState(null);
  const [game, setGame] = useState(null);
  const [compete, setCompete] = useState(null);
  const [leaders, setLeaders] = useState(null);
  const [error, setError] = useState("");
  const today = localDay();

  async function loadBasics() {
    await getStatsTracker(user.id).flush();
    const [s, g] = await Promise.all([api(`/api/stats?today=${today}`), api(`/api/achievements?today=${today}`)]);
    setStats(s);
    setGame(g);
  }

  useEffect(() => { loadBasics().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (tab === "compete" && user.shareStats) api(`/api/compete?today=${today}`).then(setCompete).catch((e) => setError(e.message));
    if (tab === "leaderboards" && user.shareStats) api(`/api/leaderboards?today=${today}`).then(setLeaders).catch((e) => setError(e.message));
  }, [tab, user.shareStats, today]);

  async function updateMe(body) {
    const result = await api("/api/me", { method: "PATCH", body });
    setUser(result.user);
    await checkAchievements();
    const g = await api(`/api/achievements?today=${today}`);
    setGame(g);
    return result.user;
  }

  async function joinBoard() {
    await updateMe({ shareStats: true });
    setCompete(null);
    setLeaders(null);
    if (tab === "compete") setCompete(await api(`/api/compete?today=${today}`));
    if (tab === "leaderboards") setLeaders(await api(`/api/leaderboards?today=${today}`));
  }

  // Unlock anything already earned (e.g. right after this feature arrives).
  useEffect(() => {
    api(`/api/achievements/check?today=${today}`, { method: "POST" })
      .then(({ unlocked }) => { if (unlocked.length) { announceAchievements(unlocked); return api(`/api/achievements?today=${today}`).then(setGame); } return null; })
      .catch(() => {});
  }, [today]);

  return (
    <div className="page progress">
      <h1>Progress</h1>
      <nav className="tabs" aria-label="Progress sections">
        {TABS.map(([key, label, to]) => <Link key={key} to={to} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}
      </nav>
      {error && <p className="error">{error}</p>}
      {tab === "overview" && (stats ? <Overview stats={stats} game={game} goal={user.dailyGoal || 0} onSetGoal={(g) => updateMe({ dailyGoal: g })} /> : <p className="muted">Loading...</p>)}
      {tab === "achievements" && <Achievements game={game} />}
      {tab === "compete" && (user.shareStats ? <Compete data={compete} user={user} /> : <JoinBoard onJoin={joinBoard} />)}
      {tab === "leaderboards" && (user.shareStats ? <Leaderboards data={leaders} /> : <JoinBoard onJoin={joinBoard} />)}
      {tab === "overview" && (
        <p className="muted small">
          {user.shareStats
            ? <>You're on the family board. <button className="linkish" onClick={() => updateMe({ shareStats: false })}>Leave the board</button></>
            : <>Want to compete? <Link to="/progress/compete">Join the family board</Link>.</>}
        </p>
      )}
    </div>
  );
}
