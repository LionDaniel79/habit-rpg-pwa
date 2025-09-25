const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, 'habit.sqlite');

const DEFAULT_DOMAINS = [
  { name: '체력', icon: 'icon-vitality', color: '#f97316' },
  { name: '지력', icon: 'icon-wisdom', color: '#38bdf8' },
  { name: '감성', icon: 'icon-empathy', color: '#f472b6' },
  { name: '의지', icon: 'icon-willpower', color: '#22c55e' },
  { name: '영성', icon: 'icon-spirit', color: '#a855f7' },
  { name: '말씀', icon: 'icon-word', color: '#facc15' }
];

const DEFAULT_LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2800];
const DEFAULT_REWARDS = [
  { level: 2, text: '레벨 2 달성! 좋아하는 간식을 즐기세요.', icon: 'reward-snack', sound: 'reward-chime' },
  { level: 5, text: '레벨 5 달성! 특별한 산책으로 축하해요.', icon: 'reward-walk', sound: 'reward-fanfare' },
  { level: 8, text: '레벨 8 달성! 취미 시간을 넉넉히 확보하세요.', icon: 'reward-hobby', sound: 'reward-chime' },
  { level: 10, text: '레벨 10 달성! 친구와 축하 파티!', icon: 'reward-celebrate', sound: 'reward-fanfare' }
];
const DEFAULT_WILLPOWER_XP = 5;

let dbInstance;

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function openConnection() {
  return new sqlite3.Database(DB_FILE);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function handleResult(err) {
      if (err) {
        return reject(err);
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows || []);
    });
  });
}

async function initializeDatabase() {
  ensureDataDirectory();
  if (!dbInstance) {
    dbInstance = openConnection();
  }
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await new Promise((resolve, reject) => {
    dbInstance.exec(schema, (err) => {
      if (err) {
        return reject(err);
      }
      resolve();
    });
  });
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database was not initialised. Call initializeDatabase() before using helpers.');
  }
  return dbInstance;
}

function parseJsonOrDefault(rawValue, fallback) {
  if (typeof rawValue !== 'string') {
    return Array.isArray(fallback) ? [...fallback] : fallback;
  }
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return Array.isArray(fallback) ? [...fallback] : fallback;
  }
}

