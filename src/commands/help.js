const { EmbedBuilder } = require('discord.js');

/**
 * Xử lý lệnh !help — Hiện danh sách lệnh
 */
async function execute(message) {
    const embed = new EmbedBuilder()
        .setColor('#00ff99')
        .setTitle('📋 BẢNG HƯỚNG DẪN TÍNH NĂNG')
        .setDescription('Chào mừng bạn đến với hệ thống Bot! Dưới đây là các lệnh bạn có thể sử dụng:')
        .addFields(
            {
                name: '🎵 Âm nhạc',
                value: 
                    `\`!p <tên bài>\` : Tìm và chọn nhạc (giao diện lật trang)\n` +
                    `\`!p <tên bài> 1\` : Tự động phát bài hát đầu tiên tìm được\n` +
                    `\`!p <link>\` : Phát trực tiếp từ link YouTube / SoundCloud\n` +
                    `\`!p\` : Tạm dừng nhạc đang phát\n` +
                    `\`!re\` : Tiếp tục phát nhạc\n` +
                    `\`!dc\` / \`!leave\` : Ngắt kết nối bot khỏi kênh thoại\n` +
                    `\`!st\` : Dừng hẳn nhạc và xóa danh sách chờ\n` +
                    `\`!s\` : Bỏ qua (Skip) bài hiện tại\n` +
                    `\`!q\` : Xem danh sách hàng đợi\n` +
                    `\`!r\` : Phát lại bài hiện tại từ đầu\n` +
                    `\`!l song\` : Bật/tắt lặp lại bài hát đang phát\n` +
                    `\`!l all\` : Bật/tắt lặp lại toàn bộ danh sách`
            },
            {
                name: '🤖 Trợ lý AI Thông minh',
                value: `\`!chat <câu hỏi>\` : Trò chuyện với AI (có khả năng tìm kiếm tin tức web)`
            }
        )
        .setFooter({ text: 'AI Discord Bot', iconURL: message.client.user.displayAvatarURL() })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };
