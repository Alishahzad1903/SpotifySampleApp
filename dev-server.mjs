import { createServer } from 'http';
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '.env') });

const SEARCH_QUERIES = [
  'love', 'dance', 'night', 'baby', 'fire', 'dream', 'heart',
  'rain', 'summer', 'world', 'life', 'party', 'sun', 'time',
  'blue', 'crazy', 'happy', 'move', 'stay', 'run', 'gold',
  'money', 'light', 'cold', 'home', 'city', 'star', 'wild',
];

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing Spotify credentials in .env');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

function getDailySeed() {
  const today = new Date();
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffle(arr, rand) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function searchSpotifyTracks(token, query, offset) {
  const params = new URLSearchParams({ q: query, type: 'track', market: 'US', limit: '10', offset: String(offset) });
  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.tracks?.items ?? [];
}

async function getAudioPreview(trackName, artistName) {
  const query = encodeURIComponent(`${trackName} ${artistName}`);
  try {
    const response = await fetch(`https://api.deezer.com/search?q=${query}&limit=5`);
    if (!response.ok) return null;
    const data = await response.json();
    // Find a result with a preview URL that actually works
    for (const d of (data.data ?? [])) {
      if (!d.preview) continue;
      try {
        const check = await fetch(d.preview, { method: 'HEAD' });
        if (check.ok && check.headers.get('content-length') !== '0') {
          return d.preview;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function handleQuiz(res) {
  try {
    const token = await getSpotifyToken();
    const seed = getDailySeed();
    const rand = seededRandom(seed);

    const selectedQueries = shuffle(SEARCH_QUERIES, rand).slice(0, 10);
    const spotifyTracks = [];

    for (const query of selectedQueries) {
      const offset = Math.floor(rand() * 5);
      const tracks = await searchSpotifyTracks(token, query, offset);
      spotifyTracks.push(...tracks);
      if (spotifyTracks.length >= 30) break;
    }

    if (spotifyTracks.length < 5) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not enough tracks found' }));
      return;
    }

    const shuffled = shuffle(spotifyTracks, rand);

    // Match Spotify tracks with available audio previews
    const tracksWithAudio = [];
    for (const track of shuffled) {
      if (tracksWithAudio.length >= 5) break;
      const artistName = track.artists?.[0]?.name ?? '';
      const previewUrl = await getAudioPreview(track.name, artistName);
      if (previewUrl) {
        tracksWithAudio.push({ ...track, previewUrl });
      }
    }

    if (tracksWithAudio.length < 5) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not enough audio previews available' }));
      return;
    }

    // Build quiz questions
    const questions = tracksWithAudio.map((correctTrack, idx) => {
      const correctAnswer = `${correctTrack.name} - ${correctTrack.artists[0]?.name ?? 'Unknown'}`;
      const distractors = shuffled
        .filter((t) => t.id !== correctTrack.id)
        .slice(idx * 4, idx * 4 + 4)
        .map((t) => `${t.name} - ${t.artists[0]?.name ?? 'Unknown'}`);
      const options = shuffle([correctAnswer, ...distractors], rand);
      return {
        previewUrl: correctTrack.previewUrl,
        correctAnswer,
        options,
        artistName: correctTrack.artists[0]?.name ?? 'Unknown',
        albumArt: correctTrack.album?.images?.[0]?.url ?? '',
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ questions, date: new Date().toISOString().split('T')[0] }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = createServer((req, res) => {
  if (req.url === '/api/quiz') {
    handleQuiz(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3001, () => {
  console.log('Quiz API running at http://localhost:3001/api/quiz');
});
