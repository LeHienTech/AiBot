const { BLACKLIST } = require('../config');

/**
 * Kiểm duyệt từ ngữ cấm trong tin nhắn
 * @param {Object} message - Discord message
 * @returns {boolean} true nếu tin nhắn bị chặn
 */
async function checkMessage(message) {
    const contentLower = message.content.toLowerCase();
    const hasBadWord = BLACKLIST.some(word => contentLower.includes(word));

    if (!hasBadWord) return false;

    try {
        await message.delete();
        const warningMessage = await message.channel.send(`⚠️ ${message.author}, ngôn từ không phù hợp!`);
        setTimeout(() => warningMessage.delete().catch(console.error), 5000);

        if (message.member.moderatable) {
            await message.member.timeout(60000, 'Vi phạm quy tắc ngôn từ');
        }
    } catch (error) {
        console.error('Lỗi kiểm duyệt:', error);
    }

    return true;
}

module.exports = { checkMessage };
