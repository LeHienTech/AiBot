const ytSearch = require('yt-search');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const { playlistData, silentAdd, getPlaylistUrls, loadBatch } = require('../utils/playlist');
const { MAX_SONG_DURATION } = require('../config');

/**
 * Xử lý lệnh !p <query> — Phát nhạc
 */
async function play(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('❌ Bạn phải vào một kênh thoại (Voice Channel) trước!');
    }

    let query = message.content.slice(3).trim();
    const guildId = message.guild.id;

    let autoPlayFirst = false;
    // Kiểm tra cờ " 1" ở cuối (tự động phát bài đầu tiên)
    if (!query.startsWith('http') && query.endsWith(' 1')) {
        autoPlayFirst = true;
        query = query.slice(0, -2).trim();
    }

    try {
        // Dọn dẹp queue cũ nếu có (resume trước để stop hoạt động đúng)
        const existingQueue = distube.getQueue(message);
        if (existingQueue) {
            if (existingQueue.paused) {
                distube.resume(message);
            }
            await distube.stop(message).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Reset playlist data cũ
        playlistData.delete(guildId);

        const isPlaylistUrl = query.startsWith('http') && (query.includes('list=') || query.includes('/playlist'));

        if (isPlaylistUrl) {
            await handlePlaylist(message, distube, query, guildId, voiceChannel);
        } else {
            await handleSingleSong(message, distube, query, voiceChannel, autoPlayFirst);
        }
    } catch (error) {
        console.error('Lỗi phát nhạc:', error);
        const errMsg = error.message || String(error);
        const errCode = error.errorCode || '';

        if (errMsg.includes('ConnectTimeout') || errMsg.includes('UND_ERR_CONNECT_TIMEOUT') || errMsg.includes('ETIMEDOUT') || errMsg.includes('fetch failed')) {
            message.reply('⏱️ Kết nối bị timeout! Mạng có thể đang chậm. Hãy thử lại sau vài giây.');
        } else if (errMsg.includes('No result') || errMsg.includes('not a supported')) {
            message.reply('❌ Không tìm thấy bài hát hoặc link không hợp lệ!');
        } else if (errCode === 'YTDLP_ERROR') {
            // Phân tích lỗi yt-dlp cụ thể
            if (errMsg.includes('Sign in') || errMsg.includes('age') || errMsg.includes('confirm your age')) {
                message.reply('🔞 Video này yêu cầu xác minh tuổi. Hãy thử bài khác!');
            } else if (errMsg.includes('not available') || errMsg.includes('Video unavailable') || errMsg.includes('removed')) {
                message.reply('❌ Video không khả dụng hoặc đã bị xóa!');
            } else if (errMsg.includes('geo') || errMsg.includes('country') || errMsg.includes('blocked')) {
                message.reply('🌍 Video bị chặn ở khu vực này! Hãy thử bài khác.');
            } else if (errMsg.includes('bot') || errMsg.includes('captcha') || errMsg.includes('403')) {
                message.reply('🤖 YouTube đang chặn bot! Hãy thử lại sau vài phút.');
            } else if (errMsg.includes('Private video') || errMsg.includes('private')) {
                message.reply('🔒 Video này ở chế độ riêng tư!');
            } else {
                message.reply('❌ Không thể phát bài này! Hãy thử bài khác hoặc thử lại sau.');
            }
        } else {
            message.reply('❌ Có lỗi xảy ra khi phát nhạc! Hãy thử một bài khác.');
        }
    }
}

/**
 * Xử lý phát playlist với lazy loading
 */
