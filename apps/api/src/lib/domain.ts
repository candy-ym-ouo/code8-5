import { createHash } from 'node:crypto';
import { BOOK_STATUSES, MOOD_TAGS, type BookStatus, type MoodTag } from '@paper-book-traces/shared';
import { AppError } from './errors.js';

export const STATUS_TRANSITIONS: Record<BookStatus, BookStatus[]> = {
  TO_READ: ['READING', 'ABANDONED'],
  READING: ['PAUSED', 'READ', 'ABANDONED'],
  PAUSED: ['READING', 'READ', 'ABANDONED'],
  READ: ['READING'],
  ABANDONED: []
};

export function normalizeText(value: string): string {
  return value.normalize('NFC').trim();
}

export function parsePositivePage(value: number, field = 'pageNumber'): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError(422, 'VALIDATION_ERROR', '页码必须为大于等于 1 的整数', {
      [field]: '页码必须为大于等于 1 的整数'
    });
  }
  return value;
}

export function validatePageRange(startPage: number, endPage: number, pageCount: number | null): void {
  parsePositivePage(startPage, 'startPage');
  parsePositivePage(endPage, 'endPage');
  if (startPage > endPage) {
    throw new AppError(422, 'VALIDATION_ERROR', '起始页不能大于结束页', {
      endPage: '结束页必须大于等于起始页'
    });
  }
  if (pageCount !== null && endPage > pageCount) {
    throw new AppError(422, 'VALIDATION_ERROR', `页码不能超过总页数 ${pageCount}`, {
      endPage: `页码不能超过总页数 ${pageCount}`
    });
  }
}

export function validateSinglePage(pageNumber: number, pageCount: number | null): void {
  parsePositivePage(pageNumber);
  if (pageCount !== null && pageNumber > pageCount) {
    throw new AppError(422, 'VALIDATION_ERROR', `页码不能超过总页数 ${pageCount}`, {
      pageNumber: `页码不能超过总页数 ${pageCount}`
    });
  }
}

export function assertBookStatus(value: string): asserts value is BookStatus {
  if (!BOOK_STATUSES.includes(value as BookStatus)) {
    throw new AppError(422, 'VALIDATION_ERROR', '书目状态无效', { status: '书目状态无效' });
  }
}

export function validateStatusTransition(current: BookStatus, next: BookStatus): void {
  if (current === next) {
    if (current === 'READ') {
      throw new AppError(409, 'STATUS_UNCHANGED', '当前已是已读完状态');
    }
    return;
  }
  if (!STATUS_TRANSITIONS[current].includes(next)) {
    throw new AppError(409, 'INVALID_STATUS_TRANSITION', '不允许执行该状态变更');
  }
}

export function normalizeMoodTags(tags: MoodTag[]): MoodTag[] {
  const unique = [...new Set(tags)];
  if (unique.length < 1 || unique.length > 3) {
    throw new AppError(422, 'VALIDATION_ERROR', '请选择 1 至 3 个情绪标签', {
      moodTags: '请选择 1 至 3 个情绪标签'
    });
  }
  if (unique.some((tag) => !MOOD_TAGS.includes(tag))) {
    throw new AppError(422, 'VALIDATION_ERROR', '包含未知情绪标签', {
      moodTags: '包含未知情绪标签'
    });
  }
  return unique;
}

export function isRestoreWindowOpen(deletedAt: Date | null, now = new Date()): boolean {
  return Boolean(deletedAt && now.getTime() - deletedAt.getTime() <= 24 * 60 * 60 * 1000);
}

export function isStrictlyEditable(editableUntil: Date, now = new Date()): boolean {
  return now.getTime() <= editableUntil.getTime();
}

export function quoteHash(quoteText: string): string {
  return createHash('sha256').update(quoteText, 'utf8').digest('hex');
}

/**
 * 引用摘录：纯空白或空串归一化为 null（无摘录）。
 */
export function normalizeOptionalQuote(value: string): string | null {
  const normalized = value.normalize('NFC').trim();
  return normalized === '' ? null : normalized;
}

export const QUOTE_MAX_LENGTH = 2000;

export type AnchorIssue =
  | 'PAGE_COUNT_CHANGED'
  | 'PAGE_COUNT_CLEARED'
  | 'OUT_OF_RANGE'
  | 'QUOTE_HASH_MISMATCH';

export interface AnchorSnapshot {
  startPage: number;
  endPage: number;
  quoteText: string | null;
  quoteHash: string | null;
  anchorPageCount: number | null;
}

export interface AnchorVerification {
  valid: boolean;
  issues: AnchorIssue[];
  /** 当前总页数；null 表示未填写 */
  currentPageCount: number | null;
  quoteVerified: boolean;
}

/**
 * 校验跨页锚点与引用摘录。
 *
 * 锚点在创建时拍下 `anchorPageCount` 快照：页码或总页数被修改后，快照仍可比对，
 * 校验不会静默通过，也不会让旧引用直接失效——页码超出当前总页数时报告 OUT_OF_RANGE。
 * 摘录完整性以 SHA-256 为准：当前摘录重算哈希与历史哈希不一致即 QUOTE_HASH_MISMATCH。
 */
export function verifyAnchor(
  snapshot: AnchorSnapshot,
  currentPageCount: number | null
): AnchorVerification {
  const issues: AnchorIssue[] = [];
  if (snapshot.anchorPageCount !== null && currentPageCount === null) {
    issues.push('PAGE_COUNT_CLEARED');
  } else if (
    snapshot.anchorPageCount !== null &&
    currentPageCount !== null &&
    snapshot.anchorPageCount !== currentPageCount
  ) {
    issues.push('PAGE_COUNT_CHANGED');
  }
  if (currentPageCount !== null && snapshot.endPage > currentPageCount) {
    issues.push('OUT_OF_RANGE');
  }
  let quoteVerified = true;
  if (snapshot.quoteHash !== null) {
    quoteVerified = snapshot.quoteText !== null && quoteHash(snapshot.quoteText) === snapshot.quoteHash;
    if (!quoteVerified) issues.push('QUOTE_HASH_MISMATCH');
  }
  return { valid: issues.length === 0, issues, currentPageCount, quoteVerified };
}

/** 解析一次批注修订的引用摘录：显式 null/空串清除摘录，undefined 表示保持原值。 */
export function resolveRevisionQuote(
  input: string | null | undefined,
  previous: { quoteText: string | null; quoteHash: string | null }
): { quoteText: string | null; quoteHash: string | null } {
  if (input === undefined) {
    return { quoteText: previous.quoteText, quoteHash: previous.quoteHash };
  }
  if (input === null) return { quoteText: null, quoteHash: null };
  const quoteText = normalizeOptionalQuote(input);
  return quoteText === null
    ? { quoteText: null, quoteHash: null }
    : { quoteText, quoteHash: quoteHash(quoteText) };
}

/**
 * 并发修订提交的内存模型：只有版本号匹配的一次提交可以落库。
 * 返回 true 表示本次提交赢得 CAS；false 表示已被别处抢先修订，应拒绝。
 */
export function commitConcurrentRevision(current: { version: number }, requestedVersion: number): boolean {
  return requestedVersion === current.version;
}
