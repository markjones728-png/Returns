const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');

function getValidInvite(token) {
  const invite = db.prepare('SELECT * FROM invites WHERE token = ?').get(token);
  if (!invite) return { invite: null, reason: 'not_found' };
  if (invite.accepted_at) return { invite, reason: 'already_accepted' };
  if (new Date(invite.expires_at) < new Date()) return { invite, reason: 'expired' };
  return { invite, reason: null };
}

router.get('/accept-invite/:token', (req, res) => {
  const { invite, reason } = getValidInvite(req.params.token);
  if (!invite) return res.render('accept-invite', { invite: null, error: 'This invite link is not valid.', old: {} });
  if (reason === 'already_accepted') return res.render('accept-invite', { invite: null, error: 'This invite has already been used. Please log in instead.', old: {} });
  if (reason === 'expired') return res.render('accept-invite', { invite: null, error: 'This invite link has expired. Ask an admin to send you a new one.', old: {} });

  res.render('accept-invite', { invite, error: null, old: {} });
});

router.post('/accept-invite/:token', (req, res) => {
  const { invite, reason } = getValidInvite(req.params.token);
  if (!invite || reason) {
    return res.render('accept-invite', { invite: null, error: 'This invite link is no longer valid.', old: {} });
  }

  const { username, password, confirm_password } = req.body;

  if (!username || !password) {
    return res.render('accept-invite', { invite, error: 'Please choose a username and password.', old: req.body });
  }
  if (password.length < 8) {
    return res.render('accept-invite', { invite, error: 'Password must be at least 8 characters.', old: req.body });
  }
  if (password !== confirm_password) {
    return res.render('accept-invite', { invite, error: 'Passwords do not match.', old: req.body });
  }

  const hash = bcrypt.hashSync(password, 10);
  let userId;
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)')
      .run(username.trim(), hash, invite.name, invite.role, invite.email);
    userId = result.lastInsertRowid;
  } catch (e) {
    return res.render('accept-invite', { invite, error: 'That username is already taken - please choose another.', old: req.body });
  }

  db.prepare(`UPDATE invites SET accepted_at = datetime('now') WHERE id = ?`).run(invite.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.redirect('/dashboard');
});

module.exports = router;
