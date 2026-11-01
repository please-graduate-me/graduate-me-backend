ALTER TABLE "Progress" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE TABLE "SegmentDifficulty" (
    "progressId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentDifficulty_pkey" PRIMARY KEY ("progressId", "segmentId"),
    CONSTRAINT "SegmentDifficulty_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "Progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SegmentDifficulty_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
