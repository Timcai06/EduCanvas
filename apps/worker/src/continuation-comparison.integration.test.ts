import {
  Annotation,
  Command,
  END,
  interrupt,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { runOnce, type TaskList } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.TEST_DATABASE_URL!;
const langGraphSchema = 'research_langgraph_continuation';
const fixtureSchema = 'research_continuation_fixture';
const NATIVE_TASK = 'research:continuation';

const CurrentWorkflowState = Annotation.Root({
  operationId: Annotation<string>(),
  version: Annotation<number>(),
  prepared: Annotation<boolean>(),
  approved: Annotation<boolean>(),
  effectKey: Annotation<string>(),
  effectCommitted: Annotation<boolean>(),
  completed: Annotation<boolean>(),
});

const LegacyWorkflowState = Annotation.Root({
  operationId: Annotation<string>(),
  version: Annotation<number>(),
  prepared: Annotation<boolean>(),
  approved: Annotation<boolean>(),
  completed: Annotation<boolean>(),
});

type CurrentState = typeof CurrentWorkflowState.State;
type WorkflowNode = 'prepare' | 'approval' | 'effect' | 'finalize';

interface NativePayload {
  operationId: string;
  step: 'prepare' | 'effect' | 'finalize';
}

interface LangGraphFixtureOptions {
  interruptBefore?: WorkflowNode[];
  failAfterEffect?: Set<string>;
}

const threadConfig = (operationId: string) => ({
  configurable: { thread_id: operationId },
});

describe('PostgreSQL continuation comparison fixture', () => {
  const pool = new pg.Pool({ connectionString });
  let checkpointer: PostgresSaver;

  beforeAll(async () => {
    await pool.query(`drop schema if exists ${langGraphSchema} cascade`);
    await pool.query(`drop schema if exists ${fixtureSchema} cascade`);
    await pool.query(`create schema ${fixtureSchema}`);
    await pool.query(`
      create table ${fixtureSchema}.effects (
        strategy text not null,
        operation_id text not null,
        effect_key text not null,
        created_at timestamptz not null default now(),
        primary key (strategy, effect_key)
      )
    `);
    await pool.query(`
      create table ${fixtureSchema}.native_workflows (
        operation_id text primary key,
        schema_version integer not null,
        state jsonb not null,
        status text not null,
        approved boolean not null default false,
        completed boolean not null default false
      )
    `);
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
    checkpointer = new PostgresSaver(pool, undefined, {
      schema: langGraphSchema,
    });
    await checkpointer.setup();
  });

  afterAll(async () => {
    await pool.query(`drop schema if exists ${langGraphSchema} cascade`);
    await pool.query(`drop schema if exists ${fixtureSchema} cascade`);
    await pool.end();
  });

  const createCurrentGraph = (options: LangGraphFixtureOptions = {}) =>
    new StateGraph(CurrentWorkflowState)
      .addNode('prepare', async (state: CurrentState) => ({
        version: 3,
        prepared: true,
        effectKey: state.effectKey || `effect:${state.operationId}`,
      }))
      .addNode('approval', async (state: CurrentState) => ({
        approved: interrupt({
          operationId: state.operationId,
          capability: 'fixture.write',
        }) as boolean,
      }))
      .addNode('effect', async (state: CurrentState) => {
        if (!state.approved) throw new Error('approval_required');
        const effectKey = state.effectKey || `effect:${state.operationId}`;
        await pool.query(
          `insert into ${fixtureSchema}.effects(strategy, operation_id, effect_key)
           values ('langgraph', $1, $2)
           on conflict do nothing`,
          [state.operationId, effectKey],
        );
        if (options.failAfterEffect?.delete(state.operationId)) {
          throw new Error('simulated_process_loss_after_effect');
        }
        return { effectKey, effectCommitted: true };
      })
      .addNode('finalize', async () => ({ completed: true }))
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'approval')
      .addEdge('approval', 'effect')
      .addEdge('effect', 'finalize')
      .addEdge('finalize', END)
      .compile({
        checkpointer,
        interruptBefore: options.interruptBefore,
      });

  const createLegacyGraph = (version: 1 | 2) =>
    new StateGraph(LegacyWorkflowState)
      .addNode('prepare', async () => ({ version, prepared: true }))
      .addNode('approval', async (state) => ({
        approved: interrupt({
          operationId: state.operationId,
          capability: 'fixture.write',
        }) as boolean,
      }))
      .addNode('effect', async (state) => {
        if (!state.approved) throw new Error('approval_required');
        await pool.query(
          `insert into ${fixtureSchema}.effects(strategy, operation_id, effect_key)
           values ('langgraph', $1, $2)
           on conflict do nothing`,
          [state.operationId, `effect:${state.operationId}`],
        );
        return {};
      })
      .addNode('finalize', async () => ({ completed: true }))
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'approval')
      .addEdge('approval', 'effect')
      .addEdge('effect', 'finalize')
      .addEdge('finalize', END)
      .compile({ checkpointer });

  const legacyInitialState = (operationId: string, version: 1 | 2) => ({
    operationId,
    version,
    prepared: false,
    approved: false,
    completed: false,
  });

  const initialState = (operationId: string): CurrentState => ({
    operationId,
    version: 3,
    prepared: false,
    approved: false,
    effectKey: `effect:${operationId}`,
    effectCommitted: false,
    completed: false,
  });

  const expectSingleEffect = async (operationId: string) => {
    const result = await pool.query<{ count: number }>(
      `select count(*)::int as count from ${fixtureSchema}.effects
       where strategy = 'langgraph' and operation_id = $1`,
      [operationId],
    );
    expect(result.rows[0]?.count).toBe(1);
  };

  const parseNativePayload = (raw: unknown): NativePayload => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('operationId' in raw) ||
      typeof raw.operationId !== 'string' ||
      !('step' in raw) ||
      !['prepare', 'effect', 'finalize'].includes(String(raw.step))
    ) {
      throw new Error('invalid_native_payload');
    }
    return {
      operationId: raw.operationId,
      step: raw.step as NativePayload['step'],
    };
  };

  const readEffectKey = (operationId: string, state: unknown): string => {
    if (
      typeof state === 'object' &&
      state !== null &&
      'effectKey' in state &&
      typeof state.effectKey === 'string'
    ) {
      return state.effectKey;
    }
    return `effect:${operationId}`;
  };

  const createNativeTasks = (
    runtimeVersion: 2 | 3,
    failAfterEffect: Set<string> = new Set(),
  ): TaskList => ({
    [NATIVE_TASK]: async (raw) => {
      const payload = parseNativePayload(raw);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const selected = await client.query<{
          state: unknown;
          approved: boolean;
        }>(
          `select state, approved
           from ${fixtureSchema}.native_workflows
           where operation_id = $1
           for update`,
          [payload.operationId],
        );
        const workflow = selected.rows[0];
        if (!workflow) throw new Error('native_workflow_missing');
        const effectKey = readEffectKey(payload.operationId, workflow.state);

        if (payload.step === 'prepare') {
          await client.query(
            `update ${fixtureSchema}.native_workflows
             set schema_version = $2,
                 state = state || jsonb_build_object('prepared', true, 'effectKey', $3::text),
                 status = 'waiting_approval'
             where operation_id = $1`,
            [payload.operationId, runtimeVersion, effectKey],
          );
        } else if (payload.step === 'effect') {
          if (!workflow.approved) throw new Error('approval_required');
          await client.query(
            `insert into ${fixtureSchema}.effects(strategy, operation_id, effect_key)
             values ('native', $1, $2)
             on conflict do nothing`,
            [payload.operationId, effectKey],
          );
          await client.query(
            `update ${fixtureSchema}.native_workflows
             set schema_version = $2,
                 state = state || jsonb_build_object('effectKey', $3::text, 'effectCommitted', true),
                 status = 'effect_committed'
             where operation_id = $1`,
            [payload.operationId, runtimeVersion, effectKey],
          );
          await client.query(`select graphile_worker.add_job($1, $2::json)`, [
            NATIVE_TASK,
            JSON.stringify({
              operationId: payload.operationId,
              step: 'finalize',
            }),
          ]);
        } else {
          await client.query(
            `update ${fixtureSchema}.native_workflows
             set schema_version = $2,
                 state = state || jsonb_build_object('completed', true),
                 status = 'completed', completed = true
             where operation_id = $1`,
            [payload.operationId, runtimeVersion],
          );
        }
        await client.query('commit');
        if (
          payload.step === 'effect' &&
          failAfterEffect.delete(payload.operationId)
        ) {
          throw new Error('simulated_process_loss_after_effect');
        }
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });

  const startNative = async (
    operationId: string,
    options: { schemaVersion?: 1 | 2 | 3; failBeforeCommit?: boolean } = {},
  ) => {
    const schemaVersion = options.schemaVersion ?? 3;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into ${fixtureSchema}.native_workflows(
           operation_id, schema_version, state, status
         ) values ($1, $2, $3::jsonb, 'queued')`,
        [
          operationId,
          schemaVersion,
          JSON.stringify(
            schemaVersion === 1 ? {} : { effectKey: `effect:${operationId}` },
          ),
        ],
      );
      await client.query(`select graphile_worker.add_job($1, $2::json)`, [
        NATIVE_TASK,
        JSON.stringify({ operationId, step: 'prepare' }),
      ]);
      if (options.failBeforeCommit) {
        throw new Error('simulated_process_loss_before_commit');
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const approveNative = async (operationId: string) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update ${fixtureSchema}.native_workflows
         set approved = true, status = 'ready'
         where operation_id = $1 and status = 'waiting_approval'
         returning operation_id`,
        [operationId],
      );
      if (updated.rowCount !== 1) throw new Error('native_not_waiting');
      await client.query(`select graphile_worker.add_job($1, $2::json)`, [
        NATIVE_TASK,
        JSON.stringify({ operationId, step: 'effect' }),
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const drainNative = async (tasks: TaskList) => {
    await runOnce({ connectionString, taskList: tasks });
  };

  const expectNativeCompleted = async (operationId: string) => {
    const workflow = await pool.query<{
      completed: boolean;
      status: string;
    }>(
      `select completed, status from ${fixtureSchema}.native_workflows
       where operation_id = $1`,
      [operationId],
    );
    expect(workflow.rows[0]).toEqual({
      completed: true,
      status: 'completed',
    });
    const effects = await pool.query<{ count: number }>(
      `select count(*)::int as count from ${fixtureSchema}.effects
       where strategy = 'native' and operation_id = $1`,
      [operationId],
    );
    expect(effects.rows[0]?.count).toBe(1);
  };

  it('recovers five LangGraph kill points with one idempotent effect', async () => {
    const beforeInvoke = 'langgraph:kill:1';
    expect(
      await checkpointer.getTuple(threadConfig(beforeInvoke)),
    ).toBeUndefined();
    const graph1 = createCurrentGraph();
    await graph1.invoke(initialState(beforeInvoke), threadConfig(beforeInvoke));
    await graph1.invoke(
      new Command({ resume: true }),
      threadConfig(beforeInvoke),
    );
    await expectSingleEffect(beforeInvoke);

    const beforePrepare = 'langgraph:kill:2';
    const graph2a = createCurrentGraph({ interruptBefore: ['prepare'] });
    await graph2a.invoke(
      initialState(beforePrepare),
      threadConfig(beforePrepare),
    );
    expect((await graph2a.getState(threadConfig(beforePrepare))).next).toEqual([
      'prepare',
    ]);
    const graph2b = createCurrentGraph();
    await graph2b.invoke(null, threadConfig(beforePrepare));
    expect((await graph2b.getState(threadConfig(beforePrepare))).next).toEqual([
      'approval',
    ]);
    await graph2b.invoke(
      new Command({ resume: true }),
      threadConfig(beforePrepare),
    );
    await expectSingleEffect(beforePrepare);

    const beforeApproval = 'langgraph:kill:3';
    const graph3a = createCurrentGraph();
    await graph3a.invoke(
      initialState(beforeApproval),
      threadConfig(beforeApproval),
    );
    const state3 = await graph3a.getState(threadConfig(beforeApproval));
    expect(state3.values).toMatchObject({ prepared: true, completed: false });
    expect(state3.next).toEqual(['approval']);
    const graph3b = createCurrentGraph();
    await graph3b.invoke(
      new Command({ resume: true }),
      threadConfig(beforeApproval),
    );
    await expectSingleEffect(beforeApproval);

    const beforeEffect = 'langgraph:kill:4';
    const graph4a = createCurrentGraph({ interruptBefore: ['effect'] });
    await graph4a.invoke(
      initialState(beforeEffect),
      threadConfig(beforeEffect),
    );
    await graph4a.invoke(
      new Command({ resume: true }),
      threadConfig(beforeEffect),
    );
    expect((await graph4a.getState(threadConfig(beforeEffect))).next).toEqual([
      'effect',
    ]);
    const graph4b = createCurrentGraph();
    await graph4b.invoke(null, threadConfig(beforeEffect));
    await expectSingleEffect(beforeEffect);

    const afterEffect = 'langgraph:kill:5';
    const graph5a = createCurrentGraph({
      failAfterEffect: new Set([afterEffect]),
    });
    await graph5a.invoke(initialState(afterEffect), threadConfig(afterEffect));
    await expect(
      graph5a.invoke(new Command({ resume: true }), threadConfig(afterEffect)),
    ).rejects.toThrow('simulated_process_loss_after_effect');
    await expectSingleEffect(afterEffect);
    const graph5b = createCurrentGraph();
    const finalState = await graph5b.invoke(null, threadConfig(afterEffect));
    expect(finalState).toMatchObject({
      effectCommitted: true,
      completed: true,
    });
    await expectSingleEffect(afterEffect);
  });

  it('recovers five graphile-worker kill points with one idempotent effect', async () => {
    const tasks = createNativeTasks(3);

    const beforeCommit = 'native:kill:1';
    await expect(
      startNative(beforeCommit, { failBeforeCommit: true }),
    ).rejects.toThrow('simulated_process_loss_before_commit');
    const absent = await pool.query(
      `select 1 from ${fixtureSchema}.native_workflows where operation_id = $1`,
      [beforeCommit],
    );
    expect(absent.rowCount).toBe(0);
    await startNative(beforeCommit);
    await drainNative(tasks);
    await approveNative(beforeCommit);
    await drainNative(tasks);
    await expectNativeCompleted(beforeCommit);

    const afterEnqueue = 'native:kill:2';
    await startNative(afterEnqueue);
    await drainNative(createNativeTasks(3));
    await approveNative(afterEnqueue);
    await drainNative(createNativeTasks(3));
    await expectNativeCompleted(afterEnqueue);

    const beforeApproval = 'native:kill:3';
    await startNative(beforeApproval);
    await drainNative(tasks);
    const waiting = await pool.query<{ status: string }>(
      `select status from ${fixtureSchema}.native_workflows where operation_id = $1`,
      [beforeApproval],
    );
    expect(waiting.rows[0]?.status).toBe('waiting_approval');
    await approveNative(beforeApproval);
    await drainNative(createNativeTasks(3));
    await expectNativeCompleted(beforeApproval);

    const afterApproval = 'native:kill:4';
    await startNative(afterApproval);
    await drainNative(tasks);
    await approveNative(afterApproval);
    await drainNative(createNativeTasks(3));
    await expectNativeCompleted(afterApproval);

    const afterEffect = 'native:kill:5';
    await startNative(afterEffect);
    await drainNative(tasks);
    await approveNative(afterEffect);
    await drainNative(createNativeTasks(3, new Set([afterEffect])));
    const effectBeforeRetry = await pool.query<{ count: number }>(
      `select count(*)::int as count from ${fixtureSchema}.effects
       where strategy = 'native' and operation_id = $1`,
      [afterEffect],
    );
    expect(effectBeforeRetry.rows[0]?.count).toBe(1);
    await pool.query(
      `update graphile_worker._private_jobs
       set run_at = now(), locked_at = null, locked_by = null
       where payload ->> 'operationId' = $1`,
      [afterEffect],
    );
    await drainNative(createNativeTasks(3));
    await expectNativeCompleted(afterEffect);
  });

  it('reads LangGraph N-2/N-1 checkpoints and supports rolling rollback', async () => {
    for (const version of [1, 2] as const) {
      const operationId = `langgraph:legacy:${version}`;
      const legacy = createLegacyGraph(version);
      await legacy.invoke(
        legacyInitialState(operationId, version),
        threadConfig(operationId),
      );
      expect((await legacy.getState(threadConfig(operationId))).next).toEqual([
        'approval',
      ]);

      const upgraded = createCurrentGraph();
      const finalState = await upgraded.invoke(
        new Command({ resume: true }),
        threadConfig(operationId),
      );
      expect(finalState).toMatchObject({ completed: true });
      await expectSingleEffect(operationId);
    }

    const rollbackOperation = 'langgraph:rollback:current-to-n1';
    const current = createCurrentGraph();
    await current.invoke(
      initialState(rollbackOperation),
      threadConfig(rollbackOperation),
    );
    const rolledBack = createLegacyGraph(2);
    const rollbackState = await rolledBack.invoke(
      new Command({ resume: true }),
      threadConfig(rollbackOperation),
    );
    expect(rollbackState).toMatchObject({ completed: true });
    await expectSingleEffect(rollbackOperation);
  });

  it('reads native N-2/N-1 rows and lets the previous runtime finish N data', async () => {
    for (const version of [1, 2] as const) {
      const operationId = `native:legacy:${version}`;
      await startNative(operationId, { schemaVersion: version });
      await drainNative(createNativeTasks(3));
      await approveNative(operationId);
      await drainNative(createNativeTasks(3));
      await expectNativeCompleted(operationId);
    }

    const rollbackOperation = 'native:rollback:current-to-n1';
    await startNative(rollbackOperation, { schemaVersion: 3 });
    await drainNative(createNativeTasks(2));
    await approveNative(rollbackOperation);
    await drainNative(createNativeTasks(2));
    await expectNativeCompleted(rollbackOperation);
    const version = await pool.query<{ schema_version: number }>(
      `select schema_version from ${fixtureSchema}.native_workflows
       where operation_id = $1`,
      [rollbackOperation],
    );
    expect(version.rows[0]?.schema_version).toBe(2);
  });
});
