import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { env } from '../../config/env.js';

function notDeletedFilter(includeDeleted: boolean) {
  return includeDeleted ? {} : { deletedAt: null };
}

export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/exports/me', async (request, reply) => {
    const userId = currentUser(request).id;
    const query = request.query as Record<string, unknown>;
    const includeDeleted = String(query.includeDeleted ?? 'false').toLowerCase() === 'true';
    const filter = notDeletedFilter(includeDeleted);

    const [booksCount, dogEarsCount, annotationsCount, annotationRevisionsCount, rereadCount, reflectionsCount, eventsCount] =
      await Promise.all([
        prisma.book.count({ where: { userId, ...filter } }),
        prisma.dogEar.count({ where: { userId, ...filter } }),
        prisma.annotation.count({ where: { userId, ...filter } }),
        prisma.annotationRevision.count({ where: { userId } }),
        prisma.rereadMark.count({ where: { userId, ...filter } }),
        prisma.completionReflection.count({ where: { userId, ...filter } }),
        prisma.activityEvent.count({ where: { userId } })
      ]);
    const totalRows =
      booksCount + dogEarsCount + annotationsCount + annotationRevisionsCount + rereadCount + reflectionsCount + eventsCount;
    if (totalRows > env.EXPORT_MAX_ROWS) {
      throw new AppError(413, 'EXPORT_TOO_LARGE', `导出数据超过 ${env.EXPORT_MAX_ROWS} 行限制`);
    }

    const [user, books, dogEars, annotations, annotationRevisions, rereadMarks, reflections, activityEvents] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        prisma.book.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
        prisma.dogEar.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
        prisma.annotation.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
        prisma.annotationRevision.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
          omit: { idempotencyKey: true }
        }),
        prisma.rereadMark.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
        prisma.completionReflection.findMany({ where: { userId, ...filter }, orderBy: { createdAt: 'asc' } }),
        prisma.activityEvent.findMany({ where: { userId }, orderBy: { occurredAt: 'asc' } })
      ]);
    const exportedAt = new Date();
    const payload = {
      schemaVersion: 2,
      exportedAt: exportedAt.toISOString(),
      includeDeleted,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      books,
      dogEars,
      annotations,
      annotationRevisions,
      rereadMarks,
      reflections,
      activityEvents
    };
    const date = exportedAt.toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="paper-book-traces-${date}.json"`);
    return reply.send(JSON.stringify(payload, null, 2));
  });
};
