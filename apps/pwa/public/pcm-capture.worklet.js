class UaccPcm16Capture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input?.length) {
      const samples = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const value = Math.max(-1, Math.min(1, input[i] ?? 0));
        samples[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      }
      this.port.postMessage(samples.buffer, [samples.buffer]);
    }
    for (const channel of outputs[0] ?? []) channel.fill(0);
    return true;
  }
}

registerProcessor("uacc-pcm16-capture", UaccPcm16Capture);
