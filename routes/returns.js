const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nextReference } = require('../db');
const {
  STATUSES, CLOSED_STATUS, STATUS_COLORS, STATUSES_NEEDING_RMA_NUMBER, STATUSES_NEEDING_RTA_NUMBER,
  APPLICATION_TYPES, PRODUCT_TYPES,
  TEST_RESULTS, RECEIVED_PARTS_STATUSES, DEALER_DETAILS,
  RT_PRODUCT_TYPES, INSTALLATION_AGE_OPTIONS, FAULT_OCCURRENCE_OPTIONS, ARRIVAL_CONDITION_FLAGS,
  WARRANTY_VERDICT_OPTIONS, REJECTION_REASONS, ACTION_TAKEN_OPTIONS, FAULT_CATEGORIES
} = require('../utils/constants');
const { upload } = require('../utils/upload');
const { saveFilesToDisk, filePath } = require('../utils/files');
const { sendStatusUpdateEmail, sendReturnSubmittedEmail, sendNewReturnStaffAlert, sendReturnCompletedEmail, sendReturnReportEmail, sendStaffInviteEmail } = require('../utils/email');
const { getNotifyRecipients } = require('../utils/notifications');
const { generateReturnPdf, generateReturnPdfBuffer } = require('../utils/pdf');
const { streamBackupZip } = require('../utils/backup');
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

// --- Staff: log a new return on a customer's behalf (e.g. phoned in) ---
router.get('/returns/new', (req, res) => {
  res.render('return-new', { error: null, old: {}, APPLICATION_TYPES, PRODUCT_TYPES, user: req.session.user });
});

router.post('/returns/new', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.render('return-new', { error: err.message, old: req.body, APPLICATION_TYPES, PRODUCT_TYPES, user: req.session.user });
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
    return res.render('return-new', { error: 'Please fill in all required fields.', old: req.body, APPLICATION_TYPES, PRODUCT_TYPES, user: req.session.user });
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
    VALUES (?, 'Return Submitted', ?, 'Logged by staff on behalf of customer')
  `).run(returnRow.id, req.session.user.name);

  if (req.files && req.files.length) {
    const saved = saveFilesToDisk(reference, req.files);
    const stmt = db.prepare(`
      INSERT INTO return_files (return_id, filename, original_name, mime_type, kind, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    saved.forEach((f) => stmt.run(returnRow.id, f.filename, f.original_name, f.mime_type, f.kind, req.session.user.name));
  }

  await sendReturnSubmittedEmail(returnRow);

  // Also alert whichever staff have opted in to "New Submissions" in the
  // admin Email Notifications area, if any.
  const submitRecipients = getNotifyRecipients('notify_on_submitted');
  if (submitRecipients.length) {
    await sendNewReturnStaffAlert(returnRow, submitRecipients, `${baseUrl(req)}/returns/${returnRow.id}`);
  }

  res.redirect(`/returns/${returnRow.id}`);
});

router.get('/returns/:id', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const files = db.prepare('SELECT * FROM return_files WHERE return_id = ? ORDER BY uploaded_at ASC').all(returnRow.id);
  const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at DESC').all(returnRow.id);

  res.render('return-detail', {
    r: returnRow, files, history, STATUSES, STATUSES_NEEDING_RMA_NUMBER, STATUSES_NEEDING_RTA_NUMBER,
    statusColors: STATUS_COLORS,
    closedStatus: CLOSED_STATUS,
    APPLICATION_TYPES, PRODUCT_TYPES,
    TEST_RESULTS, RECEIVED_PARTS_STATUSES, DEALER_DETAILS,
    RT_PRODUCT_TYPES, INSTALLATION_AGE_OPTIONS, FAULT_OCCURRENCE_OPTIONS, ARRIVAL_CONDITION_FLAGS,
    WARRANTY_VERDICT_OPTIONS, REJECTION_REASONS, ACTION_TAKEN_OPTIONS, FAULT_CATEGORIES,
    user: req.session.user
  });
});

