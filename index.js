require("dotenv").config();

const NodeCache = require("node-cache");
const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 10,
});

const abi = require("./abis.json");
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.TG_KEY);
const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.RPC));
const swapTopic =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

const { GoogleSpreadsheet } = require("google-spreadsheet");
const doc = new GoogleSpreadsheet(process.env.DOCUMENT_KEY);
var addresses = {};
var chats = {};

cache.on("expired", (key, value) => {
  fetchConfig();
});

web3.eth
  .subscribe("logs", {
    topics: [swapTopic],
  })
  .on("connected", async () => {
    console.log("[INFO]: Connected to Ethereum: Listening for token swaps:");
  })
  .on("data", async (swap) => {
    const from = web3.utils.toChecksumAddress("0x" + swap.topics[2].slice(26));
    if (Object.keys(addresses).indexOf(from) != -1) parseSwap(swap, from);
  })
  .on("error", async (error) => {
    console.log("[ERROR]: " + error);
  });

const getWallets = async () => {
  await loadSheet();
  var sheet = await doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const newAddresses = {};

  for (var i = 0; i < rows.length; i++) {
    var tempAddress = rows[i]["Wallet Address"].trim().toLowerCase();
    if (web3.utils.isAddress(tempAddress)) {
      var currentAddress = web3.utils.toChecksumAddress(tempAddress);

      if (web3.utils.checkAddressChecksum(currentAddress)) {
        newAddresses[currentAddress] = {
          name: rows[i]["Wallet Label"],
          type: rows[i]["Type"],
        };
      }
    } else {
      var label = rows[i]["Wallet Label"];
      if (label.indexOf("(invalid)") == -1) {
        rows[i]["Wallet Label"] = rows[i]["Wallet Label"] + "(invalid)";
        await rows[i].save();
      }
    }
  }
  addresses = newAddresses;
};

const getChatIds = async () => {
  await loadSheet();
  var sheet = await doc.sheetsByIndex[1];
  const rows = await sheet.getRows({ limit: 25 });
  const newChats = {};
  for (var i = 0; i < rows.length; i++) {
    var type = rows[i]["Type"];
    newChats[type] = rows[i]["Chat ID"];
  }
  chats = newChats;
};

const loadSheet = async () => {
  await doc.useServiceAccountAuth(require("./credentials.json"));
  await doc.loadInfo();
};

const parseSwap = async (swap, from) => {
  const pairContract = new web3.eth.Contract(abi.pair, swap.address);

  let amounts = web3.eth.abi.decodeParameters(
    ["uint256", "uint256", "uint256", "uint256"],
    swap.data
  );

  var [token0, token1] = await Promise.all([
    pairContract.methods
      .token0()
      .call()
      .catch((err) => console.log("Failed to fetch token0", err.data)),
    pairContract.methods
      .token1()
      .call()
      .catch((err) => console.log("Failed to fetch token1", err.data)),
  ]);

  const token0Contract = new web3.eth.Contract(abi.token, token0);
  const token1Contract = new web3.eth.Contract(abi.token, token1);

  var [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
    token0Contract.methods
      .symbol()
      .call()
      .catch((err) => console.log("Failed to fetch token0", err.data)),
    token0Contract.methods
      .decimals()
      .call()
      .catch((err) => console.log("Failed to fetch token0", err.data)),
    token1Contract.methods
      .symbol()
      .call()
      .catch((err) => console.log("Failed to fetch token1", err.data)),
    token1Contract.methods
      .decimals()
      .call()
      .catch((err) => console.log("Failed to fetch token1", err.data)),
  ]);

  let inputToken, outputToken;
  if (amounts[0] != 0)
    inputToken = {
      //address: token0,
      symbol: symbol0,
      amount: amounts[0] / Math.pow(10, decimals0),
    };
  else
    inputToken = {
      //address: token1,
      symbol: symbol1,
      amount: amounts[1] / Math.pow(10, decimals1),
    };
  if (amounts[2] != 0)
    outputToken = {
      //address: token0,
      symbol: symbol0,
      amount: amounts[2] / Math.pow(10, decimals0),
    };
  else
    outputToken = {
      //address: token1,
      symbol: symbol1,
      amount: amounts[3] / Math.pow(10, decimals1),
    };
  sendMessage(swap, inputToken, outputToken, from);
};

const sendMessage = async (swap, inputToken, outputToken, from) => {
  var wallet = addresses[from];
  var channel = chats[wallet.type];

  var message = `<b>${wallet.name}</b>: ${inputToken.amount.toFixed(4)} <b>${
    inputToken.symbol
  }</b> for ${outputToken.amount.toFixed(4)} <b>${
    outputToken.symbol
  }</b>\r\n<a href="https://etherscan.io/tx/${
    swap.transactionHash
  }">details</a>`;

  try {
    bot.sendMessage(channel, message, { parse_mode: "html" });
  } catch (e) {
    console.log(e);
  }
};

const fetchConfig = () => {
  cache.set("i", true);
  getWallets();
  getChatIds();
};

fetchConfig();
