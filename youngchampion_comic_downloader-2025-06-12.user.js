// ==UserScript==
// @name         youngchampion_comic_downloader
// @namespace
// @version      2025-06-12
// @description  狠狠下载
// @author       DHM
// @match        https://youngchampion.jp/episodes/*
// @grant        GM_download
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        canvasSelector: '.-cv-page-canvas canvas',
        pageItemSelector: '.-cv-page',
        renderedClass: 'mode-rendered',
        viewerContainer: '#comici-viewer',
        minWidth: 100,
        minHeight: 200,
        pageNumRegex: /master-\d+-(0\d|\d{2,})\.jpg/g,
        panelStyle: {
            base: `position: fixed; right: 20px; top: 20px; z-index: 99999; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 15px rgba(0,0,0,0.2); width: 320px;`,
            btn: `width: 100%; padding: 8px 0; margin: 8px 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: all 0.3s;`,
            downloadBtn: 'background: #2196F3; color: #fff;',
            clearBtn: 'background: #f44336; color: #fff;',
            status: 'margin: 10px 0; font-size: 12px; color: #666; text-align: center;',
            preview: `display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; max-height: 300px; overflow-y: auto;`
        }
    };

    const state = {
        cache: new Map(),
        usedPageNums: new Set(),
        observer: null
    };

    function init() {
        createControlPanel();
        createPreviewModal();
        initPageObserver();
        setInterval(checkAllRenderedPages, 1000);
    }

    function createControlPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = CONFIG.panelStyle.base;
        panel.id = 'mangaExtractorPanel';

        const title = document.createElement('h3');
        title.textContent = 'youngchampion漫画提取器';
        title.style.cssText = 'margin: 0 0 15px 0; text-align: center;';
        panel.appendChild(title);

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '批量下载(0页)';
        downloadBtn.style.cssText = CONFIG.panelStyle.btn + CONFIG.panelStyle.downloadBtn;
        downloadBtn.disabled = true;
        downloadBtn.id = 'downloadBtn';
        downloadBtn.addEventListener('click', batchDownload);
        panel.appendChild(downloadBtn);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空缓存';
        clearBtn.style.cssText = CONFIG.panelStyle.btn + CONFIG.panelStyle.clearBtn;
        clearBtn.disabled = true;
        clearBtn.id = 'clearBtn';
        clearBtn.addEventListener('click', clearCache);
        panel.appendChild(clearBtn);

        const statusEl = document.createElement('div');
        statusEl.id = 'extractorStatus';
        statusEl.style.cssText = CONFIG.panelStyle.status;
        statusEl.textContent = '状态:监控页面中...';
        panel.appendChild(statusEl);

        const previewEl = document.createElement('div');
        previewEl.id = 'imagePreview';
        previewEl.style.cssText = CONFIG.panelStyle.preview;
        previewEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px 0; color: #999;">翻页加载图片</div>';
        panel.appendChild(previewEl);

        const viewer = document.querySelector(CONFIG.viewerContainer);
        if (viewer) viewer.style.zIndex = '9999';
        document.body.appendChild(panel);
    }

    function createPreviewModal() {
        const modal = document.createElement('div');
        modal.id = 'previewModal';
        modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 999999; display: none; justify-content: center; align-items: center;`;

        const img = document.createElement('img');
        img.id = 'previewImg';
        img.style.cssText = `max-width: 90%; max-height: 90%; object-contain;`;
        modal.appendChild(img);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        document.body.appendChild(modal);
    }

    function initPageObserver() {
        const pagesWrap = document.querySelector('.-cv-pages-wrap') || document.body;
        if (!pagesWrap) {
            updateStatus('未找到漫画容器');
            return;
        }

        state.observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.matches && node.matches(CONFIG.pageItemSelector)) {
                            if (!node.id) node.id = `page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                            getPageImageUrl(node);
                            watchPageRender(node);
                        }
                    });
                }
                if (mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.matches(CONFIG.pageItemSelector) && target.classList.contains(CONFIG.renderedClass)) {
                        extractCanvasImage(target);
                    }
                }
            });
        });

        state.observer.observe(pagesWrap, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function getPageImageUrl(pageEl) {
        const canvas = pageEl.querySelector(CONFIG.canvasSelector);
        if (canvas) {
            try {
                const ctx = canvas.getContext('2d');
                const imageSources = [];
                const originalDrawImage = ctx.drawImage;
                ctx.drawImage = function(img) {
                    if (img.src) imageSources.push(img.src);
                    return originalDrawImage.apply(this, arguments);
                };
                ctx.drawImage(canvas, 0, 0);
                ctx.drawImage = originalDrawImage;
                pageEl.dataset.imageUrls = JSON.stringify(imageSources);
            } catch (e) {
                console.log('提取图片URL失败:', e);
            }
        }
    }

    function getRealPageNumFromUrl(pageEl) {
        const imageUrls = JSON.parse(pageEl.dataset.imageUrls || '[]');
        if (imageUrls.length === 0) return null;

        for (const url of imageUrls) {
            const match = url.match(CONFIG.pageNumRegex);
            if (match) {
                const numStr = match[0].split('-').pop().replace('.jpg', '');
                return parseInt(numStr, 10);
            }
        }
        return null;
    }

    function watchPageRender(pageEl) {
        const checkRender = () => {
            if (pageEl.classList.contains(CONFIG.renderedClass)) {
                extractCanvasImage(pageEl);
                return;
            }
            const timer = setTimeout(() => {
                if (pageEl.isConnected) checkRender();
                else clearTimeout(timer);
            }, 200);
        };
        checkRender();
    }

    function extractCanvasImage(pageEl) {
        const canvas = pageEl.querySelector(CONFIG.canvasSelector);
        if (!canvas || canvas.width < CONFIG.minWidth || canvas.height < CONFIG.minHeight) return;

        const pageKey = pageEl.id;
        if (state.cache.has(pageKey)) return;

        try {
            const dataUrl = canvas.toDataURL('image/png', 1.0);
            let realPageNum = getRealPageNumFromUrl(pageEl);

            if (!realPageNum) {
                const validPages = Array.from(document.querySelectorAll(CONFIG.pageItemSelector)).filter(el => {
                    const c = el.querySelector(CONFIG.canvasSelector);
                    return c && c.width >= CONFIG.minWidth && c.height >= CONFIG.minHeight && el.classList.contains(CONFIG.renderedClass);
                });
                realPageNum = validPages.indexOf(pageEl) + 1;
            }

            while (state.usedPageNums.has(realPageNum)) {
                realPageNum++;
            }
            state.usedPageNums.add(realPageNum);

            state.cache.set(pageKey, {
                pageEl: pageEl,
                dataUrl: dataUrl,
                realPageNum: realPageNum
            });

            updateStatus(`已缓存${state.cache.size}页`);
            updatePreview();
            enableButtons();
        } catch (error) {
            updateStatus(`提取失败:${pageEl.id}`);
        }
    }

    function checkAllRenderedPages() {
        const renderedPages = document.querySelectorAll(`${CONFIG.pageItemSelector}.${CONFIG.renderedClass}`);
        renderedPages.forEach(pageEl => {
            const canvas = pageEl.querySelector(CONFIG.canvasSelector);
            if (canvas && canvas.width >= CONFIG.minWidth && canvas.height >= CONFIG.minHeight) {
                const pageKey = pageEl.id || `page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                if (!state.cache.has(pageKey)) {
                    getPageImageUrl(pageEl);
                    extractCanvasImage(pageEl);
                }
            }
        });
    }

    function batchDownload() {
        if (state.cache.size === 0) return;

        const sortedItems = Array.from(state.cache.values())
            .sort((a, b) => a.realPageNum - b.realPageNum);

        updateStatus(`下载中:0/${sortedItems.length}页`);

        sortedItems.forEach((item, index) => {
            setTimeout(() => {
                const fileName = String(item.realPageNum).padStart(2, '0') + '.png';
                GM_download({
                    url: item.dataUrl,
                    name: fileName,
                    mimetype: 'image/png',
                    onload: () => {
                        const progress = index + 1;
                        updateStatus(`下载中:${progress}/${sortedItems.length}页`);
                        if (index === sortedItems.length - 1) {
                            updateStatus(`已缓存${state.cache.size}页(下载完成)`);
                        }
                    },
                    onerror: () => {
                        updateStatus(`第${item.realPageNum}页下载失败`);
                    }
                });
            }, index * 300);
        });
    }

    function updateStatus(text) {
        const statusEl = document.getElementById('extractorStatus');
        if (statusEl) statusEl.textContent = `状态:${text}`;
    }

    function updatePreview() {
        const previewEl = document.getElementById('imagePreview');
        if (!previewEl) return;

        previewEl.innerHTML = '';
        const sortedItems = Array.from(state.cache.values())
            .sort((a, b) => a.realPageNum - b.realPageNum);

        if (sortedItems.length === 0) {
            previewEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px 0; color: #999;">暂无缓存图片</div>';
            return;
        }

        sortedItems.forEach(item => {
            const imgWrap = document.createElement('div');
            imgWrap.style.cssText = `border: 1px solid #eee; border-radius: 4px; overflow: hidden; cursor: pointer;`;

            const img = document.createElement('img');
            img.src = item.dataUrl;
            img.alt = `第${item.realPageNum}页`;
            img.style.cssText = `width: 100%; height: 80px; object-fit: contain; background: #f5f5f5;`;

            const pageLabel = document.createElement('div');
            pageLabel.style.cssText = `font-size: 10px; text-align: center; padding: 2px 0; background: #f5f5f5;`;
            pageLabel.textContent = `第${item.realPageNum}页`;

            imgWrap.appendChild(img);
            imgWrap.appendChild(pageLabel);
            previewEl.appendChild(imgWrap);

            imgWrap.addEventListener('click', () => {
                const modal = document.getElementById('previewModal');
                const modalImg = document.getElementById('previewImg');
                modalImg.src = item.dataUrl;
                modal.style.display = 'flex';
            });
        });
    }

    function enableButtons() {
        const downloadBtn = document.getElementById('downloadBtn');
        const clearBtn = document.getElementById('clearBtn');
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = `批量下载(${state.cache.size}页)`;
        }
        if (clearBtn) clearBtn.disabled = false;
    }

    function clearCache() {
        state.cache.clear();
        state.usedPageNums.clear();
        updateStatus('缓存已清空');
        updatePreview();
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '批量下载(0页)';
        }
        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) clearBtn.disabled = true;
    }

    init();

    window.addEventListener('beforeunload', () => {
        if (state.observer) state.observer.disconnect();
    });
})();
