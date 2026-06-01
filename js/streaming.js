/**
 * SimulationRecorder — frame-accurate WebM video recorder for the Celeris WebGPU canvas.
 *
 * Design overview
 * ---------------
 * Wraps the browser's VideoEncoder + WebMMuxer pipeline and streams encoded VP9 chunks
 * directly to a user-chosen file via the File System Access API. No frames are buffered
 * in memory, so recording length is limited only by available disk space — unlike the
 * existing GIF/JPEG-stack approach which caps at ~100 frames.
 *
 * State machine:
 *   idle → initializing → recording → stopping → idle
 *
 * The class owns no DOM references and wires no event listeners. The caller (main.js)
 * holds the buttons and calls start() / addFrame() / stop() directly. This separation
 * makes it straightforward to tie recording state to the existing simulation controls
 * (pause logic, status display, etc.) without coupling this module to the HTML layout.
 *
 * Reusability: after stop() resolves the instance returns to 'idle' and start() can be
 * called again for a new session without reloading the page.
 *
 * Browser requirements: Chrome / Edge 94+ (VideoEncoder, File System Access API).
 * The caller supplies a FileSystemDirectoryHandle (e.g. from showDirectoryPicker)
 * and a base name; this class writes <base>.webm / .srt / .json into that directory.
 *
 * Dependencies:
 *   webm-muxer  — expected at js/webm-muxer.js (local copy, see import below).
 *   The file exports a single { WebMMuxer } named export containing Muxer and
 *   FileSystemWritableFileStreamTarget as properties.
 *
 * Example (main.js):
 *   import { SimulationRecorder } from './streaming.js';
 *   const recorder = new SimulationRecorder({ fps: 30, skipFrames: 1 });
 *
 *   const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
 *   startBtn.addEventListener('click', async () => {
 *       try { await recorder.start(canvas, { dirHandle: dir, baseName: 'photo' }); }
 *       catch (e) { if (e.name !== 'AbortError') console.error(e); }
 *   });
 *   stopBtn.addEventListener('click', () => recorder.stop());
 *
 *   // inside the render loop:
 *   recorder.addFrame(canvas);
 */

import { WebMMuxer } from './webm-muxer.js';

export class SimulationRecorder {

    // Private fields — all mutable state is instance-scoped so that the recorder
    // can be started, stopped, and started again without any leftover globals.
    #fps;
    #skipFrames;
    #keyframeInterval;  // in seconds
    #usPerFrame;        // microseconds between encoded frames, derived from fps and skipFrames

    #state = 'idle';    // single source of truth for the lifecycle
    #muxer = null;
    #videoEncoder = null;
    #fileStream = null;
    #rawFrameCount = 0;     // incremented on every addFrame() call
    #encodedFrameCount = 0; // incremented only when a frame is actually encoded
    #subtitles = [];        // { videoUs, simTime } — one entry per encoded frame

    // Output destination — a caller-chosen directory plus a base name. All files for
    // one session (<base>.webm, <base>.srt, optional <base>.json) are written here.
    #dirHandle = null;
    #baseName = 'recording';
    #metadata = null;       // optional plain object → written as <base>.json on stop()

