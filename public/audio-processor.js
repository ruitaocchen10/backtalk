class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._chunkSize = Math.floor(sampleRate * 0.25);
    this._downsampleRatio = Math.round(sampleRate / 16000);
  }

  process(inputs, outputs, parameters) {
    // inputs[0] = first input node, [0] = first channel (mono)
    const input = inputs[0]?.[0];
    if (!input) return true;

    // Append new samples to our accumulation buffer
    const newBuffer = new Float32Array(this._buffer.length + input.length);
    newBuffer.set(this._buffer);
    newBuffer.set(input, this._buffer.length);
    this._buffer = newBuffer;

    // Once we have 250ms worth of audio, process and send it
    if (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.slice(0, this._chunkSize);
      this._buffer = this._buffer.slice(this._chunkSize);

      // Downsample: pick every Nth sample (decimation)
      const downsampledLength = Math.floor(
        chunk.length / this._downsampleRatio,
      );
      const pcm16 = new Int16Array(downsampledLength);

      for (let i = 0; i < downsampledLength; i++) {
        // Grab every Nth sample from the source
        const sample = chunk[i * this._downsampleRatio];
        // Clamp to [-1, 1] then scale to Int16 range
        const clamped = Math.max(-1, Math.min(1, sample));
        pcm16[i] = clamped * 0x7fff; // 0x7FFF = 32767
      }

      // Send the PCM bytes to the main thread
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true; // keeps the processor alive
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
