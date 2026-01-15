// services/whatsapp.service.js - BAILEYS IMPLEMENTATION
const originalLog = console.log;
const originalInfo = console.info;

const filterLogs = (args) => {
    // Convert all arguments to a string to check for the noisy keywords
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    const noisyKeywords = [
        'SessionEntry',
        'Closing session',
        'Removing old closed session',
        'Closing stale open session'
    ];

    return noisyKeywords.some(keyword => message.includes(keyword));
};

console.log = (...args) => {
    if (filterLogs(args)) return;
    originalLog(...args);
};

console.info = (...args) => {
    if (filterLogs(args)) return;
    originalInfo(...args);
};

const { 
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const databaseService = require('./database.service');
const productsConfig = require('../utils/products-config');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const session = require('express-session');

const AUTH_DIR = process.env.WWEBJS_AUTH_PATH || path.join(process.cwd(), '.wwebjs_auth');

// Logger configuration
const logger = P({ level: 'silent' }); // Set to 'debug' for verbose logging

// PostgreSQL/SQLite store for Baileys auth
class BaileysAuthStore {
  constructor(db, isProduction) {
    this.db = db;
    this.isProduction = isProduction;
  }

  async saveState(userId, state) {
    const stateJson = JSON.stringify(state);
    const sessionId = `baileys-${userId}`;
    
    try {
      if (this.isProduction) {
        await this.db.query(`
          INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (session_id) DO UPDATE SET
          session_data = EXCLUDED.session_data,
          updated_at = CURRENT_TIMESTAMP
        `, [sessionId, stateJson]);
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_id) DO UPDATE SET
          session_data = excluded.session_data,
          updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(sessionId, stateJson);
      }
    } catch (error) {
      console.error('Error saving Baileys state:', error);
    }
  }

  async loadState(userId) {
    const sessionId = `baileys-${userId}`;
    
    try {
      if (this.isProduction) {
        const result = await this.db.query(
          'SELECT session_data FROM whatsapp_sessions WHERE session_id = $1',
          [sessionId]
        );
        if (result.rows.length > 0) {
          return JSON.parse(result.rows[0].session_data);
        }
      } else {
        const stmt = this.db.prepare(
          'SELECT session_data FROM whatsapp_sessions WHERE session_id = ?'
        );
        const row = stmt.get(sessionId);
        if (row) {
          return JSON.parse(row.session_data);
        }
      }
    } catch (error) {
      console.error('Error loading Baileys state:', error);
    }
    
    return null;
  }

  async deleteState(userId) {
    const sessionId = `baileys-${userId}`;
    
    try {
      if (this.isProduction) {
        await this.db.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
      } else {
        const stmt = this.db.prepare('DELETE FROM whatsapp_sessions WHERE session_id = ?');
        stmt.run(sessionId);
      }
    } catch (error) {
      console.error('Error deleting Baileys state:', error);
    }
  }
}

// services/whatsapp.service.js - UPDATED WITH PAUSE/RESUME/STOP + ERROR HANDLING

class WhatsAppService {
  constructor() {
    this.sockets = new Map();
    this.userSessions = new Map();
    this.io = null;
    this.userQRCodes = new Map();
    this.disabledUsers = new Map();
    
    // UPDATED: Enhanced status tracking with pause and index
    this.requestSendingStatus = new Map(); // userId -> { isSending, isPaused, currentIndex, users, progress }
    this.customSendingStatus = new Map();  // userId -> { isSending, isPaused, currentIndex, users, progress, message, media }
    
    this.pollingIntervals = new Map();
    this.botStartTimes = new Map();
    this.authStore = null;
    this.usersInSelectedFolder = new Map();
    this.connectingUsers = new Set();
    this.manualDisconnects = new Set(); // Track manual disconnects
    this.errorDisconnects = new Set(); // NEW: Track error disconnects
    this.loggedOutUsers = new Set();    // <-- ADD THIS (track users that were logged out)
    
    // LID mapping caches
    this.lidMaps = new Map();
    this.lidReverseMaps = new Map();
  }

  initialize(io) {
    this.io = io;
    
    const db = databaseService.getDatabase();
    const isProduction = process.env.DATABASE_URL !== undefined;
    this.authStore = new BaileysAuthStore(db, isProduction);
    
    console.log('📱 WhatsApp Service initialized with Baileys');
  }

  isConnecting(userId) {
    return this.connectingUsers.has(userId);
  }

  // NEW: Initialize or get sending status
  getOrInitRequestStatus(userId) {
    if (!this.requestSendingStatus.has(userId)) {
      this.requestSendingStatus.set(userId, {
        isSending: false,
        isPaused: false,
        currentIndex: -1,
        users: [],
        progress: null
      });
    }
    return this.requestSendingStatus.get(userId);
  }

  getOrInitCustomStatus(userId) {
    if (!this.customSendingStatus.has(userId)) {
      this.customSendingStatus.set(userId, {
        isSending: false,
        isPaused: false,
        currentIndex: -1,
        users: [],
        message: '',
        media: null,
        progress: null
      });
    }
    return this.customSendingStatus.get(userId);
  }

  async _deleteAuthForUser(userId, authPath) {
    try {
      // Delete files in the auth folder (if present)
      if (fs.existsSync(authPath)) {
        const entries = fs.readdirSync(authPath);
        for (const entry of entries) {
          const full = path.join(authPath, entry);
          try {
            const stat = fs.lstatSync(full);
            if (stat.isDirectory()) {
              fs.rmSync(full, { recursive: true, force: true });
            } else {
              fs.unlinkSync(full);
            }
          } catch (err) {
            console.log(`⚠️ Could not remove file ${full}:`, err && err.message ? err.message : err);
          }
        }

        // if folder now empty, remove it
        try {
          if (fs.existsSync(authPath) && fs.readdirSync(authPath).length === 0) {
            fs.rmdirSync(authPath);
          }
        } catch (err) {
          // ignore
        }
      }

      // Remove DB-stored state (if used)
      if (this.authStore && typeof this.authStore.deleteState === 'function') {
        await this.authStore.deleteState(userId);
      }

      console.log(`🧹 Auth files purged for user ${userId}`);
    } catch (err) {
      console.error('❌ _deleteAuthForUser failed for', userId, err);
      throw err;
    }
  }

