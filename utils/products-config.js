// utils/products-config.js
let databaseService = null;

class ProductsConfig {
  constructor() {
    console.log('📦 ProductsConfig initialized for multi-tenant');
  }

  // No longer needed - we'll fetch directly from database
  async loadProducts() {
    console.log('⚠️ loadProducts() is deprecated in multi-tenant mode');
    return [];
  }

  // New method to get user-specific products
  async getUserProductsDb(userId) {
    try {
      if (!databaseService) {
        databaseService = require('../services/database.service');
      }
      
      const products = await databaseService.getAllProducts(userId);
      console.log(`📦 Loaded ${products.length} products for user ${userId}`);
      
      // Convert to format expected by order-parser
      return products.map(product => [
        product.name,
        product.akas || [],
        // ensure price is present (null when absent) and enabled is boolean
        product.price === undefined ? null : product.price,
        !!product.enabled
      ]);
    } catch (error) {
      console.error('❌ Error loading user products:', error);
      // Return empty array instead of default products
      return [];
    }
  }

  // New method to get empty products db for a user
  async getUserEmptyProductsDb(userId) {
    const productsDb = await this.getUserProductsDb(userId);
    return productsDb.map(product => [product, 0]);
  }

  // For backward compatibility - but won't work well in multi-tenant
  get PRODUCTS() {
    console.warn('⚠️ Using deprecated PRODUCTS getter in multi-tenant mode');
    return [];
  }

  getEmptyProductsDb() {
    console.warn('⚠️ Using deprecated getEmptyProductsDb() in multi-tenant mode');
    return [];
  }
}

module.exports = new ProductsConfig();