const FACE_API_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
const MIN_CONFIDENCE = 0.6;
const DETECTION_INTERVAL_MS = 1200;
const EMOTION_COOLDOWN_MS = 180000;

const EMOTION_KEYWORDS = {
  happy: 'feel good pop',
  sad: 'sad acoustic',
  neutral: 'lofi chill',
  angry: 'energetic rock',
  surprised: 'party hits',
  fearful: 'ambient calm',
  disgusted: 'intense beats'
};

const EMOTION_EMOJI = {
  happy: '😄',
  sad: '😢',
  neutral: '😐',
  angry: '😠',
  surprised: '😲',
  fearful: '😨',
  disgusted: '🤢'
};

const state = {
  modelsLoaded: false,
  isDetecting: false,
  stream: null,
  detectionTimer: null,
  detectedEmotion: null,
  recommendationEmotion: null,
  pendingEmotion: null,
  lastRecommendationAt: 0,
  isFetchingTracks: false,
  activeAudio: null,
  spotify: {
    clientId: null,
    clientSecret: null,
    accessToken: null,
    expiresAt: 0
  }
};

const videoEl = document.getElementById('video');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const captureBtn = document.getElementById('capture-btn');
const statusIndicator = document.getElementById('status-indicator');
const emotionLabel = document.getElementById('emotion-label');
const emotionEmoji = document.getElementById('emoji-overlay');
const tracksContainer = document.getElementById('tracks-container');
const emotionChip = document.getElementById('current-emotion-chip');
const spotifyForm = document.getElementById('spotify-form');
const clientIdInput = document.getElementById('spotify-client-id');
const clientSecretInput = document.getElementById('spotify-client-secret');

init();

async function init() {
  updateStatus('Loading vision models…', { active: true });
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODEL_URL)
    ]);
    state.modelsLoaded = true;
    updateStatus('Models ready. Start the camera to begin.');
  } catch (error) {
    console.error('Model loading failed:', error);
    updateStatus('Failed to load models. Refresh to try again.', {
      error: true
    });
    startBtn.disabled = true;
  }
}

startBtn.addEventListener('click', handleStart);
stopBtn.addEventListener('click', handleStop);
captureBtn.addEventListener('click', handleCapture);
spotifyForm.addEventListener('submit', handleSpotifyConnect);

async function handleStart() {
  if (!state.modelsLoaded) {
    updateStatus('Models are still loading. Please wait…', { active: true });
    return;
  }

  try {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    captureBtn.disabled = false;
    updateStatus('Requesting camera access…', { active: true });

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });

    videoEl.srcObject = state.stream;
    await videoEl.play();

    updateStatus('Now detecting…', { active: true });
    state.isDetecting = true;
    startDetectionLoop();
  } catch (error) {
    console.error('Camera error:', error);
    updateStatus('Unable to access camera. Check permissions.', {
      error: true
    });
    startBtn.disabled = false;
    stopBtn.disabled = true;
    captureBtn.disabled = true;
  }
}

function handleStop() {
  stopDetectionLoop();

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    videoEl.srcObject = null;
    state.stream = null;
  }

  state.isDetecting = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  captureBtn.disabled = true;
  state.detectedEmotion = null;
  state.pendingEmotion = null;
  state.recommendationEmotion = null;
  emotionLabel.textContent = 'No face detected';
  emotionEmoji.textContent = '🙂';
  updateEmotionChip();
  updateStatus('Camera stopped.');
}

function startDetectionLoop() {
  stopDetectionLoop();

  state.detectionTimer = setInterval(async () => {
    if (!state.isDetecting || videoEl.readyState < 2) return;

    try {
      const detection = await faceapi
        .detectSingleFace(
          videoEl,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
        )
        .withFaceExpressions();

      if (!detection) {
        setEmotion(null);
        updateStatus('Searching for a face…', { active: true });
        return;
      }

      const topExpression = getTopExpression(detection.expressions);
      if (topExpression && topExpression.probability >= MIN_CONFIDENCE) {
        setEmotion(topExpression.expression, topExpression.probability);
      } else if (topExpression) {
        updateStatus(
          `Low confidence (${Math.round(topExpression.probability * 100)}%). Keep steady.`,
          { active: true }
        );
      }
    } catch (error) {
      console.error('Detection error:', error);
      updateStatus('Detection issue. Retrying…', { error: true });
    }
  }, DETECTION_INTERVAL_MS);
}

function stopDetectionLoop() {
  if (state.detectionTimer) {
    clearInterval(state.detectionTimer);
    state.detectionTimer = null;
  }
}

