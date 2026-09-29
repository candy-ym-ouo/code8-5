import type { ActivityAction, ActivityEntityType, BookStatus, MoodTag, TraceType } from '@paper-book-traces/shared';

export type { ActivityAction, ActivityEntityType, BookStatus, MoodTag, TraceType };

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface TraceSummary {
  dogEars: number;
  annotations: number;
  rereadMarks: number;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publicationYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  status: BookStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  traceSummary: TraceSummary;
  hasCompletionReflection?: boolean;
  lastTraceAt?: string | null;
  reflections?: Reflection[];
}

export interface DogEar {
  id: string;
  bookId: string;
  type: 'DOG_EAR';
  pageNumber: number;
  reason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AnchorIssue =
  | 'PAGE_COUNT_CHANGED'
  | 'PAGE_COUNT_CLEARED'
  | 'OUT_OF_RANGE'
  | 'QUOTE_HASH_MISMATCH';

export interface AnchorVerification {
  valid: boolean;
  issues: AnchorIssue[];
  currentPageCount: number | null;
  quoteVerified: boolean;
}

export interface Annotation {
  id: string;
  bookId: string;
  type: 'ANNOTATION';
  startPage: number;
  endPage: number;
  content: string;
  quote: string;
  quoteHash: string | null;
  anchorPageCount: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRevision {
  id: string;
  annotationId: string;
  revisionNumber: number;
  startPage: number;
  endPage: number;
  content: string;
  quote: string;
  quoteHash: string | null;
  anchorPageCount: number | null;
  createdAt: string;
  verification: AnchorVerification;
}

export type AnnotationVerificationResult = AnchorVerification & {
  annotationId: string;
  anchorPageCount: number | null;
  checkedAt: string;
};

export interface RereadMark {
  id: string;
  bookId: string;
  type: 'REREAD_MARK';
  pageNumber: number;
  reason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Trace = DogEar | Annotation | RereadMark;

export interface Reflection {
  id: string;
  bookId: string;
  completionRound: number;
  moodTags: MoodTag[];
  text: string;
  completedAt: string;
  editableUntil: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  bookId: string | null;
  bookTitle: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export const MOOD_LABELS: Record<MoodTag, string> = {
  MOVED: '被触动',
  CALM: '平静',
  JOYFUL: '喜悦',
  SAD: '难过',
  ANGRY: '愤怒',
  CONFUSED: '困惑',
  RELIEVED: '释然',
  EMPTY: '空落',
  CHANGED: '被改变'
};

export const STATUS_LABELS: Record<BookStatus, string> = {
  TO_READ: '想读',
  READING: '阅读中',
  READ: '已读完',
  PAUSED: '暂时搁置',
  ABANDONED: '停止阅读'
};

export const TRACE_LABELS: Record<TraceType, string> = {
  DOG_EAR: '折角',
  ANNOTATION: '批注',
  REREAD_MARK: '重读页'
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  CREATED: '创建',
  UPDATED: '修改',
  DELETED: '删除',
  RESTORED: '恢复',
  STATUS_CHANGED: '状态变化',
  COMPLETED: '读完'
};

export const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  BOOK: '书目',
  DOG_EAR: '折角',
  ANNOTATION: '批注',
  REREAD_MARK: '重读页',
  COMPLETION_REFLECTION: '完成感受'
};

export const ANCHOR_ISSUE_LABELS: Record<AnchorIssue, string> = {
  PAGE_COUNT_CHANGED: '总页数与锚点创建时不同',
  PAGE_COUNT_CLEARED: '总页数已被清空',
  OUT_OF_RANGE: '锚点页码超出当前总页数',
  QUOTE_HASH_MISMATCH: '引用摘录与保存时不一致'
};
