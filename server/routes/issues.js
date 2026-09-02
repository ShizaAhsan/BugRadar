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

async function checkIssueAccess(issueId, userId) {
  const issueResult = await query(
    `SELECT i.id, p.organization_id FROM issues i
     JOIN projects p ON i.project_id = p.id WHERE i.id = $1`,
    [issueId]
  );
  if (issueResult.rows.length === 0) return null;

  const membership = await query(
    'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, issueResult.rows[0].organization_id]
  );
  if (membership.rows.length === 0) return null;

  return { orgId: issueResult.rows[0].organization_id, role: membership.rows[0].role };
}

router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { status, environment, search, sort, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const access = await checkProjectAccess(projectId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    let whereClause = 'WHERE i.project_id = $1';
    const params = [projectId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND i.status = $${paramIdx++}`;
      params.push(status);
    }

    if (search) {
      whereClause += ` AND (i.title ILIKE $${paramIdx} OR i.culprit ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const orderBy = sort === 'first_seen' ? 'i.first_seen DESC'
      : sort === 'count' ? 'i.event_count DESC'
      : 'i.last_seen DESC';

    const countResult = await query(
      `SELECT COUNT(*) FROM issues i ${whereClause}`,
      params
    );

    params.push(parseInt(limit, 10), offset);
    const result = await query(
      `SELECT i.*,
        u.name as assignee_name,
        u.email as assignee_email
       FROM issues i
       LEFT JOIN users u ON i.assigned_to = u.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );

    res.json({
      issues: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('List issues error:', err);
    res.status(500).json({ error: 'Failed to get issues' });
  }
});

router.get('/project/:projectId/stats', async (req, res) => {
  try {
    const { projectId } = req.params;

    const access = await checkProjectAccess(projectId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'unresolved') as unresolved,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'ignored') as ignored,
        COUNT(*) as total
       FROM issues WHERE project_id = $1`,
      [projectId]
    );

    const eventsPerDay = await query(
      `SELECT DATE(timestamp) as date, COUNT(*) as count
       FROM events WHERE project_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
       GROUP BY DATE(timestamp) ORDER BY date`,
      [projectId]
    );

    const topIssues = await query(
      `SELECT id, title, event_count, status, last_seen, severity, culprit
       FROM issues WHERE project_id = $1
       ORDER BY event_count DESC LIMIT 5`,
      [projectId]
    );

    res.json({
      stats: {
        unresolved: parseInt(stats.rows[0].unresolved, 10),
        resolved: parseInt(stats.rows[0].resolved, 10),
        ignored: parseInt(stats.rows[0].ignored, 10),
        total: parseInt(stats.rows[0].total, 10),
      },
      eventsPerDay: eventsPerDay.rows,
      topIssues: topIssues.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project stats' });
  }
});

router.get('/:issueId', async (req, res) => {
  try {
    const access = await checkIssueAccess(req.params.issueId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Issue not found or access denied' });
    }

    const result = await query(
      `SELECT i.*, u.name as assignee_name, u.email as assignee_email
       FROM issues i
       LEFT JOIN users u ON i.assigned_to = u.id
       WHERE i.id = $1`,
      [req.params.issueId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    const issue = result.rows[0];

    const events = await query(
      `SELECT * FROM events WHERE issue_id = $1 ORDER BY timestamp DESC LIMIT 10`,
      [req.params.issueId]
    );

    const comments = await query(
      `SELECT c.*, u.name as author_name, u.email as author_email
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.issue_id = $1 ORDER BY c.created_at ASC`,
      [req.params.issueId]
    );

    const usersCount = await query(
      `SELECT COUNT(DISTINCT user_context->>'id') as count
       FROM events WHERE issue_id = $1 AND user_context->>'id' IS NOT NULL`,
      [req.params.issueId]
    );

    res.json({
      ...issue,
      affected_users: parseInt(usersCount.rows[0].count, 10),
      recent_events: events.rows,
      comments: comments.rows,
    });
  } catch (err) {
    console.error('Get issue error:', err);
    res.status(500).json({ error: 'Failed to get issue' });
  }
});

router.patch('/:issueId', async (req, res) => {
  try {
    const access = await checkIssueAccess(req.params.issueId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Issue not found or access denied' });
    }

    const { status, assigned_to } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (status) {
      if (!['unresolved', 'resolved', 'ignored'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${idx++}`);
      values.push(assigned_to || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.issueId);

    const result = await query(
      `UPDATE issues SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update issue' });
  }
});

router.post('/:issueId/comments', async (req, res) => {
  try {
    const access = await checkIssueAccess(req.params.issueId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Issue not found or access denied' });
    }

    const { body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Comment body is required' });
    }

    const result = await query(
      `INSERT INTO comments (issue_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING *, $4 as author_name, $5 as author_email`,
      [req.params.issueId, req.user.id, body.trim(), req.user.name, req.user.email]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

router.delete('/:issueId', async (req, res) => {
  try {
    const access = await checkIssueAccess(req.params.issueId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Issue not found or access denied' });
    }

    if (access.role === 'member') {
      return res.status(403).json({ error: 'Only admins can delete issues' });
    }

    await query('DELETE FROM events WHERE issue_id = $1', [req.params.issueId]);
    const result = await query('DELETE FROM issues WHERE id = $1 RETURNING id', [req.params.issueId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    res.json({ message: 'Issue deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete issue' });
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const { issue_ids, action } = req.body;
    if (!issue_ids || !Array.isArray(issue_ids) || issue_ids.length === 0 || !action) {
      return res.status(400).json({ error: 'issue_ids array and action are required' });
    }

    if (issue_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 issues per bulk operation' });
    }

    // Check access for first issue to determine org
    const firstAccess = await checkIssueAccess(issue_ids[0], req.user.id);
    if (!firstAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (action === 'delete' && firstAccess.role === 'member') {
      return res.status(403).json({ error: 'Only admins can delete issues' });
    }

    let updateClause;
    if (action === 'resolve') updateClause = "status = 'resolved'";
    else if (action === 'ignore') updateClause = "status = 'ignored'";
    else if (action === 'delete') {
      await query('DELETE FROM events WHERE issue_id = ANY($1)', [issue_ids]);
      await query('DELETE FROM issues WHERE id = ANY($1)', [issue_ids]);
      return res.json({ message: `${issue_ids.length} issues deleted` });
    }
    else return res.status(400).json({ error: 'Invalid action. Use: resolve, ignore, or delete' });

    await query(`UPDATE issues SET ${updateClause}, updated_at = NOW() WHERE id = ANY($1)`, [issue_ids]);
    res.json({ message: `${issue_ids.length} issues updated` });
  } catch (err) {
    res.status(500).json({ error: 'Bulk update failed' });
  }
});

module.exports = router;
