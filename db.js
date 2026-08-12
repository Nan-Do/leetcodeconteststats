import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_LOCAL_DATABASE = process.env.LOCAL || false;
const DB_PATH = process.env.DB_PATH || join(__dirname, 'leetcodeconteststats.db')

let db;
if (USE_LOCAL_DATABASE) {
  console.log("Using local database")
  db = createClient({
    url: `file:${DB_PATH}`,
    readonly: true,
  });
}
else {
  console.log("Using remote database")
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// Case is part of a user's identity: `009-KumarJi` and `009-kumarji` are two
// different accounts with two different histories. The lookups below therefore
// match exactly, and this is the only place that matches case-insensitively —
// to turn whatever the caller typed into the one account it names, or to report
// that it names several. Callers pass the resolved slug on to those lookups.
export async function findUserCandidates(userSlug, dataRegion = null) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT user_slug, data_region
      FROM contest_results
      WHERE user_slug = ? COLLATE NOCASE
      ORDER BY user_slug, data_region
    `,
    args: [userSlug],
  });

  const candidates = dataRegion
    ? result.rows.filter((row) => row.data_region === dataRegion)
    : result.rows;

  // An exactly-cased match is the account the caller named, so it wins outright
  // instead of competing with its differently-cased namesakes.
  const exact = candidates.filter((row) => row.user_slug === userSlug);
  return exact.length ? exact : candidates;
}

export async function getUserHistory(userSlug, dataRegion) {
  const result = await db.execute({
    sql: `
      SELECT
        c.contest_slug,
        c.time,
        c.num_participants,
        cr.rank,
        cr.score,
        cr.contest_score,
        cr.solved,
        time(cr.finish_time - c.time, 'unixepoch') as total_time
      FROM contest_results cr
      JOIN contest c ON cr.contest_id = c.contest_id
      WHERE cr.user_slug = ? AND cr.data_region = ?
      ORDER BY c.time ASC
    `,
    args: [userSlug, dataRegion],
  });
  return result.rows;
}

// Registering for a contest and not turning up, or turning up and submitting
// nothing, still lands in the table as a full row: a real rank, near the bottom
// of the field, with a score of 0. Those rows are the ones a user means by "I
// didn't compete that week", and left in they drag the averages down and stretch
// the chart's rank axis over ranks nobody competed for. So a contest counts as
// attended when the user scored in it. The same rule is written once more, as
// `hasAttended` in public/js/app.js, which filters the history rows the chart
// draws. Both have to agree.
export const hasAttended = (contest) => contest.score > 0;

// LeetCode occasionally leaves a contest unrated -- a broken problem, a leak,
// an outage during the window -- and the results still stand: everyone who
// competed has a rank, nobody's rating moved. The database has no idea which
// ones those were, so the flag is put on by annotateHistory below and is false
// for everyone LeetCode could not be asked about.
export const isRated = (contest) => !contest.unrated;

// The four ways the two switches under the chart can be set. Named so that the
// client can ask for a block of stats and a head-to-head tally by the same key,
// and defined once so that the sets the two are computed over cannot drift.
export const CONTEST_SETS = {
  all: () => true,
  attended: hasAttended,
  rated: isRated,
  attended_rated: (contest) => hasAttended(contest) && isRated(contest),
};

// Puts LeetCode's rating history next to the database's own record of who
// competed where, and returns plain rows -- the driver's are not meant to be
// added to, and these travel on to the client as JSON.
export function annotateHistory(history, contestRanking) {
  return history.map((contest) => {
    const entry = contestRanking?.entryFor(contest.contest_slug);
    // Present but flagged as a non-appearance still means LeetCode counted no
    // rated result for it.
    const rated = Boolean(entry) && entry.attended !== false;
    return {
      ...contest,
      rating: entry?.rating ?? null,
      // Keep track of the trend direction.
      trend_direction: entry?.trendDirection ?? null,
      // A contest the user scored in that LeetCode's rated history does not
      // list was never rated. Without an answer from LeetCode -- a CN account,
      // or a lookup that failed -- nothing is known to be unrated.
      unrated: Boolean(contestRanking) && hasAttended(contest) && !rated,
    };
  });
}

const round1 = (value) => Math.round(value * 10) / 10;

const NO_CONTESTS = {
  total_contests: 0,
  best_rank: null,
  avg_rank: null,
  best_score: null,
  avg_score: null,
  top500_count: 0,
  wins_count: 0,
  ak_count: 0,
};

// Collapses a set of contests into one block of stats.
function foldStats(contests) {
  if (!contests.length) return { ...NO_CONTESTS };

  const sum = (field) => contests.reduce((n, contest) => n + contest[field], 0);
  const count = (keep) => contests.reduce((n, contest) => n + (keep(contest) ? 1 : 0), 0);
  return {
    total_contests: contests.length,
    best_rating: Math.max(...contests.map((contest) => contest.rating)),
    best_rank: Math.min(...contests.map((contest) => contest.rank)),
    avg_rank: round1(sum('rank') / contests.length),
    best_score: Math.max(...contests.map((contest) => contest.score)),
    avg_score: round1(sum('score') / contests.length),
    top500_count: count((contest) => contest.rank <= 500),
    wins_count: count((contest) => contest.rank === 1),
    ak_count: count((contest) => contest.score === contest.contest_score),
  };
}

// Every figure the cards show, one block per way the switches can be set. The
// aggregates used to be a second query of their own, which could not have done
// this: which contests were rated is LeetCode's answer, not the database's, and
// a few hundred rows the history already fetched are cheaper to fold than to
// ask about again.
export function computeStats(history) {
  if (!history.length) return null;

  const stats = {};
  for (const [name, keep] of Object.entries(CONTEST_SETS)) {
    stats[name] = foldStats(history.filter(keep));
  }
  // What the notes under the switches report, and why each switch is there.
  stats.skipped_count = history.filter((contest) => !hasAttended(contest)).length;
  stats.unrated_count = history.filter((contest) => contest.unrated).length;
  return stats;
}

export async function searchUsers(query) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT user_slug, data_region
      FROM contest_results
      WHERE user_slug LIKE ?
      -- A NOCASE sort leaves case-only variants tied, and an unspecified tie
      -- order lets identical queries disagree about which one comes first.
      ORDER BY user_slug COLLATE NOCASE, user_slug, data_region
      LIMIT 20`,
    args: [`${query}%`],
  });
  return result.rows;
}
