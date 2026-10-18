import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const report = { generatedAt: new Date().toISOString(), chapters: [], totals: {}, errors, warnings };
const allQuestionIds = new Set();
const allConceptIds = new Set();
const prompts = new Map();
const types = new Map();
const MIN_QUESTIONS = Number(process.env.MIN_QUESTIONS || 300);
// Reviewed against the actual slide text: covers, outlines, learning goals and closing/blank slides.
// Sparse text alone is not evidence that a slide lacks testable content.
const structuralSlides = new Map([
  [1, new Set([1,2,3,40])], [2, new Set([1,2,74])],
  [3, new Set([1,2,3,74])], [4, new Set([1,2,3,52])]
]);

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function normalized(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`${relative}: JSON 파일 읽기 실패 (${error.message})`);
    return null;
  }
}
function stringArray(value, label, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some(item => !text(item))) {
    fail(`${label}: 비어 있지 않은 문자열의 배열이 필요합니다.`);
    return false;
  }
  return true;
}
function slideRefs(value, label, total) {
  if (!Array.isArray(value) || !value.length) {
    fail(`${label}: sourceSlides는 빈 배열일 수 없습니다.`);
    return [];
  }
  const valid = [];
  for (const slide of value) {
    if (!Number.isInteger(slide) || slide < 1 || slide > total) {
      fail(`${label}: 슬라이드 ${JSON.stringify(slide)}는 유효한 범위 1~${total} 밖입니다.`);
    } else valid.push(slide);
  }
  if (new Set(value).size !== value.length) fail(`${label}: sourceSlides에 중복 번호가 있습니다.`);
  return valid;
}

// Original slides and their extracted text are private local analysis artifacts.
// A fresh GitHub checkout must remain verifiable without those source files.
const manifest = fs.existsSync(path.join(root, 'analysis/slide-manifest.json'))
  ? readJson('analysis/slide-manifest.json')
  : [
    { chapter: 1, slides: 40, sparseSlides: [1,2,3,4,6,7,11,20,21,22,23,24,26,27,28,29,30,32,34,35,38,39,40] },
    { chapter: 2, slides: 74, sparseSlides: [1,2,11,29,36,42,43,51,74] },
    { chapter: 3, slides: 74, sparseSlides: [1,2,4,14,49,66,74] },
    { chapter: 4, slides: 56, sparseSlides: [1,2,14,15,19,20,24,25,52] }
  ];
const expectedSlides = new Map((Array.isArray(manifest) ? manifest : []).map(row => [row.chapter, row.slides]));
const sparseSlides = new Map((Array.isArray(manifest) ? manifest : []).map(row => [row.chapter, new Set(row.sparseSlides || [])]));
if (expectedSlides.size !== 4) fail('슬라이드 manifest에 4개 장이 필요합니다.');

