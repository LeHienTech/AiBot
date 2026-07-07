const axios = require('axios');
const cheerio = require('cheerio');
const { TIMEOUTS } = require('../config');

// Lấy URL thực từ link trung gian của DDG
function extractDdgUrl(href) {
    if (href?.includes('uddg=')) {
        return decodeURIComponent(href.split('uddg=')[1].split('&')[0]);
    } else if (href?.startsWith('http')) {
        return href;
    }
    return null;
}

/**
 * HTML Scrape từ DuckDuckGo để lấy Top URLs từ mảng các queries
 */
async function getTopUrlsFromQueries(queries) {
    const urls = new Set();
    const snippets = [];

    for (const query of queries) {
        if (urls.size >= 5) break;
        try {
            const ddgHtmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=vn-vi`;
            const ddgRes = await axios.get(ddgHtmlUrl, {
                timeout: TIMEOUTS.DDG_HTML,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
                }
            });

            const $ = cheerio.load(ddgRes.data);

            $('.result').each((i, el) => {
                if (urls.size >= 5) return false;

                const snippet = $(el).find('.result__snippet').text().trim();
                if (snippet.length > 30) snippets.push(snippet);

                const href = $(el).find('.result__a').attr('href');
                const url = extractDdgUrl(href);
                // Bỏ qua mạng xã hội và video vì bot không đọc được
                if (url && !url.includes('youtube.com') && !url.includes('facebook.com') && !url.includes('tiktok.com')) {
                    urls.add(url);
                }
            });
        } catch (e) {
            console.log(`⚠️ [DDG HTML] Lỗi tìm kiếm "${query}":`, e.message);
        }
    }

    return { urls: Array.from(urls), snippets };
}

/**
 * Deep Scrape một mảng các URLs song song
 */
async function deepScrapeUrls(urls, fallbackSnippets) {
    console.log(`🔍 [Deep Scrape] Chuẩn bị cào ${urls.length} URLs...`);
    const promises = urls.map(url => axios.get(url, {
        timeout: TIMEOUTS.DEEP_SCRAPE,
        maxRedirects: 3,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }).then(res => ({ url, data: res.data })));

    const results = await Promise.allSettled(promises);
    const contextParts = [];

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
            try {
                const { url, data } = result.value;
                const _$ = cheerio.load(data);
                _$('script, style, nav, header, footer, aside, .ads, .sidebar, .menu').remove();

                const mainSel = 'article, main, [role="main"], .content, .article-body, .post-content, #content';
                const source = _$(mainSel).length > 0 ? _$(mainSel) : _$('body');

                const paragraphs = [];
                source.find('p, h2, h3, li, div.text').each((_, el) => {
                    const text = _$(el).text().replace(/\s+/g, ' ').trim();
                    if (text.length > 30 && !text.match(/^(menu|navigation|login|copyright|create your|sign in|what can you do|by creating a|join the community|forgot password)/i)) {
                        paragraphs.push(text);
                    }
                });

                const content = paragraphs.slice(0, 15).join(' | ');
                if (content.length > 100) {
                    contextParts.push(`[Nguồn: ${url}]\n${content.substring(0, 2000)}`);
                    console.log(`✅ [Deep Scrape] Lấy thành công: ${url}`);
                }
            } catch (e) {
                console.log(`⚠️ [Deep Scrape] Lỗi bóc tách ${urls[i]}:`, e.message);
            }
        } else {
            console.log(`⚠️ [Deep Scrape] Thất bại truy cập ${urls[i]}:`, result.reason.message);
        }
    }

    if (contextParts.length > 0) {
        return contextParts.join('\n\n');
    }
    
    if (fallbackSnippets.length > 0) {
        return `[Nguồn: DuckDuckGo Snippets]\n${fallbackSnippets.join(' | ').substring(0, 2000)}`;
    }

    return '';
}

/**
 * Tìm kiếm web tổng hợp cho RAG
 * @param {string|string[]} queries - Câu tìm kiếm hoặc mảng từ khóa
 */
async function searchWeb(queries) {
    const queryArray = Array.isArray(queries) ? queries : [queries];
    console.log(`🔍 [Web Search] Bắt đầu tìm kiếm:`, queryArray);

    const { urls, snippets } = await getTopUrlsFromQueries(queryArray);
    
    if (urls.length === 0) {
        if (snippets.length > 0) return `[Nguồn: DuckDuckGo Snippets]\n${snippets.join(' | ').substring(0, 2000)}`;
        return '';
    }

    return await deepScrapeUrls(urls, snippets);
}

module.exports = { searchWeb };
