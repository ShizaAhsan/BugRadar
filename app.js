/* ==========================================================================
   BUGRADAR FRONTEND APPLICATION (app.js)
   Complete client-side logic: Auth, API, State, Page Rendering
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. API CLIENT & AUTH STATE
   -------------------------------------------------------------------------- */
const API = {
  baseUrl: '',
  token: null,

  async request(method, path, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(this.baseUrl + path, opts);
    const data = await res.json().catch(() => null);

    if (res.status === 401 && data?.code === 'TOKEN_EXPIRED') {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        opts.headers['Authorization'] = 'Bearer ' + this.token;
        const retry = await fetch(this.baseUrl + path, opts);
        return retry.json().catch(() => null);
      }
      window.location.href = '/login.html';
      return null;
    }

    if (!res.ok) throw { status: res.status, message: data?.error || 'Request failed' };
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  delete(path) { return this.request('DELETE', path); },

  async refreshToken() {
    try {
      const res = await fetch(this.baseUrl + '/api/auth/refresh', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.token = data.accessToken;
      return true;
    } catch { return false; }
  },

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('br_token', token);
    else localStorage.removeItem('br_token');
  },

  getToken() {
    if (!this.token) this.token = localStorage.getItem('br_token');
    return this.token;
  }
};

/* --------------------------------------------------------------------------
   2. STATE MANAGEMENT
   -------------------------------------------------------------------------- */
const AppState = {
  user: null,
  organizations: [],
  currentOrg: null,
  currentProject: null,

  async load() {
    try {
      const data = await API.get('/api/auth/me');
      this.user = data.user;
      this.organizations = data.organizations || [];
      if (this.organizations.length > 0) {
        const savedOrg = localStorage.getItem('br_org');
        this.currentOrg = this.organizations.find(o => o.id === savedOrg) || this.organizations[0];
      }
      return true;
    } catch {
      return false;
    }
  },

  setCurrentOrg(orgId) {
    this.currentOrg = this.organizations.find(o => o.id === orgId);
    if (this.currentOrg) localStorage.setItem('br_org', this.currentOrg.id);
  },

  async loadProject(projectId) {
    const proj = await API.get('/api/projects/' + projectId);
    this.currentProject = proj;
    return proj;
  }
};

/* --------------------------------------------------------------------------
   3. AUTH GUARD
   -------------------------------------------------------------------------- */
async function requireAuth() {
  const isLoginPage = location.pathname.includes('login');
  const isSignupPage = location.pathname.includes('signup');
  const isIndex = location.pathname.endsWith('/') || location.pathname.endsWith('index.html');

  if (isLoginPage || isSignupPage || isIndex) {
    try {
      const ok = await AppState.load();
      if (ok && (isLoginPage || isSignupPage)) {
        window.location.href = '/dashboard.html';
        return false;
      }
    } catch {}
    return true;
  }

  const ok = await AppState.load();
  if (!ok) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

/* --------------------------------------------------------------------------
   4. UI HELPERS
   -------------------------------------------------------------------------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function timeAgo(date) {
  if (!date) return 'never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(date) {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function severityColor(severity) {
  const map = { fatal: '#ef4444', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  return map[severity] || '#ef4444';
}

function statusBadge(status) {
  const colors = { unresolved: '#ef4444', resolved: '#10b981', ignored: '#71717a' };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:50px;font-size:11px;font-weight:700;background:${colors[status] || '#71717a'}22;border:1px solid ${colors[status] || '#71717a'}55;color:${colors[status] || '#71717a'}">${status}</span>`;
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981';
  toast.style.cssText = `background:${bg};color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 4px 20px ${bg}44;animation:slideIn 0.3s ease;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

/* --------------------------------------------------------------------------
   5. LOGIN / SIGNUP HANDLERS
   -------------------------------------------------------------------------- */
async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const btn = document.getElementById('login-btn');

  if (!email || !password) return;
  btn.innerHTML = '<span>Logging in...</span>';
  btn.disabled = true;

  try {
    const data = await API.post('/api/auth/login', { email, password });
    API.setToken(data.accessToken);
    btn.innerHTML = '<span style="color:#fff">✓ Logged In</span>';
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 500);
  } catch (err) {
    btn.innerHTML = '<span>Log In</span>';
    btn.disabled = false;
    showToast(err.message || 'Login failed', 'error');
  }
}

