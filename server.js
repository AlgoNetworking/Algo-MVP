const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

// Import routes and services
const whatsappService = require('./services/whatsapp.service');
const orderRoutes = require('./routes/orders.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const databaseService = require('./services/database.service');
const clientsRoutes = require('./routes/clients.routes');
const productsRoutes = require('./routes/products.routes');
const foldersRoutes = require('./routes/folders.routes');
const authRoutes = require('./routes/auth.routes');
const { requireAuth, attachUser } = require('./middleware/auth.middleware');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Session configuration
const isProduction = process.env.DATABASE_URL !== undefined;
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

if (isProduction) {
  const pgSession = require('connect-pg-simple')(session);
  const { Pool } = require('pg');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
      rejectUnauthorized: false
    }
  });
  
  sessionConfig.store = new pgSession({
    pool: pool,
    tableName: 'session'
  });
}

const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Attach user to all requests if authenticated
app.use(attachUser);

// Initialize database
databaseService.initialize();

// Load products config
/*
const productsConfig = require('./utils/products-config');
productsConfig.loadProducts().then(() => {
  console.log('✅ Products config loaded');
});
*/

// Initialize WhatsApp service with Socket.IO
whatsappService.initialize(io);

// Public routes (no authentication required)
app.use('/api/auth', authRoutes);

// Serve login and register pages (no authentication)
app.get('/login.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Protected API Routes (require authentication)
app.use('/api/orders', requireAuth, orderRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);
app.use('/api/clients', requireAuth, clientsRoutes);
app.use('/api/products', requireAuth, productsRoutes);
app.use('/api/folders', requireAuth, foldersRoutes);

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connectedUsers: Object.keys(whatsappService.clients).length
  });
});

// Serve static files with authentication check
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Allow CSS files without auth
    if (filePath.endsWith('.css')) {
      return;
    }
  }
}));

// Main page - redirect to login if not authenticated
app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling (with session auth)
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  // Check if user is authenticated
  if (!socket.request.session || !socket.request.session.userId) {
    socket.disconnect();
    return;
  }

  const userId = socket.request.session.userId;
  console.log(`🔌 Client connected: ${socket.id}, User: ${userId}`);
  
  // Send initial status for this user
  const sendingStatus = whatsappService.getSendingStatus(userId);
  socket.emit('bot-status', {
    userId,
    isConnected: whatsappService.isUserConnected(userId),
    sessions: whatsappService.getUserActiveSessions(userId),
    isSendingMessages: sendingStatus.isSendingMessages,
    sendingProgress: sendingStatus.progress
  });

  // Listen for user-specific QR code requests
  socket.on('request-qr', () => {
    const qrData = whatsappService.getUserQRCode(userId);
    if (qrData) {
      socket.emit('qr-code', { userId, ...qrData });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}, User: ${userId}`);
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
  
  // Disconnect all WhatsApp clients
  const userIds = Array.from(whatsappService.userClients.keys());
  for (const userId of userIds) {
    try {
      await whatsappService.disconnect(userId);
    } catch (error) {
      console.error(`Error disconnecting user ${userId}:`, error);
    }
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  // ✅ FIX: Use userClients Map
  const userIds = Array.from(whatsappService.userClients.keys());
  for (const userId of userIds) {
    try {
      await whatsappService.disconnect(userId);
    } catch (error) {
      console.error(`Error disconnecting user ${userId}:`, error);
    }
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`👥 Multi-tenant mode: ENABLED`);
});

module.exports = { app, server, io };