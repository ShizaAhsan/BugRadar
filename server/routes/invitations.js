const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendEmail, generateInviteEmail } = require('../email');
const config = require('../config');

const router = express.Router();

router.use(authenticate);

async function checkOrgAccess(orgId, userId) {
  const membership = await query(
    'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, orgId]
  );
  if (membership.rows.length === 0) return null;
  return membership.rows[0].role;
}

// List invitations for an org
router.get('/org/:orgId', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    const result = await query(
      `SELECT * FROM invitations
       WHERE organization_id = $1 AND accepted = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.params.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get invitations' });
  }
});

// Create invitation
router.post('/org/:orgId', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only owners and admins can invite members' });
    }

    const { email, invite_role } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const memberRole = invite_role || 'member';
    if (!['admin', 'member'].includes(memberRole)) {
      return res.status(400).json({ error: 'Invalid role. Use: admin or member' });
    }

    // Check if user is already a member
    const existingUser = await query(
      `SELECT u.id FROM users u
       JOIN memberships m ON u.id = m.user_id
       WHERE u.email = $1 AND m.organization_id = $2`,
      [email.toLowerCase(), req.params.orgId]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User is already a member of this organization' });
    }

    // Check for existing pending invitation
    const existingInvite = await query(
      `SELECT id FROM invitations
       WHERE organization_id = $1 AND email = $2 AND accepted = FALSE AND expires_at > NOW()`,
      [req.params.orgId, email.toLowerCase()]
    );
    if (existingInvite.rows.length > 0) {
      return res.status(409).json({ error: 'Invitation already pending for this email' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await query(
      `INSERT INTO invitations (organization_id, email, role, token, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.orgId, email.toLowerCase(), memberRole, token, expiresAt]
    );

    // Get org name and inviter name
    const orgResult = await query('SELECT name FROM organizations WHERE id = $1', [req.params.orgId]);
    const orgName = orgResult.rows[0]?.name || 'Organization';

    // Send invitation email
    const inviteUrl = `${config.cors.origin}/invite.html?token=${token}`;
    sendEmail(
      email.toLowerCase(),
      `You're invited to ${orgName} on BugRadar`,
      generateInviteEmail(req.user.name, orgName, inviteUrl)
    ).catch(err => console.error('Invite email failed:', err));

    // Audit log
    await query(
      `INSERT INTO audit_log (organization_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [req.params.orgId, req.user.id, 'member.invited', JSON.stringify({ email: email.toLowerCase(), role: memberRole })]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create invitation error:', err);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// Accept invitation (public endpoint - no auth required)
router.get('/accept/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT * FROM invitations
       WHERE token = $1 AND accepted = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    const invitation = result.rows[0];

    // Check if user is logged in
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.redirect(`/login.html?invite=${token}`);
    }

    const jwt = require('jsonwebtoken');
    const tokenValue = authHeader.replace('Bearer ', '');
    try {
      const decoded = jwt.verify(tokenValue, config.jwt.accessSecret);
      const userResult = await query('SELECT id, email FROM users WHERE id = $1', [decoded.userId]);

      if (userResult.rows.length === 0) {
        return res.redirect(`/login.html?invite=${token}`);
      }

      const user = userResult.rows[0];

      // Check email matches invitation
      if (user.email !== invitation.email) {
        return res.status(403).json({ error: 'This invitation is for a different email address' });
      }

      // Add user to organization
      await query(
        `INSERT INTO memberships (user_id, organization_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [user.id, invitation.organization_id, invitation.role]
      );

      // Mark invitation as accepted
      await query(
        'UPDATE invitations SET accepted = TRUE WHERE id = $1',
        [invitation.id]
      );

      // Audit log
      await query(
        `INSERT INTO audit_log (organization_id, user_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [invitation.organization_id, user.id, 'member.joined', JSON.stringify({ invited_email: invitation.email })]
      );

      res.redirect('/dashboard.html');
    } catch (err) {
      return res.redirect(`/login.html?invite=${token}`);
    }
  } catch (err) {
    console.error('Accept invitation error:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// Cancel/delete invitation
router.delete('/:invitationId', async (req, res) => {
  try {
    const inviteResult = await query(
      'SELECT * FROM invitations WHERE id = $1',
      [req.params.invitationId]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    const invitation = inviteResult.rows[0];
    const role = await checkOrgAccess(invitation.organization_id, req.user.id);
    if (!role || !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await query('DELETE FROM invitations WHERE id = $1', [req.params.invitationId]);
    res.json({ message: 'Invitation cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel invitation' });
  }
});

module.exports = router;
