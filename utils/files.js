const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

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
