import { Router } from 'express';
import { getUsers, getUserHistory, getUserStats, searchUsers } from '../db.js';

const router = Router();

router.get('/users', (req, res) => {
  try {
    res.json(getUsers());
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

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
    res.json({
      user1: { history: getUserHistory(u1, region1), stats: getUserStats(u1, region1) },
      user2: { history: getUserHistory(u2, region2), stats: getUserStats(u2, region2) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
