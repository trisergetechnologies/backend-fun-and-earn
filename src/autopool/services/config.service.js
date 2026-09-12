const {
  AutopoolSettings,
  AutopoolPoolConfig,
  AutopoolSystemBalances,
} = require('../models');
const { DEFAULT_POOLS, DEFAULT_DISTRIBUTION } = require('../constants/defaultPools');

/**
 * Autopool is opt-in via AUTOPOOL_ENABLED.
 * Unset / anything other than "true" → off (safe for existing app traffic).
 * Does not gate non-autopool routes (wallets, orders, legacy referrals).
 */
function isAutopoolEnabledFromEnv() {
  return process.env.AUTOPOOL_ENABLED === 'true';
}

function defaultEnabledForEnv() {
  return isAutopoolEnabledFromEnv();
}

function enabledSourceLabel() {
  if (process.env.AUTOPOOL_ENABLED === 'true') return 'env:true';
  if (process.env.AUTOPOOL_ENABLED === 'false') return 'env:false';
  return 'env:unset (off)';
}

async function ensureSettings(session) {
  const opts = session ? { session } : {};
  let doc = await AutopoolSettings.findOne({ key: 'global' }).session(session || null);
  if (!doc) {
    const created = await AutopoolSettings.create(
      [{ key: 'global', enabled: defaultEnabledForEnv() }],
      opts
    );
    doc = created[0];
  }
  // Keep settings.enabled in sync with env for operators reading the doc
  const envOn = isAutopoolEnabledFromEnv();
  if (doc.enabled !== envOn) {
    doc.enabled = envOn;
    await doc.save(opts);
  }
  return doc;
}

async function ensureSystemBalances(session) {
  const opts = session ? { session } : {};
  let doc = await AutopoolSystemBalances.findOne({ key: 'global' }).session(session || null);
  if (!doc) {
    const created = await AutopoolSystemBalances.create(
      [{ key: 'global', featureReserve: 0, adminAllocation: 0 }],
      opts
    );
    doc = created[0];
  }
  return doc;
}

let hasSeededPoolConfigs = false;

async function seedPoolConfigs(session) {
  if (!session && hasSeededPoolConfigs) {
    return AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean();
  }
  const opts = session ? { session } : {};
  for (const p of DEFAULT_POOLS) {
    await AutopoolPoolConfig.findOneAndUpdate(
      { poolLevel: p.poolLevel },
      {
        $set: {
          entryAmount: p.entryAmount,
          maxCycles: 10,
        },
        $setOnInsert: {
          poolLevel: p.poolLevel,
          collectionMultiplier: 2,
          distribution: { ...DEFAULT_DISTRIBUTION },
          active: true,
          configVersion: 1,
        },
      },
      { upsert: true, new: true, ...opts }
    );
  }
  if (!session) {
    hasSeededPoolConfigs = true;
  }
  return AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).session(session || null);
}

async function getPoolConfig(poolLevel, session) {
  return AutopoolPoolConfig.findOne({ poolLevel, active: true }).session(session || null);
}

function snapshotFromConfig(config) {
  return {
    entryAmount: config.entryAmount,
    collectionMultiplier: config.collectionMultiplier ?? 2,
    maxCycles: config.maxCycles ?? 10,
    samePoolPercent: config.distribution?.samePoolPercent ?? 50,
    walletPercent: config.distribution?.walletPercent ?? 20,
    nextPoolPercent: config.distribution?.nextPoolPercent ?? 20,
    adminPercent: config.distribution?.adminPercent ?? 5,
    featurePercent: config.distribution?.featurePercent ?? 5,
    configVersion: config.configVersion ?? 1,
  };
}

async function isAutopoolEnabled(_session) {
  return isAutopoolEnabledFromEnv();
}

module.exports = {
  ensureSettings,
  ensureSystemBalances,
  seedPoolConfigs,
  getPoolConfig,
  snapshotFromConfig,
  isAutopoolEnabled,
  isAutopoolEnabledFromEnv,
  enabledSourceLabel,
  defaultEnabledForEnv,
};
