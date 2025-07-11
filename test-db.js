// Test database connection independently
require('dotenv').config();

const { Client } = require('pg');

async function testDatabaseConnection() {
  console.log('🔍 Testing Database Connection...');
  console.log('');
  
  // Display connection info
  console.log('Connection Details:');
  console.log('   Host:', process.env.PGHOST);
  console.log('   Port:', process.env.PGPORT);
  console.log('   Database:', process.env.PGDATABASE);
  console.log('   User:', process.env.PGUSER);
  console.log('   Password:', process.env.PGPASSWORD ? '***' : 'Not set');
  console.log('');

  const client = new Client({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT) || 5432,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 30000,
  });

  try {
    console.log('⏳ Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    console.log('⏳ Running test query...');
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    console.log('✅ Query successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   Database version:', result.rows[0].version.split(' ')[0]);
    
    console.log('⏳ Testing table creation...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Table creation successful!');
    
    console.log('⏳ Testing data insertion...');
    await client.query(
      'INSERT INTO test_table (name) VALUES ($1) ON CONFLICT DO NOTHING',
      ['Test Entry']
    );
    console.log('✅ Data insertion successful!');
    
    console.log('⏳ Testing data retrieval...');
    const testData = await client.query('SELECT * FROM test_table LIMIT 5');
    console.log('✅ Data retrieval successful!');
    console.log('   Rows found:', testData.rows.length);
    
    console.log('⏳ Cleaning up test table...');
    await client.query('DROP TABLE IF EXISTS test_table');
    console.log('✅ Cleanup successful!');
    
    console.log('');
    console.log('🎉 All database tests passed!');
    
  } catch (error) {
    console.error('❌ Database test failed:');
    console.error('   Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Detail:', error.detail);
    console.error('   Hint:', error.hint);
    console.error('');
    
    // Additional debugging
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Connection refused - possible causes:');
      console.log('   - Database server is not running');
      console.log('   - Wrong host or port');
      console.log('   - Firewall blocking connection');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 Host not found - possible causes:');
      console.log('   - DNS resolution failed');
      console.log('   - Wrong hostname');
      console.log('   - Network connectivity issues');
    } else if (error.code === 'ECONNRESET') {
      console.log('💡 Connection reset - possible causes:');
      console.log('   - SSL/TLS handshake failed');
      console.log('   - Server closed connection');
      console.log('   - Network instability');
    }
    
    process.exit(1);
  } finally {
    try {
      await client.end();
      console.log('✅ Database connection closed');
    } catch (endError) {
      console.error('❌ Error closing connection:', endError.message);
    }
  }
}

testDatabaseConnection();