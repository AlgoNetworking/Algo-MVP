// services/whatsapp.service.js - WORKING VERSION WITH HYBRID APPROACH
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const databaseService = require('./database.service');
const fs = require('fs');
const path = require('path');

// 🔥 WORKING: Hybrid PostgreSQL Store
// Let RemoteAuth handle file operations, we just store the data in PostgreSQL
class PostgresStore {
  constructor(db) {
    this.db = db;
    this.isProduction = process.env.DATABASE_URL !== undefined;
    
    // Directory where RemoteAuth stores files
    this.authDir = path.join(__dirname, '..', '.wwebjs_auth', 'session');
  }

  async sessionExists(options) {
    const { session } = options;
    try {
      console.log(`🔍 Checking if session exists in database: ${session}`);
      
      if (this.isProduction) {
        const result = await this.db.query(
          'SELECT COUNT(*) as count FROM whatsapp_sessions WHERE session_id = $1',
          [session]
        );
        const exists = parseInt(result.rows[0].count) > 0;
        console.log(`📊 Database check - Session ${session} exists: ${exists}`);
        return exists;
      } else {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(session);
        const exists = row.count > 0;
        console.log(`📊 Database check - Session ${session} exists: ${exists}`);
        return exists;
      }
    } catch (error) {
      console.error('❌ Error checking session existence:', error);
      return false;
    }
  }

