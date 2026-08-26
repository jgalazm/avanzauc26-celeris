// Lagrangian analog of Eulerian tracer advection-diffusion:
//   dC/dt + u·∇C = K ∇²C
// becomes the Ito SDE
//   dX = u(X,t) dt + √(2K) dW
struct Globals {
    width: i32,
    height: i32,
    dx: f32,
    dy: f32,
    dt: f32,
    K: f32,
    nParticles: i32,
    evolve: i32,
    frame: u32,
    delta: f32,
    xmax: f32,
    ymax: f32
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var txParticles: texture_2d<f32>;
@group(0) @binding(2) var txModelVelocities: texture_2d<f32>;
@group(0) @binding(3) var txtemp_Particles: texture_storage_2d<rgba32float, write>;

fn pcg_hash(input: u32) -> u32 {
    var state = input * 747796405u + 2891336453u;
    var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand01(seed: u32) -> f32 {
    return f32(pcg_hash(seed)) * (1.0 / 4294967295.0);
}

fn gaussian2(seed: u32) -> vec2<f32> {
    let u1 = max(rand01(seed), 1.0e-6);
    let u2 = rand01(seed + 1u);
    let r = sqrt(-2.0 * log(u1));
    let theta = 6.28318530718 * u2;
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

fn clamp_index(i: i32, j: i32) -> vec2<i32> {
    let ii = clamp(i, 0, globals.width - 1);
    let jj = clamp(j, 0, globals.height - 1);
    return vec2<i32>(ii, jj);
}

fn sample_velocity(pos_m: vec2<f32>) -> vec4<f32> {
    let gx = pos_m.x / globals.dx;
    let gy = pos_m.y / globals.dy;
    let i0 = i32(floor(gx));
    let j0 = i32(floor(gy));
    let fx = gx - f32(i0);
    let fy = gy - f32(j0);

    let i00 = clamp_index(i0, j0);
    let i10 = clamp_index(i0 + 1, j0);
    let i01 = clamp_index(i0, j0 + 1);
    let i11 = clamp_index(i0 + 1, j0 + 1);

    let v00 = textureLoad(txModelVelocities, i00, 0);
    let v10 = textureLoad(txModelVelocities, i10, 0);
    let v01 = textureLoad(txModelVelocities, i01, 0);
    let v11 = textureLoad(txModelVelocities, i11, 0);

    return mix(mix(v00, v10, fx), mix(v01, v11, fx), fy);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = i32(id.x);
    if (i >= globals.nParticles) {
        return;
    }

    let idx = vec2<i32>(i, 0);
    var particle = textureLoad(txParticles, idx, 0);
    if (particle.b < 0.5) {
        textureStore(txtemp_Particles, idx, particle);
        return;
    }

    var pos = particle.xy;
    if (globals.evolve == 1 && globals.dt > 0.0) {
        let sample = sample_velocity(pos);
        var u = sample.r;
        var v = sample.g;
        let h = sample.a;

        // Beached / dry cells do not advect (buoy stays put).
        if (h <= globals.delta) {
            u = 0.0;
            v = 0.0;
        }

        var noise = vec2<f32>(0.0, 0.0);
        if (globals.K > 0.0 && h > globals.delta) {
            let amp = sqrt(2.0 * globals.K * globals.dt);
            let seed = globals.frame * 1973u + u32(i) * 9277u + 1u;
            noise = amp * gaussian2(seed);
        }

        pos = pos + vec2<f32>(u, v) * globals.dt + noise;
        pos.x = clamp(pos.x, 0.0, globals.xmax);
        pos.y = clamp(pos.y, 0.0, globals.ymax);
    }

    textureStore(txtemp_Particles, idx, vec4<f32>(pos.x, pos.y, 1.0, particle.a));
}
