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

export async function getUserStats(userSlug, dataRegion) {
  const result = await db.execute({
    sql: `
      SELECT
        cr.user_slug,
        cr.data_region,
        COUNT(*) AS total_contests,
        MIN(cr.rank) AS best_rank,
        ROUND(AVG(cr.rank), 1) AS avg_rank,
        MAX(cr.score) AS best_score,
        ROUND(AVG(cr.score), 1) AS avg_score,
        SUM(CASE WHEN cr.rank <= 500 THEN 1 ELSE 0 END) AS top500_count,
        SUM(CASE WHEN cr.rank = 1 THEN 1 ELSE 0 END) AS wins_count,
        SUM(CASE WHEN cr.score = cr.contest_score THEN 1 ELSE 0 END) AS ak_count
      FROM contest_results cr
      WHERE cr.user_slug = ? AND cr.data_region = ?
    `,
    args: [userSlug, dataRegion],
  });
  // An unfiltered aggregate always yields exactly one row, so a user with no
  // results arrives as a row of nulls rather than as no row at all.
  const stats = result.rows[0];
  return stats?.total_contests > 0 ? stats : null;
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
