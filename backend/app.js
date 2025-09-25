const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const {
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
} = require('./db');

const createBootstrapRouter = require('./routes/bootstrap');
const createSnapshotRouter = require('./routes/snapshot');
const createQuestsRouter = require('./routes/quests');
const createDomainsRouter = require('./routes/domains');
const createConfigRouter = require('./routes/config');
const createResetRouter = require('./routes/reset');

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const CORS_WHITELIST = (process.env.CORS_WHITELIST || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function requireDeviceId(req, res, next) {
  const deviceId = req.header('X-Device-ID');
  if (!deviceId) {
    return res.status(400).json({ error: 'X-Device-ID header is required' });
  }
  req.deviceId = deviceId;
  return next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(morgan('dev'));

  const corsOptions = {
    origin(origin, callback) {
      if (!origin || !CORS_WHITELIST.length || CORS_WHITELIST.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS not allowed for this origin'));
    },
    allowedHeaders: ['Content-Type', 'X-Device-ID'],
    credentials: true
  };
  app.use(cors(corsOptions));

  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.header('X-Device-ID') || req.ip
  });
  app.use(limiter);

  app.use(requireDeviceId);
  app.use(
    asyncHandler(async (req, res, next) => {
      await ensureUser(req.deviceId);
      req.user = { id: req.deviceId };
      next();
    })
  );

  const sharedDependencies = {
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

  app.use('/api/bootstrap', createBootstrapRouter(sharedDependencies));
  app.use('/api/snapshot', createSnapshotRouter(sharedDependencies));
  app.use('/api/quests', createQuestsRouter(sharedDependencies));
  app.use('/api/domains', createDomainsRouter(sharedDependencies));
  app.use('/api/config', createConfigRouter(sharedDependencies));
  app.use('/api/reset', createResetRouter(sharedDependencies));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
    });
  });

  return app;
}

async function startServer(customPort) {
  await initializeDatabase();
  const app = createApp();
  const port = customPort || process.env.PORT || 4000;

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Habit RPG backend listening on port ${port}`);
      resolve({ app, server });
    });
  });
}

module.exports = { createApp, startServer, initializeDatabase };