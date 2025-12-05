const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const { format } = require('mathjs');
const productsConfig = require('../utils/products-config');
const databaseService = require('./database.service');

class WhatsAppService {
  constructor() {
    // Store per-user clients and sessions
    this.userClients = new Map(); // userId -> client
    this.userQRCodes = new Map(); // userId -> qrCode
    this.userSessions = new Map(); // userId -> Map(phoneId -> sessionId)
    this.userClientData = new Map(); // userId -> clientUsers array
    this.userDisabledUsers = new Map(); // userId -> Set(disabled phone IDs)
    this.userSendingStatus = new Map(); // userId -> sending status
    this.userPollingIntervals = new Map(); // userId -> polling interval
    this.io = null;
  }

  initialize(io) {
    this.io = io;
    console.log('📱 WhatsApp Service initialized (Multi-Tenant)');
  }

  async connect(users = null, userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (this.isUserConnected(userId)) {
      throw new Error('WhatsApp client already running for this user');
    }

    try {
      // ✅ ADD: Load products for this user
      const productsConfig = require('../utils/products-config');
      await productsConfig.loadProducts(userId);
      console.log(`✅ Products loaded for user ${userId}`);

      // Clear disabled users for this user
      this.userDisabledUsers.set(userId, new Set());
      console.log(`🔄 Cleared disabled users list for user ${userId}`);

      // Store client users for this user
      this.userClientData.set(userId, users || []);

      if (users && users.length > 0) {
        console.log(`📋 Loaded ${users.length} clients for user ${userId}`);
      }

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: `user_${userId}`,
          dataPath: `./whatsapp-session-${userId}`
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

      this.setupUserEventHandlers(client, userId);
      await client.initialize();
      this.userClients.set(userId, client);
      
      // Initialize user sessions map
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Map());
      }
      
      this.startUserPolling(userId);
      
