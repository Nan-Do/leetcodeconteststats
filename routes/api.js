import { Router } from 'express';
import { annotateHistory, computeStats, CONTEST_SETS, findUserCandidates, getUserHistory, searchUsers } from '../db.js';
import { getContestRanking } from '../leetcode.js';

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

// A contest's results stop changing the moment it ends, so repeats can be
// served without asking us. An hour keeps a newly finished contest from taking
// long to appear.
router.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=3600');
  next();
});

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

// Everything a view knows about one user: the database's own record of their
// contests, with LeetCode's rating for each folded in, plus the profile summary
// the rating card shows. `ranking` is null for a CN account, which leetcode.com
// knows nothing about, and for a lookup that failed.
async function loadUser(user) {
  const [history, contestRanking] = await Promise.all([
    getUserHistory(user.user_slug, user.data_region),
    getContestRanking(user.user_slug, user.data_region),
  ]);
  return {
    history: annotateHistory(history, contestRanking),
    ranking: contestRanking?.ranking ?? null,
  };
}

function userStats(user, { history, ranking }) {
  const stats = computeStats(history);
  return stats && { user_slug: user.user_slug, data_region: user.data_region, ...stats, ranking };
}

// Counts how many contests each of the two finished ahead of the other. Only a
// contest they both took part in can be won, and a tie is won by neither.
function headToHead(history1, history2) {
  const ranks = new Map(history2.map((contest) => [contest.contest_slug, contest.rank]));

  let user1 = 0;
  let user2 = 0;
  for (const contest of history1) {
    const rival = ranks.get(contest.contest_slug);
    if (rival === undefined) continue;
    if (contest.rank < rival) user1 += 1;
    else if (rival < contest.rank) user2 += 1;
  }
  return { user1, user2 };
}

// One tally per way the switches can be set, so the client can flip them
// without asking again. They differ because a contest one of them sat out, or
// that nobody was rated for, is not a contest the other beat them in.
function headToHeadSets(history1, history2) {
  const wins = {};
  for (const [name, keep] of Object.entries(CONTEST_SETS)) {
    wins[name] = headToHead(history1.filter(keep), history2.filter(keep));
  }
  return wins;
}

// Express 5 forwards a rejected async handler to the error middleware below, so
// these routes throw rather than each carrying its own try/catch.
router.get('/users/search', async (req, res) => {
  const q = str(req.query.q).trim();
  if (q.length < MIN_QUERY_LENGTH) return res.json([]);

  res.json(await searchUsers(q));
});

router.get('/user/:userSlug/history', async (req, res) => {
  const user = await resolveUser(req.params.userSlug, str(req.query.region));
  const { history } = await loadUser(user);
  res.json(history);
});

router.get('/user/:userSlug/stats', async (req, res) => {
  const user = await resolveUser(req.params.userSlug, str(req.query.region));
  res.json(userStats(user, await loadUser(user)));
});

router.get('/compare', async (req, res) => {
  const u1 = str(req.query.u1).trim();
  const u2 = str(req.query.u2).trim();
  if (!u1 || !u2) throw new HttpError(400, 'Two user slugs required (u1, u2)');

  const [user1, user2] = await Promise.all([
    resolveUser(u1, str(req.query.r1)),
    resolveUser(u2, str(req.query.r2)),
  ]);

  const [data1, data2] = await Promise.all([loadUser(user1), loadUser(user2)]);

  res.json({
    user1: { history: data1.history, stats: userStats(user1, data1) },
    user2: { history: data2.history, stats: userStats(user2, data2) },
    wins: headToHeadSets(data1.history, data2.history),
  });
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers
// by arity, so `next` has to stay even though it is never called.
router.use((err, req, res, next) => {
  // Nothing here is cacheable, and a cached 404 would outlive the problem.
  res.set('Cache-Control', 'no-store');

  // An HttpError carries a message written for the caller. Anything else came
  // from the driver and is our problem, not theirs -- it goes to the log.
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });

  console.error('[api]', err);
  res.status(500).json({ error: 'Internal error' });
});

export default router;
