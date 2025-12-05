const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get all products
router.get('/', async (req, res) => {
  try {
    const products = await databaseService.getAllProducts(req.userId);
    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add new product
router.post('/', async (req, res) => {
  try {
    const { name, akas = [], enabled = true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required'
      });
    }

    await databaseService.addProduct(req.userId, {
      name,
      akas: Array.isArray(akas) ? akas : [akas],
      enabled
    });

    res.json({
      success: true,
      message: 'Product added successfully'
    });
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update product
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, akas, enabled } = req.body;

    await databaseService.updateProduct(req.userId, id, {
      name,
      akas: Array.isArray(akas) ? akas : [akas],
      enabled
    });

    res.json({
      success: true,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete product
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await databaseService.deleteProduct(req.userId, id);
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle product enabled status
router.put('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Enabled status is required'
      });
    }

    await databaseService.toggleProductEnabled(req.userId, id, enabled);

    res.json({
      success: true,
      message: 'Product status updated'
    });
  } catch (error) {
    console.error('Error toggling product:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;