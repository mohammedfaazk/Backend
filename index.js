// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, testConnection, safeQuery, closePool } = require('./db');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// JWT Secret - make sure to set this in your environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

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
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      );
     
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
      CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
     
      -- Create trigger to automatically update updated_at
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
     
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `;

    const result = await safeQuery(createTableQuery);
   
    if (result.success) {
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

// User Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const { name, email, password } = req.body;
   
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
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

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await safeQuery(
      'SELECT id FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (existingUser.success && existingUser.data.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const result = await safeQuery(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name.trim(), email.trim().toLowerCase(), passwordHash]
    );

    if (result.success) {
      const user = result.data.rows[0];
     
      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            created_at: user.created_at
          },
          token
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to create user',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during signup',
      error: error.message
    });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const { email, password } = req.body;
   
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const result = await safeQuery(
      'SELECT id, name, email, password_hash, is_active FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (!result.success || result.data.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.data.rows[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
   
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await safeQuery(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        },
        token
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login',
      error: error.message
    });
  }
});

// Get current user profile (protected route)
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const result = await safeQuery(
      'SELECT id, name, email, created_at, last_login FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.success && result.data.rows.length > 0) {
      res.json({
        success: true,
        data: result.data.rows[0],
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
});

// Logout (client-side should remove token, but we can blacklist if needed)
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful. Please remove the token from client.',
    timestamp: new Date().toISOString()
  });
});

// Get all users (protected route)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const result = await safeQuery(
      'SELECT id, name, email, created_at, last_login FROM users WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 100'
    );
   
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

// Get user by ID (protected route)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
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
      'SELECT id, name, email, created_at, last_login FROM users WHERE id = $1 AND is_active = TRUE',
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
    console.log('   JWT_SECRET:', JWT_SECRET ? '✅ Set' : '❌ Missing');
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
      console.log('⚠  Database connection failed after all retries');
      console.log('⚠  Server will start but database features will be limited');
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
      console.log(`   GET  /                    - Server status`);
      console.log(`   GET  /health              - Health check`);
      console.log(`   GET  /api/test-db         - Test database connection`);
      console.log(`   POST /api/setup           - Setup database tables`);
      console.log(`   POST /api/auth/signup     - User signup`);
      console.log(`   POST /api/auth/login      - User login`);
      console.log(`   GET  /api/auth/profile    - Get current user profile (protected)`);
      console.log(`   POST /api/auth/logout     - User logout (protected)`);
      console.log(`   GET  /api/users           - Get all users (protected)`);
      console.log(`   GET  /api/users/:id       - Get user by ID (protected)`);
      console.log('');
      console.log('🔐 Authentication:');
      console.log(`   - Include 'Authorization: Bearer <token>' header for protected routes`);
      console.log(`   - JWT tokens expire in: ${JWT_EXPIRES_IN}`);
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
