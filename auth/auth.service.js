// auth/auth.service.js
const bcrypt = require('bcryptjs');

// Determine database type from environment
const isProduction = process.env.DATABASE_URL !== undefined;
let db;

class AuthService {
  setDatabase(database) {
    db = database;
  }

  async register(username, password, email = null) {
    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      if (isProduction) {
        // Check if user exists
        const checkResult = await db.query(
          'SELECT id FROM users WHERE username = $1',
          [username]
        );

        if (checkResult.rows.length > 0) {
          return {
            success: false,
            message: 'Username already exists'
          };
        }

        // Create user
        const result = await db.query(
          'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
          [username, email, hashedPassword]
        );

        const user = result.rows[0];

        // Copy default products for this user
        await db.query(`
          INSERT INTO products (user_id, name, akas, enabled)
          SELECT $1, name, akas, enabled FROM default_products
        `, [user.id]);

        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          }
        };
      } else {
        // SQLite
        const checkStmt = db.prepare('SELECT id FROM users WHERE username = ?');
        const existing = checkStmt.get(username);

        if (existing) {
          return {
            success: false,
            message: 'Username already exists'
          };
        }

        const insertStmt = db.prepare(
          'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
        );
        const result = insertStmt.run(username, email, hashedPassword);

        const userId = result.lastInsertRowid;

        // Copy default products
        const defaultProducts = db.prepare('SELECT * FROM default_products').all();
        const insertProduct = db.prepare(
          'INSERT INTO products (user_id, name, akas, enabled) VALUES (?, ?, ?, ?)'
        );

        for (const prod of defaultProducts) {
          insertProduct.run(userId, prod.name, prod.akas, prod.enabled);
        }

        return {
          success: true,
          user: {
            id: userId,
            username: username,
            email: email
          }
        };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        message: 'Registration failed: ' + error.message
      };
    }
  }

  async login(username, password) {
    try {
      if (isProduction) {
        const result = await db.query(
          'SELECT id, username, email, password FROM users WHERE username = $1',
          [username]
        );

        if (result.rows.length === 0) {
          return {
            success: false,
            message: 'Invalid username or password'
          };
        }

        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
          return {
            success: false,
            message: 'Invalid username or password'
          };
        }

        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          }
        };
      } else {
        // SQLite
        const stmt = db.prepare(
          'SELECT id, username, email, password FROM users WHERE username = ?'
        );
        const user = stmt.get(username);

        if (!user) {
          return {
            success: false,
            message: 'Invalid username or password'
          };
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
          return {
            success: false,
            message: 'Invalid username or password'
          };
        }

        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          }
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        message: 'Login failed: ' + error.message
      };
    }
  }
}

module.exports = new AuthService();