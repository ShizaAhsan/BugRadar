const http = require('http');
const https = require('https');

// Env-configurable connection + credentials (QA-BUG-REPORT.md D5)
const BASE = new URL(process.env.BASE_URL || 'http://localhost:3000');
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@bugradar.dev';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const lib = BASE.protocol === 'https:' ? https : http;
    const opts = {
      hostname: BASE.hostname,
      port: BASE.port || (BASE.protocol === 'https:' ? 443 : 80),
      path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Login first — fail with guidance instead of crashing on the response body
  let r = await request('POST', '/api/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (r.status !== 200 || !r.data.accessToken) {
    console.error(`Login failed (status ${r.status}) — run \`npm run seed\` first or set DEMO_EMAIL/DEMO_PASSWORD`);
    process.exit(1);
  }
  const token = r.data.accessToken;

  // Get orgs
  r = await request('GET', '/api/auth/me', null, token);
  const orgs = Array.isArray(r.data?.organizations) ? r.data.organizations : [];
  if (orgs.length === 0) {
    console.error('No organizations for this user — run `npm run seed`');
    process.exit(1);
  }
  const orgId = orgs[0].id;

  // Get projects
  r = await request('GET', '/api/projects/org/' + orgId, null, token);
  const projs = Array.isArray(r.data) ? r.data : [];
  if (projs.length === 0) {
    console.error('No projects in this organization — run `npm run seed`');
    process.exit(1);
  }
  const projId = projs[0].id;
  console.log('Project:', projId);

  // Get issues
  r = await request('GET', '/api/issues/project/' + projId + '?limit=2', null, token);
  console.log('Status:', r.status);
  console.log('Response:', JSON.stringify(r.data).substring(0, 200));
  if (r.status !== 200) {
    console.error('Issues request FAILED');
    process.exit(1);
  }
  console.log(`OK — ${r.data.total} issues`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
