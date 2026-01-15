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
    const { name, akas = [], price = null, enabled = true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required'
      });
    }

    // Enforce price presence if user enabled global pricing (defaults to ON)
    const cfg = await databaseService.getUserConfig(req.userId);
    const productsHavePrice = cfg ? cfg.productsHavePrice : true;
    if (productsHavePrice) {
      if (price === undefined || price === null || String(price).trim() === '') {
        return res.status(400).json({ success: false, message: 'Price is required when "Products have price" is enabled.' });
      }
    }

    await databaseService.addProduct(req.userId, {
      name,
      akas: Array.isArray(akas) ? akas : [akas],
      price: price === undefined ? null : price,
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
    const { name, akas, price, enabled } = req.body;

    // Enforce price presence if user enabled global pricing (defaults to ON)
    const cfg = await databaseService.getUserConfig(req.userId);
    const productsHavePrice = cfg ? cfg.productsHavePrice : true;
    if (productsHavePrice) {
      if (price === undefined || price === null || String(price).trim() === '') {
        return res.status(400).json({ success: false, message: 'Price is required when "Products have price" is enabled.' });
      }
    }

    // Fetch existing product to preserve fields not in request
    const allProducts = await databaseService.getAllProducts(req.userId);
    const existing = allProducts.find(p => p.id === parseInt(id));
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    await databaseService.updateProduct(req.userId, id, {
      name: name !== undefined ? name : existing.name,
      akas: akas !== undefined ? (Array.isArray(akas) ? akas : [akas]) : existing.akas,
      price: price !== undefined ? price : existing.price,
      enabled: enabled !== undefined ? enabled : existing.enabled
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

    // If enabling product while prices are globally required, validate product has a price
    if (enabled === true) {
      const cfg = await databaseService.getUserConfig(req.userId);
      const productsHavePrice = cfg ? cfg.productsHavePrice : true;
      if (productsHavePrice) {
        const allProducts = await databaseService.getAllProducts(req.userId);
        const found = allProducts.find(p => String(p.id) === String(id));
        if (found && (found.price === null || found.price === undefined || String(found.price).trim() === '')) {
          return res.status(400).json({ success: false, message: 'Cannot enable product without price while "Products have price" is enabled.' });
        }
      }
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

module.exports = router;// Refresh
