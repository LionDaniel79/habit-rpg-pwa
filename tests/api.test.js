const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.DATABASE_FILE = ':memory:';
process.env.CORS_WHITELIST = 'http://localhost';
process.env.RATE_LIMIT_MAX = '999';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.NODE_ENV = 'test';

const { createApp, initializeDatabase } = require('../app');

let app;
let agent;
const deviceHeader = { 'X-Device-ID': 'test-device-123' };

test.before(async () => {
  await initializeDatabase();
  app = createApp();
  agent = request(app);
});

test('Habit RPG API flows', async (t) => {
  let questId;

  await t.test('POST /api/bootstrap seeds snapshot', async () => {
    const response = await agent.post('/api/bootstrap').set(deviceHeader).send({});
    assert.strictEqual(response.status, 201);
    assert.ok(Array.isArray(response.body.domains));
    assert.ok(response.body.config);
    assert.ok(response.body.questsByDate);
    assert.ok(Array.isArray(response.body.quests));
  });

  await t.test('Quest lifecycle create -> complete -> snapshot', async () => {
    const today = new Date().toISOString().split('T')[0];
    const createRes = await agent
      .post('/api/quests')
      .set(deviceHeader)
      .send({
        title: '체력 퀘스트',
        domain_name: '체력',
        xp: 120,
        date: today,
        is_daily: true
      });
    assert.strictEqual(createRes.status, 201);
    assert.ok(createRes.body.quest);
    questId = createRes.body.quest.id;

    const completeRes = await agent.post(`/api/quests/${questId}/complete`).set(deviceHeader);
    assert.strictEqual(completeRes.status, 200);
    assert.ok(completeRes.body.quest.is_completed);
    assert.ok(Array.isArray(completeRes.body.domains));
    assert.ok(Array.isArray(completeRes.body.levelUpEvents));
    if (completeRes.body.nextQuest) {
      assert.strictEqual(completeRes.body.nextQuest.is_daily, true);
    }

    const snapshotRes = await agent.get('/api/snapshot').set(deviceHeader);
    assert.strictEqual(snapshotRes.status, 200);
    assert.ok(snapshotRes.body.questsByDate.today.every((quest) => quest.is_completed === false));
  });

  await t.test('PATCH /api/config updates willpower XP', async () => {
    const response = await agent
      .patch('/api/config')
      .set(deviceHeader)
      .send({ willpower_xp_per_any_quest: 9 });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.config.willpower_xp_per_any_quest, 9);
  });

  await t.test('PATCH /api/domains adjusts thresholds', async () => {
    const response = await agent
      .patch('/api/domains')
      .set(deviceHeader)
      .send({ name: '체력', level_thresholds: [0, 50, 100] });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body.domain.level_thresholds, [0, 50, 100]);
  });

  await t.test('DELETE /api/quests/:id removes quest', async () => {
    const deleteRes = await agent.delete(`/api/quests/${questId}`).set(deviceHeader);
    assert.strictEqual(deleteRes.status, 200);
    const verify = await agent.get('/api/snapshot').set(deviceHeader);
    assert.ok(verify.body.quests.every((quest) => quest.id !== questId));
  });

  await t.test('POST /api/reset clears quests and restores defaults', async () => {
    const resetRes = await agent.post('/api/reset').set(deviceHeader);
    assert.strictEqual(resetRes.status, 200);
    assert.ok(Array.isArray(resetRes.body.domains));
    assert.ok(resetRes.body.config);

    const snapshotRes = await agent.get('/api/snapshot').set(deviceHeader);
    assert.strictEqual(snapshotRes.status, 200);
    assert.strictEqual(snapshotRes.body.quests.length, 0);
  });
});