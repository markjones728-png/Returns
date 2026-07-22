const multer = require('multer');

const ALLOWED_MIME = /^image\/|^video\//;

const storage = multer.memoryStorage();

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
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only photos and videos are accepted.`));
    }
  }
});

module.exports = { upload };
