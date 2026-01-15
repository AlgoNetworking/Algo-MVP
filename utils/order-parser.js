// Portuguese number words and parsing logic
const units = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'zero': 0, 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'dos': 2, 'tres': 3, 'três': 3, 'treis': 3, 'trêis': 3,
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
  if (!text) return '';

  // 1) Normalize common NBSP / no-break-like spaces to plain space
  text = text.replace(/[\u00A0\u202F\u205F]/g, ' ');

  // 2) Remove invisible / directional / joiner characters (zero-width, bidi marks, BOM, word-joiner, etc.)
  text = text.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060\u2066-\u2069\u202A-\u202E]/g, '');

  // 3) Replace bullet-like / list glyphs with a single space so list bullets don't attach to words.
  // includes bullet, middle dot, triangular bullets and other common list characters.
  text = text.replace(/[\u2022\u2023\u2043\u2219\u25E6\u00B7·•‣]/g, ' ');

  // 4) Remove control chars that sometimes sneak in
  text = text.replace(/[\x00-\x1F\x7F]/g, '');

  // 5) Usual diacritic removal
  return text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove diacritics
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

// FIXED: Calculate distance to the START of multi-word products
// Connector words (de, kg, etc.) count as 1 unit each
function calculateDistanceToProduct(product, numberPos, tokens) {
  // Distance is calculated to the first token of the product
  const productStartPos = product.position;
  
  return calculateSimpleDistance(productStartPos, numberPos, tokens);
}

// Helper function: Calculate simple token distance between two positions
// Each non-whitespace token = 1 unit, each whitespace character = 1 unit
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

/**
 * ADDED: Preprocess products DB to support number-placeholder products and AKAs with numbers.
 * For products (main names) or their AKAs that contain a numeric token (ex: "garrafao 10 litros" or "garrafao de 10 litros"),
 * create a placeholder normalized key "garrafao {number} litros" (normalized) and map the number value
 * to the original product index. This allows matching "garrafao de 10 litros" in the input and knowing
 * which exact product index (10) it refers to. Also collects info about which AKA matched.
 */
function buildProductPatternMaps(productsDb) {
  // placeholderMap: placeholderNormalizedString -> Map<numberValue -> productIndex>
  const placeholderMap = new Map();
  // placeholderToProductInfo: placeholderNormalizedString -> info about a representative product (for metadata)
  const placeholderToProductInfo = new Map();

  productsDb.forEach(([product], index) => {
    const [mainName, akas, price, enabled] = product;
    // Process main name
    const normMain = normalize(mainName);
    const digitMatchMain = normMain.match(/(^|\s)(\d+)(\s|$)/);
    if (digitMatchMain) {
      const placeholder = normMain.replace(digitMatchMain[0].trim(), '{number}');
      const placeholderNorm = placeholder.replace(/\s+/g, ' ').trim();
      const numValue = parseInt(digitMatchMain[2], 10);
      if (!placeholderMap.has(placeholderNorm)) placeholderMap.set(placeholderNorm, new Map());
      placeholderMap.get(placeholderNorm).set(numValue, index);
      if (!placeholderToProductInfo.has(placeholderNorm)) {
        placeholderToProductInfo.set(placeholderNorm, {
          placeholder: placeholderNorm,
          exampleIndex: index,
          enabled
        });
      }
    }

    // ADDED: Process AKAs for numeric placeholders (ex: "garrafao de 10 litros")
    if (akas && akas.length > 0) {
      akas.forEach(aka => {
        const normAka = normalize(aka);
        const digitMatchAka = normAka.match(/(^|\s)(\d+)(\s|$)/);
        if (digitMatchAka) {
          const placeholderAka = normAka.replace(digitMatchAka[0].trim(), '{number}');
          const placeholderAkaNorm = placeholderAka.replace(/\s+/g, ' ').trim();
          const numValueAka = parseInt(digitMatchAka[2], 10);
          if (!placeholderMap.has(placeholderAkaNorm)) placeholderMap.set(placeholderAkaNorm, new Map());
          // Map the numeric value to the same product index (AKA -> official product)
          placeholderMap.get(placeholderAkaNorm).set(numValueAka, index);
          if (!placeholderToProductInfo.has(placeholderAkaNorm)) {
            placeholderToProductInfo.set(placeholderAkaNorm, {
              placeholder: placeholderAkaNorm,
              exampleIndex: index,
              enabled
            });
          }
        }
      });
    }
  });

  return { placeholderMap, placeholderToProductInfo };
}

