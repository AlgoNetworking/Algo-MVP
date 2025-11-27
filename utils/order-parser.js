// Portuguese number words and parsing logic
const units = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'zero': 0, 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'dos': 2, 'tres': 3, 'três': 3, 'treis': 3,
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

function findAssociatedNumber(productPosition, allTokens, numbersWithPositions, usedNumberPositions) {
  if (numbersWithPositions.length === 0) {
    return [1, null];
  }

  const availableNumbers = numbersWithPositions.filter(([pos, _]) => !usedNumberPositions.has(pos));
  
  if (availableNumbers.length === 0) {
    return [1, null];
  }

  // Priority 1: Number immediately before
  if (productPosition > 0) {
    const prevToken = allTokens[productPosition - 1];
    if (/^\d+$/.test(prevToken) || allNumberWords[prevToken]) {
      for (const [pos, val] of availableNumbers) {
        if (pos === productPosition - 1) {
          return [val, pos];
        }
      }
    }
  }

  // Priority 2: Closest number before
  const numbersBefore = availableNumbers.filter(([pos, _]) => pos < productPosition);
  if (numbersBefore.length > 0) {
    const closest = numbersBefore.reduce((max, curr) => curr[0] > max[0] ? curr : max);
    return [closest[1], closest[0]];
  }

  // Priority 3: Number immediately after
  if (productPosition + 1 < allTokens.length) {
    const nextToken = allTokens[productPosition + 1];
    if (/^\d+$/.test(nextToken) || allNumberWords[nextToken]) {
      for (const [pos, val] of availableNumbers) {
        if (pos === productPosition + 1) {
          return [val, pos];
        }
      }
    }
  }

  // Priority 4: Closest number after
  const numbersAfter = availableNumbers.filter(([pos, _]) => pos > productPosition);
  if (numbersAfter.length > 0) {
    const closest = numbersAfter.reduce((min, curr) => curr[0] < min[0] ? curr : min);
    return [closest[1], closest[0]];
  }

  return [1, null];
}

function parse(message, productsDb) {
  let normalized = normalize(message);
  normalized = separateNumbersAndWords(normalized);
  normalized = normalized.replace(/[,\.;\+\-\/\(\)\[\]\:]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const tokens = normalized.split(' ');
  const workingDb = productsDb.map(([product, qty]) => [product, qty]);
  const parsedOrders = [];

  const numbersWithPositions = extractNumbersAndPositions(tokens);
  
  const productNames = productsDb.map(([p, _]) => p);
  const sortedProducts = productNames
    .map((p, idx) => [p, idx])
    .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);
  
  const maxProdWords = Math.max(...productNames.map(p => p.split(' ').length));

  const productWords = new Set();
  productNames.forEach(product => {
    product.split(' ').forEach(word => productWords.add(normalize(word)));
  });

  const usedPositions = new Set();
  const usedNumberPositions = new Set();
  const potentialMatches = [];

  let i = 0;
  while (i < tokens.length) {
    if (usedPositions.has(i)) {
      i++;
      continue;
    }

    const token = tokens[i];
    const fillerWords = ['quero', 'e'];
    
    if ((fillerWords.includes(token) && !productWords.has(token)) || 
        (/^\d+$/.test(token) && !numbersWithPositions.some(([pos, _]) => pos === i)) || 
        allNumberWords[token]) {
      i++;
      continue;
    }

    let matched = false;

    for (let size = Math.min(maxProdWords, 4); size > 0; size--) {
      if (i + size > tokens.length) continue;

      const phraseTokens = tokens.slice(i, i + size);
      let skipPhrase = false;

      for (let j = 0; j < size; j++) {
        if (usedPositions.has(i + j)) {
          skipPhrase = true;
          break;
        }
        const t = tokens[i + j];
        if (/^\d+$/.test(t) || allNumberWords[t] || (fillerWords.includes(t) && !productWords.has(t))) {
          skipPhrase = true;
          break;
        }
      }

      if (skipPhrase) continue;

      const phrase = phraseTokens.join(' ');
      const phraseNorm = normalize(phrase);

      let bestScore = 0;
      let bestProduct = null;
      let bestOriginalIdx = null;

      sortedProducts.forEach(([prodName, origIdx]) => {
        const prodNorm = normalize(prodName);
        const score = similarityPercentage(phraseNorm, prodNorm);
        if (score > bestScore) {
          bestScore = score;
          bestProduct = prodName;
          bestOriginalIdx = origIdx;
        }
      });

      if (bestScore >= 80 || (bestScore > 50 && !matched)) {
        potentialMatches.push({
          start_pos: i,
          end_pos: i + size - 1,
          product: bestProduct,
          original_idx: bestOriginalIdx,
          score: bestScore
        });

        for (let j = 0; j < size; j++) {
          usedPositions.add(i + j);
        }

        i += size;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const phrase = tokens[i];
      let bestMatch = null;
      let bestScore = 0;
      let bestOriginalIdx = null;
      const phraseNorm = normalize(phrase);

      productNames.forEach((product, idx) => {
        const score = similarityPercentage(phraseNorm, normalize(product));
        if (score > bestScore) {
          bestScore = score;
          bestMatch = product;
          bestOriginalIdx = idx;
        }
      });

      if (bestMatch && bestScore > 50) {
        potentialMatches.push({
          start_pos: i,
          end_pos: i,
          product: bestMatch,
          original_idx: bestOriginalIdx,
          score: bestScore
        });

        usedPositions.add(i);
      }

      i++;
    }
  }

  // Sort matches by priority
  potentialMatches.sort((a, b) => {
    const getPriority = (match) => {
      const startPos = match.start_pos;

      if (startPos > 0) {
        const prevToken = tokens[startPos - 1];
        if ((/^\d+$/.test(prevToken) || allNumberWords[prevToken]) && 
            !usedNumberPositions.has(startPos - 1)) {
          return 0;
        }
      }

      const numbersBefore = numbersWithPositions
        .filter(([pos, _]) => pos < startPos && !usedNumberPositions.has(pos));
      if (numbersBefore.length > 0) return 1;

      if (startPos + 1 < tokens.length) {
        const nextToken = tokens[startPos + 1];
        if ((/^\d+$/.test(nextToken) || allNumberWords[nextToken]) && 
            !usedNumberPositions.has(startPos + 1)) {
          return 2;
        }
      }

      const numbersAfter = numbersWithPositions
        .filter(([pos, _]) => pos > startPos && !usedNumberPositions.has(pos));
      if (numbersAfter.length > 0) return 3;

      return 4;
    };

    return getPriority(a) - getPriority(b);
  });

  // Process matches
  potentialMatches.forEach(match => {
    const [quantity, numberPosition] = findAssociatedNumber(
      match.start_pos,
      tokens,
      numbersWithPositions,
      usedNumberPositions
    );

    workingDb[match.original_idx][1] += quantity;
    parsedOrders.push({
      product: match.product,
      qty: quantity,
      score: Math.round(match.score * 100) / 100
    });

    if (numberPosition !== null) {
      usedNumberPositions.add(numberPosition);
    }
  });

  return { parsedOrders, updatedDb: workingDb };
}

module.exports = {
  parse,
  normalize,
  similarityPercentage
};