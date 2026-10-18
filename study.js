export const STORAGE_KEY = 'security-midterm-v1';
export const TYPES = {mcq:'객관식',short:'단답형',essay:'서술형',ox:'O / X'};
export const CHAPTER_TITLES = ['','정보 보안의 세계','시스템 보안','네트워크 보안','웹 보안'];
export function emptyState(){return {version:1,attempts:{},bookmarks:[],learned:[],notes:{},exam:null,examHistory:[],theme:'light'};}
export function normalize(text){return String(text).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}
export function checkShort(q, text){return [q.answer,...(q.acceptedAnswers||[])].some(a=>normalize(a)===normalize(text));}
export function shuffle(items, random=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function sanitizeState(raw, questions, concepts){
  if(!raw || raw.version!==1 || typeof raw!=='object') throw new Error('이 학습실의 기록 파일이 아닙니다.');
  const s=emptyState(), qs=new Set(questions.map(q=>q.id)), cs=new Set(concepts.map(c=>c.id));
  s.theme=raw.theme==='dark'?'dark':'light';
  s.bookmarks=Array.isArray(raw.bookmarks)?[...new Set(raw.bookmarks.filter(x=>qs.has(x)))]:[];
  s.learned=Array.isArray(raw.learned)?[...new Set(raw.learned.filter(x=>cs.has(x)))]:[];
  const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
  for(const [id,a] of Object.entries(raw.attempts||{}))if(qs.has(id)&&a&&typeof a==='object'){
    const score=Math.max(0,Math.min(1,finite(a.score)));
    s.attempts[id]={count:Math.max(1,Math.min(99999,Math.trunc(finite(a.count,1)))),correct:score===1,score,answer:typeof a.answer==='number'?a.answer:String(a.answer??'').slice(0,12000),date:finite(a.date,Date.now()),wrongCount:Math.max(0,Math.trunc(finite(a.wrongCount))),selfGraded:a.selfGraded===true};
  }
  for(const [id,note] of Object.entries(raw.notes||{}))if(qs.has(id)&&typeof note==='string')s.notes[id]=note.slice(0,12000);
  if(Array.isArray(raw.examHistory))s.examHistory=raw.examHistory.filter(h=>h&&Array.isArray(h.ids)&&h.ids.every(id=>qs.has(id))&&Number.isFinite(h.score)).slice(0,30);
  const ex=raw.exam;
  if(ex && Array.isArray(ex.ids)&&ex.ids.length&&ex.ids.length<=100&&ex.ids.every(id=>qs.has(id))&&Number.isFinite(ex.deadline)&&['active','review','done'].includes(ex.status)){
    const uniqueIds=[...new Set(ex.ids)];
    s.exam={ids:uniqueIds,answers:{},grades:{},rubrics:{},deadline:ex.deadline,status:ex.status,index:Math.max(0,Math.min(uniqueIds.length-1,Math.trunc(Number(ex.index)||0))),mode:['mixed','written','objective'].includes(ex.mode)?ex.mode:'mixed',started:Number(ex.started)||Date.now()};
    for(const id of s.exam.ids){
      const a=ex.answers?.[id];if(typeof a==='number'||typeof a==='string')s.exam.answers[id]=typeof a==='string'?a.slice(0,12000):a;
      if(Number.isFinite(ex.grades?.[id]))s.exam.grades[id]=Math.max(0,Math.min(1,ex.grades[id]));
      const q=questions.find(q=>q.id===id),rubricCount=q.rubric?.length||1;
      if(Array.isArray(ex.rubrics?.[id]))s.exam.rubrics[id]=[...new Set(ex.rubrics[id].filter(n=>Number.isInteger(n)&&n>=0&&n<rubricCount))];
    }
  }
  return s;
}
export function recordAttempt(state,q,answer,score,selfGraded=false){
 const prev=state.attempts[q.id];const value=Math.max(0,Math.min(1,Number.isFinite(score)?score:0));
 state.attempts[q.id]={count:(prev?.count||0)+1,correct:value===1,score:value,answer,date:Date.now(),wrongCount:(prev?.wrongCount||0)+(value<1?1:0),selfGraded};
}
export function selectExam(questions,mode='mixed',chapter='all',random=Math.random){
  const pool=questions.filter(q=>chapter==='all'||q.chapter===Number(chapter));
  const result=[];
  const take=(type,n)=>{
    const buckets=[1,2,3,4].map(ch=>shuffle(pool.filter(q=>q.type===type&&q.chapter===ch),random));
    let cursor=Math.floor(random()*4);
    while(n>0&&buckets.some(b=>b.length)){
      const b=buckets[cursor%4];if(b.length){result.push(b.pop());n--;}cursor++;
    }
  };
  if(mode==='mixed'){take('essay',9);take('short',1);take('mcq',3);}
  else if(mode==='written'){take('essay',8);take('short',4);}
  else{take('mcq',20);take('ox',5);}
  return result.map(q=>q.id);
}
export function questionPoints(q,mode){return mode==='mixed'?(q.type==='short'?4:8):1;}
export function examScore(exam,byId){
 let earned=0,total=0;for(const id of exam.ids){const p=questionPoints(byId.get(id),exam.mode);total+=p;earned+=Math.max(0,Math.min(1,exam.grades[id]||0))*p;}
 return total?Math.round(earned/total*100):0;
}
export function conceptProgress(c,questions,state){const qs=questions.filter(q=>q.conceptId===c.id);return {total:qs.length,done:qs.filter(q=>state.attempts[q.id]).length,correct:qs.filter(q=>state.attempts[q.id]?.correct).length};}
