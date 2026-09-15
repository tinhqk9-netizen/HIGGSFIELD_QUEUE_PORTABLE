/**
 * byteplus/video_studio/index.js
 *
 * Tool "Video to Video" (GTF Video Studio theo SRS) — lắp ráp store + router.
 * Độc lập hoàn toàn với luồng tạo video Kie hiện có; chỉ chia sẻ server + cổng.
 *
 * ĐÃ LÀM (Phase 1 trong HIGGSFIELD):
 *  - Local Media Library: quét folder video local (ffprobe) + CRUD + stats (SRS §3).
 *  - GTF Project entity: giữ video đối thủ + trạng thái FSM (khung cho các bước sau).
 *
 * CHƯA LÀM (chờ chốt thiết kế — xem HANDOFF):
 *  - §4 Media Description Index (cần model xem được video/ảnh).
 *  - §6-7 Reference Analysis + Production Timeline (sinh kịch bản).
 *  - §9 Asset Validation, §10-11 Assembly (FFmpeg cắt kho) HAY đẩy Kie sinh mới.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { JsonStore, ensureDir } from '../store.js';
import { config } from '../config.js';
import { byteplusMultipart, classify } from '../multipart.js';
import { scanLibrary, generateThumbnail, probeVideo, fileFingerprint } from './library.js';
import { analyzerWorker } from './analyzer_bridge.js';
import { generateTimeline, generateBatchTimelines, checkSemanticPreflight } from './timeline_generator.js';
import { assembleVideo, batchAssemble } from './assembler.js';
import { AVAILABLE_VOICES } from './voice_generator.js';

/** Thư mục KHO video nguồn — cố định trong dự án. Override qua VIDEO_STUDIO_LIBRARY_DIR. */
export function resolveLibraryDir() {
    return process.env.VIDEO_STUDIO_LIBRARY_DIR
        ? path.resolve(process.env.VIDEO_STUDIO_LIBRARY_DIR)
        : path.join(config.root, 'kho');
}

// FSM trạng thái GTF Video Studio (khớp SRS §14).
export const GTF_STATES = [
    'library_ready', 'library_described', 'reference_imported', 'reference_analyzed',
    'timeline_generated', 'awaiting_script_review', 'script_approved', 'assembling',
    'video_ready', 'awaiting_final_review', 'final_approved', 'validation_failed', 'failed'
];

// Bảng chuyển trạng thái hợp lệ (SRS §14 + nhánh sửa). Tham khảo nightmare-studio/gtf_domain.py.
export const GTF_TRANSITIONS = {
    library_ready:          new Set(['library_described', 'reference_imported', 'failed']),
    library_described:      new Set(['reference_imported', 'failed']),
    reference_imported:     new Set(['reference_analyzed', 'failed']),
    reference_analyzed:     new Set(['timeline_generated', 'failed']),
    timeline_generated:     new Set(['awaiting_script_review', 'failed']),
    awaiting_script_review: new Set(['script_approved', 'timeline_generated', 'failed']),
    script_approved:        new Set(['assembling', 'validation_failed', 'failed']),
    assembling:             new Set(['video_ready', 'failed']),
    video_ready:            new Set(['awaiting_final_review', 'failed']),
    awaiting_final_review:  new Set(['final_approved', 'timeline_generated', 'failed']),
    final_approved:         new Set(['timeline_generated', 'reference_analyzed', 'assembling']),
    validation_failed:      new Set(['script_approved', 'timeline_generated', 'failed']),
    failed:                 new Set(['library_ready', 'timeline_generated']),
};

/** Kiểm tra chuyển trạng thái có hợp lệ không. */
export function canTransition(current, target) {
    const allowed = GTF_TRANSITIONS[current];
    return allowed ? allowed.has(target) : false;
}

export class VideoStudioStore {
    constructor({ root = config.root } = {}) {
        this.root = root;
        this.libraryStore = new JsonStore(path.join(root, 'video_studio_library.json'), { assets: [] });
        this.projectStore = new JsonStore(path.join(root, 'video_studio_projects.json'), { projects: [] });
        this.libraryStore.load();
        this.projectStore.load();
        if (!Array.isArray(this.libraryStore.data.assets)) this.libraryStore.data.assets = [];
        if (!Array.isArray(this.projectStore.data.projects)) this.projectStore.data.projects = [];
    }

    // ── Library assets ──────────────────────────────────────────────
    listAssets(category) {
        const all = this.libraryStore.data.assets;
        if (!category) return all.slice();
        return all.filter(a => (a.category || '') === category);
    }

    getAsset(assetId) {
        return this.libraryStore.data.assets.find(a => a.asset_id === assetId) || null;
    }

    upsertAsset(data) {
        const arr = this.libraryStore.data.assets;
        const i = arr.findIndex(a => a.path === data.path);
        if (i === -1) arr.push(data);
        else arr[i] = { ...arr[i], ...data };
        this.libraryStore.save();
        return data;
    }

    deleteAsset(assetId) {
        const arr = this.libraryStore.data.assets;
        const i = arr.findIndex(a => a.asset_id === assetId);
        if (i === -1) return false;
        arr.splice(i, 1);
        this.libraryStore.save();
        return true;
    }

