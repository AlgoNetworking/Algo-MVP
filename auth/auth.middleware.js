function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    // Add user info to request for easy access
    req.userId = req.session.userId;
    req.user = req.session.user;
    next();
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }
}

function isAuthenticatedSocket(socket, next) {
  if (socket.handshake.auth && socket.handshake.auth.userId) {
    socket.userId = socket.handshake.auth.userId;
    next();
  } else {
    next(new Error('Authentication required'));
  }
}

module.exports = {
  isAuthenticated,
  isAuthenticatedSocket
};