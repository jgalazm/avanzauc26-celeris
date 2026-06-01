// Handler_DataRender.js
//
// Minimal render pass for the "data" WebM export: samples the free-surface elevation
// from txRenderVarsf16 (layer 0, .r) and writes it, scaled to [0,1], into the red
// channel of an offscreen, grid-resolution canvas. Pairs with shaders/vertex.wgsl
// (full-screen quad via @builtin(vertex_index)) and shaders/fragment_data.wgsl.
//
// Deliberately self-contained — its own tiny bind group (one uniform + the f16 render
// texture + a nearest sampler) rather than the 19-binding photorealistic render layout,
// so it can run independently and in parallel with the main render each frame.

export function createDataRenderBindGroupLayout(device) {
    return device.createBindGroupLayout({
        entries: [
            {
                // 0: uniform { offset, scale } — the eta → [0,1] linear mapping.
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
            {
                // 1: the f16 render-variables texture (free surface in layer 0, .r).
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float', format: 'rgba16float', viewDimension: '2d-array' },
            },
            {
                // 2: nearest sampler — one video pixel per grid cell, no interpolation.
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'non-filtering' },
            },
        ],
    });
}

export function createDataRenderPipeline(device, vertexShaderCode, fragmentShaderCode, format, bindGroupLayout) {
    return device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module: device.createShaderModule({ code: vertexShaderCode }),
            entryPoint: 'vs_main',
            // vertex.wgsl generates the quad from vertex_index — no vertex buffers needed.
        },
        fragment: {
            module: device.createShaderModule({ code: fragmentShaderCode }),
            entryPoint: 'fs_main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        // No depth attachment — this is a flat 2D blit.
    });
}

export function createDataRenderBindGroup(device, bindGroupLayout, uniformBuffer, txRenderVarsf16, sampler) {
    return device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: txRenderVarsf16.createView() },
            { binding: 2, resource: sampler },
        ],
    });
}
