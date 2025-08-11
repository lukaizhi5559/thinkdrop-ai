#!/usr/bin/env node
// tests: retrieval behavior for positional queries (JUST/last, N messages ago)

import assert from 'node:assert/strict';

const { default: AgentMod } = await import('../src/main/services/agents/UserMemoryAgent.cjs');
const UserMemoryAgent = AgentMod?.default || AgentMod;

function mockDb(expectedChecker, rows) {
  return {
    async query(sql, params) {
      expectedChecker?.(sql, params);
      return rows;
    }
  };
}

function mkSession(id = 'sess-1') {
  return [{
    session_id: id,
    title: 'Test Session',
    type: 'chat',
    similarity: 1.0
  }];
}

async function testJustLastReturnsImmediatePreviousUser() {
  let checked = false;
  const db = mockDb((sql, params) => {
    assert.match(sql, /FROM\s+conversation_messages/i);
    assert.match(sql, /session_id\s*=\s*\?/i);
    assert.match(sql, /sender\s*=\s*'user'/i, 'JUST/last should filter to sender=user');
    assert.match(sql, /ORDER BY\s+created_at\s+DESC/i);
    assert.match(sql, /LIMIT\s+1(?!\s+OFFSET)/i);
    assert.equal(params.length, 1, 'only session_id param expected');
    checked = true;
  }, [
    {
      source: 'conversation', id: 'm3', source_text: 'prev user message', sender: 'user',
      session_id: 'sess-1', created_at: '2025-08-11T19:00:00Z', metadata: '{}'
    }
  ]);

  const qc = { isConversational: true, type: 'positional', details: { position: 'last', justPattern: true } };
  const res = await UserMemoryAgent.getMessagesByPosition(mkSession(), qc, db, 3);
  assert.ok(checked, 'expected SQL assertions to run');
  assert.equal(res.length, 1, 'should return exactly one row');
  assert.equal(res[0].sender, 'user');
  assert.equal(res[0].source_text, 'prev user message');
}

async function testNMessagesAgoUsesOffsetAndUserFilter() {
  let checked = false;
  const db = mockDb((sql, params) => {
    assert.match(sql, /LIMIT\s+1\s+OFFSET\s+\?/i, 'should use OFFSET for count');
    assert.match(sql, /sender\s*=\s*'user'/i, 'count queries should filter to sender=user');
    assert.equal(params.length, 2, 'expects session_id and offset');
    assert.equal(params[1], 1, 'for count=2, offset should be 1');
    checked = true;
  }, [
    {
      source: 'conversation', id: 'm2', source_text: 'two msgs ago', sender: 'user',
      session_id: 'sess-1', created_at: '2025-08-11T18:59:00Z', metadata: '{}'
    }
  ]);

  const qc = { isConversational: true, type: 'positional', details: { count: 2, direction: 'ago' } };
  const res = await UserMemoryAgent.getMessagesByPosition(mkSession(), qc, db, 3);
  assert.ok(checked, 'expected SQL assertions to run');
  assert.equal(res.length, 1);
  assert.equal(res[0].source_text, 'two msgs ago');
}

async function testLastGenericFallsBackToRecentAnySender() {
  let checked = false;
  const db = mockDb((sql, params) => {
    assert.doesNotMatch(sql, /sender\s*=\s*'user'/i, 'generic last should not force user filter');
    assert.match(sql, /LIMIT\s+\?/i);
    checked = true;
  }, [
    { source: 'conversation', id: 'm4', source_text: 'assistant latest', sender: 'assistant', session_id: 'sess-1', created_at: '2025-08-11T19:01:00Z', metadata: '{}' },
    { source: 'conversation', id: 'm3', source_text: 'user latest', sender: 'user', session_id: 'sess-1', created_at: '2025-08-11T19:00:30Z', metadata: '{}' }
  ]);

  const qc = { isConversational: true, type: 'positional', details: { position: 'last' } };
  const res = await UserMemoryAgent.getMessagesByPosition(mkSession(), qc, db, 2);
  assert.ok(checked, 'expected SQL assertions to run');
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 'm4');
  assert.equal(res[1].id, 'm3');
}

(async () => {
  try {
    await testJustLastReturnsImmediatePreviousUser();
    console.log('✅ JUST/last previous user test passed');

    await testNMessagesAgoUsesOffsetAndUserFilter();
    console.log('✅ N messages ago test passed');

    await testLastGenericFallsBackToRecentAnySender();
    console.log('✅ Generic last test passed');

    console.log('\n🎉 Retrieval positional tests passed');
    process.exit(0);
  } catch (e) {
    console.error('❌ Retrieval positional tests failed:', e);
    process.exit(1);
  }
})();
