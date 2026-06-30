require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

// Handlers
const messageHandler = require('./src/handlers/message');
const interactionHandler = require('./src/handlers/interaction');
const distubeEvents = require('./src/handlers/distube-events');

// Features
const nsfwDetector = require('./src/features/nsfw-detector');
const audioProxy = require('./src/utils/audio-proxy');

// ─── Tạo cookies.txt từ env var (cho server deploy) ───
const cookiesPath = path.join(__dirname, 'cookies.txt');
if (!fs.existsSync(cookiesPath) && process.env.YOUTUBE_COOKIES_BASE64) {
    try {
        const cookiesContent = Buffer.from(process.env.YOUTUBE_COOKIES_BASE64, 'base64').toString('utf-8');
        fs.writeFileSync(cookiesPath, cookiesContent);
        console.log('🍪 Đã tạo cookies.txt từ environment variable');
    } catch (err) {
        console.error('⚠️ Không thể tạo cookies.txt:', err.message);
    }
} else if (fs.existsSync(cookiesPath)) {
    console.log('🍪 cookies.txt đã tồn tại');
} else {
    console.warn('⚠️ Không có cookies.txt và không có YOUTUBE_COOKIES_BASE64 — YouTube có thể chặn bot!');
}

// ─── Khởi tạo Client ───
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ─── Cấu hình DisTube (Music) ───
client.distube = new DisTube(client, {
    ffmpeg: { path: ffmpegPath },
    plugins: [
        new SoundCloudPlugin(),
        new YtDlpPlugin({ update: true })
    ]
});

// ─── Đăng ký Event Handlers ───
messageHandler.register(client);
interactionHandler.register(client);
distubeEvents.register(client.distube);

// ─── Bot sẵn sàng ───
client.once('clientReady', async () => {
    console.log(`🤖 Bot đã sẵn sàng: ${client.user.tag}`);

    // ─── Khởi tạo Audio Proxy (hỗ trợ nhạc dài) ───
    try {
        await audioProxy.startProxy();

        // Override getStreamURL của yt-dlp plugin để dùng proxy
        // Thay vì cho FFmpeg tải trực tiếp từ YouTube (bị throttle),
        // proxy dùng yt-dlp pipe audio qua localhost → luôn ổn định
        const ytdlpPlugin = client.distube.plugins.find(
            p => p.constructor.name === 'YtDlpPlugin'
        );
        if (ytdlpPlugin) {
            const originalGetStreamURL = ytdlpPlugin.getStreamURL.bind(ytdlpPlugin);
            ytdlpPlugin.getStreamURL = async function (song) {
                try {
                    return audioProxy.getProxyUrl(song.url);
                } catch (e) {
                    console.warn('[audio-proxy] Fallback to direct URL:', e.message);
                    return originalGetStreamURL(song);
                }
            };
            console.log('✅ Audio proxy sẵn sàng — hỗ trợ phát nhạc dài');
        }
    } catch (err) {
        console.error('⚠️ Không thể khởi tạo audio proxy:', err.message);
        console.log('↳ Bot sẽ dùng phương thức phát nhạc mặc định');
    }

    await nsfwDetector.loadModel();

    // ─── Tự động rời kênh sau 1 phút nếu không ai trong kênh ───
    const leaveTimers = new Map(); // guildId -> timeout

    client.on('voiceStateUpdate', (oldState, newState) => {
        const guildId = oldState.guild.id || newState.guild.id;
        const botId = client.user.id;

        // Lấy kênh voice mà bot đang ở
        const botVoiceChannel = oldState.guild.members.me?.voice?.channel;
        if (!botVoiceChannel) return; // Bot không ở kênh voice nào

        // Đếm số member thực (không phải bot) trong kênh
        const humanMembers = botVoiceChannel.members.filter(m => !m.user.bot).size;

        if (humanMembers === 0) {
            // Kênh trống (chỉ còn bot) → đặt timer 60 giây
            if (!leaveTimers.has(guildId)) {
                console.log(`⏱️ Kênh voice trống, sẽ rời sau 60 giây (guild: ${guildId})`);
                const timer = setTimeout(() => {
                    leaveTimers.delete(guildId);

                    // Kiểm tra lại lần cuối
                    const currentChannel = oldState.guild.members.me?.voice?.channel;
                    if (!currentChannel) return;
                    const stillEmpty = currentChannel.members.filter(m => !m.user.bot).size === 0;

                    if (stillEmpty) {
                        console.log(`👋 Rời kênh voice sau 1 phút không ai (guild: ${guildId})`);

                        // Dừng nhạc và dọn dẹp
                        try {
                            const queue = client.distube.getQueue(guildId);
                            if (queue) {
                                queue.textChannel?.send('👋 Không ai trong kênh thoại sau 1 phút, bot tự rời kênh.');
                                if (queue.paused) client.distube.resume(guildId);
                                client.distube.stop(guildId).catch(() => {});
                            }
                        } catch (e) {
                            // Queue không tồn tại, bỏ qua
                        }

                        // Xóa playlist data
                        const { playlistData } = require('./src/utils/playlist');
                        playlistData.delete(guildId);

                        // Rời kênh voice
                        try {
                            client.distube.voices.leave(guildId);
                        } catch (e) {
                            const { getVoiceConnection } = require('@discordjs/voice');
                            const conn = getVoiceConnection(guildId);
                            if (conn) conn.destroy();
                        }
                    }
                }, 60 * 1000); // 60 giây

                leaveTimers.set(guildId, timer);
            }
        } else {
            // Có người quay lại → hủy timer
            if (leaveTimers.has(guildId)) {
                console.log(`✅ Có người quay lại kênh voice, hủy timer rời (guild: ${guildId})`);
                clearTimeout(leaveTimers.get(guildId));
                leaveTimers.delete(guildId);
            }
        }
    });
});

// ─── Xử lý lỗi toàn cục (tránh crash) ───
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err.message);
    // Không process.exit() — để bot tiếp tục chạy
});

client.on('error', (err) => {
    console.error('⚠️ Discord client error:', err.message);
});
client.on('shardError', (err) => {
    console.error('⚠️ Discord WebSocket error:', err.message);
});

// ─── Đăng nhập ───
client.login(process.env.DISCORD_TOKEN);