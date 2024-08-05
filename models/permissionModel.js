// models/permissionModel.js
exports.permissionsList = [
    {
      name: "Products",
      permissions: [
        "Product:Create",
        "Product:Read",
        "Product:Update",
        "Product:Delete",
      ],
    },
    {
      name: "Categories",
      permissions: [
        "Category:Create",
        "Category:Read",
        "Category:Update",
        "Category:Delete",
      ],
    },
    {
      name: "Users",
      permissions: [
        "User:Create",
        "User:Read",
        "User:Update",
        "User:Delete",
      ],
    },
  ];
  
  exports.getPermissionsByName = (name) => {
    const permissionGroup = exports.permissionsList.find(
      (group) => group.name === name
    );
    return permissionGroup ? permissionGroup.permissions : [];
  };
  
  exports.checkPermissions = (userPermissions, requiredPermissions) => {
    return requiredPermissions.every((perm) => userPermissions.includes(perm));
  };
  