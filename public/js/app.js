let currentUser = null;

async function checkAuthentication() {
  try {
    const response = await fetch('/api/check-auth');
    const data = await response.json();
    
    if (!data.authenticated) {
      window.location.href = '/login';
      return false;
    }
    
    currentUser = data.user;
    updateUserInfo();
    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    window.location.href = '/login';
    return false;
  }
}

function updateUserInfo() {
  if (currentUser) {
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    
    if (userName) {
      userName.textContent = currentUser.username;
    }
    
    if (userAvatar) {
      userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
    }
  }
}

async function logout() {
  const confirmed = await confirmAction('Sair', 'Deseja realmente sair da sua conta?');
  if (!confirmed) return;
  
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Logout error:', error);
    customAlert('Erro', 'Erro ao fazer logout. Tente novamente.');
  }
}

// Global variables
let autoRefreshInterval = null;
let autoRefreshUserInterval = null;
let clients = [];
let products = [];
let notifications = [];
let notificationBadge = null;
let notificationsContainer = null;
let folders = [];
let currentFolder = null;
let folderClients = [];
let folderHasUnsavedChanges = false;

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

// Load folders from database
async function loadFolders() {
  try {
    const response = await fetch('/api/folders');
    const data = await response.json();
    if (data.success) {
      folders = data.folders;
      renderFolders();
    }
  } catch (error) {
    console.error('Error loading folders:', error);
  }
}

// Load clients for a specific folder
async function loadFolderClients(folderId) {
  try {
    const response = await fetch(`/api/clients?folderId=${folderId}`);
    const data = await response.json();
    if (data.success) {
      folderClients = data.clients;
      renderFolderClients();
    }
  } catch (error) {
    console.error('Error loading folder clients:', error);
  }
}

