// Replacing native crypto modules for ReactNative
import { Electrum } from './electrum'
import { ABCTransaction } from './abcTransaction'
import { txLibInfo } from './currencyInfoBTC'
import cs from 'coinstring'
import { bns } from 'biggystring'

// including Bcoin Engine
const bcoin = process.env.ENV === 'NODEJS' ? require('bcoin') : require('../vendor/bcoin.js')
const Buffer = process.env.ENV === 'NODEJS' ? require('buffer').Buffer : require('buffer/').Buffer

const GAP_LIMIT = 25
const FEE_UPDATE_INTERVAL = 10000
const DATA_STORE_FOLDER = 'txEngineFolderBTC'
const DATA_STORE_FILE = 'walletLocalDataV4.json'
const HEADER_STORE_FILE = 'headersV1.json'

const PRIMARY_CURRENCY = txLibInfo.getInfo.currencyCode
const DEFUALT_ELECTRUM_SERVERS = txLibInfo.getInfo.defaultsSettings.electrumServers
const DEFUALT_FEE_SERVER = txLibInfo.getInfo.defaultsSettings.feeInfoServer
const SIMPLE_FEE_SETTINGS = txLibInfo.getInfo.defaultsSettings.simpleFeeSettings

export class BitcoinEngine {
  constructor (io, keyInfo, opts = {}) {
    this.io = io
    this.keyInfo = keyInfo
    this.abcTxLibCallbacks = opts.callbacks
    this.walletLocalFolder = opts.walletLocalFolder
    this.electrumServers = (opts.optionalSettings && opts.optionalSettings.electrumServers) || DEFUALT_ELECTRUM_SERVERS
    this.feeInfoServer = (opts.optionalSettings && opts.optionalSettings.feeInfoServer) || DEFUALT_FEE_SERVER
    this.headerList = {}
    this.cachedLocalData = ''
    this.cachedLocalHeaderData = ''
    this.transactionHistory = {}
    this.txUpdateTotalEntries = 0
    this.txUpdateFinished = false
    this.txUpdateBalanceUpdateStarted = false
    this.txBalanceUpdateTotal = 0
    this.feeUpdater = null
    this.walletLocalData = {
      masterBalance: '0',
      blockHeight: 0,
      addresses: [],
      detailedFeeTable: {},
      simpleFeeTable: {},
      txIndex: {}
    }
    this.electrumCallbacks = {
      onAddressStatusChanged: this.processAddress.bind(this),
      onBlockHeightChanged: this.onBlockHeightChanged.bind(this)
    }
  }

  updateFeeTable () {
    this.io.fetch(this.feeInfoServer)
    .then(res => res.json())
    .then(fees => (this.walletLocalData.detailedFeeTable = { updated: Date.now(), fees }))
    .catch(err => console.log(err))

    if (this.electrum && this.electrum.connected) {
      for (let setting in SIMPLE_FEE_SETTINGS) {
        this.electrum.getEstimateFee(SIMPLE_FEE_SETTINGS[setting])
        .then(fee => fee !== -1 && (this.walletLocalData.simpleFeeTable[setting] = { updated: Date.now(), fee }))
        .catch(err => console.log(err))
      }
    }
  }

  onBlockHeightChanged (blockHeight) {
    if (this.walletLocalData.blockHeight < blockHeight) {
      this.walletLocalData.blockHeight = blockHeight
      this.abcTxLibCallbacks.onBlockHeightChanged(blockHeight)
      this.cacheLocalData()
    }
  }

  isTokenEnabled (token) {
    return this.walletLocalData.enabledTokens.indexOf(token) !== -1
  }

