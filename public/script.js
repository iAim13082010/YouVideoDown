const API_URL = 'https://youvideodown.onrender.com/api';

let currentVideoData = null;
let currentMode = 'video';
let currentVideoId = null;

// DOM Elements
const urlInput = document.getElementById('url-input');
const previewBtn = document.getElementById('preview-btn');
const errorMessage = document.getElementById('error-message');
const tabs = document.querySelectorAll('.tab');
const emptyState = document.getElementById('empty-state');
const videoInfo = document.getElementById('video-info');
const videoThumbnail = document.getElementById('video-thumbnail');
const watchYoutube = document.getElementById('watch-youtube');
const formatList = document.getElementById('format-list');
const downloadTitle = document.getElementById('download-title');
const emptyIcon = document.getElementById('empty-icon');
const downloadModal = document.getElementById('download-modal');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const progressStatus = document.getElementById('progress-status');
const downloadFilename = document.getElementById('download-filename');
const downloadQuality = document.getElementById('download-quality');
const cancelDownloadBtn = document.getElementById('cancel-download');

function extractVideoId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

async function getVideoInfo(url) {
    const response = await fetch(`${API_URL}/video-info`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ url })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Không thể lấy thông tin video');
    }

    return await response.json();
}

function renderFormatList() {
    if (!currentVideoData) return;

    const formats = currentMode === 'video' 
        ? currentVideoData.formats.video 
        : currentVideoData.formats.audio;

    downloadTitle.textContent = currentMode === 'video' 
        ? 'Chọn độ phân giải' 
        : 'Chọn chất lượng âm thanh';

    formatList.innerHTML = formats.map((format, index) => `
        <div class="format-item">
            <div class="format-info">
                <div class="format-quality">${format.quality}</div>
                <div class="format-details">
                    ${format.format.toUpperCase()} • ${format.size}
                    ${format.resolution ? ` • ${format.resolution}` : ''}
                </div>
            </div>
            <button class="btn-download" onclick="handleDownload(${index})">
                <span>⬇</span>
                Tải
            </button>
        </div>
    `).join('');
}

async function handleDownload(formatIndex) {
    if (!currentVideoData) return;

    const formats = currentMode === 'video' 
        ? currentVideoData.formats.video 
        : currentVideoData.formats.audio;
    
    const format = formats[formatIndex];
    const url = urlInput.value.trim();
    
    // Hiển thị modal
    downloadModal.classList.remove('hidden');
    downloadFilename.textContent = currentVideoData.title;
    downloadQuality.textContent = `${format.quality} • ${format.format.toUpperCase()}`;
    
    // Reset progress
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatus.textContent = 'Đang chuẩn bị...';
    
    try {
        const downloadUrl = `${API_URL}/download?url=${encodeURIComponent(url)}&format_id=${format.format_id}`;
        
        // Simulate progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                progress += Math.random() * 10;
                if (progress > 90) progress = 90;
                
                progressBar.style.width = progress + '%';
                progressPercent.textContent = Math.floor(progress) + '%';
                
                if (progress < 30) {
                    progressStatus.textContent = 'Đang kết nối...';
                } else if (progress < 60) {
                    progressStatus.textContent = 'Đang tải xuống...';
                } else {
                    progressStatus.textContent = 'Sắp hoàn thành...';
                }
            }
        }, 500);
        
        const response = await fetch(downloadUrl);
        
        if (!response.ok) {
            throw new Error('Không thể tải video');
        }
        
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressStatus.textContent = 'Hoàn thành!';
        
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${currentVideoData.title}.${format.format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        
        setTimeout(() => {
            downloadModal.classList.add('hidden');
        }, 2000);
        
    } catch (error) {
        progressStatus.textContent = 'Lỗi: ' + error.message;
        progressBar.style.background = '#ef4444';
        
        setTimeout(() => {
            downloadModal.classList.add('hidden');
        }, 3000);
    }
}

async function handlePreview() {
    hideError();
    const url = urlInput.value.trim();

    if (!url) {
        showError('Vui lòng nhập link YouTube');
        return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        showError('Link YouTube không hợp lệ');
        return;
    }

    previewBtn.innerHTML = '<span class="loading">⏳</span><span>Đang tải...</span>';
    previewBtn.disabled = true;

    try {
        const data = await getVideoInfo(url);
        
        currentVideoData = data;
        currentVideoId = videoId;
        
        videoThumbnail.src = data.thumbnail;
        watchYoutube.href = url;
        
        emptyState.classList.add('hidden');
        videoInfo.classList.remove('hidden');
        
        renderFormatList();

    } catch (error) {
        showError(error.message);
    } finally {
        previewBtn.innerHTML = '<span>⬇</span><span>Xem trước</span>';
        previewBtn.disabled = false;
    }
}

function handleTabChange(e) {
    const tab = e.currentTarget;
    const tabType = tab.dataset.tab;

    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    currentMode = tabType;
    emptyIcon.textContent = tabType === 'video' ? '🎥' : '🎵';

    if (currentVideoData) {
        renderFormatList();
    }
}

previewBtn.addEventListener('click', handlePreview);
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handlePreview();
});

tabs.forEach(tab => {
    tab.addEventListener('click', handleTabChange);
});

cancelDownloadBtn.addEventListener('click', () => {
    downloadModal.classList.add('hidden');
});

window.handleDownload = handleDownload;