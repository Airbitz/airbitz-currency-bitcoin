// @flow
import type {
  AbcWalletInfo,
  AbcCurrencyEngine,
  AbcCurrencyEngineOptions,
  AbcFreshAddress,
  AbcSpendInfo,
  AbcTransaction,
  AbcCurrencyInfo,
  AbcSpendTarget
} from 'airbitz-core-types'

import { EngineState } from './engineState.js'
import { PluginState } from '../plugin/pluginState.js'
import { KeyManager } from './keyManager'
import type { EngineStateCallbacks } from './engineState.js'
import type { KeyManagerCallbacks } from './keyManager'
import type { EarnComFees, BitcoinFees } from '../utils/flowTypes.js'
import { validateObject } from '../utils/utils.js'
import { InfoServerFeesSchema } from '../utils/jsonSchemas.js'
import { calcFeesFromEarnCom, calcMinerFeePerByte } from './miningFees.js'
import bcoin from 'bcoin'

const BYTES_TO_KB = 1000
const MILI_TO_SEC = 1000
const INFO_SERVER = 'https://info1.edgesecure.co:8444/v1'
/**
 * The core currency plugin.
 * Provides information about the currency,
 * as well as generic (non-wallet) functionality.
 */
export class CurrencyEngine {
  walletInfo: AbcWalletInfo
  currencyInfo: AbcCurrencyInfo
  keyManager: KeyManager
  engineState: EngineState
  pluginState: PluginState
  abcCurrencyEngineOptions: AbcCurrencyEngineOptions
  network: string
  rawTransactionFees: {
    lastUpdated: number,
    fees: Array<any>
  }
  feeInfoServer: string
  feeUpdateInterval: number
  feeTimer: any
  fees: BitcoinFees
  transactionCache: {
    [txid: string]: AbcTransaction
  }

  // ------------------------------------------------------------------------
  // Private API
  // ------------------------------------------------------------------------
  constructor (
    walletInfo: AbcWalletInfo,
    currencyInfo: AbcCurrencyInfo,
    pluginState: PluginState,
    options: AbcCurrencyEngineOptions
  ) {
    // Validate that we are a valid AbcCurrencyEngine:
    // eslint-disable-next-line no-unused-vars
    const test: AbcCurrencyEngine = this

    this.walletInfo = walletInfo
    this.currencyInfo = currencyInfo
    this.pluginState = pluginState
    this.abcCurrencyEngineOptions = options
    this.network = this.currencyInfo.defaultSettings.network.type
    this.feeInfoServer = this.currencyInfo.defaultSettings.feeInfoServer
    this.feeUpdateInterval = this.currencyInfo.defaultSettings.feeUpdateInterval
    this.fees = {
      highFee: '',
      lowFee: '',
      standardFeeLow: '',
      standardFeeHigh: '',
      standardFeeLowAmount: '',
      standardFeeHighAmount: ''
    }
    if (this.currencyInfo.defaultSettings.simpleFeeSettings) {
      Object.assign(
        this.fees,
        this.currencyInfo.defaultSettings.simpleFeeSettings
      )
    }
    this.rawTransactionFees = {
      lastUpdated: 0,
      fees: []
    }
    this.transactionCache = {}
  }

  async load (): Promise<any> {
    const engineStateCallbacks: EngineStateCallbacks = {
      onAddressInfoUpdated: (addressHash: string) => {
        if (this.keyManager) this.keyManager.setLookAhead()
        this.abcCurrencyEngineOptions.callbacks.onBalanceChanged(
          this.currencyInfo.currencyCode,
          this.getBalance()
        )
      },
      onHeightUpdated: (height: number) => {
        this.abcCurrencyEngineOptions.callbacks.onBlockHeightChanged(height)
      },
      onTxFetched: (txid: string) => {
        const abcTransaction = this.getTransaction(txid)
        this.abcCurrencyEngineOptions.callbacks.onTransactionsChanged([abcTransaction])
      }
    }
    const gapLimit = this.currencyInfo.defaultSettings.gapLimit
    const io = this.abcCurrencyEngineOptions.optionalSettings
      ? this.abcCurrencyEngineOptions.optionalSettings.io
      : null

    this.engineState = new EngineState({
      callbacks: engineStateCallbacks,
      io: io,
      localFolder: this.abcCurrencyEngineOptions.walletLocalFolder,
      encryptedLocalFolder: this.abcCurrencyEngineOptions.walletLocalEncryptedFolder,
      pluginState: this.pluginState
    })

    await this.engineState.load()

    const keyManagerCallbacks: KeyManagerCallbacks = {
      onNewAddress: (scriptHash: string, address: string, path: string) => {
        return this.engineState.addAddress(scriptHash, address, path)
      },
      onNewKey: (keys: any) => this.engineState.saveKeys(keys)
    }

    const rawKeys = await this.engineState.loadKeys()
    if (!rawKeys.master) {
      rawKeys.master = {}
    }
    if (!rawKeys.master.xpub) {
      if (this.walletInfo.keys && this.walletInfo.keys[`${this.network}Xpub`]) {
        rawKeys.master.xpub = this.walletInfo.keys[`${this.network}Xpub`]
      }
    }
    let seed = ''
    if (this.walletInfo.keys && this.walletInfo.keys[`${this.network}Key`]) {
      seed = this.walletInfo.keys[`${this.network}Key`]
    }
    const bip = this.walletInfo.type.split('-')[1]

    this.keyManager = new KeyManager({
      seed: seed,
      rawKeys: rawKeys,
      bip: bip,
      gapLimit: gapLimit,
      network: this.network,
      callbacks: keyManagerCallbacks,
      addressInfos: this.engineState.addressInfos,
      txInfos: this.engineState.parsedTxs
    })

    await this.keyManager.load()
  }

