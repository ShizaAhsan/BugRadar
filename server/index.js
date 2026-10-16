const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { pool } = require('./db');

const app = express();

// Trust proxy (required behind nginx/reverse proxy)
app.set('trust proxy', 1);

// Security headers with CSP
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is required because the frontend uses inline <script> blocks
      // and inline on* handlers throughout (see QA-BUG-REPORT.md C1).
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Helmet defaults script-src-attr to 'none', which would STILL block inline
      // onclick handlers even with 'unsafe-inline' in script-src (CSP3 fallback rules).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(cors({ origin: config.cors.origin, credentials: true }));
// Keep the raw request buffer so webhook HMACs are computed over exact sender bytes
// (re-serializing JSON can change key order and break signature verification — QA-BUG-REPORT.md B12)
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', globalLimiter);

// Serve frontend files from the dedicated public/ directory ONLY.
// Serving the project root here used to expose server source, node_modules and
// test scripts (QA-BUG-REPORT.md B2) — that fallback has been removed.
const publicDir = path.join(__dirname, '..', 'public');
const webRoot = path.resolve(publicDir);

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      // HTML: always revalidate so deploys are never stale for a day (QA-BUG-REPORT.md M15)
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  }));
} else {
  console.error('FATAL: public/ directory not found — frontend assets will NOT be served. Run: node scripts? (see QA-BUG-REPORT.md B2)');
}

// Serve SDK
app.use('/sdk', express.static(path.join(__dirname, '..', 'sdk')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orgs', require('./routes/orgs'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/users', require('./routes/users'));
app.use('/api/invitations', require('./routes/invitations'));

// Ingestion endpoint (public, keyed by DSN)
app.use('/ingest', require('./routes/ingestion'));

// Health check — verifies DB + Redis connectivity
// Shared lazy Redis client for health checks (QA-BUG-REPORT.md M18 — a new
// connection per health call leaked instances on failure paths)
let healthRedisClient = null;
async function pingRedis() {
  if (!healthRedisClient) {
    const IORedis = require('ioredis');
    const redisOpts = { host: config.redis.host, port: config.redis.port, connectTimeout: 2000, lazyConnect: true };
    if (config.redis.password) redisOpts.password = config.redis.password;
    healthRedisClient = new IORedis(redisOpts);
    healthRedisClient.on('error', () => { /* surfaced via ping result */ });
  }
  if (healthRedisClient.status === 'wait') {
    await healthRedisClient.connect();
  }
  await healthRedisClient.ping();
}

app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', timestamp: new Date().toISOString() };

  try {
    await pool.query('SELECT 1');
    health.database = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.database = 'disconnected';
  }

  try {
    await pingRedis();
    health.redis = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.redis = 'disconnected';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// SPA fallback — serve HTML pages for non-API routes with path traversal protection
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ingest') || req.path.startsWith('/sdk')) {
    // Unmatched API/ingestion/SDK GET must 404, not hang (QA-BUG-REPORT.md B1)
    return res.status(404).json({ error: 'Not found' });
  }

  const htmlFile = req.path.endsWith('.html') ? req.path : req.path + '.html';
  const resolvedPath = path.resolve(path.join(webRoot, htmlFile));

  // Ensure the resolved path stays inside webRoot (append separator to block sibling-prefix escapes)
  if (resolvedPath.startsWith(webRoot + path.sep) && fs.existsSync(resolvedPath)) {
    return res.sendFile(resolvedPath);
  }

  // Paths that look like assets (has an extension) must 404 instead of
  // returning index.html (which would execute as broken JS/CSS)
  const lastSegment = req.path.split('/').pop() || '';
  if (lastSegment.includes('.')) {
    return res.status(404).send('Not found');
  }

  res.sendFile(path.join(webRoot, 'index.html'));
});

// Error handler — honour body-parser status (malformed JSON => 400, QA-BUG-REPORT.md B10)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || err.statusCode || 500;
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

// Graceful shutdown
let server;
function shutdown(signal) {
  console.log(`${signal} received. Starting graceful shutdown...`);
  server.close(async () => {
    console.log('HTTP server closed');
    try {
      await pool.end();
      console.log('Database pool closed');
    } catch (err) {
      console.error('Error closing database pool:', err);
    }
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = config.port;
server = app.listen(PORT, () => {
  console.log(`BugRadar server running on port ${PORT} [${config.nodeEnv}]`);

  // Start retention worker (event cleanup + quota reconciliation)
  if (config.nodeEnv !== 'test') {
    const { startRetentionWorker } = require('./workers/retention');
    startRetentionWorker().catch(err => {
      console.error('Retention worker failed to start:', err);
    });
  }
});

module.exports = app;
