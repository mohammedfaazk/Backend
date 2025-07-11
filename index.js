// Verify critical modules are present
try {
  require.resolve('express/lib/router');
  console.log('Express router found at:', require.resolve('express/lib/router'));
} catch (err) {
  console.error('Express router missing!', err);
  process.exit(1);
}

require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Minimal middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'API is fully operational',
    modules: {
      express: require.resolve('express'),
      router: require.resolve('express/lib/router'),
      debug: require.resolve('debug')
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server successfully running on port ${port}`);
  console.log('Express router location:', require.resolve('express/lib/router'));
});