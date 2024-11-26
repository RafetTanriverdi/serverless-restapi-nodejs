const express = require("express");

const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ordersController = require("../controllers/ordersController");
const { getPermissionsByName } = require("../models/permissionModel");
const authMiddleware = require("../middleware/authorazitionMiddleware");

const ordersUpdatePermissions = getPermissionsByName("Orders").filter((perm) =>
  perm.includes("Update")
);
const ordersDeletePermissions = getPermissionsByName("Orders").filter((perm) =>
  perm.includes("Delete")
);
const ordersRefundPermissions = getPermissionsByName("Orders").filter((perm) =>
  perm.includes("Refund")
);

const ordersReadPermissions = getPermissionsByName("Orders").filter((perm) =>
  perm.includes("Read")
);

router
  .route("/")
  .get(
    authenticateToken,
    authMiddleware(ordersReadPermissions),
    ordersController.ListOrders
  );
router
  .route("/:orderId")
  .get(
    authenticateToken,
    authMiddleware(ordersReadPermissions),
    ordersController.GetOrder
  );
router
  .route("/:orderId")
  .patch(
    authenticateToken,
    authMiddleware(ordersUpdatePermissions),
    ordersController.UpdateOrder
  );
router
  .route("/:orderId")
  .delete(
    authenticateToken,
    authMiddleware(ordersDeletePermissions),
    ordersController.DeleteOrder
  );
router
  .route("/refund")
  .post(
    authenticateToken,
    authMiddleware(ordersRefundPermissions),
    ordersController.RefundOrder
  );

module.exports = router;