// Render folders list
function renderFolders() {
  const container = document.getElementById('clientsList');
  
  // Create folder dashboard
  let html = `
    <div class="folders-dashboard">
      <h3 style="margin-bottom: 20px;">📁 Pastas de Clientes</h3>
      <button class="btn btn-primary" onclick="showAddFolderForm()">
        ➕ Nova Pasta
      </button>
      
      <div class="folders-list" style="margin-top: 20px;">
  `;
  
  if (folders.length === 0) {
    html += `
      <div class="empty-state" style="margin-top: 20px;">
        Nenhuma pasta criada ainda. Crie uma pasta para adicionar clientes.
      </div>
    `;
  } else {
    folders.forEach(folder => {
      html += `
        <div class="folder-card" data-folder-id="${folder.id}">
          <div class="folder-info">
            <div class="folder-name">📁 ${folder.name}</div>
            <div class="folder-date">
              Criado em: ${new Date(folder.created_at).toLocaleDateString()}
            </div>
          </div>
          <div class="folder-actions">
            <button class="btn btn-sm btn-primary" onclick="openFolder(${folder.id})">
              🔓 Acessar Pasta
            </button>
            <button class="btn btn-sm btn-warning" onclick="editFolder(${folder.id})">
              ✏️ Editar Nome
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteFolder(${folder.id})">
              🗑️ Deletar
            </button>
          </div>
        </div>
      `;
    });
  }
  
  html += `
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

// Render folder content (clients inside a folder)
function renderFolderClients() {
  if (!currentFolder) return;
  
  const container = document.getElementById('clientsList');
  
  let html = `
    <div class="folder-view">
      <div class="folder-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3>
          📁 ${currentFolder.name} 
          <span style="font-size: 14px; color: #7f8c8d;">
            (${folderClients.length} cliente${folderClients.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <div>
          <button class="btn btn-sm btn-info" onclick="showImportTxtForm()">
            📄 Importar do TXT
          </button>
          <button class="btn btn-sm btn-primary" onclick="addFolderClient()">
            ➕ Adicionar Cliente
          </button>
          <button class="btn btn-sm btn-danger" onclick="closeFolder()" ${folderHasUnsavedChanges ? 'disabled' : ''}>
            ⬅️ Voltar
          </button>
        </div>
      </div>
      
      <div class="unsaved-changes-warning" style="${folderHasUnsavedChanges ? '' : 'display: none;'} background-color: #fff3cd; border: 2px solid #f39c12; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #856404; font-weight: bold;">⚠️ Você tem alterações não salvas!</span>
          <div>
            <button class="btn btn-sm btn-success" onclick="saveFolderChanges()" style="margin-right: 10px;">
              💾 Salvar Alterações
            </button>
            <button class="btn btn-sm btn-danger" onclick="cancelFolderChanges()">
              ❌ Cancelar Alterações
            </button>
          </div>
        </div>
      </div>
      
      <div id="folderClientsContainer">
  `;
  
  if (folderClients.length === 0) {
    html += `
      <div class="empty-state">
        Nenhum cliente nesta pasta. Adicione um cliente para começar.
      </div>
    `;
  } else {
    folderClients.forEach((client, index) => {
      const isEditing = currentEditingIndex === index && currentEditingType === 'folder-client';
      
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
            <button class="btn btn-sm btn-primary" onclick="editFolderClient(${index})" ${isEditing ? 'disabled' : ''}>
              ${isEditing ? '✏️ Editando...' : '✏️ Editar'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteFolderClient(${index})" ${isEditing ? 'disabled' : ''}>
              🗑️ Deletar
            </button>
            ${!client.answered ? `<button class="btn btn-sm btn-success" onclick="markFolderClientAsAnswered(${index})" ${isEditing ? 'disabled' : ''}>✅ Respondeu</button>` : ''}
          </div>
        </div>
      `;
      
      if (isEditing) {
        html += `
          <div class="edit-form" id="editFolderClientForm-${index}">
            <div class="form-group">
              <label for="editFolderClientPhone-${index}">Telefone*:</label>
              <input type="text" id="editFolderClientPhone-${index}" value="${client.phone}" required>
            </div>
            <div class="form-group">
              <label for="editFolderClientName-${index}">Nome:</label>
              <input type="text" id="editFolderClientName-${index}" value="${client.name}" placeholder="Cliente sem nome">
            </div>
            <div class="form-group">
              <label for="editFolderClientType-${index}">Tipo de Pedido:</label>
              <select id="editFolderClientType-${index}">
                <option value="normal" ${client.type === 'normal' ? 'selected' : ''}>Normal</option>
                <option value="quilo" ${client.type === 'quilo' ? 'selected' : ''}>Quilo</option>
                <option value="dosado" ${client.type === 'dosado' ? 'selected' : ''}>Dosado</option>
              </select>
            </div>
            <div class="edit-form-actions">
              <button class="btn btn-sm btn-danger" onclick="cancelEditFolderClient()">Cancelar</button>
              <button class="btn btn-sm btn-success" onclick="saveFolderClientEdit(${index})">Salvar Alterações</button>
            </div>
          </div>
        `;
      }
    });
  }
  
  html += `
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

// Show add folder form
function showAddFolderForm() {
  const container = document.getElementById('clientsList');
  const addForm = document.createElement('div');
  addForm.className = 'add-folder-form';
  addForm.style.cssText = 'background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 10px; padding: 20px; margin-bottom: 20px; animation: slideDown 0.3s ease;';
  
  addForm.innerHTML = `
    <h3 style="margin-bottom: 15px; color: #2c3e50;">➕ Criar Nova Pasta</h3>
    <div class="form-group">
      <label for="newFolderName">Nome da Pasta*:</label>
      <input type="text" id="newFolderName" placeholder="Ex: Clientes VIP" required style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; font-family: inherit;">
    </div>
    <div class="edit-form-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
      <button class="btn btn-sm btn-danger" onclick="cancelAddFolder()">Cancelar</button>
      <button class="btn btn-sm btn-success" onclick="saveNewFolder()">Criar Pasta</button>
    </div>
  `;
  
  container.querySelector('.folders-dashboard').appendChild(addForm);
  document.getElementById('newFolderName').focus();
}

// Cancel add folder
function cancelAddFolder() {
  const form = document.querySelector('.add-folder-form');
  if (form) form.remove();
}

// Save new folder
async function saveNewFolder() {
  const name = document.getElementById('newFolderName').value.trim();
  
  if (!name) {
    customAlert('Erro', 'O nome da pasta é obrigatório!');
    return;
  }
  
  try {
    const response = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`✅ Pasta criada: ${name}`);
      await loadFolders();
      cancelAddFolder();
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error creating folder:', error);
    addLog(`❌ Erro ao criar pasta: ${error.message}`, 'error');
  }
}

// Edit folder
async function editFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  
  const newName = prompt('Novo nome da pasta:', folder.name);
  if (!newName || newName.trim() === '') return;
  
  try {
    const response = await fetch(`/api/folders/${folderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`✅ Pasta atualizada: ${newName}`);
      await loadFolders();
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error updating folder:', error);
    addLog(`❌ Erro ao atualizar pasta: ${error.message}`, 'error');
  }
}

