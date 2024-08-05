const express = require("express");
const usersController = require("../controllers/usersController");
const authenticateToken = require("../middleware/authenticateToken");
const { getPermissionsByName } = require("../models/permissionModel");
const authMiddleware = require("../middleware/authorazitionMiddleware");
const router = express.Router();

const userReadPermissions = getPermissionsByName("Users").filter((perm) =>
  perm.includes("Read")
);
const userWritePermissions = getPermissionsByName("Users").filter((perm) =>
  perm.includes("Create")
);
const userUpdatePermissions = getPermissionsByName("Users").filter((perm) =>
  perm.includes("Update")
);
const userDeletePermissions = getPermissionsByName("Users").filter((perm) =>
  perm.includes("Delete")
);

router
  .route("/")
  .get(
    authenticateToken,
    authMiddleware(userReadPermissions),
    usersController.ListUsers
  )
  .post(
    authenticateToken,
    authMiddleware(userWritePermissions),
    usersController.CreateUser
  );

router
  .route("/:userId")
  .get(
    authenticateToken,
    authMiddleware(userReadPermissions),
    usersController.GetUser
  )
  .patch(
    authenticateToken,
    authMiddleware(userUpdatePermissions),
    usersController.PatchUser
  )
  .delete(
    authenticateToken,
    authMiddleware(userDeletePermissions),
    usersController.DeleteUser
  );

module.exports = router;
