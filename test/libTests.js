/* global describe it */
const { makeBitcoinPlugin } = require('../lib/index.js')
const assert = require('assert')

function fakeRandom () {

}
const plugin = makeBitcoinPlugin({io: {random: fakeRandom}})

describe('parseUri', function () {
  it('address only', function () {
    const parsedUri = plugin.parseUri('1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, null)
    assert.equal(parsedUri.currencyCode, null)
  })
  it('uri address', function () {
    const parsedUri = plugin.parseUri('bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, null)
    assert.equal(parsedUri.currencyCode, null)
  })
  it('uri address with amount', function () {
    const parsedUri = plugin.parseUri('bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=12345.6789')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, '1234567890000')
    assert.equal(parsedUri.currencyCode, 'BTC')
  })
  it('uri address with amount & label', function () {
    const parsedUri = plugin.parseUri('bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=1234.56789&label=Johnny%20Bitcoin')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, '123456789000')
    assert.equal(parsedUri.currencyCode, 'BTC')
    assert.equal(parsedUri.label, 'Johnny Bitcoin')
  })
  it('uri address with amount, label & message', function () {
    const parsedUri = plugin.parseUri('bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=1234.56789&label=Johnny%20Bitcoin&message=Hello%20World,%20I%20miss%20you%20!')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, '123456789000')
    assert.equal(parsedUri.currencyCode, 'BTC')
    assert.equal(parsedUri.label, 'Johnny Bitcoin')
    assert.equal(parsedUri.message, 'Hello World, I miss you !')
  })
  it('uri address with unsupported param', function () {
    const parsedUri = plugin.parseUri('bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?unsupported=helloworld&amount=12345.6789')
    assert.equal(parsedUri.publicAddress, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
    assert.equal(parsedUri.nativeAmount, '1234567890000')
    assert.equal(parsedUri.currencyCode, 'BTC')
  })
})

describe('encodeUri', function () {
  it('address only', function () {
    const encodedUri = plugin.encodeUri({publicAddress: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX'})
    assert.equal(encodedUri, '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX')
  })
  it('address & amount', function () {
    const encodedUri = plugin.encodeUri(
      {
        publicAddress: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX',
        nativeAmount: '123456780000'
      }
    )
    assert.equal(encodedUri, 'bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=1234.5678')
  })
  it('address, amount, and label', function () {
    const encodedUri = plugin.encodeUri(
      {
        publicAddress: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX',
        nativeAmount: '123456780000',
        currencyCode: 'BTC',
        label: 'Johnny Bitcoin'
      }
    )
    assert.equal(encodedUri, 'bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=1234.5678&label=Johnny%20Bitcoin')
  })
  it('address, amount, label, & message', function () {
    const encodedUri = plugin.encodeUri(
      {
        publicAddress: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX',
        nativeAmount: '123456780000',
        currencyCode: 'BTC',
        label: 'Johnny Bitcoin',
        message: 'Hello World, I miss you !'
      }
    )
    assert.equal(encodedUri, 'bitcoin:1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX?amount=1234.5678&label=Johnny%20Bitcoin&message=Hello%20World,%20I%20miss%20you%20!')
  })
  it('invalid currencyCode', function () {
    assert.throws(() => {
      plugin.encodeUri(
        {
          publicAddress: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX',
          nativeAmount: '123456780000',
          currencyCode: 'INVALID',
          label: 'Johnny Bitcoin',
          message: 'Hello World, I miss you !'
        }
      )
    })
  })
})
