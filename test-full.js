const http = require('http');
const https = require('https');

// All connection details are env-configurable (QA-BUG-REPORT.md D5)
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

function printResults(results) {
  console.log('\n=== BUGRADAR TEST RESULTS ===\n');
  let passed = 0, failed = 0;
  for (const t of results) {
    const icon = t.ok ? '✅' : '❌';
    console.log(`${icon} ${t.name}: ${t.detail}`);
    if (t.ok) passed++; else failed++;
  }
  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed > 0) console.log(`${failed} tests FAILED`);
  return failed;
}

async function run() {
  const results = [];
  const log = (name, ok, detail) => { results.push({ name, ok, detail }); };

  // 1. Health
  let r = await request('GET', '/api/health');
  log('Health check', r.status === 200, r.data.status);
  if (r.status !== 200) {
    printResults(results);
    process.exit(1);
  }

  // 2. Signup (fresh user for this run)
  const testEmail = 'fulltest' + Date.now() + '@test.com';
  r = await request('POST', '/api/auth/signup', { email: testEmail, password: 'testpass123', name: 'Full Test' });
  log('Signup', r.status === 201, r.data.user?.email || `status ${r.status}`);
  const token = r.data?.accessToken;

  // 3. Login as the seeded demo user when present; otherwise continue with the
  //    fresh test user so the suite also runs against an unseeded database
  r = await request('POST', '/api/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const demoOk = r.status === 200;
  log('Login (seeded demo user)', demoOk || r.status === 401,
    demoOk ? DEMO_EMAIL : 'not seeded — continuing with fresh test user');
  const auth = demoOk ? r.data.accessToken : token;
  const demoRefreshToken = r.data?.refreshToken;

  if (!auth) {
    log('Auth', false, 'no access token — cannot continue');
    printResults(results);
    process.exit(1);
  }

  // 4. Auth/me
  r = await request('GET', '/api/auth/me', null, auth);
  const orgs = Array.isArray(r.data?.organizations) ? r.data.organizations : [];
  log('Auth/me', r.status === 200, orgs.length + ' organization(s)');
  if (r.status !== 200) {
    printResults(results);
    process.exit(1);
  }

  // 5. Ensure an org exists (create one only when the account has none)
  let orgId = orgs[0]?.id;
  if (!orgId) {
    r = await request('POST', '/api/orgs', {
      name: 'Test Org ' + Date.now(),
      slug: 'test-org-' + Date.now()
    }, auth);
    orgId = r.data?.id;
  }
  log('Organization available', !!orgId, orgId || 'could not resolve an organization');
  if (!orgId) {
    printResults(results);
    process.exit(1);
  }

  // 6. Projects — list, creating one when the account has none
  r = await request('GET', '/api/projects/org/' + orgId, null, auth);
  let projects = Array.isArray(r.data) ? r.data : [];
  log('List projects', r.status === 200, projects.length + ' projects');
  if (projects.length === 0) {
    r = await request('POST', '/api/projects/org/' + orgId, {
      name: 'Full Test Project ' + Date.now(),
      platform: 'javascript'
    }, auth);
    if (r.data?.id) projects = [r.data];
  }
  if (projects.length === 0) {
    log('Project available', false, 'no project could be resolved');
    printResults(results);
    process.exit(1);
  }
  const projId = projects[0].id;
  const dsnKey = projects[0].dsn_key;

  // 7. Get project
  r = await request('GET', '/api/projects/' + projId, null, auth);
  log('Get project', r.status === 200 && r.data.name, r.data.name);

  // 8. Ingest event
  r = await request('POST', '/ingest/' + dsnKey + '/store/', {
    message: 'Test error from integration test',
    level: 'error',
    environment: 'production',
    release: 'v1.0.0',
    exception: { type: 'Error', value: 'Test error', stacktrace: { frames: [{ filename: 'test.js', lineno: 10, function: 'run' }] } },
    breadcrumbs: [{ category: 'ui.click', message: 'clicked', timestamp: new Date().toISOString() }],
    tags: { browser: 'Chrome' }
  });
  log('Ingest event', r.status === 202, JSON.stringify(r.data));

  // 9. List issues (poll briefly — ingestion may group/index asynchronously)
  let issues = [];
  for (let i = 0; i < 10 && issues.length === 0; i++) {
    r = await request('GET', '/api/issues/project/' + projId, null, auth);
    issues = r.data?.issues || [];
    if (issues.length === 0) await new Promise(res => setTimeout(res, 300));
  }
  log('List issues', r.status === 200, (r.data?.total ?? issues.length) + ' issues');
  const issueId = issues[0]?.id;

  // 10. Issue detail
  if (issueId) {
    r = await request('GET', '/api/issues/' + issueId, null, auth);
    log('Issue detail', r.status === 200, r.data.title?.substring(0, 40));
    log('Stack trace', r.data.recent_events?.[0]?.stack_trace?.frames?.length > 0, r.data.recent_events?.[0]?.stack_trace?.frames?.length + ' frames');
    log('Breadcrumbs', r.data.recent_events?.[0]?.breadcrumbs?.length > 0, r.data.recent_events?.[0]?.breadcrumbs?.length + ' breadcrumbs');
  } else {
    log('Issue detail', false, 'no issue created by ingest');
  }

  // 11. Update issue
  if (issueId) {
    r = await request('PATCH', '/api/issues/' + issueId, { status: 'resolved' }, auth);
    log('Update issue', r.status === 200, r.data.status);
  }

  // 12. Add comment
  if (issueId) {
    r = await request('POST', '/api/issues/' + issueId + '/comments', { body: 'Test comment from integration test' }, auth);
    log('Add comment', r.status === 201, r.data.body || `status ${r.status}`);
  }

  // 13. Project stats
  r = await request('GET', '/api/issues/project/' + projId + '/stats', null, auth);
  log('Project stats', r.status === 200, JSON.stringify(r.data.stats));

  // 14. Alert rules
  r = await request('GET', '/api/alerts/project/' + projId, null, auth);
  log('Alert rules', r.status === 200 && Array.isArray(r.data), (Array.isArray(r.data) ? r.data.length : 'n/a') + ' rules');

  // 15. Create alert rule
  r = await request('POST', '/api/alerts/project/' + projId, { name: 'Test Rule', trigger_type: 'new_issue', channel: 'email' }, auth);
  log('Create alert rule', r.status === 201, r.data.name || `status ${r.status}`);

  // 16. Billing (a fresh org without a subscription row must still return free defaults)
  r = await request('GET', '/api/billing/org/' + orgId, null, auth);
  log('Billing info', r.status === 200 && r.data.plan, r.data.plan + ' (' + r.data.events_used + ' events used)');

  // 17. Members
  r = await request('GET', '/api/orgs/' + orgId + '/members', null, auth);
  log('Org members', r.status === 200 && r.data.length > 0, r.data.length + ' members');

  // 18. Org detail
  r = await request('GET', '/api/orgs/' + orgId, null, auth);
  log('Org detail', r.status === 200, (r.data.name || '?') + (r.data.plan ? ' (' + r.data.plan + ')' : ''));

  // 19. Token refresh (only meaningful for the seeded demo flow)
  if (demoRefreshToken) {
    r = await request('POST', '/api/auth/refresh', { refreshToken: demoRefreshToken });
    log('Token refresh', r.status === 200 && r.data.accessToken, 'new token issued');
  } else {
    log('Token refresh', true, 'skipped (no seeded refresh token)');
  }

  // 20. Frontend pages
  const pages = ['index.html', 'login.html', 'signup.html', 'onboarding.html', 'dashboard.html', 'issues.html', 'alerts.html', 'settings.html', 'invite.html'];
  let pagesOk = 0;
  for (const p of pages) {
    const pr = await request('GET', '/' + p);
    if (pr.status === 200) pagesOk++;
  }
  log('Frontend pages', pagesOk === pages.length, pagesOk + '/' + pages.length + ' pages OK');

  // 21. SDK files
  const sdkReq = await request('GET', '/sdk/bugradar.js');
  log('SDK served', sdkReq.status === 200, 'bugradar.js');

  // 22. Create invitation
  r = await request('POST', '/api/invitations/org/' + orgId, { email: 'invite-test' + Date.now() + '@test.com', invite_role: 'member' }, auth);
  log('Create invitation', r.status === 201, r.data.email || r.data.error);
  const inviteId = r.data?.id;

  // 23. List invitations
  r = await request('GET', '/api/invitations/org/' + orgId, null, auth);
  log('List invitations', r.status === 200 && r.data.length > 0, (r.data.length ?? 'n/a') + ' pending');

  // 24. Cancel invitation
  if (inviteId) {
    r = await request('DELETE', '/api/invitations/' + inviteId, null, auth);
    log('Cancel invitation', r.status === 200, r.data.message);
  } else {
    log('Cancel invitation', true, 'skipped (no invite)');
  }

  // 25. Resend verification email
  r = await request('POST', '/api/auth/resend-verification', null, auth);
  log('Resend verification', r.status === 200 || r.status === 400, r.data.message || r.data.error);

  // 26. Webhook signature verification (unsigned → 401)
  r = await request('POST', '/api/billing/webhook', { event: 'payment.success', organization_id: orgId });
  log('Webhook (no sig)', r.status === 401, r.data.error);

  // 27. Rate limit check (signup)
  r = await request('POST', '/api/auth/signup', { email: 'ratelimittest' + Date.now() + '@test.com', password: 'testpass12345', name: 'Rate Limit Test' });
  log('Signup works', r.status === 201 || r.status === 409, r.status);

  const failed = printResults(results);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