  updateTick () {
    // console.log("TICK UPDATE", this.txUpdateTotalEntries)
    var totalAddresses = this.txUpdateTotalEntries
    var executedAddresses = 0

    var totalTransactions = 0
    var executedTransactions = 0

    for (var i in this.walletLocalData.txIndex) {
      if (!this.walletLocalData.txIndex[i].executed) continue
      executedAddresses++
      for (var j in this.walletLocalData.txIndex[i].txs) {
        if (!this.walletLocalData.txIndex[i].txs[j]) continue
        totalTransactions++
        if (this.walletLocalData.txIndex[i].txs[j].executed) {
          executedTransactions++
        }
      }
    }

    var addressProgress = executedAddresses / totalAddresses
    var transactionProgress = (totalTransactions > 0) ? executedTransactions / totalTransactions : 0

    if (addressProgress === 1 && totalTransactions === 0) {
      transactionProgress = 1
    }

    // var progress = [addressProgress, transactionProgress]

    // console.log("Total TX List:", Object.keys(this.walletLocalData.txIndex), "totalAddresses:", totalAddresses, "executedAddresses:", executedAddresses, totalTransactions, executedTransactions, transactionProgress)

    var totalProgress = addressProgress * transactionProgress

    if (totalProgress === 1 && !this.txUpdateBalanceUpdateStarted) {
      this.txUpdateBalanceUpdateStarted = 1
        // console.log("PROCESSING ELECTRUM")
      this.processElectrumData()
    }

    return totalProgress
  }

  async startEngine () {
    this.electrum = new Electrum(this.electrumServers, this.electrumCallbacks, this.io)
    this.electrum.connect()
    let walletdb = new bcoin.wallet.WalletDB({ db: 'memory' })
    await walletdb.open()

    if (!this.keyInfo.keys) throw new Error('Missing Master Key')
    if (!this.keyInfo.keys.bitcoinKey) throw new Error('Missing Master Key')

    let bitcoinKeyBuffer = Buffer.from(this.keyInfo.keys.bitcoinKey, 'base64')

    let key = bcoin.hd.PrivateKey.fromSeed(bitcoinKeyBuffer)
    let wallet = await walletdb.create({
      'master': key.xprivkey(),
      'id': 'ID1'
    })

    this.wallet = wallet
    await this.getLocalData()

    this.wallet.on('balance', balance => {
      if (this.txUpdateFinished) {
        this.walletLocalData.masterBalance = bns.add(balance.confirmed.toString(), balance.unconfirmed.toString())
        this.abcTxLibCallbacks.onBalanceChanged('BTC', this.walletLocalData.masterBalance)
        this.cacheLocalData()
      }
    })
    let accountPath = await this.wallet.getAccountPaths(0)

    let checkList = accountPath.map(path => path.toAddress().toString())
    for (let l in checkList) {
      if (this.walletLocalData.addresses.indexOf(checkList[l]) === -1) {
        this.walletLocalData.addresses = checkList
        break
      }
    }
    this.txUpdateTotalEntries = this.walletLocalData.addresses.length
    this.walletLocalData.addresses.forEach(address => this.processAddress(address))
    this.electrum.subscribeToBlockHeight().then(blockHeight => this.onBlockHeightChanged(blockHeight))
  }

  async getLocalData () {
    try {
      let localWallet = await this.walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(DATA_STORE_FILE)
      .getText(DATA_STORE_FOLDER, 'walletLocalData')
      this.cachedLocalData = localWallet
      let data = JSON.parse(localWallet)
      Object.assign(this.walletLocalData, data)
      console.log(this.walletLocalData)
      this.electrum.updateCache(data.txIndex)
      if (typeof data.headerList !== 'undefined') this.headerList = data.headerList
      this.abcTxLibCallbacks.onBalanceChanged('BTC', this.walletLocalData.masterBalance)
    } catch (e) {
      await this.cacheLocalData()
    }
    try {
      let localHeaders = await this.walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(HEADER_STORE_FILE)
      .getText(DATA_STORE_FOLDER, 'walletLocalData')

      let data = JSON.parse(localHeaders)
      if (!data.headerList) throw new Error('Something wrong with local headers ... X722', data)
      this.cachedLocalHeaderData = JSON.stringify(data.headerList)
      this.headerList = data.headerList
    } catch (e) {
      await this.cacheHeadersLocalData()
    }
    return true
  }

