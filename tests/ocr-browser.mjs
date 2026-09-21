// Real Tesseract, full untrimmed generated screenshots; no production requests.
// Place chi_sim.traineddata.gz and eng.traineddata.gz in test-results/ocr-models/.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,access,chmod} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {brotliDecompressSync} from 'node:zlib';
const root=process.cwd();await access(resolve(root,'test-results/ocr-models/chi_sim.traineddata.gz'));
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://test').pathname;res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');if(path==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><head><link rel="stylesheet" href="/node_modules/@fontsource/noto-sans-sc/400.css"></head><body></body></html>');}const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error();res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
if(!process.env.CHROMIUM_PATH){const path=resolve(root,'test-results/chromium-ocr');await writeFile(path,brotliDecompressSync(await readFile(resolve(root,'node_modules/@sparticuz/chromium/bin/chromium.br'))));await chmod(path,0o755);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||resolve(root,'test-results/chromium-ocr'),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer']});
try{
 const page=await browser.newPage();await page.goto(base);
 for(const theme of ['light','dark']){
  const data=await page.evaluate(async({base,theme})=>{
   await document.fonts.load('26px "Noto Sans SC"','年月日今天一起测试会话标题输入聊天内容的天气很好记录这一天消息应该保持完整第一二三四五六七八九十行记录新的一天开始了我们继续慢慢聊天最后一条也要留下');const c=document.createElement('canvas');c.width=800;c.height=4300;const x=c.getContext('2d'),dark=theme==='dark';x.fillStyle=dark?'#181b22':'#ebebeb';x.fillRect(0,0,800,4300);x.fillStyle=dark?'#292c34':'#fff';x.fillRect(0,0,800,90);x.fillRect(0,4200,800,100);x.font='24px "Noto Sans SC"';x.fillStyle=dark?'#fff':'#222';x.fillText('10:04 5G',20,28);x.fillText('测试会话标题',300,72);x.fillText('输入聊天内容',120,4260);
   const date=(text,y)=>{x.font='22px "Noto Sans SC"';x.fillStyle=dark?'#ddd':'#666';const width=x.measureText(text).width;x.fillText(text,(800-width)/2,y);};date('2024年9月4日 10:02',135);
   const expected=[];const bubble=(texts,y,side)=>{const left=side==='left'?70:260,w=470,h=texts.length*45+32;x.fillStyle=dark?(side==='left'?'#41454d':'#64506b'):(side==='left'?'#fff':'#96ed6c');x.fillRect(left,y,w,h);x.fillStyle='#8896a8';x.fillRect(side==='left'?15:748,y,40,40);x.font='26px "Noto Sans SC"';x.fillStyle=dark?'#fff':'#151515';texts.forEach((text,i)=>{x.fillText(text,left+18,y+40+i*45);expected.push(text);});};
   bubble(['今天的天气很好'],200,'left');bubble(['一起记录这一天'],430,'right');bubble(['消息应该保持完整'],800,'left');bubble(['第一行记录','第二行记录','第三行记录','第四行记录','第五行记录','第六行记录','第七行记录','第八行记录','第九行记录','第十行记录','第十一行记录','第十二行记录'],1320,'right');date('2024年9月5日 09:30',2100);bubble(['新的一天开始了'],2210,'left');bubble(['我们继续慢慢聊天'],2900,'right');bubble(['最后一条也要留下'],3980,'left');
   const blob=await new Promise(r=>c.toBlob(r)),file=new File([blob],'Screenshot_20260921_100400.png',{type:'image/png'});const {recognizeScreenshot}=await import('/ocr.js?v=2.3.0');const result=await recognizeScreenshot(file,{onProgress:console.log,engineOptions:{corePath:base+'/node_modules/tesseract.js-core/',langPath:base+'/test-results/ocr-models/'}});return {result,expected,png:c.toDataURL()};
  },{base,theme});
  await writeFile(`test-results/ocr-${theme}-long.png`,Buffer.from(data.png.split(',')[1],'base64'));await writeFile(`test-results/ocr-${theme}-long.json`,JSON.stringify(data.result,null,2));const text=data.result.messages.map(r=>r.text).join('\n').replace(/\s/g,'');assert.ok(data.result.tiles>=3);assert.doesNotMatch(text,/测试会话标题|输入聊天内容|5G/);for(const line of data.expected)assert.ok(text.includes(line),`${theme} missing ${line}`);for(const line of data.expected)assert.equal(text.split(line).length-1,1,`${theme} duplicate ${line}`);assert.equal(data.result.messages[0].date,'2024-09-04');assert.equal(data.result.messages.at(-1).date,'2024-09-05');assert.equal(data.result.messages.length,7);assert.deepEqual(data.result.messages.map(r=>r.side),['left','right','left','right','left','right','left']);console.log(`PASS real OCR: ${theme}, ${data.result.tiles} tiles, seven messages, complete text, no duplicates, two dates`);
 }
}finally{await browser.close();server.close();}
