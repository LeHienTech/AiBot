const path = require('path');

// Danh sách từ ngữ bị cấm
const BLACKLIST = ['chịch', 'lồn', 'địt', 'đụ má mày'];

// Ngưỡng NSFW score để cảnh báo (0-1)
const NSFW_THRESHOLD = 0.95;

// Giới hạn kích thước ảnh cho NSFW check (bytes)
const NSFW_MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB

// Timeout cho các HTTP request (ms)
const TIMEOUTS = {
    NSFW_IMAGE: 10000,    // 10s - tải ảnh NSFW
    WEATHER_API: 7000,    // 7s  - wttr.in
    DDG_API: 6000,        // 6s  - DuckDuckGo API
    DDG_HTML: 8000,       // 8s  - DuckDuckGo HTML scrape
    DEEP_SCRAPE: 7000,    // 7s  - Deep scrape article
};

// Đường dẫn yt-dlp
const YT_DLP_PATH = path.join(
    __dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

const LM_STUDIO = {
    URL: process.env.AI_API_URL || 'http://127.0.0.1:1234/v1/chat/completions',
    MODEL: process.env.AI_MODEL || 'gemma-4-31b-it',
    API_KEY: process.env.AI_API_KEY || '',
    TEMPERATURE: 0.3,
    MAX_TOKENS: 512,
};

// Discord message limit
const DISCORD_MAX_LENGTH = 1990;

// Giới hạn thời lượng bài hát (giây) - 3 giờ
const MAX_SONG_DURATION = 3 * 60 * 60;

module.exports = {
    BLACKLIST,
    NSFW_THRESHOLD,
    NSFW_MAX_IMAGE_SIZE,
    TIMEOUTS,
    YT_DLP_PATH,
    LM_STUDIO,
    DISCORD_MAX_LENGTH,
    MAX_SONG_DURATION,
};
