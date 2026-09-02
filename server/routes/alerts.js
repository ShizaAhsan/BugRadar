const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

async function checkProjectAccess(projectId, userId) {
  const projectResult = await query('SELECT organization_id FROM projects WHERE id = $1', [projectId]);
  if (projectResult.rows.length === 0) return null;

  const membership = await query(
    'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, projectResult.rows[0].organization_id]
  );
  if (membership.rows.length === 0) return null;

  return { orgId: projectResult.rows[0].organization_id, role: membership.rows[0].role };
}

async function checkRuleAccess(ruleId, userId) {
  const ruleResult = await query(
    `SELECT ar.id, p.organization_id FROM alert_rules ar
     JOIN projects p ON ar.project_id = p.id WHERE ar.id = $1`,
    [ruleId]
  );
  if (ruleResult.rows.length === 0) return null;

  const membership = await query(
    'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, ruleResult.rows[0].organization_id]
  );
  if (membership.rows.length === 0) return null;

  return { orgId: ruleResult.rows[0].organization_id, role: membership.rows[0].role };
}

router.get('/project/:projectId', async (req, res) => {
  try {
    const access = await checkProjectAccess(req.params.projectId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const result = await query(
      'SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get alert rules' });
  }
});

router.post('/project/:projectId', async (req, res) => {
  try {
    const access = await checkProjectAccess(req.params.projectId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const { name, trigger_type, threshold, window_minutes, channel, webhook_url } = req.body;

    if (!name || !trigger_type) {
      return res.status(400).json({ error: 'Name and trigger_type are required' });
    }

    if (!['new_issue', 'spike'].includes(trigger_type)) {
      return res.status(400).json({ error: 'Invalid trigger_type. Use: new_issue or spike' });
    }

    if (trigger_type === 'spike') {
      if (!threshold || threshold < 1) {
        return res.status(400).json({ error: 'Threshold must be a positive number for spike alerts' });
      }
      if (!window_minutes || window_minutes < 1) {
        return res.status(400).json({ error: 'Window must be a positive number for spike alerts' });
      }
    }

    if (channel && !['email', 'webhook'].includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel. Use: email or webhook' });
    }

    if (channel === 'webhook' && !webhook_url) {
      return res.status(400).json({ error: 'Webhook URL is required for webhook channel' });
    }

    const result = await query(
      `INSERT INTO alert_rules (project_id, name, trigger_type, threshold, window_minutes, channel, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.projectId, name, trigger_type, threshold || null, window_minutes || null, channel || 'email', webhook_url || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create alert rule error:', err);
    res.status(500).json({ error: 'Failed to create alert rule' });
  }
});

router.patch('/:ruleId', async (req, res) => {
  try {
    const access = await checkRuleAccess(req.params.ruleId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Rule not found or access denied' });
    }

    const { name, enabled, threshold, window_minutes, channel, webhook_url } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(enabled); }
    if (threshold !== undefined) { updates.push(`threshold = $${idx++}`); values.push(threshold); }
    if (window_minutes !== undefined) { updates.push(`window_minutes = $${idx++}`); values.push(window_minutes); }
    if (channel !== undefined) {
      if (!['email', 'webhook'].includes(channel)) {
        return res.status(400).json({ error: 'Invalid channel' });
      }
      updates.push(`channel = $${idx++}`); values.push(channel);
    }
    if (webhook_url !== undefined) { updates.push(`webhook_url = $${idx++}`); values.push(webhook_url); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.ruleId);

    const result = await query(
      `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

router.delete('/:ruleId', async (req, res) => {
  try {
    const access = await checkRuleAccess(req.params.ruleId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Rule not found or access denied' });
    }

    await query('DELETE FROM alert_rules WHERE id = $1', [req.params.ruleId]);
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

router.get('/history/:projectId', async (req, res) => {
  try {
    const access = await checkProjectAccess(req.params.projectId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const result = await query(
      `SELECT ah.*, ar.name as rule_name, i.title as issue_title
       FROM alert_history ah
       JOIN alert_rules ar ON ah.alert_rule_id = ar.id
       LEFT JOIN issues i ON ah.issue_id = i.id
       WHERE ar.project_id = $1
       ORDER BY ah.triggered_at DESC LIMIT 50`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get alert history' });
  }
});

module.exports = router;
