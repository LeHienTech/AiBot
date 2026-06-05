require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const ffmpegPath = require('ffmpeg-static');

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

// ─── Cấu hình DisTube ───
client.distube = new DisTube(client, {
    ffmpeg: { path: ffmpegPath },
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
client.once('ready', async () => {
    console.log(`🤖 Bot đã sẵn sàng: ${client.user.tag}`);
    await nsfwDetector.loadModel();
});

// ─── Đăng nhập ───
client.login(process.env.DISCORD_TOKEN);