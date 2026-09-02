const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { authenticate, requireOrgAccess, authorize } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

router.use(authenticate);

router.get('/org/:orgId', requireOrgAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'unresolved') as unresolved_count,
        (SELECT MAX(e.timestamp) FROM events e WHERE e.project_id = p.id) as last_event_at
       FROM projects p WHERE p.organization_id = $1 ORDER BY p.created_at DESC`,
      [req.params.orgId]
    );
    res.json(result.rows.map(r => ({
      ...r,
      unresolved_count: parseInt(r.unresolved_count, 10),
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

router.post('/org/:orgId', requireOrgAccess, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { name, platform } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const projectCount = await query(
      'SELECT COUNT(*) FROM projects WHERE organization_id = $1',
      [req.params.orgId]
    );

    const sub = await query(
      'SELECT plan FROM subscriptions WHERE organization_id = $1',
      [req.params.orgId]
    );
    const plan = sub.rows[0]?.plan || 'free';
    const maxProjects = config.plans[plan]?.maxProjects || 3;

    if (parseInt(projectCount.rows[0].count, 10) >= maxProjects) {
      return res.status(403).json({ error: `Project limit reached for ${plan} plan` });
    }

    const dsnKey = crypto.randomBytes(32).toString('hex');
    const result = await query(
      'INSERT INTO projects (organization_id, name, platform, dsn_key) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.orgId, name, platform || 'javascript', dsnKey]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const result = await query('SELECT * FROM projects WHERE id = $1', [req.params.projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, result.rows[0].organization_id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this project' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project' });
  }
});

router.patch('/:projectId', async (req, res) => {
  try {
    const projectResult = await query('SELECT * FROM projects WHERE id = $1', [req.params.projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, projectResult.rows[0].organization_id]
    );
    if (membership.rows.length === 0 || !['owner', 'admin'].includes(membership.rows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { name, platform } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name) { updates.push(`name = $${idx++}`); values.push(name); }
    if (platform) { updates.push(`platform = $${idx++}`); values.push(platform); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.params.projectId);

    const result = await query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.post('/:projectId/regenerate-dsn', async (req, res) => {
  try {
    const projectResult = await query('SELECT * FROM projects WHERE id = $1', [req.params.projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, projectResult.rows[0].organization_id]
    );
    if (membership.rows.length === 0 || membership.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can regenerate DSN' });
    }

    const newDsn = crypto.randomBytes(32).toString('hex');
    const result = await query(
      'UPDATE projects SET dsn_key = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newDsn, req.params.projectId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate DSN' });
  }
});

router.delete('/:projectId', async (req, res) => {
  try {
    const projectResult = await query('SELECT * FROM projects WHERE id = $1', [req.params.projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, projectResult.rows[0].organization_id]
    );
    if (membership.rows.length === 0 || membership.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can delete project' });
    }

    await query('DELETE FROM projects WHERE id = $1', [req.params.projectId]);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
