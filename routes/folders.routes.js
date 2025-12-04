// routes/folders.routes.js - Updated with multi-tenancy
const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get all folders for the authenticated user
router.get('/', async (req, res) => {
  try {
    const folders = await databaseService.getAllFolders(req.userId);
    res.json({
      success: true,
      folders
    });
  } catch (error) {
    console.error('Error getting folders:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get folder by ID (only if it belongs to the user)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await databaseService.getFolderById(id, req.userId);
    
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }
    
    res.json({
      success: true,
      folder
    });
  } catch (error) {
    console.error('Error getting folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create folder for the authenticated user
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Folder name is required'
      });
    }

    const folder = await databaseService.createFolder(name.trim(), req.userId);

    res.json({
      success: true,
      folder,
      message: 'Folder created successfully'
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update folder (only if it belongs to the user)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Folder name is required'
      });
    }

    const folder = await databaseService.updateFolder(id, name.trim(), req.userId);

    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    res.json({
      success: true,
      folder,
      message: 'Folder updated successfully'
    });
  } catch (error) {
    console.error('Error updating folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete folder (only if it belongs to the user)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await databaseService.deleteFolder(id, req.userId);
    
    res.json({
      success: true,
      message: 'Folder deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

// NOTE: Apply the same pattern to ALL route files:
// - clients.routes.js: Pass req.userId to all database calls
// - products.routes.js: Pass req.userId to all database calls  
// - orders.routes.js: Pass req.userId to all database calls
// This ensures data isolation between users (multi-tenancy)