  async cacheHeadersLocalData () {
    const headerList = JSON.stringify(this.headerList)
    if (this.cachedLocalHeaderData === headerList) return true
    await this.walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(HEADER_STORE_FILE)
      .setText(JSON.stringify({
        headerList: this.headerList
      }))
    this.cachedLocalHeaderData = headerList
    return true
  }

  async cacheLocalData () {
    const walletJson = JSON.stringify(this.walletLocalData)
    if (this.cachedLocalData === walletJson) return true
    await this.walletLocalFolder
      .folder(DATA_STORE_FOLDER)
      .file(DATA_STORE_FILE)
      .setText(walletJson)
    this.cachedLocalData = walletJson
    return true
  }

  updateSettings (opts) {
    if (opts.electrumServers) {
      this.electrumServers = opts.electrumServers
      this.electrum = new Electrum(this.electrumServers, this.electrumCallbacks, this.io)
      this.electrum.connect()
    }
  }

  pushAddress (address) {
    this.walletLocalData.addresses.push(address)
    this.processAddress(address)
  }

  deriveAddresses (amount) {
    for (var i = 1; i <= amount; i++) {
      // console.log("REQUESTING NEW ADDRESS")
      this.txUpdateTotalEntries++
      this.wallet.createKey(0).then(res => {
        var address = res.getAddress('base58check')
        if (this.walletLocalData.addresses.indexOf(address) > -1) {
          // console.log("EXISTING ADDRESS ")
          this.txUpdateTotalEntries--
          return
        }
        /// / console.log("PUSHING NEW ADDRESS")
        this.pushAddress(address)
      })
    }
  }

  checkGapLimit (wallet) {
    var total = this.walletLocalData.addresses.length
    var walletIndex = this.walletLocalData.addresses.indexOf(wallet) + 1
    if (walletIndex + GAP_LIMIT > total) {
      this.deriveAddresses(walletIndex + GAP_LIMIT - total)
    }
  }

  async processAddress (wallet) {
    if (typeof this.walletLocalData.txIndex[wallet] !== 'object') {
      this.walletLocalData.txIndex[wallet] = {
        txs: {},
        executed: 0,
        transactionHash: -1
      }
    } else {
      this.walletLocalData.txIndex[wallet].executed = 0
    }

    let getCallback = (tx, wallet) => {
      return transaction => {
        if (typeof this.walletLocalData.txIndex[wallet].txs[tx] === 'undefined') {
          /// / console.log("BADTX", tx, wallet, this.walletLocalData.txIndex[wallet], this.walletLocalData.txIndex[wallet].txs)
          return
        } else {
          this.walletLocalData.txIndex[wallet].txs[tx].data = transaction
          this.walletLocalData.txIndex[wallet].txs[tx].executed = 1
        }

        if (this.txUpdateFinished) {
          // console.log("ADDING TXFROMRAW ", transaction)
          this.wallet.db.addTXFromRaw(transaction)
        }
        this.checkGapLimit(wallet)
        this.updateTick()
      }
    }
    let hash = await this.electrum.subscribeToAddress(wallet)

    if (hash == null) {
      // console.log("NULL INCOMING", wallet, hash)
      this.walletLocalData.txIndex[wallet].transactionHash = hash
      this.walletLocalData.txIndex[wallet].executed = 1
      this.updateTick()
      return
    }
    if (this.walletLocalData.txIndex[wallet].transactionHash === hash) {
      // console.log("HSAH INCOMING", wallet)
      this.walletLocalData.txIndex[wallet].executed = 1
      this.updateTick()
      return
    }

    // console.log("got transactions for ", wallet, this$1.txIndex[wallet].transactionHash, hash)

    this.walletLocalData.txIndex[wallet].transactionHash = hash
    let transactions = await this.electrum.getAddresHistory(wallet)

    this.walletLocalData.txIndex[wallet].executed = 1
    for (let j in transactions) {
      if (typeof this.walletLocalData.txIndex[wallet].txs[transactions[j].tx_hash] === 'object') {
        this.walletLocalData.txIndex[wallet].txs[transactions[j].tx_hash].height = transactions[j].height
        continue
      }
      this.walletLocalData.txIndex[wallet].txs[transactions[j].tx_hash] = {
        height: transactions[j].height,
        data: '',
        executed: 0
      }
      let tx = transactions[j].tx_hash
      this.electrum.getTransaction(transactions[j].tx_hash).then(getCallback(tx, wallet))
    }
    this.updateTick()
  }

