const express = require('express');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = function createConfigRouter({ fetchConfig, updateConfig }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const config = await fetchConfig(req.user.id);
      res.json({ config });
    })
  );

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const updates = {};
      if (Object.prototype.hasOwnProperty.call(body, 'willpower_xp_per_any_quest')) {
        const value = Number(body.willpower_xp_per_any_quest);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ error: 'willpower_xp_per_any_quest must be a non-negative number' });
        }
        updates.willpower_xp_per_any_quest = value;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'default_level_thresholds')) {
        if (!Array.isArray(body.default_level_thresholds)) {
          return res.status(400).json({ error: 'default_level_thresholds must be an array of numbers' });
        }
        updates.default_level_thresholds = body.default_level_thresholds.map((value) => Number(value));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'default_levelup_rewards')) {
        if (!Array.isArray(body.default_levelup_rewards)) {
          return res.status(400).json({ error: 'default_levelup_rewards must be an array' });
        }
        updates.default_levelup_rewards = body.default_levelup_rewards;
      }
      const config = await updateConfig(req.user.id, updates);
      res.json({ config });
    })
  );

  return router;
};