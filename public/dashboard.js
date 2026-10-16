// Dashboard page behaviors: SVG chart engine, table filters/sort, search dropdown,
// header/drawer controls. Issue data comes from app.js (loadDashboard /
// renderDashboardIssues) — everything below operates on that real data (C2/M9).

// ─── DYNAMIC GRAPH DATA ENGINE ───────────────────────────────────────────────
// Skeleton series (real calendar labels, zero counts) shown only until the stats
// API delivers real event counts; never fabricated values (C2).
function skeletonLabels(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        out.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    return out;
}

window.chartData = {
    '7D':  { labels: skeletonLabels(7),  values: new Array(7).fill(0) },
    '30D': { labels: skeletonLabels(7),  values: new Array(7).fill(0) }
};

let currentRange = '7D';
const chartContainer  = document.getElementById('chartContainer');
const guideLine       = document.getElementById('guideLine');
const guidePoint      = document.getElementById('guidePoint');
const svgTooltipGroup = document.getElementById('svgTooltipGroup');
const svgTooltipBg    = document.getElementById('svgTooltipBg');
const svgTooltipTime  = document.getElementById('svgTooltipTime');
const svgTooltipVal   = document.getElementById('svgTooltipVal');
const chartLine       = document.getElementById('chartLine');
const chartArea       = document.getElementById('chartArea');
const xAxisContainer  = document.getElementById('xAxis');
const yAxisContainer  = document.getElementById('yAxis');

// Dynamically compute SVG curve paths & dynamic Y-axis scales
function generateSvgPaths(values) {
    const width = 1000;
    const height = 200;
    const paddingTop = 25;
    const paddingBottom = 25;
    const usableHeight = height - paddingTop - paddingBottom;

    const maxVal = Math.max(...values, 10);
    const minVal = 0;

    const points = values.map((val, index) => {
        const x = (index / (values.length - 1)) * width;
        const normalized = (val - minVal) / (maxVal - minVal);
        const y = height - paddingBottom - (normalized * usableHeight);
        return { x, y, val };
    });

    let pathD = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cpX = (p0.x + p1.x) / 2;
        pathD += ` Q ${cpX},${p0.y} ${p1.x},${p1.y}`;
    }

    const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
    return { pathD, areaD, maxVal, points };
}

function setChartRange(range) {
    currentRange = range;
    const data = window.chartData[range];
    if (!data) return;

    document.querySelectorAll('.time-filter-btn').forEach(btn => {
        if (btn.dataset.range) {
            btn.classList.toggle('active', btn.dataset.range === range);
        }
    });

    if (xAxisContainer) {
        xAxisContainer.innerHTML = data.labels.map(l => `<span>${l}</span>`).join('');
    }

    const { pathD, areaD, maxVal } = generateSvgPaths(data.values);

    if (yAxisContainer) {
        const step = maxVal / 4;
        yAxisContainer.innerHTML = `
            <span>${Math.round(maxVal).toLocaleString()}</span>
            <span>${Math.round(step * 3).toLocaleString()}</span>
            <span>${Math.round(step * 2).toLocaleString()}</span>
            <span>${Math.round(step * 1).toLocaleString()}</span>
            <span>0</span>
        `;
    }

    if (chartLine && chartArea) {
        chartLine.setAttribute('d', pathD);
        chartArea.setAttribute('d', areaD);
    }

    updatePointAndTooltip(500);
}

