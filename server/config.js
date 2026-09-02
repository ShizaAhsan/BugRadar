require('dotenv').config();
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD', 'WEBHOOK_SECRET'];
  for (const key of required) {
    if (!process.env[key] || process.env[key].length < 32) {
      console.error(`FATAL: ${key} must be set and at least 32 characters in production`);
      process.exit(1);
    }
  }
  if (!process.env.DB_HOST) {
    console.error('FATAL: DB_HOST must be set in production');
    process.exit(1);
  }
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'bugradar',
    password: process.env.DB_PASSWORD || (isProduction ? (() => { throw new Error('DB_PASSWORD required'); })() : 'bugradar_secret'),
    database: process.env.DB_NAME || 'bugradar',
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || (isProduction ? (() => { throw new Error('JWT_ACCESS_SECRET required'); })() : crypto.randomBytes(64).toString('hex')),
    refreshSecret: process.env.JWT_REFRESH_SECRET || (isProduction ? (() => { throw new Error('JWT_REFRESH_SECRET required'); })() : crypto.randomBytes(64).toString('hex')),
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },

  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'BugRadar <noreply@bugradar.dev>',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },

  rateLimit: {
    windowMs: 60 * 1000,
    max: 100,
  },

  authRateLimit: {
    windowMs: 15 * 60 * 1000,
    loginMax: 10,
    signupMax: 5,
    refreshMax: 20,
  },

  ingestion: {
    maxPayloadSize: 1024 * 1024,
    rateLimitPerMinute: 60,
  },

  webhookSecret: process.env.WEBHOOK_SECRET || (isProduction ? (() => { throw new Error('WEBHOOK_SECRET required'); })() : crypto.randomBytes(32).toString('hex')),

  plans: {
    free: {
      maxOrgs: 1,
      maxProjects: 3,
      maxEventsPerMonth: 5000,
      retentionDays: 30,
    },
    pro: {
      maxOrgs: 10,
      maxProjects: 50,
      maxEventsPerMonth: 100000,
      retentionDays: 90,
      priceUsd: 20,
    },
  },
};
