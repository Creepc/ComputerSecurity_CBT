import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as study from '../study.js';

const cram=JSON.parse(fs.readFileSync(new URL('../data/cram.json',import.meta.url),'utf8'));
const chapters=[1,2,3,4].map(n=>JSON.parse(fs.readFileSync(new URL(`../data/chapter${n}.json`,import.meta.url),'utf8')));
const bank=chapters.flatMap(c=>c.questions),concepts=chapters.flatMap(c=>c.concepts);
const cramQuestions=cram.topics.flatMap(t=>t.questions);
const fixtureTopics=[{id:'focus-a',questions:[{id:'focus-choice',type:'mcq',options:[{}, {}, {}, {}]},{id:'focus-essay',type:'essay',options:[]}]},{id:'focus-b',questions:[{id:'focus-short',type:'short',options:[]}]}];

async function boot(saved={},cramFailure=null){
 const store={...saved},events={},updated=new Map(),app={innerHTML:''},session={},writes=[];
 const toast={textContent:'',classList:{add(){},remove(){}}};
 const datasets={...Object.fromEntries(chapters.map(ch=>[`chapter${ch.chapter}.json`,ch])),'cram.json':cram};
 const context=vm.createContext({__study:study,URLSearchParams,console,Date,Math,Number,Set,Map,JSON,String,Array,Object,Blob,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},location:{hash:'#/bank'},window:{scrollY:327,scrollTo(){},addEventListener(){},confirm(){return true}},document:{activeElement:null,documentElement:{dataset:{}},querySelector(s){if(s==='#app')return app;if(s==='#toast')return toast;return null},querySelectorAll(){return []},getElementById(id){if(!app.innerHTML.includes(`id="${id}"`))return null;return{scrollIntoView(){},set outerHTML(html){updated.set(id,html)}}},addEventListener(type,fn){events[type]=fn}},localStorage:{getItem(k){return store[k]||null},setItem(k,v){writes.push(k);store[k]=v}},sessionStorage:{getItem(k){return session[k]||null},setItem(k,v){session[k]=v}},fetch:async url=>{const key=String(url).split('/').at(-1).split('?')[0];if(key==='cram.json'&&cramFailure){if(cramFailure==='network')throw new Error('Network failure');return{ok:cramFailure!=='http',json:async()=>({topics:[]})};}return{ok:true,json:async()=>structuredClone(datasets[key]||{changes:[]})}}});
 const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 vm.runInContext(source.replace(/^import \{([^}]+)\} from [^;]+;/,'const {$1}=__study;').replace(/init\(\);\s*$/,'globalThis.bootPromise=init();'),context);
 await context.bootPromise;
 const run=code=>vm.runInContext(code,context);
 const read=hash=>{context.location.hash=hash;run('readRoute()');return app.innerHTML;};
 const click=(action,id,value)=>events.click({target:{closest(){return{dataset:{action,id,value}}}},preventDefault(){}});
 const input=(id,value)=>events.input({target:{dataset:{input:'cram-answer',id},value}});
 return{run,read,click,input,app,store,updated,writes};
}
const json=(env,expression)=>JSON.parse(env.run(`JSON.stringify(${expression})`));
const mainRecords=env=>env.run('JSON.stringify({attempts:state.attempts,worksheet:state.worksheet,notes:state.notes,bookmarks:state.bookmarks,learned:state.learned,exam:state.exam,examHistory:state.examHistory})');

test('old backups and missing or malformed cram values receive independent default states',()=>{
 const expected={answers:{},hidden:[],remembered:[],recall:false,onlyPending:false,catalogVersion:1};
 assert.deepEqual(study.emptyCramState(),expected);
 for(const raw of [undefined,null,[],true,1,'bad'])assert.deepEqual(study.sanitizeCramState(raw,fixtureTopics),expected);
 const legacy=study.emptyState();delete legacy.cram;
 assert.deepEqual(study.sanitizeState(legacy,bank,concepts).cram,expected);
 const a=study.emptyCramState(),b=study.emptyCramState();a.answers.x='text';a.hidden.push('x');
 assert.deepEqual(b,expected);
});

test('cram restore validates question and answer types, choice zero, IDs, duplicates and text limits',()=>{
 const raw={answers:{'focus-choice':0,'focus-essay':'가'.repeat(12001),'focus-short':' IP / DNS / ping ','unknown':'discard'},hidden:['focus-choice','unknown','focus-choice'],remembered:['focus-b','unknown','focus-b'],recall:true,onlyPending:true};
 const restored=study.sanitizeCramState(raw,fixtureTopics);
 assert.deepEqual(restored.answers,{'focus-choice':0,'focus-essay':'가'.repeat(12000),'focus-short':' IP / DNS / ping '});
 assert.deepEqual(restored.hidden,['focus-choice']);assert.deepEqual(restored.remembered,['focus-b']);
 assert.equal(raw.answers['focus-essay'].length,12001);
 for(const value of [-1,4,1.5,'0',NaN,Infinity,null,{},[]])assert.equal(study.sanitizeCramState({answers:{'focus-choice':value}},fixtureTopics).answers['focus-choice'],undefined);
 for(const value of [0,true,null,{},[]])assert.equal(study.sanitizeCramState({answers:{'focus-short':value,'focus-essay':value}},fixtureTopics).answers['focus-short'],undefined);
});

