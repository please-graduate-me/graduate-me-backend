import exportJSDoc from './tooling/export-jsdoc.mjs';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

/** NestJS 코드와 DB 스크립트의 검사 기준을 백엔드에서 관리한다. */
export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**']),
  js.configs.recommended,
  { files: ['**/*.{ts,mts}'], extends: [tseslint.configs.recommended] },
  { languageOptions: { globals: globals.node } },
  prettier,
  {
    plugins: {
      '@stylistic': stylistic,
      project: { rules: { 'export-jsdoc': exportJSDoc } },
    },
    rules: {
      'project/export-jsdoc': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'always', prev: 'export', next: '*' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        {
          blankLine: 'any',
          prev: ['singleline-const', 'singleline-let', 'singleline-var'],
          next: ['singleline-const', 'singleline-let', 'singleline-var'],
        },
        {
          blankLine: 'always',
          prev: '*',
          next: [
            'multiline-const',
            'multiline-let',
            'multiline-var',
            'multiline-expression',
            'block-like',
            'return',
          ],
        },
        {
          blankLine: 'always',
          prev: ['multiline-expression', 'block-like'],
          next: '*',
        },
      ],
    },
  },
]);
