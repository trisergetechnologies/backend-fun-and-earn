'use strict';

const SystemEarningLog = require('../../models/SystemEarningLog');
const User = require('../../models/User');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapLogRow(log, userMap) {
  const u = log.fromUser ? userMap.get(String(log.fromUser)) : null;
  return {
    _id: log._id,
    amount: log.amount,
    type: log.type,
    source: log.source,
    context: log.context || '',
    status: log.status,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
    fromUser: u
      ? {
          id: String(u._id),
          name: u.name || '',
          serialNumber: u.serialNumber ?? null,
        }
      : null,
  };
}

async function resolveUserIdsFromSearch(term) {
  const serialNum = Number(term);
  const or = [{ name: { $regex: escapeRegex(term), $options: 'i' } }];
  if (!Number.isNaN(serialNum)) or.push({ serialNumber: serialNum });

  const users = await User.find({ $or: or }).select('_id').limit(200).lean();
  return users.map((u) => u._id);
}

function buildBaseMatch(type, source) {
  const match = {};
  if (type && type !== 'all' && ['inflow', 'outflow'].includes(type)) {
    match.type = type;
  }
  if (source && source !== 'all' && typeof source === 'string') {
    match.source = source;
  }
  return match;
}

async function buildFullMatch(type, source, search) {
  const base = buildBaseMatch(type, source);
  const term = search && typeof search === 'string' ? search.trim() : '';
  if (!term) return base;

  const regex = escapeRegex(term);
  const or = [
    { source: { $regex: regex, $options: 'i' } },
    { context: { $regex: regex, $options: 'i' } },
    { status: { $regex: regex, $options: 'i' } },
  ];

  const userIds = await resolveUserIdsFromSearch(term);
  if (userIds.length) {
    or.push({ fromUser: { $in: userIds } });
  }

  if (!Object.keys(base).length) return { $or: or };
  return { $and: [base, { $or: or }] };
}

/**
 * Paginated system logs: filter + sort + limit on indexed fields first, then hydrate users.
 */
async function getSystemEarningLogsPage({
  page = 1,
  limit = 20,
  search,
  type,
  source,
}) {
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const pageNum = Math.max(1, Number(page));
  const skip = (pageNum - 1) * limitNum;

  const match = await buildFullMatch(type, source, search);

  const [total, rows] = await Promise.all([
    SystemEarningLog.countDocuments(match),
    SystemEarningLog.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  const userIds = rows.map((r) => r.fromUser).filter(Boolean);
  let userMap = new Map();
  if (userIds.length) {
    const users = await User.find({ _id: { $in: userIds } })
      .select('name serialNumber')
      .lean();
    userMap = new Map(users.map((u) => [String(u._id), u]));
  }

  const logs = rows.map((row) => mapLogRow(row, userMap));

  return {
    logs,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

module.exports = {
  getSystemEarningLogsPage,
  mapLogRow,
  buildBaseMatch,
  buildFullMatch,
  escapeRegex,
};
