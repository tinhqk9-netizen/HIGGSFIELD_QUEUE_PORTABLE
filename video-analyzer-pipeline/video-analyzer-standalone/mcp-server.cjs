#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// Redirect all diagnostics/logging to stderr to avoid corrupting stdio JSON-RPC stream
const log = {
  info: (...args) => process.stderr.write(`[VIDEO-ANALYZER-MCP INFO] ${args.join(' ')}\n`),
  warn: (...args) => process.stderr.write(`[VIDEO-ANALYZER-MCP WARN] ${args.join(' ')}\n`),
  error: (...args) => process.stderr.write(`[VIDEO-ANALYZER-MCP ERROR] ${args.join(' ')}\n`),
};

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'video-analyzer',
  version: '1.0.0',
};

const ANALYZE_VIDEO_TOOL = {
  name: 'analyze_video',
  description:
    'Analyze a local video file by extracting visual frames and transcribing spoken audio locally with Whisper on CUDA. ' +
    'Combines visual analysis and speech understanding into a synchronized multimodal timeline and synthesis. ' +
    'Use this tool whenever you need to inspect, understand, summarize, transcribe, or extract key moments from a video.',
  inputSchema: {
    type: 'object',
    properties: {
      video_path: {
        type: 'string',
        description: 'Absolute local filesystem path to the video file to analyze.',
      },
      language: {
        type: 'string',
        description: "Spoken language code for Whisper transcription (e.g. 'auto', 'vi', 'en'). Defaults to 'auto'.",
        default: 'auto',
      },
      frame_interval: {
        type: 'number',
        description: 'Interval in seconds between extracted video frames (0.1 to 10.0 seconds). Default is 0.5s (2 FPS).',
        default: 0.5,
      },
      detail: {
        type: 'string',
        enum: ['summary', 'normal', 'detailed'],
        description: "Level of analysis granularity ('summary', 'normal', or 'detailed'). Default is 'detailed'.",
        default: 'detailed',
      },
    },
    required: ['video_path'],
  },
};

function formatVisualSummary(vs) {
  if (!vs) return '';
  if (typeof vs === 'string') return vs.trim();
  if (typeof vs === 'object') {
    const lines = [];
    if (Array.isArray(vs.scenes) && vs.scenes.length > 0) lines.push(`- **Scenes:** ${vs.scenes.join(', ')}`);
    if (Array.isArray(vs.people) && vs.people.length > 0) lines.push(`- **People:** ${vs.people.join(', ')}`);
    if (Array.isArray(vs.objects) && vs.objects.length > 0) lines.push(`- **Objects:** ${vs.objects.join(', ')}`);
    if (Array.isArray(vs.products) && vs.products.length > 0) lines.push(`- **Products:** ${vs.products.join(', ')}`);
    if (Array.isArray(vs.visible_text) && vs.visible_text.length > 0) lines.push(`- **On-Screen Text:** ${vs.visible_text.join(', ')}`);
    return lines.join('\n');
  }
  return '';
}

function formatAudioSummary(as) {
  if (!as) return '';
  if (typeof as === 'string') return as.trim();
  if (typeof as === 'object') {
    const lines = [];
    if (as.language && as.language !== 'auto') lines.push(`- **Language:** ${as.language}`);
    if (Array.isArray(as.topics) && as.topics.length > 0) lines.push(`- **Topics:** ${as.topics.join(', ')}`);
    if (Array.isArray(as.claims) && as.claims.length > 0) lines.push(`- **Claims:** ${as.claims.join(', ')}`);
    if (Array.isArray(as.calls_to_action) && as.calls_to_action.length > 0) lines.push(`- **Calls to Action:** ${as.calls_to_action.join(', ')}`);
    return lines.join('\n');
  }
  return '';
}

