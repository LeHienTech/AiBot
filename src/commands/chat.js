const axios = require('axios');
const { getWeatherContext } = require('../features/weather');
const { searchWeb } = require('../features/web-search');
const { AI_CONFIG, DISCORD_MAX_LENGTH } = require('../config');

// Từ hỏi tiếng Việt phổ biến — dùng cho fallback khi AI lỗi
const QUESTION_WORDS = ['là gì', 'như thế nào', 'thế nào', 'ra sao', 'bao giờ', 'khi nào', 'ở đâu', 'bao nhiêu', 'có không', 'phải không', 'à', 'vậy', 'nhỉ', 'hả', '?'];

/**
 * Fallback: cắt gọn câu hỏi thô thành từ khóa tìm kiếm
 */
function simplifyQuery(userPrompt) {
    let q = userPrompt.toLowerCase();
    for (const w of QUESTION_WORDS) {
        q = q.replaceAll(w, '').trim();
    }
    // Chỉ giữ tối đa 8 từ đầu tiên
    const words = q.split(/\s+/).filter(w => w.length > 1).slice(0, 8);
    return words.join(' ') || userPrompt.slice(0, 60);
}

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

        let response;
        let retries = 3;
        while (retries > 0) {
            try {
                response = await axios.post(AI_CONFIG.URL, {
                    model: AI_CONFIG.MODEL,
                    messages: [{ role: 'user', content: intentPrompt }],
                    temperature: 0.1
                }, requestConfig);
                break;
            } catch (err) {
                retries--;
                if (retries === 0) throw err;
                console.warn(`⚠️ [Intent] API lỗi ${err.response?.status || 500}, đang thử lại...`);
                await new Promise(res => setTimeout(res, 2000));
            }
        }

        let result = response.data.choices[0].message.content.trim();
        result = result.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
        result = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        result = result.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(result);
    } catch (e) {
        console.error('⚠️ [Intent] Lỗi phân tích ý định, dùng fallback:', e.message);
        // Fix #2: Cắt gọn câu hỏi thô thay vì ném nguyên câu tiếng Việt dài
        return { needs_search: true, queries: [simplifyQuery(userPrompt)] };
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

        let webContext = '';

        // ─── Fix #3 & #5: Check Weather TRƯỚC khi gọi AI phân tích ý định ───
        // Weather check bằng regex (0ms) → nhanh hơn 3-5 giây so với gọi AI trước
        const weatherContext = await getWeatherContext(userPrompt);
        if (weatherContext) {
            webContext = weatherContext;
            console.log('🌤️ [Weather] Đã lấy dữ liệu thời tiết, bỏ qua phân tích ý định.');
        } else {
            // ─── Bước 1: Phân tích Ý định & Tạo Câu lệnh (chỉ khi KHÔNG phải thời tiết) ───
            const intent = await analyzeIntent(userPrompt);
            
            if (intent.needs_search && intent.queries && intent.queries.length > 0) {
                console.log('🔍 [Intent] Cần tìm kiếm:', intent.queries);
                // ─── Bước 2 & 3: Truy xuất và Lọc thông tin mạng (Top 5 sites) ───
                webContext = await searchWeb(intent.queries);
            } else {
                console.log('🔍 [Intent] Giao tiếp bình thường, không search.');
            }
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

        // ─── Bước 5: Gọi AI Tổng hợp & Trả lời ───
        // Cơ chế fallback thông minh: nếu lỗi 500 → cắt ngắn context → thử lại
        const contextVersions = [combinedPrompt];
        
        // Tạo bản rút gọn: chỉ giữ 2000 ký tự context
        if (webContext && webContext.length > 2000) {
            const shortContext = webContext.substring(0, 2000) + '\n[...đã cắt ngắn...]';
            const shortPrompt = `${systemPrompt.split('[TÀI LIỆU THAM KHẢO THỰC TẾ]:')[0]}[TÀI LIỆU THAM KHẢO THỰC TẾ]:\n${shortContext}\n\n-> Dựa vào tài liệu trên, trả lời câu hỏi. Đính kèm link nguồn ở cuối.\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;
            contextVersions.push(shortPrompt);
        }
        
        // Bản không có context (trả lời bằng kiến thức sẵn có)
        const noContextPrompt = `${systemPrompt}\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;
        contextVersions.push(noContextPrompt);

        let response;
        const requestConfig = {};
        if (AI_CONFIG.API_KEY) {
            requestConfig.headers = { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` };
        }

        for (let v = 0; v < contextVersions.length; v++) {
            const currentPrompt = contextVersions[v];
            let retries = 2;
            let success = false;

            while (retries > 0) {
                try {
                    response = await axios.post(AI_CONFIG.URL, {
                        model: AI_CONFIG.MODEL,
                        messages: [
                            { role: 'user', content: currentPrompt }
                        ],
                        temperature: AI_CONFIG.TEMPERATURE,
                    }, requestConfig);
                    success = true;
                    break;
                } catch (err) {
                    retries--;
                    const status = err.response?.status || 'Unknown';
                    console.warn(`⚠️ API lỗi ${status}, đang thử lại... (${retries} lần còn lại, context version ${v + 1}/${contextVersions.length})`);
                    await new Promise(res => setTimeout(res, 3000));
                }
            }
            
            if (success) break;
            
            if (v < contextVersions.length - 1) {
                console.log(`🔄 Chuyển sang context rút gọn (version ${v + 2})...`);
            } else {
                throw new Error('Tất cả các phiên bản context đều thất bại');
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