test('cram mode booleans restore strictly and normalized containers cannot alias an imported backup',()=>{
 for(const value of ['true','false',1,0,{},[],null]){
  const restored=study.sanitizeCramState({recall:value,onlyPending:value},fixtureTopics);
  assert.equal(restored.recall,false);assert.equal(restored.onlyPending,false);
 }
 const raw={answers:{'focus-essay':'초안'},hidden:['focus-essay'],remembered:['focus-a'],recall:true,onlyPending:true};
 const restored=study.sanitizeCramState(raw,fixtureTopics);restored.answers['focus-essay']='수정';restored.hidden.push('focus-short');restored.remembered.push('focus-b');
 assert.equal(raw.answers['focus-essay'],'초안');assert.deepEqual(raw.hidden,['focus-essay']);assert.deepEqual(raw.remembered,['focus-a']);
});

test('new topics stay hidden in an older recall backup while previous individual reveals and drafts survive',()=>{
 const added={id:'focus-added',introducedVersion:2,questions:[{id:'added-essay',type:'essay',options:[]},{id:'added-choice',type:'mcq',options:[{},{},{},{}]}]};
 const expanded=[...fixtureTopics,added];
 const legacy={answers:{'focus-essay':'계속 작성할 답안','focus-choice':0},hidden:['focus-choice'],remembered:['focus-a'],recall:true,onlyPending:true};
 const restored=study.sanitizeCramState(legacy,expanded);
 assert.deepEqual(restored.answers,legacy.answers);assert.deepEqual(restored.remembered,legacy.remembered);
 assert.deepEqual(restored.hidden,['focus-choice','added-essay','added-choice']);
 assert.equal(restored.hidden.includes('focus-essay'),false,'previously revealed old answers stay revealed');
 assert.equal(restored.catalogVersion,2);assert.equal(legacy.catalogVersion,undefined);
 restored.hidden=restored.hidden.filter(id=>id!=='added-essay');
 restored.answers['added-essay']='새 주제의 초안';
 assert.deepEqual(study.sanitizeCramState(JSON.parse(JSON.stringify(restored)),expanded),restored,'a new answer revealed after migration stays revealed on reload');
 const learning=study.sanitizeCramState({...legacy,recall:false},expanded);
 assert.deepEqual(learning.hidden,legacy.hidden);assert.equal(learning.catalogVersion,2);
 assert.equal(study.sanitizeCramState(null,expanded).catalogVersion,2);
});

test('adding cram backup data preserves main-bank attempts, draft answers, notes and exam results',()=>{
 const raw=study.emptyState(),q=bank.find(q=>q.type==='essay');
 study.recordAttempt(raw,q,'기존 서술 답안',0.5,true);
 raw.worksheet[q.id]={...study.emptyWorksheetDraft(q),text:'기존 미완성 답안',hintVisible:true};
 raw.notes[q.id]='기존 메모';raw.bookmarks.push(q.id);raw.learned.push(q.conceptId);
 raw.examHistory=[{ids:[q.id],score:67,revisions:{[q.id]:study.questionRevision(q)}}];
 raw.cram={answers:{'focus-choice':0,'focus-short':'용어'},hidden:['focus-short'],remembered:['focus-b'],recall:true,onlyPending:false,catalogVersion:1};
 const restored=study.sanitizeState(JSON.parse(JSON.stringify(raw)),bank,concepts,fixtureTopics);
 assert.deepEqual(restored.attempts,raw.attempts);assert.deepEqual(restored.worksheet,raw.worksheet);
 assert.deepEqual(restored.notes,raw.notes);assert.deepEqual(restored.bookmarks,raw.bookmarks);assert.deepEqual(restored.learned,raw.learned);
 assert.equal(restored.examHistory[0].score,67);assert.deepEqual(restored.cram,raw.cram);
});

