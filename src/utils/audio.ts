export function mergeAudioSamples(chunks: Float32Array[]): Float32Array {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

export function resampleAudio(
    samples: Float32Array,
    fromRate: number,
    toRate: number,
): Float32Array {
    if (fromRate === toRate || samples.length === 0) return samples;
    const nextLength = Math.max(
        1,
        Math.round((samples.length * toRate) / fromRate),
    );
    const result = new Float32Array(nextLength);
    const ratio = (samples.length - 1) / Math.max(1, nextLength - 1);
    for (let i = 0; i < nextLength; i += 1) {
        const position = i * ratio;
        const left = Math.floor(position);
        const right = Math.min(samples.length - 1, left + 1);
        const weight = position - left;
        result[i] = samples[left] * (1 - weight) + samples[right] * weight;
    }
    return result;
}

export function writeAscii(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
    const supportedRates = new Set([8000, 16000, 22050, 24000, 44100, 48000]);
    const targetRate = supportedRates.has(Math.round(sampleRate))
        ? Math.round(sampleRate)
        : 48000;
    const samples = resampleAudio(
        mergeAudioSamples(chunks),
        Math.round(sampleRate),
        targetRate,
    );
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (const sample of samples) {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(
            offset,
            clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
            true,
        );
        offset += bytesPerSample;
    }
    return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize),
        );
    }
    return btoa(binary);
}
