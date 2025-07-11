// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { pool, testConnection, safeQuery, closePool } = require('./db');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  closePool().then(() => process.exit(1));
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  closePool().then(() => process.exit(1));
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global database connection status
let dbConnected = false;

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Backend API is running successfully! 🚀',
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbConnected ? 'Connected' : 'Disconnected',
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage()
  });
});

// Health check route
app.get('/health', async (req, res) => {
  try {
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      database: 'Checking...'
    };

    // Quick database health check
    if (dbConnected) {
      const dbTest = await safeQuery('SELECT NOW() as current_time');
      healthData.database = dbTest.success ? 'Connected' : 'Error';
      if (dbTest.success) {
        healthData.database_time = dbTest.data.rows[0].current_time;
      }
    } else {
      healthData.database = 'Disconnected';
    }

    res.json(healthData);
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: error.message,
      timestamp: new Date().toISOString(),
      database: 'Error'
    });
  }
});

// Test database connection endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const isConnected = await testConnection();
    res.json({
      success: isConnected,
      message: isConnected ? 'Database connection successful' : 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing database connection',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Setup database table
app.post('/api/setup', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    `;

    const result = await safeQuery(createTableQuery);
    
    if (result.success) {
      // Insert sample data if table is empty
      const countResult = await safeQuery('SELECT COUNT(*) as count FROM users');
      if (countResult.success && countResult.data.rows[0].count === '0') {
        await safeQuery(
          'INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4)',
          ['John Doe', 'john@example.com', 'Jane Smith', 'jane@example.com']
        );
      }

      res.json({
        success: true,
        message: 'Database setup completed successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to setup database',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting up database',
      error: error.message
    });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const result = await safeQuery('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 100');
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data.rows,
        count: result.data.rows.length,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
});

// Create new user
app.post('/api/users', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const { name, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    const result = await safeQuery(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email, created_at',
      [name.trim(), email.trim().toLowerCase()]
    );

    if (result.success) {
      res.status(201).json({
        success: true,
        data: result.data.rows[0],
        message: 'User created successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      if (result.error.includes('unique constraint')) {
        res.status(409).json({
          success: false,
          message: 'Email already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to create user',
          error: result.error
        });
      }
    }
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid user ID is required'
      });
    }

    const result = await safeQuery(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [parseInt(id)]
    );

    if (result.success) {
      if (result.data.rows.length === 0) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
      } else {
        res.json({
          success: true,
          data: result.data.rows[0],
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Start server function
const startServer = async () => {
  try {
    console.log('🚀 Starting Backend API Server...');
    console.log('📊 Environment Check:');
    console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
    console.log('   PORT:', PORT);
    console.log('   PGHOST:', process.env.PGHOST ? '✅ Set' : '❌ Missing');
    console.log('   PGUSER:', process.env.PGUSER ? '✅ Set' : '❌ Missing');
    console.log('   PGDATABASE:', process.env.PGDATABASE ? '✅ Set' : '❌ Missing');
    console.log('   PGPORT:', process.env.PGPORT ? '✅ Set' : '❌ Missing');
    console.log('   PGPASSWORD:', process.env.PGPASSWORD ? '✅ Set' : '❌ Missing');

    // Test database connection with retries
    console.log('🔄 Testing database connection...');
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries && !dbConnected) {
      console.log(`   Attempt ${retryCount + 1}/${maxRetries}`);
      
      try {
        dbConnected = await testConnection();
        if (dbConnected) {
          console.log('✅ Database connection established successfully!');
          break;
        }
      } catch (err) {
        console.error(`   Connection attempt ${retryCount + 1} failed:`, err.message);
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        console.log('   Waiting 5 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (!dbConnected) {
      console.log('⚠️  Database connection failed after all retries');
      console.log('⚠️  Server will start but database features will be limited');
    }

    // Start the HTTP server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('🎉 Server Started Successfully!');
      console.log('📍 Server Details:');
      console.log(`   URL: http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Database: ${dbConnected ? '✅ Connected' : '❌ Disconnected'}`);
      console.log('');
      console.log('🔗 Available Endpoints:');
      console.log(`   GET  /              - Server status`);
      console.log(`   GET  /health        - Health check`);
      console.log(`   GET  /api/test-db   - Test database connection`);
      console.log(`   POST /api/setup     - Setup database tables`);
      console.log(`   GET  /api/users     - Get all users`);
      console.log(`   POST /api/users     - Create new user`);
      console.log(`   GET  /api/users/:id - Get user by ID`);
      console.log('');
    });

    // Handle server errors
    server.on('error', (err) => {
      console.error('❌ Server error:', err);
      process.exit(1);
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('🛑 Received shutdown signal, closing server...');
      server.close(async () => {
        await closePool();
        console.log('✅ Server closed gracefully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the application
startServer().catch(err => {
  console.error('❌ Startup error:', err);
  process.exit(1);
});