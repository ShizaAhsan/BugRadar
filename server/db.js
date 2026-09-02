const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  ...config.database,
  max: config.database.max || 20,
  idleTimeoutMillis: config.database.idleTimeoutMillis || 30000,
  connectionTimeoutMillis: config.database.connectionTimeoutMillis || 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
