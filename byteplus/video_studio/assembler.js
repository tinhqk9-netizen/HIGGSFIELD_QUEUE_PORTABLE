import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import util from 'util';
import { generateVoice } from './voice_generator.js';

const execFileAsync = util.promisify(execFile);

/**
 * Kiểm tra file có stream âm thanh không để tránh lỗi filter ffmpeg khi concat.
 */
async function hasAudioStream(filePath, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
    try {
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'a',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            filePath
        ]);
        return stdout.trim().length > 0;
    } catch (_) {
        return false;
    }
}

/**
 * Đo thời lượng thực tế của file âm thanh (giây) bằng ffprobe.
 */
async function getAudioDuration(filePath, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
    try {
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'json',
            filePath
        ]);
        const data = JSON.parse(stdout);
        const dur = parseFloat(data.format?.duration);
        return isNaN(dur) ? 0 : dur;
    } catch (_) {
        return 0;
    }
}

/**
 * Tự động ngắt dòng thông minh để text overlay không bị tràn màn hình dọc 1080px.
 */
function wrapText(str, maxCharsPerLine = 22) {
    if (!str) return '';
    const words = String(str).trim().split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const w of words) {
        if (!currentLine) {
            currentLine = w;
        } else if ((currentLine + ' ' + w).length <= maxCharsPerLine) {
            currentLine += ' ' + w;
        } else {
            lines.push(currentLine);
            currentLine = w;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
}

/**
 * Lắp ráp video hoàn chỉnh theo danh sách segment (SRS §10-11).
 * Hỗ trợ cắt giây (trim/atrim), scale/pad về chuẩn 1080p, text overlay (drawtext),
 * lồng tiếng thuyết minh AI (Edge TTS), nhịp thở voice tự nhiên (Audio-Driven Timeline),
 * và hiệu ứng chuyển cảnh mềm mượt (smooth crossfade xfade + acrossfade).
 */
export async function assembleVideo(segments, outputPath, {
    ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
    voice = 'vi-VN-HoaiMyNeural',
    skipTts = false
} = {}) {
    if (!segments || segments.length === 0) {
        throw Object.assign(new Error('Không có segment nào để lắp ráp.'), { code: 'NO_SEGMENTS' });
    }

    const tempFiles = [];

    try {
        // 1. Sinh giọng đọc thuyết minh Edge TTS cho các segment có kịch bản voice
        const voiceFiles = [];
        if (!skipTts) {
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (seg.voice && String(seg.voice).trim()) {
                    try {
                        const vf = await generateVoice(seg.voice, { voice });
                        if (vf) {
                            voiceFiles[i] = vf;
                            tempFiles.push(vf);
                        } else {
                            voiceFiles[i] = null;
                        }
                    } catch (err) {
                        console.warn(`Không thể sinh voice cho phân đoạn #${i + 1}:`, err);
                        voiceFiles[i] = null;
                    }
                } else {
                    voiceFiles[i] = null;
                }
            }
        }

        // 2. Đo thời lượng thực tế của từng đoạn voice TTS
        const voiceDurations = [];
        for (let i = 0; i < segments.length; i++) {
            if (voiceFiles[i]) {
                voiceDurations[i] = await getAudioDuration(voiceFiles[i], ffprobePath);
            } else {
                voiceDurations[i] = 0;
            }
        }

        // 3. Tính toán thời lượng tối ưu cho từng phân cảnh (Audio-Driven Timeline)
        // Nếu có voice: thời lượng = voiceDur + 0.60s (150ms trễ đầu câu + 450ms khoảng thở cuối câu)
        // Nếu không có voice: dùng thời lượng gốc trong kịch bản (mặc định tối thiểu 2.5s)
        const segmentDurations = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const origStart = Math.max(0, Number(seg.sourceIn) || 0);
            const origEnd = Number(seg.sourceOut) || (origStart + 3);
            const origDur = Math.max(1.5, origEnd - origStart);

            const vDur = voiceDurations[i];
            if (vDur > 0) {
                // Tự động mở rộng thời lượng video khớp với độ dài voice đọc
                segmentDurations[i] = Math.max(origDur, Math.round((vDur + 0.60) * 100) / 100);
            } else {
                segmentDurations[i] = origDur;
            }
        }

        const inputs = [];
        // Thêm tất cả video footage làm inputs (index 0 đến segments.length - 1)
        for (let i = 0; i < segments.length; i++) {
            const videoPath = segments[i].path || segments[i].assetPath;
            if (!videoPath) {
                throw Object.assign(new Error(`Phân đoạn #${i + 1} thiếu đường dẫn video (path/assetPath).`), { code: 'INVALID_SEGMENT_PATH' });
            }
            inputs.push('-i', videoPath);
        }

        // Thêm các file voiceover làm inputs tiếp theo
        const voiceInputIdxs = [];
        let currentInputIdx = segments.length;
        for (let i = 0; i < segments.length; i++) {
            if (voiceFiles[i]) {
                voiceInputIdxs[i] = currentInputIdx++;
                inputs.push('-i', voiceFiles[i]);
            } else {
                voiceInputIdxs[i] = null;
            }
        }

        const filterParts = [];

        // Tìm font Arial trên Windows để drawtext tiếng Việt mượt mà
        const defaultFont = 'C:/Windows/Fonts/arial.ttf';
        const hasFont = fs.existsSync(defaultFont);
        const fontFilterParam = hasFont
            ? `fontfile='${defaultFont.replace(/\\/g, '/').replace(/:/g, '\\:')}':`
            : '';

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const videoPath = seg.path || seg.assetPath;
            const D_target = segmentDurations[i];
            const duration = D_target;
            const fileDur = await getAudioDuration(videoPath, ffprobePath);

            let start = Math.max(0, Number(seg.sourceIn) || 0);
            let origEnd = Number(seg.sourceOut) || (start + 3);

            if (fileDur > 0) {
                start = Math.min(start, Math.max(0, fileDur - 1.0));
                origEnd = Math.min(Math.max(origEnd, start + 1.0), fileDur);
            }

            const clipDur = Math.max(0.5, origEnd - start);
            let end = origEnd;
            let multiplier = 1.0;

            if (clipDur < D_target) {
                // Làm chậm tốc độ phát (Slow Motion / Time-Stretch) để kéo dãn chuyển động khớp với voice, KHÔNG dừng/đứng hình
                multiplier = Math.round((D_target / clipDur) * 10000) / 10000;
            } else {
                end = start + D_target;
            }

            // A. Video filter: trim + slow-motion setpts + scale 1080x1920 pad + fps=30 + format yuv420p
            let vFilters = [
                `trim=start=${start}:end=${end}`,
                `setpts=(PTS-STARTPTS)*${multiplier}`,
                `trim=0:${D_target}`,
                'setpts=PTS-STARTPTS',
                'scale=1080:1920:force_original_aspect_ratio=decrease',
                'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
                'fps=30',
                'format=yuv420p'
            ];

            // Text overlay nếu có (chuẩn phụ đề dọc 9:16 ăn theo voice)
            if (seg.text && String(seg.text).trim()) {
                const text = wrapText(String(seg.text).trim(), 22);
                const txtFile = path.join(os.tmpdir(), `v2v_txt_${Date.now()}_${i}.txt`);
                fs.writeFileSync(txtFile, text, 'utf-8');
                tempFiles.push(txtFile);
                const escapedTxtPath = txtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
                vFilters.push(
                    `drawtext=${fontFilterParam}textfile='${escapedTxtPath}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=12:line_spacing=10:x=(w-text_w)/2:y=h*0.72-text_h/2`
                );
            }

            filterParts.push(`[${i}:v]${vFilters.join(',')}[v${i}]`);

            // B. Audio filter: BỎ HOÀN TOÀN âm thanh gốc từ video kho, chỉ dùng voice AI
            const vIdx = voiceInputIdxs[i];
            if (vIdx !== null && vIdx !== undefined) {
                // Có giọng nói TTS: adelay 150ms để tạo khoảng thở đầu câu, apad để tạo khoảng thở cuối câu, không bị cắt đột ngột
                filterParts.push(
                    `[${vIdx}:a]adelay=150|150,volume=1.2,aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${duration},atrim=0:${duration},asetpts=PTS-STARTPTS[a${i}]`
                );
            } else {
                // Không có voice TTS: chèn silence (tĩnh lặng)
                filterParts.push(
                    `anullsrc=r=44100:cl=stereo,atrim=0:${duration},asetpts=PTS-STARTPTS[a${i}]`
                );
            }
        }

        // C. Smooth Transition (Chuyển cảnh mềm mại xfade + acrossfade)
        if (segments.length === 1) {
            filterParts.push(`[v0]null[outv]`);
            filterParts.push(`[a0]anull[outa]`);
        } else {
            const minSegDur = Math.min(...segmentDurations);
            const T = Math.min(0.35, Math.max(0.1, Math.round((minSegDur / 3) * 100) / 100));
            let runningOffset = Math.round((segmentDurations[0] - T) * 100) / 100;

            for (let k = 0; k < segments.length - 1; k++) {
                const isLast = (k === segments.length - 2);
                const inV1 = (k === 0) ? 'v0' : `vx${k}`;
                const inV2 = `v${k + 1}`;
                const outV = isLast ? 'outv' : `vx${k + 1}`;

                const inA1 = (k === 0) ? 'a0' : `ax${k}`;
                const inA2 = `a${k + 1}`;
                const outA = isLast ? 'outa' : `ax${k + 1}`;

                filterParts.push(`[${inV1}][${inV2}]xfade=transition=fade:duration=${T}:offset=${runningOffset.toFixed(2)}[${outV}]`);
                filterParts.push(`[${inA1}][${inA2}]acrossfade=d=${T}:c1=tri:c2=tri[${outA}]`);

                if (!isLast) {
                    runningOffset = Math.round((runningOffset + segmentDurations[k + 1] - T) * 100) / 100;
                }
            }
        }

        const filterScriptPath = path.join(os.tmpdir(), `v2v_filter_${Date.now()}.txt`);
        fs.writeFileSync(filterScriptPath, filterParts.join(';\n'), 'utf-8');
        tempFiles.push(filterScriptPath);

        const args = [
            '-y',
            ...inputs,
            '-filter_complex_script', filterScriptPath,
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', '+faststart',
            outputPath
        ];

        await execFileAsync(ffmpegPath, args, { timeout: 300000 });
        return outputPath;
    } catch (err) {
        console.error('Lỗi khi lắp ráp video FFmpeg:', err);
        const e = new Error(`Lỗi khi lắp ráp video: ${(err && err.message) || err}`);
        e.code = 'ASSEMBLY_FAILED';
        throw e;
    } finally {
        for (const f of tempFiles) {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        }
    }
}

