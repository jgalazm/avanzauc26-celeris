import { calc_constants } from './constants_load_calc.js';

console.log('[LAG] LagrangianParticles.js loaded');
console.warn('[LAG] LagrangianParticles.js loaded');

const MAX_TRAIL_POINTS = 4000;
const TRAIL_FADE_SEGMENTS = 16;

const TRAIL_PALETTE = [
    [54, 75, 154],
    [74, 123, 183],
    [110, 166, 205],
    [152, 202, 225],
    [194, 228, 239],
    [254, 218, 139],
    [253, 179, 102],
    [246, 126, 75],
    [221, 61, 45],
    [165, 0, 38],
];

function lerpChannel(a, b, t) {
    return Math.round(a + (b - a) * t);
}

export function trailColorForIndex(index, count) {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const x = t * (TRAIL_PALETTE.length - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, TRAIL_PALETTE.length - 1);
    const f = x - i0;
    const c0 = TRAIL_PALETTE[i0];
    const c1 = TRAIL_PALETTE[i1];
    return `rgb(${lerpChannel(c0[0], c1[0], f)}, ${lerpChannel(c0[1], c1[1], f)}, ${lerpChannel(c0[2], c1[2], f)})`;
}

function assignTrailColors(particles) {
    const n = particles.length;
    for (let i = 0; i < n; i++) {
        particles[i].trailColor = trailColorForIndex(i, n);
    }
}

function appendTrailPoint(particle, x, y) {
    if (!particle.trail) {
        particle.trail = [];
    }
    const last = particle.trail[particle.trail.length - 1];
    if (last && last.x === x && last.y === y) {
        return;
    }
    particle.trail.push({ x, y });
    if (particle.trail.length > MAX_TRAIL_POINTS) {
        particle.trail.splice(0, particle.trail.length - MAX_TRAIL_POINTS);
    }
}

let overlayEl = null;
let duckStyleInjected = false;
let readPending = false;

export function getLagrangianState() {
    if (!window.__lagrangian) {
        window.__lagrangian = {
            placing: 0,
            evolve: 0,
            particles: [],
            K: 0.001,
            needUpload: 0,
            lastTime: 0,
            frame: 0,
            clickPending: 0,
        };
    }
    return window.__lagrangian;
}

export function syncLagrangianToCalcConstants() {
    const L = getLagrangianState();
    calc_constants.lagrangianPlacing = L.placing;
    calc_constants.lagrangianEvolve = L.evolve;
    calc_constants.lagrangianParticles = L.particles;
    calc_constants.NumberOfParticles = L.particles.length;
    calc_constants.lagrangianK = L.K;
    calc_constants.lagrangianNeedUpload = L.needUpload;
    calc_constants.lagrangianLastTime = L.lastTime;
    calc_constants.lagrangianFrame = L.frame;
}

export function isPlacingLagrangian() {
    const L = getLagrangianState();
    return L.placing == 1;
}

function injectOverlayStyle() {
    if (duckStyleInjected) {
        return;
    }
    duckStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #lagrangian-overlay {
            position: fixed;
            pointer-events: none;
            overflow: hidden;
            z-index: 2147483646;
        }
        .lagrangian-duck {
            position: absolute;
            transform: translate(-50%, -50%);
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #e53935;
            border: 2px solid #ffffff;
            box-sizing: border-box;
            padding: 0;
            pointer-events: none;
            user-select: none;
        }
        .lagrangian-trails {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: visible;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

export function ensureParticleOverlay(canvas) {
    if (!canvas) {
        return null;
    }
    injectOverlayStyle();
    overlayEl = document.getElementById('lagrangian-overlay');
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.id = 'lagrangian-overlay';
        document.body.appendChild(overlayEl);
    }
    return overlayEl;
}

