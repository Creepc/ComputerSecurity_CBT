import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, normalize, checkShort, shuffle, sanitizeState, recordAttempt,
  selectExam, questionPoints, examScore, conceptProgress, normalizeCode, questionRevision, acknowledgeRevision
} from '../study.js';

const concepts = [1,2,3,4].map(chapter => ({id:`c${chapter}`,chapter}));
const questions = concepts.flatMap(concept => Object.entries({essay:12,short:6,mcq:24,ox:7}).flatMap(([type,count]) =>
  Array.from({length:count},(_,i) => ({
    id:`q${concept.chapter}-${type}-${i}`, chapter:concept.chapter, conceptId:concept.id, type,
    ...(type==='short'?{shortForm:i%2===0?'multi-part':'single'}:{}),
    options:['mcq','ox'].includes(type) ? Array.from({length:type==='mcq'?4:2},(_,j)=>({text:`선택지 ${j}`,explanation:`개념 ${j}`})) : [],
    answer:['mcq','ox'].includes(type) ? 1 : type==='short' ? '버퍼 오버플로우' : '개념과 원리 및 대응책',
    acceptedAnswers:type==='short'?['Buffer Overflow','BOF']:[],
    rubric:type==='essay'?['개념','원리','대응책']:type==='short'?['명칭']:[]
  }))));
const byId = new Map(questions.map(q=>[q.id,q]));
const find = (type,chapter=1) => questions.find(q=>q.type===type&&q.chapter===chapter);
const rng = (seed=42) => () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const countTypes = ids => ids.reduce((counts,id)=>{const type=byId.get(id).type;counts[type]=(counts[type]||0)+1;return counts;},{});
function savedExam(overrides={}) {
  const choice=find('mcq'), essay=find('essay'), short=find('short');
  return {
    ids:[choice.id,essay.id,short.id], answers:{[choice.id]:1,[essay.id]:'설명한 답안',[short.id]:'BOF'},
    grades:{},rubrics:{},revisions:{[choice.id]:1,[essay.id]:1,[short.id]:1},pendingRevisionIds:[],revisionDrafts:{},
    deadline:1900000000000,status:'active',index:1,mode:'mixed',started:1899997000000,
    ...overrides
  };
}

test('학습 상태는 매번 독립된 빈 기록으로 시작한다',()=>{
  const a=emptyState(),b=emptyState();
  a.bookmarks.push(find('mcq').id);a.notes.x='메모';
  assert.deepEqual(b.bookmarks,[]);assert.deepEqual(b.notes,{});assert.equal(b.exam,null);
});

test('중간고사 양식은 중복 없이 서술 9·단답 1·객관 3의 13문항이다',()=>{
  const before=questions.map(q=>q.id);
  for(let seed=1;seed<=12;seed++) {
    const ids=selectExam(questions,'mixed','all',rng(seed));
    assert.equal(ids.length,13);assert.equal(new Set(ids).size,13);
    assert.deepEqual(countTypes(ids),{essay:9,short:1,mcq:3});
    assert.equal(new Set(ids.map(id=>byId.get(id).chapter)).size,4);
  }
  assert.deepEqual(questions.map(q=>q.id),before,'문제은행 원본 순서를 변경하면 안 된다');
});

test('장 제한은 모든 출제 유형에서 선택한 장만 사용한다',()=>{
  for(const chapter of [1,2,3,4])for(const mode of ['mixed','written','objective']) {
    const ids=selectExam(questions,mode,String(chapter),rng(chapter));
    assert.ok(ids.length>0);assert.equal(new Set(ids).size,ids.length);
    assert.ok(ids.every(id=>byId.get(id).chapter===chapter));
  }
  assert.deepEqual(selectExam(questions,'mixed','99',rng()),[]);
});

test('집중 모의고사는 지정 구성으로 출제하고 부족한 풀은 중복으로 채우지 않는다',()=>{
  assert.deepEqual(countTypes(selectExam(questions,'written','all',rng())),{essay:8,short:4});
  assert.deepEqual(countTypes(selectExam(questions,'objective','all',rng())),{mcq:20,ox:5});
  const small=[find('essay'),find('short'),find('mcq')];
  const ids=selectExam(small,'mixed','all',rng());
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
});

