const express=require('express');
const router=express.Router();

const stripeController=require('../controllers/stripeController');

router.route('/transactions').get(stripeController.GetTransactionList);
router.route('/balance').get(stripeController.GetBalanceList)
router.route('/refunds').get(stripeController.GetRefundList);

module.exports=router;