const express = require('express');
const usersController = require('../controllers/usersController');
const authenticateToken = require('../middleware/authenticateToken');
const router = express.Router();

router.route('/')
  .get(authenticateToken, usersController.ListUsers)
  .post(authenticateToken, usersController.CreateUser);

router.route('/:userId')
  .get(authenticateToken, usersController.GetUser)
  .patch(authenticateToken, usersController.PatchUser)
  .delete(authenticateToken, usersController.DeleteUser);

module.exports = router;