  async save(options) {
    const { session } = options;
    
    try {
      console.log(`💾 Save called for session: ${session}`);
      
      // Wait for RemoteAuth to finish writing files
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Look for the session directory
      const sessionDir = path.join(this.authDir, session);
      
      if (!fs.existsSync(sessionDir)) {
        console.log(`⚠️ Session directory not found: ${sessionDir}`);
        console.log(`📂 Checking if auth directory exists: ${this.authDir}`);
        
        if (!fs.existsSync(this.authDir)) {
          console.log(`📁 Creating auth directory: ${this.authDir}`);
          fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        return;
      }
      
      // Read all files in the session directory
      console.log(`📂 Reading session directory: ${sessionDir}`);
      const files = this.readDirectoryRecursive(sessionDir);
      
      if (files.length === 0) {
        console.log(`⚠️ No files found in session directory`);
        return;
      }
      
      console.log(`📦 Found ${files.length} files to save`);
      
      // Create a JSON structure with all files
      const sessionData = {
        files: files.map(file => ({
          path: path.relative(sessionDir, file.fullPath),
          data: file.data,
          isBase64: file.isBase64
        }))
      };
      
      const jsonData = JSON.stringify(sessionData);
      console.log(`💾 Saving ${(jsonData.length / 1024).toFixed(2)} KB to database`);
      
      // Save to database
      await this.saveToDatabase(session, jsonData);
      
      console.log(`✅ Session saved successfully: ${session}`);
      
    } catch (error) {
      console.error('❌ Error saving session:', error);
      console.error('Stack:', error.stack);
    }
  }
  
  readDirectoryRecursive(dir) {
    const files = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...this.readDirectoryRecursive(fullPath));
      } else {
        try {
          const ext = path.extname(item).toLowerCase();
          const isBinary = ['.zip', '.wwebjs', '.data'].includes(ext);
          
          const data = isBinary 
            ? fs.readFileSync(fullPath, 'base64')
            : fs.readFileSync(fullPath, 'utf8');
          
          files.push({
            fullPath,
            data,
            isBase64: isBinary
          });
        } catch (err) {
          console.error(`⚠️ Error reading file ${fullPath}:`, err.message);
        }
      }
    }
    
    return files;
  }

  async saveToDatabase(session, sessionData) {
    if (this.isProduction) {
      await this.db.query(
        `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (session_id) DO UPDATE SET
         session_data = EXCLUDED.session_data,
         updated_at = CURRENT_TIMESTAMP`,
        [session, sessionData]
      );
    } else {
      const stmt = this.db.prepare(
        `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (session_id) DO UPDATE SET
         session_data = excluded.session_data,
         updated_at = CURRENT_TIMESTAMP`
      );
      stmt.run(session, sessionData);
    }
  }

  async extract(options) {
    const { session, path: extractPath } = options;
    
    try {
      console.log(`📂 Extract called for session: ${session}`);
      console.log(`📂 Extract path: ${extractPath}`);
      
      // Get session data from database
      let sessionDataJson;
      
      if (this.isProduction) {
        const result = await this.db.query(
          'SELECT session_data FROM whatsapp_sessions WHERE session_id = $1',
          [session]
        );
        if (result.rows.length === 0) {
          console.log(`ℹ️ No session found in database for ${session}`);
          return false;
        }
        sessionDataJson = result.rows[0].session_data;
      } else {
        const stmt = this.db.prepare('SELECT session_data FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(session);
        if (!row) {
          console.log(`ℹ️ No session found in database for ${session}`);
          return false;
        }
        sessionDataJson = row.session_data;
      }
      
      console.log(`📦 Retrieved session data (${(sessionDataJson.length / 1024).toFixed(2)} KB)`);
      
      const sessionData = JSON.parse(sessionDataJson);
      
      if (!sessionData.files || sessionData.files.length === 0) {
        console.log(`⚠️ No files in session data`);
        return false;
      }
      
      console.log(`📁 Extracting ${sessionData.files.length} files to ${extractPath}`);
      
      // Create the session directory
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true });
      }
      
      // Write all files
      for (const file of sessionData.files) {
        const filePath = path.join(extractPath, file.path);
        const fileDir = path.dirname(filePath);
        
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        
        if (file.isBase64) {
          fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
        } else {
          fs.writeFileSync(filePath, file.data, 'utf8');
        }
      }
      
      console.log(`✅ Session extracted successfully to ${extractPath}`);
      return true;
      
    } catch (error) {
      console.error('❌ Error extracting session:', error);
      console.error('Stack:', error.stack);
      return false;
    }
  }

  async delete(options) {
    const { session } = options;
    try {
      console.log(`🗑️ Deleting session: ${session}`);
      
      if (this.isProduction) {
        await this.db.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [session]);
      } else {
        const stmt = this.db.prepare('DELETE FROM whatsapp_sessions WHERE session_id = ?');
        stmt.run(session);
      }
      
      console.log(`✅ Session deleted: ${session}`);
    } catch (error) {
      console.error('❌ Error deleting session:', error);
    }
  }
}

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.userSessions = new Map();
    this.io = null;
    this.userQRCodes = new Map();
    this.disabledUsers = new Map();
    this.sendingStatus = new Map();
    this.pollingIntervals = new Map();
    this.botStartTimes = new Map();
    this.postgresStore = null;
    this.saveTimers = new Map(); // Timer to trigger manual saves
  }

  initialize(io) {
    this.io = io;
    
    const db = databaseService.getDatabase();
    this.postgresStore = new PostgresStore(db);
    
    console.log('📱 WhatsApp Service initialized with RemoteAuth + PostgreSQL');
  }

  async connect(userId, users = null) {
    try {
      if (this.clients.has(userId)) {
        await this.disconnect(userId);
      }

      this.disabledUsers.set(userId, new Set());
      this.botStartTimes.set(userId, Date.now());
      
      console.log(`⏰ Bot start time set for user ${userId}: ${new Date(Date.now()).toISOString()}`);

      this.sendingStatus.set(userId, {
        isSendingMessages: false,
        progress: null
      });

      const useRemoteAuth = process.env.DATABASE_URL !== undefined;
      
      const clientConfig = {
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
      };

      if (useRemoteAuth) {
        clientConfig.authStrategy = new RemoteAuth({
          store: this.postgresStore,
          clientId: `user-${userId}`,
          backupSyncIntervalMs: 300000 // 5 minutes
        });
        console.log(`📦 Using RemoteAuth for user ${userId}`);
      } else {
        const { LocalAuth } = require('whatsapp-web.js');
        clientConfig.authStrategy = new LocalAuth({
          clientId: `user-${userId}`
        });
        console.log(`📁 Using LocalAuth for user ${userId}`);
      }

      const client = new Client(clientConfig);

      this.clients.set(userId, client);
      this.userSessions.set(userId, new Map());

      this.setupEventHandlers(userId, client);

      await client.initialize();
      this.startPolling(userId);
      
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
          this.io.to(`user-${userId}`).emit('qr-code', { 
            qr: qrDataUrl,
            userId 
          });
        }
      } catch (error) {
        console.error('❌ QR code generation error:', error);
      }
    });

    client.on('authenticated', () => {
      console.log(`✅ WhatsApp authenticated for user: ${userId}`);
      
      // 🔥 CRITICAL: Trigger manual save after authentication
      console.log(`⏰ Setting up save timer for user ${userId}`);
      
      // Clear any existing timer
      if (this.saveTimers.has(userId)) {
        clearTimeout(this.saveTimers.get(userId));
      }
      
      // Save after 5 seconds to ensure all files are written
      const timer = setTimeout(async () => {
        console.log(`💾 Manually triggering save for user ${userId}`);
        try {
          await this.postgresStore.save({ session: `RemoteAuth-user-${userId}` });
          console.log(`✅ Manual save completed for user ${userId}`);
        } catch (error) {
          console.error(`❌ Manual save failed for user ${userId}:`, error);
        }
      }, 5000);
      
      this.saveTimers.set(userId, timer);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-authenticated', { userId });
      }
    });

    client.on('remote_session_saved', () => {
      console.log(`💾 RemoteAuth auto-save triggered for user ${userId}`);
    });

    client.on('ready', () => {
      console.log('✅ WhatsApp client ready for user:', userId);
      this.userQRCodes.delete(userId);
      
      // Trigger another save when ready
      setTimeout(async () => {
        console.log(`💾 Final save after ready for user ${userId}`);
        try {
          await this.postgresStore.save({ session: `RemoteAuth-user-${userId}` });
          console.log(`✅ Final save completed for user ${userId}`);
        } catch (error) {
          console.error(`❌ Final save failed for user ${userId}:`, error);
        }
      }, 3000);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-ready', {
          userId,
          clientInfo: client.info
        });
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
      
      // Clear save timer
      if (this.saveTimers.has(userId)) {
        clearTimeout(this.saveTimers.get(userId));
        this.saveTimers.delete(userId);
      }
      
      this.clients.delete(userId);
      this.userSessions.delete(userId);
      this.userQRCodes.delete(userId);
      this.disabledUsers.delete(userId);
      this.sendingStatus.delete(userId);
      this.botStartTimes.delete(userId);
      this.stopPolling(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-disconnected', { 
          reason,
          userId 
        });
      }
    });

    client.on('message', async (message) => {
      await this.handleMessage(userId, message);
    });
  }

  // ... Rest of your methods stay exactly the same ...
  // (handleMessage, sendMessage, sendBulkMessages, etc.)

  async handleMessage(userId, message) {
    try {
      const sender = message.from;
      const messageBody = message.body;
      const phoneNumber = this.formatPhoneNumber(sender);

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

      const messageTimestamp = message.timestamp * 1000;
      const currentTime = Date.now();
      const botStartTime = this.botStartTimes.get(userId) || currentTime;
      const safetyMargin = 10000;
      
      if (messageTimestamp < (botStartTime - safetyMargin)) {
        console.log(`⏪ Skipping old message for user ${userId} from ${phoneNumber}`);
        return;
      }

      if (messageTimestamp > (currentTime + 30000)) {
        console.log(`⏩ Skipping future message for user ${userId} from ${phoneNumber}`);
        return;
      }

      const clientUsers = await databaseService.getUserClients(userId);
      const userInfo = this.findUserInfo(clientUsers, phoneNumber);

      if (userInfo) {
        await databaseService.updateClientAnsweredStatusInFolder(
          userId,
          phoneNumber,
          userInfo.folderId || null,
          true
        );
      }

      const userSessions = this.userSessions.get(userId);
      if (!userSessions.has(sender)) {
        const sessionId = uuidv4();
        userSessions.set(sender, sessionId);
        console.log(`🆕 Session created for user ${userId}: ${sessionId} for ${phoneNumber}`);
        
        await orderService.startSession(sessionId, userId);
      }

      const sessionId = userSessions.get(sender);

      const response = await orderService.processMessage({
        userId,
        sessionId,
        message: messageBody,
        messageType: message.type,
        phoneNumber: sender,
        name: userInfo?.name,
        orderType: userInfo?.type
      });

      if (response && response.message) {
        await this.sendMessage(userId, sender, response.message);
      }

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

          const userSessions = this.userSessions.get(userId);
          if (!userSessions.has(phoneId)) {
            const sessionId = uuidv4();
            userSessions.set(phoneId, sessionId);
            await orderService.startSession(sessionId, userId);
          }

          const message = this.generateInitialMessage(user.name);
          await this.sendMessage(userId, phoneId, message);

          results.push({ phone: user.phone, status: 'sent' });
          status.progress.sent++;

          if (this.io) {
            this.io.to(`user-${userId}`).emit('bulk-message-progress', {
              phone: user.phone,
              name: user.name,
              progress: status.progress,
              userId
            });
          }

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

  startPolling(userId) {
    this.stopPolling(userId);

    const pollingInterval = setInterval(async () => {
      const client = this.clients.get(userId);
      if (!client) {
        this.stopPolling(userId);
        return;
      }

      try {
        const userSessions = this.userSessions.get(userId);
        if (!userSessions) return;

        for (const [phone, sessionId] of userSessions.entries()) {
          try {
            const updates = await orderService.getUpdates(sessionId, userId);
            
            if (updates.has_message && updates.bot_message) {
              await this.sendMessage(userId, phone, updates.bot_message);
            }
          } catch (error) {
            console.error(`❌ Polling error for user ${userId}, phone ${phone}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`❌ General polling error for user ${userId}:`, error);
      }
    }, 5000);

    this.pollingIntervals.set(userId, pollingInterval);
    console.log(`🔄 Polling started for user ${userId}`);
  }

  stopPolling(userId) {
    const interval = this.pollingIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(userId);
      console.log(`🛑 Polling stopped for user ${userId}`);
    }
  }

  async disconnect(userId) {
    try {
      this.stopPolling(userId);
      
      // Clear save timer
      if (this.saveTimers.has(userId)) {
        clearTimeout(this.saveTimers.get(userId));
        this.saveTimers.delete(userId);
      }
      
      const client = this.clients.get(userId);
      if (client) {
        await client.destroy();
      }
      
      this.clients.delete(userId);
      this.userSessions.delete(userId);
      this.userQRCodes.delete(userId);
      this.disabledUsers.delete(userId);
      this.sendingStatus.delete(userId);
      this.botStartTimes.delete(userId);
      
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
    const user = userName !== 'Cliente sem nome' ? ' ' + userName : '';
    const messages = [
      `Opa${user}! Estamos no aguardo do seu pedido!`,
      `Olá${user}! Estamos no aguardo do seu pedido!`,
      `Oi${user}! Estamos no aguardo do seu pedido!`
    ];
    
    const example = "2 mangas e 3 queijos";
    let warning = `\n\n(Isto é uma mensagem automática para a sua conveniência 😊, digite naturalmente como: ${example})`;
    warning += '\ndigite "pronto" quando terminar seu pedido ou aguarde a mensagem automática!';

    return messages[Math.floor(Math.random() * messages.length)] + warning;
  }
}

module.exports = new WhatsAppService();