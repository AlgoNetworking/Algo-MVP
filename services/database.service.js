const path = require('path');
const fs = require('fs');
const math = require('mathjs');
const productsConfig = require('../utils/products-config');

// Determine database type from environment
const isProduction = process.env.DATABASE_URL !== undefined;

let db;

const PRODUCTS = productsConfig.PRODUCTS;

class DatabaseService {
  async initialize() {
    try {
      if (isProduction) {
        // PostgreSQL for production
        const { Pool } = require('pg');
        
        // Parse the database URL to check if it's local
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
        // SQLite for local development
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
      
      // First, check if the views exist and drop them if they do
      try {
        await db.query('DROP VIEW IF EXISTS product_totals CASCADE');
        await db.query('DROP VIEW IF EXISTS user_orders CASCADE');
        console.log('🗑️  Removed existing views');
      } catch (error) {
        console.log('ℹ️  No views to remove or error removing views:', error.message);
      }

      // Create folders table FIRST
      await db.query(`
        CREATE TABLE IF NOT EXISTS folders (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create clients table (updated with folder_id)
      await db.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          name VARCHAR(100) NOT NULL,
          order_type VARCHAR(20) DEFAULT 'normal',
          answered BOOLEAN DEFAULT FALSE,
          is_chatbot BOOLEAN DEFAULT TRUE,
          folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(phone, folder_id)
        )
      `);

      // Create products table
      await db.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) UNIQUE NOT NULL,
          akas JSONB DEFAULT '[]',
          enabled BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create product_totals table
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_totals (
          product VARCHAR(255) PRIMARY KEY,
          total_quantity INTEGER DEFAULT 0
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert default products if table is empty
      const productsResult = await db.query('SELECT COUNT(*) FROM products');
      if (parseInt(productsResult.rows[0].count) === 0) {
        const defaultProducts = [
          ['abacaxi', '[]', true],
          ['abacaxi com hortelã', '[]', true],
          ['açaí', '[]', true],
          ['acerola', '[]', true],
          ['ameixa', '[]', true],
          ['cajá', '[]', true],
          ['caju', '[]', true],
          ['goiaba', '[]', true],
          ['graviola', '[]', true],
          ['manga', '[]', true],
          ['maracujá', '[]', true],
          ['morango', '[]', true],
          ['seriguela', '[]', true],
          ['tamarindo', '[]', true],
          ['caixa de ovos', '["ovo", "ovos"]', true],
          ['queijo', '[]', true]
        ];

        for (const [name, akas, enabled] of defaultProducts) {
          await db.query(
            `INSERT INTO products (name, akas, enabled) 
            VALUES ($1, $2::jsonb, $3)`,
            [name, akas, enabled]
          );
        }
        console.log('✅ Default products inserted');
      }

      // Create a default folder if none exists
      const foldersResult = await db.query('SELECT COUNT(*) FROM folders');
      if (parseInt(foldersResult.rows[0].count) === 0) {
        await db.query(
          'INSERT INTO folders (name) VALUES ($1)',
          ['Pasta Padrão']
        );
        console.log('✅ Default folder created');
      }

      // Clear any existing data and initialize product totals
      await db.query('DELETE FROM product_totals');
      
      const products = await this.getAllProducts();
      for (const product of products) {
        await db.query(
          `INSERT INTO product_totals (product, total_quantity) 
          VALUES ($1, 0)`,
          [product.name]
        );
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
      
      // Create clients table
      db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          order_type TEXT DEFAULT 'normal',
          answered INTEGER DEFAULT 0,
          is_chatbot INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create products table
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          akas TEXT DEFAULT '[]',
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create product_totals table
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_totals (
          product TEXT PRIMARY KEY,
          total_quantity INTEGER DEFAULT 0
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
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert default products if table is empty
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM products');
      const count = countStmt.get().count;
      
      if (count === 0) {
        const defaultProducts = [
          ['abacaxi', '[]', 1],
          ['abacaxi com hortelã', '[]', 1],
          ['açaí', '[]', 1],
          ['acerola', '[]', 1],
          ['ameixa', '[]', 1],
          ['cajá', '[]', 1],
          ['caju', '[]', 1],
          ['goiaba', '[]', 1],
          ['graviola', '[]', 1],
          ['manga', '[]', 1],
          ['maracujá', '[]', 1],
          ['morango', '[]', 1],
          ['seriguela', '[]', 1],
          ['tamarindo', '[]', 1],
          ['caixa de ovos', '["ovo", "ovos"]', 1],
          ['queijo', '[]', 1]
        ];

        const insertStmt = db.prepare(
          'INSERT INTO products (name, akas, enabled) VALUES (?, ?, ?)'
        );

        for (const [name, akas, enabled] of defaultProducts) {
          insertStmt.run(name, akas, enabled);
        }
        console.log('✅ Default products inserted');
      }

      // Clear any existing data and initialize product totals
      db.exec('DELETE FROM product_totals');
      
      const products = this.getAllProducts();
      const stmt = db.prepare(
        'INSERT INTO product_totals (product, total_quantity) VALUES (?, 0)'
      );

      for (const product of products) {
        stmt.run(product.name);
      }
      
      console.log('✅ SQLite tables created successfully');
    } catch (error) {
      console.error('❌ Error creating SQLite tables:', error);
      throw error;
    }
  }

  // ... rest of your methods remain exactly the same
  async updateProductTotal(product, quantity) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE product_totals SET total_quantity = total_quantity + $1 WHERE product = $2',
          [quantity, product]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE product_totals SET total_quantity = total_quantity + ? WHERE product = ?'
        );
        stmt.run(quantity, product);
      }
    } catch (error) {
      console.error('❌ Error updating product total:', error);
      throw error;
    }
  }

  async saveUserOrder({ phoneNumber, name, orderType, sessionId, originalMessage, parsedOrders, status = 'confirmed' }) {
    try {
      const totalQuantity = parsedOrders.reduce((sum, order) => sum + order.qty, 0);
      
      if (isProduction) {
        await db.query(
          `INSERT INTO user_orders (phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO user_orders (phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status);
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

  async getProductTotals() {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT product, total_quantity FROM product_totals WHERE total_quantity > 0 ORDER BY product'
        );
        return result.rows.reduce((acc, row) => {
          acc[row.product] = row.total_quantity;
          return acc;
        }, {});
      } else {
        const stmt = db.prepare(
          'SELECT product, total_quantity FROM product_totals WHERE total_quantity > 0 ORDER BY product'
        );
        const rows = stmt.all();
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

  async getUserOrders() {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM user_orders ORDER BY created_at DESC'
        );
        return result.rows.map(row => ({
          ...row,
          parsed_orders: typeof row.parsed_orders === 'string' 
            ? JSON.parse(row.parsed_orders) 
            : row.parsed_orders
        }));
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders ORDER BY created_at DESC');
        const rows = stmt.all();
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

  async confirmUserOrder(orderId) {
    try {
      let order;
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM user_orders WHERE id = $1 AND status = $2',
          [orderId, 'pending']
        );
        order = result.rows[0];
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE id = ? AND status = ?');
        order = stmt.get(orderId, 'pending');
      }

      if (!order) {
        throw new Error('Order not found or already confirmed');
      }

      const parsedOrders = typeof order.parsed_orders === 'string'
        ? JSON.parse(order.parsed_orders)
        : order.parsed_orders;

      // Update product totals
      for (const item of parsedOrders) {
        if (item.qty > 0) {
          await this.updateProductTotal(item.product, item.qty);
        }
      }

      // Update order status
      if (isProduction) {
        await db.query('UPDATE user_orders SET status = $1 WHERE id = $2', ['confirmed', orderId]);
      } else {
        const stmt = db.prepare('UPDATE user_orders SET status = ? WHERE id = ?');
        stmt.run('confirmed', orderId);
      }

      this.writeToTextFile(order.phone_number, order.name, order.order_type, parsedOrders);

      return { success: true };
    } catch (error) {
      console.error('❌ Error confirming order:', error);
      throw error;
    }
  }

  async cancelUserOrder(orderId) {
    try {
      let order;
      
      if (isProduction) {
        const result = await db.query('SELECT * FROM user_orders WHERE id = $1', [orderId]);
        order = result.rows[0];
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE id = ?');
        order = stmt.get(orderId);
      }

      if (!order) {
        throw new Error('Order not found');
      }

      // If confirmed, subtract quantities
      if (order.status === 'confirmed') {
        const parsedOrders = typeof order.parsed_orders === 'string'
          ? JSON.parse(order.parsed_orders)
          : order.parsed_orders;

        for (const item of parsedOrders) {
          if (item.qty > 0) {
            await this.updateProductTotal(item.product, -item.qty);
          }
        }
      }

      // Delete order
      if (isProduction) {
        await db.query('DELETE FROM user_orders WHERE id = $1', [orderId]);
      } else {
        const stmt = db.prepare('DELETE FROM user_orders WHERE id = ?');
        stmt.run(orderId);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Error canceling order:', error);
      throw error;
    }
  }

  async clearProductTotals() {
    try {
      if (isProduction) {
        await db.query('UPDATE product_totals SET total_quantity = 0');
      } else {
        db.exec('UPDATE product_totals SET total_quantity = 0');
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing product totals:', error);
      throw error;
    }
  }

  async clearUserOrders() {
    try {
      if (isProduction) {
        await db.query('DELETE FROM user_orders');
      } else {
        db.exec('DELETE FROM user_orders');
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

  // Folders methods
  async getAllFolders() {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM folders ORDER BY name'
        );
        return result.rows;
      } else {
        const stmt = db.prepare('SELECT * FROM folders ORDER BY name');
        return stmt.all();
      }
    } catch (error) {
      console.error('❌ Error getting folders:', error);
      throw error;
    }
  }

  async getFolderById(id) {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM folders WHERE id = $1',
          [id]
        );
        return result.rows[0] || null;
      } else {
        const stmt = db.prepare('SELECT * FROM folders WHERE id = ?');
        return stmt.get(id) || null;
      }
    } catch (error) {
      console.error('❌ Error getting folder:', error);
      throw error;
    }
  }

  async createFolder(name) {
    try {
      if (isProduction) {
        const result = await db.query(
          'INSERT INTO folders (name) VALUES ($1) RETURNING *',
          [name]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          'INSERT INTO folders (name) VALUES (?) RETURNING *'
        );
        return stmt.get(name);
      }
    } catch (error) {
      console.error('❌ Error creating folder:', error);
      throw error;
    }
  }

  async updateFolder(id, name) {
    try {
      if (isProduction) {
        const result = await db.query(
          'UPDATE folders SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
          [name, id]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          'UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *'
        );
        return stmt.get(name, id);
      }
    } catch (error) {
      console.error('❌ Error updating folder:', error);
      throw error;
    }
  }

  async deleteFolder(id) {
    try {
      if (isProduction) {
        await db.query('DELETE FROM folders WHERE id = $1', [id]);
      } else {
        const stmt = db.prepare('DELETE FROM folders WHERE id = ?');
        stmt.run(id);
      }
    } catch (error) {
      console.error('❌ Error deleting folder:', error);
      throw error;
    }
  }

  // Clients methods
  async getAllClients(folderId = null) {
    try {
      let query = 'SELECT * FROM clients';
      let params = [];
      
      if (folderId !== null) {
        query += ' WHERE folder_id = $1';
        params = [folderId];
      }
      
      query += ' ORDER BY name';
      
      if (isProduction) {
        const result = await db.query(query, params);
        return result.rows;
      } else {
        const stmt = db.prepare(query);
        return stmt.all(...params);
      }
    } catch (error) {
      console.error('❌ Error getting clients:', error);
      throw error;
    }
  }

  async addClient(client) {
    try {
      const { phone, name, type, answered, isChatBot, folderId } = client;
      
      if (isProduction) {
        await db.query(
          `INSERT INTO clients (phone, name, order_type, answered, is_chatbot, folder_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (phone, folder_id) DO UPDATE SET
          name = EXCLUDED.name,
          order_type = EXCLUDED.order_type,
          answered = EXCLUDED.answered,
          is_chatbot = EXCLUDED.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`,
          [phone, name, type, answered, isChatBot, folderId]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO clients (phone, name, order_type, answered, is_chatbot, folder_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (phone, folder_id) DO UPDATE SET
          name = excluded.name,
          order_type = excluded.order_type,
          answered = excluded.answered,
          is_chatbot = excluded.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`
        );
        stmt.run(phone, name, type, answered, isChatBot, folderId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error adding client:', error);
      
      // Provide user-friendly error messages
      let message = error.message;
      if (error.message.includes('unique constraint')) {
        message = `Cliente com telefone ${client.phone} já existe nesta pasta`;
      } else if (error.message.includes('foreign key constraint')) {
        message = 'Pasta não encontrada';
      }
      
      throw new Error(message);
    }
  }

  async deleteClient(phone, folderId = null) {
  try {
    if (isProduction) {
      if (folderId !== null) {
        await db.query('DELETE FROM clients WHERE phone = $1 AND folder_id = $2', [phone, folderId]);
      } else {
        await db.query('DELETE FROM clients WHERE phone = $1', [phone]);
      }
    } else {
      if (folderId !== null) {
        const stmt = db.prepare('DELETE FROM clients WHERE phone = ? AND folder_id = ?');
        stmt.run(phone, folderId);
      } else {
        const stmt = db.prepare('DELETE FROM clients WHERE phone = ?');
        stmt.run(phone);
      }
    }
  } catch (error) {
    console.error('❌ Error deleting client:', error);
    throw error;
  }
}

  async updateClientAnsweredStatus(phone, answered) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE clients SET answered = $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2',
          [answered, phone]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET answered = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?'
        );
        stmt.run(answered, phone);
      }
    } catch (error) {
      console.error('❌ Error updating client status:', error);
      throw error;
    }
  }

  async updateClientChatBotStatus(phone, isChatBot) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE clients SET is_chatbot = $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2',
          [isChatBot, phone]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE clients SET is_chatbot = ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?'
        );
        stmt.run(isChatBot, phone);
      }
    } catch (error) {
      console.error('❌ Error updating client chatbot status:', error);
      throw error;
    }
  }

  // Products methods
  async getAllProducts() {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM products ORDER BY name'
        );
        return result.rows.map(row => ({
          id: row.id,
          name: row.name,
          akas: row.akas || [],
          enabled: row.enabled
        }));
      } else {
        const stmt = db.prepare('SELECT * FROM products ORDER BY name');
        const rows = stmt.all();
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

  async addProduct(product) {
    try {
      if (isProduction) {
        await db.query(
          `INSERT INTO products (name, akas, enabled)
          VALUES ($1, $2, $3)`,
          [product.name, JSON.stringify(product.akas || []), product.enabled || true]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO products (name, akas, enabled)
          VALUES (?, ?, ?)`
        );
        stmt.run(product.name, JSON.stringify(product.akas || []), product.enabled || true);
      }
    } catch (error) {
      console.error('❌ Error adding product:', error);
      throw error;
    }
  }

  async updateProduct(id, product) {
    try {
      if (isProduction) {
        await db.query(
          `UPDATE products SET 
            name = $1,
            akas = $2,
            enabled = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $4`,
          [product.name, JSON.stringify(product.akas || []), product.enabled, id]
        );
      } else {
        const stmt = db.prepare(
          `UPDATE products SET 
            name = ?,
            akas = ?,
            enabled = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
        );
        stmt.run(product.name, JSON.stringify(product.akas || []), product.enabled, id);
      }
    } catch (error) {
      console.error('❌ Error updating product:', error);
      throw error;
    }
  }

  async deleteProduct(id) {
    try {
      if (isProduction) {
        await db.query('DELETE FROM products WHERE id = $1', [id]);
      } else {
        const stmt = db.prepare('DELETE FROM products WHERE id = ?');
        stmt.run(id);
      }
    } catch (error) {
      console.error('❌ Error deleting product:', error);
      throw error;
    }
  }

  async toggleProductEnabled(id, enabled) {
    try {
      if (isProduction) {
        await db.query(
          'UPDATE products SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [enabled, id]
        );
      } else {
        const stmt = db.prepare(
          'UPDATE products SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        );
        stmt.run(enabled, id);
      }
    } catch (error) {
      console.error('❌ Error toggling product:', error);
      throw error;
    }
  }
}

module.exports = new DatabaseService();