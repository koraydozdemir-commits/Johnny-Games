import express from "express";
import cors from "cors";
import { JSDOM } from "jsdom";

const app = express();
const port = process.env.PORT || 3000;
const allowedHosts = (process.env.ALLOWED_HOSTS || "").split(",").map(x=>x.trim()).filter(Boolean);

app.use(cors());
app.get("/health", (_req,res)=>res.json({ok:true,service:"johnny-games-proxy"}));

function allowed(url){
  if(!allowedHosts.length) return true;
  try { return allowedHosts.includes(new URL(url).hostname); } catch { return false; }
}

function rewriteHtml(html, base){
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rewrite = value => {
    try { return "/proxy?url="+encodeURIComponent(new URL(value,base).href); }
    catch { return value; }
  };
  doc.querySelectorAll("[href]").forEach(el=>{
    const v=el.getAttribute("href");
    if(v && !v.startsWith("#") && !v.startsWith("javascript:")) el.setAttribute("href",rewrite(v));
  });
  doc.querySelectorAll("[src]").forEach(el=>{
    const v=el.getAttribute("src");
    if(v && !v.startsWith("data:")) el.setAttribute("src",rewrite(v));
  });
  return dom.serialize();
}

app.get("/proxy", async (req,res)=>{
  const target=String(req.query.url||"");
  let u;
  try { u=new URL(target); } catch { return res.status(400).send("Invalid URL"); }
  if(!/^https?:$/.test(u.protocol)) return res.status(400).send("Only HTTP(S) URLs are supported");
  if(!allowed(target)) return res.status(403).send("Host not allowed");

  try {
    const upstream=await fetch(u,{redirect:"follow",headers:{"user-agent":"JohnnyGamesBrowser/1.0","accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}});
    const type=upstream.headers.get("content-type")||"application/octet-stream";
    res.status(upstream.status);
    if(type.includes("text/html")){
      const html=await upstream.text();
      res.type("html").send(rewriteHtml(html,u.href));
    }else{
      const buf=Buffer.from(await upstream.arrayBuffer());
      res.set("content-type",type).send(buf);
    }
  } catch(e) { res.status(502).send("Upstream request failed"); }
});

app.listen(port,()=>console.log("Johnny Games proxy listening on "+port));
