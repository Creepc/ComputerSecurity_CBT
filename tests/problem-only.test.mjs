import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import * as study from '../study.js';

const chapters=[1,2,3,4].map(n=>JSON.parse(fs.readFileSync(new URL(`../data/chapter${n}.json`,import.meta.url),'utf8')));
const questions=chapters.flatMap(ch=>ch.questions),concepts=chapters.flatMap(ch=>ch.concepts);
const baselineEssayIds=`q1-054 q1-055 q1-056 q1-057 q1-058 q1-059 q1-060 q1-061 q1-062 q1-063 q1-064 q1-067 q1-068 q1-069 q1-070 q1-072 q1-073 q1-074 q1-075 q1-076 q1-077 q1-078
q2-111 q2-112 q2-113 q2-114 q2-115 q2-116 q2-117 q2-118 q2-119 q2-120 q2-121 q2-122 q2-123 q2-124 q2-125 q2-126 q2-127 q2-128 q2-129 q2-130 q2-131 q2-132 q2-133 q2-134 q2-137 q2-139 q2-140 q2-141 q2-142 q2-143 q2-145 q2-146 q2-147
q3-041 q3-042 q3-044 q3-046 q3-047 q3-049 q3-050 q3-052 q3-053 q3-055 q3-056 q3-057 q3-058 q3-059 q3-060 q3-061 q3-062 q3-064 q3-065 q3-067 q3-068 q3-069 q3-071 q3-073 q3-074 q3-076 q3-077 q3-078 q3-079 q3-080 q3-102 q3-105 q3-107 q3-108 q3-109 q3-112 q3-115 q3-117
q4-036 q4-037 q4-039 q4-041 q4-042 q4-044 q4-045 q4-047 q4-048 q4-049 q4-050 q4-051 q4-052 q4-054 q4-055 q4-056 q4-057 q4-059 q4-060 q4-061 q4-062 q4-063 q4-065 q4-066 q4-067 q4-068 q4-069 q4-071 q4-072 q4-073 q4-074 q4-075 q4-097 q4-102`.split(/\s+/);
// The original 127 essays' model answers and actual scoring criteria, before guides.
// New questions are deliberately outside this digest and are validated dynamically.
const baselineCriteriaDigest='1dcb44a06c28c96fba38db7327580cff1729ed3ec20377c5fc5374b3f8dca872';
const essay={id:'hint-essay',chapter:1,conceptId:'hint-concept',type:'essay',revision:2,options:[],answer:'원인과 결과',rubric:['원인','결과']};
const mcq={id:'hint-mcq',chapter:1,conceptId:'hint-concept',type:'mcq',options:[{text:'A'},{text:'B'}],answer:0};
const fixtureQuestions=[essay,mcq],fixtureConcepts=[{id:'hint-concept',chapter:1}];
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function boot(saved={}){
 const store={...saved},session={},events={},updated=new Map(),app={innerHTML:''};
 const toast={textContent:'',classList:{add(){},remove(){}}};
 const datasets=Object.fromEntries(chapters.map(ch=>[`chapter${ch.chapter}.json`,ch]));
 const context=vm.createContext({__study:study,URLSearchParams,console,Date,Math,Number,Set,Map,JSON,String,Array,Object,Blob,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},location:{hash:'#/bank'},window:{scrollY:0,scrollTo(){},addEventListener(){},confirm(){return true}},document:{activeElement:null,documentElement:{dataset:{}},querySelector(s){if(s==='#app')return app;if(s==='#toast')return toast;return null},querySelectorAll(){return []},getElementById(id){if(!app.innerHTML.includes(`id="${id}"`))return null;return{scrollIntoView(){},set outerHTML(html){updated.set(id,html)}}},addEventListener(type,fn){events[type]=fn}},localStorage:{getItem(k){return store[k]||null},setItem(k,v){store[k]=v}},sessionStorage:{getItem(k){return session[k]||null},setItem(k,v){session[k]=v}},fetch:async url=>{const key=String(url).split('/').at(-1).split('?')[0];return{ok:true,json:async()=>structuredClone(datasets[key]||{changes:[]})}}});
 const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 vm.runInContext(source.replace(/^import \{([^}]+)\} from [^;]+;/,'const {$1}=__study;').replace(/init\(\);\s*$/,'globalThis.bootPromise=init();'),context);
 await context.bootPromise;
 const run=code=>vm.runInContext(code,context);
 const read=hash=>{context.location.hash=hash;run('readRoute()');return app.innerHTML;};
 const click=(action,id,value,index,checked)=>events.click({target:{closest(){return{dataset:{action,id,value,index},checked}}},preventDefault(){}});
 const input=(id,value)=>events.input({target:{dataset:{input:'worksheet-answer',id},value}});
 return{run,read,click,input,app,store,updated};
}

