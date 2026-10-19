export const STORAGE_KEY = 'security-midterm-v1';
export const TYPES = {mcq:'객관식',short:'단답형',essay:'서술형',ox:'O / X'};
export const CHAPTER_TITLES = ['','정보 보안의 세계','시스템 보안','네트워크 보안','웹 보안'];
export function emptyCramState(){return {answers:{},hidden:[],remembered:[],recall:false,onlyPending:false,catalogVersion:1};}
export function sanitizeCramState(raw,topics=[]){
 const next=emptyCramState(),introduced=t=>Number.isInteger(t.introducedVersion)&&t.introducedVersion>0?t.introducedVersion:1;
 next.catalogVersion=Math.max(1,...topics.map(introduced));
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return next;
 const previousVersion=Number.isInteger(raw.catalogVersion)&&raw.catalogVersion>0?Math.min(raw.catalogVersion,next.catalogVersion):1;
 const topicIds=new Set(topics.map(t=>t.id)),qMap=new Map(topics.flatMap(t=>t.questions).map(q=>[q.id,q]));
 if(raw.answers&&typeof raw.answers==='object'&&!Array.isArray(raw.answers))for(const [id,value] of Object.entries(raw.answers)){
  const q=qMap.get(id);if(!q)continue;
  if(q.type==='mcq'&&Number.isInteger(value)&&value>=0&&value<q.options.length)next.answers[id]=value;
  else if(q.type!=='mcq'&&typeof value==='string')next.answers[id]=value.slice(0,12000);
 }
 next.hidden=Array.isArray(raw.hidden)?[...new Set(raw.hidden.filter(id=>qMap.has(id)))]:[];
 next.remembered=Array.isArray(raw.remembered)?[...new Set(raw.remembered.filter(id=>topicIds.has(id)))]:[];
 next.recall=raw.recall===true;next.onlyPending=raw.onlyPending===true;
 if(next.recall&&previousVersion<next.catalogVersion)next.hidden=[...new Set([...next.hidden,...topics.filter(t=>introduced(t)>previousVersion).flatMap(t=>t.questions.map(q=>q.id))])];
 return next;
}
export function emptyCramWorkbookState(){return {answers:{},revealed:[],hints:[],rubrics:{}};}
export function sanitizeCramWorkbookState(raw,questions=[]){
 const next=emptyCramWorkbookState();if(!raw||typeof raw!=='object'||Array.isArray(raw))return next;
 const byId=new Map(questions.map(q=>[q.id,q]));
 if(raw.answers&&typeof raw.answers==='object'&&!Array.isArray(raw.answers))for(const [id,value] of Object.entries(raw.answers))if(byId.has(id)&&typeof value==='string')next.answers[id]=value.slice(0,12000);
 next.revealed=Array.isArray(raw.revealed)?[...new Set(raw.revealed.filter(id=>byId.has(id)))]:[];
 next.hints=Array.isArray(raw.hints)?[...new Set(raw.hints.filter(id=>byId.get(id)?.type==='essay'))]:[];
 if(raw.rubrics&&typeof raw.rubrics==='object'&&!Array.isArray(raw.rubrics))for(const [id,values] of Object.entries(raw.rubrics)){
  const q=byId.get(id);if(q?.type==='essay'&&Array.isArray(values))next.rubrics[id]=[...new Set(values.filter(n=>Number.isInteger(n)&&n>=0&&n<q.rubric.length))];
 }
 return next;
}
export function emptyState(){return {version:1,attempts:{},bookmarks:[],learned:[],notes:{},worksheet:{},cram:emptyCramState(),cramWorkbook:emptyCramWorkbookState(),exam:null,examHistory:[],theme:'light'};}
export function normalize(text){return String(text).normalize('NFKC').toLowerCase().replace(/(^|[\s,;:(])[-−–](?=\d)/gu,'$1음수').replace(/[\s\p{P}\p{S}]/gu,'');}
export function normalizeCode(text,caseSensitive=false){
  const value=String(text).normalize('NFKC').replace(/[–—−]/g,'-').replace(/->/g,'→').replace(/<-/g,'←').trim().replace(/\s+/g,' ').replace(/\s*([→←])\s*/g,'$1');
  return caseSensitive?value:value.toLowerCase();
}
export function checkShort(q, text){
  const compare=q.matchMode==='code'?(value=>normalizeCode(value,q.caseSensitive===true)):normalize;
  if(!String(text??'').trim())return false;
  return [q.answer,...(q.acceptedAnswers||[])].some(a=>compare(a)===compare(text));
}
export function questionRevision(q){return Number.isInteger(q?.revision)&&q.revision>0?q.revision:1;}
export function emptyWorksheetDraft(q){return {revision:questionRevision(q),choice:null,text:'',revealed:false,graded:false,score:0,rubric:[],accepted:false,hintVisible:false};}
export function worksheetHasAnswer(q,draft){return q.options?.length?Number.isInteger(draft.choice)&&draft.choice>=0&&draft.choice<q.options.length:typeof draft.text==='string'&&draft.text.trim().length>0;}
export function evaluateWorksheet(q,draft,finalizeEssay=false){
 const next={...draft,rubric:[...(draft.rubric||[])],revealed:true,graded:false,score:0};
 if(!worksheetHasAnswer(q,next))return next;
 if(q.type==='essay'){next.graded=finalizeEssay;next.score=finalizeEssay?next.rubric.length/(q.rubric?.length||1):0;}
 else{next.graded=true;next.score=q.options?.length?(next.choice===q.answer?1:0):(next.accepted||checkShort(q,next.text)?1:0);}
 return next;
}
export function sanitizeWorksheetDraft(q,raw){
 if(!raw||typeof raw!=='object'||raw.revision!==questionRevision(q))return null;
 const next=emptyWorksheetDraft(q);
 if(Number.isInteger(raw.choice)&&raw.choice>=0&&raw.choice<(q.options?.length||0))next.choice=raw.choice;
 next.text=typeof raw.text==='string'?raw.text.slice(0,12000):'';
 next.rubric=Array.isArray(raw.rubric)?[...new Set(raw.rubric.filter(n=>Number.isInteger(n)&&n>=0&&n<(q.rubric?.length||0)))]:[];
 next.accepted=q.type==='short'&&raw.accepted===true;
 next.revealed=raw.revealed===true;
 next.hintVisible=q.type==='essay'&&raw.hintVisible===true;
 if(raw.graded===true&&worksheetHasAnswer(q,next))return {...evaluateWorksheet(q,next,true),revealed:next.revealed};
 return next;
}
export function acknowledgeRevision(exam,q){
  exam.revisions??={};exam.revisions[q.id]=questionRevision(q);
  exam.pendingRevisionIds=(exam.pendingRevisionIds||[]).filter(id=>id!==q.id);
  if(exam.revisionDrafts)delete exam.revisionDrafts[q.id];
}
export function shuffle(items, random=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function sanitizeState(raw, questions, concepts, cramTopics=[],workbookQuestions=[]){
  if(!raw || raw.version!==1 || typeof raw!=='object') throw new Error('이 학습실의 기록 파일이 아닙니다.');
  const s=emptyState(), qs=new Set(questions.map(q=>q.id)), cs=new Set(concepts.map(c=>c.id)), questionMap=new Map(questions.map(q=>[q.id,q]));
  s.theme=raw.theme==='dark'?'dark':'light';
  s.bookmarks=Array.isArray(raw.bookmarks)?[...new Set(raw.bookmarks.filter(x=>qs.has(x)))]:[];
  s.learned=Array.isArray(raw.learned)?[...new Set(raw.learned.filter(x=>cs.has(x)))]:[];
  const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
  for(const [id,a] of Object.entries(raw.attempts||{}))if(qs.has(id)&&a&&typeof a==='object'){
    const score=Math.max(0,Math.min(1,finite(a.score))),revision=Number.isInteger(a.revision)&&a.revision>0?a.revision:1;
    const needsReview=revision!==questionRevision(questionMap.get(id));
    s.attempts[id]={count:Math.max(1,Math.min(99999,Math.trunc(finite(a.count,1)))),correct:score===1&&!needsReview,score,answer:typeof a.answer==='number'?a.answer:String(a.answer??'').slice(0,12000),date:finite(a.date,Date.now()),wrongCount:Math.max(0,Math.trunc(finite(a.wrongCount))),selfGraded:a.selfGraded===true,revision,needsReview};
  }
  for(const [id,note] of Object.entries(raw.notes||{}))if(qs.has(id)&&typeof note==='string')s.notes[id]=note.slice(0,12000);
  if(Array.isArray(raw.examHistory))s.examHistory=raw.examHistory.filter(h=>h&&Array.isArray(h.ids)&&h.ids.every(id=>qs.has(id))&&Number.isFinite(h.score)).slice(0,30).map(h=>({...h,needsReview:h.ids.some(id=>(h.revisions?.[id]||1)!==questionRevision(questionMap.get(id)))}));
  const ex=raw.exam;
  if(ex && Array.isArray(ex.ids)&&ex.ids.length&&ex.ids.length<=100&&ex.ids.every(id=>qs.has(id))&&Number.isFinite(ex.deadline)&&['active','review','done'].includes(ex.status)){
    const uniqueIds=[...new Set(ex.ids)];
    s.exam={ids:uniqueIds,answers:{},grades:{},rubrics:{},revisions:{},pendingRevisionIds:[],revisionDrafts:{},deadline:ex.deadline,status:ex.status,index:Math.max(0,Math.min(uniqueIds.length-1,Math.trunc(Number(ex.index)||0))),mode:['mixed','written','objective'].includes(ex.mode)?ex.mode:'mixed',started:Number(ex.started)||Date.now()};
    for(const id of s.exam.ids){
      const a=ex.answers?.[id];if(typeof a==='number'||typeof a==='string')s.exam.answers[id]=typeof a==='string'?a.slice(0,12000):a;
      const q=questionMap.get(id),rubricCount=q.rubric?.length||1;
      s.exam.revisions[id]=Number.isInteger(ex.revisions?.[id])&&ex.revisions[id]>0?ex.revisions[id]:1;
      if(s.exam.revisions[id]!==questionRevision(q)){
        s.exam.pendingRevisionIds.push(id);
        const draft=ex.revisionDrafts?.[id];
        const choiceQuestion=q.type==='mcq'||q.type==='ox';
        if(!choiceQuestion&&typeof draft==='string')s.exam.revisionDrafts[id]=draft.slice(0,12000);
        else if(choiceQuestion&&Number.isInteger(draft)&&draft>=0&&draft<(q.options?.length||0))s.exam.revisionDrafts[id]=draft;
      }
      else{
        if(Number.isFinite(ex.grades?.[id]))s.exam.grades[id]=Math.max(0,Math.min(1,ex.grades[id]));
        if(Array.isArray(ex.rubrics?.[id]))s.exam.rubrics[id]=[...new Set(ex.rubrics[id].filter(n=>Number.isInteger(n)&&n>=0&&n<rubricCount))];
      }
    }
    if(s.exam.pendingRevisionIds.length&&s.exam.status==='done')s.exam.status='review';
  }
  if(raw.worksheet&&typeof raw.worksheet==='object'&&!Array.isArray(raw.worksheet))for(const [id,draft] of Object.entries(raw.worksheet))if(qs.has(id)){const value=sanitizeWorksheetDraft(questionMap.get(id),draft);if(value)s.worksheet[id]=value;}
  s.cram=sanitizeCramState(raw.cram,cramTopics);
  s.cramWorkbook=sanitizeCramWorkbookState(raw.cramWorkbook,workbookQuestions);
  return s;
}
export function recordAttempt(state,q,answer,score,selfGraded=false){
 const prev=state.attempts[q.id];const value=Math.max(0,Math.min(1,Number.isFinite(score)?score:0));
 state.attempts[q.id]={count:(prev?.count||0)+1,correct:value===1,score:value,answer,date:Date.now(),wrongCount:(prev?.wrongCount||0)+(value<1?1:0),selfGraded,revision:questionRevision(q),needsReview:false};
}
export function selectExam(questions,mode='mixed',chapter='all',random=Math.random){
  const pool=questions.filter(q=>chapter==='all'||q.chapter===Number(chapter));
  const result=[];
  const take=(type,n)=>{
    const candidates=pool.filter(q=>q.type===type);
    const singleAnswers=type==='short'&&mode==='mixed'?candidates.filter(q=>q.shortForm!=='multi-part'):[];
    const selectedPool=singleAnswers.length?singleAnswers:candidates;
    const buckets=[1,2,3,4].map(ch=>shuffle(selectedPool.filter(q=>q.chapter===ch),random));
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
export function conceptProgress(c,questions,state){const qs=questions.filter(q=>q.conceptId===c.id);return {total:qs.length,done:qs.filter(q=>state.attempts[q.id]&&!state.attempts[q.id].needsReview).length,correct:qs.filter(q=>state.attempts[q.id]?.correct&&!state.attempts[q.id]?.needsReview).length};}
