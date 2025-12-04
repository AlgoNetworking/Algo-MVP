const express = require('express');
const router = express.Router();
const databaseService = require('../services/database.service');
const orderService = require('../services/order.service');
const orderParser = require('../utils/order-parser');
const ExcelJS = require('exceljs');
const productsConfig = require('../utils/products-config');

router.get('/totals', async (req, res) => {
  try {
    const totals = await databaseService.getProductTotals(req.userId); // ADD req.userId
    res.json({
      success: true,
      main_orders: totals,
      auto_orders: {}
    });
  } catch (error) {
    console.error('Error getting totals:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/user-orders', async (req, res) => {
  try {
    const orders = await databaseService.getUserOrders(req.userId); // ADD req.userId
    res.json({
      success: true,
      user_orders: orders
    });
  } catch (error) {
    console.error('Error getting user orders:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/confirm-order', async (req, res) => {
  try {
    const { order_id } = req.body;
    await databaseService.confirmUserOrder(order_id, req.userId); // ADD req.userId
    res.json({
      success: true,
      message: 'Order confirmed successfully'
    });
  } catch (error) {
    console.error('Error confirming order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cancel-order', async (req, res) => {
  try {
    const { order_id } = req.body;
    await databaseService.cancelUserOrder(order_id, req.userId); // ADD req.userId
    res.json({
      success: true,
      message: 'Order canceled successfully'
    });
  } catch (error) {
    console.error('Error canceling order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/manual-order', async (req, res) => {
  try {
    const { phone_number, client_name, order_type = 'normal', message } = req.body;

    if (!phone_number || !client_name || !message) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const validOrderTypes = ['normal', 'quilo', 'dosado'];
    if (!validOrderTypes.includes(order_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order type'
      });
    }

    const emptyDb = productsConfig.getEmptyProductsDb();
    const { parsedOrders, disabledProductsFound } = orderParser.parse(message, emptyDb);

    if (disabledProductsFound.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Os seguintes produtos estão temporariamente fora de estoque: ${disabledProductsFound.map(item => `${item.qty}x ${item.product}`).join(', ')}`
      });
    }

    if (parsedOrders.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid products found in message'
      });
    }

    await databaseService.saveUserOrder({
      phoneNumber: phone_number,
      name: client_name,
      orderType: order_type,
      sessionId: 'manual_session',
      originalMessage: message,
      parsedOrders,
      status: 'confirmed',
      userId: req.userId // ADD req.userId
    });

    for (const order of parsedOrders) {
      if (order.qty > 0) {
        await databaseService.updateProductTotal(order.product, order.qty, req.userId); // ADD req.userId
      }
    }

    const totalQuantity = parsedOrders.reduce((sum, o) => sum + o.qty, 0);

    res.json({
      success: true,
      message: `Manual order processed: ${totalQuantity} items`,
      parsed_orders: parsedOrders,
      total_quantity: totalQuantity,
      client_name,
      order_type
    });

  } catch (error) {
    console.error('Error adding manual order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/clear-totals', async (req, res) => {
  try {
    await databaseService.clearProductTotals(req.userId); // ADD req.userId
    res.json({
      success: true,
      message: 'Product totals cleared'
    });
  } catch (error) {
    console.error('Error clearing totals:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/clear-user-orders', async (req, res) => {
  try {
    await databaseService.clearUserOrders(req.userId); // ADD req.userId
    res.json({
      success: true,
      message: 'User orders cleared'
    });
  } catch (error) {
    console.error('Error clearing user orders:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/download-excel', async (req, res) => {
  try {
    const totals = await databaseService.getProductTotals(req.userId); // ADD req.userId

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pedidos');

    worksheet.columns = [
      { header: 'Produto', key: 'product', width: 30 },
      { header: 'Quantidade', key: 'quantity', width: 15 },
      { header: 'Tipo', key: 'type', width: 15 }
    ];

    Object.entries(totals).forEach(([product, quantity]) => {
      worksheet.addRow({
        product,
        quantity,
        type: 'Confirmado'
      });
    });

    if (worksheet.rowCount === 1) {
      worksheet.addRow({
        product: 'Nenhum pedido encontrado',
        quantity: '',
        type: ''
      });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=pedidos.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;