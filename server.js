const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

// Import routes and services
const authRoutes = require('./routes/auth.routes');
const whatsappService = require('./services/whatsapp.service');
const orderRoutes = require('./routes/orders.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const databaseService = require('./services/database.service');
const clientsRoutes = require('./routes/clients.routes');
const productsRoutes = require('./routes/products.routes');
const foldersRoutes = require('./routes/folders.routes');
const authMiddleware = require('./auth/auth.middleware');
const authService = require('./auth/auth.service');
const productsConfig = require('./utils/products-config');
const configRoutes = require('./routes/config.routes');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// When running behind a proxy (Railway, Heroku, etc.), enable trust proxy
// so Express knows the original request protocol and secure cookies work.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'multi-tenant-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: process.env.NODE_ENV === 'production',
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

app.use(sessionMiddleware);

// Initialize database
databaseService.initialize().then(() => {
  // Set database for auth service after initialization
  authService.setDatabase(databaseService.getDatabase());
});

/*
// Load products config
const productsConfig = require('./utils/products-config');
productsConfig.loadProducts().then(() => {
  console.log('✅ Products config loaded');
});
*/

// Initialize WhatsApp service with Socket.IO
whatsappService.initialize(io);

// Public routes (no authentication required)
app.use('/api/auth', authRoutes);

// Auth check endpoint (no auth required to check status)
app.get('/api/check-auth', (req, res) => {
  res.json({ 
    authenticated: !!req.session.userId,
    user: req.session.user
  });
});

// Protected API routes (require authentication)
app.use('/api/orders', authMiddleware.isAuthenticated, authMiddleware.attachUserId, orderRoutes);
app.use('/api/whatsapp', authMiddleware.isAuthenticated, authMiddleware.attachUserId, whatsappRoutes);
app.use('/api/clients', authMiddleware.isAuthenticated, authMiddleware.attachUserId, clientsRoutes);
app.use('/api/products', authMiddleware.isAuthenticated, authMiddleware.attachUserId, productsRoutes);
app.use('/api/folders', authMiddleware.isAuthenticated, authMiddleware.attachUserId, foldersRoutes);
app.use('/api/config', authMiddleware.isAuthenticated, authMiddleware.attachUserId, configRoutes);

// Health check
app.get('/health', (req, res) => {
  const userId = req.session?.userId;
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    whatsappConnected: userId ? whatsappService.isConnected(userId) : false
  });
});

// Serve pages
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.get('/register', (req, res) => {
  if (req.session.userId) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
  }
});

// server.js - Update the auth check endpoint
app.get('/api/check-auth', async (req, res) => {
  try {
    if (req.session.userId) {
      // Load user-specific products when checking auth
      await productsConfig.loadUserProducts(req.session.userId);
      res.json({ 
        authenticated: true,
        user: req.session.user
      });
    } else {
      res.json({ 
        authenticated: false,
        user: null
      });
    }
  } catch (error) {
    console.error('Error checking auth:', error);
    res.json({ 
      authenticated: false,
      user: null
    });
  }
});

app.get('/api/debug/whatsapp-sessions', async (req, res) => {
  try {
    const db = databaseService.getDatabase();
    const isProduction = process.env.DATABASE_URL !== undefined;
    
    let sessions;
    if (isProduction) {
      const result = await db.query(
        'SELECT session_id, LENGTH(session_data) as data_size, created_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC'
      );
      sessions = result.rows;
    } else {
      const stmt = db.prepare(
        'SELECT session_id, LENGTH(session_data) as data_size, created_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC'
      );
      sessions = stmt.all();
    }
    
    res.json({
      success: true,
      count: sessions.length,
      sessions: sessions.map(s => ({
        session_id: s.session_id,
        data_size: `${(s.data_size / 1024).toFixed(2)} KB`,
        created_at: s.created_at,
        updated_at: s.updated_at
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Force save session endpoint (for testing)
app.post('/api/debug/force-save-session/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const whatsappService = require('./services/whatsapp.service');
    
    // Check if client exists
    if (!whatsappService.isConnected(userId)) {
      return res.status(404).json({
        success: false,
        message: 'No active WhatsApp client for this user'
      });
    }
    // Attempt manual save via the PostgresStore if available
    try {
      if (whatsappService.postgresStore && typeof whatsappService.postgresStore.save === 'function') {
        await whatsappService.postgresStore.save({ session: `RemoteAuth-user-${userId}` });
        return res.json({
          success: true,
          message: 'Manual save attempted. Check /api/debug/whatsapp-sessions for results.'
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'PostgresStore not available. Ensure DATABASE_URL is set and service initialized.'
        });
      }
    } catch (error) {
      console.error('Error forcing session save:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test session restoration
app.get('/api/debug/test-restore/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = databaseService.getDatabase();
    const isProduction = process.env.DATABASE_URL !== undefined;
    
    const sessionId = `RemoteAuth-user-${userId}`;
    const normalized = sessionId.replace(/^RemoteAuth-/, '');

    let result;
    if (isProduction) {
      result = await db.query(
        'SELECT session_id, LENGTH(session_data) as data_size, created_at, updated_at FROM whatsapp_sessions WHERE session_id = $1',
        [normalized]
      );
    } else {
      const stmt = db.prepare(
        'SELECT session_id, LENGTH(session_data) as data_size, created_at, updated_at FROM whatsapp_sessions WHERE session_id = ?'
      );
      result = { rows: [stmt.get(normalized)] };
    }
    
    if (!result.rows || result.rows.length === 0 || !result.rows[0]) {
      return res.json({
        success: false,
        message: 'No session found in database',
        sessionId: normalized,
        recommendation: 'User needs to scan QR code first'
      });
    }

    const session = result.rows[0];

    res.json({
      success: true,
      message: 'Session exists in database',
      session: {
        session_id: session.session_id,
        data_size: `${(session.data_size / 1024).toFixed(2)} KB`,
        created_at: session.created_at,
        updated_at: session.updated_at
      },
      recommendation: 'Try restarting the WhatsApp client for this user'
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Socket.IO session sharing
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Socket.IO connection handling with auth
io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  if (userId) {
    socket.userId = userId;
    socket.join(`user-${userId}`);
    next();
  } else {
    next(new Error('Authentication required'));
  }
});

io.on('connection', (socket) => {
  console.log('🔌 Client connected for user:', socket.userId);
  
  // Send initial status for this user
  const sendingStatus = whatsappService.getSendingStatus(socket.userId);
  socket.emit('bot-status', {
    isConnected: whatsappService.isConnected(socket.userId),
    sessions: whatsappService.getActiveSessions(socket.userId),
    isSendingMessages: sendingStatus.isSendingMessages,
    sendingProgress: sendingStatus.progress
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  await whatsappService.disconnectAll();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  await whatsappService.disconnectAll();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Login: http://localhost:${PORT}/login`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, server, io };