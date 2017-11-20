// @flow
import type {
  AbcCorePluginOptions,
  AbcCurrencyInfo,
  AbcCurrencyPlugin,
  AbcCurrencyPluginFactory
} from 'airbitz-core-types'

import { bitcoinInfo } from './info/bitcoin.js'
import { bitcoinTestnetInfo } from './info/bitcointestnet.js'
import { bitcoincashInfo } from './info/bitcoincash.js'
import { bitcoincashTestnetInfo } from './info/bitcoincashtestnet.js'
import { dogecoinInfo } from './info/dogecoin.js'
import { dogecoinTestnetInfo } from './info/dogecointestnet.js'
import { litecoinInfo } from './info/litecoin.js'
import { litecoinTestnetInfo } from './info/litecointestnet.js'
import { CurrencyPlugin } from './plugin/plugin-api.js'
import { bcoinExtender } from './bcoin-extender/bcoin-extender'
import bcoin from 'bcoin'

const pluginsInfo = [
  bitcoinInfo,
  bitcoinTestnetInfo,
  bitcoincashInfo,
  bitcoincashTestnetInfo,
  dogecoinInfo,
  dogecoinTestnetInfo,
  litecoinInfo,
  litecoinTestnetInfo
]

// Extend bcoin to support all networks inside info
bcoinExtender(bcoin, pluginsInfo)

/**
 * Makes a core plugin factory, given the currencyInfo for that coin.
 */
function makePluginFactory (
  currencyInfo: AbcCurrencyInfo
): AbcCurrencyPluginFactory {
  return {
    pluginType: 'currency',
    pluginName: currencyInfo.pluginName,

    makePlugin (options: AbcCorePluginOptions): Promise<AbcCurrencyPlugin> {
      return Promise.resolve(new CurrencyPlugin(options, currencyInfo))
    }
  }
}

export const BitcoinPluginFactory = makePluginFactory(bitcoinInfo)
export const BitcoinTestnetPluginFactory = makePluginFactory(bitcoinTestnetInfo)
export const BitcoincashPluginFactory = makePluginFactory(bitcoincashInfo)
export const BitcoincashTestnetPluginFactory = makePluginFactory(
  bitcoincashTestnetInfo
)
export const DogecoinPluginFactory = makePluginFactory(dogecoinInfo)
export const DogecoinTestnetPluginFactory = makePluginFactory(
  dogecoinTestnetInfo
)
export const LitecoinPluginFactory = makePluginFactory(litecoinInfo)
export const LitecoinTestnetPluginFactory = makePluginFactory(
  litecoinTestnetInfo
)
