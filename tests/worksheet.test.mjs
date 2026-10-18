import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, emptyWorksheetDraft, worksheetHasAnswer, evaluateWorksheet,
  sanitizeWorksheetDraft, sanitizeState, recordAttempt
} from '../study.js';

const mcq = {id:'worksheet-mcq',chapter:1,conceptId:'c1',type:'mcq',revision:2,
  options:[{text:'A'},{text:'B'},{text:'C'},{text:'D'}],answer:0,rubric:[]};
const ox = {id:'worksheet-ox',chapter:1,conceptId:'c1',type:'ox',
  options:[{text:'O'},{text:'X'}],answer:1,rubric:[]};
const short = {id:'worksheet-short',chapter:2,conceptId:'c2',type:'short',revision:2,
  options:[],answer:'/config.ini',acceptedAnswers:['/app/config.ini'],
  matchMode:'code',caseSensitive:true,rubric:['정확한 경로']};
const command = {...short,id:'worksheet-command',answer:'netstat -an',
  acceptedAnswers:['netstat -na'],caseSensitive:false};
const essay = {id:'worksheet-essay',chapter:2,conceptId:'c2',type:'essay',revision:2,
  options:[],answer:'정의와 원리 및 두 가지 대책',rubric:['정의','원리','대책1','대책2']};
const questions=[mcq,ox,short,command,essay];
const concepts=[{id:'c1',chapter:1},{id:'c2',chapter:2}];

test('worksheet answers and rubric arrays are independent for every question',()=>{
  const a=emptyWorksheetDraft(mcq),b=emptyWorksheetDraft(short),c=emptyWorksheetDraft(essay);
  a.choice=0;b.text='/config.ini';c.text='정의';c.rubric.push(0);
  assert.equal(a.text,'');assert.equal(b.choice,null);assert.deepEqual(a.rubric,[]);
  assert.deepEqual(b.rubric,[]);assert.equal(c.choice,null);
  const evaluated=evaluateWorksheet(essay,c);
  evaluated.rubric.push(1);
  assert.deepEqual(c.rubric,[0]);
});

test('choice zero is a valid answer while absent or out-of-range choices are not',()=>{
  const draft=emptyWorksheetDraft(mcq);
  assert.equal(worksheetHasAnswer(mcq,draft),false);
  for(const choice of [-1,4,1.5,'0',null,undefined])
    assert.equal(worksheetHasAnswer(mcq,{...draft,choice}),false);
  const graded=evaluateWorksheet(mcq,{...draft,choice:0});
  assert.equal(graded.graded,true);assert.equal(graded.score,1);
  assert.equal(evaluateWorksheet(ox,{...emptyWorksheetDraft(ox),choice:1}).score,1);
  assert.equal(evaluateWorksheet(mcq,{...draft,choice:2,accepted:true}).score,0);
});

test('short code grading preserves path symbols, case, command flags and aliases',()=>{
  const grade=(q,text)=>evaluateWorksheet(q,{...emptyWorksheetDraft(q),text});
  assert.equal(grade(short,'/config.ini').score,1);
  assert.equal(grade(short,'/app/config.ini').score,1);
  for(const text of ['config.ini','../../config.ini','/config/ini','/CONFIG.ini'])
    assert.equal(grade(short,text).score,0,text);
  assert.equal(grade(command,' NETSTAT  -AN ').score,1);
  assert.equal(grade(command,'netstat -na').score,1);
  assert.equal(grade(command,'netstat an').score,0);
});

test('opening explanations for an empty answer does not grade or create an attempt',()=>{
  const state=emptyState();
  for(const q of questions){
    const draft=evaluateWorksheet(q,{...emptyWorksheetDraft(q),text:'  \n '});
    assert.equal(draft.revealed,true);assert.equal(draft.graded,false);assert.equal(draft.score,0);
    state.worksheet[q.id]=draft;
  }
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),questions,concepts);
  assert.deepEqual(restored.attempts,{});
  assert.ok(Object.values(restored.worksheet).every(d=>d.revealed&&!d.graded));
});

test('essay reveal waits for self-grading and finalization records partial credit',()=>{
  const draft={...emptyWorksheetDraft(essay),text:'정의와 원리를 설명한 답안',rubric:[0,1]};
  const revealed=evaluateWorksheet(essay,draft);
  assert.equal(revealed.revealed,true);assert.equal(revealed.graded,false);assert.equal(revealed.score,0);
  const graded=evaluateWorksheet(essay,revealed,true);
  assert.equal(graded.graded,true);assert.equal(graded.score,0.5);
  const state=emptyState();recordAttempt(state,essay,graded.text,graded.score,true);
  assert.equal(state.attempts[essay.id].selfGraded,true);
  assert.equal(state.attempts[essay.id].correct,false);
  assert.equal(state.attempts[essay.id].count,1);
  assert.equal(state.attempts[essay.id].score,0.5);
});

