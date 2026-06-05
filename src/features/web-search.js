const axios = require('axios');
const cheerio = require('cheerio');
const { TIMEOUTS } = require('../config');

/**
 * Tìm kiếm web qua DuckDuckGo Instant Answer API
 * @param {string} query - Câu tìm kiếm
 * @returns {string} - Kết quả tìm kiếm hoặc chuỗi rỗng
 */
async function ddgInstantAnswer(query) {
    try {
        const ddgApiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kl=vn-vi`;
        const ddgApiRes = await axios.get(ddgApiUrl, {
            timeout: TIMEOUTS.DDG_API,
            headers: { 'User-Agent': 'Mozilla/5.0 (Discord Bot)' }
        });

        const d = ddgApiRes.data;
        const parts = [];

        if (d.Answer) parts.push(`[Đáp án trực tiếp] ${d.Answer}`);
        if (d.Abstract) parts.push(`[Tóm tắt] ${d.Abstract}`);
        if (d.Definition) parts.push(`[Định nghĩa] ${d.Definition}`);
        if (d.RelatedTopics?.length > 0) {
            d.RelatedTopics
                .filter(t => t.Text?.length > 20)
                .slice(0, 3)
                .forEach(t => parts.push(t.Text));
        }

        if (parts.length > 0) {
            const result = parts.join('\n');
            console.log(`✅ [DDG API] ${parts.length} mục: ${result.substring(0, 200)}...`);
            return result;
        }
    } catch (e) {
        console.log('⚠️ [DDG API] Lỗi:', e.message);
    }

    return '';
}

/**
 * HTML Scrape + Deep Scrape từ DuckDuckGo (fallback)
 * @param {string} query - Câu tìm kiếm
 * @returns {string} - Nội dung scrape hoặc chuỗi rỗng
 */
async function ddgHtmlScrape(query) {
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
        const snippets = [];
        let firstUrl = null;

        $('.result').each((i, el) => {
            if (i >= 3) return false;

            const snippet = $(el).find('.result__snippet').text().trim();
            if (snippet.length > 30) snippets.push(snippet);

            if (i === 0) {
                const href = $(el).find('.result__a').attr('href');
                if (href?.includes('uddg=')) {
                    firstUrl = decodeURIComponent(href.split('uddg=')[1].split('&')[0]);
                } else if (href?.startsWith('http')) {
                    firstUrl = href;
                }
            }
        });

        // Deep Scrape: truy cập URL đầu tiên
        if (firstUrl?.startsWith('http')) {
            try {
                console.log(`🔍 [Deep Scrape] URL: ${firstUrl}`);
                const articleRes = await axios.get(firstUrl, {
                    timeout: TIMEOUTS.DEEP_SCRAPE,
                    maxRedirects: 3,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });

                const _$ = cheerio.load(articleRes.data);
                _$('script, style, nav, header, footer, aside, .ads, .sidebar, .menu').remove();

                const mainSel = 'article, main, [role="main"], .content, .article-body, .post-content, #content';
                const source = _$(mainSel).length > 0 ? _$(mainSel) : _$('body');

                const paragraphs = [];
                source.find('p, h2, h3').each((i, el) => {
                    const text = _$(el).text().replace(/\s+/g, ' ').trim();
                    if (text.length > 60 && !text.match(/^(menu|navigation|login|copyright)/i)) {
                        paragraphs.push(text);
                    }
                });

                const deepContent = paragraphs.slice(0, 8).join(' | ');
                const result = deepContent.length > 200
                    ? deepContent.substring(0, 2000)
                    : snippets.join(' | ');

                console.log(`✅ [Deep Scrape] OK: ${result.substring(0, 200)}...`);
                return result;
            } catch (e) {
                console.log('⚠️ [Deep Scrape] Thất bại:', e.message);
                return snippets.join(' | ');
            }
        }

        return snippets.join(' | ');
    } catch (e) {
        console.log('⚠️ [HTML Scrape] Lỗi:', e.message);
    }

    return '';
}

/**
 * Tìm kiếm web tổng hợp: DDG API → HTML Scrape → Deep Scrape
 * @param {string} query - Câu tìm kiếm
 * @returns {string} - Kết quả tìm kiếm hoặc chuỗi rỗng
 */
async function searchWeb(query) {
    // Thử DDG Instant Answer API trước
    let result = await ddgInstantAnswer(query);
    if (result) return result;

    // Fallback: HTML Scrape + Deep Scrape
    result = await ddgHtmlScrape(query);
    return result;
}

module.exports = { searchWeb };
