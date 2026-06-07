require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { SoundCloudPlugin } = require('@distube/soundcloud');

// Handlers
const messageHandler = require('./src/handlers/message');
const interactionHandler = require('./src/handlers/interaction');
const distubeEvents = require('./src/handlers/distube-events');

// Features
const nsfwDetector = require('./src/features/nsfw-detector');
const audioProxy = require('./src/utils/audio-proxy');

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
    ffmpeg: { path: 'ffmpeg' },
    plugins: [
        new YtDlpPlugin({ update: true }),
        new SoundCloudPlugin()
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
});

// ─── Đăng nhập ───
client.login(process.env.DISCORD_TOKEN);