      return { success: true, message: 'WhatsApp client starting...' };
    } catch (error) {
      console.error(`❌ Failed to connect WhatsApp for user ${userId}:`, error);
      this.userClients.delete(userId);
      throw error;
    }
  }

  setupUserEventHandlers(client, userId) {
    // Store bot start time when client is ready
    client.once('ready', () => {
      client.botStartTime = Date.now();
      console.log(`✅ WhatsApp client ready for user ${userId}`);
      this.userClients.set(userId, client);
      this.userQRCodes.delete(userId);
      
      if (this.io) {
        this.io.emit('bot-ready', {
          userId,
          clientInfo: client.info
        });
      }
    });

    client.on('qr', async (qr) => {
      console.log(`📱 QR Code received for user ${userId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.userQRCodes.set(userId, { qr, qrDataUrl });
        
        if (this.io) {
          this.io.emit('qr-code', { userId, qr, qrDataUrl });
        }
      } catch (error) {
        console.error('❌ QR code generation error:', error);
      }
    });

    client.on('authenticated', () => {
      console.log(`✅ WhatsApp authenticated for user ${userId}`);
    });

    client.on('auth_failure', (msg) => {
      console.error(`❌ Authentication failed for user ${userId}:`, msg);
      this.userQRCodes.delete(userId);
    });

    client.on('disconnected', (reason) => {
      console.log(`🔌 WhatsApp disconnected for user ${userId}:`, reason);
      this.cleanupUser(userId);
      
      if (this.io) {
        this.io.emit('bot-disconnected', { userId, reason });
      }
    });

    client.on('message', async (message) => {
      await this.handleUserMessage(message, userId, client);
    });
  }

  async handleUserMessage(message, userId, client) {
    try {
      const chat = await message.getChat();
      const formattedSenderPhone = this.formatPhoneNumber(message.from);
      
      // Filter system messages
      if (message.from === 'status@broadcast' || 
          message.fromMe || 
          chat.isGroup ||
          message.type === 'ack' ||
          message.type === 'protocol' ||
          message.type === 'e2e_notification' ||
          message.isStatus) {
        return;
      }

      // Get user's disabled users set
      const disabledUsers = this.userDisabledUsers.get(userId) || new Set();
      
      // Skip if user disabled bot
      if (disabledUsers.has(message.from)) {
        if (message.body === 'sair') {
          console.log(`✅ Enabling bot for user ${userId}, phone: ${formattedSenderPhone}`);
          disabledUsers.delete(message.from);
          return;
        } else {
          console.log(`⏸️ Skipping message for user ${userId} - bot disabled by user`);
          return;
        }
      }

      // Skip old messages
      const messageTimestamp = message.timestamp * 1000;
      const currentTime = Date.now();
      const botStartTime = client.botStartTime || currentTime;
      const safetyMargin = 10000;
      
      if (messageTimestamp < (botStartTime - safetyMargin)) {
        console.log(`⏪ Skipping old message for user ${userId}`);
        return;
      }

      if (messageTimestamp > (currentTime + 30000)) {
        console.log(`⏩ Skipping future message for user ${userId}`);
        return;
      }

      console.log(`📩 Message for user ${userId} from ${formattedSenderPhone}`);

      // Find user info from this user's clients
      const clientUsers = this.userClientData.get(userId) || [];
      const userInfo = clientUsers.find(u => u.phone === formattedSenderPhone);

      // Mark as answered
      if (userInfo && userInfo.folderId) {
        try {
          await databaseService.updateClientAnsweredStatusInFolder(
            formattedSenderPhone, 
            userInfo.folderId, 
            true,
            userId
          );
          console.log(`✅ Marked ${formattedSenderPhone} as answered for user ${userId}`);
        } catch (error) {
          console.error('❌ Error updating answered status:', error);
        }
      }

      // Get or create session for this user
      const userSessionsMap = this.userSessions.get(userId) || new Map();
      if (!userSessionsMap.has(message.from)) {
        const sessionId = uuidv4();
        userSessionsMap.set(message.from, sessionId);
        this.userSessions.set(userId, userSessionsMap);
        console.log(`🆕 Session created for user ${userId}: ${sessionId}`);
      }

      const sessionId = userSessionsMap.get(message.from);

      // Process message through order service
      const response = await orderService.processMessage({
        sessionId,
        message: message.body,
        messageType: message.type,
        phoneNumber: message.from,
        name: userInfo?.name || 'Cliente sem nome',
        orderType: userInfo?.type || 'normal',
        userId
      });

      // Send response if available
      if (response && response.message) {
        await this.sendUserMessage(message.from, response.message, userId);
      }

      // Disable bot if user chose option 2
      if (response && response.isChatBot === false) {
        console.log(`🚫 Disabling bot for user ${userId}, phone: ${formattedSenderPhone}`);
        disabledUsers.add(message.from);
        
        if (this.io) {
          this.io.emit('disable-bot', {
            userId,
            phone: formattedSenderPhone
          });
        }
      }

    } catch (error) {
      console.error(`❌ Error handling message for user ${userId}:`, error);
      await this.sendUserMessage(message.from, '❌ Ocorreu um erro. Tente novamente.', userId);
    }
  }

  formatPhoneNumber(whatsappId) {
    const numbers = whatsappId.replace('@c.us', '');
    if (numbers.length >= 12) {
      return `+${numbers.slice(0, 2)} ${numbers.slice(2, 4)} ${numbers.slice(4, 8)}-${numbers.slice(8, 12)}`;
    }
    return numbers;
  }

  async sendUserMessage(recipient, message, userId) {
    const client = this.userClients.get(userId);
    
    if (!client || !this.isClientHealthy(client)) {
      console.log(`🛑 Cannot send message for user ${userId}: Bot not running`);
      return false;
    }

    try {
      if (message && message.trim()) {
        await client.sendMessage(recipient, message);
        console.log(`✅ Message sent for user ${userId} to ${recipient}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Error sending message for user ${userId}:`, error);
      return false;
    }
  }

  isClientHealthy(client) {
    return client && 
           client.pupPage && 
           !client.pupPage.isClosed() && 
           client.info;
  }

  async sendBulkMessages(users, userId) {
    const client = this.userClients.get(userId);
    
    if (!client || !this.isClientHealthy(client)) {
      throw new Error('Bot not running for this user');
    }

    const sendingStatus = {
      isSendingMessages: true,
      progress: {
        total: users.length,
        sent: 0,
        failed: 0,
        skipped: 0
      }
    };
    
    this.userSendingStatus.set(userId, sendingStatus);

    const results = [];

    for (const user of users) {
      if (this.isUserConnected(userId)) {
        try {
          if (user.answered) {
            console.log(`⏭️ Skipping ${user.phone} - already answered`);
            results.push({ phone: user.phone, status: 'skipped', reason: 'Already answered' });
            sendingStatus.progress.skipped++;
            continue;
          }

          const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
          const numberId = await client.getNumberId(phoneId);
          
          if (!numberId) {
            results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
            sendingStatus.progress.failed++;
            continue;
          }

          // Create session
          const userSessionsMap = this.userSessions.get(userId) || new Map();
          if (!userSessionsMap.has(phoneId)) {
            const sessionId = uuidv4();
            userSessionsMap.set(phoneId, sessionId);
            this.userSessions.set(userId, userSessionsMap);
            await orderService.startSession(sessionId);
          }

          const message = this.generateInitialMessage(user.name);
          await this.sendUserMessage(phoneId, message, userId);

          results.push({ phone: user.phone, status: 'sent' });
          sendingStatus.progress.sent++;

          if (this.io) {
            this.io.emit('bulk-message-progress', {
              userId,
              phone: user.phone,
              name: user.name,
              progress: sendingStatus.progress
            });
          }

          const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
          console.error(`❌ Error sending to ${user.phone}:`, error);
          results.push({ phone: user.phone, status: 'failed', reason: error.message });
          sendingStatus.progress.failed++;
        }
      } else {
        console.log(`Sending interrupted for user ${userId}`);
        break;
      }
    }

    sendingStatus.isSendingMessages = false;
    this.userSendingStatus.set(userId, sendingStatus);

    if (this.io) {
      this.io.emit('bulk-messages-complete', { userId, results });
    }

    return results;
  }

  getSendingStatus(userId) {
    const status = this.userSendingStatus.get(userId);
    return {
      isSendingMessages: status?.isSendingMessages || false,
      progress: status?.progress || null
    };
  }

  generateInitialMessage(userName) {
    const user = userName !== 'Cliente sem nome' ? ' ' + userName : '';
    const messages = [
      `Opa${user}! Estamos no aguardo do seu pedido!`, 
      `Olá${user}! Estamos no aguardo do seu pedido!`,
      `Oi${user}! Estamos no aguardo do seu pedido!`,
      `Opa${user}! Já estamos no aguardo do seu pedido!`,
      `Olá${user}! Já estamos no aguardo do seu pedido!`,
      `Oi${user}! Já estamos no aguardo do seu pedido!`,
      `Opa${user}! Já estamos no aguardo do pedido!`,
      `Olá${user}! Já estamos no aguardo do pedido!`,
      `Oi${user}! Já estamos no aguardo do pedido!`,
      `Opa${user}! Estamos aguardando o pedido!`,
      `Olá${user}! Estamos aguardando o pedido!`,
      `Oi${user}! Estamos aguardando o pedido!`,
      `Opa${user}! Já estamos aguardando o pedido!`,
      `Olá${user}! Já estamos aguardando o pedido!`,
      `Oi${user}! Já estamos aguardando o pedido!`,
      `Opa${user}! Nós estamos no aguardo do seu pedido!`, 
      `Olá${user}! Nós estamos no aguardo do seu pedido!`,
      `Oi${user}! Nós estamos no aguardo do seu pedido!`,
      `Opa${user}! Nós já estamos no aguardo do seu pedido!`,
      `Olá${user}! Nós já estamos no aguardo do seu pedido!`,
      `Oi${user}! Nós já estamos no aguardo do seu pedido!`,
      `Opa${user}! Nós já estamos no aguardo do pedido!`,
      `Olá${user}! Nós já estamos no aguardo do pedido!`,
      `Oi${user}! Nós já estamos no aguardo do pedido!`,
      `Opa${user}! Nós estamos aguardando o pedido!`,
      `Olá${user}! Nós estamos aguardando o pedido!`,
      `Oi${user}! Nós estamos aguardando o pedido!`,
      `Opa${user}! Nós já estamos aguardando o pedido!`,
      `Olá${user}! Nós já estamos aguardando o pedido!`,
      `Oi${user}! Nós já estamos aguardando o pedido!`
    ];

    const products = productsConfig.PRODUCTS;
    const idx1 = Math.floor(Math.random() * products.length);
    const idx2 = Math.floor(Math.random() * products.length);
    const differentIdx = idx1 === idx2 ? (idx1 + 1 < products.length ? idx1 + 1 : idx1 - 1) : idx2;

    const example = `${Math.floor(Math.random() * 10) + 1} ${products[idx1][0]} e ${Math.floor(Math.random() * 10) + 1} ${products[differentIdx][0]}`;
    let warning = `\n\n(Isto é uma mensagem automática para a sua conveniência 😊, digite naturalmente como: ${example})`;
    warning += '\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!';

    return messages[Math.floor(Math.random() * messages.length)] + warning;
  }

  startUserPolling(userId) {
    // Clear existing interval if any
    if (this.userPollingIntervals.has(userId)) {
      clearInterval(this.userPollingIntervals.get(userId));
    }

    const interval = setInterval(async () => {
      const client = this.userClients.get(userId);
      if (!client || !this.isClientHealthy(client)) return;

      try {
        const userSessionsMap = this.userSessions.get(userId) || new Map();
        
        for (const [phone, sessionId] of userSessionsMap.entries()) {
          try {
            const updates = await orderService.getUpdates(sessionId);
            
            if (updates.has_message && updates.bot_message) {
              await this.sendUserMessage(phone, updates.bot_message, userId);
            }
          } catch (error) {
            console.error(`❌ Polling error for user ${userId}, phone ${phone}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`❌ General polling error for user ${userId}:`, error);
      }
    }, 5000);

    this.userPollingIntervals.set(userId, interval);
    console.log(`🔄 Polling started for user ${userId}`);
  }

  stopUserPolling(userId) {
    if (this.userPollingIntervals.has(userId)) {
      clearInterval(this.userPollingIntervals.get(userId));
      this.userPollingIntervals.delete(userId);
      console.log(`🛑 Polling stopped for user ${userId}`);
    }
  }

  async disconnect(userId) {
    try {
      this.stopUserPolling(userId);
      
      const client = this.userClients.get(userId);
      if (client) {
        await client.destroy();
      }
      
      // Reset answered status for this user's folder
      const clientUsers = this.userClientData.get(userId) || [];
      if (clientUsers.length > 0) {
        const folderId = clientUsers[0]?.folderId;
        if (folderId) {
          console.log(`🔄 Resetting answered status for user ${userId}, folder ${folderId}`);
          await databaseService.resetAnsweredStatusForFolder(folderId, userId);
        }
      }
      
      this.cleanupUser(userId);
      
      console.log(`✅ WhatsApp disconnected for user ${userId}`);
      
      if (this.io) {
        this.io.emit('bot-stopped', { userId });
      }
    } catch (error) {
      console.error(`❌ Error disconnecting user ${userId}:`, error);
    }
  }

  cleanupUser(userId) {
    this.userClients.delete(userId);
    this.userQRCodes.delete(userId);
    this.userSessions.delete(userId);
    this.userClientData.delete(userId);
    this.userDisabledUsers.delete(userId);
    this.userSendingStatus.delete(userId);
    this.stopUserPolling(userId);
  }

  isUserConnected(userId) {
    const client = this.userClients.get(userId);
    return client !== undefined && this.isClientHealthy(client);
  }

  getUserActiveSessions(userId) {
    const userSessionsMap = this.userSessions.get(userId) || new Map();
    return Array.from(userSessionsMap.entries()).map(([phone, sessionId]) => ({
      phone: this.formatPhoneNumber(phone),
      sessionId
    }));
  }

  // For Socket.IO - get QR code for specific user
  getUserQRCode(userId) {
    return this.userQRCodes.get(userId) || null;
  }

  // Check if any user is connected (for admin purposes)
  isConnected() {
    return this.userClients.size > 0;
  }

  getActiveSessions() {
    // Return all sessions across all users (for debugging)
    const allSessions = [];
    for (const [userId, sessionsMap] of this.userSessions.entries()) {
      for (const [phone, sessionId] of sessionsMap.entries()) {
        allSessions.push({
          userId,
          phone: this.formatPhoneNumber(phone),
          sessionId
        });
      }
    }
    return allSessions;
  }
}

module.exports = new WhatsAppService();