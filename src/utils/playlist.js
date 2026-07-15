const { execFile } = require('child_process');
const { YT_DLP_PATH } = require('../config');

// Lưu trạng thái playlist cho mỗi server
const playlistData = new Map();

// Flag để tắt thông báo "Đã thêm vào hàng đợi" khi đang load batch
const silentAdd = new Set();

/**
 * Lấy nhanh danh sách URL từ playlist (không tải metadata từng bài)
 * --flat-playlist chỉ lấy ID/URL, rất nhanh (~2-5 giây)
 */
function getPlaylistUrls(playlistUrl) {
    console.log(`[playlist] 📋 getPlaylistUrls: Bắt đầu phân tích playlist: ${playlistUrl}`);
    console.log(`[playlist] 📋 yt-dlp path: ${YT_DLP_PATH}`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        execFile(YT_DLP_PATH, [
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            playlistUrl
        ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            const elapsed = Date.now() - startTime;
            if (err) {
                console.error(`[playlist] ❌ getPlaylistUrls FAILED sau ${elapsed}ms:`, err.message);
                if (stderr) console.error(`[playlist] ❌ stderr:`, stderr.substring(0, 500));
                return reject(err);
            }
            try {
                console.log(`[playlist] ✅ yt-dlp trả về sau ${elapsed}ms, stdout size: ${stdout.length} bytes`);
                const data = JSON.parse(stdout);
                
                // Nếu yt-dlp trả về một video đơn thay vì playlist (vd: link mix)
                const entries = data.entries || (data.id ? [data] : []);
                
                if (entries.length === 0) {
                    console.error(`[playlist] ❌ Playlist rỗng! data.entries=${data.entries?.length}, data.id=${data.id}`);
                    return reject(new Error('Không tìm thấy danh sách video hợp lệ.'));
                }

                const urls = entries.map(entry => {
                    if (entry.url && entry.url.startsWith('http')) return entry.url;
                    return `https://www.youtube.com/watch?v=${entry.id}`;
                });
                console.log(`[playlist] ✅ Phân tích xong: "${data.title}" — ${urls.length} bài, mất ${elapsed}ms`);
                resolve({ name: data.title || 'Danh sách phát', urls });
            } catch (e) {
                console.error(`[playlist] ❌ JSON parse error:`, e.message);
                console.error(`[playlist] ❌ stdout (100 ký tự đầu):`, stdout.substring(0, 100));
                reject(e);
            }
        });
    });
}

/**
 * Tải một batch bài hát vào queue
 * @param {Object} distube - DisTube instance
 * @param {number} count - Số bài cần tải
 * @param {Object} guildData - Dữ liệu playlist của server
 * @param {Object} voiceChannel - Kênh voice
 * @param {Object} options - Options cho DisTube
 */
async function loadBatch(distube, count, guildData, voiceChannel, options) {
    const startIdx = guildData.loadedIndex;
    const endIdx = Math.min(startIdx + count, guildData.urls.length);
    const batch = guildData.urls.slice(startIdx, endIdx);

    console.log(`[loadBatch] 🔄 Bắt đầu tải batch: ${batch.length} bài (index ${startIdx}→${endIdx-1}/${guildData.urls.length})`);

    if (batch.length === 0) {
        console.log(`[loadBatch] ⚠️ Batch rỗng, không có gì để tải`);
        return { loaded: 0, total: 0, lastError: null };
    }

    guildData.isLoading = true;

    // Bật chế độ im lặng để không spam "Đã thêm vào hàng đợi"
    const guildId = options.member?.guild?.id || options.textChannel?.guildId;
    if (guildId) silentAdd.add(guildId);

    let loaded = 0;
    let lastError = null;
    const batchStartTime = Date.now();

    for (let i = 0; i < batch.length; i++) {
        const url = batch[i];
        const songIdx = startIdx + i + 1;
        const songStartTime = Date.now();
        console.log(`[loadBatch] 🎵 [${songIdx}/${guildData.urls.length}] Đang tải: ${url}`);
        try {
            await distube.play(voiceChannel, url, options);
            loaded++;
            console.log(`[loadBatch] ✅ [${songIdx}] Tải thành công! (${Date.now() - songStartTime}ms)`);
        } catch (error) {
            const errMsg = error.message || String(error);
            const errCode = error.errorCode || error.code || 'N/A';
            console.error(`[loadBatch] ❌ [${songIdx}] THẤT BẠI sau ${Date.now() - songStartTime}ms`);
            console.error(`[loadBatch] ❌ [${songIdx}] URL: ${url}`);
            console.error(`[loadBatch] ❌ [${songIdx}] Error code: ${errCode}`);
            console.error(`[loadBatch] ❌ [${songIdx}] Error message: ${errMsg}`);
            if (error.stack) console.error(`[loadBatch] ❌ [${songIdx}] Stack: ${error.stack.split('\n').slice(0, 3).join(' → ')}`);
            lastError = errMsg;
        }
        // Tăng loadedIndex cho mỗi bài (dù thành công hay thất bại) để không bị loop vô hạn
        guildData.loadedIndex++;
    }

    // Tắt chế độ im lặng
    if (guildId) silentAdd.delete(guildId);
    guildData.isLoading = false;

    const totalTime = Date.now() - batchStartTime;
    console.log(`[loadBatch] 📊 Kết quả: ${loaded}/${batch.length} thành công, tổng ${totalTime}ms${lastError ? `, lỗi cuối: ${lastError.substring(0, 100)}` : ''}`);

    return { loaded, total: batch.length, lastError };
}

module.exports = {
    playlistData,
    silentAdd,
    getPlaylistUrls,
    loadBatch,
};
