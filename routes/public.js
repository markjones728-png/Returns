const express = require('express');
const router = express.Router();
const fs = require('fs');
const { db, nextReference } = require('../db');
const { APPLICATION_TYPES, PRODUCT_TYPES } = require('../utils/constants');
const { upload } = require('../utils/upload');
const { saveFilesToDisk, filePath } = require('../utils/files');
const { sendReturnSubmittedEmail } = require('../utils/email');
const { generateCustomerReturnPdf } = require('../utils/pdf');

router.get('/', (req, res) => {
  res.render('home');
});

router.get('/submit', (req, res) => {
  res.render('submit', { error: null, old: {}, APPLICATION_TYPES, PRODUCT_TYPES });
});

router.post('/submit', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      return res.render('submit', { error: err.message, old: req.body, APPLICATION_TYPES, PRODUCT_TYPES });
    }
    next();
  });
}, async (req, res) => {
  const {
    company_name, contact_name, phone, email,
    collection_address, collection_hours, premises_type, courier_contact_number,
    equipment_type, make, model, serial_number, fault_description,
    insp_application_type, insp_product_type, insp_dimensions, insp_weight, insp_install_date
  } = req.body;

  if (!company_name || !contact_name || !phone || !email || !collection_address || !collection_hours || !premises_type || !courier_contact_number || !equipment_type || !make || !model || !serial_number || !fault_description) {
    return res.render('submit', { error: 'Please fill in all required fields.', old: req.body, APPLICATION_TYPES, PRODUCT_TYPES });
  }

  const reference = nextReference();

  db.prepare(`
    INSERT INTO returns (
      reference, company_name, contact_name, phone, email, collection_address, collection_hours, premises_type, courier_contact_number,
      equipment_type, make, model, serial_number, fault_description,
      insp_application_type, insp_product_type, insp_dimensions, insp_weight, insp_install_date,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Return Submitted')
  `).run(
    reference, company_name, contact_name, phone, email, collection_address, collection_hours, premises_type, courier_contact_number,
    equipment_type, make, model, serial_number, fault_description,
    insp_application_type || '', insp_product_type || '', insp_dimensions || '', insp_weight || '', insp_install_date || ''
  );

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

  // Only general photos/videos - the Item Received Condition uploads stay
  // internal/staff-only, same as on the staff-side report.
  const files = db.prepare(
    `SELECT * FROM return_files WHERE return_id = ? AND kind IN ('photo', 'video') ORDER BY uploaded_at ASC`
  ).all(returnRow.id);

  res.render('track', { error: null, result: { returnRow, history, files } });
});

// Public: same reference+email check as the lookup above, then stream the
// customer-safe PDF report (no login - this app has no customer accounts).
router.get('/track/pdf', (req, res) => {
  const { reference, email } = req.query;
  const returnRow = db.prepare(
    'SELECT * FROM returns WHERE reference = ? AND email = ?'
  ).get((reference || '').trim(), (email || '').trim());
  if (!returnRow) return res.status(404).send('Return not found.');

  const history = db.prepare(
    'SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC'
  ).all(returnRow.id);

  generateCustomerReturnPdf(returnRow, history, res);
});

// Public: serve a single general photo/video, gated by the same
// reference+email check. Item Received Condition uploads are excluded by
// the kind filter, so they're never reachable through this route.
router.get('/track/files/:filename', (req, res) => {
  const { reference, email } = req.query;
  const returnRow = db.prepare(
    'SELECT * FROM returns WHERE reference = ? AND email = ?'
  ).get((reference || '').trim(), (email || '').trim());
  if (!returnRow) return res.status(404).send('Not found.');

  const file = db.prepare(
    `SELECT * FROM return_files WHERE return_id = ? AND filename = ? AND kind IN ('photo', 'video')`
  ).get(returnRow.id, req.params.filename);
  if (!file) return res.status(404).send('Not found.');

  const p = filePath(returnRow.reference, file.filename);
  if (!fs.existsSync(p)) return res.status(404).send('File missing.');

  res.setHeader('Content-Type', file.mime_type);
  res.sendFile(p);
});

module.exports = router;
