import {bubbleRegions,slices,paragraphs,dateMessages,cleanOcrText,screenshotTime,isolatedDot} from './ocr-layout.js?v=2.3.0';
import {localDate} from './core.js?v=2.3.0';
let library;
function loadLibrary(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return library ||= new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('./vendor/tesseract.js?v=6.0.1',import.meta.url).href;
    const timer=setTimeout(()=>{script.remove();library=null;reject(new Error('识别组件加载超时，请检查网络后重试。'));},30000);
    script.onload=()=>{clearTimeout(timer);resolve(window.Tesseract);};script.onerror=()=>{clearTimeout(timer);library=null;reject(new Error('识别组件未能加载，请检查网络后重试。'));};document.head.append(script);
  });
}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function linesForRegions(data,regions,scale,offset){
  const lines=paragraphs(data),rows=[];
  for(const region of regions){
    if(region.symbol){rows.push({text:region.symbol,side:region.side,kind:region.kind,x:region.x0,y:offset+region.y0,height:region.y1-region.y0,confidence:90});continue;}
    const inside=lines.filter(line=>{const b=line.bbox;if(!b)return false;const x=(b.x0+b.x1)/2/scale,y=(b.y0+b.y1)/2/scale;return x>=region.x0-3&&x<=region.x1+3&&y>=region.y0-3&&y<=region.y1+3;});
    if(!inside.length)continue;
    rows.push({text:cleanOcrText(inside.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0).map(l=>l.text).join('\n')),side:region.side,kind:region.kind,x:region.x0,y:offset+region.y0,height:region.y1-region.y0,confidence:inside.reduce((sum,l)=>sum+(l.confidence??data.confidence??0),0)/inside.length,lines:inside.map(l=>({text:l.text,y:offset+l.bbox.y0/scale,height:(l.bbox.y1-l.bbox.y0)/scale,confidence:l.confidence??data.confidence??0}))});
  }
  return rows;
}
export async function recognizeScreenshot(file,{signal,onProgress=()=>{},anchorDate,session,engineOptions={}}={}){
  if(!file||!file.size||file.size>80*1024*1024||!(/\.(png|jpe?g|webp)$/i.test(file.name)||/^image\/(jpeg|png|webp)$/.test(file.type)))throw new Error('请选择不超过 80 MB 的 JPG、PNG 或 WebP 截图。');
  let worker,stopped=false,timer,rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});const url=URL.createObjectURL(file),abort=()=>{stopped=true;void worker?.terminate();if(session)session.worker=null;rejectAbort(new DOMException('Cancelled','AbortError'));};signal?.addEventListener('abort',abort,{once:true});
  const guard=()=>{if(stopped||signal?.aborted)throw new DOMException('Cancelled','AbortError');};
  try{
    const image=new Image();image.src=url;await image.decode();guard();
    const engine=await loadLibrary();guard();onProgress('正在准备中英文识别模型……');
    const startup=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(new Error('识别模型下载超时，请检查网络后重试。'));},90000);});
    worker=session?.worker||await Promise.race([interrupted,startup,engine.createWorker(['chi_sim','eng'],1,{workerPath:new URL('./vendor/tesseract-worker.js?v=6.0.1',import.meta.url).href,corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0',...engineOptions,errorHandler:()=>{}}).then(created=>{if(stopped){void created.terminate();throw new DOMException('Cancelled','AbortError');}return created;})]);clearTimeout(timer);if(session)session.worker=worker;guard();
    await worker.setParameters?.({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'200'});
    async function readCanvas(source){
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;if(session)session.worker=null;void worker.terminate();reject(new Error('这一片识别超时，已保留完成的截图，可以重试。'));},120000);});
      try{return (await Promise.race([worker.recognize(source,{}, {text:true,blocks:true}),deadline,interrupted])).data;}finally{clearTimeout(timer);}
    }
    const rows=[],tiles=slices(image.naturalHeight,image.naturalWidth),ratio=Math.min(1,800/image.naturalWidth),ocrRatio=Math.max(1,Math.min(2,1600/image.naturalWidth));let detected=0;
    for(let index=0;index<tiles.length;index++){
      guard();const tile=tiles[index];onProgress(`正在识别第 ${index+1} / ${tiles.length} 片 · 自动过滤聊天界面`);
      const analysis=canvas(Math.round(image.naturalWidth*ratio),Math.round(tile.height*ratio)),ctx=analysis.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,tile.y,image.naturalWidth,tile.height,0,0,analysis.width,analysis.height);
      const layout=bubbleRegions(ctx.getImageData(0,0,analysis.width,analysis.height),{first:index===0,last:index===tiles.length-1});
      if(layout.regions.some(r=>r.kind==='bubble')){
        let end=layout.top;
        for(const r of [...layout.regions,{y0:layout.bottom,y1:layout.bottom}].sort((a,b)=>a.y0-b.y0)){
          if(r.y0-end>analysis.width*.021)layout.regions.push({x0:analysis.width*.25,x1:analysis.width*.75,y0:end+1,y1:r.y0-1,side:'unknown',kind:'date',plain:true});
          end=Math.max(end,r.y1);
        }
      }
      const textCanvas=canvas(Math.round(image.naturalWidth*ocrRatio),Math.round(tile.height*ocrRatio)),out=textCanvas.getContext('2d',{willReadFrequently:true});out.fillStyle='#fff';out.fillRect(0,0,textCanvas.width,textCanvas.height);
      const k=ocrRatio/ratio;
      if(layout.regions.some(r=>r.kind==='bubble')){
        detected+=layout.regions.filter(r=>r.kind==='bubble').length;
        for(const original of layout.regions.filter(r=>!r.plain)){
          const inset=original.kind==='bubble'?2:0,r={...original,x0:original.x0+inset,x1:original.x1-inset,y0:original.y0+inset,y1:original.y1-inset};
          const x=Math.max(0,Math.floor(r.x0*k)),y=Math.max(0,Math.floor(r.y0*k)),w=Math.min(textCanvas.width-x,Math.ceil((r.x1-r.x0)*k)),h=Math.min(textCanvas.height-y,Math.ceil((r.y1-r.y0)*k));if(w<1||h<1)continue;
          out.drawImage(image,r.x0/ratio,tile.y+r.y0/ratio,(r.x1-r.x0)/ratio,(r.y1-r.y0)/ratio,x,y,w,h);
          const pixels=out.getImageData(x,y,w,h),bg=r.fill[0]*.299+r.fill[1]*.587+r.fill[2]*.114;
          for(let p=0;p<pixels.data.length;p+=4){const lum=pixels.data[p]*.299+pixels.data[p+1]*.587+pixels.data[p+2]*.114;const contrast=bg>130?bg-lum:lum-bg;const v=contrast>42?0:255;pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=v;pixels.data[p+3]=255;}
          out.putImageData(pixels,x,y);
          if(original.kind==='bubble'&&original.x1-original.x0<analysis.width*.07)original.symbol=isolatedDot(pixels);
        }
      }else{
        const left=Math.round(image.naturalWidth*.08),right=Math.round(image.naturalWidth*.92),top=layout.top/ratio,bottom=layout.bottom/ratio;
        out.drawImage(image,left,tile.y+top,right-left,bottom-top,left*ocrRatio,top*ocrRatio,(right-left)*ocrRatio,(bottom-top)*ocrRatio);
      }
      const data=await readCanvas(textCanvas);guard();
      const offset=tile.y*ratio;
      let found=layout.regions.length?linesForRegions(data,layout.regions.filter(r=>!r.plain),k,offset):[];
      if(!found.length){found=paragraphs(data).map(line=>{const b=line.bbox||{x0:0,x1:0,y0:0,y1:0},x=b.x0/ocrRatio,edgeRight=b.x1/ocrRatio;return {text:line.text,side:x<image.naturalWidth*.24?'left':edgeRight>image.naturalWidth*.76?'right':'unknown',kind:'text',x:x*ratio,y:offset+b.y0/k,height:(b.y1-b.y0)/k,confidence:line.confidence??data.confidence??0};}).filter(row=>row.y>=offset+layout.top&&row.y<=offset+layout.bottom);}
      rows.push(...found);textCanvas.width=1;
      const gaps=layout.regions.filter(r=>r.plain);
      if(gaps.length){
        const dates=canvas(Math.round(image.naturalWidth*ocrRatio*.5),Math.ceil(gaps.reduce((n,r)=>n+(r.y1-r.y0)*k+30,0))),dc=dates.getContext('2d',{willReadFrequently:true});dc.fillStyle='white';dc.fillRect(0,0,dates.width,dates.height);let dy=10;const positions=[];
        for(const r of gaps){const height=Math.round((r.y1-r.y0)*k);dc.drawImage(image,r.x0/ratio,tile.y+r.y0/ratio,(r.x1-r.x0)/ratio,(r.y1-r.y0)/ratio,0,dy,dates.width,height);const pixels=dc.getImageData(0,dy,dates.width,height);let avg=0;for(let p=0;p<pixels.data.length;p+=16)avg+=pixels.data[p];avg/=pixels.data.length/16;if(avg<125){for(let p=0;p<pixels.data.length;p+=4)for(let c=0;c<3;c++)pixels.data[p+c]=255-pixels.data[p+c];dc.putImageData(pixels,0,dy);}positions.push({r,dy,height});dy+=height+30;}
        const dateData=await readCanvas(dates);guard();
        for(const line of paragraphs(dateData)){const cy=(line.bbox.y0+line.bbox.y1)/2,pos=positions.find(p=>cy>=p.dy&&cy<=p.dy+p.height);if(pos)rows.push({text:line.text,side:'unknown',kind:'date',x:analysis.width*.25,y:offset+pos.r.y0+(line.bbox.y0-pos.dy)/k,height:(line.bbox.y1-line.bbox.y0)/k,confidence:line.confidence??0});}dates.width=1;
      }
      analysis.width=1;
    }
    const messages=dateMessages(rows,anchorDate||localDate(screenshotTime(file)));
    return {messages,tiles:tiles.length,detected,confidence:messages.length?messages.reduce((n,r)=>n+r.confidence,0)/messages.length:0};
  }catch(e){stopped=true;if(session)session.worker=null;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(!session||stopped)await worker?.terminate();URL.revokeObjectURL(url);}
}
