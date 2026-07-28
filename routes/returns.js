const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nextReference } = require('../db');
const {
  STATUSES, CLOSED_STATUS, STATUS_COLORS, STATUSES_NEEDING_RMA_NUMBER, STATUSES_NEEDING_RTA_NUMBER,
  APPLICATION_TYPES, PRODUCT_TYPES, WARRANTY_STATUSES,
  REPAIRABLE_OPTIONS, REQUEST_TYPES, TEST_RESULTS, RECEIVED_PARTS_STATUSES, DEALER_DETAILS
} = require('../utils/constants');
const { upload } = require('../utils/upload');
const { saveFilesToDisk, filePath } = require('../utils/files');
const { sendStatusUpdateEmail, sendReturnSubmittedEmail, sendReturnCompletedEmail, sendReturnReportEmail, sendStaffInviteEmail } = require('../utils/email');
const { generateReturnPdf, generateReturnPdfBuffer } = require('../utils/pdf');
const { generateRtAuthorisationPdf } = require('../utils/rt-form-pdf');
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
    APPLICATION_TYPES, PRODUCT_TYPES, WARRANTY_STATUSES,
    REPAIRABLE_OPTIONS, REQUEST_TYPES, TEST_RESULTS, RECEIVED_PARTS_STATUSES, DEALER_DETAILS,
    user: req.session.user
  });
});

// --- Staff: Roger Technology inspection form (filled in on receipt) ---
router.post('/returns/:id/inspection', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  const {
    insp_application_type, insp_product_type, insp_dimensions, insp_weight, insp_install_date,
    insp_product_code, insp_quantity,
    insp_plate_p_code, insp_plate_voltage, insp_plate_batch, insp_plate_in, insp_plate_pm,
    insp_guarantee_status,
    insp_problem_by_client, insp_problem_by_dealer, insp_action_suggested,
    insp_repairable, insp_request_type
  } = req.body;

  db.prepare(`
    UPDATE returns SET
      insp_application_type = ?, insp_product_type = ?, insp_dimensions = ?, insp_weight = ?, insp_install_date = ?,
      insp_product_code = ?, insp_quantity = ?,
      insp_plate_p_code = ?, insp_plate_voltage = ?, insp_plate_batch = ?, insp_plate_in = ?, insp_plate_pm = ?,
      insp_guarantee_status = ?,
      insp_problem_by_client = ?, insp_problem_by_dealer = ?, insp_action_suggested = ?,
      insp_repairable = ?, insp_request_type = ?,
      insp_completed_by = ?, insp_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    insp_application_type || '', insp_product_type || '', insp_dimensions || '', insp_weight || '', insp_install_date || '',
    insp_product_code || '', insp_quantity || '',
    insp_plate_p_code || '', insp_plate_voltage || '', insp_plate_batch || '', insp_plate_in || '', insp_plate_pm || '',
    insp_guarantee_status || '',
    insp_problem_by_client || '', insp_problem_by_dealer || '', insp_action_suggested || '',
    insp_repairable || '', insp_request_type || '',
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

  db.prepare(`
    UPDATE returns SET
      received_parts_status = ?, received_notes = ?,
      received_completed_by = ?, received_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(received_parts_status || '', received_notes || '', req.session.user.name, returnRow.id);

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

// --- Staff: download a filled copy of Roger Technology's own RMA form ---
router.get('/returns/:id/rt-form.pdf', (req, res) => {
  const returnRow = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!returnRow) return res.status(404).send('Return not found.');

  generateRtAuthorisationPdf(returnRow, res);
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
  await sendReturnCompletedEmail(updated, history);

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
  if (statusChanged) {
    await sendStatusUpdateEmail(updated);
  }

  // When a return reaches "Return Closed", send the full record to the
  // returns team's own inbox as well, so nothing is lost/forgotten.
  if (status === CLOSED_STATUS) {
    const history = db.prepare('SELECT * FROM return_status_history WHERE return_id = ? ORDER BY changed_at ASC').all(returnRow.id);
    await sendReturnCompletedEmail(updated, history);
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

// --- Admin: manage staff users ---
function usersPageData() {
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC').all();
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
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) {
    return res.render('users', { ...usersPageData(), user: req.session.user, error: 'All fields are required.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(username.trim(), hash, name.trim(), role === 'admin' ? 'admin' : 'staff');
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
  const editUser = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) return res.status(404).send('User not found.');
  res.render('user-edit', { editUser, user: req.session.user, error: null });
});

router.post('/users/:id/edit', requireAdmin, (req, res) => {
  const editUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) return res.status(404).send('User not found.');

  const { username, name, role, new_password } = req.body;
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
      db.prepare('UPDATE users SET username = ?, name = ?, role = ?, password_hash = ? WHERE id = ?')
        .run(username.trim(), name.trim(), newRole, hash, editUser.id);
    } else {
      db.prepare('UPDATE users SET username = ?, name = ?, role = ? WHERE id = ?')
        .run(username.trim(), name.trim(), newRole, editUser.id);
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
