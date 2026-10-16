# BugRadar Deployment Guide

## Prerequisites

- Docker & Docker Compose
- A domain name (for production with SSL)
- A VPS (Hetzner, DigitalOcean, AWS EC2, etc.) with at least 2GB RAM

## Quick Start (Docker Compose)

### 1. Clone and configure

```bash
git clone <repo-url> bugradar
cd bugradar
cp .env.production.example .env
```

### 2. Generate secrets

```bash
# Generate JWT secrets
openssl rand -hex 64

# Generate webhook secret
openssl rand -hex 32

# Generate a strong DB password
openssl rand -base64 32
```

### 3. Edit `.env` with your values

```bash
nano .env
```

Fill in:
- `DB_PASSWORD` — strong password from above
- `REDIS_PASSWORD` — use the same or different strong password
- `JWT_ACCESS_SECRET` — 128-char hex string
- `JWT_REFRESH_SECRET` — different 128-char hex string
- `WEBHOOK_SECRET` — 64-char hex string
- `CORS_ORIGIN` — your domain, e.g., `https://bugradar.yourdomain.com`
- SMTP credentials (optional, for email alerts) — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

> **Warning:** the values shipped in `.env.production.example` are placeholders.
> In production mode the server refuses to boot (`server/config.js`) unless
> `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DB_PASSWORD` and `WEBHOOK_SECRET`
> are each set to at least 32 characters — replace every placeholder with the
> generated values from step 2.

### 4. Start services

```bash
docker compose up -d
```

`docker-compose.yml` runs the same three services version one deployed:
the app, Redis and nginx (80/443). **PostgreSQL is external** — point
`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` in `.env` at your
database host, exactly as in version one. For a self-contained local stack
that bundles PostgreSQL and needs no certificates, use the alternate file:

```bash
docker compose -f docker-compose.local.yml up -d
```

That variant proxies plain HTTP on port 80 through `nginx.local.conf`.

### 5. Run migrations

```bash
docker compose exec app node server/migrations/run.js
docker compose exec app node server/migrations/seed.js  # optional: demo data
```

### 6. Verify

The app port is not published in the production stack (nginx fronts it on
80/443), so check health from inside the container:

```bash
docker compose exec app wget -qO- http://localhost:3000/api/health
```

---

## SSL Setup with Let's Encrypt

`nginx.conf` always serves HTTPS and reads the certificates directly from
`/etc/letsencrypt/live/<domain>/` — `docker-compose.yml` mounts the host's
`/etc/letsencrypt` directory read-only into the nginx container. There is no
separate cert-copy step and no commented-out block to enable; before the
certificates exist, the nginx container will restart-loop (the app and Redis
keep running, but nothing is served until certificates are obtained).

### 1. Update `nginx.conf`

Set `server_name` to your domain in both server blocks (HTTP and HTTPS).

### 2. Install certbot on host

```bash
sudo apt install certbot
```

### 3. Get certificate (stop anything on port 80 first)

```bash
sudo certbot certonly --standalone -d yourdomain.com
```

### 4. Restart

```bash
docker compose restart nginx
```

---

## Server Setup (Ubuntu 22.04 / Debian 12)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Clone app
git clone <repo-url> /opt/bugradar
cd /opt/bugradar

# Configure
cp .env.production.example .env
nano .env  # fill in secrets

# Start
docker compose up -d

# Run migrations
docker compose exec app node server/migrations/run.js
```

---

## PM2 (Non-Docker)

If running without Docker:

```bash
# Install PM2
npm install -g pm2

# Start
pm2 start ecosystem.config.js --env production

# Auto-start on reboot
pm2 startup
pm2 save
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | Yes | `production` |
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | PostgreSQL port (default: 5432) |
| `DB_USER` | Yes | PostgreSQL user (default: bugradar) |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `DB_NAME` | Yes | Database name (default: bugradar) |
| `DB_POOL_MAX` | No | Max DB connections (default: 20) |
| `REDIS_HOST` | Yes | Redis host |
| `REDIS_PORT` | No | Redis port (default: 6379) |
| `REDIS_PASSWORD` | No | Redis password |
| `JWT_ACCESS_SECRET` | Yes | Min 32 chars. Generate: `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Yes | Min 32 chars. Generate: `openssl rand -hex 64` |
| `SMTP_HOST` | No | SMTP server for email alerts |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | From-address for alert emails |
| `CORS_ORIGIN` | Yes | Your production domain URL |
| `WEBHOOK_SECRET` | Yes | Min 32 chars. Generate: `openssl rand -hex 32` |
| `DB_ADMIN_HOST` | No | Admin host for `npm run setup-db` (default: localhost) |
| `DB_ADMIN_PORT` | No | Admin port for `npm run setup-db` (default: 5432) |
| `DB_ADMIN_USER` | No | Admin user for `npm run setup-db` (default: postgres) |
| `DB_ADMIN_PASSWORD` | No | Admin password for `npm run setup-db` (default: postgres) |

---

## Monitoring

- Health check: `GET /api/health`
- Returns: `{ status, timestamp, database, redis }`
- Status `ok` = healthy, `degraded` = one component down

---

## Backups

PostgreSQL runs outside the compose stack in production (same as version
one), so back it up from the database host (or any machine that can reach it):

### PostgreSQL

```bash
pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
psql -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" < backup.sql
```

### Automated backup cron

```bash
# Add to crontab on the database host (daily at 2 AM)
0 2 * * * pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" | gzip > /backups/bugradar_$(date +\%Y\%m\%d).sql.gz
```

---

## Scaling

For multiple instances:
1. Use an external PostgreSQL (AWS RDS, Supabase, etc.)
2. Use an external Redis (AWS ElastiCache, Redis Cloud, etc.)
3. Run multiple `app` containers behind a load balancer
4. Set `DB_POOL_MAX=10` per instance

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `FATAL: password authentication failed` | Check `DB_PASSWORD` in `.env` matches PostgreSQL |
| `ECONNREFUSED` to Redis | Ensure Redis is running: `docker compose ps` |
| Health check returns `degraded` | Check DB/Redis connectivity logs |
| Port 3000 already in use | Change `PORT` in `.env` or stop the conflicting process |
| nginx restart-looping | Certificates missing — obtain them with the SSL steps above, or use `docker-compose.local.yml` (HTTP only) |
| Server exits on boot in production | A placeholder secret is still in `.env` — see the warning in Quick Start |
