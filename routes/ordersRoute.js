const express = require("express");

const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ordersController = require("../controllers/ordersController");

router.route("/").get(authenticateToken, ordersController.ListOrders);
router.route("/:orderId").get(authenticateToken, ordersController.GetOrder);
router.route("/:orderId").patch(authenticateToken, ordersController.UpdateOrder);
router.route("/:orderId").delete(authenticateToken, ordersController.DeleteOrder);
router.route("/refund").post(authenticateToken, ordersController.RefundOrder);

module.exports = router;