const express = require('express');
const crypto = require('crypto');
const { query, pool } = require('../db');
const config = require('../config');
const { sendEmail, generateAlertEmail } = require('../email');

const router = express.Router();

// Sliding window rate limiter per DSN key
const rateLimitMap = new Map();

function cleanupStaleEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}
setInterval(cleanupStaleEntries, 60000);

router.post('/:dsnKey/store/', async (req, res) => {
  try {
    const { dsnKey } = req.params;

    // Validate DSN
    const projectResult = await query(
      'SELECT id, organization_id, name FROM projects WHERE dsn_key = $1',
      [dsnKey]
    );
    if (projectResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid DSN key' });
    }

    const project = projectResult.rows[0];

    // Rate limit per DSN (sliding window)
    const now = Date.now();
    let rl = rateLimitMap.get(dsnKey);
    if (!rl || now > rl.resetAt) {
      rl = { count: 0, resetAt: now + 60000 };
    }
    rl.count++;
    rateLimitMap.set(dsnKey, rl);

    if (rl.count > config.ingestion.rateLimitPerMinute) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Check event quota
    const subResult = await query(
      'SELECT plan, events_used FROM subscriptions WHERE organization_id = $1',
      [project.organization_id]
    );
    const sub = subResult.rows[0];
    if (sub) {
      const planConfig = config.plans[sub.plan] || config.plans.free;
      if (sub.events_used >= planConfig.maxEventsPerMonth) {
        return res.status(429).json({ error: 'Monthly event quota exceeded', upgrade: true });
      }
    }

    // Parse event payload
    const payload = req.body;
    const event = {
      message: payload.message || payload.exception?.values?.[0]?.value || 'Unknown error',
      stackTrace: normalizeStackTrace(payload.exception || payload.stacktrace || null),
      environment: payload.environment || 'production',
      release: payload.release || null,
      breadcrumbs: payload.breadcrumbs || [],
      tags: payload.tags || {},
      userContext: payload.user || {},
      browserInfo: payload.request || payload.contexts?.browser || {},
      severity: payload.level || 'error',
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    };

    // Compute fingerprint for grouping
    const fingerprint = computeFingerprint(event);
    const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest('hex');

    // Find or create issue
    let issueResult = await query(
      'SELECT * FROM issues WHERE project_id = $1 AND fingerprint_hash = $2',
      [project.id, fingerprintHash]
    );

    let issue;
    let isNewIssue = false;
    if (issueResult.rows.length > 0) {
      issue = issueResult.rows[0];
      await query(
        `UPDATE issues SET
          last_seen = NOW(),
          event_count = event_count + 1,
          updated_at = NOW()
         WHERE id = $1`,
        [issue.id]
      );
    } else {
      isNewIssue = true;
      const culprit = extractCulprit(event.stackTrace);
      issueResult = await query(
        `INSERT INTO issues (project_id, title, culprit, fingerprint_hash, severity, first_seen, last_seen, event_count)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 1) RETURNING *`,
        [project.id, event.message.slice(0, 500), culprit, fingerprintHash, event.severity]
      );
      issue = issueResult.rows[0];
    }

    // Update user count if user context has an ID
    if (event.userContext?.id) {
      await query(
        `UPDATE issues SET user_count = (
          SELECT COUNT(DISTINCT user_context->>'id')
          FROM events WHERE issue_id = $1 AND user_context->>'id' IS NOT NULL
        ) WHERE id = $1`,
        [issue.id]
      );
    }

    // Insert event
    const eventId = crypto.randomUUID();
    await query(
      `INSERT INTO events (id, issue_id, project_id, timestamp, environment, release, message, stack_trace, breadcrumbs, tags, user_context, browser_info, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        eventId,
        issue.id,
        project.id,
        event.timestamp,
        event.environment,
        event.release,
        event.message,
        JSON.stringify(event.stackTrace),
        JSON.stringify(event.breadcrumbs),
        JSON.stringify(event.tags),
        JSON.stringify(scrubPII(event.userContext)),
        JSON.stringify(event.browserInfo),
        JSON.stringify(payload),
      ]
    );

    // Increment events_used
    if (sub) {
      await query(
        'UPDATE subscriptions SET events_used = events_used + 1 WHERE organization_id = $1',
        [project.organization_id]
      );
    }

    // Evaluate alert rules (async, fire-and-forget)
    evaluateAlertRules(project, issue, event, isNewIssue).catch(err =>
      console.error('Alert evaluation error:', err)
    );

    res.status(202).json({ id: issue.id, event_id: eventId });
  } catch (err) {
    console.error('Ingestion error:', err);
    res.status(500).json({ error: 'Event processing failed' });
  }
});

function computeFingerprint(event) {
  const parts = [event.message || ''];

  if (event.stackTrace?.frames) {
    const topFrames = event.stackTrace.frames.slice(0, 5);
    for (const frame of topFrames) {
      if (frame.filename) parts.push(frame.filename);
      if (frame.function) parts.push(frame.function);
      if (frame.lineno) parts.push(String(frame.lineno));
    }
  } else if (event.stackTrace?.values) {
    for (const exc of event.stackTrace.values.slice(0, 2)) {
      if (exc.type) parts.push(exc.type);
      if (exc.value) parts.push(exc.value);
    }
  }

  return parts.join('|').replace(/\d+/g, '#').toLowerCase();
}

function extractCulprit(stackTrace) {
  if (stackTrace?.frames?.length > 0) {
    const frame = stackTrace.frames.find(f => !f.filename?.includes('node_modules')) || stackTrace.frames[0];
    return `${frame.filename || 'unknown'}:${frame.lineno || 0}`;
  }
  if (stackTrace?.values?.length > 0) {
    const val = stackTrace.values[0];
    return val.type || val.value || 'unknown';
  }
  return 'unknown';
}

function scrubPII(ctx) {
  if (!ctx || typeof ctx !== 'object') return {};
  const scrubbed = { ...ctx };
  const sensitiveKeys = ['email', 'ip_address', 'ip', 'password', 'token'];
  for (const key of Object.keys(scrubbed)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      scrubbed[key] = '[scrubbed]';
    }
  }
  return scrubbed;
}

function normalizeStackTrace(st) {
  if (!st) return null;
  if (st.frames) return { frames: st.frames };
  if (st.stacktrace?.frames) return { frames: st.stacktrace.frames };
  if (st.values) {
    const frames = [];
    for (const val of st.values) {
      if (val.stacktrace?.frames) frames.push(...val.stacktrace.frames);
    }
    if (frames.length > 0) return { frames };
  }
  return null;
}

async function evaluateAlertRules(project, issue, event, isNewIssue) {
  const rules = await query(
    'SELECT * FROM alert_rules WHERE project_id = $1 AND enabled = TRUE',
    [project.id]
  );

  // Get org owner email for alert delivery
  const ownerResult = await query(
    `SELECT u.email, u.name FROM users u
     JOIN memberships m ON u.id = m.user_id
     WHERE m.organization_id = $1 AND m.role = 'owner'
     LIMIT 1`,
    [project.organization_id]
  );
  const ownerEmail = ownerResult.rows[0]?.email;
  const ownerName = ownerResult.rows[0]?.name;

  for (const rule of rules.rows) {
    let shouldAlert = false;

    if (rule.trigger_type === 'new_issue' && isNewIssue) {
      shouldAlert = true;
    }

    if (rule.trigger_type === 'spike' && rule.threshold && rule.window_minutes) {
      // Fixed: use parameterized query instead of string interpolation
      const cutoffTime = new Date(Date.now() - rule.window_minutes * 60 * 1000);
      const recentCount = await query(
        'SELECT COUNT(*) FROM events WHERE issue_id = $1 AND timestamp > $2',
        [issue.id, cutoffTime]
      );
      if (parseInt(recentCount.rows[0].count, 10) >= rule.threshold) {
        shouldAlert = true;
      }
    }

    if (shouldAlert) {
      await query(
        `INSERT INTO alert_history (alert_rule_id, issue_id, channel, details, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [rule.id, issue.id, rule.channel, JSON.stringify({
          issueTitle: issue.title,
          project_id: project.id,
          project_name: project.name,
        }), 'sent']
      );

      console.log(`Alert triggered: ${rule.name} for issue "${issue.title}" via ${rule.channel}`);

      // Deliver alert
      if (rule.channel === 'email' && ownerEmail) {
        const issueUrl = `${config.cors.origin}/issue-detail.html?id=${issue.id}`;
        sendEmail(
          ownerEmail,
          `[BugRadar] ${rule.name}: ${issue.title}`,
          generateAlertEmail(rule.name, issue.title, project.name, issueUrl)
        ).catch(err => console.error('Alert email failed:', err));
      }

      if (rule.channel === 'webhook' && rule.webhook_url) {
        const webhookPayload = JSON.stringify({
          event: 'alert.triggered',
          rule: { id: rule.id, name: rule.name, trigger_type: rule.trigger_type },
          issue: { id: issue.id, title: issue.title, severity: issue.severity },
          project: { id: project.id, name: project.name },
          timestamp: new Date().toISOString(),
        });

        fetch(rule.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': config.webhookSecret,
          },
          body: webhookPayload,
        }).catch(err => console.error('Webhook delivery failed:', err));
      }
    }
  }
}

module.exports = router;
