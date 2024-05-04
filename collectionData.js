const puppeteer = require('puppeteer');

async function collectionData(address) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    let data;

    page.on('response', async response => {
        const url = response.url();
        try {
            data = await response.json()
            return data
        } catch (error) {
            console.error(`Failed getting data from: ${url}`);
        }
    })

    await page.goto(`https://api.opensea.io/api/v1/asset_contract/${address}?format=json`);

    await page.close();
    await browser.close();

    return data
}


module.exports = collectionData