async function handleSignUpSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('fullname')?.value || document.getElementById('name')?.value;
  const email = document.getElementById('email').value;
  const orgname = document.getElementById('orgname')?.value;
  const password = document.getElementById('password').value;
  const terms = document.getElementById('terms')?.checked;
  const btn = document.getElementById('signup-btn');

  if (!email || !password) return;
  if (terms === false) { showToast('Please accept the terms', 'error'); return; }

  btn.innerHTML = '<span>Creating account...</span>';
  btn.disabled = true;

  try {
    const data = await API.post('/api/auth/signup', {
      name: name || email.split('@')[0],
      email,
      password
    });
    API.setToken(data.accessToken);

    // If org name provided, create org during signup
    if (orgname) {
      const slug = orgname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const org = await API.post('/api/orgs', { name: orgname, slug });
      AppState.setCurrentOrg(org.id);
    }

    btn.innerHTML = '<span style="color:#fff">✓ Account Created</span>';
    setTimeout(() => { window.location.href = '/onboarding.html'; }, 500);
  } catch (err) {
    btn.innerHTML = '<span>Create Account & Workspace</span>';
    btn.disabled = false;
    showToast(err.message || 'Signup failed', 'error');
  }
}

async function handleLogout() {
  try { await API.post('/api/auth/logout'); } catch {}
  API.setToken(null);
  localStorage.removeItem('br_org');
  localStorage.removeItem('br_project');
  window.location.href = '/login.html';
}

/* --------------------------------------------------------------------------
   6. ONBOARDING FLOW
   -------------------------------------------------------------------------- */
async function handleOnboardingSubmit(event) {
  event.preventDefault();
  const orgName = document.getElementById('orgname-input')?.value;
  const projName = document.getElementById('projname-input')?.value;

  if (!orgName || !projName) {
    showToast('Please fill in both fields', 'error');
    return;
  }

  try {
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const org = await API.post('/api/orgs', { name: orgName, slug });
    AppState.setCurrentOrg(org.id);

    const project = await API.post('/api/projects/org/' + org.id, {
      name: projName,
      platform: selectedPlatform || 'javascript'
    });
    localStorage.setItem('br_project', project.id);

    const step1View = document.getElementById('step-1-view');
    const step2View = document.getElementById('step-2-view');
    const step1Indicator = document.getElementById('indicator-step-1');
    const step2Indicator = document.getElementById('indicator-step-2');

    if (step1View && step2View) {
      step1View.style.display = 'none';
      step2View.style.display = 'flex';
      step2View.style.flexDirection = 'column';
      step1Indicator.classList.remove('active');
      step1Indicator.classList.add('completed');
      step2Indicator.classList.add('active');

      const dsnBox = document.getElementById('dsn-value');
      const dsnUrl = window.location.origin + '/ingest/' + project.dsn_key + '/store/';
      if (dsnBox) dsnBox.innerText = dsnUrl;
      updateCodeSnippet(selectedPlatform || 'javascript');
    }
  } catch (err) {
    showToast(err.message || 'Failed to create project', 'error');
  }
}

/* --------------------------------------------------------------------------
   7. DASHBOARD PAGE
   -------------------------------------------------------------------------- */
async function loadDashboard() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId) {
    showEmptyDashboard();
    return;
  }

  try {
    const [project, stats] = await Promise.all([
      API.get('/api/projects/' + projectId),
      API.get('/api/issues/project/' + projectId + '/stats')
    ]);

    AppState.currentProject = project;

    // Update stat cards
    const unresolvedEl = $('#stat-unresolved');
    const resolvedEl = $('#stat-resolved');
    const totalEl = $('#stat-total');
    if (unresolvedEl) unresolvedEl.textContent = stats.stats.unresolved;
    if (resolvedEl) resolvedEl.textContent = stats.stats.resolved;
    if (totalEl) totalEl.textContent = stats.stats.total;

    // Update sidebar nav badge
    const navBadge = $('.nav-badge');
    if (navBadge) navBadge.textContent = stats.stats.unresolved;

    // Render chart
    renderEventsChart(stats.eventsPerDay);

    // Render recent issues table
    renderDashboardIssues(stats.topIssues);

    // Update project name in sidebar
    const sidebarTitle = $('.sidebar-page-title h2 .bold');
    if (sidebarTitle) sidebarTitle.textContent = project.name;

    // Update DSN display
    const dsnEl = $('#project-dsn');
    if (dsnEl) dsnEl.textContent = project.dsn_key;

  } catch (err) {
    console.error('Dashboard load error:', err);
    showEmptyDashboard();
  }
}

