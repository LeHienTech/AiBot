const axios = require('axios');
const { getWeatherContext } = require('../features/weather');
const { searchWeb } = require('../features/web-search');
const { AI_CONFIG, DISCORD_MAX_LENGTH } = require('../config');

// ─── UTILS: HÀM GỌI AI CHUNG CHỨA LOGIC RETRY & FALLBACK ───
/**
 * Gọi AI với fallback giảm độ dài context tự động khi bị lỗi 500
 */
async function callAI(systemPrompt, userPrompt, context = '', options = {}) {
    const temperature = options.temperature ?? AI_CONFIG.TEMPERATURE;
    const requestConfig = {};
    if (AI_CONFIG.API_KEY) {
        requestConfig.headers = { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` };
    }

    // Các phiên bản context (giảm dần độ dài)
    const contextVersions = [];
    
    // Bản đầy đủ
    if (context) {
        const fullPrompt = `${systemPrompt}\n\n[TÀI LIỆU THAM KHẢO THỰC TẾ]:\n${context}\n\n-> Dựa vào tài liệu trên, hãy trả lời câu hỏi. (Ưu tiên thông tin trong tài liệu, và đính kèm link trích dẫn nếu dùng).\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;
        contextVersions.push(fullPrompt);
        
        // Bản cắt ngắn
        if (context.length > 2000) {
            const shortContext = context.substring(0, 2000) + '\n[...đã cắt ngắn...]';
            const shortPrompt = `${systemPrompt}\n\n[TÀI LIỆU THAM KHẢO THỰC TẾ]:\n${shortContext}\n\n-> Dựa vào tài liệu trên, hãy trả lời câu hỏi.\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;
            contextVersions.push(shortPrompt);
        }
    }
    
    // Bản không context
    const noContextPrompt = `${systemPrompt}\n\n--- CÂU HỎI CỦA NGƯỜI DÙNG ---\n${userPrompt}`;
    contextVersions.push(noContextPrompt);

    let response;
    for (let v = 0; v < contextVersions.length; v++) {
        const currentPrompt = contextVersions[v];
        let retries = 3;
        let success = false;

        while (retries > 0) {
            try {
                // Lọc bỏ các ký tự ẩn (control characters) từ web có thể làm hỏng JSON hoặc gây lỗi 500 cho API AI
                const sanitizedPrompt = currentPrompt.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
                
                response = await axios.post(AI_CONFIG.URL, {
                    model: AI_CONFIG.MODEL,
                    messages: [
                        { role: 'user', content: sanitizedPrompt }
                    ],
                    temperature: temperature,
                }, requestConfig);
                success = true;
                break;
            } catch (err) {
                retries--;
                const status = err.response?.status || 'Unknown';
                const errorData = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                console.warn(`⚠️ [AI] Lỗi ${status}: ${errorData} | Thử lại... (còn ${retries} lần, context v${v + 1}/${contextVersions.length})`);
                await new Promise(res => setTimeout(res, 5000));
            }
        }
        
        if (success) {
            let aiReply = response.data.choices[0].message.content.trim();
            // Xóa thẻ suy nghĩ (thought/think)
            aiReply = aiReply.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
            aiReply = aiReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            aiReply = aiReply.replace(/```json/g, '').replace(/```/g, '').trim();
            return aiReply;
        }
        
        if (v < contextVersions.length - 1) {
            console.log(`🔄 [AI] Fallback: Giảm dung lượng context (xuống v${v + 2}) do lỗi liên tục...`);
        } else {
            throw new Error('Tất cả các phiên bản context đều thất bại');
        }
    }
}

// ─── BƯỚC 1: AI PLANNER (LÊN KẾ HOẠCH TÌM KIẾM) ───
async function planSearchStrategy(userPrompt) {
    const plannerPrompt = `Bạn là một Nhà Phân Tích Ý Định. Hãy quyết định xem câu hỏi của người dùng có BẮT BUỘC phải cào dữ liệu Internet hay không.

- CHỈ TÌM KIẾM (requires_search: true) khi hỏi về: Tin tức, sự kiện mới, thời sự, giá cả cập nhật, nhân vật nổi tiếng, hoặc số liệu có thật.
- KHÔNG TÌM KIẾM (requires_search: false) khi: Chào hỏi, tâm sự, yêu cầu lên ý tưởng (brainstorm), sáng tạo, làm thơ, viết code, làm toán, hoặc kiến thức bách khoa cơ bản.

Nếu cần tìm kiếm, hãy bẻ nhỏ câu hỏi thành mảng các từ khóa tìm kiếm (số lượng từ khóa tùy thuộc vào độ phức tạp của câu hỏi).
Trả về ĐÚNG định dạng JSON sau, không giải thích thêm:
{
  "requires_search": true,
  "reasoning": "Lý do ngắn gọn",
  "sub_queries": [] // Điền các từ khóa vào đây (từ 1 đến 5 từ khóa tùy ý)
}`;

    try {
        const resultJSON = await callAI(plannerPrompt, userPrompt, '', { temperature: 0 });
        return JSON.parse(resultJSON);
    } catch (e) {
        console.error('⚠️ [Planner] Lỗi phân tích ý định, fallback không tìm kiếm:', e.message);
        return { requires_search: false, reasoning: "Fallback due to error", sub_queries: [] };
    }
}

// ─── BƯỚC 2: EXECUTOR (TÌM KIẾM THỰC TẾ) ───
async function executeSearchPhase(plan, userPrompt) {
    let combinedContext = '';

    // Luôn ưu tiên check thời tiết bằng regex trước vì nó nhanh nhất (0ms)
    const weatherContext = await getWeatherContext(userPrompt);
    if (weatherContext) {
        console.log('🌤️ [Executor] Câu hỏi thời tiết, lấy data trực tiếp.');
        combinedContext += weatherContext + '\n\n';
    }

    if (plan.requires_search && plan.sub_queries.length > 0) {
        console.log(`🔍 [Executor] Đi cào dữ liệu cho ${plan.sub_queries.length} queries:`, plan.sub_queries);
        const searchContext = await searchWeb(plan.sub_queries);
        if (searchContext) {
            combinedContext += searchContext;
        }
    }

    return combinedContext.trim();
}


// ─── HÀM CHÍNH: EXECUTE LỆNH !CHAT ───
async function execute(message) {
    const userPrompt = message.content.slice(6).trim();
    if (!userPrompt) return message.reply('Bạn muốn trò chuyện gì? Gõ `!chat + nội dung`.');

    try {
        await message.channel.sendTyping();

        // 1. Lên kế hoạch (AI Planner)
        console.log('🧠 [Chat Agentic] Bắt đầu suy nghĩ chiến lược...');
        const plan = await planSearchStrategy(userPrompt);
        if (plan.requires_search) {
            console.log(`📋 [Planner] Cần tìm kiếm (${plan.reasoning}). Queries:`, plan.sub_queries);
        } else {
            console.log(`📋 [Planner] Tự trả lời (${plan.reasoning}). KHÔNG TÌM KIẾM.`);
        }

        // 2. Tìm kiếm (Executor)
        const contextData = await executeSearchPhase(plan, userPrompt);

        // 3. Tổng hợp (AI Synthesizer)
        console.log('💡 [Chat Agentic] Bắt đầu tổng hợp câu trả lời...');
        const currentTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const systemPrompt = `Bạn là trợ lý bot Discord vui tính, năng động và am hiểu về văn hóa đại chúng (Game, Anime, Phim ảnh). 
        ⚠️ QUY TẮC TỐI THƯỢNG: 
        1. BẠN PHẢI TRẢ LỜI 100% BẰNG TIẾNG VIỆT.
        2. Nói chuyện tự nhiên, gần gũi như người thật đang chat trên Discord (dùng icon ^^, :D, nha...).
        
        ⏰ THÔNG TIN QUAN TRỌNG: Hôm nay là ngày ${currentTime}.`;

        let aiReply = await callAI(systemPrompt, userPrompt, contextData, { temperature: 0.7 });

        // ─── CHIA NHỎ TIN NHẮN (TRÁNH CẮT CỤT > 2000 KÝ TỰ) ───
        const chunks = [];
        while (aiReply.length > 0) {
            if (aiReply.length <= DISCORD_MAX_LENGTH) {
                chunks.push(aiReply);
                break;
            }
            
            let splitIndex = aiReply.lastIndexOf('\n', DISCORD_MAX_LENGTH);
            if (splitIndex === -1) splitIndex = aiReply.lastIndexOf(' ', DISCORD_MAX_LENGTH);
            if (splitIndex === -1 || splitIndex === 0) splitIndex = DISCORD_MAX_LENGTH;
            
            chunks.push(aiReply.substring(0, splitIndex));
            aiReply = aiReply.substring(splitIndex).trim();
        }

        // Gửi tuần tự các chunk
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply(chunks[i]);
            } else {
                await message.channel.send(chunks[i]);
            }
        }

    } catch (error) {
        console.error('Lỗi kết nối AI API (Chat Agentic):', error.message);
        message.reply('❌ Hiện không kết nối được với Ai');
    }
}

module.exports = { execute };
