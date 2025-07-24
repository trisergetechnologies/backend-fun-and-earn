// middleware/videoUpload.js
const multer = require('multer');

// Hold file in memory
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /mp4|mov|avi|webm|mkv/;
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (allowedTypes.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Only video files are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const singleVideoUpload = (fieldName) => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        return res.status(200).json({
          success: false,
          message: 'Video upload failed',
          error: err.message,
        });
      }

      if (!req.file) {
        return res.status(200).json({ success: false, message: "No video file uploaded" });
      }

      next();
    });
  };
};

module.exports = { singleVideoUpload };
