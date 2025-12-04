// middleware/auth.middleware.js
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  next();
};

const attachUser = (req, res, next) => {
  // Attach user ID to request if authenticated
  if (req.session && req.session.userId) {
    req.userId = req.session.userId;
    req.username = req.session.username;
  }
  next();
};

module.exports = {
  requireAuth,
  attachUser
};