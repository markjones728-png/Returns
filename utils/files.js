const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// See db.js for PERSIST_DIR explanation - keeps uploads on the same
// persistent disk as the database in production.
const PERSIST_DIR = process.env.PERSIST_DIR || path.join(__dirname, '..');
const UPLOAD_ROOT = path.join(PERSIST_DIR, 'uploads');

function saveFilesToDisk(reference, files) {
  const dir = path.join(UPLOAD_ROOT, reference);
  fs.mkdirSync(dir, { recursive: true });

  return files.map((file) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = `${crypto.randomBytes(8).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, safeName), file.buffer);
    return {
      filename: safeName,
      original_name: file.originalname,
      mime_type: file.mimetype,
      kind: file.mimetype.startsWith('video/') ? 'video' : 'photo'
    };
  });
}

function filePath(reference, filename) {
  return path.join(UPLOAD_ROOT, reference, filename);
}

module.exports = { saveFilesToDisk, filePath, UPLOAD_ROOT };