function getAvg(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function updatePointAndTooltip(xPos) {
    if (!chartContainer || !chartLine || !guideLine || !guidePoint || !svgTooltipGroup) return;
    const rect = chartContainer.getBoundingClientRect();
    const svgX = Math.max(0, Math.min(1000, (xPos / rect.width) * 1000));

    const pathLen = chartLine.getTotalLength();
    const closestPoint = chartLine.getPointAtLength((svgX / 1000) * pathLen);

    // Move Guide Line, Circle Dot & Tooltip Tag NATIVELY in SVG Space
    guideLine.setAttribute('x1', svgX);
    guideLine.setAttribute('x2', svgX);
    guidePoint.setAttribute('cx', svgX);
    guidePoint.setAttribute('cy', closestPoint.y);

    // Tooltip Tag Transform natively translates to (closestPoint.x, closestPoint.y)
    svgTooltipGroup.setAttribute('transform', `translate(${closestPoint.x}, ${closestPoint.y})`);

    // Calculate exact closest label index based on SVG X position
    const data = window.chartData[currentRange];
    const numLabels = data.labels.length;
    const segmentWidth = 1000 / (numLabels - 1);
    const index = Math.min(Math.max(0, Math.round(svgX / segmentWidth)), numLabels - 1);

    const labelVal = data.values[index];
    const avg = getAvg(data.values);

    // Spike detection (>140% avg -> Red glow)
    const isHigh = labelVal > avg * 1.4;
    const dotColor = isHigh ? '#ef4444' : '#3b82f6';
    const glowFilter = isHigh ? 'drop-shadow(0 0 12px rgba(239,68,68,0.75))' : 'drop-shadow(0 0 12px rgba(59,130,246,0.6))';

    guidePoint.setAttribute('fill', dotColor);
    guideLine.setAttribute('stroke', dotColor);

    if (svgTooltipBg) {
        svgTooltipBg.setAttribute('stroke', dotColor);
        svgTooltipBg.style.filter = glowFilter;
    }

    const timeLabel = (data.fullTimes && data.fullTimes[index]) ? data.fullTimes[index] : data.labels[index];
    const errorLabelText = isHigh ? `${labelVal.toLocaleString()} Errors (Spike)` : `${labelVal.toLocaleString()} Errors`;

    if (svgTooltipTime) svgTooltipTime.textContent = timeLabel;
    if (svgTooltipVal) {
        svgTooltipVal.textContent = errorLabelText;
        svgTooltipVal.setAttribute('fill', isHigh ? '#ef4444' : '#ffffff');
    }
}

// Fed by app.js loadDashboard() with real stats from
// GET /api/issues/project/:id/stats (C2/M9)
window.updateBugRadarGraph = function(timeRange, labels, values) {
    if (!labels || !values || labels.length < 2) return;
    window.chartData[timeRange] = { labels, values };
    if (timeRange === currentRange) {
        setChartRange(timeRange);
    }
};

// Hold & Drag ONLY on circular point
let isDragging = false;

function handlePointerMove(clientX) {
    if (!chartContainer) return;
    const rect = chartContainer.getBoundingClientRect();
    updatePointAndTooltip(clientX - rect.left);
}

if (guidePoint) {
    guidePoint.style.cursor = 'grab';
    guidePoint.style.pointerEvents = 'all';

    guidePoint.addEventListener('mousedown', (e) => {
        isDragging = true;
        guidePoint.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        handlePointerMove(e.clientX);
        e.stopPropagation();
        e.preventDefault();
    });

    guidePoint.addEventListener('touchstart', (e) => {
        isDragging = true;
        if (e.touches && e.touches[0]) {
            handlePointerMove(e.touches[0].clientX);
        }
        e.stopPropagation();
    }, { passive: true });
}

// Window-level listeners ensure smooth dragging across boundaries only when isDragging is true
window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        handlePointerMove(e.clientX);
    }
});

window.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        if (guidePoint) guidePoint.style.cursor = 'grab';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches && e.touches[0]) {
        handlePointerMove(e.touches[0].clientX);
    }
}, { passive: true });

window.addEventListener('touchend', () => {
    if (isDragging) {
        isDragging = false;
        if (guidePoint) guidePoint.style.cursor = 'grab';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

// Time Range Filter Buttons
document.querySelectorAll('.time-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.range) setChartRange(btn.dataset.range);
    });
});

// Initialize 7D view immediately
setChartRange('7D');

// ─── RECENT ISSUES TABLE (real rows rendered by app.js) ─────────────────────
// Rows are queried at event time — app.js renders them asynchronously after load.
function dashboardTableRows() {
    return Array.from(document.querySelectorAll('#recentIssuesTable tbody tr'));
}

// Table Status Filter
const tablePillBtns = document.querySelectorAll('#statusFilterPills .table-pill-btn');
tablePillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tablePillBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const status = btn.dataset.status;
        dashboardTableRows().forEach(row => {
            row.style.display = (status === 'all' || row.classList.contains(status)) ? '' : 'none';
        });
    });
});

// Table Column Sorting
let sortState = { col: null, dir: 'none' };
const sortableHeaders = document.querySelectorAll('.sortable-th');

sortableHeaders.forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.col;
        const tbody = document.querySelector('#recentIssuesTable tbody');
        if (!tbody) return;
        const rowsArr = dashboardTableRows();

        if (sortState.col !== col) {
            sortState.col = col; sortState.dir = 'desc';
        } else if (sortState.dir === 'desc') {
            sortState.dir = 'asc';
        } else {
            sortState.col = null; sortState.dir = 'none';
        }
        document.querySelectorAll('.sort-arrows span').forEach(s => s.classList.remove('active-glow'));
        if (sortState.dir !== 'none') {
            const arrowSpan = sortState.dir === 'asc' ? th.querySelector('.arrow-up') : th.querySelector('.arrow-down');
            if (arrowSpan) arrowSpan.classList.add('active-glow');
        }
        if (sortState.dir !== 'none') {
            // Row cells: 0=message, 1=status, 2=events, 3=last seen
            const cellIndex = col === 'events' ? 2 : 3;
            rowsArr.sort((a, b) => {
                const valA = parseInt((a.children[cellIndex]?.innerText || '').replace(/,/g, '')) || 0;
                const valB = parseInt((b.children[cellIndex]?.innerText || '').replace(/,/g, '')) || 0;
                return sortState.dir === 'desc' ? (valB - valA) : (valA - valB);
            });
        }
        rowsArr.forEach(r => tbody.appendChild(r));
    });
});

