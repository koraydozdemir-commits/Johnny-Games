import express from "express";
import cors from "cors";
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

const app=express();
const port=process.env.PORT||3000;
const MAX_URL_LENGTH=4096;
const MAX_BODY_BYTES=25*1024*1024;
const USER_AGENT="JohnnyGamesProxy/3.0";
const sessions=new Map();

app.disable("x-powered-by");
app.use(cors({origin:"*",methods:["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"],allowedHeaders:["*"],exposedHeaders:["Content-Type","Content-Disposition","Location"]}));
app.options("/proxy",cors());
app.use(express.raw({type:"*/*",limit:MAX_BODY_BYTES}));
app.get("/health",(_,res)=>res.json({ok:true,service:"johnny-games-proxy",version:"3.0"}));

function isPrivateIp(ip){
  if(net.isIPv4(ip)){const [a,b]=ip.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}
  if(net.isIPv6(ip)){const x=ip.toLowerCase();return x==="::1"||x==="::"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe80:");}
  return true;
}
async function assertSafeTarget(u){
  if(!["http:","https:"].includes(u.protocol))throw new Error("Only HTTP(S) URLs are supported");
  if(u.username||u.password)throw new Error("Credentials in URLs are not supported");
  if(u.hostname==="localhost"||u.hostname.endsWith(".localhost")||u.hostname.endsWith(".local"))throw new Error("Local addresses are not allowed");
  const records=await dns.lookup(u.hostname,{all:true});
  if(!records.length||records.some(r=>isPrivateIp(r.address)))throw new Error("Private network addresses are not allowed");
}
function origin(req){return `${req.protocol}://${req.get("host")}`;}
function proxied(u,o){return o+"/proxy?url="+encodeURIComponent(u.href);}
function rewriteUrl(value,base,o){
  if(!value||/^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value))return value;
  try{return proxied(new URL(value,base),o)}catch{return value}
}
function rewriteHtml(html,base,o){
  return html
    .replace(/<base[^>]*>/gi,"")
    .replace(/(\b(?:src|href|action|poster|cite|formaction)\s*=\s*)(["'])([^"']+)\2/gi,(_,a,q,v)=>a+q+rewriteUrl(v,base,o)+q)
    .replace(/(\bsrcset\s*=\s*)(["'])([^"']+)\2/gi,(_,a,q,v)=>a+q+v.split(",").map(part=>{const bits=part.trim().split(/\s+/);bits[0]=rewriteUrl(bits[0],base,o);return bits.join(" ")}).join(", ")+q)
    .replace(/url\((['"]?)([^)'"]+)\1\)/gi,(_,q,v)=>"url("+q+rewriteUrl(v,base,o)+q+")")
    .replace(/<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]+>/gi,m=>m.replace(/url\s*=\s*([^;>]+)/i,(_,v)=>"url="+rewriteUrl(v.trim().replace(/^['"]|['"]$/g,""),base,o)));
}
function rewriteCss(css,base,o){return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi,(_,q,v)=>"url("+q+rewriteUrl(v,base,o)+q+")");}

function sessionId(req,res){
  const match=String(req.headers.cookie||"").match(/(?:^|;\s*)jg_proxy_session=([^;]+)/);
  if(match?.[1])return match[1];
  const id=crypto.randomUUID();
  res.cookie("jg_proxy_session",id,{httpOnly:true,secure:true,sameSite:"none",maxAge:86400000,path:"/"});
  sessions.set(id,new Map());
  return id;
}
function getJar(req,res){const id=sessionId(req,res);if(!sessions.has(id))sessions.set(id,new Map());return sessions.get(id);}
function cookieHeader(jar,host){
  const now=Date.now();
  const values=[];
  for(const [key,item] of jar){if(item.expires&&item.expires<now){jar.delete(key);continue;}if(host===item.host||host.endsWith("."+item.host))values.push(item.name+"="+item.value);}
  return values.join("; ");
}
function storeSetCookies(jar,host,headers){
  const raw=headers.getSetCookie?.()||[];
  for(const line of raw){
    const parts=line.split(";").map(x=>x.trim());
    const pair=parts.shift();const i=pair.indexOf("=");if(i<1)continue;
    const name=pair.slice(0,i),value=pair.slice(i+1);
    let expires=0,path="/";
    for(const part of parts){const [k,...rest]=part.split("=");if(/^max-age$/i.test(k)){const n=Number(rest.join("="));if(n<=0){jar.delete(host+"|"+name);continue;}expires=Date.now()+n*1000;}if(/^expires$/i.test(k)){const t=Date.parse(rest.join("="));if(Number.isFinite(t))expires=t;}if(/^path$/i.test(k)&&rest.join("="))path=rest.join("=");}
    jar.set(host+"|"+path+"|"+name,{name,value,host,expires});
  }
}

app.all("/proxy",async(req,res)=>{
  if(!["GET","HEAD","POST","PUT","PATCH","DELETE"].includes(req.method))return res.status(405).send("Method not allowed");
  const target=String(req.query.url||"");
  if(!target||target.length>MAX_URL_LENGTH)return res.status(400).send("Invalid or oversized URL");
  let u;
  try{u=new URL(target);await assertSafeTarget(u)}catch(e){return res.status(400).send(e.message||"Invalid URL");}
  try{
    const jar=getJar(req,res);
    const headers={
      "user-agent":USER_AGENT,
      "accept":req.headers.accept||"*/*",
      "accept-language":req.headers["accept-language"]||"en-US,en;q=0.8"
    };
    const cookies=cookieHeader(jar,u.hostname);if(cookies)headers.cookie=cookies;
    if(req.headers["content-type"])headers["content-type"]=req.headers["content-type"];
    if(req.headers["content-length"])headers["content-length"]=req.headers["content-length"];
    const init={method:req.method,redirect:"manual",headers,signal:AbortSignal.timeout(20000)};
    if(!["GET","HEAD"].includes(req.method)&&req.body?.length)init.body=req.body;
    const upstream=await fetch(u,init);
    storeSetCookies(jar,u.hostname,upstream.headers);
    const location=upstream.headers.get("location");
    if(location){
      let next;
      try{next=new URL(location,u)}catch{next=null}
      if(next){
        await assertSafeTarget(next);
        res.status(upstream.status).set("location",proxied(next,origin(req))).set("access-control-allow-origin","*").end();
        return;
      }
    }
    const type=upstream.headers.get("content-type")||"application/octet-stream";
    res.status(upstream.status).set("cache-control","no-store").set("access-control-allow-origin","*");
    // These headers describe the target as a frame parent. The target is actually being
    // delivered by this proxy, so retaining them would make iframe navigation fail.
    res.removeHeader("x-frame-options");
    res.removeHeader("content-security-policy");
    res.removeHeader("content-security-policy-report-only");
    if(type.includes("text/html")){
      let body=await upstream.text();
      body=rewriteHtml(body,u,origin(req));
      res.type("html").send(body);return;
    }
    if(type.includes("text/css")){
      let body=await upstream.text();
      body=rewriteCss(body,u,origin(req));
      res.type("css").send(body);return;
    }
    const disposition=upstream.headers.get("content-disposition");if(disposition)res.set("content-disposition",disposition);
    if(req.method==="HEAD")return res.end();
    res.set("content-type",type).send(Buffer.from(await upstream.arrayBuffer()));
  }catch(e){
    console.error("Proxy error:",e.message);
    const message=e?.name==="TimeoutError"?"Upstream request timed out":(e?.message||"Upstream request failed");
    res.status(502).set("access-control-allow-origin","*").json({ok:false,error:message});
  }
});
app.listen(port,()=>console.log("Johnny Games proxy v3 listening on "+port));
