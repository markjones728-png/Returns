const express = require('express');
const router = express.Router();
const { db, nextReference } = require('../db');
const { upload } = require('../utils/upload');
const { saveFilesToDisk } = require('../utils/files');
const { sendReturnSubmittedEmail } = require('../utils/email');

router.get('/', (req, res) => {
  res.render('home');
});

router.get('/submit', (req, res) => {
  res.render('submit', { error: null, old: {} });
});

router.post('/submit', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      return res.render('submit', { error: err.message, old: req.body });
    }
    next();
  });
}, async (req, res) => {
  const {
    company_name, contact_name, phone, email,
    collection_address, collection_hours, premises_type, courier_contact_number,
    equipment_type, make, model, serial_number, fault_description
  } = req.body;

  if (!company_name || !contact_name || !phone || !email || !collection_address || !collection_hours || !premises_type || !courier_contact_number || !equipment_type || !make || !model || !serial_number || !fault_description) {
    return res.render('submit', { error: 'Please fill in all required fields.', old: req.body });
  }

  const reference = nextReference();

  db.prepare(`
    INSERT INTO returns (reference, company_name, contact_name, phone, email, collection_address, collection_hours, premises_type, courier_contact_number, equipment_type, make, model, serial_number, fault_description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Return Submitted')
  `).run(reference, company_name, contact_name, phone, email, collection_address, collection_hours, premises_type, courier_contact_number, equipment_type, make, model, serial_number, fault_description);

  const returnRow = db.prepare('SELECT * FROM returns WHERE reference = ?').get(reference);

  db.prepare(`
    INSERT INTO return_status_history (return_id, status, changed_by, note)
    VALUES (?, 'Return Submitted', ?, 'Return submitted by customer')
  `).run(returnRow.id, contact_name);

  if (req.files && req.files.length) {
    const saved = saveFilesToDisk(reference, req.files);
    const stmt = db.prepare(`
      INSERT INTO return_files (return_id, filename, original_name, mime_type, kind, uploaded_by)
      VALUES (?, ?, ?, ?, ?, 'customer')
    `);
    saved.forEach((f) => stmt.run(returnRow.id, f.filename, f.original_name, f.mime_type, f.kind));
  }

  await sendReturnSubmittedEmail(returnRow);

  res.render('submit-success', { reference });
});

// Public tracking: customer looks up their return with reference + email
router.get('/track', (req, res) => {
  res.render('track', { error: null, result: null });
});

router.post('/track', (req, res) => {
  const { reference, email } = req.body;
  const returnRow = db.prepare(
    'SELECT * FROM returns WHERE reference = ? AND email = ?'
  ).get((reference || '').trim(), (email || '').trim());

  if (!returnRow) {
    return res.render('track', { error: 'No matching return found. Check your reference and email.', result: null });
  }

  const history = db.prepare(
    'SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC'
  ).all(returnRow.id);

  res.render('track', { error: null, result: { returnRow, history } });
});

module.exports = router;
