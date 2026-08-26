function getProp(node, key) { return node.properties.find((property) => property.key === key)?.value; }
function fields(expr) { const value = expr?.value?.find((entry) => entry.key === 'fields')?.value; if (value?.tag !== 'record') throw new Error('R0 expression fields must be a record'); return new Map(value.value.map((entry) => [entry.key, entry.value])); }
function kind(expr) { const value = expr?.value?.find((entry) => entry.key === 'kind')?.value; if (value?.tag !== 'text') throw new Error('R0 expression kind must be text'); return value.value; }
const reservedWords = new Set(['False','None','True','and','arguments','as','assert','async','await','break','case','catch','class','const','continue','debugger','def','default','del','delete','do','elif','else','enum','eval','except','export','extends','false','finally','for','from','function','global','if','implements','import','in','instanceof','interface','is','lambda','let','match','new','nonlocal','not','null','or','package','pass','private','protected','public','raise','return','static','super','switch','this','throw','true','try','type','typeof','var','void','while','with','yield']);
function codeIdentifier(value, label) { if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || reservedWords.has(value)) throw new Error(`${label} is not a safe R0 identifier`); }
export function compileExprPy(expr) {
  const exprKind = kind(expr); const value = fields(expr);
  if (exprKind === 'identifier') { const name = value.get('name')?.value; codeIdentifier(name, 'identifier'); return name; }
  if (exprKind === 'list') return `[${value.get('items').value.map(compileExprPy).join(', ')}]`;
  if (exprKind === 'record') return `{${value.get('entries').value.map((entry) => `${JSON.stringify(entry.key)}: ${compileExprPy(entry.value)}`).join(', ')}}`;
  if (exprKind === 'call') { const callee = value.get('callee'); const args = value.get('args')?.value; const member = kind(callee) === 'member' ? fields(callee) : undefined; const object = member?.get('object'); const property = member?.get('property')?.value; if (kind(object) === 'identifier' && fields(object).get('name')?.value === 'Json' && Array.isArray(args) && args.length === 1) { if (property === 'parse') return `json_parse(${compileExprPy(args[0])})`; if (property === 'stringify') return `canonical(${compileExprPy(args[0])})`; } }
  throw new Error(`Unsupported R0 expression kind ${exprKind}`);
}
export function compilePySource({ artifactPath, capabilitySeal, compilerRequestSha256, kirSha256, entry, manifestFile, paramNames, semanticSha256, handlerChildren, target }) {
  codeIdentifier(entry.handlerName, 'handler'); for (const name of paramNames) codeIdentifier(name, 'parameter');
  const statements = handlerChildren.map((statement) => { if (statement.kind === 'let') { codeIdentifier(getProp(statement,'name').value, 'let binding'); return `    ${getProp(statement,'name').value} = ${compileExprPy(getProp(statement,'value'))}\n`; } if (statement.kind === 'capability') { codeIdentifier(getProp(statement,'name').value, 'capability binding'); return `    ${getProp(statement,'name').value} = await invoke(context, ${JSON.stringify(getProp(statement,'namespace').value)}, ${JSON.stringify(getProp(statement,'operation').value)})\n`; } if (statement.kind === 'print') return `    print_event(context, ${compileExprPy(getProp(statement,'value'))})\n`; if (statement.kind === 'return') return `    return result_slot(${compileExprPy(getProp(statement,'value'))})\n`; throw new Error(`Unsupported R0 statement kind ${statement.kind}`); });
  const params = paramNames.map((name) => `    ${name} = args[${JSON.stringify(name)}]`).join('\n'); const count = handlerChildren.filter((statement) => statement.kind === 'capability').length;
  return `import asyncio, hashlib, json, os, re, sys
KIR_SHA256=${JSON.stringify(kirSha256)}; COMPILER_REQUEST_SHA256=${JSON.stringify(compilerRequestSha256)}; SEMANTIC_SHA256=${JSON.stringify(semanticSha256)}; ENTRY=${JSON.stringify(entry)}; MANIFEST_FILE=${JSON.stringify(manifestFile)}; ARTIFACT_PATH=${JSON.stringify(artifactPath)}; CAPABILITY_SEAL=${JSON.stringify(capabilitySeal)}; TARGET=${JSON.stringify(target)}; COUNT=${count}; LIMIT_KEYS=['maxBytes','maxCollectionLength','maxDepth','maxDiagnostics','maxEvents','maxStringBytes']
sys.stdout.reconfigure(encoding='utf-8',errors='strict',newline='\\n')
def canonical(v):
    if v is None:return 'null'
    if isinstance(v,bool):return 'true' if v else 'false'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False,separators=(',',':'))
    if isinstance(v,int) and not isinstance(v,bool) and -(2**53-1)<=v<=2**53-1:return str(v)
    if isinstance(v,float) and v.is_integer() and -(2**53-1)<=v<=2**53-1:return str(int(v))
    if isinstance(v,list):return '['+','.join(canonical(x) for x in v)+']'
    if isinstance(v,dict):return '{'+','.join(json.dumps(k,ensure_ascii=False,separators=(',',':'))+':'+canonical(v[k]) for k in sorted(v,key=lambda x:[ord(c) for c in x]))+'}'
    raise ValueError('non-portable JSON')
def emit(v):print(canonical(v))
def exact(v, keys): return isinstance(v,dict) and set(v)==set(keys)
def positive(v): return isinstance(v,int) and not isinstance(v,bool) and v>0 and v<=9007199254740991
def portable(v): return isinstance(v,dict) and ((set(v)=={'tag'} and v.get('tag')=='null') or (set(v)=={'tag','value'} and ((v.get('tag')=='text' and isinstance(v['value'],str)) or (v.get('tag')=='boolean' and isinstance(v['value'],bool)) or (v.get('tag')=='integer' and isinstance(v['value'],str) and re.fullmatch(r'-?(?:0|[1-9][0-9]*)',v['value']) is not None and -(2**53-1)<=int(v['value'])<=2**53-1))))
def within(v,l,d=0):
    if d>l['maxDepth']:return False
    if isinstance(v,str):return len(v.encode())<=l['maxStringBytes']
    if isinstance(v,list):return len(v)<=l['maxCollectionLength'] and all(within(x,l,d+1) for x in v)
    return not isinstance(v,dict) or (len(v)<=l['maxCollectionLength'] and all(within(x,l,d+1) for x in v.values()))
def valid_step(s):
    if not isinstance(s,dict):return False
    has_r='result' in s; has_e='error' in s; keys=['namespace','operation','input','delayTicks']+(['result'] if has_r else ['error'])
    return has_r != has_e and exact(s,keys) and isinstance(s['namespace'],str) and len(s['namespace'])>0 and isinstance(s['operation'],str) and len(s['operation'])>0 and s['input']=={'presence':'absent'} and isinstance(s['delayTicks'],int) and not isinstance(s['delayTicks'],bool) and s['delayTicks']>=0 and s['delayTicks']<=9007199254740991 and (not has_r or exact(s['result'],['presence','value']) and s['result']['presence']=='value' and portable(s['result']['value'])) and (not has_e or exact(s['error'],['code']) and isinstance(s['error']['code'],str) and len(s['error']['code'])>0)
def safe_request_id(r):
    v=r.get('requestId') if isinstance(r,dict) else None
    if not isinstance(v,str):return None
    try:v.encode()
    except UnicodeEncodeError:return None
    return v
def fail(r,c,p='execution'):return {'completion':{'kind':'error'},'diagnostics':[{'category':'runtime','code':c,'phase':p}],'events':[],'format':'kern.runtime.kir.r0','outcome':'failure','requestId':safe_request_id(r),'result':{'presence':'absent'}}
def validate(r,raw):
    if not exact(r,['format','requestId','artifactManifestSha256','kirSha256','entry','arguments','limits','capabilityTranscript','control']):return 'invalid-handler-arguments'
    try:
        if (canonical(r)+'\\n').encode()!=raw:return 'invalid-handler-arguments'
    except Exception:return 'invalid-handler-arguments'
    if r['format']!='kern.runtime.kir.r0' or not isinstance(r['requestId'],str) or len(r['requestId'])==0 or len(r['artifactManifestSha256'])!=64 or r['kirSha256']!=KIR_SHA256 or r['entry']!=ENTRY:return 'handler-link-error'
    b=open(os.path.join(os.path.dirname(__file__),os.path.basename(MANIFEST_FILE)),'rb').read();m=json.loads(b);a=m.get('artifacts',[None])[0]
    if r['artifactManifestSha256']!=hashlib.sha256(b).hexdigest() or (canonical(m)+ '\\n').encode()!=b or set(m)!={'artifacts','capabilities','compilerRequestSha256','entry','format','kirSha256','runtimeAbi','semanticSha256','target'} or m.get('compilerRequestSha256')!=COMPILER_REQUEST_SHA256 or m.get('semanticSha256')!=SEMANTIC_SHA256 or m.get('format')!='kern.target.artifact.r0' or m.get('target')!=TARGET or m.get('runtimeAbi')!='kern.runtime.kir.r0' or m.get('kirSha256')!=KIR_SHA256 or m.get('entry')!=ENTRY or not isinstance(m.get('capabilities'),list) or any(not exact(x,['namespace','operation']) or not all(isinstance(x[k],str) for k in x) for x in m['capabilities']) or m.get('capabilities')!=CAPABILITY_SEAL or not isinstance(a,dict) or set(a)!={'executable','mediaType','path','sha256'} or a.get('executable')!=True or a.get('mediaType')!='text/x-python' or a.get('path')!=ARTIFACT_PATH or not isinstance(a.get('sha256'),str) or re.fullmatch('[0-9a-f]{64}',a['sha256']) is None or a.get('sha256')!=hashlib.sha256(open(__file__,'rb').read()).hexdigest():return 'handler-link-error'
    if not exact(r['arguments'],['text','textList']) or not isinstance(r['arguments']['text'],str) or not isinstance(r['arguments']['textList'],list) or not all(isinstance(x,str) for x in r['arguments']['textList']):return 'invalid-handler-arguments'
    if not exact(r['limits'],LIMIT_KEYS) or not all(positive(r['limits'][k]) for k in LIMIT_KEYS):return 'invalid-handler-arguments'
    c=r['control']
    if not exact(c,['preCancelled','cancelAtTick','timeoutTicks']) or not isinstance(c['preCancelled'],bool) or (c['cancelAtTick'] is not None and (not isinstance(c['cancelAtTick'],int) or isinstance(c['cancelAtTick'],bool) or c['cancelAtTick']<0 or c['cancelAtTick']>9007199254740991)) or (c['timeoutTicks'] is not None and (not isinstance(c['timeoutTicks'],int) or isinstance(c['timeoutTicks'],bool) or c['timeoutTicks']<0 or c['timeoutTicks']>9007199254740991)) or (c['cancelAtTick'] is not None and c['timeoutTicks'] is not None):return 'invalid-handler-arguments'
    if not isinstance(r['capabilityTranscript'],list) or len(r['capabilityTranscript'])!=COUNT or not all(valid_step(x) for x in r['capabilityTranscript']):return 'invalid-handler-arguments'
    return 'runtime-limit-exceeded' if len(raw)>r['limits']['maxBytes'] or not within(r,r['limits']) else None
def json_parse(x):
    def pairs(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('duplicate JSON key')
            out[key]=value
        return out
    return json.loads(x,object_pairs_hook=pairs)
def result_slot(x):
    if not isinstance(x,str):raise Exception('internal-runner-error')
    return {'presence':'value','value':{'tag':'text','value':x}}
def print_event(c,x):
    if not isinstance(x,str) or len(x.encode())>c['request']['limits']['maxStringBytes'] or len(c['events'])+1>c['request']['limits']['maxEvents']:raise Exception('runtime-limit-exceeded')
    c['events'].append({'op':'stdout','text':x})
async def invoke(c,ns,op):
    s=c['request']['capabilityTranscript'][c['index']];c['index']+=1
    if s['namespace']!=ns or s['operation']!=op:raise Exception('capability-error')
    settle=c['tick']+s['delayTicks'];cancel=c['request']['control']['cancelAtTick'];timeout=c['request']['control']['timeoutTicks']
    if timeout is not None and timeout<=settle and (cancel is None or timeout<=cancel):raise Exception('execution-timeout')
    if cancel is not None and cancel<=settle:raise Exception('execution-cancelled')
    c['tick']=settle
    if s['delayTicks']>0:await asyncio.sleep(0)
    if 'error' in s:raise Exception(s['error']['code'])
    if len(c['events'])+1>c['request']['limits']['maxEvents']:raise Exception('runtime-limit-exceeded')
    c['events'].append({'input':s['input'],'namespace':ns,'op':'capability','operation':op,'result':s['result']});v=s['result']['value'];return int(v['value']) if v['tag']=='integer' else None if v['tag']=='null' else v['value']
async def handler(args,context):
${params}
${statements.join('')}
async def main():
    try:raw=sys.stdin.buffer.read();r=json.loads(raw)
    except Exception:emit(fail({},'invalid-handler-arguments','link'));return
    try:bad=validate(r,raw)
    except Exception:bad='handler-link-error'
    if bad:emit(fail(r,bad,'link' if bad=='handler-link-error' else 'execution'));return
    if r['control']['preCancelled']:emit(fail(r,'execution-cancelled'));return
    c={'events':[],'index':0,'request':r,'tick':0}
    try:
        result=await handler(r['arguments'],c)
        if c['index']!=COUNT:raise Exception('capability-error')
        response={'completion':{'kind':'return'},'diagnostics':[],'events':c['events'],'format':'kern.runtime.kir.r0','outcome':'success','requestId':r['requestId'],'result':result}
        if len((canonical(response)+'\\n').encode())>r['limits']['maxBytes']:raise Exception('runtime-limit-exceeded')
        emit(response)
    except Exception as e:emit(fail(r,str(e) if str(e) in ['capability-error','execution-cancelled','execution-timeout','runtime-limit-exceeded'] else 'internal-runner-error'))
asyncio.run(main())
`;
}
