import type { NotebookMembershipRole } from '@educanvas/gateway-core';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
} from './gateway-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  agentOperations,
  gatewayApprovals,
  notebookMemberships,
} from './schema';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';
import { findCurrentOperationAccess } from './gateway/operation-access';

const accessNow = new Date(now.getTime() + 2_000);

async function seedPendingOperation(
  input: {
    actorUserId: string;
    membershipRole: NotebookMembershipRole;
  } = {
    actorUserId: 'user:owner',
    membershipRole: 'owner',
  },
) {
  const database = getDatabase();
  const conversations = new DrizzlePlatformConversationRepository(database);
  const identities = new DrizzleGatewayIdentityRepository(database);
  const store = new DrizzleGatewayOperationStore(database);
  const approvals = new DrizzleGatewayApprovalRepository(database);
  const conversation = await conversations.create({
    ownerSubjectId: 'user:owner',
    spaceKind: 'notebook',
    spaceTitle: '访问复核',
    now,
  });
  const owner =
    input.actorUserId === 'user:owner'
      ? await identities.getActive('user:owner')
      : await identities.ensureAnonymousCompatibility({
          trustedSubjectId: input.actorUserId,
          now,
        });
  if (!owner) throw new Error('Owner identity missing');
  if (input.actorUserId !== 'user:owner') {
    await database.insert(notebookMemberships).values({
      notebookId: conversation.spaceId,
      userId: owner.userId,
      role: input.membershipRole,
      grantedByUserId: 'user:owner',
      grantedAt: now,
    });
  }
  const operation = await store.begin({
    envelopeId: 'access:envelope',
    idempotencyKey: 'access:message',
    requestFingerprint: 'e'.repeat(64),
    route: {
      actorUserId: owner.userId,
      agentId: owner.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      agentProfileId: 'general',
      membershipRole: input.membershipRole,
    },
    now,
  });
  await store.append(
    operation.operationId,
    { type: 'operation.accepted' },
    now,
  );
  await database.insert(gatewayApprovals).values({
    id: 'access:approval',
    operationId: operation.operationId,
    actorUserId: owner.userId,
    capability: 'filesystem.read_allowlisted',
    risk: 'l2',
    summary: '读取受控资料',
    status: 'pending',
    requestedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  return {
    approvals,
    conversation,
    operation,
    owner,
    store,
  };
}

async function expectControlPlaneDenied(
  fixture: Awaited<ReturnType<typeof seedPendingOperation>>,
) {
  const { approvals, operation, owner, store } = fixture;
  await expect(
    store.listEvents(operation.operationId, -1, owner.userId, accessNow),
  ).rejects.toMatchObject({ code: 'operation_not_found' });
  await expect(store.listRecent(owner.userId, 20, accessNow)).resolves.toEqual(
    [],
  );
  await expect(approvals.listPending(owner.userId, accessNow)).resolves.toEqual(
    [],
  );
  await expect(
    store.describe(operation.operationId, owner.userId, accessNow),
  ).resolves.toBeNull();
  await expect(
    store.requestCancellation({
      operationId: operation.operationId,
      actorUserId: owner.userId,
      now: accessNow,
    }),
  ).resolves.toEqual({ recorded: false, continuation: 'none' });
  await expect(
    store.resolveApproval({
      approvalId: 'access:approval',
      actorUserId: owner.userId,
      status: 'denied',
      now: accessNow,
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });

  const [approval] = await getDatabase()
    .select({ status: gatewayApprovals.status })
    .from(gatewayApprovals)
    .where(eq(gatewayApprovals.id, 'access:approval'));
  const [persistedOperation] = await getDatabase()
    .select({ cancelRequestedAt: agentOperations.cancelRequestedAt })
    .from(agentOperations)
    .where(eq(agentOperations.id, operation.operationId));
  expect(approval?.status).toBe('pending');
  expect(persistedOperation?.cancelRequestedAt).toBeNull();
}

describeWithDatabase('Gateway current Operation access', () => {
  beforeAll(migrateGatewaySchema);
  beforeEach(truncateGatewayTables);
  afterAll(closeGatewayConnection);

  it('removes replay, cancellation and approval access after membership revocation', async () => {
    const fixture = await seedPendingOperation();
    await getDatabase()
      .update(notebookMemberships)
      .set({ revokedAt: new Date(now.getTime() + 1_000) })
      .where(
        and(
          eq(notebookMemberships.notebookId, fixture.conversation.spaceId),
          eq(notebookMemberships.userId, fixture.owner.userId),
        ),
      );

    await expectControlPlaneDenied(fixture);
  });

  it('removes replay, cancellation and approval access after membership expiry', async () => {
    const fixture = await seedPendingOperation();
    await getDatabase()
      .update(notebookMemberships)
      .set({ expiresAt: new Date(now.getTime() + 1_000) })
      .where(
        and(
          eq(notebookMemberships.notebookId, fixture.conversation.spaceId),
          eq(notebookMemberships.userId, fixture.owner.userId),
        ),
      );

    await expectControlPlaneDenied(fixture);
  });

  it('keeps read access but removes control actions after a viewer downgrade', async () => {
    const fixture = await seedPendingOperation();
    await getDatabase()
      .update(notebookMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(notebookMemberships.notebookId, fixture.conversation.spaceId),
          eq(notebookMemberships.userId, fixture.owner.userId),
        ),
      );

    await expect(
      fixture.store.listEvents(
        fixture.operation.operationId,
        -1,
        fixture.owner.userId,
        accessNow,
      ),
    ).resolves.toMatchObject([{ type: 'operation.accepted' }]);
    await expect(
      fixture.store.listRecent(fixture.owner.userId, 20, accessNow),
    ).resolves.toHaveLength(1);
    await expect(
      fixture.approvals.listPending(fixture.owner.userId, accessNow),
    ).resolves.toEqual([]);
    await expect(
      fixture.store.describe(
        fixture.operation.operationId,
        fixture.owner.userId,
        accessNow,
      ),
    ).resolves.toBeNull();
    await expect(
      fixture.store.resolveApproval({
        approvalId: 'access:approval',
        actorUserId: fixture.owner.userId,
        status: 'denied',
        now: accessNow,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps replay and approval control for an active shared contributor', async () => {
    const fixture = await seedPendingOperation({
      actorUserId: 'user:contributor',
      membershipRole: 'contributor',
    });

    await expect(
      fixture.store.listEvents(
        fixture.operation.operationId,
        -1,
        fixture.owner.userId,
        accessNow,
      ),
    ).resolves.toMatchObject([{ type: 'operation.accepted' }]);
    await expect(
      fixture.store.listRecent(fixture.owner.userId, 20, accessNow),
    ).resolves.toHaveLength(1);
    await expect(
      fixture.approvals.listPending(fixture.owner.userId, accessNow),
    ).resolves.toHaveLength(1);
    await expect(
      fixture.store.describe(
        fixture.operation.operationId,
        fixture.owner.userId,
        accessNow,
      ),
    ).resolves.toMatchObject({
      actorUserId: fixture.owner.userId,
      status: 'running',
    });
    await expect(
      fixture.store.resolveApproval({
        approvalId: 'access:approval',
        actorUserId: fixture.owner.userId,
        status: 'denied',
        now: accessNow,
      }),
    ).resolves.toMatchObject({
      operationId: fixture.operation.operationId,
      decision: { status: 'denied' },
    });
  });

  it('serializes a control mutation against concurrent membership revocation', async () => {
    const fixture = await seedPendingOperation();
    let releaseMembershipLock!: () => void;
    let notifyMembershipLocked!: () => void;
    const membershipLockReleased = new Promise<void>((resolve) => {
      releaseMembershipLock = resolve;
    });
    const membershipLocked = new Promise<void>((resolve) => {
      notifyMembershipLocked = resolve;
    });
    const heldAccess = getDatabase().transaction(async (transaction) => {
      const access = await findCurrentOperationAccess(transaction, {
        operationId: fixture.operation.operationId,
        actorUserId: fixture.owner.userId,
        requiredPermission: 'conversation.reply',
        now: accessNow,
        mutation: true,
      });
      notifyMembershipLocked();
      await membershipLockReleased;
      return access;
    });
    await membershipLocked;

    try {
      await expect(
        getDatabase().transaction(async (transaction) => {
          await transaction.execute(sql`set local lock_timeout = '100ms'`);
          await transaction
            .update(notebookMemberships)
            .set({ revokedAt: accessNow })
            .where(
              and(
                eq(
                  notebookMemberships.notebookId,
                  fixture.conversation.spaceId,
                ),
                eq(notebookMemberships.userId, fixture.owner.userId),
              ),
            );
        }),
      ).rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally {
      releaseMembershipLock();
    }
    await expect(heldAccess).resolves.toMatchObject({
      operationId: fixture.operation.operationId,
      role: 'owner',
    });

    await getDatabase()
      .update(notebookMemberships)
      .set({ revokedAt: accessNow })
      .where(
        and(
          eq(notebookMemberships.notebookId, fixture.conversation.spaceId),
          eq(notebookMemberships.userId, fixture.owner.userId),
        ),
      );
    await expectControlPlaneDenied(fixture);
  });
});
