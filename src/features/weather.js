const axios = require('axios');
const { TIMEOUTS } = require('../config');

const WEATHER_KEYWORDS = [
    'thời tiết', 'nhiệt độ', 'mưa', 'nắng', 'nóng', 'lạnh',
    'độ ẩm', 'gió', 'bão', 'weather', 'temperature'
];

/**
 * Phát hiện câu hỏi thời tiết & gọi wttr.in API
 * @param {string} query - Câu hỏi của người dùng
 * @returns {string|null} - Thông tin thời tiết hoặc null
 */
async function getWeatherContext(query) {
    // Không phải câu hỏi thời tiết → bỏ qua
    if (!WEATHER_KEYWORDS.some(kw => query.toLowerCase().includes(kw))) {
        return null;
    }

    // ─── Trích xuất tên thành phố từ câu tiếng Việt ───
    let city = '';
    const patterns = [
        /(?:ở|tại)\s+(.+?)(?:\s+(?:hôm nay|ngày mai|tuần này|tháng này)|$)/i,
        /thời tiết\s+(?:hôm nay\s+)?(?:ở|tại)?\s*(.+)/i,
        /(.+?)\s+(?:hôm nay|ngày mai)/i,
    ];

    for (const p of patterns) {
        const m = query.match(p);
        if (m && m[1].trim().length > 1) {
            city = m[1].trim();
            break;
        }
    }

    // ─── Lọc bỏ các từ để hỏi khỏi tên thành phố ───
    if (city) {
        const stopWords = ['như thế nào', 'ra sao', 'thế nào', 'mấy độ', 'bao nhiêu độ', 'có mưa không', 'có nắng không', 'không', 'vậy', 'nhỉ', '?'];
        let cleanCity = city.toLowerCase();
        for (const w of stopWords) {
            cleanCity = cleanCity.replace(new RegExp(w, 'gi'), '').trim();
        }
        city = cleanCity;
    }

    if (!city || city.length < 2) {
        console.log('⚠️ [Weather] Không tìm thấy tên thành phố cụ thể, dùng mặc định Hà Nội.');
        city = 'Hanoi'; 
    }

    // ─── Gọi wttr.in: miễn phí, không cần API key ───
    try {
        console.log(`🌤️ [Weather API] Tra cứu thời tiết: "${city}"`);

        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
        const res = await axios.get(url, {
            timeout: TIMEOUTS.WEATHER_API,
            headers: {
                'User-Agent': 'curl/7.68.0',
                'Accept': 'application/json'
            }
        });

        const d = res.data;
        const cur = d.current_condition[0];
        const tod = d.weather[0];

        const descVI = cur.lang_vi?.[0]?.value;
        const descEN = cur.weatherDesc?.[0]?.value || '';
        const desc = descVI || descEN;

        const areaName = d.nearest_area?.[0]?.areaName?.[0]?.value || city;
        const countryName = d.nearest_area?.[0]?.country?.[0]?.value || '';
        const rainChance = tod.hourly?.[4]?.chanceofrain ?? '?';

        const result = [
            `📍 Vị trí: ${areaName}${countryName ? ', ' + countryName : ''}`,
            `🌡️ Nhiệt độ hiện tại: ${cur.temp_C}°C (cảm giác như ${cur.FeelsLikeC}°C)`,
            `📋 Tình trạng: ${desc}`,
            `📊 Nhiệt độ trong ngày: thấp nhất ${tod.mintempC}°C - cao nhất ${tod.maxtempC}°C`,
            `💧 Độ ẩm: ${cur.humidity}%`,
            `💨 Tốc độ gió: ${cur.windspeedKmph} km/h`,
            `🌧️ Khả năng mưa: ${rainChance}%`,
        ].join('\n');

        console.log(`✅ [Weather API] OK:\n${result}`);
        return result;

    } catch (e) {
        console.log('⚠️ [Weather API] Lỗi wttr.in:', e.message);
        return null;
    }
}

module.exports = { getWeatherContext };
