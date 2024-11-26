const express=require('express');
const router=express.Router();

const stripeController=require('../controllers/stripeController');
const authenticateToken = require('../middleware/authenticateToken');

router.route('/transactions').get(authenticateToken,stripeController.GetTransactionList);
router.route('/balance').get(authenticateToken,stripeController.GetBalanceList);
router.route('/refunds').get(authenticateToken,stripeController.GetRefundList);
router.route('/balance/:customerStripeId').get(authenticateToken,stripeController.GetCustomerBalanceTransactions);

module.exports=router;