    /**
     * Optional callback invoked during stop() to report save progress.
     * Receives { phase: 'encoding'|'writing', progress: 0–1, framesLeft: number }.
     * 'encoding' fires repeatedly as the encoder drains its queue.
     * 'writing'  fires once when the encoder is done and the file stream is closing.
     * Set to null to disable.
     */
    #onSavingProgress = null;
    set onSavingProgress(cb) { this.#onSavingProgress = cb; }

    /**
     * Creates a recorder instance with the given encoding options.
     * Does not open any dialogs or allocate any GPU resources — call start() for that.
     *
     * @param {object}  [options]
     * @param {number}  [options.fps=30]             Target frame rate of the output video.
     * @param {number}  [options.skipFrames=1]       Encode 1 out of every N raw addFrame()
     *                                               calls. skipFrames=2 halves the output
     *                                               frame rate without changing call frequency.
     * @param {number}  [options.keyframeInterval=3] Seconds between forced keyframes.
     *                                               Smaller values improve seek precision
     *                                               at the cost of a slightly larger file.
     */
    constructor({ fps = 30, skipFrames = 1, keyframeInterval = 3 } = {}) {
        this.#fps = fps;
        this.#skipFrames = skipFrames;
        this.#keyframeInterval = keyframeInterval;
        // Precompute timestamp step: each encoded frame advances by (skipFrames / fps) seconds.
        this.#usPerFrame = Math.round((skipFrames / fps) * 1_000_000);
    }

    /** Current lifecycle state: 'idle' | 'initializing' | 'recording' | 'stopping'. */
    get state() { return this.#state; }

    /** Convenience boolean — true only while addFrame() is actively encoding. */
    get isRecording() { return this.#state === 'recording'; }

    /**
     * Creates <base>.webm in the supplied directory, initialises the muxer and video
     * encoder, and transitions to 'recording' so that addFrame() calls start encoding.
     *
     * Error handling:
     *   - Throws Error if no `dirHandle` is supplied, or if VideoEncoder is unavailable.
     *   - Throws if called while not in 'idle' state (prevents double-start).
     *
     * @param  {HTMLCanvasElement|OffscreenCanvas} canvas  The canvas whose frames will be
     *                                     recorded. Width and height are read once here and
     *                                     fixed for the duration of the recording.
     * @param  {object} options
     * @param  {FileSystemDirectoryHandle} options.dirHandle  Directory to write all files into.
     * @param  {string} [options.baseName='recording']  Base filename (no extension).
     * @param  {object|null} [options.metadata=null]  If set, written as <base>.json on stop().
     * @returns {Promise<void>}            Resolves when the encoder is configured and
     *                                     the recorder is ready to accept frames.
     */
    async start(canvas, { dirHandle, baseName = 'recording', metadata = null } = {}) {
        if (this.#state !== 'idle') {
            throw new Error(`Cannot start: recorder is currently '${this.#state}'.`);
        }
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('VideoEncoder API not supported (requires Chrome / Edge 94+).');
        }
        if (!dirHandle) {
            throw new Error('start() requires a FileSystemDirectoryHandle (dirHandle option).');
        }

        this.#state = 'initializing';
        this.#rawFrameCount = 0;
        this.#encodedFrameCount = 0;
        this.#subtitles = [];
        this.#dirHandle = dirHandle;
        this.#baseName = baseName;
        this.#metadata = metadata;

        // Create (or truncate) <base>.webm inside the caller-chosen directory and open
        // it for streaming writes — the picker itself is hoisted to the caller so a
        // single directory can hold several recordings (e.g. photo + data).
        const fileHandle = await dirHandle.getFileHandle(`${baseName}.webm`, { create: true });
        this.#fileStream = await fileHandle.createWritable();

        // The muxer writes encoded chunks straight to the file stream as they arrive,
        // so there is no in-memory frame buffer regardless of recording duration.
        this.#muxer = new WebMMuxer.Muxer({
            target: new WebMMuxer.FileSystemWritableFileStreamTarget(this.#fileStream),
            video: {
                codec: 'V_VP9',
                width: canvas.width,
                height: canvas.height,
                frameRate: this.#fps,
            },
        });

        this.#videoEncoder = new VideoEncoder({
            output: (chunk, meta) => this.#muxer.addVideoChunk(chunk, meta),
            error: (e) => {
                console.error('[SimulationRecorder] encoder error:', e);
                // Mark the recorder as broken so addFrame() stops submitting work
                // to a closed encoder, which would throw InvalidStateError.
                this.#state = 'idle';
            },
        });

