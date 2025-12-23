const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get all notifications for user
router.get('/', async (req, res) => {
  try {
    const notifications = await databaseService.getUserNotifications(req.userId);
    res.json({
      success: true,
      notifications: notifications.map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.is_read,
        createdAt: notification.created_at
      }))
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get unread count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await databaseService.getUnreadNotificationsCount(req.userId);
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await databaseService.markNotificationAsRead(req.userId, id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mark all notifications as read
router.put('/read-all', async (req, res) => {
  try {
    await databaseService.markAllNotificationsAsRead(req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear all notifications (delete)
router.delete('/', async (req, res) => {
  try {
    const deletedCount = await databaseService.clearAllNotifications(req.userId);
    res.json({
      success: true,
      message: `Cleared ${deletedCount} notifications`,
      deletedCount
    });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Create a notification (for testing or other services)
router.post('/', async (req, res) => {
  try {
    const { type, title, message } = req.body;
    
    if (!type || !title) {
      return res.status(400).json({
        success: false,
        message: 'Type and title are required'
      });
    }
    
    const notification = await databaseService.createNotification(
      req.userId,
      type,
      title,
      message
    );
    
    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;