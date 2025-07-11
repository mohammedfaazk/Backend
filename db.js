const { Pool, Client } = require('pg');

// Database configuration with fallback options
const dbConfig = {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'postgres',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT) || 5432,
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
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
pool.on('connect', (client) => {
  console.log('✅ New client connected to database');
});

pool.on('acquire', (client) => {
  console.log('🔄 Client acquired from pool');
});

pool.on('error', (err, client) => {
  console.error('❌ Database pool error:', err);
});

pool.on('remove', (client) => {
  console.log('🗑️  Client removed from pool');
});

// Test database connection function
const testConnection = async () => {
  let client;
  try {
    console.log('🔍 Testing database connection...');
    console.log('   Host:', process.env.PGHOST);
    console.log('   Port:', process.env.PGPORT);
    console.log('   Database:', process.env.PGDATABASE);
    console.log('   User:', process.env.PGUSER);
    
    // Test with pool
    client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    
    console.log('✅ Database connection successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   Database version:', result.rows[0].db_version.split(' ')[0]);
    
    client.release();
    return true;
    
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Error code:', err.code);
    console.error('   Error details:', err.detail || 'No additional details');
    
    if (client) {
      client.release();
    }
    
    // Try with direct client connection
    console.log('🔄 Trying direct client connection...');
    return await testDirectConnection();
  }
};

// Test direct connection as fallback
const testDirectConnection = async () => {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Direct connection successful!');
    console.log('   Current time:', result.rows[0].current_time);
    await client.end();
    return true;
    
  } catch (err) {
    console.error('❌ Direct connection also failed:', err.message);
    try {
      await client.end();
    } catch (endErr) {
      // Ignore end errors
    }
    return false;
  }
};

// Safe query function with error handling
const safeQuery = async (text, params = []) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(text, params);
    client.release();
    return { success: true, data: result };
  } catch (err) {
    if (client) {
      client.release();
    }
    console.error('❌ Query error:', err.message);
    return { success: false, error: err.message };
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
  console.log('🛑 Received SIGINT, closing database pool...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing database pool...');
  await closePool();
  process.exit(0);
});

module.exports = {
  pool,
  testConnection,
  safeQuery,
  closePool
};