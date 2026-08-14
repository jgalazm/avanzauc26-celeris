import { calc_constants } from './constants_load_calc.js';

console.log('[LAG] LagrangianParticles.js loaded');
console.warn('[LAG] LagrangianParticles.js loaded');

function rubberDuckSvg(body, shade, beak = '#FF9800') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <ellipse cx="26" cy="42" rx="23" ry="16" fill="${body}"/>
        <path d="M6 41c-3-3 1-9 6-8 2 3 1 8-2 10z" fill="${shade}"/>
        <ellipse cx="24" cy="45" rx="10" ry="6" fill="${shade}"/>
        <circle cx="44" cy="24" r="14" fill="${body}"/>
        <ellipse cx="57" cy="27" rx="8" ry="4.5" fill="${beak}"/>
        <ellipse cx="60" cy="27" rx="2.4" ry="1.7" fill="#E65100"/>
        <circle cx="47.5" cy="20.5" r="2.6" fill="#1A1A1A"/>
        <circle cx="48.3" cy="19.7" r="0.85" fill="#FFFFFF"/>
    </svg>`;
}

function svgDataUri(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const BUOY_KINDS = [
    { code: '1f986', emoji: '🦆', name: 'Pato Rockford' },
    { src: svgDataUri(rubberDuckSvg('#FFD54F', '#F4C430')), emoji: '🟡', name: 'Pato de hule amarillo' },
    { code: '1f6df', emoji: '🛟', name: 'Flotador' },
    { code: '1f3d0', emoji: '🏐', name: 'Pelota de playa' },
    { code: '26bd', emoji: '⚽', name: 'Pelota de fútbol' },
    { code: '1f3c4', emoji: '🏄', name: 'Surfista' },
];

function buoyImageSrc(kind) {
    if (kind.src) {
        return kind.src;
    }
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${kind.code}.png`;
}

export function buoyKindForIndex(index) {
    return BUOY_KINDS[((index % BUOY_KINDS.length) + BUOY_KINDS.length) % BUOY_KINDS.length];
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
            K: 0.1,
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
            line-height: 0;
            user-select: none;
            background: transparent;
            padding: 0;
            border: none;
            box-shadow: none;
        }
        .lagrangian-duck img {
            display: block;
            width: 36px;
            height: 36px;
            background: transparent;
            border: none;
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
        status.textContent = `Status: placing initial condition (${n} duck${n == 1 ? '' : 's'}). Left-click the map in Design Mode.`;
    } else if (L.evolve == 1 && n > 0) {
        status.textContent = `Status: evolving ${n} buoy${n == 1 ? '' : 's'} with K = ${L.K}`;
    } else if (n > 0) {
        status.textContent = `Status: ${n} buoy${n == 1 ? '' : 's'} placed, waiting to finish initial condition.`;
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
    L.particles.push({ x, y, kind: L.particles.length % BUOY_KINDS.length });
    L.needUpload = 1;
    L.placing = 1;
    L.clickPending = 0;
    syncLagrangianToCalcConstants();
    updateLagrangianStatus();
    console.warn(`[LAG] Duck ${L.particles.length} placed at x=${x.toFixed(2)} m, y=${y.toFixed(2)} m`);
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
                L.particles[i] = { x: 0, y: 0, kind: i % BUOY_KINDS.length };
            }
            L.particles[i].x = bufferCopy[base];
            L.particles[i].y = bufferCopy[base + 1];
            if (L.particles[i].kind == null) {
                L.particles[i].kind = i % BUOY_KINDS.length;
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

    while (overlay.childElementCount < n) {
        const duck = document.createElement('span');
        duck.className = 'lagrangian-duck';
        overlay.appendChild(duck);
    }
    while (overlay.childElementCount > n) {
        overlay.removeChild(overlay.lastChild);
    }

    for (let i = 0; i < n; i++) {
        const p = particles[i];
        const duck = overlay.children[i];
        if (!p || !duck) {
            continue;
        }
        const kind = buoyKindForIndex(p.kind == null ? i : p.kind);
        let img = duck.querySelector('img');
        if (!img) {
            duck.textContent = '';
            img = document.createElement('img');
            img.alt = '';
            img.draggable = false;
            duck.appendChild(img);
        }
        const src = buoyImageSrc(kind);
        if (img.getAttribute('src') !== src) {
            img.src = src;
        }
        img.alt = kind.name;
        img.style.filter = 'none';
        duck.title = kind.name;
        const leftPct = (p.x / domainX) * 100.0;
        const topPct = (1.0 - p.y / domainY) * 100.0;
        duck.style.left = `${leftPct}%`;
        duck.style.top = `${topPct}%`;
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
