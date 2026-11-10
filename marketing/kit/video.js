const K=require("./wraithkit.js");const {spawn}=require("child_process");const specs=require("./specs.js");
const OUT=require("path").join(__dirname,"..","out","videos");K.fs.mkdirSync(OUT,{recursive:true});
const pick=[1,3,4,5,10,15];const FPS=30,SEC=6;
async function vid(s,W,H,tag){const file=`${OUT}/${String(s.n).padStart(3,"0")}-${s.type.toLowerCase()}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,24)}-${tag}.mp4`;
 const ff=spawn("ffmpeg",["-y","-f","rawvideo","-pix_fmt","rgba","-s",`${W}x${H}`,"-r",String(FPS),"-i","-","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart",file],{stdio:["pipe","ignore","ignore"]});
 const c=K.createCanvas(W,H),x=c.getContext("2d");
 for(let f=0;f<FPS*SEC;f++){const clock=f/FPS;K.draw(x,W,H,s,Math.min(1,clock/1.8),clock);const buf=c.data();if(!ff.stdin.write(Buffer.from(buf.buffer,buf.byteOffset,buf.length)))await new Promise(r=>ff.stdin.once("drain",r))}
 ff.stdin.end();await new Promise(r=>ff.on("close",r));console.log(file)}
(async()=>{await K.load();for(const n of pick){const s=specs.find(q=>q.n===n);await vid(s,1280,720,"x");}
 await vid(specs.find(q=>q.n===1),1080,1350,"portrait");})();