export function updateLagrangianStatus() {
    const status = document.getElementById('lagrangian-status');
    if (!status) {
        return;
    }
    const L = getLagrangianState();
    const n = L.particles.length;
    if (L.placing == 1) {
        status.textContent = `Status: placing initial condition (${n} particle${n == 1 ? '' : 's'}). Left-click the map in Design Mode.`;
    } else if (L.evolve == 1 && n > 0) {
        status.textContent = `Status: evolving ${n} particle${n == 1 ? '' : 's'} with K = ${L.K}`;
    } else if (n > 0) {
        status.textContent = `Status: ${n} particle${n == 1 ? '' : 's'} placed, waiting to finish initial condition.`;
    } else {
        status.textContent = 'Status: idle';
    }
}

export function isLagrangianPanelOpen() {
    const panel = document.getElementById('particles-container');
    if (!panel) {
        return false;
    }
    const content = panel.querySelector('.window-content');
    if (!content) {
        return false;
    }
    return window.getComputedStyle(content).display !== 'none';
}

export function startLagrangianPlacement(canvas) {
    const L = getLagrangianState();
    L.placing = 1;
    L.evolve = 0;
    syncLagrangianToCalcConstants();
    if (canvas) {
        canvas.style.cursor = 'crosshair';
    }
    const startBtn = document.getElementById('lagrangian-start-button');
    const finishBtn = document.getElementById('lagrangian-finish-button');
    if (startBtn) {
        startBtn.style.setProperty('background-color', '#4CAF50', 'important');
        startBtn.style.setProperty('color', 'white', 'important');
    }
    if (finishBtn) {
        finishBtn.style.removeProperty('background-color');
        finishBtn.style.removeProperty('color');
    }
    updateLagrangianStatus();
    console.log('[LAG] START. placing=1 evolve=0 n=', L.particles.length, 'startBtn=', !!startBtn);
    console.warn('[LAG] START. placing=1 evolve=0 n=', L.particles.length, 'startBtn=', !!startBtn);
}

export function finishLagrangianPlacement(canvas) {
    const L = getLagrangianState();
    L.placing = 0;
    L.needUpload = 1;
    if (L.particles.length > 0) {
        L.evolve = 1;
        L.lastTime = 0.0;
        for (let i = 0; i < L.particles.length; i++) {
            const p = L.particles[i];
            if (!p.trail || p.trail.length === 0) {
                p.trail = [{ x: p.x, y: p.y }];
            }
        }
        assignTrailColors(L.particles);
    } else {
        L.evolve = 0;
    }
    syncLagrangianToCalcConstants();
    if (canvas) {
        canvas.style.cursor = '';
    }
    const startBtn = document.getElementById('lagrangian-start-button');
    const finishBtn = document.getElementById('lagrangian-finish-button');
    if (startBtn) {
        startBtn.style.removeProperty('background-color');
        startBtn.style.removeProperty('color');
    }
    if (finishBtn) {
        finishBtn.style.setProperty('background-color', '#4CAF50', 'important');
        finishBtn.style.setProperty('color', 'white', 'important');
    }
    updateLagrangianStatus();
    console.log('[LAG] FINISH. placing=0 evolve=', L.evolve, 'n=', L.particles.length, 'finishBtn=', !!finishBtn);
    console.warn('[LAG] FINISH. placing=0 evolve=', L.evolve, 'n=', L.particles.length, 'finishBtn=', !!finishBtn);
}

export function addParticleAtMeters(x, y) {
    const L = getLagrangianState();
    if (L.particles.length >= (calc_constants.maxNumberOfParticles || 256)) {
        console.log('Maximum number of Lagrangian particles reached.');
        return false;
    }
    L.particles.push({ x, y, trail: [] });
    L.needUpload = 1;
    L.placing = 1;
    L.clickPending = 0;
    syncLagrangianToCalcConstants();
    updateLagrangianStatus();
    console.warn(`[LAG] Particle ${L.particles.length} placed at x=${x.toFixed(2)} m, y=${y.toFixed(2)} m`);
    return true;
}

