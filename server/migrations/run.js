const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function runMigrations() {
  const client = await pool.connect();

  try {
    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const applied = await client.query('SELECT name FROM migrations ORDER BY id');
    const appliedNames = new Set(applied.rows.map(r => r.name));

    // Find migration files
    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.match(/^\d+_.*\.js$/))
      .sort();

    let ran = 0;

    for (const file of files) {
      if (appliedNames.has(file)) {
        continue;
      }

      console.log(`Running migration: ${file}`);
      const migration = require(path.join(migrationsDir, file));

      if (migration.up) {
        await client.query('BEGIN');
        try {
          await migration.up(client);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Applied: ${file}`);
          ran++;
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Failed: ${file}`, err);
          throw err;
        }
      } else if (migration.runMigration) {
        await client.query('BEGIN');
        try {
          await migration.runMigration();
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Applied: ${file}`);
          ran++;
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Failed: ${file}`, err);
          throw err;
        }
      }
    }

    if (ran === 0) {
      console.log('No new migrations to run');
    } else {
      console.log(`Applied ${ran} migration(s)`);
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations complete');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
