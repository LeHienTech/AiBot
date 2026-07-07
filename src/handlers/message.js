const nsfwDetector = require('../features/nsfw-detector');
const moderation = require('../features/moderation');
const musicCmd = require('../commands/music');
const chatCmd = require('../commands/chat_agentic');
const helpCmd = require('../commands/help');

/**
 * Đăng ký message handler cho client
 * @param {Object} client - Discord Client
 */
function register(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;

        const distube = client.distube;
        const content = message.content;

        // ─── 1A. Kiểm tra NSFW (chỉ khi có ảnh đính kèm) ───
        if (message.attachments.size > 0) {
            const isNsfw = await nsfwDetector.checkMessage(message);
            if (isNsfw) return;
        }

        // ─── 1B. Kiểm duyệt từ ngữ ───
        const isBadWord = await moderation.checkMessage(message);
        if (isBadWord) return;

        // ─── 2. Command Router ───
        if (content.startsWith('!p ')) {
            await musicCmd.play(message, distube);
        } else if (content === '!st') {
            await musicCmd.stop(message, distube);
        } else if (content === '!p') {
            await musicCmd.pause(message, distube);
        } else if (content === '!re') {
            await musicCmd.resume(message, distube);
        } else if (content === '!s') {
            await musicCmd.skip(message, distube);
        } else if (content === '!q') {
            await musicCmd.queue(message, distube);
        } else if (content === '!r') {
            await musicCmd.replay(message, distube);
        } else if (content === '!l' || content.startsWith('!l ')) {
            await musicCmd.loop(message, distube);
        } else if (content === '!dc' || content === '!leave') {
            await musicCmd.leave(message, distube);
        } else if (content.startsWith('!chat ')) {
            await chatCmd.execute(message);
        } else if (content === '!help' || content.startsWith('!help ')) {
            await helpCmd.execute(message);
        }
    });
}

module.exports = { register };
