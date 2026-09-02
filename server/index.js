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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', globalLimiter);

// Serve only the public directory for frontend files
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { maxAge: '1d', index: 'index.html' }));
} else {
  // Fallback: serve HTML files from project root but not server code
  app.use(express.static(path.join(__dirname, '..'), {
    maxAge: '1d',
    index: 'index.html',
    dotfiles: 'deny',
  }));
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
    const IORedis = require('ioredis');
    const redisOpts = { host: config.redis.host, port: config.redis.port, connectTimeout: 2000, lazyConnect: true };
    if (config.redis.password) redisOpts.password = config.redis.password;
    const redis = new IORedis(redisOpts);
    await redis.connect();
    await redis.ping();
    await redis.quit();
    health.redis = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.redis = 'disconnected';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// SPA fallback — serve index.html for non-API routes with path traversal protection
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ingest') && !req.path.startsWith('/sdk')) {
    const htmlFile = req.path.endsWith('.html') ? req.path : req.path + '.html';
    const filePath = path.join(__dirname, '..', htmlFile);
    const resolvedPath = path.resolve(filePath);
    const webRoot = path.resolve(path.join(__dirname, '..'));

    if (resolvedPath.startsWith(webRoot) && fs.existsSync(resolvedPath)) {
      return res.sendFile(resolvedPath);
    }
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
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
