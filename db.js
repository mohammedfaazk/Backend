const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'auth_demo',
  password: process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.PGPORT) || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false,
    require: true 
  } : false,
};

const pool = new Pool(dbConfig);

// Test database connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected successfully');
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  }
};

// Safe query execution
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

module.exports = { pool, testConnection, safeQuery };