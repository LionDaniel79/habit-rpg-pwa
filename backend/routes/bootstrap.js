const express = require('express');
const { buildSnapshotPayload, formatDate } = require('./shared');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = function createBootstrapRouter({ fetchConfig, updateConfig, fetchDomains, fetchQuests, createQuest }) {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const deviceId = req.user.id;
      const body = req.body || {};
      const configUpdates = {};

      if (Array.isArray(body.thresholds) && body.thresholds.length) {
        configUpdates.default_level_thresholds = body.thresholds.map((value) => Number(value));
      }
      if (Array.isArray(body.rewards) && body.rewards.length) {
        configUpdates.default_levelup_rewards = body.rewards;
      }
      if (typeof body.willpowerXp === 'number') {
        configUpdates.willpower_xp_per_any_quest = body.willpowerXp;
      }

      if (Object.keys(configUpdates).length) {
        await updateConfig(deviceId, configUpdates);
      } else {
        await fetchConfig(deviceId);
      }

      if (Array.isArray(body.initialDailyQuests) && body.initialDailyQuests.length) {
        const today = formatDate(new Date());
        const domains = await fetchDomains(deviceId);
        const domainNames = new Set(domains.map((domain) => domain.name));
        for (const quest of body.initialDailyQuests) {
          if (!quest || !quest.title || !domainNames.has(quest.domain_name)) {
            // Skip invalid quest payloads quietly to avoid breaking onboarding flows.
            continue;
          }
          const xp = Number(quest.xp);
          if (!Number.isFinite(xp) || xp <= 0) {
            continue;
          }
          await createQuest(deviceId, {
            title: quest.title,
            domain_name: quest.domain_name,
            xp,
            date: today,
            is_daily: true,
            notes: quest.notes || null
          });
        }
      }

      const snapshot = await buildSnapshotPayload(
        { fetchDomains, fetchConfig, fetchQuests },
        deviceId
      );
      res.status(201).json(snapshot);
    })
  );

  return router;
};