  processElectrumData () {
    /// / console.log("Start Electrum Update Process");

    let txMappedTxList = []

    let sortMappedList = list => {
      let _fl = 0
      let a = {}

      for (let _i = 0; _i <= list.length - 2; _i++) {
        for (let _j = _i + 1; _j <= list.length - 1; _j++) {
          _fl = 0
          for (let _o = 0; _o <= list[_i].prevOuts.length - 1; _o++) {
            if (list[_i].prevOuts[_o] === list[_j].hash) {
              _fl = 1
            }
          }
          if (_fl) {
            a = list[_i]
            list[_i] = list[_j]
            list[_j] = a
            _j = _i + 1
          }
        }
      }
    }

    for (let i in this.walletLocalData.txIndex) {
      for (let l in this.walletLocalData.txIndex[i].txs) {
        let data = this.walletLocalData.txIndex[i].txs[l].data
        let hash = l
        let prevOuts = []
        let txd = Buffer.from(data, 'hex')
        let tx = bcoin.tx.fromRaw(txd)
        let txjson = tx.toJSON()

        for (let k = 0; k <= txjson.inputs.length - 1; k++) {
          prevOuts.push(txjson.inputs[k].prevout.hash)
        }

        txMappedTxList.push({
          prevOuts: prevOuts,
          data: data,
          hash: hash
        })
      }
    }

    sortMappedList(txMappedTxList)

    this.txBalanceUpdateTotal = txMappedTxList.length

    let promiseList = txMappedTxList.map(({data}) => this.wallet.db.addTXFromRaw(data))

    Promise.all(promiseList)
    .then(() => {
      this.abcTxLibCallbacks.onAddressesChecked(1)
      return this.wallet.getBalance(0)
    })
    .then(result => {
      this.walletLocalData.masterBalance = bns.add(result.confirmed.toString(), result.unconfirmed.toString())
      this.abcTxLibCallbacks.onBalanceChanged('BTC', this.walletLocalData.masterBalance)
      this.refreshTransactionHistory()

      this.txUpdateFinished = true
      this.cacheLocalData()
    })
  }

  getNewHeadersList () {
    let result = []
    for (let i in this.walletLocalData.txIndex) {
      for (let j in this.walletLocalData.txIndex[i].txs) {
        let h = this.walletLocalData.txIndex[i].txs[j].height
        if (h < 0) continue
        if (!this.headerList[h] && result.indexOf(h) === -1) {
          result.push(h)
        }
      }
    }
    // console.log('OLD/NEW LIST HEADERS', this.headerList, result)
    return result
  }

  async pullBlockHeaders () {
    let newHeadersList = this.getNewHeadersList()
    let prom = []

    let getCallback = (i) => {
      return block => {
        // console.log('Setting block', i, block.timestamp)
        this.headerList[i] = block
      }
    }

    for (let i in newHeadersList) {
      prom.push(this.electrum.getBlockHeader(newHeadersList[i]).then(getCallback(newHeadersList[i])))
    }

    await Promise.all(prom)

    if (newHeadersList.length > 1) {
      this.cacheHeadersLocalData()
    }
  }

