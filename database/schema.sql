-- Users table (must be created first)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session table for express-session (PostgreSQL only)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Folders table (now with user_id)
CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, user_id)
);

-- Clients table (now with user_id)
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
);

-- Products table (now with user_id)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    akas JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, user_id)
);

-- Product totals table (now with user_id)
CREATE TABLE IF NOT EXISTS product_totals (
    product VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_quantity INTEGER DEFAULT 0,
    PRIMARY KEY (product, user_id)
);

-- User orders table (now with user_id)
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
);

-- Insert a default demo user (password: "demo123")
--password is demo123
INSERT INTO users (username, email, password_hash) 
VALUES ('demo', 'demo@example.com', '$2b$10$8K1p/a0dL3LKJ5KV5TXYruXLAq7Z9tQ8WXj3PZfBnXYJ7j5c9JHES')
ON CONFLICT (username) DO NOTHING;