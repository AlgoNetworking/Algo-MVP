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

// Tokenize preserving spaces as separate tokens
function tokenizeWithSpaces(text) {
  const tokens = [];
  const regex = /\S+|\s+/g; // Match non-whitespace OR whitespace
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      value: match[0],
      isWhitespace: /^\s+$/.test(match[0]),
      position: match.index,
      tokenIndex: tokens.length // Add a sequential index
    });
  }
  
  return tokens;
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

  // Process other number words - add spaces around them
  const keys = Object.keys(allNumberWords).sort((a, b) => b.length - a.length);
  keys.forEach(word => {
    if (!protectedTeens.includes(word)) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      result = result.replace(regex, ` ${word} `);
    }
  });

  return result;
}

function extractNumbersAndPositions(tokens) {
  const numbers = [];
  
  // Get only non-whitespace tokens for easier processing
  const nonWhitespaceTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].isWhitespace) {
      nonWhitespaceTokens.push({
        value: tokens[i].value,
        originalIndex: i,
        tokenIndex: tokens[i].tokenIndex
      });
    }
  }
  
  let i = 0;
  while (i < nonWhitespaceTokens.length) {
    const token = nonWhitespaceTokens[i];
    
    if (/^\d+$/.test(token.value)) {
      numbers.push([token.originalIndex, parseInt(token.value), token.tokenIndex]);
      i++;
    } else if (allNumberWords[token.value]) {
      const numTokens = [token.value];
      let j = i + 1;

      while (j < nonWhitespaceTokens.length - 1) {
        if (nonWhitespaceTokens[j].value === 'e' && 
            allNumberWords[nonWhitespaceTokens[j + 1].value]) {
          numTokens.push(nonWhitespaceTokens[j].value, nonWhitespaceTokens[j + 1].value);
          j += 2;
        } else {
          break;
        }
      }

      const number = parseNumberWords(numTokens.filter(t => t !== 'e'));
      if (number) {
        numbers.push([token.originalIndex, number, token.tokenIndex]);
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return numbers.map(([pos, val, tokenIndex]) => [pos, val, tokenIndex]);
}

// NEW: Calculate distance from number to product, considering multi-word products
function calculateDistanceToProduct(product, numberPos, tokens) {
  // For multi-word products, we need to find all tokens that belong to this product
  // and calculate the minimum distance to any of those tokens
  
  // First, let's find all token positions that belong to this product
  const productTokenPositions = [];
  
  // We know the product starts at product.position and has product.size non-whitespace tokens
  let nonWhitespaceCount = 0;
  let currentPos = product.position;
  
  while (nonWhitespaceCount < product.size && currentPos < tokens.length) {
    if (!tokens[currentPos].isWhitespace) {
      productTokenPositions.push(currentPos);
      nonWhitespaceCount++;
    }
    currentPos++;
  }
  
  if (productTokenPositions.length === 0) {
    // Fallback: just use the product's position
    return calculateSimpleDistance(product.position, numberPos, tokens);
  }
  
  // Calculate distance to each product token and take the minimum
  let minDistance = Infinity;
  
  for (const productTokenPos of productTokenPositions) {
    const distance = calculateSimpleDistance(productTokenPos, numberPos, tokens);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  
  return minDistance;
}

// Helper function: Calculate simple token distance between two positions
function calculateSimpleDistance(pos1, pos2, tokens) {
  // Count tokens between pos1 and pos2
  let distance = 0;
  const start = Math.min(pos1, pos2);
  const end = Math.max(pos1, pos2);
  
  for (let i = start + 1; i < end; i++) {
    if (tokens[i].isWhitespace) {
      // Count each space character as 1 unit
      distance += tokens[i].value.length;
    } else {
      // Count non-whitespace tokens as 1 unit
      distance += 1;
    }
  }
  
  // Add 1 for the step to the adjacent token
  return distance + 1;
}

// FIXED: Assign each number to the closest product mention (treating duplicates as separate)
function assignNumbersToProducts(productsWithPositions, numbersWithPositions, tokens) {
  // Create an array to store assignments for each product mention
  const assignments = new Array(productsWithPositions.length).fill(null);
  
  // Sort numbers by position (left to right)
  const sortedNumbers = [...numbersWithPositions].sort((a, b) => a[0] - b[0]);
  
  // Track which product mentions have been assigned a number
  const assignedProductIndices = new Set();
  
  // For each number, find the closest unassigned product mention
  for (const [numPos, numVal, numTokenIndex] of sortedNumbers) {
    let closestProductIndex = -1;
    let minDistance = Infinity;
    
    // Find the closest product mention to this number that hasn't already been assigned a number
    for (let i = 0; i < productsWithPositions.length; i++) {
      if (assignedProductIndices.has(i)) continue;
      
      const product = productsWithPositions[i];
      const distance = calculateDistanceToProduct(product, numPos, tokens);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestProductIndex = i;
      } else if (distance === minDistance) {
        // If distances are equal, choose the leftmost product
        if (closestProductIndex !== -1 && product.position < productsWithPositions[closestProductIndex].position) {
          closestProductIndex = i;
        }
      }
    }
    
    if (closestProductIndex !== -1) {
      assignments[closestProductIndex] = [numVal, numPos];
      assignedProductIndices.add(closestProductIndex);
    }
    // If no product found, the number is ignored
  }
  
  // Assign default 1 to product mentions without numbers
  for (let i = 0; i < productsWithPositions.length; i++) {
    if (assignments[i] === null) {
      assignments[i] = [1, null];
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
  
  // Tokenize preserving spaces
  const tokens = tokenizeWithSpaces(normalized);
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
    
    if (token.isWhitespace) {
      i++;
      continue;
    }

    const fillerWords = new Set(['quero', 'manda', 'amanha', 'cada', 'momento', 'amiga', 'amigo', 'cadas']);
    if ((fillerWords.has(token.value) && !productWords.has(normalize(token.value))) ||
      /^\d+$/.test(token.value) ||
      allNumberWords[token.value]) {
      i++;
      continue;
    }

    let matched = false;

    // Try to match multi-word products (from longest to shortest)
    for (let size = Math.min(maxProdWords, 4); size > 0; size--) {
      // We need to find a sequence of non-whitespace tokens that could form a product
      // But we need to allow for gaps (whitespace) between the words
      
      // Collect up to 'size' non-whitespace tokens starting from position i
      const candidateTokens = [];
      const candidatePositions = [];
      let currentPos = i;
      
      while (candidateTokens.length < size && currentPos < tokens.length) {
        if (!tokens[currentPos].isWhitespace) {
          candidateTokens.push(tokens[currentPos].value);
          candidatePositions.push(currentPos);
        }
        currentPos++;
      }
      
      if (candidateTokens.length < size) {
        continue; // Not enough tokens to form this size
      }
      
      // Now check if any token in our candidate is a filler word or number
      let skipPhrase = false;
      for (let j = 0; j < candidateTokens.length; j++) {
        const t = candidateTokens[j];
        if (/^\d+$/.test(t) || allNumberWords[t] || 
            (fillerWords.has(t) && !productWords.has(normalize(t)))) {
          skipPhrase = true;
          break;
        }
      }
      
      if (skipPhrase) continue;
      
      // Try the candidate as a phrase
      const phrase = candidateTokens.join(' ');
      const phraseNorm = normalize(phrase);

      // First check aka lookup
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
            position: candidatePositions[0], // First token position
            tokenIndex: tokens[candidatePositions[0]].tokenIndex,
            productIndex: originalIndex,
            productName: akaMatch.mainProduct,
            enabled: productEnabled,
            size: size
          });
          
          // Skip all the tokens we just matched
          i = candidatePositions[candidatePositions.length - 1] + 1;
          matched = true;
          break;
        }
      }

      // If no aka match, try similarity matching
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
          position: candidatePositions[0], // First token position
          tokenIndex: tokens[candidatePositions[0]].tokenIndex,
          productIndex: bestOriginalIdx,
          productName: bestProduct,
          enabled: bestProductEnabled,
          size: size
        });
        
        // Skip all the tokens we just matched
        i = candidatePositions[candidatePositions.length - 1] + 1;
        matched = true;
        break;
      }
    }

    // If no multi-word match, try single word
    if (!matched) {
      const phrase = token.value;
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
          tokenIndex: tokens[i].tokenIndex,
          productIndex: bestOriginalIdx,
          productName: bestMatch,
          enabled: bestProductEnabled,
          size: 1
        });
        
        matched = true;
        i++;
      } else {
        i++;
      }
    }
  }
  
  // Now assign numbers to products using the proper algorithm with space consideration
  const numberAssignments = assignNumbersToProducts(productsFound, numbersWithPositions, tokens);
  
  // Process each found product with its assigned quantity
  for (let i = 0; i < productsFound.length; i++) {
    const product = productsFound[i];
    const [quantity, _] = numberAssignments[i];
    
    if (!product.enabled) {
      disabledProductsFound.push({
        product: product.productName,
        qty: quantity
      });
    } else {
      // Add to workingDb - this will sum quantities for the same product
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