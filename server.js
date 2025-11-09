const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());

let ytDlpWrap;

async function initYtDlp() {
    try {
        console.log('📥 Starting yt-dlp initialization...');
        
        // Tạo thư mục tmp nếu chưa có
        const tmpDir = path.join(__dirname, 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
            console.log('✅ Created tmp directory');
        }

        // Chỉ định path để lưu yt-dlp
        const ytDlpPath = path.join(tmpDir, 'yt-dlp');
        
        console.log('📥 Downloading yt-dlp binary to:', ytDlpPath);
        
        // Download với path cụ thể
        await YTDlpWrap.downloadFromGithub(ytDlpPath);
        
        // Kiểm tra file có tồn tại không
        if (!fs.existsSync(ytDlpPath)) {
            throw new Error('yt-dlp binary not found after download');
        }
        
        console.log('✅ yt-dlp downloaded successfully');
        console.log('📁 Binary path:', ytDlpPath);
        
        // Kiểm tra quyền execute
        try {
            fs.chmodSync(ytDlpPath, 0o755);
            console.log('✅ Set execute permission');
        } catch (err) {
            console.warn('⚠️  Could not set execute permission:', err.message);
        }
        
        // Khởi tạo ytDlpWrap với path
        ytDlpWrap = new YTDlpWrap(ytDlpPath);
        
        // Test xem có hoạt động không
        console.log('🧪 Testing yt-dlp...');
        const version = await ytDlpWrap.getVersion();
        console.log('✅ yt-dlp version:', version);
        
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize yt-dlp:', error);
        console.error('Error details:', error.stack);
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
                error: 'Server is still initializing. Please wait a moment and try again.' 
            });
        }

        console.log('🔍 Getting video info for:', url);
        const info = await ytDlpWrap.getVideoInfo(url);
        console.log('✅ Video info retrieved:', info.title);
        
        const videoFormats = info.formats
            .filter(f => f.vcodec !== 'none' && f.acodec !== 'none')
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
            .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
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

        console.log('⬇️  Downloading format:', format_id, 'from:', url);
        
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

// Khởi động server
console.log('🚀 Starting server initialization...');
initYtDlp().then((success) => {
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on port ${PORT}`);
        if (success) {
            console.log('✅ yt-dlp ready to use');
        } else {
            console.log('⚠️  Server started but yt-dlp is NOT available');
            console.log('❌ Video download features will not work');
        }
    });
}).catch(error => {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
});