export function addParticleFromGridClick(xClick, yClick) {
    return addParticleAtMeters(xClick * calc_constants.dx, yClick * calc_constants.dy);
}

export function copyParticleLocsToTexture(device, txParticles) {
    const n = calc_constants.maxNumberOfParticles | 0;
    const bytesPerPixel = 16;
    const actualBytesPerRow = n * bytesPerPixel;
    const bytesPerRow = ((actualBytesPerRow + 255) & ~255) >>> 0;
    const rowFloats = bytesPerRow >>> 2;
    const data = new Float32Array(rowFloats);
    const particles = getLagrangianState().particles;

    for (let i = 0; i < particles.length && i < n; i++) {
        const o = i << 2;
        data[o] = particles[i].x;
        data[o + 1] = particles[i].y;
        data[o + 2] = 1.0;
        data[o + 3] = i;
    }

    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToTexture(
        { buffer, bytesPerRow, rowsPerImage: 1 },
        { texture: txParticles },
        { width: n, height: 1, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    buffer.destroy();
    getLagrangianState().needUpload = 0;
    calc_constants.lagrangianNeedUpload = 0;
}

export function runCopyParticles(device, src_texture, dst_texture, width, originX = 0) {
    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
        { texture: src_texture },
        { texture: dst_texture, origin: { x: originX, y: 0, z: 0 } },
        { width: width, height: 1, depthOrArrayLayers: 1 }
    );
    device.queue.submit([commandEncoder.finish()]);
}

export async function readParticlePositions(device, texture, canvas) {
    const n = getLagrangianState().particles.length | 0;
    if (n <= 0 || readPending) {
        return;
    }
    readPending = true;

    const bytesPerPixel = 16;
    const copyWidth = Math.max(16, Math.ceil(n / 16) * 16);
    const bytesPerRow = Math.max(256, copyWidth * bytesPerPixel);

    const buffer = device.createBuffer({
        size: bytesPerRow,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        mappedAtCreation: false,
    });

    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyTextureToBuffer(
        { texture: texture },
        { buffer: buffer, bytesPerRow: bytesPerRow, rowsPerImage: 1 },
        { width: copyWidth, height: 1, depthOrArrayLayers: 1 }
    );
    device.queue.submit([copyEncoder.finish()]);

    try {
        await buffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = buffer.getMappedRange();
        const bufferCopy = new Float32Array(arrayBuffer.slice(0, bytesPerPixel * n));
        const L = getLagrangianState();
        for (let i = 0; i < n; i++) {
            const base = i * 4;
            if (!L.particles[i]) {
                L.particles[i] = { x: 0, y: 0, trail: [] };
            }
            L.particles[i].x = bufferCopy[base];
            L.particles[i].y = bufferCopy[base + 1];
            if (L.evolve == 1) {
                appendTrailPoint(L.particles[i], L.particles[i].x, L.particles[i].y);
            }
        }
        syncLagrangianToCalcConstants();
        buffer.unmap();
        updateDuckOverlay(canvas);
    } catch (err) {
        console.error('Failed to read Lagrangian particle positions', err);
    } finally {
        buffer.destroy();
        readPending = false;
    }
}

export function updateDuckOverlay(canvas) {
    if (!canvas) {
        return;
    }
    const overlay = ensureParticleOverlay(canvas);
    if (!overlay) {
        return;
    }

    overlay.style.position = 'fixed';
    overlay.style.zIndex = '2147483646';
    overlay.style.pointerEvents = 'none';
    overlay.style.overflow = 'hidden';
    const rect = canvas.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    if (calc_constants.viewType != 1) {
        overlay.innerHTML = '';
        overlay.style.display = 'none';
        return;
    }

    overlay.style.display = 'block';
    const domainX = Math.max(calc_constants.WIDTH * calc_constants.dx, 1.0e-6);
    const domainY = Math.max(calc_constants.HEIGHT * calc_constants.dy, 1.0e-6);
    const L = getLagrangianState();
    const particles = L.particles;
    const n = particles.length;

    let svg = overlay.querySelector('svg.lagrangian-trails');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'lagrangian-trails');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        overlay.insertBefore(svg, overlay.firstChild);
    }

    let duckCount = overlay.querySelectorAll(':scope > .lagrangian-duck').length;
    while (duckCount < n) {
        const duck = document.createElement('span');
        duck.className = 'lagrangian-duck';
        overlay.appendChild(duck);
        duckCount += 1;
    }
    while (overlay.querySelectorAll(':scope > .lagrangian-duck').length > n) {
        const extra = overlay.querySelector(':scope > .lagrangian-duck:last-of-type');
        if (!extra) {
            break;
        }
        overlay.removeChild(extra);
    }

    const ducks = overlay.querySelectorAll(':scope > .lagrangian-duck');
    for (let i = 0; i < n; i++) {
        const p = particles[i];
        const duck = ducks[i];
        if (!p || !duck) {
            continue;
        }
        duck.textContent = '';
        duck.title = `Particle ${i + 1}`;
        const leftPct = (p.x / domainX) * 100.0;
        const topPct = (1.0 - p.y / domainY) * 100.0;
        duck.style.left = `${leftPct}%`;
        duck.style.top = `${topPct}%`;
    }

    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }

    if (L.evolve == 1) {
        for (let i = 0; i < n; i++) {
            const p = particles[i];
            if (!p || !p.trail || p.trail.length < 2) {
                continue;
            }
            const color = p.trailColor || trailColorForIndex(i, n);
            appendFadedTrail(svg, p.trail, color, domainX, domainY);
        }
    }
}

