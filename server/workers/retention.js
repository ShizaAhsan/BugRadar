const { query, pool } = require('../db');
const config = require('../config');

async function cleanupOldEvents() {
  console.log('[Retention] Starting event cleanup...');

  try {
    // Get all organizations with their plan
    const orgs = await query(
      `SELECT o.id, o.plan
       FROM organizations o`
    );

    let totalDeleted = 0;

    for (const org of orgs.rows) {
      const retentionDays = config.plans?.[org.plan]?.retentionDays || 30;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      // Delete old events for this org's projects
      const result = await query(
        `DELETE FROM events e
         USING projects p
         WHERE e.project_id = p.id
         AND p.organization_id = $1
         AND e.timestamp < $2`,
        [org.id, cutoffDate]
      );

      if (result.rowCount > 0) {
        console.log(`[Retention] Deleted ${result.rowCount} events from org ${org.id} (older than ${retentionDays} days)`);
        totalDeleted += result.rowCount;
      }
    }

    console.log(`[Retention] Cleanup complete. Total events deleted: ${totalDeleted}`);
    return totalDeleted;
  } catch (err) {
    console.error('[Retention] Cleanup failed:', err);
    throw err;
  }
}

async function reconcileEventCounts() {
  console.log('[Reconciliation] Starting event count reconciliation...');

  try {
    await query(
      `UPDATE subscriptions s SET
        events_used = COALESCE((
          SELECT COUNT(*)
          FROM events e
          JOIN projects p ON e.project_id = p.id
          WHERE p.organization_id = s.organization_id
          AND e.timestamp >= s.current_period_start
        ), 0)
       WHERE s.current_period_start IS NOT NULL`
    );

    console.log('[Reconciliation] Event counts reconciled');
  } catch (err) {
    console.error('[Reconciliation] Failed:', err);
    throw err;
  }
}

// Run cleanup every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000;

async function startRetentionWorker() {
  console.log('[Worker] Event retention worker started');

  // Run immediately on start
  await cleanupOldEvents();
  await reconcileEventCounts();

  // Schedule periodic runs
  setInterval(async () => {
    await cleanupOldEvents();
    await reconcileEventCounts();
  }, CLEANUP_INTERVAL);
}

if (require.main === module) {
  startRetentionWorker().then(() => {
    console.log('[Worker] Ready');
  }).catch(err => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { cleanupOldEvents, reconcileEventCounts, startRetentionWorker };
