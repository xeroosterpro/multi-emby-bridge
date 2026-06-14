function getBuildId() {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7)
    || process.env.RAILWAY_DEPLOYMENT_ID?.slice(0, 12)
    || require('../package.json').version;
}

module.exports = { getBuildId };