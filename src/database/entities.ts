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
import { Material } from './entities/Material.entity.js';
import { Expression } from './entities/Expression.entity.js';
import { LearningQuestion } from './entities/LearningQuestion.entity.js';
import { QuestionMessage } from './entities/QuestionMessage.entity.js';
import { HelperProfile } from './entities/HelperProfile.entity.js';
import { ReviewRequest } from './entities/ReviewRequest.entity.js';
import { ReviewEvent } from './entities/ReviewEvent.entity.js';
import { PracticeAttempt } from './entities/PracticeAttempt.entity.js';
import { LearningArtifact } from './entities/LearningArtifact.entity.js';
import { ArtifactRevision } from './entities/ArtifactRevision.entity.js';
import { AIOperation } from './entities/AIOperation.entity.js';
import { AIUsage } from './entities/AIUsage.entity.js';
import { AIConversation } from './entities/AIConversation.entity.js';
import { AIMessage } from './entities/AIMessage.entity.js';
import { ExerciseAttempt } from './entities/ExerciseAttempt.entity.js';
import { ExerciseState } from './entities/ExerciseState.entity.js';
import { Annotation } from './entities/Annotation.entity.js';
import { ExcerptShare } from './entities/ExcerptShare.entity.js';
import { MaterialAccess } from './entities/MaterialAccess.entity.js';
import { MaterialReading } from './entities/MaterialReading.entity.js';
import { SourceRevision } from './entities/SourceRevision.entity.js';
import { MaterialVersion } from './entities/MaterialVersion.entity.js';

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
  Material,
  Expression,
  LearningQuestion,
  QuestionMessage,
  HelperProfile,
  ReviewRequest,
  ReviewEvent,
  PracticeAttempt,
  LearningArtifact,
  ArtifactRevision,
  AIOperation,
  AIUsage,
  AIConversation,
  AIMessage,
  ExerciseAttempt,
  ExerciseState,
  Annotation,
  ExcerptShare,
  MaterialAccess,
  MaterialReading,
  SourceRevision,
  MaterialVersion,
];
