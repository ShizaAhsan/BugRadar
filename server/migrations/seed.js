const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { pool } = require('../db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Make seed idempotent even if migrations haven't run yet (QA-BUG-REPORT.md B13)
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_org ON subscriptions(organization_id)');

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

    // Create (or refresh) the single subscription — unique per org now (B13)
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan, status, current_period_end)
       VALUES ($1, 'pro', 'active', NOW() + INTERVAL '30 days')
       ON CONFLICT (organization_id)
       DO UPDATE SET plan = 'pro', status = 'active', updated_at = NOW()`,
      [actualOrgId]
    );

    // Reuse the demo project on re-runs instead of inserting a duplicate each time (B13)
    const existingProject = await client.query(
      `SELECT id, dsn_key FROM projects WHERE organization_id = $1 AND name = 'My Web App' LIMIT 1`,
      [actualOrgId]
    );

    let actualProjectId;
    let dsnKey;
    let projectIsNew = false;

    if (existingProject.rows.length > 0) {
      actualProjectId = existingProject.rows[0].id;
      dsnKey = existingProject.rows[0].dsn_key;
      projectIsNew = false;
    } else {
      projectIsNew = true;
      actualProjectId = uuidv4();
      dsnKey = crypto.randomBytes(32).toString('hex');
      await client.query(
        `INSERT INTO projects (id, organization_id, name, platform, dsn_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [actualProjectId, actualOrgId, 'My Web App', 'javascript', dsnKey]
      );
    }

    // Create sample issues (skip ones that already exist for this project) (B13)
    const issues = [
      { title: 'TypeError: Cannot read property \'map\' of undefined', culprit: 'src/components/UserList.tsx:42', severity: 'error' },
      { title: 'NetworkError: Failed to fetch /api/users', culprit: 'src/services/api.ts:15', severity: 'error' },
      { title: 'RangeError: Maximum call stack size exceeded', culprit: 'src/utils/recursion.ts:8', severity: 'fatal' },
      { title: 'Warning: Each child in a list should have a unique key', culprit: 'src/components/ItemList.tsx:23', severity: 'warning' },
      { title: 'SyntaxError: Unexpected token \'<\'', culprit: 'src/index.js:1', severity: 'error' },
    ];

    for (const issue of issues) {
      const fingerprint = crypto.createHash('sha256').update(issue.title).digest('hex');

      const existingIssue = await client.query(
        'SELECT id FROM issues WHERE project_id = $1 AND fingerprint_hash = $2 LIMIT 1',
        [actualProjectId, fingerprint]
      );

      let issueId;
      let issueIsNew = false;

      if (existingIssue.rows.length > 0) {
        issueId = existingIssue.rows[0].id;
      } else {
        issueIsNew = true;
        issueId = uuidv4();
        const eventCount = Math.floor(Math.random() * 500) + 10;
        const daysAgo = Math.floor(Math.random() * 30);
        const hoursAgo = Math.floor(Math.random() * 2);
        await client.query(
          `INSERT INTO issues (id, project_id, title, culprit, fingerprint_hash, severity, event_count, first_seen, last_seen)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' days')::INTERVAL, NOW() - ($9 || ' hours')::INTERVAL)`,
          [issueId, actualProjectId, issue.title, issue.culprit, fingerprint, issue.severity, eventCount, String(daysAgo), String(hoursAgo)]
        );
      }

      // Only add sample events when the issue was just created (idempotent re-runs)
      if (issueIsNew || projectIsNew) {
        const eventCount = Math.floor(Math.random() * 500) + 10;
        for (let i = 0; i < Math.min(eventCount, 5); i++) {
          await client.query(
            `INSERT INTO events (issue_id, project_id, timestamp, environment, message, stack_trace, breadcrumbs, tags)
             VALUES ($1, $2, NOW() - ($3 || ' hours')::INTERVAL, 'production', $4, $5, $6, $7)`,
            [
              issueId,
              actualProjectId,
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
    }

    // Create sample alert rules only if the project has none yet (B13)
    const existingRules = await client.query(
      'SELECT 1 FROM alert_rules WHERE project_id = $1 LIMIT 1',
      [actualProjectId]
    );
    if (existingRules.rows.length === 0) {
      await client.query(
        `INSERT INTO alert_rules (project_id, name, trigger_type, channel, enabled)
         VALUES ($1, 'New Issue Alert', 'new_issue', 'email', true),
                ($1, 'High Volume Spike', 'spike', 'email', true)`,
        [actualProjectId]
      );
    }

    await client.query('COMMIT');
    console.log('Seed completed successfully!');
    console.log(`Demo login: demo@bugradar.dev / demo1234`);
    console.log(`Project DSN: ${dsnKey}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
