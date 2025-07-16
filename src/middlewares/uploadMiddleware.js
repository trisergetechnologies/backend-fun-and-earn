const multer = require('multer');
const path = require('path');

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../uploads"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// Middleware factory
const singleImageUpload = (fieldName) => {
  const uploadMiddleware = upload.single(fieldName);

  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload failed',
          error: err.message,
        });
      }

      if (req.file) {
        const baseUrl = `https://${req.get('host')}`;
        req.file.url = `${baseUrl}/uploads/${req.file.filename}`;
      }

      next();
    });
  };
};

module.exports = { singleImageUpload };
