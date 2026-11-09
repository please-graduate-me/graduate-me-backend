import { materialPolicy } from '../learning/material-policy.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { User } from '../database/entities/User.entity.js';
import { HttpError } from '../common/http-error.js';

/** 조정 가능한 실행 한도를 현재 자료 정책과 같은 기준으로 사용한다. */
export function aiLimits() {
  const policy = materialPolicy();

  return { ...policy.ai, maxPreparationPages: policy.pdf.preparationPages };
}

/** 실제 청구 조회값과 구분할 환경설정 단가만 사용한다. */
export function estimatedCost(
  provider: AIUsage['provider'],
  input: number,
  output: number
) {
  const prefix =
    provider === 'naver'
      ? 'AI_NAVER'
      : provider === 'anthropic'
        ? 'AI_ANTHROPIC'
        : 'AI_GEMINI';

  const a = process.env[`${prefix}_INPUT_USD_PER_MILLION`],
    b = process.env[`${prefix}_OUTPUT_USD_PER_MILLION`];

  if (
    !a ||
    !b ||
    !Number.isFinite(Number(a)) ||
    !Number.isFinite(Number(b)) ||
    Number(a) < 0 ||
    Number(b) < 0
  )
    return null;

  return (input * Number(a) + output * Number(b)) / 1000000;
}

/** 공급자 호출을 작업 목적과 요청자 단위로 기록한다. */
export interface UsageInput {
  ownerId: string | null;
  provider: AIUsage['provider'];
  task: string;
  model: string;
  sourceKey: string;
  requestId?: string;
  estimatedInputTokens?: number;
  reservedOutputTokens?: number;
  reservedCost?: number | null;
}

/** 검증 실패와 무관하게 보존할 실제 공급자 응답의 계량값이다. */
export interface UsageMeasurement {
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string;
  provider?: AIUsage['provider'];
}

