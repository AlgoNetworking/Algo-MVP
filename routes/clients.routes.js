const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get all clients
router.get('/', async (req, res) => {
  try {
    const { folderId } = req.query;
    const clients = await databaseService.getAllClients(req.userId, folderId);
    res.json({
      success: true,
      clients: clients.map(client => ({
        id: client.id,
        phone: client.phone,
        name: client.name,
        type: client.order_type,
        answered: client.answered,
        isChatBot: client.is_chatbot,
        interpret: client.interpret_messages === undefined ? true : !!client.interpret_messages,
        folderId: client.folder_id
      }))
    });
  } catch (error) {
    console.error('Error getting clients:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add new client
router.post('/', async (req, res) => {
  try {
    const { phone, name, type = 'normal', folderId = null, interpret = true } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone is required'
      });
    }

    await databaseService.addClient(req.userId, {
      phone,
      name: name || 'Cliente sem nome',
      type,
      answered: false,
      isChatBot: true,
      interpret,
      folderId
    });

    res.json({
      success: true,
      message: 'Client added successfully'
    });
  } catch (error) {
    console.error('Error adding client:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Batch import clients (set interpret true by default)
router.post('/batch', async (req, res) => {
  try {
    const { clients, folderId } = req.body;
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ success: false, message: 'Clients array is required' });
    }
    const results = { total: clients.length, success: 0, duplicates: 0, errors: [] };
    for (const client of clients) {
      try {
        await databaseService.addClient(req.userId, {
          phone: client.phone,
          name: client.name || 'Cliente sem nome',
          type: client.type || 'normal',
          answered: false,
          isChatBot: true,
          interpret: client.interpret !== undefined ? client.interpret : true,
          folderId: folderId
        });
        results.success++;
      } catch (error) {
        if (error.message && error.message.includes('unique')) {
          results.duplicates++;
        } else {
          results.errors.push({ client, error: error.message });
        }
      }
    }
    res.json({ success: true, message: `Batch import completed: ${results.success} added, ${results.duplicates} duplicates`, results });
  } catch (error) {
    console.error('Error batch importing clients:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update client (including interpret)
router.put('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { name, type, answered, folderId = null, interpret } = req.body;

    // Get existing client
    const clients = await databaseService.getAllClients(req.userId);
    const client = clients.find(c => c.phone === phone && c.folder_id === folderId);

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    await databaseService.addClient(req.userId, {
      phone,
      name: name || client.name || 'Cliente sem nome',
      type: type || client.order_type,
      answered: answered !== undefined ? answered : client.answered,
      isChatBot: client.is_chatbot,
      interpret: interpret !== undefined ? interpret : (client.interpret_messages === undefined ? true : !!client.interpret_messages),
      folderId
    });

    res.json({ success: true, message: 'Client updated successfully' });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete client
router.delete('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { folderId } = req.query;
    if (folderId) {
      await databaseService.deleteClient(req.userId, phone, folderId);
    } else {
      await databaseService.deleteClient(req.userId, phone);
    }
    res.json({ success: true, message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update answered status
router.put('/:phone/answered', async (req, res) => {
  try {
    const { phone } = req.params;
    const { answered } = req.body;
    await databaseService.updateClientAnsweredStatus(req.userId, phone, answered);
    res.json({ success: true, message: 'Answered status updated' });
  } catch (error) {
    console.error('Error updating answered status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update chatbot status
router.put('/:phone/chatbot', async (req, res) => {
  try {
    const { phone } = req.params;
    const { isChatBot } = req.body;
    await databaseService.updateClientChatBotStatus(req.userId, phone, isChatBot);
    res.json({ success: true, message: 'ChatBot status updated' });
  } catch (error) {
    console.error('Error updating chatbot status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update interpret messages status
router.put('/:phone/interpret', async (req, res) => {
  try {
    const { phone } = req.params;
    const { interpret } = req.body;
    if (interpret === undefined) {
      return res.status(400).json({ success: false, message: 'interpret is required' });
    }
    await databaseService.updateClientInterpretStatus(req.userId, phone, !!interpret);
    res.json({ success: true, message: 'Interpret status updated' });
  } catch (error) {
    console.error('Error updating interpret status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
