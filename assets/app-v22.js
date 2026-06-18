const CONFIG = {
  correctNumber: "5552328057",
  resetAfterCallEnds: true,
};

const numberDisplay = document.querySelector("#numberDisplay");
const callState = document.querySelector("#callState");
const carrier = document.querySelector("#carrier");
const callButton = document.querySelector("#callButton");
const endButton = document.querySelector("#endButton");
const backspace = document.querySelector("#backspace");
const correctAudio = document.querySelector("#correctAudio");
const wrongAudio = document.querySelector("#wrongAudio");
const keys = Array.from(document.querySelectorAll(".key"));

let dialed = "";
let activeAudio = null;
let activeSource = null;
let callTimer = null;
let audioContext = null;
let mediaUnlocked = false;
let activeRingOscillators = [];
const responseBuffers = {
  correct: null,
  wrong: null,
};

function normalizeNumber(value) {
  return value.replace(/[^\d*#]/g, "");
}

function formatNumber(value) {
  const clean = normalizeNumber(value);

  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  if (clean.length === 7) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  if (clean.length === 10) return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  return clean;
}

function updateDisplay() {
  numberDisplay.textContent = formatNumber(dialed) || "\u00a0";
  backspace.disabled = dialed.length === 0;
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

async function loadResponseBuffers() {
  const context = ensureAudioContext();
  const fetchRecording = async (mp3Url) => {
    try {
      const mp3Response = await fetch(mp3Url);
      if (mp3Response.ok) return mp3Response.arrayBuffer();
    } catch {
      // Use the bundled WAV placeholder until the room's MP3 is added.
    }

    const wavUrl = mp3Url.replace(/\.mp3(?:\?.*)?$/i, ".wav");
    const wavResponse = await fetch(wavUrl);
    if (!wavResponse.ok) throw new Error(`Could not load recording: ${mp3Url}`);
    return wavResponse.arrayBuffer();
  };

  const [correctData, wrongData] = await Promise.all([
    fetchRecording(correctAudio.src),
    fetchRecording(wrongAudio.src),
  ]);

  const [correctBuffer, wrongBuffer] = await Promise.all([
    context.decodeAudioData(correctData),
    context.decodeAudioData(wrongData),
  ]);

  responseBuffers.correct = correctBuffer;
  responseBuffers.wrong = wrongBuffer;
}

function playTone(frequency = 770, duration = 0.08, gain = 0.045) {
  const context = ensureAudioContext();
  const oscillator = context.createOscillator();
  const volume = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  volume.gain.setValueAtTime(gain, context.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);

  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function playDualTone(frequencies, duration = 0.105, gain = 0.075) {
  const context = ensureAudioContext();
  const output = context.createDynamicsCompressor();
  const start = context.currentTime;
  const end = start + duration;

  output.threshold.value = -18;
  output.knee.value = 4;
  output.ratio.value = 5;
  output.attack.value = 0.001;
  output.release.value = 0.03;
  output.connect(context.destination);

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    toneGain.gain.setValueAtTime(0.001, start);
    toneGain.gain.linearRampToValueAtTime(gain * (index === 0 ? 1 : 0.78), start + 0.003);
    toneGain.gain.setValueAtTime(gain * (index === 0 ? 1 : 0.78), end - 0.008);
    toneGain.gain.linearRampToValueAtTime(0.001, end);

    oscillator.connect(toneGain);
    toneGain.connect(output);
    oscillator.start(start);
    oscillator.stop(end);
  });
}

function playCellPhoneRings() {
  const context = ensureAudioContext();
  const start = context.currentTime + 0.12;
  const ringStarts = [0, 2.2];
  const ringDuration = 1.25;

  ringStarts.forEach((ringStart) => {
    [440, 480].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const ringToneStart = start + ringStart;
      const ringToneEnd = ringToneStart + ringDuration;

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.001, ringToneStart);
      volume.gain.linearRampToValueAtTime(index === 0 ? 0.052 : 0.042, ringToneStart + 0.025);
      volume.gain.setValueAtTime(index === 0 ? 0.052 : 0.042, ringToneEnd - 0.06);
      volume.gain.exponentialRampToValueAtTime(0.001, ringToneEnd);

      oscillator.connect(volume);
      volume.connect(context.destination);
      oscillator.start(ringToneStart);
      oscillator.stop(ringToneEnd);
      activeRingOscillators.push(oscillator);
    });
  });

  return 3650;
}