for (let chapter = 1; chapter <= 4; chapter++) {
  const data = readJson(`data/chapter${chapter}.json`);
  if (!data) continue;
  const totalSlides = expectedSlides.get(chapter) || [0, 40, 74, 74, 56][chapter];
  const entry = {
    chapter, title: data.title, slideCount: totalSlides, concepts: 0, questions: 0,
    byType: {}, conceptWithoutQuestions: [], questionSourceSlides: [], conceptSourceSlides: [],
    slidesWithoutDirectQuestion: [], slidesWithoutConceptReference: [],
    sparseSlidesWithoutDirectQuestion: [], structuralSlidesWithoutDirectQuestion: [], contentSlidesWithoutDirectQuestion: []
  };
  report.chapters.push(entry);
  if (data.chapter !== chapter) fail(`chapter${chapter}: 최상위 chapter 번호가 다릅니다.`);
  if (!text(data.title)) fail(`chapter${chapter}: 제목이 없습니다.`);
  if (!Array.isArray(data.concepts) || !data.concepts.length) {
    fail(`chapter${chapter}: 개념 배열이 비어 있습니다.`);
    continue;
  }
  if (!Array.isArray(data.questions) || !data.questions.length) {
    fail(`chapter${chapter}: 문항 배열이 비어 있습니다.`);
    continue;
  }
  const ownConceptIds = new Set();
  const conceptQuestions = new Map();
  const questionSlides = new Set();
  const conceptSlides = new Set();
  entry.concepts = data.concepts.length;
  entry.questions = data.questions.length;

  for (const concept of data.concepts) {
    if (!concept || typeof concept !== 'object' || Array.isArray(concept)) {
      fail(`chapter${chapter}: 개념은 객체여야 합니다.`);
      continue;
    }
    const label = `chapter${chapter} 개념 ${concept.id || '(ID 없음)'}`;
    if (!text(concept.id)) fail(`${label}: ID가 없습니다.`);
    else {
      if (allConceptIds.has(concept.id)) fail(`${label}: 개념 ID 중복.`);
      allConceptIds.add(concept.id);
      ownConceptIds.add(concept.id);
      conceptQuestions.set(concept.id, 0);
    }
    if (concept.chapter !== chapter) fail(`${label}: chapter 번호 불일치.`);
    for (const key of ['title', 'summary']) if (!text(concept[key])) fail(`${label}: ${key}가 없습니다.`);
    for (const key of ['details', 'pitfalls', 'examples']) stringArray(concept[key], `${label} ${key}`);
    for (const slide of slideRefs(concept.sourceSlides, label, totalSlides)) conceptSlides.add(slide);
  }

  for (const question of data.questions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      fail(`chapter${chapter}: 문항은 객체여야 합니다.`);
      continue;
    }
    const label = `chapter${chapter} 문항 ${question.id || '(ID 없음)'}`;
    if (!text(question.id)) fail(`${label}: ID가 없습니다.`);
    else {
      if (allQuestionIds.has(question.id)) fail(`${label}: 문항 ID 중복.`);
      if (allConceptIds.has(question.id)) fail(`${label}: 개념과 문항 ID가 겹칩니다.`);
      allQuestionIds.add(question.id);
    }
    if (question.chapter !== chapter) fail(`${label}: chapter 번호 불일치.`);
    if (!ownConceptIds.has(question.conceptId)) fail(`${label}: 같은 장의 conceptId를 참조하지 않습니다.`);
    else conceptQuestions.set(question.conceptId, conceptQuestions.get(question.conceptId) + 1);
    if (!['mcq', 'short', 'ox', 'essay'].includes(question.type)) fail(`${label}: 지원하지 않는 문항 유형 ${question.type}.`);
    if (question.revision !== undefined && (!Number.isInteger(question.revision) || question.revision < 1)) fail(`${label}: revision은 1 이상의 정수여야 합니다.`);
    if (question.matchMode !== undefined && question.matchMode !== 'code') fail(`${label}: 지원하는 명시적 matchMode는 code입니다.`);
    if (question.caseSensitive !== undefined && typeof question.caseSensitive !== 'boolean') fail(`${label}: caseSensitive는 boolean이어야 합니다.`);
    if (question.caseSensitive === true && question.matchMode !== 'code') fail(`${label}: caseSensitive를 적용하려면 matchMode:code가 필요합니다.`);
    if (question.type === 'short' && !['single','multi-part'].includes(question.shortForm)) fail(`${label}: 단답형 shortForm은 single 또는 multi-part여야 합니다.`);
    if (!['기본', '응용', '심화'].includes(question.difficulty)) fail(`${label}: 난이도는 기본/응용/심화 중 하나여야 합니다.`);
    entry.byType[question.type] = (entry.byType[question.type] || 0) + 1;
    types.set(question.type, (types.get(question.type) || 0) + 1);
    if (!text(question.prompt)) fail(`${label}: 발문이 없습니다.`);
    else {
      const key = normalized(question.prompt);
      if (prompts.has(key)) fail(`${label}: ${prompts.get(key)}와 발문이 중복됩니다.`);
      else prompts.set(key, question.id);
    }
    if (!text(question.explanation)) fail(`${label}: 정답 해설이 없습니다.`);
    stringArray(question.keywords, `${label} keywords`);
    for (const slide of slideRefs(question.sourceSlides, label, totalSlides)) questionSlides.add(slide);
    if (!Array.isArray(question.options)) fail(`${label}: 모든 문항에 options 배열이 필요합니다. 주관식은 빈 배열을 사용합니다.`);

    if (['mcq', 'ox'].includes(question.type)) {
      const expectedOptions = question.type === 'mcq' ? 4 : 2;
      if (!Array.isArray(question.options) || question.options.length !== expectedOptions) {
        fail(`${label}: ${question.type}에는 ${expectedOptions}개 선택지가 필요합니다.`);
      } else {
        const optionTexts = new Set();
        question.options.forEach((option, index) => {
          if (!option || typeof option !== 'object') { fail(`${label}: 보기 ${index + 1}은 객체여야 합니다.`); return; }
          if (!text(option.text)) fail(`${label}: 보기 ${index + 1}의 내용이 없습니다.`);
          else {
            const key = normalized(option.text);
            if (optionTexts.has(key)) fail(`${label}: 중복 선택지가 있습니다.`);
            optionTexts.add(key);
          }
          if (!text(option.explanation)) fail(`${label}: 보기 ${index + 1}의 정답/오답 설명이 없습니다.`);
          else if (option.explanation.trim().length < 10) warn(`${label}: 보기 ${index + 1} 설명이 짧아 개념 설명을 확인해야 합니다.`);
        });
        const explicitCorrect = question.options.filter(option => option?.correct === true || option?.isCorrect === true);
        if (explicitCorrect.length > 1) fail(`${label}: 정답 표시가 두 개 이상입니다.`);
        if (explicitCorrect.length === 1 && question.options[question.answer] !== explicitCorrect[0]) fail(`${label}: 정답 인덱스와 선택지 정답 표시가 다릅니다.`);
      }
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= expectedOptions) fail(`${label}: answer는 유효한 단일 정답 인덱스여야 합니다.`);
    } else if (['short', 'essay'].includes(question.type)) {
      if (Array.isArray(question.options) && question.options.length !== 0) fail(`${label}: 단답형·서술형의 options는 빈 배열이어야 합니다.`);
      if (!text(question.answer)) fail(`${label}: 모범답안 문자열이 없습니다.`);
      if (question.acceptedAnswers !== undefined) stringArray(question.acceptedAnswers, `${label} acceptedAnswers`);
      if (question.type === 'essay') stringArray(question.rubric, `${label} rubric`, { required: true });
      else if (question.rubric !== undefined) stringArray(question.rubric, `${label} rubric`);
    }
  }

  entry.conceptWithoutQuestions = [...conceptQuestions.entries()].filter(([, count]) => !count).map(([id]) => id);
  for (const id of entry.conceptWithoutQuestions) fail(`chapter${chapter} 개념 ${id}: 출제된 문항이 없습니다.`);
  entry.questionSourceSlides = [...questionSlides].sort((a, b) => a - b);
  entry.conceptSourceSlides = [...conceptSlides].sort((a, b) => a - b);
  for (let slide = 1; slide <= totalSlides; slide++) {
    if (!questionSlides.has(slide)) {
      entry.slidesWithoutDirectQuestion.push(slide);
      if (sparseSlides.get(chapter)?.has(slide)) entry.sparseSlidesWithoutDirectQuestion.push(slide);
      (structuralSlides.get(chapter)?.has(slide) ? entry.structuralSlidesWithoutDirectQuestion : entry.contentSlidesWithoutDirectQuestion).push(slide);
    }
    if (!conceptSlides.has(slide)) entry.slidesWithoutConceptReference.push(slide);
  }
  entry.questionSlideCoverage = Math.round(questionSlides.size / totalSlides * 1000) / 10;
  entry.conceptSlideCoverage = Math.round(conceptSlides.size / totalSlides * 1000) / 10;
  entry.contentSlideCount = totalSlides - structuralSlides.get(chapter).size;
  entry.directlyReferencedContentSlides = entry.contentSlideCount - entry.contentSlidesWithoutDirectQuestion.length;
  if (entry.contentSlidesWithoutDirectQuestion.length) warn(`chapter${chapter}: 내용 슬라이드 ${entry.contentSlidesWithoutDirectQuestion.join(', ')}에 직접 연결된 문항이 없습니다. 이미지·요약·예시의 학습 연결을 coverage 보고서로 검토하세요.`);
}