function formatAgentSummary(result) {
  if (!result || typeof result !== 'object') {
    return String(result || 'Video analysis completed.');
  }

  const parts = [];

  if (result.video && typeof result.video === 'object') {
    const meta = [];
    if (result.video.duration != null) meta.push(`${result.video.duration}s`);
    if (result.video.width && result.video.height) meta.push(`${result.video.width}x${result.video.height}`);
    if (result.video.fps != null) meta.push(`${result.video.fps} fps`);
    if (meta.length > 0) {
      parts.push(`**Video Info:** ${meta.join(' | ')}`);
    }
  }

  if (result.summary) {
    parts.push(`## Video Summary\n${result.summary}`);
  }

  if (result.purpose) {
    parts.push(`**Purpose / Intent:** ${result.purpose}`);
  }

  const visualSummaryText = formatVisualSummary(result.visual_summary);
  if (visualSummaryText) {
    parts.push(`### Visual Summary\n${visualSummaryText}`);
  }

  const audioSummaryText = formatAudioSummary(result.audio_summary);
  if (audioSummaryText) {
    parts.push(`### Audio Summary\n${audioSummaryText}`);
  }

  if (Array.isArray(result.key_moments) && result.key_moments.length > 0) {
    const kmLines = result.key_moments.map(
      (km) => `- [${(typeof km.timestamp === 'number' ? km.timestamp.toFixed(1) : (km.timestamp || km.time || 0))}s]: ${km.description || km.text || ''}`
    ).filter((l) => l.trim().length > 5);
    if (kmLines.length > 0) {
      parts.push(`### Key Moments\n${kmLines.join('\n')}`);
    }
  }

  if (Array.isArray(result.timeline) && result.timeline.length > 0) {
    const tlLines = result.timeline.slice(0, 30).map((t) => {
      const start = typeof t.start === 'number' ? `${t.start.toFixed(1)}s` : (t.start != null ? `${t.start}s` : '0s');
      const end = typeof t.end === 'number' ? `${t.end.toFixed(1)}s` : (t.end != null ? `${t.end}s` : '?');
      const vis = t.visual ? ` *Visual:* ${t.visual}` : '';
      const sp = t.speech ? ` *Spoken:* "${t.speech}"` : '';
      const an = t.analysis ? ` *Analysis:* ${t.analysis}` : '';
      return `- **[${start} - ${end}]**${vis}${sp}${an}`;
    });
    if (tlLines.length > 0) {
      parts.push(`### Synchronized Timeline (Highlights)\n${tlLines.join('\n')}`);
    }
  }

  if (Array.isArray(result.entities) && result.entities.length > 0) {
    const entityItems = result.entities.map((e) => (typeof e === 'string' ? e : e.name || JSON.stringify(e))).filter(Boolean);
    if (entityItems.length > 0) {
      parts.push(`### Detected Entities\n` + entityItems.map((e) => `- ${e}`).join('\n'));
    }
  }

  if (Array.isArray(result.calls_to_action) && result.calls_to_action.length > 0) {
    parts.push(`### Calls to Action\n` + result.calls_to_action.map((c) => `- ${c}`).join('\n'));
  }

  if (result.conclusion) {
    parts.push(`### Conclusion\n${result.conclusion}`);
  }

  if (result.artifacts && typeof result.artifacts === 'object') {
    const art = result.artifacts;
    const artLines = [];
    if (art.final) artLines.push(`- Final Analysis JSON: \`${art.final}\``);
    if (art.timeline) artLines.push(`- Timeline JSON: \`${art.timeline}\``);
    if (art.subtitle || art.srt_path) artLines.push(`- Subtitle SRT: \`${art.subtitle || art.srt_path}\``);
    if (art.transcript) artLines.push(`- Audio Transcript: \`${art.transcript}\``);
    if (art.visual) artLines.push(`- Visual Events: \`${art.visual}\``);
    if (art.audio) artLines.push(`- Audio Analysis: \`${art.audio}\``);
    if (artLines.length > 0) {
      parts.push(`### Generated Artifacts\n${artLines.join('\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : JSON.stringify(result, null, 2);
}

class WorkerClient {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || process.env.VIDEO_ANALYZER_PYTHON || '/home/server/.openclaw/extensions/video-analyzer/.venv/bin/python';
    this.pluginRoot = options.pluginRoot || process.env.VIDEO_ANALYZER_PLUGIN_ROOT || '/home/server/.openclaw/extensions/video-analyzer';
    this.workerArgs = options.workerArgs || (process.env.VIDEO_ANALYZER_WORKER_ARGS ? process.env.VIDEO_ANALYZER_WORKER_ARGS.split(',') : ['-m', 'video_analyzer.worker']);
    this.startupTimeoutMs = Number(options.startupTimeoutMs || process.env.VIDEO_ANALYZER_STARTUP_TIMEOUT_MS || 120000);
    this.timeoutMs = Number(options.timeoutMs || process.env.VIDEO_ANALYZER_TIMEOUT_MS || 900000);
    this.idleShutdownMs = Number(options.idleShutdownMs || process.env.VIDEO_ANALYZER_IDLE_SHUTDOWN_MS || 600000);

    this.child = null;
    this.isReady = false;
    this.readyPromise = null;
    this.pending = new Map();
    this.idleTimer = null;
  }

  teardown(reason) {
    if (this.child) {
      log.info(`Worker teardown (${reason})`);
      this.child.removeAllListeners();
      try {
        this.child.kill();
      } catch (e) {
        // ignore
      }
      this.child = null;
    }
    this.isReady = false;
    this.readyPromise = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`Worker terminated (${reason})`));
    }
    this.pending.clear();
  }

  scheduleIdleShutdown() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.idleShutdownMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) {
        this.teardown('idle shutdown');
      }
    }, this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  ensureWorker() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      if (!fs.existsSync(this.pythonPath)) {
        const err = new Error(`Python executable not found at: ${this.pythonPath}`);
        log.error(err.message);
        this.readyPromise = null;
        return reject(err);
      }

      log.info(`Spawning Python worker: ${this.pythonPath} ${this.workerArgs.join(' ')}`);

      let child;
      try {
        child = spawn(this.pythonPath, this.workerArgs, {
          cwd: this.pluginRoot,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONPATH: path.join(this.pluginRoot, 'python'),
            PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        this.readyPromise = null;
        return reject(err);
      }

      this.child = child;
      if (child.stdin) {
        child.stdin.on('error', (err) => {
          log.warn(`Worker stdin stream error: ${err.message}`);
        });
      }
      let settled = false;

      const finish = (ok, reason, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        if (!ok) {
          this.teardown(reason);
          reject(err || new Error(`Worker failed to start: ${reason}`));
        } else {
          this.isReady = true;
          resolve(true);
        }
      };

      const startupTimer = setTimeout(() => {
        finish(false, 'startup timeout', new Error(`Timed out waiting for Python worker to signal ready (${this.startupTimeoutMs}ms)`));
      }, this.startupTimeoutMs);
      startupTimer.unref?.();

      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;

          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }

          if (msg.type === 'ready') {
            log.info('Python worker is ready');
            finish(true, 'ready');
            continue;
          }

          if (msg.type === 'progress') {
            log.info(`[Progress ${msg.request_id}] stage=${msg.stage} progress=${msg.progress}`);
            continue;
          }

          if (msg.type === 'response' || (msg.request_id && ('ok' in msg || 'result' in msg))) {
            const entry = this.pending.get(msg.request_id);
            if (entry) {
              clearTimeout(entry.timer);
              this.pending.delete(msg.request_id);
              if (msg.ok !== false && msg.result) {
                entry.resolve(msg.result);
              } else {
                const errMsg = msg.error?.message || `Worker reported error code: ${msg.error?.code || 'UNKNOWN'}`;
                entry.reject(new Error(errMsg));
              }
              this.scheduleIdleShutdown();
            }
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        process.stderr.write(`[PY] ${chunk.toString()}`);
      });

      child.on('error', (err) => {
        log.error(`Worker process error: ${err.message}`);
        finish(false, 'spawn error', err);
      });

      child.on('exit', (code, signal) => {
        log.warn(`Worker process exited (code ${code}, signal ${signal})`);
        if (!settled) {
          finish(false, `exited during startup (code ${code})`, new Error(`Worker exited with code ${code}`));
        } else {
          this.teardown(`process exit (code ${code})`);
        }
      });
    });

    return this.readyPromise;
  }

  async analyzeVideo(params) {
    await this.ensureWorker();

    if (!this.child || !this.child.stdin || this.child.killed) {
      throw new Error('Worker process is not available');
    }

    const requestId = crypto.randomUUID();
    const payload = {
      type: 'request',
      request_id: requestId,
      action: 'analyze_video',
      params: {
        video_path: params.video_path,
        language: params.language || 'auto',
        frame_interval: typeof params.frame_interval === 'number' ? params.frame_interval : 0.5,
        detail: params.detail || 'detailed',
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Video analysis timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      timer.unref?.();

      this.pending.set(requestId, { resolve, reject, timer });

      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }

      try {
        this.child.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }
}

function createMcpServer(workerClient = new WorkerClient()) {
  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: payload must be a JSON object' },
      };
    }

    const { jsonrpc, id, method, params } = message;

    // Notifications (JSON-RPC requests without an 'id' member)
    // MUST NOT be replied to by the server per JSON-RPC 2.0 specification.
    if (id === undefined || id === null) {
      return null;
    }

    if (jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC version. Expected "2.0".' },
      };
    }

    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: SERVER_INFO,
            instructions:
              'Video Analyzer MCP Server provides local multimodal video analysis combining visual frame analysis with local Whisper speech transcription.',
          },
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [ANALYZE_VIDEO_TOOL],
          },
        };
      }

      case 'tools/call': {
        if (!params || typeof params !== 'object' || typeof params.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: "name" is required' },
          };
        }

        if (params.name !== 'analyze_video') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Tool not found: "${params.name}"` },
          };
        }

        const args = params.arguments || {};
        const rawVideoPath = args.video_path;
        if (!rawVideoPath || typeof rawVideoPath !== 'string' || !rawVideoPath.trim()) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: 'Error: video_path parameter is required and must be a non-empty string filesystem path.',
                },
              ],
              isError: true,
            },
          };
        }

        const trimmedPath = rawVideoPath.trim();
        const os = require('node:os');
        const resolvedPath = trimmedPath.startsWith('~/')
          ? path.join(os.homedir(), trimmedPath.slice(2))
          : (trimmedPath === '~' ? os.homedir() : path.resolve(trimmedPath));

        if (!fs.existsSync(resolvedPath)) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Error: Video file not found at path: ${rawVideoPath}${resolvedPath !== rawVideoPath ? ` (resolved: ${resolvedPath})` : ''}`,
                },
              ],
              isError: true,
            },
          };
        }

        try {
          const rawResult = await workerClient.analyzeVideo({
            ...args,
            video_path: resolvedPath,
          });
          const formatted = formatAgentSummary(rawResult);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: formatted,
                },
              ],
              isError: false,
            },
          };
        } catch (err) {
          log.error(`Analysis execution failed: ${err.message}`);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Error during video analysis: ${err.message}`,
                },
              ],
              isError: true,
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: "${method}"` },
        };
      }
    }
  }

  return {
    handleMessage,
    workerClient,
    tools: [ANALYZE_VIDEO_TOOL],
  };
}

function main() {
  log.info(`Starting ${SERVER_INFO.name} v${SERVER_INFO.version}...`);

  const workerClient = new WorkerClient();
  const server = createMcpServer(workerClient);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let inFlight = 0;
  let stdinClosed = false;

  const checkExit = () => {
    if (stdinClosed && inFlight === 0) {
      log.info('Stdin closed and all in-flight requests completed. Exiting.');
      workerClient.teardown('stdin closed');
      process.exit(0);
    }
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (parseError) {
      log.error(`JSON parse error: ${parseError.message}`);
      const errResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
      return;
    }

    inFlight++;
    try {
      const response = await server.handleMessage(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (handlerError) {
      log.error(`Handler error: ${handlerError.message}`);
      const errResponse = {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: -32603, message: `Internal server error: ${handlerError.message}` },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
    } finally {
      inFlight--;
      checkExit();
    }
  });

  const shutdown = (signal) => {
    log.info(`Received ${signal}. Shutting down...`);
    rl.close();
    workerClient.teardown('process shutdown');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  rl.on('close', () => {
    stdinClosed = true;
    checkExit();
  });

  log.info(`${SERVER_INFO.name} ready for JSON-RPC messages on stdio.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  createMcpServer,
  WorkerClient,
  formatAgentSummary,
  ANALYZE_VIDEO_TOOL,
  PROTOCOL_VERSION,
  SERVER_INFO,
};
