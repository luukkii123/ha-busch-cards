"""Read-only native browser guard; fixture writes never reach the HA host."""
GUARD = "window.__blocked=[];const original=WebSocket.prototype.send;\nWebSocket.prototype.send=function(raw){let m;try{m=JSON.parse(raw)}catch{}\nconst t=m?.type;if(t){const mutation=/call_service|\\/update$|\\/create$|\\/delete$|\\/remove$|\\/set_|\\/save$|\\/download$|\\/install$|\\/start$|\\/stop$|\\/restart$|\\/execute$|\\/press$|\\/turn_/.test(t);\nconst supervisor=t==='supervisor/api'&&!['get','head'].includes(String(m.method||'get').toLowerCase());\nconst protectedWrite=/^(?:config\\/(?:entity|device|area|floor|label)_registry\\/|config_entries\\/|lovelace\\/resources\\/|frontend\\/)/.test(t)&&!/(?:\\/(?:get|list|subscribe)(?:_|$)|frontend\\/(?:get|subscribe)_)/.test(t);\nif(mutation||supervisor||protectedWrite){__blocked.push(t);if(m.id!==undefined)queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:m.id,type:'result',success:false,error:{code:'audit_write_blocked',message:'Read-only flow audit'}})})));return;}}\nreturn original.call(this,raw);};\n"

def install_readonly_guard(context):
    counters = {"httpWritesBlocked": 0}
    context.add_init_script(GUARD)
    def route(request):
        if request.request.method not in ("GET", "HEAD", "OPTIONS"):
            counters["httpWritesBlocked"] += 1
            request.abort()
        else:
            request.continue_()
    context.route("**/*", route)
    return counters
