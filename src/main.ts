interface QuizQuestion {
  previewUrl: string;
  correctAnswer: string;
  options: string[];
  artistName: string;
  albumArt: string;
}

interface QuizData {
  questions: QuizQuestion[];
  date: string;
}

interface GameStats {
  gamesPlayed: number;
  bestScore: number;
  totalCorrect: number;
  longestStreak: number;
  lastPlayed: string;
}

const CLIP_DURATION_MS = 3000;
const BASE_POINTS = 100;
const SPEED_BONUS_MAX = 150;
const STREAK_MULTIPLIER = 0.5;

// Animated music GIFs (royalty-free placeholders)
const ROUND_VISUALS = [
  'https://media.giphy.com/media/tqfS3mgQU28ko/giphy.gif',
  'https://media.giphy.com/media/l0HlNQ03J5JxX2rDi/giphy.gif',
  'https://media.giphy.com/media/4oMoIbIQrvCjm/giphy.gif',
  'https://media.giphy.com/media/3o7TKGy6TBUPRMf9Go/giphy.gif',
  'https://media.giphy.com/media/l3q2Z6S6n38zjPswo/giphy.gif',
];

let quizData: QuizData | null = null;
let currentRound = 0;
let score = 0;
let streak = 0;
let audio: HTMLAudioElement | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let answerStartTime = 0;
let answeredThisRound = false;
let roundTimes: number[] = [];
let roundResults: boolean[] = [];

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(id).classList.add('active');
}

function getStats(): GameStats {
  const raw = localStorage.getItem('songquiz_stats');
  if (raw) return JSON.parse(raw);
  return { gamesPlayed: 0, bestScore: 0, totalCorrect: 0, longestStreak: 0, lastPlayed: '' };
}

function saveStats(stats: GameStats): void {
  localStorage.setItem('songquiz_stats', JSON.stringify(stats));
}

async function fetchQuiz(): Promise<QuizData> {
  const res = await fetch('/api/quiz');
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function updateProgressPills(): void {
  document.querySelectorAll('.pill').forEach((pill, idx) => {
    pill.classList.remove('active', 'done');
    if (idx === currentRound) pill.classList.add('active');
    else if (idx < currentRound) pill.classList.add('done');
  });
}

function updateStreakBadge(): void {
  const badge = $('streak-badge');
  if (streak >= 2) {
    badge.textContent = `🔥 ${streak}`;
    badge.classList.remove('hidden');
    badge.style.animation = 'none';
    badge.offsetHeight; // trigger reflow
    badge.style.animation = '';
  } else {
    badge.classList.add('hidden');
  }
}

function calculatePoints(timeElapsed: number): { base: number; speed: number; streakBonus: number; total: number } {
  const base = BASE_POINTS;
  // Faster answers get more bonus (up to 30 seconds considered)
  const speedRatio = Math.max(0, 1 - timeElapsed / 30000);
  const speed = Math.round(SPEED_BONUS_MAX * speedRatio);
  const streakBonus = streak >= 2 ? Math.round((base + speed) * STREAK_MULTIPLIER * (streak - 1)) : 0;
  const total = base + speed + streakBonus;
  return { base, speed, streakBonus, total };
}

function showPointsPopup(points: { total: number; streakBonus: number }): void {
  const popup = $('points-popup');
  popup.classList.remove('hidden', 'bonus');

  if (points.streakBonus > 0) {
    popup.textContent = `+${points.total} pts (🔥 x${streak} streak!)`;
    popup.classList.add('bonus');
  } else {
    popup.textContent = `+${points.total} pts`;
  }

  popup.style.animation = 'none';
  popup.offsetHeight;
  popup.style.animation = '';
}

function renderRound(): void {
  const question = quizData!.questions[currentRound];

  // Reset round state
  answeredThisRound = false;

  updateProgressPills();
  $('score-label').textContent = `${score} pts`;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('next-btn').classList.add('hidden');
  $('points-popup').classList.add('hidden');

  // Random animated visual (not album art — that gives away the answer)
  const albumImg = $('album-art') as HTMLImageElement;
  albumImg.src = ROUND_VISUALS[currentRound % ROUND_VISUALS.length];
  albumImg.alt = 'Music visualization';

  // Options
  const optionsEl = $('options');
  optionsEl.innerHTML = '';

  question.options.forEach((option) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = option;
    btn.addEventListener('click', () => handleAnswer(option, btn));
    optionsEl.appendChild(btn);
  });

  // Reset play button
  const playBtn = $('play-btn') as HTMLButtonElement;
  playBtn.disabled = false;
  playBtn.classList.remove('playing');
  document.querySelector('.play-icon')!.classList.remove('hidden');
  document.querySelector('.pause-icon')!.classList.add('hidden');
  $('player-hint').textContent = 'Tap to play a 3-second clip';

  // Reset clip timer bar
  const timerFill = document.querySelector('.timer-fill') as HTMLElement;
  timerFill.style.width = '0%';

  // Hide answer timer (no longer used)
  const answerTimerWrap = document.querySelector('.answer-timer-wrap') as HTMLElement;
  if (answerTimerWrap) answerTimerWrap.style.display = 'none';
}

