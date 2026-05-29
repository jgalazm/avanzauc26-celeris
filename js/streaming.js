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
 * Browser requirements: Chrome / Edge 94+ (VideoEncoder, showSaveFilePicker).
 *
 * Dependencies:
 *   webm-muxer  — expected at js/webm-muxer.js (local copy, see import below).
 *
 * Example (main.js):
 *   import { SimulationRecorder } from './streaming.js';
 *   const recorder = new SimulationRecorder({ fps: 30, skipFrames: 1 });
 *
 *   startBtn.addEventListener('click', async () => {
 *       try { await recorder.start(canvas); }
 *       catch (e) { if (e.name !== 'AbortError') console.error(e); }
 *   });
 *   stopBtn.addEventListener('click', () => recorder.stop());
 *
 *   // inside the render loop:
 *   recorder.addFrame(canvas);
 */

import * as WebMMuxer from './webm-muxer.js';

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
     * Opens the browser's native Save-As dialog, initialises the muxer and video encoder,
     * and transitions to 'recording' so that addFrame() calls start being encoded.
     *
     * Error handling:
     *   - Throws DOMException { name: 'AbortError' } if the user cancels the dialog.
     *     Callers should catch this and treat it as a silent no-op, not an error.
     *   - Throws Error with a readable message if VideoEncoder or showSaveFilePicker are
     *     not available in the current browser.
     *   - Throws if called while not in 'idle' state (prevents double-start).
     *
     * @param  {HTMLCanvasElement} canvas  The canvas whose frames will be recorded.
     *                                     Width and height are read once here and fixed
     *                                     for the duration of the recording.
     * @returns {Promise<void>}            Resolves when the encoder is configured and
     *                                     the recorder is ready to accept frames.
     */
    async start(canvas) {
        if (this.#state !== 'idle') {
            throw new Error(`Cannot start: recorder is currently '${this.#state}'.`);
        }
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('VideoEncoder API not supported (requires Chrome / Edge 94+).');
        }
        if (typeof showSaveFilePicker === 'undefined') {
            throw new Error('File System Access API not supported (requires Chrome / Edge 86+).');
        }

        this.#state = 'initializing';
        this.#rawFrameCount = 0;
        this.#encodedFrameCount = 0;

        // Throws AbortError if the user dismisses the dialog — propagate to caller.
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: 'celeris-recording.webm',
            types: [{ description: 'WebM Video', accept: { 'video/webm': ['.webm'] } }],
        });
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
            error: (e) => console.error('[SimulationRecorder] encoder error:', e),
        });

        this.#videoEncoder.configure({
            codec: 'vp09.00.10.08',
            width: canvas.width,
            height: canvas.height,
            framerate: this.#fps,
        });

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
     * @param {HTMLCanvasElement} canvas  The canvas to capture. Should be the same element
     *                                    passed to start().
     */
    addFrame(canvas) {
        if (this.#state !== 'recording') return;

        const raw = this.#rawFrameCount++;
        if (raw % this.#skipFrames !== 0) return;

        const idx = this.#encodedFrameCount++;
        const timestamp = idx * this.#usPerFrame;
        const keyframeEveryN = this.#fps * this.#keyframeInterval;
        const keyFrame = (idx % keyframeEveryN) === 0;

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
    }

    /**
     * Finalises the recording and writes the completed file to disk.
     *
     * Sequence:
     *   1. Flush remaining frames from the encoder queue.
     *   2. Finalise the WebM container (writes duration and seek index headers).
     *   3. Close the file stream (commits bytes to the file system).
     *   4. Null out all resources and return to 'idle'.
     *
     * After this resolves, start() can be called again for a new recording session.
     * Throws if called while not in 'recording' state.
     *
     * @returns {Promise<void>}  Resolves once the file is fully written and closed.
     */
    async stop() {
        if (this.#state !== 'recording') {
            throw new Error(`Cannot stop: recorder is currently '${this.#state}'.`);
        }

        this.#state = 'stopping';

        await this.#videoEncoder.flush();
        this.#muxer.finalize();
        await this.#fileStream.close();

        // Null all resources so the instance is clean for the next session.
        this.#videoEncoder = null;
        this.#muxer = null;
        this.#fileStream = null;

        this.#state = 'idle';
    }
}
