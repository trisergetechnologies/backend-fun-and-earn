const MAX_IMAGES = parseInt(process.env.PRODUCT_MAX_IMAGES || '5', 10);

/**
 * Collect uploaded file URLs from req (legacy single + multi).
 */
function collectUploadUrls(req) {
  const urls = [];

  if (req.file && req.file.url) {
    urls.push(req.file.url);
  }

  const files = req.files;
  if (Array.isArray(files)) {
    files.forEach((f) => {
      if (f && f.url) urls.push(f.url);
    });
  } else if (files && typeof files === 'object') {
    Object.values(files).forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((f) => {
          if (f && f.url) urls.push(f.url);
        });
      }
    });
  }

  return urls;
}

function parseExistingImages(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) return raw.filter((u) => typeof u === 'string' && u.trim());
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((u) => typeof u === 'string' && u.trim());
      }
    } catch {
      return null;
    }
  }
  return null;
}

function capImages(urls) {
  return urls.slice(0, MAX_IMAGES);
}

/**
 * Build images array for product create.
 */
function buildImagesForCreate(req) {
  const uploads = collectUploadUrls(req);
  return capImages(uploads);
}

/**
 * Build images array for product update.
 * @param {object} req - Express request
 * @param {string[]} currentImages - existing DB images
 */
function buildImagesForUpdate(req, currentImages = []) {
  const uploads = collectUploadUrls(req);
  const hasExistingField = req.body && Object.prototype.hasOwnProperty.call(req.body, 'existingImages');
  const existingParsed = hasExistingField ? parseExistingImages(req.body.existingImages) : null;

  if (hasExistingField && existingParsed !== null) {
    return capImages([...existingParsed, ...uploads]);
  }

  if (uploads.length > 0) {
    return capImages([...(currentImages || []), ...uploads]);
  }

  return currentImages || [];
}

function validateImageCount(count) {
  if (count > MAX_IMAGES) {
    return {
      valid: false,
      message: `Maximum ${MAX_IMAGES} images allowed per product`,
    };
  }
  return { valid: true };
}

module.exports = {
  MAX_IMAGES,
  collectUploadUrls,
  parseExistingImages,
  buildImagesForCreate,
  buildImagesForUpdate,
  validateImageCount,
};
