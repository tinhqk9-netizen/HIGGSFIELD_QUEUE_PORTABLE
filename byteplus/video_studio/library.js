/**
 * byteplus/video_studio/library.js
 *
 * Local Media Library scanner cho tool "Video to Video" (GTF Video Studio, SRS §3).
 * Quét 1 folder video local, dùng ffprobe đọc metadata, lưu vào JSON store.
 *
 * Nguyên tắc (SRS §3, FR1/FR2/FR4):
 *  - Ghi nhận: asset_id, filename, path, duration, resolution, fps, codec, size,
 *    fingerprint (mtime:size) va category (theo thu muc con dau tien).
 *  - Incremental: file khong doi (fingerprint trung) thi bo qua, khong quet lai.
 *  - Fail-closed: ffprobe loi thi ghi vao errors, khong doan bua metadata.
 *
 * Zero dependency ngoai Node core + ffprobe co san tren PATH.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);

export function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

/** Fingerprint nhanh de phat hien file thay doi (khong hash toan bo noi dung). */
export function fileFingerprint(filePath) {
    const st = fs.statSync(filePath);
    return `${Math.round(st.mtimeMs)}:${st.size}`;
}

/** Suy ra category tu thu muc con dau tien duoi library root. VD people/clip.mp4 -> "people". */
export function inferCategory(filePath, libraryRoot) {
    const rel = path.relative(libraryRoot, filePath);
    if (rel.startsWith('..')) return '';
    const parts = rel.split(path.sep);
    return parts.length > 1 ? parts[0] : '';
}

/**
 * Chay ffprobe tren 1 file, tra ve metadata chuan hoa.
 * Nem loi neu ffprobe that bai (fail-closed).
 */
export async function probeVideo(filePath, { ffprobePath = process.env.FFPROBE_PATH || 'ffprobe', timeoutMs = 60000 } = {}) {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', String(filePath)];
    let stdout;
    try {
        ({ stdout } = await execFileAsync(ffprobePath, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }));
    } catch (err) {
        const e = new Error(`FFPROBE_FAILED: ffprobe khong đọc được ${path.basename(filePath)}: ${(err && err.message) || err}`);
        e.code = 'FFPROBE_FAILED';
        throw e;
    }

    let data;
    try {
        data = JSON.parse(stdout);
    } catch (_) {
        const e = new Error(`FFPROBE_FAILED: ffprobe trả về dữ liệu không phải JSON cho ${path.basename(filePath)}`);
        e.code = 'FFPROBE_FAILED';
        throw e;
    }

    const videoStream = (data.streams || []).find(s => s.codec_type === 'video') || {};
    const fmt = data.format || {};

    let fps = 0;
    const rate = String(videoStream.r_frame_rate || '0/1');
    if (rate.includes('/')) {
        const [num, den] = rate.split('/').map(Number);
        fps = den ? Math.round((num / den) * 100) / 100 : 0;
    } else {
        fps = Number(rate) || 0;
    }

    return {
        duration: Math.round((Number(fmt.duration) || 0) * 1000) / 1000,
        width: Number(videoStream.width) || 0,
        height: Number(videoStream.height) || 0,
        fps,
        codec: String(videoStream.codec_name || ''),
        file_size: Number(fmt.size) || 0
    };
}

/**
 * Sinh 1 ảnh thumbnail (poster frame) từ video bằng ffmpeg.
 * Trả về outPath khi xong; ném lỗi có code THUMB_FAILED nếu ffmpeg fail.
 */
export async function generateThumbnail(videoPath, outPath, { ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', atSeconds = 1, width = 400, timeoutMs = 60000 } = {}) {
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });
    // -ss trước -i để seek nhanh; scale giữ tỉ lệ; -frames:v 1 lấy đúng 1 khung.
    const args = ['-y', '-ss', String(atSeconds), '-i', String(videoPath),
        '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', String(outPath)];
    try {
        await execFileAsync(ffmpegPath, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
        // Video ngắn hơn atSeconds -> thử lại lấy khung đầu (giây 0).
        try {
            await execFileAsync(ffmpegPath, ['-y', '-i', String(videoPath), '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', String(outPath)], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
        } catch (err2) {
            const e = new Error(`THUMB_FAILED: ffmpeg không tạo được thumbnail cho ${path.basename(videoPath)}: ${(err2 && err2.message) || err2}`);
            e.code = 'THUMB_FAILED';
            throw e;
        }
    }
    if (!fs.existsSync(outPath)) {
        const e = new Error('THUMB_FAILED: ffmpeg chạy xong nhưng không có file thumbnail.');
        e.code = 'THUMB_FAILED';
        throw e;
    }
    return outPath;
}

/**
 * Quét folder đệ quy, probe từng video, upsert vào store.
 * store phải có: listAssets(), upsertAsset(data).
 * Tra ve { added, updated, unchanged, errors: [{file, error}] }.
 */
export async function scanLibrary(folder, store, opts = {}) {
    const root = path.resolve(String(folder || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        const e = new Error(`LIBRARY_FOLDER_NOT_FOUND: Thư mục thư viện không tồn tại: ${root}`);
        e.code = 'LIBRARY_FOLDER_NOT_FOUND';
        throw e;
    }

    const result = { added: 0, updated: 0, unchanged: 0, errors: [] };

    const videoFiles = [];
    const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            let st;
            try { st = fs.statSync(full); } catch { continue; }
            if (st.isDirectory()) walk(full);
            else if (st.isFile() && isVideoFile(full)) videoFiles.push(full);
        }
    };
    walk(root);
    videoFiles.sort();

    const existingByPath = new Map();
    for (const a of store.listAssets()) existingByPath.set(a.path, a);

    // Cho phép inject probe (test không cần ffprobe thật).
    const probe = (opts && opts.probeFn) || probeVideo;

    for (const file of videoFiles) {
        const fingerprint = fileFingerprint(file);
        const existing = existingByPath.get(file);
        if (existing && existing.file_hash === fingerprint) {
            result.unchanged += 1;
            continue;
        }

        let meta;
        try {
            meta = await probe(file, opts);
        } catch (err) {
            result.errors.push({ file, error: (err && err.message) || String(err) });
            continue;
        }

        store.upsertAsset({
            asset_id: existing ? existing.asset_id : 'VID_' + crypto.randomBytes(5).toString('hex'),
            filename: path.basename(file),
            path: file,
            category: inferCategory(file, root),
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            fps: meta.fps,
            codec: meta.codec,
            file_size: meta.file_size,
            file_hash: fingerprint,
            // Field cho buoc sau (SRS §4) — chua phan tich thi de rong.
            described: existing ? Boolean(existing.described) : false,
            description_index: existing ? (existing.description_index || null) : null,
            descriptionIndex: existing ? (existing.descriptionIndex || existing.description_index || null) : null,
            aiDescription: existing ? (existing.aiDescription || null) : null
        });

        if (existing) result.updated += 1;
        else result.added += 1;
    }

    return result;
}

export default { scanLibrary, probeVideo, inferCategory, fileFingerprint, isVideoFile, VIDEO_EXTENSIONS };
