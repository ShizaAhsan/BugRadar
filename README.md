# BugRadar — Self-Hosted Error Tracking Platform

A lightweight, open-source error tracking and application monitoring platform — a lean Sentry-inspired alternative built for small teams and developers.

## Features

- **Real-time error capture** — JS browser SDK, Node.js SDK, Python SDK
- **Issue grouping & deduplication** — fingerprint-based, stack trace aware
- **Dashboard** — project overview, issue list, issue detail with stack traces & breadcrumbs
- **Alerting** — email notifications on new issues and spike detection
- **Multi-tenant** — organizations, projects, role-based access (Owner/Admin/Member)
- **Billing skeleton** — Payoneer Checkout integration (sandbox mode)
- **Self-hosted** — runs on a single server or Docker Compose

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Redis >= 7

### 1. Clone & Install

```bash
git clone https://github.com/your-org/bugradar.git
cd bugradar
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your database, Redis, and JWT secret settings
```

### 3. Setup Database

```bash
# Create the PostgreSQL role + database
# (defaults: bugradar / bugradar_secret — override with DB_USER,
#  DB_PASSWORD, DB_NAME and the DB_ADMIN_* variables)
npm run setup-db

# Run migrations
npm run migrate

# Seed demo data (optional)
npm run seed
```

### 4. Start

```bash
# Development
npm run dev

# Production
npm start
```

The app runs at `http://localhost:3000`.

### Demo Login

After running the seed script:
- Email: `demo@bugradar.dev`
- Password: `demo1234`

## Docker Deployment

```bash
# Production stack (same services as version one: app + Redis + nginx on
# 80/443 with TLS — PostgreSQL stays external, see DEPLOY.md)
docker compose up -d

# Local stack (adds a bundled PostgreSQL, HTTP-only nginx on port 80,
# no certificates required)
docker compose -f docker-compose.local.yml up -d
```

Production uses the external database configured via `DB_HOST` in `.env`;
only the local stack bundles its own PostgreSQL (published on
`localhost:3000`). See `DEPLOY.md` for SSL setup, backups, and the full
environment-variable reference.

## SDK Integration

All three SDKs take the **full ingest URL** as the DSN — copy it from
Settings → Project Setup in the dashboard.

### JavaScript (Browser)

```html
<script src="/sdk/bugradar.js"></script>
<script>
  BugRadar.init({
    dsn: 'https://your-host/ingest/YOUR_DSN_KEY',
    environment: 'production',
  });
</script>
```

### Node.js

```javascript
const BugRadar = require('./sdk/bugradar-node');

const client = new BugRadar({ dsn: 'https://your-host/ingest/YOUR_DSN_KEY' });
client.install();  // captures uncaughtException / unhandledRejection
app.use(client.createExpressMiddleware());
```

### Python

```python
from sdk.bugradar import BugRadar

radar = BugRadar(dsn='https://your-host/ingest/YOUR_DSN_KEY')
radar.install()
```

## Project Structure

```
bugradar/
├── server/                 # Backend API
│   ├── index.js           # Express server entry
│   ├── config.js          # Configuration
│   ├── db.js              # PostgreSQL connection
│   ├── middleware/         # Auth middleware
│   ├── migrations/        # DB schema & seed
│   ├── routes/            # API routes
│   └── workers/           # Background processors
├── sdk/                   # Client SDKs
│   ├── bugradar.js        # Browser SDK
│   ├── bugradar-node.js   # Node.js SDK
│   └── bugradar.py        # Python SDK
├── public/                # Frontend (static, served by Express)
│   ├── *.html             # Frontend pages
│   ├── app.js             # Frontend application logic
│   ├── dashboard.js       # Dashboard chart & table logic
│   └── style.css          # Design system
├── docker-compose.yml     # Docker deployment (TLS)
├── docker-compose.local.yml # Local stack (HTTP only)
├── Dockerfile             # Container build
├── nginx.conf             # Reverse proxy config (production)
└── nginx.local.conf       # Reverse proxy config (local)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Current user + orgs |
| POST | `/api/orgs` | Create organization |
| POST | `/api/projects/org/:orgId` | Create project |
| POST | `/ingest/:dsnKey/store/` | Error ingestion |
| GET | `/api/issues/project/:id` | List issues |
| GET | `/api/issues/:id` | Issue detail |
| PATCH | `/api/issues/:id` | Update issue |
| POST | `/api/alerts/project/:id` | Create alert rule |
| POST | `/api/billing/org/:id/checkout` | Start checkout |

## License

MIT