function showEmptyDashboard() {
  const unresolvedEl = $('#stat-unresolved');
  const resolvedEl = $('#stat-resolved');
  const totalEl = $('#stat-total');
  if (unresolvedEl) unresolvedEl.textContent = '0';
  if (resolvedEl) resolvedEl.textContent = '0';
  if (totalEl) totalEl.textContent = '0';
}

function renderEventsChart(eventsPerDay) {
  const container = $('#events-chart');
  if (!container || !eventsPerDay || eventsPerDay.length === 0) return;

  const max = Math.max(...eventsPerDay.map(e => parseInt(e.count)), 1);
  const width = container.offsetWidth || 600;
  const height = 180;
  const padding = 20;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * (height - 2 * padding);
    svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#1f1f26" stroke-width="1"/>`;
  }

  if (eventsPerDay.length > 1) {
    const step = (width - 2 * padding) / (eventsPerDay.length - 1);
    let points = '';
    let areaPoints = `${padding},${height - padding} `;

    eventsPerDay.forEach((e, i) => {
      const x = padding + i * step;
      const y = height - padding - (parseInt(e.count) / max) * (height - 2 * padding);
      points += `${x},${y} `;
      areaPoints += `${x},${y} `;
    });

    areaPoints += `${padding + (eventsPerDay.length - 1) * step},${height - padding}`;

    svg += `<polygon points="${areaPoints}" fill="url(#chartGradient)" opacity="0.3"/>`;
    svg += `<polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    eventsPerDay.forEach((e, i) => {
      const x = padding + i * step;
      const y = height - padding - (parseInt(e.count) / max) * (height - 2 * padding);
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#3b82f6" stroke="#0d0d11" stroke-width="2"/>`;
    });
  }

  svg += `<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>`;
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderDashboardIssues(issues) {
  const tbody = $('#dashboard-issues-body');
  if (!tbody) return;

  if (!issues || issues.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text-muted)">No issues yet. Send your first event!</td></tr>';
    return;
  }

  tbody.innerHTML = issues.map(issue => `
    <tr class="${issue.status}" style="cursor:pointer" onclick="window.location.href='/issue-detail.html?id=${issue.id}'">
      <td>
        <span class="issue-title">${escapeHtml(issue.title)}</span>
        <span class="issue-loc">${escapeHtml(issue.culprit || '')}</span>
      </td>
      <td>${statusBadge(issue.status)}</td>
      <td class="number-font" style="font-weight:700;color:${severityColor(issue.severity)}">${issue.event_count}</td>
      <td class="number-font" style="color:var(--text-muted)">${timeAgo(issue.last_seen)}</td>
    </tr>
  `).join('');
}

/* --------------------------------------------------------------------------
   8. ISSUES LIST PAGE
   -------------------------------------------------------------------------- */
let issuesCurrentPage = 1;
let issuesCurrentStatus = '';
let issuesCurrentSearch = '';
let issuesCurrentSort = 'last_seen';

async function loadIssues() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId) return;

  try {
    const params = new URLSearchParams({
      page: issuesCurrentPage,
      limit: 20,
      sort: issuesCurrentSort,
    });
    if (issuesCurrentStatus) params.set('status', issuesCurrentStatus);
    if (issuesCurrentSearch) params.set('search', issuesCurrentSearch);

    const data = await API.get('/api/issues/project/' + projectId + '?' + params.toString());
    renderIssuesTable(data.issues, data.total, data.page, data.limit);
  } catch (err) {
    console.error('Issues load error:', err);
  }
}

