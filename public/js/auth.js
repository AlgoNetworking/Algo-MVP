// Authentication functions

async function checkAuth() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.authenticated) {
            window.location.href = '/';
        }
        return data;
    } catch (error) {
        console.error('Auth check failed:', error);
        return { authenticated: false };
    }
}

// Login form handler
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                window.location.href = '/';
            } else {
                errorDiv.textContent = data.message || 'Credenciais inválidas';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = 'Erro de conexão. Tente novamente.';
            errorDiv.style.display = 'block';
        }
    });
}

// Register form handler
if (document.getElementById('registerForm')) {
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        const errorDiv = document.getElementById('registerError');
        const successDiv = document.getElementById('registerSuccess');
        
        // Clear messages
        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';
        
        // Validate passwords
        if (password !== confirmPassword) {
            errorDiv.textContent = 'As senhas não coincidem';
            errorDiv.style.display = 'block';
            return;
        }
        
        if (password.length < 6) {
            errorDiv.textContent = 'A senha deve ter pelo menos 6 caracteres';
            errorDiv.style.display = 'block';
            return;
        }
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                successDiv.textContent = 'Conta criada com sucesso! Redirecionando...';
                successDiv.style.display = 'block';
                
                // Redirect after 2 seconds
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            } else {
                errorDiv.textContent = data.message || 'Erro ao criar conta';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = 'Erro de conexão. Tente novamente.';
            errorDiv.style.display = 'block';
        }
    });
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}