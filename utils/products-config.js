// utils/products-config.js
let databaseService = null;

class ProductsConfig {
  constructor() {
    this.products = [];
    this.loaded = false;
  }

  async loadProducts() {
    try {
      // Lazy load database service to avoid circular dependency
      if (!databaseService) {
        databaseService = require('../services/database.service');
      }
      
      this.products = await databaseService.getAllProducts();
      this.loaded = true;
      console.log(`✅ Loaded ${this.products.length} products from database`);
    } catch (error) {
      console.error('❌ Error loading products:', error);
      // Fallback to default products
      this.products = this.getDefaultProducts();
      this.loaded = true;
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
    if (!this.loaded && this.products.length === 0) {
      this.products = this.getDefaultProducts();
      this.loaded = true;
    }
    return this.products.map(product => {
      if (Array.isArray(product)) {
        // For backward compatibility with old format
        return product;
      } else {
        // New format from database
        return [product.name, product.akas || [], product.enabled];
      }
    });
  }

  getEmptyProductsDb() {
    return this.PRODUCTS.map(product => {
      // product is [name, akas, enabled]
      return [product, 0];
    });
  }

  getProductByAka(akaName) {
    const normalizedAka = this.normalizeText(akaName);

    for (const product of this.PRODUCTS) {
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

  normalizeText(text) {
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  async refresh() {
    await this.loadProducts();
  }
}

module.exports = new ProductsConfig();