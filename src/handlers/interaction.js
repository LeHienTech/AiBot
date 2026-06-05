const { EmbedBuilder } = require('discord.js');

/**
 * Đăng ký button interaction handler cho client
 * @param {Object} client - Discord Client
 */
function register(client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        if (interaction.customId.startsWith('delete_nsfw_')) {
            await handleDeleteNsfw(interaction, client);
        } else if (interaction.customId.startsWith('keep_nsfw_')) {
            await handleKeepNsfw(interaction);
        }
    });
}

/**
 * Xử lý nút "Xóa tin nhắn vi phạm"
 */
async function handleDeleteNsfw(interaction, client) {
    await interaction.deferUpdate().catch(() => { });

    const parts = interaction.customId.split('_');
    const channelId = parts[2];
    const messageId = parts[3];

    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const targetMessage = await channel.messages.fetch(messageId);
            if (targetMessage) {
                const offender = targetMessage.author;
                await targetMessage.delete();

                // Gửi thông báo vào kênh vi phạm
                const warningMsg = await channel.send(
                    `⚠️ ${offender}, Hình ảnh nhạy cảm của bạn đã bị xóa do vi phạm nội quy!`
                ).catch(() => { });
                if (warningMsg) {
                    setTimeout(() => warningMsg.delete().catch(() => { }), 5000);
                }

                // Cập nhật embed
                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x00FF00)
                    .setDescription(`✅ Đã xóa tin nhắn vi phạm của ${offender.tag}.`);

                await interaction.editReply({ embeds: [newEmbed], components: [] }).catch(() => { });
                return;
            }
        }
    } catch (error) {
        console.error('Lỗi khi xóa tin nhắn từ nút bấm:', error.message);

        if (error.code === 10008) { // Unknown Message
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x808080)
                .setDescription('⚠️ Tin nhắn này đã bị xóa trước đó.');
            await interaction.editReply({ embeds: [newEmbed], components: [] }).catch(() => { });
            return;
        } else if (error.code === 50013) { // Missing Permissions
            await interaction.followUp({
                content: '❌ Lỗi: Bot không có quyền **Quản lý tin nhắn (Manage Messages)** trong kênh gốc để xóa ảnh. Vui lòng cấp quyền cho Bot!',
                ephemeral: true
            }).catch(() => { });
            return;
        }
    }

    await interaction.followUp({
        content: '❌ Không thể xóa tin nhắn (Tin nhắn có thể đã bị xóa hoặc Bot không có quyền).',
        ephemeral: true
    }).catch(() => { });
}

/**
 * Xử lý nút "Bỏ qua (Ảnh an toàn)"
 */
async function handleKeepNsfw(interaction) {
    await interaction.deferUpdate().catch(() => { });

    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x00A1FF)
        .setDescription('☑️ Quản trị viên đã xác nhận hình ảnh này an toàn (Không xóa).');

    await interaction.editReply({ embeds: [newEmbed], components: [] }).catch(() => { });
}

module.exports = { register };
