CREATE TABLE "ShareLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "videoId" TEXT NOT NULL REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "segmentId" TEXT REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "creatorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "ShareLink_createdAt_idx" ON "ShareLink"("createdAt");
CREATE INDEX "ShareLink_creatorId_idx" ON "ShareLink"("creatorId");
CREATE INDEX "ShareLink_videoId_idx" ON "ShareLink"("videoId");
CREATE TABLE "ShareVisit" (
  "shareId" TEXT NOT NULL REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "visitId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("shareId", "visitId")
);
CREATE INDEX "ShareVisit_createdAt_idx" ON "ShareVisit"("createdAt");
CREATE TABLE "ShareStart" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shareId" TEXT NOT NULL REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ShareStart_shareId_userId_key" ON "ShareStart"("shareId", "userId");
CREATE INDEX "ShareStart_createdAt_idx" ON "ShareStart"("createdAt");
