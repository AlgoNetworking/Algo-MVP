const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const { format } = require('mathjs');
const productsConfig = require('../utils/products-config');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.io = null;
    this.userSessions = new Map();
    this.isRunning = false;
    this.pollingInterval = null;
    this.clientUsers = [];
    this.disabledUsers = new Set(); // 🔒 NEW: Track users who disabled bot
    this.isSendingMessages = false; // Add this
    this.bulkMessageProgress = null; // Add this to track progress
  }

  initialize(io) {
    this.io = io;
    console.log('📱 WhatsApp Service initialized');
  }

  async connect(users = null) {
  if (this.isRunning) {
    throw new Error('WhatsApp client already running');
  }

  try {
    this.disabledUsers.clear();
    console.log('🔄 Cleared disabled users list for fresh connection');

    // If no users provided, fetch from database
    if (!users) {
      try {
        const databaseService = require('./database.service');
        const dbClients = await databaseService.getAllClients();
        this.clientUsers = dbClients.map(client => ({
          phone: client.phone,
          name: client.name,
          type: client.order_type,
          answered: client.answered,
          isChatBot: client.is_chatbot
        }));
        console.log(`📋 Loaded ${this.clientUsers.length} clients from database`);
      } catch (error) {
        console.error('❌ Error loading clients from database:', error);
        this.clientUsers = users || [];
      }
    } else {
      this.clientUsers = users;
    }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: './whatsapp-session'
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

      this.setupEventHandlers();
      await this.client.initialize();
      this.isRunning = true;
      this.startPolling();
      
      return { success: true, message: 'WhatsApp client starting...' };
    } catch (error) {
      console.error('❌ Failed to connect WhatsApp:', error);
      this.isRunning = false;
      throw error;
    }
  }

  setupEventHandlers() {
    this.client.on('qr', async (qr) => {
      console.log('📱 QR Code received');
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        if (this.io) {
          this.io.emit('qr-code', { qr, qrDataUrl });
        }
      } catch (error) {
        console.error('❌ QR code generation error:', error);
      }
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp client ready');
      if (this.io) {
        this.io.emit('bot-ready', {
          clientInfo: this.client.info
        });
      }
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated');
      if (this.io) {
        this.io.emit('bot-authenticated');
      }
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
      if (this.io) {
        this.io.emit('bot-error', { message: 'Authentication failed', error: msg });
      }
    });

    this.client.on('disconnected', (reason) => {
      console.log('🔌 Client disconnected:', reason);
      this.isRunning = false;
      this.stopPolling();
      if (this.io) {
        this.io.emit('bot-disconnected', { reason });
      }
    });

    // In the message event handler in whatsapp.service.js
    this.client.on('message', async (message) => {      
      const chat = await message.getChat();
      const formattedSenderPhone = this.formatPhoneNumber(message.from); 
      const fromUser = this.findUserInfo(formattedSenderPhone);
      
      // More comprehensive filtering of system messages
      if(!(message.from === 'status@broadcast' || 
          message.fromMe || 
          chat.isGroup ||
          message.type === 'ack' || // Delivery receipts
          message.type === 'protocol' || // System messages
          message.type === 'e2e_notification' ||
          message.isStatus)) { // Status updates
        await this.handleMessage(message);

        if (this.io) {
          this.io.emit('user-answered-status-update', {
            phone: formattedSenderPhone
          });
        }
      }
    });
  }

  async handleMessage(message) {
    try {
      const sender = message.from;
      const messageBody = message.body;
      const phoneNumber = this.formatPhoneNumber(sender);

      // 🔒 CRITICAL: Skip processing if user previously chose to talk to a person
      if (this.disabledUsers.has(sender)) {
        if(messageBody === 'sair') {
          console.log(`✅ Enabling bot for user: ${phoneNumber}`);
          this.disabledUsers.delete(sender);
          return;
        }
        else {
          console.log(`⏸️ Skipping message from ${phoneNumber} - user previously chose to talk to person`);
          return;
        }
      }

      // 🚨 NEW: Skip messages that were sent before the bot started
      // More robust approach with additional checks
      const messageTimestamp = message.timestamp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const botStartTime = this.botStartTime || currentTime;
      
      // Additional safety margin of 10 seconds to account for timing differences
      const safetyMargin = 10000; // 10 seconds
      
      if (messageTimestamp < (botStartTime - safetyMargin)) {
          console.log(`⏪ Skipping old message from ${phoneNumber} - sent ${Math.round((botStartTime - messageTimestamp) / 1000)}s before bot started`);
          console.log(`   Message time: ${new Date(messageTimestamp).toISOString()}`);
          console.log(`   Bot start: ${new Date(botStartTime).toISOString()}`);
          return;
      }

      // Also skip messages with future timestamps (more than 30 seconds in future)
      if (messageTimestamp > (currentTime + 30000)) {
          console.log(`⏩ Skipping future message from ${phoneNumber} - timestamp in future`);
          return;
      }

      console.log(`📩 Message from ${phoneNumber}: Type: ${message.type}, Body: ${messageBody}`);

      /*
      // 🔒 CRITICAL: Skip processing if user previously chose to talk to a person
      if (this.disabledUsers.has(sender)) {
        console.log(`⏸️ Skipping message from ${phoneNumber} - user previously chose to talk to person`);
        return; // Don't process the message at all
      }
      */

      // Find user info
      const userInfo = this.findUserInfo(phoneNumber);
      
      // Get or create session
      if (!this.userSessions.has(sender)) {
        const sessionId = uuidv4();
        this.userSessions.set(sender, sessionId);
        console.log(`🆕 Session created: ${sessionId} for ${phoneNumber}`);
      }

      const sessionId = this.userSessions.get(sender);

      // Process message through order service
      const response = await orderService.processMessage({
        sessionId,
        message: messageBody,
        messageType: message.type,
        phoneNumber: sender,
        name: userInfo.name,
        orderType: userInfo.type
      });

      // Send response if available
      if (response && response.message) {
        await this.sendMessage(sender, response.message);
      }

      // 🔒 NEW: If user chose option 2, add them to disabled list
      if (response && response.isChatBot === false) {
        console.log(`🚫 Disabling bot for user: ${phoneNumber}`);
        this.disabledUsers.add(sender);
        
        // Also update frontend via socket
        if (this.io) {
          this.io.emit('disable-bot', {
            phone: phoneNumber
          });
        }
      }

      // Emit to connected clients
      /*
      if (this.io) {
        this.io.emit('message-received', {
          from: phoneNumber,
          message: messageBody,
          timestamp: new Date()
        });
      }
      */

    } catch (error) {
      console.error('❌ Error handling message:', error);
      await this.sendMessage(message.from, '❌ Ocorreu um erro. Tente novamente.');
    }
  }


  findUserInfo(phoneNumber) {
   const user = this.clientUsers.find(u => u.phone === phoneNumber);
   console.log(phoneNumber);
    return {
      name: user ? user.name : 'Cliente sem nome',
      type: user ? user.type : 'normal',
      isChatBot: user ? user.isChatBot : true
    };
  }

  formatPhoneNumber(whatsappId) {
    // Convert from "5585999999999@c.us" to "+55 85 99999-9999"
    const numbers = whatsappId.replace('@c.us', '');
    if (numbers.length >= 12) {
      return `+${numbers.slice(0, 2)} ${numbers.slice(2, 4)} ${numbers.slice(4, 8)}-${numbers.slice(8, 12)}`;
    }
    return numbers;
  }

  async sendMessage(recipient, message) {
    if (!this.isRunning || !this.client) {
      console.log('🛑 Cannot send message: Bot not running');
      return false;
    }

    try {
      if (message && message.trim()) {
        await this.client.sendMessage(recipient, message);
        console.log(`✅ Message sent to ${recipient}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      return false;
    }
  }

  async sendBulkMessages(users) {
    if (!this.isRunning) {
      throw new Error('Bot not running');
    }

    this.isSendingMessages = true; // Set sending state
    this.bulkMessageProgress = {
      total: users.length,
      sent: 0,
      failed: 0
    };

    const results = [];

    for (const user of users) {
      if (this.isRunning) {
        try {
          if (user.answered) {
            results.push({ phone: user.phone, status: 'skipped', reason: 'Already answered' });
            this.bulkMessageProgress.sent++; // Count skipped as sent for progress
            continue;
          }

          const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
          
          // Verify number exists
          const numberId = await this.client.getNumberId(phoneId);
          if (!numberId) {
            results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
            this.bulkMessageProgress.failed++;
            continue;
          }

          // Create session
          if (!this.userSessions.has(phoneId)) {
            const sessionId = uuidv4();
            this.userSessions.set(phoneId, sessionId);
            await orderService.startSession(sessionId);
          }

          // Send initial message
          const message = this.generateInitialMessage(user.name);
          await this.sendMessage(phoneId, message);

          results.push({ phone: user.phone, status: 'sent' });
          this.bulkMessageProgress.sent++;

          // Emit progress
          if (this.io) {
            this.io.emit('bulk-message-progress', {
              phone: user.phone,
              name: user.name,
              progress: this.bulkMessageProgress
            });
          }

          // Random delay between 18-30 seconds
          const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
          console.error(`❌ Error sending to ${user.phone}:`, error);
          results.push({ phone: user.phone, status: 'failed', reason: error.message });
          this.bulkMessageProgress.failed++;
        }
      } else {
        console.log("Envio de mensagens interrompido pelo desligamento do bot.");
        break;
      }
    }

    this.isSendingMessages = false; // Reset sending state
    this.bulkMessageProgress = null;

    if (this.io) {
      this.io.emit('bulk-messages-complete', { results });
    }

    return results;
  }

  getSendingStatus() {
    return {
      isSendingMessages: this.isSendingMessages,
      progress: this.bulkMessageProgress
    };
  }

  generateInitialMessage(userName) {
    const user = userName ? ' ' + userName : '';
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
      // "nós" section
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
    const differentIdx = idx1 === idx2 ? (idx1 + 1 < products.length ? idx1 + 1 :  idx1 - 1) : idx2;

    const example = `${Math.floor(Math.random() * 10) + 1} ${products[idx1][0]} e ${Math.floor(Math.random() * 10) + 1} ${products[differentIdx][0]}`;
    const warning = `\n\n(Isto é uma mensagem automática, digite naturalmente como: ${example})`;

    return messages[Math.floor(Math.random() * messages.length)] + warning;
  }

  startPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        for (const [phone, sessionId] of this.userSessions.entries()) {
          try {
            const updates = await orderService.getUpdates(sessionId);
            
            if (updates.has_message && updates.bot_message) {
              await this.sendMessage(phone, updates.bot_message);
            }
          } catch (error) {
            console.error(`❌ Polling error for ${phone}:`, error.message);
          }
        }
      } catch (error) {
        console.error('❌ General polling error:', error);
      }
    }, 5000);

    console.log('🔄 Polling started');
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('🛑 Polling stopped');
  }

  async disconnect() {
    try {
      this.stopPolling();
      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }
      this.isRunning = false;
      this.userSessions.clear();
      console.log('✅ WhatsApp disconnected');
      
      if (this.io) {
        this.io.emit('bot-stopped');
      }
    } catch (error) {
      console.error('❌ Error disconnecting:', error);
    }
  }

  isConnected() {
    return this.isRunning && this.client !== null;
  }

  getActiveSessions() {
    return Array.from(this.userSessions.entries()).map(([phone, sessionId]) => ({
      phone: this.formatPhoneNumber(phone),
      sessionId
    }));
  }
}

module.exports = new WhatsAppService();
