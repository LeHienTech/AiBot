const axios = require('axios');
const { getWeatherContext } = require('../features/weather');
const { searchWeb } = require('../features/web-search');
const { AI_CONFIG, DISCORD_MAX_LENGTH } = require('../config');

/**
 * Phân tích ý định người dùng để tạo Search Queries
 */
async function analyzeIntent(userPrompt) {
    try {
        const intentPrompt = `Bạn là một hệ thống phân tích ý định. Nhiệm vụ của bạn là xem câu nói của người dùng có cần tìm kiếm thông tin trên mạng (tin tức, sự kiện mới, kiến thức cụ thể, giá cả, thông tin có thật) hay chỉ là giao tiếp bình thường (chào hỏi, tâm sự).
Trả về ĐÚNG định dạng JSON sau, không kèm bất kỳ lời giải thích nào:
{
  "needs_search": true/false,
  "queries": ["từ khóa 1", "từ khóa 2"] // Tối đa 2 từ khóa tối ưu nhất cho Google Search. Bỏ trống nếu needs_search là false.
}

--- CÂU NÓI CỦA NGƯỜI DÙNG ---
${userPrompt}`;
        
        const requestConfig = {};
        if (AI_CONFIG.API_KEY) {
            requestConfig.headers = { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` };
        }

        const response = await axios.post(AI_CONFIG.URL, {
            model: AI_CONFIG.MODEL,
            messages: [{ role: 'user', content: intentPrompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        }, requestConfig);

        let result = response.data.choices[0].message.content.trim();
        result = result.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
        result = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        result = result.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(result);
    } catch (e) {
        console.error('⚠️ [Intent] Lỗi phân tích ý định, dùng fallback:', e.message);
        return { needs_search: true, queries: [userPrompt] };
    }
}

/**
 * Xử lý lệnh !chat <câu hỏi> — Trợ lý AI (RAG Pipeline)
 */
async function execute(message) {
    const userPrompt = message.content.slice(6).trim();
    if (!userPrompt) return message.reply('Bạn muốn trò chuyện gì? Gõ `!chat + nội dung`.');

    try {
        await message.channel.sendTyping();

        // ─── Bước 1: Phân tích Ý định & Tạo Câu lệnh ───
        let webContext = '';
        const intent = await analyzeIntent(userPrompt);
        
        if (intent.needs_search && intent.queries && intent.queries.length > 0) {
            console.log('🔍 [Intent] Cần tìm kiếm:', intent.queries);
            
            // Ưu tiên Weather API nếu là câu hỏi thời tiết
            const weatherContext = await getWeatherContext(userPrompt);
            if (weatherContext) {
                webContext = weatherContext;
            } else {
                // ─── Bước 2 & 3: Truy xuất và Lọc thông tin mạng (Top 3 sites) ───
                webContext = await searchWeb(intent.queries);
            }
        } else {
            console.log('🔍 [Intent] Giao tiếp bình thường, không search.');
        }

        // ─── Bước 4: Nạp vào Ngữ cảnh ───
        const currentTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        let systemPrompt = `Bạn là trợ lý bot Discord vui tính, năng động và am hiểu về văn hóa đại chúng (Game, Anime, Phim ảnh). 
        ⚠️ QUY TẮC TỐI THƯỢNG: 
        1. BẠN PHẢI TRẢ LỜI 100% BẰNG TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG DÙNG TIẾNG ANH.
        2. Nói chuyện tự nhiên, gần gũi như người thật đang chat trên Discord (có thể dùng icon ^^, :D, nha, nè...).
        3. KHÔNG hiển thị các bước suy nghĩ, KHÔNG dùng thẻ <thought> hay <think>. Chỉ đưa ra câu trả lời cuối cùng.
        
        ⏰ THÔNG TIN QUAN TRỌNG: Hôm nay là ngày ${currentTime}.`;

        if (webContext) {
            systemPrompt += `\n\n[TÀI LIỆU THAM KHẢO THỰC TẾ]:\n${webContext}
            
-> HƯỚNG DẪN RAG (Retrieval-Augmented Generation):
1. Đọc kỹ [TÀI LIỆU THAM KHẢO THỰC TẾ] ở trên.
2. Dựa HOÀN TOÀN vào tài liệu để trả lời câu hỏi của người dùng. Không bịa đặt thông tin nếu không có trong tài liệu.
3. Nếu tài liệu không chứa thông tin cần thiết, hãy thành thật nói rằng bạn không tìm thấy thông tin mới nhất.
4. TỔNG HỢP & TRÍCH DẪN: Ở cuối câu trả lời, hãy đính kèm các link nguồn từ tài liệu (Ví dụ: "Nguồn tham khảo: URL").`;
        }

        // ─── Xây dựng payload để tránh lỗi 500 của Google API ───
        const combinedPrompt = `${systemPrompt}\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;

        let response;
        let retries = 3;
        
        const requestConfig = {};
        if (AI_CONFIG.API_KEY) {
            requestConfig.headers = { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` };
        }

        // ─── Bước 5: Gọi AI Tổng hợp & Trả lời ───
        while (retries > 0) {
            try {
                response = await axios.post(AI_CONFIG.URL, {
                    model: AI_CONFIG.MODEL,
                    messages: [
                        { role: 'user', content: combinedPrompt }
                    ],
                    temperature: AI_CONFIG.TEMPERATURE,
                }, requestConfig);
                
                break;
            } catch (err) {
                retries--;
                if (retries === 0) throw err;
                const status = err.response?.status || 'Unknown';
                console.warn(`⚠️ API lỗi ${status}, đang thử lại... (${retries} lần còn lại)`);
                await new Promise(res => setTimeout(res, 2000));
            }
        }

        let aiReply = response.data.choices[0].message.content.trim();

        // Xóa thẻ suy nghĩ (thought/think)
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
