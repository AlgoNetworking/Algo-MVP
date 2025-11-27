const databaseService = require('./database.service');
const orderParser = require('../utils/order-parser');

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
    return [
      ['abacaxi', 0], ['abacaxi com hortelã', 0], ['açaí', 0], ['acerola', 0],
      ['ameixa', 0], ['cajá', 0], ['cajú', 0], ['goiaba', 0], ['graviola', 0],
      ['manga', 0], ['maracujá', 0], ['morango', 0], ['seriguela', 0], ['tamarindo', 0],
      ['caixa de ovos', 0], ['ovo', 0], ['queijo', 0]
    ];
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
          parsedOrders.push({ product, qty, score: 100.0 });
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
        summary += `• ${product}: ${qty}\n`;
      }
    }
    summary += '\n⚠️ **Confirma o pedido?** (responda com \'confirmar\' ou \'nao\')';
    return summary;
  }

  checkCancelCommand(message) {
    const cancelCommands = ['cancelar', 'hoje não', 'hoje nao'];
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

  async processMessage({ sessionId, message, phoneNumber, name, orderType }) {
    const session = this.getSession(sessionId);
    
    if (phoneNumber) session.phoneNumber = phoneNumber;
    if (name) session.name = name;
    if (orderType) session.orderType = orderType;

    const messageLower = message.toLowerCase().trim();
    session.lastActivity = Date.now();

    // Check for cancel
    if (session.checkCancelCommand(messageLower)) {
      session.state = 'waiting_for_next';
      session.resetCurrent();
      return { success: true, message: null };
    }

    // Handle waiting_for_next
    if (session.state === 'waiting_for_next') {
      session.state = 'option';
      session.waitingForOption = true;
      const greeting = name !== 'Cliente sem nome' ? `Olá ${name}!` : 'Olá!';
      return {
        success: true,
        message: `${greeting}\n\nVocê quer pedir(digite 1) ou falar com o gerente(digite 2)?`
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
          message: 'Ótimo! Digite seus pedidos. Ex: \'2 mangas e 3 queijos\''
        };
      } else if (messageLower === '2') {
        session.waitingForOption = false;
        session.state = 'waiting_for_next';
        return {
          success: true,
          message: 'Ok então.'
        };
      } else {
        return {
          success: false,
          message: 'Por favor, escolha uma opção: 1 para pedir ou 2 para falar com o gerente.'
        };
      }
    }

    // Handle confirmation
    if (session.state === 'confirming') {
      const confirmWords = ['confirmar', 'sim', 's'];
      const denyWords = ['nao', 'não', 'n'];

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
              parsedOrders.push({ product, qty, score: 100.0 });
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
          response += `• ${qty}x ${product}\n`;
        }
        
        const thankYou = session.name !== 'Cliente sem nome' 
          ? `\nObrigado pelo pedido, ${session.name}! 🎉\n\n`
          : '\nObrigado pelo pedido! 🎉\n\n';
        response += thankYou;

        return { success: true, message: response };

      } else if (denyWords.some(w => messageLower.split(' ').includes(w))) {
        session.cancelTimer();
        session.resetCurrent();
        session.startInactivityTimer();
        return {
          success: true,
          message: '🔄 **Lista limpa!** Digite novos itens.'
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
          return { success: true };
        } else {
          return {
            success: false,
            message: '❌ Item não reconhecido. Digite \'confirmar\' para confirmar ou \'nao\' para cancelar.'
          };
        }
      }
    }

    // Handle collection
    if (session.state === 'collecting') {
      if (['pronto', 'confirmar'].includes(messageLower)) {
        if (session.hasItems()) {
          session.sendSummary();
          return { success: true, message: '📋 Preparando seu resumo...' };
        } else {
          return { success: false, message: '❌ Lista vazia. Adicione itens primeiro.' };
        }
      } else {
        const { parsedOrders, updatedDb } = orderParser.parse(message, session.currentDb);
        session.currentDb = updatedDb;
        
        if (parsedOrders.length > 0) {
          session.startInactivityTimer();
          return { success: true };
        } else {
          session.startInactivityTimer();
          return {
            success: false,
            message: '❌ Nenhum item reconhecido. Tente usar termos como \'2 mangas\', \'cinco queijos\', etc.'
          };
        }
      }
    }

    return { success: false, message: 'Estado não reconhecido. Digite \'cancelar\' para reiniciar.' };
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