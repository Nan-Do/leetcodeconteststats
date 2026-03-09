import { Router } from 'express';
import { getUsers, getUserHistory, getUserStats, searchUsers } from '../db.js';

const router = Router();

router.get('/users/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  try {
    res.json(searchUsers(q.trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/user/:userSlug/history', (req, res) => {
  const { userSlug } = req.params;
  const dataRegion = req.query.region || 'US';
  try {
    const history = getUserHistory(userSlug, dataRegion);
    if (!history.length) return res.status(404).json({ error: 'No data found for this user' });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/user/:userSlug/stats', (req, res) => {
  const { userSlug } = req.params;
  const dataRegion = req.query.region || 'US';
  try {
    const stats = getUserStats(userSlug, dataRegion);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/compare', (req, res) => {
  const { u1, u2, r1, r2 } = req.query;
  if (!u1 || !u2) return res.status(400).json({ error: 'Two user slugs required (u1, u2)' });
  const region1 = r1 || 'US';
  const region2 = r2 || 'US';
  try {
    const u1_history = getUserHistory(u1, region1);
    const u1_stats = getUserStats(u1, region1);
    const u2_history = getUserHistory(u2, region2);
    const u2_stats = getUserStats(u2, region2);

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
    res.status(500).json({ error: err.message });
  }
});

export default router;