function trailPointsAttr(trail, i0, i1, domainX, domainY) {
    let pts = '';
    for (let k = i0; k <= i1; k++) {
        const tx = (trail[k].x / domainX) * 100.0;
        const ty = (1.0 - trail[k].y / domainY) * 100.0;
        pts += `${tx},${ty} `;
    }
    return pts.trim();
}

function makeTrailPolyline(svg, points, color, width, opacity) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', String(width));
    line.setAttribute('stroke-opacity', String(opacity));
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('points', points);
    svg.appendChild(line);
}

function appendFadedTrail(svg, trail, color, domainX, domainY) {
    const last = trail.length - 1;
    const full = trailPointsAttr(trail, 0, last, domainX, domainY);
    makeTrailPolyline(svg, full, color, 12, 0.12);

    const usable = Math.max(1, last);
    for (let s = 0; s < TRAIL_FADE_SEGMENTS; s++) {
        const i0 = Math.floor((s / TRAIL_FADE_SEGMENTS) * usable);
        let i1 = Math.floor(((s + 1) / TRAIL_FADE_SEGMENTS) * usable);
        if (i1 <= i0) {
            i1 = Math.min(i0 + 1, last);
        }
        const opacity = 0.10 + 0.52 * Math.pow((s + 1) / TRAIL_FADE_SEGMENTS, 1.35);
        const width = 7 + 1.5 * ((s + 1) / TRAIL_FADE_SEGMENTS);
        makeTrailPolyline(svg, trailPointsAttr(trail, i0, i1, domainX, domainY), color, width, opacity);
    }
}

export function clearLagrangianParticles() {
    const L = getLagrangianState();
    L.particles.length = 0;
    L.placing = 0;
    L.evolve = 0;
    L.needUpload = 1;
    syncLagrangianToCalcConstants();
    const startBtn = document.getElementById('lagrangian-start-button');
    const finishBtn = document.getElementById('lagrangian-finish-button');
    if (startBtn) {
        startBtn.style.backgroundColor = '';
        startBtn.style.color = '';
    }
    if (finishBtn) {
        finishBtn.style.backgroundColor = '';
        finishBtn.style.color = '';
    }
    updateLagrangianStatus();
    console.warn('[LAG] CLEAR. n=0 placing=0 evolve=0');
}
