const databaseService = require('./database.service');
const orderParser = require('../utils/order-parser');
const productsConfig = require('../utils/products-config');

class OrderSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.currentDb = this.getEmptyProducts();
    this.state = 'waiting_for_next';
    this.reminderCount = 0;
    this.messageQueue = [];
    this.activeTimer = null;
    this.lastActivity = Date.now();
    this.waitingForOption = false;
    this.phoneNumber = null;
    this.name = null;
    this.orderType = null;
  }

  getEmptyProducts() {
    return productsConfig.getEmptyProductsDb(); // Update this line
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
    this.currentDb = this.getEmptyProducts();
    this.state = 'collecting';
    this.reminderCount = 0;
    this.cancelTimer();
  }

  startInactivityTimer() {
    this.cancelTimer();
    this.activeTimer = setTimeout(() => this.sendSummary(), 5000);
  }

  cancelTimer() {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
  }

  sendSummary() {
    if (this.state === 'collecting' && this.hasItems()) {
      this.state = 'confirming';
      this.reminderCount = 0;
      const summary = this.buildSummary();
      this.messageQueue.push(summary);
      this.startReminderCycle();
    } else if (this.state === 'collecting') {
      this.startInactivityTimer();
    }
  }

  startReminderCycle() {
    this.reminderCount = 1;
    this.cancelTimer();
    this.activeTimer = setTimeout(() => this.sendReminder(), 5000);
  }

  sendReminder() {
    if (this.state === 'confirming' && this.reminderCount <= 5) {
      const summary = this.buildSummary();
      this.messageQueue.push(`🔔 **LEMBRETE (${this.reminderCount}/5):**\n${summary}`);

      if (this.reminderCount === 5) {
        this.markAsPending();
      } else {
        this.reminderCount++;
        this.cancelTimer();
        this.activeTimer = setTimeout(() => this.sendReminder(), 5000);
      }
    }
  }

  async markAsPending() {
    if (this.hasItems() && this.phoneNumber) {
      const parsedOrders = [];
      for (const [product, qty] of this.currentDb) {
        if (qty > 0) {
          const productName = product[0];
          parsedOrders.push({ productName, qty, score: 100.0 });
        }
      }

      await databaseService.saveUserOrder({
        phoneNumber: this.phoneNumber,
        name: this.name,
        orderType: this.orderType,
        sessionId: this.sessionId,
        originalMessage: 'Auto-saved (pending confirmation)',
        parsedOrders,
        status: 'pending'
      });

      this.messageQueue.push('🟡 **PEDIDO SALVO COMO PENDENTE** - Aguardando confirmação manual.');
      this.resetCurrent();
      this.state = 'waiting_for_next';
    }
  }

  buildSummary() {
    let summary = '📋 **RESUMO DO SEU PEDIDO:**\n';
    for (const [product, qty] of this.currentDb) {
      if (qty > 0) {
        const productName = product[0];
        summary += `• ${productName}: ${qty}\n`;
      }
    }
    summary += '\n⚠️ **Confirma o pedido?** (responda com \'confirmar\' ou \'nao\')';
    return summary;
  }

  checkCancelCommand(message) {
    const cancelCommands = ['cancelar', 'não', 'nao'];
    return cancelCommands.some(cmd => message.toLowerCase().includes(cmd));
  }

  getPendingMessage() {
    return this.messageQueue.shift() || null;
  }
}

