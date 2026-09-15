import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import util from 'util';
import { config } from '../config.js';

const execFileAsync = util.promisify(execFile);

const ANALYZER_ROOT = process.env.VIDEO_ANALYZER_ROOT
    || path.join(config.root, 'video-analyzer-pipeline', 'video-analyzer-standalone');

const EDGE_TTS_BIN = process.env.EDGE_TTS_BIN
    || (process.platform === 'win32'
        ? path.join(ANALYZER_ROOT, '.venv', 'Scripts', 'edge-tts.exe')
        : path.join(ANALYZER_ROOT, '.venv', 'bin', 'edge-tts'));

export const AVAILABLE_VOICES = [
    // Giọng tiếng Anh (Edge TTS) — mặc định cho kịch bản tiếng Anh.
    { id: 'en-US-AriaNeural',    name: 'Aria (US Female — Confident, Upbeat)', gender: 'Female' },
    { id: 'en-US-GuyNeural',     name: 'Guy (US Male — Warm, Persuasive)', gender: 'Male' },
    { id: 'en-US-JennyNeural',   name: 'Jenny (US Female — Friendly, Casual)', gender: 'Female' },
    { id: 'en-US-EricNeural',    name: 'Eric (US Male — Bold, Energetic)', gender: 'Male' },
    { id: 'en-GB-SoniaNeural',   name: 'Sonia (UK Female — Elegant)', gender: 'Female' },
    // Giọng tiếng Việt (giữ lại nếu cần).
    { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (VI Nữ - Truyền cảm)', gender: 'Female' },
    { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (VI Nam - Trầm ấm)', gender: 'Male' }
];

/**
 * Sinh file giọng nói tiếng Việt bằng Edge TTS (SRS §10 bước 7).
 * Hoàn toàn miễn phí, chất lượng cao từ Microsoft Speech.
 */
export async function generateVoice(text, { voice = 'en-US-AriaNeural', rate = '+0%', pitch = '+0Hz', outPath = null } = {}) {
    if (!text || !String(text).trim()) return null;

    const trimmed = String(text).trim();
    const targetPath = outPath || path.join(os.tmpdir(), `v2v_voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`);

    const exe = fs.existsSync(EDGE_TTS_BIN) ? EDGE_TTS_BIN : 'edge-tts';

    const args = [
        '--voice', voice,
        '--text', trimmed,
        '--rate', rate,
        '--pitch', pitch,
        '--write-media', targetPath
    ];

    try {
        await execFileAsync(exe, args, { timeout: 30000 });
        if (fs.existsSync(targetPath)) return targetPath;
        return null;
    } catch (err) {
        console.warn('Cảnh báo: Không thể sinh voice bằng Edge TTS:', (err && err.message) || err);
        return null;
    }
}

export default { generateVoice, AVAILABLE_VOICES };
