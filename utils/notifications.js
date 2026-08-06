const { db } = require('../db');

// Fixed whitelist of the two notification-preference columns on `users` -
// this is the only thing ever interpolated into the SQL below, and it never
// comes from user input, so there's no injection risk despite the
// interpolation.
const NOTIFY_COLUMNS = new Set(['notify_on_submitted', 'notify_on_completed']);

// Returns the email addresses of every staff member who has opted in to a
// given notification type (see the Email Notifications area on the admin
// Users page). Staff with the box ticked but no email address set are
// skipped, since there'd be nowhere to send it.
function getNotifyRecipients(column) {
  if (!NOTIFY_COLUMNS.has(column)) return [];
  const rows = db.prepare(
    `SELECT email FROM users WHERE ${column} = 1 AND email != ''`
  ).all();
  return rows.map((r) => r.email);
}

module.exports = { getNotifyRecipients };
