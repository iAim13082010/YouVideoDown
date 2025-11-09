const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

const app = express();
const ytDlpWrap = new YTDlpWrap();

app.use(cors());
app.use(express.json());

function formatFileSize(bytes) {
    if (!bytes) return 'N/A';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const info = await ytDlpWrap.getVideoInfo(url);
        
        // Extract video formats
        const videoFormats = info.formats
            .filter(f => f.vcodec !== 'none' && f.acodec !== 'none')
            .map(f => ({
                format_id: f.format_id,
                quality: f.format_note || f.resolution || 'Unknown',
                format: f.ext,
                size: formatFileSize(f.filesize || f.filesize_approx),
                resolution: f.resolution || 'N/A'
            }));

        // Extract audio formats
        const audioFormats = info.formats
            .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
            .map(f => ({
                format_id: f.format_id,
                quality: `${f.abr || 'Unknown'}kbps`,
                format: f.ext,
                size: formatFileSize(f.filesize || f.filesize_approx)
            }));

        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            author: info.uploader,
            formats: {
                video: videoFormats.slice(0, 10),
                audio: audioFormats.slice(0, 5)
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

        const info = await ytDlpWrap.getVideoInfo(url);
        const title = info.title.replace(/[^\w\s-]/g, '');
        const format = info.formats.find(f => f.format_id === format_id);
        const ext = format?.ext || 'mp4';

        res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);

        // Stream download
        const stream = ytDlpWrap.execStream([
            url,
            '-f', format_id,
            '-o', '-'
        ]);

        stream.pipe(res);

    } catch (error) {
        console.error('Error downloading video:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Không thể tải video. Vui lòng thử lại.' 
            });
        }
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});