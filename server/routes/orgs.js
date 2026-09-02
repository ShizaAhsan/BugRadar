const express = require('express');
const { query } = require('../db');
const { authenticate, requireOrgAccess, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/', async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    const existing = await query('SELECT id FROM organizations WHERE slug = $1', [slugClean]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Organization slug already taken' });
    }

    const orgResult = await query(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *',
      [name, slugClean]
    );
    const org = orgResult.rows[0];

    await query(
      'INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)',
      [req.user.id, org.id, 'owner']
    );

    await query(
      'INSERT INTO subscriptions (organization_id, plan, status, current_period_end) VALUES ($1, $2, $3, NOW() + INTERVAL \'30 days\')',
      [org.id, 'free', 'active']
    );

    await query(
      'INSERT INTO audit_log (organization_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [org.id, req.user.id, 'org.created', JSON.stringify({ name })]
    );

    res.status(201).json(org);
  } catch (err) {
    console.error('Create org error:', err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

router.get('/:orgId', requireOrgAccess, async (req, res) => {
  try {
    const result = await query('SELECT * FROM organizations WHERE id = $1', [req.params.orgId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

router.get('/:orgId/members', requireOrgAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at as joined_at
       FROM memberships m JOIN users u ON m.user_id = u.id
       WHERE m.organization_id = $1 ORDER BY m.created_at ASC`,
      [req.params.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get members' });
  }
});

router.post('/:orgId/members', requireOrgAccess, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const userResult = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found. They must sign up first.' });
    }

    const existing = await query(
      'SELECT id FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [userResult.rows[0].id, req.params.orgId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User is already a member' });
    }

    const memberRole = ['admin', 'member'].includes(role) ? role : 'member';
    await query(
      'INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)',
      [userResult.rows[0].id, req.params.orgId, memberRole]
    );

    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

router.delete('/:orgId/members/:userId', requireOrgAccess, authorize('owner', 'admin'), async (req, res) => {
  try {
    if (req.params.userId === req.user.id && req.orgMembership.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot remove themselves' });
    }

    await query(
      'DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.params.userId, req.params.orgId]
    );
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
