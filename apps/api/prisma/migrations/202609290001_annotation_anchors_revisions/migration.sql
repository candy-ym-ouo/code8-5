-- CreateEnum
CREATE TYPE "AnnotationRevisionKind" AS ENUM ('CREATED', 'REVISED');

-- AlterTable
ALTER TABLE "annotations"
    ADD COLUMN "quote" VARCHAR(2000),
    ADD COLUMN "anchor_label" VARCHAR(300),
    ADD COLUMN "anchor_start" INTEGER,
    ADD COLUMN "anchor_end" INTEGER,
    ADD COLUMN "anchored_page_count" INTEGER,
    ADD COLUMN "anchor_hash" CHAR(64);

-- CreateTable
CREATE TABLE "annotation_revisions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "annotation_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "kind" "AnnotationRevisionKind" NOT NULL,
    "start_page" INTEGER NOT NULL,
    "end_page" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "quote" VARCHAR(2000),
    "anchor_label" VARCHAR(300),
    "anchor_start" INTEGER,
    "anchor_end" INTEGER,
    "anchored_page_count" INTEGER,
    "anchor_hash" CHAR(64),
    "idempotency_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "annotation_revisions_user_id_idempotency_key_key"
    ON "annotation_revisions" ("user_id", "idempotency_key");

CREATE INDEX "annotation_revisions_annotation_id_revision_no_idx"
    ON "annotation_revisions" ("annotation_id", "revision_no");

CREATE INDEX "annotation_revisions_user_id_created_at_idx"
    ON "annotation_revisions" ("user_id", "created_at");

ALTER TABLE "annotation_revisions"
    ADD CONSTRAINT "annotation_revisions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "annotation_revisions"
    ADD CONSTRAINT "annotation_revisions_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "annotation_revisions"
    ADD CONSTRAINT "annotation_revisions_annotation_id_fkey"
    FOREIGN KEY ("annotation_id") REFERENCES "annotations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
