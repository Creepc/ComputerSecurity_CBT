import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as study from '../study.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
const chapters=[1,2,3,4].map(n=>read(`chapter${n}`)),cram=read('cram'),book=read('cram-workbook'),lecture=read('lecture-sources');
const questions=chapters.flatMap(c=>c.questions),concepts=chapters.flatMap(c=>c.concepts),short=book.questions.find(q=>q.type==='short'),essay=book.questions.find(q=>q.type==='essay');
async function boot(saved={},failure=null){
 const store={...saved},events={},updated=new Map(),writes=[],app={innerHTML:''},toast={textContent:'',classList:{add(){},remove(){}}};
 const progress={textContent:''};
 const datasets={...Object.fromEntries(chapters.map(c=>[`chapter${c.chapter}.json`,c])),'cram.json':cram,'cram-workbook.json':book,'lecture-sources.json':lecture};
 const context=vm.createContext({__study:study,URLSearchParams,console,Date,Math,Number,Set,Map,JSON,String,Array,Object,Blob,URL,setTimeout:()=>0,clearTimeout(){},setInterval(){},location:{hash:'#/cram-workbook'},window:{scrollY:512,scrollTo(){},addEventListener(){},confirm(){return true}},document:{activeElement:null,documentElement:{dataset:{}},querySelector(s){if(s==='#app')return app;if(s==='#toast')return toast;if(s==='.workbook-progress')return progress;return null},querySelectorAll(){return []},getElementById(id){if(!app.innerHTML.includes(`id="${id}"`))return null;return{scrollIntoView(){},set outerHTML(html){updated.set(id,html)}}},addEventListener(type,fn){events[type]=fn}},localStorage:{getItem(k){return store[k]||null},setItem(k,v){store[k]=v;writes.push(k)}},sessionStorage:{getItem(){return null}},fetch:async url=>{const key=String(url).split('/').at(-1).split('?')[0];if(key==='cram-workbook.json'&&failure){if(failure==='network')throw new Error('network failure');return{ok:failure!=='http',json:async()=>({questions:[]})}}return{ok:true,json:async()=>structuredClone(datasets[key]||{changes:[]})}}});
 const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 vm.runInContext(source.replace(/^import \{([^}]+)\} from [^;]+;/,'const {$1}=__study;').replace(/init\(\);\s*$/,'globalThis.bootPromise=init();'),context);await context.bootPromise;
 const run=code=>vm.runInContext(code,context),readRoute=hash=>{context.location.hash=hash;run('readRoute()');return app.innerHTML;};
 const click=(action,id,value,index,checked)=>events.click({target:{closest(){return{dataset:{action,id,value,index},checked}}},preventDefault(){}});
 const input=(id,value)=>events.input({target:{dataset:{input:'workbook-answer',id},value}});
 return{run,read:readRoute,click,input,store,events,updated,writes,app,progress};
}
const json=(env,code)=>JSON.parse(env.run(`JSON.stringify(${code})`));

test('written cram backups validate IDs, text, hints and rubric indices without trusting scores',()=>{
 const raw={answers:{[short.id]:'가'.repeat(12001),[essay.id]:0,unknown:'discard'},revealed:[short.id,short.id,'unknown'],hints:[short.id,essay.id,'unknown'],rubrics:{[essay.id]:[0,0,-1,100,0.5,'1'],[short.id]:[0]},score:100};
 const result=study.sanitizeCramWorkbookState(raw,book.questions);
 assert.equal(result.answers[short.id].length,12000);assert.equal(result.answers[essay.id],undefined);
 assert.deepEqual(result.revealed,[short.id]);assert.deepEqual(result.hints,[essay.id]);assert.deepEqual(result.rubrics,{[essay.id]:[0]});assert.equal(result.score,undefined);
 for(const bad of [null,[],true,'bad'])assert.deepEqual(study.sanitizeCramWorkbookState(bad,book.questions),study.emptyCramWorkbookState());
 result.rubrics[essay.id].push(1);assert.deepEqual(raw.rubrics[essay.id],[0,0,-1,100,0.5,'1']);
});

test('new workbook backup data preserves main-bank results, old cram answers and unfinished writing',()=>{
 const state=study.emptyState(),q=questions.find(q=>q.type==='essay');study.recordAttempt(state,q,'기존 답',0.5,true);state.notes[q.id]='기존 메모';state.bookmarks.push(q.id);
 state.cram.answers['cram-01-q1']='기존 벼락치기 답';state.cram.remembered=['cram-01'];
 state.cramWorkbook={answers:{[essay.id]:'새 서술 초안'},revealed:[essay.id],hints:[essay.id],rubrics:{[essay.id]:[0]}};
 const restored=study.sanitizeState(JSON.parse(JSON.stringify(state)),questions,concepts,cram.topics,book.questions);
 assert.deepEqual(restored.attempts,state.attempts);assert.deepEqual(restored.notes,state.notes);assert.deepEqual(restored.bookmarks,state.bookmarks);assert.deepEqual(restored.cramWorkbook,state.cramWorkbook);assert.deepEqual(restored.cram.answers,state.cram.answers);
 const old={...state};delete old.cramWorkbook;assert.deepEqual(study.sanitizeState(old,questions,concepts,cram.topics,book.questions).cramWorkbook,study.emptyCramWorkbookState());
});

