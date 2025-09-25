const express = require('express');
const { enrichDomain } = require('./shared');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = function createDomainsRouter({ fetchDomains, fetchDomainByName, saveDomain }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const domains = await fetchDomains(req.user.id);
      res.json({ domains: domains.map(enrichDomain) });
    })
  );

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      const payload = req.body || {};
      if (!payload.name) {
        return res.status(400).json({ error: 'name is required to update a domain' });
      }
      const domain = await fetchDomainByName(req.user.id, payload.name);
      if (!domain) {
        return res.status(404).json({ error: 'Domain not found' });
      }
      if (Array.isArray(payload.level_thresholds)) {
        domain.level_thresholds = payload.level_thresholds.map((value) => Number(value));
      }
      if (Array.isArray(payload.levelup_rewards)) {
        domain.levelup_rewards = payload.levelup_rewards;
      }
      const updated = await saveDomain(domain);
      res.json({ domain: enrichDomain(updated) });
    })
  );

  return router;
};