class OrderService {
  constructor() {
    this.sessions = new Map();
  }

  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new OrderSession(sessionId));
    }
    return this.sessions.get(sessionId);
  }

  async startSession(sessionId) {
    const session = this.getSession(sessionId);
    session.state = 'collecting';
    return { success: true };
  }

  async processMessage({ sessionId, message, messageType, phoneNumber, name, orderType }) {
    const session = this.getSession(sessionId);
    
    if (phoneNumber) session.phoneNumber = phoneNumber;
    if (name) session.name = name;
    if (orderType) session.orderType = orderType;

    const messageLower = message.toLowerCase().trim();
    session.lastActivity = Date.now();

    // Check for cancel
    if (session.checkCancelCommand(messageLower) && session.state !== 'confirming') {
      session.resetCurrent();
      session.state = 'waiting_for_next';
      return { success: true, message: null, isChatBot: true};
    }

    if(messageType !== 'chat') {
      session.state = 'option';
      session.waitingForOption = true;
      return {
        success: true,
        message: `Perdão, mas o nosso programa de mensagens automáticas ainda não entende mensagens que não sejam de texto. \n\nVocê deseja:\nrealizar um pedido (digite "*1*");\nfalar com uma pessoa (digite "*2*");\nver a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?`,
        isChatBot: true
      };
    }

    // Handle waiting_for_next
    if (session.state === 'waiting_for_next') {
      session.state = 'option';
      session.waitingForOption = true;
      const greeting = name !== 'Cliente sem nome' ? `Olá ${name}!` : 'Olá!';
      return {
        success: true,
        message: `${greeting} Isso é uma mensagem automática.\n\nVocê deseja:\nrealizar um pedido (digite "*1*");\nfalar com uma pessoa (digite "*2*");\nver a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?`,
        isChatBot: true
      };
    }

    // Handle option selection
    if (session.state === 'option' && session.waitingForOption) {
      if (messageLower === '1') {
        session.waitingForOption = false;
        session.state = 'collecting';
        session.startInactivityTimer();
        return {
          success: true,
          message: 'Ótimo! Digite seus pedidos. Exemplo: \"2 mangas e 3 queijos\"',
          isChatBot: true
        };
      } else if (messageLower === '2') {
        session.waitingForOption = false;
        session.state = 'waiting_for_next';
        return {
          success: true,
          message: 'Ok, assim que podermos terá uma resposta!\n\n(digite \"sair\" caso queira voltar a conversar com o bot)',
          isChatBot: false
        };
      } else if (messageLower === '3') {
        const okay = name !== 'Cliente sem nome' ? `Certo, ${name}. Aqui` : 'Certo, aqui';
        session.waitingForOption = true;
        session.state = 'option';
        let productList = `${okay} está nossa lista de produtos!\n\n`;
        for (const item of session.currentDb) {
          productList += `- ${item[0][0]} \n`;
        }
        productList += '\nE agora? Você deseja:\nrealizar um pedido (digite "*1*");\ntirar uma dúvida com uma pessoa (digite "*2*");\nver novamente a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?'
        return {
          success: true,
          message: productList,
          isChatBot: true
        }
      } else if (messageLower === '4') {

        const products = productsConfig.PRODUCTS;
    
        const idx1 = Math.floor(Math.random() * products.length);
        const idx2 = Math.floor(Math.random() * products.length);
        const differentIdx = idx1 === idx2 ? (idx1 + 1 < products.length ? idx1 + 1 :  idx1 - 1) : idx2;
    
        const example = `${Math.floor(Math.random() * 10) + 1} ${products[idx1][0]} e ${Math.floor(Math.random() * 10) + 1} ${products[differentIdx][0]}`;

        session.waitingForOption = true;
        session.state = 'option';
        let info = 'Ok, aqui temos instruções de como utilizar o programa e mais sobre ele!\n\n';
        info += 'O programa oferece quatro opções quando está no menu inicial: "*1*" para realizar um pedido, "*2*" para falar com uma pessoa real, "*3*" para ver a lista de produtos e "*4*" para ler a mensagem que você está lendo agora.\n\n';
        info += `Para realizar um pedido, basta digitar mensagens de texto de forma natural, como: ${example}. Pois o programa consegue entender mensagens em linguagem natural.\n\n`;
        info += 'O programa foi feito por Guilherme Moura Mororó e amigos para originalmente ajudar a empresa de seus avós. No entanto, ainda está em fase de testes e pode ser adicionado ao seu negócio gratuitamente. Basta contatar o número (+55 85 7400-2430) e recebrá mais informações sobre o produto.\n\n'
        info += 'E agora? Você deseja:\nrealizar um pedido (digite "*1*");\ntirar uma dúvida com uma pessoa (digite "*2*");\nler a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo novamente(digite "*4*")?'
        return {
          success: true,
          message: info,
          isChatBot: true
        }
      } 
      
      else {
        return {
          success: false,
          message: 'Por favor, escolha uma opção:\n("*1*") para pedir;\n("*2*") para falar com uma pessoa;\n("*3*") para ver a lista de produtos ou\n("*4*") para saber mais sobre o programa e como usá-lo',
          isChatBot: true
        };
      }
    }

    // Handle confirmation
    if (session.state === 'confirming') {
      const confirmWords = ['confirmar', 'confimar', 'confirma', 'confima','sim', 's'];
      const denyWords = ['nao', 'não', 'n', 'cancelar'];

      if (confirmWords.some(w => messageLower.split(' ').includes(w))) {
        session.cancelTimer();
        const confirmedOrder = session.getCurrentOrders();

        // Update database
        for (const [product, quantity] of Object.entries(confirmedOrder)) {
          if (quantity > 0) {
            await databaseService.updateProductTotal(product, quantity);
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
        
        const thankYou = session.name !== 'Cliente sem nome' 
          ? `\nObrigado pelo pedido, ${session.name}! 🎉\n\n`
          : '\nObrigado pelo pedido! 🎉\n\n';
        response += thankYou;

        return { success: true, message: response, isChatBot: true };

      } else if (denyWords.some(w => messageLower.split(' ').includes(w))) {
        session.cancelTimer();
        session.resetCurrent();
        session.startInactivityTimer();
        return {
          success: true,
          message: '🔄 **Lista limpa!** Digite novos itens.',
          isChatBot: true
        };

      } else {
        // Try parsing as new items
        const { parsedOrders, updatedDb } = orderParser.parse(message, session.currentDb);
        
        if (parsedOrders.length > 0) {
          session.currentDb = updatedDb;
          session.cancelTimer();
          session.state = 'collecting';
          session.reminderCount = 0;
          session.startInactivityTimer();
          return { success: true, isChatBot: true};
        } else {
          return {
            success: false,
            message: '❌ Item não reconhecido. Digite \'confirmar\' para confirmar ou \'nao\' para cancelar.',
            isChatBot: true,
          };
        }
      }
    }

    // Handle collection
    if (session.state === 'collecting') {
      if (['pronto', 'confirmar'].includes(messageLower)) {
        if (session.hasItems()) {
          session.sendSummary();
          return { success: true, message: '📋 Preparando seu resumo...', isChatBot: true };
        } else {
          return { success: false, message: '❌ Lista vazia. Adicione itens primeiro.', isChatBot: true };
        }
      } else {
        const { parsedOrders, updatedDb } = orderParser.parse(message, session.currentDb);
        session.currentDb = updatedDb;
        
        if (parsedOrders.length > 0) {
          session.startInactivityTimer();
          return { success: true, isChatBot: true };
        } else {
          session.startInactivityTimer();
          return {
            success: false,
            message: '❌ Nenhum item reconhecido. Tente usar termos como \'2 mangas\', \'cinco queijos\', etc.',
            isChatBot: true
          };
        }
      }
    }

    return { success: false, message: 'Estado não reconhecido. Digite \'cancelar\' para reiniciar.', isChatBot: true};
  }

  async getUpdates(sessionId) {
    const session = this.getSession(sessionId);
    const message = session.getPendingMessage();
    
    return {
      state: session.state,
      current_orders: session.getCurrentOrders(),
      reminders_sent: session.reminderCount,
      has_message: message !== null,
      bot_message: message
    };
  }

  getSessionInfo(sessionId) {
    const session = this.getSession(sessionId);
    return {
      state: session.state,
      hasItems: session.hasItems(),
      currentOrders: session.getCurrentOrders()
    };
  }
}

module.exports = new OrderService();