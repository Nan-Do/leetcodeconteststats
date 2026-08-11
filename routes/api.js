import { Router } from 'express';
import { findUserCandidates, getUserHistory, getUserStats, hasAttended, searchUsers } from '../db.js';

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

// Express 5 forwards a rejected async handler to the error middleware below, so
// these routes throw rather than each carrying its own try/catch.
router.get('/users/search', async (req, res) => {
  const q = str(req.query.q).trim();
  if (q.length < MIN_QUERY_LENGTH) return res.json([]);

  res.json(await searchUsers(q));
});

router.get('/user/:userSlug/history', async (req, res) => {
  const user = await resolveUser(req.params.userSlug, str(req.query.region));
  res.json(await getUserHistory(user.user_slug, user.data_region));
});

router.get('/user/:userSlug/stats', async (req, res) => {
  const user = await resolveUser(req.params.userSlug, str(req.query.region));
  res.json(await getUserStats(user.user_slug, user.data_region));
});

router.get('/compare', async (req, res) => {
  const u1 = str(req.query.u1).trim();
  const u2 = str(req.query.u2).trim();
  if (!u1 || !u2) throw new HttpError(400, 'Two user slugs required (u1, u2)');

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

  res.json({
    user1: { history: u1_history, stats: u1_stats },
    user2: { history: u2_history, stats: u2_stats },
    // Both tallies, so the client's "hide skipped contests" toggle can switch
    // between them without asking again. They differ because a contest one of
    // them sat out is not a contest the other beat them in.
    wins: {
      all: headToHead(u1_history, u2_history),
      attended: headToHead(u1_history.filter(hasAttended), u2_history.filter(hasAttended)),
    },
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