test('essay hints default to hidden, and only literal true restores an essay hint',()=>{
 assert.equal(study.emptyWorksheetDraft(essay).hintVisible,false);
 const base={...study.emptyWorksheetDraft(essay),text:'아직 작성 중'};
 const legacy={...base};delete legacy.hintVisible;
 assert.equal(study.sanitizeWorksheetDraft(essay,legacy).hintVisible,false);
 for(const value of [false,0,1,'true','false',null,undefined,{},[]]){
  const restored=study.sanitizeWorksheetDraft(essay,{...base,hintVisible:value});
  assert.equal(restored.hintVisible,false,String(value));
 }
 assert.equal(study.sanitizeWorksheetDraft(essay,{...base,hintVisible:true}).hintVisible,true);
 assert.equal(study.sanitizeWorksheetDraft(mcq,{...study.emptyWorksheetDraft(mcq),hintVisible:true}).hintVisible,false);
});

test('backup round trip preserves hint and draft without inventing grades or attempts',()=>{
 const state=study.emptyState();
 state.worksheet[essay.id]={...study.emptyWorksheetDraft(essay),text:'작성 중인 답안',rubric:[0],hintVisible:true};
 state.worksheet[mcq.id]={...study.emptyWorksheetDraft(mcq),choice:0};
 state.notes[essay.id]='개인 메모';state.bookmarks.push(essay.id);
 const restored=study.sanitizeState(JSON.parse(JSON.stringify(state)),fixtureQuestions,fixtureConcepts);
 assert.deepEqual(restored.worksheet,state.worksheet);
 assert.deepEqual(restored.attempts,{});
 assert.equal(restored.worksheet[essay.id].graded,false);
 assert.equal(restored.worksheet[essay.id].revealed,false);
 assert.equal(restored.notes[essay.id],'개인 메모');
 assert.deepEqual(restored.bookmarks,[essay.id]);
});

test('restored hint cannot smuggle a score and a revised question discards the old hint draft',()=>{
 const malicious={...study.emptyWorksheetDraft(essay),hintVisible:true,score:1,graded:true,text:''};
 const draft=study.sanitizeWorksheetDraft(essay,malicious);
 assert.equal(draft.hintVisible,true);assert.equal(draft.graded,false);assert.equal(draft.score,0);
 assert.equal(study.sanitizeWorksheetDraft({...essay,revision:3},malicious),null);
 const raw=study.emptyState();raw.worksheet[essay.id]=malicious;
 assert.deepEqual(study.sanitizeState(raw,[{...essay,revision:3}],fixtureConcepts).worksheet,{});
});

test('adding writing guides preserves every original essay model answer and scoring criterion',()=>{
 const byId=new Map(questions.map(q=>[q.id,q]));
 const original=baselineEssayIds.map(id=>{
  const q=byId.get(id);assert.ok(q,`${id}: original essay missing`);assert.equal(q.type,'essay');
  return{id:q.id,answer:q.answer,rubric:q.rubric};
 });
 const digest=createHash('sha256').update(JSON.stringify(original)).digest('hex');
 assert.equal(digest,baselineCriteriaDigest,'Guides must explain existing criteria rather than silently change them.');
});

test('the four clarified real essays preserve old answers and scores while requesting a fresh assessment',()=>{
 const oldRevisions={'q1-059':1,'q2-126':2,'q2-132':1,'q4-054':1};
 const byId=new Map(questions.map(q=>[q.id,q])),raw=study.emptyState(),ids=[...Object.keys(oldRevisions),'q1-054'];
 raw.exam={ids,answers:{},grades:{},rubrics:{},revisions:{},deadline:Date.now()+60000,status:'done',index:0,mode:'written',started:Date.now()};
 for(const id of ids){
  const q=byId.get(id),oldRevision=oldRevisions[id]??study.questionRevision(q);
  if(id in oldRevisions)assert.equal(study.questionRevision(q),oldRevision+1,`${id}: explicit criterion needs a revision`);
  raw.attempts[id]={count:3,score:0.5,correct:false,answer:'보존할 이전 답안 '+id,date:100,wrongCount:2,selfGraded:true,revision:oldRevision};
  raw.worksheet[id]={...study.emptyWorksheetDraft(q),revision:oldRevision,text:'작성하던 답안 '+id};
  raw.notes[id]='보존 메모 '+id;raw.bookmarks.push(id);
  raw.exam.answers[id]='기존 시험 답안 '+id;raw.exam.grades[id]=1;raw.exam.rubrics[id]=[0];raw.exam.revisions[id]=oldRevision;
 }
 raw.examHistory=[{ids,score:80,revisions:{...raw.exam.revisions}}];
 const restored=study.sanitizeState(JSON.parse(JSON.stringify(raw)),questions,concepts);
 assert.equal(restored.exam.status,'review');
 assert.deepEqual(new Set(restored.exam.pendingRevisionIds),new Set(Object.keys(oldRevisions)));
 for(const id of ids){
  const changed=id in oldRevisions,a=restored.attempts[id];
  assert.equal(a.answer,raw.attempts[id].answer);assert.equal(a.score,0.5);assert.equal(a.count,3);
  assert.equal(a.needsReview,changed);assert.equal(restored.notes[id],raw.notes[id]);assert.ok(restored.bookmarks.includes(id));
  assert.equal(restored.exam.answers[id],raw.exam.answers[id]);
  if(changed){assert.equal(restored.worksheet[id],undefined);assert.equal(restored.exam.grades[id],undefined);assert.equal(restored.exam.rubrics[id],undefined);}
  else{assert.equal(restored.worksheet[id].text,raw.worksheet[id].text);assert.equal(restored.exam.grades[id],1);}
 }
 assert.equal(restored.examHistory[0].score,80);assert.equal(restored.examHistory[0].needsReview,true);
});

