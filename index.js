const { WebhookClient } = require('discord.js');
const fs = require("fs");
const Web3 = require('web3');
const collectionData = require('./collectionData')
require('dotenv').config()

const InputDataDecoder = require('ethereum-input-data-decoder');
const decoder = new InputDataDecoder('./abi.json');

const timeout = 6000 //Milliseconds (1min = 60000ms)

const web3 = new Web3(process.env.NODE_URL);
const web3socket = new Web3(process.env.SOCKET_URL);

//ENTER SMART CONTRACT ADDRESS BELOW. see abi.js if you want to modify the abi
const CONTRACT_ADDRESS = "contract_address";

const CONTRACT_ABI = require('./abi.json');
const marketplace = new web3socket.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
const bucket = JSON.parse(fs.readFileSync("./database.json"));
const allUsers = JSON.parse(fs.readFileSync("./users.json"));

//Clean State
function reset() {
    if (bucket.length > 0) {
        for (let i = 0; i < bucket.length; i++) {
            if (bucket[i].token_address.length < 5) {
                bucket.splice(i, 1);
                i--
                console.log("Removed unwanted data from bucket!");
            }
            bucket[i].sales = 0
        }
        fs.writeFileSync('./database.json', JSON.stringify(bucket.sort((a, b) => b.sales - a.sales), null, 2))
    }
}



async function getTransferDetails(data_events) {
    const error = JSON.parse(fs.readFileSync("./error.json"));

    let txHash = data_events.transactionHash
    let from = data_events['returnValues']['maker'];
    let to = data_events['returnValues']['taker'];
    let amount = data_events['returnValues']['price'];
    let converted_amount = web3.utils.fromWei(amount);

    const mystery = await error.filter((e) => { return e === txHash })
    if (mystery.length === 0) {
        const getInputData = await web3.eth.getTransaction(txHash);

        const contractAddressRAW = await decoder.decodeData(getInputData.input).inputs[0][4];
        const contractAddress = "0x" + contractAddressRAW.toString();

        if (contractAddress.length < 6) {
            if (!error.includes(txHash)) {
                error.push(txHash);
            }
        } else {
            try {

                if (!allUsers.includes(from)) {
                    allUsers.push(from)
                }

                if (!allUsers.includes(to)) {
                    allUsers.push(to)
                }

                const filter = await bucket.filter((e) => { return e.token_address === contractAddress })

                const DATA = { token_address: contractAddress, sales: 1, listing: 0 }

                if (filter.length === 0) {
                    bucket.push(DATA)

                } else if (filter.length > 1) {
                    console.log(`Got more data on ${contractAddress}`)
                }
                else {
                    const inBucket = await bucket.filter((e) => { return e.token_address === contractAddress })[0]
                    bucket[bucket.indexOf(inBucket)].sales++
                }
            } catch (error) {
                console.log(`Error at 0x${txHash}\n`)
                // console.log(error)
            }
        }
    }
    fs.writeFileSync('./error.json', JSON.stringify(error, null, 2))
    fs.writeFileSync('./database.json', JSON.stringify(bucket.sort((a, b) => b.sales - a.sales), null, 2))
    fs.writeFileSync('./users.json', JSON.stringify(allUsers, null, 2))

};

reset()

marketplace.events.OrdersMatched(// Gets the Sales;
    { fromBlock: "latest", toBlock: "latest" },
    async (errors, events) => {
        if (!errors) {
            // process events
            try {
                await getTransferDetails(events)

            } catch (e) { console.log(e) }
        }
    })

console.log("Started at", new Date().toLocaleString())

setInterval(async () => {
    let result = ""

    const blacklist = JSON.parse(fs.readFileSync("./blacklist.json"));

    const storage = bucket.filter((e) => { return !blacklist.includes(e.token_address) && e.sales > 1 })

    console.log(allUsers.length)
    console.log("Processing Data at time:", new Date().toLocaleString())

    for (let i = 0; i < storage.length; i++) {
        const asset = storage[i]
        try {
            if (i < 3 && !blacklist.includes(asset.token_address)) {
                if (!asset.name || !asset.slug) {

                    const data = await collectionData(asset.token_address)

                    const assetInfo = bucket[bucket.indexOf(asset)]
                    assetInfo.name = data.name
                    assetInfo.slug = data.collection.slug
                    assetInfo.avatar = data.image_url

                    assetInfo.website = data.external_link ? data.external_link : "No Website"

                    assetInfo.discord = data.collection.discord_url ? data.collection.discord_url : "No Discord"
                    assetInfo.medium = data.collection.medium_username ? data.collection.medium_username : "No Medium"
                    assetInfo.twitter = data.collection.twitter_username ? data.collection.twitter_username : "No Twitter"
                    assetInfo.instagram = data.collection.instagram_username ? data.collection.twitter_username : "No Instagram"

                    assetInfo.buyFloor = `https://opensea.io/collection/${data.collection.slug}?search[sortAscending]=true&search[sortBy]=PRICE&search[toggles][0]=BUY_NOW`
                    assetInfo.activity = `https://opensea.io/activity/${data.collection.slug}`

                    result += `\n**${assetInfo.name}**\n**Sales**: *${assetInfo.sales}*\n[Buy Floor](<${assetInfo.buyFloor}>) or [Check Activity](<${assetInfo.activity}>)\n------------------------------`
                } else {
                    result += `\n**${asset.name}**\n**Sales**: *${asset.sales}*\n[Buy Floor](<${asset.buyFloor}>) or [Check Activity](<${asset.activity}>)\n------------------------------`
                }

            }
        } catch (error) {
            console.log(error)
            console.log("Metadata Error", asset.token_address)
        }
    }

    if (result.length > 0) {
        const webhookClient = new WebhookClient({ url: "discord_webhook_link" });
        webhookClient.send({
            content: `\nTop projects by volume over the last ${timeout / 60000} minutes` + result,
            avatarURL: 'https://storage.googleapis.com/opensea-static/Logomark/Logomark-Blue.png',
        });
    }

    //Always Save at last
    fs.writeFileSync('./database.json', JSON.stringify(bucket.sort((a, b) => b.sales - a.sales), null, 2))

    reset()

}, timeout);