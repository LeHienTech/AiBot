const http = require('http');
const { spawn } = require('child_process');
const { YT_DLP_PATH } = require('../config');

let server = null;
let proxyPort = null;

/**
 * Khởi tạo local HTTP proxy server để stream audio qua yt-dlp.
 * 
 * Tại sao cần proxy?
 * - Khi phát nhạc dài, YouTube sẽ throttle (giảm tốc độ) stream URL trực tiếp
 * - FFmpeg không xử lý được cơ chế throttle của YouTube
 * - Bằng cách dùng yt-dlp làm trung gian, yt-dlp xử lý toàn bộ throttle/retry
 * - FFmpeg chỉ cần đọc từ localhost → luôn ổn định
 * 
 * @returns {Promise<number>} Port của proxy server
 */
function startProxy() {
    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            try {
                const reqUrl = new URL(req.url, 'http://127.0.0.1');
                const videoUrl = reqUrl.searchParams.get('url');

                if (!videoUrl) {
                    res.writeHead(400);
                    res.end('Missing url');
                    return;
                }

                console.log(`[audio-proxy] 🎵 Stream: ${videoUrl.substring(0, 80)}...`);

                const args = [
                    '-f', 'bestaudio[ext=webm]/bestaudio/best',  // Ưu tiên webm audio (Opus) → ít transcode
                    '-o', '-',                 // Output to stdout (pipe)
                    '--no-warnings',
                    '--no-part',
                    '--no-cache-dir',
                    '--no-check-certificates',
                    '--retries', '10',         // Retry 10 lần nếu lỗi mạng
                    '--fragment-retries', '10', // Retry fragment 10 lần
                    '--retry-sleep', '1',      // Chờ 1 giây giữa các lần retry
                    '--buffer-size', '1M',     // Buffer lớn hơn (1M thay vì 16K)
                    '--http-chunk-size', '10M', // Tải từng chunk 10MB — tránh throttle
                    '--socket-timeout', '30',  // Timeout socket 30 giây (tránh treo vĩnh viễn)
                    '--no-playlist',
                    '--js-runtimes', 'node',
                    '--extractor-args', 'youtube:player_client=android,web', // Bypass 403 Forbidden
                    '--force-ipv4',            // Bypass IPv6 blocks which often get 403
                    '--no-abort-on-error',     // Không dừng nếu gặp lỗi nhỏ
                ];

                const fs = require('fs');
                const path = require('path');
                const cookiesPath = path.join(__dirname, '../../cookies.txt');
                if (fs.existsSync(cookiesPath)) {
                    args.push('--cookies', cookiesPath);
                }

                args.push(videoUrl);

                // Spawn yt-dlp để download và pipe audio trực tiếp
                const ytdlp = spawn(YT_DLP_PATH, args, {
                    windowsHide: true,
                });

                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Accept-Ranges': 'none',
                    'Connection': 'keep-alive',
                });

                // ─── Watchdog: phát hiện stream bị treo ───
                // Nếu không nhận data trong 30 giây → yt-dlp bị stall → kill
                let watchdogTimer = null;
                const WATCHDOG_TIMEOUT = 30000; // 30 giây

                const resetWatchdog = () => {
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    watchdogTimer = setTimeout(() => {
                        console.error('[audio-proxy] ⚠️ Stream stall detected (no data for 30s), killing yt-dlp');
                        if (ytdlp && !ytdlp.killed) {
                            ytdlp.kill('SIGTERM');
                            // Force kill sau 3 giây nếu SIGTERM không work
                            setTimeout(() => {
                                if (ytdlp && !ytdlp.killed) {
                                    ytdlp.kill('SIGKILL');
                                }
                            }, 3000);
                        }
                    }, WATCHDOG_TIMEOUT);
                };

                // Bắt đầu watchdog
                resetWatchdog();

                // Pipe: yt-dlp stdout → HTTP response → FFmpeg
                ytdlp.stdout.on('data', (chunk) => {
                    resetWatchdog(); // Reset watchdog mỗi khi nhận data
                    if (!res.writableEnded) {
                        // Backpressure handling: nếu response buffer đầy, tạm dừng đọc
                        const canWrite = res.write(chunk);
                        if (!canWrite) {
                            ytdlp.stdout.pause();
                            res.once('drain', () => {
                                ytdlp.stdout.resume();
                            });
                        }
                    }
                });

                ytdlp.stderr.on('data', (data) => {
                    const msg = data.toString().trim();
                    // Chỉ log lỗi thật, bỏ qua download progress & info
                    if (msg && !msg.startsWith('[download]') && !msg.startsWith('[info]')
                        && !msg.startsWith('Deleting') && !msg.startsWith('[youtube]')
                        && !msg.startsWith('[ExtractAudio]')
                        && !msg.startsWith('Deprecated Feature')) {
                        console.error(`[audio-proxy] yt-dlp: ${msg}`);
                    }
                });

                ytdlp.on('error', (err) => {
                    console.error('[audio-proxy] yt-dlp spawn error:', err.message);
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    if (!res.writableEnded) res.end();
                });

                ytdlp.on('close', (code) => {
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    if (code !== 0 && code !== null) {
                        console.error(`[audio-proxy] yt-dlp exit code: ${code}`);
                    }
                    if (!res.writableEnded) res.end();
                });

                // Cleanup khi FFmpeg ngắt (skip, stop, bot rời kênh, etc.)
                const cleanup = () => {
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    if (ytdlp && !ytdlp.killed) {
                        ytdlp.kill();
                    }
                };
                req.on('close', cleanup);
                req.on('error', cleanup);
                res.on('error', cleanup);

            } catch (err) {
                console.error('[audio-proxy] Request error:', err.message);
                if (!res.headersSent) res.writeHead(500);
                if (!res.writableEnded) res.end();
            }
        });

        // Keep-alive để tránh connection bị đóng giữa chừng
        server.keepAliveTimeout = 120000; // 2 phút
        server.headersTimeout = 125000;   // Hơn keepAlive một chút

        server.listen(0, '127.0.0.1', () => {
            proxyPort = server.address().port;
            console.log(`🎵 Audio proxy: http://127.0.0.1:${proxyPort}`);
            resolve(proxyPort);
        });

        server.on('error', (err) => {
            console.error('[audio-proxy] Server error:', err.message);
            reject(err);
        });
    });
}

/**
 * Tạo URL proxy cho một video URL
 * @param {string} videoUrl - URL gốc (YouTube, etc.)
 * @returns {string} URL proxy local
 */
function getProxyUrl(videoUrl) {
    if (!proxyPort) throw new Error('Audio proxy chưa sẵn sàng');
    return `http://127.0.0.1:${proxyPort}/stream?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * Dừng proxy server
 */
function stopProxy() {
    if (server) {
        server.close();
        server = null;
        proxyPort = null;
    }
}

module.exports = { startProxy, getProxyUrl, stopProxy };
