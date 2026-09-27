export const WAVE_BARS = 42;

export function levelFromTimeDomain(bins: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < bins.length; i++) {
    const v = (bins[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, bins.length)) * 3.4);
}

export function packWave(samples: number[], bars = WAVE_BARS) {
  if (samples.length === 0) return [];
  const out: number[] = [];
  const size = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * size);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * size)));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, samples[j] || 0);
    out.push(Math.max(0.08, Math.min(1, peak)));
  }
  return out;
}

export function peaksFromBuffer(buffer: AudioBuffer, bars = WAVE_BARS) {
  const channel = buffer.getChannelData(0);
  if (channel.length === 0) return [];
  const out: number[] = [];
  const size = channel.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * size);
    const end = i === bars - 1 ? channel.length : Math.max(start + 1, Math.floor((i + 1) * size));
    let sum = 0;
    for (let j = start; j < end; j++) sum += channel[j] * channel[j];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    out.push(Math.max(0.08, Math.min(1, rms * 3.4)));
  }
  return out;
}

export function finiteVoiceMs(ms: number | null | undefined, audioSeconds?: number) {
  if (ms && Number.isFinite(ms) && ms > 0 && ms < 11 * 60 * 1000) return ms;
  if (audioSeconds && Number.isFinite(audioSeconds) && audioSeconds > 0 && audioSeconds < 11 * 60) return audioSeconds * 1000;
  return 0;
}
