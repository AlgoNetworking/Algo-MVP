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

  getDatabase() {
    return db;
  }

  async initializePostgres() {
    try {
      console.log('🔄 Creating PostgreSQL tables...');
      
      // Create users table FIRST
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create folders table with user_id
      await db.query(`
        CREATE TABLE IF NOT EXISTS folders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        )
      `);

      // Create clients table with user_id
      await db.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          phone VARCHAR(20) NOT NULL,
          name VARCHAR(100) NOT NULL,
          order_type VARCHAR(20) DEFAULT 'normal',
          answered BOOLEAN DEFAULT FALSE,
          is_chatbot BOOLEAN DEFAULT TRUE,
          folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, phone, folder_id)
        )
      `);

      // Create products table with user_id
      await db.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          akas JSONB DEFAULT '[]',
          enabled BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        )
      `);

      // Create product_totals table with user_id
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_totals (
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          product VARCHAR(255) NOT NULL,
          total_quantity INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, product)
        )
      `);

      // Create user_orders table with user_id
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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

      // Create default_products table (shared template)
      await db.query(`
        CREATE TABLE IF NOT EXISTS default_products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) UNIQUE NOT NULL,
          akas JSONB DEFAULT '[]',
          enabled BOOLEAN DEFAULT TRUE
        )
      `);

      // Insert default products if table is empty
      const defaultResult = await db.query('SELECT COUNT(*) FROM default_products');
      if (parseInt(defaultResult.rows[0].count) === 0) {
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
            `INSERT INTO default_products (name, akas, enabled) 
            VALUES ($1, $2::jsonb, $3)`,
            [name, akas, enabled]
          );
        }
        console.log('✅ Default products template inserted');
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
      
      // Create users table
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create folders table with user_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        )
      `);

      // Create clients table with user_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          phone TEXT NOT NULL,
          name TEXT NOT NULL,
          order_type TEXT DEFAULT 'normal',
          answered INTEGER DEFAULT 0,
          is_chatbot INTEGER DEFAULT 1,
          folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, phone, folder_id)
        )
      `);

      // Create products table with user_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          akas TEXT DEFAULT '[]',
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        )
      `);

      // Create product_totals table with user_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_totals (
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          product TEXT NOT NULL,
          total_quantity INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, product)
        )
      `);

      // Create user_orders table with user_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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

      // Create default_products table
      db.exec(`
        CREATE TABLE IF NOT EXISTS default_products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          akas TEXT DEFAULT '[]',
          enabled INTEGER DEFAULT 1
        )
      `);

      // Insert default products if table is empty
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM default_products');
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
          'INSERT INTO default_products (name, akas, enabled) VALUES (?, ?, ?)'
        );

        for (const [name, akas, enabled] of defaultProducts) {
          insertStmt.run(name, akas, enabled);
        }
        console.log('✅ Default products template inserted');
      }

      console.log('✅ SQLite tables created successfully');
    } catch (error) {
      console.error('❌ Error creating SQLite tables:', error);
      throw error;
    }
  }

  // Continue in next artifact...
// Product methods with user_id
  async updateProductTotal(userId, product, quantity) {
    try {
      if (isProduction) {
        // Insert or update
        await db.query(`
          INSERT INTO product_totals (user_id, product, total_quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, product) DO UPDATE
          SET total_quantity = product_totals.total_quantity + $3
        `, [userId, product, quantity]);
      } else {
        const stmt = db.prepare(`
          INSERT INTO product_totals (user_id, product, total_quantity)
          VALUES (?, ?, ?)
          ON CONFLICT (user_id, product) DO UPDATE
          SET total_quantity = total_quantity + excluded.total_quantity
        `);
        stmt.run(userId, product, quantity);
      }
    } catch (error) {
      console.error('❌ Error updating product total:', error);
      throw error;
    }
  }

  async saveUserOrder({ userId, phoneNumber, name, orderType, sessionId, originalMessage, parsedOrders, status = 'confirmed' }) {
    try {
      const totalQuantity = parsedOrders.reduce((sum, order) => sum + order.qty, 0);
      
      if (isProduction) {
        await db.query(
          `INSERT INTO user_orders (user_id, phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [userId, phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO user_orders (user_id, phone_number, name, order_type, session_id, original_message, parsed_orders, total_quantity, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(userId, phoneNumber, name, orderType, sessionId, originalMessage, JSON.stringify(parsedOrders), totalQuantity, status);
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

  async confirmUserOrder(userId, orderId) {
    try {
      let order;
      
      if (isProduction) {
        const result = await db.query(
          'SELECT * FROM user_orders WHERE id = $1 AND user_id = $2 AND status = $3',
          [orderId, userId, 'pending']
        );
        order = result.rows[0];
      } else {
        const stmt = db.prepare('SELECT * FROM user_orders WHERE id = ? AND user_id = ? AND status = ?');
        order = stmt.get(orderId, userId, 'pending');
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
          await this.updateProductTotal(userId, item.product, item.qty);
        }
      }

      // Update order status
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

  async cancelUserOrder(userId, orderId) {
    try {
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

      // If confirmed, subtract quantities
      if (order.status === 'confirmed') {
        const parsedOrders = typeof order.parsed_orders === 'string'
          ? JSON.parse(order.parsed_orders)
          : order.parsed_orders;

        for (const item of parsedOrders) {
          if (item.qty > 0) {
            await this.updateProductTotal(userId, item.product, -item.qty);
          }
        }
      }

      // Delete order
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
      if (isProduction) {
        await db.query('UPDATE product_totals SET total_quantity = 0 WHERE user_id = $1', [userId]);
      } else {
        const stmt = db.prepare('UPDATE product_totals SET total_quantity = 0 WHERE user_id = ?');
        stmt.run(userId);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing product totals:', error);
      throw error;
    }
  }

  async clearUserOrders(userId) {
    try {
      if (isProduction) {
        await db.query('DELETE FROM user_orders WHERE user_id = $1', [userId]);
      } else {
        const stmt = db.prepare('DELETE FROM user_orders WHERE user_id = ?');
        stmt.run(userId);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing user orders:', error);
      throw error;
    }
  }

  // Folders methods with user_id
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

  async getFolderById(userId, id) {
    try {
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

  async createFolder(userId, name) {
    try {
      if (isProduction) {
        const result = await db.query(
          'INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING *',
          [userId, name]
        );
        return result.rows[0];
      } else {
        const stmt = db.prepare(
          'INSERT INTO folders (user_id, name) VALUES (?, ?) RETURNING *'
        );
        return stmt.get(userId, name);
      }
    } catch (error) {
      console.error('❌ Error creating folder:', error);
      throw error;
    }
  }

  async updateFolder(userId, id, name) {
    try {
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

  async deleteFolder(userId, id) {
    try {
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

  // Continue in next artifact with clients and products methods...
  // Clients methods with user_id
  async getUserClients(userId) {
    try {
      if (isProduction) {
        // PostgreSQL version - get all clients for the user, including folder info
        const result = await db.query(
          `SELECT 
            c.*,
            f.name as folder_name
          FROM clients c
          LEFT JOIN folders f ON c.folder_id = f.id
          WHERE c.user_id = $1
          ORDER BY c.name`,
          [userId]
        );
        
        return result.rows.map(client => ({
          id: client.id,
          phone: client.phone,
          name: client.name,
          type: client.order_type,
          answered: client.answered,
          isChatBot: client.is_chatbot,
          folderId: client.folder_id,
          folderName: client.folder_name
        }));
      } else {
        // SQLite version
        const stmt = db.prepare(`
          SELECT 
            c.*,
            f.name as folder_name
          FROM clients c
          LEFT JOIN folders f ON c.folder_id = f.id
          WHERE c.user_id = ?
          ORDER BY c.name
        `);
        
        const rows = stmt.all(userId);
        return rows.map(client => ({
          id: client.id,
          phone: client.phone,
          name: client.name,
          type: client.order_type,
          answered: client.answered,
          isChatBot: client.is_chatbot,
          folderId: client.folder_id,
          folderName: client.folder_name
        }));
      }
    } catch (error) {
      console.error('❌ Error getting user clients:', error);
      throw error;
    }
  }

  async getAllClients(userId, folderId = null) {
    try {
      if (isProduction) {
        // PostgreSQL version
        if (folderId !== null) {
          const result = await db.query(
            'SELECT * FROM clients WHERE user_id = $1 AND folder_id = $2 ORDER BY name',
            [userId, folderId]
          );
          return result.rows;
        } else {
          const result = await db.query(
            'SELECT * FROM clients WHERE user_id = $1 ORDER BY name',
            [userId]
          );
          return result.rows;
        }
      } else {
        // SQLite version
        if (folderId !== null) {
          const stmt = db.prepare('SELECT * FROM clients WHERE user_id = ? AND folder_id = ? ORDER BY name');
          return stmt.all(userId, folderId);
        } else {
          const stmt = db.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY name');
          return stmt.all(userId);
        }
      }
    } catch (error) {
      console.error('❌ Error getting clients:', error);
      throw error;
    }
  }

  async addClient(userId, client) {
    try {
      const { phone, name, type, answered, isChatBot, folderId } = client;
      
      if (isProduction) {
        await db.query(
          `INSERT INTO clients (user_id, phone, name, order_type, answered, is_chatbot, folder_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (user_id, phone, folder_id) DO UPDATE SET
          name = EXCLUDED.name,
          order_type = EXCLUDED.order_type,
          answered = EXCLUDED.answered,
          is_chatbot = EXCLUDED.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`,
          [userId, phone, name, type, answered, isChatBot, folderId]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO clients (user_id, phone, name, order_type, answered, is_chatbot, folder_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, phone, folder_id) DO UPDATE SET
          name = excluded.name,
          order_type = excluded.order_type,
          answered = excluded.answered,
          is_chatbot = excluded.is_chatbot,
          updated_at = CURRENT_TIMESTAMP`
        );
        stmt.run(userId, phone, name, type, answered, isChatBot, folderId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error adding client:', error);
      
      let message = error.message;
      if (error.message.includes('unique constraint') || error.message.includes('UNIQUE constraint')) {
        message = `Cliente com telefone ${client.phone} já existe nesta pasta`;
      } else if (error.message.includes('foreign key constraint')) {
        message = 'Pasta não encontrada';
      }
      
      throw new Error(message);
    }
  }

  async deleteClient(userId, phone, folderId = null) {
    try {
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

  async updateClientAnsweredStatus(userId, phone, answered) {
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
        stmt.run(answered, phone, userId);
      }
    } catch (error) {
      console.error('❌ Error updating client status:', error);
      throw error;
    }
  }

  async updateClientChatBotStatus(userId, phone, isChatBot) {
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
        stmt.run(isChatBot, phone, userId);
      }
    } catch (error) {
      console.error('❌ Error updating client chatbot status:', error);
      throw error;
    }
  }

  async updateClientAnsweredStatusInFolder(userId, phone, folderId, answered) {
    try {
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

  async resetAnsweredStatusForFolder(userId, folderId) {
    try {
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
      console.log(`✅ Reset answered status for folder ${folderId}`);
    } catch (error) {
      console.error('❌ Error resetting answered status:', error);
      throw error;
    }
  }

  // Products methods with user_id
  async getAllProducts(userId) {
    try {
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

  async addProduct(userId, product) {
    try {
      if (isProduction) {
        await db.query(
          `INSERT INTO products (user_id, name, akas, enabled)
          VALUES ($1, $2, $3, $4)`,
          [userId, product.name, JSON.stringify(product.akas || []), product.enabled || true]
        );
      } else {
        const stmt = db.prepare(
          `INSERT INTO products (user_id, name, akas, enabled)
          VALUES (?, ?, ?, ?)`
        );
        stmt.run(userId, product.name, JSON.stringify(product.akas || []), product.enabled || true);
      }
    } catch (error) {
      console.error('❌ Error adding product:', error);
      throw error;
    }
  }

  async updateProduct(userId, id, product) {
    try {
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

  async deleteProduct(userId, id) {
    try {
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

  async toggleProductEnabled(userId, id, enabled) {
    try {
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

  async close() {
    if (isProduction) {
      await db.end();
    } else {
      db.close();
    }
  }
}

module.exports = new DatabaseService();