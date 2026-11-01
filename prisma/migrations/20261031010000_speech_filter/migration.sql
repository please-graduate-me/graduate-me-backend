-- 말소리 검사 결과와 비파괴 구절 제외 상태를 저장한다.
ALTER TABLE "Video" ADD COLUMN "speechRegions" JSONB,
ADD COLUMN "speechFilterVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "speechCheckedAt" TIMESTAMP(3);
ALTER TABLE "Segment" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "exclusionReason" TEXT;