  async refreshTransactionHistory () {
    await this.pullBlockHeaders()
    let res = await this.wallet.getHistory()
    let transactionList = []
    for (let i in res) {
      let tx = res[i].tx
      let inputs = tx.inputs
      let address
      let hash = tx.txid()
      if (this.transactionHistory[hash]) {
        continue
      }
      /// / console.log("inputs ==> ", inputs)
      let outgoingTransaction = false
      let totalAmount = 0
      let ts = Math.floor(Date.now() / 1000)
      for (let j in inputs) {
        address = inputs[j].getAddress().toBase58()
        let addressIndex = this.walletLocalData.addresses.indexOf(address)
        if (addressIndex > -1) {
          if (typeof this.headerList[this.walletLocalData.txIndex[this.walletLocalData.addresses[addressIndex]].txs[hash].height] !== 'undefined') {
            ts = this.headerList[this.walletLocalData.txIndex[this.walletLocalData.addresses[addressIndex]].txs[hash].height].timestamp
            console.log('Getting timestamp from list, input', ts)
          }
          outgoingTransaction = true
        }
        /// / console.log("I>>",address )
      }
      let outputs = tx.outputs
        /// / console.log("OUTPUTS ==> ", outputs)
      for (let j in outputs) {
        address = outputs[j].getAddress().toBase58()
        let addressIndex = this.walletLocalData.addresses.indexOf(address)
        if (addressIndex > -1 && typeof this.headerList[this.walletLocalData.txIndex[this.walletLocalData.addresses[addressIndex]].txs[hash].height] !== 'undefined') {
          ts = this.headerList[this.walletLocalData.txIndex[this.walletLocalData.addresses[addressIndex]].txs[hash].height].timestamp
          console.log('Getting timestamp from list, output', ts)
        }
        if ((addressIndex === -1 && outgoingTransaction) || (!outgoingTransaction && addressIndex > -1)) {
          totalAmount += outputs[j].value
        }
        /// / console.log("O>",address, "V>",outputs[j].value )
      }
      let d = ts
      totalAmount = (outgoingTransaction) ? -totalAmount : totalAmount
      let t = new ABCTransaction(hash, d, 'BTC', 1, totalAmount, 10000, 'signedTx', {})
      this.transactionHistory[hash] = t
      transactionList.push(t)
    }
    if (this.abcTxLibCallbacks.onTransactionsChanged) {
      this.abcTxLibCallbacks.onTransactionsChanged(transactionList)
    }
  }

  async killEngine () {
    this.electrum = null
    await this.cacheHeadersLocalData()
    await this.cacheLocalData()
    return true
  }

  // synchronous
  getBlockHeight () {
    return this.walletLocalData.blockHeight
  }

  // asynchronous
  enableTokens (tokens) {
    var this$1 = this
    if (tokens === void 0) tokens = []

    for (var n in tokens) {
      var token = tokens[n]
      if (this$1.walletLocalData.enabledTokens.indexOf(token) !== -1) {
        this$1.walletLocalData.enabledTokens.push(token)
      }
    }
    // return Promise.resolve(dataStore.enableTokens(tokens))
  }

  // synchronous
  getBalance (options) {
    return this.walletLocalData.masterBalance
  }

  // synchronous
  getNumTransactions ({currencyCode = PRIMARY_CURRENCY} = {currencyCode: PRIMARY_CURRENCY}) {
    return this.walletLocalData.transactionsObj[currencyCode].length
  }

