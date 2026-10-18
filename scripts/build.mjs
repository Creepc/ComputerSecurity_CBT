import {mkdir,copyFile,cp,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
await mkdir(resolve(dist,'data'),{recursive:true});
for(const name of ['index.html','app.js','study.js','style.css','icon.svg'])await copyFile(resolve(root,name),resolve(dist,name));
for(const name of ['chapter1.json','chapter2.json','chapter3.json','chapter4.json','exam-pattern.json','review-log.json']){
 const body=JSON.parse(await readFile(resolve(root,'data',name),'utf8'));
 await writeFile(resolve(dist,'data',name),JSON.stringify(body),'utf8');
}
await writeFile(resolve(dist,'.nojekyll'),'');
const files=await readdir(dist);
if(files.some(name=>/analysis|시험|수업자료|\.hwp|\.pptx/.test(name)))throw new Error('비공개 분석 자료가 빌드에 포함되어 있습니다.');
console.log('Static site built in dist/ (application + original study content only).');
