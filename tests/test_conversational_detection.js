#!/usr/bin/env node
// tests/conversational-query.spec.mjs

import assert from "node:assert/strict";

const { default: AgentMod } = await import('../src/main/services/agents/UserMemoryAgent.cjs');
const UserMemoryAgent = AgentMod.default || AgentMod;

function genCases() {
  const topics = ["flights", "food", "kubernetes", "React", "taxes", "vacation", "hiring", "NDR", "DuckDB", "OpenAI"];
  const counts = [2,3,4,5,10];

  // ✅ Should be conversational
  const positive = [
    "what was my first question?",
    "what did we talk about at the beginning of this chat?",
    "what was the last thing I asked?",
    "show me the most recent message in this conversation",
    "what did you say earlier in this thread?",
    "in our conversation, what did we discuss first?",
    "what was our last conversation about?",
    "what did we mention before that?",
    "what did I tell you previously?",
    "what did we discuss earlier?",
    "show the 3rd message",
    "2 messages back what did I say?",
    "a few messages ago you said something—what was it?",
    "several msgs back, what did I ask?",
    "tell me the previous message",
    "remember when we talked about flights—what did we say first?",
    "what was the earliest message about food in this chat?",
    "from the start of this conversation, what did we discuss?",
    "summarize our conversation",
    "give me a conversation overview",
    "what have we been talking about?",
    "what topics have we discussed in this session?",
    "what did you tell me before?",
    "what did we say after that?",
    "what did I ask next?",
    "beginning of this chat, what happened?",
  ];

  // generate parametric positives
  counts.forEach(n => {
    positive.push(`${n} messages ago, what did I say?`);
    positive.push(`show the ${n}th message`);
  });
  topics.forEach(t => {
    positive.push(`in this chat, what did we say about ${t}?`);
    positive.push(`what was our last discussion about ${t}?`);
    positive.push(`earliest thing we mentioned about ${t} in this conversation?`);
  });

  // ❌ Should NOT be conversational (history traps / non-chat)
  const negative = [
    "who was the first president of the usa?",
    "what was the last emperor of china?",
    "when was the last war?",
    "what is the first album by that artist?",
    "what happened in the previous season?",
    "tell me about the latest movie release",
    "what is the most recent version of React?",
    "what is the first law of thermodynamics?",
    "last year’s inflation rate?",
    "previous quarter revenue for Apple?",
    "don’t summarize our chat",
    "do not show me the conversation",
    "stop talking about our chat",
    "what did the last dynasty accomplish?",
    "first city on the itinerary?",
    "last book in the series?",
    "previous album track list?",
    "what’s the latest weather in NYC?",
    "show the planet’s first moon discovery",
    "who won the last game?",
  ];

  // generate parametric negatives
  topics.forEach(t => {
    negative.push(`what was the last ${t} conference?`);
    negative.push(`who wrote the first ${t} book?`);
  });

  return { positive, negative };
}