// Delete folder
async function deleteFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  
  const confirmed = await confirmAction('Deletar Pasta', `Deletar a pasta "${folder.name}" e todos os clientes dentro dela?`);
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/folders/${folderId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`🗑️ Pasta deletada: ${folder.name}`);
      if (currentFolder && currentFolder.id === folderId) {
        currentFolder = null;
        folderClients = [];
      }
      await loadFolders();
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error deleting folder:', error);
    addLog(`❌ Erro ao deletar pasta: ${error.message}`, 'error');
  }
}

// Open folder
async function openFolder(folderId) {
  if (folderHasUnsavedChanges) {
    const confirmed = await confirmAction('Alterações não salvas', 'Você tem alterações não salvas. Deseja descartá-las e abrir outra pasta?');
    if (!confirmed) return;
    folderHasUnsavedChanges = false;
  }
  
  try {
    const response = await fetch(`/api/folders/${folderId}`);
    const data = await response.json();
    if (data.success) {
      currentFolder = data.folder;
      currentEditingIndex = -1;
      currentEditingType = null;
      await loadFolderClients(folderId);
    }
  } catch (error) {
    console.error('Error opening folder:', error);
    addLog(`❌ Erro ao abrir pasta: ${error.message}`, 'error');
  }
}

// Close folder
function closeFolder() {
  if (folderHasUnsavedChanges) {
    customAlert('Alterações não salvas', 'Você precisa salvar ou cancelar as alterações antes de fechar a pasta.');
    return;
  }
  
  currentFolder = null;
  folderClients = [];
  currentEditingIndex = -1;
  currentEditingType = null;
  renderFolders();
}

// Add folder client
function addFolderClient() {
  if (!currentFolder) return;
  
  const container = document.getElementById('folderClientsContainer');
  
  // Remove any existing add form
  const existingForm = container.querySelector('.add-folder-client-form');
  if (existingForm) {
    existingForm.remove();
    return;
  }
  
  const addForm = document.createElement('div');
  addForm.className = 'add-folder-client-form';
  addForm.style.cssText = 'background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 10px; padding: 20px; margin-bottom: 15px; animation: slideDown 0.3s ease;';
  
  addForm.innerHTML = `
    <h4 style="margin-bottom: 15px; color: #2c3e50;">➕ Adicionar Cliente à Pasta</h4>
    <div class="form-group">
      <label for="newFolderClientPhone">Telefone*:</label>
      <input type="text" id="newFolderClientPhone" placeholder="+55 85 9999-9999" required style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; font-family: inherit;">
    </div>
    <div class="form-group">
      <label for="newFolderClientName">Nome:</label>
      <input type="text" id="newFolderClientName" placeholder="Deixe em branco para \'Cliente sem nome\'" style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; font-family: inherit;">
    </div>
    <div class="form-group">
      <label for="newFolderClientType">Tipo de Pedido:</label>
      <select id="newFolderClientType" style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; font-family: inherit;">
        <option value="normal">Normal</option>
        <option value="quilo">Quilo</option>
        <option value="dosado">Dosado</option>
      </select>
    </div>
    <div class="edit-form-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
      <button class="btn btn-sm btn-danger" onclick="cancelAddFolderClient()">Cancelar</button>
      <button class="btn btn-sm btn-success" onclick="saveNewFolderClient()">Salvar Cliente</button>
    </div>
  `;
  
  container.prepend(addForm);
  document.getElementById('newFolderClientPhone').focus();
}

// Cancel add folder client
function cancelAddFolderClient() {
  const form = document.querySelector('.add-folder-client-form');
  if (form) form.remove();
}

// Save new folder client
async function saveNewFolderClient() {
  if (!currentFolder) return;
  
  const phone = document.getElementById('newFolderClientPhone').value.trim();
  const name = document.getElementById('newFolderClientName').value.trim();
  const type = document.getElementById('newFolderClientType').value;
  
  if (!phone) {
    customAlert('Erro', 'O telefone é obrigatório!');
    return;
  }

  const normalizedPhone = normalizePhoneNumber(phone);
  
  try {
    const response = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: normalizedPhone,
        name: name || 'Cliente sem nome',
        type,
        folderId: currentFolder.id
      })
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`✅ Cliente adicionado à pasta: ${name || 'Cliente sem nome'}`);
      folderHasUnsavedChanges = true;
      await loadFolderClients(currentFolder.id);
      cancelAddFolderClient();
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error adding folder client:', error);
    addLog(`❌ Erro ao adicionar cliente: ${error.message}`, 'error');
  }
}

