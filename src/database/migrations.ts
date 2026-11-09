import { RemoveAudioProcessing1794146400000 } from './migrations/1794146400000-remove-audio-processing.js';
import { LearningWorkspace1794222000000 } from './migrations/1794222000000-learning-workspace.js';
import { LearningAI1794223000000 } from './migrations/1794223000000-learning-ai.js';
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
];
