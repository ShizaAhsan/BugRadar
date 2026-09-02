const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret);
    const result = await query('SELECT id, email, name FROM users WHERE id = $1', [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.orgMembership) {
      return res.status(403).json({ error: 'Organization access required' });
    }
    if (roles.length > 0 && !roles.includes(req.orgMembership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

const requireOrgAccess = async (req, res, next) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return next();

    const result = await query(
      'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    req.orgMembership = { role: result.rows[0].role, organizationId: orgId };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticate, authorize, requireOrgAccess };
