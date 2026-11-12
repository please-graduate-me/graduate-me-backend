import { LearningGrowth1800000001800 } from './migrations/1800000001800-learning-growth.js';
import { AdminCredentials1800000001700 } from './migrations/1800000001700-admin-credentials.js';
import { CommunityHelpersAdmin1800000001600 } from './migrations/1800000001600-community-helpers-admin.js';
import { MaterialAnalysis1800000001500 } from './migrations/1800000001500-material-analysis.js';
import { CourseOwnerPreservation1800000001400 } from './migrations/1800000001400-course-owner-preservation.js';
import { VideoPlayback1800000001300 } from './migrations/1800000001300-video-playback.js';
import { CommunityReports1800000001200 } from './migrations/1800000001200-community-reports.js';
import { RecommendationEvents1800000001100 } from './migrations/1800000001100-recommendation-events.js';
import { LearningExtensions1800000001000 } from './migrations/1800000001000-learning-extensions.js';
import { MaterialRegistration1794223000600 } from './migrations/1794223000600-material-registration.js';
import { AIMessageProvider1794223000500 } from './migrations/1794223000500-ai-message-provider.js';
import { MaterialOcr1794223000300 } from './migrations/1794223000300-material-ocr.js';
import { OcrProvider1794223000400 } from './migrations/1794223000400-ocr-provider.js';
import { ConversationEvidence1794223000200 } from './migrations/1794223000200-conversation-evidence.js';
import { RemoveAudioProcessing1794146400000 } from './migrations/1794146400000-remove-audio-processing.js';
import { LearningWorkspace1794222000000 } from './migrations/1794222000000-learning-workspace.js';
import { LearningAI1794223000000 } from './migrations/1794223000000-learning-ai.js';
import { MaterialVersions1794223000100 } from './migrations/1794223000100-material-versions.js';
import { VideoLearningPolicy1794222000200 } from './migrations/1794222000200-video-learning-policy.js';
import { NormalizeDefaults1793664000002 } from './migrations/1793664000002-normalize-defaults.js';
import { Schema1793404800000 } from './migrations/1793404800000-schema.js';
import { Schema1793408400000 } from './migrations/1793408400000-schema.js';
import { Schema1793491200000 } from './migrations/1793491200000-schema.js';
import { Schema1793494800000 } from './migrations/1793494800000-schema.js';
import { Schema1793498400000 } from './migrations/1793498400000-schema.js';
import { Schema1793502000000 } from './migrations/1793502000000-schema.js';
import { Schema1793664000000 } from './migrations/1793664000000-schema.js';
import { TypeormDefaults1793664000001 } from './migrations/1793664000001-typeorm-defaults.js';

/** 배포와 테스트가 동일한 순서로 스키마 변경을 적용한다. */
export const migrations = [
  Schema1793404800000,
  Schema1793408400000,
  Schema1793491200000,
  Schema1793494800000,
  Schema1793498400000,
  Schema1793502000000,
  Schema1793664000000,
  TypeormDefaults1793664000001,
  NormalizeDefaults1793664000002,
  RemoveAudioProcessing1794146400000,
  LearningWorkspace1794222000000,
  VideoLearningPolicy1794222000200,
  LearningAI1794223000000,
  MaterialVersions1794223000100,
  ConversationEvidence1794223000200,
  MaterialOcr1794223000300,
  OcrProvider1794223000400,
  AIMessageProvider1794223000500,
  MaterialRegistration1794223000600,
  LearningExtensions1800000001000,
  RecommendationEvents1800000001100,
  CommunityReports1800000001200,
  VideoPlayback1800000001300,
  CourseOwnerPreservation1800000001400,
  MaterialAnalysis1800000001500,
  CommunityHelpersAdmin1800000001600,
  AdminCredentials1800000001700,
  LearningGrowth1800000001800,
];
