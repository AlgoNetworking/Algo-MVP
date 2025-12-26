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

const __lidPhoneCache = new Map();
function cacheSetLidPhone(lid, phone, ttlMs = 1000 * 60 * 5) {
  __lidPhoneCache.set(String(lid), { phone, expiresAt: Date.now() + ttlMs });
}
function cacheGetLidPhone(lid) {
  const e = __lidPhoneCache.get(String(lid));
  if (!e) return null;
  if (e.expiresAt < Date.now()) { __lidPhoneCache.delete(String(lid)); return null; }
  return e.phone;
}

/**
 * Batch resolve usando client.getContactLidAndPhone(userIds).
 * Retorna objeto { <lid>: <phone> } (phone pode ser '5585...' ou '5585...@c.us')
 */
async function batchResolveLidsToPhones(client, userIds = []) {
  const result = {};
  if (!client || !Array.isArray(userIds) || userIds.length === 0) return result;

  // usar cache
  const toQuery = [];
  for (const id of userIds) {
    const cached = cacheGetLidPhone(id);
    if (cached) result[id] = cached;
    else toQuery.push(id);
  }
  if (toQuery.length === 0) return result;

  try {
    const res = await client.getContactLidAndPhone(toQuery);

    // Normaliza formas defensivamente
    if (!res) {
      // nada retornado
    } else if (Array.isArray(res)) {
      for (let i = 0; i < res.length; i++) {
        const r = res[i];
        const lid = toQuery[i];
        if (!r) continue;
        if (typeof r === 'string') {
          result[lid] = r;
          cacheSetLidPhone(lid, r);
        } else if (r.phone) {
          const key = String(r.lid || lid);
          result[key] = r.phone;
          cacheSetLidPhone(key, r.phone);
        } else {
          const maybe = Object.values(r).find(v => typeof v === 'string' && /\d{6,}/.test(v));
          if (maybe) { result[lid] = maybe; cacheSetLidPhone(lid, maybe); }
        }
      }
    } else if (typeof res === 'object') {
      // forma map-like { "<lid>": "5585..." } ou { lid: 'x', phone: 'y' }
      for (const k of Object.keys(res)) {
        const v = res[k];
        if (typeof v === 'string' && /\d{6,}/.test(v)) {
          result[String(k)] = v;
          cacheSetLidPhone(k, v);
        } else if (v && v.phone) {
          result[String(k)] = v.phone;
          cacheSetLidPhone(k, v.phone);
        }
      }
    } else if (typeof res === 'string' && toQuery.length === 1) {
      result[toQuery[0]] = res;
      cacheSetLidPhone(toQuery[0], res);
    }
  } catch (err) {
    (console.debug || console.log)('batchResolveLidsToPhones error', err);
  }

  return result;
}

