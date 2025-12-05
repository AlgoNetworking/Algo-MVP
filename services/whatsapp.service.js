const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const databaseService = require('./database.service');

class WhatsAppService {
  constructor() {
    this.clients = new Map(); // userId -> client
    this.userSessions = new Map(); // userId -> userSessions map
    this.io = null;
    this.userQRCodes = new Map(); // userId -> QR code
    this.disabledUsers = new Map(); // userId -> Set of disabled phone numbers
    this.sendingStatus = new Map(); // userId -> sending status
  }

  initialize(io) {
    this.io = io;
    console.log('📱 WhatsApp Service initialized for multi-tenant');
  }

  async connect(userId, users = null) {
    try {
      // Clean up previous client if exists
      if (this.clients.has(userId)) {
        await this.disconnect(userId);
      }

      // Clear disabled users for this user
      this.disabledUsers.set(userId, new Set());

      // Initialize sending status
      this.sendingStatus.set(userId, {
        isSendingMessages: false,
        progress: null
      });

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: `user-${userId}` // Unique session per user
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      this.clients.set(userId, client);
      this.userSessions.set(userId, new Map());

      this.setupEventHandlers(userId, client);

      await client.initialize();
      
      return { success: true, message: 'WhatsApp client starting...' };
    } catch (error) {
      console.error('❌ Failed to connect WhatsApp for user', userId, error);
      throw error;
    }
  }

  setupEventHandlers(userId, client) {
    client.on('qr', async (qr) => {
      console.log('📱 QR Code received for user:', userId);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.userQRCodes.set(userId, qrDataUrl);
        
        if (this.io) {
          // Emit to this specific user's sockets
          this.io.to(`user-${userId}`).emit('qr-code', { 
            qr: qrDataUrl,
            userId 
          });
        }
      } catch (error) {
        console.error('❌ QR code generation error:', error);
      }
    });