  async connect(userId, users = null) {
    try {
      // Check if user is enabled
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
        message: 'Erro interno ao verificar permissão do usuário.'
      };
    }
    
    try {
      // Prevent multiple simultaneous connection attempts
      if (this.connectingUsers.has(userId)) {
        console.log(`⚠️ User ${userId} is already connecting, skipping duplicate request`);
        return {
          success: false,
          message: 'Já está conectando. Aguarde...'
        };
      }
      
      // Check if already connected
      if (this.sockets.has(userId)) {
        console.log(`⚠️ User ${userId} already has an active socket, disconnecting first`);
        await this.disconnect(userId);
        // Wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      this.connectingUsers.add(userId);
      
      if (this.io) {
        const requestStatus = this.getRequestSendingStatus(userId);
        const customStatus = this.getCustomSendingStatus(userId);
        
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: false,
          isConnecting: true,
          sessions: [],
          isSendingRequestMessages: requestStatus.isSendingRequestMessages,
          requestProgress: requestStatus.requestProgress,
          isSendingCustomMessages: customStatus.isSendingCustomMessages,
          customProgress: customStatus.customProgress
        });
      }
            
      if (users && Array.isArray(users)) {
        this.setSelectedFolderForUser(userId, users);
        console.log(`📁 Selected folder set for user ${userId}: ${users.length} entries`);
      }

      this.disabledUsers.set(userId, new Set());
      this.botStartTimes.set(userId, Date.now());
      
      this.requestSendingStatus.set(userId, {
        isSendingRequestMessages: false,
        requestProgress: null
      });

      this.customSendingStatus.set(userId, {
        isSendingCustomMessages: false,
        customProgress: null
      });

      // Create auth directory
      const authPath = path.join(AUTH_DIR, `baileys-${userId}`);
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

      if (this.loggedOutUsers.has(userId)) {
        try {
          console.log(`🧹 Detected previous logout for user ${userId} - purging auth files to force new QR`);
          await this._deleteAuthForUser(userId, authPath);
        } catch (err) {
          console.log(`⚠️ Could not purge auth files for user ${userId}:`, err && err.message ? err.message : err);
        } finally {
          // remove the flag so a subsequent connect doesn't try to delete again
          this.loggedOutUsers.delete(userId);
        }
      }

      // Validate global pricing configuration: if enabled, ensure all products have prices (defaults to ON)
      const cfg = await databaseService.getUserConfig(userId);
      const productsHavePrice = cfg ? cfg.productsHavePrice : true;
      if (productsHavePrice) {
        try {
          const allProducts = await databaseService.getAllProducts(userId);
          const missing = allProducts.filter(p => p.price === null || p.price === undefined || String(p.price).trim() === '');
          if (missing.length > 0) {
            this.connectingUsers.delete(userId);
            return {
              success: false,
              message: `Não é possível conectar: existem ${missing.length} produto(s) sem preço. Corrija os produtos ou desative \"Produtos têm preço\" nas configurações.`
            };
          }
        } catch (err) {
          console.error('Error validating product prices before connect:', err);
          // continue — don't block conn if validation failed due to DB error
        }
      }