test('failed or empty cram loading leaves the complete existing local backup untouched',async()=>{
 const raw=study.emptyState(),written=cramQuestions.find(q=>q.type==='essay');
 raw.cram={answers:{[written.id]:'반드시 보존할 초안'},hidden:[written.id],remembered:[cram.topics[0].id],recall:true,onlyPending:true};
 const q=bank.find(q=>q.type==='essay');study.recordAttempt(raw,q,'기존 답안',0.5,true);raw.notes[q.id]='기존 오답 메모';
 const text=JSON.stringify(raw);
 for(const failure of ['http','network','empty']){
  const env=await boot({[study.STORAGE_KEY]:text},failure);
  assert.ok(env.app.innerHTML.includes('학습 자료를 불러오지 못했습니다.'));
  assert.equal(env.store[study.STORAGE_KEY],text);
  assert.deepEqual(env.writes,[],'loading failure must not save a state with lost cram IDs');
 }
 const recovered=await boot({[study.STORAGE_KEY]:text});
 assert.equal(recovered.run(`state.cram.answers[${JSON.stringify(written.id)}]`),'반드시 보존할 초안');
 assert.equal(recovered.run(`state.attempts[${JSON.stringify(q.id)}].score`),0.5);
});

test('the cram route renders every selected topic and question separately from the full question bank',async()=>{
 const env=await boot(),html=env.read('#/cram');
 assert.equal((html.match(/class="surface cram-topic"/g)||[]).length,cram.topics.length);
 assert.equal((html.match(/class="cram-question"/g)||[]).length,cramQuestions.length);
 assert.equal((html.match(/class="cram-feedback"/g)||[]).length,cramQuestions.length);
 assert.equal((html.match(/class="cram-memory"/g)||[]).length,cram.topics.length);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 assert.equal(env.run('questions.length'),bank.length);
 assert.equal(env.run('cramQuestions().some(q=>byId.has(q.id))'),false);
 assert.deepEqual(json(env,'state.attempts'),{});
 assert.ok(env.read('#/bank').includes('href="#/cram"'));
});

test('the four bounded lecture additions are identified by lecture evidence without invented past questions',async()=>{
 const added=cram.topics.filter(t=>t.evidenceType==='lecture-core');
 assert.equal(added.length,4);assert.equal(cram.topics.length,16);assert.equal(cramQuestions.length,32);
 const env=await boot(),html=env.read('#/cram');
 for(const topic of added){
  assert.deepEqual(topic.evidence,[]);assert.ok(topic.lectureEvidence.length>0);
  assert.equal(topic.questions[0].label,'강의 핵심 예상');assert.equal(topic.introducedVersion,2);
  assert.equal(env.run(`cramEvidenceLabel(cramData.topics.find(t=>t.id===${JSON.stringify(topic.id)}))`),'현재 강의 핵심');
  const evidence=env.run(`cramEvidenceDetails(cramData.topics.find(t=>t.id===${JSON.stringify(topic.id)}))`);
  assert.match(evidence,/강의 [1-4]장/);assert.doesNotMatch(evidence,/(?:중간|기말) [0-9]/);
  assert.ok(html.includes(`id="${topic.id}"`));
 }
 assert.equal(env.run('questions.length'),462,'the separate cram additions do not inflate the scored main bank');
});

test('fresh and reset users start with the current catalog so new individual reveals survive reload',async()=>{
 const added=cram.topics.find(t=>t.introducedVersion===2).questions[0];
 const env=await boot();env.read('#/cram');
 for(const reset of [false,true]){
  if(reset)env.click('reset-state');
  assert.equal(env.run('state.cram.catalogVersion'),2);
  env.click('cram-recall');env.click('cram-reveal',added.id);
  env.input(added.id,'새 주제 작성 답안');
  assert.equal(env.run(`state.cram.hidden.includes(${JSON.stringify(added.id)})`),false);
  const restored=await boot(env.store);
  assert.equal(restored.run(`state.cram.hidden.includes(${JSON.stringify(added.id)})`),false);
  assert.equal(restored.run(`state.cram.answers[${JSON.stringify(added.id)}]`),'새 주제 작성 답안');
 }
});

test('typing Korean and symbols saves exact text without rerendering or disturbing another answer',async()=>{
 const written=cramQuestions.filter(q=>q.type!=='mcq'),env=await boot();env.read('#/cram');
 const before=env.app.innerHTML,text='가나다\nIP → DNS / %a·%A <메모> 🔒';
 env.input(written[0].id,text);env.input(written[1].id,'두 번째 초안');
 assert.equal(env.app.innerHTML,before,'input handlers must not recreate focused textarea nodes');
 assert.equal(env.updated.size,0);
 assert.equal(env.run(`state.cram.answers[${JSON.stringify(written[0].id)}]`),text);
 const restored=await boot(env.store);assert.equal(restored.run(`state.cram.answers[${JSON.stringify(written[0].id)}]`),text);
 assert.equal(restored.run(`state.cram.answers[${JSON.stringify(written[1].id)}]`),'두 번째 초안');
});

