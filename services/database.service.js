const path = require('path');
const fs = require('fs');
const math = require('mathjs');
const productsConfig = require('../utils/products-config');

// Determine database type from environment
const isProduction = process.env.DATABASE_URL !== undefined;

let db;

class DatabaseService {
  async initialize() {
    try {
      if (isProduction) {
        const { Pool } = require('pg');
        
        const isLocalDB = process.env.DATABASE_URL && 
                         (process.env.DATABASE_URL.includes('localhost') || 
                          process.env.DATABASE_URL.includes('127.0.0.1'));
        
        db = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: isLocalDB ? false : {
            rejectUnauthorized: false
          }
        });
        console.log('📊 Using PostgreSQL database');
        await this.initializePostgres();
      } else {
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '..', 'local_orders.db');
        db = new Database(dbPath);
        console.log('📊 Using SQLite database:', dbPath);
        this.initializeSQLite();
      }
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error;
    }
  }

  async initializePostgres() {
    try {
      console.log('🔄 Creating PostgreSQL tables...');
      
      // Drop views if they exist
      try {
        await db.query('DROP VIEW IF EXISTS product_totals CASCADE');
        await db.query('DROP VIEW IF EXISTS user_orders CASCADE');
        console.log('🗑️  Removed existing views');
      } catch (error) {
        console.log('ℹ️  No views to remove or error removing views:', error.message);
      }

      // Create users table FIRST
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create folders table
      await db.query(`
        CREATE TABLE IF NOT EXISTS folders (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, user_id)
        )
      `);

      // Create clients table
      await db.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          name VARCHAR(100) NOT NULL,
          order_type VARCHAR(20) DEFAULT 'normal',
          answered BOOLEAN DEFAULT FALSE,
          is_chatbot BOOLEAN DEFAULT TRUE,
          folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(phone, folder_id, user_id)
        )
      `);

      // Create products table
      await db.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          akas JSONB DEFAULT '[]',
          enabled BOOLEAN DEFAULT TRUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, user_id)
        )
      `);

      // Create product_totals table
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_totals (
          product VARCHAR(255) NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          total_quantity INTEGER DEFAULT 0,
          PRIMARY KEY (product, user_id)
        )
      `);

      // Create user_orders table
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_orders (
          id SERIAL PRIMARY KEY,
          phone_number VARCHAR(255),
          name VARCHAR(255),
          order_type VARCHAR(255),
          session_id VARCHAR(255),
          original_message TEXT,
          parsed_orders JSONB,
          total_quantity INTEGER,
          status VARCHAR(50) DEFAULT 'confirmed',
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create session table for express-session
      await db.query(`
        CREATE TABLE IF NOT EXISTS session (
          sid VARCHAR NOT NULL PRIMARY KEY,
          sess JSON NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire)
      `);

      // Insert demo user if not exists
      const demoCheck = await db.query('SELECT id FROM users WHERE username = $1', ['demo']);
      if (demoCheck.rows.length === 0) {
        const bcrypt = require('bcrypt');
        const demoHash = await bcrypt.hash('demo123', 10);
        await db.query(
          'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
          ['demo', 'demo@example.com', demoHash]
        );
        console.log('✅ Demo user created (username: demo, password: demo123)');
      }

      console.log('✅ PostgreSQL tables created successfully');
    } catch (error) {
      console.error('❌ Error creating PostgreSQL tables:', error);
      throw error;
    }
  }

  initializeSQLite() {
    try {
      console.log('🔄 Creating SQLite tables...');
      
      // Create users table FIRST
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create folders table
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, user_id)
        )
      `);

      // Create clients table
      db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          name TEXT NOT NULL,
          order_type TEXT DEFAULT 'normal',
          answered INTEGER DEFAULT 0,
          is_chatbot INTEGER DEFAULT 1,
          folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(phone, folder_id, user_id)
        )
      `);

      // Create products table
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          akas TEXT DEFAULT '[]',
          enabled INTEGER DEFAULT 1,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, user_id)
        )
      `);

      // Create product_totals table
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_totals (
          product TEXT NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          total_quantity INTEGER DEFAULT 0,
          PRIMARY KEY (product, user_id)
        )
      `);

      // Create user_orders table
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT,
          name TEXT,
          order_type TEXT,
          session_id TEXT,
          original_message TEXT,
          parsed_orders TEXT,
          total_quantity INTEGER,
          status TEXT DEFAULT 'confirmed',
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert demo user if not exists
      const demoCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
      if (!demoCheck) {
        const bcrypt = require('bcrypt');
        const demoHash = bcrypt.hashSync('demo123', 10);
        db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
          .run('demo', 'demo@example.com', demoHash);
        console.log('✅ Demo user created (username: demo, password: demo123)');
      }

      console.log('✅ SQLite tables created successfully');
    } catch (error) {
      console.error('❌ Error creating SQLite tables:', error);
      throw error;
    }
  }

  // ==================== USER MANAGEMENT ====================
  
  async createUser({ username, email, passwordHash }) {
    try {
      if (isProduction) {
        const result = await db.query(
          `INSERT INTO users (username, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, username, email, created_at`,
          [username, email, passwordHash]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          `INSERT INTO users (username, email, password_hash)
          VALUES (?, ?, ?)
          RETURNING id, username, email, created_at`
        );
        return stmt.get(username, email, passwordHash);
      }
    } catch (error) {
      console.error('❌ Error creating user:', error);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM users WHERE username = $1',
          [username]
        );
        return result.rows[0] || null;
      } else {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username) || null;
      }
    } catch (error) {
      console.error('❌ Error getting user:', error);
      throw error;
    }
  }

  async getUserById(userId) {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT id, username, email, created_at FROM users WHERE id = $1',
          [userId]
        );
        return result.rows[0] || null;
      } else {
        const stmt = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?');
        return stmt.get(userId) || null;
      }
    } catch (error) {
      console.error('❌ Error getting user by ID:', error);
      throw error;
    }
  }

  // ==================== FOLDERS ====================
  
  async getAllFolders(userId) {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM folders WHERE user_id = $1 ORDER BY name',
          [userId]
        );
        return result.rows;
      } else {
        const stmt = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY name');
        return stmt.all(userId);
      }
    } catch (error) {
      console.error('❌ Error getting folders:', error);
      throw error;
    }
  }

  async getFolderById(id, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM folders WHERE id = $1 AND user_id = $2',
          [id, userId]
        );
        return result.rows[0] || null;
      } else {
        const stmt = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?');
        return stmt.get(id, userId) || null;
      }
    } catch (error) {
      console.error('❌ Error getting folder:', error);
      throw error;
    }
  }

  async createFolder(name, userId) {
    try {
      if (isProduction) {
        const result = await db.query(
          'INSERT INTO folders (name, user_id) VALUES ($1, $2) RETURNING *',
          [name, userId]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          'INSERT INTO folders (name, user_id) VALUES (?, ?) RETURNING *'
        );
        return stmt.get(name, userId);
      }
    } catch (error) {
      console.error('❌ Error creating folder:', error);
      throw error;
    }
  }

  async updateFolder(id, name, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        const result = await db.query(
          'UPDATE folders SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *',
          [name, id, userId]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          'UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? RETURNING *'
        );
        return stmt.get(name, id, userId);
      }
    } catch (error) {
      console.error('❌ Error updating folder:', error);
      throw error;
    }
  }

  async deleteFolder(id, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query('DELETE FROM folders WHERE id = $1 AND user_id = $2', [id, userId]);
      } else {
        const stmt = db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?');
        stmt.run(id, userId);
      }
    } catch (error) {
      console.error('❌ Error deleting folder:', error);
      throw error;
    }
  }

  async resetAnsweredStatusForFolder(folderId, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          'UPDATE clients SET answered = false, updated_at = CURRENT_TIMESTAMP WHERE folder_id = $1 AND user_id = $2',
          [folderId, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET answered = false, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ? AND user_id = ?'
        );
        stmt.run(folderId, userId);
      }
      console.log(`✅ Reset answered status for folder ${folderId}, user ${userId}`);
    } catch (error) {
      console.error('❌ Error resetting answered status:', error);
      throw error;
    }
  }

  // ==================== CLIENTS ====================
  
  async getAllClients(folderId = null, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      let query = 'SELECT * FROM clients WHERE user_id = $1';
      let params = [userId];
      
      if (folderId !== null) {
        query += ' AND folder_id = $2';
        params.push(folderId);
      }
      
      query += ' ORDER BY name';
      
      if (isProduction) {
        const result = await db.query(query, params);
        return result.rows;
      } else {
        query = query.replace(/\$1/g, '?').replace(/\$2/g, '?');
        const stmt = db.prepare(query);
        return stmt.all(...params);
      }
    } catch (error) {
      console.error('❌ Error getting clients:', error);
      throw error;
    }
  }

  async addClient(client, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      const { phone, name, type, answered, isChatBot, folderId } = client;
      
      if (isProduction) {
        await db.query(
          `INSERT INTO clients (phone, name, order_type, answered, is_chatbot, folder_id, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (phone, folder_id, user_id) DO UPDATE SET
          name = EXCLUDED.name,
          order_type = EXCLUDED.order_type,
          answered = EXCLUDED.answered,
          is_chatbot = EXCLUDED.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`,
          [phone, name, type, answered, isChatBot, folderId, userId]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO clients (phone, name, order_type, answered, is_chatbot, folder_id, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (phone, folder_id, user_id) DO UPDATE SET
          name = excluded.name,
          order_type = excluded.order_type,
          answered = excluded.answered,
          is_chatbot = excluded.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`
        );
        stmt.run(phone, name, type, answered, isChatBot, folderId, userId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error adding client:', error);
      throw error;
    }
  }

  async deleteClient(phone, folderId = null, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        if (folderId !== null) {
          await db.query('DELETE FROM clients WHERE phone = $1 AND folder_id = $2 AND user_id = $3', [phone, folderId, userId]);
        } else {
          await db.query('DELETE FROM clients WHERE phone = $1 AND user_id = $2', [phone, userId]);
        }
      } else {
        if (folderId !== null) {
          const stmt = db.prepare('DELETE FROM clients WHERE phone = ? AND folder_id = ? AND user_id = ?');
          stmt.run(phone, folderId, userId);
        } else {
          const stmt = db.prepare('DELETE FROM clients WHERE phone = ? AND user_id = ?');
          stmt.run(phone, userId);
        }
      }
    } catch (error) {
      console.error('❌ Error deleting client:', error);
      throw error;
    }
  }

  async updateClientAnsweredStatus(phone, answered, userId) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE clients SET answered = $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND user_id = $3',
          [answered, phone, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET answered = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ? AND user_id = ?'
        );
        stmt.run(answered ? 1 : 0, phone, userId);
      }
    } catch (error) {
      console.error('❌ Error updating client status:', error);
      throw error;
    }
  }

  async updateClientChatBotStatus(phone, isChatBot, userId) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE clients SET is_chatbot = $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND user_id = $3',
          [isChatBot, phone, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET is_chatbot = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ? AND user_id = ?'
        );
        stmt.run(isChatBot ? 1 : 0, phone, userId);
      }
    } catch (error) {
      console.error('❌ Error updating client chatbot status:', error);
      throw error;
    }
  }

  async updateClientAnsweredStatusInFolder(phone, folderId, answered, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          'UPDATE clients SET answered = $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND folder_id = $3 AND user_id = $4',
          [answered, phone, folderId, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET answered = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ? AND folder_id = ? AND user_id = ?'
        );
        stmt.run(answered, phone, folderId, userId);
      }
    } catch (error) {
      console.error('❌ Error updating client status in folder:', error);
      throw error;
    }
  }

  // ==================== PRODUCTS ====================
  
  async getAllProducts(userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM products WHERE user_id = $1 ORDER BY name',
          [userId]
        );
        return result.rows.map(row => ({
          id: row.id,
          name: row.name,
          akas: row.akas || [],
          enabled: row.enabled
        }));
      } else {
        const stmt = db.prepare('SELECT * FROM products WHERE user_id = ? ORDER BY name');
        const rows = stmt.all(userId);
        return rows.map(row => ({
          id: row.id,
          name: row.name,
          akas: JSON.parse(row.akas || '[]'),
          enabled: row.enabled
        }));
      }
    } catch (error) {
      console.error('❌ Error getting products:', error);
      throw error;
    }
  }

  async addProduct(product, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          `INSERT INTO products (name, akas, enabled, user_id)
          VALUES ($1, $2, $3, $4)`,
          [product.name, JSON.stringify(product.akas || []), product.enabled || true, userId]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO products (name, akas, enabled, user_id)
          VALUES (?, ?, ?, ?)`
        );
        stmt.run(product.name, JSON.stringify(product.akas || []), product.enabled || true, userId);
      }
    } catch (error) {
      console.error('❌ Error adding product:', error);
      throw error;
    }
  }

  async updateProduct(id, product, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          `UPDATE products SET 
            name = $1,
            akas = $2,
            enabled = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND user_id = $5`,
          [product.name, JSON.stringify(product.akas || []), product.enabled, id, userId]
        );
      } else {
        const stmt = db.prepare(
          `UPDATE products SET 
            name = ?,
            akas = ?,
            enabled = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`
        );
        stmt.run(product.name, JSON.stringify(product.akas || []), product.enabled, id, userId);
      }
    } catch (error) {
      console.error('❌ Error updating product:', error);
      throw error;
    }
  }

  async deleteProduct(id, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query('DELETE FROM products WHERE id = $1 AND user_id = $2', [id, userId]);
      } else {
        const stmt = db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?');
        stmt.run(id, userId);
      }
    } catch (error) {
      console.error('❌ Error deleting product:', error);
      throw error;
    }
  }

  async toggleProductEnabled(id, enabled, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          'UPDATE products SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
          [enabled, id, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE products SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
        );
        stmt.run(enabled, id, userId);
      }
    } catch (error) {
      console.error('❌ Error toggling product:', error);
      throw error;
    }
  }

  // ==================== ORDERS ====================
  
  async updateProductTotal(product, quantity, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query(
          'UPDATE product_totals SET total_quantity = total_quantity + $1 WHERE product = $2 AND user_id = $3',
          [quantity, product, userId]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE product_totals SET total_quantity = total_quantity + ? WHERE product = ? AND user_id = ?'
        );
        stmt.run(quantity, product, userId);
      }
    } catch (error) {
      console.error('❌ Error updating product total:', error);
      throw error;
    }
  }

  async saveUserOrder({ phoneNumber, name, orderType, sessionId, originalMessage, parsedOrders, status = 'confirmed', userId }) {
    try {
      if (!userId) throw new Error('User ID required');
      
      const totalQuantity = parsedOrders.reduce((sum, order) => sum + order.qty, 0);
      
      if (isProduction) {
        await db.query(
          `INSERT INTO user_orders (phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status, userId]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO user_orders (phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status, userId);
      }

      if (status === 'confirmed') {
        this.writeToTextFile(phoneNumber, name, orderType, parsedOrders);
      }
    } catch (error) {
      console.error('❌ Error saving user order:', error);
      throw error;
    }
  }

  writeToTextFile(phoneNumber, name, orderType, parsedOrders) {
    try {
      const ordersDir = path.join(__dirname, '..', 'orders');
      if (!fs.existsSync(ordersDir)) {
        fs.mkdirSync(ordersDir, { recursive: true });
      }

      let content = `${phoneNumber}\n${name}\n`;

      if (orderType === 'normal') {
        parsedOrders.forEach(order => {
          content += `${order.qty}x ${order.product}\n`;
        });
        content += '\n';
        fs.appendFileSync(path.join(ordersDir, 'pedidos_clientes.txt'), content);
      } else if (orderType === 'quilo') {
        let totalQty = 0;
        const items = [];
        parsedOrders.forEach(order => {
          const qty = Math.floor(order.qty / 10);
          totalQty += qty;
          if (qty > 0) {
            items.push(`${qty}x ${order.product}\n`);
          }
        });
        if (totalQty > 0) {
          items.forEach(item => content += item);
          content += '\n';
          fs.appendFileSync(path.join(ordersDir, 'pedidos_clientes_quilo.txt'), content);
        }
      } else if (orderType === 'dosado') {
        parsedOrders.forEach(order => {
          content += `${order.qty}x ${order.product} (dosado)\n`;
        });
        content += '\n';
        fs.appendFileSync(path.join(ordersDir, 'pedidos_clientes_dosado.txt'), content);
      }
    } catch (error) {
      console.error('❌ Error writing to text file:', error);
    }
  }

  async getProductTotals(userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        const result = await db.query(
          'SELECT product, total_quantity FROM product_totals WHERE user_id = $1 AND total_quantity > 0 ORDER BY product',
          [userId]
        );
        return result.rows.reduce((acc, row) => {
          acc[row.product] = row.total_quantity;
          return acc;
        }, {});
      } else {
        const stmt = db.prepare(
          'SELECT product, total_quantity FROM product_totals WHERE user_id = ? AND total_quantity > 0 ORDER BY product'
        );
        const rows = stmt.all(userId);
        return rows.reduce((acc, row) => {
          acc[row.product] = row.total_quantity;
          return acc;
        }, {});
      }
    } catch (error) {
      console.error('❌ Error getting product totals:', error);
      throw error;
    }
  }

  async getUserOrders(userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM user_orders WHERE user_id = $1 ORDER BY created_at DESC',
          [userId]
        );
        return result.rows.map(row => ({
          ...row,
          parsed_orders: typeof row.parsed_orders === 'string' 
            ? JSON.parse(row.parsed_orders) 
            : row.parsed_orders
        }));
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE user_id = ? ORDER BY created_at DESC');
        const rows = stmt.all(userId);
        return rows.map(row => ({
          ...row,
          parsed_orders: JSON.parse(row.parsed_orders)
        }));
      }
    } catch (error) {
      console.error('❌ Error getting user orders:', error);
      throw error;
    }
  }

  async confirmUserOrder(orderId, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      let order;
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM user_orders WHERE id = $1 AND status = $2 AND user_id = $3',
          [orderId, 'pending', userId]
        );
        order = result.rows[0];
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE id = ? AND status = ? AND user_id = ?');
        order = stmt.get(orderId, 'pending', userId);
      }

      if (!order) {
        throw new Error('Order not found or already confirmed');
      }

      const parsedOrders = typeof order.parsed_orders === 'string'
        ? JSON.parse(order.parsed_orders)
        : order.parsed_orders;

      for (const item of parsedOrders) {
        if (item.qty > 0) {
          await this.updateProductTotal(item.product, item.qty, userId);
        }
      }

      if (isProduction) {
        await db.query('UPDATE user_orders SET status = $1 WHERE id = $2 AND user_id = $3', ['confirmed', orderId, userId]);
      } else {
        const stmt = db.prepare('UPDATE user_orders SET status = ? WHERE id = ? AND user_id = ?');
        stmt.run('confirmed', orderId, userId);
      }

      this.writeToTextFile(order.phone_number, order.name, order.order_type, parsedOrders);

      return { success: true };
    } catch (error) {
      console.error('❌ Error confirming order:', error);
      throw error;
    }
  }

  async cancelUserOrder(orderId, userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      let order;
      
      if (isProduction) {
        const result = await db.query('SELECT * FROM user_orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
        order = result.rows[0];
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE id = ? AND user_id = ?');
        order = stmt.get(orderId, userId);
      }

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status === 'confirmed') {
        const parsedOrders = typeof order.parsed_orders === 'string'
          ? JSON.parse(order.parsed_orders)
          : order.parsed_orders;

        for (const item of parsedOrders) {
          if (item.qty > 0) {
            await this.updateProductTotal(item.product, -item.qty, userId);
          }
        }
      }

      if (isProduction) {
        await db.query('DELETE FROM user_orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
      } else {
        const stmt = db.prepare('DELETE FROM user_orders WHERE id = ? AND user_id = ?');
        stmt.run(orderId, userId);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Error canceling order:', error);
      throw error;
    }
  }

  async clearProductTotals(userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query('UPDATE product_totals SET total_quantity = 0 WHERE user_id = $1', [userId]);
      } else {
        db.exec(`UPDATE product_totals SET total_quantity = 0 WHERE user_id = ${userId}`);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing product totals:', error);
      throw error;
    }
  }

  async clearUserOrders(userId) {
    try {
      if (!userId) throw new Error('User ID required');
      
      if (isProduction) {
        await db.query('DELETE FROM user_orders WHERE user_id = $1', [userId]);
      } else {
        db.exec(`DELETE FROM user_orders WHERE user_id = ${userId}`);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing user orders:', error);
      throw error;
    }
  }

  async close() {
    if (isProduction) {
      await db.end();
    } else {
      db.close();
    }
  }
}

module.exports = new DatabaseService();