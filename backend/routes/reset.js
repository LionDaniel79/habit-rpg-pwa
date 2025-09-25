const express = require('express');
const { enrichDomain } = require('./shared');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = function createResetRouter({ resetUserData, fetchDomains, fetchConfig }) {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      await resetUserData(req.user.id);
      const [domains, config] = await Promise.all([
        fetchDomains(req.user.id),
        fetchConfig(req.user.id)
      ]);
      res.json({
        message: 'All progress has been reset.',
        domains: domains.map(enrichDomain),
        config
      });
    })
  );

  return router;
};