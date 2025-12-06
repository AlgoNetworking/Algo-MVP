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

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'multi-tenant-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
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