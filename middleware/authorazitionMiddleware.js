
const { verifyToken } = require('../utils/jwtUtils');
const { checkPermissions, getPermissionsByName } = require('../models/permissionModel');

const authMiddleware = (requiredPermissions) => {
  return async (req, res, next) => {
    const token = req.headers.authorization.split(' ')[1];

    try {
      const decodedToken = await verifyToken(token);
      const userPermissions = decodedToken['custom:permissions'] ? decodedToken['custom:permissions'].split(',') : [];

      if (!checkPermissions(userPermissions, requiredPermissions)) {
        return res.status(403).json({ message: "Access denied: insufficient permissions" });
      }

      req.user = decodedToken;
      next();
    } catch (error) {
      console.error("Authorization error:", error);
      res.status(401).json({ message: "Unauthorized", details: error.message });
    }
  };
};

module.exports = authMiddleware;
