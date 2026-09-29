-- AlterTable: 批注增加跨页锚点快照与引用摘录字段
ALTER TABLE "annotations"
  ADD COLUMN "quote_text" TEXT,
  ADD COLUMN "quote_hash" CHAR(64),
  ADD COLUMN "anchor_page_count" INTEGER;

-- CreateTable: 批注修订快照，旧引用与当前摘录均可追溯
CREATE TABLE "annotation_revisions" (
    "id" UUID NOT NULL,
    "annotation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "start_page" INTEGER NOT NULL,
    "end_page" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "quote_text" TEXT,
    "quote_hash" CHAR(64),
    "anchor_page_count" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "annotation_revisions_annotation_id_revision_number_key"
  ON "annotation_revisions"("annotation_id", "revision_number");

CREATE INDEX "annotation_revisions_book_id_revision_number_idx"
  ON "annotation_revisions"("book_id", "revision_number");

-- AddForeignKey
ALTER TABLE "annotation_revisions"
  ADD CONSTRAINT "annotation_revisions_annotation_id_fkey"
  FOREIGN KEY ("annotation_id") REFERENCES "annotations"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "annotation_revisions"
  ADD CONSTRAINT "annotation_revisions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "annotation_revisions"
  ADD CONSTRAINT "annotation_revisions_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "books"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill: 为既有批注补齐第 1 版修订快照，锚点总页数以所属书目当前值为准
INSERT INTO "annotation_revisions" (
  "id",
  "annotation_id",
  "user_id",
  "book_id",
  "revision_number",
  "start_page",
  "end_page",
  "content",
  "quote_text",
  "quote_hash",
  "anchor_page_count",
  "created_at"
)
SELECT
  gen_random_uuid(),
  a."id",
  a."user_id",
  a."book_id",
  1,
  a."start_page",
  a."end_page",
  a."content",
  a."quote_text",
  a."quote_hash",
  b."page_count",
  a."created_at"
FROM "annotations" a
JOIN "books" b ON b."id" = a."book_id";
