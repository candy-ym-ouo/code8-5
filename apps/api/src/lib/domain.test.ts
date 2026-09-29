import { describe, expect, it } from 'vitest';
import {
  commitConcurrentRevision,
  isRestoreWindowOpen,
  isStrictlyEditable,
  normalizeMoodTags,
  quoteHash,
  resolveRevisionQuote,
  validatePageRange,
  validateStatusTransition,
  verifyAnchor
} from './domain.js';
import { AppError } from './errors.js';

describe('domain rules', () => {
  it('allows declared status transitions', () => {
    expect(() => validateStatusTransition('READING', 'READ')).not.toThrow();
    expect(() => validateStatusTransition('READ', 'READING')).not.toThrow();
  });

  it('rejects illegal status transitions', () => {
    expect(() => validateStatusTransition('TO_READ', 'READ')).toThrow(AppError);
    expect(() => validateStatusTransition('ABANDONED', 'READING')).toThrow(AppError);
  });

  it('validates page ranges and page count', () => {
    expect(() => validatePageRange(42, 44, 300)).not.toThrow();
    expect(() => validatePageRange(44, 42, 300)).toThrow(AppError);
    expect(() => validatePageRange(42, 301, 300)).toThrow(AppError);
  });

  it('normalizes mood tags and rejects empty or duplicate overrun', () => {
    expect(normalizeMoodTags(['MOVED', 'MOVED', 'CALM'])).toEqual(['MOVED', 'CALM']);
    expect(() => normalizeMoodTags([])).toThrow(AppError);
  });

  it('enforces restore and edit windows', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(isRestoreWindowOpen(new Date('2026-09-24T00:00:00.000Z'), now)).toBe(true);
    expect(isRestoreWindowOpen(new Date('2026-09-22T00:00:00.000Z'), now)).toBe(false);
    expect(isStrictlyEditable(new Date('2026-09-25T00:00:00.000Z'), now)).toBe(true);
    expect(isStrictlyEditable(new Date('2026-09-23T00:00:00.000Z'), now)).toBe(false);
  });
});

describe('annotation cross-page anchors and quote excerpts', () => {
  const quote = '凡是过往，皆为序章。';
  const digest = quoteHash(quote);

  it('accepts an anchor whose page count snapshot matches the current book', () => {
    const result = verifyAnchor(
      { startPage: 12, endPage: 14, quoteText: quote, quoteHash: digest, anchorPageCount: 300 },
      300
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.quoteVerified).toBe(true);
  });

  it('reports page count changes while the anchor still lies in range', () => {
    const result = verifyAnchor(
      { startPage: 12, endPage: 14, quoteText: quote, quoteHash: digest, anchorPageCount: 300 },
      320
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(['PAGE_COUNT_CHANGED']);
    expect(result.quoteVerified).toBe(true);
  });

  it('reports both change and out-of-range after total pages shrink', () => {
    const result = verifyAnchor(
      { startPage: 280, endPage: 290, quoteText: quote, quoteHash: digest, anchorPageCount: 300 },
      200
    );
    expect(result.issues).toEqual(['PAGE_COUNT_CHANGED', 'OUT_OF_RANGE']);
  });

  it('flags a cleared page count against a stored snapshot', () => {
    const result = verifyAnchor(
      { startPage: 12, endPage: 14, quoteText: null, quoteHash: null, anchorPageCount: 300 },
      null
    );
    expect(result.issues).toEqual(['PAGE_COUNT_CLEARED']);
  });

  it('detects quote tampering through hash mismatch', () => {
    const result = verifyAnchor(
      { startPage: 12, endPage: 14, quoteText: '被改过的摘录', quoteHash: digest, anchorPageCount: 300 },
      300
    );
    expect(result.valid).toBe(false);
    expect(result.quoteVerified).toBe(false);
    expect(result.issues).toContain('QUOTE_HASH_MISMATCH');
  });

  it('resolves quote revisions: keep, replace and clear', () => {
    const previous = { quoteText: quote, quoteHash: digest };
    expect(resolveRevisionQuote(undefined, previous)).toEqual(previous);
    const replaced = resolveRevisionQuote('新的摘录', previous);
    expect(replaced.quoteText).toBe('新的摘录');
    expect(replaced.quoteHash).toBe(quoteHash('新的摘录'));
    expect(resolveRevisionQuote(null, previous)).toEqual({ quoteText: null, quoteHash: null });
    expect(resolveRevisionQuote('   ', previous)).toEqual({ quoteText: null, quoteHash: null });
  });

  it('lets only one of two concurrent revision commits win', () => {
    const stored = { version: 3 };
    const winners: boolean[] = [];
    // 模拟两个端都基于 version=3 同时提交：只有一次 CAS 成功
    winners.push(commitConcurrentRevision(stored, 3));
    if (winners[0]) stored.version = 4;
    winners.push(commitConcurrentRevision(stored, 3));
    expect(winners).toEqual([true, false]);
    expect(winners.filter(Boolean)).toHaveLength(1);
  });
});
