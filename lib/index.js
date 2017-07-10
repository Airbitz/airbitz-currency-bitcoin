'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var rfc4648 = require('rfc4648');

var bcoin = require('bcoin');

var request = require('request');

var net = require("tcp");

var fs = require('fs');

/* global */

function hexToBytes(hex) {
  for (var bytes = new Buffer(hex.length/2), c = 0; c < hex.length; c += 2)
  bytes[c/2] = parseInt(hex.substr(c, 2), 16);
  return bytes;
}


var txLibInfo = {
  supportedTokens: ['BTC'],

  getInfo: {
    // Details of supported currency
    currencyCode: 'BTC', // The 3 character code for the currency
    denominations: [
      // An array of Objects of the possible denominations for this currency
      {
        name: 'bits', // The human readable string to describe the denomination
        multiplier: 100, // The value to multiply the smallest unit of currency to get to the denomination
        symbol: 'μBTC' // The human readable 1-3 character symbol of the currency, e.g “Ƀ”
      },
      {
        name: 'mBTC',
        multiplier: 100000,
        symbol: 'mB'
      },
      {
        name: 'BTC',
        multiplier: 100000000,
        symbol: 'B'
      }
    ],
    symbolImage: 'qq/2iuhfiu1/3iufhlq249r8yq34tiuhq4giuhaiwughiuaergih/rg', // Base64 encoded png or jpg image of the currency symbol (optional)
    metaTokens: [
      // Array of objects describing the supported metatokens
      {
        currencyCode: 'BTC',
        denominations: [
          {
            name: 'BTC',
            multiplier: 1
          }
        ],
        symbolImage: 'fe/3fthfiu1/3iufhlq249r8yq34tiuhqggiuhaiwughiuaergih/ef'
      }
    ]
  }
};

// abcWalletTxLib-btc.js
// const random = require('random-js')
var GAP_LIMIT = 10;
var DATA_STORE_FOLDER = 'txEngineFolder';
var DATA_STORE_FILE = 'walletLocalData.json';
var ADDRESS_POLL_MILLISECONDS = 20000;
var TRANSACTION_POLL_MILLISECONDS = 3000;
var BLOCKHEIGHT_POLL_MILLISECONDS = 60000;
var SAVE_DATASTORE_MILLISECONDS = 10000;

var PRIMARY_CURRENCY = txLibInfo.getInfo.currencyCode;
var TOKEN_CODES = [PRIMARY_CURRENCY].concat(txLibInfo.supportedTokens);

