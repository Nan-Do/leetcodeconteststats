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
// attended when the user scored in it, and every figure below is reported both
// ways. The same rule is written twice more -- as `cr.score > 0` in the query
// below, and as `hasAttended` in public/js/app.js, which filters the history
// rows the chart draws. All three have to agree.
export const hasAttended = (contest) => contest.score > 0;

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

// Collapses the per-group tallies of the query below into one block of stats.
// The query totals rather than averages so that this can fold any set of groups
// together, which is what keeps "all contests" and "attended only" from being
// two aggregate queries that have to be kept saying the same thing.
function foldStats(groups) {
  const total = groups.reduce((n, group) => n + group.total_contests, 0);
  if (!total) return { ...NO_CONTESTS };

  const sum = (field) => groups.reduce((n, group) => n + group[field], 0);
  return {
    total_contests: total,
    best_rank: Math.min(...groups.map((group) => group.best_rank)),
    avg_rank: round1(sum('rank_sum') / total),
    best_score: Math.max(...groups.map((group) => group.best_score)),
    avg_score: round1(sum('score_sum') / total),
    top500_count: sum('top500_count'),
    wins_count: sum('wins_count'),
    ak_count: sum('ak_count'),
  };
}

export async function getUserStats(userSlug, dataRegion) {
  const result = await db.execute({
    sql: `
      SELECT
        CASE WHEN cr.score > 0 THEN 1 ELSE 0 END AS attended,
        COUNT(*) AS total_contests,
        MIN(cr.rank) AS best_rank,
        SUM(cr.rank) AS rank_sum,
        MAX(cr.score) AS best_score,
        SUM(cr.score) AS score_sum,
        SUM(CASE WHEN cr.rank <= 500 THEN 1 ELSE 0 END) AS top500_count,
        SUM(CASE WHEN cr.rank = 1 THEN 1 ELSE 0 END) AS wins_count,
        SUM(CASE WHEN cr.score = cr.contest_score THEN 1 ELSE 0 END) AS ak_count
      FROM contest_results cr
      WHERE cr.user_slug = ? AND cr.data_region = ?
      GROUP BY attended
    `,
    args: [userSlug, dataRegion],
  });

  // Grouping drops the empty group, so a user with no results at all has no
  // rows here, and one whose every contest was skipped has only the group 0.
  if (!result.rows.length) return null;

  const all = foldStats(result.rows);
  const attended = foldStats(result.rows.filter((row) => row.attended === 1));
  return {
    user_slug: userSlug,
    data_region: dataRegion,
    all,
    attended,
    skipped_count: all.total_contests - attended.total_contests,
  };
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
