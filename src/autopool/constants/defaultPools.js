/** Locked default pool table from business spec. */
const DEFAULT_POOLS = [
  { poolLevel: 1, entryAmount: 1000 },
  { poolLevel: 2, entryAmount: 2000 },
  { poolLevel: 3, entryAmount: 4000 },
  { poolLevel: 4, entryAmount: 8000 },
  { poolLevel: 5, entryAmount: 16000 },
  { poolLevel: 6, entryAmount: 32000 },
  { poolLevel: 7, entryAmount: 64000 },
  { poolLevel: 8, entryAmount: 128000 },
  { poolLevel: 9, entryAmount: 256000 },
  { poolLevel: 10, entryAmount: 512000 },
];

const DEFAULT_DISTRIBUTION = {
  samePoolPercent: 50,
  walletPercent: 20,
  nextPoolPercent: 20,
  adminPercent: 5,
  featurePercent: 5,
};

module.exports = { DEFAULT_POOLS, DEFAULT_DISTRIBUTION };
