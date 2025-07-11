console.log('Debug module path:', require.resolve('debug')); // Debugging line

require('dotenv').config();
const express = require('express');
const debug = require('debug')('server');

const app = express();
const port = process.env.PORT || 3000;

// Basic middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  debug('Received request for /');
  res.json({ 
    status: 'running',
    message: 'API is working!',
    debug: typeof debug
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString() 
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  debug(`Server started on port ${port}`);
});