const examPattern = readJson('data/exam-pattern.json');
if (examPattern) {
  if (!text(examPattern.summary)) fail('exam-pattern: summary가 없습니다.');
  for (const section of ['strategies', 'scopeNotes', 'cautions']) stringArray(examPattern[section], `exam-pattern ${section}`, { required: true });
  for (const [section, expected] of Object.entries({ midterm: { learningQuestions: 13, essay: 9, short: 1, mcq: 3 }, final: { learningQuestions: 12, essay: 4, short: 8, mcq: 0 } })) {
    for (const [key, value] of Object.entries(expected)) if (examPattern[section]?.[key] !== value) fail(`exam-pattern ${section}.${key}: 원시험 분석값 ${value}와 다릅니다.`);
  }
}

if (fs.existsSync(path.join(root, 'data/review-log.json'))) {
  const log = readJson('data/review-log.json');
  if (log) {
    if (!Number.isInteger(log.baselineQuestions) || log.baselineQuestions < 0) fail('review-log: baselineQuestions는 0 이상의 정수여야 합니다.');
    if (log.currentQuestions !== allQuestionIds.size) fail(`review-log: currentQuestions(${log.currentQuestions})와 실제 문제 수(${allQuestionIds.size})가 다릅니다.`);
    if (log.addedQuestions !== allQuestionIds.size - log.baselineQuestions) fail('review-log: addedQuestions는 currentQuestions-baselineQuestions와 같아야 합니다.');
    if (!Array.isArray(log.changes)) fail('review-log: changes 배열이 필요합니다.');
    else log.changes.forEach((change,index) => {
      if (!change || typeof change !== 'object') { fail(`review-log changes[${index}]: 변경 내역 객체가 필요합니다.`); return; }
      if (change.questionIds !== undefined) {
        if (!Array.isArray(change.questionIds)) fail(`review-log changes[${index}]: questionIds는 배열이어야 합니다.`);
        else for (const id of change.questionIds) if (!allQuestionIds.has(id)) fail(`review-log changes[${index}]: 존재하지 않는 문항 ID ${id}.`);
      }
    });
  }
}

