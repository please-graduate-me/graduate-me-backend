/** export의 주석이 데코레이터 앞에 연결되고 한국어 단일 라인 지침을 따르는지 검사한다. */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing:
        'export에는 첫 데코레이터 앞에 연결된 한 줄 한국어 JSDoc을 작성해 주세요.',
      multiline:
        'JSDoc은 한 줄로 작성해 주세요. 보안 위험·법적 구속 설명만 여러 줄 예외를 허용합니다.',
      language: 'JSDoc 본문은 한국어로 작성해 주세요.',
      tags: '매개변수·반환값 나열 대신 의도를 한 줄로 설명해 주세요.',
    },
  },
  create(context) {
    const source = context.sourceCode;

    const inspect = (node) => {
      const decorators = node.declaration?.decorators ?? [];

      const start = Math.min(
        node.range[0],
        ...decorators.map((item) => item.range[0])
      );

      // 데코레이터 뒤 주석은 보기에는 가까워도 TypeScript 선언의 JSDoc으로 연결되지 않는다.
      const comment = source
        .getAllComments()
        .filter((item) => item.range[1] <= start)
        .at(-1);

      if (
        !comment ||
        comment.type !== 'Block' ||
        !comment.value.startsWith('*') ||
        source.text.slice(comment.range[1], start).trim()
      ) {
        context.report({ node, messageId: 'missing' });

        return;
      }

      const value = comment.value.slice(1).trim();

      if (
        comment.loc.start.line !== comment.loc.end.line &&
        !/(보안 위험|법적 구속)/u.test(value)
      )
        context.report({ node, messageId: 'multiline' });
      if (!/[가-힣]/u.test(value))
        context.report({ node, messageId: 'language' });
      if (/@(?:param|returns?)\b/u.test(value))
        context.report({ node, messageId: 'tags' });
    };

    return {
      ExportNamedDeclaration: inspect,
      ExportDefaultDeclaration: inspect,
      ExportAllDeclaration: inspect,
    };
  },
};