    libraryStats() {
        const assets = this.libraryStore.data.assets;
        const byCategory = {};
        let totalDuration = 0;
        let totalSize = 0;
        for (const a of assets) {
            totalDuration += Number(a.duration) || 0;
            totalSize += Number(a.file_size) || 0;
            const c = a.category || '(root)';
            byCategory[c] = (byCategory[c] || 0) + 1;
        }
        return {
            total: assets.length,
            described: assets.filter(a => a.described).length,
            totalDurationSeconds: Math.round(totalDuration * 100) / 100,
            totalSizeBytes: totalSize,
            byCategory
        };
    }

    // ── GTF projects (khung cho cac buoc sau) ───────────────────────
    listProjects() { return this.projectStore.data.projects.slice().reverse(); }
    getProject(id) { return this.projectStore.data.projects.find(p => p.id === id) || null; }

    createProject({ name, referenceVideoPath = null, referenceVideoName = null, hookVideoPath = null, hookVideoName = null, requestedOutputs = 10 } = {}) {
        const now = new Date().toISOString();
        const project = {
            id: 'gtf_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
            name: String(name || 'GTF Project').trim(),
            status: referenceVideoPath ? 'reference_imported' : 'library_ready',
            referenceVideoPath,
            referenceVideoName,
            hookVideoPath,
            hookVideoName,
            requestedOutputs: parseInt(requestedOutputs, 10) || 10,
            hookAnalysis: null,
            referenceAnalysis: null,
            preflightStatus: null,
            productionTimeline: null,
            batchTimelines: [],
            renderedVideos: [],
            finalVideoPath: null,
            createdAt: now,
            updatedAt: now
        };
        this.projectStore.data.projects.push(project);
        this.projectStore.save();
        return project;
    }

    updateProject(id, patch = {}) {
        const p = this.getProject(id);
        if (!p) return null;
        Object.assign(p, patch, { updatedAt: new Date().toISOString() });
        this.projectStore.save();
        return p;
    }

    transitionProject(id, target) {
        const p = this.getProject(id);
        if (!p) throw Object.assign(new Error('Không tìm thấy project.'), { code: 'PROJECT_NOT_FOUND' });
        if (p.status === target) return p; // Idempotent: nếu đã ở trạng thái đích rồi thì bỏ qua, không ném lỗi
        if (!canTransition(p.status, target)) {
            throw Object.assign(new Error(`Chuyển trạng thái không hợp lệ: ${p.status} -> ${target}`), { code: 'INVALID_TRANSITION' });
        }
        p.status = target;
        p.updatedAt = new Date().toISOString();
        this.projectStore.save();
        return p;
    }

    deleteProject(id) {
        const arr = this.projectStore.data.projects;
        const i = arr.findIndex(p => p.id === id);
        if (i === -1) return false;
        arr.splice(i, 1);
        this.projectStore.save();
        try {
            const outDir = path.join(this.root, 'video_studio_outputs', id);
            if (fs.existsSync(outDir)) {
                fs.rmSync(outDir, { recursive: true, force: true });
            }
        } catch (_) {}
        return true;
    }

    /** Đảm bảo mọi ghi đang chờ đã nằm trên đĩa (dùng khi shutdown / test). */
    async flush() {
        await Promise.all([this.libraryStore.flush(), this.projectStore.flush()]);
    }
}

