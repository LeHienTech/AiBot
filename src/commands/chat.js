const axios = require('axios');
const { getWeatherContext } = require('../features/weather');
const { searchWeb } = require('../features/web-search');
const { AI_CONFIG, DISCORD_MAX_LENGTH } = require('../config');

/**
 * Xử lý lệnh !chat <câu hỏi> — Trợ lý AI
 */
async function execute(message) {
    const userPrompt = message.content.slice(6).trim();
    if (!userPrompt) return message.reply('Bạn muốn trò chuyện gì? Gõ `!chat + nội dung`.');

    try {
        await message.channel.sendTyping();

        // ─── Thu thập context từ web ───
        let webContext = '';

        // Ưu tiên Weather API nếu là câu hỏi thời tiết
        const weatherContext = await getWeatherContext(userPrompt);
        if (weatherContext) {
            webContext = weatherContext;
        }

        // Nếu không phải thời tiết, tìm kiếm web
        if (!webContext) {
            webContext = await searchWeb(userPrompt);
        }

        // ─── Xây dựng System Prompt ───
        const currentTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

        let systemPrompt = `Bạn là trợ lý bot Discord vui tính, năng động và am hiểu về văn hóa đại chúng (Game, Anime, Phim ảnh). 
        ⚠️ QUY TẮC TỐI THƯỢNG: 
        1. BẠN PHẢI TRẢ LỜI 100% BẰNG TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG DÙNG TIẾNG ANH.
        2. Nói chuyện tự nhiên, gần gũi như người thật đang chat trên Discord (có thể dùng icon ^^, :D, nha, nè...).
        3. KHÔNG hiển thị các bước suy nghĩ, KHÔNG dùng thẻ <thought> hay <think>. Chỉ đưa ra câu trả lời cuối cùng.
        
        ⏰ THÔNG TIN QUAN TRỌNG: Hôm nay là ngày ${currentTime}.
        
        - Khi người dùng hỏi về các tác phẩm (Game, Anime, Phim) "gần đây", "mới nhất" hoặc "đang hot", hãy TỰ TIN đề xuất những tác phẩm NỔI TIẾNG, CÓ THẬT và ĐÃ RA MẮT.
        - TUYỆT ĐỐI KHÔNG BỊA ĐẶT THÔNG TIN.`;

        if (webContext) {
            systemPrompt += `\n\n[DỮ LIỆU TỪ INTERNET: "${webContext}"] 
            -> Hướng dẫn: ĐỌC KỸ dữ liệu Internet. NẾU dữ liệu này thực sự chứa thông tin cập nhật (tin tức, thời tiết, sự kiện mới), BẮT BUỘC dùng nó để trả lời. 
            -> NẾU dữ liệu Internet lỗi thời hoặc không khớp với ngày hiện tại (${currentTime}), HÃY BỎ QUA và dùng kiến thức chuẩn xác của bạn để tư vấn.`;
        }

        // ─── Gọi AI API ───
        const requestConfig = {};
        if (AI_CONFIG.API_KEY) {
            requestConfig.headers = {
                'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
            };
        }

        const response = await axios.post(AI_CONFIG.URL, {
            model: AI_CONFIG.MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: AI_CONFIG.TEMPERATURE,
        }, requestConfig);

        let aiReply = response.data.choices[0].message.content.trim();

        // ─── Xóa thẻ suy nghĩ (thought/think) của các model reasoning ───
        aiReply = aiReply.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
        aiReply = aiReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // Discord giới hạn 2000 ký tự
        if (aiReply.length > DISCORD_MAX_LENGTH) {
            aiReply = aiReply.substring(0, DISCORD_MAX_LENGTH - 3) + '...';
        }

        await message.reply(aiReply);

    } catch (error) {
        console.error('Lỗi kết nối AI API:', error.message);
        message.reply('❌ Hiện không kết nối được với Ai');
    }
}

module.exports = { execute };