// --- Staff: Roger Technology inspection form (filled in on receipt) ---
router.post('/returns/:id/inspection', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  // Matches the Roger Technology Warranty Repair Return Form's "Product
  // Information" and "Reported Fault" sections - everything else on that
  // form (customer/product identity, RMA number, date received) is already
  // captured elsewhere, and the fields specific to the older "Request for
  // Authorisation to Return Product for Inspection" form have been retired.
  const { insp_invoice_number, insp_rt_product_type, insp_installation_age, insp_fault_occurrence } = req.body;

  db.prepare(`
    UPDATE returns SET
      insp_invoice_number = ?, insp_rt_product_type = ?, insp_installation_age = ?, insp_fault_occurrence = ?,
      insp_completed_by = ?, insp_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    insp_invoice_number || '', insp_rt_product_type || '', insp_installation_age || '', insp_fault_occurrence || '',
    req.session.user.name,
    returnRow.id
  );

  res.redirect(`/returns/${returnRow.id}#inspection`);
});

// --- Staff: item received condition (filled in when the item first     ---
// --- arrives - photos, whether all parts are present, and notes.       ---
// --- Internal/system use only - never included on anything emailed to  ---
// --- the customer (see utils/pdf.js).                                  ---
router.post('/returns/:id/received', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).send(err.message);
    next();
  });
}, (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const { received_parts_status, received_notes } = req.body;

  // Checkboxes come through as a string if only one is ticked, an array if
  // several are, or undefined if none are - normalise to a comma-joined list.
  let flags = req.body.received_condition_flags || [];
  if (!Array.isArray(flags)) flags = [flags];

  db.prepare(`
    UPDATE returns SET
      received_parts_status = ?, received_notes = ?, received_condition_flags = ?,
      received_completed_by = ?, received_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(received_parts_status || '', received_notes || '', flags.join(', '), req.session.user.name, returnRow.id);

  if (req.files && req.files.length) {
    const saved = saveFilesToDisk(returnRow.reference, req.files, 'received');
    const stmt = db.prepare(`
      INSERT INTO return_files (return_id, filename, original_name, mime_type, kind, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    saved.forEach((f) => stmt.run(returnRow.id, f.filename, f.original_name, f.mime_type, f.kind, req.session.user.name));
  }

  res.redirect(`/returns/${returnRow.id}#received`);
});

// --- Staff: testing results (filled in after tests are carried out) ---
router.post('/returns/:id/test', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const { test_result, test_notes } = req.body;

  db.prepare(`
    UPDATE returns SET
      test_result = ?, test_notes = ?,
      test_completed_by = ?, test_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(test_result || '', test_notes || '', req.session.user.name, returnRow.id);

  res.redirect(`/returns/${returnRow.id}#testing`);
});

// --- Staff: warranty determination & final verdict, matching the Roger  ---
// --- Technology Warranty Repair Return Form's section 5. Internal/staff ---
// --- use only, same as the rest of the Inspection Form.                 ---
router.post('/returns/:id/warranty', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const { insp_warranty_verdict, insp_rejection_reason, insp_action_taken, fault_category, insp_warranty_summary } = req.body;

  db.prepare(`
    UPDATE returns SET
      insp_warranty_verdict = ?, insp_rejection_reason = ?, insp_action_taken = ?, fault_category = ?, insp_warranty_summary = ?,
      warranty_completed_by = ?, warranty_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    insp_warranty_verdict || '', insp_rejection_reason || '', insp_action_taken || '', fault_category || '', insp_warranty_summary || '',
    req.session.user.name,
    returnRow.id
  );

  res.redirect(`/returns/${returnRow.id}#warranty`);
});

