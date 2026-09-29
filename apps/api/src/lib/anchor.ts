import { createHash } from 'node:crypto';
import { normalizeText } from './domain.js';

export const ANCHOR_BASE = 10_000;
export const ANCHOR_QUOTE_MAX_LENGTH = 2000;
export const ANCHOR_LABEL_MAX_LENGTH = 300;

export type AnchorSnapshot = {
  startPage: number;
  endPage: number;
  quote: string | null;
  anchorLabel: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  anchoredPageCount: number | null;
  anchorHash: string | null;
};

export type AnchorInput = {
  startPage: number;
  endPage: number;
  quote: string | null;
  anchorLabel: string | null;
};

export type AnchorStatus = 'MATCH' | 'DRIFTED' | 'MISSING';

export type AnchorCheckResult = {
  status: AnchorStatus;
  expectedStartPage: number | null;
  expectedEndPage: number | null;
  startOffset: number | null;
  endOffset: number | null;
  quoteChanged: boolean;
};

export function pageToAnchor(page: number, pageCount: number): number {
  return Math.round((page * ANCHOR_BASE) / pageCount);
}

export function anchorToPage(anchor: number, pageCount: number): number {
  return Math.max(1, Math.min(pageCount, Math.round((anchor * pageCount) / ANCHOR_BASE)));
}

export function computeAnchorHash(input: {
  anchorStart: number;
  anchorEnd: number;
  anchoredPageCount: number;
  quote: string | null;
  anchorLabel: string | null;
}): string {
  const payload = [
    input.anchorStart,
    input.anchorEnd,
    input.anchoredPageCount,
    input.quote ?? '',
    input.anchorLabel ?? ''
  ].join('');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 用“相对位置 + 当时总页数快照”生成跨页锚点。
 * 书没有总页数时无法建立锚点，保留页码本身即可。
 */
export function buildAnchor(input: AnchorInput, pageCount: number | null): {
  anchorStart: number | null;
  anchorEnd: number | null;
  anchoredPageCount: number | null;
  anchorHash: string | null;
} {
  if (pageCount === null) {
    return { anchorStart: null, anchorEnd: null, anchoredPageCount: null, anchorHash: null };
  }
  const anchorStart = pageToAnchor(input.startPage, pageCount);
  const anchorEnd = pageToAnchor(input.endPage, pageCount);
  return {
    anchorStart,
    anchorEnd,
    anchoredPageCount: pageCount,
    anchorHash: computeAnchorHash({
      anchorStart,
      anchorEnd,
      anchoredPageCount: pageCount,
      quote: input.quote,
      anchorLabel: input.anchorLabel
    })
  };
}

export function normalizeQuote(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value ?? '');
  return normalized ? normalized.slice(0, ANCHOR_QUOTE_MAX_LENGTH) : null;
}

export function normalizeAnchorLabel(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value ?? '');
  return normalized ? normalized.slice(0, ANCHOR_LABEL_MAX_LENGTH) : null;
}

/**
 * 按当前总页数重算锚点期望位置，用于校验页码或总页数修改后的偏移。
 */
export function checkAnchor(
  snapshot: Pick<
    AnchorSnapshot,
    'anchorStart' | 'anchorEnd' | 'anchoredPageCount' | 'anchorHash' | 'quote' | 'anchorLabel'
  >,
  currentPages: { startPage: number; endPage: number },
  pageCount: number | null
): AnchorCheckResult | null {
  if (snapshot.anchorStart === null || snapshot.anchorEnd === null || snapshot.anchoredPageCount === null) {
    return null;
  }
  const quoteChanged =
    computeAnchorHash({
      anchorStart: snapshot.anchorStart,
      anchorEnd: snapshot.anchorEnd,
      anchoredPageCount: snapshot.anchoredPageCount,
      quote: snapshot.quote,
      anchorLabel: snapshot.anchorLabel
    }) !== snapshot.anchorHash;

  if (pageCount === null) {
    return {
      status: 'MISSING',
      expectedStartPage: null,
      expectedEndPage: null,
      startOffset: null,
      endOffset: null,
      quoteChanged
    };
  }

  const expectedStartPage = anchorToPage(snapshot.anchorStart, pageCount);
  const expectedEndPage = anchorToPage(snapshot.anchorEnd, pageCount);
  const startOffset = currentPages.startPage - expectedStartPage;
  const endOffset = currentPages.endPage - expectedEndPage;
  const drifted = startOffset !== 0 || endOffset !== 0 || quoteChanged;
  return {
    status: drifted ? 'DRIFTED' : 'MATCH',
    expectedStartPage,
    expectedEndPage,
    startOffset,
    endOffset,
    quoteChanged
  };
}
