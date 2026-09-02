const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/me', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, name, email_verified, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.patch('/me', async (req, res) => {
  try {
    const { name, email } = req.body;

    if (name !== undefined) {
      if (!name || name.trim().length < 1) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      if (name.length > 255) {
        return res.status(400).json({ error: 'Name too long' });
      }
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.user.id);

    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, email_verified`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.get('/org/:orgId', async (req, res) => {
  try {
    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, req.params.orgId]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    const result = await query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at as joined_at
       FROM users u
       JOIN memberships m ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at`,
      [req.params.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get org users' });
  }
});

router.get('/org/:orgId/:userId', async (req, res) => {
  try {
    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, req.params.orgId]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    const result = await query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at as joined_at
       FROM users u
       JOIN memberships m ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.id = $2`,
      [req.params.orgId, req.params.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in this organization' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
