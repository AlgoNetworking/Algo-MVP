// Socket.IO connection
const socket = io();

// Global variables
let autoRefreshInterval = null;
let autoRefreshUserInterval = null;
let clients = [
    {
      "phone": "+55 85 8976-4552",
      "name": "Guilherme Mororó",
      "answered": false,
      "type": "normal",
      "isChatBot": true
    },
    {
      "phone": "+55 85 9789-2528", //seria interessante adicionar uma coisa que permita o numero ir de 
      // "+558597892528" pra "+55 85 9789-2528", deve ser facil.
      "name": "Pedro Tiraboschi",
      "answered": false,
      "type": "normal",
      "isChatBot": true
    },
    {
      "phone": "+55 85 9668-5918",
      "name": "Carlos Sérgio",
      "answered": false,
      "type": "normal",
      "isChatBot": true
    },
];

// Load clients from localStorage
function loadClients() {
    const stored = localStorage.getItem('whatsapp-bot-clients');
    if (stored) {
        clients = JSON.parse(stored);
    }
}

// Save clients to localStorage
function saveClients() {
    localStorage.setItem('whatsapp-bot-clients', JSON.stringify(clients));
}

// Add log entry
function addLog(message, type = 'info') {
    const logs = document.getElementById('logs');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `
        <span class="log-time">${new Date().toLocaleTimeString()}</span>
        <span class="log-message">${message}</span>
    `;
    logs.appendChild(logEntry);
    logs.scrollTop = logs.scrollHeight;
}

// Tab switching
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const tabId = tab.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// WhatsApp connection functions
async function connectWhatsApp() {
  try {
    addLog('📱 Conectando WhatsApp...');

    // 🔄 Reset ALL clients when reconnecting WhatsApp
    for(client of clients) {
      client.answered = false;
      client.isChatBot = true; // Reset bot functionality for everyone
    }
    
    saveClients(); // Save the changes
    renderClients(); // Update the UI

     const response = await fetch('/api/whatsapp/connect', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: clients })
    });
    const data = await response.json();
    
    if (data.success) {
      addLog('✅ WhatsApp conectando...');
    } else {
      addLog('❌ Erro: ' + data.message, 'error');
    }
  } catch (error) {
    addLog('❌ Erro de conexão: ' + error.message, 'error');
  }
}

async function disconnectWhatsApp() {
    try {
        addLog('🔌 Desconectando WhatsApp...');
        const response = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            addLog('✅ WhatsApp desconectado');
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
    }
}

async function sendBulkMessages() {
    if (clients.length === 0) {
        alert('Nenhum cliente cadastrado!');
        return;
    }

    if (!confirm(`Enviar mensagens para ${clients.length} clientes?`)) return;

    try {
        document.getElementById('sendBulkBtn').textContent = '📤 Enviando...';
        document.getElementById('sendBulkBtn').disabled = true;
        
        addLog('📤 Iniciando envio em massa...');
        const response = await fetch('/api/whatsapp/send-bulk', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ users: clients })
        });
        
        const data = await response.json();
        if (data.success) {
            addLog('✅ Envio em massa iniciado');
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
        document.getElementById('sendBulkBtn').textContent = '📤 Enviar Mensagens em Massa';
        document.getElementById('sendBulkBtn').disabled = false;
    }
}

async function downloadExcel() {
    try {
        addLog('📥 Baixando planilha...');
        const response = await fetch('/api/orders/download-excel');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pedidos.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        addLog('✅ Planilha baixada com sucesso!');
    } catch (error) {
        addLog('❌ Erro ao baixar planilha: ' + error.message, 'error');
    }
}

