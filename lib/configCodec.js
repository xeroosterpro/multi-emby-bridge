function decodeConfig(encoded) {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { decodeConfig, encodeConfig };