"""Deploy administration via local Git credential manager; credentials stay in memory."""
import argparse,json,subprocess,urllib.request,urllib.error

parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','create','pages','status']);args=parser.parse_args()
repo='Creepc/ComputerSecurity_CBT'
p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,check=True)
credential=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
token=credential.get('password')
if not token:raise SystemExit('GitHub credential not available.')
def api(path,method='GET',body=None):
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'Codex-ComputerSecurity-CBT','X-GitHub-Api-Version':'2022-11-28'}
    req=urllib.request.Request('https://api.github.com'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return json.load(r) if r.status!=204 else {}
    except urllib.error.HTTPError as err:
        detail=json.loads(err.read().decode());raise RuntimeError(f'GitHub HTTP {err.code}: {detail.get("message","request failed")}') from None
if args.action=='inspect':
    user=api('/user'); print(json.dumps({'login':user['login']}))
    try:
        r=api('/repos/'+repo);print(json.dumps({k:r.get(k) for k in ['full_name','html_url','default_branch','has_pages']}))
    except RuntimeError as err:print(str(err))
elif args.action=='create':
    try:r=api('/repos/'+repo)
    except RuntimeError as err:
        if 'HTTP 404' not in str(err):raise
        r=api('/user/repos','POST',{'name':'ComputerSecurity_CBT','description':'컴퓨터보안 중간고사 · 개념별 문제은행과 서술형 모의고사','private':False,'auto_init':False})
    print(json.dumps({k:r.get(k) for k in ['full_name','html_url','clone_url','default_branch','size']},ensure_ascii=False))
elif args.action=='pages':
    try:r=api('/repos/'+repo+'/pages')
    except RuntimeError as err:
        if 'HTTP 404' not in str(err):raise
        r=api('/repos/'+repo+'/pages','POST',{'build_type':'workflow'})
    if r.get('build_type')!='workflow':r=api('/repos/'+repo+'/pages','PUT',{'build_type':'workflow'})
    print(json.dumps({k:r.get(k) for k in ['html_url','status','build_type']},ensure_ascii=False))
else:
    runs=api('/repos/'+repo+'/actions/runs?per_page=3')
    print(json.dumps([{'id':r['id'],'status':r['status'],'conclusion':r['conclusion'],'url':r['html_url'],'sha':r['head_sha']} for r in runs['workflow_runs']],ensure_ascii=False))
    try:
        pages=api('/repos/'+repo+'/pages');print(json.dumps({k:pages.get(k) for k in ['html_url','status','build_type']}))
    except RuntimeError as err:print(str(err))
