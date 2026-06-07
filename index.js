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
    ffmpeg: {
        path: 'ffmpeg',
        args: {
            // Input args giúp phát nhạc dài ổn định hơn
            input: {
                reconnect: 1,
                reconnect_streamed: 1,
                reconnect_on_network_error: 1,
                reconnect_on_http_error: '4xx,5xx',
                reconnect_delay_max: 15,
                rw_timeout: 30000000,       // 30 giây timeout cho read/write (microseconds)
            },
        },
    },
    plugins: [
        new YtDlpPlugin({
            update: true,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
            },
        }),
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
    await nsfwDetector.loadModel();
});

// ─── Đăng nhập ───
client.login(process.env.DISCORD_TOKEN);