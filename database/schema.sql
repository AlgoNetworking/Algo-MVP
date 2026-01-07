-- Notifications table - persistent notifications that survive sessions
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

-- Folders table - now with user_id
CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Clients table - now with user_id
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    order_type VARCHAR(20) DEFAULT 'normal',
    answered BOOLEAN DEFAULT FALSE,
    is_chatbot BOOLEAN DEFAULT TRUE,
    interpret_messages BOOLEAN DEFAULT TRUE,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, phone, folder_id)
);

-- Products table - now with user_id
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    akas JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Product totals table - now with user_id
CREATE TABLE IF NOT EXISTS product_totals (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    product VARCHAR(255) NOT NULL,
    price VARCHAR(255) NOT NULL,
    total_quantity INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, product)
);

-- User orders table - now with user_id
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
);

-- 🔥 NEW: WhatsApp sessions table for RemoteAuth
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    session_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id 
ON whatsapp_sessions(session_id);

-- Insert default products for each new user (will be copied during user creation)
CREATE TABLE IF NOT EXISTS default_products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    akas JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE
);

-- Insert default products if not exists
INSERT INTO default_products (name, akas, enabled) VALUES
    ('abacaxi', '[]', true),
    ('abacaxi com hortelã', '[]', true),
    ('açaí', '[]', true),
    ('acerola', '[]', true),
    ('ameixa', '[]', true),
    ('cajá', '[]', true),
    ('caju', '[]', true),
    ('goiaba', '[]', true),
    ('graviola', '[]', true),
    ('manga', '[]', true),
    ('maracujá', '[]', true),
    ('morango', '[]', true),
    ('seriguela', '[]', true),
    ('tamarindo', '[]', true),
    ('caixa de ovos', '["ovo", "ovos"]', true),
    ('queijo', '[]', true)
ON CONFLICT (name) DO NOTHING;