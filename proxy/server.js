import express from "express";
import cors from "cors";
const app=express(); const port=process.env.PORT||3000;
app.use(cors()); app.get("/health",(_,res)=>res.json({ok:true}));
function rewriteUrl(value,base){try{return "/proxy?url="+encodeURIComponent(new URL(value,base).href)}catch{return value}}
function rewriteHtml(html,base){
 return html
 .replace(/(\b(?:src|href|action)\s*=\s*["'])([^"']+)(["'])/gi,(_,a,v,b)=>a+rewriteUrl(v,base)+b)
 .replace(/url\((['"]?)([^)'"]+)\1\)/gi,(_,q,v)=>"url("+q+rewriteUrl(v,base)+q+")");
}
app.all("/proxy",async(req,res)=>{
 const target=String(req.query.url||"");
 let u; try{u=new URL(target)}catch{return res.status(400).send("Invalid URL")}
 if(!/^https?:$/.test(u.protocol))return res.status(400).send("Only HTTP(S) URLs are supported");
 try{
  const headers={"user-agent":"JohnnyGamesProxy/1.0","accept":req.headers.accept||"*/*"};
  if(req.headers.cookie)headers.cookie=req.headers.cookie;
  const upstream=await fetch(u,{redirect:"follow",headers});
  const type=upstream.headers.get("content-type")||"application/octet-stream";
  res.status(upstream.status);
  if(type.includes("text/html")){
   let body=await upstream.text();
   body=body.replace(/<base[^>]*>/gi,"");
   body=rewriteHtml(body,u.href);
   res.type("html").send(body);
  }else{
   res.set("content-type",type);
   const location=upstream.headers.get("location"); if(location)res.set("location","/proxy?url="+encodeURIComponent(new URL(location,u.href).href));
   res.send(Buffer.from(await upstream.arrayBuffer()));
  }
 }catch(e){res.status(502).send("Upstream request failed")}
});
app.listen(port,()=>console.log("Johnny Games proxy listening on "+port));