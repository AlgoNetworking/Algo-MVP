// Socket.IO connection
const socket = io();

// Global variables
let autoRefreshInterval = null;
let autoRefreshUserInterval = null;
let clients = [];
let products = [];
let notifications = [];
let notificationBadge = null;
let notificationsContainer = null;

// Modal system variables
let modalResolve = null;
let currentEditingIndex = -1;
let currentEditingType = null; // 'client' or 'product'
/*
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
*/

function initializeNotifications() {
    notificationBadge = document.getElementById('notificationBadge');
    notificationsContainer = document.getElementById('notificationsContainer');
    
    document.getElementById('clearAllNotificationsBtn').addEventListener('click', clearAllNotifications);
}

// Notification functions
function addNotification(phone, name) {
    // Check if notification already exists for this phone
    const existingIndex = notifications.findIndex(n => n.phone === phone);
    
    if (existingIndex === -1) {
        const notification = {
            id: Date.now() + Math.random(),
            phone: phone,
            name: name,
            message: "O cliente escolheu conversar com uma pessoa, no aguardo do atendimento",
            timestamp: new Date().toISOString(),
            read: false
        };
        
        notifications.push(notification);
        renderNotifications();
        updateNotificationBadge();
        
        // Also show a log message
        addLog(`🔔 Nova notificação: ${name} escolheu falar com pessoa`);
    }
}

function removeNotification(notificationId) {
    const index = notifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
        notifications.splice(index, 1);
        renderNotifications();
        updateNotificationBadge();
    }
}

async function clearAllNotifications() {
    if (notifications.length === 0) return;
    
    const confirmed = await confirmAction('Limpar Notificações', `Limpar todas as ${notifications.length} notificações?`);
    if (confirmed) {
        notifications = [];
        renderNotifications();
        updateNotificationBadge();
        addLog('🗑️ Todas as notificações foram limpas');
    }
}

function renderNotifications() {
    if (!notificationsContainer) return;
    
    if (notifications.length === 0) {
        notificationsContainer.innerHTML = '<div class="empty-state">Nenhuma notificação</div>';
        return;
    }
    
    let html = '';
    notifications.forEach(notification => {
        const time = new Date(notification.timestamp).toLocaleTimeString();
        
        html += `
            <div class="notification-box" data-id="${notification.id}">
                <div class="notification-header">
                    <span class="notification-client-name">${notification.name}</span>
                    <span class="notification-client-phone">${notification.phone}</span>
                </div>
                <div class="notification-message">
                    ${notification.message}
                </div>
                <div class="notification-time">
                    📅 Recebido em: ${time}
                </div>
                <div class="notification-actions">
                    <button class="notification-ok-btn" onclick="dismissNotification(${notification.id})">
                        OK
                    </button>
                </div>
            </div>
        `;
    });
    
    notificationsContainer.innerHTML = html;
}

function updateNotificationBadge() {
    if (!notificationBadge) return;
    
    const unreadCount = notifications.length;
    
    if (unreadCount > 0) {
        notificationBadge.textContent = unreadCount;
        notificationBadge.style.display = 'flex';
    } else {
        notificationBadge.style.display = 'none';
    }
}

function dismissNotification(notificationId) {
    removeNotification(notificationId);
}

// Modal Dialog System
function initializeModal() {
    const overlay = document.getElementById('modalOverlay');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    
    cancelBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        if (modalResolve) modalResolve(false);
    });
    
    confirmBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        if (modalResolve) modalResolve(true);
    });
    
    // Close modal when clicking outside
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.style.display = 'none';
            if (modalResolve) modalResolve(false);
        }
    });
}

// Custom confirm dialog
function customConfirm(title, message) {
    return new Promise((resolve) => {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        document.getElementById('modalOverlay').style.display = 'flex';
        modalResolve = resolve;
    });
}

// Replace all confirm dialogs
async function confirmAction(title, message) {
    return await customConfirm(title, message);
}

