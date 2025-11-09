const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

let ytDlpWrap;

async function downloadYtDlpStandalone() {
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const ytDlpPath = path.join(tmpDir, 'yt-dlp');
    
    // URL cho Linux standalone binary (không cần Python)
    const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    
    console.log('📥 Downloading yt-dlp standalone binary (no Python needed)...');
    
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(ytDlpPath);
        
        https.get(downloadUrl, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                https.get(response.headers.location, (redirectResponse) => {
                    redirectResponse.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        fs.chmodSync(ytDlpPath, 0o755);
                        console.log('✅ Downloaded standalone binary');
                        resolve(ytDlpPath);
                    });
                });
            } else {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    fs.chmodSync(ytDlpPath, 0o755);
                    console.log('✅ Downloaded standalone binary');
                    resolve(ytDlpPath);
                });
            }
        }).on('error', (err) => {
            fs.unlink(ytDlpPath, () => {});
            reject(err);
        });
        
        file.on('error', (err) => {
            fs.unlink(ytDlpPath, () => {});
            reject(err);
        });
    });
}

async function initYtDlp() {
    try {
        console.log('🚀 Starting yt-dlp initialization...');
        
        const ytDlpPath = await downloadYtDlpStandalone();
        console.log('📁 Binary path:', ytDlpPath);
        
        // Test binary
        console.log('🧪 Testing yt-dlp...');
        const { stdout } = await execAsync(`${ytDlpPath} --version`);
        console.log('✅ yt-dlp version:', stdout.trim());
        
        ytDlpWrap = new YTDlpWrap(ytDlpPath);
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize yt-dlp:', error.message);
        return false;
    }
}

function formatFileSize(bytes) {
    if (!bytes) return 'N/A';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

app.get('/api/health', (req, res) => {
    res.json({ 
        status: ytDlpWrap ? 'ok' : 'initializing',
        message: ytDlpWrap ? 'Server is running' : 'Server is initializing...',
        ytdlpReady: !!ytDlpWrap
    });
});

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!ytDlpWrap) {
            return res.status(503).json({ 
                error: 'Server is still initializing. Please wait and try again.' 
            });
        }

        let info;
        try {
            info = await ytDlpWrap.getVideoInfo(url);
        } catch (err) {
            console.error('Failed to fetch video info:', err.message);
            return res.status(500).json({
                error: 'Không thể lấy thông tin video. Vui lòng kiểm tra lại link.'
            });
        }

        // ✅ Kiểm tra nếu formats không tồn tại hoặc không phải mảng
        if (!info || !Array.isArray(info.formats)) {
            return res.status(500).json({
                error: 'Thông tin định dạng video không khả dụng. Link có thể không hợp lệ.'
            });
        }

        const videoFormats = info.formats
            .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.format_id)
            .map(f => ({
                format_id: f.format_id,
                quality: f.format_note || f.resolution || 'Unknown',
                format: f.ext,
                size: formatFileSize(f.filesize || f.filesize_approx),
                resolution: f.resolution || 'N/A'
            }))
            .sort((a, b) => {
                const getHeight = (res) => parseInt(res?.split('x')[1]) || 0;
                return getHeight(b.resolution) - getHeight(a.resolution);
            });

        const audioFormats = info.formats
            .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.format_id)
            .map(f => ({
                format_id: f.format_id,
                quality: `${f.abr || 'Unknown'}kbps`,
                format: f.ext,
                size: formatFileSize(f.filesize || f.filesize_approx)
            }))
            .sort((a, b) => {
                const bitrateA = parseInt(a.quality) || 0;
                const bitrateB = parseInt(b.quality) || 0;
                return bitrateB - bitrateA;
            });

        const uniqueVideoFormats = Array.from(
            new Map(videoFormats.map(f => [f.quality, f])).values()
        );
        
        const uniqueAudioFormats = Array.from(
            new Map(audioFormats.map(f => [f.quality, f])).values()
        );

        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            author: info.uploader,
            formats: {
                video: uniqueVideoFormats.slice(0, 10),
                audio: uniqueAudioFormats.slice(0, 5)
            }
        });

    } catch (error) {
        console.error('Error getting video info:', error);
        res.status(500).json({ 
            error: 'Không thể lấy thông tin video. Vui lòng kiểm tra lại link.' 
        });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, format_id } = req.query;

        if (!url || !format_id) {
            return res.status(400).json({ error: 'URL and format_id are required' });
        }

        if (!ytDlpWrap) {
            return res.status(503).json({ 
                error: 'Server is still initializing. Please try again.' 
            });
        }

        const info = await ytDlpWrap.getVideoInfo(url);
        const title = info.title.replace(/[^\w\s-]/g, '');
        const format = info.formats.find(f => f.format_id === format_id);
        const ext = format?.ext || 'mp4';

        res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        const stream = ytDlpWrap.execStream([
            url,
            '-f', format_id,
            '-o', '-'
        ]);

        stream.pipe(res);

        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed' });
            }
        });

    } catch (error) {
        console.error('Error downloading video:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Không thể tải video. Vui lòng thử lại.' 
            });
        }
    }
});

const PORT = process.env.PORT || 8080;

console.log('🎬 Initializing YouTube Downloader Server...');
initYtDlp().then((success) => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(success ? '✅ Ready to download!' : '❌ yt-dlp unavailable');
    });
}).catch(error => {
    console.error('💥 Startup failed:', error);
    process.exit(1);
});