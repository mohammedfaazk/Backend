require('dotenv').config();
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Simple test route
app.get('/', (req, res) => {
  res.send('API is working!');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});