// Edit folder client
function editFolderClient(index) {
  if (currentEditingIndex !== -1) {
    cancelEditFolderClient();
  }
  currentEditingIndex = index;
  currentEditingType = 'folder-client';
  renderFolderClients();
}

// Cancel edit folder client
function cancelEditFolderClient() {
  currentEditingIndex = -1;
  currentEditingType = null;
  renderFolderClients();
}

// Save folder client edit
async function saveFolderClientEdit(index) {
  if (!currentFolder) return;
  
  const client = folderClients[index];
  const phone = document.getElementById(`editFolderClientPhone-${index}`).value.trim();
  const name = document.getElementById(`editFolderClientName-${index}`).value.trim();
  const type = document.getElementById(`editFolderClientType-${index}`).value;
  
  if (!phone) {
    customAlert('Erro', 'O telefone é obrigatório!');
    return;
  }
  
  try {
    const response = await fetch(`/api/clients/${client.phone}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        name: name || 'Cliente sem nome',
        type,
        folderId: currentFolder.id
      })
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`✅ Cliente atualizado: ${name || 'Cliente sem nome'}`);
      folderHasUnsavedChanges = true;
      currentEditingIndex = -1;
      currentEditingType = null;
      await loadFolderClients(currentFolder.id);
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error updating folder client:', error);
    addLog(`❌ Erro ao atualizar cliente: ${error.message}`, 'error');
  }
}

// Delete folder client
async function deleteFolderClient(index) {
  if (!currentFolder) return;
  
  const client = folderClients[index];
  const confirmed = await confirmAction('Deletar Cliente', `Deletar ${client.name}?`);
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/clients/${encodeURIComponent(client.phone)}?folderId=${currentFolder.id}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    if (data.success) {
      addLog(`🗑️ Cliente removido da pasta: ${client.name}`);
      folderHasUnsavedChanges = true;
      await loadFolderClients(currentFolder.id);
    } else {
      customAlert('Erro', data.message);
    }
  } catch (error) {
    console.error('Error deleting folder client:', error);
    addLog(`❌ Erro ao deletar cliente: ${error.message}`, 'error');
  }
}

// Mark folder client as answered
async function markFolderClientAsAnswered(index) {
  if (!currentFolder) return;
  
  const client = folderClients[index];
  if (client.answered === false) {
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(client.phone)}/answered`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          answered: true,
          folderId: currentFolder.id 
        })
      });
      
      const data = await response.json();
      if (data.success) {
        addLog(`✅ Cliente marcado como respondido: ${client.name}`);
        folderHasUnsavedChanges = true;
        await loadFolderClients(currentFolder.id);
      }
    } catch (error) {
      console.error('Error updating folder client status:', error);
    }
  }
}

// Save all folder changes
async function saveFolderChanges() {
  if (!currentFolder) return;
  
  // In a real implementation, you might need to sync multiple changes
  // For now, we'll just reset the unsaved changes flag
  folderHasUnsavedChanges = false;
  addLog(`✅ Alterações na pasta "${currentFolder.name}" salvas com sucesso!`);
  renderFolderClients();
}

// Cancel folder changes
async function cancelFolderChanges() {
  if (!currentFolder) return;
  
  const confirmed = await confirmAction('Cancelar Alterações', 'Descartar todas as alterações não salvas?');
  if (!confirmed) return;
  
  folderHasUnsavedChanges = false;
  await loadFolderClients(currentFolder.id);
  addLog(`❌ Alterações na pasta "${currentFolder.name}" descartadas.`);
}

// Update folder selection dropdown
async function updateFolderSelect() {
  try {
    const response = await fetch('/api/folders');
    const data = await response.json();
    if (data.success) {
      folders = data.folders;
      const select = document.getElementById('folderSelect');
      const info = document.getElementById('selectedFolderInfo');
      
      // Clear existing options except first
      while (select.options.length > 1) {
        select.remove(1);
      }
      
      // Add folder options
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        select.appendChild(option);
      });
      
      // Restore selected folder if exists
      if (selectedFolderId) {
        select.value = selectedFolderId;
        info.textContent = `Selecionada: ${selectedFolderName}`;
        info.style.display = 'block';
      } else {
        info.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error loading folders for select:', error);
  }
}

