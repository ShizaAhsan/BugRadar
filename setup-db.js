require('dotenv').config();
const { Client } = require('pg');

async function setup() {
  // Admin credentials come from the environment (D6) — defaults match a local
  // development install
  const admin = new Client({
    host: process.env.DB_ADMIN_HOST || 'localhost',
    port: parseInt(process.env.DB_ADMIN_PORT || '5432', 10),
    user: process.env.DB_ADMIN_USER || 'postgres',
    password: process.env.DB_ADMIN_PASSWORD || 'postgres',
    database: 'postgres'
  });
  await admin.connect();

  const appUser = process.env.DB_USER || 'bugradar';
  const appPassword = process.env.DB_PASSWORD || 'bugradar_secret';
  const appName = process.env.DB_NAME || 'bugradar';
  const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const literal = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  try {
    await admin.query(`CREATE USER ${ident(appUser)} WITH PASSWORD ${literal(appPassword)}`);
    console.log('User created');
  } catch (e) {
    console.log('User:', e.code === '42710' ? 'already exists' : e.message);
  }

  try {
    await admin.query(`CREATE DATABASE ${ident(appName)} OWNER ${ident(appUser)}`);
    console.log('Database created');
  } catch (e) {
    console.log('Database:', e.code === '42P04' ? 'already exists' : e.message);
  }

  await admin.end();
  console.log('Setup complete');
}

setup().catch(e => { console.error(e); process.exit(1); });
