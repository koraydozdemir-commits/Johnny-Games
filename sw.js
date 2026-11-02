'use strict';
var CACHE='johnny-games-shell-v6';
var CORE=['./','./index.html','./play.html','./analytics.html','./games.json','./manifest.webmanifest','./images/Banner.png','./images/Wallpaper.jpg'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){var u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;e.respondWith(caches.match(e.request).then(function(hit){var net=fetch(e.request).then(function(r){if(r.ok&&r.type==='basic'){var copy=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,copy)})}return r}).catch(function(){return hit||caches.match('./index.html')});return hit||net}))});
