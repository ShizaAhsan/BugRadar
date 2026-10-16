// Shared validation helpers (QA-BUG-REPORT.md B11)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Parse positive integer query params with fallbacks; never yields NaN/negatives.
function parsePositiveInt(value, fallback, max) {
  let n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) n = fallback;
  if (max && n > max) n = max;
  return n;
}

// Map UI time-range values (24h/7d/30d/all) or ISO dates to a Date, or null.
function parseSince(value) {
  if (!value || value === 'all') return null;
  const ranges = { '24h': 1, '1h': 1 / 60, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
  if (ranges[value] !== undefined) {
    return new Date(Date.now() - ranges[value] * 24 * 60 * 60 * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Map UI severity pills (critical/high/medium/low) to stored severity values,
// while passing through real SDK severities unchanged.
const SEVERITY_MAP = { critical: 'fatal', high: 'error', medium: 'warning', low: 'info' };
function mapSeverity(value) {
  if (!value) return null;
  return SEVERITY_MAP[value] || value;
}

// Map UI sort keys to a safe allow-list of ORDER BY expressions (no injection).
const SORT_MAP = {
  time: 'i.last_seen DESC',
  last_seen: 'i.last_seen DESC',
  first_seen: 'i.first_seen DESC',
  count: 'i.event_count DESC',
  events: 'i.event_count DESC',
  users: 'i.user_count DESC',
};
function mapSort(sort) {
  return SORT_MAP[sort] || 'i.last_seen DESC';
}

module.exports = { isUUID, parsePositiveInt, parseSince, mapSeverity, mapSort, UUID_RE };
