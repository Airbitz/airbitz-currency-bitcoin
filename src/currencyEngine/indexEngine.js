// @flow

import { Electrum } from '../electrumWrapper/indexElectrum'
import { bns } from 'biggystring'
import { validate } from 'jsonschema'

import type {
  AbcCurrencyPluginCallbacks,
  AbcCurrencyEngine,
  AbcWalletInfo,
  AbcMakeEngineOptions,
  AbcTransaction,
  AbcSpendTarget,
  AbcFreshAddress,
  AbcSpendInfo
} from 'airbitz-core-types'

// $FlowFixMe
const BufferJS = require('bufferPlaceHolder').Buffer
const crypto = require('crypto')
const MILI_TO_SEC = 1000
const BYTES_TO_KB = 1000
const SERVER_RETRY_INTERVAL = 1000

function validateObject (object, schema) {
  const result = validate(object, schema)

  if (result.errors.length === 0) {
    return true
  } else {
    for (const n in result.errors) {
      const errMsg = result.errors[n].message
      console.log('ERROR: validateObject:' + errMsg)
    }
    return false
  }
}

type WalletLocalData = {
  masterBalance: string,
  blockHeight: number,
  addresses: {
    receive: Array<any>,
    change: Array<any>,
    nested: Array<any>
  },
  detailedFeeTable: any,
  simpleFeeTable: any
}

