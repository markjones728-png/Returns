const fs = require('fs');
const archiver = require('archiver');
const { db } = require('../db');
const { UPLOAD_ROOT } = require('./files');

// Streams a single .zip containing every table as JSON plus every uploaded
// photo/video, so an admin always has an independent copy of everything -
// separate from (and in addition to) whatever hosting/disk setup is in use.
function streamBackupZip(res) {
  const timestamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="returns-portal-backup-${timestamp}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Backup archive error:', err.message);
    res.status(500).end();
  });
  archive.pipe(res);

  const returns = db.prepare('SELECT * FROM returns ORDER BY id ASC').all();
  const history = db.prepare('SELECT * FROM return_status_history ORDER BY id ASC').all();
  const files = db.prepare('SELECT * FROM return_files ORDER BY id ASC').all();
  // Deliberately excludes password_hash - restoring access is done via the
  // invite/add-staff flow rather than restoring old password hashes.
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC').all();

  archive.append(JSON.stringify(returns, null, 2), { name: 'data/returns.json' });
  archive.append(JSON.stringify(history, null, 2), { name: 'data/return_status_history.json' });
  archive.append(JSON.stringify(files, null, 2), { name: 'data/return_files.json' });
  archive.append(JSON.stringify(users, null, 2), { name: 'data/users.json' });

  const readmeText = `Roger Technology / RT Automation Returns Portal - Backup
Generated: ${new Date().toISOString()}

data/*.json      - every return, its status history, uploaded-file records, and staff accounts (no passwords)
files/            - the actual uploaded photos and videos, organised by return reference number

This is a point-in-time snapshot for safekeeping. There is currently no
"restore" button in the app - if you ever need to restore from this, send
it to whoever is maintaining the app for you.
`;
  archive.append(readmeText, { name: 'README.txt' });

  if (fs.existsSync(UPLOAD_ROOT)) {
    archive.directory(UPLOAD_ROOT, 'files');
  }

  archive.finalize();
}

module.exports = { streamBackupZip };
