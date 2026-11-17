
const ROLE_PERMISSIONS = Object.freeze({
  tenant_admin: [
    "vehicles:read",
    "vehicles:write",
    "users:read",
    "users:write",
  ],
  manager: [
    "vehicles:read",
    "vehicles:write",
  ],
  viewer: [
    "vehicles:read",
  ],
});

function authorize(permission) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    const permissions = ROLE_PERMISSIONS[req.auth.role] || [];

    if (!permissions.includes(permission)) {
      return res.status(403).json({
        message: "Insufficient permissions",
      });
    }

    next();
  };
}

module.exports = {
  authorize,
  ROLE_PERMISSIONS,
};
