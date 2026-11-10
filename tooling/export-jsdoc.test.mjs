import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './export-jsdoc.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('한국어 export JSDoc 연결', rule, {
  valid: [
    '/** 학생별 설정을 분리한다. */\nexport const settings = {};',
    '/** 학생별 설정을 분리한다. */\n@Controller()\nexport class Settings {}',
    '/**\n * 보안 위험: 키 유출을 막기 위한 저장 제한을 설명한다.\n */\nexport const secretPolicy = {};',
  ],
  invalid: [
    { code: 'export const settings = {};', errors: [{ messageId: 'missing' }] },
    {
      code: '@Controller()\n/** 학생별 설정을 분리한다. */\nexport class Settings {}',
      errors: [{ messageId: 'missing' }],
    },
    {
      code: '/** Keeps settings separate. */\nexport const settings = {};',
      errors: [{ messageId: 'language' }],
    },
    {
      code: '/**\n * 학생별 설정을 분리한다.\n */\nexport const settings = {};',
      errors: [{ messageId: 'multiline' }],
    },
    {
      code: '/** 설정을 분리한다. @param value 설정 */\nexport const settings = {};',
      errors: [{ messageId: 'tags' }],
    },
  ],
});
