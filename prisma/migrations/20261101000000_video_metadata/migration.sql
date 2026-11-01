ALTER TABLE "Video" ADD COLUMN "downloadedAt" TIMESTAMP(3);
ALTER TABLE "Video" ADD COLUMN "category" TEXT, ADD COLUMN "youtubeCategoryId" TEXT;

CREATE TABLE "VideoLike" (
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoLike_pkey" PRIMARY KEY ("userId", "videoId"),
    CONSTRAINT "VideoLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoLike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VideoLike_videoId_idx" ON "VideoLike"("videoId");
