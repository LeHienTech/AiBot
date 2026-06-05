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
    return new Promise((resolve, reject) => {
        execFile(YT_DLP_PATH, [
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            playlistUrl
        ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err) return reject(err);
            try {
                const data = JSON.parse(stdout);
                
                // Nếu yt-dlp trả về một video đơn thay vì playlist (vd: link mix)
                const entries = data.entries || (data.id ? [data] : []);
                
                if (entries.length === 0) {
                    return reject(new Error('Không tìm thấy danh sách video hợp lệ.'));
                }

                const urls = entries.map(entry => {
                    if (entry.url && entry.url.startsWith('http')) return entry.url;
                    return `https://www.youtube.com/watch?v=${entry.id}`;
                });
                resolve({ name: data.title || 'Danh sách phát', urls });
            } catch (e) {
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

    if (batch.length === 0) return 0;

    guildData.loadedIndex = endIdx;
    guildData.isLoading = true;

    // Bật chế độ im lặng để không spam "Đã thêm vào hàng đợi"
    silentAdd.add(options.member.guild.id);

    let loaded = 0;
    for (const url of batch) {
        try {
            await distube.play(voiceChannel, url, options);
            loaded++;
        } catch (error) {
            console.error(`Lỗi tải bài ${startIdx + loaded + 1}:`, error.message);
        }
    }

    // Tắt chế độ im lặng
    silentAdd.delete(options.member.guild.id);
    guildData.isLoading = false;

    return loaded;
}

module.exports = {
    playlistData,
    silentAdd,
    getPlaylistUrls,
    loadBatch,
};
