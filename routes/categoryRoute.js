const express = require("express");
const categoryController = require("../controllers/categoryController");
const authenticateToken = require("../middleware/authenticateToken");
const { getPermissionsByName } = require("../models/permissionModel");
const router = express.Router();

const categoryReadPermissions = getPermissionsByName("Categories").filter(
  (perm) => perm.includes("Read")
);
const categoryWritePermissions = getPermissionsByName("Categories").filter(
  (perm) => perm.includes("Create")
);
const categoryUpdatePermissions = getPermissionsByName("Categories").filter(
  (perm) => perm.includes("Update")
);
const categoryDeletePermissions = getPermissionsByName("Categories").filter(
  (perm) => perm.includes("Delete")
);

router
  .route("/")
  .get(
    authenticateToken,
    authMiddleware(categoryReadPermissions),
    categoryController.ListCategories
  )
  .post(
    authenticateToken,
    authMiddleware(categoryWritePermissions),
    categoryController.CreateCategory
  );

router
  .route("/:categoryId")
  .get(
    authenticateToken,
    authMiddleware(categoryReadPermissions),
    categoryController.GetCategory
  )
  .patch(
    authenticateToken,
    authMiddleware(categoryUpdatePermissions),
    categoryController.UpdateCategory
  )
  .delete(
    authenticateToken,
    authMiddleware(categoryDeletePermissions),
    categoryController.DeleteCategory
  );

module.exports = router;
