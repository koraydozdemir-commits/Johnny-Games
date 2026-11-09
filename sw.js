'use strict';
var CACHE='johnny-games-shell-v11';
var CORE=['./','./index.html','./play.html','./analytics.html','./games.json','./manifest.webmanifest','./images/Banner.png','./images/Wallpaper.jpg'];
var MAX_CACHE_BYTES=2*1024*1024;
function cacheable(request,response,url){
 if(!response||!response.ok||response.type!=='basic'||request.method!=='GET')return false;
 if(url.origin!==location.origin)return false;
 if(url.pathname.indexOf('/games/')!==-1||url.pathname.indexOf('/thumbnails/')!==-1)return false;
 var type=(response.headers.get('content-type')||'').toLowerCase();
 if(!(type.indexOf('text/html')===0||type.indexOf('javascript')!==-1||type.indexOf('text/css')===0||type.indexOf('application/json')===0||type.indexOf('image/')===0))return false;
 var size=Number(response.headers.get('content-length')||0);
 return !size||size<=MAX_CACHE_BYTES;
}
async function putIfSmall(cache,request,response,url){
 if(!cacheable(request,response,url))return;
 try{await cache.put(request,response.clone())}catch(_){}
}
self.addEventListener('install',function(event){
 event.waitUntil(caches.open(CACHE).then(function(cache){
  return Promise.all(CORE.map(async function(path){
   try{var request=new Request(path,{cache:'reload'}),response=await fetch(request);if(response.ok)await cache.put(request,response)}catch(_){}
  }));
 }).then(function(){return self.skipWaiting()}));
});
self.addEventListener('activate',function(event){
 event.waitUntil(caches.keys().then(function(keys){
  return Promise.all(keys.filter(function(key){return key!==CACHE}).map(function(key){return caches.delete(key)}));
 }).then(function(){return self.clients.claim()}));
});
self.addEventListener('fetch',function(event){
 var request=event.request;
 if(request.method!=='GET')return;
 var url=new URL(request.url);
 if(url.origin!==location.origin)return;
 event.respondWith((async function(){
  var cache=await caches.open(CACHE);
  try{
   var response=await fetch(request,{cache:'no-store'});
   await putIfSmall(cache,request,response,url);
   return response;
  }catch(error){
   var cached=await cache.match(request);
   if(cached)return cached;
   if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname.endsWith('/index.html'))){
    return (await cache.match('./index.html'))||Response.error();
   }
   return Response.error();
  }
 })());
});
