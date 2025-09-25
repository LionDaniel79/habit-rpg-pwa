const express = require('express');
const { buildSnapshotPayload } = require('./shared');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = function createSnapshotRouter({ fetchDomains, fetchConfig, fetchQuests }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const snapshot = await buildSnapshotPayload(
        { fetchDomains, fetchConfig, fetchQuests },
        req.user.id
      );
      res.json(snapshot);
    })
  );

  return router;
};