const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get current user's config
router.get('/', async (req, res) => {
  try {
    const dbService = require('../services/database.service');
    const config = await dbService.getUserConfig(req.userId);
    res.json({ success: true, config: config || { callByName: true } });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save (replace) current user's config
router.post('/', async (req, res) => {
  try {
    const config = req.body && req.body.config ? req.body.config : {};
    await databaseService.saveUserConfig(req.userId, config);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;