function mapDomain(row) {
  const thresholds = parseJsonOrDefault(row.level_thresholds_json, DEFAULT_LEVEL_THRESHOLDS);
  const rewards = parseJsonOrDefault(row.levelup_rewards_json, DEFAULT_REWARDS);
  return {
    id: row.id,
    device_id: row.device_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    level: row.level,
    xp: row.xp,
    level_thresholds: thresholds,
    levelup_rewards: rewards,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapQuest(row) {
  return {
    id: row.id,
    device_id: row.device_id,
    title: row.title,
    domain_name: row.domain_name,
    xp: row.xp,
    date: row.date,
    is_completed: Boolean(row.is_completed),
    is_daily: Boolean(row.is_daily),
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  };
}

function defaultConfigPayload() {
  return {
    willpower_xp_per_any_quest: DEFAULT_WILLPOWER_XP,
    default_level_thresholds_json: JSON.stringify(DEFAULT_LEVEL_THRESHOLDS),
    default_levelup_rewards_json: JSON.stringify(DEFAULT_REWARDS)
  };
}

async function ensureUser(deviceId) {
  const db = getDb();
  let user = await get(db, 'SELECT * FROM users WHERE id = ?', [deviceId]);
  if (!user) {
    await run(db, 'INSERT INTO users (id) VALUES (?)', [deviceId]);
    user = await get(db, 'SELECT * FROM users WHERE id = ?', [deviceId]);
    const configPayload = defaultConfigPayload();
    await run(
      db,
      `INSERT INTO app_config (device_id, willpower_xp_per_any_quest, default_level_thresholds_json, default_levelup_rewards_json)
       VALUES (?, ?, ?, ?)` ,
      [
        deviceId,
        configPayload.willpower_xp_per_any_quest,
        configPayload.default_level_thresholds_json,
        configPayload.default_levelup_rewards_json
      ]
    );

    const thresholdsJson = configPayload.default_level_thresholds_json;
    const rewardsJson = configPayload.default_levelup_rewards_json;
    for (const domain of DEFAULT_DOMAINS) {
      await run(
        db,
        `INSERT INTO domains (id, device_id, name, icon, color, level_thresholds_json, levelup_rewards_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)` ,
        [randomUUID(), deviceId, domain.name, domain.icon, domain.color, thresholdsJson, rewardsJson]
      );
    }
  }
  return user;
}

async function fetchConfig(deviceId) {
  const db = getDb();
  let row = await get(db, 'SELECT * FROM app_config WHERE device_id = ?', [deviceId]);
  if (!row) {
    await ensureUser(deviceId);
    row = await get(db, 'SELECT * FROM app_config WHERE device_id = ?', [deviceId]);
  }
  return {
    device_id: row.device_id,
    willpower_xp_per_any_quest: Number(row.willpower_xp_per_any_quest),
    default_level_thresholds: parseJsonOrDefault(row.default_level_thresholds_json, DEFAULT_LEVEL_THRESHOLDS),
    default_levelup_rewards: parseJsonOrDefault(row.default_levelup_rewards_json, DEFAULT_REWARDS),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function updateConfig(deviceId, updates = {}) {
  const db = getDb();
  await ensureUser(deviceId);
  const fields = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(updates, 'willpower_xp_per_any_quest')) {
    fields.push('willpower_xp_per_any_quest = ?');
    params.push(Number(updates.willpower_xp_per_any_quest) || 0);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'default_level_thresholds')) {
    const json = JSON.stringify(updates.default_level_thresholds);
    fields.push('default_level_thresholds_json = ?');
    params.push(json);
    const domains = await fetchDomains(deviceId);
    for (const domain of domains) {
      await run(
        db,
        'UPDATE domains SET level_thresholds_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [json, domain.id]
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'default_levelup_rewards')) {
    const json = JSON.stringify(updates.default_levelup_rewards);
    fields.push('default_levelup_rewards_json = ?');
    params.push(json);
    const domains = await fetchDomains(deviceId);
    for (const domain of domains) {
      await run(
        db,
        'UPDATE domains SET levelup_rewards_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [json, domain.id]
      );
    }
  }

  if (!fields.length) {
    return fetchConfig(deviceId);
  }

  params.push(deviceId);
  await run(
    db,
    `UPDATE app_config SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?`,
    params
  );

  return fetchConfig(deviceId);
}

async function fetchDomains(deviceId) {
  const db = getDb();
  const rows = await all(db, 'SELECT * FROM domains WHERE device_id = ? ORDER BY created_at', [deviceId]);
  return rows.map(mapDomain);
}

async function fetchDomainByName(deviceId, name) {
  const db = getDb();
  const row = await get(db, 'SELECT * FROM domains WHERE device_id = ? AND name = ?', [deviceId, name]);
  return row ? mapDomain(row) : null;
}

async function saveDomain(domain) {
  const db = getDb();
  await run(
    db,
    `UPDATE domains
       SET level = ?, xp = ?, level_thresholds_json = ?, levelup_rewards_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      domain.level,
      domain.xp,
      JSON.stringify(domain.level_thresholds),
      JSON.stringify(domain.levelup_rewards),
      domain.id
    ]
  );
  return fetchDomainByName(domain.device_id, domain.name);
}

async function fetchQuests(deviceId) {
  const db = getDb();
  const rows = await all(db, 'SELECT * FROM quests WHERE device_id = ? ORDER BY date, created_at', [deviceId]);
  return rows.map(mapQuest);
}

async function fetchQuestById(deviceId, questId) {
  const db = getDb();
  const row = await get(db, 'SELECT * FROM quests WHERE id = ? AND device_id = ?', [questId, deviceId]);
  return row ? mapQuest(row) : null;
}

async function createQuest(deviceId, payload) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await run(
    db,
    `INSERT INTO quests (id, device_id, title, domain_name, xp, date, is_daily, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      id,
      deviceId,
      payload.title.trim(),
      payload.domain_name,
      Number(payload.xp),
      payload.date,
      payload.is_daily ? 1 : 0,
      payload.notes || null,
      now,
      now
    ]
  );
  return fetchQuestById(deviceId, id);
}

async function updateQuest(deviceId, questId, updates = {}) {
  const db = getDb();
  const existing = await fetchQuestById(deviceId, questId);
  if (!existing) {
    return null;
  }

  const allowed = ['title', 'domain_name', 'xp', 'date', 'is_daily', 'is_completed', 'notes'];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      fields.push(`${key} = ?`);
      if (key === 'is_daily' || key === 'is_completed') {
        params.push(updates[key] ? 1 : 0);
      } else if (key === 'title') {
        params.push(String(updates[key]).trim());
      } else if (key === 'xp') {
        params.push(Number(updates[key]));
      } else {
        params.push(updates[key]);
      }
    }
  }
  if (!fields.length) {
    return existing;
  }
  params.push(new Date().toISOString());
  params.push(questId);
  params.push(deviceId);
  await run(
    db,
    `UPDATE quests SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND device_id = ?`,
    params
  );
  return fetchQuestById(deviceId, questId);
}

async function deleteQuest(deviceId, questId) {
  const db = getDb();
  const result = await run(db, 'DELETE FROM quests WHERE id = ? AND device_id = ?', [questId, deviceId]);
  return result.changes > 0;
}

function calculateLevelProgress(domain, xpGain, rewardsCatalog) {
  const thresholds = domain.level_thresholds || DEFAULT_LEVEL_THRESHOLDS;
  const rewards = rewardsCatalog || domain.levelup_rewards || DEFAULT_REWARDS;
  const updatedDomain = { ...domain, levelup_rewards: rewards };
  const events = [];
  updatedDomain.xp += xpGain;

  while (updatedDomain.level < thresholds.length && updatedDomain.xp >= thresholds[updatedDomain.level]) {
    updatedDomain.level += 1;
    const reward = rewards.find((item) => item.level === updatedDomain.level) || null;
    if (reward) {
      events.push({
        domain_name: updatedDomain.name,
        new_level: updatedDomain.level,
        reward_text: reward.text,
        reward_icon: reward.icon,
        reward_sound: reward.sound
      });
    } else {
      events.push({
        domain_name: updatedDomain.name,
        new_level: updatedDomain.level,
        reward_text: null,
        reward_icon: null,
        reward_sound: null
      });
    }
  }

  return { domain: updatedDomain, events };
}

async function markQuestCompleted(deviceId, questId) {
  const db = getDb();
  const quest = await fetchQuestById(deviceId, questId);
  if (!quest) {
    return null;
  }
  if (quest.is_completed) {
    return { quest, domains: [], levelUpEvents: [], nextQuest: null };
  }

  const config = await fetchConfig(deviceId);
  const domain = await fetchDomainByName(deviceId, quest.domain_name);
  if (!domain) {
    throw new Error(`Domain ${quest.domain_name} not found for device ${deviceId}`);
  }

  const domainProgress = calculateLevelProgress(domain, Number(quest.xp), domain.levelup_rewards);
  await saveDomain(domainProgress.domain);

  let willpowerProgress = null;
  if (config.willpower_xp_per_any_quest > 0) {
    const willpower = await fetchDomainByName(deviceId, '의지');
    if (willpower) {
      willpowerProgress = calculateLevelProgress(
        willpower,
        Number(config.willpower_xp_per_any_quest),
        willpower.levelup_rewards
      );
      await saveDomain(willpowerProgress.domain);
    }
  }

  await run(
    db,
    'UPDATE quests SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND device_id = ?',
    [questId, deviceId]
  );
  const updatedQuest = await fetchQuestById(deviceId, questId);

  let nextQuest = null;
  if (quest.is_daily) {
    const nextDate = new Date(quest.date);
    nextDate.setDate(nextDate.getDate() + 1);
    nextQuest = await createQuest(deviceId, {
      title: quest.title,
      domain_name: quest.domain_name,
      xp: quest.xp,
      date: nextDate.toISOString().split('T')[0],
      is_daily: true,
      notes: quest.notes || null
    });
  }

  const domains = [domainProgress.domain];
  const levelUpEvents = [...domainProgress.events];
  if (willpowerProgress) {
    domains.push(willpowerProgress.domain);
    levelUpEvents.push(...willpowerProgress.events);
  }

  return {
    quest: updatedQuest,
    domains,
    levelUpEvents,
    nextQuest
  };
}

async function resetUserData(deviceId) {
  const db = getDb();
  await ensureUser(deviceId);
  await run(db, 'DELETE FROM quests WHERE device_id = ?', [deviceId]);
  await run(db, 'UPDATE domains SET level = 1, xp = 0, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?', [deviceId]);
  const configPayload = defaultConfigPayload();
  await run(
    db,
    `UPDATE app_config SET willpower_xp_per_any_quest = ?, default_level_thresholds_json = ?, default_levelup_rewards_json = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE device_id = ?`,
    [
      configPayload.willpower_xp_per_any_quest,
      configPayload.default_level_thresholds_json,
      configPayload.default_levelup_rewards_json,
      deviceId
    ]
  );
  const thresholdsJson = configPayload.default_level_thresholds_json;
  const rewardsJson = configPayload.default_levelup_rewards_json;
  await run(
    db,
    'UPDATE domains SET level_thresholds_json = ?, levelup_rewards_json = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?',
    [thresholdsJson, rewardsJson, deviceId]
  );
}

module.exports = {
  initializeDatabase,
  ensureUser,
  fetchConfig,
  updateConfig,
  fetchDomains,
  fetchDomainByName,
  saveDomain,
  fetchQuests,
  fetchQuestById,
  createQuest,
  updateQuest,
  deleteQuest,
  markQuestCompleted,
  resetUserData,
  DEFAULT_DOMAINS,
  DEFAULT_LEVEL_THRESHOLDS,
  DEFAULT_REWARDS
};