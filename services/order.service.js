// services/order.service.js
const databaseService = require('./database.service');
const orderParser = require('../utils/order-parser');

class OrderSession {
  constructor(sessionId, userId) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.currentDb = []; // Will be populated async
    this.state = 'waiting_for_next';
    this.reminderCount = 0;
    this.messageQueue = [];
    this.activeTimer = null;
    this.lastActivity = Date.now();
    this.waitingForOption = false;
    this.phoneNumber = null;
    this.name = null;
    this.orderType = null;
    this.hasDisabledProducts = false;
    this.productsLoaded = false;
    this.loadingPromise = null; // To handle concurrent loading
    this.parseOrderAttempts = 0;
    this.chooseOptionAttempts = 0;
  }

  // Async method to load products
  async loadProducts() {
    if (this.productsLoaded) return this.currentDb;
    
    if (this.loadingPromise) {
      // If already loading, wait for that promise
      return await this.loadingPromise;
    }
    
    this.loadingPromise = (async () => {
      try {
        console.log(`🔄 Loading products for user ${this.userId} in session ${this.sessionId}`);
        const userProducts = await databaseService.getAllProducts(this.userId);
        
        // Convert to format expected by order-parser
        this.currentDb = userProducts.map(product => [
          [product.name, product.akas || [], product.enabled],
          0
        ]);
        
        this.productsLoaded = true;
        console.log(`✅ Loaded ${this.currentDb.length} products for user ${this.userId}`);
        return this.currentDb;
      } catch (error) {
        console.error('❌ Error loading products:', error);
        this.currentDb = [];
        return [];
      } finally {
        this.loadingPromise = null;
      }
    })();
    
    return await this.loadingPromise;
  }

  hasEnabledItems() {
    return this.currentDb.some(([product, qty]) => {
      const [_, __, enabled] = product;
      return enabled && qty > 0;
    });
  }

  hasDisabledItems() {
    return this.currentDb.some(([product, qty]) => {
      const [_, __, enabled] = product;
      return !enabled && qty > 0;
    });
  }

  hasItems() {
    return this.currentDb.some(([_, qty]) => qty > 0);
  }

  getCurrentOrders() {
    return Object.fromEntries(
      this.currentDb.filter(([_, qty]) => qty > 0)
    );
  }

  resetCurrent() {
    // Reset quantities to 0 but keep products
    this.currentDb = this.currentDb.map(([product, _]) => [product, 0]);
    this.state = 'collecting';
    this.reminderCount = 0;
    this.cancelTimer();
  }

  startInactivityTimer() {
    this.cancelTimer();
    // Only start timer if there are enabled items
    if (this.hasEnabledItems() && !this.hasDisabledItems()) {
      this.activeTimer = setTimeout(() => this.sendSummary(), 30000); //30 seconds
    }
  }

  cancelTimer() {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
  }

  sendSummary() {
    if (this.state === 'collecting' && this.hasEnabledItems()) {
      // Filter out disabled products before sending summary
      const enabledItems = [];
      const disabledItems = [];
      
      this.currentDb.forEach(([product, qty]) => {
        const [mainName, akas, enabled] = product;
        if (enabled && qty > 0) {
          enabledItems.push([product, qty]);
        } else if (!enabled && qty > 0) {
          disabledItems.push({ product: mainName, qty });
        }
      });
      
      this.state = 'confirming';
      this.reminderCount = 0;
      const summary = this.buildSummary(enabledItems);
      this.messageQueue.push([summary, '']);
      this.startReminderCycle();
    } else if (this.state === 'collecting') {
      this.startInactivityTimer();
    }
  }

  startReminderCycle() {
    this.reminderCount = 1;
    this.cancelTimer();
    this.activeTimer = setTimeout(() => this.sendReminder(), 900000); // 15 minutes
  }

  sendReminder() {
    if (this.state === 'confirming' && this.reminderCount <= 3) {
      const summary = this.buildSummary();
      
      if (this.reminderCount === 3) {
        this.markAsPending();
      } else {
        this.messageQueue.push([`🔔 **LEMBRETE (${this.reminderCount}/2):**\n${summary}`, '']);
        this.reminderCount++;
        this.cancelTimer();
        this.activeTimer = setTimeout(() => this.sendReminder(), 900000); //15 minutes
      }
    }
  }

  async markAsPending() {
    if (this.hasEnabledItems() && this.phoneNumber) {
      const parsedOrders = [];
      for (const [product, qty] of this.currentDb) {
        const [mainName, akas, enabled] = product;
        if (enabled && qty > 0) {
          parsedOrders.push({ productName: mainName, qty, score: 100.0 });
        }
      }

      await databaseService.saveUserOrder({
        userId: this.userId,
        phoneNumber: this.phoneNumber,
        name: this.name,
        orderType: this.orderType,
        sessionId: this.sessionId,
        originalMessage: 'Auto-saved (pending confirmation)',
        parsedOrders,
        status: 'pending'
      });

      this.messageQueue.push(['🟡 **PEDIDO SALVO COMO PENDENTE** - *Pedido confirmado automaticamente.*', 'autoConfirmedOrder']);
      this.resetCurrent();
      this.state = 'waiting_for_next';
    }
  }

  buildSummary(items = null) {
    let summary = '📋 **RESUMO DO SEU PEDIDO:**\n';
    const itemsToShow = items || this.currentDb.filter(([_, qty]) => qty > 0);
    
    if (this.orderType !== 'outro')
      for (const [product, qty] of itemsToShow) {
        if (qty > 0) {
          const [mainName, akas, enabled] = product;
          if (enabled) {
            summary += `• ${mainName}: ${qty}\n`;
          }
        }
      }
      else {
        for (const [product, qty] of itemsToShow) {
          if (qty > 0) {
            const [mainName, akas, enabled] = product;
            if (enabled) {
              summary += `\n${mainName}\n`;
            }
          }
        }
      }
    summary += '\n⚠️ **Confirma o pedido?** (responda com \"sim\" ou \"não\")';
    return summary;
  }

  checkCancelCommand(message) {
    const cancelCommands = 
    [
      'nao', 'não', 'n', 'cancelar', 'cancela', 'cancelra', 'cancelrar', '\"cancelar\"', 'não obrigada',
      'não obrigado', 'nao obrigada', 'nao obrigado', 'nao brigada', 'nao brigado', 'n obrigada', 'n obrigado', 
      'n brigada', 'n brigado', 'não, obrigada', 'não, obrigado', 'nao, obrigada', 'nao, obrigado', 'nao, brigada',
      'nao, brigado', 'n, obrigada', 'n, obrigado', 'n, brigada', 'n, brigado',
      '\'cancelar\'', 'cancelar.', 'nao vou pedir', 'não vou pedir', '\"cancelar.\"', '\'cancelar.\'', 'estamos viajando', 'estou viajando',
      'nao quero', 'não quero', 'ainda tenho', 'obrigado, não quero hoje', 'tamo viajando', 'tamos viajando', 'to viajando', 'tô viajando',
      'não vou querer', 'não vou querer hoje', 'não quero hoje', 'só próxima semana', 
      'só proxima semana', 'so proxima semana','obrigado, nao quero hoje', 
      'nao vou querer', 'nao vou querer hoje', 'nao quero hoje', 'hoje nao', 'hoje não', 'hj nao', 'hj não', 'hj n',
      'ainda tem', 'não preciso', 'para essa semana não', 'para essa semana n', 'estamos abastecidos',
      'estou abastecido', 'estou abastecida', 'sem pedidos', 'próxima semana', 'proxima semana',
    ];
    return cancelCommands.includes(message);
  }

  getPendingMessage() {
    return this.messageQueue.shift() || null;
  }

  // Helper to get product names for examples
  getProductNames() {
    return this.currentDb
      .map(([product, _]) => {
        const [name, akas, enabled] = product;
        return enabled ? name : null;
      })
      .filter(name => name !== null);
  }
}

