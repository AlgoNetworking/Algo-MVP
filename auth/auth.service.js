const bcrypt = require('bcryptjs');
const databaseService = require('../services/database.service');

class AuthService {
  async register(username, password, email) {
    try {
      // Check if user exists
      const existingUser = await databaseService.getUserByUsername(username);
      if (existingUser) {
        return { success: false, message: 'Username already exists' };
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await databaseService.createUser({
        username,
        password: hashedPassword,
        email
      });

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          created_at: user.created_at
        }
      };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, message: 'Registration failed' };
    }
  }

  async login(username, password) {
    try {
      // Get user
      const user = await databaseService.getUserByUsername(username);
      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Check password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return { success: false, message: 'Invalid credentials' };
      }

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          created_at: user.created_at
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Login failed' };
    }
  }
}

module.exports = new AuthService();