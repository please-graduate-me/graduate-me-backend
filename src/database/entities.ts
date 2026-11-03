import { User } from './entities/User.entity.js';
import { Account } from './entities/Account.entity.js';
import { Session } from './entities/Session.entity.js';
import { VerificationToken } from './entities/VerificationToken.entity.js';
import { Video } from './entities/Video.entity.js';
import { VideoLike } from './entities/VideoLike.entity.js';
import { Job } from './entities/Job.entity.js';
import { Segment } from './entities/Segment.entity.js';
import { ShareLink } from './entities/ShareLink.entity.js';
import { ShareVisit } from './entities/ShareVisit.entity.js';
import { ShareStart } from './entities/ShareStart.entity.js';
import { Progress } from './entities/Progress.entity.js';
import { SegmentDifficulty } from './entities/SegmentDifficulty.entity.js';
import { SegmentState } from './entities/SegmentState.entity.js';
import { Attempt } from './entities/Attempt.entity.js';

/** API와 마이그레이션이 동일한 엔티티 메타데이터를 사용한다. */
export const entities = [
  User,
  Account,
  Session,
  VerificationToken,
  Video,
  VideoLike,
  Job,
  Segment,
  ShareLink,
  ShareVisit,
  ShareStart,
  Progress,
  SegmentDifficulty,
  SegmentState,
  Attempt,
];