class OrderService {
  constructor() {
    this.sessions = new Map();
  }

  getSession(sessionId, userId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new OrderSession(sessionId, userId));
    }
    return this.sessions.get(sessionId);
  }

  async startSession(sessionId, userId) {
    const session = this.getSession(sessionId, userId);
    await session.loadProducts(); // Ensure products are loaded
    session.state = 'collecting';
    return { success: true };
  }

  async processMessage({ userId, sessionId, message, messageType, phoneNumber, name, orderType }) {
    const session = this.getSession(sessionId, userId);

    const messageLower = message.toLowerCase().trim();

    // Get user's product names for example
    const productNames = session.getProductNames();

    const confirmWords = 
    [
      'confirmar', 'confimar', 'confirma', 'confima', 'confirmo',
      'sim', 's', 'ok', 'okey', 'okay', 'claro', 'pode ser', 'pronto', 
      'ponto'
    ];

    const greetingWords = 
    [
      'olá', 'ola', 'oi', 'boa dia', 'bom dia', 'bom dia ', 'bon dia',
      'boa tarde', 'bom tarde', 'bon tarde', 'boa noite', 
      'bom noite', 'bon noite', 'opa', 'eae', 'salve', 
      'saudações', 'saudacoes', 'hello', 'hi', 'hey', 
      'opa bom dia', 'opa boa tarde', 'opa boa noite', 
      'oi bom dia', 'oi boa tarde', 'oi boa noite', 
      'ola bom dia', 'ola boa tarde', 'ola boa noite', 
      'olá bom dia', 'olá boa tarde', 'olá boa noite', 
      'eae bom dia','eae boa tarde', 'eae boa noite', 'alo',
      'alô'
    ];
    if(greetingWords.includes(messageLower.replace(/[?!,.]/g, '')) && session.state === 'collecting' && !session.hasItems()) {

      const idx1 = Math.floor(Math.random() * productNames.length);
      const idx2 = Math.floor(Math.random() * productNames.length);
      const differentIdx = idx1 === idx2 ? (idx1 + 1 < productNames.length ? idx1 + 1 :  idx1 - 1) : idx2;
  
      const firstUpperCase = messageLower.replace(/[?!,.]/g, '').trim().charAt(0).toUpperCase() + 
                              messageLower.replace(/[?!,.]/g, '').trim().slice(1);
      let greeting = firstUpperCase;
      if(firstUpperCase === 'Boa dia' || firstUpperCase === 'Bon dia') { greeting = 'Bom dia'; }
      if(firstUpperCase === 'Bom tarde' || firstUpperCase === 'Bon tarde') { greeting = 'Boa tarde'; }
      if(firstUpperCase === 'Bom noite' || firstUpperCase === 'Bon noite') { greeting = 'Boa noite'; }
      if(firstUpperCase === 'Alo') { greeting = 'Alô'; }
      if(firstUpperCase === 'Ola') { greeting = 'Olá'; }

      const example = productNames[0] ?
      `${Math.floor(Math.random() * 10) + 1} ${productNames[idx1]} e ${Math.floor(Math.random() * 10) + 1} ${productNames[differentIdx]}`
      : null;
      const hint = example
        ? `(digite seu pedido naturalmente como: ${example})\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!\n*Caso não queira pedir, digite \"cancelar\".*`
        : '(não há produtos disponíveis no momento)';
      session.waitingForOption = false;
      return {
        success: true,
        message: `${greeting}! Isto é uma mensagem automática para a sua conveniência 😊\n\n${hint}`,
        isChatBot: true,
        clientStatus: '',
      }
    }

    if(messageLower.endsWith('?')) {
      session.waitingForOption = false;
      session.state = 'waiting_for_next';
      for(let i = 0; i < session.currentDb.length; i++) {
        session.currentDb[i][1] = 0;
      }
      console.log(session.currentDb);
      return {
        success: true,
        message: 'O programa detectou que você quer tirar uma dúvida com um funcionário. Assim que pudermos terá uma resposta!\n\n(digite "sair" caso queira voltar a falar com um robô)',
        isChatBot: false,
        clientStatus: 'talkToEmployee',
      };
    }
    
    // Ensure products are loaded before processing
    if (!session.productsLoaded) {
      await session.loadProducts();
    }
    
    if (phoneNumber) session.phoneNumber = phoneNumber;
    if (name) session.name = name;
    if (orderType) session.orderType = orderType;

    session.lastActivity = Date.now();

    // Check for cancel
    if (session.checkCancelCommand(messageLower) && session.state !== 'confirming') {
      session.resetCurrent();
      session.state = 'waiting_for_next';
      session.parseOrderAttempts = 0;
      try {
        if (session.phoneNumber) {
          // save a lightweight cancelled order (no items)
          const parsedOrders = []; // empty because user canceled
          await databaseService.saveUserOrder({
            userId,
            phoneNumber: session.phoneNumber,
            name: session.name || 'Cliente sem nome',
            orderType: session.orderType || 'normal',
            sessionId,
            originalMessage: message,
            parsedOrders,
            status: 'canceled' // note: new status value treated in UI/CSS
          });
        }
      } catch (err) {
        console.error('Error saving canceled user order:', err);
      }
      return { success: true, message: 'Ok, até próxima semana! 😃', isChatBot: true, clientStatus: 'wontOrder',};
    }

    if(messageType !== 'chat') {
      session.state = 'waiting_for_next';
      session.waitingForOption = false;
      return {
        success: true,
        message: `Perdão, mas o nosso programa de mensagens automáticas ainda não entende mensagens que não sejam de texto. \n\nVocê será redirecionado para um funcionário responder.\n\n(digite "sair" caso queira voltar a falar com um robô)`,
        isChatBot: false,
        clientStatus: 'talkToEmployee',
      };
    }

    // Handle waiting_for_next
    if (session.state === 'waiting_for_next') {
      session.state = 'option';
      session.waitingForOption = true;
      const config = await databaseService.getUserConfig(userId);
        const callByName = config ? config.callByName : true;

      const callName = callByName ? name : 'Cliente sem nome';
      const greeting = callName !== 'Cliente sem nome' ? `Olá ${callName}!` : 'Olá!';
      return {
        success: true,
        message: `${greeting} Isso é uma mensagem automática. 😁\n\nVocê deseja:\nrealizar um pedido (digite "*1*");\nfalar com um funcionário (digite "*2*");\nver a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?`,
        isChatBot: true,
        clientStatus: '',
      };
    }

    // Handle option selection
    if (session.state === 'option' && session.waitingForOption) {
      if (messageLower === '1') {
        session.waitingForOption = false;
        session.state = 'collecting';
        session.startInactivityTimer();
        session.parseOrderAttempts = 0;
        session.chooseOptionAttempts = 0;
        
        if (productNames.length === 0) {
          return {
            success: false,
            message: '❌ Não há produtos disponíveis no momento. Por favor, entre em contato conosco.',
            isChatBot: true,
            clientStatus: '',
          };
        }
        
        let example = '';
        if (productNames.length >= 2) {
          const idx1 = Math.floor(Math.random() * productNames.length);
          let idx2 = Math.floor(Math.random() * productNames.length);
          while (idx2 === idx1 && productNames.length > 1) {
            idx2 = Math.floor(Math.random() * productNames.length);
          }
          example = `${Math.floor(Math.random() * 10) + 1} ${productNames[idx1]} e ${Math.floor(Math.random() * 10) + 1} ${productNames[idx2]}`;
        } else {
          example = `${Math.floor(Math.random() * 10) + 1} ${productNames[0]}`;
        }
        
        return {
          success: true,
          message: `Ótimo! Digite seus pedidos. Exemplo: "${example}"\ndigite "pronto" quando terminar seu pedido ou aguarde a mensagem automática!`,
          isChatBot: true,
          clientStatus: '',
        };
      } else if (messageLower === '2') {
        session.waitingForOption = false;
        session.state = 'waiting_for_next';
        session.chooseOptionAttempts = 0;
        return {
          success: true,
          message: 'Ok, assim que pudermos terá uma resposta!\n\n(digite "sair" caso queira voltar a falar com um robô)',
          isChatBot: false,
          clientStatus: 'talkToEmployee',
        };
      } else if (messageLower === '3') {
        const config = await databaseService.getUserConfig(userId);
        const callByName = config ? config.callByName : true;

        const callName = callByName ? name : 'Cliente sem nome';
        const okay = callName !== 'Cliente sem nome' ? `Certo, ${callName}. Aqui` : 'Certo, aqui';
        session.waitingForOption = true;
        session.state = 'option';
        session.chooseOptionAttempts = 0;
        
        let productList = `${okay} está nossa lista de produtos!\n\n`;
        let hasProducts = false;
        
        for (const [product, qty] of session.currentDb) {
          const [productName, akas, enabled] = product;
          if (enabled) {
            productList += `• ${productName} - ✅\n`;
            hasProducts = true;
          }
          else {
            productList += `• ${productName} - ❌ (Fora de estoque no momento)\n`;
          }
        }
        
        if (!hasProducts) {
          productList += 'Nenhum produto disponível no momento.\n';
        }
        
        productList += '\nE agora? Você deseja:\nrealizar um pedido (digite "*1*");\nfalar com um funcionário (digite "*2*");\nver novamente a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?';
        
        return {
          success: true,
          message: productList,
          isChatBot: true,
          clientStatus: '',
        };
      } else if (messageLower === '4') {
        // Get product names for example
        const productNames = session.getProductNames();
        let example = '';
        session.chooseOptionAttempts = 0;
        
        if (productNames.length >= 2) {
          const idx1 = Math.floor(Math.random() * productNames.length);
          let idx2 = Math.floor(Math.random() * productNames.length);
          while (idx2 === idx1 && productNames.length > 1) {
            idx2 = Math.floor(Math.random() * productNames.length);
          }
          example = `${Math.floor(Math.random() * 10) + 1} ${productNames[idx1]} e ${Math.floor(Math.random() * 10) + 1} ${productNames[idx2]}`;
        } else if (productNames.length === 1) {
          example = `${Math.floor(Math.random() * 10) + 1} ${productNames[0]}`;
        } else {
          example = '2 mangas e 3 queijos';
        }

        session.waitingForOption = true;
        session.state = 'option';
        let info = 'Ok, aqui temos instruções de como utilizar o programa e mais sobre ele!\n\n';
        info += 'O programa oferece quatro opções quando está no menu inicial: "*1*" para realizar um pedido, "*2*" para falar com um funcionário, "*3*" para ver a lista de produtos e "*4*" para ler a mensagem que você está lendo agora.\n\n';
        info += `Para realizar um pedido, basta digitar mensagens de texto de forma natural, como: ${example}. Pois o programa consegue entender mensagens em linguagem natural.\n\n`;
        info += 'O programa foi feito por Guilherme Moura Mororó, Nicolas Pinheiro e Marcos Bastos para originalmente ajudar a empresa dos avós de Guilherme. No entanto, ainda está em fase de testes e pode ser adicionado ao seu negócio gratuitamente. Basta contatar o número (+55 85 7400-2430) e recebrá mais informações sobre o produto.\n\n';
        info += 'E agora? Você deseja:\nrealizar um pedido (digite "*1*");\nfalar com um funcionário (digite "*2*");\nler a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo novamente(digite "*4*")?';
        
        return {
          success: true,
          message: info,
          isChatBot: true,
          clientStatus: '',
        };
      } else {
        session.chooseOptionAttempts++;
        if(session.chooseOptionAttempts >= 2) {
          session.waitingForOption = false;
          session.state = 'waiting_for_next';
          return {
            success: true,
            message: 'O programa detectou que você quer falar com um funcionário. Assim que pudermos terá uma resposta!\n\n(digite "sair" caso queira voltar a falar com um robô)',
            isChatBot: false,
            clientStatus: 'talkToEmployee',
          };
        }
        return {
          success: false,
          message: 'Por favor, escolha uma opção:\n("*1*") para pedir;\n("*2*") para falar com um funcionário;\n("*3*") para ver a lista de produtos ou\n("*4*") para saber mais sobre o programa e como usá-lo',
          isChatBot: true,
          clientStatus: '',
        };
      }
    }

    // Handle confirmation
    if (session.state === 'confirming') {

      if (confirmWords.includes(messageLower)) {
        // Before confirming, check for disabled products in any new items
        const { disabledProductsFound } = orderParser.parse(message, session.currentDb);
        
        if (disabledProductsFound.length > 0) {
          // Reset to collecting state
          session.cancelTimer();
          session.state = 'collecting';
          
          // Remove disabled products from current orders
          const filteredDb = [];
          const disabledRemoved = [];
          
          session.currentDb.forEach(([product, qty]) => {
            const [mainName, akas, enabled] = product;
            if (enabled && qty > 0) {
              filteredDb.push([product, qty]);
            } else if (!enabled && qty > 0) {
              disabledRemoved.push({ product: mainName, qty });
              filteredDb.push([product, 0]); // Reset quantity for disabled product
            } else {
              filteredDb.push([product, qty]);
            }
          });
          
          session.currentDb = filteredDb;
          
          // Inform user about the disabled products
          let errorMessage = '❌ **ATENÇÃO:**\n\n';
          errorMessage += disabledProductsFound.length > 1 
          ? 'Os seguintes produtos estão temporariamente fora de estoque:\n' 
          : 'O seguinte produto está temporariamente fora de estoque:\n';
          disabledProductsFound.forEach(item => {
            errorMessage += `• *${item.product}*\n`;
          });
          errorMessage += '\nEstes itens foram removidos. Você pode:\n';
          errorMessage += '- Continuar adicionando outros produtos\n';
          errorMessage += '- Digitar "pronto" para enviar o pedido\n';
          errorMessage += '- Digitar "cancelar" para cancelar o seu pedido';
          
          return {
            success: false,
            message: errorMessage,
            isChatBot: true,
            clientStatus: '',
          };
        }
        
        // Rest of confirmation logic
        session.cancelTimer();
        const confirmedOrder = session.getCurrentOrders();

        // Update database
        for (const [product, quantity] of Object.entries(confirmedOrder)) {
          if (quantity > 0) {
            await databaseService.updateProductTotal(userId, product, quantity);
          }
        }

        // Save user order
        if (session.phoneNumber) {
          const parsedOrders = [];
          for (const [product, qty] of session.currentDb) {
            if (qty > 0) {
              const productName = product[0];
              parsedOrders.push({ productName, qty, score: 100.0 });
            }
          }

          await databaseService.saveUserOrder({
            userId,
            phoneNumber: session.phoneNumber,
            name: session.name,
            orderType: session.orderType,
            sessionId,
            originalMessage: message,
            parsedOrders,
            status: 'confirmed'
          });
        }

        session.resetCurrent();
        session.state = 'waiting_for_next';

        let response = '✅ **PEDIDO CONFIRMADO COM SUCESSO!**\n\n**Itens confirmados:**\n';
        for (const [product, qty] of Object.entries(confirmedOrder)) {
          const splittedProduct = product.split(',');
          const productName = splittedProduct[0];
          response += `• ${qty}x ${productName}\n`;
        }
        const config = await databaseService.getUserConfig(userId);
        const callByName = config ? config.callByName : true;

        const callName = callByName ? session.name : 'Cliente sem nome';
        
        const thankYou = callName !== 'Cliente sem nome' 
          ? `\nObrigado pelo pedido, ${callName}! 🎉\n\n`
          : '\nObrigado pelo pedido! 🎉\n\n';
        response += thankYou;

        return { success: true, message: response, isChatBot: true, clientStatus: 'confirmedOrder',};

      } else if (session.checkCancelCommand(messageLower)) {
        session.cancelTimer();

        try {
          if (session.phoneNumber) {
            // save a lightweight cancelled order (no items)
            const parsedOrders = []; // empty because user canceled
            await databaseService.saveUserOrder({
              userId,
              phoneNumber: session.phoneNumber,
              name: session.name || 'Cliente sem nome',
              orderType: session.orderType || 'normal',
              sessionId,
              originalMessage: message,
              parsedOrders,
              status: 'canceled' // note: new status value treated in UI/CSS
            });
          }
        } catch (err) {
          console.error('Error saving canceled user order:', err);
        }

        session.resetCurrent();
        session.startInactivityTimer();
        return {
          success: true,
          message: '🔄 **Pedido cancelado!** Digite novos itens.',
          isChatBot: true,
          clientStatus: '',
        };

      } else {
        // Try parsing as new items
        if (session.orderType !== 'outro') {
          const { parsedOrders, updatedDb, disabledProductsFound } = orderParser.parse(message, session.currentDb);
        
          if (disabledProductsFound.length > 0) {
            // Reset to collecting state when disabled product is ordered
            session.cancelTimer();
            session.state = 'collecting';
            session.currentDb = updatedDb;
            
            let errorMessage = '❌ **ATENÇÃO:**\n\n';
            errorMessage += disabledProductsFound.length > 1 
            ? 'Os seguintes produtos estão temporariamente fora de estoque:\n' 
            : 'O seguinte produto está temporariamente fora de estoque:\n';
            disabledProductsFound.forEach(item => {
              errorMessage += `• *${item.product}*\n`;
            });
            errorMessage += '\nConfirmação interrompida. Você pode:\n';
            errorMessage += '- Continuar adicionando outros produtos\n';
            errorMessage += '- Digitar "pronto" para enviar o pedido sem estes itens\n';
            errorMessage += '- Digitar "cancelar" para cancelar o seu pedido';
            
            return {
              success: false,
              message: errorMessage,
              isChatBot: true,
              clientStatus: '',
            };
          }
          
          if (parsedOrders.length > 0) {
            session.currentDb = updatedDb;
            session.cancelTimer();
            session.state = 'collecting'; // Go back to collecting state
            session.reminderCount = 0;
            session.startInactivityTimer();
            return { success: true, isChatBot: true, clientStatus: '',};
          } else {
            return {
              success: false,
              message: '☹️ Perdão, o item não foi reconhecido. Digite \'confirmar\' para confirmar ou \'nao\' para cancelar.',
              isChatBot: true,
              clientStatus: '',
            };
          }
        } 
        else {
          const { disabledProductsFound } = orderParser.parse(message, session.currentDb);

          const parsedOrders = [];

          parsedOrders.push({
            productName: message,
            qty: 1,
            score: 100.0
          });
        
          if (disabledProductsFound.length > 0) {
            // Reset to collecting state when disabled product is ordered
            session.cancelTimer();
            session.state = 'collecting';
            
            let errorMessage = '❌ **ATENÇÃO:**\n\n';
            errorMessage += disabledProductsFound.length > 1 
            ? 'Os seguintes produtos estão temporariamente fora de estoque:\n' 
            : 'O seguinte produto está temporariamente fora de estoque:\n';
            disabledProductsFound.forEach(item => {
              errorMessage += `• *${item.product}*\n`;
            });
            errorMessage += '\nConfirmação interrompida. Você pode:\n';
            errorMessage += '- Continuar adicionando outros produtos\n';
            errorMessage += '- Digitar "pronto" para enviar o pedido sem estes itens\n';
            errorMessage += '- Digitar "cancelar" para cancelar o seu pedido';
            
            return {
              success: false,
              message: errorMessage,
              isChatBot: true,
              clientStatus: '',
            };
          }
          
          if (parsedOrders.length > 0) {
            const akas = '';
            const enabled = true;
            const product = [message, akas, enabled];
            session.currentDb.push([product, 1]);
            session.cancelTimer();
            session.state = 'collecting'; // Go back to collecting state
            session.reminderCount = 0;
            session.startInactivityTimer();
            return { success: true, isChatBot: true, clientStatus: '',};
          } else {
            return {
              success: false,
              message: '☹️ Perdão, o item não foi reconhecido. Digite \'confirmar\' para confirmar ou \'nao\' para cancelar.',
              isChatBot: true,
              clientStatus: '',
            };
          }
        }
      }
    }

    // Handle collection
    if (session.state === 'collecting') {
      if (confirmWords.includes(messageLower)) {
        if (session.hasItems()) {
          // Check if there are any disabled products in current orders
          const hasDisabledProducts = session.currentDb.some(([product, qty]) => {
            const [_, __, enabled] = product;
            return !enabled && qty > 0;
          });
          

          if (hasDisabledProducts) {
            // Remove disabled products and keep only enabled ones
            const filteredDb = [];
            const disabledRemoved = [];
            
            session.currentDb.forEach(([product, qty]) => {
              const [mainName, akas, enabled] = product;
              if (enabled && qty > 0) {
                filteredDb.push([product, qty]);
              } else if (!enabled && qty > 0) {
                disabledRemoved.push({ product: mainName, qty });
              } else {
                filteredDb.push([product, qty]);
              }
            });
            
            // Update the session with filtered products
            session.currentDb = filteredDb;
            
            // Send summary with only enabled products
            session.sendSummary();
            
            // Optionally notify about removed products
            if (disabledRemoved.length > 0) {
              // This message can be sent before the summary
              return {
                success: true,
                message: `⚠️ **ATENÇÃO:** Os seguintes produtos estão fora de estoque e foram removidos do seu pedido:\n${
                  disabledRemoved.map(item => `• ${item.qty}x ${item.product}`).join('\n')
                }\n\n📋 Preparando resumo dos produtos disponíveis...`,
                isChatBot: true,
                clientStatus: '',
              };
            }
            
            return { success: true, message: '📋 Preparando seu resumo...', isChatBot: true, clientStatus: '', };
          } else {
            // No disabled products, proceed normally
            session.sendSummary();
            return { success: true, message: '📋 Preparando seu resumo...', isChatBot: true, clientStatus: '', };
          }
        } else {
          return { success: false, message: '❌ Lista vazia. Adicione itens primeiro.', isChatBot: true, clientStatus: '', };
        }
      } else {
        if (session.orderType !== 'outro') {
          const { parsedOrders, updatedDb, disabledProductsFound } = orderParser.parse(message, session.currentDb);
          
          // If disabled products found, don't start timer but keep the enabled ones
          if (disabledProductsFound.length > 0) {
            // Keep the updatedDb (which includes disabled products)
            session.currentDb = updatedDb;
            
            // Don't start the timer
            session.cancelTimer();
            
            // Build informative message
            let errorMessage = '❌ **ATENÇÃO:**\n\n';
            errorMessage += disabledProductsFound.length > 1 
            ? 'Os seguintes produtos estão temporariamente fora de estoque:\n' 
            : 'O seguinte produto está temporariamente fora de estoque:\n';
            disabledProductsFound.forEach(item => {
              errorMessage += `• *${item.product}*\n`;
            });
            errorMessage += '\nVocê pode:\n';
            errorMessage += '- Continuar adicionando outros produtos\n';
            errorMessage += '- Digitar "pronto" para enviar o pedido sem estes itens\n';
            errorMessage += '- Digitar "cancelar" para cancelar o seu pedido';
            
            return {
              success: false,
              message: errorMessage,
              isChatBot: true,
              clientStatus: '',
            };
          }
          
          if (parsedOrders.length > 0) {
            session.currentDb = updatedDb;
            session.startInactivityTimer(); // Only start timer if no disabled products
            return { success: true, isChatBot: true, clientStatus: '', };
          } else {
            session.startInactivityTimer();
            session.parseOrderAttempts++;
            if(session.parseOrderAttempts >= 2 && !session.hasItems()) {
              session.waitingForOption = false;
              session.state = 'waiting_for_next';
              return {
                success: true,
                message: 'O programa detectou que você quer falar com um funcionário. Assim que pudermos terá uma resposta!\n\n(digite "sair" caso queira voltar a falar com um robô)',
                isChatBot: false,
                clientStatus: 'talkToEmployee',
              };
            }
            return {
              success: false,
              message: '☹️ Desculpa, não consegui reconhecer nenhum item... Tente usar termos como \'2 mangas\', \'cinco queijos\'. *Se desejar cancelar o pedido, digite "cancelar".*',
              isChatBot: true,
              clientStatus: '',
            };
          }
        }
        else {
          const { disabledProductsFound } = orderParser.parse(message, session.currentDb);

          const parsedOrders = [];

          parsedOrders.push({
            productName: message,
            qty: 1,
            score: 100.0
          });
          
          // If disabled products found, don't start timer but keep the enabled ones
          if (disabledProductsFound.length > 0) {
            // Keep the updatedDb (which includes disabled products)
            const akas = '';
            const enabled = true;
            const product = [message, akas, enabled];
            session.currentDb.push([product, 1]);
            
            // Don't start the timer
            session.cancelTimer();
            
            // Build informative message
            let errorMessage = '❌ **ATENÇÃO:**\n\n';
            errorMessage += disabledProductsFound.length > 1 
            ? 'Os seguintes produtos estão temporariamente fora de estoque:\n' 
            : 'O seguinte produto está temporariamente fora de estoque:\n';
            disabledProductsFound.forEach(item => {
              errorMessage += `• *${item.product}*\n`;
            });
            errorMessage += '\nVocê pode:\n';
            errorMessage += '- Continuar adicionando outros produtos\n';
            errorMessage += '- Digitar "pronto" para enviar o pedido sem estes itens\n';
            errorMessage += '- Digitar "cancelar" para cancelar o seu pedido';
            
            return {
              success: false,
              message: errorMessage,
              isChatBot: true,
              clientStatus: '',
            };
          }
          
          if (parsedOrders.length > 0) {
            const akas = '';
            const enabled = true;
            const product = [message, akas, enabled];
            session.currentDb.push([product, 1]);
            session.startInactivityTimer(); // Only start timer if no disabled products
            return { success: true, isChatBot: true, clientStatus: '', };
          } else {
            session.startInactivityTimer();
            session.parseOrderAttempts++;
            if(session.parseOrderAttempts >= 2 && !session.hasItems()) {
              session.waitingForOption = false;
              session.state = 'waiting_for_next';
              return {
                success: true,
                message: 'O programa detectou que você quer falar com um funcionário. Assim que pudermos terá uma resposta!\n\n(digite "sair" caso queira voltar a falar com um robô)',
                isChatBot: false,
                clientStatus: 'talkToEmployee',
              };
            }
            return {
              success: false,
              message: '☹️ Desculpa, não consegui reconhecer nenhum item... Tente usar termos como \'2 mangas\', \'cinco queijos\'. *Se desejar cancelar o pedido, digite "cancelar".*',
              isChatBot: true,
              clientStatus: '',
            };
          }
        }
      }
    }

    return { success: false, message: 'Estado não reconhecido. Digite \'cancelar\' para reiniciar.', isChatBot: true, clientStatus: '',};
  }

  async getUpdates(sessionId, userId) {
    const session = this.getSession(sessionId, userId);
    // Ensure products are loaded
    if (!session.productsLoaded) {
      await session.loadProducts();
    }
    
    const message = session.getPendingMessage();
    
    return {
      state: session.state,
      current_orders: session.getCurrentOrders(),
      reminders_sent: session.reminderCount,
      has_message: message !== null,
      bot_message: message,
      client_status: message
    };
  }

  getSessionInfo(sessionId, userId) {
    const session = this.getSession(sessionId, userId);
    return {
      state: session.state,
      hasItems: session.hasItems(),
      currentOrders: session.getCurrentOrders()
    };
  }
}

module.exports = new OrderService();