        this.#videoEncoder.configure({
            codec: 'vp09.00.10.08',
            width: canvas.width,
            height: canvas.height,
            framerate: this.#fps,
        });

        // Awaiting flush() right after configure() confirms that the encoder actually
        // initialised successfully. If configure() failed asynchronously the flush
        // promise rejects, letting us propagate the error to the caller cleanly
        // instead of leaving the recorder stuck in 'recording' with a dead encoder.
        try {
            await this.#videoEncoder.flush();
        } catch (e) {
            await this.#fileStream.close();
            this.#fileStream = null;
            this.#muxer = null;
            this.#videoEncoder = null;
            this.#state = 'idle';
            throw new Error(`[Recording] VideoEncoder failed to initialise: ${e.message}`);
        }

        this.#state = 'recording';
    }

    /**
     * Captures the current canvas contents as one video frame and feeds it to the encoder.
     * Intended to be called on every simulation render tick; silently no-ops when not recording.
     *
     * Frame skipping: only 1 in every `skipFrames` raw calls produces an encoded frame.
     * This lets the render loop call addFrame() unconditionally without needing to track
     * frame counts externally.
     *
     * Timestamps: derived from the encoded frame index (not wall-clock time) so the output
     * plays back at exactly `fps`, independent of simulation speed or dropped frames.
     *
     * Keyframes: a forced keyframe is inserted every `keyframeInterval` seconds of encoded
     * video so that the file is seekable throughout.
     *
     * Memory safety: each VideoFrame is closed in a finally block, guaranteeing that GPU
     * memory is released even if videoEncoder.encode() throws.
     *
     * Periodic flush: the encoder queue is flushed once per keyframe interval to push
     * data to disk incrementally and bound the encoder's internal queue size.
     *
     * Subtitles: each encoded frame records { videoUs, simTime } for the SRT file written
     * by stop(). The subtitle for a given frame spans from its video timestamp to the next
     * frame's timestamp, showing the simulation time at the start of that interval.
     *
     * @param {HTMLCanvasElement} canvas    The canvas to capture.
     * @param {number}            [simTime=0]  Current simulation time in seconds. Recorded
     *                                         as a subtitle entry for the companion .srt file.
     */
    addFrame(canvas, simTime = 0) {
        if (this.#state !== 'recording') return;

        const raw = this.#rawFrameCount++;
        if (raw % this.#skipFrames !== 0) return;

        const idx = this.#encodedFrameCount++;
        const timestamp = idx * this.#usPerFrame;
        const keyframeEveryN = this.#fps * this.#keyframeInterval;
        const keyFrame = (idx % keyframeEveryN) === 0;

        this.#subtitles.push({ videoUs: timestamp, simTime });

        const frame = new VideoFrame(canvas, { timestamp });
        try {
            this.#videoEncoder.encode(frame, { keyFrame });
        } finally {
            // Close unconditionally — VideoFrame holds a reference to GPU texture memory.
            frame.close();
        }

        // Flush once per keyframe interval (skip idx===0 to avoid a redundant flush at start).
        if (keyFrame && idx > 0) {
            this.#videoEncoder.flush();
        }

        if (idx > 0 && idx % 100 === 0) {
            console.log(`[Recording] ${idx} frames encoded.`);
        }
    }

    /**
     * Finalises the recording and writes the completed file to disk.
     *
     * Sequence:
     *   1. Flush remaining frames from the encoder queue.
     *   2. Finalise the WebM container (writes duration and seek index headers).
     *   3. Close the file stream (commits bytes to the file system).
     *   4. Build and trigger a browser download of the companion .srt subtitle file.
     *   5. Null out all resources and return to 'idle'.
     *
     * After this resolves, start() can be called again for a new recording session.
     * Throws if called while not in 'recording' state.
     *
     * @returns {Promise<void>}  Resolves once the video file is written and the
     *                           subtitle download has been triggered.
     */
    async stop() {
        if (this.#state !== 'recording') {
            throw new Error(`Cannot stop: recorder is currently '${this.#state}'.`);
        }

        this.#state = 'stopping';

        // Snapshot the encoder queue depth at the moment stop() is called.
        // encodeQueueSize = frames submitted but not yet output as encoded chunks.
        // If the periodic flushes kept up, this may already be 0.
        const pendingAtStop = this.#videoEncoder.encodeQueueSize;

        if (pendingAtStop > 0 && this.#onSavingProgress) {
            // 'dequeue' fires each time the encoder finishes one or more queued frames.
            const onDequeue = () => {
                const remaining = this.#videoEncoder.encodeQueueSize;
                const progress  = 1 - remaining / pendingAtStop;
                this.#onSavingProgress({ phase: 'encoding', progress, framesLeft: remaining });
            };
            this.#videoEncoder.addEventListener('dequeue', onDequeue);
            await this.#videoEncoder.flush();
            this.#videoEncoder.removeEventListener('dequeue', onDequeue);
        } else {
            await this.#videoEncoder.flush();
        }

        // fileStream.close() has no progress signal — notify caller that we've moved
        // on to the write phase so the UI can show a distinct state.
        this.#onSavingProgress?.({ phase: 'writing', progress: 1, framesLeft: 0 });

        this.#muxer.finalize();
        await this.#fileStream.close();

        // Write the companion .srt (and optional .json) into the same directory.
        await this.#writeSidecars();

        // Null all resources so the instance is clean for the next session.
        this.#videoEncoder = null;
        this.#muxer = null;
        this.#fileStream = null;
        this.#subtitles = [];
        this.#dirHandle = null;
        this.#metadata = null;

        this.#state = 'idle';
    }

    /**
     * Converts a video timestamp in microseconds to the SRT time format HH:MM:SS,mmm.
     *
     * @param  {number} us  Timestamp in microseconds.
     * @returns {string}
     */
    #usToSrtTime(us) {
        const ms   = Math.floor(us / 1000);
        const h    = Math.floor(ms / 3_600_000);
        const m    = Math.floor((ms % 3_600_000) / 60_000);
        const s    = Math.floor((ms % 60_000) / 1_000);
        const msec = ms % 1_000;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(msec).padStart(3,'0')}`;
    }

    /**
     * Writes the companion sidecar files into the session directory:
     *   - <base>.srt  : one subtitle per encoded frame, mapping video time → sim time.
     *                   Entry N spans frame N's video timestamp to frame N+1's; the last
     *                   frame uses one frame-duration as its display window.
     *   - <base>.json : present only when a `metadata` object was passed to start()
     *                   (e.g. the data video's eta → red scale/offset for decoding).
     */
    async #writeSidecars() {
        if (this.#subtitles.length > 0) {
            let srt = '';
            for (let i = 0; i < this.#subtitles.length; i++) {
                const startUs = this.#subtitles[i].videoUs;
                const endUs   = i + 1 < this.#subtitles.length
                    ? this.#subtitles[i + 1].videoUs
                    : startUs + this.#usPerFrame;
                const simTime = this.#subtitles[i].simTime;

                srt += `${i + 1}\n`;
                srt += `${this.#usToSrtTime(startUs)} --> ${this.#usToSrtTime(endUs)}\n`;
                srt += `Sim time: ${simTime.toFixed(2)} s\n\n`;
            }
            await this.#writeTextFile(`${this.#baseName}.srt`, srt);
            console.log(`[Recording] Subtitle file saved: ${this.#baseName}.srt`);
        }

        if (this.#metadata) {
            // frameCount is only known now (at stop). Spreading first keeps the caller's
            // key order — if they included a frameCount placeholder, its position is kept
            // and only its value is overwritten with the true encoded-frame total.
            const meta = { ...this.#metadata, frameCount: this.#encodedFrameCount };
            await this.#writeTextFile(`${this.#baseName}.json`, JSON.stringify(meta, null, 2));
            console.log(`[Recording] Metadata file saved: ${this.#baseName}.json (${this.#encodedFrameCount} frames)`);
        }
    }

    /** Creates/overwrites a text file in the session directory and writes `contents`. */
    async #writeTextFile(name, contents) {
        const handle = await this.#dirHandle.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(contents);
        await stream.close();
    }
}
