const express = require('express');
const router = express.Router();
const authService = require('../auth/auth.service');

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const result = await authService.register(username, password, email);

    if (result.success) {
      // Set session
      req.session.userId = result.user.id;
      req.session.user = result.user;
      
      res.json({
        success: true,
        user: result.user
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const result = await authService.login(username, password);

    if (result.success) {
      // Set session
      req.session.userId = result.user.id;
      req.session.user = result.user;
      
      res.json({
        success: true,
        user: result.user
      });
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
    
    res.clearCookie('connect.sid');
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

// Check auth status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session.userId,
    user: req.session.user
  });
});

module.exports = router;