  getTransaction (txid: string): AbcTransaction {
    const { height = -1, firstSeen = Date.now() } =
      this.engineState.txHeightCache[txid] || {}
    let date = firstSeen
    // If confirmed, we will try and take the timestamp as the date
    if (height && height !== -1) {
      const blockHeight = this.pluginState.headerCache[height.toString()]
      if (blockHeight) {
        date = blockHeight.timestamp
      }
    }
    // If already exists, try and update the height and return
    if (this.transactionCache[txid]) {
      const abcTransaction = this.transactionCache[txid]
      if (height !== abcTransaction.blockHeight) {
        abcTransaction.blockHeight = height
        abcTransaction.date = date
      }
      return abcTransaction
    }
    // Get pased bcoin tx from engine
    const bcoinTransaction = this.engineState.parsedTxs[txid]
    if (!bcoinTransaction) {
      throw new Error('Transaction not found')
    }

    const ourReceiveAddresses = []
    let nativeAmount = 0
    let totalOutputAmount = 0
    let totalInputAmount = 0

    // Process tx outputs
    const outputsLength = bcoinTransaction.outputs.length
    for (let i = 0; i < outputsLength; i++) {
      const { address, value } = bcoinTransaction.outputs[i].toJSON(this.network)
      totalOutputAmount += value
      if (this.engineState.scriptHashes[address]) {
        nativeAmount += value
        ourReceiveAddresses.push(address)
      }
    }

    // Process tx inputs
    const inputsLength = bcoinTransaction.inputs.length
    for (let i = 0; i < inputsLength; i++) {
      const input = bcoinTransaction.inputs[i]
      if (input.prevout) {
        const { hash, index } = input.prevout
        const prevoutBcoinTX = this.engineState.parsedTxs[hash]
        if (prevoutBcoinTX) {
          const { value, address } = prevoutBcoinTX.outputs[index].getJSON(this.network)
          totalInputAmount += value
          if (this.engineState.scriptHashes[address]) {
            nativeAmount -= value
          }
        }
      }
    }

    const fee = totalInputAmount ? totalInputAmount - totalOutputAmount : 0
    const abcTransaction: AbcTransaction = {
      ourReceiveAddresses,
      currencyCode: this.currencyInfo.currencyCode,
      otherParams: {},
      txid: txid,
      date: date,
      blockHeight: height,
      nativeAmount: nativeAmount.toString(),
      networkFee: fee.toString(),
      signedTx: this.engineState.txCache[txid]
    }
    this.transactionCache[txid] = abcTransaction
    return abcTransaction
  }

  async updateFeeTable () {
    try {
      if (this.rawTransactionFees.lastUpdated) throw new Error('Already has fees')
      const url = `${INFO_SERVER}/networkFees/${this.currencyInfo.currencyCode}`
      if (
        !this.abcCurrencyEngineOptions.optionalSettings ||
        !this.abcCurrencyEngineOptions.optionalSettings.io ||
        !this.abcCurrencyEngineOptions.optionalSettings.io.fetch
      ) {
        throw new Error('No io/fetch object')
      }
      const feesResponse = await this.abcCurrencyEngineOptions.optionalSettings.io.fetch(url)
      const feesJson = await feesResponse.json()
      if (validateObject(feesJson, InfoServerFeesSchema)) {
        this.fees = feesJson
      } else {
        throw new Error('Fetched invalid networkFees')
      }
    } catch (err) {
      console.log(err)
    }
    await this.updateFeeTableLoop()
  }

