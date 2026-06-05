const tf = require('@tensorflow/tfjs');
const nsfwjs = require('nsfwjs');
const axios = require('axios');
const sharp = require('sharp');
const { EmbedBuilder, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { NSFW_THRESHOLD, NSFW_MAX_IMAGE_SIZE, TIMEOUTS } = require('../config');

// Biến lưu NSFW model (singleton)
let nsfwModel = null;

/**
 * Tải NSFW model khi bot khởi động
 */
async function loadModel() {
    console.log('⏳ Đang tải NSFW detection model...');
    try {
        nsfwModel = await nsfwjs.load();
        console.log('✅ NSFW model đã sẵn sàng! Bot có thể phát hiện ảnh nhạy cảm.');
    } catch (error) {
        console.error('❌ Lỗi tải NSFW model:', error.message);
        console.log('⚠️ Bot sẽ hoạt động bình thường nhưng không kiểm tra được ảnh NSFW.');
    }
}

/**
 * Kiểm tra xem model đã sẵn sàng chưa
 */
function isReady() {
    return nsfwModel !== null;
}

/**
 * Phân loại một ảnh, trả về predictions
 */
async function classifyImage(imageUrl) {
    // Tải ảnh về dưới dạng buffer (timeout 10 giây)
    const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: TIMEOUTS.NSFW_IMAGE,
    });
    const imageBuffer = Buffer.from(response.data);

    // Dùng sharp để decode ảnh thành raw pixel data
    const { data, info } = await sharp(imageBuffer)
        .resize(299, 299, { fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Tạo tensor an toàn qua tf.tidy
    const imageTensor = tf.tidy(() => {
        return tf.tensor3d(
            new Uint8Array(data),
            [info.height, info.width, 3]
        );
    });

    // Phân loại ảnh
    const predictions = await nsfwModel.classify(imageTensor);
    
    // Giải phóng bộ nhớ tensor
    imageTensor.dispose();

    return predictions;
}

/**
 * Tính NSFW score từ predictions
 */
function calculateNsfwScore(predictions) {
    const nsfwCategories = ['Porn', 'Hentai', 'Sexy'];
    return predictions
        .filter(p => nsfwCategories.includes(p.className))
        .reduce((sum, p) => sum + p.probability, 0);
}

/**
 * Xử lý kiểm tra NSFW cho một tin nhắn
 * @returns {boolean} true nếu tin nhắn bị chặn (NSFW detected)
 */
async function checkMessage(message) {
    if (!nsfwModel || message.attachments.size === 0) return false;

    const imageAttachments = [...message.attachments.values()].filter(att =>
        att.contentType && att.contentType.startsWith('image/')
        && (!att.size || att.size <= NSFW_MAX_IMAGE_SIZE)
    );

    for (const attachment of imageAttachments) {
        try {
            const predictions = await classifyImage(attachment.url);
            const nsfwScore = calculateNsfwScore(predictions);

            // Log kết quả để debug
            const topPrediction = predictions.reduce((a, b) => a.probability > b.probability ? a : b);
            console.log(`📸 Ảnh từ ${message.author.tag}: ${topPrediction.className} (${(topPrediction.probability * 100).toFixed(1)}%) | NSFW score: ${(nsfwScore * 100).toFixed(1)}%`);

            // Nếu điểm NSFW cao → Gửi cảnh báo
            if (nsfwScore > NSFW_THRESHOLD) {
                await sendNsfwAlert(message, attachment, nsfwScore);
                return true; // Tin nhắn bị chặn
            }
        } catch (error) {
            console.error('Lỗi kiểm tra NSFW:', error.message);
        }
    }

    return false;
}

/**
 * Gửi cảnh báo NSFW vào kênh mod-logs
 */
async function sendNsfwAlert(message, attachment, nsfwScore) {
    let modLogChannel = message.guild.channels.cache.find(c => c.name === 'mod-logs');

    if (!modLogChannel) {
        try {
            modLogChannel = await message.guild.channels.create({
                name: 'mod-logs',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: message.client.user.id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    }
                ]
            });
        } catch (err) {
            console.error('Không thể tạo kênh mod-logs:', err.message);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('⚠️ Cảnh báo Hình ảnh Nhạy cảm (NSFW)')
        .setColor(0xFF0000)
        .setDescription(`Phát hiện hình ảnh có khả năng là NSFW. Cần quản trị viên đánh giá thủ công.`)
        .addFields(
            { name: 'Người gửi', value: `${message.author} (${message.author.tag})`, inline: true },
            { name: 'Kênh', value: `${message.channel}`, inline: true },
            { name: 'Điểm NSFW', value: `${(nsfwScore * 100).toFixed(1)}%`, inline: true },
            { name: 'Đường dẫn gốc', value: `[Nhấn để đi đến tin nhắn](${message.url})` }
        )
        .setImage(attachment.url)
        .setTimestamp();

    const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_nsfw_${message.channel.id}_${message.id}`)
        .setLabel('Xóa tin nhắn vi phạm')
        .setStyle(ButtonStyle.Danger);

    const keepButton = new ButtonBuilder()
        .setCustomId(`keep_nsfw_${message.channel.id}_${message.id}`)
        .setLabel('Bỏ qua (Ảnh an toàn)')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(deleteButton, keepButton);

    if (modLogChannel) {
        await modLogChannel.send({ embeds: [embed], components: [row] });
    } else {
        try {
            const owner = await message.guild.fetchOwner();
            if (owner) {
                await owner.send({ embeds: [embed], components: [row] });
            }
        } catch (dmErr) {
            console.error('Lỗi gửi DM cho owner:', dmErr.message);
        }
    }

    console.log(`🔞 Đã báo cáo ảnh NSFW từ ${message.author.tag} (Score: ${(nsfwScore * 100).toFixed(1)}%)`);
}

module.exports = {
    loadModel,
    isReady,
    checkMessage,
};