test('섞기는 원본을 유지하고 같은 난수열에서 재현 가능하다',()=>{
  const source=[1,2,3,4,5,6];
  assert.deepEqual(shuffle(source,rng(7)),shuffle(source,rng(7)));
  assert.deepEqual(source,[1,2,3,4,5,6]);
  assert.deepEqual([...shuffle(source,rng(2))].sort(),source);
});

test('중간 양식의 배점 합은 100점이며 서술 부분점수와 단답·객관 오답을 반영한다',()=>{
  const ids=selectExam(questions,'mixed','all',rng());
  assert.equal(ids.reduce((sum,id)=>sum+questionPoints(byId.get(id),'mixed'),0),100);
  const ex={ids,mode:'mixed',grades:Object.fromEntries(ids.map(id=>[id,1]))};
  assert.equal(examScore(ex,byId),100);
  ex.grades[ids.find(id=>byId.get(id).type==='essay')]=0.5;
  ex.grades[ids.find(id=>byId.get(id).type==='short')]=0;
  ex.grades[ids.find(id=>byId.get(id).type==='mcq')]=0;
  assert.equal(examScore(ex,byId),84);
  const firstEssay=ids.find(id=>byId.get(id).type==='essay');
  ex.grades[firstEssay]=9;assert.equal(examScore(ex,byId),88,'한 문항을 배점보다 높게 계산하면 안 된다');
  ex.grades[firstEssay]=-2;assert.equal(examScore(ex,byId),80,'음수 점수는 0점으로 제한한다');
  assert.equal(examScore({ids:[],mode:'mixed',grades:{}},byId),0);
});

test('동일 배점 시험은 부분점수를 포함하여 100점으로 환산한다',()=>{
  const ids=selectExam(questions,'objective','all',rng());
  const grades=Object.fromEntries(ids.map(id=>[id,1]));grades[ids[0]]=0.5;
  assert.equal(examScore({ids,grades,mode:'objective'},byId),98);
  assert.equal(questionPoints(find('essay'),'written'),1);
});

test('단답형은 등록 동의어·대소문자·전각문자·공백·구두점을 정규화한다',()=>{
  const q=find('short');
  for(const answer of ['버퍼오버플로우',' buffer-overflow. ','ＢＯＦ','bOf'])assert.equal(checkShort(q,answer),true,answer);
  assert.equal(checkShort(q,'스택 카나리'),false);assert.equal(checkShort(q,''),false);
  assert.equal(normalize(' ＳＱＬ Injection! '),'sqlinjection');
});

test('최근 시도 결과가 오답 상태를 결정하고 누적 오답 횟수는 보존한다',()=>{
  const s=emptyState(),q=find('essay');
  recordAttempt(s,q,'첫 오답',0);recordAttempt(s,q,'부분 답',0.5,true);
  assert.equal(s.attempts[q.id].correct,false);assert.equal(s.attempts[q.id].wrongCount,2);
  recordAttempt(s,q,'완전 답안',1,true);
  assert.equal(s.attempts[q.id].correct,true);assert.equal(s.attempts[q.id].wrongCount,2);
  recordAttempt(s,q,'다시 틀린 답',0);
  assert.equal(s.attempts[q.id].correct,false);assert.equal(s.attempts[q.id].count,4);
  assert.equal(s.attempts[q.id].wrongCount,3);assert.equal(s.attempts[q.id].answer,'다시 틀린 답');
  assert.equal(s.attempts[q.id].selfGraded,false);assert.ok(Number.isFinite(s.attempts[q.id].date));
});

test('개념 풀이 현황은 부분점수를 완전 정답으로 세지 않는다',()=>{
  const s=emptyState(),own=questions.filter(q=>q.conceptId==='c1');
  recordAttempt(s,own[0],'정답',1);recordAttempt(s,own[1],'부분',0.5);recordAttempt(s,own[2],'오답',0);
  assert.deepEqual(conceptProgress(concepts[0],questions,s),{total:own.length,done:3,correct:1});
});

test('다른 형식의 기록 파일은 복원하지 않는다',()=>{
  for(const raw of [null,{},[],{version:2}])assert.throws(()=>sanitizeState(raw,questions,concepts));
});

