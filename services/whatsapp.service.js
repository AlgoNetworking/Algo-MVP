// services/whatsapp.service.js - WORKING VERSION WITH HYBRID APPROACH
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const orderService = require('./order.service');
const databaseService = require('./database.service');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 🔥 WORKING: Hybrid PostgreSQL Store
// Let RemoteAuth handle file operations, we just store the data in PostgreSQL
class PostgresStore {
  constructor(db) {
    this.db = db;
    this.isProduction = process.env.DATABASE_URL !== undefined;
    
    // Directory where RemoteAuth stores files
    // Use base .wwebjs_auth directory. Individual strategies may create
    // `LocalAuth-<id>` or `RemoteAuth-<id>` or a `session/<id>` subfolder.
    this.authDir = path.join(__dirname, '..', '.wwebjs_auth');
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
          const baseAuth = this.authDir;
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
      
      // Create a tar.gz of the session directory and store as base64
      try {
        console.log(`📂 Archiving session directory for DB save: ${sessionDir}`);
        const parentDir = path.dirname(sessionDir);
        const baseName = path.basename(sessionDir);

        // Use system 'tar' to create a gzipped tar to stdout
        const tar = spawnSync('tar', ['-czf', '-', '-C', parentDir, baseName], { maxBuffer: 50 * 1024 * 1024 });

        if (tar.status !== 0 || !tar.stdout) {
          console.warn('⚠️ Tar process failed, fallback to file-by-file save');
          // fallback: try reading files individually
          const files = this.readDirectoryRecursive(sessionDir);
          if (files.length === 0) {
            console.log(`⚠️ No files found in session directory`);
            return;
          }
          const sessionData = {
            files: files.map(file => ({
              path: path.relative(sessionDir, file.fullPath),
              data: file.data,
              isBase64: file.isBase64
            }))
          };
          const jsonData = JSON.stringify(sessionData);
          console.log(`💾 Saving ${(jsonData.length / 1024).toFixed(2)} KB to database (fallback)`);
          await this.saveToDatabase(normalized, jsonData);
          console.log(`✅ Session saved successfully (fallback): ${session}`);
          return;
        }

        const tarBuffer = tar.stdout;
        const b64 = tarBuffer.toString('base64');
        const payload = JSON.stringify({ type: 'tar.gz', data: b64 });
        console.log(`💾 Saving ${(payload.length / 1024).toFixed(2)} KB tarball to database`);
        await this.saveToDatabase(normalized, payload);
        console.log(`✅ Session saved successfully (tar): ${session}`);
      } catch (err) {
        console.error('❌ Error archiving session dir:', err.message);
      }
      
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

      // If payload is a tar.gz blob (created by our save), extract it directly
      if (sessionData && sessionData.type === 'tar.gz' && sessionData.data) {
        try {
          const tarB64 = sessionData.data;
          const buffer = Buffer.from(tarB64, 'base64');

          // Ensure target parent exists
          const targetDir = extractPath; // we expect extractPath to be the full session directory path
          const parent = path.dirname(targetDir);
          if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
          }

          // Create target dir if not exists
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          console.log(`📦 Extracting tarball into ${parent}`);

          const tar = spawnSync('tar', ['-xzf', '-', '-C', parent], { input: buffer, maxBuffer: 50 * 1024 * 1024 });
          if (tar.status !== 0) {
            console.error('❌ Tar extraction failed:', tar.stderr ? tar.stderr.toString() : 'unknown');
            return false;
          }

          console.log(`✅ Session extracted successfully to ${extractPath}`);
          return true;
        } catch (err) {
          console.error('❌ Error extracting tarball session:', err.message);
          return false;
        }
          // If payload is a zip blob (created by RemoteAuth.compressSession), write the zip file to disk
          if (sessionData && sessionData.type === 'zip' && sessionData.data) {
            try {
              const zipB64 = sessionData.data;
              const buffer = Buffer.from(zipB64, 'base64');

              const targetFile = extractPath; // RemoteAuth passes compressedSessionPath (e.g., 'RemoteAuth-user-1.zip')
              const targetDir = path.dirname(targetFile) || '.';
              if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
              fs.writeFileSync(targetFile, buffer);
              console.log(`✅ Zip session written to ${targetFile}`);
              return true;
            } catch (err) {
              console.error('❌ Error writing zip session file:', err.message);
              return false;
            }
          }
      }

