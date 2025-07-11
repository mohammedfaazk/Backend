const { Pool, Client } = require('pg');
require('dotenv').config();

// Database configuration with fallback options
const dbConfig = {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'postgres',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT) || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false,
    require: true 
  } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Create connection pool
const pool = new Pool(dbConfig);

// Connection event handlers
pool.on('connect', () => {
  console.log('✅ New client connected to database');
});

pool.on('acquire', () => {
  console.log('🔄 Client acquired from pool');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
});

pool.on('remove', () => {
  console.log('🗑️ Client removed from pool');
});

// Test database connection function
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    console.log('✅ Database connection successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   Database version:', result.rows[0].db_version.split(' ')[0]);
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  } finally {
    if (client) client.release();
  }
};

// Safe query function with error handling
const safeQuery = async (text, params = []) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(text, params);
    return { success: true, data: result };
  } catch (err) {
    console.error('❌ Query error:', err.message);
    return { success: false, error: err.message };
  } finally {
    if (client) client.release();
  }
};

// Graceful shutdown
const closePool = async () => {
  try {
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (err) {
    console.error('❌ Error closing pool:', err);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closePool();
  process.exit(0);
});

module.exports = {
  pool,
  testConnection,
  safeQuery,
  closePool
};