async function clearDatabase() {
    if (!confirm('⚠️ Limpar TODOS os dados do banco?')) return;
    
    try {
        const response = await fetch('/api/orders/clear-totals', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            addLog('✅ Banco de dados limpo!');
            refreshOrders();
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
    }
}

// Orders functions
async function refreshOrders() {
    try {
        const response = await fetch('/api/orders/totals');
        const data = await response.json();
        
        if (data.success) {
            renderOrdersTable(data.main_orders);
            updateStats(data.main_orders);
        }
    } catch (error) {
        console.error('Error refreshing orders:', error);
    }
}

function renderOrdersTable(orders) {
    const container = document.getElementById('ordersTable');
    const products = Object.entries(orders).filter(([_, qty]) => qty > 0);
    
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum pedido encontrado</div>';
        return;
    }
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Quantidade</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    products.forEach(([product, quantity]) => {
        html += `
            <tr>
                <td>${product}</td>
                <td>${quantity}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

function updateStats(orders) {
    const products = Object.keys(orders).filter(product => orders[product] > 0);
    const totalQuantity = Object.values(orders).reduce((sum, qty) => sum + qty, 0);
    
    document.getElementById('totalProducts').textContent = products.length;
    document.getElementById('totalQuantity').textContent = totalQuantity;
}

function toggleAutoRefresh() {
    const btn = document.getElementById('autoRefreshBtn');
    
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        btn.textContent = '🔁 Auto: OFF';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary');
        addLog('Auto-refresh desativado');
    } else {
        autoRefreshInterval = setInterval(refreshOrders, 5000);
        btn.textContent = '🔁 Auto: ON';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        addLog('Auto-refresh ativado (5s)');
        refreshOrders();
    }
}

// User orders functions
async function refreshUserOrders() {
    try {
        const response = await fetch('/api/orders/user-orders');
        const data = await response.json();
        
        if (data.success) {
            renderUserOrders(data.user_orders);
        }
    } catch (error) {
        console.error('Error refreshing user orders:', error);
    }
}

function renderUserOrders(orders) {
    const container = document.getElementById('userOrdersContainer');
    
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum pedido de usuário encontrado</div>';
        return;
    }
    
    let html = '';
    orders.forEach(order => {
        const parsedOrders = typeof order.parsed_orders === 'string' 
            ? JSON.parse(order.parsed_orders) 
            : order.parsed_orders;
            
        html += `
            <div class="order-box ${order.status}">
                <div class="order-header">
                    <span>${order.name} (${order.phone_number})</span>
                    <span>${new Date(order.created_at).toLocaleString()}</span>
                </div>
                <div class="order-items">
                    ${parsedOrders.map(item => 
                        `<span class="order-item-badge">${item.qty}x ${item.product}</span>`
                    ).join('')}
                </div>
                <div class="order-actions">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="confirmOrder(${order.id})">✅ Confirmar</button>
                    ` : ''}
                    <button class="btn btn-sm btn-danger" onclick="cancelOrder(${order.id})">❌ Cancelar</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

async function confirmOrder(orderId) {
    try {
        const response = await fetch('/api/orders/confirm-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });
        
        const data = await response.json();
        if (data.success) {
            addLog('✅ Pedido confirmado');
            refreshUserOrders();
            refreshOrders();
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
    }
}

async function cancelOrder(orderId) {
    if (!confirm('Cancelar este pedido?')) return;
    
    try {
        const response = await fetch('/api/orders/cancel-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });
        
        const data = await response.json();
        if (data.success) {
            addLog('🗑️ Pedido cancelado');
            refreshUserOrders();
            refreshOrders();
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
    }
}

async function clearUserOrders() {
    if (!confirm('⚠️ Limpar TODOS os pedidos de usuário?')) return;
    
    try {
        const response = await fetch('/api/orders/clear-user-orders', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            addLog('✅ ' + data.message);
            refreshUserOrders();
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
    }
}

function toggleAutoRefreshUser() {
    const btn = document.getElementById('autoRefreshUserBtn');
    
    if (autoRefreshUserInterval) {
        clearInterval(autoRefreshUserInterval);
        autoRefreshUserInterval = null;
        btn.textContent = '🔁 Auto: OFF';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary');
        addLog('Auto-refresh de usuários desativado');
    } else {
        autoRefreshUserInterval = setInterval(refreshUserOrders, 5000);
        btn.textContent = '🔁 Auto: ON';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        addLog('Auto-refresh de usuários ativado (5s)');
        refreshUserOrders();
    }
}

// Manual order form
document.getElementById('manualOrderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = document.getElementById('manualPhone').value;
    const name = document.getElementById('manualName').value;
    const type = document.getElementById('manualOrderType').value;
    const message = document.getElementById('manualMessage').value;
    
    try {
        addLog('📝 Adicionando pedido manual...');
        const response = await fetch('/api/orders/manual-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone_number: phone,
                client_name: name,
                order_type: type,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addLog(`✅ ${data.message}`);
            document.getElementById('manualOrderForm').reset();
            refreshUserOrders();
            refreshOrders();
            alert(`Pedido adicionado!\n${data.total_quantity} itens para ${data.client_name}`);
        } else {
            addLog(`❌ ${data.message}`, 'error');
            alert('Erro: ' + data.message);
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
        alert('Erro de conexão');
    }
});

// Client management
function renderClients() {
    const container = document.getElementById('clientsList');
    
    if (clients.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum cliente cadastrado</div>';
        return;
    }
    
    let html = '';
    clients.forEach((client, index) => {
        html += `
            <div class="client-card">
                <div class="client-info">
                    <div class="client-name">${client.name}</div>
                    <div class="client-phone">${client.phone} • Tipo: ${client.type}</div>
                    <div style="font-size: 0.85em; color: ${client.answered ? '#27ae60' : '#e74c3c'};">
                        ${client.answered ? '✅ Respondeu' : '⏳ Pendente'}
                    </div>
                </div>
                <div class="client-actions">
                    <button class="btn btn-sm btn-primary" onclick="editClient(${index})">✏️ Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteClient(${index})">🗑️ Deletar</button>
                    ${!client.answered ? `<button class="btn btn-sm btn-success" onclick="markAsAnswered(${index})">✅ Respondeu</button>` : ''}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function addClient() {
    const phone = prompt('Telefone do cliente (ex: +55 85 99999-9999):');
    if (!phone) return;
    
    const name = prompt('Nome do cliente:');
    if (!name) return;
    
    const type = prompt('Tipo de pedido (normal/quilo/dosado):', 'normal');
    if (!type) return;
    
    clients.push({
        phone: phone.trim(),
        name: name.trim(),
        type: type.toLowerCase().trim(),
        answered: false,
        isChatBot: true
    });
    
    saveClients();
    renderClients();
    addLog(`✅ Cliente ${name} adicionado`);
}

function editClient(index) {
    const client = clients[index];
    
    const phone = prompt('Telefone:', client.phone);
    if (phone === null) return;
    
    const name = prompt('Nome:', client.name);
    if (name === null) return;
    
    const type = prompt('Tipo (normal/quilo/dosado):', client.type);
    if (type === null) return;
    
    clients[index] = {
        ...client,
        phone: phone.trim(),
        name: name.trim(),
        type: type.toLowerCase().trim()
    };
    
    saveClients();
    renderClients();
    addLog(`✅ Cliente ${name} atualizado`);
}

function deleteClient(index) {
    if (!confirm(`Deletar ${clients[index].name}?`)) return;
    
    const name = clients[index].name;
    clients.splice(index, 1);
    saveClients();
    renderClients();
    addLog(`🗑️ Cliente ${name} removido`);
}

function markAsAnswered(index) {
    if(clients[index].answered === false) {
        clients[index].answered = true;
        saveClients();
        renderClients();
        addLog(`✅ ${clients[index].name} marcado como respondido`);
    }
}

function disableChatBot(index) {
    addLog('testando 3');
    clients[index].isChatBot = false;
    saveClients();
    renderClients();
    addLog(`✅ O bot foi desativado para ${clients[index].name} `);
    
}

// Socket.IO event handlers
socket.on('connect', () => {
    addLog('🔌 Conectado ao servidor');
});

socket.on('disconnect', () => {
    addLog('🔌 Desconectado do servidor');
    updateConnectionStatus(false);
});

socket.on('qr-code', (data) => {
    const container = document.getElementById('qrContainer');
    container.innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code" style="max-width: 300px;">`;
    addLog('📱 QR Code recebido - escaneie com WhatsApp');
});

socket.on('bot-ready', () => {
    addLog('✅ WhatsApp conectado e pronto!');
    updateConnectionStatus(true);
    document.getElementById('sendBulkBtn').disabled = false;
    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('connectBtn').disabled = true;
});

socket.on('bot-authenticated', () => {
    addLog('✅ WhatsApp autenticado');
});

socket.on('bot-error', (data) => {
    addLog(`❌ Erro: ${data.message}`, 'error');
});

socket.on('bot-disconnected', (data) => {
    addLog(`🔌 WhatsApp desconectado: ${data.reason}`);
    updateConnectionStatus(false);
    document.getElementById('connectBtn').disabled = false;
    document.getElementById('disconnectBtn').disabled = true;
    document.getElementById('sendBulkBtn').disabled = true;
});

socket.on('bot-stopped', () => {
    addLog('🛑 Bot parado');
    updateConnectionStatus(false);
    document.getElementById('sendBulkBtn').textContent = '📤 Enviar Mensagens em Massa';
    document.getElementById('sendBulkBtn').disabled = true;
    document.getElementById('disconnectBtn').disabled = true;
    document.getElementById('connectBtn').disabled = false;
});

socket.on('message-received', (data) => {
    addLog(`📩 Mensagem de ${data.from}: ${data.message.substring(0, 50)}`);
});

socket.on('user-answered-status-update', (data) => {
    const clientIndex = clients.findIndex(c => c.phone === data.phone);
    if (clientIndex !== -1) {
        markAsAnswered(clientIndex);
    }
    addLog(data.phone + "test");
});
/*
socket.on('disable-bot', (data) => {
    const clientDisableBotIndex = clients.findIndex(c => c.phone === data.phone);
    if (clientDisableBotIndex !== -1) {
        disableChatBot(clientDisableBotIndex);
        addLog(clients[clientDisableBotIndex].isChatBot);
    }
    addLog('testando bip bop...');
});
*/

socket.on('bulk-message-progress', (data) => {
    addLog(`📤 Enviado para ${data.name} (${data.phone})`);
    
    // Mark as answered
//    const clientIndex = clients.findIndex(c => c.phone === data.phone);
//    if (clientIndex !== -1) {
//        clients[clientIndex].answered = true;
//        saveClients();
//    }
});

socket.on('bulk-messages-complete', (data) => {
    addLog('✅ Envio de mensagens concluído!');
    document.getElementById('sendBulkBtn').textContent = '📤 Enviar Mensagens para seus Clientes';
    if(document.getElementById('connectBtn').disabled) {
        document.getElementById('sendBulkBtn').disabled = false;
    }
    else{
        document.getElementById('sendBulkBtn').disabled = true;
    }
    console.log(document.getElementById('connectBtn').disabled);
    const successful = data.results.filter(r => r.status === 'sent').length;
    if(successful == 1) {
        addLog(`Envio concluído!\n${successful} mensagem enviada com sucesso!`);
    }
    else if(successful > 1) {
        addLog(`Envio concluído!\n${successful} mensagens enviadas com sucesso!`);
    }
    renderClients();
});

socket.on('bot-status', (data) => {
    document.getElementById('sessionCount').textContent = data.sessions.length;
    updateConnectionStatus(data.isConnected);
});

// alterei umas coisas aqui pra quando o usuario reiniciar a pagina
function updateConnectionStatus(isConnected) {
    const statusBadge = document.getElementById('connectionStatus');
    
    if (isConnected) {
        statusBadge.textContent = 'Conectado';
        statusBadge.classList.remove('offline');
        statusBadge.classList.add('online');
    } else {
        statusBadge.textContent = 'Desconectado';
        statusBadge.classList.remove('online');
        statusBadge.classList.add('offline');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    addLog('🚀 Dashboard inicializado');
    setupTabs();
    loadClients();
    renderClients();
    
    // Setup button event listeners
    document.getElementById('connectBtn').addEventListener('click', connectWhatsApp);
    document.getElementById('disconnectBtn').addEventListener('click', disconnectWhatsApp);
    document.getElementById('sendBulkBtn').addEventListener('click', sendBulkMessages);
    document.getElementById('downloadExcelBtn').addEventListener('click', downloadExcel);
    document.getElementById('clearDbBtn').addEventListener('click', clearDatabase);
    
    // Load initial data
    setTimeout(() => {
        refreshOrders();
        refreshUserOrders();
    }, 1000);
});

// Status updates
setInterval(() => {
    fetch('/api/whatsapp/status')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                updateConnectionStatus(data.isConnected);
                document.getElementById('sessionCount').textContent = data.sessions.length;
            }
        })
        .catch(() => {});
}, 5000);