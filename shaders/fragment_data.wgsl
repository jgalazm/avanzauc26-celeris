// fragment_data.wgsl
//
// Data-export fragment shader. Instead of the photorealistic view, this encodes the
// raw free-surface elevation (eta) into the red channel, linearly scaled to [0,1]:
//
//     red01 = clamp((eta - offset) / scale, 0, 1)
//
// The inverse mapping (eta = red01 * scale + offset) is written to the companion
// .json sidecar by the recorder so the video can be decoded back to physical units.
//
// Source: txRenderVarsf16 layer 0, .r channel — the same value fragment.wgsl samples
// as `waves`. Rendered into an offscreen canvas sized to the simulation grid so each
// video pixel maps to one grid cell (nearest sampling, no interpolation).

struct DataParams {
    offset: f32,   // eta value that maps to red = 0   (= colorVal_min)
    scale:  f32,   // eta span that maps to red = 1    (= colorVal_max - colorVal_min)
    _pad0:  f32,
    _pad1:  f32,
};

@group(0) @binding(0) var<uniform> params: DataParams;
@group(0) @binding(1) var txRenderVarsf16: texture_2d_array<f32>;
@group(0) @binding(2) var samp: sampler;

struct FragmentOutput {
    @location(0) color: vec4<f32>,
};

@fragment
fn fs_main(@location(1) uv: vec2<f32>) -> FragmentOutput {
    var out: FragmentOutput;

    let eta = textureSampleLevel(txRenderVarsf16, samp, uv, 0, 0.0).r;  // free surface elevation
    let red = clamp((eta - params.offset) / params.scale, 0.0, 1.0);

    out.color = vec4<f32>(red, 0.0, 0.0, 1.0);
    return out;
}
