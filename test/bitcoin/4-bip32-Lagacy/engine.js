/* global describe it */
const BitcoinCurrencyPluginFactory = require('../../../lib/index.test.js').BitcoinCurrencyPluginFactory
const assert = require('assert')
const disklet = require('disklet')
const Emitter = require('events').EventEmitter
const request = require('request')
const _ = require('lodash')
const cs = require('coinstring')
const jsonfile = require('jsonfile')
const path = require('path')

const DATA_STORE_FOLDER = 'txEngineFolderBTC'
const DATA_STORE_FILE = 'walletLocalDataV4.json'
const TRANSACTION_STORE_FILE = 'transactionsV1.json'
const TRANSACTION_ID_STORE_FILE = 'transactionsIdsV1.json'
const dummyWalletData = path.join(__dirname, './dummyWalletData.json')
const dummyTransactions = path.join(__dirname, './dummyTransactions.json')
const dummyTransactionsIds = path.join(__dirname, './dummyTransactionsIds.json')

let plugin, keys, engine
var emitter = new Emitter()
let walletLocalFolder = disklet.makeMemoryFolder()
const WALLET_TYPE = 'wallet:testnet'

let opts = {
  io: {
    fetch: require('node-fetch'),
    random: (size) => Array(size).fill(0).map((x, i) => i),
    net: require('net')
  }
}

let callbacks = {
  onAddressesChecked (progressRatio) {
    // console.log('onAddressesCheck', progressRatio)
    emitter.emit('onAddressesCheck', progressRatio)
  },
  onBalanceChanged (currencyCode, balance) {
    // console.log('onBalanceChange:', currencyCode, balance)
    emitter.emit('onBalanceChange', currencyCode, balance)
  },
  onBlockHeightChanged (height) {
    // console.log('onBlockHeightChange:', height)
    emitter.emit('onBlockHeightChange', height)
  },
  onTransactionsChanged (transactionList) {
    // console.log('onTransactionsChanged:', transactionList)
    emitter.emit('onTransactionsChanged', transactionList)
  }
}

describe(`Start Engine for Wallet type ${WALLET_TYPE}`, function () {
  before('Create local cache file', function (done) {
    let walletData = jsonfile.readFileSync(dummyWalletData)
    let transactions = jsonfile.readFileSync(dummyTransactions)
    let transactionsIds = jsonfile.readFileSync(dummyTransactionsIds)
    walletLocalFolder
    .folder(DATA_STORE_FOLDER)
    .file(DATA_STORE_FILE)
    .setText(JSON.stringify(walletData))
    .then(() => walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(TRANSACTION_STORE_FILE)
      .setText(JSON.stringify(transactions))
    )
    .then(() => walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(TRANSACTION_ID_STORE_FILE)
      .setText(JSON.stringify(transactionsIds))
    )
    .then(() => BitcoinCurrencyPluginFactory.makePlugin(opts))
    .then((bitcoinPlugin) => {
      assert.equal(bitcoinPlugin.currencyInfo.currencyCode, 'BTC')
      plugin = bitcoinPlugin
      keys = plugin.createPrivateKey(WALLET_TYPE)
      keys = plugin.derivePublicKey({type: WALLET_TYPE, keys: {bitcoinKey: keys.bitcoinKey}})
    })
    .then(done)
  })

  it('Make Engine', function () {
    // console.log(walletLocalFolder)
    return plugin.makeEngine({type: WALLET_TYPE, keys}, {
      callbacks,
      walletLocalFolder,
      optionalSettings: {
        enableOverrideServers: true,
        electrumServers: [
          ['testnetnode.arihanc.com', '51001']
        ]
      }
    }).then(e => {
      engine = e
      assert.equal(typeof engine.startEngine, 'function', 'startEngine')
      assert.equal(typeof engine.killEngine, 'function', 'killEngine')
      // assert.equal(typeof engine.enableTokens, 'function', 'enableTokens')
      assert.equal(typeof engine.getBlockHeight, 'function', 'getBlockHeight')
      assert.equal(typeof engine.getBalance, 'function', 'getBalance')
      assert.equal(typeof engine.getNumTransactions, 'function', 'getNumTransactions')
      assert.equal(typeof engine.getTransactions, 'function', 'getTransactions')
      assert.equal(typeof engine.getFreshAddress, 'function', 'getFreshAddress')
      assert.equal(typeof engine.addGapLimitAddresses, 'function', 'addGapLimitAddresses')
      assert.equal(typeof engine.isAddressUsed, 'function', 'isAddressUsed')
      assert.equal(typeof engine.makeSpend, 'function', 'makeSpend')
      assert.equal(typeof engine.signTx, 'function', 'signTx')
      assert.equal(typeof engine.broadcastTx, 'function', 'broadcastTx')
      assert.equal(typeof engine.saveTx, 'function', 'saveTx')
      return true
    })
    .catch(e => console.log(e))
  })

  it(`Get BlockHeight for Wallet type ${WALLET_TYPE}`, function (done) {
    this.timeout(10000)
    let end = _.after(2, done)
    request.get('https://api.blocktrail.com/v1/tBTC/block/latest?api_key=MY_APIKEY', (err, res, body) => {
      assert(!err, 'getting block height from a second source')
      emitter.once('onBlockHeightChange', height => {
        const thirdPartyHeight = parseInt(JSON.parse(body).height)
        assert(height >= thirdPartyHeight, 'Block height')
        assert(engine.getBlockHeight() >= thirdPartyHeight, 'Block height')
        end() // Can be "done" since the promise resolves before the event fires but just be on the safe side
      })
      engine.startEngine().then(a => {
        assert.equal(engine.getBlockHeight(), 1180814, 'Should init as 1180814')
        end()
      })
      .catch(e => console.log(e))
    })
  })
})

