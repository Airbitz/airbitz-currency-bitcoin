// @flow

import { type EdgeIo } from 'edge-core-js/types'

import { logger } from '../utils/logger.js'
import { allInfo } from '../info/all.js'

const makeBroadcastBlockchainInfo = (io: EdgeIo, currencyCode: string) => {
  const supportedCodes = ['BTC']
  if (!supportedCodes.find(c => c === currencyCode)) {
    return null
  }
  return async (rawTx: string) => {
    try {
      const response = await io.fetch('https://blockchain.info/pushtx', {
        method: 'POST',
        body: 'tx=' + rawTx,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      if (response.ok) {
        logger.info('SUCCESS makeBroadcastBlockchainInfo')
        return true
      } else {
        logger.info('ERROR makeBroadcastBlockchainInfo', response)
        throw new Error(`blockchain.info failed with status ${response.status}`)
      }
    } catch (e) {
      logger.info('ERROR makeBroadcastBlockchainInfo', e)
      throw e
    }
  }
}

const makeBroadcastInsight = (io: EdgeIo, currencyCode: string) => {
  const supportedCodes = ['BCH']
  if (!supportedCodes.find(c => c === currencyCode)) {
    return null
  }

  const urls = {
    BCH: 'https://bch-insight.bitpay.com/api/tx/send',
    BTC: 'https://insight.bitpay.com/api/tx/send'
  }

  return async (rawTx: string) => {
    try {
      const response = await io.fetch(urls[currencyCode], {
        method: 'POST',
        body: 'rawtx=' + rawTx,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      if (response.ok) {
        const out = await response.json()
        if (out.txid) {
          logger.info('SUCCESS makeBroadcastInsight:' + JSON.stringify(out))
          return out
        }
      }
      logger.info('ERROR makeBroadcastInsight', response)
      throw new Error(
        `${urls[currencyCode]} failed with status ${response.status}`
      )
    } catch (e) {
      logger.info('ERROR makeBroadcastInsight:', e)
      throw e
    }
  }
}

const makeBroadcastBlockchair = (io: EdgeIo, currencyCode: string) => {
  const supportedCodes = ['DOGE']
  if (!supportedCodes.find(c => c === currencyCode)) {
    return null
  }
  currencyCode = currencyCode.toLowerCase()
  const info = allInfo.find(currency => {
    return currency.currencyInfo.currencyCode === currencyCode.toUpperCase()
  })
  let pluginName
  if (info && info.currencyInfo) {
    pluginName = info.currencyInfo.pluginName
  } else {
    return null
  }

  return async (rawTx: string) => {
    try {
      const body = { data: rawTx }
      const response = await io.fetch(
        `https://api.blockchair.com/${pluginName}/push/transaction`,
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          method: 'POST',
          body: JSON.stringify(body)
        }
      )
      const out = await response.json()
      logger.info('SUCCESS makeBroadcastBlockchair: ', out)
      if (out.context && out.context.error) {
        logger.info('makeBroadcastBlockchair fail with out: ', out)
        throw new Error(
          `https://api.blockchair.com/${pluginName}/push/transaction failed with error ${out.context.error}`
        )
      }
      logger.info('makeBroadcastBlockchair executed successfully with hash: ', out.data.transaction_hash)
      return out.data.transaction_hash
    } catch (e) {
      logger.info('ERROR makeBroadcastBlockchair: ', e)
      throw e
    }
  }
}

const broadcastFactories = [
  makeBroadcastBlockchainInfo,
  makeBroadcastInsight,
  makeBroadcastBlockchair
]

export { broadcastFactories }
