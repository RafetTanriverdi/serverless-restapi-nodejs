const express = require("express");

const authenticateToken = require("../middleware/authenticateToken");
const customersController = require("../controllers/customersController");
const authMiddleware = require("../middleware/authorazitionMiddleware");
const { getPermissionsByName } = require("../models/permissionModel");
const router = express.Router();

const customersReadPermissions = getPermissionsByName("Customers").filter(
  (perm) => perm.includes("Read")
);
const customersDetailsPermissions = getPermissionsByName("Customers").filter(
  (perm) => perm.includes("Details")
);

const customersUpdatePermissions = getPermissionsByName("Customers").filter(
  (perm) => perm.includes("Update")
);

const customersDeletePermissions = getPermissionsByName("Customers").filter(
  (perm) => perm.includes("Delete")
);

router
  .route("/")
  .get(
    authenticateToken,
    authMiddleware(customersReadPermissions),
    customersController.ListCustomers
  );
router
  .route("/:customerId")
  .get(
    authenticateToken,
    authMiddleware(customersDetailsPermissions),
    customersController.GetCustomer
  );

router
  .route("/:customerId")
  .patch(
    authenticateToken,
    authMiddleware(customersUpdatePermissions),
    customersController.UpdateCustomer
  );

router
  .route("/:customerId")
  .delete(
    authenticateToken,
    authMiddleware(customersDeletePermissions),
    customersController.DeleteCustomer
  );

module.exports = router;
