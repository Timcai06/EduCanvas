import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNotebookPrivacyFixture } from './notebook-privacy-fixture.mjs';

const owner = { id: 'agent:owner', ownerActorId: 'actor:owner' };
const contributor = {
  id: 'agent:contributor',
  ownerActorId: 'actor:contributor',
};
const notebookId = 'notebook:shared';

const fixture = () =>
  createNotebookPrivacyFixture({
    agents: [owner, contributor],
    memberships: [
      { notebookId, actorId: owner.ownerActorId },
      { notebookId, actorId: contributor.ownerActorId },
    ],
    sharedResources: [
      { id: 'source:1', kind: 'source', notebookId },
      { id: 'conversation:1', kind: 'conversation', notebookId },
      { id: 'artifact:1', kind: 'artifact', notebookId },
    ],
    privateResources: [
      {
        id: 'memory:owner',
        kind: 'memory',
        ownerActorId: owner.ownerActorId,
        ownerAgentId: owner.id,
      },
      {
        id: 'credential:owner',
        kind: 'credential',
        ownerActorId: owner.ownerActorId,
        ownerAgentId: owner.id,
      },
      {
        id: 'node:owner',
        kind: 'node',
        ownerActorId: owner.ownerActorId,
        ownerAgentId: owner.id,
      },
      {
        id: 'grant:owner',
        kind: 'defaultGrant',
        ownerActorId: owner.ownerActorId,
        ownerAgentId: owner.id,
      },
    ],
  });

describe('Notebook privacy research fixture', () => {
  it('shares only Notebook resources while retaining each actor personal Agent', () => {
    const privacy = fixture();

    assert.deepEqual(privacy.resolveAgent(owner.ownerActorId), owner);
    assert.deepEqual(
      privacy.resolveAgent(contributor.ownerActorId),
      contributor,
    );
    for (const [kind, resourceId] of [
      ['source', 'source:1'],
      ['conversation', 'conversation:1'],
      ['artifact', 'artifact:1'],
    ]) {
      assert.equal(
        privacy.readShared({
          actorId: contributor.ownerActorId,
          notebookId,
          kind,
          resourceId,
        }).allowed,
        true,
      );
    }
  });

  it('fails closed for an actor outside the Notebook or a mismatched Notebook', () => {
    const privacy = fixture();
    assert.deepEqual(
      privacy.readShared({
        actorId: 'actor:outsider',
        notebookId,
        kind: 'source',
        resourceId: 'source:1',
      }),
      { allowed: false, code: 'notebook_membership_required' },
    );
    assert.deepEqual(
      privacy.readShared({
        actorId: contributor.ownerActorId,
        notebookId: 'notebook:other',
        kind: 'source',
        resourceId: 'source:1',
      }),
      { allowed: false, code: 'notebook_membership_required' },
    );
  });

  it('denies another member owner Memory, Credential, Node and default grant', () => {
    const privacy = fixture();
    for (const [kind, resourceId] of [
      ['memory', 'memory:owner'],
      ['credential', 'credential:owner'],
      ['node', 'node:owner'],
      ['defaultGrant', 'grant:owner'],
    ]) {
      assert.deepEqual(
        privacy.usePrivate({
          actorId: contributor.ownerActorId,
          agentId: contributor.id,
          kind,
          resourceId,
        }),
        { allowed: false, code: 'private_capability_owner_mismatch' },
      );
    }
  });

  it('does not let a client forge the owner Agent id', () => {
    const privacy = fixture();
    assert.deepEqual(
      privacy.usePrivate({
        actorId: contributor.ownerActorId,
        agentId: owner.id,
        kind: 'node',
        resourceId: 'node:owner',
      }),
      { allowed: false, code: 'actor_agent_mismatch' },
    );
  });

  it('treats every absent private capability as unavailable, never as an empty grant', () => {
    const privacy = fixture();
    for (const kind of ['memory', 'credential', 'node', 'defaultGrant']) {
      assert.deepEqual(
        privacy.usePrivate({
          actorId: contributor.ownerActorId,
          agentId: contributor.id,
          kind,
          resourceId: `${kind}:missing`,
        }),
        { allowed: false, code: 'private_capability_unavailable' },
      );
    }
  });
});