test('fresh workbook shows all 128 written questions in one scroll with answers and hints hidden',async()=>{
 const env=await boot(),html=env.app.innerHTML;
 assert.equal((html.match(/class="surface workbook-question"/g)||[]).length,128);assert.equal((html.match(/class="workbook-feedback"/g)||[]).length,0);assert.equal((html.match(/class="keyword-chips workbook-hint"/g)||[]).length,0);
 assert.match(html,/단답형 80문항 · 서술형 48문항/);assert.equal(env.run('questions.length'),462);assert.equal(env.run('cramQuestions().length'),32);assert.deepEqual(json(env,'state.attempts'),{});
 assert.ok(env.read('#/cram').includes('href="#/cram-workbook"'));
});

test('typing Korean and symbols preserves focus and round trips exact drafts without main-bank grading',async()=>{
 const env=await boot(),before=env.app.innerHTML,value='인증은 본인 확인.\n<답안> → A & B 🔒';
 env.input(essay.id,value);env.input(short.id,'기밀성');
 assert.equal(env.app.innerHTML,before);assert.equal(env.updated.size,0);assert.deepEqual(json(env,'state.attempts'),{});
 const restored=await boot(env.store);assert.equal(restored.run(`state.cramWorkbook.answers[${JSON.stringify(essay.id)}]`),value);assert.ok(restored.app.innerHTML.includes('&lt;답안&gt;'));assert.equal(restored.run(`state.cramWorkbook.answers[${JSON.stringify(short.id)}]`),'기밀성');
});

test('individual hints, answer reveal and essay checks affect only that workbook question',async()=>{
 const env=await boot();env.input(essay.id,'직접 쓴 답');env.click('wb-hint',essay.id);env.click('wb-reveal',essay.id);env.click('wb-rubric',essay.id,undefined,'0',true);
 assert.deepEqual(json(env,'state.cramWorkbook.revealed'),[essay.id]);assert.deepEqual(json(env,'state.cramWorkbook.hints'),[essay.id]);assert.deepEqual(json(env,`state.cramWorkbook.rubrics[${JSON.stringify(essay.id)}]`),[0]);assert.deepEqual(json(env,'state.attempts'),{});
 assert.equal(env.run(`state.cramWorkbook.revealed.includes(${JSON.stringify(short.id)})`),false);
 const restored=await boot(env.store);assert.deepEqual(json(restored,`state.cramWorkbook.rubrics[${JSON.stringify(essay.id)}]`),[0]);
 restored.input(essay.id,'수정한 답');assert.deepEqual(json(restored,`state.cramWorkbook.rubrics[${JSON.stringify(essay.id)}]`),[],'editing an answer clears stale self-checks');
});

test('chapter and type filters show every matching question and preserve other drafts and reveals',async()=>{
 const env=await boot();env.input(short.id,'보존할 답');env.click('wb-reveal',short.id);env.click('wb-chapter',undefined,'3');
 assert.equal((env.app.innerHTML.match(/class="surface workbook-question"/g)||[]).length,48);
 env.events.change({target:{dataset:{workbookFilter:'type'},value:'essay'}});
 assert.equal((env.app.innerHTML.match(/class="surface workbook-question"/g)||[]).length,18);
 env.click('wb-show-visible');assert.equal(json(env,'state.cramWorkbook.revealed').length,19);env.click('wb-hide-visible');assert.deepEqual(json(env,'state.cramWorkbook.revealed'),[short.id]);
 assert.equal(env.run(`state.cramWorkbook.answers[${JSON.stringify(short.id)}]`),'보존할 답');
});

