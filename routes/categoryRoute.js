const express = require('express');
const categoryController= require('../controllers/categoryController');
const authenticateToken = require('../middleware/authenticateToken');
const router = express.Router();

router.route('/')
  .get(authenticateToken, categoryController.ListCategories)
  .post(authenticateToken, categoryController.CreateCategory);

router.route('/:categoryId')
  .get(authenticateToken, categoryController.GetCategory)
  .patch(authenticateToken, categoryController.UpdateCategory)
  .delete(authenticateToken, categoryController.DeleteCategory);

module.exports = router;