// Generate a large labeled suite (>1000) with categories and negation flags
function genMegaSuite() {
  const topics = ["flights","food","kubernetes","react","taxes","vacation","hiring","ndr","duckdb","openai","ml","ui","infra","frontend","backend"]; // 15
  const counts = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  const ordinals = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th","13th","14th","15th","16th","17th","18th","19th","20th","2th","3th"]; // include typos
  const contractions = ["don't","don’t","do not"]; // unicode apostrophe variant
  const multilingual = [
    // Spanish, French, Portuguese, German (simple approximations)
    "que dije hace 2 mensajes?",
    "mostrame el 3er mensaje",
    "qu'est-ce que j'ai dit précédemment?",
    "affiche le 4ème message",
    "o que eu acabei de dizer?",
    "mostre a 2ª mensagem",
    "was habe ich gerade gesagt?",
    "zeig die 3. nachricht"
  ];

  /**
   * Test case shape:
   * { q: string, expected: boolean, category?: 'positional'|'topical'|'overview'|'general', negation?: boolean }
   */
  const cases = [];

  // Positional templates
  const posTemplates = [
    (n) => `${n} messages ago, what did I say?`,
    (n) => `${n} msgs back what did I ask?`,
    (o) => `show the ${o} message`,
    () => `what did I tell you previously?`,
    () => `what did we discuss earlier?`,
    () => `what did I just say?`,
    () => `tell me the previous message`,
    () => `show me the most recent message in this conversation`,
  ];

  // Topical templates
  const topTemplates = [
    (t) => `in this chat, what did we say about ${t}?`,
    (t) => `what was our last discussion about ${t}?`,
    (t) => `earliest thing we mentioned about ${t} in this conversation?`,
  ];

  // Overview templates
  const overview = [
    `summarize our conversation`,
    `give me a conversation overview`,
    `what have we been talking about?`,
    `what topics have we discussed in this session?`,
  ];

  // Build positional by counts/ordinals
  counts.forEach((n) => {
    cases.push({ q: posTemplates[0](n), expected: true, category: 'positional' });
    cases.push({ q: posTemplates[1](n), expected: true, category: 'positional' });
  });
  ordinals.forEach((o) => {
    cases.push({ q: posTemplates[2](o), expected: true, category: 'positional' });
  });
  // Add fixed positional
  posTemplates.slice(3).forEach((tpl) => cases.push({ q: tpl(), expected: true, category: 'positional' }));

  // Topical across topics
  topics.forEach((t) => {
    topTemplates.forEach((tpl) => cases.push({ q: tpl(t), expected: true, category: 'topical' }));
  });

  // Overview
  overview.forEach((q) => cases.push({ q, expected: true, category: 'overview' }));

  // Multilingual positional-ish
  multilingual.forEach((q) => cases.push({ q, expected: true, category: 'positional' }));

  // Negation traps (should be non-conversational)
  const negTrapsBase = [
    `summarize our chat`,
    `show me the conversation`,
    `display our chat history`,
  ];
  contractions.forEach((neg) => {
    negTrapsBase.forEach((b) => cases.push({ q: `${neg} ${b}`, expected: false, negation: true }));
  });

  // History traps (non-chat)
  const historyEntities = ["emperor","president","war","century","year","season","game","movie","album","book","battle","dynasty","kingdom","empire","country","city"];
  const historyTemplates = [
    (e) => `who was the first ${e}?`,
    (e) => `what was the last ${e}?`,
    (e) => `previous ${e} details?`,
  ];
  historyEntities.forEach((e) => historyTemplates.forEach((tpl) => cases.push({ q: tpl(e), expected: false })));

  // Tech/version non-chat
  topics.forEach((t) => cases.push({ q: `what is the most recent version of ${t}?`, expected: false }));

  // Weather/news non-chat
  cases.push({ q: `what’s the latest weather in NYC?`, expected: false });

  // Ensure we exceed 1000 by adding combinations
  // Pair every topic with every count for positional-like phrasing
  topics.forEach((t) => counts.forEach((n) => {
    cases.push({ q: `${n} messages back about ${t}, what did we say?`, expected: true, category: 'positional' });
    cases.push({ q: `show the ${n}th message about ${t}`, expected: true, category: 'positional' });
  }));

  return cases;
}

function computeMetrics(results) {
  let TP = 0, FP = 0, TN = 0, FN = 0;
  let negFP = 0; // negation false positives
  let posExp = 0, posHit = 0; // overall recall
  let posPositionalExp = 0, posPositionalHit = 0; // positional recall

  results.forEach(r => {
    const { expected, got, category, negation } = r;
    if (expected) {
      posExp++;
      if (got) {
        TP++; posHit++;
        if (category === 'positional') posPositionalHit++;
      } else {
        FN++;
        if (category === 'positional') posPositionalExp++;
      }
      if (category === 'positional' && got) posPositionalExp++; // count total positional expected once
    } else {
      if (got) { FP++; if (negation) negFP++; }
      else TN++;
    }
  });

  const precision = TP + FP === 0 ? 1 : TP / (TP + FP);
  const recall = posExp === 0 ? 1 : posHit / posExp;
  const accuracy = (TP + TN) / Math.max(1, (TP + TN + FP + FN));
  const positionalRecall = posPositionalExp === 0 ? 1 : posPositionalHit / posPositionalExp;

  return { TP, FP, TN, FN, precision, recall, accuracy, positionalRecall, negFP };
}

function printConfusion({ TP, FP, TN, FN }) {
  console.log(`\nConfusion Matrix`);
  console.log(`TP: ${TP}  FP: ${FP}`);
  console.log(`FN: ${FN}  TN: ${TN}`);
}

