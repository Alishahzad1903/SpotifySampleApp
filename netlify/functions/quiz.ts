import type { Context } from '@netlify/functions';

interface SpotifyToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  preview_url: string | null;
  album: { name: string; images: { url: string }[] };
}

interface TrackWithAudio extends SpotifyTrack {
  audioPreview: string;
}

interface QuizQuestion {
  previewUrl: string;
  correctAnswer: string;
  options: string[];
  artistName: string;
  albumArt: string;
}

interface DeezerSearchResult {
  data?: { preview: string }[];
}

const SEARCH_QUERIES = [
  'love', 'dance', 'night', 'baby', 'fire', 'dream', 'heart',
  'rain', 'summer', 'world', 'life', 'party', 'sun', 'time',
  'blue', 'crazy', 'happy', 'move', 'stay', 'run', 'gold',
  'money', 'light', 'cold', 'home', 'city', 'star', 'wild',
];

async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing Spotify credentials');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = (await response.json()) as SpotifyToken;
  return data.access_token;
}

function getDailySeed(): number {
  const today = new Date();
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function searchSpotifyTracks(token: string, query: string, offset: number): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    market: 'US',
    limit: '10',
    offset: String(offset),
  });

  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.tracks?.items ?? [];
}

async function getAudioPreview(trackName: string, artistName: string): Promise<string | null> {
  const query = encodeURIComponent(`${trackName} ${artistName}`);
  try {
    const response = await fetch(`https://api.deezer.com/search?q=${query}&limit=3`);
    if (!response.ok) return null;
    const data = (await response.json()) as DeezerSearchResult;
    const match = data.data?.find((d) => d.preview);
    return match?.preview ?? null;
  } catch {
    return null;
  }
}

export default async function handler(_req: Request, _context: Context): Promise<Response> {
  try {
    const token = await getSpotifyToken();
    const seed = getDailySeed();
    const rand = seededRandom(seed);

    const selectedQueries = shuffle(SEARCH_QUERIES, rand).slice(0, 10);
    const spotifyTracks: SpotifyTrack[] = [];

    for (const query of selectedQueries) {
      const offset = Math.floor(rand() * 5);
      const tracks = await searchSpotifyTracks(token, query, offset);
      spotifyTracks.push(...tracks);
      if (spotifyTracks.length >= 30) break;
    }

    if (spotifyTracks.length < 5) {
      return new Response(JSON.stringify({ error: 'Not enough tracks found' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shuffled = shuffle(spotifyTracks, rand);

    // Match Spotify tracks with available audio previews
    const tracksWithAudio: TrackWithAudio[] = [];
    for (const track of shuffled) {
      if (tracksWithAudio.length >= 5) break;
      const artistName = track.artists?.[0]?.name ?? '';
      const previewUrl = await getAudioPreview(track.name, artistName);
      if (previewUrl) {
        tracksWithAudio.push({ ...track, audioPreview: previewUrl });
      }
    }

    if (tracksWithAudio.length < 5) {
      return new Response(JSON.stringify({ error: 'Not enough audio previews available' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build quiz questions
    const questions: QuizQuestion[] = tracksWithAudio.map((correctTrack, idx) => {
      const correctAnswer = `${correctTrack.name} - ${correctTrack.artists[0]?.name ?? 'Unknown'}`;

      const distractors = shuffled
        .filter((t) => t.id !== correctTrack.id)
        .slice(idx * 4, idx * 4 + 4)
        .map((t) => `${t.name} - ${t.artists[0]?.name ?? 'Unknown'}`);

      const options = shuffle([correctAnswer, ...distractors], rand);

      return {
        previewUrl: correctTrack.audioPreview,
        correctAnswer,
        options,
        artistName: correctTrack.artists[0]?.name ?? 'Unknown',
        albumArt: correctTrack.album?.images?.[0]?.url ?? '',
      };
    });

    return new Response(JSON.stringify({ questions, date: new Date().toISOString().split('T')[0] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
