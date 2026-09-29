import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TRACE_TYPES, type TraceType } from '@paper-book-traces/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError, zodFields } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { isRestoreWindowOpen, normalizeText, validatePageRange, validateSinglePage } from '../../lib/domain.js';
import { buildAnchor, checkAnchor, normalizeAnchorLabel, normalizeQuote } from '../../lib/anchor.js';
import { writeEvent } from '../../lib/events.js';
import { optionalDate, paginationFromQuery, parseId } from '../../lib/http.js';

const optionalReason = (max: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const dogEarCreateSchema = z.object({
  pageNumber: z.number().int().positive(),
  reason: optionalReason(500)
});

const dogEarUpdateSchema = z
  .object({
    pageNumber: z.number().int().positive().optional(),
    reason: optionalReason(500),
    version: z.number().int().positive().optional()
  })
  .refine((value) => value.pageNumber !== undefined || value.reason !== undefined, {
    message: '至少提供一个要更新的字段'
  });

const annotationQuoteSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().max(2000, '引用摘录不能超过 2000 字').nullable().optional()
);

const annotationAnchorLabelSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().max(300, '锚点位置说明不能超过 300 字').nullable().optional()
);

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, '幂等键格式无效')
  .optional();

const annotationCreateSchema = z.object({
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  content: z.string().trim().min(1, '请输入批注').max(5000),
  quote: annotationQuoteSchema,
  anchorLabel: annotationAnchorLabelSchema,
  idempotencyKey: idempotencyKeySchema
});

const annotationUpdateSchema = z
  .object({
    startPage: z.number().int().positive().optional(),
    endPage: z.number().int().positive().optional(),
    content: z.string().trim().min(1).max(5000).optional(),
    quote: annotationQuoteSchema,
    anchorLabel: annotationAnchorLabelSchema,
    idempotencyKey: idempotencyKeySchema,
    version: z.number().int().positive().optional()
  })
  .refine(
    (value) =>
      value.startPage !== undefined ||
      value.endPage !== undefined ||
      value.content !== undefined ||
      value.quote !== undefined ||
      value.anchorLabel !== undefined,
    {
      message: '至少提供一个要更新的字段'
    }
  );

const rereadCreateSchema = z.object({
  pageNumber: z.number().int().positive(),
  reason: optionalReason(1000)
});

const rereadUpdateSchema = z
  .object({
    pageNumber: z.number().int().positive().optional(),
    reason: optionalReason(1000),
    version: z.number().int().positive().optional()
  })
  .refine((value) => value.pageNumber !== undefined || value.reason !== undefined, {
    message: '至少提供一个要更新的字段'
  });

const deleteSchema = z.object({ version: z.number().int().positive().optional() }).optional();

function serializeDogEar(item: {
  id: string;
  bookId: string;
  version: number;
  pageNumber: number;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...item, type: 'DOG_EAR' as const };
}