function getTopExpression(expressions = {}) {
  let best = { expression: null, probability: 0 };
  Object.entries(expressions).forEach(([expression, probability]) => {
    if (probability > best.probability) {
      best = { expression, probability };
    }
  });
  return best;
}

function setEmotion(emotion, confidence = 0) {
  if (!emotion) {
    state.detectedEmotion = null;
    state.pendingEmotion = null;
    emotionLabel.textContent = 'No face detected';
    emotionEmoji.textContent = '🙂';
    if (!state.recommendationEmotion) {
      updateEmotionChip();
    }
    return;
  }

  const prettyEmotion = capitalize(emotion);
  emotionLabel.textContent = `${prettyEmotion} (${Math.round(confidence * 100)}%)`;
  emotionEmoji.textContent = EMOTION_EMOJI[emotion] ?? '🙂';
  state.detectedEmotion = emotion;

  if (!hasSpotifyCredentials()) {
    tracksContainer.innerHTML =
      '<p class="hint">Provide Spotify credentials above to get tracks.</p>';
    return;
  }

  if (!state.recommendationEmotion) {
    attemptRecommendation(emotion);
    return;
  }

  if (state.recommendationEmotion === emotion) {
    state.pendingEmotion = null;
    updateEmotionChip();
    return;
  }

  const elapsed = Date.now() - state.lastRecommendationAt;
  if (elapsed >= EMOTION_COOLDOWN_MS) {
    attemptRecommendation(emotion);
  } else {
    state.pendingEmotion = emotion;
    updateEmotionChip({ pending: true });
    const remainingMs = EMOTION_COOLDOWN_MS - elapsed;
    updateStatus(
      `Holding current playlist for ${formatDuration(remainingMs)}. Press Capture Emotion to refresh now.`,
      { active: true }
    );
  }
}

function handleCapture() {
  if (!state.isDetecting) {
    updateStatus('Start the camera first.', { error: true });
    return;
  }
  if (!state.detectedEmotion) {
    updateStatus('No face detected. Look at the camera.', { error: true });
    return;
  }
  if (!hasSpotifyCredentials()) {
    updateStatus('Connect to Spotify first.', { error: true });
    return;
  }

  updateStatus('Refreshing recommendations…', { active: true });
  attemptRecommendation(state.detectedEmotion, { force: true });
}

function attemptRecommendation(emotion, { force = false } = {}) {
  if (!emotion || !hasSpotifyCredentials()) return;

  if (state.isFetchingTracks) {
    state.pendingEmotion = force ? emotion : state.pendingEmotion;
    updateEmotionChip({ pending: true });
    return;
  }

  if (!force && state.recommendationEmotion === emotion && state.lastRecommendationAt) {
    updateEmotionChip();
    return;
  }

  state.isFetchingTracks = true;
  state.recommendationEmotion = emotion;
  state.pendingEmotion = null;
  updateEmotionChip();

  fetchTracksForEmotion(emotion)
    .then(() => {
      state.lastRecommendationAt = Date.now();
      updateStatus('Playlist refreshed.');
    })
    .catch((error) => {
      console.error('Spotify fetch failed:', error);
      showTracksError('Spotify is unavailable. Try again.');
    })
    .finally(() => {
      state.isFetchingTracks = false;
    });
}

function updateStatus(message, { active = false, error = false } = {}) {
  statusIndicator.textContent = message;
  statusIndicator.classList.toggle('status-badge--active', active);
  statusIndicator.classList.toggle('status-badge--error', error);
}

function handleSpotifyConnect(event) {
  event.preventDefault();

  const clientId = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();

  if (!clientId || !clientSecret) {
    updateStatus('Client ID and secret are required.', { error: true });
    return;
  }

  state.spotify.clientId = clientId;
  state.spotify.clientSecret = clientSecret;
  state.spotify.accessToken = null;
  state.spotify.expiresAt = 0;

  updateStatus('Spotify connected. Awaiting emotion…');
  if (state.detectedEmotion) {
    attemptRecommendation(state.detectedEmotion, { force: true });
  } else if (state.recommendationEmotion) {
    attemptRecommendation(state.recommendationEmotion, { force: true });
  }
}

async function fetchTracksForEmotion(emotion) {
  const keyword = EMOTION_KEYWORDS[emotion] ?? emotion;
  await ensureSpotifyAccessToken();

  if (!state.spotify.accessToken) {
    throw new Error('Missing Spotify access token.');
  }

  setTracksLoading(`Fetching ${keyword} tracks…`);

  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
    keyword
  )}&type=track&limit=6`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.spotify.accessToken}`
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      state.spotify.accessToken = null;
      state.spotify.expiresAt = 0;
      return fetchTracksForEmotion(emotion);
    }
    throw new Error(`Spotify API error: ${response.status}`);
  }

  const data = await response.json();
  const tracks = data?.tracks?.items ?? [];
  renderTracks(tracks, keyword);
}