// Alert replacement
function customAlert(title, message) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    const modalFooter = document.querySelector('.modal-footer');
    modalFooter.style.display = 'none';
    
    return new Promise((resolve) => {
        const overlay = document.getElementById('modalOverlay');
        overlay.style.display = 'flex';
        
        const closeModal = () => {
            overlay.style.display = 'none';
            modalFooter.style.display = 'flex';
            overlay.removeEventListener('click', handleOutsideClick);
            resolve();
        };
        
        const handleOutsideClick = (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        };
        
        overlay.addEventListener('click', handleOutsideClick);
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    });
}

// Load clients from database
async function loadClients() {
    try {
        const response = await fetch('/api/clients');
        const data = await response.json();
        if (data.success) {
            clients = data.clients;
            renderClients();
        }
    } catch (error) {
        console.error('Error loading clients:', error);
    }
}

// Load products from database
async function loadProducts() {
    try {
        const response = await fetch('/api/products');
        const data = await response.json();
        if (data.success) {
            products = data.products;
            renderProducts();
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

// Save client to database
async function saveClient(client, isUpdate = false) {
    try {
        const url = isUpdate ? `/api/clients/${encodeURIComponent(client.phone)}` : '/api/clients';
        const method = isUpdate ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(client)
        });
        
        const data = await response.json();
        if (data.success) {
            await loadClients();
            addLog(`✅ Cliente ${isUpdate ? 'atualizado' : 'adicionado'}: ${client.name}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving client:', error);
        addLog(`❌ Erro ao salvar cliente: ${error.message}`, 'error');
        return false;
    }
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
    
    saveClient(); // Save the changes
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
      customAlert('Erro', data.message);
    }
  } catch (error) {
    addLog('❌ Erro de conexão: ' + error.message, 'error');
    customAlert('Erro de Conexão', error.message);
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
        customAlert('Aviso', 'Nenhum cliente cadastrado!');
        return;
    }

    const confirmed = await confirmAction('Enviar Mensagens', `Enviar mensagens para ${clients.length} clientes?`);
    if (!confirmed) return;

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
    const confirmed = await confirmAction('⚠️ Confirmar', 'Limpar TODOS os dados do banco?');
    if (!confirmed) return;
    
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

        const phoneNumber = `+${order.phone_number.slice(0, 2)} ${order.phone_number.slice(2, 4)} ${order.phone_number.slice(4, 8)}-${order.phone_number.slice(8, 12)}`;
            
        html += `
            <div class="order-box ${order.status}">
                <div class="order-header">
                    <span>${order.name} (${phoneNumber})</span>
                    <span>${new Date(order.created_at).toLocaleString()}</span>
                </div>
                <div class="order-items">
                    ${parsedOrders.map(item => 
                        `<span class="order-item-badge">${item.qty}x ${item.productName}</span>`
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
    const confirmed = await confirmAction('Cancelar Pedido', 'Cancelar este pedido?');
    if (!confirmed) return;
    
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
    const confirmed = await confirmAction('⚠️ Confirmar', 'Limpar TODOS os pedidos de usuário?');
    if (!confirmed) return;
    
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
            customAlert('Sucesso!', `Pedido adicionado!\n${data.total_quantity} itens para ${data.client_name}`);
        } else {
            addLog(`❌ ${data.message}`, 'error');
            customAlert('Erro', data.message);
        }
    } catch (error) {
        addLog('❌ Erro: ' + error.message, 'error');
        customAlert('Erro de Conexão', 'Não foi possível conectar ao servidor.');
    }
});

// Client management
function renderClients() {
    const container = document.getElementById('clientsList');
    
    if (clients.length === 0 && !container.querySelector('.add-client-form')) {
        container.innerHTML = '<div class="empty-state">Nenhum cliente cadastrado</div>';
        return;
    }
    
    let html = '';
    clients.forEach((client, index) => {
        const isEditing = currentEditingIndex === index && currentEditingType === 'client';
        
        html += `
            <div class="client-card ${isEditing ? 'editing' : ''}">
                <div class="client-info">
                    <div class="client-name">${client.name}</div>
                    <div class="client-phone">${client.phone} • Tipo: ${client.type}</div>
                    <div style="font-size: 0.85em; color: ${client.answered ? '#27ae60' : '#e74c3c'};">
                        ${client.answered ? '✅ Respondeu' : '⏳ Pendente'}
                    </div>
                </div>
                <div class="client-actions">
                    <button class="btn btn-sm btn-primary" onclick="editClient(${index})" ${isEditing ? 'disabled' : ''}>
                        ${isEditing ? '✏️ Editando...' : '✏️ Editar'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteClient(${index})" ${isEditing ? 'disabled' : ''}>
                        🗑️ Deletar
                    </button>
                    ${!client.answered ? `<button class="btn btn-sm btn-success" onclick="markAsAnswered(${index})" ${isEditing ? 'disabled' : ''}>✅ Respondeu</button>` : ''}
                </div>
            </div>
        `;
        
        if (isEditing) {
            html += `
                <div class="edit-form" id="editClientForm-${index}">
                    <div class="form-group">
                        <label for="editClientPhone-${index}">Telefone*:</label>
                        <input type="text" id="editClientPhone-${index}" value="${client.phone}" required>
                    </div>
                    <div class="form-group">
                        <label for="editClientName-${index}">Nome:</label>
                        <input type="text" id="editClientName-${index}" value="${client.name}" placeholder="Cliente sem nome">
                    </div>
                    <div class="form-group">
                        <label for="editClientType-${index}">Tipo de Pedido:</label>
                        <select id="editClientType-${index}">
                            <option value="normal" ${client.type === 'normal' ? 'selected' : ''}>Normal</option>
                            <option value="quilo" ${client.type === 'quilo' ? 'selected' : ''}>Quilo</option>
                            <option value="dosado" ${client.type === 'dosado' ? 'selected' : ''}>Dosado</option>
                        </select>
                    </div>
                    <div class="edit-form-actions">
                        <button class="btn btn-sm btn-danger" onclick="cancelEditClient()">Cancelar</button>
                        <button class="btn btn-sm btn-success" onclick="saveClientEdit(${index})">Salvar Alterações</button>
                    </div>
                </div>
            `;
        }
    });
    
    container.innerHTML = html;
}

// Product rendering and management
function renderProducts() {
    const container = document.getElementById('productsList');
    
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum produto cadastrado</div>';
        return;
    }
    
    let html = '';
    products.forEach((product, index) => {
        const isEditing = currentEditingIndex === index && currentEditingType === 'product';
        
        html += `
            <div class="product-card ${isEditing ? 'editing' : ''}">
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-akas">AKAs: ${Array.isArray(product.akas) ? product.akas.join(', ') : product.akas}</div>
                    <div style="display: flex; align-items: center; margin-top: 5px;">
                        <button class="toggle-btn ${product.enabled ? 'active' : ''}" onclick="toggleProduct(${index}, ${!product.enabled})" 
                                title="${product.enabled ? 'Desativar' : 'Ativar'}">
                        </button>
                        <span class="toggle-status" style="color: ${product.enabled ? '#27ae60' : '#e74c3c'}">
                            ${product.enabled ? '✅ Ativo' : '⏸️ Desativado'}
                        </span>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="btn btn-sm btn-primary" onclick="editProduct(${index})" ${isEditing ? 'disabled' : ''}>
                        ${isEditing ? '✏️ Editando...' : '✏️ Editar'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteProduct(${index})" ${isEditing ? 'disabled' : ''}>
                        🗑️ Deletar
                    </button>
                </div>
            </div>
        `;
        
        if (isEditing) {
            html += `
                <div class="edit-form" id="editProductForm-${index}">
                    <div class="form-group">
                        <label for="editProductName-${index}">Nome do Produto*:</label>
                        <input type="text" id="editProductName-${index}" value="${product.name}" required>
                    </div>
                    <div class="form-group">
                        <label for="editProductAkas-${index}">AKAs (separados por vírgula):</label>
                        <input type="text" id="editProductAkas-${index}" 
                               value="${Array.isArray(product.akas) ? product.akas.join(', ') : product.akas}">
                    </div>
                    <div class="edit-form-actions">
                        <button class="btn btn-sm btn-danger" onclick="cancelEditProduct()">Cancelar</button>
                        <button class="btn btn-sm btn-success" onclick="saveProductEdit(${index})">Salvar Alterações</button>
                    </div>
                </div>
            `;
        }
    });
    
    container.innerHTML = html;
}

// Update client functions to use database
function addClient() {
    const container = document.getElementById('clientsList');
    
    // Remove any existing add form
    const existingForm = container.querySelector('.add-client-form');
    if (existingForm) {
        existingForm.remove();
        return;
    }
    
    const addForm = document.createElement('div');
    addForm.className = 'add-client-form';
    addForm.innerHTML = `
        <h3 style="margin-bottom: 15px; color: #2c3e50;">➕ Adicionar Novo Cliente</h3>
        <div class="form-group">
            <label for="newClientPhone">Telefone*:</label>
            <input type="text" id="newClientPhone" placeholder="+55 85 99999-9999" required>
        </div>
        <div class="form-group">
            <label for="newClientName">Nome:</label>
            <input type="text" id="newClientName" placeholder="Deixe em branco para 'Cliente sem nome'">
        </div>
        <div class="form-group">
            <label for="newClientType">Tipo de Pedido:</label>
            <select id="newClientType">
                <option value="normal">Normal</option>
                <option value="quilo">Quilo</option>
                <option value="dosado">Dosado</option>
            </select>
        </div>
        <div class="edit-form-actions">
            <button class="btn btn-sm btn-danger" onclick="cancelAddClient()">Cancelar</button>
            <button class="btn btn-sm btn-success" onclick="saveNewClient()">Salvar Cliente</button>
        </div>
    `;
    
    container.prepend(addForm);
    document.getElementById('newClientPhone').focus();
}

function cancelAddClient() {
    const form = document.querySelector('.add-client-form');
    if (form) form.remove();
}

async function saveNewClient() {
    const phone = document.getElementById('newClientPhone').value.trim();
    const name = document.getElementById('newClientName').value.trim();
    const type = document.getElementById('newClientType').value;
    
    if (!phone) {
        customAlert('Erro', 'O telefone é obrigatório!');
        return;
    }
    
    await saveClient({
        phone: phone,
        name: name || 'Cliente sem nome',
        type: type
    });
    
    cancelAddClient();
}

function editClient(index) {
    if (currentEditingIndex !== -1) {
        cancelEditClient();
    }
    currentEditingIndex = index;
    currentEditingType = 'client';
    renderClients();
}

function cancelEditClient() {
    currentEditingIndex = -1;
    currentEditingType = null;
    renderClients();
}

async function deleteClient(index) {
    const confirmed = await confirmAction('Deletar Cliente', `Deletar ${clients[index].name}?`);
    if (!confirmed) return;
    
    await deleteClientFromDb(clients[index].phone);
}

async function saveClientEdit(index) {
    const phone = document.getElementById(`editClientPhone-${index}`).value.trim();
    const name = document.getElementById(`editClientName-${index}`).value.trim();
    const type = document.getElementById(`editClientType-${index}`).value;
    
    if (!phone) {
        customAlert('Erro', 'O telefone é obrigatório!');
        return;
    }
    
    const success = await saveClient({
        phone: phone,
        name: name || 'Cliente sem nome',
        type: type
    }, true);
    
    if (success) {
        currentEditingIndex = -1;
        currentEditingType = null;
        renderClients();
    }
}

// Delete client from database
async function deleteClientFromDb(phone) {
    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(phone)}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            await loadClients();
            addLog('🗑️ Cliente removido');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting client:', error);
        addLog(`❌ Erro ao deletar cliente: ${error.message}`, 'error');
        return false;
    }
}

