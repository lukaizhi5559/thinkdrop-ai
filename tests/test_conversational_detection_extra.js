#!/usr/bin/env node
import assert from 'node:assert/strict';

const { default: AgentMod } = await import('../src/main/services/agents/UserMemoryAgent.cjs');
const UserMemoryAgent = AgentMod.default || AgentMod;

function noiseVariants(q) {
  const emojis = ['🤔','🧐','💭','❓','❗'];
  const punct = ['...', '!!', '??', '—', ' - '];
  const cases = [q.toLowerCase(), q.toUpperCase(), q.replace(/\b(i|we|you)\b/gi, (m)=>m[0].toUpperCase()+m.slice(1))];
  const withEmoji = emojis.map(e => `${e} ${q}`);
  const withPunct = punct.map(p => `${q}${p}`);
  return [...new Set([q, ...cases, ...withEmoji, ...withPunct])];
}

function genExtraSuite() {
  const positivesBase = [
    'what did we discuss earlier in this conversation?',
    'show me the last few messages from this chat',
    'what did I say previously in this thread?',
    'summarize our session so far',
    'topics we have been discussing?',
    'what did I ask first?',
    'in this session, what did we cover about kubernetes?',
    'give me an overview of our conversation',
    'show the 2nd message',
    '3 messages ago what did I say',
  ];

  // More multilingual (simple approximations, not strict grammar)
  const multilingualPos = [
    'que hablamos al principio de este chat?', // es
    'muestrame el ultimo mensaje de esta conversacion', // es
    "qu'avons-nous dit auparavant dans ce fil?", // fr
    'montre-moi le dernier message de cette conversation', // fr
    'o que discutimos anteriormente nesta conversa?', // pt
    'zeige mir die letzten nachrichten in diesem chat', // de
    'cosa abbiamo detto prima in questa chat?', // it
    'wat hebben we eerder in dit gesprek gezegd?', // nl
    'humne is chat me pehle kya kaha?', // hi (latin)
    'zhe ge duihua li wo zhiqian shuo le shenme?', // zh pinyin
  ];

  const negativesBase = [
    'who was the previous king of england?',
    'what is the first law of motion?',
    'what is the latest version of node?',
    "don't summarize this conversation", // negation trap
    'do not show me our chat history', // negation trap
    'show last pope', // history trap
    'what was the first moon landing?',
  ];

  // Code-switch + typos
  const codeSwitchPos = [
    'can you mostrar el ultimo mensaje de this chat?',
    'que topics did we discutir en esta conversacion?',
    'pode mostrar the 3rd message desta conversa?',
  ];

  // Expand with noise variants
  const positiveCore = [];
  const positiveExperimental = [];
  const negativeCore = [];
  // Core = English + code-switch (light) with noise
  ;[...positivesBase, ...codeSwitchPos].forEach(q => positiveCore.push(...noiseVariants(q)));
  negativesBase.forEach(q => negativeCore.push(...noiseVariants(q)));
  // Experimental = Multilingual; we log metrics but don't fail CI yet
  multilingualPos.forEach(q => positiveExperimental.push(...noiseVariants(q)));

  // Deduplicate
  const posCoreSet = [...new Set(positiveCore)];
  const posExpSet = [...new Set(positiveExperimental)];
  const negCoreSet = [...new Set(negativeCore)];

  // Build labeled test cases
  return {
    core: [
      ...posCoreSet.map(q => ({ q, expected: true, kind: 'pos' })),
      ...negCoreSet.map(q => ({ q, expected: false, kind: 'neg' })),
    ],
    experimental: [
      ...posExpSet.map(q => ({ q, expected: true, kind: 'pos' })),
    ]
  };
}

function computeMetrics(results) {
  let TP=0, FP=0, TN=0, FN=0, posTotal=0, posHit=0, negFP=0;
  results.forEach(r => {
    if (r.expected) {
      posTotal++;
      if (r.got) { TP++; posHit++; } else { FN++; }
    } else {
      if (r.got) { FP++; negFP++; } else { TN++; }
    }
  });
  const accuracy = (TP+TN)/Math.max(1, results.length);
  const precision = TP/Math.max(1, TP+FP);
  const recall = TP/Math.max(1, TP+FN);
  return { TP, FP, TN, FN, accuracy, precision, recall, negFP, posTotal, posHit };
}

function printSummary(m) {
  console.log('\nConfusion Matrix');
  console.log(`TP: ${m.TP}  FP: ${m.FP}`);
  console.log(`FN: ${m.FN}  TN: ${m.TN}`);
  console.log(`\nMetrics:`);
  console.log(`- Accuracy: ${(m.accuracy*100).toFixed(1)}%`);
  console.log(`- Precision: ${(m.precision*100).toFixed(1)}%`);
  console.log(`- Recall (overall): ${(m.recall*100).toFixed(1)}%`);
  console.log(`- Negation False Positives: ${m.negFP}`);
}

(async () => {
  console.log('🧪 Conversational Detection — Extra Multilingual/Noisy Suite');
  const { core, experimental } = genExtraSuite();

  const resultsCore = [];
  core.forEach(tc => {
    const got = !!UserMemoryAgent.isConversationalQueryRobust(tc.q);
    if (got !== tc.expected) {
      const kind = tc.expected ? 'POS' : 'NEG';
      console.log(`[FAIL CORE ${kind}] "${tc.q}" -> got=${got}`);
    }
    resultsCore.push({ ...tc, got });
  });

  const mCore = computeMetrics(resultsCore);
  console.log('\n[Core English/Noisy]');
  printSummary(mCore);
  // Enforce strict gates on core subset (adjusted thresholds after substantial improvements)
  assert.ok(mCore.accuracy >= 0.94, `Core overall accuracy ${(mCore.accuracy*100).toFixed(1)}% < 94%`);
  assert.ok(mCore.negFP === 0, `Core negation false positives: ${mCore.negFP} (must be 0)`);
  assert.ok(mCore.recall >= 0.90, `Core recall ${(mCore.recall*100).toFixed(1)}% < 90%`);

  // Experimental multilingual — log only, still enforce zero negation FP globally via core set
  const resultsExp = [];
  experimental.forEach(tc => {
    const got = !!UserMemoryAgent.isConversationalQueryRobust(tc.q);
    if (got !== tc.expected) {
      console.log(`[INFO EXP POS MISS] "${tc.q}" -> got=${got}`);
    }
    resultsExp.push({ ...tc, got });
  });
  const mExp = computeMetrics(resultsExp);
  console.log('\n[Experimental Multilingual]');
  printSummary(mExp);

  console.log('\n✅ Extra suite (core gates) thresholds met');
  process.exit(0);
})();
