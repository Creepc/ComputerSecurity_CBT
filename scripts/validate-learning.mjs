import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
const chapters=[1,2,3,4].map(n=>read(`data/chapter${n}.json`)),cram=read('data/cram.json'),book=read('data/cram-workbook.json'),sources=read('data/lecture-sources.json');
const errors=[],check=(yes,message)=>{if(!yes)errors.push(message);},text=v=>typeof v==='string'&&v.trim().length>0,norm=s=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,''),counts=[0,40,74,78,56];
check(book.version===1&&Array.isArray(book.questions),'문제집 형식 오류');
check(book.questions?.length===128,'문제집 128문항 필요');
const ids=new Set([...chapters.flatMap(c=>c.questions.map(q=>q.id)),...cram.topics.flatMap(t=>t.questions.map(q=>q.id))]);
const prompts=new Set([...chapters.flatMap(c=>c.questions.map(q=>norm(q.prompt))),...cram.topics.flatMap(t=>t.questions.map(q=>norm(q.prompt)))]);
for(const t of cram.topics){
 check(text(t.teaching?.overview)&&text(t.teaching?.example)&&text(t.teaching?.examAnswer),`${t.id}: 이해 설명·예시·시험 답안 필요`);
 check(Array.isArray(t.teaching?.explanation)&&t.teaching.explanation.length>=2&&t.teaching.explanation.every(text),`${t.id}: 연결된 원리 설명 필요`);
 const qs=book.questions.filter(q=>q.topicId===t.id);
 check(qs.length===8&&qs.filter(q=>q.type==='short').length===5&&qs.filter(q=>q.type==='essay').length===3,`${t.id}: 단답5·서술3 필요`);
}
for(const q of book.questions||[]){
 const topic=cram.topics.find(t=>t.id===q.topicId);
 check(topic&&q.chapter===topic.chapter,`${q.id}: 주제·장 연결 오류`);
 check(/^cw-\d{2}-0[1-8]$/.test(q.id)&&!ids.has(q.id),`${q.id}: ID 오류·중복`);ids.add(q.id);
 check(['short','essay'].includes(q.type)&&Array.isArray(q.options)&&q.options.length===0,`${q.id}: 주관식 필요`);
 for(const key of ['prompt','answer','explanation'])check(text(q[key]),`${q.id}: ${key} 필요`);
 if(text(q.prompt)){const p=norm(q.prompt);check(!prompts.has(p),`${q.id}: 발문 중복`);prompts.add(p);}
 check(Array.isArray(q.keywords)&&q.keywords.length>0&&q.keywords.every(text),`${q.id}: 핵심어 필요`);
 check(Array.isArray(q.rubric)&&q.rubric.length>0&&q.rubric.every(text),`${q.id}: 답안 확인 요소 필요`);
 check(Array.isArray(q.acceptedAnswers)&&(q.type==='essay'||q.acceptedAnswers.length>0)&&q.acceptedAnswers.every(text),`${q.id}: 인정 답안 오류`);
 check(Array.isArray(q.sourceSlides)&&q.sourceSlides.length>0&&q.sourceSlides.every(n=>Number.isInteger(n)&&n>=1&&n<=counts[q.chapter]),`${q.id}: PPT 쪽수 오류`);
}
check(sources.version===1&&sources.chapters?.length===4,'PPT 4개 원문 필요');
const assets=new Set();
for(const [i,c] of (sources.chapters||[]).entries()){
 check(c.chapter===i+1&&text(c.file)&&/^[a-f0-9]{64}$/.test(c.sha256),`원문 ${i+1}장 메타데이터 오류`);
 check(c.slides.length===counts[c.chapter],`${c.chapter}장 원문 페이지 수 오류`);
 for(const [j,s] of c.slides.entries()){
  check(s.number===j+1&&typeof s.text==='string'&&Array.isArray(s.images),`${c.chapter}장 ${j+1}쪽 원문 형식 오류`);
  check((s.notes===undefined||typeof s.notes==='string')&&!('notesPart' in s),`발표자 노트 형식 오류: ${c.chapter}/${j+1}`);
  for(const img of s.images){
   check(/^assets\/lecture\/[a-f0-9]{64}\.(?:png|jpe?g|gif|webp)$/i.test(img.path)&&text(img.alt),`삽입 그림 경로 오류: ${img.path}`);
   if(assets.has(img.path))continue;assets.add(img.path);
   const file=new URL(img.path,root);check(fs.existsSync(file),`삽입 그림 누락: ${img.path}`);
   if(fs.existsSync(file))check(createHash('sha256').update(fs.readFileSync(file)).digest('hex')===img.path.split('/').at(-1).split('.')[0],`원본 그림 해시 불일치: ${img.path}`);
  }
 }
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`이해 설명 ${cram.topics.length}주제 · 문제집 단답80/서술48 · PPT 원문248쪽/삽입 그림${assets.size}개 검증 통과`);