test('복원은 미지의 ID와 잘못된 메모를 버리고 문자열 길이를 제한한다',()=>{
  const id=find('mcq').id;
  const raw={...emptyState(),theme:'unknown',bookmarks:[id,id,'missing'],learned:['c1','c1','missing'],notes:{[id]:'x'.repeat(13000),missing:'비유효', [find('short').id]:9},attempts:{missing:{score:1}}};
  const s=sanitizeState(raw,questions,concepts);
  assert.equal(s.theme,'light');assert.deepEqual(s.bookmarks,[id]);assert.deepEqual(s.learned,['c1']);
  assert.equal(s.notes[id].length,12000);assert.equal(s.notes.missing,undefined);assert.equal(s.notes[find('short').id],undefined);
  assert.deepEqual(s.attempts,{});
});

test('진행 중인 시험 답안·현재 위치·시간은 JSON 백업 후 복원된다',()=>{
  const raw={...emptyState(),theme:'dark',exam:savedExam()};
  const s=sanitizeState(JSON.parse(JSON.stringify(raw)),questions,concepts);
  assert.deepEqual(s.exam,raw.exam);assert.equal(s.theme,'dark');
  assert.deepEqual(raw.exam.answers,s.exam.answers);
  const essay=find('essay').id;
  for(const status of ['review','done']) {
    const finished={...raw,exam:savedExam({status,rubrics:{[essay]:[0,2]},grades:Object.fromEntries(raw.exam.ids.map(id=>[id,id===essay?2/3:1]))})};
    assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(finished)),questions,concepts).exam,finished.exam);
  }
  assert.equal(sanitizeState({...raw,exam:savedExam({ids:['missing']})},questions,concepts).exam,null);
  assert.equal(sanitizeState({...raw,exam:savedExam({deadline:'잘못된 시간'})},questions,concepts).exam,null);
});

test('중복 시험 ID와 소수 인덱스가 있어도 현재 위치는 유효한 정수다',()=>{
  const id=find('mcq').id;
  let s=sanitizeState({...emptyState(),exam:savedExam({ids:[id,id],index:1})},questions,concepts);
  assert.deepEqual(s.exam.ids,[id]);assert.equal(s.exam.index,0);
  s=sanitizeState({...emptyState(),exam:savedExam({index:1.5})},questions,concepts);
  assert.ok(Number.isInteger(s.exam.index));assert.ok(s.exam.index>=0&&s.exam.index<s.exam.ids.length);
});

test('복원된 채점 요소는 실제 항목 범위에서 중복 없이 유지된다',()=>{
  const essay=find('essay'),mcq=find('mcq');
  const raw={...emptyState(),exam:savedExam({status:'review',rubrics:{[essay.id]:[0,0,1,2,3,49,-1,0.5,'1'],[mcq.id]:[0]},grades:{[essay.id]:5,[mcq.id]:-2,missing:1}})};
  const s=sanitizeState(raw,questions,concepts);
  assert.deepEqual(s.exam.rubrics[essay.id],[0,1,2]);
  assert.equal(s.exam.grades[essay.id],1);assert.equal(s.exam.grades[mcq.id],0);assert.equal(s.exam.grades.missing,undefined);
});

test('복원된 최근 정답 여부는 점수와 일치하며 숫자 필드가 비정상 값이 되지 않는다',()=>{
  const q=find('mcq');
  const s=sanitizeState({...emptyState(),attempts:{[q.id]:{count:-5,wrongCount:Infinity,score:0.5,correct:true,date:Infinity,answer:1}}},questions,concepts);
  const a=s.attempts[q.id];assert.equal(a.correct,a.score===1);assert.equal(a.count,1);
  assert.ok(Number.isFinite(a.wrongCount));assert.ok(Number.isFinite(a.date));
});

test('기록 함수는 유효 점수 범위 밖의 값도 0~1 사이의 유한 점수로 보관한다',()=>{
  const s=emptyState(),q=find('essay');
  recordAttempt(s,q,'과도한 점수',2);assert.equal(s.attempts[q.id].score,1);
  recordAttempt(s,q,'음수',-1);assert.equal(s.attempts[q.id].score,0);
  recordAttempt(s,q,'비정상 숫자',NaN);assert.ok(Number.isFinite(s.attempts[q.id].score));
  assert.equal(s.attempts[q.id].correct,false);
});

