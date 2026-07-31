const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// See db.js for PERSIST_DIR explanation - keeps uploads on the same
// persistent disk as the database in production.
const PERSIST_DIR = process.env.PERSIST_DIR || path.join(__dirname, '..');
const UPLOAD_ROOT = path.join(PERSIST_DIR, 'uploads');

// kindPrefix lets a caller tag uploads as belonging to a distinct group
// (e.g. "received" for the received-condition photos) so they can be
// filtered/displayed separately from general photos/videos elsewhere.
function saveFilesToDisk(reference, files, kindPrefix) {
  const dir = path.join(UPLOAD_ROOT, reference);
  fs.mkdirSync(dir, { recursive: true });

  return files.map((file) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = `${crypto.randomBytes(8).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, safeName), file.buffer);
    const baseKind = file.mimetype.startsWith('video/')
      ? 'video'
      : file.mimetype === 'application/pdf'
        ? 'document'
        : 'photo';
    return {
      filename: safeName,
      original_name: file.originalname,
      mime_type: file.mimetype,
      kind: kindPrefix ? `${kindPrefix}_${baseKind}` : baseKind
    };
  });
}

function filePath(reference, filename) {
  return path.join(UPLOAD_ROOT, reference, filename);
}

module.exports = { saveFilesToDisk, filePath, UPLOAD_ROOT };
