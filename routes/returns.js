const express = require('express');
const router = express.Router();
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { STATUSES, CLOSED_STATUS, STATUS_COLORS } = require('../utils/constants');
const { upload } = require('../utils/upload');
const { saveFilesToDisk, filePath } = require('../utils/files');
const { sendStatusUpdateEmail } = require('../utils/email');
const { generateReturnPdf } = require('../utils/pdf');
const { requireAuth, requireAdmin } = require('./auth');

router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  const q = (req.query.q || '').trim();
  const tab = req.query.tab === 'archived' ? 'archived' : 'live';

  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM returns
      WHERE (reference LIKE ? OR company_name LIKE ? OR contact_name LIKE ? OR serial_number LIKE ? OR make LIKE ? OR model LIKE ?)
      ORDER BY created_at DESC
    `).all(like, like, like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM returns ORDER BY created_at DESC').all();
  }

  const live = rows.filter((r) => r.status !== CLOSED_STATUS);
  const archived = rows.filter((r) => r.status === CLOSED_STATUS);

  res.render('dashboard', {
    live, archived, tab, q,
    statusColors: STATUS_COLORS,
    user: req.session.user
  });
});

router.get('/returns/:id', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const files = db.prepare('SELECT * FROM return_files WHERE return_id = ? ORDER BY uploaded_at ASC').all(returnRow.id);
  const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at DESC').all(returnRow.id);

  res.render('return-detail', {
    r: returnRow, files, history, STATUSES,
    statusColors: STATUS_COLORS,
    user: req.session.user
  });
});

router.post('/returns/:id/status', async (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const { status, note, notify } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).send('Invalid status.');

  db.prepare(`UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, returnRow.id);
  db.prepare(`
    INSERT INTO return_status_history (return_id, status, changed_by, note)
    VALUES (?, ?, ?, ?)
  `).run(returnRow.id, status, req.session.user.name, note || '');

  if (notify === 'on') {
    const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnRow.id);
    await sendStatusUpdateEmail(updated);
  }

  res.redirect(`/returns/${returnRow.id}`);
});

router.post('/returns/:id/notes', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  db.prepare(`UPDATE returns SET staff_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.body.staff_notes || '', returnRow.id);

  res.redirect(`/returns/${returnRow.id}`);
});

router.post('/returns/:id/files', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).send(err.message);
    next();
  });
}, (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  if (req.files && req.files.length) {
    const saved = saveFilesToDisk(returnRow.reference, req.files);
    const stmt = db.prepare(`
      INSERT INTO return_files (return_id, filename, original_name, mime_type, kind, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    saved.forEach((f) => stmt.run(returnRow.id, f.filename, f.original_name, f.mime_type, f.kind, req.session.user.name));
  }

  res.redirect(`/returns/${returnRow.id}`);
});

router.get('/returns/:id/pdf', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');
  const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);

  generateReturnPdf(returnRow, history, res);
});

router.get('/files/:returnId/:filename', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.returnId);
  if (!returnRow) return res.status(404).send('Not found.');

  const file = db.prepare('SELECT * FROM return_files WHERE return_id = ? AND filename = ?')
    .get(returnRow.id, req.params.filename);
  if (!file) return res.status(404).send('Not found.');

  const p = filePath(returnRow.reference, file.filename);
  if (!fs.existsSync(p)) return res.status(404).send('File missing on disk.');

  res.setHeader('Content-Type', file.mime_type);
  res.sendFile(p);
});

// --- Admin: manage staff users ---
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC').all();
  res.render('users', { users, user: req.session.user, error: null });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) {
    const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC').all();
    return res.render('users', { users, user: req.session.user, error: 'All fields are required.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(username.trim(), hash, name.trim(), role === 'admin' ? 'admin' : 'staff');
    res.redirect('/users');
  } catch (e) {
    const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC').all();
    res.render('users', { users, user: req.session.user, error: 'Username already exists.' });
  }
});

module.exports = router;