test('recall and learn toggle only visibility, preserving all drafts and main-bank records without grading',async()=>{
 const env=await boot();env.read('#/cram');const written=cramQuestions.find(q=>q.type==='essay');
 env.input(written.id,'가리고 다시 설명할 답안');
 env.run('const original=questions.find(q=>q.type==="essay");recordAttempt(state,original,"기존답",0.5,true);state.notes[original.id]="기존메모";save();');
 const records=mainRecords(env),answers=env.run('JSON.stringify(state.cram.answers)');
 env.click('cram-recall');assert.equal(env.run('state.cram.recall'),true);
 assert.equal(json(env,'state.cram.hidden').length,cramQuestions.length);
 assert.equal((env.app.innerHTML.match(/class="cram-memory"/g)||[]).length,0);
 assert.equal((env.app.innerHTML.match(/class="cram-feedback"/g)||[]).length,0);
 env.click('cram-learn');assert.equal(env.run('state.cram.recall'),false);assert.deepEqual(json(env,'state.cram.hidden'),[]);
 assert.equal((env.app.innerHTML.match(/class="cram-feedback"/g)||[]).length,cramQuestions.length);
 assert.equal(env.run('JSON.stringify(state.cram.answers)'),answers);assert.equal(mainRecords(env),records);
});

test('individual reveal and choice zero update only that question and never create scored attempts',async()=>{
 const env=await boot();env.read('#/cram');env.click('cram-recall');
 const choice=cramQuestions.find(q=>q.type==='mcq'),other=cramQuestions.find(q=>q.type==='essay');
 env.input(other.id,'별도 문항 답안');const hidden=env.run('state.cram.hidden.length');
 env.updated.clear();env.click('cram-choice',choice.id,'0');
 assert.equal(env.run(`state.cram.answers[${JSON.stringify(choice.id)}]`),0);
 assert.deepEqual([...env.updated.keys()],[choice.id]);
 env.click('cram-reveal',choice.id);assert.equal(env.run('state.cram.hidden.length'),hidden-1);
 assert.equal(env.run(`state.cram.hidden.includes(${JSON.stringify(other.id)})`),true);
 assert.equal(env.run(`state.cram.answers[${JSON.stringify(other.id)}]`),'별도 문항 답안');
 env.click('cram-reveal',choice.id);assert.equal(env.run('state.cram.hidden.length'),hidden);
 assert.deepEqual(json(env,'state.attempts'),{});
 const restored=await boot(env.store);assert.equal(restored.run(`state.cram.answers[${JSON.stringify(choice.id)}]`),0);
});

test('remembered-topic filtering preserves hidden drafts and can show all topics after none remain',async()=>{
 const env=await boot();env.read('#/cram');const first=cram.topics[0],q=first.questions.find(q=>q.type!=='mcq')||first.questions[0];
 if(q.type==='mcq')env.click('cram-choice',q.id,'0');else env.input(q.id,'나중에도 남길 답안');
 const answers=env.run('JSON.stringify(state.cram.answers)');
 env.click('cram-remember',first.id);env.click('cram-pending');
 assert.equal((env.app.innerHTML.match(/class="surface cram-topic"/g)||[]).length,cram.topics.length-1);
 assert.ok(!env.app.innerHTML.includes(`id="${first.id}"`));
 for(const topic of cram.topics.slice(1))env.click('cram-remember',topic.id);
 assert.equal((env.app.innerHTML.match(/class="surface cram-topic"/g)||[]).length,0);
 assert.ok(env.app.innerHTML.includes('모든 주제 보기'));
 assert.equal(env.run('JSON.stringify(state.cram.answers)'),answers);assert.deepEqual(json(env,'state.attempts'),{});
 const restored=await boot(env.store);restored.read('#/cram');assert.equal(restored.run('state.cram.onlyPending'),true);
 assert.equal(json(restored,'state.cram.remembered').length,cram.topics.length);
 restored.click('cram-pending');assert.equal((restored.app.innerHTML.match(/class="surface cram-topic"/g)||[]).length,cram.topics.length);
 assert.equal(restored.run('JSON.stringify(state.cram.answers)'),answers);
});

test('unknown IDs and invalid choice actions cannot add state or corrupt stored drafts',async()=>{
 const env=await boot();env.read('#/cram');const choice=cramQuestions.find(q=>q.type==='mcq'),essay=cramQuestions.find(q=>q.type==='essay');
 env.input(essay.id,'보존할 답안');const before=env.run('JSON.stringify(state)');
 for(const value of ['-1','4','0.5','NaN'])env.click('cram-choice',choice.id,value);
 env.click('cram-choice',essay.id,'0');env.click('cram-reveal','unknown');env.click('cram-remember','unknown');env.input('unknown','bad');
 assert.equal(env.run('JSON.stringify(state)'),before);
});
