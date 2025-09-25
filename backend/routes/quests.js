const express = require('express');
const { formatDate } = require('./shared');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ensureValidDate(value) {
  const formatted = formatDate(value);
  if (!formatted) {
    const error = new Error('date must be an ISO-8601 date string (YYYY-MM-DD)');
    error.status = 400;
    throw error;
  }
  return formatted;
}

module.exports = function createQuestsRouter({
  fetchDomainByName,
  fetchQuestById,
  createQuest,
  updateQuest,
  deleteQuest,
  markQuestCompleted
}) {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const deviceId = req.user.id;
      const body = req.body || {};
      if (!body.title || !body.title.trim()) {
        return res.status(400).json({ error: 'title is required' });
      }
      if (!body.domain_name) {
        return res.status(400).json({ error: 'domain_name is required' });
      }
      const domain = await fetchDomainByName(deviceId, body.domain_name);
      if (!domain) {
        return res.status(400).json({ error: 'Unknown domain_name' });
      }
      const xp = Number(body.xp);
      if (!Number.isFinite(xp) || xp <= 0) {
        return res.status(400).json({ error: 'xp must be a positive number' });
      }
      const date = ensureValidDate(body.date || new Date());
      const quest = await createQuest(deviceId, {
        title: body.title,
        domain_name: domain.name,
        xp,
        date,
        is_daily: Boolean(body.is_daily),
        notes: body.notes || null
      });
      res.status(201).json({ quest });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const deviceId = req.user.id;
      const questId = req.params.id;
      const updates = req.body || {};
      if (Object.prototype.hasOwnProperty.call(updates, 'domain_name')) {
        const domain = await fetchDomainByName(deviceId, updates.domain_name);
        if (!domain) {
          return res.status(400).json({ error: 'Unknown domain_name' });
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'xp')) {
        const xp = Number(updates.xp);
        if (!Number.isFinite(xp) || xp <= 0) {
          return res.status(400).json({ error: 'xp must be a positive number' });
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'date')) {
        updates.date = ensureValidDate(updates.date);
      }
      const quest = await updateQuest(deviceId, questId, updates);
      if (!quest) {
        return res.status(404).json({ error: 'Quest not found' });
      }
      res.json({ quest });
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const deleted = await deleteQuest(req.user.id, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Quest not found' });
      }
      res.json({ ok: true });
    })
  );

  router.post(
    '/:id/complete',
    asyncHandler(async (req, res) => {
      const result = await markQuestCompleted(req.user.id, req.params.id);
      if (!result) {
        return res.status(404).json({ error: 'Quest not found' });
      }
      res.json(result);
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const quest = await fetchQuestById(req.user.id, req.params.id);
      if (!quest) {
        return res.status(404).json({ error: 'Quest not found' });
      }
      res.json({ quest });
    })
  );

  return router;
};