// Update selected folder
function updateSelectedFolder(folderId) {
  selectedFolderId = folderId;
  const select = document.getElementById('folderSelect');
  const info = document.getElementById('selectedFolderInfo');
  
  if (folderId) {
    const folder = folders.find(f => f.id == folderId);
    if (folder) {
      selectedFolderName = folder.name;
      info.textContent = `Selecionada: ${folder.name}`;
      info.style.display = 'block';
      addLog(`📁 Pasta selecionada: ${folder.name}`);
    }
  } else {
    selectedFolderName = null;
    info.style.display = 'none';
    addLog('⚠️ Nenhuma pasta selecionada');
  }
}



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
    
    // Get clients from selected folder
    let selectedClients = [];
    if (selectedFolderId) {
      const response = await fetch(`/api/clients?folderId=${selectedFolderId}`);
      const data = await response.json();
      if (data.success) {
        selectedClients = data.clients;
        addLog(`📁 Usando pasta selecionada com ${selectedClients.length} clientes`);
      }
    } else {
      // Fallback to all clients if no folder selected
      const response = await fetch('/api/clients');
      const data = await response.json();
      if (data.success) {
        selectedClients = data.clients;
        addLog('⚠️ Nenhuma pasta selecionada, usando todos os clientes');
      }
    }

    // 🔄 Reset ALL clients when reconnecting WhatsApp
    for(let client of selectedClients) {
      client.answered = false;
      client.isChatBot = true; // Reset bot functionality for everyone
      // Update client in database
      await fetch(`/api/clients/${encodeURIComponent(client.phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
    }
    
    renderFolderClients(); // Update the UI

    const response = await fetch('/api/whatsapp/connect', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: selectedClients })
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
      const confirmed = await confirmAction('Desconectar Bot', 'Isso vai excluir todas as sessões de seus clientes, tem certeza de que deseja desconectar?');
      if (!confirmed) return;

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
  if (!selectedFolderId) {
    customAlert('Aviso', 'Por favor, selecione uma pasta primeiro!');
    return;
  }

  // Load clients from selected folder
  let clients = [];
  try {
    const response = await fetch(`/api/clients?folderId=${selectedFolderId}`);
    const data = await response.json();
    if (data.success) {
      clients = data.clients;
    }
  } catch (error) {
    console.error('Error loading folder clients:', error);
    customAlert('Erro', 'Não foi possível carregar os clientes da pasta selecionada.');
    return;
  }

  if (clients.length === 0) {
    customAlert('Aviso', 'Nenhum cliente na pasta selecionada!');
    return;
  }

  const confirmed = await confirmAction('Enviar Mensagens', `Enviar mensagens para ${clients.length} clientes da pasta "${selectedFolderName}"?`);
  if (!confirmed) return;

  try {
    document.getElementById('sendBulkBtn').textContent = '📤 Enviando...';
    document.getElementById('sendBulkBtn').disabled = true;
    
    addLog(`📤 Iniciando envio em massa para pasta: ${selectedFolderName}...`);
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
      const [productName, akas, enabled] = product.split(',');
        html += `
            <tr>
                <td>${productName}</td>
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

        const phoneNumber = normalizePhoneNumber(order.phone_number);
            
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
                <span class="order-type-badge">${order.order_type}</span>
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
            <input type="text" id="newClientPhone" placeholder="+55 85 9999-9999" required>
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

// Phone number normalization function
function normalizePhoneNumber(phoneInput) {
  if (!phoneInput || phoneInput.trim() === '') return null;
  
  // Remove all non-digit characters
  let digits = phoneInput.replace(/\D/g, '');
  
  // Handle Brazil phone numbers
  if (digits.startsWith('55')) {
    // Already has country code
    if (digits.length === 12) { // 55 + 2 area + 8 number
      return `+${digits.substring(0, 2)} ${digits.substring(2, 4)} ${digits.substring(4, 8)}-${digits.substring(8, 12)}`;
    } else if (digits.length === 13) { // 55 + 2 area + 9 number
      return `+${digits.substring(0, 2)} ${digits.substring(2, 4)} ${digits.substring(4, 9)}-${digits.substring(9, 13)}`;
    }
  } else {
    // Add Brazil country code
    if (digits.length === 10) { // 2 area + 8 number
      return `+55 ${digits.substring(0, 2)} ${digits.substring(2, 6)}-${digits.substring(6, 10)}`;
    } else if (digits.length === 11) { // 2 area + 9 number
      return `+55 ${digits.substring(0, 2)} ${digits.substring(2, 7)}-${digits.substring(7, 11)}`;
    } else if (digits.length === 8) { // Just number (assume area code 85)
      return `+55 85 ${digits.substring(0, 4)}-${digits.substring(4, 8)}`;
    } else if (digits.length === 9) { // Just number (assume area code 85)
      return `+55 85 ${digits.substring(0, 5)}-${digits.substring(5, 9)}`;
    }
  }
  
  // If we can't format properly, just return with country code
  return `+55 ${digits}`;
}

// Show TXT import form
function showImportTxtForm() {
  if (!currentFolder) {
    customAlert('Erro', 'Nenhuma pasta aberta.');
    return;
  }
  
  const container = document.getElementById('folderClientsContainer');
  
  // Remove any existing import form
  const existingForm = container.querySelector('.import-txt-form');
  if (existingForm) {
    existingForm.remove();
    return;
  }
  
  const importForm = document.createElement('div');
  importForm.className = 'import-txt-form';
  importForm.style.cssText = 'background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 10px; padding: 20px; margin-bottom: 20px; animation: slideDown 0.3s ease;';
  
  importForm.innerHTML = `
    <h4 style="margin-bottom: 15px; color: #2c3e50;">📄 Importar Clientes do Arquivo TXT</h4>
    
    <div style="margin-bottom: 15px; padding: 15px; background: #e8f4fc; border-radius: 8px; border-left: 4px solid #3498db;">
      <h5 style="margin-top: 0; color: #2c3e50;">📋 Formato do Arquivo:</h5>
      <p style="margin: 5px 0; font-size: 0.9em; color: #2c3e50;">
        <strong>Opção 1:</strong> Apenas números de telefone (um por linha)<br>
        <em>Exemplo:</em><br>
        +55 85 7400-2430<br>
        558574002430<br>
        8574002430
      </p>
      <p style="margin: 5px 0; font-size: 0.9em; color: #2c3e50;">
        <strong>Opção 2:</strong> Telefone, Nome (separados por vírgula)<br>
        <em>Exemplo:</em><br>
        +55 85 7400-2430, Guilherme Moura<br>
        558574002430, Nicolas Pinheiro
      </p>
      <p style="margin: 5px 0; font-size: 0.9em; color: #2c3e50;">
        <strong>Opção 3:</strong> Telefone, Nome, Tipo (separados por vírgula)<br>
        <em>Exemplo:</em><br>
        +55 85 7400-2430, Guilherme Moura, normal<br>
        558574002430, Nicolas Pinheiro, quilo<br>
        8574002430, Carlos Sérgio, dosado
      </p>
      <p style="margin: 5px 0; font-size: 0.85em; color: #7f8c8d;">
        <strong>Tipos válidos:</strong> normal, quilo, dosado (padrão: normal)<br>
        <strong>Nome padrão:</strong> "Cliente sem nome" (se não especificado)
      </p>
    </div>
    
    <div class="form-group" style="margin-bottom: 15px;">
      <label for="txtFileInput" style="display: block; margin-bottom: 5px; font-weight: 600; color: #2c3e50;">
        Selecione o arquivo TXT:
      </label>
      <input type="file" id="txtFileInput" accept=".txt" style="width: 100%; padding: 8px; border: 2px solid #e9ecef; border-radius: 8px;">
    </div>
    
    <div id="importPreview" style="display: none; margin-bottom: 15px; max-height: 200px; overflow-y: auto; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px; background: white;">
      <h5 style="margin-top: 0; color: #2c3e50;">Pré-visualização:</h5>
      <div id="previewContent"></div>
    </div>
    
    <div class="edit-form-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
      <button class="btn btn-sm btn-danger" onclick="cancelImportTxt()">Cancelar</button>
      <button class="btn btn-sm btn-success" id="importBtn" onclick="importFromTxt()" disabled>
        Importar Clientes
      </button>
    </div>
  `;
  
  container.prepend(importForm);
  
  // Add event listener for file selection
  document.getElementById('txtFileInput').addEventListener('change', previewTxtFile);
}

// Preview TXT file contents
function previewTxtFile(event) {
  const file = event.target.files[0];
  const importBtn = document.getElementById('importBtn');
  const previewDiv = document.getElementById('importPreview');
  const previewContent = document.getElementById('previewContent');
  
  if (!file) {
    importBtn.disabled = true;
    previewDiv.style.display = 'none';
    return;
  }
  
  // Check if it's a text file
  if (!file.name.toLowerCase().endsWith('.txt')) {
    customAlert('Erro', 'Por favor, selecione um arquivo .txt');
    importBtn.disabled = true;
    previewDiv.style.display = 'none';
    return;
  }
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const content = e.target.result;
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length === 0) {
      previewContent.innerHTML = '<p style="color: #e74c3c;">Arquivo vazio ou sem conteúdo válido.</p>';
      importBtn.disabled = true;
    } else {
      let previewHtml = '<div style="font-size: 0.85em;">';
      let validCount = 0;
      
      // Show first 10 lines as preview
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        const parsed = parseTxtLine(line);
        
        if (parsed) {
          validCount++;
          previewHtml += `
            <div style="margin-bottom: 5px; padding: 5px; border-bottom: 1px solid #f1f1f1;">
              <strong>${parsed.phone}</strong><br>
              <span style="color: #7f8c8d;">${parsed.name} • ${parsed.type}</span>
            </div>
          `;
        }
      }
      
      if (lines.length > 10) {
        previewHtml += `<div style="color: #7f8c8d; font-style: italic;">... e mais ${lines.length - 10} linha(s)</div>`;
      }
      
      previewHtml += '</div>';
      previewContent.innerHTML = previewHtml;
      
      if (validCount > 0) {
        importBtn.disabled = false;
        importBtn.innerHTML = `Importar ${lines.length} Cliente(s)`;
      } else {
        importBtn.disabled = true;
      }
    }
    
    previewDiv.style.display = 'block';
  };
  
  reader.onerror = function() {
    customAlert('Erro', 'Não foi possível ler o arquivo.');
    importBtn.disabled = true;
    previewDiv.style.display = 'none';
  };
  
  reader.readAsText(file);
}

