const { query } = require('./server/db');

async function test() {
  const limit = 50;
  const offset = 0;
  try {
    // Resolve a project dynamically instead of a hardcoded UUID that only ever
    // existed on the original author's machine (QA-BUG-REPORT.md D5)
    const projects = await query(
      'SELECT id, name FROM projects ORDER BY created_at LIMIT 1'
    );
    if (projects.rows.length === 0) {
      console.error('No projects found — run `npm run migrate && npm run seed` first');
      process.exit(1);
    }
    const projectId = projects.rows[0].id;
    console.log('Project:', projects.rows[0].name, projectId);

    const r = await query(
      'SELECT i.*, u.name as assignee_name, u.email as assignee_email FROM issues i LEFT JOIN users u ON i.assigned_to = u.id WHERE i.project_id = $1 ORDER BY i.last_seen DESC LIMIT $2 OFFSET $3',
      [projectId, limit, offset]
    );
    console.log('Query OK:', r.rows.length, 'rows');
    r.rows.forEach(row => console.log(' -', row.title));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}
test();
