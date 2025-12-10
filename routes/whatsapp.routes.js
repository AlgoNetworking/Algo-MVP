const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');

// Connect WhatsApp
router.post('/connect', async (req, res) => {
  try {
    const { users } = req.body;

    // Users should already be filtered by folder from frontend
    const result = await whatsappService.connect(req.userId, users);
    res.json(result);
  } catch (error) {
    console.error('Error connecting WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Disconnect WhatsApp
router.post('/disconnect', async (req, res) => {
  try {
    await whatsappService.disconnect(req.userId);
    res.json({
      success: true,
      message: 'WhatsApp disconnected'
    });
  } catch (error) {
    console.error('Error disconnecting WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Send bulk messages
router.post('/send-bulk', async (req, res) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        message: 'Users array required'
      });
    }

    // Start bulk sending (async)
    whatsappService.sendBulkMessages(req.userId, users)
      .then(results => {
        console.log('Bulk messages completed for user', req.userId, ':', results);
      })
      .catch(error => {
        console.error('Bulk messages error for user', req.userId, ':', error);
      });

    res.json({
      success: true,
      message: 'Bulk message sending started'
    });

  } catch (error) {
    console.error('Error starting bulk messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/send-custom', async (req, res) => {
  try {
    const { users, message, ignoreInterpretation } = req.body;
    if (!users || !Array.isArray(users) || !message) {
      return res.status(400).json({ success: false, message: 'users array and message required' });
    }

    // Start async process
    whatsappService.sendCustomMessages(req.userId, users, message, !!ignoreInterpretation)
      .then(results => {
        console.log('Custom messages started for user', req.userId);
      })
      .catch(err => {
        console.error('Error sending custom messages for', req.userId, err);
      });

    res.json({ success: true, message: 'Custom message send started' });
  } catch (error) {
    console.error('Error in send-custom route:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/send-warning', async (req, res) => {
  try {
    const { users, warning, ignoreInterpretation } = req.body;
    if (!Array.isArray(users) || !warning) {
      return res.status(400).json({ success: false, message: 'users and warning required' });
    }
    whatsappService.sendWarningMessages(req.userId, users, warning, true /*always ignore*/ )
      .then(()=>{})
      .catch(err => console.error('send-warning error', err));
    res.json({ success: true, message: 'Send-warning started' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get sending status
router.get('/sending-status', (req, res) => {
  try {
    const status = whatsappService.getSendingStatus(req.userId);
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error getting sending status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get connection status
router.get('/status', (req, res) => {
  try {
    res.json({
      success: true,
      isConnected: whatsappService.isConnected(req.userId),
      sessions: whatsappService.getActiveSessions(req.userId)
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;