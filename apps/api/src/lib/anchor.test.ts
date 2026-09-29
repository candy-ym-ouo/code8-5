import { describe, expect, it } from 'vitest';
import {
  ANCHOR_BASE,
  anchorToPage,
  buildAnchor,
  checkAnchor,
  computeAnchorHash,
  normalizeAnchorLabel,
  normalizeQuote,
  pageToAnchor
} from './anchor.js';

describe('anchor mapping', () => {
  it('round-trips pages when the page count does not change', () => {
    for (const pageCount of [100, 300, 320]) {
      for (let page = 1; page <= pageCount; page += 1) {
        expect(anchorToPage(pageToAnchor(page, pageCount), pageCount)).toBe(page);
      }
    }
  });

  it('projects pages proportionally after page count changes', () => {
    // 300 页版本中的第 150 页（中点），在 400 页版本应落在第 200 页
    expect(pageToAnchor(150, 300)).toBe(ANCHOR_BASE / 2);
    expect(anchorToPage(pageToAnchor(150, 300), 400)).toBe(200);
  });

  it('clamps projected pages into the valid range', () => {
    expect(anchorToPage(1, 10)).toBe(1);
    expect(anchorToPage(ANCHOR_BASE, 10)).toBe(10);
  });
});

describe('buildAnchor', () => {
  it('returns a null anchor when the book has no declared page count', () => {
    expect(
      buildAnchor({ startPage: 10, endPage: 12, quote: '摘录', anchorLabel: '第一章' }, null)
    ).toEqual({ anchorStart: null, anchorEnd: null, anchoredPageCount: null, anchorHash: null });
  });

  it('snapshots page count and signs anchor fields', () => {
    const anchor = buildAnchor(
      { startPage: 10, endPage: 12, quote: '原文摘录', anchorLabel: '第二章' },
      300
    );
    expect(anchor.anchoredPageCount).toBe(300);
    expect(anchor.anchorStart).toBe(pageToAnchor(10, 300));
    expect(anchor.anchorEnd).toBe(pageToAnchor(12, 300));
    expect(anchor.anchorHash).toHaveLength(64);
    expect(anchor.anchorHash).toBe(
      computeAnchorHash({
        anchorStart: anchor.anchorStart!,
        anchorEnd: anchor.anchorEnd!,
        anchoredPageCount: 300,
        quote: '原文摘录',
        anchorLabel: '第二章'
      })
    );
  });
});

describe('checkAnchor', () => {
  function snapshotAt(pageCount: number, startPage: number, endPage: number, quote: string | null) {
    return {
      anchorStart: pageToAnchor(startPage, pageCount),
      anchorEnd: pageToAnchor(endPage, pageCount),
      anchoredPageCount: pageCount,
      anchorHash: computeAnchorHash({
        anchorStart: pageToAnchor(startPage, pageCount),
        anchorEnd: pageToAnchor(endPage, pageCount),
        anchoredPageCount: pageCount,
        quote,
        anchorLabel: null
      }),
      quote,
      anchorLabel: null
    };
  }

  it('returns null for records without an anchor', () => {
    expect(
      checkAnchor(
        {
          anchorStart: null,
          anchorEnd: null,
          anchoredPageCount: null,
          anchorHash: null,
          quote: null,
          anchorLabel: null
        },
        { startPage: 10, endPage: 12 },
        300
      )
    ).toBeNull();
  });

  it('matches when page count and pages are unchanged', () => {
    const result = checkAnchor(snapshotAt(300, 10, 12, '原文'), { startPage: 10, endPage: 12 }, 300);
    expect(result?.status).toBe('MATCH');
    expect(result?.startOffset).toBe(0);
    expect(result?.endOffset).toBe(0);
    expect(result?.quoteChanged).toBe(false);
  });

  it('recomputes expected pages and offsets after page count changes', () => {
    const result = checkAnchor(snapshotAt(300, 150, 150, '原文'), { startPage: 150, endPage: 150 }, 400);
    expect(result?.status).toBe('DRIFTED');
    expect(result?.expectedStartPage).toBe(200);
    expect(result?.startOffset).toBe(-50);
  });

  it('reports MISSING when current page count is cleared', () => {
    const result = checkAnchor(snapshotAt(300, 10, 12, null), { startPage: 10, endPage: 12 }, null);
    expect(result?.status).toBe('MISSING');
    expect(result?.expectedStartPage).toBeNull();
  });

  it('detects a tampered quote through the anchor hash', () => {
    const original = snapshotAt(300, 10, 12, '原文摘录');
    const result = checkAnchor({ ...original, quote: '被改过的摘录' }, { startPage: 10, endPage: 12 }, 300);
    expect(result?.status).toBe('DRIFTED');
    expect(result?.quoteChanged).toBe(true);
    expect(result?.startOffset).toBe(0);
  });
});

describe('anchor text normalization', () => {
  it('keeps undefined distinct from explicit null and trims length', () => {
    expect(normalizeQuote(undefined)).toBeUndefined();
    expect(normalizeQuote(null)).toBeNull();
    expect(normalizeQuote('   ')).toBeNull();
    expect(normalizeQuote('  摘录  ')).toBe('摘录');
    expect(normalizeQuote('摘'.repeat(3000))).toHaveLength(2000);
    expect(normalizeAnchorLabel('  第一章 ')).toBe('第一章');
  });
});
