// routes/whatsapp.routes.js - UPDATED WITH PAUSE/RESUME/STOP ENDPOINTS
const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');

// Existing routes...
router.post('/connect', async (req, res) => {
  try {
    const { users } = req.body;
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

router.post('/send-bulk', async (req, res) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        message: 'Users array required'
      });
    }

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

router.post('/send-custom-bulk', async (req, res) => {
  try {
    const { users, message, media } = req.body;

    if (!users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        message: 'Users array required'
      });
    }

    if ((!message || message.trim() === '') && !media) {
      return res.status(400).json({
        success: false,
        message: 'Message text or media file required'
      });
    }

    if (media) {
      if (!media.data || !media.mimetype) {
        return res.status(400).json({
          success: false,
          message: 'Invalid media data'
        });
      }
      
      const MAX_SIZE = 50 * 1024 * 1024;
      const estimatedSize = (media.data.length * 3) / 4;
      
      if (estimatedSize > MAX_SIZE) {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds 50MB limit'
        });
      }
    }

    whatsappService.sendCustomBulkMessages(
      req.userId, 
      users, 
      message?.trim() || '', 
      media || null
    )
      .then(results => {
        console.log('Custom bulk messages completed for user', req.userId, ':', results);
      })
      .catch(error => {
        console.error('Custom bulk messages error for user', req.userId, ':', error);
      });

    res.json({
      success: true,
      message: 'Custom bulk message sending started'
    });

  } catch (error) {
    console.error('Error starting custom bulk messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Pause request messages
router.post('/pause-request-messages', (req, res) => {
  try {
    whatsappService.pauseRequestMessages(req.userId);
    res.json({
      success: true,
      message: 'Request messages paused'
    });
  } catch (error) {
    console.error('Error pausing request messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Resume request messages
router.post('/resume-request-messages', (req, res) => {
  try {
    whatsappService.resumeRequestMessages(req.userId);
    res.json({
      success: true,
      message: 'Request messages resumed'
    });
  } catch (error) {
    console.error('Error resuming request messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Stop request messages
router.post('/stop-request-messages', (req, res) => {
  try {
    whatsappService.stopRequestMessages(req.userId);
    res.json({
      success: true,
      message: 'Request messages stopped'
    });
  } catch (error) {
    console.error('Error stopping request messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Pause custom messages
router.post('/pause-custom-messages', (req, res) => {
  try {
    whatsappService.pauseCustomMessages(req.userId);
    res.json({
      success: true,
      message: 'Custom messages paused'
    });
  } catch (error) {
    console.error('Error pausing custom messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Resume custom messages
router.post('/resume-custom-messages', (req, res) => {
  try {
    whatsappService.resumeCustomMessages(req.userId);
    res.json({
      success: true,
      message: 'Custom messages resumed'
    });
  } catch (error) {
    console.error('Error resuming custom messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// NEW: Stop custom messages
router.post('/stop-custom-messages', (req, res) => {
  try {
    whatsappService.stopCustomMessages(req.userId);
    res.json({
      success: true,
      message: 'Custom messages stopped'
    });
  } catch (error) {
    console.error('Error stopping custom messages:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/sending-status', (req, res) => {
  try {
    const requestStatus = whatsappService.getRequestSendingStatus(req.userId);
    const customStatus = whatsappService.getCustomSendingStatus(req.userId);
    res.json({
      success: true,
      ...requestStatus,
      ...customStatus
    });
  } catch (error) {
    console.error('Error getting sending status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

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





router.get('/sessions-count/:userId', (req, res) => {
  const userId = req.params.userId;
  const svc = whatsappService;
  const sessions = svc.userSessions.get(userId);
  res.json({
    userId,
    sessionsCount: sessions ? sessions.size : 0,
    sessionsKeys: sessions ? Array.from(sessions.keys()) : []
  });
});

// POST create mock sessions quickly (no real WhatsApp calls) - helpful for quick tests
// body: { userId: "test-user-1", count: 5 }
router.post('/create-mock-sessions', (req, res) => {
  const { userId, count = 3 } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const svc = whatsappService;
  if (!svc.userSessions.has(userId)) svc.userSessions.set(userId, new Map());
  const map = svc.userSessions.get(userId);
  for (let i = 1; i <= count; i++) {
    map.set(`mock-client-${i}`, { mock: true, createdAt: Date.now() });
  }
  res.json({ ok: true, sessionsCount: map.size, sessionsKeys: Array.from(map.keys()) });
});

// POST simulate a Baileys disconnect event
// body: { userId: "test-user-1", kind: "auto-error"|"manual", statusCode: 428 }
router.post('/simulate-disconnect', async (req, res) => {
  try {
    const { userId, kind = 'auto-error', statusCode = 428 } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const svc = whatsappService;
    const sock = svc.sockets.get(userId);
    if (!sock) return res.status(404).json({ error: 'socket-not-found' });

    const eventPayload = {
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode } },
        status: 'disconnect',
      },
      isReconnecting: kind === 'auto-error',
    };

    if (sock.ev && typeof sock.ev.emit === 'function') {
      sock.ev.emit('connection.update', eventPayload);
    } else if (typeof sock.emit === 'function') {
      sock.emit('connection.update', eventPayload);
    } else {
      return res.status(500).json({ error: 'socket-has-no-emit' });
    }

    // If you have a manual-cleanup method, call it for kind === 'manual'
    if (kind === 'manual' && typeof svc.handleManualDisconnect === 'function') {
      try { svc.handleManualDisconnect(userId); } catch(e) { /* ignore */ }
    }

    res.json({ ok: true, injected: eventPayload });
  } catch (err) {
    console.error('simulate-disconnect error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;