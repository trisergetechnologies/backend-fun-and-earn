const multer = require('multer');
const path = require('path');
const { MAX_IMAGES } = require('../utils/productImages');

const MAX_FILE_SIZE = parseInt(process.env.PRODUCT_MAX_IMAGE_SIZE_MB || '1', 10) * 1024 * 1024;

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
};

const baseMulter = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

function attachFileUrls(req) {
  const baseUrl = `https://${req.get('host')}`;

  if (req.file) {
    req.file.url = `${baseUrl}/uploads/${req.file.filename}`;
  }

  const assignUrls = (files) => {
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    list.forEach((f) => {
      if (f && f.filename) {
        f.url = `${baseUrl}/uploads/${f.filename}`;
      }
    });
  };

  if (req.files) {
    if (Array.isArray(req.files)) {
      assignUrls(req.files);
    } else {
      Object.values(req.files).forEach(assignUrls);
    }
  }
}

function handleMulterError(err, res) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `Each image must be at most ${process.env.PRODUCT_MAX_IMAGE_SIZE_MB || 1}MB`,
        data: null,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_IMAGES} images allowed per product`,
        data: null,
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload failed',
      error: err.message,
      data: null,
    });
  }

  return res.status(400).json({
    success: false,
    message: err.message || 'File upload failed',
    data: null,
  });
}

function wrapMulter(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return handleMulterError(err, res);
      }
      attachFileUrls(req);
      next();
    });
  };
}

const singleImageUpload = (fieldName) =>
  wrapMulter(baseMulter.single(fieldName));

const multiImageUpload = (fieldName, maxCount = MAX_IMAGES) =>
  wrapMulter(baseMulter.array(fieldName, maxCount));

const flexibleProductImageUpload = () =>
  wrapMulter(
    baseMulter.fields([
      { name: 'image', maxCount: 1 },
      { name: 'images', maxCount: MAX_IMAGES },
    ])
  );

module.exports = {
  singleImageUpload,
  multiImageUpload,
  flexibleProductImageUpload,
};
