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
- SMTP credentials (optional, for email alerts)

### 4. Start services

```bash
docker compose up -d
```

### 5. Run migrations

```bash
docker compose exec app node server/migrations/run.js
docker compose exec app node server/migrations/seed.js  # optional: demo data
```

### 6. Verify

```bash
curl http://localhost:3000/api/health
```

---

## SSL Setup with Let's Encrypt

### 1. Install certbot on host

```bash
sudo apt install certbot
```

### 2. Get certificate (stop nginx first)

```bash
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
```

### 3. Copy certs to project

```bash
mkdir -p ssl
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/
sudo chown -R $USER:$USER ssl/
```

### 4. Uncomment HTTPS block in `nginx.conf`

Edit the HTTPS server block and update `server_name` to your domain.

### 5. Restart

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
| `CORS_ORIGIN` | Yes | Your production domain URL |
| `WEBHOOK_SECRET` | Yes | Min 32 chars. Generate: `openssl rand -hex 32` |

---

## Monitoring

- Health check: `GET /api/health`
- Returns: `{ status, timestamp, database, redis }`
- Status `ok` = healthy, `degraded` = one component down

---

## Backups

### PostgreSQL

```bash
docker compose exec postgres pg_dump -U bugradar bugradar > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
cat backup.sql | docker compose exec -T postgres psql -U bugradar bugradar
```

### Automated backup cron

```bash
# Add to crontab (daily at 2 AM)
0 2 * * * docker compose exec -T postgres pg_dump -U bugradar bugradar | gzip > /backups/bugradar_$(date +\%Y\%m\%d).sql.gz
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