async function handlePlaylist(message, distube, query, guildId, voiceChannel) {
    const statusMsg = await message.channel.send('📋 Đang phân tích playlist... (chỉ mất vài giây)');

    const { name, urls } = await getPlaylistUrls(query);

    if (urls.length === 0) {
        return statusMsg.edit('❌ Playlist trống hoặc không hợp lệ!');
    }

    // Lưu trạng thái playlist
    playlistData.set(guildId, {
        name,
        urls,
        loadedIndex: 0,
        isLoading: false,
        voiceChannel,
        textChannel: message.channel,
        member: message.member,
    });

    const guildData = playlistData.get(guildId);
    const initialBatch = Math.min(5, urls.length);

    await statusMsg.edit(
        `📋 **${name}** — ${urls.length} bài\n` +
        `⚡ Đang tải ${initialBatch} bài đầu tiên để phát ngay...`
    );

    const loaded = await loadBatch(distube, initialBatch, guildData, voiceChannel, {
        message,
        textChannel: message.channel,
        member: message.member,
    });

    const remaining = urls.length - guildData.loadedIndex;
    if (remaining > 0) {
        message.channel.send(
            `✅ Đã tải **${loaded}/${urls.length}** bài — đang phát!\n` +
            `🔄 Còn **${remaining}** bài sẽ được tải tự động khi cần.`
        );
    } else {
        message.channel.send(`✅ Đã tải toàn bộ **${loaded}** bài từ playlist!`);
    }
}

/**
 * Xử lý phát bài đơn
 */
async function handleSingleSong(message, distube, query, voiceChannel, autoPlayFirst = false) {
    let playQuery = query;

    if (!query.startsWith('http')) {
        const searchMsg = await message.channel.send(`🔍 Đang tìm kiếm: \`${query}\`...`);
        const searchResult = await ytSearch(query);

        if (searchResult && searchResult.videos.length > 0) {
            if (autoPlayFirst) {
                const firstVideo = searchResult.videos[0];
                // Kiểm tra thời lượng bài hát
                if (firstVideo.seconds && firstVideo.seconds > MAX_SONG_DURATION) {
                    await searchMsg.edit(`❌ Không thể phát nhạc **${firstVideo.title}** vì nhạc quá dài (${firstVideo.timestamp})`);
                    return;
                }
                playQuery = firstVideo.url;
                await searchMsg.edit(`✅ Đã tự động chọn bài đầu tiên: **${firstVideo.title}**`);
                await distube.play(voiceChannel, playQuery, {
                    message,
                    textChannel: message.channel,
                    member: message.member,
                });
                return;
            }

            // Lấy 20 kết quả đầu tiên
            const topResults = searchResult.videos.slice(0, 20);
            const PAGE_SIZE = 5;
            let currentPage = 0;
            const totalPages = Math.ceil(topResults.length / PAGE_SIZE);

            const formatViews = (views) => {
                if (!views) return '0';
                if (views >= 1000000) return (views / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
                if (views >= 1000) return (views / 1000).toFixed(1).replace(/\\.0$/, '') + 'N';
                return views.toString();
            };

            const generateEmbeds = (page) => {
                const start = page * PAGE_SIZE;
                const end = Math.min(start + PAGE_SIZE, topResults.length);
                const embeds = [];
                for (let i = start; i < end; i++) {
                    const video = topResults[i];
                    embeds.push(
                        new EmbedBuilder()
                            .setColor('#0099ff')
                            .setTitle(`[${i + 1}] ` + (video.title.length > 200 ? video.title.substring(0, 197) + '...' : video.title))
                            .setURL(video.url)
                            .setThumbnail(video.image || video.thumbnail)
                            .setDescription(`⏱ **${video.timestamp}** • 👀 **${formatViews(video.views)}** • 👤 **${video.author.name}**\n\u200B`)
                    );
                }
                if (embeds.length > 0) {
                    embeds[embeds.length - 1].setFooter({ text: `Trang ${page + 1} / ${totalPages} • Chọn trong vòng 60s` });
                }
                return embeds;
            };

            const generateComponents = (page) => {
                const start = page * PAGE_SIZE;
                const end = Math.min(start + PAGE_SIZE, topResults.length);
                
                const row1 = new ActionRowBuilder();
                for (let i = start; i < end; i++) {
                    row1.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`select_${i}`)
                            .setLabel(`${i + 1}`)
                            .setStyle(ButtonStyle.Primary)
                    );
                }

                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev')
                        .setEmoji('◀️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0),
                    new ButtonBuilder()
                        .setCustomId('next')
                        .setEmoji('▶️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === totalPages - 1),
                    new ButtonBuilder()
                        .setCustomId('cancel')
                        .setLabel('❌ Hủy')
                        .setStyle(ButtonStyle.Danger)
                );

                return [row1, row2];
            };
            
            await searchMsg.edit({ 
                content: `🔍 **Kết quả tìm kiếm cho \`${query}\`:**`, 
                embeds: generateEmbeds(currentPage), 
                components: generateComponents(currentPage) 
            });

            // Lắng nghe sự kiện click nút
            const filter = i => i.user.id === message.author.id;
            const collector = searchMsg.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.customId === 'cancel') {
                    collector.stop('cancelled');
                    await i.update({ content: '❌ Đã hủy chọn bài hát.', embeds: [], components: [] });
                } else if (i.customId === 'prev') {
                    if (currentPage > 0) currentPage--;
                    await i.update({ embeds: generateEmbeds(currentPage), components: generateComponents(currentPage) });
                } else if (i.customId === 'next') {
                    if (currentPage < totalPages - 1) currentPage++;
                    await i.update({ embeds: generateEmbeds(currentPage), components: generateComponents(currentPage) });
                } else if (i.customId.startsWith('select_')) {
                    const choiceIndex = parseInt(i.customId.split('_')[1], 10);
                    const selectedVideo = topResults[choiceIndex];
                    
                    // Kiểm tra thời lượng bài hát
                    if (selectedVideo.seconds && selectedVideo.seconds > MAX_SONG_DURATION) {
                        await i.update({ 
                            content: `❌ Không thể phát nhạc **${selectedVideo.title}** vì nhạc quá dài (${selectedVideo.timestamp})`, 
                            embeds: [], 
                            components: [] 
                        });
                        collector.stop('too_long');
                        return;
                    }
                    
                    playQuery = selectedVideo.url;
                    collector.stop('selected');
                    await i.update({ content: `✅ Đã chọn: **${selectedVideo.title}**`, embeds: [], components: [] });
                    
                    // Bắt đầu phát nhạc
                    await distube.play(voiceChannel, playQuery, {
                        message,
                        textChannel: message.channel,
                        member: message.member,
                    });
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    searchMsg.edit({ content: '⏳ Hết thời gian chờ, đã hủy chọn bài hát.', embeds: [], components: [] }).catch(() => {});
                }
            });

            // Return sớm vì distube.play đã được xử lý trong collector
            return;
        } else {
            return searchMsg.edit('❌ Không tìm thấy bài hát nào trên YouTube.');
        }
    } else {
        message.channel.send(`🔍 Đang xử lý đường link...`);
    }

    await distube.play(voiceChannel, playQuery, {
        message,
        textChannel: message.channel,
        member: message.member,
    });
}