async function markAsAnswered(index) {
    if (clients[index].answered === false) {
        await updateClientAnsweredStatus(clients[index].phone, true);
    }
}

// Update client answered status
async function updateClientAnsweredStatus(phone, answered) {
    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(phone)}/answered`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answered })
        });
        
        const data = await response.json();
        if (data.success) {
            await loadClients();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error updating client status:', error);
        return false;
    }
}

async function disableChatBot(index) {
    await updateClientChatBotStatus(clients[index].phone, false);
    addLog(`✅ O bot foi desativado para ${clients[index].name}`);
}

// Update client chatbot status
async function updateClientChatBotStatus(phone, isChatBot) {
    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(phone)}/chatbot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isChatBot })
        });
        
        const data = await response.json();
        if (data.success) {
            await loadClients();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error updating client chatbot status:', error);
        return false;
    }
}

// Product management functions
async function saveProduct(product, isUpdate = false) {
    try {
        const url = isUpdate ? `/api/products/${product.id}` : '/api/products';
        const method = isUpdate ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        
        const data = await response.json();
        if (data.success) {
            await loadProducts();
            addLog(`✅ Produto ${isUpdate ? 'atualizado' : 'adicionado'}: ${product.name}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving product:', error);
        addLog(`❌ Erro ao salvar produto: ${error.message}`, 'error');
        return false;
    }
}