String.prototype.hashCode = function() {
  var hash = 0, i, chr;
  if (this.length === 0) return hash;
  for (i = 0; i < this.length; i++) {
    chr   = this.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

var baseUrl = 'http://shitcoin-az-braz.airbitz.co:8080/api/';
// const baseUrl = 'http://localhost:8080/api/'

function makeBitcoinPlugin (opts) {
  if ( opts === void 0 ) opts = {};

  var io = opts.io;

  return {
    getInfo: function () {
      var currencyDetails = txLibInfo.getInfo;

      return currencyDetails
    },

    createMasterKeys: function (walletType) {
      if (walletType === 'shitcoin') {
        var masterPrivateKey = rfc4648.base16.stringify(io.random(8));
        var masterPublicKey = 'pub' + masterPrivateKey;
        return { masterPrivateKey: masterPrivateKey, masterPublicKey: masterPublicKey }
      } else if (walletType === 'bitcoin') {
        return null
      } else {
        return null
      }
    },

    makeEngine: function (keyInfo, opts) {
      if ( opts === void 0 ) opts = {};

      var abcTxLib = new ABCTxLibTRD(io, keyInfo, opts);

      return abcTxLib
    }
  }
}

var WalletLocalData = function WalletLocalData (jsonString) {
  var this$1 = this;

  this.blockHeight = 0;
  this.totalBalances = { TRD: 0 };

  // Map of gap limit addresses
  this.gapLimitAddresses = [];
  this.transactionsObj = {};

  // Array of ABCTransaction objects sorted by date from newest to oldest
  for (var n in TOKEN_CODES) {
    var currencyCode = TOKEN_CODES[n];
    this$1.transactionsObj[currencyCode] = [];
  }

  // Array of txids to fetch
  this.transactionsToFetch = [];

  // Array of address objects, unsorted
  this.addressArray = [];

  this.unusedAddressIndex = 0;
  this.masterPublicKey = '';
  this.enabledTokens = [PRIMARY_CURRENCY];
  if (jsonString != null) {
    var data = JSON.parse(jsonString);
    for (var k in data) {
      this$1[k] = data[k];
    }
  }
};

var ABCTransaction = function ABCTransaction (
  txid,
  date,
  currencyCode,
  blockHeight,
  amountSatoshi,
  networkFee,
  signedTx,
  otherParams
) {
  this.txid = txid;
  this.date = date;
  this.currencyCode = currencyCode;
  this.blockHeight = blockHeight;
  this.amountSatoshi = amountSatoshi;
  this.networkFee = networkFee;
  this.signedTx = signedTx;
  this.otherParams = otherParams;
};

var ABCTxLibTRD = function ABCTxLibTRD (io, keyInfo, opts) {
  if ( opts === void 0 ) opts = {};

  // dataStore.init(abcTxLibAccess, options, callbacks)
  var walletLocalFolder = opts.walletLocalFolder;
  var callbacks = opts.callbacks;

  // console.log(callbacks);

  this.io = io;
  this.keyInfo = keyInfo;
  this.abcTxLibCallbacks = callbacks;
  this.walletLocalFolder = walletLocalFolder;

  this.tcpClient = {};
  this.walletsScanQueue = [];
  this.transactionsStash = [];
  this.increasingLimitLoop = 0;
  this.watchAhead = 35;
  this.addressLimitLoop = 0;
  this.txUpdateTotalAddresses = 0;
  this.txUpdateStarted = false;
  this.txUpdateTotalEntries = 0;
  this.txUpdateFinished = false;
  this.txBalanceUpdateTotal = 0;
  this.txBalanceUpdateProgress = 1;
  this.txUpdateMonitoring = {};
  this.engineOn = false;
  this.transactionsDirty = true;
  this.totalPercentageCompbined = 0;
  this.addressesChecked = false;
  this.numAddressesChecked = 0;
  this.numAddressesToCheck = 0;
  this.walletLocalData = {};
  this.walletLocalDataDirty = false;
  this.transactionsChangedArray = [];
  this.masterBalance = 0;
  this.addresses = [];

  this.logger = new bcoin.logger({ level: 'debug', console: true });

  this.logger.writeConsole = function(level, module, args) {
    // console.log(level,module,args);
    if (level == 4 && module == "net" && args[0].substring(0,6) == "Status"){
      console.log("SPV SYNC PROGRESS: ", args[3]);
    } 
  };

  this.logger.info = function(level, module, args) {
    // console.log(level,module,args);
  };

  this.logger.open();

  this.chain = new bcoin.chain({
    db: 'leveldb',
    location: process.env.PWD + "/db" + '/spvdemo',
    spv: true,
    network: "main",
    logConsole: true,
    logger: this.logger
  });

  this.pool = new bcoin.pool({
    chain: this.chain,
    spv: true,
    maxPeers: 8 ,
    logger: this.logger
  });

  // this.walletdb = new bcoin.walletdb({ db: 'leveldb', location: process.env.PWD + "/db" + '/mywalletTest' });
  this.walletdb = new bcoin.walletdb({ db: 'memory' });

};

// *************************************
// Private methods
// *************************************
ABCTxLibTRD.prototype.engineLoop = function engineLoop () {
  this.engineOn = true;
  this.blockHeightInnerLoop();
  this.checkAddressesInnerLoop();
  this.checkTransactionsInnerLoop();
  this.saveWalletDataStore();
};

ABCTxLibTRD.prototype.isTokenEnabled = function isTokenEnabled (token) {
  return this.walletLocalData.enabledTokens.indexOf(token) !== -1
};

ABCTxLibTRD.prototype.fetchGet = function fetchGet (cmd, params) {
  return this.io.fetch(baseUrl + cmd + '/' + params, {
    method: 'GET'
  })
};

ABCTxLibTRD.prototype.fetchPost = function fetchPost (cmd, body) {
  return this.io.fetch(baseUrl + cmd, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify(body)
  })
};

// *************************************
// Poll on the blockheight
// *************************************
ABCTxLibTRD.prototype.blockHeightInnerLoop = function blockHeightInnerLoop () {
    var this$1 = this;

  if (this.engineOn) {
    var p = new Promise(function (resolve, reject) {
      this$1.fetchGet('height', '')
        .then(function (response) {
          return response.json()
        })
        .then(function (jsonObj) {
          if (this$1.walletLocalData.blockHeight !== jsonObj.height) {
            this$1.walletLocalData.blockHeight = jsonObj.height;
            this$1.walletLocalDataDirty = true;
            console.log(
              'Block height changed: ' + this$1.walletLocalData.blockHeight
            );
            this$1.abcTxLibCallbacks.blockHeightChanged(
              this$1.walletLocalData.blockHeight
            );
          }
          resolve();
        })
        .catch(function (err) {
          console.log('Error fetching height: ' + err);
          resolve();
        });
    });
    p.then(function () {
      setTimeout(function () {
        this$1.blockHeightInnerLoop();
      }, BLOCKHEIGHT_POLL_MILLISECONDS);
    });
  }
};

ABCTxLibTRD.prototype.checkTransactionsInnerLoop = function checkTransactionsInnerLoop () {
    var this$1 = this;

  if (this.engineOn) {
    var promiseArray = [];
    var numTransactions = this.walletLocalData.transactionsToFetch.length;

    for (var n = 0; n < numTransactions; n++) {
      var txid = this$1.walletLocalData.transactionsToFetch[n];
      var p = this$1.processTransactionFromServer(txid);
      promiseArray.push(p);
      console.log('checkTransactionsInnerLoop: check ' + txid);
    }

    if (promiseArray.length > 0) {
      Promise.all(promiseArray)
        .then(function (response) {
          setTimeout(function () {
            this$1.checkTransactionsInnerLoop();
          }, TRANSACTION_POLL_MILLISECONDS);
        })
        .catch(function (e) {
          console.log(
            new Error(
              'Error: checkTransactionsInnerLoop: should not get here'
            )
          );
          setTimeout(function () {
            this$1.checkTransactionsInnerLoop();
          }, TRANSACTION_POLL_MILLISECONDS);
        });
    } else {
      setTimeout(function () {
        this$1.checkTransactionsInnerLoop();
      }, TRANSACTION_POLL_MILLISECONDS);
    }
  }
};

ABCTxLibTRD.prototype.handleData = function(data){

  if (this.txUpdateMonitoring[data.id].executed){
    // console.log("FUCK REPEATS!!!");
    return;
  }

  if (data.id.substring(0,1)=="h"){
    
    this.txUpdateMonitoring[data.id].executed = Date.now();
    this.txUpdateMonitoring[data.id].requestResult = data.result;

    var walletAddress = data.id.substring(1);

    var walletIndex = this.addresses.indexOf( walletAddress );
    if ((walletIndex+this.watchAhead+1 > (this.addresses.length+this.addressLimitLoop) && data.result.length>0)){
      this.addressLimit = walletIndex+this.watchAhead+1;
      this.addressLimitLoop = this.addressLimit - this.addresses.length - this.addressLimitLoop;
      // console.log("INCREMENTING",this.addresses.length, this.addressLimitLoop)
      this.incrementWatchList(this.addressLimitLoop);
    }

    // console.log("GOT TRANSACTIONS <<<", walletAddress, this.addressLimitLoop  );

    if (data.result.length>0){
      for (var j=0;j<=data.result.length-1;j++){
        
        // console.log("Requesting transaction", data.result[j].tx_hash);
        // console.log("Total transactions", this.transactionsStash.length );
        
        var requestID = "t"+data.result[j].tx_hash;
        var requestString = '{ "id": '+requestID+', "method":"blockchain.transaction.get", "params":["'+data.result[j].tx_hash+'"] }';

        this.transactionsStash.push(data.result[j].tx_hash);

        this.tcpClient.write(requestString+"\n");
        this.txUpdateMonitoring[requestID] = {
          requestTime: Date.now(),
          requestResult: '',
          requestString: requestString,
          transactionHash: data.result[j].tx_hash,
          transactionHeight: data.result[j].height,
          executed: 0
        };
      } 
    }
  }
  if (data.id.substring(0,1)=="t"){
    // console.log("GOT DATA", data.id);
    
    this.txUpdateMonitoring[data.id].executed = Date.now();
    this.txUpdateMonitoring[data.id].requestResult = data.result;
    
    
    // console.log(bcoin.tx);
    // var dataTX = JSON.parse(r);
    
    // if (data.id==16)
    //   return;
    // for (var y=0;y<=dataTX.inputs.length-1;y++){
    //   tcpClient.write('{ "id": 16, "method":"blockchain.transaction.get", "params":["'+dataTX.inputs[y].prevout.hash+'"] }'+"\n");   
    // }
    // console.log("TX HASHES!!:",data.result);   
    return;
  } 
}
 
ABCTxLibTRD.prototype.rescan = function(data){
  if (data!=0){

    var string = "";
    for (var ui=0;ui<=data.length-1;ui++){
      string+=String.fromCharCode(data[ui]);
    }
    this.globalRecievedData += string;
    var result = [];
    if (this.globalRecievedData.indexOf("\n")>-1){
      // console.log("stringbeforesplit ",this.globalRecievedData); 
      var mdata = this.globalRecievedData.split("\n");
      for (var k=0;k<=mdata.length-1;k++){
        if (mdata[k].length<3){
          continue;
        }
        // console.log("ssbefore parsing, mk ",mdata[k]);   
        var res = false;
        try{
          res = JSON.parse(mdata[k]);
          result.push(res);
        } catch(e){}
      }
    } else {
      // console.log("ssbefore parsing, s ",this.globalRecievedData);   
      try{
        data = JSON.parse(this.globalRecievedData);
        result.push(data);
      } catch(e){}
    } 
    if (result.length>0){
      this.globalRecievedData = "";
    }
    for (var o=0;o<=result.length-1;o++){
      this.handleData(result[o]);  
    }
  }

  if (this.walletsScanQueue.length==0)
    return;
 
  var wallet = this.walletsScanQueue.shift();
  var requestID = "h"+wallet;
  // console.log("JOINING, ",wallet);
  // walletsScanQueue = [];
  var requestString = '{ "id": '+requestID+', "method":"blockchain.address.get_history", "params":["'+wallet+'"] }';
  
  this.tcpClient.write(requestString+"\n");  

  this.txUpdateMonitoring[requestID] = {
    requestTime: Date.now(),
    requestResult: '',
    requestString: requestString,
    executed: 0
  };

  // var client = net.connect("50001", "cluelessperson.com", function(res) {
  //   console.log('opened client on ' + JSON.stringify(client.address()));
  //   client.write('{ "id": 1, "method":"blockchain.address.get_balance", "params":["'+address+'"] }'+"\n");
  //   client.on("data",function(data){
  //     
  //     console.log("zzszincomming, ",string);  
  //     data = JSON.parse(string);
  //   console.log("zzzincomming, ",data);   
  //   })
  //   // client.write('Hello, server! Love, Client.');
  // });
}


ABCTxLibTRD.prototype.processTransactionFromServer = function processTransactionFromServer (txid) {
    var this$1 = this;

  return this.fetchGet('transaction', txid)
    .then(function (response) {
      return response.json()
    })
    .then(function (jsonObj) {
      console.log('processTransactionFromServer: response.json():');
      console.log(jsonObj);

      //
      // Calculate the amount sent from the wallet
      //

      // Iterate through all the inputs and see if any are in our wallet
      var spendAmounts = [];
      var receiveAmounts = [];
      var amountsSatoshi = [];

      var inputs = jsonObj.inputs;
      var outputs = jsonObj.outputs;

      var otherParams = {
        inputs: inputs,
        outputs: outputs
      };

      for (var c in TOKEN_CODES) {
        var currencyCode = TOKEN_CODES[c];
        receiveAmounts[currencyCode] = spendAmounts[currencyCode] = 0;

        for (var n in inputs) {
          var input = inputs[n];
          var addr = input.address;
          var ccode = input.currencyCode;
          var idx$1 = this$1.findAddress(addr);
          if (idx$1 !== -1 && ccode === currencyCode) {
            spendAmounts[ccode] += input.amount;
          }
        }

        // Iterate through all the outputs and see if any are in our wallet
        for (var n$1 in outputs) {
          var output = outputs[n$1];
          var addr$1 = output.address;
          var ccode$1 = output.currencyCode;
          var idx$2 = this$1.findAddress(addr$1);
          if (idx$2 !== -1 && ccode$1 === currencyCode) {
            receiveAmounts[ccode$1] += output.amount;
          }
        }
        amountsSatoshi[currencyCode] =
          receiveAmounts[currencyCode] - spendAmounts[currencyCode];

        // Create a txlib ABCTransaction object which must contain
        // txid, date, blockHeight, amountSatoshi, networkFee, signedTx, and optionally otherParams
        /*
        let networkFee = jsonObj.networkFee
        if (currencyCode != PRIMARY_CURRENCY) {
          networkFee = 0
        }
        */

        if (
          receiveAmounts[currencyCode] !== 0 ||
          spendAmounts[currencyCode] !== 0
        ) {
          var abcTransaction = new ABCTransaction(
            jsonObj.txid,
            jsonObj.txDate,
            currencyCode,
            jsonObj.blockHeight,
            amountsSatoshi[currencyCode],
            jsonObj.networkFee,
            'iwassignedyoucantrustme',
            otherParams
          );
          this$1.addTransaction(currencyCode, abcTransaction);
        }
      }

      // Remove txid from transactionsToFetch
      var idx = this$1.walletLocalData.transactionsToFetch.indexOf(
        jsonObj.txid
      );
      if (idx !== -1) {
        this$1.walletLocalData.transactionsToFetch.splice(idx, 1);
        this$1.walletLocalDataDirty = true;
      }

      if (this$1.walletLocalData.transactionsToFetch.length === 0) {
        this$1.abcTxLibCallbacks.transactionsChanged(
          this$1.transactionsChangedArray
        );
        this$1.transactionsChangedArray = [];
      }

      return 0
    })
    .catch(function (e) {
      console.log('Error fetching address');
      return 0
    })
};

// **********************************************
// Check all addresses for new transactions
// **********************************************
ABCTxLibTRD.prototype.checkAddressesInnerLoop = function checkAddressesInnerLoop () {
    var this$1 = this;

  if (this.engineOn) {
    var promiseArray = [];
    // var promiseArrayCount = 0
    for (
      var n = 0;
      n < this.walletLocalData.unusedAddressIndex + GAP_LIMIT;
      n++
    ) {
      var address = this$1.addressFromIndex(n);
      var p = this$1.processAddressFromServer(address);
      promiseArray.push(p);

      if (this$1.walletLocalData.addressArray[n] == null) {
        this$1.walletLocalData.addressArray[n] = { address: address };
        this$1.walletLocalDataDirty = true;
      } else {
        if (this$1.walletLocalData.addressArray[n].address !== address) {
          throw new Error('Derived address mismatch on index ' + n)
        }
      }

      console.log('checkAddressesInnerLoop: check ' + address);
    }

    if (promiseArray.length > 0) {
      this.numAddressesChecked = 0;
      this.numAddressesToCheck = promiseArray.length;
      Promise.all(promiseArray)
        .then(function (response) {
          // Iterate over all the address balances and get a final balance
          console.log(
            'checkAddressesInnerLoop: Completed responses: ' + response.length
          );

          var arrayAmounts = response;
          var totalBalances = { TRD: 0 };
          for (var n in arrayAmounts) {
            var amountsObj = arrayAmounts[n];
            for (var currencyCode in amountsObj) {
              if (totalBalances[currencyCode] == null) {
                totalBalances[currencyCode] = 0;
              }
              totalBalances[currencyCode] += amountsObj[currencyCode];
              console.log(
                'checkAddressesInnerLoop: arrayAmounts[' +
                  n +
                  '][' +
                  currencyCode +
                  ']: ' +
                  arrayAmounts[n][currencyCode] +
                  ' total:' +
                  totalBalances[currencyCode]
              );
            }
          }
          this$1.walletLocalData.totalBalances = totalBalances;
          this$1.walletLocalDataDirty = true;

          if (!this$1.addressesChecked) {
            this$1.addressesChecked = true;
            this$1.abcTxLibCallbacks.addressesChecked(1);
            this$1.numAddressesChecked = 0;
            this$1.numAddressesToCheck = 0;
          }
          setTimeout(function () {
            this$1.checkAddressesInnerLoop();
          }, ADDRESS_POLL_MILLISECONDS);
        })
        .catch(function (e) {
          console.log(
            new Error('Error: checkAddressesInnerLoop: should not get here')
          );
          setTimeout(function () {
            this$1.checkAddressesInnerLoop();
          }, ADDRESS_POLL_MILLISECONDS);
        });
    } else {
      setTimeout(function () {
        this$1.checkAddressesInnerLoop();
      }, ADDRESS_POLL_MILLISECONDS);
    }
  }
};

ABCTxLibTRD.prototype.addressFromIndex = function addressFromIndex (index) {
  var addr = '' + index + '_' + this.walletLocalData.masterPublicKey;

  if (index === 0) {
    addr = addr + '__600000'; // Preload first addresss with some funds
  }
  return addr
};

ABCTxLibTRD.prototype.processAddressFromServer = function processAddressFromServer (address) {
    var this$1 = this;

  return this.fetchGet('address', address)
    .then(function (response) {
      return response.json()
    })
    .then(function (jsonObj) {
      console.log('processAddressFromServer: response.json():');
      console.log(jsonObj);
      var txids = jsonObj.txids;
      var idx = this$1.findAddress(jsonObj.address);
      if (idx === -1) {
        throw new Error(
          'Queried address not found in addressArray:' + jsonObj.address
        )
      }
      this$1.walletLocalData.addressArray[idx] = jsonObj;
      this$1.walletLocalDataDirty = true;

      // Iterate over txids in address
      for (var n in txids) {
        // This address has transactions
        var txid = txids[n];
        console.log('processAddressFromServer: txid:' + txid);

        if (
          this$1.findTransaction(PRIMARY_CURRENCY, txid) === -1 &&
          this$1.walletLocalData.transactionsToFetch.indexOf(txid) === -1
        ) {
          console.log(
            'processAddressFromServer: txid not found. Adding:' + txid
          );
          this$1.walletLocalData.transactionsToFetch.push(txid);
          this$1.walletLocalDataDirty = true;

          this$1.transactionsDirty = true;
        }
      }

      if (
        (txids != null && txids.length) ||
        this$1.walletLocalData.gapLimitAddresses.indexOf(jsonObj.address) !== -1
      ) {
        // Since this address is "used", make sure the unusedAddressIndex is incremented if needed
        if (idx >= this$1.walletLocalData.unusedAddressIndex) {
          this$1.walletLocalData.unusedAddressIndex = idx + 1;
          this$1.walletLocalDataDirty = true;
          console.log(
            'processAddressFromServer: set unusedAddressIndex:' +
              this$1.walletLocalData.unusedAddressIndex
          );
        }
      }

      this$1.numAddressesChecked++;
      var progress = this$1.numAddressesChecked / this$1.numAddressesToCheck;

      if (progress !== 1) {
        this$1.abcTxLibCallbacks.addressesChecked(progress);
      }

      return jsonObj.amounts
    })
    .catch(function (e) {
      console.log('Error fetching address: ' + address);
      return 0
    })
};

ABCTxLibTRD.prototype.findTransaction = function findTransaction (currencyCode, txid) {
  if (this.walletLocalData.transactionsObj[currencyCode] == null) {
    return -1
  }

  var currency = this.walletLocalData.transactionsObj[currencyCode];
  return currency.findIndex(function (element) {
    return element.txid === txid
  })
};

ABCTxLibTRD.prototype.findAddress = function findAddress (address) {
  return this.walletLocalData.addressArray.findIndex(function (element) {
    return element.address === address
  })
};

ABCTxLibTRD.prototype.sortTxByDate = function sortTxByDate (a, b) {
  return b.date - a.date
};

ABCTxLibTRD.prototype.addTransaction = function addTransaction (currencyCode, abcTransaction) {
  // Add or update tx in transactionsObj
  var idx = this.findTransaction(currencyCode, abcTransaction.txid);

  if (idx === -1) {
    console.log('addTransaction: adding and sorting:' + abcTransaction.txid);
    this.walletLocalData.transactionsObj[currencyCode].push(abcTransaction);

    // Sort
    this.walletLocalData.transactionsObj[currencyCode].sort(this.sortTxByDate);
    this.walletLocalDataDirty = true;
  } else {
    // Update the transaction
    this.walletLocalData.transactionsObj[currencyCode][idx] = abcTransaction;
    this.walletLocalDataDirty = true;
    console.log('addTransaction: updating:' + abcTransaction.txid);
  }
  this.transactionsChangedArray.push(abcTransaction);
};

ABCTxLibTRD.prototype.collectGarbage = function(){
  if (this.txUpdateFinished)
    return;
  
  var executedCount = 0;
  var totalExecutedCount = 0;
  var totalCount = 0;

  for (var i in this.txUpdateMonitoring){
    totalCount++;
    if (!this.txUpdateMonitoring[i].executed && (Date.now() - this.txUpdateMonitoring[i].requestTime) > 5000){
      this.tcpClient.write(this.txUpdateMonitoring[i].requestString+"\n");
      // console.log("RE-Requesting ", i,this.txUpdateMonitoring[i].requestString);
      this.txUpdateMonitoring[i].requestTime = Date.now();
    }
    if (this.txUpdateMonitoring[i].executed && i.substring(0,1) == "h" ){
      executedCount++;
    }
    if (this.txUpdateMonitoring[i].executed){
      totalExecutedCount++;
    }
  }

  var percentageCompleted = ((executedCount / this.txUpdateTotalEntries)).toFixed(2);
  var totalPercentageCompleted = ((totalExecutedCount / totalCount)).toFixed(2);
  var totalPercentageCompbined = (0.98*percentageCompleted*totalPercentageCompleted).toFixed(5);

  if (this.totalPercentageCompbined < totalPercentageCompbined){
    this.totalPercentageCompbined = totalPercentageCompbined;
  }

  if (this.abcTxLibCallbacks["onAdressesChecked"]){
    this.abcTxLibCallbacks.onAdressesChecked(this.totalPercentageCompbined);
  }
  console.log("Progress", this.totalPercentageCompbined, "%");
  
  

  if (totalExecutedCount == totalCount){
    return this.processElectrumData();
  }
  var this$1 = this;

  setTimeout(function(){
    this$1.collectGarbage();
  }, 200);

}

ABCTxLibTRD.prototype.processElectrumData = function () {
    
    // console.log("Start Electrum Update Process");

    var txMappedTxList = [];

    function sortMappedList(list){
      var _fl = 0;
      var a = {};

      for (var _i=0; _i<=list.length-2;_i++){
        for (var _j=_i+1; _j<=list.length-1;_j++){
          _fl = 0;
          for (var _o=0;_o<=list[_i].prevOuts.length-1;_o++){
            if (list[_i].prevOuts[_o]==list[_j].hash){
              _fl = 1;
            }
          }
          if (_fl){
            a = list[_i];
            list[_i] = list[_j];
            list[_j] = a;
            _j=_i+1;
          }
        }
      }
    }

    for (var i in this.txUpdateMonitoring){
      if (i.substring(0,1)=="h"){
        continue;
      }
      var data = this.txUpdateMonitoring[i].requestResult;
      var hash = this.txUpdateMonitoring[i].transactionHash;

      var prevOuts = [];
      var txd = hexToBytes(data);
      var tx = bcoin.tx.fromRaw(txd);
      var txjson = tx.toJSON();

      for (var k=0;k<=txjson.inputs.length-1;k++){
        prevOuts.push(txjson.inputs[k].prevout.hash);
        // console.log("TXData: ",txjson.inputs[k].prevout.hash);  
      }

      txMappedTxList.push({
        prevOuts: prevOuts,
        data: data,
        hash: hash
      })

     

      // var txd = hexToBytes(this.txUpdateMonitoring[i].requestResult);

      // var tx = new bcoin.tx.fromRaw(txd);
      // console.log(tx);
      //var r = this.wallet.db.addTXFromRaw(this.txUpdateMonitoring[i].requestResult);
    }

    sortMappedList(txMappedTxList);
    
    var this$1 = this;
    for (var j in txMappedTxList){
      this.txBalanceUpdateTotal++;
      this.wallet.db.addTXFromRaw(txMappedTxList[j].data).then(function(){
        this$1.txBalanceUpdateProgress++;
        var totalPercentageCompbined = 0.98 + 0.02*(this$1.txBalanceUpdateProgress/this$1.txBalanceUpdateTotal);

        if (this$1.totalPercentageCompbined < totalPercentageCompbined && totalPercentageCompbined<=1){
          this$1.totalPercentageCompbined = totalPercentageCompbined;
          if (this$1.abcTxLibCallbacks["onAdressesChecked"]){
            this$1.abcTxLibCallbacks.onAdressesChecked(this$1.totalPercentageCompbined);
          }
          console.log("Progress", this$1.totalPercentageCompbined, "%");
        }

      });
      // console.log(r);
    }
   
    // var s = JSON.stringify(result);
    // fs.writeFileSync("res.txt",s);

    this.txUpdateFinished = true;
}
// *************************************
// Save the wallet data store
// *************************************
ABCTxLibTRD.prototype.saveWalletDataStore = function saveWalletDataStore () {
    var this$1 = this;

  if (this.engineOn) {
    if (this.walletLocalDataDirty) {
      var walletJson = JSON.stringify(this.walletLocalData);
      this.walletLocalFolder
        .folder(DATA_STORE_FOLDER)
        .file(DATA_STORE_FILE)
        .setText(walletJson)
        .then(function (result) {
          this$1.walletLocalDataDirty = false;
          setTimeout(function () {
            this$1.saveWalletDataStore();
          }, SAVE_DATASTORE_MILLISECONDS);
        })
        .catch(function (err) {
          console.log(err);
        });
    }
  }
};

ABCTxLibTRD.prototype.incrementWatchList = function (number){
  var this$1 = this;
  for (var i=0;i<number;i++){
    this.wallet.createKey(0).then(function (res){
      this$1.txUpdateTotalEntries++;
      var address = res.getAddress('base58check');
      this$1.pool.watchAddress(address); 
      this$1.addresses.push(address);
      this$1.addressLimitLoop--;
      this$1.walletsScanQueue.push(address);
      if (this$1.addresses.length>=this$1.addressLimitLoop){
        this$1.increasingLimitLoop=0;
      }
    });
  }
  
}

// *************************************
// Public methods
// *************************************

ABCTxLibTRD.prototype.startEngine = function startEngine () {
  var this$1 = this;

  console.log(this.keyInfo);

  function hexToBytes(hex) {
    for (var bytes = new Buffer(hex.length/2), c = 0; c < hex.length; c += 2)
    bytes[c/2] = parseInt(hex.substr(c, 2), 16);
    return bytes;
  }


  return this.pool.open().then(function() {
    return this$1.walletdb.open();
  })
  .then(function() {

    var w = new bcoin.hd.PrivateKey()
    w.fromSeed("9f8c2359d1581ecc861600306a647f98b0bcfa258de9ece3a124ae1499988503")
    // w.fromSeed("5ad1fd622f79236309614c85c39b32b7999ef2ae175872e683c317db7375af5a")
    // 5ad1fd622f79236309614c85c39b32b7999ef2ae175872e683c317db7375af5a
    var key = w.toJSON()
    

    // var w = new bcoin.hd.PrivateKey()
    // var b = new Buffer (this$1.keyInfo.keys.bitcoinKey, "base64");
    // var hex = b.toString("hex");

    // // console.log("======== .>>>>", this$1.keyInfo.keys.bitcoinKey);
    // // console.log("======== .>>>>", hex);
    // // console.log("======== .>>>>", b.toString("hex"));
    
    // w.fromSeed(hex)
    
    // var key = w.toJSON()
    
    // console.log("XPRIV", key.xprivkey);

    return this$1.walletdb.ensure({
        "master": key.xprivkey,
        "id": "AirBitzMain"
      });
  })
  .then(function(wallet) {
    // console.log(wallet.account.keys);

    // console.log("Root m/0/0/0 => "+);
    this$1.wallet = wallet;
    this$1.masterWallet = wallet.getID()
      // console.log('Main address: '+ wallet.getAddress('base58check'));
      // console.log("RECIEVE DEPTH: ", this$1.wallet.account.receiveDepth);
    // Add our address to the spv filter.
    this$1.pool.watchAddress(wallet.getAddress());

    
      this$1.pool.watchAddress(wallet.getAddress('base58check'));
      
      wallet.getBalance(0).then(function(result){
          // console.log("Balance======>",result.confirmed);
          this$1.masterBalance = result.confirmed+result.unconfirmed;
      });
      // console.log("Generating 1000 nearest addresses");
      this$1.txUpdateTotalAddresses = 30;
      for (var i=0;i<this$1.txUpdateTotalAddresses;i++){
        this$1.wallet.createKey(0).then(function (res){
          var address = res.getAddress('base58check');
          this$1.pool.watchAddress(address); 
          this$1.addresses.push(address);
          this$1.walletsScanQueue.push(address);
          // console.log("watching " + address);
          if (this$1.addresses.length == this$1.txUpdateTotalAddresses){
            this$1.pool.connect().then(function() {
            // Start the blockchain sync.
              this$1.pool.startSync();

              this$1.tcpClient = net.connect("50001", "h.1209k.com", function(res) {
                  
                  this$1.txUpdateStarted = Date.now();
                  this$1.txUpdateTotalEntries = this$1.addresses.length;
                  // console.log("txUpdateStarted", this$1.txUpdateStarted);

                  this$1.rescan(0);
                  setTimeout(function(){
                    this$1.collectGarbage();
                  }, 1200);
                  
                  this$1.tcpClient.on("data",function(data){
                    this$1.rescan(data);
                  })
              });

              this$1.pool.on('tx', function(tx) {
                this$1.walletdb.addTX(tx);
              });

              this$1.wallet.on('balance', function(balance) {
                // console.log('Balance updated.',this$1.txBalanceUpdateTotal, this$1.txBalanceUpdateProgress);
                if (this$1.txBalanceUpdateTotal == this$1.txBalanceUpdateProgress){
                  console.log(bcoin.amount.btc(balance.unconfirmed));
                  this$1.abcTxLibCallbacks.onBalanceChanged(balance.unconfirmed);
                  wallet.getBalance(0).then(function(result){
                      // console.log("Balance======>",result);
                      this$1.masterBalance = result.confirmed + result.unconfirmed;
                  });  
                }
                
              });
            });
          }
        });
      }
      // process.exit();
    // Connect, start retrieving and relaying txs
    return this$1.wallet.getAccountPaths(0).then(function(result){
      // var a;
      // for (var i in result){
      //   a =result[i].toAddress();
      //   this$1.addresses.push(a.toString());
      //   this$1.pool.watchAddress(a.toString()); 
      //   console.log("Paths===:===>",a.toString(), this$1.addresses.length);
      // }
    }).then(function(){
      
    })
    
  });

  // var prom = new Promise(function (resolve, reject) {
  //   this$1.walletLocalFolder
  //     .folder(DATA_STORE_FOLDER)
  //     .file(DATA_STORE_FILE)
  //     .getText(DATA_STORE_FOLDER, 'walletLocalData')
  //     .then(function (result) {
  //       this$1.walletLocalData = new WalletLocalData(result);
  //       this$1.walletLocalData.masterPublicKey = this$1.keyInfo.keys.masterPublicKey;
  //       this$1.engineLoop();
  //       resolve();
  //     })
  //     .catch(function (err) {
  //       console.log(err);
  //       console.log('No walletLocalData setup yet: Failure is ok');
  //       this$1.walletLocalData = new WalletLocalData(null);
  //       this$1.walletLocalData.masterPublicKey = this$1.keyInfo.keys.masterPublicKey;
  //       this$1.walletLocalFolder
  //         .folder(DATA_STORE_FOLDER)
  //         .file(DATA_STORE_FILE)
  //         .setText(JSON.stringify(this$1.walletLocalData))
  //         .then(function (result) {
  //           this$1.engineLoop();
  //           resolve();
  //         })
  //         .catch(function (err) {
  //           console.log('Error writing to localDataStore:' + err);
  //           resolve();
  //         });
  //     });
  // });

  // return prom
};

ABCTxLibTRD.prototype.killEngine = function killEngine () {
  // disconnect network connections
  // clear caches

  this.engineOn = false;

  return true
};

// synchronous
ABCTxLibTRD.prototype.getBlockHeight = function getBlockHeight () {
  return this.walletLocalData.blockHeight
};

// asynchronous
ABCTxLibTRD.prototype.enableTokens = function enableTokens (tokens) {
    var this$1 = this;
    if ( tokens === void 0 ) tokens = [];

  for (var n in tokens) {
    var token = tokens[n];
    if (this$1.walletLocalData.enabledTokens.indexOf(token) !== -1) {
      this$1.walletLocalData.enabledTokens.push(token);
    }
  }
  // return Promise.resolve(dataStore.enableTokens(tokens))
};

// synchronous
ABCTxLibTRD.prototype.getTokenStatus = function getTokenStatus () {
  // return dataStore.getTokensStatus()
};

// synchronous
ABCTxLibTRD.prototype.getBalance = function getBalance (options) {
    if ( options === void 0 ) options = {};

  var currencyCode = PRIMARY_CURRENCY;
  if (options.currencyCode != null) {
    currencyCode = options.currencyCode;
  }
  
  var this$1 = this;

  setTimeout(function(){
    this$1.collectGarbage();
  }, 200);
  
  this.wallet.getBalance(0).then(function(result){
      // console.log("Balance======>",result.confirmed);
      this$1.masterBalance = result.confirmed+result.unconfirmed;
  });

  return this.masterBalance;
};

// synchronous
ABCTxLibTRD.prototype.getNumTransactions = function getNumTransactions (options) {
    if ( options === void 0 ) options = {};

  var currencyCode = PRIMARY_CURRENCY;
  if (options != null && options.currencyCode != null) {
    currencyCode = options.currencyCode;
  }
  return this.walletLocalData.transactionsObj[currencyCode].length
};

// asynchronous
ABCTxLibTRD.prototype.getTransactions = function getTransactions (options) {
    var this$1 = this;
    if ( options === void 0 ) options = {};

  var currencyCode = PRIMARY_CURRENCY;
  if (options != null && options.currencyCode != null) {
    currencyCode = options.currencyCode;
  }
  var prom = new Promise(function (resolve, reject) {
    var startIndex = 0;
    var numEntries = 0;
    if (options == null) {
      resolve(this$1.walletLocalData.transactionsObj[currencyCode].slice(0));
      return
    }
    if (options.startIndex != null && options.startIndex > 0) {
      startIndex = options.startIndex;
      if (
        startIndex >=
        this$1.walletLocalData.transactionsObj[currencyCode].length
      ) {
        startIndex =
          this$1.walletLocalData.transactionsObj[currencyCode].length - 1;
      }
    }
    if (options.numEntries != null && options.numEntries > 0) {
      numEntries = options.numEntries;
      if (
        numEntries + startIndex >
        this$1.walletLocalData.transactionsObj[currencyCode].length
      ) {
        // Don't read past the end of the transactionsObj
        numEntries =
          this$1.walletLocalData.transactionsObj[currencyCode].length -
          startIndex;
      }
    }

    // Copy the appropriate entries from the arrayTransactions
    var returnArray = [];

    if (numEntries) {
      returnArray = this$1.walletLocalData.transactionsObj[currencyCode].slice(
        startIndex,
        numEntries + startIndex
      );
    } else {
      returnArray = this$1.walletLocalData.transactionsObj[currencyCode].slice(
        startIndex
      );
    }
    resolve(returnArray);
  });

  return prom
};

// synchronous
ABCTxLibTRD.prototype.getFreshAddress = function getFreshAddress (options) {
    if ( options === void 0 ) options = {};

  // Algorithm to derive master pub key from master private key
  //master public key = "pub[masterPrivateKey]". ie. "pub294709fe7a0sb0c8f7398f"
  // Algorithm to drive an address from index is "[index]-[masterPublicKey]" ie. "102-pub294709fe7a0sb0c8f7398f"
  // return this$1.wallet.createKey(0).then(function(res){
  //   return res.getAddress('base58check');
  // });
  return this.masterWallet;
  if (this.addresses.length > this.wallet.account.receiveDepth)
  {
    var this$1 = this;
    this.wallet.createKey(0).then(function (res){
      this$1.pool.watchAddress(res.getAddress('base58check')); 
      // console.log(this$1.wallet.getAccount()); 
      // console.log("watching " + res.getAddress('base58check'));
    });
    return this.addresses[this.wallet.account.receiveDepth];
  }
  // return this.addressFromIndex(this.walletLocalData.unusedAddressIndex)
};

// synchronous
ABCTxLibTRD.prototype.addGapLimitAddresses = function addGapLimitAddresses (addresses, options) {
    var this$1 = this;

  for (var i in addresses) {
    if (this$1.walletLocalData.gapLimitAddresses.indexOf(addresses[i]) === -1) {
      this$1.walletLocalData.gapLimitAddresses.push(addresses[i]);
    }
  }
};

// synchronous
ABCTxLibTRD.prototype.isAddressUsed = function isAddressUsed (address, options) {
    if ( options === void 0 ) options = {};

  var idx = this.findAddress(address);
  if (idx !== -1) {
    var addrObj = this.walletLocalData.addressArray[idx];
    if (addrObj != null) {
      if (addrObj.txids.length > 0) {
        return true
      }
    }
  }
  idx = this.walletLocalData.gapLimitAddresses.indexOf(address);
  if (idx !== -1) {
    return true
  }
  return false
};

// synchronous
ABCTxLibTRD.prototype.makeSpend = function makeSpend (abcSpendInfo) {
    var this$1 = this;

    // console.log();
    // return;
    //1BynMxKHRyASZDNhX4q6pRtdzAb2m8d7jM

    //1DDeAGCAikvNemUHqCLJGsavAqQYfv5AbX

    var options = {
      subtractFee: true,
      outputs: [{
        address: abcSpendInfo.spendTargets[0].publicAddress,
        value: parseInt(abcSpendInfo.spendTargets[0].amountSatoshi)
      }]
    };
    console.log("signing", options);
    
    return this$1.wallet.send(options).then(function(tx) {
      console.log("after TX CREATED", tx);
      // Need to pass our passphrase back in to sign
 
      var rawTX = tx.toRaw().toString("hex");
      console.log('RAW tx:',rawTX);
      console.log('Fee:',tx.getFee());

      // request.post({ url:'https://insight.bitpay.com/api/tx/send', form: {rawtx:rawTX} }, function(err,httpResponse,body){ 
      //   console.log("Transaction status", body)
      // })
      return;
      // return this$1.pool.broadcast(tx);

    }).then(function() {
      console.log('tx sent!');
    });
    return;
  // returns an ABCTransaction data structure, and checks for valid info
  var prom = new Promise(function (resolve, reject) {
    // ******************************
    // Get the fee amount
    var networkFee = 50000;
    if (abcSpendInfo.networkFeeOption === 'high') {
      networkFee += 10000;
    } else if (abcSpendInfo.networkFeeOption === 'low') {
      networkFee -= 10000;
    } else if (abcSpendInfo.networkFeeOption === 'custom') {
      if (
        abcSpendInfo.customNetworkFee == null ||
        abcSpendInfo.customNetworkFee <= 0
      ) {
        reject(new Error('Invalid custom fee'));
        return
      } else {
        networkFee = abcSpendInfo.customNetworkFee;
      }
    }

    // ******************************
    // Calculate the total to send
    var totalSpends = {};
    totalSpends[PRIMARY_CURRENCY] = 0;
    var outputs = [];
    var spendTargets = abcSpendInfo.spendTargets;

    for (var n in spendTargets) {
      var spendTarget = spendTargets[n];
      if (spendTarget.amountSatoshi <= 0) {
        reject(new Error('Error: invalid spendTarget amount'));
        return
      }
      var currencyCode = PRIMARY_CURRENCY;
      if (spendTarget.currencyCode != null) {
        currencyCode = spendTarget.currencyCode;
      }
      if (totalSpends[currencyCode] == null) {
        totalSpends[currencyCode] = 0;
      }
      totalSpends[currencyCode] += spendTarget.amountSatoshi;
      outputs.push({
        currencyCode: currencyCode,
        address: spendTarget.publicAddress,
        amount: spendTarget.amountSatoshi
      });
    }
    totalSpends[PRIMARY_CURRENCY] += networkFee;

    for (var n$1 in totalSpends) {
      var totalSpend = totalSpends[n$1];
      // XXX check if spends exceed totals
      if (totalSpend > this$1.walletLocalData.totalBalances[n$1]) {
        reject(new Error('Error: insufficient balance for token:' + n$1));
        return
      }
    }

    // ****************************************************
    // Pick inputs. Picker will use all funds in an address
    var totalInputAmounts = {};
    var inputs = [];
    var addressArray = this$1.walletLocalData.addressArray;
    // Get a new address for change if needed
    var changeAddress = this$1.addressFromIndex(
      this$1.walletLocalData.unusedAddressIndex
    );

    for (var currencyCode$1 in totalSpends) {
      for (var n$2 in addressArray) {
        var addressObj = addressArray[n$2];
        if (addressObj.amounts[currencyCode$1] > 0) {
          if (totalInputAmounts[currencyCode$1] == null) {
            totalInputAmounts[currencyCode$1] = 0;
          }

          totalInputAmounts[currencyCode$1] += addressObj.amounts[currencyCode$1];
          inputs.push({
            currencyCode: currencyCode$1,
            address: addressObj.address,
            amount: addressObj.amounts[currencyCode$1]
          });
        }
        if (totalInputAmounts[currencyCode$1] >= totalSpends[currencyCode$1]) {
          break
        }
      }

      if (totalInputAmounts[currencyCode$1] < totalSpends[currencyCode$1]) {
        reject(
          new Error('Error: insufficient funds for token:' + currencyCode$1)
        );
        return
      }
      if (totalInputAmounts[currencyCode$1] > totalSpends[currencyCode$1]) {
        outputs.push({
          currencyCode: currencyCode$1,
          address: changeAddress,
          amount: totalInputAmounts[currencyCode$1] - totalSpends[currencyCode$1]
        });
      }
    }

    // **********************************
    // Create the unsigned ABCTransaction
    var abcTransaction = new ABCTransaction(
      null,
      null,
      null,
      null,
      totalSpends[PRIMARY_CURRENCY],
      networkFee,
      null,
      { inputs: inputs, outputs: outputs }
    );

    resolve(abcTransaction);
  });
  return prom
};

// asynchronous
ABCTxLibTRD.prototype.signTx = function signTx (abcTransaction) {
  var prom = new Promise(function (resolve, reject) {
    abcTransaction.signedTx = 'iwassignedjusttrustme';
    resolve(abcTransaction);
  });

  return prom
};

// asynchronous
ABCTxLibTRD.prototype.broadcastTx = function broadcastTx (abcTransaction) {
    var this$1 = this;

  var prom = new Promise(function (resolve, reject) {
    this$1.fetchPost('spend', abcTransaction.otherParams)
      .then(function (response) {
        return response.json()
      })
      .then(function (jsonObj) {
        // Copy params from returned transaction object to our abcTransaction object
        abcTransaction.blockHeight = jsonObj.blockHeight;
        abcTransaction.txid = jsonObj.txid;
        abcTransaction.date = jsonObj.txDate;
        resolve(abcTransaction);
      })
      .catch(function (e) {
        reject(new Error('Error: broadcastTx failed'));
      });
  });
  return prom
};

// asynchronous
ABCTxLibTRD.prototype.saveTx = function saveTx (abcTransaction) {
  var prom = new Promise(function (resolve, reject) {
    resolve(abcTransaction);
  });

  return prom
};

exports.makeBitcoinPlugin = makeBitcoinPlugin;
//# sourceMappingURL=index.js.map