function serializeAnnotation(
  item: {
    id: string;
    bookId: string;
    version: number;
    startPage: number;
    endPage: number;
    content: string;
    quote: string | null;
    anchorLabel: string | null;
    anchorStart: number | null;
    anchorEnd: number | null;
    anchoredPageCount: number | null;
    anchorHash: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  pageCount: number | null = null
) {
  const base = {
    id: item.id,
    bookId: item.bookId,
    version: item.version,
    startPage: item.startPage,
    endPage: item.endPage,
    content: item.content,
    quote: item.quote,
    anchorLabel: item.anchorLabel,
    anchorStart: item.anchorStart,
    anchorEnd: item.anchorEnd,
    anchoredPageCount: item.anchoredPageCount,
    anchorHash: item.anchorHash,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
  const anchor =
    item.anchorStart !== null && item.anchorEnd !== null && item.anchoredPageCount !== null
      ? checkAnchor(
          {
            anchorStart: item.anchorStart,
            anchorEnd: item.anchorEnd,
            anchoredPageCount: item.anchoredPageCount,
            anchorHash: item.anchorHash,
            quote: item.quote,
            anchorLabel: item.anchorLabel
          },
          { startPage: item.startPage, endPage: item.endPage },
          pageCount
        )
      : null;
  return {
    ...base,
    anchor: anchor
      ? {
          status: anchor.status,
          anchoredPageCount: item.anchoredPageCount,
          expectedStartPage: anchor.expectedStartPage,
          expectedEndPage: anchor.expectedEndPage,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset,
          quoteChanged: anchor.quoteChanged
        }
      : null,
    type: 'ANNOTATION' as const
  };
}

function serializeAnnotationRevision(item: {
  id: string;
  annotationId: string;
  revisionNo: number;
  kind: 'CREATED' | 'REVISED';
  startPage: number;
  endPage: number;
  content: string;
  quote: string | null;
  anchorLabel: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  anchoredPageCount: number | null;
  anchorHash: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}) {
  return {
    id: item.id,
    annotationId: item.annotationId,
    revisionNo: item.revisionNo,
    kind: item.kind,
    startPage: item.startPage,
    endPage: item.endPage,
    content: item.content,
    quote: item.quote,
    anchorLabel: item.anchorLabel,
    anchorStart: item.anchorStart,
    anchorEnd: item.anchorEnd,
    anchoredPageCount: item.anchoredPageCount,
    anchorHash: item.anchorHash,
    createdAt: item.createdAt
  };
}

function serializeRereadMark(item: {
  id: string;
  bookId: string;
  version: number;
  pageNumber: number;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...item, type: 'REREAD_MARK' as const };
}

function assertVersion(current: number, requested?: number): void {
  if (requested && requested !== current) {
    throw new AppError(409, 'STALE_WRITE', '记录已在其他位置被修改，请刷新后重试');
  }
}

function eventSummary(value: string | null | undefined): string {
  return (value ? normalizeText(value).slice(0, 120) : '');
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function annotationRevisionInput(data: {
  startPage: number;
  endPage: number;
  content: string;
  quote: string | null;
  anchorLabel: string | null;
  anchor: ReturnType<typeof buildAnchor>;
}) {
  return {
    startPage: data.startPage,
    endPage: data.endPage,
    content: data.content,
    quote: data.quote,
    anchorLabel: data.anchorLabel,
    anchorStart: data.anchor.anchorStart,
    anchorEnd: data.anchor.anchorEnd,
    anchoredPageCount: data.anchor.anchoredPageCount,
    anchorHash: data.anchor.anchorHash
  };
}

export const traceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/books/:bookId/traces', async (request) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');

    const query = request.query as Record<string, unknown>;
    const type = typeof query.type === 'string' && query.type !== 'ALL' ? query.type : undefined;
    if (type && !TRACE_TYPES.includes(type as TraceType)) {
      throw new AppError(422, 'VALIDATION_ERROR', '痕迹类型无效');
    }
    const pageNumber = query.pageNumber === undefined ? undefined : Number(query.pageNumber);
    if (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
      throw new AppError(422, 'VALIDATION_ERROR', '页码无效');
    }
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const from = optionalDate(query.from, 'from');
    const to = optionalDate(query.to, 'to');
    const dateFilter = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {})
    };
    const { page, pageSize } = paginationFromQuery(request);

    const [dogEars, annotations, rereadMarks] = await Promise.all([
      !type || type === 'DOG_EAR'
        ? prisma.dogEar.findMany({
            where: {
              userId,
              bookId,
              deletedAt: null,
              ...(pageNumber ? { pageNumber } : {}),
              ...(keyword ? { reason: { contains: keyword, mode: 'insensitive' } } : {}),
              ...(from || to ? { createdAt: dateFilter } : {})
            },
            orderBy: { createdAt: 'desc' }
          })
        : [],
      !type || type === 'ANNOTATION'
        ? prisma.annotation.findMany({
            where: {
              userId,
              bookId,
              deletedAt: null,
              ...(pageNumber ? { startPage: { lte: pageNumber }, endPage: { gte: pageNumber } } : {}),
              ...(keyword
                ? {
                    OR: [
                      { content: { contains: keyword, mode: 'insensitive' } },
                      { quote: { contains: keyword, mode: 'insensitive' } },
                      { anchorLabel: { contains: keyword, mode: 'insensitive' } }
                    ]
                  }
                : {}),
              ...(from || to ? { createdAt: dateFilter } : {})
            },
            orderBy: { createdAt: 'desc' }
          })
        : [],
      !type || type === 'REREAD_MARK'
        ? prisma.rereadMark.findMany({
            where: {
              userId,
              bookId,
              deletedAt: null,
              ...(pageNumber ? { pageNumber } : {}),
              ...(keyword ? { reason: { contains: keyword, mode: 'insensitive' } } : {}),
              ...(from || to ? { createdAt: dateFilter } : {})
            },
            orderBy: { createdAt: 'desc' }
          })
        : []
    ]);

    const merged = [
      ...dogEars.map(serializeDogEar),
      ...annotations.map((annotation) => serializeAnnotation(annotation, book.pageCount)),
      ...rereadMarks.map(serializeRereadMark)
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = merged.length;
    const items = merged.slice((page - 1) * pageSize, page * pageSize);
    return { items, pagination: { page, pageSize, total } };
  });

  app.post('/books/:bookId/dog-ears', async (request, reply) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const parsed = dogEarCreateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '折角信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
    validateSinglePage(parsed.data.pageNumber, book.pageCount);
    const reason = parsed.data.reason ? normalizeText(parsed.data.reason) : null;
    const existing = await prisma.dogEar.findFirst({
      where: { bookId, pageNumber: parsed.data.pageNumber, deletedAt: null }
    });
    if (existing) {
      if ((existing.reason ?? '') === (reason ?? '')) {
        return reply.status(200).send({ dogEar: serializeDogEar(existing), idempotent: true });
      }
      throw new AppError(409, 'DOG_EAR_EXISTS', '该页已有折角，请编辑原记录');
    }

    try {
      const dogEar = await prisma.$transaction(async (tx) => {
        const created = await tx.dogEar.create({
          data: { userId, bookId, pageNumber: parsed.data.pageNumber, reason }
        });
        await writeEvent(tx, {
          userId,
          bookId,
          entityType: 'DOG_EAR',
          entityId: created.id,
          action: 'CREATED',
          payload: { pageNumber: created.pageNumber, reason: eventSummary(created.reason) }
        });
        return created;
      });
      return reply.status(201).send({ dogEar: serializeDogEar(dogEar) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DOG_EAR_EXISTS', '该页已有折角，请编辑原记录');
      }
      throw error;
    }
  });

  app.patch('/dog-ears/:dogEarId', async (request) => {
    const id = parseId((request.params as { dogEarId: string }).dogEarId, 'dogEarId');
    const parsed = dogEarUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '折角信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const existing = await prisma.dogEar.findFirst({
      where: { id, userId, deletedAt: null },
      include: { book: true }
    });
    if (!existing || existing.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '折角不存在');
    assertVersion(existing.version, parsed.data.version);
    const nextPage = parsed.data.pageNumber ?? existing.pageNumber;
    validateSinglePage(nextPage, existing.book.pageCount);
    const nextReason =
      parsed.data.reason === undefined
        ? existing.reason
        : parsed.data.reason
          ? normalizeText(parsed.data.reason)
          : null;
    if (nextPage !== existing.pageNumber) {
      const duplicate = await prisma.dogEar.findFirst({
        where: { bookId: existing.bookId, pageNumber: nextPage, deletedAt: null, id: { not: id } }
      });
      if (duplicate) throw new AppError(409, 'DOG_EAR_EXISTS', '目标页已有折角');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.dogEar.updateMany({
        where: { id, userId, version: existing.version, deletedAt: null },
        data: {
          pageNumber: nextPage,
          reason: nextReason,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '折角已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'DOG_EAR',
        entityId: id,
        action: 'UPDATED',
        payload: { pageNumber: nextPage, reason: eventSummary(nextReason) }
      });
      return tx.dogEar.findUniqueOrThrow({ where: { id } });
    });
    return { dogEar: serializeDogEar(updated) };
  });

  app.delete('/dog-ears/:dogEarId', async (request, reply) => {
    const id = parseId((request.params as { dogEarId: string }).dogEarId, 'dogEarId');
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const existing = await prisma.dogEar.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '折角不存在');
    assertVersion(existing.version, parsed.data?.version);
    await prisma.$transaction(async (tx) => {
      const result = await tx.dogEar.updateMany({
        where: { id, userId, deletedAt: null, version: existing.version },
        data: { deletedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '折角已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'DOG_EAR',
        entityId: id,
        action: 'DELETED',
        payload: { pageNumber: existing.pageNumber }
      });
    });
    return reply.status(204).send();
  });

  app.post('/dog-ears/:dogEarId/restore', async (request) => {
    const id = parseId((request.params as { dogEarId: string }).dogEarId, 'dogEarId');
    const userId = currentUser(request).id;
    const existing = await prisma.dogEar.findFirst({ where: { id, userId }, include: { book: true } });
    if (!existing || !existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除折角不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }
    if (existing.book.deletedAt) throw new AppError(409, 'BOOK_DELETED', '所属书目已删除');
    const duplicate = await prisma.dogEar.findFirst({
      where: { bookId: existing.bookId, pageNumber: existing.pageNumber, deletedAt: null, id: { not: id } }
    });
    if (duplicate) throw new AppError(409, 'DOG_EAR_EXISTS', '该页已有有效折角，无法恢复');
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.dogEar.update({
        where: { id },
        data: { deletedAt: null, version: { increment: 1 } }
      });
      await writeEvent(tx, {
        userId,
        bookId: value.bookId,
        entityType: 'DOG_EAR',
        entityId: id,
        action: 'RESTORED',
        payload: { pageNumber: value.pageNumber }
      });
      return value;
    });
    return { dogEar: serializeDogEar(restored) };
  });

  app.post('/books/:bookId/annotations', async (request, reply) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const parsed = annotationCreateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '批注信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
    validatePageRange(parsed.data.startPage, parsed.data.endPage, book.pageCount);
    const content = normalizeText(parsed.data.content);
    const quote = normalizeQuote(parsed.data.quote) ?? null;
    const anchorLabel = normalizeAnchorLabel(parsed.data.anchorLabel) ?? null;
    const anchor = buildAnchor(
      {
        startPage: parsed.data.startPage,
        endPage: parsed.data.endPage,
        quote,
        anchorLabel
      },
      book.pageCount
    );

    // 同一个 idempotencyKey 下的并发创建只落一条：先查是否已由重复请求写入。
    if (parsed.data.idempotencyKey) {
      const replayed = await prisma.annotationRevision.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.data.idempotencyKey } },
        include: { annotation: { include: { book: true } } }
      });
      if (replayed) {
        if (replayed.annotation.deletedAt || replayed.annotation.book.deletedAt) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_USED', '该幂等键已被使用，请重新发起一次新操作');
        }
        return reply
          .status(200)
          .send({ annotation: serializeAnnotation(replayed.annotation, replayed.annotation.book.pageCount), idempotent: true });
      }
    }

    try {
      const annotation = await prisma.$transaction(async (tx) => {
        const created = await tx.annotation.create({
          data: {
            userId,
            bookId,
            startPage: parsed.data.startPage,
            endPage: parsed.data.endPage,
            content,
            quote,
            anchorLabel,
            ...anchor
          }
        });
        await tx.annotationRevision.create({
          data: {
            userId,
            bookId,
            annotationId: created.id,
            revisionNo: 1,
            kind: 'CREATED',
            idempotencyKey: parsed.data.idempotencyKey ?? null,
            ...annotationRevisionInput({ startPage: created.startPage, endPage: created.endPage, content, quote, anchorLabel, anchor })
          }
        });
        await writeEvent(tx, {
          userId,
          bookId,
          entityType: 'ANNOTATION',
          entityId: created.id,
          action: 'CREATED',
          payload: {
            startPage: created.startPage,
            endPage: created.endPage,
            summary: eventSummary(created.content),
            quote: eventSummary(created.quote),
            anchoredPageCount: created.anchoredPageCount
          }
        });
        return created;
      });
      return reply.status(201).send({ annotation: serializeAnnotation(annotation, book.pageCount) });
    } catch (error) {
      if (isUniqueConflict(error) && parsed.data.idempotencyKey) {
        const replayed = await prisma.annotationRevision.findUniqueOrThrow({
          where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.data.idempotencyKey } },
          include: { annotation: { include: { book: true } } }
        });
        if (replayed.annotation.deletedAt || replayed.annotation.book.deletedAt) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_USED', '该幂等键已被使用，请重新发起一次新操作');
        }
        return reply
          .status(200)
          .send({ annotation: serializeAnnotation(replayed.annotation, replayed.annotation.book.pageCount), idempotent: true });
      }
      throw error;
    }
  });

  app.patch('/annotations/:annotationId', async (request) => {
    const id = parseId((request.params as { annotationId: string }).annotationId, 'annotationId');
    const parsed = annotationUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '批注信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // 锁定批注行，让并发修订串行化；只有拿到锁的请求能写入修订记录。
        await tx.$queryRaw`SELECT id FROM annotations WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        const existing = await tx.annotation.findFirst({
          where: { id, userId, deletedAt: null },
          include: { book: true }
        });
        if (!existing || existing.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '批注不存在');

        // 同一幂等键的重复修订直接返回已保存版本，修订历史只保留一次。
        if (parsed.data.idempotencyKey) {
          const replayed = await tx.annotationRevision.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.data.idempotencyKey } }
          });
          if (replayed) {
            if (replayed.annotationId !== id) {
              throw new AppError(409, 'IDEMPOTENCY_KEY_USED', '该幂等键已被使用，请重新发起一次新操作');
            }
            return { annotation: existing, pageCount: existing.book.pageCount, idempotent: true as const };
          }
        }

        assertVersion(existing.version, parsed.data.version);
        const startPage = parsed.data.startPage ?? existing.startPage;
        const endPage = parsed.data.endPage ?? existing.endPage;
        validatePageRange(startPage, endPage, existing.book.pageCount);
        const content =
          parsed.data.content !== undefined ? normalizeText(parsed.data.content) : existing.content;
        const quote =
          parsed.data.quote === undefined ? existing.quote : (normalizeQuote(parsed.data.quote) ?? null);
        const anchorLabel =
          parsed.data.anchorLabel === undefined
            ? existing.anchorLabel
            : (normalizeAnchorLabel(parsed.data.anchorLabel) ?? null);
        const anchor = buildAnchor({ startPage, endPage, quote, anchorLabel }, existing.book.pageCount);

        const result = await tx.annotation.updateMany({
          where: { id, userId, deletedAt: null, version: existing.version },
          data: {
            startPage,
            endPage,
            content,
            quote,
            anchorLabel,
            ...anchor,
            version: { increment: 1 }
          }
        });
        if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '批注已在其他位置被修改');

        const revisionNo = existing.version + 1;
        await tx.annotationRevision.create({
          data: {
            userId,
            bookId: existing.bookId,
            annotationId: id,
            revisionNo,
            kind: 'REVISED',
            idempotencyKey: parsed.data.idempotencyKey ?? null,
            ...annotationRevisionInput({ startPage, endPage, content, quote, anchorLabel, anchor })
          }
        });
        await writeEvent(tx, {
          userId,
          bookId: existing.bookId,
          entityType: 'ANNOTATION',
          entityId: id,
          action: 'UPDATED',
          payload: {
            startPage,
            endPage,
            summary: eventSummary(content),
            quote: eventSummary(quote),
            anchoredPageCount: anchor.anchoredPageCount,
            revisionNo
          }
        });
        return { annotation: await tx.annotation.findUniqueOrThrow({ where: { id } }), pageCount: existing.book.pageCount, idempotent: false as const };
      });
      return {
        annotation: serializeAnnotation(updated.annotation, updated.pageCount),
        ...(updated.idempotent ? { idempotent: true } : {})
      };
    } catch (error) {
      if (isUniqueConflict(error) && parsed.data.idempotencyKey) {
        const replayed = await prisma.annotationRevision.findUniqueOrThrow({
          where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.data.idempotencyKey } },
          include: { annotation: { include: { book: true } } }
        });
        if (replayed.annotation.deletedAt || replayed.annotation.book.deletedAt || replayed.annotationId !== id) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_USED', '该幂等键已被使用，请重新发起一次新操作');
        }
        return { annotation: serializeAnnotation(replayed.annotation, replayed.annotation.book.pageCount), idempotent: true };
      }
      throw error;
    }
  });

  app.get('/annotations/:annotationId/revisions', async (request) => {
    const id = parseId((request.params as { annotationId: string }).annotationId, 'annotationId');
    const userId = currentUser(request).id;
    const existing = await prisma.annotation.findFirst({
      where: { id, userId, deletedAt: null },
      include: { book: true }
    });
    if (!existing || existing.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '批注不存在');
    const revisions = await prisma.annotationRevision.findMany({
      where: { annotationId: id },
      orderBy: { revisionNo: 'asc' }
    });
    return {
      items: revisions.map((revision) => {
        const serialized = serializeAnnotationRevision(revision);
        // 用当前页码与当前摘录校验每个历史快照：旧引用与当前摘录是否一致可追溯。
        const anchorCheck = checkAnchor(
          {
            anchorStart: revision.anchorStart,
            anchorEnd: revision.anchorEnd,
            anchoredPageCount: revision.anchoredPageCount,
            anchorHash: revision.anchorHash,
            quote: revision.quote,
            anchorLabel: revision.anchorLabel
          },
          { startPage: existing.startPage, endPage: existing.endPage },
          existing.book.pageCount
        );
        return {
          ...serialized,
          anchor: anchorCheck
            ? {
                status: anchorCheck.status === 'MATCH' && revision.quote !== existing.quote ? 'DRIFTED' : anchorCheck.status,
                expectedStartPage: anchorCheck.expectedStartPage,
                expectedEndPage: anchorCheck.expectedEndPage,
                startOffset: anchorCheck.startOffset,
                endOffset: anchorCheck.endOffset
              }
            : null,
          quoteMatchesCurrent: revision.quote === existing.quote
        };
      })
    };
  });

  app.delete('/annotations/:annotationId', async (request, reply) => {
    const id = parseId((request.params as { annotationId: string }).annotationId, 'annotationId');
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const existing = await prisma.annotation.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '批注不存在');
    assertVersion(existing.version, parsed.data?.version);
    await prisma.$transaction(async (tx) => {
      const result = await tx.annotation.updateMany({
        where: { id, userId, deletedAt: null, version: existing.version },
        data: { deletedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '批注已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'ANNOTATION',
        entityId: id,
        action: 'DELETED',
        payload: { startPage: existing.startPage, endPage: existing.endPage }
      });
    });
    return reply.status(204).send();
  });

  app.post('/annotations/:annotationId/restore', async (request) => {
    const id = parseId((request.params as { annotationId: string }).annotationId, 'annotationId');
    const userId = currentUser(request).id;
    const existing = await prisma.annotation.findFirst({ where: { id, userId }, include: { book: true } });
    if (!existing || !existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除批注不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }
    if (existing.book.deletedAt) throw new AppError(409, 'BOOK_DELETED', '所属书目已删除');
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.annotation.update({
        where: { id },
        data: { deletedAt: null, version: { increment: 1 } }
      });
      await writeEvent(tx, {
        userId,
        bookId: value.bookId,
        entityType: 'ANNOTATION',
        entityId: id,
        action: 'RESTORED',
        payload: { startPage: value.startPage, endPage: value.endPage }
      });
      return value;
    });
    return { annotation: serializeAnnotation(restored, existing.book.pageCount) };
  });

  app.post('/books/:bookId/reread-marks', async (request, reply) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const parsed = rereadCreateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '重读信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
    validateSinglePage(parsed.data.pageNumber, book.pageCount);
    const mark = await prisma.$transaction(async (tx) => {
      const created = await tx.rereadMark.create({
        data: {
          userId,
          bookId,
          pageNumber: parsed.data.pageNumber,
          reason: parsed.data.reason ? normalizeText(parsed.data.reason) : null
        }
      });
      await writeEvent(tx, {
        userId,
        bookId,
        entityType: 'REREAD_MARK',
        entityId: created.id,
        action: 'CREATED',
        payload: { pageNumber: created.pageNumber, reason: eventSummary(created.reason) }
      });
      return created;
    });
    return reply.status(201).send({ rereadMark: serializeRereadMark(mark) });
  });

  app.patch('/reread-marks/:rereadMarkId', async (request) => {
    const id = parseId((request.params as { rereadMarkId: string }).rereadMarkId, 'rereadMarkId');
    const parsed = rereadUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '重读信息无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const existing = await prisma.rereadMark.findFirst({
      where: { id, userId, deletedAt: null },
      include: { book: true }
    });
    if (!existing || existing.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '重读记录不存在');
    assertVersion(existing.version, parsed.data.version);
    const pageNumber = parsed.data.pageNumber ?? existing.pageNumber;
    validateSinglePage(pageNumber, existing.book.pageCount);
    const reason =
      parsed.data.reason === undefined
        ? existing.reason
        : parsed.data.reason
          ? normalizeText(parsed.data.reason)
          : null;
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.rereadMark.updateMany({
        where: { id, userId, deletedAt: null, version: existing.version },
        data: { pageNumber, reason, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '重读记录已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'REREAD_MARK',
        entityId: id,
        action: 'UPDATED',
        payload: { pageNumber, reason: eventSummary(reason) }
      });
      return tx.rereadMark.findUniqueOrThrow({ where: { id } });
    });
    return { rereadMark: serializeRereadMark(updated) };
  });

  app.delete('/reread-marks/:rereadMarkId', async (request, reply) => {
    const id = parseId((request.params as { rereadMarkId: string }).rereadMarkId, 'rereadMarkId');
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    const userId = currentUser(request).id;
    const existing = await prisma.rereadMark.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '重读记录不存在');
    assertVersion(existing.version, parsed.data?.version);
    await prisma.$transaction(async (tx) => {
      const result = await tx.rereadMark.updateMany({
        where: { id, userId, deletedAt: null, version: existing.version },
        data: { deletedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '重读记录已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'REREAD_MARK',
        entityId: id,
        action: 'DELETED',
        payload: { pageNumber: existing.pageNumber }
      });
    });
    return reply.status(204).send();
  });

  app.post('/reread-marks/:rereadMarkId/restore', async (request) => {
    const id = parseId((request.params as { rereadMarkId: string }).rereadMarkId, 'rereadMarkId');
    const userId = currentUser(request).id;
    const existing = await prisma.rereadMark.findFirst({ where: { id, userId }, include: { book: true } });
    if (!existing || !existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除重读记录不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }
    if (existing.book.deletedAt) throw new AppError(409, 'BOOK_DELETED', '所属书目已删除');
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.rereadMark.update({
        where: { id },
        data: { deletedAt: null, version: { increment: 1 } }
      });
      await writeEvent(tx, {
        userId,
        bookId: value.bookId,
        entityType: 'REREAD_MARK',
        entityId: id,
        action: 'RESTORED',
        payload: { pageNumber: value.pageNumber }
      });
      return value;
    });
    return { rereadMark: serializeRereadMark(restored) };
  });
};
