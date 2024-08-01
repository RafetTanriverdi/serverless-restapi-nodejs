const express = require('express');
const productsController = require('../controllers/productsController');
const authenticateToken = require('../middleware/authenticateToken');
const router = express.Router();

router.route('/')
  .get(authenticateToken, productsController.ListProducts)
  .post(authenticateToken, productsController.CreateProduct);

router.route('/:productId')
  .get(authenticateToken, productsController.GetProduct)
  .patch(authenticateToken, productsController.PatchProduct)
  .delete(authenticateToken, productsController.DeleteProduct);

module.exports = router;