report.totals = { chapters: report.chapters.length, concepts: allConceptIds.size, questions: allQuestionIds.size, byType: Object.fromEntries(types), minimumQuestions: MIN_QUESTIONS };
report.totals.slides = report.chapters.reduce((totals, entry) => ({
  all: totals.all + entry.slideCount,
  directlyReferenced: totals.directlyReferenced + entry.questionSourceSlides.length,
  content: totals.content + entry.contentSlideCount,
  directlyReferencedContent: totals.directlyReferencedContent + entry.directlyReferencedContentSlides
}), { all:0, directlyReferenced:0, content:0, directlyReferencedContent:0 });
for (const id of allQuestionIds) if (allConceptIds.has(id)) fail(`ID ${id}: 개념과 문항 ID가 겹칩니다.`);
if (!Number.isInteger(MIN_QUESTIONS) || MIN_QUESTIONS < 1) fail('MIN_QUESTIONS는 1 이상의 정수여야 합니다.');
else if (allQuestionIds.size < MIN_QUESTIONS) fail(`문제 수가 ${allQuestionIds.size}개로 최소 ${MIN_QUESTIONS}개에 미달합니다.`);
for (const type of ['mcq', 'short', 'essay', 'ox']) if (!types.get(type)) fail(`${type} 유형의 문제가 없습니다.`);

fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
fs.writeFileSync(path.join(root, 'analysis', 'validation-report.json'), JSON.stringify(report, null, 2) + '\n');
for (const entry of report.chapters) {
  console.log(`${entry.chapter}장 ${entry.title}: ${entry.concepts}개 개념, ${entry.questions}개 문제 | 문항 출처 ${entry.questionSourceSlides.length}/${entry.slideCount}장 (${entry.questionSlideCoverage ?? 0}%)`);
  if (entry.slidesWithoutDirectQuestion.length) console.log(`  직접 문항 없는 슬라이드(검토용): ${entry.slidesWithoutDirectQuestion.join(', ')}`);
}
console.log(`합계: 개념 ${allConceptIds.size}개 / 문제 ${allQuestionIds.size}개 / 유형 ${JSON.stringify(Object.fromEntries(types))}`);
console.log(`내용 슬라이드 문항 출처 연결: ${report.totals.slides.directlyReferencedContent}/${report.totals.slides.content}장 (표지·목차·학습목표·마지막장 제외)`);
for (const message of warnings) console.warn(`검토: ${message}`);
for (const message of errors) console.error(`오류: ${message}`);
console.log(`상세 보고서: analysis/validation-report.json`);
if (errors.length) process.exitCode = 1;
else console.log('데이터 검증 통과. 의미·정답의 정확성은 자료 대조와 별도로 검토해야 합니다.');
