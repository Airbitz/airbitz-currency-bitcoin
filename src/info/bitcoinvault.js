// @flow

import { type EdgeCurrencyInfo } from 'edge-core-js/types'

import type { EngineCurrencyInfo } from '../engine/currencyEngine.js'
import type { BcoinCurrencyInfo } from '../utils/bcoinExtender/bcoinExtender.js'

const bcoinInfo: BcoinCurrencyInfo = {
  type: 'bitcoinvault',
  magic: 0xadd8bd55,
  formats: ['bip49', 'bip84', 'bip44', 'bip32'],
  keyPrefix: {
    privkey: 0x80,
    xpubkey: 0x0488b21e,
    xprivkey: 0x0488ade4,
    xpubkey58: 'xpub',
    xprivkey58: 'xprv',
    coinType: 440
  },
  addressPrefix: {
    pubkeyhash: 0x4e,
    scripthash: 0x3c,
    witnesspubkeyhash: 0x06,
    witnessscripthash: 0x0a,
    bech32: 'royale'
  }
}

const engineInfo: EngineCurrencyInfo = {
  network: 'bitcoinvault',
  currencyCode: 'BTCV',
  gapLimit: 20,
  defaultFee: 1000,
  feeUpdateInterval: 60000,
  customFeeSettings: ['satPerByte'],
  simpleFeeSettings: {
    highFee: '150',
    lowFee: '20',
    standardFeeLow: '50',
    standardFeeHigh: '100',
    standardFeeLowAmount: '173200',
    standardFeeHighAmount: '8670000'
  }
}

const currencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'BTCV',
  displayName: 'Bitcoin Vault',
  pluginId: 'bitcoinvault',
  denominations: [
    { name: 'BTCV', multiplier: '100000000', symbol: 'BTCV' },
    { name: 'mBTCV', multiplier: '100000', symbol: 'mBTCV' },
    { name: 'bits', multiplier: '100', symbol: 'ƀ' },
    { name: 'sats', multiplier: '1', symbol: 's' }
  ],
  walletType: 'wallet:bitcoinvault',

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    electrumServers: [
      'electrums://electrumx-mainnet1.bitcoinvault.global:443',
      'electrums://electrumx-mainnet2.bitcoinvault.global:443'
    ],
    disableFetchingServers: false
  },
  metaTokens: [],

  // Explorers:
  blockExplorer: 'https://explorer.bitcoinvault.global/block/%s?from=edgeapp',
  addressExplorer:
    'https://explorer.bitcoinvault.global/address/%s?from=edgeapp',
  transactionExplorer: 'https://explorer.bitcoinvault.global/tx/%s?from=edgeapp'
}

export const bitcoinvault = { bcoinInfo, engineInfo, currencyInfo }