// --- Admin only: correct/edit the details the customer originally typed  ---
// --- in at submission, in case of a mistake at booking-in or details     ---
// --- that have changed since. Any change here also changes what the     ---
// --- customer sees on their Track a Return page and in emails, since     ---
// --- those all read straight from these same columns.                   ---
router.post('/returns/:id/customer-details', requireAdmin, (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const {
    company_name, contact_name, phone, email,
    collection_address, collection_hours, premises_type, courier_contact_number,
    equipment_type, make, model, serial_number, fault_description,
    insp_application_type, insp_product_type, insp_dimensions, insp_weight, insp_install_date
  } = req.body;

  if (!company_name || !contact_name || !phone || !email || !collection_address || !collection_hours || !premises_type || !courier_contact_number || !equipment_type || !make || !model || !serial_number || !fault_description) {
    return res.status(400).send('Please fill in all required fields, then go back and try again.');
  }

  db.prepare(`
    UPDATE returns SET
      company_name = ?, contact_name = ?, phone = ?, email = ?,
      collection_address = ?, collection_hours = ?, premises_type = ?, courier_contact_number = ?,
      equipment_type = ?, make = ?, model = ?, serial_number = ?, fault_description = ?,
      insp_application_type = ?, insp_product_type = ?, insp_dimensions = ?, insp_weight = ?, insp_install_date = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    company_name, contact_name, phone, email,
    collection_address, collection_hours, premises_type, courier_contact_number,
    equipment_type, make, model, serial_number, fault_description,
    insp_application_type || '', insp_product_type || '', insp_dimensions || '', insp_weight || '', insp_install_date || '',
    returnRow.id
  );

  res.redirect(`/returns/${returnRow.id}`);
});

// Quick one-click archive/reopen actions (shortcuts for the status form above)
router.post('/returns/:id/archive', async (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  db.prepare(`UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(CLOSED_STATUS, returnRow.id);
  db.prepare(`
    INSERT INTO return_status_history (return_id, status, changed_by, note)
    VALUES (?, ?, ?, 'Archived by staff')
  `).run(returnRow.id, CLOSED_STATUS, req.session.user.name);

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnRow.id);
  const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);
  await sendReturnCompletedEmail(updated, history, getNotifyRecipients('notify_on_completed'));

  res.redirect(`/returns/${returnRow.id}`);
});

router.post('/returns/:id/status', async (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const { status, note, manufacturer_rma_number, rta_rt_number } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).send('Invalid status.');

  const statusChanged = status !== returnRow.status;

  db.prepare(`UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, returnRow.id);
  db.prepare(`
    INSERT INTO return_status_history (return_id, status, changed_by, note)
    VALUES (?, ?, ?, ?)
  `).run(returnRow.id, status, req.session.user.name, note || '');

  // Only overwrite these numbers if something was actually entered this time,
  // so they aren't accidentally wiped out by a later, unrelated status change.
  if (manufacturer_rma_number && manufacturer_rma_number.trim()) {
    db.prepare(`UPDATE returns SET manufacturer_rma_number = ? WHERE id = ?`)
      .run(manufacturer_rma_number.trim(), returnRow.id);
  }
  if (rta_rt_number && rta_rt_number.trim()) {
    db.prepare(`UPDATE returns SET rta_rt_number = ? WHERE id = ?`)
      .run(rta_rt_number.trim(), returnRow.id);
  }

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnRow.id);

  // The customer is always emailed whenever the status actually changes, so
  // they're kept up to date automatically without staff needing to remember.
  // The link takes them straight to their report on the Track a Return page,
  // with their reference/email already filled in.
  if (statusChanged) {
    const trackUrl = `${baseUrl(req)}/track?reference=${encodeURIComponent(updated.reference)}&email=${encodeURIComponent(updated.email)}`;
    await sendStatusUpdateEmail(updated, trackUrl);
  }

  // When a return reaches "Return Closed", send the full record to whichever
  // staff have opted in to "Completed Returns" in the admin Email
  // Notifications area, so nothing is lost/forgotten.
  if (status === CLOSED_STATUS) {
    const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);
    await sendReturnCompletedEmail(updated, history, getNotifyRecipients('notify_on_completed'));
  }

  res.redirect(`/returns/${returnRow.id}`);
});

// --- Staff: email the PDF report to the customer, and mark it as sent ---
router.post('/returns/:id/send-report', async (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const historyForPdf = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);
  const pdfBuffer = await generateReturnPdfBuffer(returnRow, historyForPdf);
  await sendReturnReportEmail(returnRow, pdfBuffer);

  db.prepare(`UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?`).run('Report Sent', returnRow.id);
  db.prepare(`
    INSERT INTO return_status_history (return_id, status, changed_by, note)
    VALUES (?, 'Report Sent', ?, 'PDF report emailed to customer')
  `).run(returnRow.id, req.session.user.name);

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

// --- Staff: add/edit a note against a single uploaded photo/video ---
router.post('/returns/:id/files/:fileId/caption', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const file = db.prepare('SELECT * FROM return_files WHERE id = ? AND return_id = ?')
    .get(req.params.fileId, returnRow.id);
  if (!file) return res.status(404).send('File not found.');

  db.prepare('UPDATE return_files SET caption = ? WHERE id = ?')
    .run((req.body.caption || '').trim(), file.id);

  const anchor = req.body.redirect_anchor ? `#${req.body.redirect_anchor}` : '';
  res.redirect(`/returns/${returnRow.id}${anchor}`);
});

