require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

require('./db'); // initialises schema + seeds default admin

const publicRoutes = require('./routes/public');
const { router: authRoutes } = require('./routes/auth');
const returnsRoutes = require('./routes/returns');
const inviteRoutes = require('./routes/invite');

const app = express();

// Render (and most hosts) put the app behind a proxy - trust it so
// req.protocol / req.secure reflect the real https:// scheme rather than
// the internal http:// connection. Needed so invite links etc. use https.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    secure: process.env.COOKIE_SECURE === 'true'
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', inviteRoutes);
app.use('/', returnsRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Roger Technology Returns Portal running on port ${PORT}`);
});