async function deleteProductFromDb(id) {
    try {
        const response = await fetch(`/api/products/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            await loadProducts();
            addLog('🗑️ Produto removido');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting product:', error);
        addLog(`❌ Erro ao deletar produto: ${error.message}`, 'error');
        return false;
    }
}

async function toggleProductEnabled(id, enabled) {
    try {
        const response = await fetch(`/api/products/${id}/toggle`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        
        const data = await response.json();
        if (data.success) {
            await loadProducts();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error toggling product:', error);
        return false;
    }
}

function addProduct() {
    const container = document.getElementById('productsList');
    
    // Remove any existing add form
    const existingForm = container.querySelector('.add-product-form');
    if (existingForm) {
        existingForm.remove();
        return;
    }
    
    const addForm = document.createElement('div');
    addForm.className = 'add-product-form';
    addForm.innerHTML = `
        <h3 style="margin-bottom: 15px; color: #2c3e50;">➕ Adicionar Novo Produto</h3>
        <div class="form-group">
            <label for="newProductName">Nome do Produto*:</label>
            <input type="text" id="newProductName" placeholder="Nome do produto" required>
        </div>
        <div class="form-group">
            <label for="newProductAkas">AKAs (separados por vírgula, opcional):</label>
            <input type="text" id="newProductAkas" placeholder="sinônimos, variações">
        </div>
        <div class="form-group">
            <label style="display: flex; align-items: center;">
                <input type="checkbox" id="newProductEnabled" checked style="margin-right: 10px;">
                Produto Ativo
            </label>
        </div>
        <div class="edit-form-actions">
            <button class="btn btn-sm btn-danger" onclick="cancelAddProduct()">Cancelar</button>
            <button class="btn btn-sm btn-success" onclick="saveNewProduct()">Salvar Produto</button>
        </div>
    `;
    
    container.prepend(addForm);
    document.getElementById('newProductName').focus();
}

function cancelAddProduct() {
    const form = document.querySelector('.add-product-form');
    if (form) form.remove();
}

async function saveNewProduct() {
    const name = document.getElementById('newProductName').value.trim();
    const akasInput = document.getElementById('newProductAkas').value.trim();
    const akas = akasInput ? akasInput.split(',').map(a => a.trim()).filter(a => a) : [];
    const enabled = document.getElementById('newProductEnabled').checked;
    
    if (!name) {
        customAlert('Erro', 'O nome do produto é obrigatório!');
        return;
    }
    
    await saveProduct({
        name: name,
        akas: akas,
        enabled: enabled
    });
    
    cancelAddProduct();
}

function editProduct(index) {
    if (currentEditingIndex !== -1) {
        cancelEditProduct();
    }
    currentEditingIndex = index;
    currentEditingType = 'product';
    renderProducts();
}

function cancelEditProduct() {
    currentEditingIndex = -1;
    currentEditingType = null;
    renderProducts();
}

async function saveProductEdit(index) {
    const name = document.getElementById(`editProductName-${index}`).value.trim();
    const akasInput = document.getElementById(`editProductAkas-${index}`).value.trim();
    const akas = akasInput ? akasInput.split(',').map(a => a.trim()).filter(a => a) : [];
    
    if (!name) {
        customAlert('Erro', 'O nome do produto é obrigatório!');
        return;
    }
    
    const success = await saveProduct({
        id: products[index].id,
        name: name,
        akas: akas,
        enabled: products[index].enabled
    }, true);
    
    if (success) {
        currentEditingIndex = -1;
        currentEditingType = null;
        renderProducts();
    }
}


async function deleteProduct(index) {
    const confirmed = await confirmAction('Deletar Produto', `Deletar "${products[index].name}"?`);
    if (!confirmed) return;
    
    await deleteProductFromDb(products[index].id);
}

async function toggleProduct(index, enabled) {
    await toggleProductEnabled(products[index].id, enabled);
    renderProducts();
}

function formatPhoneNumberForDisplay(phone) {
    // Convert from whatsapp format (5585999999999@c.us) to display format
    const cleanPhone = phone.replace('@c.us', '');
    
    if (cleanPhone.length === 13) { // Brazil format with country code
        return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 8)}-${cleanPhone.slice(8, 12)}`;
    } else if (cleanPhone.length === 11) { // Brazil format without +
        return `${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 7)}-${cleanPhone.slice(7, 11)}`;
    }
    
    return phone;
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

socket.on('disable-bot', (data) => {
    // Create notification when user chooses option 2
    const formattedPhone = formatPhoneNumberForDisplay(data.phone);
    const user = clients.find(c => c.phone === formattedPhone);
    
    if (user) {
        addNotification(formattedPhone, user.name);
    } else {
        // Try to find user without formatting
        const unformattedUser = clients.find(c => {
            const normalizedPhone = c.phone.replace(/[+\-\s]/g, '');
            const normalizedDataPhone = data.phone.replace(/[+\-\s]/g, '');
            return normalizedPhone.includes(normalizedDataPhone) || 
                   normalizedDataPhone.includes(normalizedPhone);
        });
        
        if (unformattedUser) {
            addNotification(unformattedUser.phone, unformattedUser.name);
        } else {
            addNotification(data.phone, 'Cliente sem Nome');
        }
    }
    
    // Update client chatbot status
    const clientDisableBotIndex = clients.findIndex(c => c.phone === formattedPhone);
    if (clientDisableBotIndex !== -1) {
        disableChatBot(clientDisableBotIndex);
    }
});


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
    
    // The button state will be updated by the next status check
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
    updateConnectionStatus(data.isConnected, data.isSendingMessages, data.sendingProgress);
});