function buildAkaLookup(productsDb) {
  const akaLookup = new Map();

  productsDb.forEach(([product, _], index) => {
    const [mainName, akas, price, enabled] = product;

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
        // Non-numeric AKAs are directly added so exact matches work as before
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

// FIXED: Check if token ranges overlap (for deduplication)
function rangesOverlap(start1, end1, start2, end2) {
  return start1 <= end2 && start2 <= end1;
}

// Process a single line with improved number assignment and numeric-product + AKA support
function parseLine(line, productsDb, similarityThreshold, uncertainRange) {
  let normalized = normalize(line);
  normalized = separateNumbersAndWords(normalized);
  normalized = normalized.replace(/[,\.;\+\-\/\(\)\[\]\:]/g, ' ');
  
  // Tokenize preserving spaces
  const tokens = tokenizeWithSpaces(normalized);
  const workingDb = productsDb.map(([product, qty]) => [product, qty]);
  const parsedOrders = [];
  const disabledProductsFound = [];

  let numbersWithPositions = extractNumbersAndPositions(tokens);

  const akaLookup = buildAkaLookup(productsDb);

  // ADDED: build placeholder maps for numeric-products (ex: "garrafao {number} litros")
  // This also includes AKAs with numbers (e.g. "garrafao de {number} litros").
  const { placeholderMap, placeholderToProductInfo } = buildProductPatternMaps(productsDb);

  // Include ALL products for matching (both enabled and disabled)
  const sortedProducts = productsDb.map(([product, qty], index) => {
    const [name, akas, price, enabled] = product;
    return [name, akas, price, enabled, qty, index];
  }).sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

  const normalizedProducts = sortedProducts.map(([product]) => normalize(product));
  let maxProdWords = 0;
  for (const [product] of productsDb) {
    const [mainName, akas] = product;
    maxProdWords = Math.max(maxProdWords, mainName.trim().split(/\s+/).length);
    if (akas && akas.length) {
      for (const aka of akas) {
        maxProdWords = Math.max(maxProdWords, aka.trim().split(/\s+/).length);
      }
    }
  }
  // fallback safety
  if (maxProdWords === 0) maxProdWords = 1;

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

  // Define connector/filler words that should be skipped but don't break matching
  const connectorWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'em', 'por', 'para', 'no', 'na', 'nos', 'nas']);
  const fillerWords = new Set(['quero', 'manda', 'amanha', 'mandar', 'cada', 'momento', 'amiga', 'amigo', 'cadas', 'segue', 'kg', 'kgs', 'kilo', 'kilos', 'quilos', 'quilo', '*', '•', '-']);

  // IMPROVED: Collect all possible matches, then deduplicate
  // This ensures we find "abacaxi com hortelã" even if "abacaxi" could also match
  const allPossibleMatches = [];
  
  // For each position, try to match products of all sizes
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.isWhitespace) continue;

    // ADDED: skip starting candidate windows on numeric tokens (digits or written-number words).
    // This prevents leading quantities (e.g. "3 abacaaxi com hortela") from being treated as
    // internal numeric tokens of a product candidate.
    const tokenNorm = normalize(token.value);
    if (/^\d+$/.test(token.value) || allNumberWords[tokenNorm]) {
      continue;
    }

    for (let size = Math.min(maxProdWords, 4); size > 0; size--) {
      const candidateTokens = [];
      const candidatePositions = [];
      const allPositions = []; // Track all positions including connectors/fillers
      const numericTokenInfos = []; // ADDED: store numeric token info inside candidate (originalIndex, value, tokenIndex)
      let currentPos = i;
      let nonConnectorCount = 0;
      
      while (nonConnectorCount < size && currentPos < tokens.length) {
        if (!tokens[currentPos].isWhitespace) {
          const t = tokens[currentPos].value;
          const normalizedT = normalize(t);
          
          if (/^\d+$/.test(t)) {
            // Determine the previous non-whitespace token index before currentPos
            let prevNonWs = null;
            for (let p = currentPos - 1; p >= 0; p--) {
              if (!tokens[p].isWhitespace) { prevNonWs = p; break; }
            }

            // If the previous meaningful token is NOT part of the candidate tokens,
            // don't treat it as internal.
            const prevIsPartOfCandidate = prevNonWs !== null && candidatePositions.includes(prevNonWs);
            if (!prevIsPartOfCandidate) {
              allPositions.push(currentPos);
              currentPos++;
              continue;
            }

            // LOOKAHEAD: determine whether this numeric token *looks like product-internal*
            let looksInternal = false;
            const lookaheadLimit = 3; // check up to 3 non-whitespace tokens after numeric
            let laIndex = currentPos + 1;
            let laNonWsSeen = 0;

            while (laIndex < tokens.length && laNonWsSeen < lookaheadLimit) {
              if (!tokens[laIndex].isWhitespace) {
                laNonWsSeen++;
                const laNorm = normalize(tokens[laIndex].value);
                if (!(/^\d+$/.test(tokens[laIndex].value) || allNumberWords[laNorm] || connectorWords.has(laNorm) || fillerWords.has(laNorm))) {
                  looksInternal = true;
                  break;
                }
              }
              laIndex++;
            }

            if (!looksInternal) {
              // Not followed by a meaningful product-token -> not internal
              allPositions.push(currentPos);
              currentPos++;
              continue;
            }

            // NEW: if the token AFTER this numeric *looks like it starts a product*, then
            // we should NOT treat the numeric as internal (it likely belongs to the next product).
            // Find the next non-whitespace token index after the numeric
            let nextNonWs = null;
            for (let n = currentPos + 1; n < tokens.length; n++) {
              if (!tokens[n].isWhitespace) { nextNonWs = n; break; }
            }

            let nextIsProductStart = false;
            if (nextNonWs !== null) {
              // Build a small phrase from nextNonWs up to maxProdWords tokens (skipping whitespace)
              const parts = [];
              let taken = 0;
              for (let p = nextNonWs; p < tokens.length && taken < maxProdWords; p++) {
                if (!tokens[p].isWhitespace) {
                  parts.push(normalize(tokens[p].value));
                  taken++;
                }
              }
              const candidateStartPhrase = parts.join(' ').trim();

              // 1) exact aka/product name quick check
              if (akaLookup.has(candidateStartPhrase)) {
                nextIsProductStart = true;
              } else {
                // 2) placeholder map check — replace numeric-like tokens with {number} (best-effort)
                const placeholderParts = parts.map(x => allNumberWords[x] !== undefined ? '{number}' : x);
                const placeholderPhrase = placeholderParts.join(' ').trim();
                if (placeholderMap.has(placeholderPhrase)) {
                  nextIsProductStart = true;
                } else {
                  // 3) similarity check against product names: if very similar -> treat as product start
                  for (let s = 0; s < normalizedProducts.length; s++) {
                    const prodNorm = normalizedProducts[s];
                    const score = similarityPercentage(candidateStartPhrase, prodNorm);
                    if (score >= similarityThreshold) {
                      nextIsProductStart = true;
                      break;
                    }
                  }
                }
              }
            }

            if (nextIsProductStart) {
              // The token after the number looks like the start of a product -> don't treat number as internal
              allPositions.push(currentPos);
              currentPos++;
              continue;
            }

            // If we reach here, numeric is adjacent, looks internal by lookahead, and the following token
            // is NOT likely a product start -> treat numeric as internal.
            candidateTokens.push(t);
            candidatePositions.push(currentPos);
            allPositions.push(currentPos);
            numericTokenInfos.push({ originalIndex: currentPos, value: parseInt(t, 10), tokenIndex: tokens[currentPos].tokenIndex });
            nonConnectorCount++;
            currentPos++;
            continue;
          }

          if (allNumberWords[normalizedT]) {
            candidateTokens.push(normalizedT);
            candidatePositions.push(currentPos);
            allPositions.push(currentPos);
            numericTokenInfos.push({ originalIndex: currentPos, value: null, tokenIndex: tokens[currentPos].tokenIndex, text: normalizedT });
            nonConnectorCount++;
            currentPos++;
            continue;
          }
          
          if ((connectorWords.has(normalizedT) || fillerWords.has(normalizedT)) && 
              !productWords.has(normalizedT)) {
            allPositions.push(currentPos);
            currentPos++;
            continue;
          }
          
          candidateTokens.push(t);
          candidatePositions.push(currentPos);
          allPositions.push(currentPos);
          nonConnectorCount++;
        }
        currentPos++;
      }
      
      if (candidateTokens.length < size) {
        continue; // Not enough tokens to form this size
      }

      const phrase = candidateTokens.join(' ');
      const phraseNorm = normalize(phrase);

      // ADDED: Build placeholder version where contiguous numeric tokens are replaced by {number}
      const placeholderParts = candidateTokens.map(tok => {
        if (/^\d+$/.test(tok)) return '{number}';
        const n = normalize(tok);
        if (allNumberWords[n]) return '{number}';
        return normalize(tok);
      });
      const phrasePlaceholderNorm = placeholderParts.join(' ').replace(/\s+/g, ' ').trim();

      // Try exact aka lookup first (non-placeholder)
      const akaMatch = akaLookup.get(phraseNorm);
      if (akaMatch) {
        let originalIndex = -1;
        let productEnabled = true;
        for (let idx = 0; idx < productsDb.length; idx++) {
          if (productsDb[idx][0][0] === akaMatch.mainProduct) {
            originalIndex = idx;
            productEnabled = productsDb[idx][0][3];
            break;
          }
        }

        if (originalIndex !== -1) {
          const startPos = candidatePositions[0];
          const endPos = allPositions[allPositions.length - 1];
          
          allPossibleMatches.push({
            position: startPos,
            endPosition: endPos,
            tokenIndex: tokens[startPos].tokenIndex,
            productIndex: originalIndex,
            productName: akaMatch.mainProduct,
            matchedAka: phraseNorm, // ADDED: note which AKA matched
            enabled: productEnabled,
            size: size,
            score: 100,
            numericTokenInfos // ADDED: attach numeric info if any
          });
        }
      } else {
        // ADDED: If phrase contains numbers (placeholder form different from raw), try placeholder exact match
        const containsNumberToken = numericTokenInfos.length > 0;
        if (containsNumberToken && placeholderMap.has(phrasePlaceholderNorm)) {
          // Detect numeric value present in the candidate (digit or textual)
          let detectedNumber = null;

          if (numericTokenInfos.length === 1) {
            const ni = numericTokenInfos[0];
            if (ni.value !== null) detectedNumber = ni.value;
            else if (ni.text && allNumberWords[ni.text] !== undefined) detectedNumber = allNumberWords[ni.text];
          } else {
            // Try to parse a combined textual/numeric token group (best-effort)
            const textualParts = [];
            for (const ni of numericTokenInfos) {
              if (ni.value !== null) textualParts.push(String(ni.value));
              else if (ni.text && allNumberWords[ni.text] !== undefined) textualParts.push(String(allNumberWords[ni.text]));
            }
            // If joined digits make sense as a single integer, try parse them:
            if (textualParts.length) {
              const joined = textualParts.join('');
              const maybe = parseInt(joined, 10);
              if (!Number.isNaN(maybe)) detectedNumber = maybe;
            }
          }

          const numToIndex = placeholderMap.get(phrasePlaceholderNorm) || new Map();

          // If we found a valid number mapping, accept the product.
          if (detectedNumber !== null && numToIndex.has(detectedNumber)) {
            const originalIndex = numToIndex.get(detectedNumber);
            const productEnabled = productsDb[originalIndex][0][3];
            const startPos = candidatePositions[0];
            const endPos = allPositions[allPositions.length - 1];
            allPossibleMatches.push({
              position: startPos,
              endPosition: endPos,
              tokenIndex: tokens[startPos].tokenIndex,
              productIndex: originalIndex,
              productName: productsDb[originalIndex][0][0],
              matchedAka: phrasePlaceholderNorm,
              enabled: productEnabled,
              size: size,
              score: 100,
              numericTokenInfos,
              numericValue: detectedNumber
            });
            continue; // candidate handled
          }

          // IMPORTANT: placeholder exists but the number is missing/invalid.
          // DO NOT fall back to similarity matching — skip this candidate entirely.
          // (This prevents "garrafao 30 litros" from matching "garrafao 10 litros".)
          continue;
        }

        // Try similarity matching (non-placeholder only)
        let bestScore = 0;
        let bestProduct = null;
        let bestProductEnabled = true;
        let bestOriginalIdx = null;

        for (let idx = 0; idx < sortedProducts.length; idx++) {
          const [productName, akas, price, enabled, qty, originalIdx] = sortedProducts[idx];
          const prodNorm = normalize(productName);
          const score = similarityPercentage(phraseNorm, prodNorm);
          if (score > bestScore) {
            bestScore = score;
            bestProduct = productName;
            bestProductEnabled = enabled;  // Now correctly using enabled status
            bestOriginalIdx = originalIdx; // Now using the correct index
          }
        }

        if (bestScore >= similarityThreshold) {
          const startPos = candidatePositions[0];
          const endPos = allPositions[allPositions.length - 1];
          
          allPossibleMatches.push({
            position: startPos,
            endPosition: endPos,
            tokenIndex: tokens[startPos].tokenIndex,
            productIndex: bestOriginalIdx,
            productName: bestProduct,
            enabled: bestProductEnabled,
            size: size,
            score: bestScore,
            numericTokenInfos: numericTokenInfos.length ? numericTokenInfos : undefined
          });
        }
      }
    }
  }
  
  // CHANGED: Prefer longer (multi-word) matches by boosting score with size multiplier.
  // This prevents a short single-word match from blocking a multi-word match that is
  // slightly worse in raw Levenshtein score but covers more tokens.
  allPossibleMatches.sort((a, b) => {
    const aBoosted = (a.score || 0) + (a.size || 0) * 10;
    const bBoosted = (b.score || 0) + (b.size || 0) * 10;
    if (bBoosted !== aBoosted) return bBoosted - aBoosted;
    if (b.score !== a.score) return b.score - a.score;
    if (b.size !== a.size) return b.size - a.size;
    return a.position - b.position;
  });
  
  const productsFound = [];
  for (const match of allPossibleMatches) {
    // Check if this match overlaps with any already accepted match
    let overlaps = false;
    for (const accepted of productsFound) {
      if (rangesOverlap(match.position, match.endPosition, accepted.position, accepted.endPosition)) {
        overlaps = true;
        break;
      }
    }
    
    if (!overlaps) {
      productsFound.push(match);
    }
  }
  
  // Sort by position for number assignment
  productsFound.sort((a, b) => a.position - b.position);

  // ADDED: Remove numbers that are *part of a matched product name* from numbersWithPositions
  if (numbersWithPositions.length > 0) {
    const filteredNumbers = [];
    for (const numEntry of numbersWithPositions) {
      const [numPos, numVal, numTokenIndex] = numEntry;
      let isInternal = false;
      for (const p of productsFound) {
        if (p.numericTokenInfos && p.numericTokenInfos.length > 0) {
          for (const ni of p.numericTokenInfos) {
            if (ni.originalIndex === numPos) {
              isInternal = true;
              break;
            }
          }
        }
        if (isInternal) break;
      }
      if (!isInternal) filteredNumbers.push(numEntry);
    }
    numbersWithPositions = filteredNumbers;
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
        matchedAka: product.matchedAka, // ADDED: if matched via AKA placeholder, this will be set
        qty: quantity,
        score: product.score || 100.0
      });
    }
  }

  return { parsedOrders, updatedDb: workingDb, disabledProductsFound };
}

// UPDATED: Main parse function that processes each line separately and accumulates
function parse(message, productsDb, similarityThreshold = 76, uncertainRange = [60, 80]) {
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