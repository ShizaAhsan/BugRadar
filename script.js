/* ==========================================================================
   BUGRADAR MASTER SCRIPT (script.js)
   Shared Interactivity & Application Logic
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. PASSWORD VISIBILITY TOGGLE (Used in login.html & signup.html)
   -------------------------------------------------------------------------- */
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eye-icon');

    if (!passwordInput || !eyeIcon) return;

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.innerHTML = `
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
            <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
            <line x1="2" y1="2" x2="22" y2="22"></line>
        `;
    } else {
        passwordInput.type = 'password';
        eyeIcon.innerHTML = `
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}

/* --------------------------------------------------------------------------
   2. PASSWORD STRENGTH METER (Used in signup.html)
   -------------------------------------------------------------------------- */
function updatePasswordStrength(val) {
    const fill = document.getElementById('strength-fill');
    if (!fill) return;
    if (!val) {
        fill.style.width = '0%';
        return;
    }
    let score = 0;
    if (val.length >= 6) score += 25;
    if (val.length >= 10) score += 25;
    if (/[A-Z]/.test(val)) score += 25;
    if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) score += 25;

    fill.style.width = score + '%';
    if (score <= 50) {
        fill.style.backgroundColor = 'var(--color-danger)';
    } else if (score <= 75) {
        fill.style.backgroundColor = 'var(--color-warning)';
    } else {
        fill.style.backgroundColor = 'var(--color-success)';
    }
}

/* --------------------------------------------------------------------------
   3. COPY TO CLIPBOARD HELPER
   -------------------------------------------------------------------------- */
function copyToClipboard(textId, btnElement) {
    const textToCopy = document.getElementById(textId)?.innerText || textId;
    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = btnElement.innerText;
        btnElement.innerText = '✓ Copied!';
        btnElement.style.color = 'var(--color-success)';
        btnElement.style.borderColor = 'var(--color-success)';
        
        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.style.color = '';
            btnElement.style.borderColor = '';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

/* --------------------------------------------------------------------------
   4. ONBOARDING PLATFORM PICKER & DSN GENERATION
   -------------------------------------------------------------------------- */
let selectedPlatform = 'javascript';

function selectPlatform(element, platformKey) {
    document.querySelectorAll('.platform-card').forEach(card => card.classList.remove('selected'));
    element.classList.add('selected');
    selectedPlatform = platformKey;
    updateCodeSnippet(platformKey);
}

function updateCodeSnippet(platform) {
    const codeDisplay = document.getElementById('code-display');
    const dsnVal = document.getElementById('dsn-value')?.innerText || 'https://b892a0e2a8@ingest.bugradar.io/proj_9801';
    
    if (!codeDisplay) return;

    if (platform === 'javascript' || platform === 'react') {
        codeDisplay.innerHTML = `
<span class="code-comment">// 1. Install via npm</span>
<span class="code-keyword">npm install</span> @bugradar/browser

<span class="code-comment">// 2. Initialize in your application entry file</span>
<span class="code-keyword">import</span> * <span class="code-keyword">as</span> BugRadar <span class="code-keyword">from</span> <span class="code-string">"@bugradar/browser"</span>;

<span class="code-function">BugRadar.init</span>({
  dsn: <span class="code-string">"${dsnVal}"</span>,
  environment: <span class="code-string">"production"</span>,
  tracesSampleRate: <span class="code-string">1.0</span>,
});`;
    } else if (platform === 'node') {
        codeDisplay.innerHTML = `
<span class="code-comment">// 1. Install BugRadar Node SDK</span>
<span class="code-keyword">npm install</span> @bugradar/node

<span class="code-comment">// 2. Initialize before loading application modules</span>
<span class="code-keyword">const</span> BugRadar = <span class="code-function">require</span>(<span class="code-string">"@bugradar/node"</span>);

<span class="code-function">BugRadar.init</span>({
  dsn: <span class="code-string">"${dsnVal}"</span>,
  environment: <span class="code-string">"production"</span>,
});

<span class="code-comment">// 3. Express error handling middleware</span>
app.<span class="code-function">use</span>(BugRadar.Handlers.<span class="code-function">errorHandler</span>());`;
    } else if (platform === 'python') {
        codeDisplay.innerHTML = `
<span class="code-comment"># 1. Install via pip</span>
pip install bugradar-python

<span class="code-comment"># 2. Initialize in your app.py / main.py</span>
<span class="code-keyword">import</span> bugradar

bugradar.<span class="code-function">init</span>(
    dsn=<span class="code-string">"${dsnVal}"</span>,
    environment=<span class="code-string">"production"</span>
)`;
    }
}

/* --------------------------------------------------------------------------
   5. ONBOARDING STEP TRANSITION (DEPRECATED - use handleOnboardingSubmit from app.js)
   -------------------------------------------------------------------------- */
function handleCreateProject(event) {
    // Redirect to the real handler in app.js
    if (typeof handleOnboardingSubmit === 'function') {
        return handleOnboardingSubmit(event);
    }
    // Fallback: original mock behavior
    event.preventDefault();
    const orgName = document.getElementById('orgname-input').value;
    const projName = document.getElementById('projname-input').value;
    
    if (!orgName || !projName) {
        alert('Please fill in both Organization and Project names.');
        return;
    }

    // Hide Step 1 Form, Show Step 2 DSN Integration View
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

        // Set generated DSN
        const hash = Math.random().toString(36).substring(2, 12);
        const dsnBox = document.getElementById('dsn-value');
        if (dsnBox) {
            dsnBox.innerText = `https://${hash}@ingest.bugradar.io/proj_${Math.floor(1000 + Math.random() * 9000)}`;
        }
        updateCodeSnippet(selectedPlatform);
    }
}

function simulateTestErrorEvent() {
    const radarDot = document.getElementById('radar-dot');
    const statusText = document.getElementById('polling-text-status');
    const testBtn = document.getElementById('test-event-btn');

    if (!statusText) return;

    testBtn.innerText = 'Dispatching Error...';
    testBtn.disabled = true;

    // Send a real test error to the ingestion endpoint
    const dsnVal = document.getElementById('dsn-value')?.innerText;
    if (dsnVal && dsnVal.includes('ingest')) {
        fetch(dsnVal, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Test error from BugRadar onboarding',
                level: 'error',
                environment: 'production',
                exception: {
                    type: 'Error',
                    value: 'Test error from BugRadar onboarding',
                    stacktrace: {
                        frames: [
                            { filename: 'src/test.js', lineno: 42, function: 'testFunction', colno: 5 },
                            { filename: 'node_modules/app/index.js', lineno: 100, function: 'main' }
                        ]
                    }
                },
                breadcrumbs: [
                    { category: 'ui.click', message: 'Button clicked', timestamp: new Date().toISOString() },
                    { category: 'navigation', message: 'Page loaded', timestamp: new Date().toISOString() }
                ],
                tags: { browser: 'Chrome 120', os: 'Windows 10' }
            })
        }).catch(() => {});
    }

    setTimeout(() => {
        if (radarDot) {
            radarDot.style.backgroundColor = 'var(--color-success)';
            radarDot.style.boxShadow = '0 0 12px var(--color-success)';
            radarDot.style.animation = 'none';
        }
        statusText.innerHTML = '<span style="color: var(--color-success); font-weight: 600;">✓ First Error Event Received!</span> (Test error at src/test.js:42)';
        testBtn.innerText = '✓ Event Captured!';
        testBtn.style.borderColor = 'var(--color-success)';
        testBtn.style.color = 'var(--color-success)';
    }, 1200);
}