const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');

// Get all clients
router.get('/', async (req, res) => {
  try {
    const clients = await databaseService.getAllClients();
    res.json({
      success: true,
      clients: clients.map(client => ({
        phone: client.phone,
        name: client.name,
        type: client.order_type,
        answered: client.answered,
        isChatBot: client.is_chatbot
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
    const { phone, name, type = 'normal' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone is required'
      });
    }

    await databaseService.addClient({
      phone,
      name: name || 'Cliente sem nome',
      type,
      answered: false,
      isChatBot: true
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

// Update client
router.put('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { name, type, answered } = req.body;

    // Get existing client
    const clients = await databaseService.getAllClients();
    const client = clients.find(c => c.phone === phone);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await databaseService.addClient({
      phone,
      name: name || client.name || 'Cliente sem nome',
      type: type || client.order_type,
      answered: answered !== undefined ? answered : client.answered,
      isChatBot: client.is_chatbot
    });

    res.json({
      success: true,
      message: 'Client updated successfully'
    });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete client
router.delete('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    await databaseService.deleteClient(phone);
    
    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
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

    await databaseService.updateClientAnsweredStatus(phone, answered);

    res.json({
      success: true,
      message: 'Answered status updated'
    });
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

    await databaseService.updateClientChatBotStatus(phone, isChatBot);

    res.json({
      success: true,
      message: 'ChatBot status updated'
    });
  } catch (error) {
    console.error('Error updating chatbot status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;