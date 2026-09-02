const { query } = require('./server/db');

async function test() {
  const projectId = '52340d50-ad6d-4f87-9d01-56a6c4d39727';
  const limit = 50;
  const offset = 0;
  try {
    const r = await query(
      'SELECT i.*, u.name as assignee_name, u.email as assignee_email FROM issues i LEFT JOIN users u ON i.assigned_to = u.id WHERE i.project_id = $1 ORDER BY i.last_seen DESC LIMIT $2 OFFSET $3',
      [projectId, limit, offset]
    );
    console.log('Query OK:', r.rows.length, 'rows');
    r.rows.forEach(r => console.log(' -', r.title));
  } catch(e) {
    console.error('Error:', e.message);
  }
  process.exit();
}
test();