export default (bcoin:any, txLibInfo:any) => class CurrencyEngine implements AbcCurrencyEngine {
  connected: boolean
  walletLocalFolder: any
  walletLocalEncryptedFolder: any
  io: any
  walletType: string
  masterKeys: any
  network: string
  wallet: any
  headerList: any
  primaryCurrency: string
  abcTxLibCallbacks: AbcCurrencyPluginCallbacks
  walletLocalData: WalletLocalData
  transactions: any
  transactionsIds: Array<any>
  memoryDump: any
  gapLimit: number
  electrumServers: Array<Array<string>>
  electrum: Electrum
  feeUpdater:any
  feeUpdateInterval: number
  maxFee: number
  defaultFee: number
  defaultDenomMultiplier: number
  simpleFeeSettings: any
  feeInfoServer: string
  currencyName: string
  diskPath: {
    folder: any,
    files: any
  }
  electrumCallbacks: {
    onAddressStatusChanged (address: string, hash: string):Promise<void>,
    onBlockHeightChanged (height: number):void
  }
  constructor (io:any, keyInfo:AbcWalletInfo, opts: AbcMakeEngineOptions) {
    if (!opts.walletLocalFolder) throw new Error('Cannot create and engine without a local folder')
    this.connected = false
    this.walletLocalFolder = opts.walletLocalFolder
    this.walletLocalEncryptedFolder = opts.walletLocalEncryptedFolder
    this.io = io
    this.walletType = keyInfo.type
    this.masterKeys = keyInfo.keys
    this.currencyName = txLibInfo.getInfo.currencyName.toLowerCase()
    if (this.masterKeys) {
      this.masterKeys.currencyKey = keyInfo.keys[`${this.currencyName}Key`]
    }
    this.network = keyInfo.type.includes('testnet') ? 'testnet' : 'main'
    this.wallet = null
    this.primaryCurrency = txLibInfo.getInfo.currencyCode
    this.defaultDenomMultiplier = txLibInfo.getInfo.denominations.reduce((result, denom) =>
      denom.name === this.primaryCurrency ? parseInt(denom.multiplier) : result
    , 1)
    this.abcTxLibCallbacks = opts.callbacks

    // Loads All of this properties into "this":
    // electrumServers: List of electrum servers to connect to
    // feeInfoServer: The server to get fee from (21fee)
    // diskPath: An Object with contains the following items
    // -  dataStoreFolder: The folder to store all data to disk
    // -  dataStoreFiles: File names for different types of cache
    // simpleFeeSettings: Settings for simple fee algorithem
    // gapLimit: How many addresses we use as gap,
    // maxFee: Maximum transaction fee per byte,
    // feeUpdateInterval: Interval to update fee in miliseconds,
    Object.assign(this, txLibInfo.getInfo.defaultsSettings)
    // If user provided optional settings and wants to overide the defaults
    if (opts.optionalSettings && opts.optionalSettings.enableOverrideServers) {
      Object.assign(this, opts.optionalSettings)
    }

    // Objects to load and save from disk
    this.headerList = {}
    this.walletLocalData = {
      masterBalance: '0',
      blockHeight: 0,
      addresses: {
        receive: [],
        change: [],
        nested: []
      },
      detailedFeeTable: {
        updated: 0
      },
      simpleFeeTable: {}
    }
    this.transactions = {}
    this.transactionsIds = []
    this.memoryDump = {}
    // // // // // // // // // // // // //

    this.electrumCallbacks = {
      onAddressStatusChanged: this.onTransactionStatusHash.bind(this),
      onBlockHeightChanged: this.onBlockHeightChanged.bind(this),
      onSubscribeEnd: this.subscribeToAddress.bind(this)
    }
  }

  static async makeEngine (io:any, keyInfo: AbcWalletInfo, opts: AbcMakeEngineOptions): Promise<AbcCurrencyEngine> {
    const engine = new CurrencyEngine(io, keyInfo, opts)
    await engine.startWallet()
    return engine
  }

  async startWallet () {
    if (!this.masterKeys) throw new Error('Missing Master Key')
    if (!this.masterKeys.currencyKey) throw new Error('Missing Master Key')

    const walletDbOptions = {
      network: this.network,
      memDbRaw: null
    }

    await this.loadFromDisk(this.memoryDump, 'memoryDump')

    if (this.memoryDump.rawMemory) {
      walletDbOptions.memDbRaw = BufferJS.from(this.memoryDump.rawMemory, 'hex')
    } else {
      console.log('No memDBRaw')
    }

    const walletdb = new bcoin.wallet.WalletDB(walletDbOptions)
    await walletdb.open()

    let key = null

    // See if we have an xpriv key stored in local encrypted storage
    let keyObj = await this.loadEncryptedFromDisk()
    if (keyObj) {
      try {
        // bcoin says fromJSON but it's really from JS object
        key = bcoin.hd.PrivateKey.fromJSON(keyObj)
      } catch (e) {
        key = null
        keyObj = null
      }
    }

    // If not stored key, derive it from the mnemonic
    if (!key) {
      try {
        const mnemonic = bcoin.hd.Mnemonic.fromPhrase(this.masterKeys.currencyKey)
        key = bcoin.hd.PrivateKey.fromMnemonic(mnemonic, this.network)
      } catch (e) {
        const keyBuffer = BufferJS.from(this.masterKeys.currencyKey, 'base64')
        key = bcoin.hd.PrivateKey.fromSeed(keyBuffer, this.network)
      }
    }

    // If we didn't have a stored key, store it now
    if (!keyObj) {
      // bcoin says toJSON but it's really to JS object
      keyObj = key.toJSON()
      await this.saveEncryptedToDisk(keyObj)
    }

    if (this.memoryDump.rawMemory) {
      try {
        this.wallet = await walletdb.get('ID1')
        this.wallet.importMasterKey({master: key.xprivkey()})
      } catch (e) {}
    }
    if (!this.wallet) {
      const masterPath = this.walletType.includes('44') ? null : 'm/0/0'
      const masterIndex = !masterPath ? null : 32
      this.wallet = await walletdb.create({
        'master': key.xprivkey(),
        'id': 'ID1',
        secureMode: true,
        witness: this.walletType.includes('segwit'),
        masterPath,
        masterIndex
      })
      await this.wallet.setLookahead(0, this.gapLimit)
      await this.saveMemDumpToDisk()
    }
    await this.syncDiskData()
  }

  async syncDiskData () {
    const props = ['walletLocalData', 'transactions', 'transactionsIds', 'headerList']
    const loadFromDiskPromise = props.map(key =>
      // $FlowFixMe
      this.loadFromDisk(this[key], key).then(result => !result ? this.saveToDisk(this[key], key) : true)
    )
    await Promise.all(loadFromDiskPromise)
    this.electrum = new Electrum(this.electrumServers, this.electrumCallbacks, this.io, this.walletLocalData.blockHeight)
    if (!this.memoryDump) {
      const addTXPromises = []
      for (const address in this.transactions) {
        if (this.transactions[address]) {
          for (const tx in this.transactions[address].txs) {
            const { abcTransaction, rawTransaction } = this.transactions[address].txs[tx]
            if (rawTransaction && abcTransaction) {
              const bcoinTX = bcoin.primitives.TX.fromRaw(BufferJS.from(rawTransaction, 'hex'))
              addTXPromises.push(this.wallet.add(bcoinTX))
            }
          }
        }
      }
      await Promise.all(addTXPromises)
    }
    await this.syncAddresses()
  }

  async syncAddresses () {
    const account = await this.wallet.getAccount(0)
    const receiveDepth = account.receiveDepth - 1 + this.gapLimit
    const changeDepth = account.changeDepth - 1 + this.gapLimit
    const nestedDepth = account.nestedDepth - 1 + this.gapLimit
    const addresses = this.walletLocalData.addresses
    if (receiveDepth > addresses.receive.length ||
      (this.walletType.includes('44') && changeDepth > addresses.change.length)) {
      const accountPaths = await this.wallet.getPaths(0)
      const newAddresses = {
        receive: [],
        change: [],
        nested: []
      }
      for (let i in accountPaths) {
        switch (accountPaths[i].branch) {
          case 0:
            if (receiveDepth > addresses.receive.length) {
              newAddresses.receive.push(accountPaths[i].toAddress(this.network).toString())
            }
            break
          case 1:
            if (this.walletType.includes('44') && changeDepth > addresses.change.length) {
              newAddresses.change.push(accountPaths[i].toAddress(this.network).toString())
            }
            break
          case 2:
            if (this.walletType.includes('segwit') && nestedDepth > addresses.nested.length) {
              newAddresses.nested.push(accountPaths[i].toAddress(this.network).toString())
            }
            break
        }
      }
      if (newAddresses.receive.length > addresses.receive.length) {
        addresses.receive = newAddresses.receive
      }
      if (this.walletType.includes('44')) {
        if (newAddresses.change.length > addresses.change.length) {
          addresses.change = newAddresses.change
        }
      }
      if (this.walletType.includes('segwit')) {
        if (newAddresses.nested.length > addresses.nested.length) {
          addresses.nested = newAddresses.nested
        }
      }
    }
    if (!this.memoryDump.rawMemory) {
      await this.saveMemDumpToDisk()
    }
  }
  /* --------------------------------------------------------------------- */
  /* ---------------------------  Public API  ---------------------------- */
  /* --------------------------------------------------------------------- */
  updateSettings (opts:any) {
    if (opts.electrumServers) {
      this.electrumServers = opts.electrumServers
      this.electrum = new Electrum(this.electrumServers, this.electrumCallbacks, this.io, this.walletLocalData.blockHeight)
      this.electrum.connect()
    }
  }

  async startEngine () {
    this.wallet.on('balance', balance => {
      const confirmedBalance = balance.confirmed.toString()
      const unconfirmedBalance = balance.unconfirmed.toString()
      this.walletLocalData.masterBalance = bns.add(confirmedBalance, unconfirmedBalance)
      this.abcTxLibCallbacks.onBalanceChanged(this.primaryCurrency, this.walletLocalData.masterBalance)
      this.saveToDisk(this.walletLocalData, 'walletLocalData')
    })
    const transactions = await this.getTransactions()
    if (transactions && transactions.length) this.abcTxLibCallbacks.onTransactionsChanged(transactions)
    if (this.walletLocalData.masterBalance !== '0') {
      this.abcTxLibCallbacks.onBalanceChanged(this.primaryCurrency, this.walletLocalData.masterBalance)
    }
    this.electrum.connect()
    this.connected = true
    this.getAllOurAddresses().forEach(address => {
      this.subscribeToAddress(address).then(() => {
        this.initialSyncCheck()
      })
    })

    if (!Object.keys(this.walletLocalData.detailedFeeTable).length) {
      await this.updateFeeTable()
    } else {
      this.updateFeeTable()
    }
    this.feeUpdater = setInterval(() => this.updateFeeTable(), this.feeUpdateInterval)
  }

  async killEngine () {
    this.electrum.stop()
    this.connected = false
    clearInterval(this.feeUpdater)
    await this.saveMemDumpToDisk()
    await this.saveToDisk(this.headerList, 'headerList')
    await this.saveToDisk(this.walletLocalData, 'walletLocalData')
    await this.saveToDisk(this.transactions, 'transactions')
    await this.saveToDisk(this.transactionsIds, 'transactionsIds')
  }

  getBlockHeight ():number {
    return this.walletLocalData.blockHeight
  }

  getBalance (options:any):string {
    return this.walletLocalData.masterBalance
  }

  getNumTransactions (options:any):number {
    return this.objectToArray(this.transactions).reduce((s, addressTxs) => {
      return s + Object.keys(addressTxs).length
    }, 0)
  }

  async enableTokens (tokens: Array<string>) {
    if (tokens.length > 0) {
      throw new Error('TokenUnsupported')
    }
  }

  getTokenStatus (token:string): boolean {
    return false
  }

  async getTransactions (options:any): Promise<Array<AbcTransaction>> {
    let abcTransactions = []
    for (const address in this.transactions) {
      if (this.transactions[address]) {
        for (const tx in this.transactions[address].txs) {
          const abcTransaction = this.transactions[address].txs[tx].abcTransaction
          abcTransaction && abcTransactions.push(abcTransaction)
        }
      }
    }
    const startIndex = (options && options.startIndex) || 0
    let endIndex = (options && options.numEntries) || abcTransactions.length
    if (startIndex + endIndex > abcTransactions.length) {
      endIndex = abcTransactions.length
    }
    return abcTransactions.slice(startIndex, endIndex)
  }

  getFreshAddress (options: any): AbcFreshAddress {
    let freshAddress = { publicAddress: null }
    for (let i = 0; i < this.walletLocalData.addresses.receive.length; i++) {
      const address = this.walletLocalData.addresses.receive[i]
      if (!Object.keys(this.transactions).length || !Object.keys(this.transactions[address].txs).length) {
        freshAddress.publicAddress = address
        break
      }
    }
    if (!freshAddress.publicAddress) throw Error('ErrorNoFreshAddresses')
    if (this.walletType.includes('segwit')) {
      freshAddress.segwitAddress = freshAddress.publicAddress
      freshAddress.publicAddress = null
      for (let i = 0; i < this.walletLocalData.addresses.nested.length; i++) {
        const address = this.walletLocalData.addresses.nested[i]
        if (!Object.keys(this.transactions).length || !Object.keys(this.transactions[address].txs).length) {
          freshAddress.publicAddress = address
          break
        }
      }
      if (!freshAddress.publicAddress) throw Error('ErrorNoFreshAddresses')
    }
    return freshAddress
  }

  addGapLimitAddresses (addresses:Array<string>) {
    addresses.forEach(async address => {
      const path = await this.wallet.getPath(address)
      const account = await this.wallet.getAccount(0)
      switch (path.branch) {
        case 0:
          if (path.index + this.gapLimit > account.receiveDepth) {
            account.syncDepth(path.index + this.gapLimit)
            await this.checkGapLimitForBranch(account, 'receive', 0)
          }
          break
        case 1:
          if (this.walletType.includes('44') && path.index + this.gapLimit > account.changeDepth) {
            account.syncDepth(0, path.index + this.gapLimit)
            await this.checkGapLimitForBranch(account, 'change', 1)
          }
          break
        case 2:
          if (this.walletType.includes('segwit') && path.index + this.gapLimit > account.nestedDepth) {
            account.syncDepth(0, 0, path.index + this.gapLimit)
            await this.checkGapLimitForBranch(account, 'nested', 2)
          }
          break
      }
    })
  }

  isAddressUsed (address: string, options: any) {
    try {
      bcoin.primitives.Address.fromBase58(address)
    } catch (e) {
      try {
        bcoin.primitives.Address.fromBech32(address)
      } catch (e) {
        throw new Error('Wrong formatted address')
      }
    }
    if (this.getAllOurAddresses().indexOf(address) === -1) {
      throw new Error('Address not found in wallet')
    }
    if (!this.transactions[address]) {
      return false
    }
    return Object.keys(this.transactions[address].txs).length !== 0
  }

  async makeSpend (abcSpendInfo: AbcSpendInfo) {
    const valid = validateObject(abcSpendInfo, {
      'type': 'object',
      'properties': {
        'currencyCode': { 'type': 'string' },
        'networkFeeOption': { 'type': 'string' },
        'spendTargets': {
          'type': 'array',
          'items': {
            'type': 'object',
            'properties': {
              'currencyCode': { 'type': 'string' },
              'publicAddress': { 'type': 'string' },
              'nativeAmount': { 'type': 'string' },
              'destMetadata': { 'type': 'object' },
              'destWallet': { 'type': 'object' }
            },
            'required': [
              'publicAddress'
            ]
          }
        }
      },
      'required': [ 'spendTargets' ]
    })

    if (!valid) {
      throw (new Error('Error: invalid AbcSpendInfo'))
    }

    // Ethereum can only have one output
    if (abcSpendInfo.spendTargets.length < 1) {
      throw (new Error('Need to provide Spend Targets'))
    }

    const feeOption = abcSpendInfo.networkFeeOption || 'standard'
    let rate, resultedTransaction

    if (feeOption === 'custom') {
      // customNetworkFee is in sat/Bytes in need to be converted to sat/KB
      rate = parseInt(abcSpendInfo.customNetworkFee) * BYTES_TO_KB
    } else {
      // defualt fees are in sat/KB
      rate = this.getRate(feeOption)
    }

    const outputs = abcSpendInfo.spendTargets.map(spendTarget => {
      return new bcoin.primitives.Output({
        value: parseInt(spendTarget.nativeAmount),
        script: bcoin.script.fromAddress(spendTarget.publicAddress)
      })
    })

    // Rate is in sat/KB
    const txOptions = { outputs, rate, maxFee: this.maxFee }
    try {
      resultedTransaction = await this.wallet.createTX(txOptions)
    } catch (e) {
      if (e.type === 'FundingError') throw new Error('InsufficientFundsError')
      throw e
    }
    const allOurAddresses = this.getAllOurAddresses()
    const sumOfTx = abcSpendInfo.spendTargets.reduce((s, spendTarget: AbcSpendTarget) => {
      if (spendTarget.publicAddress &&
        allOurAddresses.indexOf(spendTarget.publicAddress) !== -1) {
        return s
      } else return s - parseInt(spendTarget.nativeAmount)
    }, 0)

    let ourReceiveAddresses = []
    for (const i in resultedTransaction.outputs) {
      const address = resultedTransaction.outputs[i].getAddress().toString(this.network)
      if (address && allOurAddresses.indexOf(address) !== -1) {
        ourReceiveAddresses.push(address)
      }
    }

    const abcTransaction: AbcTransaction = {
      ourReceiveAddresses,
      otherParams: {
        bcoinTx: resultedTransaction,
        abcSpendInfo,
        rate
      },
      currencyCode: this.primaryCurrency,
      txid: '',
      date: 0,
      blockHeight: 0,
      nativeAmount: (sumOfTx - parseInt(resultedTransaction.getFee())).toString(),
      networkFee: resultedTransaction.getFee().toString(),
      signedTx: ''
    }
    return abcTransaction
  }

  async signTx (abcTransaction:AbcTransaction):Promise<AbcTransaction> {
    await this.wallet.sign(abcTransaction.otherParams.bcoinTx)
    abcTransaction.date = Date.now() / MILI_TO_SEC
    abcTransaction.signedTx = abcTransaction.otherParams.bcoinTx.toRaw().toString('hex')
    return abcTransaction
  }

  async broadcastTx (abcTransaction:AbcTransaction):Promise<AbcTransaction> {
    if (!abcTransaction.signedTx) throw new Error('Tx is not signed')
    if (!this.electrum) throw new Error('Uninitialized electrum servers')
    try {
      const broadcastResponse = await this.electrum.broadcastTransaction(abcTransaction.signedTx)
      const resultedTxid = broadcastResponse.result
      if (resultedTxid === 'TX decode failed') throw new Error('Tx is not valid')
      const txJson = abcTransaction.otherParams.bcoinTx.getJSON(this.network)
      const rawTransaction = abcTransaction.signedTx
      abcTransaction.txid = resultedTxid
      abcTransaction.otherParams = {}
      abcTransaction.ourReceiveAddresses.forEach(address => {
        this.transactions[address].txs[abcTransaction.txid] = { abcTransaction, txJson, rawTransaction }
      })
      return abcTransaction
    } catch (e) {
      console.log(e)
      if (e.message && e.message.includes('66: ')) {
        const feeInSatBytes = parseInt(abcTransaction.otherParams.rate) / BYTES_TO_KB
        abcTransaction.otherParams.abcSpendInfo.customNetworkFee = feeInSatBytes * 1.5
        abcTransaction.otherParams.abcSpendInfo.networkFeeOption = 'custom'
        const newAbcTransaction = await this.makeSpend(abcTransaction.otherParams.abcSpendInfo)
        const newSignedAbcTransaction = await this.signTx(newAbcTransaction)
        const broadcastTx = await this.broadcastTx(newSignedAbcTransaction)
        return broadcastTx
      }
      throw new Error('Electrum server internal error processing request:' + e.message)
    }
  }

  async saveTx (abcTransaction:AbcTransaction):Promise<void> {
    const bcoinTX = bcoin.primitives.TX.fromRaw(BufferJS.from(abcTransaction.signedTx, 'hex'))
    await this.wallet.add(bcoinTX)
  }
  /* --------------------------------------------------------------------- */
  /* --------------------  Experimantal Public API  ---------------------- */
  /* --------------------------------------------------------------------- */
  async getTransactionsByIds (transactionsIds:Array<string>): Promise<Array<AbcTransaction>> {
    const allTransactions = await this.getTransactions()
    return allTransactions.filter(({ txid }) => transactionsIds.indexOf(txid) !== -1)
  }

  async getTransactionsIds (): Promise<Array<string>> {
    return this.transactionsIds
  }
  /* --------------------------------------------------------------------- */
  /* ---------------------------  Private API  --------------------------- */
  /* --------------------------------------------------------------------- */
  getAllOurAddresses (): Array<string> {
    let allOurAddresses = []
    for (const typed in this.walletLocalData.addresses) {
      allOurAddresses = allOurAddresses.concat(this.walletLocalData.addresses[typed])
    }
    return allOurAddresses
  }

  objectToArray (obj:any): Array<any> {
    return Object.keys(obj).map(key => obj[key])
  }

  updateFeeTable () {
    if (this.feeInfoServer !== '' &&
      this.walletLocalData.detailedFeeTable.updated < Date.now() - this.feeUpdateInterval) {
      this.io.fetch(this.feeInfoServer)
      .then(res => res.json())
      .then(({ fees }) => {
        let high = fees[fees.length - 1].minFee
        for (let i = fees.length - 1; i >= 0; i--) {
          if (fees[i].maxDelay !== 0) break
          high = fees[i].minFee
        }
        // Results are in sat/bytes and should be converted to sat/KB
        high *= BYTES_TO_KB
        let low = fees[0].minFee
        const highestMaxDelay = fees[0].maxDelay
        for (let i = 1; i < fees.length; i++) {
          low = fees[i].minFee
          if (fees[i].maxDelay < highestMaxDelay) break
        }
        // Results are in sat/bytes and should be converted to sat/KB
        low *= BYTES_TO_KB
        const standard = (low + high) / 2
        this.walletLocalData.detailedFeeTable = { updated: Date.now(), low, standard, high }
      })
      .catch(err => console.log(err))
    }

    for (const setting in this.simpleFeeSettings) {
      if (!this.walletLocalData.simpleFeeTable[setting]) {
        this.walletLocalData.simpleFeeTable[setting] = { updated: 0, fee: this.defaultFee }
      }
      if (this.walletLocalData.simpleFeeTable[setting].updated < Date.now() - this.feeUpdateInterval) {
        this.electrum.getEstimateFee(this.simpleFeeSettings[setting])
        .then(feeServerResponse => {
          const fee = feeServerResponse.result
          if (fee !== -1) {
            this.walletLocalData.simpleFeeTable[setting].updated = Date.now()
            // Results are in sat/KB
            this.walletLocalData.simpleFeeTable[setting].fee = Math.floor(fee * this.defaultDenomMultiplier)
          }
        })
        .catch(err => console.log(err))
      }
    }
  }

  getRate (feeOption: string) {
    if (this.walletLocalData.detailedFeeTable[feeOption]) return this.walletLocalData.detailedFeeTable[feeOption]
    if (this.walletLocalData.simpleFeeTable[feeOption]) return this.walletLocalData.simpleFeeTable[feeOption].fee
  }

  onBlockHeightChanged (data: any) {
    const blockHeight = data.params[0].block_height
    if (this.walletLocalData.blockHeight < blockHeight) {
      this.walletLocalData.blockHeight = blockHeight
      this.abcTxLibCallbacks.onBlockHeightChanged(blockHeight)
      this.saveToDisk(this.walletLocalData, 'walletLocalData')
    }
  }

  addressToScriptHash (address: string) {
    const script = bcoin.script.fromAddress(address)
    const scriptRaw = script.toRaw()
    const scriptHash = crypto.createHash('sha256').update(scriptRaw).digest().toString('hex')
    // $FlowFixMe
    const reversedScriptHash = scriptHash.match(/../g).reverse().join('')
    return reversedScriptHash
  }

  scriptHashToAddress (scriptHash: string) {
    for (const address in this.transactions) {
      if (this.transactions[address].scriptHash === scriptHash) {
        return address
      }
    }
    return ''
  }

  async subscribeToAddress (address: string) {
    const addressFromScriptHash = this.scriptHashToAddress(address)
    address = addressFromScriptHash !== '' ? addressFromScriptHash : address
    let scriptHash
    if (!this.transactions[address]) {
      scriptHash = this.addressToScriptHash(address)
      this.transactions[address] = { txs: {}, addressStatusHash: null, scriptHash }
    } else {
      scriptHash = this.transactions[address].scriptHash
    }
    this.transactions[address].executed = 0
    let addressSubscriptionResponse = null
    try {
      if (this.walletType.includes('segwit')) {
        addressSubscriptionResponse = await this.electrum.subscribeToScriptHash(scriptHash)
      } else {
        addressSubscriptionResponse = await this.electrum.subscribeToAddress(address)
      }
      if (addressSubscriptionResponse &&
        addressSubscriptionResponse.result &&
        addressSubscriptionResponse.result !== this.transactions[address].addressStatusHash) {
        if (this.walletType.includes('segwit')) {
          addressSubscriptionResponse.params = [scriptHash, addressSubscriptionResponse.result]
          await this.onTransactionStatusHash(addressSubscriptionResponse)
        } else {
          addressSubscriptionResponse.params = [address, addressSubscriptionResponse.result]
          await this.onTransactionStatusHash(addressSubscriptionResponse)
        }
      }
      this.transactions[address].executed = 1
    } catch (e) {
      this.connected && setTimeout(() => {
        this.subscribeToAddress(address)
      }, SERVER_RETRY_INTERVAL)
    }
  }

  async onTransactionStatusHash (data: any) {
    const [scriptHash, hash] = data.params
    try {
      const address = this.walletType.includes('segwit') ? this.scriptHashToAddress(scriptHash) : scriptHash
      const localTxObject = this.transactions[address]
      localTxObject.addressStatusHash = hash
      const transactionsServerResponse = await this.electrum.getScriptHashHistory(scriptHash, data.connectionID)
      const transactionHashes = transactionsServerResponse.result
      transactionHashes.forEach(transactionObject => {
        this.handleTransaction(address, transactionObject, data.connectionID)
      })
    } catch (e) {
      this.connected && setTimeout(() => {
        data.connectionID = null
        this.onTransactionStatusHash(data)
      }, SERVER_RETRY_INTERVAL)
    }
  }

  async handleTransaction (address: string, transactionObj: any, connectionID?: string) {
    try {
      const localTxObject = this.transactions[address]
      const txHash = transactionObj.tx_hash
      if (this.transactionsIds.indexOf(txHash) === -1) this.transactionsIds.push(txHash)
      let transactionData = localTxObject.txs[txHash]
      if (transactionData && transactionData.abcTransaction) {
        if (transactionData.abcTransaction.blockHeight !== transactionObj.height) {
          transactionData.abcTransaction.blockHeight = transactionObj.height
          const blockHeader = await this.getBlockHeader(transactionObj.height, connectionID)
          await this.saveToDisk(this.transactions, 'transactions')
          transactionData.abcTransaction.date = blockHeader.timestamp
          this.abcTxLibCallbacks.onTransactionsChanged([transactionData.abcTransaction])
        }
      }
      if (!transactionData) {
        localTxObject.txs[txHash] = {
          txJson: {},
          rawTransaction: null
        }
        transactionData = localTxObject.txs[txHash]
      }
      if (!transactionData.rawTransaction) {
        const rawTXresponse = await this.electrum.getTransaction(txHash, connectionID)
        transactionData.rawTransaction = rawTXresponse.result
        const bcoinTX = bcoin.primitives.TX.fromRaw(BufferJS.from(transactionData.rawTransaction, 'hex'))
        transactionData.txJson = bcoinTX.getJSON(this.network)
      }
      await this.saveToDisk(this.transactions, 'transactions')
      const bcoinTX = bcoin.primitives.TX.fromRaw(BufferJS.from(transactionData.rawTransaction, 'hex'))
      const ourReceiveAddresses = []
      let nativeAmount = 0
      let totalOutputAmount = 0
      let totalInputAmount = 0
      const allOurAddresses = this.getAllOurAddresses()
      // Process tx outputs
      transactionData.txJson.outputs.forEach(({ address, value }) => {
        totalOutputAmount += value
        if (allOurAddresses.indexOf(address) !== -1) {
          nativeAmount += value
          ourReceiveAddresses.push(address)
        }
      })
      // Process tx inputs
      const getPrevout = async (input) => {
        const { hash, index } = input.prevout
        if (!input.prevRawTransaction) {
          const prevRawResponse = await this.electrum.getTransaction(hash, connectionID)
          input.prevRawTransaction = prevRawResponse.result
        }
        const prevoutBcoinTX = bcoin.primitives.TX.fromRaw(BufferJS.from(input.prevRawTransaction, 'hex'))
        const { value, address } = prevoutBcoinTX.getJSON(this.network).outputs[index]
        totalInputAmount += value
        if (allOurAddresses.indexOf(address) !== -1) {
          nativeAmount -= value
        }
      }
      await Promise.all(transactionData.txJson.inputs.map(input => getPrevout(input)))
      const abcTransaction: AbcTransaction = {
        ourReceiveAddresses,
        networkFee: (totalInputAmount - totalOutputAmount).toString(),
        otherParams: {},
        currencyCode: this.primaryCurrency,
        txid: txHash,
        date: Date.now() / 1000,
        blockHeight: transactionObj.height,
        nativeAmount: nativeAmount.toString(),
        signedTx: ''
      }
      await this.wallet.add(bcoinTX)
      await this.saveMemDumpToDisk()
      transactionData.abcTransaction = abcTransaction
      const blockHeader = transactionObj.height ? await this.getBlockHeader(transactionObj.height, connectionID) : null
      const date = blockHeader ? blockHeader.timestamp : Date.now() / MILI_TO_SEC
      abcTransaction.date = date
      await this.saveToDisk(this.transactions, 'transactions')
      this.abcTxLibCallbacks.onTransactionsChanged([abcTransaction])
      await this.checkGapLimit(address)
    } catch (e) {
      this.connected && setTimeout(() => {
        this.handleTransaction(address, transactionObj)
      }, SERVER_RETRY_INTERVAL)
    }
  }

  async getBlockHeader (height: number, connectionID?: string): any {
    if (this.headerList[height]) {
      return this.headerList[height]
    }
    let header
    const serverHeaserResponse = await this.electrum.getBlockHeader(height, connectionID)
    header = serverHeaserResponse.result
    this.headerList[height] = header
    this.saveToDisk(this.headerList, 'headerList')
    return header
  }

  async checkGapLimit (address: string) {
    const account = await this.wallet.getAccount(0)
    const path = await this.wallet.getPath(address)
    switch (path.branch) {
      case 0:
        this.checkGapLimitForBranch(account, 'receive', 0)
        break
      case 1:
        if (this.walletType.includes('44')) {
          this.checkGapLimitForBranch(account, 'receive', 1)
        }
        break
      case 2:
        if (this.walletType.includes('segwit')) {
          this.checkGapLimitForBranch(account, 'nested', 2)
        }
        break
    }
  }

  async checkGapLimitForBranch (account:any, type: string, typeNum: number) {
    const addresses = this.walletLocalData.addresses[type]
    const addressDepth = account[`${type}Depth`] - 1 + this.gapLimit
    const addressesLen = addresses.length
    if (addressDepth > addressesLen) {
      const paths = await this.wallet.getPaths(0)
      paths
      .filter(path => path.branch === typeNum && path.index > addressesLen)
      .forEach(path => {
        const address = path.toAddress(this.network).toString()
        addresses.push(address)
        this.subscribeToAddress(address)
      })
    }
  }

  initialSyncCheck () {
    if (this.getAllOurAddresses().length === Object.keys(this.transactions).length) {
      let finishedLoading = true
      for (const address in this.transactions) {
        if (!this.transactions[address].executed) {
          finishedLoading = false
          break
        }
      }
      finishedLoading && this.abcTxLibCallbacks.onAddressesChecked(1)
    }
  }
  /* --------------------------------------------------------------------- */
  /* -----------------------  Disk Util Functions  ----------------------- */
  /* --------------------------------------------------------------------- */
  async saveToDisk (obj: any, fileName: string, optionalFileName: string = '') {
    try {
      await this.walletLocalFolder
      .folder(this.diskPath.folder)
      .file(this.diskPath.files[fileName] + optionalFileName)
      .setText(JSON.stringify(obj))
    } catch (e) {
      return e
    }
  }

  async saveMemDumpToDisk () {
    if (this.wallet &&
      this.wallet.db &&
      this.wallet.db.db &&
      this.wallet.db.db.binding &&
      this.wallet.db.db.binding.toRaw) {
      this.memoryDump.rawMemory = this.wallet.db.db.binding.toRaw().toString('hex')
      await this.saveToDisk(this.memoryDump, 'memoryDump')
    }
  }

  async loadFromDisk (obj:any, fileName: string, optionalFileName: string = '') {
    try {
      global.pnow('AWAIT getText')
      const data = await this.walletLocalFolder
      .folder(this.diskPath.folder)
      .file(this.diskPath.files[fileName] + optionalFileName)
      .getText()
      global.pnow('RESOLVE getText')
      let dataJson = JSON.parse(data)
      Object.assign(obj, dataJson)
      global.pnow('RETURN from loadFromDisk')
      return dataJson
    } catch (e) {
      return null
    }
  }

  async loadEncryptedFromDisk () {
    try {
      const data: string = await this.walletLocalEncryptedFolder.file('privateKey').getText()
      const dataObj = JSON.parse(data)
      return dataObj
    } catch (e) {
      return null
    }
  }

  async saveEncryptedToDisk (xprivObj: any) {
    try {
      const xprivJson = JSON.stringify(xprivObj)
      await this.walletLocalEncryptedFolder.file('privateKey').setText(xprivJson)
    } catch (e) {

    }
  }

  async loadMemoryDumpFromDisk () {
    const memoryDump = await this.loadFromDisk(this.memoryDump, 'memoryDump')
    if (!memoryDump) await this.saveMemDumpToDisk()
  }
}