async function ensureSpotifyAccessToken() {
  const now = Date.now();
  if (state.spotify.accessToken && state.spotify.expiresAt > now + 5000) return;

  const { clientId, clientSecret } = state.spotify;
  if (!clientId || !clientSecret) return;

  updateStatus('Requesting Spotify token…', { active: true });

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    state.spotify.accessToken = null;
    state.spotify.expiresAt = 0;
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = await response.json();
  state.spotify.accessToken = data.access_token;
  state.spotify.expiresAt = Date.now() + data.expires_in * 1000;
}

function renderTracks(tracks, keyword) {
  if (!tracks.length) {
    tracksContainer.classList.add('tracks-list--empty');
    tracksContainer.innerHTML = `<p>No tracks found for <strong>${keyword}</strong>. Try again.</p>`;
    return;
  }

  tracksContainer.classList.remove('tracks-list--empty');
  tracksContainer.innerHTML = '';
  tracks.forEach((track) => {
    const card = document.createElement('article');
    card.className = 'track-card';

    const image = document.createElement('img');
    image.className = 'track-card__thumb';
    image.src = track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? '';
    image.alt = `${track.name} cover art`;

    const meta = document.createElement('div');
    meta.className = 'track-card__meta';

    const title = document.createElement('h3');
    title.className = 'track-card__title';
    title.textContent = track.name;

    const artist = document.createElement('p');
    artist.className = 'track-card__artist';
    artist.textContent = track.artists?.map((a) => a.name).join(', ') ?? 'Unknown artist';

    meta.append(title, artist);

    const actions = document.createElement('div');
    actions.className = 'track-card__actions';

    if (track.preview_url) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = track.preview_url;
      audio.addEventListener('play', () => {
        if (state.activeAudio && state.activeAudio !== audio) {
          state.activeAudio.pause();
        }
        state.activeAudio = audio;
      });
      audio.addEventListener('ended', () => {
        if (state.activeAudio === audio) {
          state.activeAudio = null;
        }
      });
      actions.appendChild(audio);
    } else {
      const noPreview = document.createElement('span');
      noPreview.textContent = 'Preview unavailable';
      noPreview.className = 'chip chip--muted';
      actions.appendChild(noPreview);
    }

    const linkBtn = document.createElement('button');
    linkBtn.className = 'track-card__btn track-card__btn--link';
    linkBtn.type = 'button';
    linkBtn.textContent = 'Open in Spotify';
    linkBtn.addEventListener('click', () => {
      window.open(track.external_urls?.spotify, '_blank', 'noopener');
    });

    actions.appendChild(linkBtn);
    card.append(image, meta, actions);
    tracksContainer.appendChild(card);
  });
}

function showTracksError(message) {
  tracksContainer.classList.add('tracks-list--empty');
  tracksContainer.innerHTML = `<p>${message}</p><button class="track-card__btn" type="button">Try again</button>`;
  const retryBtn = tracksContainer.querySelector('button');
  retryBtn.addEventListener('click', () => {
    const targetEmotion = state.detectedEmotion ?? state.recommendationEmotion;
    if (targetEmotion) {
      attemptRecommendation(targetEmotion, { force: true });
    }
  });
}

function setTracksLoading(message) {
  tracksContainer.classList.add('tracks-list--empty');
  tracksContainer.innerHTML = `<p>${message}</p>`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes
    ? `${minutes}m ${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;
}

function hasSpotifyCredentials() {
  return Boolean(state.spotify.clientId && state.spotify.clientSecret);
}

function updateEmotionChip({ pending = false } = {}) {
  if (pending && state.pendingEmotion) {
    emotionChip.textContent = `${capitalize(state.pendingEmotion)} (pending)`;
    emotionChip.className = 'chip chip--pending';
    return;
  }

  if (state.recommendationEmotion) {
    emotionChip.textContent = capitalize(state.recommendationEmotion);
    emotionChip.className = 'chip chip--accent';
  } else if (state.isDetecting) {
    emotionChip.textContent = 'Awaiting emotion…';
    emotionChip.className = 'chip chip--muted';
  } else {
    emotionChip.textContent = 'Waiting for camera…';
    emotionChip.className = 'chip chip--muted';
  }
}

window.addEventListener('beforeunload', () => {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  if (state.activeAudio) {
    state.activeAudio.pause();
  }
});