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
    this.hasDisabledProducts = false; // Add this flag
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
    // Only start timer if there are enabled items
    if (this.hasEnabledItems() && !this.hasDisabledItems()) {
      this.activeTimer = setTimeout(() => this.sendSummary(), 5000);
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
      const summary = this.buildSummary(enabledItems); // Pass only enabled items
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
    if (this.hasEnabledItems() && this.phoneNumber) {
      const parsedOrders = [];
      for (const [product, qty] of this.currentDb) {
        const [mainName, akas, enabled] = product;
        if (enabled && qty > 0) {
          parsedOrders.push({ productName: mainName, qty, score: 100.0 });
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

  buildSummary(items = null) {
    let summary = '📋 **RESUMO DO SEU PEDIDO:**\n';
    const itemsToShow = items || this.currentDb.filter(([_, qty]) => qty > 0);
    
    for (const [product, qty] of itemsToShow) {
      if (qty > 0) {
        const [mainName, akas, enabled] = product;
        if (enabled) { // Only show enabled products in summary
          summary += `• ${mainName}: ${qty}\n`;
        }
      }
    }
    summary += '\n⚠️ **Confirma o pedido?** (responda com \'confirmar\' ou \'nao\')';
    return summary;
  }

  checkCancelCommand(message) {
    const cancelCommands = ['cancelar', 'não', 'nao'];
    return cancelCommands.includes(message);
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
        message: `Perdão, mas o nosso programa de mensagens automáticas ainda não entende mensagens que não sejam de texto. \n\nVocê deseja:\nrealizar um pedido (digite "*1*");\ntirar dúvida com uma pessoa (digite "*2*");\nver a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?`,
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
        message: `${greeting} Isso é uma mensagem automática.\n\nVocê deseja:\nrealizar um pedido (digite "*1*");\ntirar dúvida com uma pessoa (digite "*2*");\nver a lista de produtos (digite "*3*") ou\nsaber mais sobre o programa e como usá-lo (digite "*4*")?`,
        isChatBot: true
      };
    }

    // Handle option selection
    if (session.state === 'option' && session.waitingForOption) {
      if (messageLower === '1') {
        session.waitingForOption = false;
        session.state = 'collecting';
        session.startInactivityTimer();

        const products = productsConfig.PRODUCTS;
        
            const idx1 = Math.floor(Math.random() * products.length);
            const idx2 = Math.floor(Math.random() * products.length);
            const differentIdx = idx1 === idx2 ? (idx1 + 1 < products.length ? idx1 + 1 :  idx1 - 1) : idx2;
        
            const example = `${Math.floor(Math.random() * 10) + 1} ${products[idx1][0]} e ${Math.floor(Math.random() * 10) + 1} ${products[differentIdx][0]}`;
        return {
          success: true,
          message: `Ótimo! Digite seus pedidos. Exemplo: \"${example}\"\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!`,
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
        info += 'O programa oferece quatro opções quando está no menu inicial: "*1*" para realizar um pedido, "*2*" para tirar uma dúvida com uma pessoa, "*3*" para ver a lista de produtos e "*4*" para ler a mensagem que você está lendo agora.\n\n';
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
          message: 'Por favor, escolha uma opção:\n("*1*") para pedir;\n("*2*") para tirar uma dúvida com uma pessoa;\n("*3*") para ver a lista de produtos ou\n("*4*") para saber mais sobre o programa e como usá-lo',
          isChatBot: true
        };
      }
    }

    // Handle confirmation
    if (session.state === 'confirming') {
      const confirmWords = ['confirmar', 'confimar', 'confirma', 'confima','sim', 's'];
      const denyWords = ['nao', 'não', 'n', 'cancelar'];

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
            errorMessage += `• ${item.product}\n`;
          });
          errorMessage += '\nEstes itens foram removidos. Você pode:\n';
          errorMessage += '1. Continuar adicionando outros produtos\n';
          errorMessage += '2. Digitar "pronto" para enviar o pedido\n';
          errorMessage += '3. Digitar "cancelar" para cancelar o seu pedido';
          
          return {
            success: false,
            message: errorMessage,
            isChatBot: true
          };
        }
        
        // Rest of confirmation logic remains the same...
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

      } else if (denyWords.includes(messageLower)) {
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
            errorMessage += `• ${item.product}\n`;
          });
          errorMessage += '\nConfirmação interrompida. Você pode:\n';
          errorMessage += '1. Continuar adicionando outros produtos\n';
          errorMessage += '2. Digitar "pronto" para enviar o pedido sem estes itens\n';
          errorMessage += '3. Digitar "cancelar" para cancelar o seu pedido';
          
          return {
            success: false,
            message: errorMessage,
            isChatBot: true
          };
        }
        
        if (parsedOrders.length > 0) {
          session.currentDb = updatedDb;
          session.cancelTimer();
          session.state = 'collecting'; // Go back to collecting state
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
          // Check if there are any disabled products in current orders
          const hasDisabledProducts = session.currentDb.some(([product, qty]) => {
            const [_, __, enabled] = product;
            return !enabled && qty > 0;
          });
          

          // console.log(hasDisabledProducts); aparentemente isso aqui embaixo nunca vai ser usado
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
                isChatBot: true
              };
            }
            
            return { success: true, message: '📋 Preparando seu resumo...', isChatBot: true };
          } else {
            // No disabled products, proceed normally
            session.sendSummary();
            return { success: true, message: '📋 Preparando seu resumo...', isChatBot: true };
          }
        } else {
          return { success: false, message: '❌ Lista vazia. Adicione itens primeiro.', isChatBot: true };
        }
      } else {
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
            errorMessage += `• ${item.product}\n`;
          });
          errorMessage += '\nVocê pode:\n';
          errorMessage += '1. Continuar adicionando outros produtos\n';
          errorMessage += '2. Digitar "pronto" para enviar o pedido sem estes itens\n';
          errorMessage += '3. Digitar "cancelar" para cancelar o seu pedido';
          
          return {
            success: false,
            message: errorMessage,
            isChatBot: true
          };
        }
        
        if (parsedOrders.length > 0) {
          session.currentDb = updatedDb;
          session.startInactivityTimer(); // Only start timer if no disabled products
          return { success: true, isChatBot: true };
        } else {
          session.startInactivityTimer();
          return {
            success: false,
            message: '☹️ Desculpa, não consegui reconhecer nenhum item... Tente usar termos como \'2 mangas\', \'cinco queijos\'. Se desejar cancelar o pedido, digite \"cancelar\".',
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