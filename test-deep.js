const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent('những tựa game nổi bật 2026') + '&kl=vn-vi', { 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
}).then(async res => { 
    const $ = cheerio.load(res.data); 
    const firstUrlAttr = $('.result__url').first().attr('href'); 
    if (!firstUrlAttr) {
        console.log('No URL found');
        return;
    }
    
    // Decode DuckDuckGo redirect URL
    let url = firstUrlAttr;
    if (url.includes('//duckduckgo.com/l/?uddg=')) {
        url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
    } else if (url.startsWith('/l/?uddg=')) {
        url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
    }
    
    console.log('Decoded URL:', url); 
    try {
        const articleRes = await axios.get(url, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }); 
        const _$ = cheerio.load(articleRes.data); 
        // Remove scripts and styles
        _$('script, style').remove();
        console.log(_$('p, h1, h2, h3, li').text().replace(/\s+/g, ' ').substring(0, 1000)); 
    } catch (e) {
        console.log('Fetch article error:', e.message);
    }
}).catch(err => console.error(err.message));
