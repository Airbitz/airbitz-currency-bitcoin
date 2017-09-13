import { parse, serialize } from 'uri-js'
import { bns } from 'biggystring'
import cs from 'coinstring'
import CurrencyEngine from './currencyEngineBTC'
import { txLibInfo } from './currencyInfoBTC'
import bcoin from 'bcoin'

const BufferJS = require('bufferPlaceHolder').Buffer
const valid = address => cs.createValidator(0x00)(address)

const getParameterByName = (param, url) => {
  const name = param.replace(/[[\]]/g, '\\$&')
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)')
  const results = regex.exec(url)
  if (!results) return null
  if (!results[2]) return ''
  return decodeURIComponent(results[2].replace(/\+/g, ' '))
}

const createRandomPrivateKey = io => ({
  bitcoinKey: BufferJS.from(io.random(32)).toString('base64')
})

const createPublicKey = (walletInfo, network) => {
  if (!walletInfo.keys.bitcoinKey) throw new Error('InvalidKeyName')
  return {
    bitcoinKey: walletInfo.keys.bitcoinKey,
    bitcoinXpub: bcoin.hd.PrivateKey.fromSeed(BufferJS.from(walletInfo.keys.bitcoinKey, 'base64'), network).xpubkey()
  }
}

const privateKeyInitializers = {
  'bitcoin': io => createRandomPrivateKey(io),
  'bitcoin44': io => createRandomPrivateKey(io),
  'testnet': io => createRandomPrivateKey(io),
  'testnet44': io => createRandomPrivateKey(io)
}

const publicKeyInitializers = {
  'bitcoin': walletInfo => createPublicKey(walletInfo, 'main'),
  'bitcoin44': walletInfo => createPublicKey(walletInfo, 'main'),
  'testnet': walletInfo => createPublicKey(walletInfo, 'testnet'),
  'testnet44': walletInfo => createPublicKey(walletInfo, 'testnet')
}

export const BitcoinCurrencyPluginFactory = {
  pluginType: 'currency',
  makePlugin: async (opts = {io: {}}) => {
    let io = opts.io
    return {
      pluginName: txLibInfo.getInfo.currencyName.toLowerCase(),
      currencyInfo: txLibInfo.getInfo,

      createPrivateKey: (walletType) => {
        walletType = walletType.replace('wallet:', '').toLowerCase()
        if (!privateKeyInitializers[walletType]) throw new Error('InvalidWalletType')
        return privateKeyInitializers[walletType](io)
      },

      derivePublicKey: (walletInfo) => {
        walletInfo.type = walletInfo.type.replace('wallet:', '').toLowerCase()
        if (!publicKeyInitializers[walletInfo.type]) throw new Error('InvalidWalletType')
        if (!walletInfo.keys) throw new Error('InvalidKeyName')
        return publicKeyInitializers[walletInfo.type](walletInfo)
      },

      makeEngine: (keyInfo, opts = {}) => {
        if (keyInfo.keys) {
          keyInfo.keys.currencyKey = keyInfo.keys.bitcoinKey
        }
        return CurrencyEngine(bcoin, txLibInfo).makeEngine(io, keyInfo, opts)
      },

      parseUri: (uri) => {
        let parsedUri = parse(uri)
        let info = txLibInfo.getInfo
        if (parsedUri.scheme &&
            parsedUri.scheme.toLowerCase() !== info.currencyName.toLowerCase()) throw new Error('InvalidUriError')

        let address = parsedUri.host || parsedUri.path
        if (!address) throw new Error('InvalidUriError')
        address = address.replace('/', '') // Remove any slashes
        if (!valid(address)) throw new Error('InvalidPublicAddressError')

        let nativeAmount = null
        let currencyCode = null

        let amountStr = getParameterByName('amount', uri)

        if (amountStr && typeof amountStr === 'string') {
          let amount = parseFloat(amountStr)
          let multiplier = txLibInfo.getInfo.denominations.find(e => e.name === info.currencyCode).multiplier.toString()
          nativeAmount = bns.mulf(amount, multiplier)
          currencyCode = info.currencyCode
        }

        return {
          publicAddress: address,
          nativeAmount,
          currencyCode,
          label: getParameterByName('label', uri),
          message: getParameterByName('message', uri)
        }
      },

      encodeUri: (obj) => {
        if (!obj.publicAddress || !valid(obj.publicAddress)) throw new Error('InvalidPublicAddressError')
        if (!obj.nativeAmount && !obj.label && !obj.message) return obj.publicAddress
        let queryString = ''
        let info = txLibInfo.getInfo
        if (obj.nativeAmount) {
          let currencyCode = obj.currencyCode || info.currencyCode
          let multiplier = txLibInfo.getInfo.denominations.find(e => e.name === currencyCode).multiplier.toString()
          let amount = bns.divf(obj.nativeAmount, multiplier)
          queryString += 'amount=' + amount.toString() + '&'
        }
        if (obj.label) queryString += 'label=' + obj.label + '&'
        if (obj.message) queryString += 'message=' + obj.message + '&'
        queryString = queryString.substr(0, queryString.length - 1)

        return serialize({
          scheme: info.currencyName.toLowerCase(),
          path: obj.publicAddress,
          query: queryString
        })
      }
    }
  }
}
