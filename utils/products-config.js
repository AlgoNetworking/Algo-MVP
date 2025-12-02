module.exports = {
  PRODUCTS: [
    ['abacaxi',[],true], ['abacaxi com hortelã',[], true], ['açaí',[], true], ['acerola',[], true],
    ['ameixa',[], true], ['cajá',[], true], ['caju',[], true], ['goiaba',[], true], ['graviola',[], true],
    ['manga',[], true], ['maracujá',[], true], ['morango',[], true], ['seriguela',[], true], ['tamarindo',[], true],
    ['caixa de ovos',['ovo', 'ovos'], true], ['queijo',[], true]
  ],
  
  getEmptyProductsDb() {
    return this.PRODUCTS.map(product => [product, 0]);
  }
};