function renderIssuesTable(issues, total, page, limit) {
  const tbody = $('#issues-table-body');
  if (!tbody) return;

  const totalPages = Math.ceil(total / limit);

  if (!issues || issues.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted)">No issues found</td></tr>';
    updateIssuesPagination(0, 0);
    return;
  }

  tbody.innerHTML = issues.map(issue => `
    <tr class="${issue.status}" style="cursor:pointer" onclick="window.location.href='/issue-detail.html?id=${issue.id}'">
      <td>
        <span class="issue-title">${escapeHtml(issue.title)}</span>
        <span class="issue-loc">${escapeHtml(issue.culprit || '')}</span>
      </td>
      <td>${statusBadge(issue.status)}</td>
      <td class="number-font" style="font-weight:600">${issue.event_count}</td>
      <td style="color:var(--text-muted);font-size:12px">${issue.assignee_name ? escapeHtml(issue.assignee_name) : '<span style="opacity:0.4">Unassigned</span>'}</td>
      <td class="number-font" style="color:var(--text-muted)">${timeAgo(issue.last_seen)}</td>
    </tr>
  `).join('');

  updateIssuesPagination(totalPages, page);
}

function updateIssuesPagination(totalPages, currentPage) {
  const paginationEl = $('#issues-pagination');
  if (!paginationEl) return;

  if (totalPages <= 1) { paginationEl.innerHTML = ''; return; }

  let html = '';
  if (currentPage > 1) {
    html += `<button class="pill-btn" onclick="issuesGoPage(${currentPage - 1})">← Prev</button>`;
  }
  html += `<span style="font-size:12px;color:var(--text-muted);padding:0 12px">Page ${currentPage} of ${totalPages}</span>`;
  if (currentPage < totalPages) {
    html += `<button class="pill-btn" onclick="issuesGoPage(${currentPage + 1})">Next →</button>`;
  }
  paginationEl.innerHTML = html;
}

function issuesGoPage(page) {
  issuesCurrentPage = page;
  loadIssues();
}

function issuesFilterStatus(status) {
  issuesCurrentStatus = status;
  issuesCurrentPage = 1;
  $$('#statusFilterPills .table-pill-btn').forEach(b => b.classList.remove('active'));
  if (status === '') $$('#statusFilterPills .table-pill-btn')[0]?.classList.add('active');
  else {
    $$('#statusFilterPills .table-pill-btn').forEach(b => {
      if (b.textContent.toLowerCase().includes(status)) b.classList.add('active');
    });
  }
  loadIssues();
}

function issuesSearch(query) {
  issuesCurrentSearch = query;
  issuesCurrentPage = 1;
  loadIssues();
}

function issuesSort(sort) {
  issuesCurrentSort = sort;
  loadIssues();
}

/* --------------------------------------------------------------------------
   9. ISSUE DETAIL PAGE
   -------------------------------------------------------------------------- */
async function loadIssueDetail() {
  const issueId = new URLSearchParams(window.location.search).get('id');
  if (!issueId) {
    window.location.href = '/issues.html';
    return;
  }

  try {
    const issue = await API.get('/api/issues/' + issueId);

    // Title
    const titleEl = $('#issue-title');
    if (titleEl) titleEl.textContent = issue.title;

    // Status badge
    const statusEl = $('#issue-status-badge');
    if (statusEl) statusEl.innerHTML = statusBadge(issue.status);

    // Metadata
    const culpritEl = $('#issue-culprit');
    if (culpritEl) culpritEl.textContent = issue.culprit || 'Unknown';

    const countEl = $('#issue-event-count');
    if (countEl) countEl.textContent = issue.event_count;

    const firstSeenEl = $('#issue-first-seen');
    if (firstSeenEl) firstSeenEl.textContent = formatDateTime(issue.first_seen);

    const lastSeenEl = $('#issue-last-seen');
    if (lastSeenEl) lastSeenEl.textContent = formatDateTime(issue.last_seen);

    const usersEl = $('#issue-users');
    if (usersEl) usersEl.textContent = issue.affected_users || 0;

    const assigneeEl = $('#issue-assignee');
    if (assigneeEl) assigneeEl.textContent = issue.assignee_name || 'Unassigned';

    // Stack trace
    renderStackTrace(issue.recent_events);

    // Breadcrumbs
    renderBreadcrumbs(issue.recent_events);

    // Comments
    renderComments(issue.comments);

    // Events timeline
    renderEventsTimeline(issue.recent_events);

  } catch (err) {
    console.error('Issue detail error:', err);
    showToast('Failed to load issue', 'error');
  }
}

