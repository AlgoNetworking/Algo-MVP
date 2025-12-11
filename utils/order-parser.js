// Portuguese number words and parsing logic
const units = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'zero': 0, 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'dos': 2, 'tres': 3, 'trÃªs': 3, 'treis': 3,
  'quatro': 4, 'quarto': 4, 'cinco': 5, 'cnico': 5, 'seis': 6, 'ses': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'nov': 9
};

const teens = {
  'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13, 'quatorze': 14, 'catorze': 14,
  'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19
};

const tens = {
  'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60,
  'setenta': 70, 'oitenta': 80, 'noventa': 90
};

const hundreds = {
  'cem': 100, 'cento': 100, 'duzentos': 200, 'trezentos': 300, 'quatrocentos': 400,
  'quinhentos': 500, 'seiscentos': 600, 'setecentos': 700, 'oitocentos': 800,
  'novecentos': 900
};

const allNumberWords = { ...units, ...teens, ...tens, ...hundreds };

function normalize(text) {
  return text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function similarityPercentage(a, b) {
  const normA = normalize(a);
  const normB = normalize(b);
  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  return maxLen === 0 ? 100.0 : (1 - distance / maxLen) * 100;
}

function parseNumberWords(tokens) {
  let total = 0;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (hundreds[token]) {
      total += hundreds[token];
      i++;
    } else if (tens[token]) {
      let val = tens[token];
      if (i + 1 < tokens.length && units[tokens[i + 1]]) {
        val += units[tokens[i + 1]];
        i += 2;
      } else {
        i++;
      }
      total += val;
    } else if (teens[token]) {
      total += teens[token];
      i++;
    } else if (units[token]) {
      total += units[token];
      i++;
    } else {
      i++;
    }
  }

  return total > 0 ? total : null;
}

function separateNumbersAndWords(text) {
  let result = text.toLowerCase();
  
  // Insert spaces between digits and letters
  result = result.replace(/(\d+)([a-zA-Z])/g, '$1 $2');
  result = result.replace(/([a-zA-Z])(\d+)/g, '$1 $2');

  // Protect compound teen numbers
  const protectedTeens = ['dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  protectedTeens.forEach(teen => {
    result = result.replace(new RegExp(teen, 'g'), ` ${teen} `);
  });

  // Process other number words
  const keys = Object.keys(allNumberWords).sort((a, b) => b.length - a.length);
  keys.forEach(word => {
    if (!protectedTeens.includes(word)) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      result = result.replace(regex, ` ${word} `);
    }
  });

  return result.replace(/\s+/g, ' ').trim();
}