test('every current essay, including new questions, has term meanings and a substantive answer outline',()=>{
 const essays=questions.filter(q=>q.type==='essay');
 assert.ok(essays.length>=baselineEssayIds.length);
 for(const q of essays){
  const guide=q.writingGuide;assert.ok(guide,`${q.id}: guide missing`);
  assert.ok(Array.isArray(guide.keywords)&&guide.keywords.length>=2,`${q.id}: at least two terms`);
  const terms=[];
  for(const item of guide.keywords){
   assert.ok(typeof item.term==='string'&&item.term.trim(),`${q.id}: term missing`);
   assert.ok(typeof item.explanation==='string'&&item.explanation.trim(),`${q.id}: term meaning missing`);
   assert.notEqual(item.term.trim(),item.explanation.trim(),`${q.id}: term repeated instead of defined`);
   terms.push(item.term.trim());
  }
  assert.equal(new Set(terms).size,terms.length,`${q.id}: duplicate terms`);
  assert.ok(Array.isArray(guide.answerOutline)&&guide.answerOutline.length>=2,`${q.id}: outline length`);
  assert.ok(guide.answerOutline.every(s=>typeof s==='string'&&s.trim()),`${q.id}: empty outline step`);
 }
});

test('hint terms preserve case and symbols while withholding computed results and attached meanings',()=>{
 const terms=id=>questions.find(q=>q.id===id).writingGuide.keywords.map(k=>k.term);
 assert.deepEqual(terms('q2-140'),['%a','%A','%p','%P','%t','%T','%u','%U']);
 for(const marker of ['%X의 X','%X의 +','%X의 -'])assert.ok(terms('q2-152').includes(marker));
 assert.ok(terms('q2-117').every(term=>!/(?:6|91)\s*분/.test(term)));
 assert.ok(terms('q3-115').every(term=>!/(?:20|40)/.test(term)));
 assert.ok(terms('q2-145').every(term=>!/(?:23|22|21|3389|177|6000)/.test(term)));
 assert.ok(terms('q3-117').every(term=>!/[1-7]/.test(term)));
 assert.ok(terms('q4-048').every(term=>!(/A0[125]/.test(term))));
});

test('before revealing an essay, hint toggling exposes terms only and saves without grading',async()=>{
 const q=questions.find(q=>q.type==='essay'&&q.writingGuide);assert.ok(q,'essay guide fixture');
 const env=await boot();env.read(`#/worksheet/${q.chapter}`);
 env.input(q.id,'내가 작성하던 답안');
 env.click('worksheet-hint',q.id);
 const html=env.run(`worksheetCard(byId.get(${JSON.stringify(q.id)}),0)`);
 assert.ok(html.includes('keyword-chips'));
 for(const k of q.writingGuide.keywords)assert.ok(html.includes(`<span>${escapeHtml(k.term)}</span>`));
 for(const marker of ['keyword-definitions','answer-outline','model-answer','concept-recap','worksheet-feedback-'])assert.ok(!html.includes(marker),marker);
 const current=JSON.parse(env.run('JSON.stringify(state)'));
 assert.equal(current.worksheet[q.id].hintVisible,true);
 assert.equal(current.worksheet[q.id].text,'내가 작성하던 답안');
 assert.equal(current.worksheet[q.id].revealed,false);assert.equal(current.worksheet[q.id].graded,false);
 assert.deepEqual(current.attempts,{});
 const restored=await boot(env.store);assert.equal(restored.run(`state.worksheet[${JSON.stringify(q.id)}].hintVisible`),true);
 env.click('worksheet-hint',q.id);
 assert.equal(env.run(`state.worksheet[${JSON.stringify(q.id)}].hintVisible`),false);
});

