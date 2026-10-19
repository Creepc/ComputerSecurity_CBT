import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const data=read('data/cram.json'),chapters=[1,2,3,4].map(n=>read(`data/chapter${n}.json`));
const errors=[],ids=new Set(),prompts=new Set();
const check=(value,message)=>{if(!value)errors.push(message);};
const text=v=>typeof v==='string'&&v.trim().length>0;
const strings=v=>Array.isArray(v)&&v.length>0&&v.every(text);
const normalized=v=>v.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
const oldPrompts=new Set(chapters.flatMap(ch=>ch.questions).map(q=>normalized(q.prompt)));
check(data.version===1,'벼락치기 schema version1 필요');
for(const field of ['selectionNote','evidenceNote','exclusionNote'])check(text(data[field]),field+' 필요');
check(Array.isArray(data.patterns)&&data.patterns.length>=3,'실제 기출 출제패턴 설명 필요');
for(const p of data.patterns||[])check(text(p.title)&&text(p.observation),'출제패턴 제목·구체적 관찰 필요');
check(Array.isArray(data.topics)&&data.topics.length>=8&&data.topics.length<=12,'집중 주제는8~12개로 제한');
let total=0;const types={};
for(const [index,t] of (data.topics||[]).entries()){
 check(t.id===`cram-${String(index+1).padStart(2,'0')}`,t.id+': 연속된 우선순위 ID 필요');
 check(!ids.has(t.id),t.id+': ID 중복');ids.add(t.id);
 const ch=chapters.find(c=>c.chapter===t.chapter);
 check(!!ch,t.id+': 잘못된 장');
 for(const field of ['title','priorityReason','memoryLine'])check(text(t[field]),t.id+': '+field+' 필요');
 check(t.memoryTips&&typeof t.memoryTips==='object'&&!Array.isArray(t.memoryTips),t.id+': 주제별 암기 팁 필요');
 for(const field of ['cue','howToRemember','distinguish','recallPrompt'])check(text(t.memoryTips?.[field]),t.id+': 암기 팁 '+field+' 필요');
 check(Array.isArray(t.sourceSlides)&&t.sourceSlides.length>0&&t.sourceSlides.every(n=>Number.isInteger(n)&&n>=1&&n<=[0,40,74,74,56][t.chapter]),t.id+': 범위 내 슬라이드 근거 필요');
 check(Array.isArray(t.conceptIds)&&t.conceptIds.length>0&&t.conceptIds.every(id=>ch?.concepts.some(c=>c.id===id)),t.id+': 해당 장 개념 참조 필요');
 check(Array.isArray(t.evidence)&&t.evidence.length>0,t.id+': 기출 발문 근거 필요');
 for(const ev of t.evidence||[])check(['midterm','final'].includes(ev.exam)&&Array.isArray(ev.numbers)&&ev.numbers.length>0&&ev.numbers.every(n=>Number.isInteger(n)&&n>=1&&n<=(ev.exam==='midterm'?13:12))&&text(ev.observation),t.id+': 기출 종류·문항·관찰 필요');
 check(Array.isArray(t.essentials)&&t.essentials.length>=3&&t.essentials.length<=7,t.id+': 핵심 용어3~7개 필요');
 const terms=new Set();for(const k of t.essentials||[]){check(text(k.term)&&text(k.explanation),t.id+': 용어 뜻 필요');check(!terms.has(k.term),t.id+': 용어 중복');terms.add(k.term);}
 check(Array.isArray(t.questions)&&t.questions.length===2,t.id+': 예상문항2개 필요');
 for(const [i,q] of (t.questions||[]).entries()){
  total++;types[q.type]=(types[q.type]||0)+1;
  check(q.id===`${t.id}-q${i+1}`,q.id+': 주제 안의 문항 ID 불일치');check(!ids.has(q.id),q.id+': ID 중복');ids.add(q.id);
  check(q.label===(i===0?(t.evidenceType==='style-transfer'?'성향 적용 예상':'기출형 예상'):'범위 내 변형'),q.id+': 기출 근거와 성향 적용·변형 구분 필요');
  check(['essay','short','mcq'].includes(q.type),q.id+': 문항 유형 불일치');
  check(text(q.prompt)&&text(q.explanation),q.id+': 발문·해설 필요');
  if(text(q.prompt)){const key=normalized(q.prompt);check(!prompts.has(key),q.id+': 새 예상문항 발문 중복');check(!oldPrompts.has(key),q.id+': 기존 문제와 발문 동일');prompts.add(key);}
  if(q.type==='mcq'){
   check(Array.isArray(q.options)&&q.options.length===4,q.id+': 4지선다 필요');
   check(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4,q.id+': 정답 번호 불일치');
   for(const o of q.options||[])check(text(o.text)&&text(o.explanation),q.id+': 모든 보기의 내용·해설 필요');
   check(new Set((q.options||[]).map(o=>o.text)).size===4,q.id+': 보기 중복');
  }else{
   check(Array.isArray(q.options)&&q.options.length===0,q.id+': 서술·단답 options는 빈 배열');
   check(text(q.answer)&&strings(q.rubric),q.id+': 모범답안·체크 요소 필요');
   if(q.type==='short')check(strings(q.acceptedAnswers),q.id+': 인정 답안 필요');
  }
 }
}
check(total===data.topics.length*2,'주제당2문항 수 불일치');
check(!/반드시\s*출제|100%\s*출제|무조건\s*나온|만점\s*보장/.test(JSON.stringify(data)),'출제·점수 확정 표현 금지');
if(errors.length){for(const error of errors)console.error(error);process.exit(1);}
console.log(`벼락치기 검증 통과: ${data.topics.length}주제 / 별도 예상 ${total}문항 / ${JSON.stringify(types)} (기존 문제은행 수에 포함하지 않음)`);