  // asynchronous
  async getTransactions (options) {
    if (options === void 0) options = {}
    // console.log(this$1.walletLocalData)
    var currencyCode = PRIMARY_CURRENCY
    if (options != null && options.currencyCode != null) {
      currencyCode = options.currencyCode
    }

    var startIndex = 0
    var numEntries = 0
    if (!options === null) {
      return this.walletLocalData.transactionsObj[currencyCode].slice(0)
    }
    if (options.startIndex != null && options.startIndex > 0) {
      startIndex = options.startIndex
      if (
        startIndex >=
        this.walletLocalData.transactionsObj[currencyCode].length
      ) {
        startIndex =
          this.walletLocalData.transactionsObj[currencyCode].length - 1
      }
    }
    if (options.numEntries != null && options.numEntries > 0) {
      numEntries = options.numEntries
      if (
        numEntries + startIndex >
        this.walletLocalData.transactionsObj[currencyCode].length
      ) {
        // Don't read past the end of the transactionsObj
        numEntries =
          this.walletLocalData.transactionsObj[currencyCode].length -
          startIndex
      }
    }

    // Copy the appropriate entries from the arrayTransactions
    var returnArray = []
    if (numEntries) {
      returnArray = this.walletLocalData.transactionsObj[currencyCode].slice(
        startIndex,
        numEntries + startIndex
      )
    } else {
      returnArray = this.walletLocalData.transactionsObj[currencyCode].slice(
        startIndex
      )
    }
    return returnArray
  }

  getFreshAddress (options = {}) {
    for (let i = 0; i < this.walletLocalData.addresses.length; i++) {
      let address = this.walletLocalData.addresses[i]
      if (!Object.keys(this.walletLocalData.txIndex[address].txs).length) return address
    }
    return false
  }

  // synchronous
  isAddressUsed (address, options = {}) {
    let validator = cs.createValidator(0x00)
    if (!validator(address)) throw new Error('Wrong formatted address')
    if (this.walletLocalData.addresses.indexOf(address) === -1) throw new Error('Address not found in wallet')
    if (!this.walletLocalData.txIndex[address]) return true
    return Object.keys(this.walletLocalData.txIndex[address].txs).length !== 0
  }

  // synchronous
  async makeSpend (abcSpendInfo) {
    /// / console.log();
    // return;
    // 1BynMxKHRyASZDNhX4q6pRtdzAb2m8d7jM

    // 1DDeAGCAikvNemUHqCLJGsavAqQYfv5AbX

    // return;
    // returns an ABCTransaction data structure, and checks for valid info
    let fee = parseInt(this.masterFee * 100000000) * 0.3

    let outputs = []

    outputs.push({
      currencyCode: 'BTC',
      address: abcSpendInfo.spendTargets[0].publicAddress,
      amount: parseInt(abcSpendInfo.spendTargets[0].amountSatoshi)
    })

    const abcTransaction = new ABCTransaction('', // txid
      0, // date
      'BTC', // currencyCode
      '0', // blockHeightNative
      abcSpendInfo.spendTargets[0].amountSatoshi, // nativeAmount
      fee.toString(), // nativeNetworkFee
      '0', // signedTx
      {
        outputs: outputs
      } // otherParams
    )

    return abcTransaction
  }

  // asynchronous
  async signTx (abcTransaction) {
    let fee = parseInt(this.masterFee * 100000000)
    let options = {
      outputs: [{
        address: abcTransaction.otherParams.outputs[0].address,
        value: parseInt(abcTransaction.otherParams.outputs[0].amount)
      }],
      rate: fee
    }
    let tx = await this.wallet.send(options)
    let rawTX = tx.toRaw().toString('hex')
    abcTransaction.date = Date.now() / 1000
    abcTransaction.signedTx = rawTX
    return abcTransaction
  }

  // asynchronous
  async broadcastTx (abcTransaction) {
    if (!abcTransaction.signedTx) throw new Error('Tx is not signed')
    let serverResponse = await this.electrum.broadcastTransaction(abcTransaction.signedTx)
    if (!serverResponse) throw new Error('Electrum server internal error processing request')
    if (serverResponse === 'TX decode failed') throw new Error('Tx is not valid')
    return serverResponse
  }

  // asynchronous
  saveTx (abcTransaction) {
    var prom = new Promise(function (resolve, reject) {
      resolve(abcTransaction)
    })

    return prom
  }
}
