module.exports = {
  PRODUCTS: [
    'abacaxi', 'abacaxi com hortelã', 'açaí', 'acerola',
    'ameixa', 'cajá', 'cajú', 'goiaba', 'graviola',
    'manga', 'maracujá', 'morango', 'seriguela', 'tamarindo',
    'caixa de ovos', 'ovo', 'queijo'
  ],
  
  getEmptyProductsDb() {
    return this.PRODUCTS.map(product => [product, 0]);
  }
};