function playCallEndedSound() {
  const context = ensureAudioContext();
  const start = context.currentTime + 0.035;
  const beepStarts = [0, 0.32, 0.64];

  beepStarts.forEach((offset) => {
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    const beepStart = start + offset;
    const beepEnd = beepStart + 0.2;

    oscillator.type = "sine";
    oscillator.frequency.value = 425;
    volume.gain.setValueAtTime(0.001, beepStart);
    volume.gain.linearRampToValueAtTime(0.055, beepStart + 0.008);
    volume.gain.setValueAtTime(0.055, beepEnd - 0.025);
    volume.gain.exponentialRampToValueAtTime(0.001, beepEnd);

    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(beepStart);
    oscillator.stop(beepEnd);
  });
}

function unlockMedia() {
  if (mediaUnlocked) return;
  mediaUnlocked = true;
  loadResponseBuffers().catch(() => {
    mediaUnlocked = false;
  });

  [correctAudio, wrongAudio].forEach((audio) => {
    const originalMuted = audio.muted;
    audio.muted = true;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = originalMuted;
      })
      .catch(() => {
        audio.muted = originalMuted;
        mediaUnlocked = false;
      });
  });
}

function playKeySound(key) {
  const tones = {
    "1": [697, 1209],
    "2": [697, 1336],
    "3": [697, 1477],
    "4": [770, 1209],
    "5": [770, 1336],
    "6": [770, 1477],
    "7": [852, 1209],
    "8": [852, 1336],
    "9": [852, 1477],
    "*": [941, 1209],
    "0": [941, 1336],
    "#": [941, 1477],
  };
  playDualTone(tones[key] || [770, 1336]);
}

function stopActiveAudio() {
  clearTimeout(callTimer);
  activeRingOscillators.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch {
      // The scheduled ringtone note has already ended.
    }
  });
  activeRingOscillators = [];
  if (activeSource) {
    activeSource.stop();
    activeSource = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

function showCallEnded() {
  callState.textContent = "Call Ended";
  carrier.textContent = "No Caller ID";
  playCallEndedSound();

  if (CONFIG.resetAfterCallEnds) {
    window.setTimeout(() => {
      dialed = "";
      callState.textContent = "Phone";
      updateDisplay();
    }, 550);
  }
}

function endCall() {
  stopActiveAudio();
  showCallEnded();
}

async function playResponse(audio) {
  const context = ensureAudioContext();
  const buffer = audio === correctAudio ? responseBuffers.correct : responseBuffers.wrong;

  if (buffer) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.95;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    source.addEventListener("ended", () => {
      if (activeSource !== source) return;
      activeSource = null;
      showCallEnded();
    });
    activeSource = source;
    source.start();
    return;
  }

  activeAudio = audio;
  audio.currentTime = 0;
  audio.addEventListener("ended", () => {
    if (activeAudio !== audio) return;
    activeAudio = null;
    showCallEnded();
  }, { once: true });
  try {
    await audio.play();
  } catch {
    playTone(audio === correctAudio ? 660 : 220, 0.7, 0.08);
  }
}

function callNumber() {
  if (!dialed) return;

  unlockMedia();
  stopActiveAudio();
  const clean = normalizeNumber(dialed);
  const isCorrect = clean === normalizeNumber(CONFIG.correctNumber);

  carrier.textContent = formatNumber(clean);
  callState.textContent = "Calling...";
  const ringDurationMs = playCellPhoneRings();

  callTimer = window.setTimeout(() => {
    activeRingOscillators = [];
    callState.textContent = isCorrect ? "Connected" : "Wrong Number";
    playResponse(isCorrect ? correctAudio : wrongAudio);
  }, ringDurationMs);
}

keys.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.key;
    if (dialed.length >= 16) return;

    unlockMedia();
    dialed += key;
    callState.textContent = "Phone";
    playKeySound(key);
    updateDisplay();
  });
});

backspace.addEventListener("click", () => {
  if (!dialed) return;
  dialed = dialed.slice(0, -1);
  playTone(520, 0.055, 0.025);
  updateDisplay();
});

callButton.addEventListener("click", callNumber);
endButton.addEventListener("click", endCall);

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if (/^[0-9*#]$/.test(key)) {
    document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.click();
  }
  if (key === "Backspace") backspace.click();
  if (key === "Enter") callButton.click();
  if (key === "Escape") endButton.click();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker-v22.js")
    .then((registration) => registration.update())
    .catch(() => {});
}

updateDisplay();
