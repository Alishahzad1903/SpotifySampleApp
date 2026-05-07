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
const ANSWER_TIME_LIMIT = 10000; // 10 seconds to answer
const BASE_POINTS = 100;
const SPEED_BONUS_MAX = 150; // max bonus for fast answers
const STREAK_MULTIPLIER = 0.5; // 50% bonus per streak

let quizData: QuizData | null = null;
let currentRound = 0;
let score = 0;
let streak = 0;
let audio: HTMLAudioElement | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let answerTimerInterval: ReturnType<typeof setInterval> | null = null;
let answerStartTime = 0;
let answeredThisRound = false;

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

function startAnswerTimer(): void {
  answerStartTime = Date.now();
  answeredThisRound = false;
  const fill = document.querySelector('.answer-timer-fill') as HTMLElement;
  const label = $('answer-time-label');
  fill.style.width = '100%';
  fill.classList.remove('urgent', 'critical');
  label.textContent = '10s';

  answerTimerInterval = setInterval(() => {
    if (answeredThisRound) {
      clearInterval(answerTimerInterval!);
      return;
    }
    const elapsed = Date.now() - answerStartTime;
    const remaining = Math.max(0, ANSWER_TIME_LIMIT - elapsed);
    const pct = (remaining / ANSWER_TIME_LIMIT) * 100;
    fill.style.width = `${pct}%`;
    label.textContent = `${(remaining / 1000).toFixed(1)}s`;

    if (pct < 20) fill.classList.add('critical');
    else if (pct < 40) fill.classList.add('urgent');

    if (remaining <= 0) {
      clearInterval(answerTimerInterval!);
      handleTimeout();
    }
  }, 100);
}

function handleTimeout(): void {
  answeredThisRound = true;
  streak = 0;
  updateStreakBadge();
  stopClip();

  document.querySelectorAll('.option-btn').forEach((el) => {
    (el as HTMLButtonElement).disabled = true;
    const question = quizData!.questions[currentRound];
    if (el.textContent === question.correctAnswer) {
      el.classList.add('correct');
    }
  });

  $('feedback').textContent = `⏱ Time's up! It was: ${quizData!.questions[currentRound].correctAnswer}`;
  $('feedback').className = 'feedback wrong';

  if (currentRound < 4) {
    $('next-btn').classList.remove('hidden');
  } else {
    setTimeout(showResults, 1500);
  }
}

function calculatePoints(timeElapsed: number): { base: number; speed: number; streakBonus: number; total: number } {
  const base = BASE_POINTS;
  const speedRatio = Math.max(0, 1 - timeElapsed / ANSWER_TIME_LIMIT);
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
  if (answerTimerInterval) {
    clearInterval(answerTimerInterval);
    answerTimerInterval = null;
  }

  updateProgressPills();
  $('score-label').textContent = `${score} pts`;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('next-btn').classList.add('hidden');
  $('points-popup').classList.add('hidden');

  // Album art
  const albumImg = $('album-art') as HTMLImageElement;
  albumImg.src = question.albumArt || '';
  albumImg.alt = 'Album art';

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

  // Reset timers
  const timerFill = document.querySelector('.timer-fill') as HTMLElement;
  timerFill.style.width = '0%';
  const answerFill = document.querySelector('.answer-timer-fill') as HTMLElement;
  answerFill.style.width = '100%';
  answerFill.classList.remove('urgent', 'critical');
  $('answer-time-label').textContent = '';
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
      // Start answer countdown after clip finishes
      if (!answeredThisRound) {
        startAnswerTimer();
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

  if (answerTimerInterval) {
    clearInterval(answerTimerInterval);
    answerTimerInterval = null;
  }

  const question = quizData!.questions[currentRound];
  const isCorrect = selected === question.correctAnswer;
  const timeElapsed = Date.now() - answerStartTime;

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
  const correctCount = quizData!.questions.filter(
    (q, i) => i < 5
  ).length; // We track via score/streak instead

  // Calculate correct answers from round results
  const totalCorrectThisGame = Math.round(score / BASE_POINTS); // approximate
  const actualCorrect = quizData!.questions.reduce((count, q, _i) => {
    // We can't easily track this without state, use streak logic
    return count;
  }, 0);

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

  const statsEl = $('results-stats');
  statsEl.innerHTML = `
    <div class="stat-box"><span class="stat-value">${stats.gamesPlayed}</span><span class="stat-label">Played</span></div>
    <div class="stat-box"><span class="stat-value">${stats.bestScore}</span><span class="stat-label">Best Score</span></div>
    <div class="stat-box"><span class="stat-value">${stats.longestStreak}</span><span class="stat-label">Best Streak</span></div>
  `;

  const summary = $('answers-summary');
  summary.innerHTML = '';
  quizData!.questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'answer-item';
    div.innerHTML = `<span class="answer-num">${i + 1}</span><span>${q.correctAnswer}</span>`;
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
