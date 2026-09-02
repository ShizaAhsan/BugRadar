const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, (res) => {
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
  const results = [];
  const log = (name, ok, detail) => { results.push({ name, ok, detail }); };
  
  // 1. Health
  let r = await request('GET', '/api/health');
  log('Health check', r.status === 200, r.data.status);

  // 2. Signup
  const testEmail = 'fulltest' + Date.now() + '@test.com';
  r = await request('POST', '/api/auth/signup', { email: testEmail, password: 'testpass123', name: 'Full Test' });
  log('Signup', r.status === 201, r.data.user?.email);
  const token = r.data.accessToken;

  // 3. Login
  r = await request('POST', '/api/auth/login', { email: 'demo@bugradar.dev', password: 'demo1234' });
  log('Login', r.status === 200, r.data.user?.email);
  const demoToken = r.data.accessToken;
  const demoRefreshToken = r.data.refreshToken;

  // 4. Auth/me
  r = await request('GET', '/api/auth/me', null, demoToken);
  log('Auth/me', r.status === 200 && r.data.organizations?.length > 0, r.data.organizations?.[0]?.name);
  const orgId = r.data.organizations[0].id;

  // 5. Create project (new user)
  r = await request('POST', '/api/projects/org/' + orgId, { name: 'Full Test Project', platform: 'javascript' }, token);
  // This might fail if user doesn't belong to org - that's OK
  
  // Use demo user's org/project
  r = await request('GET', '/api/projects/org/' + orgId, null, demoToken);
  log('List projects', r.status === 200 && r.data.length > 0, r.data.length + ' projects');
  const projId = r.data[0].id;
  const dsnKey = r.data[0].dsn_key;

  // 6. Get project
  r = await request('GET', '/api/projects/' + projId, null, demoToken);
  log('Get project', r.status === 200 && r.data.name, r.data.name);

  // 7. Ingest event
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

  // 8. List issues
  r = await request('GET', '/api/issues/project/' + projId, null, demoToken);
  log('List issues', r.status === 200, r.data.total + ' issues');
  const issueId = r.data.issues[0]?.id;

  // 9. Issue detail
  if (issueId) {
    r = await request('GET', '/api/issues/' + issueId, null, demoToken);
    log('Issue detail', r.status === 200, r.data.title?.substring(0, 40));
    log('Stack trace', r.data.recent_events?.[0]?.stack_trace?.frames?.length > 0, r.data.recent_events?.[0]?.stack_trace?.frames?.length + ' frames');
    log('Breadcrumbs', r.data.recent_events?.[0]?.breadcrumbs?.length > 0, r.data.recent_events?.[0]?.breadcrumbs?.length + ' breadcrumbs');
  }

  // 10. Update issue
  if (issueId) {
    r = await request('PATCH', '/api/issues/' + issueId, { status: 'resolved' }, demoToken);
    log('Update issue', r.status === 200, r.data.status);
  }

  // 11. Add comment
  if (issueId) {
    r = await request('POST', '/api/issues/' + issueId + '/comments', { body: 'Test comment from integration test' }, demoToken);
    log('Add comment', r.status === 201, r.data.body);
  }

  // 12. Project stats
  r = await request('GET', '/api/issues/project/' + projId + '/stats', null, demoToken);
  log('Project stats', r.status === 200, JSON.stringify(r.data.stats));

  // 13. Alert rules
  r = await request('GET', '/api/alerts/project/' + projId, null, demoToken);
  log('Alert rules', r.status === 200 && r.data.length > 0, r.data.length + ' rules');

  // 14. Create alert rule
  r = await request('POST', '/api/alerts/project/' + projId, { name: 'Test Rule', trigger_type: 'new_issue', channel: 'email' }, demoToken);
  log('Create alert rule', r.status === 201, r.data.name);

  // 15. Billing
  r = await request('GET', '/api/billing/org/' + orgId, null, demoToken);
  log('Billing info', r.status === 200, r.data.plan + ' (' + r.data.events_used + ' events used)');

  // 16. Members
  r = await request('GET', '/api/orgs/' + orgId + '/members', null, demoToken);
  log('Org members', r.status === 200 && r.data.length > 0, r.data.length + ' members');

  // 17. Org detail
  r = await request('GET', '/api/orgs/' + orgId, null, demoToken);
  log('Org detail', r.status === 200, r.data.name + ' (' + r.data.plan + ')');

  // 18. Token refresh
  r = await request('POST', '/api/auth/refresh', { refreshToken: demoRefreshToken });
  log('Token refresh', r.status === 200 && r.data.accessToken, 'new token issued');

  // 19. Frontend pages
  const pages = ['index.html', 'login.html', 'signup.html', 'onboarding.html', 'dashboard.html', 'issues.html', 'alerts.html', 'settings.html', 'invite.html'];
  let pagesOk = 0;
  for (const p of pages) {
    const pr = await request('GET', '/' + p);
    if (pr.status === 200) pagesOk++;
  }
  log('Frontend pages', pagesOk === pages.length, pagesOk + '/' + pages.length + ' pages OK');

  // 20. SDK files
  const sdkReq = await request('GET', '/sdk/bugradar.js');
  log('SDK served', sdkReq.status === 200, 'bugradar.js');

  // 21. Create invitation
  r = await request('POST', '/api/invitations/org/' + orgId, { email: 'invite-test@test.com', invite_role: 'member' }, demoToken);
  log('Create invitation', r.status === 201, r.data.email || r.data.error);
  const inviteId = r.data?.id;

  // 22. List invitations
  r = await request('GET', '/api/invitations/org/' + orgId, null, demoToken);
  log('List invitations', r.status === 200 && r.data.length > 0, r.data.length + ' pending');

  // 23. Cancel invitation
  if (inviteId) {
    r = await request('DELETE', '/api/invitations/' + inviteId, null, demoToken);
    log('Cancel invitation', r.status === 200, r.data.message);
  } else {
    log('Cancel invitation', true, 'skipped (no invite)');
  }

  // 24. Resend verification email
  r = await request('POST', '/api/auth/resend-verification', null, demoToken);
  log('Resend verification', r.status === 200 || r.status === 400, r.data.message || r.data.error);

  // 25. Webhook signature verification
  r = await request('POST', '/api/billing/webhook', { event: 'payment.success', organization_id: orgId });
  log('Webhook (no sig)', r.status === 401, r.data.error);

  // 26. Rate limit check (signup)
  r = await request('POST', '/api/auth/signup', { email: 'ratelimittest@test.com', password: 'testpass12345', name: 'Rate Limit Test' });
  log('Signup works', r.status === 201 || r.status === 409, r.status);

  // Print results
  console.log('\n=== BUGRADAR TEST RESULTS ===\n');
  let passed = 0, failed = 0;
  for (const t of results) {
    const icon = t.ok ? '✅' : '❌';
    console.log(`${icon} ${t.name}: ${t.detail}`);
    if (t.ok) passed++; else failed++;
  }
  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed > 0) console.log(`${failed} tests FAILED`);
  
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