/**
 * Dựng đồng thời 10 video cùng lúc bằng FFmpeg (Parallel Batch Render).
 * Tận dụng toàn bộ sức mạnh phần cứng máy tính: render full tải 10 luồng song song.
 */
export async function batchAssemble(timelines, outputDir, {
    ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
    voice = 'vi-VN-HoaiMyNeural',
    onProgress = null
} = {}) {
    fs.mkdirSync(outputDir, { recursive: true });

    // Kích hoạt đồng thời toàn bộ 10 video (Full 10 Concurrent Renders)
    const renderTasks = timelines.map(async (tl, idx) => {
        const videoIndex = tl.index || (idx + 1);
        const outFileName = `final_${videoIndex}.mp4`;
        const outPath = path.join(outputDir, outFileName);

        if (typeof onProgress === 'function') {
            onProgress(videoIndex, 'rendering', 0.2);
        }

        try {
            await assembleVideo(tl.segments, outPath, {
                ffmpegPath,
                ffprobePath,
                voice
            });

            if (typeof onProgress === 'function') {
                onProgress(videoIndex, 'completed', 1.0);
            }

            return {
                index: videoIndex,
                title: tl.title,
                angle: tl.angle,
                directorNote: tl.directorNote,
                success: true,
                outputPath: outPath,
                fileName: outFileName
            };
        } catch (err) {
            console.error(`[BatchAssemble] Lỗi render video #${videoIndex}:`, err);
            if (typeof onProgress === 'function') {
                onProgress(videoIndex, 'failed', 0);
            }
            return {
                index: videoIndex,
                title: tl.title,
                angle: tl.angle,
                success: false,
                error: err.message
            };
        }
    });

    return await Promise.all(renderTasks);
}

