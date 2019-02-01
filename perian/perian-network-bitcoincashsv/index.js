// @flow

const main = {
  magic: 0xd9b4bef9,
  keyPrefix: {
    coinType: 145
  },
  addressPrefix: {
    pubkeyhash: 0x00,
    scripthash: 0x05,
    cashAddress: 'bitcoincash'
  },
  replayProtection: {
    forkSighash: 0x40,
    forcedMinVersion: 1
  }
}

module.exports = { main }