// ─── SEARCH BAR: real issues + page links (no fabricated entries) ───────────
function buildSearchIndex() {
    const pages = [
        { icon: '⚡', title: 'Dashboard', sub: 'Go to Overview Dashboard', url: 'dashboard.html' },
        { icon: '📋', title: 'Issues', sub: 'View all issues list', url: 'issues.html' },
        { icon: '📊', title: 'Performance', sub: 'View performance & billing', url: 'performance.html' },
        { icon: '🔔', title: 'Alerts', sub: 'View alerts & history', url: 'alerts.html' },
        { icon: '⚙️', title: 'Settings', sub: 'Project settings & DSN', url: 'settings.html' }
    ];
    const issues = (window.dashboardSearchData || []).map(i => ({
        icon: i.status === 'resolved' ? '🟢' : '🔴',
        title: i.title || 'Untitled issue',
        sub: i.culprit || '',
        url: 'issue-detail.html?id=' + i.id
    }));
    return issues.concat(pages);
}

const dashSearchInput = document.getElementById('dashboardSearchInput');
const searchDropdown  = document.getElementById('searchDropdown');

function renderSearchDropdown(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
        if (searchDropdown) {
            searchDropdown.classList.remove('visible');
            searchDropdown.innerHTML = '';
        }
        return;
    }
    const results = buildSearchIndex().filter(item =>
        item.title.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q)
    );
    if (!searchDropdown) return;
    if (results.length === 0) {
        // Escape the raw query — it is echoed back into innerHTML (M8)
        searchDropdown.innerHTML = `<div class="search-no-result">No results for "<strong>${escapeHtml(query)}</strong>"</div>`;
    } else {
        searchDropdown.innerHTML = results.map(r => `
            <a href="${r.url}" class="search-result-item">
                <span class="search-result-icon">${r.icon}</span>
                <span class="search-result-text">
                    <span class="search-result-title">${escapeHtml(r.title)}</span>
                    <span class="search-result-sub">${escapeHtml(r.sub)}</span>
                </span>
            </a>`).join('');
    }
    searchDropdown.classList.add('visible');
}

if (dashSearchInput) {
    dashSearchInput.addEventListener('input', () => {
        renderSearchDropdown(dashSearchInput.value);
        const q = dashSearchInput.value.toLowerCase().trim();
        dashboardTableRows().forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            if (searchDropdown) searchDropdown.classList.remove('visible');
        }
    });
}

// ─── PROFILE DROPDOWN ────────────────────────────────────────────────────────
function toggleProfileDropdown() {
    const dd = document.getElementById('profileDropdown');
    if (dd) dd.classList.toggle('visible');
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('#profileWrap')) {
        const dd = document.getElementById('profileDropdown');
        if (dd) dd.classList.remove('visible');
    }
});

// Profile dropdown, drawer, color guide and header controls.
// toggleMobDrawer / closeMobDrawerOnBackdrop / toggleColorGuideModal are the
// single definitions shared from app.js (no shadow copies here — M9).
document.addEventListener('DOMContentLoaded', function () {

    // Mobile hamburger
    const mobHamBtn = document.getElementById('mobHamBtn');
    if (mobHamBtn) {
        mobHamBtn.addEventListener('click', toggleMobDrawer);
    }

    // Mobile drawer close button
    document.querySelectorAll('.mob-drawer-close').forEach(function (btn) {
        btn.addEventListener('click', toggleMobDrawer);
    });

    // Mobile drawer backdrop
    const mobDrawerBackdrop = document.getElementById('mobDrawerBackdrop');
    if (mobDrawerBackdrop) {
        mobDrawerBackdrop.addEventListener('click', closeMobDrawerOnBackdrop);
    }

    // Color guide buttons
    document.querySelectorAll('.sidebar-color-guide-btn').forEach(function (btn) {
        btn.addEventListener('click', toggleColorGuideModal);
    });

    // Profile dropdown
    const profileWrap = document.getElementById('profileWrap');
    if (profileWrap) {
        profileWrap.addEventListener('click', function (e) {
            // Keep the Sign Out link (handleLogout) from re-opening the dropdown
            if (e.target.closest('.profile-drop-item')) return;
            toggleProfileDropdown();
        });
    }

    // Header icon buttons → Alerts / Settings
    document.querySelectorAll('.icon-btn').forEach(function (btn) {
        const title = btn.getAttribute('title');
        if (title === 'Alerts') {
            btn.addEventListener('click', function () {
                window.location.href = 'alerts.html';
            });
        }
        if (title === 'Settings') {
            btn.addEventListener('click', function () {
                window.location.href = 'settings.html';
            });
        }
    });

    // Color guide backdrop + close button
    const colorGuideModal = document.getElementById('colorGuideModal');
    if (colorGuideModal) {
        colorGuideModal.addEventListener('click', closeColorGuideOnBackdrop);
    }
    const colorGuideClose = document.querySelector('.color-guide-close');
    if (colorGuideClose) {
        colorGuideClose.addEventListener('click', toggleColorGuideModal);
    }
});

function closeColorGuideOnBackdrop(e) {
    if (e.target === document.getElementById('colorGuideModal')) {
        toggleColorGuideModal();
    }
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const backdrop = document.getElementById('mobDrawerBackdrop');
        if (backdrop && backdrop.classList.contains('open')) {
            toggleMobDrawer();
        }
    }
});
