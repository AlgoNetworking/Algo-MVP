// auth/auth.middleware.js
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  
  // Check if it's an API request
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  // Redirect to login for page requests
  res.redirect('/login');
};

const attachUserId = (req, res, next) => {
  if (req.session && req.session.userId) {
    req.userId = req.session.userId;
  }
  next();
};

module.exports = {
  isAuthenticated,
  attachUserId
};