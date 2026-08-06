const { db } = require('../db');
const { getNotifyRecipients } = require('./notifications');
const { buildBackupZipBuffer } = require('./backup');
const { sendDailyBackupEmail } = require('./email');

// This app is deployed as a normal web app (not a separate scheduled/cron
// service), so instead of relying on the process being awake at a precise
// time each night, this is checked on every incoming request (see the
// middleware in server.js). The check itself is two tiny database reads, so
// it costs nothing on the requests where nothing is due. The first request
// of a new calendar day that finds someone has opted in to "Daily Backup" in
// the admin Email Notifications area triggers the actual backup + email in
// the background, without delaying that request.
//
// The last-sent date is stored in the database (not in memory) specifically
// because this app gets redeployed often (every time code is pushed to
// GitHub), which restarts the process and would otherwise wipe an in-memory
// "have we sent today's backup yet" flag and risk sending it twice.

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function getLastAutoBackupDate() {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'last_auto_backup_date'`).get();
  return row ? row.value : null;
}

function setLastAutoBackupDate(dateStr) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('last_auto_backup_date', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(dateStr);
}

async function maybeSendDailyBackup() {
  const today = todayString();
  if (getLastAutoBackupDate() === today) return; // already sent today

  const recipients = getNotifyRecipients('notify_on_backup');
  if (!recipients.length) return; // nobody has opted in yet - nothing to do

  try {
    const zipBuffer = await buildBackupZipBuffer();
    await sendDailyBackupEmail(recipients, zipBuffer, today);
    setLastAutoBackupDate(today);
    console.log(`Automatic daily backup emailed to: ${recipients.join(', ')}`);
  } catch (err) {
    console.error('Automatic daily backup failed:', err.message);
  }
}

module.exports = { maybeSendDailyBackup };