/**
 * Xử lý lệnh !st — Dừng nhạc
 */
async function stop(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        playlistData.delete(message.guild.id);
        distube.stop(message);
        message.reply('⏹️ Đã dừng nhạc và dọn dẹp danh sách phát.');
    } catch (error) {
        message.reply('❌ Hiện tại không có bài hát nào đang phát.');
    }
}

/**
 * Xử lý lệnh !p (không có query) — Tạm dừng
 */
async function pause(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ Hiện tại không có bài hát nào đang phát.');
        if (queue.paused) return message.reply('⚠️ Nhạc đã đang tạm dừng rồi!');
        distube.pause(message);
        message.reply('⏸️ Đã tạm dừng nhạc. Dùng `!re` để tiếp tục.');
    } catch (error) {
        console.error('Lỗi pause:', error);
        message.reply('❌ Không thể tạm dừng nhạc.');
    }
}

/**
 * Xử lý lệnh !re — Tiếp tục phát
 */
async function resume(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ Hiện tại không có bài hát nào đang phát.');
        if (!queue.paused) return message.reply('⚠️ Nhạc đang phát rồi!');
        distube.resume(message);
        message.reply('▶️ Đã tiếp tục phát nhạc!');
    } catch (error) {
        console.error('Lỗi resume:', error);
        message.reply('❌ Không thể tiếp tục phát nhạc.');
    }
}

/**
 * Xử lý lệnh !s — Bỏ qua bài
 */
