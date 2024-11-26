
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
    {
      name:'Orders',
      permissions:[
        'Order:Refund',
        'Order:Read',
        'Order:Update',
        'Order:Delete'
      ]
    },
    {
      name:'Customers',
      permissions:[
        'Customer:Read',
        'Customer:Update',
        'Customer:Delete',
        'Customer:Details'
      ]
    }
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
  