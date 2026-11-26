/* FAKE Firebase compat SDK (테스트 전용). Firestore 는 https://fakefs.test/op 로 (Node 쪽 메모리 저장소 + 규칙 흉내) */
(function(){
  if (window.firebase && window.firebase.__fake) return;
  const API = 'https://fakefs.test/op';
  const LSK = '__fakefb_user';
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const unb64 = s => { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return decodeURIComponent(escape(atob(s))); };
  const rand = () => Math.random().toString(36).slice(2,10);
  const err = (code,msg) => { const e = new Error(msg||code); e.code = code; e.name='FirebaseError'; return e; };
  let user = null; const listeners = new Set();
  function mkUser(o){ const tok = 'idt.'+b64(JSON.stringify({uid:o.uid,claims:o.claims||{},anon:!!o.anon}));
    return { uid:o.uid, isAnonymous:!!o.anon, _tok:tok,
      getIdToken: async()=>tok, getIdTokenResult: async()=>({claims:Object.assign({},o.claims||{}),token:tok}), delete: async()=>{ setUser(null); } }; }
  function setUser(o){ user = o ? mkUser(o) : null; try{ o ? localStorage.setItem(LSK, JSON.stringify(o)) : localStorage.removeItem(LSK); }catch(e){}
    listeners.forEach(f=>setTimeout(()=>f(user),0)); }
  try{ const j = localStorage.getItem(LSK); if (j) user = mkUser(JSON.parse(j)); }catch(e){}
  const auth = {
    get currentUser(){ return user; },
    onAuthStateChanged(f){ listeners.add(f); setTimeout(()=>f(user),0); return ()=>listeners.delete(f); },
    async signInAnonymously(){ setUser({uid:'anon:'+rand(),anon:true,claims:{}}); await call({op:'auth',kind:'anon'}); return {user}; },
    async signInWithCustomToken(t){ if(typeof t!=='string'||!t.startsWith('ct.')) throw err('auth/invalid-custom-token');
      const o = JSON.parse(unb64(t.slice(3))); setUser({uid:o.uid,claims:o.claims||{}}); await call({op:'auth',kind:'custom',uid:o.uid}); return {user}; },
    async signOut(){ setUser(null); }
  };
  async function call(body){ const r = await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(Object.assign({token:user?user._tok:null},body))});
    const j = await r.json(); if (j.error) throw err(j.error, j.message); return j; }
  const SV = {__sv:'ts'};
  class Snap{ constructor(path,data){ this.ref=new DocRef(path); this.id=path.split('/').pop(); this._d=data; this.exists=data!=null; } data(){ return this._d==null?undefined:JSON.parse(JSON.stringify(this._d)); } get(k){ return this._d?this._d[k]:undefined; } }
  function poll(fn, next, onErr){ let stop=false,last=null,t=null; const tick=async()=>{ if(stop) return; try{ const v=await fn(); const k=JSON.stringify(v.key); if(k!==last){ last=k; if(!stop) next(v.val); } t=setTimeout(tick,350); }catch(e){ if(!stop&&onErr) onErr(e); } }; tick(); return ()=>{stop=true;clearTimeout(t);}; }
  const hasUndef=v=>v===undefined||(v&&typeof v==='object'&&Object.values(v).some(hasUndef));
  const chk=(d)=>{ if(hasUndef(d)) return Promise.reject(err('invalid-argument','Unsupported field value: undefined')); return null; };
  class DocRef{ constructor(path){ this.path=path; this.id=path.split('/').pop(); }
    async get(){ const r = await call({op:'get',path:this.path}); return new Snap(this.path,r.data); }
    set(d,o){ const e=chk(d); if(e) return e; return call({op:'set',path:this.path,data:d,merge:!!(o&&o.merge)}).then(()=>{}); }
    update(d){ const e=chk(d); if(e) return e; return call({op:'update',path:this.path,data:d}).then(()=>{}); }
    delete(){ return call({op:'delete',path:this.path}).then(()=>{}); }
    onSnapshot(next,onErr){ return poll(async()=>{ const r=await call({op:'get',path:this.path}); return {key:r.data,val:new Snap(this.path,r.data)}; },next,onErr); } }
  class Query{ constructor(col,filters){ this.col=col; this.filters=filters||[]; }
    where(f,op,v){ return new Query(this.col,this.filters.concat([[f,op,v]])); }
    doc(id){ return new DocRef(this.col+'/'+(id||rand()+rand())); }
    async _run(){ const r = await call({op:'query',col:this.col,filters:this.filters}); return r.docs; }
    async get(){ const docs = await this._run(); return qsnap(this.col,docs); }
    onSnapshot(next,onErr){ return poll(async()=>{ const docs=await this._run(); return {key:docs,val:qsnap(this.col,docs)}; },next,onErr); } }
  const qsnap=(col,docs)=>{ const ds=docs.map(d=>new Snap(col+'/'+d.id,d.data)); return {docs:ds,size:ds.length,empty:!ds.length,forEach:f=>ds.forEach(f)}; };
  const db = { doc:p=>new DocRef(p), collection:c=>new Query(c,[]) };
  const firestore = function(){ return db; }; firestore.FieldValue = { serverTimestamp:()=>SV };
  window.firebase = { __fake:true, apps:[], initializeApp(cfg){ const a={name:'[DEFAULT]',options:cfg}; this.apps.push(a); return a; }, auth:()=>auth, firestore };
})();
