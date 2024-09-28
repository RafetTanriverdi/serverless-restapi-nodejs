const express = require("express");

const authenticateToken = require("../middleware/authenticateToken");
const customersController = require("../controllers/customersController");
const router = express.Router();

router.route("/").get(authenticateToken, customersController.ListCustomers);
router
  .route("/:customerId")
  .get(authenticateToken, customersController.GetCustomer);

router
  .route("/:customerId")
  .patch(authenticateToken, customersController.UpdateCustomer);

router
  .route("/:customerId")
  .delete(authenticateToken, customersController.DeleteCustomer);
  
module.exports = router;