    client.on('ready', () => {
      console.log('✅ WhatsApp client ready for user:', userId);
      this.userQRCodes.delete(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-ready', {
          userId,
          clientInfo: client.info
        });
      }
    });

    client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated for user:', userId);
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-authenticated', { userId });
      }
    });

    client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed for user:', userId, msg);
      this.userQRCodes.delete(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-error', { 
          message: 'Authentication failed', 
          error: msg,
          userId 
        });
      }
    });

    client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp disconnected for user:', userId, 'Reason:', reason);
      this.clients.delete(userId);
      this.userSessions.delete(userId);
      this.userQRCodes.delete(userId);
      this.disabledUsers.delete(userId);
      this.sendingStatus.delete(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-disconnected', { 
          reason,
          userId 
        });
      }
    });

    // Message handler
    client.on('message', async (message) => {
      await this.handleMessage(userId, message);
    });
  }

  async handleMessage(userId, message) {
    try {
      const sender = message.from;
      const messageBody = message.body;
      const phoneNumber = this.formatPhoneNumber(sender);

      // Get user's disabled users
      const userDisabled = this.disabledUsers.get(userId) || new Set();
      if (userDisabled.has(sender)) {
        if (messageBody === 'sair') {
          console.log(`✅ Enabling bot for user ${userId}: ${phoneNumber}`);
          userDisabled.delete(sender);
          return;
        } else {
          console.log(`⏸️ Skipping message from ${phoneNumber} - user chose to talk to person`);
          return;
        }
      }

      // Get user's clients from their folder
      const clientUsers = await databaseService.getUserClients(userId);
      const userInfo = this.findUserInfo(clientUsers, phoneNumber);

      // Update answered status if needed
      if (userInfo) {
        // FIXED: Correct parameter order for updateClientAnsweredStatusInFolder
        await databaseService.updateClientAnsweredStatusInFolder(
          userId,        // userId first
          phoneNumber,   // phone
          userInfo.folderId || null, // folderId
          true           // answered
        );
      }

      // Get or create session
      const userSessions = this.userSessions.get(userId);
      if (!userSessions.has(sender)) {
        const sessionId = uuidv4();
        userSessions.set(sender, sessionId);
        console.log(`🆕 Session created for user ${userId}: ${sessionId} for ${phoneNumber}`);
        
        // Start the session and ensure products are loaded
        await orderService.startSession(sessionId, userId);
      }

      const sessionId = userSessions.get(sender);

      // Process message through order service
      const response = await orderService.processMessage({
        userId,
        sessionId,
        message: messageBody,
        messageType: message.type,
        phoneNumber: sender,
        name: userInfo?.name,
        orderType: userInfo?.type
      });

      // Send response if available
      if (response && response.message) {
        await this.sendMessage(userId, sender, response.message);
      }

      // Handle user choosing to talk to person
      if (response && response.isChatBot === false) {
        console.log(`🚫 Disabling bot for user ${userId}: ${phoneNumber}`);
        userDisabled.add(sender);
        
        if (this.io) {
          this.io.to(`user-${userId}`).emit('disable-bot', {
            phone: phoneNumber,
            userId
          });
        }
      }

    } catch (error) {
      console.error('❌ Error handling message for user', userId, error);
      await this.sendMessage(userId, message.from, '❌ Ocorreu um erro. Tente novamente.');
    }
  }

  async sendMessage(userId, recipient, message) {
    const client = this.clients.get(userId);
    if (!client) {
      console.log('🛑 Cannot send message: No client for user', userId);
      return false;
    }

    try {
      if (message && message.trim()) {
        await client.sendMessage(recipient, message);
        console.log(`✅ Message sent from user ${userId} to ${recipient}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error sending message for user', userId, error);
      return false;
    }
  }

  async sendBulkMessages(userId, users) {
    const client = this.clients.get(userId);
    if (!client) {
      throw new Error('Bot not running for user ' + userId);
    }

    const status = this.sendingStatus.get(userId);
    status.isSendingMessages = true;
    status.progress = {
      total: users.length,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    const results = [];

    for (const user of users) {
      if (status.isSendingMessages) {
        try {
          if (user.answered) {
            results.push({ phone: user.phone, status: 'skipped', reason: 'Already answered' });
            status.progress.skipped++;
            continue;
          }

          const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
          const numberId = await client.getNumberId(phoneId);
          
          if (!numberId) {
            results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
            status.progress.failed++;
            continue;
          }

          // Create session if not exists
          const userSessions = this.userSessions.get(userId);
          if (!userSessions.has(phoneId)) {
            const sessionId = uuidv4();
            userSessions.set(phoneId, sessionId);
            await orderService.startSession(sessionId);
          }

          // Send initial message
          const message = this.generateInitialMessage(user.name);
          await this.sendMessage(userId, phoneId, message);

          results.push({ phone: user.phone, status: 'sent' });
          status.progress.sent++;

          // Emit progress
          if (this.io) {
            this.io.to(`user-${userId}`).emit('bulk-message-progress', {
              phone: user.phone,
              name: user.name,
              progress: status.progress,
              userId
            });
          }

          // Random delay
          const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
          console.error(`❌ Error sending to ${user.phone} for user ${userId}:`, error);
          results.push({ phone: user.phone, status: 'failed', reason: error.message });
          status.progress.failed++;
        }
      } else {
        console.log(`Envio de mensagens interrompido para usuário ${userId}`);
        break;
      }
    }

    status.isSendingMessages = false;
    status.progress = null;

    if (this.io) {
      this.io.to(`user-${userId}`).emit('bulk-messages-complete', { 
        results,
        userId 
      });
    }

    return results;
  }

  getSendingStatus(userId) {
    return this.sendingStatus.get(userId) || {
      isSendingMessages: false,
      progress: null
    };
  }

  async disconnect(userId) {
    try {
      const client = this.clients.get(userId);
      if (client) {
        await client.destroy();
      }
      
      this.clients.delete(userId);
      this.userSessions.delete(userId);
      this.userQRCodes.delete(userId);
      this.disabledUsers.delete(userId);
      this.sendingStatus.delete(userId);
      
      console.log('✅ WhatsApp disconnected for user:', userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-stopped', { userId });
      }
    } catch (error) {
      console.error('❌ Error disconnecting WhatsApp for user', userId, error);
    }
  }

  async disconnectAll() {
    const promises = Array.from(this.clients.keys()).map(userId => 
      this.disconnect(userId)
    );
    await Promise.all(promises);
  }

  isConnected(userId) {
    const client = this.clients.get(userId);
    return client !== undefined && client !== null;
  }

  getActiveSessions(userId) {
    const userSessions = this.userSessions.get(userId);
    if (!userSessions) return [];
    
    return Array.from(userSessions.entries()).map(([phone, sessionId]) => ({
      phone: this.formatPhoneNumber(phone),
      sessionId
    }));
  }

  getQRCode(userId) {
    return this.userQRCodes.get(userId);
  }

  // Helper methods
  findUserInfo(users, phoneNumber) {
    return users.find(u => u.phone === phoneNumber) || null;
  }

  formatPhoneNumber(whatsappId) {
    const numbers = whatsappId.replace('@c.us', '');
    if (numbers.length >= 12) {
      return `+${numbers.slice(0, 2)} ${numbers.slice(2, 4)} ${numbers.slice(4, 8)}-${numbers.slice(8, 12)}`;
    }
    return numbers;
  }

  generateInitialMessage(userName) {
    // Same as before but simplified
    const user = userName !== 'Cliente sem nome' ? ' ' + userName : '';
    const messages = [
      `Opa${user}! Estamos no aguardo do seu pedido!`,
      `Olá${user}! Estamos no aguardo do seu pedido!`,
      `Oi${user}! Estamos no aguardo do seu pedido!`
    ];
    
    const example = "2 mangas e 3 queijos";
    let warning = `\n\n(Isto é uma mensagem automática para a sua conveniência 😊, digite naturalmente como: ${example})`;
    warning += '\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!';

    return messages[Math.floor(Math.random() * messages.length)] + warning;
  }
}

module.exports = new WhatsAppService();