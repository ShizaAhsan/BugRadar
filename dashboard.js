// Make table rows clickable to navigate to issue-detail.html?from=dashboard
        document.querySelectorAll('tbody tr').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = 'issue-detail.html?from=dashboard';
            });
        });

        // ─── DYNAMIC GRAPH DATA ENGINE ─────────────────────────────────────────────
        window.chartData = {
            '1H': {
                labels: ['19:00', '19:10', '19:20', '19:30', '19:40', '19:50', '20:00'],
                fullTimes: ['19:00:00 UTC', '19:10:00 UTC', '19:20:00 UTC', '19:30:00 UTC', '19:40:00 UTC', '19:50:00 UTC', '20:00:00 UTC'],
                values: [320, 870, 420, 1540, 680, 290, 750]
            },
            '24H': {
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
                fullTimes: ['Today, 00:00 AM', 'Today, 04:00 AM', 'Today, 08:00 AM', 'Today, 12:00 PM', 'Today, 04:00 PM', 'Today, 08:00 PM', 'Today, 11:59 PM'],
                values: [210, 340, 1850, 980, 760, 1100, 590]
            },
            '7D': {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                fullTimes: ['Mon, 10:00 AM', 'Tue, 02:30 PM', 'Wed, 12:00 PM', 'Thu, 06:15 PM', 'Fri, 09:45 PM', 'Sat, 04:20 PM', 'Sun, 11:10 PM'],
                values: [410, 880, 1540, 920, 1780, 650, 1950]
            },
            '30D': {
                labels: ['Oct 1', 'Oct 7', 'Oct 14', 'Oct 21', 'Oct 28'],
                fullTimes: ['Oct 1, 2026 - 12:00 PM', 'Oct 7, 2026 - 12:00 PM', 'Oct 14, 2026 - 12:00 PM', 'Oct 21, 2026 - 12:00 PM', 'Oct 28, 2026 - 12:00 PM'],
                values: [3400, 8900, 18200, 11500, 19800]
            }
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

        // Global Backend API Integration Function
        window.updateBugRadarGraph = function(timeRange, labels, values) {
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

        // Table Status Filter
        const tablePillBtns = document.querySelectorAll('#statusFilterPills .table-pill-btn');
        const tableRows = document.querySelectorAll('#recentIssuesTable tbody tr');

        tablePillBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tablePillBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const status = btn.dataset.status;
                tableRows.forEach(row => {
                    row.style.display = (status === 'all' || row.classList.contains(status)) ? '' : 'none';
                });
            });
        });

        // Table Column Sorting
        let sortState = { col: null, dir: 'none' };
        const sortableHeaders = document.querySelectorAll('.sortable-th');
        const tbody = document.querySelector('#recentIssuesTable tbody');

        sortableHeaders.forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
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
                const rowsArr = Array.from(tableRows);
                if (sortState.dir !== 'none') {
                    rowsArr.sort((a, b) => {
                        let valA = 0, valB = 0;
                        if (col === 'events') {
                            valA = parseInt(a.children[1].innerText.replace(/,/g, '')) || 0;
                            valB = parseInt(b.children[1].innerText.replace(/,/g, '')) || 0;
                        } else if (col === 'users') {
                            valA = parseInt(a.children[2].innerText.replace(/,/g, '')) || 0;
                            valB = parseInt(b.children[2].innerText.replace(/,/g, '')) || 0;
                        } else if (col === 'time') {
                            valA = parseInt(a.children[3].dataset.time) || 0;
                            valB = parseInt(b.children[3].dataset.time) || 0;
                        }
                        return sortState.dir === 'desc' ? (valB - valA) : (valA - valB);
                    });
                }
                rowsArr.forEach(r => tbody.appendChild(r));
            });
        });

        // Search Bar Dropdown & Navigation
        const searchIndex = [
            { icon: '🔴', title: 'TypeError: Cannot read properties', sub: 'src/components/Dashboard.tsx:84', url: 'issue-detail.html?from=dashboard' },
            { icon: '🔴', title: 'ReferenceError: window is not defined', sub: 'utils/analytics.js:12', url: 'issue-detail.html?from=dashboard' },
            { icon: '🟡', title: 'AxiosError: Request failed 500', sub: 'api/userController.ts:201', url: 'issue-detail.html?from=dashboard' },
            { icon: '⚡', title: 'Dashboard', sub: 'Go to Overview Dashboard', url: 'dashboard.html' },
            { icon: '📋', title: 'Issues', sub: 'View all issues list', url: 'issues.html' },
            { icon: '📊', title: 'Performance', sub: 'View performance metrics', url: 'performance.html' },
            { icon: '🔔', title: 'Alerts', sub: 'View alerts & incidents', url: 'alerts.html' },
            { icon: '⚙️', title: 'Settings', sub: 'Project settings & DSN', url: 'settings.html' }
        ];

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
            const results = searchIndex.filter(item =>
                item.title.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q)
            );
            if (!searchDropdown) return;
            if (results.length === 0) {
                searchDropdown.innerHTML = `<div class="search-no-result">No results for "<strong>${query}</strong>"</div>`;
            } else {
                searchDropdown.innerHTML = results.map(r => `
                    <a href="${r.url}" class="search-result-item">
                        <span class="search-result-icon">${r.icon}</span>
                        <span class="search-result-text">
                            <span class="search-result-title">${r.title}</span>
                            <span class="search-result-sub">${r.sub}</span>
                        </span>
                    </a>`).join('');
            }
            searchDropdown.classList.add('visible');
        }

        if (dashSearchInput) {
            dashSearchInput.addEventListener('input', () => {
                renderSearchDropdown(dashSearchInput.value);
                const q = dashSearchInput.value.toLowerCase().trim();
                tableRows.forEach(row => {
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

        // Profile Dropdown Toggle
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

        // KPI Time Range Dropdown
        function toggleKpiDropdown() {
            const dd = document.getElementById('kpiTimeDropdown');
            if (dd) dd.classList.toggle('visible');
        }
        function selectKpiRange(el) {
            document.querySelectorAll('.kpi-time-opt').forEach(o => o.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('kpiBigValue').innerText = el.dataset.val;
            document.getElementById('kpiTimeBtn').innerHTML = el.dataset.label + ' &#9662;';
            document.getElementById('kpiTimeDropdown').classList.remove('visible');
        }
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#kpiTimeBtn') && !e.target.closest('#kpiTimeDropdown')) {
                const dd = document.getElementById('kpiTimeDropdown');
                if (dd) dd.classList.remove('visible');
            }
        });

        // Modal Handlers
        function openAlertModal() {
            document.getElementById('modalTitle').innerHTML = '<span>🔔 Alert Threshold Exceeded</span>';
            document.getElementById('modalBody').innerHTML = 'Critical exception count for <strong>TypeError: Cannot read properties of undefined</strong> has exceeded 1,000 events in the last 1 hour. Immediate developer triage recommended.';
            document.getElementById('appModalOverlay').classList.add('active');
        }
        function openAskModal() {
            document.getElementById('modalTitle').innerHTML = '<span>❓ Confirm Alert Rule Enable</span>';
            document.getElementById('modalBody').innerHTML = 'Would you like BugRadar to automatically post Slack webhook alerts to <strong>#engineering-alerts</strong> whenever error frequency spikes by over 50%?';
            document.getElementById('appModalOverlay').classList.add('active');
        }
        function closeModal() {
            document.getElementById('appModalOverlay').classList.remove('active');
        }

        // Mobile Drawer Controller
        function toggleMobDrawer() {
            var backdrop = document.getElementById('mobDrawerBackdrop');
            var btn = document.getElementById('mobHamBtn');
            if (backdrop) {
                var isOpen = backdrop.classList.toggle('open');
                if (btn) {
                    btn.classList.toggle('open', isOpen);
                }
                document.body.style.overflow = isOpen ? 'hidden' : '';
            }
        }

        function closeMobDrawerOnBackdrop(e) {
            if (e.target === document.getElementById('mobDrawerBackdrop')) {
                toggleMobDrawer();
            }
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var backdrop = document.getElementById('mobDrawerBackdrop');
                if (backdrop && backdrop.classList.contains('open')) {
                    toggleMobDrawer();
                }
            }
        });

function toggleColorGuideModal() {
            var modal = document.getElementById('colorGuideModal');
            if (modal) {
                modal.classList.toggle('open');
            }
        }
        function closeColorGuideOnBackdrop(e) {
            if (e.target === document.getElementById('colorGuideModal')) {
                toggleColorGuideModal();
            }
        }

// CSP-safe dashboard event handlers
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
                profileWrap.addEventListener('click', function () {
                    toggleProfileDropdown();
                });
            }

            // KPI time dropdown
            const kpiTimeBtn = document.getElementById('kpiTimeBtn');
            if (kpiTimeBtn) {
                kpiTimeBtn.addEventListener('click', toggleKpiDropdown);
            }

            // KPI time options
            document.querySelectorAll('.kpi-time-opt').forEach(function (option) {
                option.addEventListener('click', function () {
                    selectKpiRange(option);
                });
            });

            // Alerts icon
            const iconButtons = document.querySelectorAll('.icon-btn');

            iconButtons.forEach(function (btn) {
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

            // Dashboard issue rows
            document.querySelectorAll('tr.unresolved, tr.resolved').forEach(function (row) {
                row.addEventListener('click', function () {
                    window.location.href = 'issue-detail.html?from=dashboard';
                });
            });

            // Dismiss modal button
            document.querySelectorAll('.btn.btn-secondary').forEach(function (btn) {
                if (btn.textContent.trim() === 'Dismiss') {
                    btn.addEventListener('click', closeModal);
                }
            });

            // View Issue Details modal button
            document.querySelectorAll('.btn.btn-primary').forEach(function (btn) {
                if (btn.textContent.trim() === 'View Issue Details') {
                    btn.addEventListener('click', function () {
                        window.location.href = 'issue-detail.html?from=dashboard';
                    });
                }
            });

            // Color guide backdrop
            const colorGuideModal = document.getElementById('colorGuideModal');
            if (colorGuideModal) {
                colorGuideModal.addEventListener('click', closeColorGuideOnBackdrop);
            }

            // Color guide close button
            const colorGuideClose = document.querySelector('.color-guide-close');
            if (colorGuideClose) {
                colorGuideClose.addEventListener('click', toggleColorGuideModal);
            }
        });