@Injectable()
/** 유료 호출 직전에 계정별 요청·동시 실행·예약 토큰 한도를 확인한다. */
export class UsageService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async execute<T>(
    input: UsageInput,
    run: (
      recordUsage: (measurement: UsageMeasurement) => Promise<void>
    ) => Promise<{ value: T } & UsageMeasurement>
  ): Promise<T> {
    const limits = aiLimits();

    const start = new Date(),
      day = new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate()
        )
      );

    const reservedTokens =
      Math.max(0, Math.ceil(input.estimatedInputTokens ?? 0)) +
      Math.max(0, Math.ceil(input.reservedOutputTokens ?? 4096));

    // OCR처럼 토큰 단가가 없는 작업은 페이지 단가만 사용한다.
    const reservedCost =
      input.reservedCost !== undefined
        ? input.reservedCost
        : estimatedCost(
            input.provider,
            input.estimatedInputTokens ?? 0,
            input.reservedOutputTokens ?? 4096
          );

    const row = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ai-quota:${input.ownerId || 'system'}`,
      ]);

      const entries = await tx.find(AIUsage, {
        where: { ownerId: input.ownerId ?? IsNull(), createdAt: MoreThan(day) },
      });

      // 프로세스 중단으로 남은 예약은 공급자 최대 처리 시간보다 긴 유예 후 해제한다.
      for (const entry of entries)
        if (
          entry.status === 'running' &&
          start.getTime() - entry.createdAt.getTime() > 30 * 60000
        ) {
          entry.status = 'failed';

          await tx.update(
            AIUsage,
            { id: entry.id },
            {
              status: 'failed',
              error: '처리 프로세스가 종료되어 실행을 중단했습니다.',
              elapsedMs: start.getTime() - entry.createdAt.getTime(),
            }
          );
        }

      const running = entries.filter((e) => e.status === 'running');

      const tokens = entries.reduce(
        (sum, e) =>
          sum +
          (e.status === 'running' ||
          e.inputTokens === null ||
          e.outputTokens === null
            ? Math.max(
                e.reservedTokens,
                (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
              )
            : (e.inputTokens ?? 0) + (e.outputTokens ?? 0)),
        0
      );

      if (
        entries.length >= limits.dailyRequests ||
        tokens + reservedTokens > limits.dailyTokens
      )
        throw new HttpError(
          429,
          '오늘의 AI 사용 한도에 도달했습니다. 저장된 결과는 계속 이용할 수 있습니다.'
        );
      if (running.length >= limits.concurrentRequests)
        throw new HttpError(
          429,
          '진행 중인 AI 요청을 마친 뒤 다시 요청해 주세요.'
        );
      const budget = Number(process.env.AI_DAILY_BUDGET_USD || 0);

      if (budget > 0) {
        if (reservedCost === null)
          throw new HttpError(
            503,
            '비용 상한을 사용하려면 공급자별 추정 단가를 설정해 주세요.'
          );

        const cost = entries.reduce(
          (sum, e) => sum + (e.estimatedCost ?? 0),
          0
        );

        if (cost + reservedCost > budget)
          throw new HttpError(429, '오늘의 AI 추정 비용 한도에 도달했습니다.');
      }

      return tx.save(AIUsage, {
        ownerId: input.ownerId,
        provider: input.provider,
        task: input.task,
        model: input.model,
        sourceKey: input.sourceKey,
        requestId: input.requestId ?? null,
        status: 'running',
        reservedTokens,
        estimatedCost: reservedCost,
        actualCost: null,
      });
    });

    const normalize = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null;

    const measurementPatch = (measurement: UsageMeasurement) => {
      const inputTokens = normalize(measurement.inputTokens),
        outputTokens = normalize(measurement.outputTokens);

      return {
        provider: measurement.provider ?? input.provider,
        model: measurement.model ?? input.model,
        inputTokens,
        outputTokens,
        estimatedCost:
          input.reservedCost !== undefined
            ? reservedCost
            : inputTokens !== null && outputTokens !== null
              ? estimatedCost(
                  measurement.provider ?? input.provider,
                  inputTokens,
                  outputTokens
                )
              : reservedCost,
      };
    };

    let measured: UsageMeasurement = {};
    let lastMeasurement = '';

    const recordUsage = async (measurement: UsageMeasurement) => {
      measured = {
        inputTokens:
          measurement.inputTokens ??
          (measurement.inputTokens === null ? null : measured.inputTokens),
        outputTokens:
          measurement.outputTokens ??
          (measurement.outputTokens === null ? null : measured.outputTokens),
        model: measurement.model ?? measured.model,
        provider: measurement.provider ?? measured.provider,
      };

      const patch = measurementPatch(measured),
        fingerprint = JSON.stringify(patch);

      if (fingerprint === lastMeasurement) return;
      // 모델 출력 검증이 실패하거나 이후 처리가 끊겨도 이미 받은 실측값은 남긴다.
      await this.db.manager.update(AIUsage, { id: row.id }, patch);
      lastMeasurement = fingerprint;
    };

    try {
      const result = await run(recordUsage);

      const patch = measurementPatch({
        ...measured,
        ...Object.fromEntries(
          Object.entries(result).filter(
            ([key, value]) => key !== 'value' && value !== undefined
          )
        ),
      });

      await this.db.manager.update(
        AIUsage,
        { id: row.id },
        {
          status: 'succeeded',
          ...patch,
          elapsedMs: Date.now() - start.getTime(),
        }
      );

      return result.value;
    } catch (error) {
      await this.db.manager.update(
        AIUsage,
        { id: row.id },
        {
          status: 'failed',
          elapsedMs: Date.now() - start.getTime(),
          error: '공급자 처리 또는 결과 검증에 실패했습니다.',
        }
      );

      throw error;
    }
  }
  async report() {
    const rows = await this.db.manager.find(AIUsage, {
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const items = await Promise.all(
      rows.map(async (r) => {
        const user = r.ownerId
          ? await this.db.manager.findOneBy(User, { id: r.ownerId })
          : null;

        return {
          id: r.id,
          provider: r.provider,
          task: r.task,
          model: r.model,
          user: { id: r.ownerId, name: user?.name ?? null },
          sourceKey: r.sourceKey,
          status: r.status,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          elapsedMs: r.elapsedMs,
          estimatedCost: r.estimatedCost,
          actualCost: r.actualCost,
          error: r.error,
          createdAt: r.createdAt,
        };
      })
    );

    const hasEstimate = rows.some((r) => r.estimatedCost !== null);

    return {
      currency: 'USD' as const,
      items,
      summary: {
        requests: rows.length,
        succeeded: rows.filter((r) => r.status === 'succeeded').length,
        failed: rows.filter((r) => r.status === 'failed').length,
        inputTokens: rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0),
        outputTokens: rows.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
        estimatedCost: hasEstimate
          ? rows.reduce((a, r) => a + (r.estimatedCost ?? 0), 0)
          : null,
        actualCost: null,
      },
      limits: aiLimits(),
    };
  }
}