const failures = { pos: [], neg: [] };
function runOne(label, query, expected) {
  const got = !!UserMemoryAgent.isConversationalQueryRobust(query);
  const pass = got === expected;
  const mark = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark} [${label}] "${query}" -> ${got}`);
  if (!pass) failures[label]?.push({ query, got, expected });
  return pass;
}

(async () => {
  console.log('🧪 Conversational Query Detection — Robust Tests');

  // 1) Your original fixed lists (kept)
  const conversationalQueries = [
    "What topics have we been discussing?",
    "What have we talked about?",
    "What subjects did we cover?",
    "What things have we been discussing?",
    "What topics we've discussed",
    "What have we been covering?",
    "What was my first question?",
    "What did I ask earlier?",
    "What was our last conversation about?",
    "This chat is about what?",
    "In our conversation, what did we discuss?",
    "What was the first message?",
    "Show me the last few messages"
  ];
  const nonConversationalQueries = [
    "What was the last emperor of China?",
    "Who was the first president?",
    "What was the previous album by this artist?",
    "When was the last war?",
    "Don't show me the conversation",
    "I don't want to see what we discussed"
  ];

  let pass = 0, fail = 0;

  console.log('\n=== Baseline (existing samples) ===');
  conversationalQueries.forEach(q => runOne('pos', q, true) ? pass++ : fail++);
  nonConversationalQueries.forEach(q => runOne('neg', q, false) ? pass++ : fail++);

  // 2) Generated suite (~120 cases)
  const { positive, negative } = genCases();

  console.log('\n=== Generated Positives ===');
  positive.forEach(q => runOne('pos', q, true) ? pass++ : fail++);

  console.log('\n=== Generated Negatives ===');
  negative.forEach(q => runOne('neg', q, false) ? pass++ : fail++);

  // 3) Spot-check classify function (type/details)
  console.log('\n=== Classification spot-check ===');
  [
    "what was my first question?",
    "show the 3rd message",
    "2 messages back what did I say?",
    "what did the last emperor do?"
  ].forEach(q => {
    const res = UserMemoryAgent.classifyConversationalQuery(q);
    console.log(`"${q}" -> conv=${res.isConversational}, type=${res.type}, details=`, res.details);
  });

  // 4) Summary + assert (small suite)
  const total = pass + fail;
  console.log(`\n🎯 Summary: ${pass}/${total} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\n--- Failure Details ---');
    if (failures.pos.length) {
      console.log('\n[Expected conversational -> got false]');
      failures.pos.forEach(f => console.log(`POS FAIL: "${f.query}" -> got=${f.got}`));
    }
    if (failures.neg.length) {
      console.log('\n[Expected non-conversational -> got true]');
      failures.neg.forEach(f => console.log(`NEG FAIL: "${f.query}" -> got=${f.got}`));
    }
  }
  const minPassRate = 0.95; // tighten over time
  const passRate = pass / Math.max(1, total);
  try {
    assert.ok(passRate >= minPassRate, `Pass rate ${Math.round(passRate*100)}% < ${minPassRate*100}%`);
    console.log('✅ Threshold met');
  
    // 5) Large-scale suite (1000+)
    const mega = genMegaSuite();
    // Evaluate without spamming logs: only record failures
    const results = [];
    let failuresMega = 0;
    mega.forEach(tc => {
      const got = !!UserMemoryAgent.isConversationalQueryRobust(tc.q);
      results.push({ ...tc, got });
      if (got !== tc.expected) failuresMega++;
    });

    const metrics = computeMetrics(results);
    printConfusion(metrics);
    console.log(`\nMetrics:\n- Accuracy: ${(metrics.accuracy*100).toFixed(1)}%\n- Precision: ${(metrics.precision*100).toFixed(1)}%\n- Recall (overall): ${(metrics.recall*100).toFixed(1)}%\n- Positional Recall: ${(metrics.positionalRecall*100).toFixed(1)}%\n- Negation False Positives: ${metrics.negFP}`);

    // CI gates
    assert.ok(metrics.accuracy >= 0.95, `Overall accuracy ${(metrics.accuracy*100).toFixed(1)}% < 95%`);
    assert.ok(metrics.negFP === 0, `Negation false positives: ${metrics.negFP} (must be 0)`);
    assert.ok(metrics.positionalRecall >= 0.98, `Positional recall ${(metrics.positionalRecall*100).toFixed(1)}% < 98%`);

    console.log('\n✅ Large-scale thresholds met');
    process.exit(0);
  } catch (e) {
    console.error('❌ Threshold not met:', e.message);
    process.exit(1);
  }
})();