  async updateFeeTableLoop () {
    if (
      this.abcCurrencyEngineOptions.optionalSettings &&
      this.abcCurrencyEngineOptions.optionalSettings.io &&
      this.feeInfoServer !== '' &&
      this.rawTransactionFees.lastUpdated < Date.now() - this.feeUpdateInterval
    ) {
      try {
        const results = await this.abcCurrencyEngineOptions.optionalSettings.io.fetch(
          this.feeInfoServer
        )
        if (results.status !== 200) {
          throw new Error(results.body)
        }
        const { fees }: EarnComFees = await results.json()
        this.rawTransactionFees.lastUpdated = Date.now()
        this.rawTransactionFees.fees = fees
        this.fees = calcFeesFromEarnCom(this.fees, { fees })
      } catch (e) {
        console.log('Error while trying to update fee table', e)
      } finally {
        this.feeTimer = setTimeout(() => {
          this.updateFeeTableLoop()
        }, this.feeUpdateInterval)
      }
    }
  }

  getRate ({
    spendTargets,
    networkFeeOption = 'standard',
    customNetworkFee = ''
  }: AbcSpendInfo): number {
    if (networkFeeOption === 'custom' && customNetworkFee !== '') {
      // customNetworkFee is in sat/Bytes in need to be converted to sat/KB
      return parseInt(customNetworkFee) * BYTES_TO_KB
    } else {
      const amountForTx = spendTargets
        .reduce((s, { nativeAmount }) => s + parseInt(nativeAmount), 0)
        .toString()
      const rate = calcMinerFeePerByte(
        amountForTx,
        networkFeeOption,
        customNetworkFee,
        this.fees
      )
      return parseInt(rate) * BYTES_TO_KB
    }
  }

