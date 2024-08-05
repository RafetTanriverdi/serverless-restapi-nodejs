// routes/productRoutes.js
const express = require("express");
const productsController = require("../controllers/productsController");
const authenticateToken = require("../middleware/authenticateToken");
const { getPermissionsByName } = require("../models/permissionModel");
const authMiddleware = require("../middleware/authorazitionMiddleware");

const router = express.Router();

const productReadPermissions = getPermissionsByName("Products").filter((perm) =>
  perm.includes("Read")
);
const productWritePermissions = getPermissionsByName("Products").filter(
  (perm) => perm.includes("Create")
);
const productUpdatePermissions = getPermissionsByName("Products").filter(
  (perm) => perm.includes("Update")
);
const productDeletePermissions = getPermissionsByName("Products").filter(
  (perm) => perm.includes("Delete")
);
router
  .route("/")
  .get(
    authenticateToken,
    authMiddleware(productReadPermissions),
    productsController.ListProducts
  )
  .post(
    authenticateToken,
    authMiddleware(productWritePermissions),
    productsController.CreateProduct
  );

router
  .route("/:productId")
  .get(
    authenticateToken,
    authMiddleware(productReadPermissions),
    productsController.GetProduct
  )
  .patch(
    authenticateToken,
    authMiddleware(productUpdatePermissions),
    productsController.PatchProduct
  )
  .delete(
    authenticateToken,
    authMiddleware(productDeletePermissions),
    productsController.DeleteProduct
  );

module.exports = router;