test('every question explanation embeds its entire linked concept and all essay guide content',async()=>{
 const env=await boot(),byConcept=new Map(concepts.map(c=>[c.id,c]));
 for(const q of questions){
  const html=env.run(`allExplanations(byId.get(${JSON.stringify(q.id)}))`),c=byConcept.get(q.conceptId);
  assert.ok(html.includes(`data-concept-id="${c.id}"`),`${q.id}: linked concept missing`);
  for(const text of [c.title,c.summary,...c.details,...c.examples,...c.pitfalls])
   assert.ok(html.includes(escapeHtml(text)),`${q.id}: full concept field missing`);
  if(q.type==='essay'){
   assert.ok(html.includes(`data-guide-for="${q.id}"`));
   for(const k of q.writingGuide.keywords){assert.ok(html.includes(escapeHtml(k.term)));assert.ok(html.includes(escapeHtml(k.explanation)));}
   for(const step of q.writingGuide.answerOutline)assert.ok(html.includes(escapeHtml(step)));
  }
 }
});

test('keyword recall resets only the chosen draft while preserving attempts, notes and another answer',async()=>{
 const q=questions.find(q=>q.type==='essay'&&q.writingGuide),other=questions.find(other=>other.chapter===q.chapter&&other.id!==q.id&&other.type==='essay');
 const env=await boot();env.read(`#/worksheet/${q.chapter}`);
 env.input(q.id,'이전 서술 답안');env.click('worksheet-show',q.id);
 env.click('worksheet-rubric',q.id,undefined,'0',true);env.click('worksheet-grade',q.id);
 env.input(other.id,'다른 문항의 미완성 답안');env.click('worksheet-hint',other.id);
 env.run(`state.notes[${JSON.stringify(q.id)}]='보존할 메모';state.bookmarks.push(${JSON.stringify(q.id)});save();`);
 const records=env.run('JSON.stringify({attempts:state.attempts,notes:state.notes,bookmarks:state.bookmarks,exam:state.exam,examHistory:state.examHistory})');
 const otherBefore=env.run(`JSON.stringify(state.worksheet[${JSON.stringify(other.id)}])`);
 env.click('worksheet-recall',q.id);
 assert.deepEqual(JSON.parse(env.run(`JSON.stringify(state.worksheet[${JSON.stringify(q.id)}])`)),{...study.emptyWorksheetDraft(q),hintVisible:true});
 assert.equal(env.run(`JSON.stringify(state.worksheet[${JSON.stringify(other.id)}])`),otherBefore);
 assert.equal(env.run('JSON.stringify({attempts:state.attempts,notes:state.notes,bookmarks:state.bookmarks,exam:state.exam,examHistory:state.examHistory})'),records);
 const html=env.run(`worksheetCard(byId.get(${JSON.stringify(q.id)}),0)`);
 assert.ok(html.includes('keyword-chips'));assert.ok(!html.includes('model-answer'));assert.ok(!html.includes('keyword-definitions'));
 const restored=await boot(env.store);assert.equal(restored.run(`state.worksheet[${JSON.stringify(q.id)}].hintVisible`),true);
 assert.equal(restored.run(`state.worksheet[${JSON.stringify(other.id)}].text`),'다른 문항의 미완성 답안');
});

test('bulk explanation reading reveals concept and guide without grading or changing hints and drafts',async()=>{
 const q=questions.find(q=>q.type==='essay'&&q.writingGuide),env=await boot();env.read(`#/worksheet/${q.chapter}`);
 env.input(q.id,'채점하지 않을 초안');env.click('worksheet-hint',q.id);
 const before=env.run(`JSON.stringify(state.worksheet[${JSON.stringify(q.id)}])`);
 env.click('worksheet-expand-all');
 const after=JSON.parse(env.run(`JSON.stringify(state.worksheet[${JSON.stringify(q.id)}])`));
 assert.deepEqual({...after,revealed:false},JSON.parse(before));
 assert.deepEqual(JSON.parse(env.run('JSON.stringify(state.attempts)')),{});
 assert.ok(env.app.innerHTML.includes('keyword-definitions'));assert.ok(env.app.innerHTML.includes('concept-recap'));
 env.click('worksheet-collapse-all');
 assert.equal(env.run(`JSON.stringify(state.worksheet[${JSON.stringify(q.id)}])`),before);
 assert.deepEqual(JSON.parse(env.run('JSON.stringify(state.attempts)')),{});
});
