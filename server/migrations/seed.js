const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create demo user
    const passwordHash = await bcrypt.hash('demo1234', 12);
    const userId = uuidv4();
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, email_verified)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO NOTHING`,
      [userId, 'demo@bugradar.dev', passwordHash, 'Demo User']
    );

    // Get or create user
    const userResult = await client.query('SELECT id FROM users WHERE email = $1', ['demo@bugradar.dev']);
    const actualUserId = userResult.rows[0]?.id || userId;

    // Create demo org
    const orgId = uuidv4();
    await client.query(
      `INSERT INTO organizations (id, name, slug, plan)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [orgId, 'Demo Organization', 'demo-org', 'pro']
    );

    const orgResult = await client.query('SELECT id FROM organizations WHERE slug = $1', ['demo-org']);
    const actualOrgId = orgResult.rows[0]?.id || orgId;

    // Create membership
    await client.query(
      `INSERT INTO memberships (user_id, organization_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [actualUserId, actualOrgId]
    );

    // Create subscription
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan, status, current_period_end)
       VALUES ($1, 'pro', 'active', NOW() + INTERVAL '30 days')
       ON CONFLICT DO NOTHING`,
      [actualOrgId]
    );

    // Create demo project
    const projectId = uuidv4();
    const crypto = require('crypto');
    const dsnKey = crypto.randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO projects (id, organization_id, name, platform, dsn_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [projectId, actualOrgId, 'My Web App', 'javascript', dsnKey]
    );

    // Create sample issues
    const issues = [
      { title: 'TypeError: Cannot read property \'map\' of undefined', culprit: 'src/components/UserList.tsx:42', severity: 'error' },
      { title: 'NetworkError: Failed to fetch /api/users', culprit: 'src/services/api.ts:15', severity: 'error' },
      { title: 'RangeError: Maximum call stack size exceeded', culprit: 'src/utils/recursion.ts:8', severity: 'fatal' },
      { title: 'Warning: Each child in a list should have a unique key', culprit: 'src/components/ItemList.tsx:23', severity: 'warning' },
      { title: 'SyntaxError: Unexpected token \'<\'', culprit: 'src/index.js:1', severity: 'error' },
    ];

    const issueIds = [];
    for (const issue of issues) {
      const issueId = uuidv4();
      issueIds.push(issueId);
      const fingerprint = crypto.createHash('sha256').update(issue.title).digest('hex');
      const eventCount = Math.floor(Math.random() * 500) + 10;
      const daysAgo = Math.floor(Math.random() * 30);
      const hoursAgo = Math.floor(Math.random() * 2);
      await client.query(
        `INSERT INTO issues (id, project_id, title, culprit, fingerprint_hash, severity, event_count, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' days')::INTERVAL, NOW() - ($9 || ' hours')::INTERVAL)
         ON CONFLICT DO NOTHING`,
        [issueId, projectId, issue.title, issue.culprit, fingerprint, issue.severity, eventCount, String(daysAgo), String(hoursAgo)]
      );

      // Create sample events for each issue
      for (let i = 0; i < Math.min(eventCount, 5); i++) {
        await client.query(
          `INSERT INTO events (issue_id, project_id, timestamp, environment, message, stack_trace, breadcrumbs, tags)
           VALUES ($1, $2, NOW() - ($3 || ' hours')::INTERVAL, 'production', $4, $5, $6, $7)`,
          [
            issueId,
            projectId,
            String(i),
            issue.title,
            JSON.stringify({
              frames: [
                { filename: issue.culprit.split(':')[0], lineno: parseInt(issue.culprit.split(':')[1]) || 0, function: 'render' },
                { filename: 'node_modules/react-dom/index.js', lineno: 123, function: 'processChild' },
              ],
            }),
            JSON.stringify([
              { category: 'ui.click', message: 'button#submit clicked', timestamp: new Date(Date.now() - 60000).toISOString() },
              { category: 'http', message: 'POST /api/data 200', timestamp: new Date(Date.now() - 30000).toISOString() },
            ]),
            JSON.stringify({ browser: 'Chrome 120', os: 'Windows 10' }),
          ]
        );
      }
    }

    // Create sample alert rules
    await client.query(
      `INSERT INTO alert_rules (project_id, name, trigger_type, channel, enabled)
       VALUES ($1, 'New Issue Alert', 'new_issue', 'email', true),
              ($1, 'High Volume Spike', 'spike', 'email', true)
       ON CONFLICT DO NOTHING`,
      [projectId]
    );

    await client.query('COMMIT');
    console.log('Seed completed successfully!');
    console.log(`Demo login: demo@bugradar.dev / demo1234`);
    console.log(`Project DSN: ${dsnKey}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