function renderStackTrace(events) {
  const container = $('#stack-trace');
  if (!container || !events || events.length === 0) return;

  const event = events[0];
  let frames = [];

  if (event.stack_trace) {
    if (event.stack_trace.frames) frames = event.stack_trace.frames;
    else if (event.stack_trace.values) {
      for (const val of event.stack_trace.values) {
        if (val.stacktrace?.frames) frames.push(...val.stacktrace.frames);
      }
    }
  }

  if (frames.length === 0) {
    container.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:13px">${escapeHtml(event.message || 'No stack trace available')}</div>`;
    return;
  }

  const framesHtml = frames.map((f, i) => `
    <div style="padding:8px 16px;border-bottom:1px solid var(--card-border);font-family:var(--font-mono);font-size:12px;display:flex;gap:12px;align-items:center">
      <span style="color:var(--text-muted);min-width:24px;text-align:right">${frames.length - i}</span>
      <div style="flex:1">
        <div style="color:${i === 0 ? '#ef4444' : 'var(--text-main)'};font-weight:${i === 0 ? '700' : '400'}">${escapeHtml(f.function || f.filename || 'unknown')}</div>
        <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${escapeHtml(f.filename || '')}:${f.lineno || 0}:${f.colno || 0}</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = framesHtml;
}

function renderBreadcrumbs(events) {
  const container = $('#breadcrumbs-timeline');
  if (!container || !events || events.length === 0) {
    if (container) container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No breadcrumbs recorded</div>';
    return;
  }

  const allBreadcrumbs = events.flatMap(e => e.breadcrumbs || []).sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  ).slice(-20);

  if (allBreadcrumbs.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No breadcrumbs recorded</div>';
    return;
  }

  const icons = { 'ui.click': '🖱️', 'console': '📝', 'navigation': '🧭', 'http': '🌐', 'logging': '📋' };

  container.innerHTML = allBreadcrumbs.map(bc => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--card-border)">
      <span style="font-size:16px;min-width:24px;text-align:center">${icons[bc.category] || '📌'}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${escapeHtml(bc.message || bc.category || '')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${formatDateTime(bc.timestamp)}</div>
      </div>
      <span style="font-size:10px;color:var(--text-muted);padding:2px 8px;border-radius:50px;background:rgba(255,255,255,0.05)">${bc.category || 'unknown'}</span>
    </div>
  `).join('');
}

function renderComments(comments) {
  const container = $('#comments-list');
  if (!container) return;

  if (!comments || comments.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No comments yet</div>';
    return;
  }

  container.innerHTML = comments.map(c => `
    <div style="padding:14px;border:1px solid var(--card-border);border-radius:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;font-weight:600">${escapeHtml(c.author_name || 'Unknown')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${timeAgo(c.created_at)}</span>
      </div>
      <div style="font-size:13px;line-height:1.5;color:var(--text-main)">${escapeHtml(c.body)}</div>
    </div>
  `).join('');
}

function renderEventsTimeline(events) {
  const container = $('#events-timeline');
  if (!container || !events || events.length === 0) {
    if (container) container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No events recorded</div>';
    return;
  }

  container.innerHTML = events.slice(0, 10).map(e => `
    <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--card-border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${severityColor(e.severity || 'error')};margin-top:5px;flex-shrink:0"></div>
      <div style="flex:1">
        <div style="font-size:12px;color:var(--text-main)">${escapeHtml(e.message || 'No message')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
          ${e.environment || 'unknown'} · ${formatDateTime(e.timestamp)} · ${e.release || 'no release'}
        </div>
      </div>
    </div>
  `).join('');
}

async function addComment() {
  const issueId = new URLSearchParams(window.location.search).get('id');
  const input = $('#comment-input');
  if (!issueId || !input || !input.value.trim()) return;

  try {
    await API.post('/api/issues/' + issueId + '/comments', { body: input.value.trim() });
    input.value = '';
    loadIssueDetail();
  } catch (err) {
    showToast(err.message || 'Failed to add comment', 'error');
  }
}

async function updateIssueStatus(status) {
  const issueId = new URLSearchParams(window.location.search).get('id');
  if (!issueId) return;

  try {
    await API.patch('/api/issues/' + issueId, { status });
    showToast('Issue ' + status);
    loadIssueDetail();
  } catch (err) {
    showToast(err.message || 'Failed to update issue', 'error');
  }
}

/* --------------------------------------------------------------------------
   10. ALERTS PAGE
   -------------------------------------------------------------------------- */
