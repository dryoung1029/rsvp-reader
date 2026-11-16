// Achievement definitions, shared by the Worker (which awards them) and the
// app (which shows them). Each `check` gets the context built in
// worker/game.js; `progress` returns [current, target] for the progress bar.
//
// Points: 5 (easy) to 100 (legendary). Secret achievements show "???" until earned.

// Speed only counts in documents at least this long, so a short or made-up
// passage can't be used to rack up speed records.
export const SPEED_MIN_DOC_WORDS = 2000;

export const TIERS = [
  { min: 100, name: "legendary" },
  { min: 40, name: "gold" },
  { min: 15, name: "silver" },
  { min: 0, name: "bronze" }
];
export const tierFor = (points) => TIERS.find((t) => points >= t.min).name;

const words = (n) => ({ progress: (c) => [c.totalWords, n], check: (c) => c.totalWords >= n });
const streak = (n) => ({ progress: (c) => [c.bestStreak, n], check: (c) => c.bestStreak >= n });
const speed = (wpm, minWords) => ({
  progress: (c) => [Math.min(c.bestWpm[minWords] || 0, wpm), wpm],
  check: (c) => (c.bestWpm[minWords] || 0) >= wpm
});

export const ACHIEVEMENTS = [
  // Getting started
  { id: "first_words", group: "Getting started", icon: "✨", title: "First Flash", desc: "Read your first 100 words.", points: 5, ...words(100) },
  { id: "settling_in", group: "Getting started", icon: "☕", title: "Settling In", desc: "Spend 10 minutes reading.", points: 5, progress: (c) => [Math.floor(c.totalMs / 60000), 10], check: (c) => c.totalMs >= 600000 },
  { id: "the_end", group: "Getting started", icon: "🏁", title: "The End", desc: "Finish a document.", points: 10, progress: (c) => [c.finished, 1], check: (c) => c.finished >= 1 },
  { id: "goal_setter", group: "Getting started", icon: "🎯", title: "Goal Setter", desc: "Set a daily reading goal.", points: 5, check: (c) => c.dailyGoal > 0 },

  // Volume
  { id: "words_10k", group: "Volume", icon: "📄", title: "Ten Thousand", desc: "Read 10,000 words.", points: 10, ...words(10000) },
  { id: "words_100k", group: "Volume", icon: "📚", title: "Novel Length", desc: "Read 100,000 words, about one novel.", points: 25, ...words(100000) },
  { id: "words_500k", group: "Volume", icon: "🏛️", title: "Half a Million", desc: "Read 500,000 words.", points: 50, ...words(500000) },
  { id: "words_1m", group: "Volume", icon: "💎", title: "Millionaire", desc: "Read 1,000,000 words.", points: 100, ...words(1000000) },
  { id: "big_day", group: "Volume", icon: "☀️", title: "Big Day", desc: "Read 5,000 words in one day.", points: 15, progress: (c) => [c.maxDayWords, 5000], check: (c) => c.maxDayWords >= 5000 },
  { id: "marathon", group: "Volume", icon: "🏃", title: "Marathon", desc: "Read 20,000 words in one day.", points: 40, progress: (c) => [c.maxDayWords, 20000], check: (c) => c.maxDayWords >= 20000 },
  { id: "in_the_zone", group: "Volume", icon: "🧘", title: "In the Zone", desc: "Read 3,000 words without pausing.", points: 15, progress: (c) => [c.longestSession, 3000], check: (c) => c.longestSession >= 3000 },

  // Speed: the speed setting you held for a whole sitting of at least 500 (or 1,000) words,
  // in a document of at least SPEED_MIN_DOC_WORDS words, and passed the quiz on it
  { id: "speed_300", group: "Speed", icon: "🚲", title: "Cruising", desc: "Read 500 words in one sitting at 300 wpm or faster, in a full-length document.", points: 5, ...speed(300, 500) },
  { id: "speed_400", group: "Speed", icon: "🛵", title: "Picking Up Pace", desc: "Read 500 words in one sitting at 400 wpm or faster, in a full-length document.", points: 10, ...speed(400, 500) },
  { id: "speed_500", group: "Speed", icon: "🚗", title: "Fast Lane", desc: "Read 500 words in one sitting at 500 wpm or faster, in a full-length document.", points: 20, ...speed(500, 500) },
  { id: "speed_swizz", group: "Speed", icon: "⚡", title: "Read As Fast As Swizz", desc: "Read 1,000 words in one sitting at 600 wpm or faster, in a full-length document.", points: 40, ...speed(600, 1000) },
  { id: "speed_750", group: "Speed", icon: "🚄", title: "Blur", desc: "Read 1,000 words in one sitting at 750 wpm or faster, in a full-length document.", points: 60, ...speed(750, 1000) },
  { id: "speed_900", group: "Speed", icon: "🚀", title: "Light Speed", desc: "Read 1,000 words in one sitting at 900 wpm or faster, in a full-length document.", points: 100, ...speed(900, 1000) },

  // Streaks
  { id: "streak_3", group: "Streaks", icon: "🔥", title: "Three in a Row", desc: "Read 3 days in a row.", points: 10, ...streak(3) },
  { id: "streak_7", group: "Streaks", icon: "📅", title: "Full Week", desc: "Read 7 days in a row.", points: 20, ...streak(7) },
  { id: "streak_30", group: "Streaks", icon: "🗓️", title: "Habit Formed", desc: "Read 30 days in a row.", points: 50, ...streak(30) },
  { id: "streak_100", group: "Streaks", icon: "💯", title: "Centurion", desc: "Read 100 days in a row.", points: 100, ...streak(100) },
  { id: "on_target", group: "Streaks", icon: "✅", title: "On Target", desc: "Hit your daily goal on 7 different days.", points: 25, progress: (c) => [c.goalDays, 7], check: (c) => c.goalDays >= 7 },
  { id: "weekender", group: "Streaks", icon: "🛋️", title: "Weekender", desc: "Read on a Saturday and the Sunday after it.", points: 10, check: (c) => c.weekend },

  // Finishing
  { id: "finish_5", group: "Finishing", icon: "📗", title: "Shelf Builder", desc: "Finish 5 documents.", points: 15, progress: (c) => [c.finished, 5], check: (c) => c.finished >= 5 },
  { id: "finish_25", group: "Finishing", icon: "🗄️", title: "Library Card", desc: "Finish 25 documents.", points: 40, progress: (c) => [c.finished, 25], check: (c) => c.finished >= 25 },
  { id: "cover_to_cover", group: "Finishing", icon: "📖", title: "Cover to Cover", desc: "Finish a document of 50,000 words or more.", points: 50, progress: (c) => [c.biggestFinished, 50000], check: (c) => c.biggestFinished >= 50000 },
  { id: "omnivore", group: "Finishing", icon: "🍽️", title: "Omnivore", desc: "Add documents from 3 different places (file, web, email, phone share…).", points: 15, progress: (c) => [c.sources, 3], check: (c) => c.sources >= 3 },

  // Time of day (secret)
  { id: "night_owl", group: "Secret", icon: "🦉", title: "Night Owl", desc: "Read after 10 pm.", points: 10, secret: true, check: (c) => c.nightOwl },
  { id: "early_bird", group: "Secret", icon: "🐦", title: "Early Bird", desc: "Read between 4 and 7 am.", points: 10, secret: true, check: (c) => c.earlyBird },

  // Family
  { id: "joined_board", group: "Family", icon: "👋", title: "Joined the Board", desc: "Join the family board.", points: 5, check: (c) => c.onBoard },
  { id: "pass_it_on", group: "Family", icon: "📨", title: "Pass It On", desc: "Send a document to someone.", points: 10, progress: (c) => [c.sent, 1], check: (c) => c.sent >= 1 },
  { id: "book_club", group: "Family", icon: "☕", title: "Book Club", desc: "Send 10 documents to family.", points: 25, progress: (c) => [c.sent, 10], check: (c) => c.sent >= 10 },
  { id: "recommended", group: "Family", icon: "🤝", title: "Good Recommendation", desc: "Finish a document someone sent you.", points: 15, progress: (c) => [c.finishedShared, 1], check: (c) => c.finishedShared >= 1 },

  // Quizzes: the quick check that makes reading count
  { id: "sharp", group: "Quizzes", icon: "🧠", title: "Sharp", desc: "Pass your first reading quiz.", points: 10, progress: (c) => [c.quizzes, 1], check: (c) => c.quizzes >= 1 },
  { id: "perfect_ten", group: "Quizzes", icon: "🎓", title: "Perfect Ten", desc: "Pass 10 quizzes on the first try.", points: 25, progress: (c) => [c.quizzesFirstTry, 10], check: (c) => c.quizzesFirstTry >= 10 },
  { id: "scholar", group: "Quizzes", icon: "📜", title: "Scholar", desc: "Pass 50 reading quizzes.", points: 50, progress: (c) => [c.quizzes, 50], check: (c) => c.quizzes >= 50 },

  // Competition
  { id: "podium", group: "Competition", icon: "🥉", title: "On the Podium", desc: "Finish in the top 3 for words read in a monthly competition.", points: 25, progress: (c) => [c.podiums, 1], check: (c) => c.podiums >= 1 },
  { id: "champion", group: "Competition", icon: "🏆", title: "Monthly Champion", desc: "Read the most words in a monthly competition.", points: 50, progress: (c) => [c.wins, 1], check: (c) => c.wins >= 1 },
  { id: "dynasty", group: "Competition", icon: "👑", title: "Dynasty", desc: "Win 3 monthly competitions.", points: 100, progress: (c) => [c.wins, 3], check: (c) => c.wins >= 3 }
];

export const ACHIEVEMENTS_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const TOTAL_POINTS = ACHIEVEMENTS.reduce((sum, a) => sum + a.points, 0);

// XP: 1 per 100 words read, plus 5 per achievement point.
// Level n needs 100 × n(n−1)/2 XP: 100 for level 2, 300 for 3, 600 for 4, …
export function xpFor(totalWords, points) {
  return Math.floor(totalWords / 100) + points * 5;
}

const TITLES = [
  [1, "Skimmer"], [3, "Page Turner"], [5, "Bookworm"], [8, "Speed Reader"],
  [11, "Word Blur"], [15, "Velocity"], [20, "Swizz Class"]
];

export function levelFor(xp) {
  let level = 1;
  while (100 * ((level + 1) * level) / 2 <= xp) level += 1;
  const floor = 100 * (level * (level - 1)) / 2;
  const next = 100 * ((level + 1) * level) / 2;
  const title = [...TITLES].reverse().find(([min]) => level >= min)[1];
  return { level, title, xp, floor, next };
}