/** Conveniência: resolve um único lid */
async function resolveLidToPhone(client, lid) {
  if (!lid) return null;
  const cached = cacheGetLidPhone(lid);
  if (cached) return cached;
  const map = await batchResolveLidsToPhones(client, [lid]);
  return map[String(lid)] || null;
}

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
    this.requestSendingStatus = new Map();  // For request messages
    this.customSendingStatus = new Map();   // For custom messages
    this.sendingStatus = new Map();   // DEPRECATED
    this.pollingIntervals = new Map();
    this.botStartTimes = new Map();
    this.postgresStore = null;
    this.saveTimers = new Map(); // Timer to trigger manual saves
    this.usersInSelectedFolder = new Map();
    this.connectingUsers = new Set();
  }

  initialize(io) {
    this.io = io;
    
    const db = databaseService.getDatabase();
    this.postgresStore = new PostgresStore(db);
    
    console.log('📱 WhatsApp Service initialized with RemoteAuth + PostgreSQL');
  }

  isConnecting(userId) {
    return this.connectingUsers.has(userId);
  }

  async connect(userId, users = null) {
    try {
      // Check if user is enabled before connecting
      const enabled = await databaseService.isUserEnabled(userId);
      if (!enabled) {
        console.log(`⚠️ User ${userId} attempted to start bot but is disabled`);
        return {
          success: false,
          message: 'Conta desabilitada. Contate o administrador.'
        };
      }
    } catch (err) {
      console.error('Error verifying enabled flag:', err);
      return {
        success: false,
        message: 'Erro interno ao verificar permissão do usuário. Tente novamente mais tarde.'
      };
    }
    
    try {
      // Check if already connecting or connected
      if (this.clients.has(userId)) {
        const client = this.clients.get(userId);
        // Check if client is in the process of connecting
        if (client && client.pupetteer && client.pupetteer.browser && !client.pupetteer.browser.connected) {
          return {
            success: false,
            message: 'Já está conectando. Aguarde...'
          };
        }
        await this.disconnect(userId);
      }
      // mark as connecting and notify UI
      this.connectingUsers.add(userId);
      if (this.io) {
          const requestStatus = this.getRequestSendingStatus(userId);
          const customStatus = this.getCustomSendingStatus(userId);
          
          this.io.to(`user-${userId}`).emit('bot-status', {
              isConnected: true,
              isConnecting: false,
              sessions: this.getActiveSessions(userId),
              isSendingRequestMessages: requestStatus.isSendingRequestMessages,
              requestProgress: requestStatus.requestProgress,
              isSendingCustomMessages: customStatus.isSendingCustomMessages,
              customProgress: customStatus.customProgress
          });
      }
            
      if (users && Array.isArray(users)) {
        this.setSelectedFolderForUser(userId, users);
        console.log(`📁 Selected folder set for user ${userId}: ${Array.isArray(users) ? users.length + ' entries' : String(users)}`);
      }
      else {
        console.log(`connect(): received non-array users for user ${userId}`, { users });
      }

      this.disabledUsers.set(userId, new Set());
      this.botStartTimes.set(userId, Date.now());
      
      console.log(`⏰ Bot start time set for user ${userId}: ${new Date(Date.now()).toISOString()}`);

      this.requestSendingStatus.set(userId, {
          isSendingRequestMessages: false,
          requestProgress: null
      });

      this.customSendingStatus.set(userId, {
          isSendingCustomMessages: false,
          customProgress: null
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
          dataPath: AUTH_DIR
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
      // Clean up on error
      if (this.clients.has(userId)) {
        this.clients.delete(userId);
      }
      if (this.userSessions.has(userId)) {
        this.userSessions.delete(userId);
      }
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

      // Clear connecting flag
      this.connectingUsers.delete(userId);

      // emit bot-ready as before
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-ready', {
          userId,
          clientInfo: client.info
        });

        // emit updated bot-status (connected, not connecting)
        const requestStatus = this.getRequestSendingStatus(userId) || { isSendingRequestMessages: false, progress: null };
        const customStatus = this.getCustomSendingStatus(userId) || { isSendingCustomMessages: false, progress: null };
        
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: true,
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          isSendingRequestMessages: requestStatus.isSendingRequestMessages,
          requestProgress: requestStatus.requestProgress,
          isSendingCustomMessages: customStatus.isSendingCustomMessages,
          customProgress: customStatus.customProgress
        });
      }
    });

    client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed for user:', userId, msg);
      this.userQRCodes.delete(userId);

      // clear connecting
      this.connectingUsers.delete(userId);

      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-error', {
          message: 'Authentication failed',
          error: msg,
          userId
        });
        // also emit updated bot-status (not connected, not connecting)
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: false,
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          isSendingRequestMessages: false,
          requestProgress: null,
          isSendingCustomMessages: false,
          customProgress: null
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
      this.requestSendingStatus.delete(userId);
      this.customSendingStatus.delete(userId);
      this.botStartTimes.delete(userId);
      this.stopPolling(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-disconnected', { 
          reason,
          userId 
        });

        // updated status
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: false,
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          isSendingRequestMessages: false,
          requestProgress: null,
          isSendingCustomMessages: false,
          customProgress: null
        });
      }
    });

    client.on('message', async (message) => {
      const chat = await message.getChat();
      const type = message.type;
      
      // Updated filtering to handle @lid
      const isValidMessage = !(
        message.from === 'status@broadcast' || 
        message.fromMe || 
        chat.isGroup ||
        message.from.includes('@g.us') ||  // Add explicit group check
        message.from.includes('broadcast') ||  // Add explicit broadcast check
        type === 'ack' ||
        type === 'protocol' ||
        type === 'e2e_notification' ||
        message.isStatus
      ) && (
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
      );
      
      if (isValidMessage) {
        await this.handleMessage(userId, message);
      }
    });
  }

  // require logger and databaseService as used elsewhere
  async getClientUsersFor(userId) {
    // 1) attempt in-memory selected folder (per-user Map)
    try {
      const selectedRaw = this.usersInSelectedFolder && this.usersInSelectedFolder.get
        ? this.usersInSelectedFolder.get(userId)
        : null;

      if (selectedRaw) {
        const arr = this.coerceToClientArray(selectedRaw, { source: 'map', userId, stack: new Error().stack.split('\n').slice(0,6) });
        if (arr.length) return arr;
        // if empty after coercion, fallthrough to DB
      }

      // 2) fallback to DB
      const dbRaw = await databaseService.getUserClients(userId);
      console.log('DEBUG dbRaw sample for user', userId, typeof dbRaw, Object.keys(dbRaw||{}).slice(0,6));
      const arrFromDb = this.coerceToClientArray(dbRaw, { source: 'db', userId, stack: new Error().stack.split('\n').slice(0,6) });
      if (arrFromDb.length) return arrFromDb;

      // 3) nothing useful — log full objects (first time only)
      console.log(`getClientUsersFor: no clients found (map or db) for user ${userId}`, {
        mapSample: (selectedRaw && (Array.isArray(selectedRaw) ? selectedRaw.length : Object.keys(selectedRaw || {}).slice(0,6))) || null,
        dbSample: (dbRaw && (Array.isArray(dbRaw) ? dbRaw.length : Object.keys(dbRaw || {}).slice(0,6))) || null,
      });

      return [];
    } catch (err) {
      console.error(`getClientUsersFor: unexpected error for user ${userId}`, err && (err.stack || err));
      return [];
    }
  }


  coerceToClientArray(raw, ctx = {}) {
    // If already an array — done.
    if (Array.isArray(raw)) return raw;

    // Prepare a small diagnostic preview for logging
    const preview = (() => {
      try {
        const keys = raw && typeof raw === 'object' ? Object.keys(raw).slice(0,6) : String(raw).slice(0,200);
        return { type: typeof raw, keys };
      } catch (e) { return { type: typeof raw, keys: [] }; }
    })();

    // 1) common wrappers
    if (raw && typeof raw === 'object') {
      // common shapes: { clients: [...] } or { data: [...] } or { users: [...] }
      if (Array.isArray(raw.clients)) return raw.clients;
      if (Array.isArray(raw.data)) return raw.data;
      if (Array.isArray(raw.users)) return raw.users;

      // If it's an object keyed by phone or id, convert values -> array
      const maybeValues = Object.values(raw);
      if (maybeValues.length > 0 && maybeValues.every(v => typeof v === 'object')) {
        console.log(`coerceToClientArray: converting object->array (likely map)`, { ctx, preview });
        return maybeValues;
      }
    }

    // Not convertible -> log what it was and return empty array
    console.error(`coerceToClientArray: unexpected clientUsers shape; coerced to []`, { ctx, preview });
    return [];
  }

  setSelectedFolderForUser(userId, users) {
    if (!users) {
      this.usersInSelectedFolder.delete(userId);
      return;
    }
    if (!Array.isArray(users)) {
      const coerced = this.coerceToClientArray(users, { source: 'setSelectedFolderForUser', userId });
      if (!coerced.length) {
        console.log(`setSelectedFolderForUser: received invalid users for ${userId}; ignoring`, { userId });
        return;
      }
      this.usersInSelectedFolder.set(userId, coerced);
      return;
    }
    this.usersInSelectedFolder.set(userId, users);
  }

  async handleMessage(userId, message) {
    try {
      let sender = message.from;
      const messageBody = message.body;
      let phoneNumber = this.formatPhoneNumber(sender);
      let phoneNumberDigits = this.extractDigitsFromJid(sender);

      // Enhanced logging for @lid
      const senderType = sender.includes('@lid') ? '@lid' : sender.includes('@c.us') ? '@c.us' : 'unknown';
      console.log(`📨 Message from ${senderType}: raw=${sender}, digits=${phoneNumberDigits}, formatted=${phoneNumber}`);

      // Check if user is still enabled
      const enabled = await databaseService.isUserEnabled(userId);
      if (!enabled) {
        console.log(`⚠️ User ${userId} is disabled, stopping message processing`);
        await this.disconnect(userId);
        return;
      }

      // Skip invalid formats
      if (sender.includes('@g.us') || sender.includes('status@') || sender.includes('broadcast')) {
        console.log(`Received group/broadcast/system message: ${sender}`);
        return;
      }

      // Updated validation for @lid
      if (!this.isLikelyPhoneDigits(phoneNumberDigits)) {
        console.log(`🚫 Ignoring message from invalid WhatsApp id for user ${userId}: raw='${sender}', digits='${phoneNumberDigits}', type='${senderType}'`);
        return;
      }

      // Get clients
      const clientUsers = await this.getClientUsersFor(userId);
      
      if (clientUsers.length === 0) {
        console.log(`⚠️ clientUsers empty for user ${userId}. incoming from=${sender}`);
      }
      
      console.log(`ℹ️ Using ${this.usersInSelectedFolder.has(userId) ? 'selected folder' : 'DB clients'} for user ${userId} (clients: ${clientUsers?.length || 0})`);

      // Find client - this is where the matching happens
      let clientInfo = this.findUserInfoByDigits(clientUsers, phoneNumberDigits);

      // If not found and sender looks like a @lid, attempt to resolve via wwebjs client.getContactLidAndPhone
      if (!clientInfo && String(sender).includes('@lid')) {
        try {
          const client = this.clients.get(userId);
          if (client && typeof client.getContactLidAndPhone === 'function') {
            const lid = String(sender).split('@')[0];
            console.log(`ℹ️ Attempting to resolve lid "${lid}" for user ${userId}`);
            const resolvedPhone = await resolveLidToPhone(client, lid); // helper above

            if (resolvedPhone) {
              // normalize digits only
              const resolvedDigits = String(resolvedPhone).split('@')[0].replace(/\D/g, '');
              console.log(`✅ Resolved lid "${lid}" -> ${resolvedDigits}`);

              // update variables to normalized @c.us id
              sender = `${resolvedDigits}@c.us`;
              phoneNumber = this.formatPhoneNumber(sender);
              phoneNumberDigits = resolvedDigits;

              // re-check client list with resolved digits
              clientInfo = this.findUserInfoByDigits(clientUsers, phoneNumberDigits);

              if (clientInfo) {
                console.log(`ℹ️ Mapped lid ${lid} -> ${sender} to existing client`);
              } else {
                console.log(`ℹ️ Resolved lid ${lid} -> ${sender} but no matching client entry found for user ${userId}`);
              }
            } else {
              console.log(`⚠️ getContactLidAndPhone returned nothing usable for lid "${lid}"`);
            }
          } else {
            console.log(`⚠️ client.getContactLidAndPhone not available for user ${userId}`);
          }
        } catch (err) {
          console.error('❌ Error resolving @lid:', err);
        }
      }

      if (!clientInfo) {
        console.log(`🚫 Ignoring message from unregistered number for user ${userId}: raw='${sender}', digits='${phoneNumberDigits}', type='${senderType}'`);
        console.log(`📋 Available client numbers (first 5):`, clientUsers.slice(0, 5).map(c => ({
          phone: c.phone,
          normalized: c.phone ? String(c.phone).replace(/\D/g, '') : 'none'
        })));
        return;
      }

      if (clientInfo.interpret === false) {
        try {
          // mark answered (so bulk/invites skip them)
          await databaseService.updateClientAnsweredStatus(userId, phoneNumber, true);

          // emit socket update so UI reflects answered state
          if (this.io) {
            this.io.to(`user-${userId}`).emit('client-answered', {
              phone: phoneNumber,
              userId
            });
          }

          console.log(`⏸️ Skipping interpretation for ${phoneNumber} (interpret disabled). Marked as answered.`);
        } catch (err) {
          console.error('Error marking client as answered for interpret-disabled client:', err);
        }
        // do not call orderService or any interpretation logic
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

      if (response && (
        response.isChatBot === false || 
        response.clientStatus === 'wontOrder' || 
        response.clientStatus === 'confirmedOrder'
      )) {

        const clientUsers = await this.getClientUsersFor(userId);

        if(response.isChatBot === false) {
          console.log(`🚫 Disabling bot for user ${userId}: ${phoneNumber}`);
          userDisabled.add(sender);
          if (this.io) {
            this.io.to(`user-${userId}`).emit('disable-bot', {
              phone: phoneNumber,
              userId,
              clients: clientUsers
            });
          }
        }
        if(response.clientStatus === 'wontOrder') {
          if (this.io) {
            this.io.to(`user-${userId}`).emit('wont-order', {
              phone: phoneNumber,
              userId,
              clients: clientUsers
            });
          }
        }
        if(response.clientStatus === 'confirmedOrder') {
          if (this.io) {
            this.io.to(`user-${userId}`).emit('confirmed-order', {
              phone: phoneNumber,
              userId,
              clients: clientUsers
            });
          }
        }
        // Also emit notification update
        const unreadCount = await databaseService.getUnreadNotificationsCount(userId);
        this.io.to(`user-${userId}`).emit('notifications-update', { unreadCount });
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
        // Ensure recipient has proper WhatsApp ID format
        let formattedRecipient = recipient;
        if (!recipient.includes('@')) {
          formattedRecipient = recipient.replace(/[+\-\s]/g, '') + '@c.us';
        }
        // If it already has @lid or @c.us, use as-is
        
        await client.sendMessage(formattedRecipient, message);
        console.log(`✅ Message sent from user ${userId} to ${formattedRecipient}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error sending message for user', userId, error);
      return false;
    }
  }

  async sendBulkMessages(userId, users) {
    // Check if user is still enabled before sending bulk messages
    const enabled = await databaseService.isUserEnabled(userId);
    if (!enabled) {
        console.log(`⚠️ User ${userId} is disabled, cannot send bulk messages`);
        await this.disconnect(userId);
        throw new Error('Conta desabilitada. Não é possível enviar mensagens.');
    }

    const client = this.clients.get(userId);
    if (!client) {
        throw new Error('Bot not running for user ' + userId);
    }

    // Use requestSendingStatus for request bulk messages
    const status = this.requestSendingStatus.get(userId);
    status.isSendingRequestMessages = true;
    status.requestProgress = {
      total: users.length,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    const results = [];

    for (const user of users) {
        if (status.isSendingRequestMessages) {
            try {
                // Check user enabled status before each message
                const enabled = await databaseService.isUserEnabled(userId);
                if (!enabled) {
                    console.log(`⚠️ User ${userId} was disabled during bulk sending, stopping`);
                    status.isSendingRequestMessages = false;
                    await this.disconnect(userId);
                    break;
                }

                if (user.answered) {
                    results.push({ phone: user.phone, status: 'skipped', reason: 'Already answered' });
                    status.requestProgress.skipped++;
                    continue;
                }

                const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
                const numberId = await client.getNumberId(phoneId);
                
                if (!numberId) {
                    results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
                    status.requestProgress.failed++;
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
                status.requestProgress.sent++;

                // Emit request-specific progress
                if (this.io) {
                    this.io.to(`user-${userId}`).emit('request-bulk-message-progress', {
                        phone: user.phone,
                        name: user.name,
                        progress: status.requestProgress,
                        userId
                    });
                }

                const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));

            } catch (error) {
                console.error(`❌ Error sending to ${user.phone} for user ${userId}:`, error);
                results.push({ phone: user.phone, status: 'failed', reason: error.message });
                status.requestProgress.failed++;
            }
        } else {
            console.log(`Envio de mensagens de pedido interrompido para usuário ${userId}`);
            break;
        }
    }

    // Clear request sending status
    status.isSendingRequestMessages = false;
    status.progress = null;

    if (this.io) {
        this.io.to(`user-${userId}`).emit('bulk-messages-complete', { 
            results,
            userId 
        });
    }

    return results;
  }

  async sendCustomBulkMessages(userId, users, message) {
    // Check if user is still enabled before sending custom bulk messages
    const enabled = await databaseService.isUserEnabled(userId);
    if (!enabled) {
        console.log(`⚠️ User ${userId} is disabled, cannot send custom bulk messages`);
        await this.disconnect(userId);
        throw new Error('Conta desabilitada. Não é possível enviar mensagens.');
    }

    const client = this.clients.get(userId);
    if (!client) {
        throw new Error('Bot not running for user ' + userId);
    }

    // Use customSendingStatus for custom bulk messages
    const status = {
        isSendingCustomMessages: true,
        customProgress: {
            total: users.length,
            sent: 0,
            failed: 0,
            skipped: 0
        }
    };
    this.customSendingStatus.set(userId, status);

    const results = [];

    for (const user of users) {
        if (status.isSendingCustomMessages) {
            try {
                // Check user enabled status before each message
                const enabled = await databaseService.isUserEnabled(userId);
                if (!enabled) {
                    console.log(`⚠️ User ${userId} was disabled during custom bulk sending, stopping`);
                    status.isSendingCustomMessages = false;
                    await this.disconnect(userId);
                    break;
                }

                const phoneId = user.phone.replace(/[+\-\s]/g, '') + '@c.us';
                const numberId = await client.getNumberId(phoneId);
                
                if (!numberId) {
                    results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
                    status.customProgress.failed++;
                    continue;
                }

                // ⚠️ CRITICAL: NO session creation, NO orderService.startSession()
                // Just send the raw message
                await this.sendMessage(userId, phoneId, message);

                results.push({ phone: user.phone, status: 'sent' });
                status.customProgress.sent++;

                // Emit custom-specific progress
                if (this.io) {
                    this.io.to(`user-${userId}`).emit('custom-bulk-message-progress', {
                        phone: user.phone,
                        name: user.name,
                        progress: status.customProgress,
                        userId
                    });
                }

                // Random delay between messages
                const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));

            } catch (error) {
                console.error(`❌ Error sending custom message to ${user.phone} for user ${userId}:`, error);
                results.push({ phone: user.phone, status: 'failed', reason: error.message });
                status.customProgress.failed++;
            }
        } else {
            console.log(`Envio de mensagens customizadas interrompido para usuário ${userId}`);
            break;
        }
    }

    // Clear custom sending status
    status.isSendingCustomMessages = false;
    this.customSendingStatus.set(userId, status);

    if (this.io) {
        this.io.to(`user-${userId}`).emit('custom-bulk-messages-complete', { 
            results,
            userId 
        });
    }

    return results;
  }
  /*
  getSendingStatus(userId) {
    return this.sendingStatus.get(userId) || {
      isSendingRequestMessages: false,
      requestProgress: null,
      isSendingCustomMessages: false,
      customProgress: null,
    };
  }
  */
  getRequestSendingStatus(userId) {
    return this.requestSendingStatus.get(userId) || {
        isSendingRequestMessages: false,
        requestProgress: null
    };
  }

  getCustomSendingStatus(userId) {
      return this.customSendingStatus.get(userId) || {
          isSendingCustomMessages: false,
          customProgress: null
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
        // Check if user is still enabled before processing
        const enabled = await databaseService.isUserEnabled(userId);
        if (!enabled) {
          console.log(`⚠️ User ${userId} is disabled during polling, disconnecting`);
          this.stopPolling(userId);
          await this.disconnect(userId);
          return;
        }

        const userSessions = this.userSessions.get(userId);
        if (!userSessions) return;

        for (const [phone, sessionId] of userSessions.entries()) {
          try {
            const updates = await orderService.getUpdates(sessionId, userId);
            
            if (updates.has_message && updates.bot_message) {
              await this.sendMessage(userId, phone, updates.bot_message[0]);
            }
          
            if (updates.has_message && updates.client_status[1] === 'autoConfirmedOrder') {

              const clientUsers = await this.getClientUsersFor(userId);

              if (this.io) {
                this.io.to(`user-${userId}`).emit('auto-confirmed-order', {
                  phone: this.formatPhoneNumber(phone),
                  userId,
                  clients: clientUsers
                });
              }
              
              // Also emit notification update
              const unreadCount = await databaseService.getUnreadNotificationsCount(userId);
              this.io.to(`user-${userId}`).emit('notifications-update', { unreadCount });
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
      this.requestSendingStatus.delete(userId);
      this.customSendingStatus.delete(userId);
      this.botStartTimes.delete(userId);
      this.usersInSelectedFolder.delete(userId);
      
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
    const normalize = (p) => {
      if (!p && p !== 0) return '';
      return String(p).replace(/\D/g, ''); // keep only digits
    };

    const target = normalize(phoneNumber);

    // try exact digits match first, then fallback to original equality if needed
    return users.find(u => {
      const up = normalize(u.phone);
      return up && up === target;
    }) || null;
  }

  findUserInfoByDigits(users, targetDigits) {
    const normalize = (p) => (p ? String(p).replace(/\D/g, '') : '');
    return users.find(u => {
      const up = normalize(u.phone);
      return up && up === targetDigits;
    }) || null;
  }

  formatPhoneNumber(whatsappId) {
    // Handle both @c.us and @lid formats
    const numbers = whatsappId.replace('@c.us', '').replace('@lid', '');
    
    if (numbers.length >= 12) {
      return `+${numbers.slice(0, 2)} ${numbers.slice(2, 4)} ${numbers.slice(4, 8)}-${numbers.slice(8, 12)}`;
    }
    return numbers;
  }

  extractDigitsFromJid(raw) {
    if (!raw) return '';
    // Handle both @c.us and @lid formats
    const left = String(raw).split('@')[0];
    return left.replace(/\D/g, ''); // keep only digits
  }

  isLikelyPhoneDigits(digits) {
    // @lid numbers can be longer (15+ digits), so expand the range
    return /^\d{8,20}$/.test(digits);
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