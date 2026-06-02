// fragment_data.wgsl
//
// Data-export fragment shader. Instead of the photorealistic view, this encodes raw
// simulation fields into the output channels, each linearly scaled to [0,1]:
//
//     red   = clamp((eta  - etaOffset)  / etaScale,  0, 1)   // free-surface elevation
//     green = clamp((foam - foamOffset) / foamScale, 0, 1)   // foam / whitewater intensity
//
// The inverse mappings (e.g. eta = red01 * etaScale + etaOffset) are written to the
// companion .json sidecar by the recorder so the video can be decoded to physical units.
//
// Source: txRenderVarsf16 layer 0 — .r is eta and .a is foam (see Copytxf32_txf16.wgsl,
// where layer 0 = vec4(eta, max_eta, bottom, foam)). The foam value is the Kennedy et al.
// breaking intensity B, which lives in [0,1].
//
// Rendered into an offscreen canvas sized to the simulation grid (nearest sampling, one
// video pixel per grid cell).

struct DataParams {
    etaOffset:  f32,   // eta value that maps to red = 0    (= colorVal_min)
    etaScale:   f32,   // eta span that maps to red = 1     (= colorVal_max - colorVal_min)
    foamOffset: f32,   // foam value that maps to green = 0 (default 0)
    foamScale:  f32,   // foam span that maps to green = 1  (default 1)
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

    let texel = textureSampleLevel(txRenderVarsf16, samp, uv, 0, 0.0);  // layer 0
    let eta  = texel.r;  // free surface elevation
    let foam = texel.a;  // foam / whitewater intensity (Kennedy B)

    let red   = clamp((eta  - params.etaOffset)  / params.etaScale,  0.0, 1.0);
    let green = clamp((foam - params.foamOffset) / params.foamScale, 0.0, 1.0);

    out.color = vec4<f32>(red, green, 0.0, 1.0);
    return out;
}