      // Fallback: older format with files array
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

// Adapter to match the RemoteAuth store interface expected by whatsapp-web.js
class RemoteAuthStoreAdapter {
  constructor(pgStore) {
    this.pgStore = pgStore;
  }

  // Check if a session exists (RemoteAuth may call this)
  async exists(session) {
    try {
      return await this.pgStore.sessionExists({ session });
    } catch (err) {
      console.warn('RemoteAuthStoreAdapter.exists error:', err?.message || err);
      return false;
    }
  }

  // Get session data from DB. Return parsed object if possible.
  async get(session) {
    try {
      const normalized = this.pgStore.normalizeSession(session);
      // Query DB directly using pgStore logic
      if (this.pgStore.isProduction) {
        const res = await this.pgStore.db.query('SELECT session_data FROM whatsapp_sessions WHERE session_id = $1', [normalized]);
        if (!res || res.rows.length === 0) return null;
        try { return JSON.parse(res.rows[0].session_data); } catch (e) { return res.rows[0].session_data; }
      } else {
        const stmt = this.pgStore.db.prepare('SELECT session_data FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(normalized);
        if (!row) return null;
        try { return JSON.parse(row.session_data); } catch (e) { return row.session_data; }
      }
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.get error:', err?.message || err);
      return null;
    }
  }

  // Save session data into DB. Accepts any value and stores as JSON/string.
  async set(session, value) {
    try {
      const normalized = this.pgStore.normalizeSession(session);
      let payload;
      if (typeof value === 'string') payload = value;
      else payload = JSON.stringify(value);

      await this.pgStore.saveToDatabase(normalized, payload);
      return true;
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.set error:', err?.message || err);
      return false;
    }
  }

  // Delete session from DB
  async delete(session) {
    try {
      await this.pgStore.delete({ session });
      return true;
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.delete error:', err?.message || err);
      return false;
    }
  }
  // Compatibility: RemoteAuth expects sessionExists/save/extract/delete methods
  async sessionExists(options) {
    try {
      // RemoteAuth calls with an object { session: 'RemoteAuth-<id>' }
      if (typeof options === 'string') return await this.exists(options);
      return await this.pgStore.sessionExists(options);
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.sessionExists error:', err?.message || err);
      return false;
    }
  }

  async save(options) {
    try {
      // RemoteAuth creates a zip file named `<session>.zip` in cwd before calling save
      // Try to read that file and store as base64 zip payload
      const session = options && options.session ? options.session : options;
      const zipName = `${session}.zip`;
      if (fs.existsSync(zipName)) {
        const buf = fs.readFileSync(zipName);
        const b64 = buf.toString('base64');
        const payload = JSON.stringify({ type: 'zip', data: b64 });
        await this.pgStore.saveToDatabase(this.pgStore.normalizeSession(session), payload);
        return true;
      }
      // Fallback: let pgStore.save try to find session dir
      if (this.pgStore.save) {
        await this.pgStore.save({ session });
        return true;
      }
      return false;
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.save error:', err?.message || err);
      return false;
    }
  }

  async extract(options) {
    try {
      // RemoteAuth calls extract({ session, path }) where path is the expected archive filename
      const session = options && options.session ? options.session : options;
      const destPath = options && options.path ? options.path : options;

      const normalized = this.pgStore.normalizeSession(session);
      let sessionDataJson;

      if (this.pgStore.isProduction) {
        const res = await this.pgStore.db.query('SELECT session_data FROM whatsapp_sessions WHERE session_id = $1', [normalized]);
        if (!res || res.rows.length === 0) return false;
        sessionDataJson = res.rows[0].session_data;
      } else {
        const stmt = this.pgStore.db.prepare('SELECT session_data FROM whatsapp_sessions WHERE session_id = ?');
        const row = stmt.get(normalized);
        if (!row) return false;
        sessionDataJson = row.session_data;
      }

      // Try parse; if parsing fails, treat as raw base64
      let parsed;
      try { parsed = JSON.parse(sessionDataJson); } catch (e) { parsed = sessionDataJson; }

      // If payload explicitly contains type+data (zip or tar.gz), write the raw bytes to destPath
      if (parsed && typeof parsed === 'object' && parsed.type && parsed.data) {
        const buf = Buffer.from(parsed.data, 'base64');
        fs.writeFileSync(destPath, buf);
        console.log(`✅ RemoteAuthStoreAdapter wrote archive to ${destPath}`);
        return true;
      }

      // If parsed is a plain base64 string, write it out as destPath
      if (typeof parsed === 'string') {
        const buf = Buffer.from(parsed, 'base64');
        fs.writeFileSync(destPath, buf);
        console.log(`✅ RemoteAuthStoreAdapter wrote base64 blob to ${destPath}`);
        return true;
      }

      // Fallback: if we stored files array, write them into a directory named after destPath (without .zip/.tar.gz)
      if (parsed && parsed.files && parsed.files.length > 0) {
        let targetDir = destPath.replace(/\.zip$|\.tar\.gz$/i, '');
        if (!targetDir || targetDir === destPath) targetDir = `${normalized}_session`;
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        for (const file of parsed.files) {
          const filePath = path.join(targetDir, file.path);
          const fileDir = path.dirname(filePath);
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
          if (file.isBase64) fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
          else fs.writeFileSync(filePath, file.data, 'utf8');
        }
        // Indicate success; RemoteAuth may expect an archive file, but writing the directory at least restores files
        console.log(`✅ RemoteAuthStoreAdapter extracted ${parsed.files.length} files into ${targetDir}`);
        return true;
      }

      return false;
    } catch (err) {
      console.error('RemoteAuthStoreAdapter.extract error:', err?.message || err);
      return false;
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
    
    // Postgres-backed store will be used by RemoteAuth when available
    console.log('📱 WhatsApp Service initialized');
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
        // Use built-in RemoteAuth backed by our PostgresStore in production (DATABASE_URL present)
        try {
          // Use an adapter so RemoteAuth gets the methods it expects (get/set/delete/exists)
          const remoteStore = new RemoteAuthStoreAdapter(this.postgresStore);
          clientConfig.authStrategy = new RemoteAuth({
              clientId: `user-${userId}`,
              store: remoteStore,
              // RemoteAuth enforces a minimum backup sync interval (1 minute)
              backupSyncIntervalMs: 60000
            });
          console.log('Using built-in RemoteAuth with PostgresStore');
        }
        catch (err) {
          console.warn('Failed to initialize built-in RemoteAuth, falling back to LocalAuth with DB extract:', err?.message || err);
          // fallback: attempt to extract session files from DB into LocalAuth path and use LocalAuth
          const extractPath = path.join(this.postgresStore.authDir);
          try {
            await this.postgresStore.extract({ session: `RemoteAuth-user-${userId}`, path: extractPath });
          }
          catch (err2) {
            console.warn('Could not extract session from DB for LocalAuth fallback', err2?.message || err2);
          }
          // Ensure LocalAuth is available before using it
          try {
            const { LocalAuth } = require('whatsapp-web.js');
            clientConfig.authStrategy = new LocalAuth({ clientId: `user-${userId}` });
          } catch (errLocal) {
            console.error('❌ LocalAuth is not available:', errLocal?.message || errLocal);
            throw errLocal;
          }
        }
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
      
            // If payload is a zip blob (created by RemoteAuth.compressSession), write the zip file to disk
            if (sessionData && sessionData.type === 'zip' && sessionData.data) {
              try {
                const zipB64 = sessionData.data;
                const buffer = Buffer.from(zipB64, 'base64');

                const targetFile = extractPath; // RemoteAuth passes compressedSessionPath (e.g., 'RemoteAuth-user-1.zip')
                const targetDir = path.dirname(targetFile) || '.';
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(targetFile, buffer);
                console.log(`✅ Zip session written to ${targetFile}`);
                return true;
              } catch (err) {
                console.error('❌ Error writing zip session file:', err.message);
                return false;
              }
            }
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