// alterei umas coisas aqui pra quando o usuario reiniciar a pagina
function updateConnectionStatus(isConnected, isSendingMessages = false, sendingProgress = null) {
    const statusBadge = document.getElementById('connectionStatus');
    const sendBulkBtn = document.getElementById('sendBulkBtn');
    
    if (isConnected) {
        statusBadge.textContent = 'Conectado';
        statusBadge.classList.remove('offline');
        statusBadge.classList.add('online');
        document.getElementById('connectBtn').disabled = true;
        document.getElementById('disconnectBtn').disabled = false;
        
        if (isSendingMessages) {
            sendBulkBtn.textContent = '📤 Enviando...';
            sendBulkBtn.disabled = true;
            // Optional: Show progress
            if (sendingProgress) {
                sendBulkBtn.textContent = `📤 Enviando... (${sendingProgress.sent}/${sendingProgress.total})`;
            }
        } else {
            sendBulkBtn.textContent = '📤 Enviar Mensagens em Massa';
            sendBulkBtn.disabled = false;
        }
    } else {
        statusBadge.textContent = 'Desconectado';
        statusBadge.classList.remove('online');
        statusBadge.classList.add('offline');
        document.getElementById('connectBtn').disabled = false;
        document.getElementById('disconnectBtn').disabled = true;
        sendBulkBtn.textContent = '📤 Enviar Mensagens em Massa';
        sendBulkBtn.disabled = true;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    addLog('🚀 Dashboard inicializado');
    setupTabs();
    loadClients();
    renderClients();
    loadProducts();
    initializeNotifications();
    initializeModal(); // Add this line
    
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
                // Also get sending status
                fetch('/api/whatsapp/sending-status')
                    .then(r => r.json())
                    .then(sendingData => {
                        if (sendingData.success) {
                            updateConnectionStatus(
                                data.isConnected, 
                                sendingData.isSendingMessages,
                                sendingData.progress
                            );
                            document.getElementById('sessionCount').textContent = data.sessions.length;
                        }
                    })
                    .catch(() => {});
            }
        })
        .catch(() => {});
}, 5000);