test('교수 양식 단답은 범위 안 단일답을 우선하고 없을 때 복합답을 사용한다',()=>{
  for(let seed=1;seed<=20;seed++)for(const chapter of ['all','1','2','3','4']) {
    const ids=selectExam(questions,'mixed',chapter,rng(seed));
    const short=ids.map(id=>byId.get(id)).find(q=>q.type==='short');
    assert.equal(short.shortForm,'single');
  }
  const onlyMultipart=questions.filter(q=>q.type!=='short'||q.shortForm==='multi-part');
  const fallback=selectExam(onlyMultipart,'mixed','4',rng()).map(id=>byId.get(id)).find(q=>q.type==='short');
  assert.equal(fallback.shortForm,'multi-part');assert.equal(fallback.chapter,4);
  const limited=questions.filter(q=>q.type!=='short'||(q.chapter===1&&Number(q.id.split('-').at(-1))<4));
  const written=selectExam(limited,'written','1',rng()).map(id=>byId.get(id)).filter(q=>q.type==='short');
  assert.equal(written.length,4);assert.ok(written.some(q=>q.shortForm==='single'));assert.ok(written.some(q=>q.shortForm==='multi-part'));
});

test('경로 단답은 슬래시·상위 경로·점·대소문자를 보존한다',()=>{
  const q={answer:'/config.ini',acceptedAnswers:[],matchMode:'code',caseSensitive:true};
  assert.equal(checkShort(q,' /config.ini '),true);
  for(const answer of ['config.ini','../../config.ini','/config/ini','/CONFIG.INI','configini'])assert.equal(checkShort(q,answer),false,answer);
});

test('명령 단답은 공백 폭과 인쇄용 대시는 허용하고 옵션 기호·토큰은 유지한다',()=>{
  const q={answer:'netstat -an',acceptedAnswers:[],matchMode:'code'};
  for(const answer of [' NETSTAT   -an ','netstat –an','netstat\t-an'])assert.equal(checkShort(q,answer),true,answer);
  for(const answer of ['netstat an','netstatan','netstat-an','netstat /an'])assert.equal(checkShort(q,answer),false,answer);
  const view={answer:'UNIFIED_AUDIT_TRAIL',matchMode:'code'};
  assert.equal(checkShort(view,'unified_audit_trail'),true);assert.equal(checkShort(view,'UNIFIEDAUDITTRAIL'),false);
});

test('조회 방향을 묻는 단답은 오른쪽·왼쪽 화살표를 구별한다',()=>{
  const q={answer:'IP → 도메인 이름',matchMode:'code'};
  assert.equal(checkShort(q,'IP -> 도메인 이름'),true);
  assert.equal(checkShort(q,'IP ← 도메인 이름'),false);
  assert.equal(checkShort(q,'IP <- 도메인 이름'),false);
  assert.equal(checkShort(q,'도메인 이름 → IP'),false);
  assert.equal(normalizeCode(' A → B '),'a→b');
});

test('용어형 숫자 단답도 양수와 음수를 같은 값으로 인정하지 않는다',()=>{
  const q={answer:'48비트, 24비트',acceptedAnswers:['48비트 24비트']};
  assert.equal(checkShort(q,'48비트 24비트'),true);
  for(const answer of ['-48비트, 24비트','48비트, -24비트','−48비트,24비트'])assert.equal(checkShort(q,answer),false,answer);
  assert.equal(normalize('buffer-overflow'),normalize('Buffer Overflow'));
  assert.equal(normalize('SHA-256'),normalize('SHA256'));
});

test('문항 revision은 양의 정수만 인정하고 기존 문항은 1로 해석한다',()=>{
  assert.equal(questionRevision({revision:2}),2);
  for(const revision of [undefined,0,-1,1.5,'2',NaN])assert.equal(questionRevision({revision}),1);
});

test('개정 전 시도는 답안·점수·메모를 보존하되 현재 정답률에서 제외한다',()=>{
  const changed=find('essay'),unchanged=find('mcq');
  const current=questions.map(q=>q.id===changed.id?{...q,revision:2}:q);
  const raw=emptyState();recordAttempt(raw,changed,'개정 전 작성한 답',1,true);recordAttempt(raw,unchanged,1,1);
  raw.notes[changed.id]='틀렸던 이유 메모';raw.bookmarks=[changed.id];
  const s=sanitizeState(JSON.parse(JSON.stringify(raw)),current,concepts),a=s.attempts[changed.id];
  assert.equal(a.answer,'개정 전 작성한 답');assert.equal(a.score,1);assert.equal(a.correct,false);assert.equal(a.needsReview,true);assert.equal(a.revision,1);
  assert.equal(s.notes[changed.id],'틀렸던 이유 메모');assert.deepEqual(s.bookmarks,[changed.id]);
  assert.equal(s.attempts[unchanged.id].needsReview,false);assert.equal(s.attempts[unchanged.id].correct,true);
  const p=conceptProgress(concepts[0],current,s);assert.equal(p.done,1);assert.equal(p.correct,1);
  recordAttempt(s,current.find(q=>q.id===changed.id),'새 기준으로 다시 푼 답',1,true);
  assert.equal(s.attempts[changed.id].revision,2);assert.equal(s.attempts[changed.id].needsReview,false);assert.equal(s.attempts[changed.id].count,2);
});

