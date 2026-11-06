// js/audio-engine.js
// Estúdio de Áudio no Canvas: Waveform, Player com Loop/Pitch, Gravador de Microfone e Marcadores de Tempo Conectáveis

export class AudioEngine {
  constructor(app) {
    this.app = app;
    this.audioCtx = null;
    this.activePlayers = new Map(); // nodeId -> { audioEl, rafId }

    // Estado do Gravador de Microfone
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.micStream = null;
    this.micStartTime = 0;
    this.micAnimId = null;

    this.initMicModalEvents();
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  async extractPeaksFromDataUrl(dataUrl, samples = 96) {
    try {
      const res = await fetch(dataUrl);
      const arrayBuffer = await res.arrayBuffer();
      const ctx = this.getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const rawData = audioBuffer.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(rawData.length / samples));
      const peaks = [];

      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          const val = Math.abs(rawData[start + j] || 0);
          if (val > sum) sum = val;
        }
        peaks.push(Math.min(1, Math.max(0.06, Number(sum.toFixed(3)))));
      }

      return {
        peaks,
        duration: audioBuffer.duration || 5
      };
    } catch (e) {
      // Fallback caso o formato não decodifique no buffer offline
      const fallbackPeaks = Array.from({ length: samples }, (_, i) =>
        Number((0.2 + 0.65 * Math.abs(Math.sin(i * 0.25) * Math.cos(i * 0.11))).toFixed(3))
      );
      return { peaks: fallbackPeaks, duration: 8 };
    }
  }

  drawWaveform(canvas, peaks = [], progressRatio = 0, accentColor = '#38bdf8') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const list = peaks.length > 0 ? peaks : Array.from({ length: 64 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 0.3)));
    const barCount = list.length;
    const gap = 2;
    const barWidth = Math.max(2, (w - (barCount - 1) * gap) / barCount);

    for (let i = 0; i < barCount; i++) {
      const ratio = i / barCount;
      const amp = list[i];
      const barH = Math.max(4, amp * (h - 10));
      const x = i * (barWidth + gap);
      const y = (h - barH) / 2;

      ctx.fillStyle = ratio <= progressRatio ? accentColor : 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barH, 2);
      } else {
        ctx.rect(x, y, barWidth, barH);
      }
      ctx.fill();
    }

    // Linha vertical do cursor de reprodução (Playhead)
    const playX = Math.max(1, Math.min(w - 1, progressRatio * w));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.stroke();
  }

  formatTime(sec = 0) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  }

  setupAudioNodeDOM(nodeData, el) {
    const canvas = el.querySelector('.waveform-canvas');
    const playBtn = el.querySelector('.audio-play-btn');
    const timeBadge = el.querySelector('.audio-time-badge');
    const loopBtn = el.querySelector('.audio-loop-btn');
    const pinBtn = el.querySelector('.audio-add-pin-btn');
    const speedSelect = el.querySelector('.audio-speed-select');
    const volSlider = el.querySelector('.audio-vol-slider');
    const markersTrack = el.querySelector('.audio-markers-track');

    let playerObj = this.activePlayers.get(nodeData.id);
    if (!playerObj) {
      const audioEl = new Audio(nodeData.src);
      audioEl.preload = 'metadata';
      audioEl.loop = !!nodeData.loop;
      audioEl.playbackRate = nodeData.playbackRate || 1;
      audioEl.volume = nodeData.volume ?? 0.9;
      playerObj = { audioEl, rafId: null };
      this.activePlayers.set(nodeData.id, playerObj);
    }

    const { audioEl } = playerObj;

    const updateVisuals = () => {
      const dur = audioEl.duration && isFinite(audioEl.duration) ? audioEl.duration : (nodeData.duration || 5);
      nodeData.duration = dur;
      const cur = audioEl.currentTime || 0;
      const ratio = dur > 0 ? cur / dur : 0;
      this.drawWaveform(canvas, nodeData.peaks, ratio, nodeData.accentColor || '#38bdf8');
      if (timeBadge) {
        timeBadge.textContent = `${this.formatTime(cur)} / ${this.formatTime(dur)}`;
      }
    };

    const tick = () => {
      updateVisuals();
      if (!audioEl.paused) {
        playerObj.rafId = requestAnimationFrame(tick);
      }
    };

    audioEl.onloadedmetadata = () => updateVisuals();
    audioEl.onplay = () => {
      playBtn.textContent = '⏸';
      tick();
    };
    audioEl.onpause = () => {
      playBtn.textContent = '▶';
      if (playerObj.rafId) cancelAnimationFrame(playerObj.rafId);
      updateVisuals();
    };
    audioEl.onended = () => {
      playBtn.textContent = '▶';
      if (playerObj.rafId) cancelAnimationFrame(playerObj.rafId);
      updateVisuals();
    };

    playBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audioEl.paused) {
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
    });

    // Clique na Waveform para pular para o tempo clicado
    canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = audioEl.duration && isFinite(audioEl.duration) ? audioEl.duration : (nodeData.duration || 5);
      audioEl.currentTime = ratio * dur;
      updateVisuals();
    });

    // Loop
    loopBtn.classList.toggle('active', !!nodeData.loop);
    loopBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nodeData.loop = !nodeData.loop;
      audioEl.loop = nodeData.loop;
      loopBtn.classList.toggle('active', nodeData.loop);
      this.app.storage.scheduleAutoSave();
    });

    // Adicionar Marcador de Tempo (Pin)
    pinBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addMarkerToAudioNode(nodeData.id);
    });

    // Velocidade / Pitch
    speedSelect.value = String(nodeData.playbackRate || 1);
    speedSelect.addEventListener('mousedown', (e) => e.stopPropagation());
    speedSelect.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value) || 1;
      nodeData.playbackRate = rate;
      audioEl.playbackRate = rate;
      this.app.storage.scheduleAutoSave();
    });

    // Volume
    volSlider.value = String(nodeData.volume ?? 0.9);
    volSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    volSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      nodeData.volume = vol;
      audioEl.volume = vol;
    });

    this.renderAudioMarkers(nodeData, markersTrack, audioEl, updateVisuals);
    updateVisuals();
  }

  renderAudioMarkers(nodeData, markersTrack, audioEl, updateVisuals) {
    if (!markersTrack) return;
    markersTrack.innerHTML = '';
    const markers = nodeData.markers || [];
    const dur = nodeData.duration || 5;

    for (const marker of markers) {
      const pct = Math.max(2, Math.min(98, (marker.time / dur) * 100));
      const pinEl = document.createElement('div');
      pinEl.className = 'audio-marker-pin';
      pinEl.style.left = `${pct}%`;
      pinEl.style.background = marker.color || '#f43f5e';
      pinEl.dataset.markerId = marker.id;

      const head = document.createElement('div');
      head.className = 'audio-marker-head';
      head.style.background = marker.color || '#f43f5e';
      head.title = `Clique p/ tocar em ${this.formatTime(marker.time)} | Duplo clique p/ renomear | Arraste a bolinha branca p/ conectar seta!`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = `${marker.label || this.formatTime(marker.time)}`;

      const connDot = document.createElement('span');
      connDot.className = 'marker-conn-dot';
      connDot.title = 'Arraste daqui para conectar este segundo do áudio a uma imagem ou nota!';
      connDot.dataset.portNodeId = nodeData.id;
      connDot.dataset.portAnchor = `marker:${marker.id}`;

      head.appendChild(labelSpan);
      head.appendChild(connDot);
      pinEl.appendChild(head);

      // Clicar no marcador pula o som para aquele segundo e toca
      pinEl.addEventListener('mousedown', (e) => {
        if (e.target === connDot) {
          e.stopPropagation();
          this.app.connectionsDrawing.startConnectionDrag(nodeData.id, `marker:${marker.id}`, e);
          return;
        }
        e.stopPropagation();
        audioEl.currentTime = marker.time;
        updateVisuals();
        audioEl.play().catch(() => {});
      });

      // Duplo clique no marcador permite renomear ou remover
      pinEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newName = prompt('Nome do Marcador no Áudio (deixe vazio para excluir):', marker.label || '');
        if (newName === null) return;
        if (newName.trim() === '') {
          nodeData.markers = nodeData.markers.filter((m) => m.id !== marker.id);
        } else {
          marker.label = newName.trim();
        }
        this.renderAudioMarkers(nodeData, markersTrack, audioEl, updateVisuals);
        this.app.connectionsDrawing.renderAllConnections();
        this.app.storage.scheduleAutoSave();
      });

      markersTrack.appendChild(pinEl);
    }
  }

  addMarkerToAudioNode(nodeId, customTime = null, customLabel = null) {
    const nodeData = this.app.state.nodes.get(nodeId);
    if (!nodeData || nodeData.type !== 'audio') return;

    const playerObj = this.activePlayers.get(nodeId);
    const cur = customTime !== null ? customTime : (playerObj?.audioEl?.currentTime || (nodeData.duration || 5) * 0.35);
    if (!nodeData.markers) nodeData.markers = [];

    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#a855f7', '#38bdf8'];
    const color = colors[nodeData.markers.length % colors.length];
    const markerId = 'mk_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    const label = customLabel || `${this.formatTime(cur)}`;

    nodeData.markers.push({
      id: markerId,
      time: Number(cur.toFixed(2)),
      label,
      color
    });

    const el = document.querySelector(`.canvas-node[data-id="${nodeId}"]`);
    if (el && playerObj) {
      const markersTrack = el.querySelector('.audio-markers-track');
      this.renderAudioMarkers(nodeData, markersTrack, playerObj.audioEl, () => {});
    }
    this.app.setStatus(`Marcador "${label}" adicionado no áudio! Arraste a bolinha branca dele para conectar a qualquer item.`);
    this.app.storage.scheduleAutoSave();
    return markerId;
  }

  stopAndCleanupNode(nodeId) {
    const playerObj = this.activePlayers.get(nodeId);
    if (playerObj) {
      playerObj.audioEl.pause();
      if (playerObj.rafId) cancelAnimationFrame(playerObj.rafId);
      this.activePlayers.delete(nodeId);
    }
  }

  // GRAVADOR DE MICROFONE AO VIVO
  initMicModalEvents() {
    const btnRec = document.getElementById('btn-record-mic');
    const btnStopSave = document.getElementById('btn-stop-save-mic');
    const btnCancel = document.getElementById('btn-cancel-mic');

    if (btnRec) {
      btnRec.addEventListener('click', () => this.startMicrophoneRecording());
    }
    if (btnStopSave) {
      btnStopSave.addEventListener('click', () => this.stopMicrophoneRecording(true));
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.stopMicrophoneRecording(false));
    }
  }

  async startMicrophoneRecording() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.micStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (!this.shouldSaveRecording || this.recordedChunks.length === 0) return;
        const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          const center = this.app.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
          await this.app.nodesManager.createAudioNodeFromDataUrl(
            dataUrl,
            `Gravação de Voz (${new Date().toLocaleTimeString()})`,
            center.x - 165,
            center.y - 85
          );
        };
        reader.readAsDataURL(blob);
      };

      this.mediaRecorder.start();
      this.micStartTime = performance.now();
      document.getElementById('mic-recorder-modal').classList.remove('hidden');
      this.animateMicLiveWaveform();
    } catch (err) {
      alert('Não foi possível acessar o microfone (' + err.message + '). Você também pode usar o botão "+ Som Demo" ou importar arquivos .mp3/.wav!');
    }
  }

  animateMicLiveWaveform() {
    const ctx = this.getAudioContext();
    const source = ctx.createMediaStreamSource(this.micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = document.getElementById('mic-live-canvas');
    const cctx = canvas.getContext('2d');
    const timerEl = document.getElementById('mic-timer');

    const draw = () => {
      if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
      this.micAnimId = requestAnimationFrame(draw);

      const elapsed = (performance.now() - this.micStartTime) / 1000;
      timerEl.textContent = this.formatTime(elapsed);

      analyser.getByteFrequencyData(dataArray);
      cctx.clearRect(0, 0, canvas.width, canvas.height);

      const barW = (canvas.width / bufferLength) * 1.6;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barH = (dataArray[i] / 255) * canvas.height;
        cctx.fillStyle = '#f43f5e';
        cctx.fillRect(x, canvas.height - barH, barW - 2, barH);
        x += barW;
      }
    };
    draw();
  }

  stopMicrophoneRecording(save = true) {
    this.shouldSaveRecording = save;
    if (this.micAnimId) cancelAnimationFrame(this.micAnimId);
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    document.getElementById('mic-recorder-modal').classList.add('hidden');
  }

  // SINTETIZADOR DE ÁUDIO DEMO EM WAV (Para testar sem arquivos externos)
  generateDemoWavDataUrl(preset = 'chord') {
    const sampleRate = 22050;
    const duration = 4.2;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    const notes = preset === 'arp' ? [261.63, 329.63, 392.0, 523.25, 659.25, 523.25] : [220.0, 277.18, 329.63, 440.0];

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const stepIdx = Math.floor(t * ( notes.length / duration )) % notes.length;
      const freq = notes[stepIdx];
      const localT = (t % (duration / notes.length));
      const env = Math.exp(-localT * 3.2) * Math.min(1, localT * 45);
      const wave =
        0.55 * Math.sin(2 * Math.PI * freq * t) +
        0.25 * Math.sin(2 * Math.PI * (freq * 1.5) * t) +
        0.2 * Math.sin(2 * Math.PI * (freq * 0.5) * t);

      const sample = Math.max(-1, Math.min(1, wave * env * 0.8));
      view.setInt16(44 + i * 2, sample * 32767, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  }
}
