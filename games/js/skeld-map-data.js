/* Johnny Among Us — The Skeld map geometry and gameplay anchors.
 *
 * The room/corridor outline was independently adapted from the public overview
 * geometry in HorseyHangout/au_skeld (CC BY-NC-SA 4.0), used as a measured
 * geometry reference. No Innersloth textures, models, sprites or sounds are
 * included. See docs/skeld-map-reference.md and the source LICENSE.
 *
 * The 1024×1024 source drawing has actual ship geometry in x=5..1020,
 * y=4..563. A uniform 1.4 scale places it into the existing 1440×870
 * multiplayer world without changing player/network world size.
 */
(function(global){
'use strict';
const SOURCE={"hull":"M 70,190 H 45 L 5,217 v 116 l 40,27 h 25 v -39 h 39 v -28 h 37 v 80 h -45 v 84 l 29,22 h 82 v -35 h 48 v 63 h 185 v 8 l 48,48 h 95 V 457 h 82 v 32 h -67 v 50 l 24,24 h 70 l 23,-23 v -51 h -14 v -32 h 29 v 44 h 58 l 50,-50 v -56 h -35 v -72 h 58 v -40 h 70 v 29 h 47 l 37,-30 v -34 l -38,-31 h -46 v 30 h -70 v -35 h -58 v -48 h 35 V 108 L 792,57 h -57 v 44 H 683 V 71 L 616,4 H 464 l -45,45 v 54 H 212 V 77 h -82 l -29,22 v 84 h 45 v 74 H 109 V 229 H 70 Z","wallWest":"m 357,471 h 88 v -73 l 35,-35 h 52 V 251 h -55 l -58,-58 v -54 h -54 v 32 h 34 v 61 l 41,41 v 11 H 319 l -19,-23 v -90 h 30 V 139 H 212 v 44 h -31 v 74 h 39 v -25 l 21,-21 h 24 l 17,17 v 91 h -62 v -26 h -39 v 80 h 31 v 35 h 83 v 63 h 27 V 328 h 121 v 12 l -30,30 v 48 l -23,23 h -33 z","wallEast":"M 567,251 v 46 h 164 v 73 l -21,21 h -97 v -58 h -46 v 30 h 21 v 59 h 147 v -5 l 22,-22 h 16 V 287 h 57 v -40 h -80 v 21 h -88 v -15 l 38,-38 v -11 h 50 v 8 h 23 v -48 h -15 l -23,-23 v -5 h -52 v 54 l -61,61 z","cafeteria":"M 616,4 H 464 l -45,45 v 144 l 58,58 h 145 l 61,-61 V 71 Z","weapons":"m 735,57 v 84 l 23,23 h 85 V 108 L 792,57 Z","navigation":"m 936,217 v 95 h 47 l 37,-30 v -34 l -38,-31 z","shields":"m 843,395 h -86 l -22,22 v 84 h 58 l 50,-50 z","communications":"m 720,489 v 51 l -23,23 h -70 l -24,-24 v -50 z","storage":"M 588,563 V 363 H 480 l -35,35 v 117 l 48,48 z","medbay":"m 300,171 h 99 v 61 l 41,41 v 11 H 319 l -19,-23 z","upperEngine":"M 212,183 V 77 h -82 l -29,22 v 84 z","reactor":"M 109,321 V 229 H 70 V 190 H 45 L 5,217 v 116 l 40,27 h 25 v -39 z","security":"m 220,232 v 87 h 62 v -91 l -17,-17 h -24 z","lowerEngine":"M 101,373 H 212 V 479 H 130 L 101,457 Z","electrical":"M 390,441 H 322 V 328 h 121 v 12 l -30,30 v 48 z","admin":"m 613,297 v 94 h 97 l 21,-21 v -73 z","o2":"m 750,268 v -64 h -50 v 11 l -38,38 v 15 z","hallTop":"M 419,139 V 103 H 212 v 36 h 118 v 32 h 35 v -32 z","hallWest":"m 146,183 v 74 h -37 v 36 h 37 v 80 h 35 v -80 h 39 v -36 h -39 v -74 z","hallSouth":"m 212,408 v 36 h 48 v 63 h 185 v -36 h -88 v -30 h -35 v 30 h -27 v -63 z","hallCafeteria":"m 532,251 h 35 v 46 h 46 v 36 h -46 v 30 h -35 z","hallAdmin":"m 588,422 h 147 v 35 h -29 v 32 h -36 v -32 h -82 z","hallEast":"M 773,395 V 287 h 57 v -40 h -80 v -35 h 23 v -48 h 35 v 48 h 58 v 35 h 70 v 36 h -70 v 40 h -58 v 72 z","hallBridge":"m 683,101 h 52 v 35 h -52 z"};
const TRANSFORM={scale:1.4,x:7,y:38};
function parsePath(d){
  const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g)||[];
  const paths=[];let path=null,x=0,y=0,sx=0,sy=0,cmd=null,i=0;
  const isCommand=t=>/^[a-zA-Z]$/.test(t);
  while(i<tokens.length){
    if(isCommand(tokens[i])){cmd=tokens[i++];if(cmd==='z'||cmd==='Z'){if(path&&path.length>2){paths.push(path);path=null;}x=sx;y=sy;cmd=null;continue;}}
    if(!cmd)continue;
    const lower=cmd===cmd.toLowerCase(),op=cmd.toUpperCase();
    if(op==='M'||op==='L'){
      const nx=Number(tokens[i++]),ny=Number(tokens[i++]);
      if(!Number.isFinite(nx)||!Number.isFinite(ny))break;
      x=lower?x+nx:nx;y=lower?y+ny:ny;
      if(op==='M'){if(path&&path.length>2)paths.push(path);path=[[x,y]];sx=x;sy=y;cmd=lower?'l':'L';}
      else {if(!path){path=[[x,y]];sx=x;sy=y;}else path.push([x,y]);}
    }else if(op==='H'){
      const nx=Number(tokens[i++]);if(!Number.isFinite(nx))break;x=lower?x+nx:nx;if(path)path.push([x,y]);
    }else if(op==='V'){
      const ny=Number(tokens[i++]);if(!Number.isFinite(ny))break;y=lower?y+ny:ny;if(path)path.push([x,y]);
    }else{throw new Error('Unsupported Skeld SVG path command: '+cmd);}
  }
  if(path&&path.length>2)paths.push(path);
  return paths;
}
function mapPoly(poly){return poly.map(p=>[TRANSFORM.x+p[0]*TRANSFORM.scale,TRANSFORM.y+p[1]*TRANSFORM.scale]);}
const FLOORS=[["Cafeteria","cafeteria","cafeteria"],["Weapons","weapons","weapons"],["Navigation","navigation","nav"],["Shields","shields","shields"],["Communications","communications","comms"],["Storage","storage","storage"],["MedBay","medbay","medbay"],["Upper Engine","upperEngine","engine"],["Reactor","reactor","reactor"],["Security","security","security"],["Lower Engine","lowerEngine","engine"],["Electrical","electrical","electrical"],["Admin","admin","admin"],["O2","o2","o2"]].map(([n,key,kind])=>({n:n,kind:kind,c:'#aeb2ad',p:mapPoly(parsePath(SOURCE[key])[0])}));
const HALLS=["hallTop","hallWest","hallSouth","hallCafeteria","hallAdmin","hallEast","hallBridge"].map(key=>mapPoly(parsePath(SOURCE[key])[0]));
const HULL=mapPoly(parsePath(SOURCE.hull)[0]);
const WALLS=["hull","wallWest","wallEast"].flatMap(key=>parsePath(SOURCE[key]).map(mapPoly));

const VENT_META=[
 {id:0,name:'Admin',protocol:[2.543373,-9.59182],canvas:[960,520],links:[1,2]},
 {id:1,name:'Right hallway',protocol:[9.38308,-6.0749207],canvas:[1180,472],links:[0,2]},
 {id:2,name:'Cafeteria',protocol:[4.2584915,0.08728027],canvas:[830,248],links:[0,1]},
 {id:3,name:'Electrical',protocol:[-9.777372,-7.6704063],canvas:[546,570],links:[5,6]},
 {id:4,name:'Upper Engine',protocol:[-15.288929,2.8827324],canvas:[245,220],links:[11]},
 {id:5,name:'Security',protocol:[-12.534981,-6.586403],canvas:[357,402],links:[3,6]},
 {id:6,name:'Medbay',protocol:[-10.608683,-3.8129234],canvas:[525,360],links:[3,5]},
 {id:7,name:'Weapons',protocol:[8.819103,3.687191],canvas:[1113,178],links:[12]},
 {id:8,name:'Lower Reactor',protocol:[-20.796825,-6.590065],canvas:[84,444],links:[9]},
 {id:9,name:'Lower Engine',protocol:[-15.251087,-13.293049],canvas:[231,626],links:[8]},
 {id:10,name:'Shields',protocol:[9.52224,-13.974211],canvas:[1127,661],links:[13]},
 {id:11,name:'Upper Reactor',protocol:[-21.877165,-2.6886406],canvas:[84,360],links:[4]},
 {id:12,name:'Upper Navigation',protocol:[16.007935,-2.8046074],canvas:[1372,402],links:[7]},
 {id:13,name:'Lower Navigation',protocol:[16.007935,-6.0212097],canvas:[1372,437],links:[10]}
];
const VENT_GROUPS=[[4,11],[8,9],[3,5,6],[0,1,2],[7,12],[13,10]];
const VENTS=VENT_META.map(v=>v.canvas.slice()),VENT_LINKS=VENT_META.map(v=>v.links.slice());

const TASK_NAMES=['START REACTOR','ALIGN ENGINE OUTPUT','SUBMIT SCAN','FIX WIRING','SWIPE CARD','PRIME SHIELDS','CLEAR ASTEROIDS','STABILIZE STEERING','UNLOCK MANIFOLDS','CALIBRATE DISTRIBUTOR','DOWNLOAD / UPLOAD DATA','CLEAN O2 FILTER','FUEL ENGINES','CHART COURSE',null,'DIVERT POWER','EMPTY GARBAGE','INSPECT SAMPLE'];
const ST=[
 [152,420],[285,270],[535,390],[500,555],[1000,550],[1089,710],[1178,225],[1367,418],
 [54,353],[585,555],[950,316],[970,358],[730,740],[1389,384],null,[546,570],[830,300],[585,400]
];
const WIRE_STATIONS=[
 {name:'Admin',point:[1000,555],stages:[1,2]},
 {name:'Cafeteria',point:[950,316],stages:[1,2]},
 {name:'Electrical',point:[500,555],stages:[0]},
 {name:'Navigation',point:[1367,418],stages:[0,1,2]},
 {name:'Security',point:[357,450],stages:[2]},
 {name:'Storage',point:[730,680],stages:[0,1]}
];
const DOWNLOAD_STATIONS=[
 {name:'Cafeteria',point:[950,316]},
 {name:'Weapons',point:[1178,225]},
 {name:'Navigation',point:[1389,384]},
 {name:'Communications',point:[990,805]},
 {name:'Electrical',point:[510,590]}
];
const POWER_TARGETS=[[990,805],[970,358],[1089,710],[1367,418],[1178,225],[165,650],[357,450],[285,270]];
const POWER_TARGET_NAMES=['COMMUNICATIONS','O2','SHIELDS','NAVIGATION','WEAPONS','LOWER ENGINE','SECURITY','UPPER ENGINE'];
const TBL=[820,205];

const DOORWAYS=[
 // Upper Engine, Reactor, Security, MedBay, Lower Engine, Electrical, Storage, Admin.
 [295,230,18,42,true], [145,390,18,42,true], [392,390,18,42,true],
 [418,340,18,42,true], [295,625,18,42,true], [621,576,18,42,true],
 [815,650,18,42,true], [857,499,18,42,true],
 // Communications, Shields, Weapons, Navigation.
 [925,715,46,16,false], [1090,583,46,16,false], [1027,167,18,42,true],
 [1305,405,18,42,true],
 // O2 diagonal doorway, Cafeteria west/east/south openings.
 [948,347,46,16,false,Math.PI*0.75], [585,250,18,42,true],
 [954,250,18,42,true], [760,381,46,16,false]
];
const PANELS=[[546,570]];
const REACTOR_PANELS=[[130,365],[130,485]];
const O2_PANELS=[[1000,350],[1010,500]];
const COMMS_PANEL=[950,780];
const CAMERAS=[
 {name:'Security hallway',x:405,y:455,angle:0},
 {name:'MedBay hallway',x:445,y:430,angle:0},
 {name:'Admin hallway',x:1030,y:520,angle:Math.PI},
 {name:'O2 hallway',x:1080,y:385,angle:Math.PI}
];
const PROPS=[
 {id:'upper-engine',x:255,y:205,w:88,h:68},
 {id:'lower-engine',x:255,y:625,w:88,h:68},
 {id:'reactor-core',x:90,y:420,w:96,h:110},
 {id:'security-desk',x:360,y:405,w:48,h:32},
 {id:'medbay-bed-a',x:492,y:325,w:42,h:72},
 {id:'medbay-bed-b',x:555,y:325,w:42,h:72},
 {id:'cafeteria-table-a',x:740,y:125,w:76,h:52},
 {id:'cafeteria-table-b',x:890,y:125,w:76,h:52},
 {id:'cafeteria-table-c',x:740,y:295,w:76,h:52},
 {id:'cafeteria-table-d',x:890,y:295,w:76,h:52},
 {id:'meeting-table',x:820,y:205,w:58,h:40},
 {id:'weapons-cannon',x:1115,y:180,w:104,h:68},
 {id:'admin-table',x:930,y:500,w:100,h:70},
 {id:'shield-generator',x:1127,y:650,w:66,h:66}
];
const NO_COLLISION_PROPS=new Set(['security-desk','medbay-bed-a','medbay-bed-b','weapons-cannon']);
const SMALL_ROOM_PROPS=new Set(['upper-engine','lower-engine','reactor-core']);
const BLOCKERS=PROPS.filter(p=>!NO_COLLISION_PROPS.has(p.id)).map(p=>{
 const scale=SMALL_ROOM_PROPS.has(p.id)?0.34:0.58;
 const cw=p.w*scale,ch=p.h*scale;
 return[p.x-cw/2,p.y-ch/2,cw,ch];
}).concat([
 [480,492,30,48],[520,492,30,48],[560,492,30,48],[600,492,30,48],
 [480,610,30,42],[520,610,30,42],[560,610,30,42],
 [660,590,42,42],[750,590,42,42],[800,590,38,38],[660,705,42,42],[800,705,38,38],[740,770,42,38],
 [1000,335,46,26],[1032,373,38,26],[1340,340,58,32],[1380,405,55,32],[1310,430,50,26],
 [890,565,46,24],[970,565,46,24],[950,755,54,28],[1090,610,42,24]
]);
const DEFAULT_WIRE_ROUTE=[WIRE_STATIONS[2].point,WIRE_STATIONS[5].point,WIRE_STATIONS[0].point];
global.JohnnySkeldMapData=Object.freeze({
 version:2,world:{width:1440,height:870},transform:TRANSFORM,
 FLOORS,HALLS,HULL,WALLS,VENT_META,VENT_GROUPS,VENTS,VENT_LINKS,
 TASK_NAMES,ST,WIRE_STATIONS,DOWNLOAD_STATIONS,POWER_TARGETS,POWER_TARGET_NAMES,TBL,
 DOORWAYS,PANELS,REACTOR_PANELS,O2_PANELS,COMMS_PANEL,CAMERAS,PROPS,BLOCKERS,
 DEFAULT_WIRE_ROUTE
});
})(window);