test('완료 시험의 개정 문항만 재검토 상태로 돌리고 과거 숫자 답을 새 정답으로 채점하지 않는다',()=>{
  const changed=find('mcq'),essay=find('essay'),short=find('short');
  const current=questions.map(q=>q.id===changed.id?{...q,revision:2,answer:0}:q);
  const ex=savedExam({status:'done',grades:{[changed.id]:1,[essay.id]:0.5,[short.id]:1},rubrics:{[changed.id]:[0],[essay.id]:[0]}});
  const s=sanitizeState({...emptyState(),exam:ex},current,concepts);
  assert.equal(s.exam.status,'review');assert.deepEqual(s.exam.pendingRevisionIds,[changed.id]);
  assert.equal(s.exam.answers[changed.id],1,'과거 답은 현재 보기 의미로 변환하지 않고 보존한다');
  assert.equal(s.exam.grades[changed.id],undefined);assert.equal(s.exam.rubrics[changed.id],undefined);
  assert.equal(s.exam.grades[essay.id],0.5);assert.deepEqual(s.exam.rubrics[essay.id],[0]);assert.equal(s.exam.grades[short.id],1);
  assert.equal(s.exam.revisions[changed.id],1);
});

test('재확인 확인은 해당 문항의 revision만 갱신하고 새 답안 초안을 제거한다',()=>{
  const changed={...find('mcq'),revision:2},other={...find('essay'),revision:3};
  const ex=savedExam({pendingRevisionIds:[changed.id,other.id],revisionDrafts:{[changed.id]:0,[other.id]:'작성 중'}});
  const preserved={...ex.answers};acknowledgeRevision(ex,changed);
  assert.equal(ex.revisions[changed.id],2);assert.deepEqual(ex.pendingRevisionIds,[other.id]);
  assert.equal(ex.revisionDrafts[changed.id],undefined);assert.equal(ex.revisionDrafts[other.id],'작성 중');assert.deepEqual(ex.answers,preserved);
});

test('개정 답안 초안은 해당 문항의 선택형/주관식 형식에 맞게 복원한다',()=>{
  const choice=find('mcq'),essay=find('essay'),short=find('short');
  const current=questions.map(q=>[choice.id,essay.id].includes(q.id)?{...q,revision:2}:q);
  const ex=savedExam({status:'review',revisionDrafts:{[choice.id]:0,[essay.id]:'x'.repeat(13000),[short.id]:'개정 안 된 문항의 초안',missing:'없는 문항'}});
  const s=sanitizeState({...emptyState(),exam:ex},current,concepts);
  assert.equal(s.exam.revisionDrafts[choice.id],0);assert.equal(s.exam.revisionDrafts[essay.id].length,12000);
  assert.equal(s.exam.revisionDrafts[short.id],undefined);assert.equal(s.exam.revisionDrafts.missing,undefined);
  ex.revisionDrafts={[choice.id]:'1',[essay.id]:1};
  const invalid=sanitizeState({...emptyState(),exam:ex},current,concepts);
  assert.equal(invalid.exam.revisionDrafts[choice.id],undefined);assert.equal(invalid.exam.revisionDrafts[essay.id],undefined);
});

test('과거 시험 이력은 점수를 보존하면서 개정 전 문항 포함 여부를 표시한다',()=>{
  const changed=find('essay'),unchanged=find('mcq');
  const current=questions.map(q=>q.id===changed.id?{...q,revision:2}:q);
  const raw={...emptyState(),examHistory:[{date:1,ids:[changed.id],score:100,mode:'written'},{date:2,ids:[unchanged.id],score:100,mode:'objective'}]};
  const s=sanitizeState(raw,current,concepts);
  assert.equal(s.examHistory[0].score,100);assert.equal(s.examHistory[0].needsReview,true);assert.equal(s.examHistory[1].needsReview,false);
});
