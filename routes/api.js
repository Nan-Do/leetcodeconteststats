import { Router } from 'express';
import { findUserCandidates, getUserHistory, getUserStats, searchUsers } from '../db.js';

const router = Router();

// The client applies this same minimum before it calls. Keep the two in step: a
// longer minimum here than the client knows about makes short usernames
// unreachable rather than merely unsuggested.
const MIN_QUERY_LENGTH = 2;

const VALID_REGIONS = ['US', 'CN'];

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Express hands over an array when a parameter repeats (?q=a&q=b), which would
// otherwise reach string methods that don't exist on it.
const str = (value) => (typeof value === 'string' ? value : '');

function sendError(res, err) {
  res.status(err.status ?? 500).json({ error: err.message, ...err.extra });
}

// Turns a slug and an optional region into the single account they name, or
// throws explaining why they don't name exactly one.
async function resolveUser(userSlug, region) {
  if (region && !VALID_REGIONS.includes(region)) {
    throw new HttpError(400, `Unknown region "${region}". Expected ${VALID_REGIONS.join(' or ')}.`);
  }

  const candidates = await findUserCandidates(userSlug, region || null);

  if (!candidates.length) {
    throw new HttpError(404, `No data found for user "${userSlug}"`);
  }
  if (candidates.length > 1) {
    throw new HttpError(409, `"${userSlug}" matches ${candidates.length} accounts — name one exactly`, { candidates });
  }
  return candidates[0];
}

router.get('/users/search', async (req, res) => {
  const q = str(req.query.q).trim();
  if (q.length < MIN_QUERY_LENGTH) return res.json([]);

  try {
    res.json(await searchUsers(q));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/user/:userSlug/history', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userSlug, str(req.query.region));
    res.json(await getUserHistory(user.user_slug, user.data_region));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/user/:userSlug/stats', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userSlug, str(req.query.region));
    res.json(await getUserStats(user.user_slug, user.data_region));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/compare', async (req, res) => {
  const u1 = str(req.query.u1).trim();
  const u2 = str(req.query.u2).trim();
  if (!u1 || !u2) return res.status(400).json({ error: 'Two user slugs required (u1, u2)' });

  try {
    const [user1, user2] = await Promise.all([
      resolveUser(u1, str(req.query.r1)),
      resolveUser(u2, str(req.query.r2)),
    ]);

    const [u1_history, u1_stats, u2_history, u2_stats] = await Promise.all([
      getUserHistory(user1.user_slug, user1.data_region),
      getUserStats(user1.user_slug, user1.data_region),
      getUserHistory(user2.user_slug, user2.data_region),
      getUserStats(user2.user_slug, user2.data_region),
    ]);

    const u1_results = new Map();
    u1_history.forEach((contest) => u1_results.set(contest["contest_slug"], contest["rank"]))
    const u2_results = new Map();
    u2_history.forEach((contest) => u2_results.set(contest["contest_slug"], contest["rank"]))

    let u1_victories = 0;
    for (const [contest_slug, rank] of u1_results) {
      if (u2_results.has(contest_slug) && rank < u2_results.get(contest_slug)) u1_victories += 1;
    }
    let u2_victories = 0;
    for (const [contest_slug, rank] of u2_results) {
      if (u1_results.has(contest_slug) && rank < u1_results.get(contest_slug)) u2_victories += 1;
    }

    res.json({
      user1: { history: u1_history, stats: u1_stats },
      user2: { history: u2_history, stats: u2_stats },
      wins: { user1: u1_victories, user2: u2_victories },
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
