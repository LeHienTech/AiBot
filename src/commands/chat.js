const axios = require('axios');
const { getWeatherContext } = require('../features/weather');
const { searchWeb } = require('../features/web-search');
const { LM_STUDIO, DISCORD_MAX_LENGTH } = require('../config');

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

        let systemPrompt = `Bạn là trợ lý bot Discord vui tính và am hiểu về văn hóa đại chúng (Game, Anime, Phim ảnh). 
        ⚠️ QUY TẮC TỐI THƯỢNG: BẠN PHẢI TRẢ LỜI 100% BẰNG TIẾNG VIỆT.
        
        ⏰ THÔNG TIN QUAN TRỌNG: Hôm nay là ngày ${currentTime}.
        
        - Khi người dùng hỏi về các tác phẩm (Game, Anime, Phim) "gần đây", "mới nhất" hoặc "đang hot", hãy TỰ TIN đề xuất những tác phẩm NỔI TIẾNG, CÓ THẬT và ĐÃ RA MẮT.
        - TUYỆT ĐỐI KHÔNG BỊA ĐẶT THÔNG TIN (Ví dụ: Không ghép sai studio sản xuất phim).`;

        if (webContext) {
            systemPrompt += `\n\n[DỮ LIỆU TỪ INTERNET: "${webContext}"] 
            -> Hướng dẫn: ĐỌC KỸ dữ liệu Internet. NẾU dữ liệu này thực sự chứa thông tin cập nhật (tin tức thời sự, tỷ số, thời tiết, lịch chiếu phim cụ thể), BẮT BUỘC dùng nó để trả lời. 
            -> NẾU dữ liệu Internet chỉ là thông tin rác, lỗi thời hoặc không khớp với ngày hiện tại (${currentTime}), HÃY LỜ NÓ ĐI và dùng kiến thức chuẩn xác của bạn để tư vấn.`;
        }

        // ─── Gọi LM Studio ───
        const response = await axios.post(LM_STUDIO.URL, {
            model: LM_STUDIO.MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: LM_STUDIO.TEMPERATURE,
            max_tokens: LM_STUDIO.MAX_TOKENS,
        });

        let aiReply = response.data.choices[0].message.content.trim();

        // Discord giới hạn 2000 ký tự
        if (aiReply.length > DISCORD_MAX_LENGTH) {
            aiReply = aiReply.substring(0, DISCORD_MAX_LENGTH - 3) + '...';
        }

        await message.reply(aiReply);

    } catch (error) {
        console.error('Lỗi kết nối LM Studio:', error.message);
        message.reply('❌ Không thể kết nối AI. Đảm bảo LM Studio đang chạy Local Server ở cổng 1234!');
    }
}

module.exports = { execute };