// Parse a single line from TXT file
function parseTxtLine(line) {
  line = line.trim();
  if (!line) return null;
  
  // Split by comma, but be careful with commas in names
  const parts = line.split(',').map(part => part.trim());
  
  if (parts.length === 0) return null;
  
  // Extract phone (first part)
  const phoneRaw = parts[0];
  const phone = normalizePhoneNumber(phoneRaw);
  
  if (!phone) return null;
  
  // Extract name (second part if exists)
  let name = 'Cliente sem nome';
  if (parts.length >= 2 && parts[1] !== '') {
    name = parts[1];
  }
  
  // Extract order type (third part if exists)
  let type = 'normal';
  if (parts.length >= 3 && parts[2] !== '') {
    const validTypes = ['normal', 'quilo', 'dosado'];
    const inputType = parts[2].toLowerCase();
    type = validTypes.includes(inputType) ? inputType : 'normal';
  }
  
  return { phone, name, type };
}

// Cancel import
function cancelImportTxt() {
  const form = document.querySelector('.import-txt-form');
  if (form) form.remove();
}

// Import from TXT file
async function importFromTxt() {
  if (!currentFolder) {
    customAlert('Erro', 'Nenhuma pasta aberta.');
    return;
  }
  
  const fileInput = document.getElementById('txtFileInput');
  if (!fileInput.files[0]) {
    customAlert('Erro', 'Por favor, selecione um arquivo.');
    return;
  }
  
  const confirmed = await confirmAction(
    'Importar Clientes', 
    `Importar clientes do arquivo para a pasta "${currentFolder.name}"?`
  );
  
  if (!confirmed) return;
  
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = async function(e) {
    const content = e.target.result;
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    const errors = [];
    
    addLog(`📄 Iniciando importação de ${lines.length} linha(s) do arquivo...`);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = parseTxtLine(line);
      
      if (!parsed) {
        errorCount++;
        errors.push(`Linha ${i + 1}: Formato inválido - "${line.substring(0, 30)}..."`);
        continue;
      }
      
      try {
        const response = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: parsed.phone,
            name: parsed.name,
            type: parsed.type,
            folderId: currentFolder.id
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          successCount++;
          // Show progress every 10 imports
          if (successCount % 10 === 0) {
            addLog(`✅ ${successCount} cliente(s) importado(s)...`);
          }
        } else {
          if (data.message && data.message.includes('duplicate')) {
            duplicateCount++;
          } else {
            errorCount++;
            errors.push(`Linha ${i + 1}: ${data.message || 'Erro desconhecido'}`);
          }
        }
      } catch (error) {
        errorCount++;
        errors.push(`Linha ${i + 1}: ${error.message}`);
      }
      
      // Small delay to not overload the server
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Show results
    let resultMessage = `✅ Importação concluída!`;
    resultMessage += `✅ Sucesso: ${successCount} cliente(s)`;
    if (duplicateCount > 0) {
      resultMessage += `⚠️ Duplicados: ${duplicateCount} cliente(s) (já existiam)`;
    }
    if (errorCount > 0) {
      resultMessage += `❌ Erros: ${errorCount} cliente(s)`;
    }
    
    if (errors.length > 0) {
      resultMessage += `Detalhes dos erros:`;
      resultMessage += errors.slice(0, 5).map(e => `• ${e}`).join('<br>');
      if (errors.length > 5) {
        resultMessage += `• ... e mais ${errors.length - 5} erro(s)`;
      }
    }
    
    customAlert('Resultado da Importação', resultMessage);
    
    // Update the UI
    folderHasUnsavedChanges = true;
    await loadFolderClients(currentFolder.id);
    cancelImportTxt();
    
    addLog(`📄 Importação finalizada: ${successCount} adicionado(s), ${duplicateCount} duplicado(s), ${errorCount} erro(s)`);
  };
  
  reader.onerror = function() {
    customAlert('Erro', 'Não foi possível ler o arquivo.');
  };
  
  reader.readAsText(file);
}