      // Get Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`Using Baileys v${version.join('.')}, isLatest: ${isLatest}`);

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // Create socket
      const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        getMessage: async () => undefined
      });

      this.sockets.set(userId, sock);

      // Preserve existing sessions on reconnect — only initialize if missing
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Map());
      } else {
        console.log(`ℹ️ Preserving existing sessions for user ${userId} (reconnect)`);
      }

      // Save credentials when they change
      sock.ev.on('creds.update', saveCreds);

      this.setupEventHandlers(userId, sock);

      console.log(`✅ Baileys socket created for user ${userId}`);
      
      return { success: true, message: 'WhatsApp client starting...' };
    } catch (error) {
      console.error('❌ Failed to connect WhatsApp for user', userId, error);
      this.connectingUsers.delete(userId);
      if (this.sockets.has(userId)) {
        this.sockets.delete(userId);
      }
      if (this.userSessions.has(userId)) {
        this.userSessions.delete(userId);
      }
      throw error;
    }
  }

  setupEventHandlers(userId, sock) {
    // Connection update handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
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
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        // UPDATED: Distinguish between manual and error disconnects
        const wasManualDisconnect = this.manualDisconnects.has(userId);
        const isErrorDisconnect = !wasManualDisconnect && statusCode !== DisconnectReason.loggedOut;
        
        // NEW: Stop sending messages on ANY disconnect to prevent console errors
        this.pauseRequestMessages(userId, true); // true = from disconnect
        this.pauseCustomMessages(userId, true);  // true = from disconnect
        
        if (wasManualDisconnect) {
          console.log('🛑 Manual disconnect detected for user:', userId);
          this.manualDisconnects.delete(userId);
          this.connectingUsers.delete(userId);
          
          // FULL cleanup on manual disconnect
          this.sockets.delete(userId);
          this.userSessions.delete(userId); // CLEAR SESSIONS
          this.userQRCodes.delete(userId);
          this.disabledUsers.delete(userId);
          
          // Reset sending status (clear stored indices)
          this.stopRequestMessages(userId);
          this.stopCustomMessages(userId);
          
          this.botStartTimes.delete(userId);
          this.usersInSelectedFolder.delete(userId);
          this.stopPolling(userId);
          
          if (this.io) {
            this.io.to(`user-${userId}`).emit('bot-disconnected', { 
              reason: 'Manual disconnect',
              userId 
            });

            this.io.to(`user-${userId}`).emit('bot-status', {
              isConnected: false,
              isConnecting: false,
              sessions: [],
              ...this.getRequestSendingStatus(userId),
              ...this.getCustomSendingStatus(userId)
            });
          }
          
          return; // Don't reconnect
        }
        
        if (isErrorDisconnect) {
          // UPDATED: Error disconnect - DON'T clear sessions, keep sending state
          console.log('⚠️ Error disconnect for user:', userId, 'Status:', statusCode);
          this.errorDisconnects.add(userId);
          this.connectingUsers.delete(userId);
          
          // Minimal cleanup - keep sessions and sending state
          this.sockets.delete(userId);
          this.userQRCodes.delete(userId);
          this.stopPolling(userId);
          
          if (this.io) {
            this.io.to(`user-${userId}`).emit('bot-disconnected', { 
              reason: 'Error - reconnecting...',
              userId 
            });
          }
          
          // Auto reconnect after 3 seconds
          setTimeout(() => {
            console.log('🔄 Auto-reconnecting after error for user:', userId);
            const selectedUsers = this.usersInSelectedFolder.get(userId);
            this.connect(userId, selectedUsers ? Array.from(selectedUsers) : null);
          }, 3000);
          
          return;
        }
        
        // Logged out - full cleanup
        console.log('🔌 Logged out for user:', userId);
        this.connectingUsers.delete(userId);
        this.sockets.delete(userId);
        this.userSessions.delete(userId);
        this.userQRCodes.delete(userId);
        this.disabledUsers.delete(userId);
        this.stopRequestMessages(userId);
        this.stopCustomMessages(userId);
        this.botStartTimes.delete(userId);
        this.usersInSelectedFolder.delete(userId);
        this.stopPolling(userId);
        this.loggedOutUsers.add(userId);
        
        if (this.io) {
          this.io.to(`user-${userId}`).emit('bot-disconnected', { 
            reason: 'Logged out',
            userId 
          });

          this.io.to(`user-${userId}`).emit('bot-status', {
            isConnected: false,
            isConnecting: false,
            sessions: [],
            ...this.getRequestSendingStatus(userId),
            ...this.getCustomSendingStatus(userId)
          });
        }
        
      } else if (connection === 'open') {
        console.log('✅ WhatsApp connected for user:', userId);
        this.userQRCodes.delete(userId);
        this.connectingUsers.delete(userId);
        
        // UPDATED: Check if this was an error reconnect
        const wasErrorReconnect = this.errorDisconnects.has(userId);
        if (wasErrorReconnect) {
          this.errorDisconnects.delete(userId);
          console.log('🔄 Auto-resuming message sending after error reconnect for user:', userId);
          
          // Auto-resume request messages if they were active
          const reqStatus = this.requestSendingStatus.get(userId);
          if (reqStatus && reqStatus.isSending && reqStatus.isPaused) {
            this.resumeRequestMessages(userId);
          }
          
          // Auto-resume custom messages if they were active
          const customStatus = this.customSendingStatus.get(userId);
          if (customStatus && customStatus.isSending && customStatus.isPaused) {
            this.resumeCustomMessages(userId);
          }
        }

        if (this.io) {
          this.io.to(`user-${userId}`).emit('bot-ready', {
            userId,
            clientInfo: { user: sock.user }
          });

          this.io.to(`user-${userId}`).emit('bot-status', {
            isConnected: true,
            isConnecting: false,
            sessions: this.getActiveSessions(userId),
            ...this.getRequestSendingStatus(userId),
            ...this.getCustomSendingStatus(userId)
          });
        }

        this.startPolling(userId);

        // Build initial LID mappings
        (async () => {
          try {
            const res = await this.buildLidMappingsForUser(userId);
            if (this.io) {
              this.io.to(`user-${userId}`).emit('lid-mapping-built', { userId, ...res });
            }
          } catch (err) {
            console.log('⚠️ buildLidMappingsForUser failed at startup', err && err.message ? err.message : err);
          }
        })();
      }
    });

    // Messages handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const message of messages) {
          const botStart = this.botStartTimes.get(userId);
          const rawTs =
            message.messageTimestamp ||
            message.message?.messageTimestamp ||
            message.message?.timestamp;

          if (rawTs && botStart) {
            const msgTsMs = Number(rawTs) * 1000;

            if (msgTsMs < botStart) {
              // IGNORA mensagens antigas (antes do bot iniciar)
              continue;
            }
          }
          // Skip if message is from me
          if (message.key.fromMe) continue;
          
          // Skip group messages
          if (message.key.remoteJid?.endsWith('@g.us')) continue;
          
          // Skip broadcast messages
          if (message.key.remoteJid?.includes('broadcast')) continue;
          
          await this.handleMessage(userId, message);
        }
      }
    });
  }

  async getClientUsersFor(userId) {
    try {
      const selectedRaw = this.usersInSelectedFolder.get(userId);

      if (selectedRaw) {
        const arr = this.coerceToClientArray(selectedRaw, { source: 'map', userId });
        if (arr.length) return arr;
      }

      const dbRaw = await databaseService.getUserClients(userId);
      const arrFromDb = this.coerceToClientArray(dbRaw, { source: 'db', userId });
      if (arrFromDb.length) return arrFromDb;

      return [];
    } catch (err) {
      console.error(`getClientUsersFor: unexpected error for user ${userId}`, err);
      return [];
    }
  }

  coerceToClientArray(raw, ctx = {}) {
    if (Array.isArray(raw)) return raw;

    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.clients)) return raw.clients;
      if (Array.isArray(raw.data)) return raw.data;
      if (Array.isArray(raw.users)) return raw.users;

      const maybeValues = Object.values(raw);
      if (maybeValues.length > 0 && maybeValues.every(v => typeof v === 'object')) {
        return maybeValues;
      }
    }

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
        return;
      }
      this.usersInSelectedFolder.set(userId, coerced);
    } else {
      this.usersInSelectedFolder.set(userId, users);
    }

    // Kick off mapping refresh in background (non-blocking)
    (async () => {
      try {
        await this.buildLidMappingsForUser(userId);
      } catch (err) {
        console.log('⚠️ buildLidMappingsForUser failed after setSelectedFolderForUser', err && err.message ? err.message : err);
      }
    })();
  }

  /**
   * Build/refresh LID mappings for the user's selected clients.
   * Attempts batch lookup via Baileys' lidMapping store and falls back to per-PN lookups.
   */
  async buildLidMappingsForUser(userId) {
    const sock = this.sockets.get(userId);
    if (!sock) {
      console.log(`⚠️ buildLidMappingsForUser: no socket for user ${userId}`);
      return { success: false, reason: 'no-socket' };
    }

    // get clients (uses selected folder if present)
    const clients = await this.getClientUsersFor(userId);
    if (!clients || clients.length === 0) {
      console.log(`⚠️ No clients to map LIDs for user ${userId}`);
      this.lidMaps.set(userId, new Map());
      this.lidReverseMaps.set(userId, new Map());
      return { success: true, mapped: 0 };
    }

    // prepare unique PN JIDs (e.g. 5511999999999@s.whatsapp.net)
    const pns = Array.from(new Set(
      clients.map(c => {
        const phone = String(c.phone || '').trim();
        if (!phone) return null;
        return this.phoneToJid(phone);
      }).filter(Boolean)
    ));

    if (pns.length === 0) {
      console.log(`⚠️ No valid phone JIDs found for mapping for user ${userId}`);
      this.lidMaps.set(userId, new Map());
      this.lidReverseMaps.set(userId, new Map());
      return { success: true, mapped: 0 };
    }

    const userLidMap = new Map(); // pn -> lid
    const userLidReverse = new Map(); // lid -> pn

    try {
      const lidStore = sock.signalRepository && sock.signalRepository.lidMapping;
      let results = [];

      // preferred: batch call if available
      if (lidStore && typeof lidStore.getLIDsForPNs === 'function') {
        try {
          const batch = await lidStore.getLIDsForPNs(pns);
          // normalize batch output
          if (Array.isArray(batch)) {
            results = batch;
          } else if (batch && typeof batch === 'object') {
            results = Object.entries(batch).map(([pn, lid]) => ({ pn, lid }));
          }
        } catch (err) {
          console.log('⚠️ lidMapping.getLIDsForPNs failed, falling back to per-PN lookup', err && err.message ? err.message : err);
        }
      }

      // fallback: per-PN resolution
      if ((!results || results.length === 0) && lidStore && typeof lidStore.getLIDForPN === 'function') {
        const promises = pns.map(async (pn) => {
          try {
            const lid = await lidStore.getLIDForPN(pn);
            return { pn, lid: lid || null };
          } catch (err) {
            return { pn, lid: null };
          }
        });
        results = await Promise.all(promises);
      }

      // final fallback: try sock.onWhatsApp (some forks return info)
      if ((!results || results.length === 0) && typeof sock.onWhatsApp === 'function') {
        const promises = pns.map(async (pn) => {
          try {
            const infoArr = await sock.onWhatsApp(pn);
            // infoArr often looks like [{ exists: true, jid: '...' }] but some forks may include lid
            if (Array.isArray(infoArr) && infoArr[0]) {
              // if the provider returns lid, try it
              const maybeLid = infoArr[0].lid || infoArr[0].jid?.endsWith('@lid') ? infoArr[0].jid : null;
              return { pn, lid: maybeLid };
            }
            return { pn, lid: null };
          } catch (err) {
            return { pn, lid: null };
          }
        });
        results = await Promise.all(promises);
      }

      // process results and populate maps
      for (const r of results) {
        const pn = r?.pn || r?.pnJid || null;
        const lid = r?.lid || r?.lidJid || null;
        const normPn = pn ? (pn.includes('@') ? pn : `${pn}@s.whatsapp.net`) : null;
        const normLid = lid ? (lid.includes('@') ? lid : `${lid}@lid`) : null;
        if (normPn && normLid) {
          userLidMap.set(normPn, normLid);
          userLidReverse.set(normLid, normPn);
        }
      }

      // attach caches
      this.lidMaps.set(userId, userLidMap);
      this.lidReverseMaps.set(userId, userLidReverse);

      console.log(`🔁 LID mapping built for user ${userId}: ${userLidMap.size} / ${pns.length} resolved`);

      return { success: true, mapped: userLidMap.size, total: pns.length };
    } catch (err) {
      console.error('❌ buildLidMappingsForUser error', err);
      return { success: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /**
   * Public wrapper to refresh user mapping on demand.
   */
  async refreshLidMappings(userId) {
    return this.buildLidMappingsForUser(userId);
  }

  async handleMessage(userId, message) {
    try {
      const userConfig = await databaseService.getUserConfig(userId);
      if (userConfig && userConfig.interpret === false) {
        console.log(`⏸️ Global interpretation disabled for user ${userId}; ignoring incoming messages.`);
        // NOTE: per your requirement, when global interpret is off we DO NOT mark messages as answered.
        // So simply return early and do not call orderService.processMessage.
        return;
      }

      const botStart = this.botStartTimes.get(userId);
      const rawTs =
        message.messageTimestamp ||
        message.message?.messageTimestamp ||
        message.message?.timestamp;

      if (rawTs && botStart) {
        const msgTsMs = Number(rawTs) * 1000;
        if (msgTsMs < botStart) {
          return;
        }
      }
      // -------------------------
      // Resolve canonical sender JID (including mapping if incoming is @lid)
      // -------------------------
      let sender = message.key.remoteJid;
      const messageBody = message.message?.conversation || 
                          message.message?.extendedTextMessage?.text || '';
      
      if (!messageBody) return; // Skip non-text messages for now

      // If incoming sender is a lid and we have a cached mapping, translate it
      try {
        if (/@lid$/.test(String(sender))) {
          const lidReverse = this.lidReverseMaps.get(userId);
          if (lidReverse && lidReverse.has(String(sender))) {
            const mappedPn = lidReverse.get(String(sender));
            if (mappedPn) {
              const old = sender;
              sender = mappedPn;
              console.log(`🔁 Resolved incoming LID ${old} -> ${sender} using cached map for user ${userId}`);
            }
          }
        }
      } catch (err) {
        console.debug('⚠️ lid reverse lookup error', err && err.message ? err.message : err);
      }

      let phoneNumber = this.formatPhoneNumber(sender);
      let phoneNumberDigits = this.extractDigitsFromJid(sender);

      console.log(`📨 Message from: jid=${sender}, digits=${phoneNumberDigits}, formatted=${phoneNumber}`);

      // Check if user is still enabled
      const enabled = await databaseService.isUserEnabled(userId);
      if (!enabled) {
        console.log(`⚠️ User ${userId} is disabled, stopping message processing`);
        await this.disconnect(userId);
        return;
      }

      // Get clients
      const clientUsers = await this.getClientUsersFor(userId);
      
      if (clientUsers.length === 0) {
        console.log(`⚠️ clientUsers empty for user ${userId}. incoming from=${sender}`);
      }

      // Find client (try using resolved digits)
      let clientInfo = this.findUserInfoByDigits(clientUsers, phoneNumberDigits);

      if (!clientInfo && !userConfig.answerUnknownUsers) {
        console.log(`🚫 Ignoring message from unregistered number for user ${userId}: ${sender}`);
        return;
      }

      if (clientInfo && clientInfo.interpret === false) {
        try {
          await databaseService.updateClientAnsweredStatus(userId, phoneNumber, true);

          if (this.io) {
            this.io.to(`user-${userId}`).emit('client-answered', {
              phone: phoneNumber,
              userId
            });
          }

          console.log(`⏸️ Skipping interpretation for ${phoneNumber} (interpret disabled)`);
        } catch (err) {
          console.error('Error marking client as answered:', err);
        }
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

      const messageTimestamp = message.messageTimestamp * 1000;
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

      // Get message type - Baileys uses different structure
      const messageType = this.getMessageType(message);

      const response = await orderService.processMessage({
        userId,
        sessionId,
        message: messageBody,
        messageType,
        phoneNumber: sender,
        name: userInfo?.name || 'Cliente sem nome',
        orderType: userInfo?.type || 'normal'
      });

      if (response && response.message) {
        await this.sendMessage(userId, sender, response.message, response.media);
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
        
        const unreadCount = await databaseService.getUnreadNotificationsCount(userId);
        this.io.to(`user-${userId}`).emit('notifications-update', { unreadCount });
      }

    } catch (error) {
      console.error('❌ Error handling message for user', userId, error);
      await this.sendMessage(userId, message.key.remoteJid, '❌ Ocorreu um erro. Tente novamente.');
    }
  }

  getMessageType(message) {
    if (message.message?.conversation || message.message?.extendedTextMessage) {
      return 'chat';
    }
    if (message.message?.imageMessage) return 'image';
    if (message.message?.videoMessage) return 'video';
    if (message.message?.audioMessage) return 'audio';
    if (message.message?.documentMessage) return 'document';
    if (message.message?.stickerMessage) return 'sticker';
    if (message.message?.locationMessage) return 'location';
    if (message.message?.contactMessage) return 'vcard';
    return 'unknown';
  }

  async sendMessage(userId, recipient, message, media = null) {
    const sock = this.sockets.get(userId);
    if (!sock) {
      console.log('🛑 Cannot send message: No socket for user', userId);
      return false;
    }

    try {
      // Handle media messages
      if (media && media.data && media.mimetype) {
        const buffer = Buffer.from(media.data, 'base64');
        
        if (media.mimetype.startsWith('image/')) {
          // Send image with optional caption
          await sock.sendMessage(recipient, {
            image: buffer,
            caption: message || undefined,
            mimetype: media.mimetype
          });
          console.log(`✅ Image sent from user ${userId} to ${recipient}`);
        } else if (media.mimetype === 'application/pdf' || 
                  media.mimetype.includes('document') ||
                  media.mimetype.includes('officedocument')) {
          // Send document with optional caption
          await sock.sendMessage(recipient, {
            document: buffer,
            caption: message || undefined,
            mimetype: media.mimetype,
            fileName: media.filename || 'document'
          });
          console.log(`✅ Document sent from user ${userId} to ${recipient}`);
        } else {
          // Generic document handling
          await sock.sendMessage(recipient, {
            document: buffer,
            caption: message || undefined,
            mimetype: media.mimetype,
            fileName: media.filename || 'file'
          });
          console.log(`✅ File sent from user ${userId} to ${recipient}`);
        }
        return true;
      }
      
      // Handle text-only messages
      if (message && message.trim()) {
        await sock.sendMessage(recipient, { text: message });
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
    const enabled = await databaseService.isUserEnabled(userId);
    if (!enabled) {
      console.log(`⚠️ User ${userId} is disabled, cannot send bulk messages`);
      await this.disconnect(userId);
      throw new Error('Conta desabilitada.');
    }

    const sock = this.sockets.get(userId);
    if (!sock) {
      throw new Error('Bot not running for user ' + userId);
    }

    const status = this.getOrInitRequestStatus(userId);
    
    // Initialize sending state
    status.isSending = true;
    status.isPaused = false;
    status.users = users;
    status.currentIndex = -1;
    status.progress = {
      total: users.length,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    // Emit initial status
    if (this.io) {
      this.io.to(`user-${userId}`).emit('bot-status', {
        isConnected: true,
        isConnecting: false,
        sessions: this.getActiveSessions(userId),
        ...this.getRequestSendingStatus(userId),
        ...this.getCustomSendingStatus(userId)
      });
    }

    // Start sending
    await this.continueRequestMessages(userId);
  }

  // NEW: Continue sending request messages from current index
  async continueRequestMessages(userId) {
    const status = this.getOrInitRequestStatus(userId);
    const sock = this.sockets.get(userId);
    
    if (!sock || !status.isSending) return;

    const results = [];
    const startIndex = status.currentIndex + 1;

    for (let i = startIndex; i < status.users.length; i++) {
      // Check if paused or stopped
      if (!status.isSending) {
        console.log(`⏹️ Request messages stopped at index ${i} for user ${userId}`);
        break;
      }
      
      if (status.isPaused) {
        console.log(`⏸️ Request messages paused at index ${i} for user ${userId}`);
        status.currentIndex = i - 1; // Store current position
        break;
      }

      const user = status.users[i];
      status.currentIndex = i;

      try {
        const enabled = await databaseService.isUserEnabled(userId);
        if (!enabled) {
          console.log(`⚠️ User ${userId} was disabled during bulk sending`);
          this.stopRequestMessages(userId);
          await this.disconnect(userId);
          break;
        }

        if (user.answered) {
          results.push({ phone: user.phone, status: 'skipped', reason: 'Already answered' });
          status.progress.skipped++;
          continue;
        }

        const jid = this.phoneToJid(user.phone);
        const [exists] = await sock.onWhatsApp(jid);
        
        if (!exists) {
          results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
          status.progress.failed++;
          continue;
        }

        const userSessions = this.userSessions.get(userId);
        const message = await this.generateInitialMessage(userId, user.name, userSessions.get(jid));
        if (!userSessions.has(jid)) {
          const sessionId = uuidv4();
          userSessions.set(jid, sessionId);
          await orderService.startSession(sessionId, userId);
        }

        await this.sendMessage(userId, jid, message);

        results.push({ phone: user.phone, status: 'sent' });
        status.progress.sent++;

        if (this.io) {
          this.io.to(`user-${userId}`).emit('request-bulk-message-progress', {
            phone: user.phone,
            name: user.name,
            requestProgress: status.progress,
            userId
          });
        }

        const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        console.error(`❌ Error sending to ${user.phone}:`, error);
        results.push({ phone: user.phone, status: 'failed', reason: error.message });
        status.progress.failed++;
      }
    }

    // Check if completed
    if (status.currentIndex >= status.users.length - 1 && status.isSending) {
      this.stopRequestMessages(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bulk-messages-complete', { 
          results,
          userId 
        });
      }
    }
  }

  async sendCustomBulkMessages(userId, users, message, media = null) {
    const enabled = await databaseService.isUserEnabled(userId);
    if (!enabled) {
      console.log(`⚠️ User ${userId} is disabled, cannot send custom bulk messages`);
      await this.disconnect(userId);
      throw new Error('Conta desabilitada.');
    }

    const sock = this.sockets.get(userId);
    if (!sock) {
      throw new Error('Bot not running for user ' + userId);
    }

    const status = this.getOrInitCustomStatus(userId);
    
    // Initialize sending state
    status.isSending = true;
    status.isPaused = false;
    status.users = users;
    status.message = message;
    status.media = media;
    status.currentIndex = -1;
    status.progress = {
      total: users.length,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    // Emit initial status
    if (this.io) {
      this.io.to(`user-${userId}`).emit('bot-status', {
        isConnected: true,
        isConnecting: false,
        sessions: this.getActiveSessions(userId),
        ...this.getRequestSendingStatus(userId),
        ...this.getCustomSendingStatus(userId)
      });
    }

    // Start sending
    await this.continueCustomMessages(userId);
  }

  // NEW: Continue sending custom messages from current index
  async continueCustomMessages(userId) {
    const status = this.getOrInitCustomStatus(userId);
    const sock = this.sockets.get(userId);
    
    if (!sock || !status.isSending) return;

    const results = [];
    const startIndex = status.currentIndex + 1;

    for (let i = startIndex; i < status.users.length; i++) {
      // Check if paused or stopped
      if (!status.isSending) {
        console.log(`⏹️ Custom messages stopped at index ${i} for user ${userId}`);
        break;
      }
      
      if (status.isPaused) {
        console.log(`⏸️ Custom messages paused at index ${i} for user ${userId}`);
        status.currentIndex = i - 1; // Store current position
        break;
      }

      const user = status.users[i];
      status.currentIndex = i;

      try {
        const enabled = await databaseService.isUserEnabled(userId);
        if (!enabled) {
          console.log(`⚠️ User ${userId} was disabled during custom bulk sending`);
          this.stopCustomMessages(userId);
          await this.disconnect(userId);
          break;
        }

        const jid = this.phoneToJid(user.phone);
        const [exists] = await sock.onWhatsApp(jid);
        
        if (!exists) {
          results.push({ phone: user.phone, status: 'failed', reason: 'Invalid number' });
          status.progress.failed++;
          continue;
        }

        const sent = await this.sendMessage(userId, jid, status.message, status.media);
        
        if (sent) {
          results.push({ phone: user.phone, status: 'sent' });
          status.progress.sent++;

          if (this.io) {
            this.io.to(`user-${userId}`).emit('custom-bulk-message-progress', {
              phone: user.phone,
              name: user.name,
              customProgress: status.progress,
              userId
            });
          }
        } else {
          results.push({ phone: user.phone, status: 'failed', reason: 'Send failed' });
          status.progress.failed++;
        }

        const delay = (18 + Math.floor(Math.random() * 12)) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        console.error(`❌ Error sending custom message to ${user.phone}:`, error);
        results.push({ phone: user.phone, status: 'failed', reason: error.message });
        status.progress.failed++;
      }
    }

    // Check if completed
    if (status.currentIndex >= status.users.length - 1 && status.isSending) {
      this.stopCustomMessages(userId);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('custom-bulk-messages-complete', { 
          results,
          userId
        });
      }
    }
  }

  // NEW: Pause request messages
  pauseRequestMessages(userId, fromDisconnect = false) {
    const status = this.getOrInitRequestStatus(userId);
    if (status.isSending && !status.isPaused) {
      status.isPaused = true;
      console.log(`⏸️ Request messages paused for user ${userId}${fromDisconnect ? ' (from disconnect)' : ''}`);
      
      if (this.io && !fromDisconnect) {
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: this.isConnected(userId),
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          ...this.getRequestSendingStatus(userId),
          ...this.getCustomSendingStatus(userId)
        });
      }
    }
  }

  // NEW: Resume request messages
  resumeRequestMessages(userId) {
    const status = this.getOrInitRequestStatus(userId);
    if (status.isSending && status.isPaused) {
      status.isPaused = false;
      console.log(`▶️ Request messages resumed for user ${userId} from index ${status.currentIndex + 1}`);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: this.isConnected(userId),
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          ...this.getRequestSendingStatus(userId),
          ...this.getCustomSendingStatus(userId)
        });
      }
      
      // Continue sending from where we left off
      this.continueRequestMessages(userId);
    }
  }

  // NEW: Stop request messages (clear everything)
  stopRequestMessages(userId) {
    const status = this.getOrInitRequestStatus(userId);
    status.isSending = false;
    status.isPaused = false;
    status.currentIndex = -1;
    status.users = [];
    status.progress = null;
    console.log(`⏹️ Request messages stopped for user ${userId}`);
    
    if (this.io) {
      this.io.to(`user-${userId}`).emit('bot-status', {
        isConnected: this.isConnected(userId),
        isConnecting: false,
        sessions: this.getActiveSessions(userId),
        ...this.getRequestSendingStatus(userId),
        ...this.getCustomSendingStatus(userId)
      });
    }
  }

  // NEW: Pause custom messages
  pauseCustomMessages(userId, fromDisconnect = false) {
    const status = this.getOrInitCustomStatus(userId);
    if (status.isSending && !status.isPaused) {
      status.isPaused = true;
      console.log(`⏸️ Custom messages paused for user ${userId}${fromDisconnect ? ' (from disconnect)' : ''}`);
      
      if (this.io && !fromDisconnect) {
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: this.isConnected(userId),
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          ...this.getRequestSendingStatus(userId),
          ...this.getCustomSendingStatus(userId)
        });
      }
    }
  }

  // NEW: Resume custom messages
  resumeCustomMessages(userId) {
    const status = this.getOrInitCustomStatus(userId);
    if (status.isSending && status.isPaused) {
      status.isPaused = false;
      console.log(`▶️ Custom messages resumed for user ${userId} from index ${status.currentIndex + 1}`);
      
      if (this.io) {
        this.io.to(`user-${userId}`).emit('bot-status', {
          isConnected: this.isConnected(userId),
          isConnecting: false,
          sessions: this.getActiveSessions(userId),
          ...this.getRequestSendingStatus(userId),
          ...this.getCustomSendingStatus(userId)
        });
      }
      
      // Continue sending from where we left off
      this.continueCustomMessages(userId);
    }
  }

  // NEW: Stop custom messages (clear everything)
  stopCustomMessages(userId) {
    const status = this.getOrInitCustomStatus(userId);
    status.isSending = false;
    status.isPaused = false;
    status.currentIndex = -1;
    status.users = [];
    status.message = '';
    status.media = null;
    status.progress = null;
    console.log(`⏹️ Custom messages stopped for user ${userId}`);
    
    if (this.io) {
      this.io.to(`user-${userId}`).emit('bot-status', {
        isConnected: this.isConnected(userId),
        isConnecting: false,
        sessions: this.getActiveSessions(userId),
        ...this.getRequestSendingStatus(userId),
        ...this.getCustomSendingStatus(userId)
      });
    }
  }

  // NEW: Get request sending status (for frontend)
  getRequestSendingStatus(userId) {
    const status = this.getOrInitRequestStatus(userId);
    return {
      isSendingRequestMessages: status.isSending,
      isRequestMessagesPaused: status.isPaused,
      requestProgress: status.progress
    };
  }

  // NEW: Get custom sending status (for frontend)
  getCustomSendingStatus(userId) {
    const status = this.getOrInitCustomStatus(userId);
    return {
      isSendingCustomMessages: status.isSending,
      isCustomMessagesPaused: status.isPaused,
      customProgress: status.progress
    };
  }
