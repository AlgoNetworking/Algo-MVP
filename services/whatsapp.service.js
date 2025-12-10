// services/whatsapp.service.js - WORKING VERSION WITH HYBRID APPROACH
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const databaseService = require('./database.service');
const productsConfig = require('../utils/products-config');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = process.env.WWEBJS_AUTH_PATH || path.join(process.cwd(), '.wwebjs_auth');

// 🔥 WORKING: Hybrid PostgreSQL Store
// Let RemoteAuth handle file operations, we just store the data in PostgreSQL
class PostgresStore {
  constructor(db) {
    this.db = db;
    this.isProduction = process.env.DATABASE_URL !== undefined;
    
    // Directory where RemoteAuth stores files
    this.authDir = path.join(AUTH_DIR, 'session'); // PostgresStore constructor
  }

  normalizeSession(session) {
    if (!session) return session;
    return session.replace(/^RemoteAuth-/, '');
  }

  async sessionExists(options) {
    const { session } = options;
    try {
      console.log(`🔍 Checking if session exists in database: ${session}`);
      const normalized = this.normalizeSession(session);
      
      if (this.isProduction) {
        const result = await this.db.query(
          'SELECT COUNT(*) as count FROM whatsapp_sessions WHERE session_id = $1',
          [normalized]
        );
        const exists = parseInt(result.rows[0].count) > 0;
        console.log(`📊 Database check - Session ${normalized} exists: ${exists}`);
        return exists;
      } else {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(normalized);
        const exists = row && row.count > 0;
        console.log(`📊 Database check - Session ${normalized} exists: ${exists}`);
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
      try {
        const keys = Object.keys(options || {});
        console.log(`🔍 Save options keys: ${keys.join(', ')}`);

        // Log a trimmed JSON of options for debugging (avoid huge payloads)
        try {
          const safe = JSON.stringify(options, (k, v) => {
            if (k === 'session_data' || k === 'data' || k === 'files') return '[REDACTED]';
            return v;
          });
          console.log(`🔍 Save options preview: ${safe.slice(0, 1000)}`);
        } catch (e) {
          console.log('🔍 Could not stringify save options for preview');
        }

        if (options && options.data) {
          try {
            const size = typeof options.data === 'string' ? Buffer.byteLength(options.data) : JSON.stringify(options.data).length;
            console.log(`🔎 Save options contains 'data' (approx ${Math.round(size / 1024)} KB)`);
          } catch (e) {
            console.log('🔎 Save options contains data but size calculation failed');
          }
        }
      } catch (e) {
        console.log('⚠️ Failed to inspect save options', e.message);
      }
      const normalized = this.normalizeSession(session);
      
      // Wait for RemoteAuth to finish writing files
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Look for the session directory
      // RemoteAuth may call with 'RemoteAuth-<clientId>' or '<clientId>'.
      // Try multiple possible local session directory names for robustness.
      const candidates = [
        session,
        normalized,
        `RemoteAuth-${normalized}`,
        `LocalAuth-${normalized}`,
        `LocalAuth-${session}`
      ].filter(Boolean);
      let sessionDir = null;

      // Retry loop: sometimes RemoteAuth triggers save before writing files to disk.
      const maxAttempts = 10;
      const attemptDelayMs = 1000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        for (const cand of candidates) {
          const candPath = path.join(this.authDir, cand);
          if (fs.existsSync(candPath)) {
            sessionDir = candPath;
            break;
          }
        }
        if (sessionDir) break;

        if (attempt < maxAttempts) {
          console.log(`⏳ Session dir not found (attempt ${attempt}/${maxAttempts}), retrying in ${attemptDelayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, attemptDelayMs));
        }
      }

      if (!sessionDir) {
        console.log(`⚠️ Session directory not found for candidates: ${candidates.join(', ')}`);
        console.log(`📂 Checking if auth directory exists: ${this.authDir}`);

        if (!fs.existsSync(this.authDir)) {
          console.log(`📁 Creating auth directory: ${this.authDir}`);
          fs.mkdirSync(this.authDir, { recursive: true });
        }

        try {
          const entries = fs.readdirSync(this.authDir);
          console.log(`📂 Auth dir contents: ${entries.join(', ')}`);
        } catch (e) {
          console.log('⚠️ Could not read auth dir contents:', e.message);
        }

        // Aggressive scan: search .wwebjs_auth for any folder with files.
        try {
          const baseAuth = path.join(__dirname, '..', '.wwebjs_auth');
          const foundDirs = [];

          function scanDir(dir) {
            try {
              const items = fs.readdirSync(dir);
              for (const it of items) {
                const full = path.join(dir, it);
                let stat;
                try { stat = fs.statSync(full); } catch (e) { continue; }
                if (stat.isDirectory()) {
                  // check if directory has any files
                  const inner = fs.readdirSync(full);
                  if (inner && inner.length > 0) {
                    foundDirs.push(full);
                  }
                  // recurse
                  scanDir(full);
                }
              }
            } catch (e) {
              // ignore
            }
          }

          scanDir(baseAuth);

          if (foundDirs.length > 0) {
            console.log(`🔎 Found auth candidate dirs: ${foundDirs.join(' | ')}`);
            // Prefer directories that include the normalized session id
            const prefer = foundDirs.find(d => d.includes(normalized) || d.includes(session));
            const pick = prefer || foundDirs[0];
            console.log(`🔍 Picking ${pick} as session dir candidate`);
            sessionDir = pick;
          } else {
            console.log('🔎 No auth dirs found during aggressive scan');
          }
        } catch (e) {
          console.log('⚠️ Aggressive scan failed:', e.message);
        }

        // If RemoteAuth provided session data directly in options, save it.
        if (options && options.data) {
          try {
            const sessionDataJson = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
            console.log(`💾 Saving session data provided directly by RemoteAuth for ${normalized}`);
            await this.saveToDatabase(normalized, sessionDataJson);
            console.log(`✅ Session saved from options for ${normalized}`);
          } catch (err) {
            console.error('❌ Failed to save session data from options:', err.message);
          }
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
      
      // Save to database using normalized session id
      await this.saveToDatabase(normalized, jsonData);
      
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
    const normalized = this.normalizeSession(session);
    if (this.isProduction) {
      await this.db.query(
        `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (session_id) DO UPDATE SET
         session_data = EXCLUDED.session_data,
         updated_at = CURRENT_TIMESTAMP`,
        [normalized, sessionData]
      );
    } else {
      const stmt = this.db.prepare(
        `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (session_id) DO UPDATE SET
         session_data = excluded.session_data,
         updated_at = CURRENT_TIMESTAMP`
      );
      stmt.run(normalized, sessionData);
    }
  }

  async extract(options) {
    const { session, path: extractPath } = options;
    
    try {
      console.log(`📂 Extract called for session: ${session}`);
      console.log(`📂 Extract path: ${extractPath}`);
      
      // Get session data from database
      let sessionDataJson;
      const normalized = this.normalizeSession(session);

      if (this.isProduction) {
        const result = await this.db.query(
          'SELECT session_data FROM whatsapp_sessions WHERE session_id = $1',
          [normalized]
        );
        if (result.rows.length === 0) {
          console.log(`ℹ️ No session found in database for ${normalized}`);
          return false;
        }
        sessionDataJson = result.rows[0].session_data;
      } else {
        const stmt = this.db.prepare('SELECT session_data FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(normalized);
        if (!row) {
          console.log(`ℹ️ No session found in database for ${normalized}`);
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
      const normalized = this.normalizeSession(session);

      if (this.isProduction) {
        await this.db.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [normalized]);
      } else {
        const stmt = this.db.prepare('DELETE FROM whatsapp_sessions WHERE session_id = ?');
        stmt.run(normalized);
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
    this.usersInSelectedFolder = null;
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
      if(users) {
        this.usersInSelectedFolder = users;
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
        // Production: try to restore session files from DB into local auth dir
        // and use LocalAuth pointing to that clientId. This keeps compatibility
        // with filesystem-based auth while persisting sessions in Postgres.
        try {
          const normalizedSession = `user-${userId}`;
          const candidatePaths = [
            path.join(this.postgresStore.authDir, 'session', normalizedSession),
            path.join(this.postgresStore.authDir, normalizedSession),
            path.join(this.postgresStore.authDir, `RemoteAuth-${normalizedSession}`),
            path.join(this.postgresStore.authDir, `LocalAuth-${normalizedSession}`)
          ];

          console.log(`📂 Attempting to extract session ${normalizedSession} to candidate paths`);
          let anyExtracted = false;
          for (const extractPath of candidatePaths) {
            try {
              const extracted = await this.postgresStore.extract({ session: normalizedSession, path: extractPath });
              if (extracted) {
                console.log(`📁 Session extracted to ${extractPath}`);
                anyExtracted = true;
              } else {
                console.log(`ℹ️ No session data to extract for ${normalizedSession} at ${extractPath}`);
              }
            } catch (e) {
              console.error(`❌ Error extracting to ${extractPath}:`, e.message);
            }
          }

          if (!anyExtracted) {
            console.log(`ℹ️ No session data extracted for ${normalizedSession} to any candidate path`);
          }
        } catch (err) {
          console.error('❌ Error extracting session before LocalAuth:', err.message);
        }

        const { LocalAuth } = require('whatsapp-web.js');
        clientConfig.authStrategy = new LocalAuth({
          clientId: `user-${userId}`,
          dataPath: AUTH_DIR // ensure LocalAuth writes into the mounted dir
        });
        console.log(`📁 Using LocalAuth (restored from Postgres if available) for user ${userId}`);
      } else {
        const { LocalAuth } = require('whatsapp-web.js');
        clientConfig.authStrategy = new LocalAuth({
          clientId: `user-${userId}`,
          dataPath: AUTH_DIR // ensure LocalAuth writes into the mounted dir
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

      const chat = await message.getChat();
      const type = message.type;  
      // More comprehensive filtering of system messages
      if(!(message.from === 'status@broadcast' || 
          message.fromMe || 
          chat.isGroup ||
          type === 'ack' || // Delivery receipts
          type === 'protocol' || // System messages
          type === 'e2e_notification' ||
          message.isStatus) && (
          type === 'chat' ||
          type === 'image' ||
          type === 'video' ||
          type === 'audio' ||
          type === 'document' ||
          type === 'sticker' ||
          type === 'location' ||
          type === 'vcard' ||
          type === 'contacts_array' ||
          type === 'list_response' ||
          type === 'buttons_response' ||
          type === 'poll_creation' ||
          type === 'template_button_reply' ||
          type === 'template_button_list_reply' ||
          type === 'event_creation' ||
          type === 'ptt'
          )
        ) { // Status updates
        await this.handleMessage(userId, message);
      }
    });
  }

  // (handleMessage, sendMessage, sendBulkMessages, etc.)

  async handleMessage(userId, message) {
    try {
      const sender = message.from;
      const messageBody = message.body;
      const phoneNumber = this.formatPhoneNumber(sender);

      const clientUsers = this.usersInSelectedFolder || await databaseService.getClientUsers(userId);
      if(!clientUsers.find(u => u.phone === phoneNumber)) {
        console.log(`🚫 Ignoring message from unregistered number for user ${userId}: ${phoneNumber}`);
        return;
      }

      const userDisabled = this.disabledUsers.get(userId) || new Set();
      if (userDisabled.has(sender)) {
        if (messageBody.toLowerCase() === 'sair') {
          console.log(`✅ Enabling bot for user ${userId}: ${phoneNumber}`);
          userDisabled.delete(sender);
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
        
        // await orderService.startSession(sessionId, userId);
      }

      const sessionId = userSessions.get(sender);

      const response = await orderService.processMessage({
        userId,
        sessionId,
        message: messageBody,
        messageType: message.type,
        phoneNumber: sender,
        name: userInfo?.name || 'Cliente sem nome',
        orderType: userInfo?.type || 'normal'
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

          const message = await this.generateInitialMessage(userId, user.name);
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

  async sendCustomMessages(userId, users, messageText, ignoreInterpretation = true) {
    const client = this.clients.get(userId);
    if (!client) throw new Error('Bot not running for user ' + userId);

    const status = this.sendingStatus.get(userId);
    status.isSendingMessages = true;
    status.progress = { total: users.length, sent: 0, failed: 0, skipped: 0 };
    const results = [];

    for (const user of users) {
      if (!status.isSendingMessages) break;
      try {
        const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
        const numberId = await client.getNumberId(phoneId);
        if (!numberId) {
          results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
          status.progress.failed++;
          continue;
        }

        // IMPORTANT: do NOT create session or call orderService
        await this.sendMessage(userId, phoneId, messageText);

        results.push({ phone: user.phone, status: 'sent' });
        status.progress.sent++;

        if (this.io) {
          this.io.to(`user-${userId}`).emit('bulk-message-progress', {
            phone: user.phone, name: user.name, progress: status.progress, userId
          });
        }

        // optional delay (keep same pattern as bulk to avoid spam): e.g. random between 18-30s
        const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        console.error(`Error sending custom to ${user.phone}:`, error);
        results.push({ phone: user.phone, status: 'failed', reason: error.message });
        status.progress.failed++;
      }
    }

    status.isSendingMessages = false;
    status.progress = null;

    if (this.io) {
      this.io.to(`user-${userId}`).emit('bulk-messages-complete', { results, userId });
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

  async generateInitialMessage(userId, userName) {

    const config = await databaseService.getUserConfig(userId);
    const callByName = config ? config.callByName : true;

    const enabled = true;
    userName = callByName ? userName : 'Cliente sem nome';
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

    const products = await productsConfig.getUserEmptyProductsDb(userId);
    let filteredProducts = [];
    for(const [product, qty] of products) {
      if(product[2] && enabled){
        filteredProducts.push([product[0]]);
      }
    }

    const idx1 = Math.floor(Math.random() * filteredProducts.length);
    const idx2 = Math.floor(Math.random() * filteredProducts.length);
    const differentIdx = idx1 === idx2 ? (idx1 + 1 < filteredProducts.length ? idx1 + 1 :  idx1 - 1) : idx2;

    const example = filteredProducts[0] ?
    `${Math.floor(Math.random() * 10) + 1} ${filteredProducts[idx1]} e ${Math.floor(Math.random() * 10) + 1} ${filteredProducts[differentIdx]}`
    : null;
    let hint = `\n\n(Isto é uma mensagem automática para a sua conveniência 😊`;
    hint += example
      ? `, digite naturalmente como: ${example})` 
      : `)`;
    hint += '\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!\n';
    hint += '*Caso não queira pedir, digite \"cancelar\".*';
    return messages[Math.floor(Math.random() * messages.length)] + hint;
  }
}

module.exports = new WhatsAppService();