// Initialize Socket.IO with authentication
let socket;

function initializeSocket() {
  if (!currentUser) return;
  
  socket = io({
    auth: {
      userId: currentUser.id
    }
  });

  // ... (rest of socket event handlers remain the same)
  socket.on('connect', () => {
    addLog('🔌 Conectado ao servidor');
  });

  socket.on('disconnect', () => {
    addLog('🔌 Desconectado do servidor');
    updateConnectionStatus(false);
  });

  socket.on('qr-code', (data) => {
    const container = document.getElementById('qrContainer');
    container.innerHTML = `<img src="${data.qr}" alt="QR Code" style="max-width: 300px;">`;
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
  });

  socket.on('disable-bot', (data) => {
    const formattedPhone = formatPhoneNumberForDisplay(data.phone);
    const user = clients.find(c => c.phone === formattedPhone);
    
    if (user) {
      addNotification(formattedPhone, user.name);
    } else {
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
 
    const clientDisableBotIndex = clients.findIndex(c => c.phone === formattedPhone);
    if (clientDisableBotIndex !== -1) {
      disableChatBot(clientDisableBotIndex);
    }
  });

  socket.on('bulk-message-progress', (data) => {
    addLog(`📤 Enviado para ${data.name} (${data.phone})`);
  });

  socket.on('bulk-messages-complete', (data) => {
    addLog('✅ Envio de mensagens concluído!');
    document.getElementById('sendBulkBtn').textContent = '📤 Enviar Mensagens para seus Clientes';
    
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
}

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

// ---------------------- Configuration UI / persistence ----------------------
let userConfig = {
  callByName: true // default
};

async function loadUserConfig() {
  try {
    const res = await fetch('/api/config', { method: 'GET' });
    const data = await res.json();
    if (data && data.success && data.config) {
      userConfig = Object.assign(userConfig, data.config);
    }
  } catch (err) {
    console.error('Failed to load user config:', err);
  } finally {
    renderConfigUI();
  }
}

function renderConfigUI() {
  const toggle = document.getElementById('toggleCallByName');
  const label = document.getElementById('toggleCallByNameLabel');
  if (!toggle || !label) return;

  if (userConfig.callByName) {
    toggle.classList.add('active');
    label.textContent = 'Ativado';
  } else {
    toggle.classList.remove('active');
    label.textContent = 'Desativado';
  }
}

// Toggle click handler (does NOT save automatically)
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'toggleCallByName') {
    userConfig.callByName = !userConfig.callByName;
    renderConfigUI();
  }
});

// Save button handler
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'saveConfigBtn') {
    try {
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: userConfig })
      });
      const data = await resp.json();
      if (data && data.success) {
        customAlert('Salvo', 'Configurações salvas com sucesso.');
      } else {
        customAlert('Erro', 'Falha ao salvar configurações.');
      }
    } catch (err) {
      console.error('Failed to save config:', err);
      customAlert('Erro', 'Falha ao salvar configurações.');
    }
  }
});

// Ensure we load config after auth check
const _orig_checkAuthentication = checkAuthentication;
checkAuthentication = async function() {
  const ok = await _orig_checkAuthentication();
  if (ok) await loadUserConfig();
  return ok;
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication first
  const isAuthenticated = await checkAuthentication();
  if (!isAuthenticated) return;
  
  // Initialize socket after authentication
  initializeSocket();
  
  addLog('🚀 Dashboard inicializado');
  setupTabs();
  loadFolders();
  updateFolderSelect();
  loadProducts();
  initializeNotifications();
  initializeModal();
  
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
    if (!socket || !currentUser) return;
    
    fetch('/api/whatsapp/status')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
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