module.exports = {
  PRODUCTS: [
    ['abacaxi', [], true],
    ['abacaxi com hortelã', [], true],
    ['açaí', [], true],
    ['acerola', [], true],
    ['ameixa', [], true],
    ['cajá', [], true],
    ['caju', [], true],
    ['goiaba', [], true],
    ['graviola', [], true],
    ['manga', [], true],
    ['maracujá', [], true],
    ['morango', [], true],
    ['seriguela', [], true],
    ['tamarindo', [], true],
    ['caixa de ovos', ['ovo', 'ovos'], true],
    ['queijo', [], true]
  ],

  getEmptyProductsDb() {
    return this.PRODUCTS.map(product => [product, 0]);
  },

  getProductByAka(akaName) {
    const normalizedAka = this.normalizeText(akaName);

    for (const product of this.PRODUCTS) {
      const [mainName, akas] = product;

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
  },

  normalizeText(text) {
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
};