describe(`Is Address Used for Wallet type ${WALLET_TYPE}`, function () {
  it('Checking an empty address', function (done) {
    assert.equal(engine.isAddressUsed('mhFxbbUCHi2pZQqmpRju6tgTm2KXoRX8F6'), false)
    done()
  })

  it('Checking a non empty address from cache 1', function (done) {
    assert.equal(engine.isAddressUsed('mfXZU3rapa1VWoNj5j2ekvt1gpNLFyT2Ub'), true)
    done()
  })

  it('Checking a non empty address from cache 2', function (done) {
    assert.equal(engine.isAddressUsed('mh6kCD1mFjrFP7Di2sgmh7V8WXRy21Cje7'), true)
    done()
  })

  it('Checking a non empty address from network', function (done) {
    setTimeout(() => {
      assert.equal(engine.isAddressUsed('mh8MyFhj9ERZ6DczpLJNb3ZQLDn9tqhrU1'), true)
      done()
    }, 1000)
  })
})

describe(`Get Fresh Address for Wallet type ${WALLET_TYPE}`, function () {
  it('Should provide a non used BTC address when no options are provided', function (done) {
    setTimeout(() => {
      let { publicAddress } = engine.getFreshAddress()
      assert(cs.createValidator(0x6F)(publicAddress), 'Should be a valid address')
      request.get(`https://api.blocktrail.com/v1/tBTC/address/${publicAddress}?api_key=MY_APIKEY`, (err, res, body) => {
        const thirdPartyBalance = parseInt(JSON.parse(body).received)
        assert(!err, 'getting address incoming txs from a second source')
        assert(thirdPartyBalance === 0, 'Should have never received coins')
        done()
      })
    }, 1000)
  })
})

// let abcSpendInfo = {
//   networkFeeOption: 'high',
//   metadata:  {
//     name: 'Transfer to College Fund',
//     category: 'Transfer:Wallet:College Fund',
//   },
//   spendTargets: [
//     {
//       destWallet,
//       nativeAmount: '210000000' // 2.1 BTC
//     },
//   ]
// }

let templateSpend = {
  networkFeeOption: 0,
  metadata: {
    name: 'Transfer to College Fund',
    category: 'Transfer:Wallet:College Fund'
  },
  spendTargets: [
    {
      currencyCode: 'BTC',
      publicAddress: 'mfgNKSNq8375GLZ7uhBJPvzpZxKtL9HUb9',
      nativeAmount: '2100000' // 0.021 BTC
    },
    {
      currencyCode: 'BTC',
      publicAddress: 'mg2ic79wfpvH7oy8tUrfVjxbZ85weJbp2Q',
      nativeAmount: '4200000' // 0.042 BTC
    },
    {
      currencyCode: 'BTC',
      publicAddress: 'mhk239abov7CnL85PU5u3hD5HXahPuCMDX',
      nativeAmount: '1100000' // 0.011 BTC
    },
    {
      currencyCode: 'BTC',
      publicAddress: 'mjmA4sTWKVFpRtsFPY53MtyGVhUKahRT9L',
      nativeAmount: '500000' // 0.005 BTC
    }
  ]
}

describe(`Make Spend and Sign for Wallet type ${WALLET_TYPE}`, function () {
  it('Should fail since no spend target is given', function () {
    let abcSpendInfo = {
      networkFeeOption: 'high',
      metadata: {
        name: 'Transfer to College Fund',
        category: 'Transfer:Wallet:College Fund'
      }
    }
    return engine.makeSpend(abcSpendInfo).catch(e => {
      assert(e, 'Should throw')
    })
  })

  it('Should build transaction with low fee', function () {
    return engine.makeSpend(Object.assign(templateSpend, { networkFeeOption: 'low' })).then(a => {
      // console.log('makeSpend', a)
      return engine.signTx(a)
    })
    .then(a => {
      // console.log('sign', a)
    })
    .catch(a => console.log('error', a))
  })

  it('Should build transaction with standard fee', function () {
    return engine.makeSpend(Object.assign(templateSpend, { networkFeeOption: 'standard' })).then(a => {
      // console.log('makeSpend', a)
      return engine.signTx(a)
    })
    .then(a => {
      // console.log('sign', a)
    })
    .catch(a => console.log('error', a))
  })

  it('Should build transaction with high fee', function () {
    return engine.makeSpend(Object.assign(templateSpend, { networkFeeOption: 'high' })).then(a => {
      // console.log('makeSpend', a)
      return engine.signTx(a)
    })
    .then(a => {
      // console.log('sign', a)
    })
    .catch(a => console.log('error', a))
  })

  it('Should build transaction with custom fee', function () {
    return engine.makeSpend(Object.assign(templateSpend, {
      networkFeeOption: 'custom',
      customNetworkFee: '1000'
    })).then(a => {
      // console.log('makeSpend', a)
      return engine.signTx(a)
    })
    .then(a => {
      // console.log('sign', a)
    })
    .catch(a => console.log('error', a))
  })
})
