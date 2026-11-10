const K=require("./wraithkit.js");const fs=K.fs;const OUT=require("path").join(__dirname,"..","out");fs.mkdirSync(OUT+"/posters",{recursive:true});
const specs=require("./specs.js");
(async()=>{await K.load();let n=0;for(const s of specs){const slug=`${String(s.n).padStart(3,"0")}-${s.type.toLowerCase()}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,28)}`;
 for(const [tag,W,H] of [["x",1600,900],["portrait",1080,1350]]){const c=K.createCanvas(W,H);K.draw(c.getContext("2d"),W,H,s,1,0);fs.writeFileSync(`${OUT}/posters/${slug}-${tag}.png`,c.toBuffer("image/png"));n++}}
 console.log(n,"posters")})();