async function loadAlerts() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId) return;

  try {
    const [rules, history] = await Promise.all([
      API.get('/api/alerts/project/' + projectId),
      API.get('/api/alerts/history/' + projectId)
    ]);

    renderAlertRules(rules);
    renderAlertHistory(history);
  } catch (err) {
    console.error('Alerts load error:', err);
  }
}

function renderAlertRules(rules) {
  const container = $('#alert-rules-list');
  if (!container) return;

  if (!rules || rules.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center">No alert rules configured</div>';
    return;
  }

  container.innerHTML = rules.map(rule => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;border:1px solid var(--card-border);border-radius:12px;margin-bottom:10px">
      <div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">${escapeHtml(rule.name)}</div>
        <div style="font-size:12px;color:var(--text-muted)">
          ${rule.trigger_type === 'new_issue' ? 'When new issue created' : `Spike: >${rule.threshold} in ${rule.window_minutes}min`}
          · ${rule.channel}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:11px;padding:3px 10px;border-radius:50px;background:${rule.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};border:1px solid ${rule.enabled ? 'rgba(16,185,129,0.3)' : 'var(--card-border)'};color:${rule.enabled ? '#10b981' : 'var(--text-muted)'}">${rule.enabled ? 'Active' : 'Disabled'}</span>
        <button onclick="deleteAlertRule('${rule.id}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px" title="Delete rule">✕</button>
      </div>
    </div>
  `).join('');
}

function renderAlertHistory(history) {
  const container = $('#alert-history-list');
  if (!container) return;

  if (!history || history.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center">No alerts triggered yet</div>';
    return;
  }

  container.innerHTML = history.map(h => `
    <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--card-border)">
      <div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-top:5px;flex-shrink:0"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${escapeHtml(h.rule_name)}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(h.issue_title || 'Unknown issue')} · ${formatDateTime(h.triggered_at)}</div>
      </div>
    </div>
  `).join('');
}

async function createAlertRule() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId) return;

  const name = prompt('Alert rule name:');
  if (!name) return;

  const triggerType = prompt('Trigger type (new_issue or spike):', 'new_issue');
  if (!triggerType) return;

  const channel = prompt('Channel (email or webhook):', 'email');

  try {
    const body = { name, trigger_type: triggerType, channel: channel || 'email' };
    if (triggerType === 'spike') {
      body.threshold = parseInt(prompt('Threshold (events count):', '10'), 10);
      body.window_minutes = parseInt(prompt('Window (minutes):', '5'), 10);
    }

    await API.post('/api/alerts/project/' + projectId, body);
    showToast('Alert rule created');
    loadAlerts();
  } catch (err) {
    showToast(err.message || 'Failed to create rule', 'error');
  }
}

async function deleteAlertRule(ruleId) {
  if (!confirm('Delete this alert rule?')) return;
  try {
    await API.delete('/api/alerts/' + ruleId);
    showToast('Rule deleted');
    loadAlerts();
  } catch (err) {
    showToast(err.message || 'Failed to delete rule', 'error');
  }
}

/* --------------------------------------------------------------------------
   11. SETTINGS PAGE
   -------------------------------------------------------------------------- */
async function loadSettings() {
  const projectId = localStorage.getItem('br_project');
  const orgId = AppState.currentOrg?.id;
  if (!projectId || !orgId) return;

  try {
    const [project, members, invitations] = await Promise.all([
      API.get('/api/projects/' + projectId),
      API.get('/api/orgs/' + orgId + '/members'),
      API.get('/api/invitations/org/' + orgId).catch(() => [])
    ]);

    // Project info
    const nameEl = $('#setting-project-name');
    const platformEl = $('#setting-project-platform');
    const dsnEl = $('#setting-dsn-value');

    if (nameEl) nameEl.value = project.name;
    if (platformEl) platformEl.textContent = project.platform;
    if (dsnEl) dsnEl.textContent = project.dsn_key;

    // Team members
    renderTeamMembers(members);

    // Pending invitations
    renderPendingInvitations(invitations);

  } catch (err) {
    console.error('Settings load error:', err);
  }
}

function renderTeamMembers(members) {
  const container = $('#team-members-list');
  if (!container) return;

  if (!members || members.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No team members</div>';
    return;
  }

  container.innerHTML = `
    <table class="team-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Role</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${members.map(m => `
          <tr>
            <td><strong>${escapeHtml(m.name || 'Unknown')}</strong>${m.user_id === AppState.user?.id ? ' (You)' : ''}</td>
            <td class="number-font">${escapeHtml(m.email)}</td>
            <td><span class="role-badge" style="${m.role === 'owner' ? 'background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3)' : m.role === 'admin' ? 'background:rgba(6,182,212,0.15);color:#22d3ee;border-color:rgba(6,182,212,0.3)' : ''}">${m.role}</span></td>
            <td>${m.role !== 'owner' ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="removeMember('${m.id}')">Remove</button>` : '<span style="color:var(--text-muted);font-size:12px">-</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function updateProjectSettings() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId) return;

  const nameEl = $('#setting-project-name');
  if (!nameEl || !nameEl.value.trim()) return;

  try {
    await API.patch('/api/projects/' + projectId, { name: nameEl.value.trim() });
    showToast('Project updated');
  } catch (err) {
    showToast(err.message || 'Failed to update project', 'error');
  }
}

async function regenerateDSN() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId || !confirm('Regenerate DSN? The old key will stop working immediately.')) return;

  try {
    const result = await API.post('/api/projects/' + projectId + '/regenerate-dsn');
    const dsnEl = $('#setting-dsn-value');
    if (dsnEl) dsnEl.textContent = result.dsn_key;
    showToast('DSN regenerated');
  } catch (err) {
    showToast(err.message || 'Failed to regenerate DSN', 'error');
  }
}

async function inviteMember() {
  const orgId = AppState.currentOrg?.id;
  if (!orgId) return;

  const email = prompt('Enter email address to invite:');
  if (!email) return;

  const role = prompt('Role (admin or member):', 'member');

  try {
    await API.post('/api/invitations/org/' + orgId, { email, invite_role: role || 'member' });
    showToast('Invitation sent to ' + email);
    loadSettings();
  } catch (err) {
    showToast(err.message || 'Failed to send invitation', 'error');
  }
}

function renderPendingInvitations(invitations) {
  const container = $('#pending-invitations-list');
  if (!container) return;

  if (!invitations || invitations.length === 0) {
    container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">No pending invitations</div>';
    return;
  }

  container.innerHTML = invitations.map(inv => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--card-border)">
      <div>
        <div style="font-size:13px;font-weight:500">${escapeHtml(inv.email)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${inv.role} · Expires ${formatDate(inv.expires_at)}</div>
      </div>
      <button onclick="cancelInvitation('${inv.id}')" style="background:none;border:none;color:var(--error-red);cursor:pointer;font-size:12px">Cancel</button>
    </div>
  `).join('');
}

