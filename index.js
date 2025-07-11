require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, testConnection, safeQuery, closePool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Global database connection status
let dbConnected = false;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'API is running',
    status: 'OK',
    database: dbConnected ? 'Connected' : 'Disconnected'
  });
});

app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date(),
    database: 'Checking...'
  };

  if (dbConnected) {
    const dbTest = await safeQuery('SELECT NOW() as current_time');
    healthCheck.database = dbTest.success ? 'Connected' : 'Error';
  } else {
    healthCheck.database = 'Disconnected';
  }

  res.json(healthCheck);
});

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if user exists
    const userExists = await safeQuery('SELECT id FROM users WHERE email = $1', [email]);
    if (userExists.success && userExists.data.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const newUser = await safeQuery(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );

    if (!newUser.success) {
      return res.status(500).json({ error: 'Failed to create user' });
    }

    // Generate token
    const token = jwt.sign(
      { id: newUser.data.rows[0].id, email: newUser.data.rows[0].email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      user: newUser.data.rows[0],
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user
    const userResult = await safeQuery(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (!userResult.success || userResult.data.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.data.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected Routes
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userResult = await safeQuery(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!userResult.success || userResult.data.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(userResult.data.rows[0]);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const startServer = async () => {
  try {
    // Test database connection
    dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.log('⚠️  Server starting without database connection');
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();