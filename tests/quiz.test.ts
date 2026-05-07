import { describe, it, expect } from 'vitest';

// Replicate the pure utility functions from the serverless function for unit testing
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

describe('getDailySeed', () => {
  it('returns a consistent number for the same date', () => {
    const seed1 = getDailySeed();
    const seed2 = getDailySeed();
    expect(seed1).toBe(seed2);
  });

  it('returns an 8-digit number', () => {
    const seed = getDailySeed();
    expect(seed).toBeGreaterThan(20200000);
    expect(seed).toBeLessThan(21000000);
  });
});

describe('seededRandom', () => {
  it('produces deterministic values for the same seed', () => {
    const rand1 = seededRandom(12345);
    const rand2 = seededRandom(12345);
    expect(rand1()).toBe(rand2());
    expect(rand1()).toBe(rand2());
    expect(rand1()).toBe(rand2());
  });

  it('produces values between 0 and 1', () => {
    const rand = seededRandom(99999);
    for (let i = 0; i < 100; i++) {
      const val = rand();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('produces different values for different seeds', () => {
    const rand1 = seededRandom(111);
    const rand2 = seededRandom(222);
    // At least one of the first 3 values should differ
    const vals1 = [rand1(), rand1(), rand1()];
    const vals2 = [rand2(), rand2(), rand2()];
    expect(vals1).not.toEqual(vals2);
  });
});

describe('shuffle', () => {
  it('returns same elements in different order', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const rand = seededRandom(42);
    const shuffled = shuffle(arr, rand);
    expect(shuffled).toHaveLength(arr.length);
    expect(shuffled.sort((a, b) => a - b)).toEqual(arr);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    const rand = seededRandom(7);
    shuffle(arr, rand);
    expect(arr).toEqual(original);
  });

  it('produces deterministic output for same seed', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const shuffled1 = shuffle(arr, seededRandom(100));
    const shuffled2 = shuffle(arr, seededRandom(100));
    expect(shuffled1).toEqual(shuffled2);
  });

  it('handles empty array', () => {
    const rand = seededRandom(1);
    expect(shuffle([], rand)).toEqual([]);
  });

  it('handles single element', () => {
    const rand = seededRandom(1);
    expect(shuffle([42], rand)).toEqual([42]);
  });
});
