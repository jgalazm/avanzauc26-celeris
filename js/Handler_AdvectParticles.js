export function create_AdvectParticles_BindGroupLayout(device) {
    return device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    format: 'rgba32float'
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    format: 'rgba32float'
                }
            },
            {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: 'rgba32float',
                    viewDimension: '2d'
                }
            }
        ]
    });
}

export function create_AdvectParticles_BindGroup(device, uniformBuffer, txParticles, txModelVelocities, txtemp_Particles) {
    return device.createBindGroup({
        layout: create_AdvectParticles_BindGroupLayout(device),
        entries: [
            {
                binding: 0,
                resource: { buffer: uniformBuffer }
            },
            {
                binding: 1,
                resource: txParticles.createView()
            },
            {
                binding: 2,
                resource: txModelVelocities.createView()
            },
            {
                binding: 3,
                resource: txtemp_Particles.createView()
            }
        ]
    });
}
