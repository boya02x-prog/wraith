// Wraith Transmission Kit: one renderer for posters (PNG) and videos (MP4 frames). Same code = uniform look.
const fs=require("fs"),path=require("path");
const ROOT=process.env.WRAITH_ROOT||path.resolve(__dirname,"..","..");
const {createCanvas,loadImage,GlobalFonts}=require(ROOT+"/node_modules/@napi-rs/canvas");
GlobalFonts.registerFromPath(ROOT+"/assets/fonts/anton-latin-400-normal.woff","Anton");
GlobalFonts.registerFromPath(ROOT+"/assets/fonts/ibm-plex-mono-latin-700-normal.woff","Plex");
const TYPES={
 SIGHTING:{label:"NEW SIGHTING",color:"#ff7b3d",tier:"wraith"},      // a new feature
 TRANSMISSION:{label:"TRANSMISSION",color:"#2fd9c0",tier:"shade"},    // update / patch notes / news
 GATHERING:{label:"GATHERING",color:"#b27cff",tier:"specter"},       // event, AMA, giveaway, raid night
 ASCENDED:{label:"ASCENDED",color:"#ffd34a",tier:"wraith"},          // milestone
 WARNING:{label:"WARNING",color:"#ff3b4d",tier:"specter"},           // scam / safety alert
 RANKUP:{label:"RANK UP",color:"#ff7b3d",tier:"wraith"},             // tier news
};
const ART={shade:"shade.png",specter:"specter.png",wraith:"tier-wraith.png"};
const HUE={shade:0,specter:0,wraith:0};
let img={};
async function load(){for(const [k,f] of Object.entries(ART))img[k]=await loadImage(ROOT+"/public/"+f)}
const cl=(v)=>Math.max(0,Math.min(1,v)),eo=(t,a,b)=>{const x=cl((t-a)/(b-a));return 1-Math.pow(1-x,3)};
function wrap(x,t,w){const o=[];let l="";for(const wd of t.split(" ")){const tt=l?l+" "+wd:wd;if(x.measureText(tt).width>w&&l){o.push(l);l=wd}else l=tt}if(l)o.push(l);return o}
function fit(x,t,w,max,min,maxLines,font,availH=1e9){for(let px=max;px>=min;px-=2){x.font=`${px}px ${font}`;const L=wrap(x,t,w);if(L.length<=maxLines&&L.length*px*1.02<=availH)return{px,L}}x.font=`${min}px ${font}`;return{px:min,L:wrap(x,t,w).slice(0,maxLines)}}
function hexA(h,a){const n=parseInt(h.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}
function eyes(x,cx,cy,s,col,open){const w=34*s,h=11*s*Math.max(.12,open);for(const dx of[-1,1]){x.save();x.translate(cx+dx*30*s,cy);x.rotate(dx*-0.1);x.shadowColor=col;x.shadowBlur=18*s;x.fillStyle=col;x.beginPath();x.roundRect(-w/2,-h/2,w,h,h/2);x.fill();x.restore()}}
/** Draw one frame. spec={type,n,title,sub,chips?,tier?}; t=0..1 intro progress (use 1 for posters); clock=seconds for looping motion */
function draw(x,W,H,spec,t=1,clock=0){
 const T=TYPES[spec.type]||TYPES.TRANSMISSION,col=T.color,tier=spec.tier||T.tier,P=H>W;
 x.fillStyle="#0b0b0d";x.fillRect(0,0,W,H);
 const gx=P?W/2:W*0.74,gy=P?H*0.775:H*0.52;
 let g=x.createRadialGradient(gx,gy,10,gx,gy,Math.max(W,H)*0.6);g.addColorStop(0,hexA(col,0.32));g.addColorStop(1,hexA(col,0));x.fillStyle=g;x.fillRect(0,0,W,H);
 x.strokeStyle="rgba(255,255,255,0.035)";x.lineWidth=1;const gs=P?54:48;for(let a=0;a<W;a+=gs){x.beginPath();x.moveTo(a,0);x.lineTo(a,H);x.stroke()}for(let b=0;b<H;b+=gs){x.beginPath();x.moveTo(0,b);x.lineTo(W,b);x.stroke()}
 // scanner rings
 const R0=(P?W:H)*(P?0.14:0.17),gap=(P?W:H)*0.11;
 for(let i=0;i<5;i++){const ph=((clock*0.35+i*0.2)%1);const r=R0+i*gap+(clock?ph*gap*0.5:0);x.strokeStyle=hexA(col,(0.30-i*0.05)*eo(t,0.0,0.4));x.lineWidth=2;x.beginPath();x.arc(gx,gy,r,0,Math.PI*2);x.stroke()}
 // crosshair ticks
 x.strokeStyle=hexA(col,0.35*eo(t,0.1,0.5));x.beginPath();x.moveTo(gx-R0*0.5,gy);x.lineTo(gx-R0*2.2,gy);x.moveTo(gx+R0*0.5,gy);x.lineTo(gx+R0*2.2,gy);x.stroke();
 // character
 const im=img[tier],ch=(P?H*0.29:H*0.74),cw=ch*im.width/im.height,e=eo(t,0.05,0.4),float=clock?Math.sin(clock*2)*8:0;
 x.save();x.globalAlpha=e;x.drawImage(im,gx-cw/2,gy+ch*0.5-ch*0.1*(1-e)+float-ch,cw,ch);x.restore();
 // viewfinder corners
 const m=P?44:40,L=P?70:60,ce=eo(t,0,0.3);x.strokeStyle=col;x.lineWidth=4;
 for(const [cx,cy,sx,sy] of [[m,m,1,1],[W-m,m,-1,1],[m,H-m,1,-1],[W-m,H-m,-1,-1]]){x.beginPath();x.moveTo(cx+sx*L*ce,cy);x.lineTo(cx,cy);x.lineTo(cx,cy+sy*L*ce);x.stroke()}
 // tag
 const pad=P?84:96,top=P?96:96,tagT=`●  ${T.label}${spec.n?`  №${String(spec.n).padStart(3,"0")}`:""}`;
 x.font=`700 ${P?28:26}px Plex`;const tw=x.measureText(tagT).width+40,te=eo(t,0.1,0.4);
 x.save();x.globalAlpha=te;x.fillStyle=hexA(col,0.14);x.strokeStyle=col;x.lineWidth=2;x.beginPath();x.roundRect(pad,top,tw,52,26);x.fill();x.stroke();x.fillStyle=col;x.textBaseline="middle";x.textAlign="left";x.fillText(tagT,pad+20,top+27);x.restore();
 // brand eyes (top right) that blink
 const blink=clock?(Math.sin(clock*1.7)>0.97?0.15:1):1;eyes(x,W-pad-40,top+26,0.9,col,blink*eo(t,0.1,0.4));
 // headline
 const colW=P?W-pad*2:W*0.52;const hf=fit(x,spec.title.toUpperCase(),colW,P?170:190,P?80:70,P?4:3,"Anton",P?H*0.25:H*0.31);
 x.textBaseline="alphabetic";x.textAlign="left";x.font=`${hf.px}px Anton`;
 let y=(P?top+120:top+130)+hf.px*0.92;
 hf.L.forEach((ln,i)=>{const a=eo(t,0.25+i*0.08,0.55+i*0.08);x.save();x.globalAlpha=a;x.fillStyle="#fff";x.shadowColor=hexA(col,0.55);x.shadowBlur=26;x.fillText(ln,pad,y+(1-a)*40);x.restore();y+=hf.px*1.02});
 x.fillStyle=col;x.globalAlpha=eo(t,0.5,0.7);x.fillRect(pad,y-hf.px*0.55,110,8);x.globalAlpha=1;
 // sub
 if(spec.sub){const sf=fit(x,spec.sub,colW,P?38:30,P?26:22,P?4:3,"Plex");x.font=`700 ${sf.px}px Plex`;x.fillStyle="#d4d4d9";x.globalAlpha=eo(t,0.55,0.8);let sy=y-hf.px*0.55+68+sf.px;sf.L.forEach(ln=>{x.fillText(ln,pad,sy);sy+=sf.px*1.35});x.globalAlpha=1;y=sy}
 if(spec.chips&&spec.chips.length){let cx=pad;const cy=Math.min(y+8,H-(P?290:128));x.font=`700 ${P?24:20}px Plex`;for(const c of spec.chips){const w=x.measureText(c).width+32;x.globalAlpha=eo(t,0.7,0.9);x.fillStyle=hexA(col,0.13);x.beginPath();x.roundRect(cx,cy,w,44,12);x.fill();x.fillStyle=col;x.fillText(c,cx+16,cy+30);cx+=w+10}x.globalAlpha=1}
 // ticker
 const ty=H-(P?64:56);x.save();x.beginPath();x.rect(pad,ty-26,W-pad*2,36);x.clip();x.font=`700 ${P?22:20}px Plex`;x.fillStyle="#8d8d95";const seg="WRAITH.FARM   ·   SEVEN CHAINS   ·   ONE GHOST   ·   THE GHOST SAW IT FIRST   ·   ";const sw=x.measureText(seg).width;const off=(clock*60)%sw;x.globalAlpha=eo(t,0.7,1);for(let k=-1;k<4;k++)x.fillText(seg,pad+k*sw-off,ty);x.restore();
 // scanline sweep
 if(clock){const sy=((clock*0.25)%1)*H;const gg=x.createLinearGradient(0,sy-60,0,sy);gg.addColorStop(0,hexA(col,0));gg.addColorStop(1,hexA(col,0.12));x.fillStyle=gg;x.fillRect(0,sy-60,W,60)}
 x.fillStyle="rgba(0,0,0,0.12)";for(let b=0;b<H;b+=4)x.fillRect(0,b,W,1);
}
async function poster(spec,file,W=1600,H=900){await load();const c=createCanvas(W,H),x=c.getContext("2d");draw(x,W,H,spec,1,0);fs.writeFileSync(file,c.toBuffer("image/png"))}
module.exports={draw,load,TYPES,poster,createCanvas,fs};
