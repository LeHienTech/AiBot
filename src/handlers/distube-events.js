const { getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { playlistData, silentAdd, loadBatch } = require('../utils/playlist');
const { MAX_SONG_DURATION } = require('../config');

/**
 * Đăng ký DisTube event handlers
 * @param {Object} distube - DisTube instance
 */
function register(distube) {
    // Thông báo khi phát bài
    distube.on('playSong', async (queue, song) => {
        // Kiểm tra nếu bài hát quá dài
        if (song.duration > MAX_SONG_DURATION) {
            queue.textChannel?.send(`❌ Không thể phát nhạc **${song.name}** vì nhạc quá dài (${song.formattedDuration})`);
            try {
                if (queue.songs.length > 1) {
                    await distube.skip(queue);
                } else {
                    await distube.stop(queue);
                }
            } catch (e) {
                // Bỏ qua lỗi khi skip/stop
            }
            return;
        }
        queue.textChannel?.send(`🎶 Đang phát: **${song.name}** - \`${song.formattedDuration}\``);
    });

    // Thông báo khi thêm bài vào hàng đợi
    distube.on('addSong', (queue, song) => {
        const guildId = queue.textChannel?.guildId;
        if (guildId && silentAdd.has(guildId)) return;
        queue.textChannel?.send(`✅ Đã thêm vào hàng đợi: **${song.name}** - \`${song.formattedDuration}\``);
    });

    // Auto-preload: Tự động tải thêm bài khi queue sắp hết
    distube.on('finishSong', async (queue, song) => {
        const guildId = queue.textChannel?.guildId;
        if (!guildId) return;

        const guildData = playlistData.get(guildId);
        if (!guildData) return;
        if (guildData.isLoading) return;

        const remainingInQueue = queue.songs.length;
        const remainingInPlaylist = guildData.urls.length - guildData.loadedIndex;

        if (remainingInQueue <= 2 && remainingInPlaylist > 0) {
            const batchSize = Math.min(3, remainingInPlaylist);

            console.log(`🔄 Auto-preload: Queue còn ${remainingInQueue} bài, tải thêm ${batchSize} bài...`);
            queue.textChannel?.send(`🔄 Đang tải thêm **${batchSize}** bài từ playlist...`);

            const loaded = await loadBatch(distube, batchSize, guildData, guildData.voiceChannel, {
                textChannel: guildData.textChannel,
                member: guildData.member,
            });

            const stillRemaining = guildData.urls.length - guildData.loadedIndex;
            if (loaded > 0) {
                queue.textChannel?.send(`✅ Đã tải thêm **${loaded}** bài! (Còn **${stillRemaining}** bài trong playlist)`);
            }

            if (stillRemaining === 0) {
                queue.textChannel?.send(`🏁 Đã tải hết toàn bộ playlist **${guildData.name}**!`);
            }
        }
    });

    // ─── Xử lý Voice Connection ổn định ───
    // Khi DisTube tạo voice connection, thêm logic reconnect
    distube.on('initQueue', (queue) => {
        // Tăng volume mặc định
        queue.volume = 100;

        // Xử lý voice connection stability
        const connection = getVoiceConnection(queue.id);
        if (connection) {
            // Tăng timeout cho stream dài
            connection.on('stateChange', async (oldState, newState) => {
                // Nếu connection bị disconnect, thử reconnect
                if (newState.status === VoiceConnectionStatus.Disconnected) {
                    try {
                        console.log('⚠️ Voice connection disconnected, đang thử reconnect...');
                        // Chờ xem có reconnect tự động không (15 giây - tăng từ 5s cho stream dài)
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 15000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 15000),
                        ]);
                        // Đang reconnect, không cần làm gì
                        console.log('🔄 Voice connection đang reconnect...');
                    } catch (error) {
                        // Không reconnect được → destroy để tránh memory leak
                        console.error('❌ Voice connection không thể reconnect, destroying...');
                        try {
                            connection.destroy();
                        } catch (e) {
                            // Connection đã bị destroy rồi
                        }
                    }
                }
            });
        }
    });

    // Xử lý lỗi DisTube (v5: error event = (error, queue, song))
    distube.on('error', (error, queue, song) => {
        const errorMsg = error.message || String(error);
        console.error('DisTube error:', errorMsg);
        const textChannel = queue?.textChannel;
        if (!textChannel) return;

        // Kiểm tra nếu lỗi liên quan đến stream bị ngắt (thường xảy ra với nhạc dài)
        const isStreamError = errorMsg.includes('ffmpeg exited') ||
            errorMsg.includes('aborted') ||
            errorMsg.includes('PREMATURE_CLOSE') ||
            errorMsg.includes('ERR_STREAM') ||
            errorMsg.includes('ETIMEDOUT') ||
            errorMsg.includes('ECONNRESET');

        // Kiểm tra lỗi kết nối/timeout
        const isConnectionError = errorMsg.includes('ConnectTimeoutError') ||
            errorMsg.includes('UND_ERR_CONNECT_TIMEOUT') ||
            errorMsg.includes('Connect Timeout') ||
            errorMsg.includes('ENOTFOUND') ||
            errorMsg.includes('ECONNREFUSED') ||
            errorMsg.includes('fetch failed') ||
            errorMsg.includes('network');

        if (isConnectionError) {
            textChannel.send(
                `⏱️ Kết nối bị timeout khi tải nhạc` +
                (song ? ` **${song.name || ''}**` : '') +
                `\n💡 Có thể do mạng chậm hoặc server bận. Hãy thử lại sau vài giây!`
            );
        } else if (isStreamError && song) {
            const songName = song.name || 'không rõ';
            const duration = song.formattedDuration || '';
            textChannel.send(
                `❌ Không thể phát nhạc **${songName}** vì nhạc quá dài` +
                (duration ? ` (${duration})` : '') +
                `\n💡 Hãy thử tìm bản ngắn hơn hoặc dùng link khác.`
            );
        } else {
            textChannel.send(`❌ Đã xảy ra lỗi: ${errorMsg}`);
        }
    });

    // Log và thông báo khi bot bị ngắt kết nối
    distube.on('disconnect', (queue) => {
        console.log(`🔌 Bot đã ngắt kết nối voice (guild: ${queue.id})`);
        queue.textChannel?.send('🔌 Bot đã ngắt kết nối khỏi kênh thoại.');
    });

    // Log khi kênh voice trống
    distube.on('empty', (queue) => {
        console.log(`👻 Kênh voice trống, bot rời kênh (guild: ${queue.id})`);
        queue.textChannel?.send('👋 Kênh thoại trống, bot đã rời kênh.');
    });
}

module.exports = { register };
