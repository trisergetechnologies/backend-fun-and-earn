const {
  buildImagesForCreate,
  buildImagesForUpdate,
  validateImageCount,
  MAX_IMAGES,
} = require('../productImages');
const { normalizeGstin, GSTIN_MAX_LENGTH } = require('../gstin');

describe('productImages', () => {
  it('buildImagesForCreate uses legacy single file', () => {
    const req = { file: { url: 'https://x/a.jpg' }, files: null };
    expect(buildImagesForCreate(req)).toEqual(['https://x/a.jpg']);
  });

  it('buildImagesForCreate merges multi files', () => {
    const req = {
      files: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }],
    };
    expect(buildImagesForCreate(req)).toHaveLength(2);
  });

  it('buildImagesForUpdate merges existingImages and uploads', () => {
    const req = {
      body: { existingImages: JSON.stringify(['https://x/keep.jpg']) },
      files: [{ url: 'https://x/new.jpg' }],
    };
    expect(buildImagesForUpdate(req, [])).toEqual([
      'https://x/keep.jpg',
      'https://x/new.jpg',
    ]);
  });

    it('removes images when existingImages is empty array', () => {
      const req = {
        body: { existingImages: JSON.stringify([]) },
      };
      expect(buildImagesForUpdate(req, ['https://x/old1.jpg', 'https://x/old2.jpg'])).toEqual([]);
    });

    it('buildImagesForUpdate appends when existingImages omitted', () => {
    const req = { body: {}, file: { url: 'https://x/new.jpg' } };
    expect(buildImagesForUpdate(req, ['https://x/old.jpg'])).toEqual([
      'https://x/old.jpg',
      'https://x/new.jpg',
    ]);
  });

  it('validateImageCount rejects over max', () => {
    const result = validateImageCount(MAX_IMAGES + 1);
    expect(result.valid).toBe(false);
  });
});

describe('gstin', () => {
  it('allows empty GSTIN (optional)', () => {
    expect(normalizeGstin('')).toEqual({ ok: true, value: '' });
    expect(normalizeGstin(null)).toEqual({ ok: true, value: '' });
    expect(normalizeGstin('   ')).toEqual({ ok: true, value: '' });
  });

  it('saves any string within max length without format checks', () => {
    expect(normalizeGstin('INVALIDGSTINXX')).toEqual({
      ok: true,
      value: 'INVALIDGSTINXX',
    });
    expect(normalizeGstin('29ABBCA7044H1ZN')).toEqual({
      ok: true,
      value: '29ABBCA7044H1ZN',
    });
  });

  it('rejects when longer than max characters', () => {
    const tooLong = 'A'.repeat(GSTIN_MAX_LENGTH + 1);
    expect(normalizeGstin(tooLong)).toEqual({
      ok: false,
      message: `GSTIN must be at most ${GSTIN_MAX_LENGTH} characters`,
    });
  });
});
