require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, testConnection, safeQuery } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-strong-secret-key-here';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());

// Debug Root Route
app.get('/', (req, res) => {
  res.send('✅ Backend is live and running!');
});

// Health Check
app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    status: 'OK',
    database: dbStatus ? 'Connected' : 'Disconnected',
    timestamp: new Date(),
  });
});

// JWT Auth Middleware
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

// Signup Route
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existingUser = await safeQuery('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.success && existingUser.data.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await safeQuery(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, hashedPassword]
    );

    if (!result.success) {
      return res.status(500).json({ error: 'User creation failed' });
    }

    const token = jwt.sign(
      { id: result.data.rows[0].id, email: result.data.rows[0].email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      success: true,
      message: 'Signup successful',
      data: {
        user: result.data.rows[0],
        token,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await safeQuery(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (!result.success || result.data.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.data.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: { id: user.id, name: user.name, email: user.email },
        token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected Route
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await safeQuery('SELECT id, name, email, created_at FROM users');
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    res.json({ success: true, data: result.data.rows });
  } catch (err) {
    console.error('Users fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start Server
const startServer = async () => {
  try {
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('❌ DB connection failed. Exiting...');
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
};

startServer();
