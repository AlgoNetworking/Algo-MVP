let databaseService = null;

class ProductsConfig {
  constructor() {
    this.userProducts = new Map(); // userId -> products array
    this.loaded = new Set(); // Track which users have loaded products
  }

  async loadProducts(userId) {
    if (!userId) {
      console.warn('⚠️ ProductsConfig.loadProducts called without userId, using defaults');
      return this.getDefaultProducts();
    }

    try {
      // Lazy load database service to avoid circular dependency
      if (!databaseService) {
        databaseService = require('../services/database.service');
      }
      
      const products = await databaseService.getAllProducts(userId);
      this.userProducts.set(userId, products);
      this.loaded.add(userId);
      console.log(`✅ Loaded ${products.length} products for user ${userId}`);
      return products;
    } catch (error) {
      console.error(`❌ Error loading products for user ${userId}:`, error);
      // Fallback to default products
      const defaults = this.getDefaultProducts();
      this.userProducts.set(userId, defaults);
      this.loaded.add(userId);
      return defaults;
    }
  }

  getDefaultProducts() {
    return [
      { id: 1, name: 'abacaxi', akas: [], enabled: true },
      { id: 2, name: 'abacaxi com hortelã', akas: [], enabled: true },
      { id: 3, name: 'açaí', akas: [], enabled: true },
      { id: 4, name: 'acerola', akas: [], enabled: true },
      { id: 5, name: 'ameixa', akas: [], enabled: true },
      { id: 6, name: 'cajá', akas: [], enabled: true },
      { id: 7, name: 'caju', akas: [], enabled: true },
      { id: 8, name: 'goiaba', akas: [], enabled: true },
      { id: 9, name: 'graviola', akas: [], enabled: true },
      { id: 10, name: 'manga', akas: [], enabled: true },
      { id: 11, name: 'maracujá', akas: [], enabled: true },
      { id: 12, name: 'morango', akas: [], enabled: true },
      { id: 13, name: 'seriguela', akas: [], enabled: true },
      { id: 14, name: 'tamarindo', akas: [], enabled: true },
      { id: 15, name: 'caixa de ovos', akas: ['ovo', 'ovos'], enabled: true },
      { id: 16, name: 'queijo', akas: [], enabled: true }
    ];
  }

  get PRODUCTS() {
    // This is a fallback - should not be used in multi-tenant context
    console.warn('⚠️ PRODUCTS getter called without userId - using defaults');
    return this.getDefaultProducts().map(product => 
      [product.name, product.akas || [], product.enabled]
    );
  }

  getUserProducts(userId) {
    if (!userId) {
      return this.PRODUCTS;
    }
    
    const products = this.userProducts.get(userId) || this.getDefaultProducts();
    return products.map(product => {
      if (Array.isArray(product)) {
        return product;
      } else {
        return [product.name, product.akas || [], product.enabled];
      }
    });
  }

  getEmptyProductsDb(userId = null) {
    const products = userId ? this.getUserProducts(userId) : this.PRODUCTS;
    return products.map(product => [product, 0]);
  }

  getProductByAka(akaName, userId = null) {
    const normalizedAka = this.normalizeText(akaName);
    const products = userId ? this.getUserProducts(userId) : this.PRODUCTS;

    for (const product of products) {
      const [mainName, akas, enabled] = product;

      if (!enabled) continue;

      if (this.normalizeText(mainName) === normalizedAka) {
        return { mainProduct: mainName, score: 100 };
      }

      if (akas && akas.length > 0) {
        for (const aka of akas) {
          if (this.normalizeText(aka) === normalizedAka) {
            return { mainProduct: mainName, score: 100 };
          }
        }
      }
    }

    return null;
  }

  getProductByAkaWithStatus(akaName, userId = null) {
    const normalizedAka = this.normalizeText(akaName);
    const products = userId ? this.getUserProducts(userId) : this.PRODUCTS;

    for (const product of products) {
      const [mainName, akas, enabled] = product;

      if (this.normalizeText(mainName) === normalizedAka) {
        return { mainProduct: mainName, score: 100, enabled };
      }

      if (akas && akas.length > 0) {
        for (const aka of akas) {
          if (this.normalizeText(aka) === normalizedAka) {
            return { mainProduct: mainName, score: 100, enabled };
          }
        }
      }
    }

    return null;
  }

  normalizeText(text) {
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  async refresh(userId) {
    if (userId) {
      await this.loadProducts(userId);
    }
  }

  clearUserCache(userId) {
    this.userProducts.delete(userId);
    this.loaded.delete(userId);
  }
}

module.exports = new ProductsConfig();