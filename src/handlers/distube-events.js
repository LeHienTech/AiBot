const { getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { playlistData, silentAdd, loadBatch } = require('../utils/playlist');
const { MAX_SONG_DURATION } = require('../config');

// Theo dõi số lần retry cho mỗi guild (tránh retry vô hạn)
const retryCount = new Map(); // guildId -> { songUrl, count }
const MAX_RETRIES = 2;

/**
 * Đăng ký DisTube event handlers
 * @param {Object} distube - DisTube instance
 */
function register(distube) {
    // Thông báo khi phát bài
    distube.on('playSong', async (queue, song) => {
        console.log(`[distube] 🎶 playSong: "${song.name}" | url=${song.url} | duration=${song.formattedDuration} | guild=${queue.textChannel?.guildId}`);
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

        // Reset retry count khi phát bài mới thành công
        const guildId = queue.textChannel?.guildId;
        if (guildId) {
            const retry = retryCount.get(guildId);
            if (retry && retry.songUrl === song.url) {
                // Đang retry bài này, không thông báo lại
                return;
            }
            retryCount.delete(guildId);
        }

        queue.textChannel?.send(`🎶 Đang phát: **${song.name}** - \`${song.formattedDuration}\``);
    });

    // Thông báo khi thêm bài vào hàng đợi
    distube.on('addSong', (queue, song) => {
        console.log(`[distube] ➕ addSong: "${song.name}" | url=${song.url} | guild=${queue.textChannel?.guildId}`);
        const guildId = queue.textChannel?.guildId;
        if (guildId && silentAdd.has(guildId)) return;
        queue.textChannel?.send(`✅ Đã thêm vào hàng đợi: **${song.name}** - \`${song.formattedDuration}\``);
    });

    // Auto-preload: Tự động tải thêm bài khi queue sắp hết
    distube.on('finishSong', async (queue, song) => {
        const guildId = queue.textChannel?.guildId;
        if (!guildId) return;

        // Reset retry count khi bài hoàn thành bình thường
        retryCount.delete(guildId);

        const guildData = playlistData.get(guildId);
        if (!guildData) return;
        if (guildData.isLoading) return;

        const remainingInQueue = queue.songs.length;
        const remainingInPlaylist = guildData.urls.length - guildData.loadedIndex;

        if (remainingInQueue <= 2 && remainingInPlaylist > 0) {
            const batchSize = Math.min(3, remainingInPlaylist);

            console.log(`🔄 Auto-preload: Queue còn ${remainingInQueue} bài, tải thêm ${batchSize} bài...`);
            queue.textChannel?.send(`🔄 Đang tải thêm **${batchSize}** bài từ playlist...`);

            const result = await loadBatch(distube, batchSize, guildData, guildData.voiceChannel, {
                textChannel: guildData.textChannel,
                member: guildData.member,
            });

            const stillRemaining = guildData.urls.length - guildData.loadedIndex;
            if (result.loaded > 0) {
                queue.textChannel?.send(`✅ Đã tải thêm **${result.loaded}** bài! (Còn **${stillRemaining}** bài trong playlist)`);
            } else if (result.lastError) {
                queue.textChannel?.send(`⚠️ Không tải được bài tiếp theo: \`${result.lastError.substring(0, 100)}\``);
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
    distube.on('error', async (error, queue, song) => {
        const errorMsg = error.message || String(error);
        const errorCode = error.errorCode || '';
        console.error(`[distube] ❌ ERROR event:`);
        console.error(`[distube] ❌ Song: ${song?.name || 'N/A'} | URL: ${song?.url || 'N/A'}`);
        console.error(`[distube] ❌ Error code: ${errorCode || 'N/A'}`);
        console.error(`[distube] ❌ Error message: ${errorMsg}`);
        if (error.stack) console.error(`[distube] ❌ Stack trace:\n${error.stack}`);
        const textChannel = queue?.textChannel;
        const guildId = queue?.textChannel?.guildId || queue?.id;

        // Kiểm tra nếu lỗi liên quan đến stream bị ngắt (thường xảy ra khi phát giữa chừng)
        const isStreamError = errorMsg.includes('ffmpeg exited') ||
            errorMsg.includes('aborted') ||
            errorMsg.includes('PREMATURE_CLOSE') ||
            errorMsg.includes('ERR_STREAM') ||
            errorMsg.includes('ECONNRESET') ||
            errorMsg.includes('write after end') ||
            errorMsg.includes('Cannot read properties') ||
            errorMsg.includes('resource is not readable');

        // Kiểm tra lỗi kết nối/timeout
        const isConnectionError = errorMsg.includes('ConnectTimeoutError') ||
            errorMsg.includes('UND_ERR_CONNECT_TIMEOUT') ||
            errorMsg.includes('Connect Timeout') ||
            errorMsg.includes('ENOTFOUND') ||
            errorMsg.includes('ECONNREFUSED') ||
            errorMsg.includes('fetch failed') ||
            errorMsg.includes('network') ||
            errorMsg.includes('ETIMEDOUT');

        // ─── Auto-retry: Tự động phát lại khi stream bị ngắt giữa chừng ───
        if ((isStreamError || isConnectionError) && song && guildId) {
            const retry = retryCount.get(guildId) || { songUrl: null, count: 0 };

            if (retry.songUrl === song.url) {
                retry.count++;
            } else {
                retry.songUrl = song.url;
                retry.count = 1;
            }
            retryCount.set(guildId, retry);

            if (retry.count <= MAX_RETRIES) {
                console.log(`🔄 Auto-retry ${retry.count}/${MAX_RETRIES}: ${song.name || song.url}`);
                textChannel?.send(
                    `⚠️ Nhạc bị gián đoạn, đang thử phát lại... (lần ${retry.count}/${MAX_RETRIES})`
                );

                // Chờ 2 giây trước khi retry để cho yt-dlp cleanup
                await new Promise(r => setTimeout(r, 2000));

                try {
                    const voiceChannel = queue?.voiceChannel;
                    if (voiceChannel) {
                        await distube.play(voiceChannel, song.url, {
                            textChannel: textChannel,
                            member: queue.songs?.[0]?.member || queue.member,
                        });
                        return; // Retry thành công, không gửi error message
                    }
                } catch (retryError) {
                    console.error('Auto-retry failed:', retryError.message);
                }
            } else {
                // Đã retry hết số lần
                retryCount.delete(guildId);
            }
        }

        if (!textChannel) return;

        if (isConnectionError) {
            textChannel.send(
                `⏱️ Kết nối bị timeout khi tải nhạc` +
                (song ? ` **${song.name || ''}**` : '') +
                `\n💡 Có thể do mạng chậm hoặc server bận. Hãy thử lại sau vài giây!`
            );
        } else if (isStreamError && song) {
            const songName = song.name || 'không rõ';
            textChannel.send(
                `❌ Stream bị ngắt khi phát **${songName}**` +
                `\n💡 Hãy dùng \`!p ${song.url || songName}\` để thử lại.`
            );
        } else if (errorCode === 'YTDLP_ERROR') {
            // Lỗi từ yt-dlp — phân tích cụ thể
            if (errorMsg.includes('Sign in') || errorMsg.includes('age')) {
                textChannel.send('🔞 Video yêu cầu xác minh tuổi, bỏ qua...');
            } else if (errorMsg.includes('truncated') || errorMsg.includes('Incomplete')) {
                textChannel.send('❌ Link YouTube bị thiếu hoặc sai! (Incomplete YouTube ID)');
            } else if (errorMsg.includes('not available') || errorMsg.includes('unavailable') || errorMsg.includes('removed')) {
                textChannel.send('❌ Video không khả dụng hoặc đã bị xóa!');
            } else if (errorMsg.includes('bot') || errorMsg.includes('captcha') || errorMsg.includes('403')) {
                textChannel.send('🤖 YouTube đang chặn bot! Hãy thử lại sau vài phút.');
            } else if (errorMsg.includes('Private video') || errorMsg.includes('private')) {
                textChannel.send('🔒 Video này ở chế độ riêng tư!');
            } else {
                textChannel.send(`❌ Lỗi yt-dlp: Không thể xử lý video${song ? ` **${song.name || ''}**` : ''}. Hãy thử bài khác!`);
            }
        } else {
            textChannel.send(`❌ Đã xảy ra lỗi: ${errorMsg.substring(0, 200)}`);
        }
    });

    // Log và thông báo khi bot bị ngắt kết nối
    distube.on('disconnect', (queue) => {
        console.log(`🔌 Bot đã ngắt kết nối voice (guild: ${queue.id})`);
        retryCount.delete(queue.id);
        queue.textChannel?.send('🔌 Bot đã ngắt kết nối khỏi kênh thoại.');
    });

    // Log khi kênh voice trống
    distube.on('empty', (queue) => {
        console.log(`👻 Kênh voice trống, bot rời kênh (guild: ${queue.id})`);
        retryCount.delete(queue.id);
        queue.textChannel?.send('👋 Kênh thoại trống, bot đã rời kênh.');
    });
}

module.exports = { register };