async function cancelInvitation(invitationId) {
  if (!confirm('Cancel this invitation?')) return;
  try {
    await API.delete('/api/invitations/' + invitationId);
    showToast('Invitation cancelled');
    loadSettings();
  } catch (err) {
    showToast(err.message || 'Failed to cancel invitation', 'error');
  }
}

async function removeMember(memberId) {
  if (!confirm('Remove this member from the organization?')) return;
  const orgId = AppState.currentOrg?.id;
  if (!orgId) return;

  try {
    await API.delete('/api/orgs/' + orgId + '/members/' + memberId);
    showToast('Member removed');
    loadSettings();
  } catch (err) {
    showToast(err.message || 'Failed to remove member', 'error');
  }
}

async function deleteProject() {
  const projectId = localStorage.getItem('br_project');
  if (!projectId || !confirm('Are you sure you want to delete this project? This cannot be undone.')) return;

  try {
    await API.delete('/api/projects/' + projectId);
    localStorage.removeItem('br_project');
    showToast('Project deleted');
    window.location.href = '/dashboard.html';
  } catch (err) {
    showToast(err.message || 'Failed to delete project', 'error');
  }
}

/* --------------------------------------------------------------------------
   12. BILLING PAGE
   -------------------------------------------------------------------------- */
async function loadBilling() {
  const orgId = AppState.currentOrg?.id;
  if (!orgId) return;

  try {
    const billing = await API.get('/api/billing/org/' + orgId);
    renderBillingInfo(billing);
  } catch (err) {
    console.error('Billing load error:', err);
  }
}

