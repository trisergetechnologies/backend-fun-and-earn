'use strict';

const mockAxiosDelete = jest.fn();

jest.mock('axios', () => ({
  delete: (...args) => mockAxiosDelete(...args),
}));

jest.mock('../../models/Video', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock('../../models/VideoLike', () => ({
  deleteMany: jest.fn(),
}));

jest.mock('../../models/VideoWatchHistory', () => ({
  deleteMany: jest.fn(),
}));

jest.mock('../../../models/User', () => ({
  updateOne: jest.fn(),
}));

const Video = require('../../models/Video');
const VideoLike = require('../../models/VideoLike');
const VideoWatchHistory = require('../../models/VideoWatchHistory');
const User = require('../../../models/User');
const {
  isBunnyNotFound,
  selectVideosForDeletion,
  deleteVideoFully,
} = require('../videoRetention.service');

function chainFind(resolved) {
  return {
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

describe('videoRetention.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAX_PLATFORM_VIDEOS = '200';
    process.env.VIDEO_RETENTION_BATCH_SIZE = '20';
    process.env.BUNNY_STREAM_API_KEY = 'test-key';
    process.env.BUNNY_STREAM_LIBRARY_ID = '12345';
  });

  describe('isBunnyNotFound', () => {
    it('returns true for 404 responses', () => {
      expect(isBunnyNotFound({ response: { status: 404 } })).toBe(true);
      expect(isBunnyNotFound({ response: { status: 500 } })).toBe(false);
      expect(isBunnyNotFound(new Error('network'))).toBe(false);
    });
  });

  describe('selectVideosForDeletion', () => {
    it('returns inactive videos first up to limit', async () => {
      const inactive = [
        { _id: 'a', isActive: false, createdAt: new Date('2020-01-01') },
        { _id: 'b', isActive: false, createdAt: new Date('2020-01-02') },
      ];
      Video.find.mockReturnValueOnce(chainFind(inactive));
      Video.countDocuments.mockResolvedValue(50);

      const result = await selectVideosForDeletion(5);

      expect(result).toHaveLength(2);
      expect(Video.find).toHaveBeenCalledWith({ isActive: false });
      expect(result[0]._id).toBe('a');
    });

    it('includes oldest active overflow when no inactive backlog', async () => {
      Video.find
        .mockReturnValueOnce(chainFind([]))
        .mockReturnValueOnce(
          chainFind([{ _id: 'old1', isActive: true, createdAt: new Date('2019-01-01') }])
        );
      Video.countDocuments.mockResolvedValue(205);

      const result = await selectVideosForDeletion(10);

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('old1');
      expect(Video.find).toHaveBeenLastCalledWith({ isActive: true });
    });

    it('does not fetch overflow when active count is within cap', async () => {
      Video.find.mockReturnValueOnce(chainFind([]));
      Video.countDocuments.mockResolvedValue(150);

      const result = await selectVideosForDeletion(10);

      expect(result).toHaveLength(0);
      expect(Video.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteVideoFully', () => {
    it('treats Bunny 404 as success and removes DB records', async () => {
      mockAxiosDelete.mockRejectedValue({ response: { status: 404 } });
      Video.updateOne.mockResolvedValue({});
      VideoLike.deleteMany.mockResolvedValue({});
      VideoWatchHistory.deleteMany.mockResolvedValue({});
      User.updateOne.mockResolvedValue({});
      Video.deleteOne.mockResolvedValue({});

      const result = await deleteVideoFully({
        _id: 'vid1',
        userId: 'user1',
        isActive: true,
        bunnyFilePath: 'guid-abc',
      });

      expect(result.success).toBe(true);
      expect(Video.updateOne).toHaveBeenCalledWith(
        { _id: 'vid1' },
        { isActive: false }
      );
      expect(VideoLike.deleteMany).toHaveBeenCalledWith({ videoId: 'vid1' });
      expect(VideoWatchHistory.deleteMany).toHaveBeenCalledWith({ videoId: 'vid1' });
      expect(User.updateOne).toHaveBeenCalledWith(
        { _id: 'user1' },
        { $pull: { 'shortVideoProfile.videoUploads': 'vid1' } }
      );
      expect(Video.deleteOne).toHaveBeenCalledWith({ _id: 'vid1' });
    });

    it('leaves DB row when Bunny delete fails with non-404', async () => {
      mockAxiosDelete.mockRejectedValue({ response: { status: 503 }, message: 'unavailable' });
      Video.updateOne.mockResolvedValue({});

      const result = await deleteVideoFully({
        _id: 'vid2',
        userId: 'user2',
        isActive: true,
        bunnyFilePath: 'guid-xyz',
      });

      expect(result.success).toBe(false);
      expect(Video.deleteOne).not.toHaveBeenCalled();
    });

    it('skips deactivate when already inactive', async () => {
      mockAxiosDelete.mockResolvedValue({});
      VideoLike.deleteMany.mockResolvedValue({});
      VideoWatchHistory.deleteMany.mockResolvedValue({});
      User.updateOne.mockResolvedValue({});
      Video.deleteOne.mockResolvedValue({});

      await deleteVideoFully({
        _id: 'vid3',
        userId: 'user3',
        isActive: false,
        bunnyFilePath: 'guid-inactive',
      });

      expect(Video.updateOne).not.toHaveBeenCalled();
      expect(Video.deleteOne).toHaveBeenCalled();
    });
  });
});
