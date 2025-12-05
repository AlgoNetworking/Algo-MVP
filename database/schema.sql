-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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