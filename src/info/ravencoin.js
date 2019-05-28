// @flow

import { type EdgeCurrencyInfo } from 'edge-core-js/types'

import type { EngineCurrencyInfo } from '../engine/currencyEngine.js'
import type { BcoinCurrencyInfo } from '../utils/bcoinExtender/bcoinExtender.js'
import { imageServerUrl } from './constants.js'

const bcoinInfo: BcoinCurrencyInfo = {
  type: 'ravencoin',
  magic: 0xd9b4bef9, // ?
  formats: ['bip44', 'bip32'],
  keyPrefix: {
    privkey: 0x80, // done
    xpubkey: 0x0488b21e,
    xprivkey: 0x0488ade4,
    xpubkey58: 'xpub',
    xprivkey58: 'xprv',
    coinType: 0 // 175?
  },
  addressPrefix: {
    pubkeyhash: 0x3c, // done
    scripthash: 0x7a // done
  }
}

const engineInfo: EngineCurrencyInfo = {
  network: 'ravencoin',
  currencyCode: 'RVN',
  gapLimit: 10,
  maxFee: 1000000,
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
  currencyCode: 'RVN',
  displayName: 'Ravencoin',
  pluginName: 'ravencoin',
  denominations: [
    { name: 'RVN', multiplier: '100000000', symbol: 'R' }
  ],
  walletType: 'wallet:ravencoin',

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    electrumServers: [
      'electrum://rvn.satoshi.org.uk:50001'
    ],
    disableFetchingServers: false
  },
  metaTokens: [],

  // Explorers:
  addressExplorer: 'https://explorer.ravencoin.world/address/%s',
  blockExplorer: 'https://explorer.ravencoin.world/block/%s',
  transactionExplorer: 'https://explorer.ravencoin.world/tx/%s',

  // Images:
  symbolImage: `${imageServerUrl}/ravencoin-logo-solo-64.png`,
  symbolImageDarkMono: `${imageServerUrl}/ravencoin-logo-solo-64.png`
}

export const ravencoin = { bcoinInfo, engineInfo, currencyInfo }
