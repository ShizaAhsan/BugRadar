const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { sendEmail, generateVerificationEmail, generateInviteEmail } = require('../email');

const router = express.Router();

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.loginMax,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.signupMax,
  message: { error: 'Too many signup attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.refreshMax,
  message: { error: 'Too many refresh attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, config.jwt.accessSecret, { expiresIn: config.jwt.accessExpiry });
  const refreshToken = jwt.sign({ userId }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiry });
  return { accessToken, refreshToken };
}

function setTokenCookies(res, accessToken, refreshToken) {
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = uuidv4();

    const result = await query(
      'INSERT INTO users (email, password_hash, name, verification_token) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
      [email.toLowerCase(), passwordHash, name, verificationToken]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id);
    setTokenCookies(res, accessToken, refreshToken);

    // Send verification email (non-blocking)
    const verifyUrl = `${config.cors.origin}/api/auth/verify-email?token=${verificationToken}`;
    sendEmail(email, 'Verify your BugRadar account', generateVerificationEmail(name, verifyUrl)).catch(() => {});

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    setTokenCookies(res, accessToken, refreshToken);

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(token, config.jwt.refreshSecret);
    const result = await query('SELECT id, email, name FROM users WHERE id = $1', [decoded.userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.userId);
    setTokenCookies(res, accessToken, newRefresh);

    res.json({ accessToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const memberships = await query(
      `SELECT m.role, o.id as org_id, o.name as org_name, o.slug as org_slug, o.plan
       FROM memberships m JOIN organizations o ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.created_at ASC`,
      [req.user.id]
    );

    res.json({
      user: { id: req.user.id, email: req.user.email, name: req.user.name },
      organizations: memberships.rows.map(m => ({
        id: m.org_id,
        name: m.org_name,
        slug: m.org_slug,
        role: m.role,
        plan: m.plan,
      })),
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Email verification
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Verification token required' });
    }

    const result = await query(
      'UPDATE users SET email_verified = TRUE, verification_token = NULL WHERE verification_token = $1 RETURNING id',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    res.redirect('/login.html?verified=true');
  } catch (err) {
    console.error('Email verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Resend verification email
router.post('/resend-verification', authenticate, async (req, res) => {
  try {
    const user = await query('SELECT email, name, email_verified, verification_token FROM users WHERE id = $1', [req.user.id]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = user.rows[0];
    if (u.email_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const token = u.verification_token || uuidv4();
    if (!u.verification_token) {
      await query('UPDATE users SET verification_token = $1 WHERE id = $2', [token, req.user.id]);
    }

    const verifyUrl = `${config.cors.origin}/api/auth/verify-email?token=${token}`;
    await sendEmail(u.email, 'Verify your BugRadar account', generateVerificationEmail(u.name, verifyUrl));

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

module.exports = router;