async function skip(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ Hiện tại không có bài hát nào đang phát.');

        if (queue.songs.length <= 1) {
            const guildData = playlistData.get(message.guild.id);
            if (guildData && guildData.loadedIndex < guildData.urls.length) {
                message.reply('⏭️ Đang tải bài tiếp theo từ playlist...');
                await loadBatch(distube, 1, guildData, voiceChannel, {
                    message,
                    textChannel: message.channel,
                    member: message.member,
                });
                await distube.skip(message).catch(() => { });
            } else {
                distube.stop(message);
                playlistData.delete(message.guild.id);
                return message.reply('⏭️ Không còn bài tiếp theo, đã dừng phát nhạc.');
            }
        } else {
            await distube.skip(message);
            message.reply('⏭️ Đã bỏ qua bài hát hiện tại!');
        }
    } catch (error) {
        console.error('Lỗi skip:', error);
        message.reply('❌ Không thể bỏ qua bài hát.');
    }
}

/**
 * Xử lý lệnh !q — Xem hàng đợi
 */
async function queue(message, distube) {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ Hiện tại không có hàng đợi nào.');

    const guildData = playlistData.get(message.guild.id);
    const currentSong = queue.songs[0];
    let queueText = `🎶 **Đang phát:** ${currentSong.name} - \`${currentSong.formattedDuration}\`\n\n`;

    const upcoming = queue.songs.slice(1, 11);
    if (upcoming.length > 0) {
        queueText += `📋 **Hàng đợi:**\n`;
        upcoming.forEach((song, i) => {
            queueText += `${i + 1}. ${song.name} - \`${song.formattedDuration}\`\n`;
        });
    }

    if (queue.songs.length > 11) {
        queueText += `\n... và ${queue.songs.length - 11} bài khác trong queue`;
    }

    if (guildData && guildData.loadedIndex < guildData.urls.length) {
        const remaining = guildData.urls.length - guildData.loadedIndex;
        queueText += `\n\n🔄 Playlist **${guildData.name}**: còn **${remaining}** bài chưa tải`;
    }

    message.channel.send(queueText);
}

/**
 * Xử lý lệnh !r — Phát lại từ đầu
 */
async function replay(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ Hiện tại không có bài hát nào đang phát.');
        distube.seek(message, 0);
        message.reply('⏪ Đang phát lại bài hát từ đầu!');
    } catch (error) {
        console.error('Lỗi replay:', error);
        message.reply('❌ Không thể phát lại bài hát.');
    }
}

/**
 * Xử lý lệnh !l [song|all|off] — Lặp lại
 */
async function loop(message, distube) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn chưa vào kênh thoại!');

    try {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ Hiện tại không có bài hát nào đang phát.');

        const args = message.content.split(' ');
        let mode = 0;

        if (args[1] === 'song') {
            mode = 1;
        } else if (args[1] === 'all') {
            mode = 2;
        } else if (args[1] === 'off') {
            mode = 0;
        } else {
            mode = queue.repeatMode === 0 ? 1 : 0;
        }

        mode = distube.setRepeatMode(message, mode);
        const modeText = mode ? (mode === 2 ? 'Lặp lại danh sách (Queue)' : 'Lặp lại bài hát (Song)') : 'Tắt lặp lại (Off)';
        message.reply(`🔁 Chế độ lặp lại: **${modeText}**`);
    } catch (error) {
        console.error('Lỗi loop:', error);
        message.reply('❌ Không thể thay đổi chế độ lặp lại.');
    }
}

/**
 * Ngắt kết nối bot
 */
async function leave(message, distube) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('❌ Bạn phải vào kênh thoại thì mới có thể ngắt kết nối bot!');
    }

    try {
        await distube.voices.leave(message);
        message.channel.send('👋 Đã ngắt kết nối và rời khỏi kênh thoại!');
    } catch (e) {
        // Fallback ngắt bằng getVoiceConnection nếu distube bị lỗi state
        const { getVoiceConnection } = require('@discordjs/voice');
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            message.channel.send('👋 Đã ngắt kết nối và rời khỏi kênh thoại!');
        } else {
            message.reply('❌ Bot hiện không ở trong kênh thoại nào!');
        }
    }
}

module.exports = {
    play,
    stop,
    pause,
    resume,
    skip,
    queue,
    replay,
    loop,
    leave
};