test('short-only route shows 80 consecutive questions and preserves shared answers across routes',async()=>{
 const env=await boot();env.input(short.id,'기밀성');env.input(essay.id,'보존할 서술 답안');env.click('wb-hint',essay.id);env.click('wb-reveal',essay.id);env.click('wb-rubric',essay.id,undefined,'0',true);
 env.events.change({target:{dataset:{workbookFilter:'type'},value:'essay'}});
 const before=env.run('JSON.stringify(state.cramWorkbook)'),html=env.read('#/cram-short');
 assert.match(html,/벼락치기 단답형 문제집/);assert.match(html,/작성 1 \/ 80문항/);assert.ok(!html.includes('id="workbook-type"'));
 const displayed=[...html.matchAll(/class="surface workbook-question" id="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(displayed,book.questions.filter(q=>q.type==='short').map(q=>q.id));
 assert.deepEqual([...html.matchAll(/class="workbook-number">(\d+)</g)].map(m=>Number(m[1])),Array.from({length:80},(_,i)=>i+1));
 assert.ok(!html.includes('data-action="wb-hint"'));assert.ok(!html.includes('data-action="wb-rubric"'));assert.equal(env.run('JSON.stringify(state.cramWorkbook)'),before);
 assert.equal(env.run('questions.length'),462);assert.equal(env.run('workbookQuestions().length'),128);
 env.input(short.id,'무결성');assert.match(env.progress.textContent,/작성 1 \/ 80문항/);
 const mixed=env.read('#/cram-workbook');assert.equal((mixed.match(/class="surface workbook-question"/g)||[]).length,128);assert.ok(mixed.includes('무결성'));assert.ok(mixed.includes('보존할 서술 답안'));
 const restored=await boot(env.store);assert.equal(restored.run(`state.cramWorkbook.answers['${short.id}']`),'무결성');assert.deepEqual(json(restored,`state.cramWorkbook.rubrics['${essay.id}']`),[0]);
});

test('short workbook chapter and topic controls scope bulk reveals without touching essay records',async()=>{
 const env=await boot();env.input(essay.id,'서술 기록');env.click('wb-hint',essay.id);env.click('wb-reveal',essay.id);env.click('wb-rubric',essay.id,undefined,'0',true);env.read('#/cram-short');
 env.click('wb-chapter',undefined,'3');assert.equal((env.app.innerHTML.match(/class="surface workbook-question"/g)||[]).length,30);
 env.events.change({target:{dataset:{workbookFilter:'topic'},value:'cram-15'}});assert.equal((env.app.innerHTML.match(/class="surface workbook-question"/g)||[]).length,5);
 env.click('wb-show-visible');assert.deepEqual(json(env,'state.cramWorkbook.revealed'),[essay.id,...book.questions.filter(q=>q.topicId==='cram-15'&&q.type==='short').map(q=>q.id)]);
 env.click('wb-hide-visible');assert.deepEqual(json(env,'state.cramWorkbook.revealed'),[essay.id]);assert.deepEqual(json(env,'state.cramWorkbook.hints'),[essay.id]);assert.deepEqual(json(env,`state.cramWorkbook.rubrics['${essay.id}']`),[0]);assert.equal(env.run(`state.cramWorkbook.answers['${essay.id}']`),'서술 기록');
 env.click('wb-chapter',undefined,'all');env.click('wb-show-visible');assert.equal(json(env,'state.cramWorkbook.revealed').length,81);env.click('wb-hide-visible');assert.deepEqual(json(env,'state.cramWorkbook.revealed'),[essay.id]);
});

test('invalid actions cannot change records or mark hidden answers',async()=>{
 const env=await boot(),before=env.run('JSON.stringify(state)');
 for(const i of ['0','-1','100','0.5'])env.click('wb-rubric',essay.id,undefined,i,true);
 env.click('wb-rubric',short.id,undefined,'0',true);env.click('wb-hint',short.id);env.click('wb-reveal','unknown');env.input('unknown','bad');
 assert.equal(env.run('JSON.stringify(state)'),before);
});

test('failed workbook loading leaves complete existing study backup untouched',async()=>{
 const state=study.emptyState();state.cramWorkbook.answers[essay.id]='보존할 초안';state.notes[questions[0].id]='기존 메모';const saved=JSON.stringify(state);
 for(const failure of ['http','network','empty']){const env=await boot({[study.STORAGE_KEY]:saved},failure);assert.match(env.app.innerHTML,/학습 자료를 불러오지 못했습니다/);assert.equal(env.store[study.STORAGE_KEY],saved);assert.deepEqual(env.writes,[]);}
});

test('original PPT text and figures load only after expansion and are escaped as source material',async()=>{
 const env=await boot(),html=env.read('#/chapter/3');assert.equal((html.match(/data-source-chapter="3"/g)||[]).length,40);assert.ok(!html.includes('lecture-original'));
 env.run('lectureData={chapters:[{chapter:3,file:"원본.pptx",slides:[{number:1,text:"<script>원문 & 텍스트</script>",notes:"<img src=x> 노트 원문",images:[]}]}]}');
 const body={dataset:{},innerHTML:''},details={open:true,dataset:{sourceChapter:'3',sourceSlides:'1'},querySelector(){return body;}};
 env.events.toggle({target:details});assert.ok(body.innerHTML.includes('&lt;script&gt;원문 &amp; 텍스트&lt;/script&gt;'));assert.ok(!body.innerHTML.includes('<script>'));assert.ok(body.innerHTML.includes('&lt;img src=x&gt; 노트 원문'));assert.match(body.innerHTML,/원본.pptx/);assert.equal(body.dataset.loaded,'true');
 assert.deepEqual(json(env,'state.attempts'),{});
});