function renderBillingInfo(billing) {
  const planEl = $('#billing-plan');
  const usageEl = $('#billing-usage');
  const limitEl = $('#billing-limit');
  const periodEl = $('#billing-period');

  if (planEl) planEl.textContent = billing.plan.toUpperCase();
  if (usageEl) usageEl.textContent = billing.events_used?.toLocaleString() || '0';
  if (limitEl) limitEl.textContent = billing.limits?.maxEventsPerMonth?.toLocaleString() || '5,000';
  if (periodEl) periodEl.textContent = billing.current_period_end ? formatDate(billing.current_period_end) : '-';
}

async function upgradeToPro() {
  const orgId = AppState.currentOrg?.id;
  if (!orgId) return;

  try {
    const result = await API.post('/api/billing/org/' + orgId + '/checkout', { plan: 'pro' });

    // For demo: auto-confirm
    if (result.checkout_url?.includes('demo=true')) {
      await API.post('/api/billing/org/' + orgId + '/checkout/confirm');
      showToast('Upgraded to Pro plan!');
      loadBilling();
    } else {
      window.location.href = result.checkout_url;
    }
  } catch (err) {
    showToast(err.message || 'Failed to initiate checkout', 'error');
  }
}

async function downgradeToFree() {
  const orgId = AppState.currentOrg?.id;
  if (!orgId || !confirm('Downgrade to the free plan?')) return;

  try {
    await API.post('/api/billing/org/' + orgId + '/downgrade');
    showToast('Downgraded to free plan');
    loadBilling();
  } catch (err) {
    showToast(err.message || 'Failed to downgrade', 'error');
  }
}

/* --------------------------------------------------------------------------
   13. NAVIGATION & SIDEBAR
   -------------------------------------------------------------------------- */
function updateSidebarUser() {
  const nameEl = $$('.user-name, .mob-user-name');
  const emailEl = $$('.user-email, .mob-user-email');
  const avatarEls = $$('.avatar, .mob-avatar');

  if (AppState.user) {
    nameEl.forEach(el => el.textContent = AppState.user.name || 'User');
    emailEl.forEach(el => el.textContent = AppState.user.email || '');
    avatarEls.forEach(el => el.textContent = (AppState.user.name || 'U')[0].toUpperCase());
  }
}

function highlightActiveNav() {
  const path = location.pathname;
  $$('.nav-item, .mob-nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href && path.includes(href.replace('.html', ''))) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

/* --------------------------------------------------------------------------
   14. HTML ESCAPE UTILITY
   -------------------------------------------------------------------------- */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* --------------------------------------------------------------------------
   15. MOBILE DRAWER
   -------------------------------------------------------------------------- */
function toggleMobDrawer() {
  const backdrop = $('#mobDrawerBackdrop');
  const btn = $('#mobHamBtn');
  if (backdrop) backdrop.classList.toggle('open');
  if (btn) btn.classList.toggle('open');
}

function closeMobDrawerOnBackdrop(e) {
  if (e.target === e.currentTarget) toggleMobDrawer();
}

/* --------------------------------------------------------------------------
   16. COLOR GUIDE MODAL
   -------------------------------------------------------------------------- */
function toggleColorGuideModal() {
  const modal = document.querySelector('.color-guide-modal');
  if (modal) modal.classList.toggle('open');
}

/* --------------------------------------------------------------------------
   17. PAGE INITIALIZATION
   -------------------------------------------------------------------------- */
async function initPage() {
  const path = location.pathname;

  // Auth pages
  if (path.includes('login') || path.includes('signup')) {
    await requireAuth();
    return;
  }

  // Index page
  if (path.endsWith('/') || path.endsWith('index.html')) {
    try { await AppState.load(); } catch {}
    return;
  }

  // Protected pages
  const authed = await requireAuth();
  if (!authed) return;

  updateSidebarUser();
  highlightActiveNav();

  // Load page-specific data
  if (path.includes('dashboard')) loadDashboard();
  else if (path.includes('issues') && !path.includes('issue-detail')) loadIssues();
  else if (path.includes('issue-detail')) loadIssueDetail();
  else if (path.includes('alerts')) loadAlerts();
  else if (path.includes('settings')) loadSettings();
  else if (path.includes('performance')) loadBilling();
  else if (path.includes('onboarding')) {} // onboarding handles itself
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
