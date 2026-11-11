// Runs PCM conversion away from the UI thread. Originals never enter this output.
self.onmessage = ({ data: { tracks, sampleRate, duration } }) => {
  try {
    const rate = 12000, count = Math.ceil(duration * rate);
    const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
    const peaks = Array(96).fill(0);
    for (let i = 0; i < count; i++) {
      const start = Math.min(tracks[0].length - 1, Math.floor(i * sampleRate / rate));
      const end = Math.min(tracks[0].length, Math.max(start + 1, Math.floor((i + 1) * sampleRate / rate)));
      let sample = 0;
      for (const track of tracks) for (let j = start; j < end; j++) sample += track[j];
      sample = Math.max(-1, Math.min(1, sample / (tracks.length * (end - start))));
      const bin = Math.min(95, Math.floor(i * 96 / count));
      peaks[bin] = Math.max(peaks[bin], Math.abs(sample));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    self.postMessage({ bytes, peaks }, [bytes]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