  getUTXOs () {
    const utxos: any = []
    for (const scriptHash in this.engineState.addressInfos) {
      const utxoLength = this.engineState.addressInfos[scriptHash].utxos.length
      for (let i = 0; i < utxoLength; i++) {
        const utxo = this.engineState.addressInfos[scriptHash].utxos[i]
        let height = -1
        if (this.engineState.txHeightCache[utxo.txid]) {
          height = this.engineState.txHeightCache[utxo.txid].height
        }
        utxos.push({ utxo, height })
      }
    }
    return utxos
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------
  updateSettings (settings: any): void {
    // TODO: Implement this
  }

  async startEngine (): Promise<void> {
    const cachedTXs = await this.getTransactions()
    this.abcCurrencyEngineOptions.callbacks.onTransactionsChanged(cachedTXs)
    this.abcCurrencyEngineOptions.callbacks.onBalanceChanged(
      this.currencyInfo.currencyCode,
      this.getBalance()
    )
    await this.updateFeeTable()
    return this.engineState.connect()
  }

  async killEngine (): Promise<void> {
    clearTimeout(this.feeTimer)
    return this.engineState.disconnect()
  }

  getBlockHeight (): number {
    return this.pluginState.height
  }

  async enableTokens (tokens: Array<string>): Promise<void> {}

  async getEnabledTokens (): Promise<Array<string>> {
    return []
  }

  addCustomToken (token: any): Promise<void> {
    return Promise.reject(new Error('This plugin has no tokens'))
  }

  disableTokens (tokens: Array<string>): Promise<void> {
    return Promise.reject(new Error('This plugin has no tokens'))
  }

  getTokenStatus (token: string): boolean {
    return false
  }

  getBalance (options: any): string {
    let balance = 0
    for (const scriptHash in this.engineState.addressInfos) {
      const { utxos } = this.engineState.addressInfos[scriptHash]
      const utxoLength = utxos.length
      for (let i = 0; i < utxoLength; i++) {
        balance += utxos[i].value
      }
    }
    return balance.toString()
  }

  getNumTransactions (options: any): number {
    return Object.keys(this.engineState.txCache).length
  }

  async getTransactions (options: any): Promise<Array<AbcTransaction>> {
    const rawTxs = this.engineState.txCache
    const abcTransactions = []
    for (const txid in rawTxs) {
      const abcTransaction = this.getTransaction(txid)
      abcTransactions.push(abcTransaction)
    }

    const startIndex = (options && options.startIndex) || 0
    let endIndex =
      (options && options.numEntries + startIndex) || abcTransactions.length
    if (startIndex + endIndex > abcTransactions.length) {
      endIndex = abcTransactions.length
    }
    return abcTransactions.slice(startIndex, endIndex)
  }

  getFreshAddress (options: any): AbcFreshAddress {
    const abcAddress = { publicAddress: this.keyManager.getReceiveAddress() }
    return abcAddress
  }

  addGapLimitAddresses (addresses: Array<string>, options: any): void {
    const scriptHashes = addresses.map(
      displayAddress => this.engineState.scriptHashes[displayAddress]
    )

    this.engineState.markAddressesUsed(scriptHashes)
    if (this.keyManager) this.keyManager.setLookAhead()
  }

  isAddressUsed (address: string, options: any): boolean {
    try {
      bcoin.primitives.Address.fromBase58(address)
    } catch (e) {
      try {
        bcoin.primitives.Address.fromBech32(address)
      } catch (e) {
        throw new Error('Wrong formatted address')
      }
    }
    for (const scriptHash in this.engineState.addressInfos) {
      if (
        this.engineState.addressInfos[scriptHash].displayAddress === address
      ) {
        return this.engineState.addressInfos[scriptHash].used
      }
    }
    return false
  }

  async makeSpend (
    abcSpendInfo: AbcSpendInfo,
    options?: any = {}
  ): Promise<AbcTransaction> {
    // Can't spend without outputs
    if (
      !options.CPFP &&
      (!abcSpendInfo.spendTargets || abcSpendInfo.spendTargets.length < 1)
    ) {
      throw new Error('Need to provide Spend Targets')
    }
    let resultedTransaction

    try {
      Object.assign(options, {
        rate: this.getRate(abcSpendInfo),
        maxFee: this.currencyInfo.defaultSettings.maxFee,
        outputs: abcSpendInfo.spendTargets,
        utxos: this.getUTXOs(),
        height: this.getBlockHeight()
      })
      resultedTransaction = await this.keyManager.createTX(options)
    } catch (e) {
      if (e.type === 'FundingError') throw new Error('InsufficientFundsError')
      throw e
    }
    const sumOfTx = abcSpendInfo.spendTargets.reduce(
      (s, spendTarget: AbcSpendTarget) => {
        if (
          spendTarget.publicAddress &&
          this.engineState.scriptHashes[spendTarget.publicAddress]
        ) {
          return s
        } else return s - parseInt(spendTarget.nativeAmount)
      },
      0
    )

    const ourReceiveAddresses = []
    for (const i in resultedTransaction.outputs) {
      const address = resultedTransaction.outputs[i]
        .getAddress()
        .toString(this.network)
      if (address && this.engineState.scriptHashes[address]) {
        ourReceiveAddresses.push(address)
      }
    }

    const abcTransaction: AbcTransaction = {
      ourReceiveAddresses,
      otherParams: {
        bcoinTx: resultedTransaction,
        abcSpendInfo,
        rate: options.rate
      },
      currencyCode: this.currencyInfo.currencyCode,
      txid: '',
      date: 0,
      blockHeight: 0,
      nativeAmount: (
        sumOfTx - parseInt(resultedTransaction.getFee())
      ).toString(),
      networkFee: resultedTransaction.getFee().toString(),
      signedTx: ''
    }
    return abcTransaction
  }

  async signTx (abcTransaction: AbcTransaction): Promise<AbcTransaction> {
    await this.keyManager.sign(abcTransaction.otherParams.bcoinTx)
    abcTransaction.date = Date.now() / MILI_TO_SEC
    abcTransaction.signedTx = abcTransaction.otherParams.bcoinTx
      .toRaw()
      .toString('hex')
    abcTransaction.txid = abcTransaction.otherParams.bcoinTx.rhash()
    return abcTransaction
  }

  async broadcastTx (abcTransaction: AbcTransaction): Promise<AbcTransaction> {
    if (!abcTransaction.otherParams.bcoinTx) {
      abcTransaction.otherParams.bcoinTx = bcoin.primitives.TX.fromRaw(abcTransaction.signedTx, 'hex')
    }
    for (const output of abcTransaction.otherParams.bcoinTx.outputs) {
      if (output.value <= 0 || output.value === '0') {
        throw new Error('Wrong spend amount')
      }
    }
    const txid = await this.engineState.broadcastTx(abcTransaction.signedTx)
    if (!abcTransaction.txid) abcTransaction.txid = txid
    return abcTransaction
  }

  saveTx (abcTransaction: AbcTransaction): Promise<void> {
    this.engineState.saveTx(abcTransaction.txid, abcTransaction.signedTx)
    return Promise.resolve()
  }

  getDisplayPrivateSeed () {
    if (this.walletInfo.keys && this.walletInfo.keys[`${this.network}Key`]) {
      return this.walletInfo.keys[`${this.network}Key`]
    }
    return null
  }

  getDisplayPublicSeed () {
    if (this.walletInfo.keys && this.walletInfo.keys[`${this.network}Xpub`]) {
      return this.walletInfo.keys[`${this.network}Xpub`]
    }
    return null
  }
}