/*
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
*/
  startPolling(userId) {
    this.stopPolling(userId);

    const pollingInterval = setInterval(async () => {
      const sock = this.sockets.get(userId);
      if (!sock) {
        this.stopPolling(userId);
        return;
      }

      try {
        const enabled = await databaseService.isUserEnabled(userId);
        if (!enabled) {
          console.log(`⚠️ User ${userId} is disabled during polling`);
          this.stopPolling(userId);
          await this.disconnect(userId);
          return;
        }

        const userSessions = this.userSessions.get(userId);
        if (!userSessions) return;

        for (const [jid, sessionId] of userSessions.entries()) {
          try {
            const updates = await orderService.getUpdates(sessionId, userId);
            
            if (updates.has_message && updates.bot_message) {
              await this.sendMessage(userId, jid, updates.bot_message[0]);
            }
          
            if (updates.has_message && updates.client_status[1] === 'autoConfirmedOrder') {
              const clientUsers = await this.getClientUsersFor(userId);

              if (this.io) {
                this.io.to(`user-${userId}`).emit('auto-confirmed-order', {
                  phone: this.formatPhoneNumber(jid),
                  userId,
                  clients: clientUsers
                });
              }
              
              const unreadCount = await databaseService.getUnreadNotificationsCount(userId);
              this.io.to(`user-${userId}`).emit('notifications-update', { unreadCount });
            }

          } catch (error) {
            console.error(`❌ Polling error for user ${userId}, jid ${jid}:`, error.message);
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
      // Mark as manual disconnect BEFORE stopping polling/closing socket
      this.manualDisconnects.add(userId);
      
      this.stopPolling(userId);
      
      const sock = this.sockets.get(userId);
      if (sock) {
        try {
          // Only logout if socket is still open
          const state = sock.ws?.readyState;
          if (state === 1) { // WebSocket.OPEN = 1
            await sock.logout();
          } else {
            console.log(`⚠️ Socket already closed for user ${userId}, skipping logout`);
            // Socket is already closed, just trigger cleanup via end()
            sock.end();
          }
        } catch (logoutError) {
          console.log(`⚠️ Could not logout user ${userId}:`, logoutError.message);
          // Try to end the socket to trigger the close event
          try {
            sock.end();
          } catch (endError) {
            // Ignore end errors
          }
        }
      }
      
      // Wait a bit for the connection.update event to fire
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // If the event handler didn't clean up (socket was already dead), do it manually
      if (this.sockets.has(userId)) {
        this.sockets.delete(userId);
        this.userSessions.delete(userId);
        this.userQRCodes.delete(userId);
        this.disabledUsers.delete(userId);
        this.requestSendingStatus.delete(userId);
        this.customSendingStatus.delete(userId);
        this.botStartTimes.delete(userId);
        this.usersInSelectedFolder.delete(userId);
        this.manualDisconnects.delete(userId);
        this.lidMaps.delete(userId);
        this.lidReverseMaps.delete(userId);
        
        if (this.io) {
          this.io.to(`user-${userId}`).emit('bot-stopped', { userId });
        }
      }
      
      console.log('✅ WhatsApp disconnected for user:', userId);
      
    } catch (error) {
      console.error('❌ Error disconnecting WhatsApp for user', userId, error);
      // Clean up the manual disconnect flag even on error
      this.manualDisconnects.delete(userId);
    }
  }

  async disconnectAll() {
    const promises = Array.from(this.sockets.keys()).map(userId => 
      this.disconnect(userId)
    );
    await Promise.all(promises);
  }

  isConnected(userId) {
    const sock = this.sockets.get(userId);
    return sock !== undefined && sock !== null;
  }

  getActiveSessions(userId) {
    const userSessions = this.userSessions.get(userId);
    if (!userSessions) return [];
    
    return Array.from(userSessions.entries()).map(([jid, sessionId]) => ({
      phone: this.formatPhoneNumber(jid),
      sessionId
    }));
  }

  getQRCode(userId) {
    return this.userQRCodes.get(userId);
  }

  findUserInfo(users, phoneNumber) {
    const normalize = (p) => {
      if (!p && p !== 0) return '';
      return String(p).replace(/\D/g, '');
    };

    const target = normalize(phoneNumber);

    return users.find(u => {
      const up = normalize(u.phone);
      return up && up === target;
    }) || null;
  }

  // improved find by digits (exact, suffix, contains) for robustness
  findUserInfoByDigits(users, targetDigits) {
    const normalize = (p) => (p ? String(p).replace(/\D/g, '') : '');
    const t = normalize(targetDigits);
    if (!t) return null;

    // 1) exact match
    let user = users.find(u => normalize(u.phone) === t);
    if (user) return user;

    // 2) try suffix matches (last 11..8 digits)
    const suffixLengths = [11, 10, 9, 8];
    for (const len of suffixLengths) {
      if (t.length < len) continue;
      const suf = t.slice(-len);
      user = users.find(u => {
        const up = normalize(u.phone);
        return up && up.endsWith(suf);
      });
      if (user) return user;
    }

    // 3) try cross-contains (one contains the other)
    user = users.find(u => {
      const up = normalize(u.phone);
      return up && (up.endsWith(t) || t.endsWith(up) || up.includes(t) || t.includes(up));
    });

    return user || null;
  }

  formatPhoneNumber(jid) {
    // Extract phone number from JID (removes @s.whatsapp.net)
    const numbers = jid.split('@')[0];
    
    if (numbers.length >= 12) {
      return `+${numbers.slice(0, 2)} ${numbers.slice(2, 4)} ${numbers.slice(4, 8)}-${numbers.slice(8, 12)}`;
    }
    return numbers;
  }

  extractDigitsFromJid(jid) {
    if (!jid) return '';
    const left = String(jid).split('@')[0];
    return left.replace(/\D/g, '');
  }

  phoneToJid(phone) {
    // Remove all non-digits and format to WhatsApp JID
    const digits = String(phone || '').replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
  }

  async generateInitialMessage(userId, userName, sessionId) {
    const config = await databaseService.getUserConfig(userId);
    const callByName = config ? config.callByName : true;

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
      if(product[2]){
        filteredProducts.push([product[0]]);
      }
    }
    let hint = '';
    if (!sessionId) {
      const idx1 = Math.floor(Math.random() * filteredProducts.length);
      const idx2 = Math.floor(Math.random() * filteredProducts.length);
      const differentIdx = idx1 === idx2 ? (idx1 + 1 < filteredProducts.length ? idx1 + 1 :  idx1 - 1) : idx2;

      const example = filteredProducts[0] ?
      `${Math.floor(Math.random() * 10) + 1} ${filteredProducts[idx1]} e ${Math.floor(Math.random() * 10) + 1} ${filteredProducts[differentIdx]}`
      : null;
      
      hint += `\n\n(Isto é uma mensagem automática para a sua conveniência 😊`;
      hint += example ? `, digite naturalmente como: ${example})` : `)`;
      hint += '\ndigite \"pronto\" quando terminar seu pedido ou aguarde a mensagem automática!\n';
      hint += '*Caso não queira pedir, digite \"cancelar\".*';
    }
    
    return messages[Math.floor(Math.random() * messages.length)] + hint;
  }
}

module.exports = new WhatsAppService();