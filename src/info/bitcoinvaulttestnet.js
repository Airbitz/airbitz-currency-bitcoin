// @flow

import { type EdgeCurrencyInfo } from 'edge-core-js/types'

import type { EngineCurrencyInfo } from '../engine/currencyEngine.js'
import type { BcoinCurrencyInfo } from '../utils/bcoinExtender/bcoinExtender.js'

const bcoinInfo: BcoinCurrencyInfo = {
  type: 'bitcoinvaulttestnet',
  magic: 0xdd68e9d3,
  formats: ['bip49', 'bip84', 'bip44', 'bip32'],
  keyPrefix: {
    privkey: 0xef,
    xpubkey: 0x043587cf,
    xprivkey: 0x04358394,
    xpubkey58: 'tpub',
    xprivkey58: 'tprv',
    coinType: 1
  },
  addressPrefix: {
    pubkeyhash: 0x6f,
    scripthash: 0xc4,
    witnesspubkeyhash: 0x03,
    witnessscripthash: 0x28,
    bech32: 'troyale'
  }
}

const engineInfo: EngineCurrencyInfo = {
  network: 'bitcoinvaulttestnet',
  currencyCode: 'TBTCV',
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
  currencyCode: 'TBTCV',
  displayName: 'Bitcoin Vault Testnet',
  pluginId: 'bitcoinvaulttestnet',
  denominations: [
    { name: 'TBTCV', multiplier: '100000000', symbol: 'TBTCV' },
    { name: 'mTBTCV', multiplier: '100000', symbol: 'mTBTCV' },
    { name: 'bits', multiplier: '100', symbol: 'ƀ' },
    { name: 'sats', multiplier: '1', symbol: 's' }
  ],
  walletType: 'wallet:bitcoinvaulttestnet',

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    electrumServers: ['electrum://electrumx.testnet.btc.stage.rnd.land:50001'],
    disableFetchingServers: true
  },
  metaTokens: [],

  // Explorers:
  blockExplorer:
    'https://explorer.testnet.bitcoinvault.global/block/%s?from=edgeapp',
  addressExplorer:
    'https://explorer.testnet.bitcoinvault.global/address/%s?from=edgeapp',
  transactionExplorer:
    'https://explorer.testnet.bitcoinvault.global/tx/%s?from=edgeapp'
}

export const bitcoinvaultTestnet = { bcoinInfo, engineInfo, currencyInfo }
