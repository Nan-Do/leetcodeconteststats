import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_LOCAL_DATABASE = process.env.LOCAL || false;
const DB_PATH = process.env.DB_PATH || join(__dirname, 'leetcode_contests_data.sqlite');

let db;
if (USE_LOCAL_DATABASE) {
  db = createClient({
    url: `file:${DB_PATH}`,
    readonly: true,
  });
}
else {
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    readonly: true,
  });
}

export async function getUserHistory(userSlug, dataRegion) {
  const result = await db.execute({
    sql: `
      SELECT
        c.contest_slug,
        c.time,
        c.num_participants,
        cr.rank,
        cr.score
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
        cr.username,
        cr.user_slug,
        cr.data_region,
        COUNT(*) AS total_contests,
        MIN(cr.rank) AS best_rank,
        ROUND(AVG(cr.rank), 1) AS avg_rank,
        MAX(cr.score) AS best_score,
        ROUND(AVG(cr.score), 1) AS avg_score,
        SUM(CASE WHEN cr.rank <= 500 THEN 1 ELSE 0 END) AS top500_count,
        SUM(CASE WHEN cr.rank = 1 THEN 1 ELSE 0 END) AS wins_count
      FROM contest_results cr
      WHERE cr.user_slug = ? AND cr.data_region = ?
    `,
    args: [userSlug, dataRegion],
  });
  return result.rows[0] ?? null;
}

export async function searchUsers(query) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT username, user_slug, data_region
      FROM contest_results
      WHERE user_slug LIKE ?
      ORDER BY user_slug COLLATE NOCASE
      LIMIT 20`,
    args: [`${query}%`],
  });
  return result.rows;
}
