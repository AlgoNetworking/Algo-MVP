const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');

// Connect WhatsApp
router.post('/connect', async (req, res) => {
  try {
    const { users } = req.body;

    // Users should already be filtered by folder from frontend
    // Pass userId to WhatsApp service
    const result = await whatsappService.connect(users, req.userId);
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
    await whatsappService.disconnect();
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
    whatsappService.sendBulkMessages(users)
      .then(results => {
        console.log('Bulk messages completed:', results);
      })
      .catch(error => {
        console.error('Bulk messages error:', error);
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

// Get sending status
router.get('/sending-status', (req, res) => {
  try {
    const status = whatsappService.getSendingStatus();
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
      isConnected: whatsappService.isConnected(),
      sessions: whatsappService.getActiveSessions()
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