function extractNumbersAndPositions(tokens) {
  const numbers = [];
  let i = 0;

  while (i < tokens.length) {
    if (/^\d+$/.test(tokens[i])) {
      numbers.push([i, parseInt(tokens[i])]);
      i++;
    } else if (allNumberWords[tokens[i]]) {
      const numTokens = [tokens[i]];
      let j = i + 1;

      while (j < tokens.length - 1) {
        if (tokens[j] === 'e' && allNumberWords[tokens[j + 1]]) {
          numTokens.push(tokens[j], tokens[j + 1]);
          j += 2;
        } else {
          break;
        }
      }

      const number = parseNumberWords(numTokens.filter(t => t !== 'e'));
      if (number) {
        numbers.push([i, number]);
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return numbers;
}

// CORRECTED: Assign each number to the closest product
function assignNumbersToProducts(productsWithPositions, numbersWithPositions) {
  const assignments = new Map(); // product index -> [quantity, number position]
  
  // Sort numbers by position (left to right)
  const sortedNumbers = [...numbersWithPositions].sort((a, b) => a[0] - b[0]);
  
  // For each number, find the closest unassigned product
  for (const [numPos, numVal] of sortedNumbers) {
    let closestProduct = null;
    let minDistance = Infinity;
    let closestProductIndex = -1;
    
    // Find the closest product to this number that doesn't already have a number
    for (const product of productsWithPositions) {
      if (assignments.has(product.productIndex)) continue;
      
      const distance = Math.abs(product.position - numPos);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestProduct = product;
        closestProductIndex = product.productIndex;
      } else if (distance === minDistance) {
        // If distances are equal, choose the leftmost product
        if (product.position < closestProduct.position) {
          closestProduct = product;
          closestProductIndex = product.productIndex;
        }
      }
    }
    
    if (closestProduct !== null) {
      assignments.set(closestProductIndex, [numVal, numPos]);
    }
    // If no product found, the number is ignored
  }
  
  // Assign default 1 to products without numbers
  for (const product of productsWithPositions) {
    if (!assignments.has(product.productIndex)) {
      assignments.set(product.productIndex, [1, null]);
    }
  }
  
  return assignments;
}

function buildAkaLookup(productsDb) {
  const akaLookup = new Map();

  productsDb.forEach(([product, _], index) => {
    const [mainName, akas, enabled] = product;

    // Always add to lookup, regardless of enabled status
    const normalizedMain = normalize(mainName);
    akaLookup.set(normalizedMain, { 
      mainProduct: mainName, 
      index, 
      score: 100, 
      enabled: enabled 
    });

    if (akas && akas.length > 0) {
      akas.forEach(aka => {
        const normalizedAka = normalize(aka);
        akaLookup.set(normalizedAka, { 
          mainProduct: mainName, 
          index, 
          score: 100, 
          enabled: enabled 
        });
      });
    }
  });

  return akaLookup;
}

// Process a single line with improved number assignment
function parseLine(line, productsDb, similarityThreshold, uncertainRange) {
  let normalized = normalize(line);
  normalized = separateNumbersAndWords(normalized);
  normalized = normalized.replace(/[,\.;\+\-\/\(\)\[\]\:]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const tokens = normalized.split(' ');
  const workingDb = productsDb.map(([product, qty]) => [product, qty]);
  const parsedOrders = [];
  const disabledProductsFound = [];

  const numbersWithPositions = extractNumbersAndPositions(tokens);

  const akaLookup = buildAkaLookup(productsDb);

  // Include ALL products for matching (both enabled and disabled)
  const sortedProducts = productsDb.map(([product, qty], index) => [product[0], product[1], product[2], qty, index])
    .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

  const normalizedProducts = sortedProducts.map(([product]) => normalize(product));
  const maxProdWords = Math.max(...productsDb.map(([p]) => p[0].split(' ').length));

  const productWords = new Set();
  productsDb.forEach(([product]) => {
    const [name, akas] = product;
    name.split(' ').forEach(word => productWords.add(normalize(word)));
    if (akas) {
      akas.forEach(aka => {
        aka.split(' ').forEach(word => productWords.add(normalize(word)));
      });
    }
  });

  // First pass - collect all products found in the message
  const productsFound = [];
  
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    const fillerWords = new Set(['quero', 'manda', 'amanha', 'cada', 'momento', 'amiga', 'amigo', 'cadas']);
    if ((fillerWords.has(token) && !productWords.has(token)) ||
      /^\d+$/.test(token) ||
      allNumberWords[token]) {
      i++;
      continue;
    }

    let matched = false;

    for (let size = Math.min(maxProdWords, 4); size > 0; size--) {
      if (i + size > tokens.length) continue;

      const phraseTokens = tokens.slice(i, i + size);

      let skipPhrase = true;
      // Check if any token is NOT a filler word or number
      for (const t of phraseTokens) {
        if (!/^\d+$/.test(t) && !allNumberWords[t] && !(fillerWords.has(t) && !productWords.has(t))) {
          skipPhrase = false;
          break;
        }
      }
      if (skipPhrase) continue;

      const phrase = phraseTokens.join(' ');
      const phraseNorm = normalize(phrase);

      const akaMatch = akaLookup.get(phraseNorm);

      if (akaMatch) {
        let originalIndex = -1;
        let productEnabled = true;
        for (let idx = 0; idx < productsDb.length; idx++) {
          if (productsDb[idx][0][0] === akaMatch.mainProduct) {
            originalIndex = idx;
            productEnabled = productsDb[idx][0][2]; // Get enabled status
            break;
          }
        }

        if (originalIndex !== -1) {
          productsFound.push({
            position: i,
            productIndex: originalIndex,
            productName: akaMatch.mainProduct,
            enabled: productEnabled,
            size: size
          });
          
          i += size;
          matched = true;
          break;
        }
      }

      // Find best match among ALL products
      let bestScore = 0;
      let bestProduct = null;
      let bestProductEnabled = true;
      let bestOriginalIdx = null;

      for (let idx = 0; idx < sortedProducts.length; idx++) {
        const [productName, _, enabled] = sortedProducts[idx];
        const prodNorm = normalize(productName);
        const score = similarityPercentage(phraseNorm, prodNorm);
        if (score > bestScore) {
          bestScore = score;
          bestProduct = productName;
          bestProductEnabled = enabled;
          bestOriginalIdx = sortedProducts[idx][4]; // Original index
        }
      }

      if (bestScore >= similarityThreshold) {
        productsFound.push({
          position: i,
          productIndex: bestOriginalIdx,
          productName: bestProduct,
          enabled: bestProductEnabled,
          size: size
        });
        
        i += size;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const phrase = tokens[i];
      let bestMatch = null;
      let bestScore = 0;
      let bestProductEnabled = true;
      let bestOriginalIdx = null;
      const phraseNorm = normalize(phrase);

      const singleWordAkaMatch = akaLookup.get(phraseNorm);
      if (singleWordAkaMatch) {
        for (let idx = 0; idx < productsDb.length; idx++) {
          if (productsDb[idx][0][0] === singleWordAkaMatch.mainProduct) {
            bestOriginalIdx = idx;
            bestMatch = singleWordAkaMatch.mainProduct;
            bestProductEnabled = productsDb[idx][0][2];
            bestScore = 100;
            break;
          }
        }
      } else {
        for (let idx = 0; idx < sortedProducts.length; idx++) {
          const [productName, _, enabled] = sortedProducts[idx];
          const score = similarityPercentage(phraseNorm, normalize(productName));
          if (score > bestScore) {
            bestScore = score;
            bestMatch = productName;
            bestProductEnabled = enabled;
            bestOriginalIdx = sortedProducts[idx][4];
          }
        }
      }

      if (bestMatch && bestScore > 50) {
        productsFound.push({
          position: i,
          productIndex: bestOriginalIdx,
          productName: bestMatch,
          enabled: bestProductEnabled,
          size: 1
        });
        
        matched = true;
      }
      i++;
    }
  }
  
  // Now assign numbers to products using the proper algorithm
  const numberAssignments = assignNumbersToProducts(productsFound, numbersWithPositions);
  
  // Process each found product with its assigned quantity
  for (const product of productsFound) {
    const [quantity, _] = numberAssignments.get(product.productIndex);
    
    if (!product.enabled) {
      disabledProductsFound.push({
        product: product.productName,
        qty: quantity
      });
    } else {
      // Add to workingDb
      workingDb[product.productIndex][1] += quantity;
      parsedOrders.push({
        productName: product.productName,
        qty: quantity,
        score: 100.0
      });
    }
  }

  return { parsedOrders, updatedDb: workingDb, disabledProductsFound };
}

// UPDATED: Main parse function that processes each line separately and accumulates
function parse(message, productsDb, similarityThreshold = 80, uncertainRange = [1, 80]) {
  // Split message by lines and filter out empty lines
  const lines = message.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  let allParsedOrders = [];
  let allDisabledProductsFound = [];
  
  // Start with the current database (which already has accumulated quantities from previous messages)
  let currentDb = productsDb.map(([product, qty]) => [product, qty]);
  
  // Process each line independently, accumulating results
  for (const line of lines) {
    const result = parseLine(line, currentDb, similarityThreshold, uncertainRange);
    
    // Merge results
    allParsedOrders = [...allParsedOrders, ...result.parsedOrders];
    allDisabledProductsFound = [...allDisabledProductsFound, ...result.disabledProductsFound];
    
    // Update the database for the next line (accumulating quantities)
    currentDb = result.updatedDb;
  }
  
  // IMPORTANT: Return the accumulated database, not a reset one
  return { 
    parsedOrders: allParsedOrders, 
    updatedDb: currentDb, 
    disabledProductsFound: allDisabledProductsFound 
  };
}

module.exports = {
  parse,
  normalize,
  similarityPercentage,
  buildAkaLookup
};