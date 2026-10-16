const migration = `
-- QA-BUG-REPORT.md B13: one subscription row per organization.
-- Deduplicate (keep the newest row by physical order) before adding the index.
DELETE FROM subscriptions a
USING subscriptions b
WHERE a.organization_id = b.organization_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_org ON subscriptions(organization_id);

-- QA-BUG-REPORT.md M16: verification tokens now expire (24h).
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

UPDATE users
SET verification_expires_at = created_at + INTERVAL '24 hours'
WHERE verification_token IS NOT NULL
  AND verification_expires_at IS NULL;
`;

module.exports = {
  up: async (client) => {
    await client.query(migration);
    console.log('Migration completed successfully');
  }
};