test('manual short-answer acceptance survives restore and cannot grade a blank answer',()=>{
  const accepted=evaluateWorksheet(short,{...emptyWorksheetDraft(short),text:'의미가 같은 미등록 표현',accepted:true});
  assert.equal(accepted.graded,true);assert.equal(accepted.score,1);
  const restored=sanitizeWorksheetDraft(short,JSON.parse(JSON.stringify(accepted)));
  assert.equal(restored.accepted,true);assert.equal(restored.score,1);
  const blank=evaluateWorksheet(short,{...emptyWorksheetDraft(short),accepted:true});
  assert.equal(blank.graded,false);assert.equal(blank.score,0);
});

test('backup round trip preserves unfinished answers, hidden results and pending essay rubrics',()=>{
  const state=emptyState();
  state.worksheet[mcq.id]={...evaluateWorksheet(mcq,{...emptyWorksheetDraft(mcq),choice:0}),revealed:false};
  state.worksheet[short.id]={...emptyWorksheetDraft(short),text:'/app/config.ini'};
  state.worksheet[essay.id]=evaluateWorksheet(essay,{...emptyWorksheetDraft(essay),text:'작성 중인 서술 답안',rubric:[0,2]});
  state.learned=['c1'];state.bookmarks=[short.id];state.notes[essay.id]='복습 메모';
  recordAttempt(state,ox,0,0);
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),questions,concepts);
  assert.deepEqual(restored.worksheet,state.worksheet);
  assert.deepEqual(restored.attempts,state.attempts);
  assert.deepEqual(restored.learned,['c1']);assert.deepEqual(restored.bookmarks,[short.id]);
  assert.equal(restored.notes[essay.id],'복습 메모');
  assert.equal(restored.worksheet[essay.id].graded,false);
  assert.deepEqual(restored.worksheet[essay.id].rubric,[0,2]);
});

test('old backups restore without worksheet data and revised drafts cannot reuse old choices',()=>{
  const old=emptyState();delete old.worksheet;
  assert.deepEqual(sanitizeState(old,questions,concepts).worksheet,{});
  const state=emptyState();
  state.worksheet[mcq.id]={...emptyWorksheetDraft(mcq),revision:1,choice:0,graded:true,score:1};
  state.worksheet[ox.id]={...emptyWorksheetDraft(ox),choice:1};
  state.worksheet.unknown={revision:1,text:'unknown'};
  const restored=sanitizeState(state,questions,concepts);
  assert.equal(restored.worksheet[mcq.id],undefined);
  assert.equal(restored.worksheet.unknown,undefined);
  assert.equal(restored.worksheet[ox.id].choice,1);
});

test('malformed imported draft fields are bounded and do not trust claimed scores',()=>{
  for(const raw of [null,'bad',42,[],{revision:0},{revision:'2'}])
    assert.equal(sanitizeWorksheetDraft(essay,raw),null);
  const raw={revision:2,text:'x'.repeat(13000),choice:0,rubric:[0,0,1,9,-1,1.5,'2'],accepted:true,
    revealed:true,graded:true,score:Infinity};
  const fixed=sanitizeWorksheetDraft(essay,raw);
  assert.equal(fixed.text.length,12000);assert.equal(fixed.choice,null);
  assert.deepEqual(fixed.rubric,[0,1]);assert.equal(fixed.accepted,false);assert.equal(fixed.score,0.5);
  const badChoice=sanitizeWorksheetDraft(mcq,{revision:2,choice:'0',text:9,rubric:'bad',revealed:'true',graded:true,score:1});
  assert.equal(badChoice.choice,null);assert.equal(badChoice.text,'');
  assert.equal(badChoice.revealed,false);assert.equal(badChoice.graded,false);assert.equal(badChoice.score,0);
});

test('restoring graded drafts recomputes correct and wrong results independently',()=>{
  const state=emptyState();
  state.worksheet[mcq.id]={...emptyWorksheetDraft(mcq),choice:2,graded:true,score:1};
  state.worksheet[short.id]={...emptyWorksheetDraft(short),text:'/config.ini',graded:true,score:0};
  state.worksheet[essay.id]={...emptyWorksheetDraft(essay),text:'부분 답안',rubric:[3],graded:true,score:1};
  const restored=sanitizeState(state,questions,concepts);
  assert.equal(restored.worksheet[mcq.id].score,0);
  assert.equal(restored.worksheet[short.id].score,1);
  assert.equal(restored.worksheet[essay.id].score,0.25);
  assert.deepEqual(restored.attempts,{});
});
