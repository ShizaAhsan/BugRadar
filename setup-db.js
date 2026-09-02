const { Client } = require('pg');

async function setup() {
  const admin = new Client({
    host: 'localhost', port: 5432,
    user: 'postgres', password: 'postgres',
    database: 'postgres'
  });
  await admin.connect();

  try {
    await admin.query("CREATE USER bugradar WITH PASSWORD 'bugradar_secret'");
    console.log('User created');
  } catch (e) {
    console.log('User:', e.code === '42710' ? 'already exists' : e.message);
  }

  try {
    await admin.query('CREATE DATABASE bugradar OWNER bugradar');
    console.log('Database created');
  } catch (e) {
    console.log('Database:', e.code === '42P04' ? 'already exists' : e.message);
  }

  await admin.end();
  console.log('Setup complete');
}

setup().catch(e => { console.error(e); process.exit(1); });
