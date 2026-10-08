import express from "express";
import cors from "cors";
import dns from "node:dns/promises";
import net from "node:net";

const app=express();
const port=process.env.PORT||3000;
const MAX_URL_LENGTH=4096;
const MAX_BODY_BYTES=25*1024*1024;
const USER_AGENT="JohnnyGamesProxy/2.0";

app.disable("x-powered-by");
app.use(cors({origin:true,methods:["GET","HEAD","OPTIONS"],allowedHeaders:["Content-Type","Accept","X-Requested-With"]}));
app.use(express.raw({type:"*/*",limit:MAX_BODY_BYTES}));

app.get("/health",(_,res)=>res.json({ok:true,service:"johnny-games-proxy"}));

function isPrivateIp(ip){
  if(net.isIPv4(ip)){
    const [a,b]=ip.split(".").map(Number);
    return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
  }
  if(net.isIPv6(ip)){
    const x=ip.toLowerCase();
    return x==="::1"||x==="::"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe80:");
  }
  return true;
}
async function assertSafeTarget(u){
  if(!["http:","https:"].includes(u.protocol))throw new Error("Only HTTP(S) URLs are supported");
  if(u.username||u.password)throw new Error("Credentials in URLs are not supported");
  if(u.hostname==="localhost"||u.hostname.endsWith(".localhost")||u.hostname.endsWith(".local"))throw new Error("Local addresses are not allowed");
  const records=await dns.lookup(u.hostname,{all:true});
  if(!records.length||records.some(r=>isPrivateIp(r.address)))throw new Error("Private network addresses are not allowed");
}
function proxied(u,origin){return origin+"/proxy?url="+encodeURIComponent(u.href)}
function rewriteUrl(value,base,origin){
  if(!value||/^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value))return value;
  try{return proxied(new URL(value,base),origin)}catch{return value}
}
function rewriteHtml(html,base,origin){
  return html
    .replace(/<base[^>]*>/gi,"")
    .replace(/(\b(?:src|href|action|poster)\s*=\s*)(["'])([^"']+)\2/gi,(_,a,q,v)=>a+q+rewriteUrl(v,base,origin)+q)
    .replace(/url\((['"]?)([^)'"]+)\1\)/gi,(_,q,v)=>"url("+q+rewriteUrl(v,base,origin)+q+")");
}
function rewriteCss(css,base,origin){
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi,(_,q,v)=>"url("+q+rewriteUrl(v,base)+q+")");
}

app.all("/proxy",async(req,res)=>{
  if(!["GET","HEAD"].includes(req.method))return res.status(405).send("Method not allowed");
  const target=String(req.query.url||"");
  if(!target||target.length>MAX_URL_LENGTH)return res.status(400).send("Invalid or oversized URL");
  let u;
  try{u=new URL(target);await assertSafeTarget(u)}catch(e){return res.status(400).send(e.message||"Invalid URL")}
  try{
    const headers={
      "user-agent":USER_AGENT,
      "accept":req.headers.accept||"*/*",
      "accept-language":req.headers["accept-language"]||"en-US,en;q=0.8"
    };
    const upstream=await fetch(u,{redirect:"manual",headers,signal:AbortSignal.timeout(20000)});
    const location=upstream.headers.get("location");
    if(location){
      let next;
      try{next=new URL(location,u)}catch{next=null}
      if(next){
        try{await assertSafeTarget(next)}catch(e){return res.status(400).send(e.message||"Unsafe redirect")}
        return res.redirect(302,proxied(next,`${req.protocol}://${req.get("host")}`));
      }
    }
    const type=upstream.headers.get("content-type")||"application/octet-stream";
    res.status(upstream.status);
    res.set("cache-control","no-store");
    if(type.includes("text/html")){
      let body=await upstream.text();
      body=rewriteHtml(body,u,`${req.protocol}://${req.get("host")}`);
      res.type("html").send(body);
      return;
    }
    if(type.includes("text/css")){
      let body=await upstream.text();
      body=rewriteCss(body,u,`${req.protocol}://${req.get("host")}`);
      res.type("css").send(body);
      return;
    }
    res.set("content-type",type);
    const disposition=upstream.headers.get("content-disposition");
    if(disposition)res.set("content-disposition",disposition);
    if(req.method==="HEAD")return res.end();
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }catch(e){
    console.error("Proxy error:",e.message);
    res.status(502).send("Upstream request failed");
  }
});

app.listen(port,()=>console.log("Johnny Games proxy listening on "+port));