function playClip(): void {
  const question = quizData!.questions[currentRound];

  if (audio) {
    audio.pause();
    audio = null;
  }

  audio = new Audio(question.previewUrl);

  const playBtn = $('play-btn') as HTMLButtonElement;
  playBtn.disabled = true;
  playBtn.classList.add('playing');
  document.querySelector('.play-icon')!.classList.add('hidden');
  document.querySelector('.pause-icon')!.classList.remove('hidden');
  $('player-hint').textContent = 'Listening...';

  const timerFill = document.querySelector('.timer-fill') as HTMLElement;
  const startTime = Date.now();

  audio.play().catch(() => {
    playBtn.disabled = false;
    playBtn.classList.remove('playing');
    document.querySelector('.play-icon')!.classList.remove('hidden');
    document.querySelector('.pause-icon')!.classList.add('hidden');
    $('player-hint').textContent = 'Tap to play a 3-second clip';
  });

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min((elapsed / CLIP_DURATION_MS) * 100, 100);
    timerFill.style.width = `${progress}%`;

    if (elapsed >= CLIP_DURATION_MS) {
      stopClip();
      // Start silently tracking answer time after clip finishes
      if (!answeredThisRound) {
        answerStartTime = Date.now();
      }
    }
  }, 50);
}

function stopClip(): void {
  if (audio) {
    audio.pause();
    audio = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const playBtn = $('play-btn') as HTMLButtonElement;
  playBtn.disabled = false;
  playBtn.classList.remove('playing');
  document.querySelector('.play-icon')!.classList.remove('hidden');
  document.querySelector('.pause-icon')!.classList.add('hidden');
  $('player-hint').textContent = 'Tap to replay';
}

function handleAnswer(selected: string, btn: HTMLElement): void {
  if (answeredThisRound) return;
  answeredThisRound = true;

  const question = quizData!.questions[currentRound];
  const isCorrect = selected === question.correctAnswer;
  const timeElapsed = answerStartTime > 0 ? Date.now() - answerStartTime : 0;

  // Record round time and result
  roundTimes[currentRound] = timeElapsed;
  roundResults[currentRound] = isCorrect;

  document.querySelectorAll('.option-btn').forEach((el) => {
    (el as HTMLButtonElement).disabled = true;
    if (el.textContent === question.correctAnswer) {
      el.classList.add('correct');
    }
  });

  if (isCorrect) {
    streak++;
    const points = calculatePoints(timeElapsed);
    score += points.total;
    btn.classList.add('correct');
    $('feedback').textContent = '✓ Correct!';
    $('feedback').className = 'feedback correct';
    showPointsPopup(points);
    updateStreakBadge();
  } else {
    streak = 0;
    btn.classList.add('wrong');
    $('feedback').textContent = `✗ It was: ${question.correctAnswer}`;
    $('feedback').className = 'feedback wrong';
    updateStreakBadge();
  }

  $('score-label').textContent = `${score} pts`;
  stopClip();

  if (currentRound < 4) {
    $('next-btn').classList.remove('hidden');
  } else {
    setTimeout(showResults, 1500);
  }
}

function spawnConfetti(): void {
  const container = $('confetti');
  container.innerHTML = '';
  const colors = ['#1DB954', '#ff9500', '#8b5cf6', '#ec4899', '#06b6d4', '#fbbf24'];

  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 1}s`;
    piece.style.animationDuration = `${1.5 + Math.random() * 1.5}s`;
    container.appendChild(piece);
  }
}

function showResults(): void {
  // Determine result emoji and title based on score
  let emoji: string;
  let title: string;
  if (score >= 1000) {
    emoji = '🏆';
    title = 'Legendary!';
    spawnConfetti();
  } else if (score >= 700) {
    emoji = '🎉';
    title = 'Amazing!';
    spawnConfetti();
  } else if (score >= 400) {
    emoji = '👏';
    title = 'Nice Work!';
  } else {
    emoji = '🎵';
    title = 'Keep Practicing!';
  }

  $('results-emoji').textContent = emoji;
  $('results-title').textContent = title;
  $('final-score').textContent = `${score} points`;

  // Update and display stats
  const stats = getStats();
  stats.gamesPlayed++;
  if (score > stats.bestScore) stats.bestScore = score;
  if (streak > stats.longestStreak) stats.longestStreak = streak;
  stats.lastPlayed = new Date().toISOString().split('T')[0];
  saveStats(stats);

  const correctCount = roundResults.filter(Boolean).length;
  const totalTime = roundTimes.reduce((sum, t) => sum + t, 0);
  const avgTime = totalTime / roundTimes.length;

  const statsEl = $('results-stats');
  statsEl.innerHTML = `
    <div class="stat-box"><span class="stat-value">${correctCount}/5</span><span class="stat-label">Correct</span></div>
    <div class="stat-box"><span class="stat-value">${(avgTime / 1000).toFixed(1)}s</span><span class="stat-label">Avg Time</span></div>
    <div class="stat-box"><span class="stat-value">${stats.bestScore}</span><span class="stat-label">Best Score</span></div>
  `;

  const summary = $('answers-summary');
  summary.innerHTML = '';
  quizData!.questions.forEach((q, i) => {
    const timeTaken = roundTimes[i] != null ? `${(roundTimes[i] / 1000).toFixed(1)}s` : '-';
    const icon = roundResults[i] ? '✓' : '✗';
    const resultClass = roundResults[i] ? 'correct' : 'wrong';
    const div = document.createElement('div');
    div.className = 'answer-item';
    div.innerHTML = `<span class="answer-num ${resultClass}">${icon}</span><span>${q.correctAnswer}</span><span class="answer-time">${timeTaken}</span>`;
    summary.appendChild(div);
  });

  showScreen('results');
}

function nextRound(): void {
  currentRound++;
  renderRound();
}

async function init(): Promise<void> {
  try {
    showScreen('loading');
    quizData = await fetchQuiz();
    currentRound = 0;
    score = 0;
    streak = 0;
    roundTimes = [];
    roundResults = [];
    showScreen('quiz');
    renderRound();
  } catch {
    showScreen('error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('play-btn').addEventListener('click', playClip);
  $('next-btn').addEventListener('click', nextRound);
  $('replay-btn').addEventListener('click', () => {
    $('error-msg').textContent = 'Come back tomorrow for a new quiz!';
    showScreen('error');
  });
  init();
});
