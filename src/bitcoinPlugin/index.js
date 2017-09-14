import txLibInfo from './currencyInfo'
import bcoin from 'lcoin'
import CurrencyPlugin from './../currencyPlugin/index'

export const BitcoinCurrencyPluginFactory = CurrencyPlugin({
  magicBytes: {
    testnet: 0x6F,
    main: 0x00
  },
  txLibInfo,
  bcoin
})