/** Router cho tool Video to Video, mount tai /api/video-studio. */
export function createVideoStudioRouter({ store, libraryDir } = {}) {
    const s = store || new VideoStudioStore();
    const KHO = libraryDir || resolveLibraryDir();
    // Video đối thủ (reference) lưu RIÊNG, KHÔNG nằm trong kho nguồn.
    const REF_DIR = process.env.VIDEO_STUDIO_REFERENCES_DIR
        ? path.resolve(process.env.VIDEO_STUDIO_REFERENCES_DIR)
        : path.join(config.root, 'video_studio_references');
    ensureDir(KHO);
    ensureDir(REF_DIR);
    const router = express.Router();

    const fail = (res, err, code = 400) => res.status(err.code === 'LIBRARY_FOLDER_NOT_FOUND' ? 404 : code)
        .json({ error: err.message || String(err), code: err.code || 'ERROR' });

    // ── trạng thái tool ──
    router.get('/status', (req, res) => {
        res.json({ tool: 'video-to-video', libraryDir: KHO, stats: s.libraryStats(), projects: s.listProjects().length });
    });

    // ── Theo dõi tiến trình phân tích AI (poll từ frontend) ──
    const _analyzeProgress = new Map(); // assetId -> { stage, progress, startedAt }
    router.get('/analyze-progress/:id', (req, res) => {
        const p = _analyzeProgress.get(req.params.id);
        if (!p) return res.json({ active: false });
        res.json({ active: true, stage: p.stage, progress: p.progress, startedAt: p.startedAt });
    });
    router.get('/analyze-progress', (req, res) => {
        const all = {};
        for (const [id, p] of _analyzeProgress) all[id] = p;
        res.json({ tasks: all, count: _analyzeProgress.size });
    });

    // ── Upload video vào KHO (lưu thẳng về thư mục dự án) rồi tự index ──
    // Đăng ký TRƯỚC express.json để middleware multipart xử lý body.
    router.post('/library/upload', byteplusMultipart(KHO), async (req, res) => {
        try {
            const files = req.files || [];
            if (!files.length) return res.status(400).json({ error: 'Không có file nào được tải lên.', code: 'NO_FILE' });
            // Chỉ nhận video; file khác thì xoá khỏi kho.
            const kept = [];
            for (const f of files) {
                if (classify(f.originalName) === 'video') kept.push(f);
                else { try { fs.unlinkSync(f.localPath); } catch (_) {} }
            }
            if (!kept.length) return res.status(415).json({ error: 'Chỉ hỗ trợ file video.', code: 'NOT_VIDEO' });
            // Index lại kho để cập nhật danh mục.
            const result = await scanLibrary(KHO, s);
            warmThumbs(); // làm ấm thumbnail nền, không chặn response
            queueBackgroundDescribe(); // tự động phân tích AI nền cho các clip chưa mô tả
            res.json({ success: true, uploaded: kept.length, libraryDir: KHO, result, stats: s.libraryStats() });
        } catch (err) { fail(res, err); }
    });

    router.use(express.json({ limit: '5mb' }));

    // ── Local Media Library (SRS §3) — mặc định quét KHO của dự án ──
    router.post('/library/scan', async (req, res) => {
        try {
            const folder = (req.body && req.body.folder) || KHO;
            const result = await scanLibrary(folder, s);
            warmThumbs(); // làm ấm thumbnail nền, không chặn response
            queueBackgroundDescribe(); // tự động phân tích AI nền cho các clip chưa mô tả
            res.json({ success: true, folder: path.resolve(folder), result, stats: s.libraryStats() });
        } catch (err) { fail(res, err); }
    });

    router.get('/library/assets', (req, res) => {
        res.json({ assets: s.listAssets(req.query.category), stats: s.libraryStats() });
    });

    router.get('/library/assets/:id', (req, res) => {
        const a = s.getAsset(req.params.id);
        if (!a) return res.status(404).json({ error: 'Không tìm thấy asset.', code: 'ASSET_NOT_FOUND' });
        res.json({ asset: a });
    });

    router.delete('/library/assets/:id', (req, res) => {
        if (!s.deleteAsset(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy asset.', code: 'ASSET_NOT_FOUND' });
        res.json({ success: true });
    });

    router.get('/library/stats', (req, res) => res.json(s.libraryStats()));

    // ── Thumbnail (ảnh khung hình) của 1 clip — sinh bằng ffmpeg, cache lại ──
    const THUMB_DIR = path.join(config.root, 'video_studio_thumbs');
    const _thumbInFlight = new Map(); // chống sinh trùng: 1 ffmpeg / asset tại một thời điểm

    function ensureThumb(a) {
        const out = path.join(THUMB_DIR, `${a.asset_id}.jpg`);
        if (fs.existsSync(out)) return Promise.resolve(out);
        if (_thumbInFlight.has(a.asset_id)) return _thumbInFlight.get(a.asset_id);
        if (!fs.existsSync(a.path)) return Promise.reject(Object.assign(new Error('SOURCE_MISSING'), { code: 'SOURCE_MISSING' }));
        const p = generateThumbnail(a.path, out).finally(() => _thumbInFlight.delete(a.asset_id));
        _thumbInFlight.set(a.asset_id, p);
        return p;
    }

    // Làm ấm cache TUẦN TỰ (tránh 24 ffmpeg song song khi UI mở lần đầu).
    let _warming = false;
    async function warmThumbs() {
        if (_warming) return;
        _warming = true;
        try {
            for (const a of s.listAssets()) {
                try { await ensureThumb(a); } catch (_) {}
            }
        } finally { _warming = false; }
    }

    // Tự động phân tích AI cho toàn bộ video trong kho chưa có mô tả (chạy nền)
    let _describing = false;
    async function queueBackgroundDescribe() {
        if (_describing) return;
        _describing = true;
        try {
            const undescribed = s.listAssets().filter(a => !a.described && fs.existsSync(a.path));
            for (const a of undescribed) {
                try {
                    _analyzeProgress.set(a.asset_id, { stage: 'starting', progress: 0, startedAt: Date.now() });
                    const result = await analyzerWorker.analyze(a.path, {
                        language: 'vi',
                        onProgress: (stage, progress) => {
                            _analyzeProgress.set(a.asset_id, { stage, progress: progress || 0, startedAt: _analyzeProgress.get(a.asset_id)?.startedAt || Date.now() });
                        }
                    });
                    _analyzeProgress.set(a.asset_id, { stage: 'saving', progress: 0.95, startedAt: _analyzeProgress.get(a.asset_id)?.startedAt });
                    let events = result.visual_events || result.events || [];
                    if ((!events || !events.length) && result.artifacts?.visual && fs.existsSync(result.artifacts.visual)) {
                        try {
                            const visData = JSON.parse(fs.readFileSync(result.artifacts.visual, 'utf-8'));
                            events = visData.events || [];
                        } catch (_) {}
                    }
                    const summary = result.summary || result.conclusion || '';
                    s.upsertAsset({
                        path: a.path,
                        descriptionIndex: events,
                        description_index: events,
                        aiDescription: summary,
                        described: true
                    });
                } catch (e) {
                    console.error('[VideoStudio] Auto describe error for', a.asset_id, e.message);
                } finally {
                    _analyzeProgress.delete(a.asset_id);
                }
            }
        } finally {
            _describing = false;
        }
    }

    router.get('/library/thumb/:id', async (req, res) => {
        const a = s.getAsset(req.params.id);
        if (!a) return res.status(404).end();
        try {
            const out = await ensureThumb(a);
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            fs.createReadStream(out).pipe(res);
        } catch (err) {
            res.status(err.code === 'SOURCE_MISSING' ? 410 : 500).end();
        }
    });

    // Phát video từ kho local (hỗ trợ HTTP 206 partial streaming)
    router.get('/library/video/:id', (req, res) => {
        const a = s.getAsset(req.params.id);
        if (!a) return res.status(404).json({ error: 'Không tìm thấy asset.', code: 'ASSET_NOT_FOUND' });
        if (!fs.existsSync(a.path)) return res.status(404).json({ error: 'File video không tồn tại trên đĩa.', code: 'FILE_NOT_FOUND' });
        
        const stat = fs.statSync(a.path);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(a.path, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(200, head);
            fs.createReadStream(a.path).pipe(res);
        }
    });

    // ── GTF projects (khung) ──
    router.get('/projects', (req, res) => res.json({ projects: s.listProjects() }));
    router.post('/projects', byteplusMultipart(REF_DIR), (req, res) => {
        try {
            const body = req.body || {};
            if (!body.name || !String(body.name).trim()) return res.status(422).json({ error: 'Thiếu tên project.', code: 'NAME_REQUIRED' });
            const files = req.files || [];
            const vid = files.find(f => f.field === 'refVideo' && classify(f.originalName) === 'video') || files.find(f => classify(f.originalName) === 'video' && f.field !== 'hookVideo');
            const hookVid = files.find(f => f.field === 'hookVideo' && classify(f.originalName) === 'video');
            // File không phải video thì xoá, tránh rác trong thư mục reference.
            for (const f of files) { if (f !== vid && f !== hookVid) { try { fs.unlinkSync(f.localPath); } catch (_) {} } }
            const project = s.createProject({
                name: body.name,
                referenceVideoPath: vid ? vid.localPath : null,
                referenceVideoName: vid ? vid.originalName : null,
                hookVideoPath: hookVid ? hookVid.localPath : null,
                hookVideoName: hookVid ? hookVid.originalName : null,
                requestedOutputs: body.requestedOutputs
            });
            res.status(201).json({ success: true, project });
        } catch (err) { fail(res, err); }
    });
    router.get('/projects/:id', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
        res.json({ project: p });
    });
    router.delete('/projects/:id', (req, res) => {
        const deleted = s.deleteProject(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
        res.json({ success: true, deletedId: req.params.id });
    });
    router.post('/projects/:id/inputs', byteplusMultipart(REF_DIR), (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });

            const uneditableStatuses = ['reference_analyzed', 'timeline_generated', 'awaiting_script_review', 'script_approved', 'assembling', 'video_ready', 'awaiting_final_review', 'final_approved'];
            if (uneditableStatuses.includes(p.status) || p.referenceAnalysis) {
                return res.status(400).json({ error: 'Dự án đã được AI phân tích ở bước 2, không thể thay đổi video input.', code: 'ALREADY_ANALYZED' });
            }

            const files = req.files || [];
            const vid = files.find(f => f.field === 'refVideo' && classify(f.originalName) === 'video') || files.find(f => classify(f.originalName) === 'video' && f.field !== 'hookVideo');
            const hookVid = files.find(f => f.field === 'hookVideo' && classify(f.originalName) === 'video');

            for (const f of files) {
                if (f !== vid && f !== hookVid) {
                    try { fs.unlinkSync(f.localPath); } catch (_) {}
                }
            }

            const patch = {};
            if (vid) {
                if (p.referenceVideoPath && p.referenceVideoPath !== vid.localPath && fs.existsSync(p.referenceVideoPath)) {
                    try { fs.unlinkSync(p.referenceVideoPath); } catch (_) {}
                }
                patch.referenceVideoPath = vid.localPath;
                patch.referenceVideoName = vid.originalName;
                patch.referenceAnalysis = null;
            }

            if (hookVid) {
                if (p.hookVideoPath && p.hookVideoPath !== hookVid.localPath && fs.existsSync(p.hookVideoPath)) {
                    try { fs.unlinkSync(p.hookVideoPath); } catch (_) {}
                }
                patch.hookVideoPath = hookVid.localPath;
                patch.hookVideoName = hookVid.originalName;
                patch.hookAnalysis = null;
            }

            const body = req.body || {};
            if (body.removeHook === 'true' || body.removeHook === true) {
                if (p.hookVideoPath && fs.existsSync(p.hookVideoPath)) {
                    try { fs.unlinkSync(p.hookVideoPath); } catch (_) {}
                }
                patch.hookVideoPath = null;
                patch.hookVideoName = null;
                patch.hookAnalysis = null;
            }

            const finalRefPath = patch.referenceVideoPath || p.referenceVideoPath;
            if (finalRefPath && (p.status === 'library_ready' || p.status === 'failed')) {
                patch.status = 'reference_imported';
            }

            const updated = s.updateProject(p.id, patch);
            res.json({ success: true, project: updated });
        } catch (err) { fail(res, err); }
    });

    router.post('/library/describe', async (req, res) => {
        try {
            const { assetId } = req.body || {};
            let toDescribe = [];
            if (assetId) {
                const a = s.getAsset(assetId);
                if (!a) return res.status(404).json({ error: 'Không tìm thấy asset.', code: 'ASSET_NOT_FOUND' });
                toDescribe.push(a);
            } else {
                toDescribe = s.listAssets().filter(a => !a.described);
            }
            let count = 0;
            let lastAsset = null;
            for (const a of toDescribe) {
                try {
                    _analyzeProgress.set(a.asset_id, { stage: 'starting', progress: 0, startedAt: Date.now() });
                    const result = await analyzerWorker.analyze(a.path, {
                        language: 'vi',
                        onProgress: (stage, progress) => {
                            _analyzeProgress.set(a.asset_id, { stage, progress: progress || 0, startedAt: _analyzeProgress.get(a.asset_id)?.startedAt || Date.now() });
                        }
                    });
                    _analyzeProgress.set(a.asset_id, { stage: 'saving', progress: 0.95, startedAt: _analyzeProgress.get(a.asset_id)?.startedAt });
                    let events = result.visual_events || result.events || [];
                    if ((!events || !events.length) && result.artifacts?.visual && fs.existsSync(result.artifacts.visual)) {
                        try {
                            const visData = JSON.parse(fs.readFileSync(result.artifacts.visual, 'utf-8'));
                            events = visData.events || [];
                        } catch (_) {}
                    }
                    const summary = result.summary || result.conclusion || '';
                    s.upsertAsset({
                        path: a.path,
                        descriptionIndex: events,
                        description_index: events,
                        aiDescription: summary,
                        described: true
                    });
                    count++;
                    lastAsset = s.getAsset(a.asset_id);
                } catch (e) {
                    console.error('Lỗi khi describe asset:', a.asset_id, e);
                    if (assetId) throw e;
                } finally {
                    _analyzeProgress.delete(a.asset_id);
                }
            }
            res.json({ success: true, described: count, asset: lastAsset });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/analyze-reference', async (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            if (!p.referenceVideoPath) return res.status(400).json({ error: 'Project không có video đối thủ.', code: 'NO_REFERENCE' });
            
            const result = await analyzerWorker.analyze(p.referenceVideoPath, { language: 'vi' });
            
            s.updateProject(p.id, { referenceAnalysis: result });

            // Tự động lưu video đối thủ vào kho thư viện (§3-§4)
            try {
                const events = result.visual_events || result.events || [];
                const summary = result.summary || result.purpose || result.conclusion || '';
                const probeMeta = await probeVideo(p.referenceVideoPath);
                s.upsertAsset({
                    path: p.referenceVideoPath,
                    filename: p.referenceVideoName || path.basename(p.referenceVideoPath),
                    category: 'reference',
                    duration: probeMeta.duration,
                    width: probeMeta.width,
                    height: probeMeta.height,
                    fps: probeMeta.fps,
                    codec: probeMeta.codec,
                    file_size: probeMeta.file_size,
                    file_hash: fileFingerprint(p.referenceVideoPath),
                    described: true,
                    descriptionIndex: events,
                    description_index: events,
                    aiDescription: summary
                });
            } catch (libErr) {
                console.warn('Lỗi tự động nạp video đối thủ vào kho:', libErr.message);
            }

            // Only transition when all analyses are complete
            const updated = s.getProject(p.id);
            if (!updated.hookVideoPath || updated.hookAnalysis) {
                s.transitionProject(p.id, 'reference_analyzed');
            }
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/analyze-hook', async (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            if (!p.hookVideoPath) return res.status(400).json({ error: 'Project không có video hook.', code: 'NO_HOOK' });
            
            const result = await analyzerWorker.analyze(p.hookVideoPath, { language: 'vi' });
            
            s.updateProject(p.id, { hookAnalysis: result });

            // Tự động lưu video hook vào kho thư viện (§3-§4)
            try {
                const events = result.visual_events || result.events || [];
                const summary = result.summary || result.purpose || result.conclusion || '';
                const probeMeta = await probeVideo(p.hookVideoPath);
                s.upsertAsset({
                    path: p.hookVideoPath,
                    filename: p.hookVideoName || path.basename(p.hookVideoPath),
                    category: 'hook',
                    duration: probeMeta.duration,
                    width: probeMeta.width,
                    height: probeMeta.height,
                    fps: probeMeta.fps,
                    codec: probeMeta.codec,
                    file_size: probeMeta.file_size,
                    file_hash: fileFingerprint(p.hookVideoPath),
                    described: true,
                    descriptionIndex: events,
                    description_index: events,
                    aiDescription: summary
                });
            } catch (libErr) {
                console.warn('Lỗi tự động nạp video hook vào kho:', libErr.message);
            }

            // Check if both analyses are done — only transition if reference is also analyzed
            const updated = s.getProject(p.id);
            if (updated.referenceAnalysis && updated.hookAnalysis) {
                s.transitionProject(p.id, 'reference_analyzed');
            }
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    // ── Pre-flight Semantic Gate (§6.1) ──
    router.post('/projects/:id/preflight-check', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            if (!p.referenceAnalysis) return res.status(400).json({ error: 'Chưa có phân tích video đối thủ.', code: 'NO_ANALYSIS' });

            const check = checkSemanticPreflight(p.referenceAnalysis, s.listAssets());
            s.updateProject(p.id, { preflightStatus: check });
            res.json({ success: true, preflight: check, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    // ── Sinh Production Timeline (hỗ trợ Batch N kịch bản & chống trùng lặp đa tầng) (§7) ──
    router.post('/projects/:id/generate-timeline', async (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            
            const describedAssets = s.listAssets().filter(a => a.described);
            if (describedAssets.length === 0) {
                return res.status(400).json({ error: 'Kho chưa có video nào được mô tả AI.', code: 'NO_DESCRIBED_ASSETS' });
            }

            // Pre-flight check trước khi sinh
            const preflight = checkSemanticPreflight(p.referenceAnalysis, s.listAssets());
            s.updateProject(p.id, { preflightStatus: preflight });
            if (!preflight.canProceed) {
                return res.status(422).json({
                    error: preflight.reason || 'Kho không đủ source phù hợp với video đối thủ.',
                    code: 'PREFLIGHT_MISMATCH',
                    preflight
                });
            }

            const count = parseInt(req.body?.count, 10) || p.requestedOutputs || 10;
            let batchTimelines = [];

            const hookContext = {
                hookVideoPath: p.hookVideoPath || null,
                hookVideoName: p.hookVideoName || null,
                hookAnalysis: p.hookAnalysis || null,
                // Loại hook do user chọn ở frontend; 'auto' (hoặc thiếu) = để model tự chọn theo độ phù hợp.
                hookType: req.body?.hookType || 'auto'
            };

            if (count > 1) {
                batchTimelines = await generateBatchTimelines(p.referenceAnalysis, describedAssets, p.hookAnalysis || null, count, hookContext);
            } else {
                const single = await generateTimeline(p.referenceAnalysis, describedAssets, p.hookAnalysis || null, hookContext);
                batchTimelines = [{ index: 1, ...single, isValid: true, coverageRate: 100 }];
            }

            const validOne = batchTimelines.find(t => t.isValid) || batchTimelines[0];
            s.updateProject(p.id, {
                batchTimelines,
                productionTimeline: validOne ? validOne.segments : []
            });

            s.transitionProject(p.id, 'timeline_generated');
            s.transitionProject(p.id, 'awaiting_script_review');
            
            res.json({ success: true, project: s.getProject(p.id), batchTimelines });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/review', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            
            const { action, notes } = req.body || {};
            if (action === 'approve') {
                s.transitionProject(p.id, 'script_approved');
            } else if (action === 'reject') {
                s.transitionProject(p.id, 'timeline_generated'); // cho sửa lại
                if (notes) s.updateProject(p.id, { reviewNotes: notes });
            } else {
                return res.status(400).json({ error: 'Hành động không hợp lệ.', code: 'INVALID_ACTION' });
            }
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/batch-review', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            
            const { action, approvedIndices } = req.body || {};
            if (action === 'approve' || action === 'approve_all') {
                s.transitionProject(p.id, 'script_approved');
                if (Array.isArray(approvedIndices)) {
                    s.updateProject(p.id, { approvedBatchIndices: approvedIndices });
                }
            } else if (action === 'reject') {
                s.transitionProject(p.id, 'timeline_generated');
            } else {
                return res.status(400).json({ error: 'Hành động không hợp lệ.', code: 'INVALID_ACTION' });
            }
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/validate', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            if (!p.productionTimeline && (!p.batchTimelines || !p.batchTimelines.length)) {
                return res.status(400).json({ error: 'Project chưa có timeline.', code: 'NO_TIMELINE' });
            }

            s.transitionProject(p.id, 'assembling');
            res.json({ success: true, valid: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.get('/voices', (req, res) => {
        res.json({ voices: AVAILABLE_VOICES });
    });

    router.post('/projects/:id/assemble', async (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            if (p.status !== 'assembling') return res.status(400).json({ error: 'Project chưa ở trạng thái assembling.', code: 'INVALID_STATE' });
            
            const OUTPUT_DIR = path.join(config.root, 'video_studio_outputs', p.id);
            ensureDir(OUTPUT_DIR);
            const voice = (req.body && req.body.voice) || p.voice || 'vi-VN-HoaiMyNeural';

            // Nếu có Batch Kịch Bản: Dựng song song 10 video cùng lúc bằng FFmpeg
            if (Array.isArray(p.batchTimelines) && p.batchTimelines.length > 0) {
                const validTimelines = p.batchTimelines.filter(t => t.isValid !== false);
                const toRender = validTimelines.length > 0 ? validTimelines : p.batchTimelines;

                const prepared = toRender.map((tl, idx) => ({
                    ...tl,
                    index: tl.index || (idx + 1),
                    segments: (tl.segments || []).map(seg => {
                        const a = s.getAsset(seg.sourceAssetId);
                        return { ...seg, path: a ? a.path : (seg.assetPath || '') };
                    })
                }));

                const results = await batchAssemble(prepared, OUTPUT_DIR, { voice });
                const finalPath = path.join(OUTPUT_DIR, 'final.mp4');
                const firstSuccess = results.find(r => r.success);
                if (firstSuccess && firstSuccess.outputPath && fs.existsSync(firstSuccess.outputPath)) {
                    try { fs.copyFileSync(firstSuccess.outputPath, finalPath); } catch (_) {}
                }

                s.updateProject(p.id, { renderedVideos: results, finalVideoPath: finalPath, voice });
            } else {
                const finalPath = path.join(OUTPUT_DIR, 'final.mp4');
                const segments = (p.productionTimeline || []).map(seg => {
                    const a = s.getAsset(seg.sourceAssetId);
                    return { ...seg, path: a ? a.path : (seg.assetPath || '') };
                });
                await assembleVideo(segments, finalPath, { voice });
                s.updateProject(p.id, { finalVideoPath: finalPath, voice, renderedVideos: [{ index: 1, success: true, outputPath: finalPath, fileName: 'final.mp4' }] });
            }
            
            s.transitionProject(p.id, 'video_ready');
            s.transitionProject(p.id, 'awaiting_final_review');
            exportProjectPackage(s.getProject(p.id), s);
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.put('/projects/:id/timeline', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            const { timeline } = req.body || {};
            if (!Array.isArray(timeline)) {
                return res.status(400).json({ error: 'Timeline phải là một mảng các segment.', code: 'INVALID_TIMELINE' });
            }
            s.updateProject(p.id, { productionTimeline: timeline });
            exportProjectPackage(s.getProject(p.id), s);
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    router.post('/projects/:id/final-review', (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            
            const { action } = req.body || {};
            if (action === 'approve') {
                s.transitionProject(p.id, 'final_approved');
                exportProjectPackage(s.getProject(p.id), s);
            } else if (action === 'reject') {
                s.transitionProject(p.id, 'timeline_generated');
            } else {
                return res.status(400).json({ error: 'Hành động không hợp lệ.', code: 'INVALID_ACTION' });
            }
            
            res.json({ success: true, project: s.getProject(p.id) });
        } catch (err) { fail(res, err); }
    });

    // Stream VIDEO ĐỐI THỦ (input của user) với HTTP 206 Range — cho step 1 xem lại.
    router.get('/projects/:id/reference-video', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p || !p.referenceVideoPath || !fs.existsSync(p.referenceVideoPath)) {
            return res.status(404).json({ error: 'Không có video đối thủ.', code: 'NO_REFERENCE' });
        }
        const filePath = p.referenceVideoPath;
        const fileSize = fs.statSync(filePath).size;
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4'
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    // Stream video Hook câu view user tải lên (206 Range) — song song với /reference-video
    router.get('/projects/:id/hook-video', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p || !p.hookVideoPath || !fs.existsSync(p.hookVideoPath)) {
            return res.status(404).json({ error: 'Không có video hook.', code: 'NO_HOOK' });
        }
        const filePath = p.hookVideoPath;
        const fileSize = fs.statSync(filePath).size;
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4'
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    // Stream video với HTTP 206 Range cho thẻ <video> (hỗ trợ index batch: ?index=N)
    router.get('/projects/:id/video', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).end();
        let targetPath = p.finalVideoPath;
        const idx = parseInt(req.query.index, 10);
        if (idx && Array.isArray(p.renderedVideos)) {
            const found = p.renderedVideos.find(v => v.index === idx);
            if (found && found.outputPath && fs.existsSync(found.outputPath)) {
                targetPath = found.outputPath;
            }
        }
        if (!targetPath || !fs.existsSync(targetPath)) {
            return res.status(404).end();
        }
        const stat = fs.statSync(targetPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(targetPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(200, head);
            fs.createReadStream(targetPath).pipe(res);
        }
    });

    router.get('/projects/:id/output', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
        let targetPath = p.finalVideoPath;
        let fileName = 'final.mp4';
        const idx = parseInt(req.query.index, 10);
        if (idx && Array.isArray(p.renderedVideos)) {
            const found = p.renderedVideos.find(v => v.index === idx);
            if (found && found.outputPath && fs.existsSync(found.outputPath)) {
                targetPath = found.outputPath;
                fileName = found.fileName || `final_${idx}.mp4`;
            }
        }
        if (!targetPath || !fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'Chưa có file video hoàn chỉnh.', code: 'NO_VIDEO' });
        }
        res.download(targetPath, fileName);
    });

    router.get('/projects/:id/storyboard', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).send('Project not found');
        const outDir = path.join(config.root, 'video_studio_outputs', p.id);
        const sbPath = path.join(outDir, 'storyboard.html');
        if (!fs.existsSync(sbPath)) exportProjectPackage(p, s);
        if (!fs.existsSync(sbPath)) return res.status(404).send('Storyboard not generated');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        fs.createReadStream(sbPath).pipe(res);
    });

    router.get('/projects/:id/manifest', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).json({ error: 'Không tìm thấy project.' });
        const outDir = path.join(config.root, 'video_studio_outputs', p.id);
        const mfPath = path.join(outDir, 'episode_manifest.json');
        if (!fs.existsSync(mfPath)) exportProjectPackage(p, s);
        if (!fs.existsSync(mfPath)) return res.status(404).json({ error: 'Manifest chưa được tạo.' });
        res.download(mfPath, 'episode_manifest.json');
    });

    router.get('/projects/:id/timeline-json', (req, res) => {
        const p = s.getProject(req.params.id);
        if (!p) return res.status(404).json({ error: 'Không tìm thấy project.' });
        const outDir = path.join(config.root, 'video_studio_outputs', p.id);
        const tlPath = path.join(outDir, 'production_timeline.json');
        if (!fs.existsSync(tlPath)) exportProjectPackage(p, s);
        if (!fs.existsSync(tlPath)) return res.status(404).json({ error: 'Timeline JSON chưa được tạo.' });
        res.download(tlPath, 'production_timeline.json');
    });

    router.get('/projects/:id/download-zip', async (req, res) => {
        try {
            const p = s.getProject(req.params.id);
            if (!p) return res.status(404).json({ error: 'Không tìm thấy project.', code: 'PROJECT_NOT_FOUND' });
            
            const outDir = path.join(config.root, 'video_studio_outputs', p.id);
            exportProjectPackage(p, s);
            
            // Collect files to zip
            const filesToZip = [];
            if (Array.isArray(p.renderedVideos) && p.renderedVideos.length > 0) {
                for (const rv of p.renderedVideos) {
                    if (rv.success && rv.outputPath && fs.existsSync(rv.outputPath)) {
                        filesToZip.push({ path: rv.outputPath, name: rv.fileName || `final_${rv.index}.mp4` });
                    }
                }
            } else {
                const finalMp4 = p.finalVideoPath;
                if (finalMp4 && fs.existsSync(finalMp4)) filesToZip.push({ path: finalMp4, name: 'final.mp4' });
            }
            const sbPath = path.join(outDir, 'storyboard.html');
            if (fs.existsSync(sbPath)) filesToZip.push({ path: sbPath, name: 'storyboard.html' });
            const tlPath = path.join(outDir, 'production_timeline.json');
            if (fs.existsSync(tlPath)) filesToZip.push({ path: tlPath, name: 'production_timeline.json' });
            const mfPath = path.join(outDir, 'episode_manifest.json');
            if (fs.existsSync(mfPath)) filesToZip.push({ path: mfPath, name: 'episode_manifest.json' });
            
            if (!filesToZip.length) return res.status(404).json({ error: 'Không có file để tải.' });
            
            // Use PowerShell to create zip (Windows)
            const zipPath = path.join(outDir, `${p.name.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]/g, '_')}.zip`);
            // Copy all files to a temp staging dir, then zip
            const stageDir = path.join(outDir, '_zip_stage');
            if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
            fs.mkdirSync(stageDir, { recursive: true });
            for (const f of filesToZip) {
                fs.copyFileSync(f.path, path.join(stageDir, f.name));
            }
            
            const { execFileSync } = await import('child_process');
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            execFileSync('powershell', [
                '-NoProfile', '-Command',
                `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
            ], { timeout: 30000 });
            
            // Cleanup staging dir
            fs.rmSync(stageDir, { recursive: true, force: true });
            
            const safeName = p.name.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]/g, '_') + '.zip';
            res.download(zipPath, safeName);
        } catch (err) { fail(res, err); }
    });

    return router;
}

export default createVideoStudioRouter;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * Xuất gói dữ liệu dự án (SRS §13):
 * - final.mp4 (đã tạo bởi assembler)
 * - production_timeline.json
 * - episode_manifest.json
 * - storyboard.html
 */
export function exportProjectPackage(project, store, { outDir = null } = {}) {
    if (!project || !project.id) return;
    const baseDir = outDir || (store && store.root ? store.root : config.root);
    const targetDir = outDir || path.join(baseDir, 'video_studio_outputs', project.id);
    ensureDir(targetDir);

    const tl = project.productionTimeline || [];
    // 1. production_timeline.json
    try {
        fs.writeFileSync(path.join(targetDir, 'production_timeline.json'), JSON.stringify(tl, null, 2), 'utf-8');
    } catch (_) {}

    // 2. episode_manifest.json
    try {
        const manifest = {
            id: project.id,
            name: project.name,
            status: project.status,
            referenceVideoName: project.referenceVideoName,
            voice: project.voice || 'vi-VN-HoaiMyNeural',
            totalSegments: tl.length,
            totalDuration: tl.reduce((sum, s) => sum + Math.max(0, (Number(s.sourceOut) || 0) - (Number(s.sourceIn) || 0)), 0),
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            finalVideoPath: project.finalVideoPath || null
        };
        fs.writeFileSync(path.join(targetDir, 'episode_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (_) {}

    // 3. storyboard.html
    try {
        const rows = tl.map((seg, idx) => {
            const asset = store ? store.getAsset(seg.sourceAssetId) : null;
            const assetName = asset ? asset.filename : (seg.sourceAssetId || 'Clip ?');
            const dur = Math.max(0, (Number(seg.sourceOut) || 0) - (Number(seg.sourceIn) || 0)).toFixed(1);
            return `<tr>
                <td><strong>#${seg.order || (idx + 1)}</strong></td>
                <td><code>${escapeHtml(assetName)}</code></td>
                <td>${seg.sourceIn}s → ${seg.sourceOut}s (${dur}s)</td>
                <td>${escapeHtml(seg.text || '—')}</td>
                <td>${escapeHtml(seg.voice || '—')}</td>
                <td>${escapeHtml(seg.transition || 'cut')}</td>
            </tr>`;
        }).join('');

        const html = `<!doctype html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <title>Storyboard — ${escapeHtml(project.name)}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e2e8f0; padding: 2rem; margin: 0; }
        h1 { color: #a78bfa; margin-bottom: 0.5rem; }
        .meta { color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.5rem; }
        table { border-collapse: collapse; width: 100%; margin-top: 1rem; background: #1a1d27; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        th, td { border: 1px solid #2d3348; padding: 10px 14px; text-align: left; }
        th { background: #232736; color: #c4b5fd; font-weight: 600; }
        code { background: #2d3348; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>🎬 Storyboard: ${escapeHtml(project.name)}</h1>
    <div class="meta">Mã dự án: <code>${escapeHtml(project.id)}</code> · Số phân đoạn: ${tl.length} · Thời gian: ${new Date().toLocaleString('vi-VN')}</div>
    <table>
        <thead>
            <tr>
                <th>Phân đoạn</th>
                <th>Clip nguồn</th>
                <th>Thời điểm cắt</th>
                <th>Text Overlay</th>
                <th>Voice / Lời thoại</th>
                <th>Chuyển cảnh</th>
            </tr>
        </thead>
        <tbody>
            ${rows || '<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có phân đoạn nào.</td></tr>'}
        </tbody>
    </table>
</body>
</html>`;
        fs.writeFileSync(path.join(targetDir, 'storyboard.html'), html, 'utf-8');
    } catch (_) {}
}
