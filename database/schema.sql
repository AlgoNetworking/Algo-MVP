-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    order_type VARCHAR(20) DEFAULT 'normal',
    answered BOOLEAN DEFAULT FALSE,
    is_chatbot BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    akas JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default products
INSERT INTO products (name, akas, enabled) VALUES
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