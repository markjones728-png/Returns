const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PERSIST_DIR } = require('./files');

const ALLOWED_MIME = /^image\/|^video\/|^application\/pdf$/;

// Files are streamed straight to disk as they come in, rather than held in
// memory (as multer.memoryStorage() used to do). A customer attaching a
// couple of phone photos/videos can easily add up to a few hundred MB
// across up to 10 files - buffering all of that in RAM at once was large
// enough to run the server out of memory and crash the whole process, which
// is what showed up as a "502 error" right at the point of hitting Send.
// utils/files.js moves each file from here into its final
// uploads/<reference> folder once saveFilesToDisk() is called.
//
// This temp folder is deliberately a sibling of the "uploads" folder (both
// directly inside PERSIST_DIR), not the system's own temp folder - on
// Render, uploads live on a separate mounted disk, and moving a file
// between two different disks can't be done with a simple, instant rename.
// Keeping both folders on the same disk from the start keeps that move
// cheap and reliable. It's also deliberately outside the "uploads" folder
// itself, so the daily backup (utils/backup.js, which zips up the whole
// uploads folder) never picks up a file still mid-upload.
const TMP_UPLOAD_DIR = path.join(PERSIST_DIR, 'uploads_tmp');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 10
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only photos, videos and PDF documents are accepted.`));
    }
  }
});

// Deletes any temporary uploaded files that never ended up being attached
// to a return - e.g. the customer uploaded photos but then a different
// required field was missing, so the form was re-shown with an error and
// those files were never moved into a return's folder by saveFilesToDisk().
// Without this, those temp files would just sit on disk forever.
function cleanupTempFiles(files) {
  (files || []).forEach((f) => {
    if (f && f.path) {
      fs.unlink(f.path, () => {});
    }
  });
}

module.exports = { upload, cleanupTempFiles, TMP_UPLOAD_DIR };
