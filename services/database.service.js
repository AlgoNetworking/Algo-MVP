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

      // Clear any existing data and initialize products
      await db.query('DELETE FROM product_totals');
      
      for (const product of PRODUCTS) {
        await db.query(
          `INSERT INTO product_totals (product, total_quantity) 
           VALUES ($1, 0)`,
          [product]
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

      // Clear any existing data and initialize products
      db.exec('DELETE FROM product_totals');
      
      const stmt = db.prepare(
        'INSERT INTO product_totals (product, total_quantity) VALUES (?, 0)'
      );

      for (const product of PRODUCTS) {
        stmt.run(product);
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
}

module.exports = new DatabaseService();