router.get('/returns/:id/pdf', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');
  const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);
  const files = db.prepare('SELECT * FROM return_files WHERE return_id = ? ORDER BY uploaded_at ASC').all(returnRow.id);

  generateReturnPdf(returnRow, history, files, res);
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

// --- Any logged-in user: change their own password ---
router.get('/account', (req, res) => {
  res.render('account', { user: req.session.user, error: null, success: null });
});

router.post('/account/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!dbUser || !bcrypt.compareSync(current_password || '', dbUser.password_hash)) {
    return res.render('account', { user: req.session.user, error: 'Current password is incorrect.', success: null });
  }
  if (!new_password || new_password.length < 8) {
    return res.render('account', { user: req.session.user, error: 'New password must be at least 8 characters.', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('account', { user: req.session.user, error: 'New passwords do not match.', success: null });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, dbUser.id);
  res.render('account', { user: req.session.user, error: null, success: 'Password updated.' });
});

// --- Admin: backups ---
router.get('/backup', requireAdmin, (req, res) => {
  res.render('backup', { user: req.session.user });
});

router.get('/backup/download', requireAdmin, (req, res) => {
  streamBackupZip(res);
});

// --- Reports: fault-category trends and CSV exports of returns. Open to   ---
// --- any logged-in staff member (like the dashboard), not admin-only,     ---
// --- since it doesn't expose anything staff can't already see per-return. ---
router.get('/reports', (req, res) => {
  const { from, to } = req.query;

  const clauses = [];
  const params = [];
  if (from) { clauses.push('date(created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(created_at) <= date(?)'); params.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(`SELECT status, equipment_type, fault_category FROM returns ${where}`).all(...params);
  const totalInRange = rows.length;
  const categorised = rows.filter((r) => r.fault_category);

  // Totals per fault category (only returns where staff have recorded one
  // as part of Warranty Determination - older/in-progress returns won't
  // have this yet), most common first.
  const categoryTotals = {};
  FAULT_CATEGORIES.forEach((c) => { categoryTotals[c] = 0; });
  categorised.forEach((r) => {
    categoryTotals[r.fault_category] = (categoryTotals[r.fault_category] || 0) + 1;
  });
  const categoryTotalsSorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const maxCategoryCount = Math.max(1, ...categoryTotalsSorted.map(([, n]) => n));

  // Matrix of Equipment Type x Fault Category, so a trend on a particular
  // type of kit stands out. Equipment Type is free text on the submission
  // form, so this groups by the trimmed value exactly as typed - returns
  // where it was entered inconsistently will appear as separate rows.
  const matrix = {};
  categorised.forEach((r) => {
    const key = (r.equipment_type || '').trim() || 'Unspecified';
    if (!matrix[key]) matrix[key] = {};
    matrix[key][r.fault_category] = (matrix[key][r.fault_category] || 0) + 1;
  });
  const equipmentTypes = Object.keys(matrix).sort((a, b) => {
    const totalA = Object.values(matrix[a]).reduce((s, n) => s + n, 0);
    const totalB = Object.values(matrix[b]).reduce((s, n) => s + n, 0);
    return totalB - totalA;
  });

  res.render('reports', {
    user: req.session.user,
    from: from || '', to: to || '',
    totalInRange, categorisedCount: categorised.length,
    categoryTotalsSorted, maxCategoryCount,
    FAULT_CATEGORIES, equipmentTypes, matrix
  });
});

// --- CSV export of returns (opens straight in Excel), filtered by status  ---
// --- (open/closed/all) and the same optional date range as the Reports    ---
// --- page above.                                                          ---
router.get('/reports/export', (req, res) => {
  const { status, from, to } = req.query;

  const clauses = [];
  const params = [];
  if (status === 'open') { clauses.push('status != ?'); params.push(CLOSED_STATUS); }
  if (status === 'closed') { clauses.push('status = ?'); params.push(CLOSED_STATUS); }
  if (from) { clauses.push('date(created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(created_at) <= date(?)'); params.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(`SELECT * FROM returns ${where} ORDER BY created_at ASC`).all(...params);

  const columns = [
    ['Reference', (r) => r.reference],
    ['Status', (r) => r.status],
    ['Company', (r) => r.company_name],
    ['Contact Name', (r) => r.contact_name],
    ['Phone', (r) => r.phone],
    ['Email', (r) => r.email],
    ['Equipment Type', (r) => r.equipment_type],
    ['Make', (r) => r.make],
    ['Model', (r) => r.model],
    ['Serial Number', (r) => r.serial_number],
    ['Fault Description', (r) => r.fault_description],
    ['Fault Category', (r) => r.fault_category],
    ['Manufacturer RMA Number', (r) => r.manufacturer_rma_number],
    ['RTA RT Number', (r) => r.rta_rt_number],
    ['Created', (r) => r.created_at],
    ['Last Updated', (r) => r.updated_at]
  ];

  const csvEscape = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [columns.map(([label]) => csvEscape(label)).join(',')];
  rows.forEach((r) => {
    lines.push(columns.map(([, fn]) => csvEscape(fn(r))).join(','));
  });
  const csv = lines.join('\r\n');

  const labelPart = status === 'open' ? 'open' : status === 'closed' ? 'closed' : 'all';
  const timestamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="returns-${labelPart}-${timestamp}.csv"`);
  res.send('\uFEFF' + csv); // BOM so Excel opens the UTF-8 file with correct characters
});

// --- Admin: manage staff users ---
function usersPageData() {
  const users = db.prepare('SELECT id, username, name, role, email, notify_on_submitted, notify_on_completed, notify_on_backup, created_at FROM users ORDER BY created_at ASC').all();
  const invites = db.prepare(`
    SELECT * FROM invites WHERE accepted_at IS NULL ORDER BY created_at DESC
  `).all().map((inv) => ({ ...inv, expired: new Date(inv.expires_at) < new Date() }));
  return { users, invites };
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function adminCount() {
  return db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c;
}

router.get('/users', requireAdmin, (req, res) => {
  res.render('users', { ...usersPageData(), user: req.session.user, error: null });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, password, name, role, email } = req.body;
  if (!username || !password || !name) {
    return res.render('users', { ...usersPageData(), user: req.session.user, error: 'All fields are required.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)')
      .run(username.trim(), hash, name.trim(), role === 'admin' ? 'admin' : 'staff', (email || '').trim());
    res.redirect('/users');
  } catch (e) {
    res.render('users', { ...usersPageData(), user: req.session.user, error: 'Username already exists.' });
  }
});

// Invite a new staff member by email - they set their own username/password
router.post('/users/invite', requireAdmin, async (req, res) => {
  const { email, name, role } = req.body;
  if (!email || !name) {
    return res.render('users', { ...usersPageData(), user: req.session.user, error: 'Name and email are required to send an invite.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO invites (email, name, role, token, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(email.trim(), name.trim(), role === 'admin' ? 'admin' : 'staff', token, req.session.user.name, expiresAt);

  const acceptUrl = `${baseUrl(req)}/accept-invite/${token}`;
  await sendStaffInviteEmail({ email: email.trim(), name: name.trim(), invitedBy: req.session.user.name, acceptUrl });

  res.redirect('/users');
});

router.post('/users/invite/:id/revoke', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL').run(req.params.id);
  res.redirect('/users');
});

router.get('/users/:id/edit', requireAdmin, (req, res) => {
  const editUser = db.prepare('SELECT id, username, name, role, email FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) return res.status(404).send('User not found.');
  res.render('user-edit', { editUser, user: req.session.user, error: null });
});

router.post('/users/:id/edit', requireAdmin, (req, res) => {
  const editUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) return res.status(404).send('User not found.');

  const { username, name, role, email, new_password } = req.body;
  const newRole = role === 'admin' ? 'admin' : 'staff';

  if (!username || !name) {
    return res.render('user-edit', { editUser, user: req.session.user, error: 'Name and username are required.' });
  }
  if (editUser.role === 'admin' && newRole !== 'admin' && adminCount() <= 1) {
    return res.render('user-edit', { editUser, user: req.session.user, error: 'You can\'t remove admin access from the last remaining admin.' });
  }

  try {
    if (new_password) {
      if (new_password.length < 8) {
        return res.render('user-edit', { editUser, user: req.session.user, error: 'New password must be at least 8 characters.' });
      }
      const hash = bcrypt.hashSync(new_password, 10);
      db.prepare('UPDATE users SET username = ?, name = ?, role = ?, email = ?, password_hash = ? WHERE id = ?')
        .run(username.trim(), name.trim(), newRole, (email || '').trim(), hash, editUser.id);
    } else {
      db.prepare('UPDATE users SET username = ?, name = ?, role = ?, email = ? WHERE id = ?')
        .run(username.trim(), name.trim(), newRole, (email || '').trim(), editUser.id);
    }
    // Keep the current session's displayed name/role in sync if editing yourself
    if (req.session.user.id === editUser.id) {
      req.session.user.name = name.trim();
      req.session.user.username = username.trim();
      req.session.user.role = newRole;
    }
    res.redirect('/users');
  } catch (e) {
    res.render('user-edit', { editUser, user: req.session.user, error: 'That username is already taken.' });
  }
});

// --- Admin: which staff get emailed automatically on a new submission,   ---
// --- which get emailed when a return is marked "Return Closed", and      ---
// --- which get the automatic daily backup (see utils/autoBackup.js). A   ---
// --- checkbox that isn't ticked simply doesn't appear in req.body, so    ---
// --- every user is set explicitly (on if present in the array, off if   ---
// --- not) rather than only ever turning things on.                      ---
router.post('/users/notifications', requireAdmin, (req, res) => {
  let submittedIds = req.body.notify_submitted || [];
  if (!Array.isArray(submittedIds)) submittedIds = [submittedIds];
  let completedIds = req.body.notify_completed || [];
  if (!Array.isArray(completedIds)) completedIds = [completedIds];
  let backupIds = req.body.notify_backup || [];
  if (!Array.isArray(backupIds)) backupIds = [backupIds];

  const allUsers = db.prepare('SELECT id FROM users').all();
  const updateStmt = db.prepare('UPDATE users SET notify_on_submitted = ?, notify_on_completed = ?, notify_on_backup = ? WHERE id = ?');
  allUsers.forEach((u) => {
    const notifySubmitted = submittedIds.includes(String(u.id)) ? 1 : 0;
    const notifyCompleted = completedIds.includes(String(u.id)) ? 1 : 0;
    const notifyBackup = backupIds.includes(String(u.id)) ? 1 : 0;
    updateStmt.run(notifySubmitted, notifyCompleted, notifyBackup, u.id);
  });

  res.redirect('/users');
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).send('User not found.');

  if (target.id === req.session.user.id) {
    return res.render('users', { ...usersPageData(), user: req.session.user, error: 'You can\'t delete your own account while logged in as it.' });
  }
  if (target.role === 'admin' && adminCount() <= 1) {
    return res.render('users', { ...usersPageData(), user: req.session.user, error: 'You can\'t delete the last remaining admin.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.redirect('/users');
});

module.exports = router;
