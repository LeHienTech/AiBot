const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent('thời tiết hà nội'), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
}).then(res => {
    const $ = cheerio.load(res.data);
    const results = [];
    $('.result__snippet').each((i, el) => {
        results.push($(el).text().trim());
    });
    console.log(results.slice(0,3));
}).catch(err => console.error(err.message));
