import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, 'leetcode_contests_data.sqlite');
const db = new Database(DB_PATH, { readonly: true });

export function getUsers() {
  return db.prepare(`
    SELECT DISTINCT username, user_slug, data_region
    FROM contest_results
    ORDER BY username COLLATE NOCASE
    LIMIT 100
  `).all();
}

export function getUserHistory(userSlug, dataRegion) {
  return db.prepare(`
    SELECT
      c.contest_slug,
      c.time,
      c.num_participants,
      cr.rank,
      cr.score,
      cr.finish_time,
      cr.global_ranking
    FROM contest_results cr
    JOIN contest c ON cr.contest_id = c.contest_id
    WHERE cr.user_slug = ? AND cr.data_region = ?
    ORDER BY c.time ASC
  `).all(userSlug, dataRegion);
}

export function getUserStats(userSlug, dataRegion) {
  return db.prepare(`
    SELECT
      cr.username,
      cr.user_slug,
      cr.data_region,
      COUNT(*) AS total_contests,
      MIN(cr.rank) AS best_rank,
      ROUND(AVG(cr.rank), 1) AS avg_rank,
      MIN(cr.global_ranking) AS best_global_ranking,
      ROUND(AVG(cr.global_ranking), 0) AS avg_global_ranking,
      MAX(cr.score) AS best_score,
      ROUND(AVG(cr.score), 1) AS avg_score,
      SUM(CASE WHEN cr.rank <= 500 THEN 1 ELSE 0 END) AS top500_count,
      SUM(CASE WHEN cr.rank = 1 THEN 1 ELSE 0 END) AS wins_count
    FROM contest_results cr
    WHERE cr.user_slug = ? AND cr.data_region = ?
  `).get(userSlug, dataRegion);
}

export function searchUsers(query) {
  return db.prepare(`
    SELECT DISTINCT username, user_slug, data_region
    FROM contest_results
    WHERE username LIKE ? OR user_slug LIKE ?
    ORDER BY username COLLATE NOCASE
    LIMIT 20
  `).all(`%${query}%`, `%${query}%`);
}
